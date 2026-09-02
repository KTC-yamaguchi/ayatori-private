#!/usr/bin/env node
// scripts/pending-answers.mjs
//
// Operating Principle 4 (未確定情報は補完せず質問する) の OFFLINE 経路を支える決定論 CLI。
// pending-questions.json (schemas/pending-questions.schema.json) の未解決 entry を
// 人間が読める Markdown 回答シートに export し、人間がオフラインで記入した回答を
// (TSV でも export 済み Markdown でも) 読み込んで検証・書き戻す。
//
// 通常の Pre-flight Gate (skills/_shared/preflight-gate.md) は同一 session 内で
// AskUserQuestion を使って batch propose するが、それが使えない場面 (session を分けたい /
// 非エンジニアに紙 or チャットで回答してもらう 等) の代替経路が本 script。
// skills/_shared/preflight-gate.md の手順 (d) (resolved_at / resolved_answer の merge) と
// (f) (pipeline-state.json.pending_questions_open の再計算) だけを実装する — 手順 (e)
// (要件反映先 artifact 本体の書き換え) は本 script のスコープ外 (別の人間 / LLM 手順が担う)。
//
// script にする理由 (決定論性):
//   「どの回答がどの entry に対応するか」「選択肢のどれに解決されるか」「重複 / 矛盾 / 未回答
//   をどう分類するか」は入力から一意に決まる機械判定であり、LLM が毎回読み直すと表記揺れ
//   (「A」「(A)」「a.」等) や既存回答との矛盾検出の揺れが生じる。本 script に閉じることで
//   「回答 → resolved_answer」の変換が 1 か所の決定論になる (scripts/preflight-partition.mjs
//   が「ask / hold の振り分け」を決定論化したのと同じ設計方針)。
//
// 対応フォーマット:
//   - TSV (`.tsv` / `.txt`, または拡張子が曖昧なとき TAB を含む行があれば TSV と判定):
//     1 行 = `target<TAB>answer`。空行・`#` 始まりの行は無視。canonical な入力形式。
//   - Markdown (`.md`): `export` が書き出した回答シートの形だけを解釈する
//     (`- **target**: \`...\`` 行を見つけ、直後の ```answer フェンスの中身を回答として読む)。
//     見出しレベルのブレや行末空白には強いが、それ以外の手書き Markdown を汎用的に解析する
//     機能は持たない — target 行の後に対応する answer フェンスが (次の target 行より前に)
//     見つからない場合は `answer_block_missing` という hard failure にする。
//
// 回答 → resolved_answer の解決順序 (`options` を持つ entry のみ 1-3 を試す):
//   1. `options[].label` に対する完全一致 (trim 後)                    → resolved_from: "label"
//   2. `A` / `A)` / `(A)` / `a.` / `1` / `1)` 等の裸の選択肢指示子      → resolved_from: "letter"
//   3. 大小文字 / 空白を正規化した label との一致                      → resolved_from: "label_ci"
//   4. 上記に当たらない場合はそのまま自由記述として扱う (warning 付き) → resolved_from: "free_text"
//   `options` を持たない entry (value-fill 質問) は 1-3 をスキップし、常に "free_text"
//   (warning なし — 自由記述が正解の質問なので警告する理由がない)。
//
// 検証 (check / write 共通):
//   hard failure (収集して全件まとめて報告。write はこれが 1 件でもあれば何も書かない):
//     unknown_target / duplicate_target / conflicting_answer (既に resolved_at 済みの entry に
//     異なる回答が来た場合。同一回答は no-op) / answer_block_missing (Markdown のみ) /
//     invalid_entry (未解決 entry の必須 field 欠落・entries が配列でない・null 要素) /
//     only_target_unanswered (write の --only-targets 専用。指定 target に回答が無い)
//   warning (block しない):
//     free_text / unanswered / no_reflect_to / already_resolved_same_answer
//
// exit code 契約:
//   0 = 成功 (warning があってもよい)
//   1 = hard failure がある、または `--strict` 指定時に warning が 1 件でもある
//   2 = 運用エラー (サブコマンド / 引数不正、app_dir 不在、pending-questions.json 不在・
//       parse 不能・トップレベル app_name 欠落 or 空・entries フィールド自体が欠落、
//       answer file 不在・読めない、pipeline-state.json が既存だが parse 不能)
//   1 / 2 のときは理由を必ず stderr に出す。
//
// 使い方:
//   node scripts/pending-answers.mjs export <app_dir> [--all] [--out <path>]
//   node scripts/pending-answers.mjs check  <app_dir> --from <file> [--json] [--strict]
//   node scripts/pending-answers.mjs write  <app_dir> --from <file> [--only-targets <csv>] [--strict]
//   node scripts/pending-answers.mjs --help
//
//   例:
//     node scripts/pending-answers.mjs export artifacts/myapp
//     node scripts/pending-answers.mjs check  artifacts/myapp --from artifacts/myapp/pending-questions.md --json
//     node scripts/pending-answers.mjs write  artifacts/myapp --from answers.tsv
//
// <app_dir> = artifacts/{app_name} 相当のディレクトリ (絶対 / 相対どちらも可。repo 外でもよい)。
// 本 script はファイル I/O 以外の外部依存を持たない (npm 依存ゼロ、外部 CLI 不要 =
// CLAUDE.md Operating Principle 1 適合)。

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PENDING_QUESTIONS_FILE = "pending-questions.json";
const PIPELINE_STATE_FILE = "pipeline-state.json";
const UNANSWERED_PLACEHOLDER = "(未回答 — A / B / または自由記述をここに書く)";
const REQUIRED_ENTRY_FIELDS = ["target", "question", "raised_by_step", "raised_at"];

