#!/usr/bin/env node
// scripts/check-marker-retention.mjs
//
// Phase 1c (Step 33 sub-step 4.5.5) 推測マーカー保持検査の決定論 checker:
//   reverse 産要件 (requirements.json.status == "REVERSE_ENGINEERED") の
//   requirements/*.md から `※ 推測 (inferred)` / `※ 不明 (unknown)` マーカーの出現数を数え、
//   改訂前 (req-delta/snapshots/) と比較して「触っていない文書のマーカーが落ちた」= Apply の
//   書き過ぎを機械検出する。マーカーは provenance 誤認防止の主防御線であり、無言で落ちると
//   推測が確定事実として下流 (design / screens) に laundering される。
//
// 決定論 script にする理由 (skill 本文の grep パイプラインから切り出した経緯):
//   shell one-liner 版は (a) パターンが空白付き `※ 推測` のみで無空白 `※推測` を数えない、
//   (b) `uniq -c` 集計のため出現数 0 に落ちた文書が出力から消え「マーカー全量消失」が
//   「出力なし」と区別できない、(c) 比較相手 (snapshot 側) のコマンドとファイル名対応が
//   未規定で決定的に再実行できない、という 3 つの穴を持っていた。入力から出力が一意に
//   決まる処理なので、LLM の模擬実行を挟まず本 script が単一の判定 SoT となる。
//
// マーカー表記: `※` と語の間の空白は「無し / 半角空白 / 全角空白」を等価に扱う。
//   repo 内は両表記が混在しており (CLAUDE.md / schemas/requirements.schema.json /
//   skills/29c-req-propagate/SKILL.md、および writer である skills/reverse/06-format-convert/
//   SKILL.md 自身も無空白表記を含む)、片方だけを数えると脱落を検出できない。
//   行数ではなく出現数を数える (1 行に複数マーカーがある場合の片方脱落を見逃さない)。
//
// 判定仕様:
//   - 「触った文書」= 既定では pipeline-state.json.req_delta.runs[-1] の
//     directly_changed_docs ∪ impacted_docs (Step 32 の分類結果)。
//     run が特定できない場合は**全文書を未変更扱い**にする (安全側 — 減少をすべて違反として
//     可視化する。沈黙 PASS にしない)。理由は warnings に記録する。
//     `--docs <csv>` を与えた場合はその集合を「触った文書」として使う (req_delta の run は
//     読まない)。req-delta 以外の経路 — 例えば承認された食い違いだけを要件文書へ反映する
//     突合フロー — は req_delta.runs[] に run を持たないため、導出に任せると自分が正当に
//     直した文書まで未変更扱いになり FAIL と誤判定される。どちらの経路で判定したかは
//     出力の touched_source (explicit / req_delta_run / null) に残す。
//   - 未変更文書でマーカーが減っていれば violation (= FAIL)。人手の判断を要さない。
//   - 変更対象文書での減少は review_required として列挙する。(a) 改訂で根拠が付いた /
//     (b) 記述ごと削除された、のどちらかであれば正当であり、script は自動判定できない。
//     skill 側が 1 件ずつ確認する契約 (件数と doc 名を出すところまでが本 script の責務)。
//   - snapshot に無い文書 (例: snapshots が除外する 00-raw-input.md) は比較対象外として
//     warnings に出す。違反にはしない (母集団の食い違いを沈黙させないための可視化)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/check-marker-retention.mjs artifacts/{app_name} \
//           [--snapshots <dir>] [--requirements <dir>] [--state <path>] [--requirements-json <path>] \
//           [--docs <csv>]
//         パス系フラグは app ルートからの相対パス。省略時は既定パス。
//         --docs は文書名の csv (例: 05-features.md,07-interfaces.md。パス付きでも basename を取る)。
//         空の csv は受け付けない — 「触った文書ゼロ」はフラグ省略時の安全側判定と同義であり、
//         空指定はシェル変数の展開漏れである可能性が高いため入力不能 (exit 2) として弾く。
// 入力:   {app}/requirements.json (status) / {app}/pipeline-state.json (触った文書の集合) /
//         {app}/requirements/*.md (改訂後) / {app}/req-delta/snapshots/*.snapshot.md (改訂前)
// 出力:   stdout に JSON verdict のみ (report ファイルは書かない)
// exit:   0 = PASS / REVIEW / SKIPPED、1 = FAIL (未変更文書のマーカー消失)、
//         2 = 入力不能 (app ルート / requirements/ 不在。stdout へは何も出力しない)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/** `※` と語の間の空白は無し / 半角 / 全角を等価に扱う。行数ではなく出現数を数える。 */
export const MARKER_PATTERN = /※[ 　]?(?:推測|不明)/g;

