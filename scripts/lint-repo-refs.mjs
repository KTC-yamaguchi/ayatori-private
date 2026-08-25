#!/usr/bin/env node
// scripts/lint-repo-refs.mjs — 宣言整合 lint v1 (stale drift の機械検出)
//
// 一括リネーム・原則追加・enum 廃止のたびに「参照側の更新漏れ (stale drift)」が
// 発生し、人間の grep 目視に依存してきた。本 script はその検出を決定的処理として
// 固定化する。v1 は偽陽性リスクの低い機械チェック 5 種に限定する:
//
//   1. path-ref          docs/*.md / skills/**.md / schemas/*.json 参照パスの実在検査
//                        (macOS の case-insensitive FS に騙されないよう case-sensitive 照合)
//   2. skill-md-case     小文字 skill.md 参照の検出 (正: 大文字 SKILL.md)
//   3. principle-ref     「Operating Principle N / 原則N」引用 ↔ CLAUDE.md 見出し番号の突合
//                        (同一行の文脈キーワードから正しい原則番号を逆引きして照合)
//   4. command-policy    pipeline.yaml command_policy.allowed_commands ↔
//                        phases/*/SKILL.md frontmatter name: の双方向突合
//   5. deprecated-token  廃止 enum / 旧 MCP ツール名の denylist 照合
//
// 依存ゼロ (node:fs / node:path / node:url のみ)。schema↔writer 突合 (prose から書き込み key を
// 抽出する類) は偽陽性リスクが高いため v1 対象外。
//
// Usage:
//   node scripts/lint-repo-refs.mjs [--root <dir>] [--json]
//   node scripts/lint-repo-refs.mjs --baseline <path>         # ratchet モード (CI 用)
//   node scripts/lint-repo-refs.mjs --write-baseline <path>   # 現状を baseline として書き出す
//
// Baseline (ratchet) モード:
//   導入時点で既に存在する既知違反を baseline ファイルに記録して許容し、
//   「baseline を超える新規違反」だけを exit 1 でブロックする。既知違反の修正が
//   進んだら --write-baseline で baseline を縮める (増やす方向の更新は、その違反を
//   意図的に許容するという明示的なレビュー判断があるときのみ)。
//   違反の同定は (check, file, message) の組で行い、行番号は含めない
//   (無関係な編集による行ズレで baseline が壊れないようにするため)。
//   同一 (check, file, message) が複数回出現する場合は件数で比較する
//   (既知 2 件の file に 3 件目が増えたら新規違反として検出する)。
//
// Exit code:
//   0 = 違反なし (baseline モードでは新規違反なし)
//   1 = 違反あり (baseline モードでは baseline 超過の新規違反あり)
//   2 = 運用エラー (CLAUDE.md 不在・キーワード表の検証失敗・baseline 読込失敗等)

import { readFileSync, readdirSync, lstatSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

// ── スキャン範囲 ─────────────────────────────────────────────

// 走査から除外するディレクトリ (repo-root 相対)。
// - artifacts/     : 実行時成果物 (プロジェクトごとの生成物、宣言ではない)
// - scripts/       : lint 自身とテストが denylist 文字列・fixture を含むため
// - docs/superpowers, docs/issues : 履歴文書 (「当時の記録」であり修正対象外)
// - docs/test-fixtures, docs/templates, docs/images : fixture / テンプレ / 画像
// - .claude/skills : router SKILL.md への symlink 群 (実体側を走査すれば十分)
// - .claude/worktrees : 別ブランチの作業コピー (git 管理外・CI には存在しない)
// - user/          : 実行時メモリ置き場 (git 管理外の想定)
const EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "artifacts",
  "scripts",
  "_backup",
  "user",
  "licenses", // vendored 第三者ライセンス文書 (旧構成への言及を含む歴史記録)
  join("docs", "superpowers"),
  join("docs", "issues"),
  join("docs", "test-fixtures"),
  join("docs", "templates"),
  join("docs", "images"),
  join(".claude", "skills"),
  join(".claude", "worktrees"),
]);

// 個別ファイルの除外 (repo-root 相対)。settings.local.json は gitignored な
// 個人ローカル設定で、宣言 (repo にコミットされた SoT) ではない。
const EXCLUDE_FILES = new Set([join(".claude", "settings.local.json")]);

const SCAN_EXTS = new Set([".md", ".yaml", ".yml", ".json", ".sh"]);