const USAGE = [
  "usage:",
  "  node scripts/pending-answers.mjs export <app_dir> [--all] [--out <path>]",
  "  node scripts/pending-answers.mjs check  <app_dir> --from <file> [--json] [--strict]",
  "  node scripts/pending-answers.mjs write  <app_dir> --from <file> [--only-targets <csv>] [--strict]",
  "  node scripts/pending-answers.mjs --help",
].join("\n");

/** 運用エラー (exit 2) を表す。中身の壊れ (exit 1) とは別カテゴリ。 */
export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliError";
  }
}

// ───────────────────────────── CLI 引数解析 ─────────────────────────────

export function parseArgs(argv) {
  if (argv.length === 0) return { error: "サブコマンドを指定してください (export / check / write)" };
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") return { help: true };
  if (!["export", "check", "write"].includes(command)) {
    return { error: `不明なサブコマンド: ${command}` };
  }
  const args = {
    command,
    appDir: null,
    all: false,
    out: null,
    from: null,
    json: false,
    strict: false,
    onlyTargets: null,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--all") {
      args.all = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--strict") {
      args.strict = true;
      continue;
    }
    if (arg === "--out") {
      const value = rest[i + 1];
      if (value === undefined) return { error: "--out に値がありません" };
      args.out = value;
      i += 1;
      continue;
    }
    if (arg === "--from") {
      const value = rest[i + 1];
      if (value === undefined) return { error: "--from に値がありません" };
      args.from = value;
      i += 1;
      continue;
    }
    if (arg === "--only-targets") {
      const value = rest[i + 1];
      if (value === undefined) return { error: "--only-targets に値がありません" };
      args.onlyTargets = value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) return { error: `不明なフラグ: ${arg}` };
    if (args.appDir !== null) return { error: `引数が多すぎます: ${arg}` };
    args.appDir = arg;
  }
  if (args.appDir === null) return { error: "app_dir (artifacts/{app_name} 相当) を指定してください" };
  if ((command === "check" || command === "write") && args.from === null) {
    return { error: "--from を指定してください" };
  }
  return args;
}

// ───────────────────────────── pending-questions.json 読み込み ─────────────────────────────

/**
 * pending-questions.json を Read して doc を返す。運用エラーは CliError (exit 2)。
 * `opts.requireArray` を true にすると entries が配列でない場合も運用エラーにする
 * (export はこれが無いと処理できない)。check/write は false のまま呼び、entries の型不正を
 * 「中身の壊れ (invalid_entry, exit 1)」として buildWorkOrder 側で扱う。
 */
