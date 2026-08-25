#!/usr/bin/env node
// scripts/check-marker-retention.test.mjs
//
// check-marker-retention.mjs の白箱 unit test。専用 fixture を都度組み立てて検証するため、
// 実プロジェクト (artifacts/ 配下) には一切依存しない。
//
// 実プロジェクトを検証台にしない理由: 本 script が置き換えた shell 版の穴 (無空白 `※推測` を
// 数えない) は、検証台にしていた reverse プロジェクトが空白付き表記しか含まなかったために
// 実測 188 件が全て一致して「網羅できている」と誤認され、そのまま通過した。均質な母集団での
// 実測は網羅性の証明にならないため、異表記・0 件・複数/行を fixture で明示的に作る。
//
// 実行: npm test (= node --test) / 単体: node --test scripts/check-marker-retention.test.mjs
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  check,
  classify,
  collectCounts,
  countMarkers,
  deriveTouchedDocs,
  parseArgs,
  parseTouchedDocsArg,
  parseSnapshotDocName,
} from "./check-marker-retention.mjs";

// --- fixture helpers ---------------------------------------------------------

/** { reqDocs, snapshotDocs, status, run } から一時 app ディレクトリを組み立てる。 */
function makeApp({ reqDocs = {}, snapshotDocs = null, status = "REVERSE_ENGINEERED", run = undefined } = {}) {
  const root = mkdtempSync(join(tmpdir(), "marker-retention-"));
  mkdirSync(join(root, "requirements"), { recursive: true });
  for (const [name, body] of Object.entries(reqDocs)) {
    writeFileSync(join(root, "requirements", name), body, "utf8");
  }
  if (status !== null) {
    writeFileSync(join(root, "requirements.json"), JSON.stringify({ app_name: "fixture", status }), "utf8");
  }
  if (snapshotDocs !== null) {
    const snapDir = join(root, "req-delta", "snapshots");
    mkdirSync(snapDir, { recursive: true });
    for (const [name, body] of Object.entries(snapshotDocs)) {
      writeFileSync(join(snapDir, name.replace(/\.md$/, ".snapshot.md")), body, "utf8");
    }
  }
  if (run !== undefined) {
    writeFileSync(
      join(root, "pipeline-state.json"),
      JSON.stringify({ app_name: "fixture", req_delta: { runs: [run] } }),
      "utf8",
    );
  }
  return root;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

// --- countMarkers: 表記ゆれと出現数 -----------------------------------------

test("countMarkers は無空白・半角空白・全角空白の 3 表記をすべて数える", () => {
  assert.equal(countMarkers("※推測 の値"), 1);
  assert.equal(countMarkers("※ 推測 の値"), 1);
  assert.equal(countMarkers("※　不明 の値"), 1);
  assert.equal(countMarkers("※不明 と ※ 不明 と ※　推測"), 3);
});

test("countMarkers は行数ではなく出現数を数える (1 行 2 件の片方脱落を見逃さない)", () => {
  assert.equal(countMarkers("A は ※ 推測、B も ※ 推測"), 2);
});

test("countMarkers はマーカー以外の ※ を数えない", () => {
  assert.equal(countMarkers("※ 注記です"), 0);
  assert.equal(countMarkers("推測 のみ / 不明 のみ"), 0);
});

// --- ファイル名対応 ---------------------------------------------------------

test("parseSnapshotDocName は {doc}.snapshot.md を {doc}.md に戻す", () => {
  assert.equal(parseSnapshotDocName("05-features.snapshot.md"), "05-features.md");
  assert.equal(parseSnapshotDocName("05-features.md"), null);
});

// --- collectCounts: 0 件文書を落とさない ------------------------------------

test("collectCounts は出現数 0 の文書も entry として保持する", () => {
  const root = makeApp({
    reqDocs: { "01-overview.md": "マーカー無し", "05-features.md": "※ 推測 (inferred)" },
  });
  try {
    const counts = collectCounts(join(root, "requirements"));
    assert.deepEqual([...counts.entries()].sort(), [
      ["01-overview.md", 0],
      ["05-features.md", 1],
    ]);
  } finally {
    cleanup(root);
  }
});

test("collectCounts はディレクトリ不在で null を返す", () => {
  assert.equal(collectCounts(join(tmpdir(), "no-such-dir-marker-retention")), null);
});

// --- touched 集合の導出 -----------------------------------------------------

test("deriveTouchedDocs は directly_changed と impacted の合併を返す", () => {
  const touched = deriveTouchedDocs({
    req_delta: { runs: [{ directly_changed_docs: ["05-features.md"], impacted_docs: ["04-use-cases.md"] }] },
  });
  assert.deepEqual([...touched].sort(), ["04-use-cases.md", "05-features.md"]);
});

test("deriveTouchedDocs は run 不在 / 分類空で null を返す (呼び出し側が安全側に倒す)", () => {
  assert.equal(deriveTouchedDocs({}), null);
  assert.equal(deriveTouchedDocs({ req_delta: { runs: [] } }), null);
  assert.equal(deriveTouchedDocs({ req_delta: { runs: [{ directly_changed_docs: [], impacted_docs: [] }] } }), null);
});

// --- classify: 減少の振り分け -----------------------------------------------

test("classify は未変更文書の減少を violation、変更対象の減少を review_required に振り分ける", () => {
  const baseline = new Map([
    ["01-overview.md", 2],
    ["05-features.md", 3],
    ["06-non-functional.md", 1],
  ]);
  const current = new Map([
    ["01-overview.md", 1], // 未変更なのに減った → violation
    ["05-features.md", 2], // 変更対象の減少 → review_required
    ["06-non-functional.md", 1], // 変化なし
  ]);
  const out = classify(baseline, current, new Set(["05-features.md"]));
  assert.deepEqual(
    out.violations.map((v) => v.doc),
    ["01-overview.md"],
  );
  assert.deepEqual(
    out.review_required.map((v) => v.doc),
    ["05-features.md"],
  );
  assert.equal(out.docs.length, 3, "docs は全件 (変化なしも含む) を保持する");
});

test("classify は touched が null のとき全文書を未変更扱いにする (安全側)", () => {
  const out = classify(new Map([["05-features.md", 3]]), new Map([["05-features.md", 1]]), null);
  assert.deepEqual(
    out.violations.map((v) => v.doc),
    ["05-features.md"],
  );
  assert.equal(out.review_required.length, 0);
});

test("classify は増加を違反にしない", () => {
  const out = classify(new Map([["05-features.md", 1]]), new Map([["05-features.md", 4]]), new Set());
  assert.equal(out.violations.length, 0);
  assert.equal(out.review_required.length, 0);
});

test("classify は snapshot に無い現行文書を warning にする (母集団の食い違いを沈黙させない)", () => {
  const out = classify(new Map([["05-features.md", 1]]), new Map([
    ["05-features.md", 1],
    ["00-raw-input.md", 9],
  ]), new Set());
  assert.equal(out.violations.length, 0);
  assert.match(out.warnings.join("\n"), /00-raw-input\.md/);
});

test("classify は snapshot にあって現行に無い文書を violation + warning にする", () => {
  const out = classify(new Map([["05-features.md", 2]]), new Map(), new Set());
  assert.deepEqual(
    out.violations.map((v) => v.doc),
    ["05-features.md"],
  );
  assert.match(out.warnings.join("\n"), /存在しない/);
});

// --- check(): exit code 契約 ------------------------------------------------

test("check は無空白マーカーの脱落を FAIL として検出する (shell 版が見逃した回帰)", () => {
  const root = makeApp({
    // baseline は無空白表記のみ。空白付きだけを数える実装ではここが 0 件に見え、
    // 「減っていない」と誤判定される。
    snapshotDocs: { "01-overview.md": "位置の表示形式は ※不明 (unknown)" },
    reqDocs: { "01-overview.md": "位置の表示形式は緯度経度" },
    run: { directly_changed_docs: ["05-features.md"], impacted_docs: [] },
  });
  try {
    const { result, exitCode } = check([root]);
    assert.equal(result.verdict, "FAIL");
    assert.equal(exitCode, 1);
    assert.deepEqual(
      result.violations.map((v) => [v.doc, v.baseline, v.current]),
      [["01-overview.md", 1, 0]],
    );
  } finally {
    cleanup(root);
  }
});

test("check はマーカー全量消失を 0 件の行として可視化する (uniq -c 集計で消えた穴)", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A\n※ 推測 B\n※ 不明 C" },
    reqDocs: { "05-features.md": "根拠なし" },
    run: { directly_changed_docs: ["01-overview.md"], impacted_docs: [] },
  });
  try {
    const { result, exitCode } = check([root]);
    assert.equal(exitCode, 1);
    const entry = result.docs.find((d) => d.doc === "05-features.md");
    assert.deepEqual([entry.baseline, entry.current, entry.delta], [3, 0, -3]);
  } finally {
    cleanup(root);
  }
});

