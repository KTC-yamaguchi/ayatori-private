#!/usr/bin/env node
// scripts/lint-skills.mjs
//
// `SKILL.md` を docs/skill-authoring-convention.md（Skill 作成規約）に
// 照らして機械検証する決定論 linter。PR 時の自動チェック（.github/workflows/lint-skills.yml）
// と手動監査（npm run lint:skills）の両方から使う。
//
// 検証する規約（違反があれば exit(1)。PR を実際にブロックするかは
// workflow / ブランチ保護側の設定次第）:
//   1. ファイル名は大文字 `SKILL.md`（小文字 `skill.md` は不可、規約 §3）
//   2. 1 行目から YAML frontmatter（`---` で開き `---` で閉じる）
//   3. `name` あり / 文字種 [a-z0-9-] / 最大 64 文字 / **ディレクトリ名と一致**
//        - skills/<slug>/SKILL.md → name == <slug>（例: 12-design-system）
//        - phases/<slug>/SKILL.md → name == ayatori-<slug>（例: ayatori-question）
//   4. `description` あり / 空・プレースホルダ（TODO 等）でない
//   5. `description` は 1 行形式（block scalar `|` / `>` は不可）。phases はダブルクォート必須 /
//      skills は plain（クォート無し）既定、`: ` 等 YAML plain scalar として不正になる文字列を
//      含む場合のみダブルクォート（規約 §2.2）
//   6. 【警告のみ・PR をブロックしない】Jira チケット番号 / 日付を本文に埋めない（規約 §5）。
//      履歴は git / Jira が持つため本文中のメタ情報はノイズ。コードフェンス / インラインコード内は
//      対象外（stub JSON の timestamp 例示等）。本 Rule のみ SKILL.md 以外の phases/skills 配下
//      .md（refs/ 等の補助 md）に加え、同じ手順書性質を持つ .claude/agents/*.md（subagent 定義）と
//      pipeline.yaml（コメント / rule 文字列に履歴マーカーが堆積しやすい）にも適用。
//      既知の埋め込み（導入時点の残存分）は baseline（ratchet — lint-repo-refs と同方式）で
//      表示を抑制し、**新規 / 超過分だけ**を行番号付きで表示する。
//
// 使い方:
//   node scripts/lint-skills.mjs <file...>   # 指定ファイルのみ検証（CI は PR 変更分を渡す）
//   node scripts/lint-skills.mjs --all       # 追跡中の全対象ファイルを検証（git ls-files ベース）
//   （引数なし = --all）
//   オプション:
//     --baseline <path>        # Rule 6 警告の既知分を抑制（同定キーは file + 種別 + トークン。
//                              #  行番号は含めない — 無関係な編集の行ズレで baseline が壊れないように）
//     --write-baseline <path>  # 全対象ファイルの現状警告を baseline として書き出す（掃除後の縮小更新）
//
// 判定は **git が記録したパス**（大文字小文字を保持）で行う。macOS の case-insensitive FS では
// ローカル glob が誤検出するため、--all は git ls-files を使い、CI は git diff の結果を渡す。
// 引数の path は repo ルート相対へ正規化する（先頭 `./` / 絶対パスでも同一判定になるように）。
// 対象外の引数は黙って落とさず「対象外パス（スキップ）」として明示する。

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NAME_RE = /^[a-z0-9-]+$/;
const NAME_MAX = 64;
// skills/ はフェーズ単位のグループディレクトリ 1 段を許容する (例: skills/reverse/01-ground-truth/SKILL.md)。
// name 規約の照合対象は常に leaf ディレクトリ名 (グループ名ではない)。
export const SKILL_PATH_RE = /^(phases|skills)\/(?:[^/]+\/)?([^/]+)\/(SKILL|skill)\.md$/;
// Rule 6 のみの対象: SKILL.md 以外の phases/skills 配下 .md（refs/ / templates 等の補助 md）
const AUX_MD_PATH_RE = /^(phases|skills)\/.+\.md$/;
// Rule 6 のみの対象（追加分）: subagent 定義 md（SKILL.md と同じ手順書性質）と
// pipeline.yaml（コメント / rule 文字列に「チケット番号 + 完了日」の履歴マーカーが堆積しやすい）
const AGENT_MD_PATH_RE = /^\.claude\/agents\/[^/]+\.md$/;
const RULE6_EXTRA_FILES = new Set(['pipeline.yaml']);
export const isRule6OnlyFile = (f) => AUX_MD_PATH_RE.test(f) || AGENT_MD_PATH_RE.test(f) || RULE6_EXTRA_FILES.has(f);
// 検査対象の全体集合（SKILL.md = 全 Rule / それ以外 = Rule 6 のみ）。
// workflow (.github/workflows/lint-skills.yml) の grep 正規表現・trackedSkillFiles() の pathspec と
// 3 点一致が必要 — scripts/lint-skills.test.mjs が同一性を固定する（更新漏れの黙殺防止）
export const isLintTarget = (f) => SKILL_PATH_RE.test(f) || isRule6OnlyFile(f);
// git ls-files に渡す pathspec（isLintTarget が true になり得る path を全て被覆すること — test が固定）
export const LS_FILES_PATHSPEC = ['phases', 'skills', '.claude/agents', 'pipeline.yaml'];
const PLACEHOLDER_RE = /^(todo|tbd|tba|xxx|fixme|placeholder|-)?$/i;
// plain scalar として値が壊れる代表パターン（`: `/行末 `:`= mapping 誤解釈 / ` #`= コメント開始 /
// 先頭 YAML indicator（`,` 含む）/ 先頭 `- ` `? `= sequence / complex-key 誤解釈）。いずれも PyYAML で
// parse error になることを確認済み（行末 `:` 含む）。完全な YAML 判定はしない
//（yaml 依存なし方針の近似。実際に観測されたのは `: ` 混入）
const PLAIN_UNSAFE_RE = /:(\s|$)|\s#|^[[\]{}#&*!|>'"%@`,]|^[-?](\s|$)/;

