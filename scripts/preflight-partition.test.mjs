// scripts/preflight-partition.test.mjs
//
// scripts/preflight-partition.mjs の単体テスト。Node 標準の node:test + node:assert のみ (依存ゼロ)。
//   実行: npm test (= node --test) / 単体: node --test scripts/preflight-partition.test.mjs
//
// テスト方針:
//   - fixture は毎回 mkdtemp で組み立てる (実プロジェクト artifacts/ 配下には依存しない)。
//   - **後方互換を固定する**: `reflect_to` を持たない legacy entry は必ず ask に入る
//     (既存 14 プロジェクトの pending-questions.json は全件この形なので、ここが崩れると
//      「聞かれるべき質問が黙って持ち越される」退行になる)。
//   - exit code 契約 (0 / 2) は run() と、実プロセス起動 (spawnSync) の両方で確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  InputError,
  classifyTargets,
  isTargetPattern,
  matchesPattern,
  parseTargets,
  partition,
  run,
} from "./preflight-partition.mjs";

// ── fixture helpers ─────────────────────────────────────

/** 被テスト CLI の絶対パス。cwd に依存させない (repo 外から node --test しても走る)。 */
const CLI = fileURLToPath(new URL("./preflight-partition.mjs", import.meta.url));

/** 1 entry 分の最小形 (schema required field は満たす)。 */
const entry = (target, extra = {}) => ({
  target,
  question: `${target} をどうしますか?`,
  raised_by_step: "06-format-convert",
  raised_at: "2026-08-13T10:00:00+09:00",
  ...extra,
});

/** pending-questions.json を持つ app ルートを作る (queue=null で不在にする)。 */
function makeApp(queue) {
  const root = mkdtempSync(join(tmpdir(), "preflight-partition-"));
  if (queue !== null) {
    writeFileSync(join(root, "pending-questions.json"), typeof queue === "string" ? queue : JSON.stringify(queue), "utf8");
  }
  return root;
}

const partitionOf = (entries, targets) => partition({ app_name: "t", entries }, parseTargets(targets));

// ── 振り分け規則 ────────────────────────────────────────

test("reflect_to 未設定 (legacy) は ask — 後方互換", () => {
  const { ask, hold, open } = partitionOf([entry("a.b"), entry("c.d")], "tokens.json");
  assert.deepEqual(
    ask,
    [
      { index: 0, target: "a.b" },
      { index: 1, target: "c.d" },
    ],
    "reflect_to を持たない entry は phase の target_artifacts に関係なく全件 ask",
  );
  assert.deepEqual(hold, []);
  assert.equal(open, 2);
});

test("reflect_to が target_artifacts に完全一致 → ask", () => {
  const { ask, hold } = partitionOf(
    [entry("global.color.focus-ring", { reflect_to: "tokens.json" })],
    "requirements.json,tokens.json",
  );
  assert.deepEqual(ask, [{ index: 0, target: "global.color.focus-ring", reflect_to: "tokens.json" }]);
  assert.deepEqual(hold, []);
});

test("reflect_to が一致しない → hold (ask しない)", () => {
  const { ask, hold, open } = partitionOf(
    [entry("global.color.focus-ring", { reflect_to: "tokens.json" })],
    "requirements.json,screens/00-coverage-check.json",
  );
  assert.deepEqual(ask, []);
  assert.deepEqual(hold, [{ index: 0, target: "global.color.focus-ring", reflect_to: "tokens.json" }]);
  assert.equal(open, 1, "hold も未解決として open に数える (gate (f) の counter と同じ数)");
});

test("glob エントリ (requirements/*.md) は prefix / suffix 一致で ask", () => {
  const { ask, hold } = partitionOf(
    [
      entry("flow.step3", { reflect_to: "requirements/03-user-flow.md" }),
      entry("token.pill", { reflect_to: "tokens.json" }),
    ],
    "requirements/*.md",
  );
  assert.deepEqual(ask, [{ index: 0, target: "flow.step3", reflect_to: "requirements/03-user-flow.md" }]);
  assert.deepEqual(hold, [{ index: 1, target: "token.pill", reflect_to: "tokens.json" }]);
});