// ── check 3: 原則番号 ↔ 文脈キーワード対応表 ──────────────────
//
// 各 keyword は「その原則にしか現れない識別語」。実行時に CLAUDE.md の
// `## Operating Principles` 配下の見出し (`### N. <title>`) と突合して
//   (a) 番号 N の見出しが存在する
//   (b) N の keyword の少なくとも 1 つが見出しタイトルに含まれる
//   (c) keyword が他の原則タイトルに現れない (一意性)
// を検証する。原則の改番・改名でこの表が古くなると exit 2 で停止するため、
// 表の陳腐化が silent に進むことはない。
// 注意: 英語 "uncertain" は 5 分類表記「(D) UNCERTAIN」として原則説明の周辺に
// 頻出し、原則名の引用と区別できず誤爆するため keyword に採用しない。
const PRINCIPLE_KEYWORDS = {
  1: ["external tooling", "外部CLI"],
  2: ["subagent permissions"],
  3: ["一次ソース", "primary source"],
  4: ["未確定", "補完せず質問"],
  5: ["外部コマンド", "external command"],
};

// ── check 5: 廃止トークン denylist ──────────────────────────
//
// allowFiles = そのトークンへの言及が正当なファイル (repo-root 相対)。
// 典型は「廃止を宣言している SoT 自身」。
const DEPRECATED_TOKENS = [
  {
    token: "all_states_and_platforms",
    allowFiles: ["pipeline.yaml"],
    note: "廃止 enum。新 enum: user_selected | all_platforms (pipeline.yaml screens.figma_export.scope)",
  },
  {
    token: "mcp__plugin_figma_figma__",
    allowFiles: [],
    note: "旧 Figma MCP ツール名 prefix。現行: mcp__figma__",
  },
  {
    token: "wcag-mapping.json.violations",
    allowFiles: ["skills/08-design-brainstorm/SKILL.md"], // W1 rename の沿革注記のみ許容
    note: "W1 リファクタで廃止 — violations は wcag-history.json.attempts[].violations に分離済",
  },
  // シークレットの在り処 (保管先 Confluence ページ) を指す情報は repo に書かない
  // (TFS Standard 13.02.03 シークレットの保存要件 / PR #202 レビュー指摘)。
  // 「取得先はチーム内で共有 — 不明な場合はチームに確認」の形で書く。
  {
    token: "4022960181",
    allowFiles: [],
    note: "画像生成 API キー保管先の Confluence page ID。在り処情報は repo に書かない (TFS Standard 13.02.03)",
  },
  {
    token: "ayatori-openai のアカウント情報",
    allowFiles: [],
    note: "画像生成 API キー保管先の Confluence ページ名。在り処情報は repo に書かない (TFS Standard 13.02.03)",
  },
];

// ── check 1: 参照パス実在検査の除外 ──────────────────────────
//
// 行にこれらの語が含まれる場合、その行の path 参照は「存在しないことを
// 明示的に説明している文」なので実在検査しない。
const PATH_REF_LINE_SUPPRESSORS = ["存在しない", "実装予定", "将来導入"];

// 個別 allowlist (repo-root 相対 path 文字列そのもの)。意図的に架空の
// 例示 path を書く場合はここに追加する。
const PATH_REF_ALLOWLIST = new Set([
  "skills/NN-name/SKILL.md", // README / retro 系で使う「step skill の一般形」例示
]);

// check 2 のファイル単位 allowlist。命名規約そのものを説明する文書は「使ってはいけない
// 小文字 skill.md」を反例として本文に含むため、検出対象から除外する。
const SKILL_MD_CASE_ALLOW_FILES = new Set([
  "CLAUDE.md",
  join("docs", "skill-authoring-convention.md"),
]);

// ── 汎用ヘルパー ─────────────────────────────────────────────

function walk(root) {
  const files = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs);
      if (EXCLUDE_DIRS.has(rel) || EXCLUDE_FILES.has(rel)) continue;
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        visit(abs);
      } else if (st.isFile()) {
        const dot = e.name.lastIndexOf(".");
        const ext = dot >= 0 ? e.name.slice(dot) : "";
        if (SCAN_EXTS.has(ext)) files.push(rel);
      }
    }
  };
  visit(root);
  return files.sort();
}