test("check は変更対象文書の減少を REVIEW (exit 0) にして doc 名を列挙する", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A\n※ 推測 B" },
    reqDocs: { "05-features.md": "※ 推測 A (根拠追記済)" },
    run: { directly_changed_docs: ["05-features.md"], impacted_docs: [] },
  });
  try {
    const { result, exitCode } = check([root]);
    assert.equal(result.verdict, "REVIEW");
    assert.equal(exitCode, 0);
    assert.deepEqual(
      result.review_required.map((v) => v.doc),
      ["05-features.md"],
    );
    assert.equal(result.violations.length, 0);
  } finally {
    cleanup(root);
  }
});

test("check は増減なしを PASS にする", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A", "01-overview.md": "なし" },
    reqDocs: { "05-features.md": "※ 推測 A", "01-overview.md": "なし" },
    run: { directly_changed_docs: ["05-features.md"], impacted_docs: [] },
  });
  try {
    const { result, exitCode } = check([root]);
    assert.equal(result.verdict, "PASS");
    assert.equal(exitCode, 0);
    assert.deepEqual(result.totals, { baseline: 1, current: 1 });
  } finally {
    cleanup(root);
  }
});

test("check は非 reverse プロジェクトを SKIPPED にする", () => {
  const root = makeApp({ reqDocs: { "05-features.md": "※不明" }, status: "APPROVED" });
  try {
    const { result, exitCode } = check([root]);
    assert.equal(result.verdict, "SKIPPED");
    assert.equal(result.reason, "not_reverse_engineered");
    assert.equal(exitCode, 0);
  } finally {
    cleanup(root);
  }
});