test("matchesPattern: 完全一致 / glob / 非対応形の境界", () => {
  assert.equal(matchesPattern("tokens.json", "tokens.json"), true);
  assert.equal(matchesPattern("tokens.json", "tokens.jsonx"), false);
  assert.equal(matchesPattern("requirements/03-user-flow.md", "requirements/*.md"), true);
  assert.equal(matchesPattern("requirements/03-user-flow.txt", "requirements/*.md"), false);
  assert.equal(matchesPattern("reqirements/03.md", "requirements/*.md"), false);
  // `*` が 0 文字に対応する最短一致は認める (`requirements/.md`)
  assert.equal(matchesPattern("requirements/.md", "requirements/*.md"), true);
  // prefix + suffix が重なる短い値は一致させない (`requirements/.md` 未満)
  assert.equal(matchesPattern("requirements/md", "requirements/*.md"), false);
  // `*` 2 個以上は非対応 = 一致しない扱い
  assert.equal(matchesPattern("a/b/c.md", "a/*/*.md"), false);
});

test("reflect_to の前後空白は trim して照合する (照合リスト側と対称)", () => {
  const { ask, hold } = partitionOf(
    [
      entry("trailing", { reflect_to: "tokens.json " }),
      entry("leading", { reflect_to: " tokens.json" }),
    ],
    "tokens.json",
  );
  assert.deepEqual(
    ask,
    [
      { index: 0, target: "trailing", reflect_to: "tokens.json" },
      { index: 1, target: "leading", reflect_to: "tokens.json" },
    ],
    "空白付きの reflect_to も trim 後に一致すれば ask (些細な空白で hold に落とさない)",
  );
  assert.deepEqual(hold, []);
});

test("reflect_to が空白のみは未設定扱い (R1 = ask。hold にしない)", () => {
  const { ask, hold, open } = partitionOf([entry("blank", { reflect_to: "  " })], "requirements.json");
  assert.deepEqual(ask, [{ index: 0, target: "blank" }], "trim 後が空文字なら reflect_to 未設定として従来挙動 (ask) へ倒す");
  assert.deepEqual(hold, []);
  assert.equal(open, 1);
});

test("resolved 済 entry は振り分け対象外", () => {
  const { ask, hold, open } = partitionOf(
    [
      entry("done", { reflect_to: "tokens.json", resolved_at: "2026-08-13T11:00:00+09:00", resolved_answer: "#00c8b4" }),
      entry("todo"),
    ],
    "tokens.json",
  );
  assert.deepEqual(ask, [{ index: 1, target: "todo" }], "index は entries[] の添字 (resolved を飛ばしてもズレない)");
  assert.deepEqual(hold, []);
  assert.equal(open, 1);
});

test("entries に null 要素があると InputError (壊れた entry を黙って無視しない)", () => {
  assert.throws(
    () => partitionOf([entry("a"), null], "tokens.json"),
    (e) => e instanceof InputError && /entries\[1\]/.test(e.message) && /object でない/.test(e.message),
  );
});

test("未解決 entry の target 欠落 (キー無し) は InputError", () => {
  const broken = { question: "?", raised_by_step: "06-format-convert", raised_at: "2026-08-13T10:00:00+09:00" };
  assert.throws(
    () => partitionOf([broken], "tokens.json"),
    (e) => e instanceof InputError && /entries\[0\]\.target が欠落/.test(e.message),
  );
});

test("未解決 entry の target 欠落 (空文字) は InputError", () => {
  assert.throws(
    () => partitionOf([entry("")], "tokens.json"),
    (e) => e instanceof InputError && /entries\[0\]\.target が欠落/.test(e.message),
  );
});

test("resolved 済み entry の target 欠落は許容する (台帳履歴の破損を fatal にしない)", () => {
  const resolvedBroken = {
    question: "?",
    raised_by_step: "06-format-convert",
    raised_at: "2026-08-13T10:00:00+09:00",
    resolved_at: "2026-08-13T11:00:00+09:00",
    resolved_answer: "done",
  };
  const { ask, hold, open } = partitionOf([resolvedBroken, entry("todo")], "tokens.json");
  assert.deepEqual(ask, [{ index: 1, target: "todo" }], "resolved 済みの破損 entry は素通りし、他の未解決 entry は正常に振り分けられる");
  assert.deepEqual(hold, []);
  assert.equal(open, 1);
});