const CONV = 'docs/skill-authoring-convention.md';

let cachedRoot = null;
export function repoRoot() {
  if (cachedRoot) return cachedRoot;
  try {
    cachedRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    cachedRoot = process.cwd();
  }
  return cachedRoot;
}

// 引数 path を repo ルート相対（posix 区切り）へ正規化する。完全一致判定
//（RULE6_EXTRA_FILES / 各 path 正規表現）が `./pipeline.yaml` や絶対パスで素通りしないように。
export function normalizeArg(arg, root = repoRoot()) {
  const rel = path.relative(root, path.resolve(arg)); // 相対 path は cwd 基準で解決（subdir からの実行も正しく repo 相対へ）
  return rel.split(path.sep).join('/');
}

export function trackedSkillFiles() {
  const out = execSync(`git ls-files ${LS_FILES_PATHSPEC.join(' ')}`, {
    encoding: 'utf8',
    cwd: repoRoot(),
  });
  return out.split('\n').filter(isLintTarget);
}

// Rule 6（警告のみ）: Jira チケット番号 / 日付のメタ情報を本文に埋めない（規約 §5）。
// 変更履歴・チケット対応は git log / PR / Jira が持つため、本文中の番号・日付はノイズになる。
// コードフェンス（```...```）とインラインコード（`...`）内は対象外
//（pipeline-state stub の timestamp 例示等の正当な用途を誤検出しないため）。
// 警告は exit code に影響しない（既存ファイルの残存分で PR をブロックしないため）。
// 返り値は { kind: 'ticket'|'date', token, lines[] } の配列（lines は 1 起点の行番号 —
// どれが自分の diff 由来かを書き手側で切り分けられるように表示に含める）。
const DATE_RE = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/g;
export function metaInfoWarnings(content) {
  const prose = content
    // フェンス内は改行だけ残して除去する（行番号を保つ）
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/`[^`\n]*`/g, '');
  const found = new Map(); // "kind token" → Set<lineNo>（kind / token とも空白を含まない）
  prose.split(/\r?\n/).forEach((line, i) => {
    const push = (kind, token) => {
      const key = `${kind} ${token}`;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(i + 1);
    };
    for (const m of line.matchAll(/POCTEAMA-\d+/g)) push('ticket', m[0]);
    for (const m of line.matchAll(DATE_RE)) push('date', m[0]);
  });
  return [...found.entries()].map(([key, lines]) => {
    const [kind, token] = key.split(' ');
    return { kind, token, lines: [...lines] };
  });
}

export function formatWarningMessage(w, note = '') {
  const lines = w.lines.map((n) => `L${n}`).join(', ');
  const base =
    w.kind === 'ticket'
      ? `Jira チケット番号 \`${w.token}\` を本文に埋めない（チケット対応は git log / PR / Jira が持つ）[規約 §5.2]`
      : `日付 \`${w.token}\` を本文に埋めない（変更履歴は git が持つ。スナップショット時点の明示等、実質的な意味がある場合のみ可）[規約 §5.1]`;
  return `${base}（${lines}）${note}`;
}