export function loadPendingQuestionsDoc(appDir, opts = {}) {
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    throw new CliError(`app_dir が見つからない (ディレクトリではない): ${appDir}`);
  }
  const path = join(appDir, PENDING_QUESTIONS_FILE);
  if (!existsSync(path)) {
    throw new CliError(`${PENDING_QUESTIONS_FILE} が見つからない: ${path}`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new CliError(`${path}: JSON として parse できない (${e.message})`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new CliError(`${path}: トップレベルが object でない`);
  }
  if (typeof doc.app_name !== "string" || doc.app_name.trim() === "") {
    throw new CliError(`${path}: app_name が欠落または空`);
  }
  if (doc.entries === undefined) {
    throw new CliError(`${path}: entries が欠落`);
  }
  if (opts.requireArray && !Array.isArray(doc.entries)) {
    throw new CliError(`${path}: entries が配列でない`);
  }
  return doc;
}

const isResolvedEntry = (entry) =>
  entry !== null &&
  typeof entry === "object" &&
  entry.resolved_at !== undefined &&
  entry.resolved_at !== null &&
  entry.resolved_at !== "";

// ───────────────────────────── answer file 解析 ─────────────────────────────

/** TSV 本体を解析する (`target<TAB>answer`、空行 / `#` 始まりは無視)。 */
export function parseTsv(content) {
  const answers = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, lineNo) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) return;
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) {
      throw new CliError(`answer file (TSV) ${lineNo + 1} 行目: タブ区切りでない (target\\tanswer 形式で書くこと): ${JSON.stringify(line)}`);
    }
    const target = line.slice(0, tabIdx).trim();
    const text = line.slice(tabIdx + 1);
    if (target === "") {
      throw new CliError(`answer file (TSV) ${lineNo + 1} 行目: target が空`);
    }
    answers.push({ target, text });
  });
  return { answers, failures: [] };
}

/**
 * `export` が書き出した Markdown 回答シートだけを解釈する。
 * `- **target**: \`...\`` 行を全件走査してから、各 target 行と次の target 行 (または EOF) の
 * 間で ```answer ... ``` フェンスを探す。見出しレベルのブレ・行末空白には強い (見出し行を
 * 一切見ず target 行だけをアンカーにしているため)。見つからない場合は answer_block_missing
 * という hard failure として記録し、他の target の解析は続ける (1 箇所の壊れで全滅させない)。
 */
export function parseMarkdown(content) {
  const lines = content.split(/\r?\n/);
  const targetLineRe = /^\s*-\s*\*\*target\*\*:\s*`([^`]*)`/;
  const targetLines = [];
  lines.forEach((line, idx) => {
    const m = line.match(targetLineRe);
    if (m) targetLines.push({ idx, target: m[1] });
  });

  const answers = [];
  const failures = [];
  targetLines.forEach(({ idx, target }, k) => {
    const boundary = k + 1 < targetLines.length ? targetLines[k + 1].idx : lines.length;
    let fenceStart = -1;
    for (let j = idx + 1; j < boundary; j += 1) {
      if (/^```answer\s*$/.test(lines[j].trim())) {
        fenceStart = j;
        break;
      }
    }
    if (fenceStart === -1) {
      failures.push({ kind: "answer_block_missing", target, detail: "target 行の後に ```answer フェンスが見つからない (次の設問より前)" });
      return;
    }
    let fenceEnd = -1;
    for (let j = fenceStart + 1; j < boundary; j += 1) {
      if (/^```\s*$/.test(lines[j].trim())) {
        fenceEnd = j;
        break;
      }
    }
    if (fenceEnd === -1) {
      failures.push({ kind: "answer_block_missing", target, detail: "```answer フェンスが閉じられていない (次の設問より前)" });
      return;
    }
    answers.push({ target, text: lines.slice(fenceStart + 1, fenceEnd).join("\n") });
  });
  return { answers, failures };
}

/** 拡張子で TSV / Markdown を判定し、曖昧なときは中身に TAB があるかで sniff する。 */
export function parseAnswerFile(filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new CliError(`answer file が見つからない: ${filePath}`);
  }
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (e) {
    throw new CliError(`answer file を読めない: ${filePath} (${e.message})`);
  }
  const ext = extname(filePath).toLowerCase();
  let format;
  if (ext === ".tsv" || ext === ".txt") format = "tsv";
  else if (ext === ".md") format = "md";
  else format = /\t/.test(content) ? "tsv" : "md";
  return format === "tsv" ? { format, ...parseTsv(content) } : { format, ...parseMarkdown(content) };
}