test("run: null 要素 / 未解決 entry の target 欠落は exit 2", () => {
  const withNull = makeApp({ app_name: "t", entries: [entry("a"), null] });
  const r1 = run([withNull, "--target-artifacts", "tokens.json"]);
  assert.equal(r1.exitCode, 2);
  assert.match(r1.error, /entries\[1\]/);

  const withMissingTarget = makeApp({
    app_name: "t",
    entries: [{ question: "?", raised_by_step: "06-format-convert", raised_at: "2026-08-13T10:00:00+09:00" }],
  });
  const r2 = run([withMissingTarget, "--target-artifacts", "tokens.json"]);
  assert.equal(r2.exitCode, 2);
  assert.match(r2.error, /target が欠落/);
});

test("空リスト (--target-artifacts \"\") では reflect_to ありが全 hold・未設定は ask", () => {
  const { ask, hold, open } = partitionOf(
    [
      entry("legacy"),
      entry("t1", { reflect_to: "tokens.json" }),
      entry("t2", { reflect_to: "requirements.json" }),
    ],
    "",
  );
  assert.deepEqual(ask, [{ index: 0, target: "legacy" }]);
  assert.deepEqual(
    hold.map((h) => h.reflect_to),
    ["tokens.json", "requirements.json"],
  );
  assert.equal(open, 3);
});

test("entry の順序は entries[] 順を保持する (決定論)", () => {
  const entries = ["e0", "e1", "e2", "e3"].map((t, i) =>
    entry(t, i % 2 === 0 ? { reflect_to: "tokens.json" } : { reflect_to: "requirements.json" }),
  );
  const { ask, hold } = partitionOf(entries, "tokens.json");
  assert.deepEqual(
    ask.map((a) => a.index),
    [0, 2],
  );
  assert.deepEqual(
    hold.map((h) => h.index),
    [1, 3],
  );
});

// ── target pattern の形検証 ──────────────────────────────

test("isTargetPattern: 相対パス + glob 1 個だけを通す", () => {
  assert.equal(isTargetPattern("requirements.json"), true);
  assert.equal(isTargetPattern("requirements/*.md"), true);
  assert.equal(isTargetPattern("screens/00-coverage-check.json"), true);
  assert.equal(isTargetPattern("design-brief.yaml"), true);
  assert.equal(isTargetPattern("`tokens.json`"), false, "バックティックは prose 宣言の混入物");
  assert.equal(isTargetPattern("tokens.json)"), false, "丸括弧も同じ");
  assert.equal(isTargetPattern("主に requirements.json"), false, "全角文字 + 空白");
  assert.equal(isTargetPattern("requirements.json / requirements/*.md"), false, "comma でない区切りは 1 token に潰れる");
  assert.equal(isTargetPattern("/abs/path.json"), false, "先頭 / の絶対パスは不可");
  assert.equal(isTargetPattern("../outside.json"), false, "先頭 .. の親参照は不可");
  assert.equal(isTargetPattern("screens/*/*.html"), false, "`*` 2 個以上は matchesPattern が常に false = 効かない宣言");
});

// 実データ再現: 各 phase preamble の `target_artifacts` 宣言 (prose) を逐語で渡したケース。
// comma を持たない宣言は文字列全体が 1 token になり、reverse の宣言は comma を持つが両側に
// バックティック / 括弧 / 日本語が付く。いずれも有効 token 0 個 = exit 2 (全件 ask へ fail-open)。
const PROSE_DECLARATIONS = {
  requirements: "主に `requirements.json`",
  screens: "`requirements.json` / `screens/00-coverage-check.json`",
  reverse:
    "`reverse-engineered/*.md` (Step 06 通過後の resume では `requirements.json,requirements/*.md`) — (b) の振り分け照合にそのまま渡す",
  "req-delta": "主に `requirements.json` / `requirements/*.md`",
};