// ── Rule 6 baseline (ratchet — lint-repo-refs と同方針) ─────────────────────
// 同定キー: (file, kind, token)。行番号を含めない（無関係な編集の行ズレで baseline が壊れないように）。
// count は当該トークンが出現する行数 — 現件数が count 以下なら抑制、超過なら「新規追加」として表示する。

const KEY_SEP = String.fromCharCode(0);
const warningKey = (file, w) => [file, w.kind, w.token].join(KEY_SEP);

export function buildBaseline(results) {
  const entries = [];
  for (const r of results) {
    for (const w of r.warnings ?? []) {
      entries.push({ file: r.file, kind: w.kind, token: w.token, count: w.lines.length });
    }
  }
  entries.sort(
    (a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.token.localeCompare(b.token)
  );
  return {
    _comment:
      'lint-skills Rule 6（Jira 番号 / 日付の埋め込み警告）の既知分 baseline (ratchet)。ここに載っている警告は表示を抑制し、超過分（新規追加）だけを表示する。既知分を掃除したら `node scripts/lint-skills.mjs --write-baseline scripts/lint-skills.baseline.json` で縮めること。エントリを増やす方向の手編集は、その埋め込みを意図的に許容するレビュー判断があるときのみ。',
    entries,
  };
}

export function loadBaseline(p, root = repoRoot()) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path.join(root, p), 'utf8'));
  } catch (e) {
    throw new Error(`baseline の読込に失敗: ${p} (${e.message})`);
  }
  if (!Array.isArray(parsed?.entries)) {
    throw new Error(`baseline の形式が不正 (entries 配列がない): ${p}`);
  }
  const counts = new Map();
  for (const e of parsed.entries) {
    counts.set([e.file, e.kind, e.token].join(KEY_SEP), e.count ?? 0);
  }
  return counts;
}

// 警告を baseline と突合して { shown, suppressed } に分ける
export function applyBaseline(file, warnings, baselineCounts) {
  const shown = [];
  let suppressed = 0;
  for (const w of warnings) {
    const allowed = baselineCounts.get(warningKey(file, w)) ?? 0;
    if (w.lines.length <= allowed) {
      suppressed++;
      continue;
    }
    shown.push({
      ...w,
      note: allowed > 0 ? ` — baseline 許容 ${allowed} 行を超過（現在 ${w.lines.length} 行）` : '',
    });
  }
  return { shown, suppressed };
}