// ───────────────────────────── 回答 → resolved_answer 解決 ─────────────────────────────

const normalizeLabel = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** 裸の選択肢指示子 (`A` `A)` `(A)` `a.` `1` `1)` 等) を options の index (0-based) へ。 */
function letterToOptionIndex(trimmed, optionCount) {
  const m = trimmed.match(/^\(?\s*([A-Za-z]|[0-9]+)\s*[).]?\s*$/);
  if (!m) return -1;
  const raw = m[1];
  const idx = /^[A-Za-z]$/.test(raw) ? raw.toUpperCase().charCodeAt(0) - 65 : Number.parseInt(raw, 10) - 1;
  return idx >= 0 && idx < optionCount ? idx : -1;
}

/**
 * 1 件の回答テキストを entry の resolved_answer 相当の値に解決する。
 * @returns {{status:"unanswered"}|{status:"resolved", value:string, resolved_from:string, warning?:string}}
 */
export function resolveAnswer(entry, rawText) {
  const trimmed = (rawText ?? "").trim();
  if (trimmed === "" || trimmed === UNANSWERED_PLACEHOLDER) return { status: "unanswered" };

  const options = Array.isArray(entry.options) ? entry.options : null;
  if (!options || options.length === 0) {
    return { status: "resolved", value: trimmed, resolved_from: "free_text" };
  }
  for (const opt of options) {
    if (typeof opt?.label === "string" && opt.label === trimmed) {
      return { status: "resolved", value: opt.label, resolved_from: "label" };
    }
  }
  const letterIdx = letterToOptionIndex(trimmed, options.length);
  if (letterIdx !== -1) {
    return { status: "resolved", value: options[letterIdx].label, resolved_from: "letter" };
  }
  for (const opt of options) {
    if (typeof opt?.label === "string" && normalizeLabel(opt.label) === normalizeLabel(trimmed)) {
      return { status: "resolved", value: opt.label, resolved_from: "label_ci" };
    }
  }
  return { status: "resolved", value: trimmed, resolved_from: "free_text", warning: "free_text" };
}

// ───────────────────────────── work order 構築 (check / write 共通) ─────────────────────────────

/**
 * doc.entries と解析済み回答を突き合わせ、groups / unanswered / warnings / failures を組む。
 * I/O なし・純関数 (answer file の parse 段で出た failures は呼び出し側で先頭に merge すること)。
 */