/** 要件文書として比較対象にするファイル名 (NN-*.md)。 */
const REQ_DOC_PATTERN = /^\d{2}-.*\.md$/;

const SNAPSHOT_SUFFIX = ".snapshot.md";

/** text 中のマーカー出現数を返す。 */
export function countMarkers(text) {
  const matches = text.match(MARKER_PATTERN);
  return matches === null ? 0 : matches.length;
}

/** `05-features.snapshot.md` → `05-features.md`。snapshot 以外の名前は null。 */
export function parseSnapshotDocName(fileName) {
  if (!fileName.endsWith(SNAPSHOT_SUFFIX)) return null;
  return `${fileName.slice(0, -SNAPSHOT_SUFFIX.length)}.md`;
}

function listFiles(dir) {
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  return readdirSync(dir).sort();
}

/**
 * dir 配下のマーカー出現数を Map<docName, count> で返す。0 件の文書も必ず entry を持つ
 * (出現数 0 に落ちた文書を集計から消さない — 全量消失を「出力なし」にしないため)。
 * dir が無い場合は null。
 */
export function collectCounts(dir, { snapshot = false } = {}) {
  const files = listFiles(dir);
  if (files === null) return null;
  const counts = new Map();
  for (const file of files) {
    const docName = snapshot ? parseSnapshotDocName(file) : file;
    if (docName === null || !REQ_DOC_PATTERN.test(docName)) continue;
    counts.set(docName, countMarkers(readFileSync(join(dir, file), "utf8")));
  }
  return counts;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * pipeline-state.json から「触った文書」集合を導出する。
 * run が特定できない場合は null を返す (呼び出し側が安全側 = 全文書を未変更扱いにする)。
 */
export function deriveTouchedDocs(state) {
  const runs = state?.req_delta?.runs;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const run = runs[runs.length - 1];
  const direct = Array.isArray(run?.directly_changed_docs) ? run.directly_changed_docs : [];
  const impacted = Array.isArray(run?.impacted_docs) ? run.impacted_docs : [];
  if (direct.length === 0 && impacted.length === 0) return null;
  return new Set([...direct, ...impacted].map((d) => basename(String(d))));
}

/**
 * baseline / current の出現数を突き合わせ、docs (全件) / violations / review_required /
 * warnings を返す。touched が null のときは全文書を未変更扱いにする (安全側)。
 */
export function classify(baseline, current, touched) {
  const docs = [];
  const violations = [];
  const reviewRequired = [];
  const warnings = [];

  for (const [doc, before] of [...baseline.entries()].sort()) {
    const hasCurrent = current.has(doc);
    const after = hasCurrent ? current.get(doc) : 0;
    const isTouched = touched !== null && touched.has(doc);
    const entry = { doc, baseline: before, current: after, delta: after - before, touched: isTouched };
    docs.push(entry);

    if (!hasCurrent) {
      warnings.push(`${doc}: snapshot にはあるが改訂後の requirements/ に存在しない (削除された可能性)`);
      if (before > 0) violations.push(entry);
      continue;
    }
    if (entry.delta < 0) (isTouched ? reviewRequired : violations).push(entry);
  }

  for (const doc of [...current.keys()].sort()) {
    if (baseline.has(doc)) continue;
    warnings.push(`${doc}: snapshot に対応ファイルが無いため比較対象外 (snapshots が除外する文書か、新規追加)`);
  }

  return { docs, violations, review_required: reviewRequired, warnings };
}

/**
 * `--docs` の csv を Set<docName> にする。パス付きでも basename を取る (state 由来の
 * 導出と同じ正規化)。有効な名前が 1 件も無い場合は null (呼び出し側が入力不能として扱う)。
 */
export function parseTouchedDocsArg(raw) {
  if (raw === null || raw === undefined) return null;
  const docs = String(raw)
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .map((d) => basename(d))
    .filter((d) => d !== "" && d !== "." && d !== "..");
  return docs.length === 0 ? null : new Set(docs);
}

export function parseArgs(argv) {
  const args = { appDir: null, snapshots: null, requirements: null, state: null, requirementsJson: null, docs: null };
  const flags = new Map([
    ["--snapshots", "snapshots"],
    ["--requirements", "requirements"],
    ["--state", "state"],
    ["--requirements-json", "requirementsJson"],
    ["--docs", "docs"],
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const key = flags.get(argv[i]);
    if (key !== undefined) {
      const value = argv[i + 1];
      // 値の位置に別フラグが来たら「値なし」として扱う — 隣のフラグ名を値として飲み込むと、
      // 例えば `--docs --state x` が touched={"--state"} になり全文書が未変更扱い (過剰な FAIL) になる
      args[key] = value === undefined || value.startsWith("--") ? null : value;
      if (args[key] !== null) i += 1;
    } else if (args.appDir === null) {
      args.appDir = argv[i];
    }
  }
  return args;
}

/** 検査本体。{ result, exitCode } を返す。exitCode 2 のとき result は null。 */
export function check(argv) {
  const args = parseArgs(argv);
  const docsFlagGiven = argv.includes("--docs");
  const explicitTouched = docsFlagGiven ? parseTouchedDocsArg(args.docs) : null;
  if (docsFlagGiven && explicitTouched === null) {
    return {
      result: null,
      exitCode: 2,
      error: "--docs に文書名の csv を指定してください (例: --docs 05-features.md,07-interfaces.md)",
    };
  }
  if (args.appDir === null || !existsSync(args.appDir)) return { result: null, exitCode: 2 };

  const resolve = (override, fallback) => join(args.appDir, override ?? fallback);
  const reqDir = resolve(args.requirements, "requirements");
  const snapDir = resolve(args.snapshots, join("req-delta", "snapshots"));
  const statePath = resolve(args.state, "pipeline-state.json");
  const reqJsonPath = resolve(args.requirementsJson, "requirements.json");

  const current = collectCounts(reqDir);
  if (current === null) return { result: null, exitCode: 2 };

  const requirements = readJson(reqJsonPath);
  if (requirements?.status !== "REVERSE_ENGINEERED") {
    return {
      result: {
        verdict: "SKIPPED",
        reason: "not_reverse_engineered",
        detail: "requirements.json.status != \"REVERSE_ENGINEERED\" — 本検査は reverse 産要件のみが対象",
      },
      exitCode: 0,
    };
  }

  const baseline = collectCounts(snapDir, { snapshot: true });
  if (baseline === null || baseline.size === 0) {
    return {
      result: {
        verdict: "SKIPPED",
        reason: "no_snapshots",
        // 比較先は --snapshots で差し替えられる。既定パスを決め打ちで出すと、別ディレクトリを
        // 渡した呼び出し元に「存在しないパスを見ろ」と案内してしまう。
        detail: `${snapDir} に比較対象 (NN-*.snapshot.md) が無い (沈黙 PASS ではなく skipped として報告)`,
        current_totals: sumCounts(current),
      },
      exitCode: 0,
    };
  }

  const touched = explicitTouched ?? deriveTouchedDocs(readJson(statePath));
  const { docs, violations, review_required, warnings } = classify(baseline, current, touched);
  if (touched === null) {
    warnings.push(
      "pipeline-state.json から req_delta.runs[-1] の directly_changed_docs / impacted_docs を特定できないため、全文書を未変更扱いで判定した (安全側)",
    );
  }

  const verdict = violations.length > 0 ? "FAIL" : review_required.length > 0 ? "REVIEW" : "PASS";
  return {
    result: {
      verdict,
      touched_source: explicitTouched !== null ? "explicit" : touched === null ? null : "req_delta_run",
      touched_docs: touched === null ? null : [...touched].sort(),
      totals: { baseline: sumCounts(baseline), current: sumCounts(current) },
      docs,
      violations,
      review_required,
      warnings,
    },
    exitCode: verdict === "FAIL" ? 1 : 0,
  };
}

function sumCounts(counts) {
  let total = 0;
  for (const n of counts.values()) total += n;
  return total;
}

export function main(argv) {
  const { result, exitCode, error } = check(argv);
  if (result === null) {
    process.stderr.write(
      `${error ?? "入力不能: app ルートまたは requirements/ が見つかりません。node scripts/check-marker-retention.mjs artifacts/{app_name}"}\n`,
    );
    return 2;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return exitCode;
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMainModule()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch {
    // 想定外エラーは「入力不能」扱い (exit 1 は FAIL verdict 専用の契約を守る)
    process.exitCode = 2;
  }
}