test("check は snapshots 不在を SKIPPED として報告する (沈黙 PASS にしない)", () => {
  const root = makeApp({ reqDocs: { "05-features.md": "※ 推測" }, snapshotDocs: null });
  try {
    const { result, exitCode } = check([root]);
    assert.equal(result.verdict, "SKIPPED");
    assert.equal(result.reason, "no_snapshots");
    assert.equal(exitCode, 0);
  } finally {
    cleanup(root);
  }
});

test("no_snapshots の detail は --snapshots で渡したディレクトリを出す (既定パスを決め打ちしない)", () => {
  const root = makeApp({ reqDocs: { "05-features.md": "※ 推測" }, snapshotDocs: null });
  try {
    const { result, exitCode } = check([root, "--snapshots", "reverse-verify/snapshots/2026-08-13-001"]);
    assert.equal(result.verdict, "SKIPPED");
    assert.equal(result.reason, "no_snapshots");
    assert.match(result.detail, /reverse-verify\/snapshots\/2026-08-13-001/, "渡したディレクトリが案内される");
    assert.doesNotMatch(result.detail, /req-delta/, "既定パスを案内しない (別経路の呼び出し元を誤誘導する)");
    assert.equal(exitCode, 0);
  } finally {
    cleanup(root);
  }
});

test("check は run 特定不能でも判定し、安全側に倒したことを warnings に残す", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A" },
    reqDocs: { "05-features.md": "根拠なし" },
    // pipeline-state.json を置かない
  });
  try {
    const { result, exitCode } = check([root]);
    assert.equal(result.verdict, "FAIL");
    assert.equal(exitCode, 1);
    assert.equal(result.touched_docs, null);
    assert.match(result.warnings.join("\n"), /安全側/);
  } finally {
    cleanup(root);
  }
});

test("check は app ルート / requirements 不在を exit 2 (入力不能) にする", () => {
  assert.deepEqual(check([join(tmpdir(), "no-such-app-marker-retention")]), { result: null, exitCode: 2 });
  assert.deepEqual(check([]), { result: null, exitCode: 2 });
  const root = mkdtempSync(join(tmpdir(), "marker-retention-empty-"));
  try {
    assert.equal(check([root]).exitCode, 2, "requirements/ が無ければ入力不能");
  } finally {
    cleanup(root);
  }
});

// --- --docs (触った文書の明示指定) ------------------------------------------