export function buildWorkOrder(doc, answers) {
  const failures = [];
  const warnings = [];
  const unanswered = [];
  const groupsMap = new Map();

  if (!Array.isArray(doc.entries)) {
    failures.push({ kind: "invalid_entry", target: null, detail: "entries が配列でない" });
    return { groups: [], unanswered, warnings, failures };
  }

  const byTarget = new Map();
  doc.entries.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      failures.push({ kind: "invalid_entry", target: null, detail: `entries[${index}] が object でない (null 要素)` });
      return;
    }
    if (!isResolvedEntry(entry)) {
      const missing = REQUIRED_ENTRY_FIELDS.filter(
        (f) => !(f in entry) || entry[f] === "" || entry[f] === null || entry[f] === undefined,
      );
      if (missing.length > 0) {
        failures.push({
          kind: "invalid_entry",
          target: typeof entry.target === "string" && entry.target !== "" ? entry.target : null,
          detail: `entries[${index}]: 未解決 entry の必須 field 欠落 (${missing.join(", ")})`,
        });
        return;
      }
    }
    if (typeof entry.target === "string" && entry.target !== "") {
      byTarget.set(entry.target, { entry, index });
    }
  });

  const occurrences = new Map();
  for (const a of answers) occurrences.set(a.target, (occurrences.get(a.target) ?? 0) + 1);
  const duplicateTargets = new Set([...occurrences].filter(([, count]) => count > 1).map(([t]) => t));
  const reportedDuplicates = new Set();

  for (const a of answers) {
    if (duplicateTargets.has(a.target)) {
      if (!reportedDuplicates.has(a.target)) {
        failures.push({
          kind: "duplicate_target",
          target: a.target,
          detail: `answer file 内で target が ${occurrences.get(a.target)} 回出現 (1 回だけ書くこと)`,
        });
        reportedDuplicates.add(a.target);
      }
      continue;
    }

    const found = byTarget.get(a.target);
    if (!found) {
      failures.push({ kind: "unknown_target", target: a.target, detail: "pending-questions.json の entries に無い target" });
      continue;
    }
    const { entry, index } = found;

    const resolved = resolveAnswer(entry, a.text);
    if (resolved.status === "unanswered") {
      unanswered.push(a.target);
      warnings.push({ kind: "unanswered", target: a.target, detail: "未回答のまま (プレースホルダ or 空欄)" });
      continue;
    }

    if (isResolvedEntry(entry)) {
      if (entry.resolved_answer === resolved.value) {
        warnings.push({ kind: "already_resolved_same_answer", target: a.target, detail: "既に同一回答で resolved 済み (no-op)" });
      } else {
        failures.push({
          kind: "conflicting_answer",
          target: a.target,
          detail: `既存 resolved_answer ${JSON.stringify(entry.resolved_answer)} と新回答 ${JSON.stringify(resolved.value)} が矛盾`,
        });
        continue;
      }
    }

    if (resolved.warning) {
      warnings.push({ kind: resolved.warning, target: a.target, detail: `選択肢と一致せず自由記述として解釈: ${resolved.value}` });
    }
    const reflectTo = typeof entry.reflect_to === "string" && entry.reflect_to.trim() !== "" ? entry.reflect_to.trim() : null;
    if (reflectTo === null) {
      warnings.push({ kind: "no_reflect_to", target: a.target, detail: "entry に reflect_to が未設定" });
    }
    if (!groupsMap.has(reflectTo)) groupsMap.set(reflectTo, []);
    groupsMap.get(reflectTo).push({
      _index: index,
      target: a.target,
      question: entry.question,
      answer: resolved.value,
      resolved_from: resolved.resolved_from,
    });
  }

  const groups = [...groupsMap.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([reflect_to, items]) => ({
      reflect_to,
      items: items
        .sort((x, y) => x._index - y._index)
        .map(({ _index, ...rest }) => rest),
    }));

  return { groups, unanswered, warnings, failures };
}

// ───────────────────────────── 人間可読フォーマット ─────────────────────────────