// macOS の default FS は case-insensitive のため existsSync では
// `skill.md` ↔ `SKILL.md` の大文字小文字違いを検出できない。
// ディレクトリ実体の entry 名と 1 セグメントずつ厳密比較する。
// cache は 1 回の lint 実行内でのみ有効 (runLint() 冒頭で clear)。同一プロセスで
// 複数回呼んでも、呼び出し間の FS 変更が反映され、cache も増え続けない。
const dirCache = new Map();
function caseSensitiveExists(root, relPath) {
  let cur = root;
  for (const seg of relPath.split("/")) {
    if (!dirCache.has(cur)) {
      try {
        dirCache.set(cur, new Set(readdirSync(cur)));
      } catch {
        dirCache.set(cur, new Set());
      }
    }
    if (!dirCache.get(cur).has(seg)) return false;
    cur = join(cur, seg);
  }
  // 参照パスはファイル想定。同名ディレクトリ (例: docs/foo.md/) を
  // 「参照先が存在する」と誤判定しないよう、最後にファイルであることを確認する
  // (statSync は symlink を辿るので、ファイルへの symlink も実在扱いになる)。
  try {
    return statSync(cur).isFile();
  } catch {
    return false;
  }
}

function readLines(root, rel) {
  // CRLF ファイルでも行末に \r が残らないように分割する
  return readFileSync(join(root, rel), "utf8").split(/\r?\n/);
}

// ── check 1: 参照パスの実在検査 ──────────────────────────────

// lookbehind (?<![\w/.-]) は `.claude/skills/...` のような長い path の途中を
// `skills/...` として部分マッチする誤検出を防ぐ (直前が path 構成文字なら不採用)。
const PATH_REF_RE = /(?<![\w/.-])(?:docs\/[A-Za-z0-9_./-]+\.md|skills\/[A-Za-z0-9_./-]+\.md|schemas\/[A-Za-z0-9_.-]+\.json)\b/g;
const PATH_REF_EXTS = new Set([".md", ".yaml", ".yml", ".json"]);

function checkPathRefs(root, rel, lines, violations) {
  lines.forEach((line, i) => {
    if (PATH_REF_LINE_SUPPRESSORS.some((s) => line.includes(s))) return;
    for (const m of line.matchAll(PATH_REF_RE)) {
      const ref = m[0];
      // プレースホルダ・glob を含む参照は runtime 展開なので対象外
      if (/[{}*<>]/.test(ref)) continue;
      if (PATH_REF_ALLOWLIST.has(ref)) continue;
      if (!caseSensitiveExists(root, ref)) {
        violations.push({
          check: "path-ref",
          file: rel,
          line: i + 1,
          message: `参照先が存在しない (case-sensitive 照合): ${ref}`,
        });
      }
    }
  });
}

// ── check 2: 小文字 skill.md 参照の検出 ──────────────────────

function checkSkillMdCase(root, rel, lines, violations) {
  if (SKILL_MD_CASE_ALLOW_FILES.has(rel)) return;
  lines.forEach((line, i) => {
    if (line.includes("skill.md")) {
      violations.push({
        check: "skill-md-case",
        file: rel,
        line: i + 1,
        message: "小文字 skill.md 参照 (正: 大文字 SKILL.md。case-sensitive な Linux 環境で参照が壊れる)",
      });
    }
  });
}

// ── check 3: 原則番号引用 ↔ CLAUDE.md 見出しの突合 ───────────