test("--docs は req_delta の run を読まずに触った文書を決める (run を持たない経路の誤判定回避)", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A\n※ 推測 B", "01-overview.md": "※ 推測 C" },
    reqDocs: { "05-features.md": "※ 推測 A (根拠追記済)", "01-overview.md": "※ 推測 C" },
    // req_delta.runs[] は 05 を触っていないと言うが、実際に直したのは 05
    run: { directly_changed_docs: ["01-overview.md"], impacted_docs: [] },
  });
  try {
    const derived = check([root]);
    assert.equal(derived.result.verdict, "FAIL", "導出任せでは正当な修正が違反に見える");

    const { result, exitCode } = check([root, "--docs", "05-features.md"]);
    assert.equal(result.verdict, "REVIEW");
    assert.equal(exitCode, 0);
    assert.equal(result.touched_source, "explicit");
    assert.deepEqual(result.touched_docs, ["05-features.md"]);
    assert.deepEqual(
      result.review_required.map((v) => v.doc),
      ["05-features.md"],
    );
  } finally {
    cleanup(root);
  }
});

test("--docs 指定外の文書の減少は違反のまま (指定は免罪符にならない)", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A", "01-overview.md": "※ 推測 C" },
    reqDocs: { "05-features.md": "※ 推測 A", "01-overview.md": "根拠なし" },
    run: { directly_changed_docs: ["01-overview.md"], impacted_docs: [] },
  });
  try {
    const { result, exitCode } = check([root, "--docs", "05-features.md"]);
    assert.equal(result.verdict, "FAIL");
    assert.equal(exitCode, 1);
    assert.deepEqual(
      result.violations.map((v) => v.doc),
      ["01-overview.md"],
    );
  } finally {
    cleanup(root);
  }
});

test("--docs はパス付きでも basename を取る / 空指定と値なしは入力不能", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A\n※ 推測 B" },
    reqDocs: { "05-features.md": "※ 推測 A" },
  });
  try {
    const withPath = check([root, "--docs", "requirements/05-features.md"]);
    assert.equal(withPath.result.verdict, "REVIEW");
    assert.deepEqual(withPath.result.touched_docs, ["05-features.md"]);

    for (const argv of [[root, "--docs", ""], [root, "--docs", " , "], [root, "--docs"]]) {
      const r = check(argv);
      assert.equal(r.exitCode, 2, `${JSON.stringify(argv)} は入力不能`);
      assert.match(r.error, /--docs/);
    }
  } finally {
    cleanup(root);
  }
});

test("touched_source は判定経路を残す (explicit / req_delta_run / null)", () => {
  const root = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A" },
    reqDocs: { "05-features.md": "※ 推測 A" },
    run: { directly_changed_docs: ["05-features.md"], impacted_docs: [] },
  });
  try {
    assert.equal(check([root]).result.touched_source, "req_delta_run");
    assert.equal(check([root, "--docs", "05-features.md"]).result.touched_source, "explicit");
  } finally {
    cleanup(root);
  }
  const noRun = makeApp({
    snapshotDocs: { "05-features.md": "※ 推測 A" },
    reqDocs: { "05-features.md": "※ 推測 A" },
  });
  try {
    assert.equal(check([noRun]).result.touched_source, null);
  } finally {
    cleanup(noRun);
  }
});

// --- parseArgs --------------------------------------------------------------

test("parseArgs は app ルートと上書きフラグを読む", () => {
  const args = parseArgs([
    "artifacts/App",
    "--snapshots",
    "delta/snapshots",
    "--state",
    "custom-state.json",
    "--docs",
    "05-features.md,07-interfaces.md",
  ]);
  assert.equal(args.appDir, "artifacts/App");
  assert.equal(args.snapshots, "delta/snapshots");
  assert.equal(args.state, "custom-state.json");
  assert.equal(args.docs, "05-features.md,07-interfaces.md");
  assert.equal(args.requirements, null);
});

test("parseArgs は値の位置に別フラグが来たら値なしとして扱う (隣のフラグを飲み込まない)", () => {
  const a = parseArgs(["artifacts/App", "--docs", "--state", "custom.json"]);
  assert.equal(a.docs, null, "--state を文書名として飲み込まない");
  assert.equal(a.state, "custom.json", "後続フラグは正しく解釈される");
  // 値なし --docs は入力不能として弾かれる (既存契約)
  assert.equal(check(["artifacts/App", "--docs", "--state", "custom.json"]).exitCode, 2);
});

test("parseTouchedDocsArg は csv を basename の Set にし、空は null にする", () => {
  assert.deepEqual([...parseTouchedDocsArg("05-features.md, requirements/07-interfaces.md")].sort(), [
    "05-features.md",
    "07-interfaces.md",
  ]);
  assert.equal(parseTouchedDocsArg(""), null);
  assert.equal(parseTouchedDocsArg(null), null);
  assert.equal(parseTouchedDocsArg(".."), null, "パス脱出だけの指定は空扱い");
});