// frontmatter を最小パース（yaml 依存なし）。`name` / `description` の有無と値を返す。
export function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { present: false };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { present: false, unterminated: true };
  const fm = lines.slice(1, end);

  const readScalar = (key) => {
    for (let i = 0; i < fm.length; i++) {
      const m = fm[i].match(new RegExp(`^${key}:\\s*(.*)$`));
      if (!m) continue;
      let val = m[1].trim();
      let style;
      // block scalar (| or >) / 値なしの複数行 plain → 後続のインデント行を連結
      if (val === '' || val === '|' || val === '>' || val === '|-' || val === '>-') {
        style = 'block';
        const block = [];
        for (let j = i + 1; j < fm.length; j++) {
          if (/^\s+\S/.test(fm[j])) block.push(fm[j].trim());
          else if (fm[j].trim() === '') continue;
          else break;
        }
        val = block.join(' ').trim();
      } else if (val.startsWith('"') || val.startsWith("'")) {
        // 開始 + 終了クォートが揃う場合のみ quoted 扱い。末尾コメント（`"..." # c` は有効 YAML）は除去。
        // 閉じクォート欠落は YAML として不正 → 'malformed'（Rule 5 で検出）
        const m2 = val[0] === '"' ? val.match(/^"(.*)"\s*(?:#.*)?$/) : val.match(/^'(.*)'\s*(?:#.*)?$/);
        if (m2) {
          style = val[0] === '"' ? 'double' : 'single';
          val = m2[1].trim();
        } else {
          style = 'malformed';
          val = val.slice(1).trim();
        }
      } else {
        style = 'plain';
        // key と同一行に値があっても、次の非空行がインデント継続なら multi-line plain folding
        //（有効 YAML だが 1 行形式ではない）→ 'block' に合流させ Rule 5 で検出
        let j = i + 1;
        while (j < fm.length && fm[j].trim() === '') j++;
        if (j < fm.length && /^\s+\S/.test(fm[j])) {
          style = 'block';
          const cont = [val];
          for (; j < fm.length; j++) {
            if (/^\s+\S/.test(fm[j])) cont.push(fm[j].trim());
            else if (fm[j].trim() === '') continue;
            else break;
          }
          val = cont.join(' ').trim();
        }
      }
      return { found: true, value: val, style };
    }
    return { found: false };
  };

  return { present: true, name: readScalar('name'), description: readScalar('description') };
}

export function lintFile(file) {
  const errors = [];
  const abs = path.join(repoRoot(), file);
  const m = file.match(SKILL_PATH_RE);
  if (!m) {
    // 補助 md（refs/ 等）/ subagent 定義 md / pipeline.yaml は Rule 6（警告）のみ検査
    if (!isRule6OnlyFile(file)) return { file, skipped: true, errors };
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      return { file, errors: [`ファイルを読めない: ${file}`] };
    }
    return { file, errors, warnings: metaInfoWarnings(content) };
  }
  const [, top, slug, base] = m;
  const expectedName = top === 'phases' ? `ayatori-${slug}` : slug;

  // Rule 1: ファイル名は大文字 SKILL.md
  if (base !== 'SKILL') {
    errors.push(`ファイル名は大文字 \`SKILL.md\` にする（現在: ${base}.md）[規約 §3]`);
  }

  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    return { file, errors: [`ファイルを読めない: ${file}`] };
  }

  const fm = parseFrontmatter(content);

  // Rule 2: frontmatter
  if (!fm.present) {
    errors.push(
      fm.unterminated
        ? 'frontmatter が `---` で閉じていない [規約 §2]'
        : '1 行目から `---` の YAML frontmatter が必要 [規約 §2]'
    );
    return { file, errors }; // frontmatter が無ければ name/description も判定不能
  }

  // Rule 3: name
  if (!fm.name.found || fm.name.value === '') {
    errors.push('`name` が必要 [規約 §2.1]');
  } else {
    const n = fm.name.value;
    if (!NAME_RE.test(n)) errors.push(`\`name\` は小文字英数字とハイフンのみ（現在: "${n}"）[規約 §2.1]`);
    else if (n.length > NAME_MAX) errors.push(`\`name\` は最大 ${NAME_MAX} 文字（現在: ${n.length}）[規約 §2.1]`);
    else if (n !== expectedName) errors.push(`\`name\` はディレクトリ名と一致させる: "${expectedName}"（現在: "${n}"）[規約 §2.1]`);
  }

  // Rule 4: description
  if (!fm.description.found || fm.description.value === '') {
    errors.push('`description` が必要 [規約 §2.2]');
  } else if (PLACEHOLDER_RE.test(fm.description.value) || fm.description.value.length < 3) {
    errors.push(`\`description\` がプレースホルダ / 短すぎる（"${fm.description.value}"）[規約 §2.2]`);
  }

  // Rule 5: description の書式 — 1 行形式 + 層ごとの quote 規則（規約 §2.2）
  if (fm.description.found && fm.description.value !== '') {
    const { style, value } = fm.description;
    if (style === 'block') {
      errors.push('`description` は 1 行形式にする（block scalar `|` / `>` もインデント継続の複数行も不可）[規約 §2.2]');
    } else if (style === 'malformed') {
      errors.push('`description` のクォートが同一行で閉じていない（1 行形式 + 同一行での閉じクォートが必要）[規約 §2.2]');
    } else if (top === 'phases') {
      if (style !== 'double') {
        errors.push('phases の `description` は常にダブルクォートで囲む（`description: "..."`）[規約 §2.2]');
      }
    } else if (style === 'single') {
      errors.push('skills の `description` は plain（クォート無し）を既定にする。quote が必要な場合はダブルクォート [規約 §2.2]');
    } else if (style === 'plain' && PLAIN_UNSAFE_RE.test(value)) {
      errors.push('`description` が YAML plain scalar として不正（`: ` / ` #` / 先頭 indicator 文字）。ダブルクォートで囲む [規約 §2.2]');
    }
  }

  // Rule 6（警告のみ）: Jira チケット番号 / 日付を本文に埋めない
  return { file, errors, warnings: metaInfoWarnings(content) };
}