function parsePrincipleHeadings(root) {
  const claudeMd = join(root, "CLAUDE.md");
  if (!existsSync(claudeMd)) {
    throw new OperationalError("CLAUDE.md が見つからない (--root の指定を確認)");
  }
  const lines = readFileSync(claudeMd, "utf8").split(/\r?\n/);
  const headings = new Map(); // number -> title
  let inSection = false;
  for (const line of lines) {
    if (/^## Operating Principles\b/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^## /.test(line)) break; // 次の H2 でセクション終了
    if (!inSection) continue;
    const m = line.match(/^### (\d+)\.\s*(.+?)\s*$/);
    if (m) headings.set(Number(m[1]), m[2]);
  }
  if (headings.size === 0) {
    throw new OperationalError("CLAUDE.md の Operating Principles 見出し (### N. ...) が 1 件も見つからない");
  }
  return headings;
}

function validateKeywordTable(headings) {
  for (const [numStr, keywords] of Object.entries(PRINCIPLE_KEYWORDS)) {
    const num = Number(numStr);
    const title = headings.get(num);
    if (title === undefined) {
      throw new OperationalError(
        `原則 ${num} の見出しが CLAUDE.md に存在しない。原則が改番された場合は PRINCIPLE_KEYWORDS を更新すること`
      );
    }
    const titleLower = title.toLowerCase();
    if (!keywords.some((kw) => titleLower.includes(kw.toLowerCase()))) {
      throw new OperationalError(
        `原則 ${num} の見出し「${title}」に PRINCIPLE_KEYWORDS[${num}] のいずれも含まれない。表を見出しに追随させること`
      );
    }
    // 一意性: keyword が他の原則タイトルに現れたら逆引きが誤爆するため停止
    for (const kw of keywords) {
      for (const [otherNum, otherTitle] of headings) {
        if (otherNum !== num && otherTitle.toLowerCase().includes(kw.toLowerCase())) {
          throw new OperationalError(
            `keyword「${kw}」が原則 ${num} と ${otherNum} の両方の見出しに一致する。より識別的な語に変えること`
          );
        }
      }
    }
  }
}

const PRINCIPLE_REF_RE = /(?:Operating Principles?|原則)\s*(\d+)/g;

function checkPrincipleRefs(rel, lines, headings, violations) {
  lines.forEach((line, i) => {
    for (const m of line.matchAll(PRINCIPLE_REF_RE)) {
      const cited = Number(m[1]);
      const lineLower = line.toLowerCase();
      const matchedNums = new Set();
      for (const [numStr, keywords] of Object.entries(PRINCIPLE_KEYWORDS)) {
        if (keywords.some((kw) => lineLower.includes(kw.toLowerCase()))) {
          matchedNums.add(Number(numStr));
        }
      }
      // 同一行に文脈キーワードが無ければ検証不能としてスキップ (drift 検出に限定)
      if (matchedNums.size === 0) continue;
      if (!matchedNums.has(cited)) {
        const expected = [...matchedNums]
          .map((n) => `${n} (${headings.get(n) ?? "?"})`)
          .join(" / ");
        violations.push({
          check: "principle-ref",
          file: rel,
          line: i + 1,
          message: `原則番号ズレ: 「${cited}」と引用されているが、同一行の文脈キーワードは原則 ${expected} を指す`,
        });
      }
    }
  });
}

// ── check 4: allowed_commands ↔ phases frontmatter の突合 ────

function parseAllowedCommands(root) {
  const yamlPath = join(root, "pipeline.yaml");
  if (!existsSync(yamlPath)) {
    throw new OperationalError("pipeline.yaml が見つからない (--root の指定を確認)");
  }
  const lines = readFileSync(yamlPath, "utf8").split(/\r?\n/);
  const idx = lines.findIndex((l) => /^\s*allowed_commands:\s*(#.*)?$/.test(l));
  if (idx < 0) {
    throw new OperationalError("pipeline.yaml に allowed_commands: ブロックが見つからない");
  }
  const baseIndent = lines[idx].match(/^(\s*)/)[1].length;
  const commands = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= baseIndent) break; // ブロック終端 (dedent)
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^-\s*([A-Za-z0-9_-]+)/);
    if (m) commands.push(m[1]);
    else break; // list item 以外が現れたらブロック終端
  }
  return { commands, line: idx + 1 };
}

function parsePhaseNames(root) {
  const phasesDir = join(root, "phases");
  const names = new Map(); // name -> phases/<dir>/SKILL.md
  if (!existsSync(phasesDir)) return names;
  for (const e of readdirSync(phasesDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const skillRel = join("phases", e.name, "SKILL.md");
    const skillAbs = join(root, skillRel);
    if (!existsSync(skillAbs)) continue;
    const text = readFileSync(skillAbs, "utf8");
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const nameMatch = fm[1].match(/^name:\s*"?([A-Za-z0-9_-]+)"?\s*$/m);
    if (nameMatch) names.set(nameMatch[1], skillRel.split(sep).join("/"));
  }
  return names;
}

function checkCommandPolicy(root, violations) {
  const { commands, line } = parseAllowedCommands(root);
  const allowed = new Set(commands);
  const phaseNames = parsePhaseNames(root);
  for (const [name, skillRel] of phaseNames) {
    if (!allowed.has(name)) {
      violations.push({
        check: "command-policy",
        file: "pipeline.yaml",
        line,
        message: `allowed_commands に未登録: ${name} (${skillRel} frontmatter name)。正規コマンドが halt_and_confirm される自己矛盾になる`,
      });
    }
  }
  for (const name of allowed) {
    if (!phaseNames.has(name)) {
      violations.push({
        check: "command-policy",
        file: "pipeline.yaml",
        line,
        message: `allowed_commands の「${name}」に対応する phases/*/SKILL.md frontmatter name が存在しない (phase 削除 / 改名の取り残し)`,
      });
    }
  }
}

// ── check 5: 廃止トークン denylist ───────────────────────────

function checkDeprecatedTokens(rel, lines, violations) {
  for (const entry of DEPRECATED_TOKENS) {
    if (entry.allowFiles.includes(rel)) continue;
    lines.forEach((line, i) => {
      if (line.includes(entry.token)) {
        violations.push({
          check: "deprecated-token",
          file: rel,
          line: i + 1,
          message: `廃止トークン: ${entry.token} — ${entry.note}`,
        });
      }
    });
  }
}

// ── 実行本体 ─────────────────────────────────────────────────

class OperationalError extends Error {}

export function runLint(root) {
  dirCache.clear();
  const violations = [];
  const headings = parsePrincipleHeadings(root);
  validateKeywordTable(headings);
  checkCommandPolicy(root, violations);

  for (const rel of walk(root)) {
    const relPosix = rel.split(sep).join("/");
    const lines = readLines(root, rel);
    const ext = relPosix.slice(relPosix.lastIndexOf("."));
    if (PATH_REF_EXTS.has(ext)) checkPathRefs(root, relPosix, lines, violations);
    checkSkillMdCase(root, relPosix, lines, violations);
    checkPrincipleRefs(relPosix, lines, headings, violations);
    checkDeprecatedTokens(relPosix, lines, violations);
  }

  violations.sort((a, b) =>
    a.check.localeCompare(b.check) || a.file.localeCompare(b.file) || a.line - b.line
  );
  return violations;
}

// ── baseline (ratchet) ───────────────────────────────────────

// 同定キー: 行番号を含めない (無関係な編集の行ズレで baseline が壊れないように)
// KEY_SEP は check / file / message のいずれにも現れない NUL 文字。
// 生バイトを source に埋め込まないよう実行時に生成する。
const KEY_SEP = String.fromCharCode(0);
function violationKey(v) {
  return [v.check, v.file, v.message].join(KEY_SEP);
}

// violations を (check, file, message) ごとの件数に集約する
export function aggregateViolations(violations) {
  const counts = new Map();
  for (const v of violations) {
    const key = violationKey(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function buildBaseline(violations) {
  const counts = aggregateViolations(violations);
  const entries = [...counts.entries()]
    .map(([key, count]) => {
      const [check, file, message] = key.split(KEY_SEP);
      return { check, file, message, count };
    })
    .sort(
      (a, b) =>
        a.check.localeCompare(b.check) ||
        a.file.localeCompare(b.file) ||
        a.message.localeCompare(b.message)
    );
  return {
    _comment:
      "lint-repo-refs の既知違反 baseline (ratchet)。ここに載っている違反は CI で許容され、超過分 (新規 drift) だけが exit 1 でブロックされる。既知違反を修正したら `node scripts/lint-repo-refs.mjs --write-baseline scripts/lint-repo-refs.baseline.json` で縮めること。エントリを増やす方向の手編集は「その drift を意図的に許容する」レビュー判断があるときのみ。",
    entries,
  };
}

export function loadBaseline(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new OperationalError(`baseline の読込に失敗: ${path} (${e.message})`);
  }
  if (!Array.isArray(parsed.entries)) {
    throw new OperationalError(`baseline の形式が不正 (entries 配列がない): ${path}`);
  }
  const counts = new Map();
  for (const e of parsed.entries) {
    counts.set([e.check, e.file, e.message].join(KEY_SEP), e.count ?? 1);
  }
  return counts;
}

// 現在の violations を baseline と突合し、超過 (新規) と解消済みを分離する。
// 返り値:
//   newViolations  — baseline 許容数を超えた分の violation (現出現の末尾から超過数分)
//   resolvedKeys   — baseline にあるが現在は件数が減った/消えたエントリ (情報表示用)
//   baselinedCount — baseline で許容された件数
export function compareWithBaseline(violations, baselineCounts) {
  const byKey = new Map();
  for (const v of violations) {
    const key = violationKey(v);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(v);
  }

  const newViolations = [];
  for (const [key, occurrences] of byKey) {
    const allowed = baselineCounts.get(key) ?? 0;
    if (occurrences.length > allowed) {
      newViolations.push(
        ...occurrences.slice(allowed).map((v) => ({
          ...v,
          baseline_note:
            allowed > 0 ? `baseline 許容 ${allowed} 件を超過 (現在 ${occurrences.length} 件)` : "baseline 未登録の新規違反",
        }))
      );
    }
  }

  const resolvedKeys = [];
  for (const [key, allowed] of baselineCounts) {
    const current = byKey.get(key)?.length ?? 0;
    if (current < allowed) {
      const [check, file, message] = key.split(KEY_SEP);
      resolvedKeys.push({ check, file, message, baseline: allowed, current });
    }
  }

  const baselinedCount = violations.length - newViolations.length;
  return { newViolations, resolvedKeys, baselinedCount };
}

export {
  parsePrincipleHeadings,
  validateKeywordTable,
  parseAllowedCommands,
  parsePhaseNames,
  caseSensitiveExists,
  OperationalError,
};

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let asJson = false;
  let baselinePath = null;
  let writeBaselinePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) {
      root = args[++i];
    } else if (args[i] === "--json") {
      asJson = true;
    } else if (args[i] === "--baseline" && args[i + 1]) {
      baselinePath = args[++i];
    } else if (args[i] === "--write-baseline" && args[i + 1]) {
      writeBaselinePath = args[++i];
    } else {
      console.error(
        `不明な引数: ${args[i]}\nUsage: node scripts/lint-repo-refs.mjs [--root <dir>] [--json] [--baseline <path> | --write-baseline <path>]`
      );
      process.exit(2);
    }
  }
  if (baselinePath && writeBaselinePath) {
    console.error("lint-repo-refs: --baseline と --write-baseline は同時指定できない");
    process.exit(2);
  }

  let violations;
  try {
    violations = runLint(root);

    if (writeBaselinePath) {
      const baseline = buildBaseline(violations);
      writeFileSync(writeBaselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
      console.log(
        `lint-repo-refs: baseline を書き出した: ${writeBaselinePath} (違反 ${violations.length} 件 / ${baseline.entries.length} エントリ)`
      );
      process.exit(0);
    }

    if (baselinePath) {
      const baselineCounts = loadBaseline(baselinePath);
      const { newViolations, resolvedKeys, baselinedCount } = compareWithBaseline(violations, baselineCounts);

      if (asJson) {
        console.log(
          JSON.stringify(
            {
              new_violations: newViolations,
              resolved_baseline_entries: resolvedKeys,
              summary: { new: newViolations.length, baselined: baselinedCount },
            },
            null,
            2
          )
        );
      } else {
        for (const v of newViolations) {
          console.log(`[${v.check}] ${v.file}:${v.line} ${v.message} — ${v.baseline_note}`);
        }
        for (const r of resolvedKeys) {
          console.log(
            `(info) baseline 解消: [${r.check}] ${r.file} — ${r.message} (baseline ${r.baseline} 件 → 現在 ${r.current} 件)。--write-baseline で縮めてよい`
          );
        }
        console.log(
          newViolations.length === 0
            ? `lint-repo-refs: 新規違反なし (既知 ${baselinedCount} 件は baseline 許容済)`
            : `lint-repo-refs: 新規違反 ${newViolations.length} 件 (既知 ${baselinedCount} 件は baseline 許容済)`
        );
      }
      process.exit(newViolations.length === 0 ? 0 : 1);
    }
  } catch (e) {
    if (e instanceof OperationalError) {
      console.error(`lint-repo-refs: 運用エラー: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }

  if (asJson) {
    const byCheck = {};
    for (const v of violations) byCheck[v.check] = (byCheck[v.check] ?? 0) + 1;
    console.log(JSON.stringify({ violations, summary: { total: violations.length, byCheck } }, null, 2));
  } else {
    for (const v of violations) {
      console.log(`[${v.check}] ${v.file}:${v.line} ${v.message}`);
    }
    const byCheck = {};
    for (const v of violations) byCheck[v.check] = (byCheck[v.check] ?? 0) + 1;
    const summary = Object.entries(byCheck)
      .map(([c, n]) => `${c}=${n}`)
      .join(", ");
    console.log(
      violations.length === 0
        ? "lint-repo-refs: 違反なし"
        : `lint-repo-refs: 違反 ${violations.length} 件 (${summary})`
    );
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