for (const [phase, declaration] of Object.entries(PROSE_DECLARATIONS)) {
  test(`run: ${phase} の宣言 prose を逐語で渡すと exit 2 (全件 hold の無音化を防ぐ)`, () => {
    const root = makeApp({
      app_name: "t",
      entries: [entry("legacy"), entry("r1", { reflect_to: "requirements.json" })],
    });
    const { exitCode, error, summary } = run([root, "--target-artifacts", declaration]);
    assert.equal(exitCode, 2, `有効 token 0 個で exit 0 に倒すと reflect_to 持ちが全件 silent hold (summary=${JSON.stringify(summary)})`);
    assert.match(error, /path 形の token が 1 つもない/);
  });
}

test("classifyTargets: comma あり宣言の逐語 (reverse) は 2 token に割れるが両方 invalid", () => {
  const tokens = parseTargets(PROSE_DECLARATIONS.reverse);
  assert.equal(tokens.length, 2, "comma で割れるので token は 2 個 — だが両方に修飾が付く");
  assert.throws(() => classifyTargets(PROSE_DECLARATIONS.reverse), (e) => e instanceof InputError);
});

test("run: 抽出漏れが一部だけなら有効分で振り分け + invalid_targets に残りが載る", () => {
  const root = makeApp({
    app_name: "t",
    entries: [
      entry("req.a", { reflect_to: "requirements.json" }),
      entry("flow.b", { reflect_to: "requirements/03-user-flow.md" }),
    ],
  });
  // バックティックを落としきれなかった 2 番目の token だけ drop される
  const { exitCode, summary } = run([root, "--target-artifacts", "requirements.json,`requirements/*.md`"]);
  assert.equal(exitCode, 0, "有効 token が 1 つでもあれば drop して続行 (exit 2 の fail-open = 全件 ask には倒さない)");
  assert.deepEqual(summary.ask, [{ index: 0, target: "req.a", reflect_to: "requirements.json" }]);
  assert.deepEqual(summary.hold, [{ index: 1, target: "flow.b", reflect_to: "requirements/03-user-flow.md" }]);
  assert.deepEqual(summary.invalid_targets, ["`requirements/*.md`"], "drop した token を可視化する (黙って効かせない)");
});

test("run: `*` 2 個の token は drop され、他の有効 token で振り分けが続く", () => {
  const root = makeApp({
    app_name: "t",
    entries: [entry("req.a", { reflect_to: "requirements.json" }), entry("scr.b", { reflect_to: "screens/web/01-home.html" })],
  });
  const { exitCode, summary } = run([root, "--target-artifacts", "screens/*/*.html,requirements.json"]);
  assert.equal(exitCode, 0);
  assert.deepEqual(
    summary.ask.map((a) => a.index),
    [0],
  );
  assert.deepEqual(
    summary.hold.map((h) => h.index),
    [1],
    "`*` 2 個の pattern は matchesPattern が常に false なので、drop してもしなくても hold — invalid_targets で気付けるようにする",
  );
  assert.deepEqual(summary.invalid_targets, ["screens/*/*.html"]);
});

test("run: 正常な comma 区切りでは invalid_targets を出さない (既存の出力形を保つ)", () => {
  const root = makeApp({
    app_name: "t",
    entries: [entry("req.a", { reflect_to: "requirements.json" }), entry("flow.b", { reflect_to: "requirements/03-user-flow.md" })],
  });
  const { exitCode, summary } = run([root, "--target-artifacts", "requirements.json,requirements/*.md"]);
  assert.equal(exitCode, 0);
  assert.deepEqual(summary, {
    ask: [
      { index: 0, target: "req.a", reflect_to: "requirements.json" },
      { index: 1, target: "flow.b", reflect_to: "requirements/03-user-flow.md" },
    ],
    hold: [],
    open: 2,
  });
  assert.equal("invalid_targets" in summary, false, "0 件のときは key 自体を出さない (呼び出し側 / 既存契約の互換)");
});