function main() {
  const argv = process.argv.slice(2);
  const fileArgs = [];
  let all = false;
  let baselinePath = null;
  let writeBaselinePath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') all = true;
    else if (a === '--baseline') baselinePath = argv[++i];
    else if (a === '--write-baseline') writeBaselinePath = argv[++i];
    else if (a.startsWith('--')) {
      console.error(`未知のオプション: ${a}`);
      process.exit(2);
    } else fileArgs.push(a);
  }
  if (baselinePath === undefined || writeBaselinePath === undefined) {
    console.error('--baseline / --write-baseline には path が必要');
    process.exit(2);
  }

  // --write-baseline: 全対象ファイルの現状警告を書き出して終了（掃除後の縮小更新用）
  if (writeBaselinePath) {
    const results = trackedSkillFiles().map(lintFile).filter((r) => !r.skipped);
    const baseline = buildBaseline(results);
    writeFileSync(path.join(repoRoot(), writeBaselinePath), JSON.stringify(baseline, null, 2) + '\n');
    console.log(`baseline を書き出した: ${writeBaselinePath}（${baseline.entries.length} entries）`);
    return;
  }

  let files;
  const skippedArgs = [];
  if (fileArgs.length === 0 || all) {
    files = trackedSkillFiles();
  } else {
    // 引数 path を正規化して対象判定する。対象外は黙って落とさず末尾で明示する
    //（`./` 付き・絶対パス・対象外ツリーの渡し間違いに気付けるように）
    files = [];
    for (const a of fileArgs) {
      const f = normalizeArg(a);
      if (isLintTarget(f)) files.push(f);
      else skippedArgs.push(a);
    }
  }

  let baselineCounts = new Map();
  if (baselinePath) {
    try {
      baselineCounts = loadBaseline(baselinePath);
    } catch (e) {
      console.error(e.message);
      process.exit(2);
    }
  }

  const results = files.map(lintFile).filter((r) => !r.skipped);
  let failCount = 0;
  let warnCount = 0;
  let suppressedTotal = 0;

  for (const r of results) {
    const { shown, suppressed } = applyBaseline(r.file, r.warnings ?? [], baselineCounts);
    suppressedTotal += suppressed;
    if (r.errors.length === 0) {
      console.log(`${shown.length > 0 ? '⚠' : '✓'} ${r.file}`);
    } else {
      failCount++;
      console.log(`✗ ${r.file}`);
      for (const e of r.errors) console.log(`    - ${e}`);
    }
    if (shown.length > 0) {
      warnCount++;
      for (const w of shown) console.log(`    ⚠ ${formatWarningMessage(w, w.note)}`);
    }
  }

  for (const a of skippedArgs) console.log(`- 対象外パス（スキップ）: ${a}`);

  const ok = results.length - failCount;
  const suppressedNote =
    suppressedTotal > 0 ? `（baseline 抑制 ${suppressedTotal} 件 — 掃除が進んだら --write-baseline で縮める）` : '';
  console.log(`\n${results.length} 件検査 / ${ok} OK / ${failCount} 違反 / 警告あり ${warnCount} 件${suppressedNote}`);
  if (failCount > 0) {
    console.log(`\n規約: ${CONV}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