const truncate = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function formatHumanWorkOrder(appName, work) {
  const lines = [`pending-answers work order: ${appName}`];
  for (const group of work.groups) {
    lines.push("", `== ${group.reflect_to ?? "(反映先未設定)"} ==`);
    for (const item of group.items) {
      lines.push(`  - ${item.target}: ${item.answer} [${item.resolved_from}] — ${truncate(String(item.question ?? ""), 60)}`);
    }
  }
  if (work.unanswered.length > 0) lines.push("", `未回答 (${work.unanswered.length}): ${work.unanswered.join(", ")}`);
  if (work.warnings.length > 0) {
    lines.push("", `警告 (${work.warnings.length}):`);
    for (const w of work.warnings) lines.push(`  - ${w.kind}: ${w.target ?? "-"} — ${w.detail}`);
  }
  if (work.failures.length > 0) {
    lines.push("", `失敗 (${work.failures.length}):`);
    for (const f of work.failures) lines.push(`  - ${f.kind}: ${f.target ?? "-"} — ${f.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

// ───────────────────────────── export: 回答シート生成 ─────────────────────────────

function selectSheetEntries(doc, includeAll) {
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const selected = [];
  entries.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") return; // 壊れた要素は export では黙って除外 (検証は check/write の役割)
    const resolved = isResolvedEntry(entry);
    if (resolved && !includeAll) return;
    selected.push({ entry, index, isResolved: resolved });
  });
  return selected;
}

function groupForSheet(selected) {
  const map = new Map();
  for (const item of selected) {
    const trimmed = typeof item.entry.reflect_to === "string" ? item.entry.reflect_to.trim() : "";
    const key = trimmed !== "" ? trimmed : null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([reflect_to, items]) => ({ reflect_to, items }));
}

function renderEntryBlock(qn, entry, isResolved) {
  const lines = [];
  const label = String(qn).padStart(2, "0");
  const header = typeof entry.header === "string" && entry.header !== "" ? entry.header : "(header なし)";
  lines.push(`### Q${label} — ${header}`, "");
  lines.push(`- **target**: \`${entry.target}\`   ← 編集しないこと (突合キー)`);
  const reflectTo = typeof entry.reflect_to === "string" && entry.reflect_to.trim() !== "" ? entry.reflect_to.trim() : "(未設定)";
  lines.push(`- **反映先**: \`${reflectTo}\``);
  const origin = `${entry.raised_by_step ?? ""}${entry.ambiguity_kind ? ` / ${entry.ambiguity_kind}` : ""}`;
  lines.push(`- **出所**: ${origin}`);
  const question = String(entry.question ?? "").replace(/\r?\n/g, " ").trim();
  lines.push(`- **質問**: ${question}`);
  if (Array.isArray(entry.options) && entry.options.length > 0) {
    lines.push("- **選択肢**:");
    entry.options.forEach((opt, idx) => {
      const letter = String.fromCharCode(65 + idx);
      lines.push(`  - **${letter})** ${opt?.label ?? ""} — ${opt?.description ?? ""}`);
    });
  }
  lines.push("", isResolved ? "#### 回答 (解決済み)" : "#### 回答", "");
  lines.push("```answer");
  lines.push(isResolved ? String(entry.resolved_answer ?? "") : UNANSWERED_PLACEHOLDER);
  lines.push("```", "");
  return lines;
}

export function renderSheet(appName, groups) {
  const lines = [
    `# pending-questions 回答シート — ${appName}`,
    "",
    "このファイルは pending-questions.json の未解決質問にオフラインで回答するための回答シートです。",
    "",
    "## 書き方",
    "",
    "- 回答は各設問の ```answer コードブロックの中だけを編集してください。",
    "- **target** 行 (`- **target**: ...`) は突合キーなので編集しないでください。",
    "- 選択肢がある設問は、選択肢の記号 (例: `B` / `B)` / `(B)`) か選択肢の文言をそのまま書いてください。自由記述でも構いません。",
    `- 回答しない設問はプレースホルダ \`${UNANSWERED_PLACEHOLDER}\` をそのまま残してください。`,
    "",
  ];
  let qn = 0;
  for (const group of groups) {
    lines.push(`## ${group.reflect_to ?? "(反映先未設定)"}`, "");
    for (const item of group.items) {
      qn += 1;
      lines.push(...renderEntryBlock(qn, item.entry, item.isResolved));
    }
  }
  return `${lines.join("\n")}\n`;
}

function runExport(args) {
  const doc = loadPendingQuestionsDoc(args.appDir, { requireArray: true });
  const outPath = args.out ?? join(args.appDir, "pending-questions.md");
  const selected = selectSheetEntries(doc, args.all);
  const groups = groupForSheet(selected);
  writeFileSync(outPath, renderSheet(doc.app_name, groups));
  const unresolvedCount = selected.filter((s) => !s.isResolved).length;
  process.stdout.write(`✅ 回答シートを書き出しました: ${outPath} (未解決 ${unresolvedCount} 件 / グループ ${groups.length} 件)\n`);
  return 0;
}

// ───────────────────────────── check ─────────────────────────────

function runCheck(args) {
  const doc = loadPendingQuestionsDoc(args.appDir);
  const parsed = parseAnswerFile(args.from);
  const work = buildWorkOrder(doc, parsed.answers);
  work.failures = [...parsed.failures, ...work.failures];

  const hasFailure = work.failures.length > 0;
  const hasStrictWarning = args.strict && work.warnings.length > 0;
  const exitCode = hasFailure || hasStrictWarning ? 1 : 0;

  if (args.json) {
    const out = { app_name: doc.app_name, groups: work.groups, unanswered: work.unanswered, warnings: work.warnings, failures: work.failures };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } else {
    process.stdout.write(formatHumanWorkOrder(doc.app_name, work));
  }
  if (exitCode !== 0) {
    process.stderr.write(
      `[pending-answers] check: failures=${work.failures.length} warnings=${work.warnings.length}${hasStrictWarning && !hasFailure ? " (--strict により warning も exit 1)" : ""}\n`,
    );
  }
  return exitCode;
}

// ───────────────────────────── write ─────────────────────────────

/**
 * pipeline-state.json の pending_questions_open だけを再計算して merge する。
 * 不在なら lazy init (docs/artifact-file-responsibility.md 設計原則 4)。既存なら他 key を保持。
 */
export function updatePipelineState(appDir, appName, open) {
  const path = join(appDir, PIPELINE_STATE_FILE);
  if (!existsSync(path)) {
    if (typeof appName !== "string" || appName.trim() === "") {
      throw new CliError("pipeline-state.json の lazy init: app_name が空 (pending-questions.json.app_name を確認)");
    }
    const state = { app_name: appName, pending_questions_open: open };
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }
  let existing;
  try {
    existing = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new CliError(`${path}: JSON として parse できない (${e.message})`);
  }
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    throw new CliError(`${path}: トップレベルが object でない`);
  }
  const state = { ...existing, pending_questions_open: open };
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function runWrite(args) {
  const doc = loadPendingQuestionsDoc(args.appDir);
  const parsed = parseAnswerFile(args.from);
  const work = buildWorkOrder(doc, parsed.answers);
  work.failures = [...parsed.failures, ...work.failures];

  if (args.onlyTargets) {
    const answeredTargets = new Set(work.groups.flatMap((g) => g.items.map((i) => i.target)));
    for (const t of args.onlyTargets) {
      if (!answeredTargets.has(t)) {
        work.failures.push({ kind: "only_target_unanswered", target: t, detail: "--only-targets で指定されたが回答が見つからない (未回答 or answer file に無い)" });
      }
    }
  }

  const hasFailure = work.failures.length > 0;
  const hasStrictWarning = args.strict && work.warnings.length > 0;
  if (hasFailure || hasStrictWarning) {
    process.stderr.write(formatHumanWorkOrder(doc.app_name, work));
    process.stderr.write(
      `[pending-answers] write: 中断 (failures=${work.failures.length} warnings=${work.warnings.length}${hasStrictWarning && !hasFailure ? " / --strict" : ""}) — 何も書き込みませんでした\n`,
    );
    return 1;
  }

  const onlyTargetsSet = args.onlyTargets ? new Set(args.onlyTargets) : null;
  const nowIso = new Date().toISOString();
  let stamped = 0;
  let noop = 0;
  for (const group of work.groups) {
    for (const item of group.items) {
      if (onlyTargetsSet && !onlyTargetsSet.has(item.target)) continue;
      const entry = doc.entries.find((e) => e !== null && typeof e === "object" && e.target === item.target);
      if (!entry) continue; // buildWorkOrder が既に byTarget で見つけているので通常到達しない
      if (isResolvedEntry(entry) && entry.resolved_answer === item.answer) {
        noop += 1;
        continue;
      }
      entry.resolved_at = nowIso;
      entry.resolved_answer = item.answer;
      stamped += 1;
    }
  }

  writeFileSync(join(args.appDir, PENDING_QUESTIONS_FILE), `${JSON.stringify(doc, null, 2)}\n`);

  const openAfter = doc.entries.filter((e) => e !== null && typeof e === "object" && !isResolvedEntry(e)).length;
  updatePipelineState(args.appDir, doc.app_name, openAfter);

  process.stdout.write(
    `✅ 回答を書き込みました: 確定 ${stamped} 件 / 既確定スキップ(no-op) ${noop} 件 / 残り未解決 ${openAfter} 件 (pending_questions_open = ${openAfter})\n`,
  );
  return 0;
}

// ───────────────────────────── entrypoint ─────────────────────────────

export function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (args.error !== undefined) {
    process.stderr.write(`[pending-answers] ${args.error}\n${USAGE}\n`);
    return 2;
  }
  try {
    if (args.command === "export") return runExport(args);
    if (args.command === "check") return runCheck(args);
    return runWrite(args);
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`[pending-answers] ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export function main(argv) {
  return run(argv);
}

// テストから import されたときは main() を走らせない (scripts/preflight-partition.mjs と同じ guard)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