test("run: 空リスト / 区切りだけの raw は exit 0 (反映先を持たない位置の正常系)", () => {
  const root = makeApp({ app_name: "t", entries: [entry("legacy"), entry("t1", { reflect_to: "tokens.json" })] });
  for (const raw of ["", "   ", " , "]) {
    const { exitCode, summary } = run([root, "--target-artifacts", raw]);
    assert.equal(exitCode, 0, `raw=${JSON.stringify(raw)} は token 0 個 = 「反映先を 1 つも持たない」宣言`);
    assert.deepEqual(summary.ask, [{ index: 0, target: "legacy" }]);
    assert.deepEqual(summary.hold, [{ index: 1, target: "t1", reflect_to: "tokens.json" }]);
    assert.equal("invalid_targets" in summary, false);
  }
});

// ── CLI 契約 (exit code) ────────────────────────────────

test("run: 正常系は exit 0 + summary", () => {
  const root = makeApp({ app_name: "t", entries: [entry("x", { reflect_to: "tokens.json" })] });
  const { exitCode, summary } = run([root, "--target-artifacts", "tokens.json"]);
  assert.equal(exitCode, 0);
  assert.equal(summary.ask.length, 1);
  assert.equal(summary.hold.length, 0);
  assert.equal(summary.open, 1);
});

test("run: hold のみ (ask 0 件) でも exit 0", () => {
  const root = makeApp({ app_name: "t", entries: [entry("x", { reflect_to: "tokens.json" })] });
  const { exitCode, summary } = run([root, "--target-artifacts", "requirements.json"]);
  assert.equal(exitCode, 0);
  assert.deepEqual(summary.ask, []);
  assert.equal(summary.hold.length, 1);
});

test("run: pending-questions.json 不在は exit 0 + 空 summary (新規プロジェクトの正常系)", () => {
  const root = makeApp(null);
  const { exitCode, summary, error } = run([root, "--target-artifacts", "tokens.json"]);
  assert.equal(exitCode, 0, `キュー不在は「読めない」ではなく「まだ 1 件も append されていない」正常系 (error=${error})`);
  assert.deepEqual(summary, { ask: [], hold: [], open: 0 });
});

test("run: app ルート不在は exit 2 のまま (キュー不在との非対称 = app 名 typo を無音化しない)", () => {
  const root = makeApp(null);
  const { exitCode, error } = run([join(root, "no-such-app"), "--target-artifacts", "tokens.json"]);
  assert.equal(exitCode, 2);
  assert.match(error, /app ルートが見つからない/);
});

test("run: JSON 破損 / entries 型不正 / 引数不正はすべて exit 2", () => {
  const broken = makeApp("{ not json");
  assert.equal(run([broken, "--target-artifacts", ""]).exitCode, 2);

  const noEntries = makeApp({ app_name: "t" });
  assert.equal(run([noEntries, "--target-artifacts", ""]).exitCode, 2);

  const ok = makeApp({ app_name: "t", entries: [] });
  assert.equal(run([ok]).exitCode, 2, "--target-artifacts 未指定は引数不正");
  assert.equal(run([ok, "--target-artifacts"]).exitCode, 2, "値なしは引数不正");
  assert.equal(run([ok, "--nope", "x"]).exitCode, 2, "不明フラグは引数不正");
  assert.equal(run(["--target-artifacts", "x"]).exitCode, 2, "app ルート未指定は引数不正");
  assert.equal(run([join(ok, "no-such-dir"), "--target-artifacts", ""]).exitCode, 2, "app ルート不在は入力不能");
});

test("CLI: 実プロセスで exit 0 + stdout JSON (ask / hold / open)", () => {
  const root = makeApp({
    app_name: "t",
    entries: [entry("legacy"), entry("tok", { reflect_to: "tokens.json" })],
  });
  const r = spawnSync(process.execPath, [CLI, root, "--target-artifacts", "requirements.json"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.deepEqual(summary.ask, [{ index: 0, target: "legacy" }]);
  assert.deepEqual(summary.hold, [{ index: 1, target: "tok", reflect_to: "tokens.json" }]);
  assert.equal(summary.open, 2);
});
