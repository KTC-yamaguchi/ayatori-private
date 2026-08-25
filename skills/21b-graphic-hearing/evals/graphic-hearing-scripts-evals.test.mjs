#!/usr/bin/env node
// skills/21b-graphic-hearing/evals/graphic-hearing-scripts-evals.test.mjs
//
// Step 21b の同梱 script 2 本 (scripts/gather-context.mjs / scripts/commit-decision.mjs) の
// **CLI 契約テスト**: 黒箱 CLI として fixture (tmpdir に組み立てた artifacts ツリー) に対して回し、
// stdout JSON の routing 契約 (ok / E_* code) と書き込み副作用 (graphic-plan.json /
// pipeline-state.json / _backup 退避) を固定する。SKILL.md の routing 表・設計
// docs/graphic-generation-design.md §8-4 / §9-2 との対応が回帰しないことを検出する。
//
// fixture 規約: golden ファイルは持たない (出力が小さい JSON のため parse して assert する)。
// artifacts ツリーは makeApp() が tmpdir に毎回組み立て、AYATORI_REPO_ROOT env で
// script に差し込む (作業ツリーの artifacts/ を一切汚さない = npm test 後も git status クリーン)。
//
// 使い方:
//   npm test                                                                              # 検証 (node --test discovery)
//   node --test skills/21b-graphic-hearing/evals/graphic-hearing-scripts-evals.test.mjs   # 本 eval のみ
//   (ディレクトリ引数形 `node --test skills/.../evals/` は Node 23 で誤って fail するため使わない)
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATHER = join(HERE, "..", "scripts", "gather-context.mjs");
const COMMIT = join(HERE, "..", "scripts", "commit-decision.mjs");
const APP = "testapp";

/** tmpdir に artifacts/testapp の fixture ツリーを組み立てる。opts で状態を変形する。 */
function makeApp(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "21b-eval-"));
  const app = join(root, "artifacts", APP);
  mkdirSync(join(app, "screens", "web"), { recursive: true });
  mkdirSync(join(app, "screens", "mobile"), { recursive: true });
  mkdirSync(join(app, "graphics"), { recursive: true });

  const state = {
    schema_version: "2026-05-22",
    app_name: APP,
    approvals: { screens_human_approved: true },
    screens: { graphics: { step21a_completed_at: "2026-07-16T10:00:00+09:00" } },
  };
  if (opts.notApproved) state.approvals.screens_human_approved = false;
  if (opts.no21a) delete state.screens.graphics.step21a_completed_at;
  if (opts.decision) Object.assign(state.screens.graphics, opts.decision);
  writeFileSync(join(app, "pipeline-state.json"), JSON.stringify(state, null, 2));

  const req = {
    app_name: APP,
    design_output_scope: {
      platform_combo: opts.platformCombo ?? "mobile_and_web",
      graphic_generation: opts.upstreamSkip ? "skip" : "ask",
      illustration_policy: "illustration_character",
    },
  };
  if (!opts.noRequirements) writeFileSync(join(app, "requirements.json"), JSON.stringify(req, null, 2));

  if (!opts.noScreenList) writeFileSync(join(app, "screens", "00-screen-list.md"), "# 画面一覧\n");
  const PH = '<div class="illust-placeholder"></div>';
  if (opts.dualTheme) {
    // Step 17 dual_theme 命名: {screen}--light.html / --dark.html のみ (suffix なし main は存在しない)
    writeFileSync(join(app, "screens", "web", "01-login--light.html"), `<html>${PH}${PH}</html>`);
    writeFileSync(join(app, "screens", "web", "01-login--dark.html"), `<html>${PH}</html>`);
    writeFileSync(join(app, "screens", "web", "02-dashboard--light.html"), "<html></html>");
    writeFileSync(join(app, "screens", "web", "02-dashboard--dark.html"), "<html></html>");
    writeFileSync(join(app, "screens", "web", "01-login--empty--light.html"), "<html></html>"); // sub-state × theme (除外対象)
    writeFileSync(join(app, "screens", "mobile", "01-login--light.html"), `<html>${PH}</html>`);
    writeFileSync(join(app, "screens", "mobile", "01-login--dark.html"), "<html></html>");
  } else {
    writeFileSync(join(app, "screens", "web", "01-login.html"), `<html>${PH}${PH}</html>`);
    writeFileSync(join(app, "screens", "web", "02-dashboard.html"), "<html></html>");
    writeFileSync(join(app, "screens", "web", "02-dashboard--empty.html"), "<html></html>"); // sub-state variant (除外対象)
    writeFileSync(join(app, "screens", "mobile", "01-login.html"), `<html>${PH}</html>`);
  }
  if (opts.webSm) {
    // web_viewports=["sm"] 構成の web-sm main 画面 (21a が web-sm slot を提案し得る — yena review)
    mkdirSync(join(app, "screens", "web-sm"), { recursive: true });
    writeFileSync(join(app, "screens", "web-sm", "01-login.html"), `<html>${PH}</html>`);
  }
  if (!opts.noRecommend) writeFileSync(join(app, "graphics", "graphic-recommend.md"), "# 推奨レポート\n");
  if (opts.existingPlan) writeFileSync(join(app, "graphics", "graphic-plan.json"), JSON.stringify(opts.existingPlan));

  return { root, app };
}

/** script を黒箱 CLI として実行し、stdout JSON を parse して返す。 */
function run(script, root, args, stdin) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, AYATORI_REPO_ROOT: root },
    input: stdin,
  });
  assert.equal(res.status, 0, `exit 0 契約 (routing は JSON の code で行う)。stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const readState = (app) => JSON.parse(readFileSync(join(app, "pipeline-state.json"), "utf8"));

const VALID_SLOTS = {
  slots: [
    {
      graphic_id: "empty-login-illust",
      screen: "01-login",
      platforms: ["web", "mobile"],
      placement: "illust-placeholder ブロック置換",
      size_role: "content",
      state: "default",
      rationale: "推奨レポート由来",
    },
    {
      graphic_id: "hero-dashboard",
      screen: "02-dashboard",
      platforms: ["web"],
      placement: "ヒーロー領域 (ヘッダー直下)",
      size_role: "hero",
      state: "default",
    },
  ],
};

// ── gather-context.mjs: 正常系 ──────────────────────────────────────────────

test("gather: report mode — mode/inventory/placeholder_hits を返し sub-state variant を除外する", () => {
  const { root } = makeApp();
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.equal(out.mode, "report");
    assert.equal(out.recommend_report, "graphics/graphic-recommend.md");
    assert.equal(out.platform_combo, "mobile_and_web");
    assert.deepEqual(out.screens, { web: ["01-login", "02-dashboard"], mobile: ["01-login"] }); // --empty は不在
    assert.deepEqual(out.placeholder_hits, { "01-login": { web: 2, mobile: 1 } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: plain mode — recommend 不在で mode=plain / recommend_report=null (fail-open degrade)", () => {
  const { root } = makeApp({ noRecommend: true });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.equal(out.mode, "plain");
    assert.equal(out.recommend_report, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── gather-context.mjs: 前提 NG routing (SKILL.md Step 1 の表と 1:1) ────────

for (const [name, opts, code] of [
  ["Step 21 未承認", { notApproved: true }, "E_SCREENS_NOT_APPROVED"],
  ["21a 未実行", { no21a: true }, "E_21A_NOT_DONE"],
  ["要否確定済み", { decision: { decision: "skip", decided_by: "step21b" } }, "E_DECISION_ALREADY_SET"],
  ["上流 scope skip", { upstreamSkip: true }, "E_UPSTREAM_SKIP"],
  // 上流 skip では 21a 自体が走らない = 21a 未実行が正常状態。E_21A_NOT_DONE (21a へ差し戻し) に誤縮退しない
  ["上流 scope skip + 21a 未実行", { upstreamSkip: true, no21a: true }, "E_UPSTREAM_SKIP"],
  ["requirements 不在", { noRequirements: true }, "E_REQUIREMENTS_MISSING"],
  ["screen-list 不在 (Step 14 未完了)", { noScreenList: true }, "E_SCREEN_LIST_MISSING"],
]) {
  test(`gather: ${name} → ${code}`, () => {
    const { root } = makeApp(opts);
    try {
      const out = run(GATHER, root, [APP]);
      assert.equal(out.ok, false);
      assert.equal(out.code, code);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("gather: E_DECISION_ALREADY_SET は decision 値を同梱する (P4-07 再質問禁止の報告用)", () => {
  const { root } = makeApp({ decision: { decision: "generate" } });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.code, "E_DECISION_ALREADY_SET");
    assert.equal(out.decision, "generate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: app_name 引数なし → E_USAGE / 不在 app → E_APP_NOT_FOUND", () => {
  const { root } = makeApp();
  try {
    assert.equal(run(GATHER, root, []).code, "E_USAGE");
    assert.equal(run(GATHER, root, ["no-such-app"]).code, "E_APP_NOT_FOUND");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-decision.mjs: skip ────────────────────────────────────────────────

test("commit skip: decision=skip + decided_by=step21b を記録し plan は書かない (設計 §8-4 gate_21b)", () => {
  const { root, app } = makeApp();
  try {
    const out = run(COMMIT, root, [APP, "skip"]);
    assert.equal(out.ok, true);
    assert.equal(out.decision, "skip");
    const g = readState(app).screens.graphics;
    assert.equal(g.decision, "skip");
    assert.equal(g.decided_by, "step21b");
    assert.equal(g.step21a_completed_at, "2026-07-16T10:00:00+09:00"); // merge write で既存キー保全
    assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-decision.mjs: generate 正常系 ─────────────────────────────────────

test("commit generate: plan 一括生成 + decision=generate (taste キーなし / recommend_report_ref あり)", () => {
  const { root, app } = makeApp();
  try {
    const out = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(VALID_SLOTS));
    assert.equal(out.ok, true);
    assert.equal(out.slot_count, 2);
    assert.deepEqual(out.graphic_ids, ["empty-login-illust", "hero-dashboard"]);

    const plan = JSON.parse(readFileSync(join(app, "graphics", "graphic-plan.json"), "utf8"));
    assert.equal(plan.app_name, APP);
    assert.match(plan.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.equal(plan.recommend_report_ref, "graphics/graphic-recommend.md");
    assert.deepEqual(plan.slots, VALID_SLOTS.slots);
    assert.equal("taste" in plan, false); // 21c territory (key 分離)

    const g = readState(app).screens.graphics;
    assert.equal(g.decision, "generate");
    assert.equal("decided_by" in g, false); // decided_by は skip 系のみ (設計 §9-2)
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit generate: plain mode では recommend_report_ref を省略する (degrade で確定した記録)", () => {
  const { root, app } = makeApp({ noRecommend: true });
  try {
    assert.equal(run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(VALID_SLOTS)).ok, true);
    const plan = JSON.parse(readFileSync(join(app, "graphics", "graphic-plan.json"), "utf8"));
    assert.equal("recommend_report_ref" in plan, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit generate: 残置 plan (§5 手動リセット後) は _backup/graphics/ へ退避してから上書き", () => {
  const { root, app } = makeApp({ existingPlan: { schema_version: "2026-07-14", app_name: APP, created_at: "x", slots: [{ old: true }] } });
  try {
    const out = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(VALID_SLOTS));
    assert.equal(out.ok, true);
    assert.ok(out.backed_up, "backed_up path が報告される");
    // stamp は _backup/ ミラー規約 (pipeline.yaml § artifact_backup) の {stem}.{YYYYMMDD_HHMMSS}.{ext} 形式
    const backups = readdirSync(join(app, "_backup", "graphics")).filter((f) => /^graphic-plan\.\d{8}_\d{6}\.json$/.test(f));
    assert.equal(backups.length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(app, "_backup", "graphics", backups[0]), "utf8")).slots, [{ old: true }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-decision.mjs: 検証 NG (書き込みゼロ契約) ──────────────────────────

test("commit generate: E_VALIDATION — R9 同基準の全違反種別を列挙し、一切書き込まない", () => {
  const { root, app } = makeApp();
  try {
    const bad = {
      slots: [
        { graphic_id: "Bad-", screen: "99-nope", platforms: ["web", "ios"], size_role: "huge", state: "empty", extra_key: 1 },
      ],
    };
    const out = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(bad));
    assert.equal(out.code, "E_VALIDATION");
    for (const frag of [
      "'placement' が欠落",
      "extra_key",
      "pattern 違反",
      "hero/content/small",
      "state 'empty' は enum",
      "main 画面 '99-nope' が存在しません",
      "存在する main 画面: 01-login, 02-dashboard", // self-correct 用の実在 stem 列挙

      "'ios' は enum (web/web-sm/mobile) 外",
    ]) {
      assert.ok(out.errors.some((e) => e.includes(frag)), `errors に「${frag}」を含む`);
    }
    assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), false, "検証 NG で plan 未生成");
    assert.equal("decision" in readState(app).screens.graphics, false, "検証 NG で state 未更新");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, stdin, frag] of [
  ["空 slots (minItems 1)", '{"slots":[]}', "1 件以上"],
  ["parse 不能 stdin", "not json {", null],
  [
    "完全重複 slot",
    JSON.stringify({ slots: [VALID_SLOTS.slots[1], VALID_SLOTS.slots[1]] }),
    "完全重複",
  ],
  [
    // platforms の並び順違いは同一 slot (dedup キーは sort 正規化してから比較)
    "完全重複 slot (platforms 並び順違い)",
    JSON.stringify({ slots: [VALID_SLOTS.slots[0], { ...VALID_SLOTS.slots[0], platforms: ["mobile", "web"] }] }),
    "完全重複",
  ],
]) {
  test(`commit generate: ${name} → 書き込みゼロで NG 報告`, () => {
    const { root, app } = makeApp();
    try {
      const out = run(COMMIT, root, [APP, "generate", "--stdin"], stdin);
      assert.equal(out.ok, false);
      assert.ok(["E_VALIDATION", "E_BAD_INPUT"].includes(out.code));
      if (frag) assert.ok(out.errors.some((e) => e.includes(frag)));
      assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("commit generate: platform_combo=web_only では mobile slot を拒否する", () => {
  const { root } = makeApp({ platformCombo: "web_only" });
  try {
    const bad = { slots: [{ graphic_id: "a1", screen: "01-login", platforms: ["mobile"], placement: "p", size_role: "small", state: "default" }] };
    const out = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(bad));
    assert.equal(out.code, "E_VALIDATION");
    assert.ok(out.errors.some((e) => e.includes("platform_combo (web_only) の範囲外")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit generate: web-sm slot は実在すれば通り、不在なら実在照合で拒否する (yena review — 無検証素通しの防止)", () => {
  // 実在: screens/web-sm/01-login.html あり → dry-run OK
  const a = makeApp({ webSm: true });
  try {
    const good = { slots: [{ graphic_id: "a1", screen: "01-login", platforms: ["web-sm"], placement: "p", size_role: "small", state: "default" }] };
    const out = run(COMMIT, a.root, [APP, "generate", "--stdin", "--dry-run"], JSON.stringify(good));
    assert.equal(out.ok, true, "web-sm 画面が実在する slot は valid");
  } finally {
    rmSync(a.root, { recursive: true, force: true });
  }
  // 不在: screens/web-sm/ なし → 従来は範囲/実在の両検査を素通しだった。実在照合エラーで拒否する
  const b = makeApp();
  try {
    const bad = { slots: [{ graphic_id: "a1", screen: "01-login", platforms: ["web-sm"], placement: "p", size_role: "small", state: "default" }] };
    const out = run(COMMIT, b.root, [APP, "generate", "--stdin"], JSON.stringify(bad));
    assert.equal(out.code, "E_VALIDATION");
    assert.ok(out.errors.some((e) => e.includes("screens/web-sm/ に main 画面")), `実在照合エラーを期待: ${JSON.stringify(out.errors)}`);
  } finally {
    rmSync(b.root, { recursive: true, force: true });
  }
});

test("commit generate: platform_combo=mobile_only では web-sm slot を範囲外として拒否する", () => {
  const { root } = makeApp({ platformCombo: "mobile_only", webSm: true });
  try {
    const bad = { slots: [{ graphic_id: "a1", screen: "01-login", platforms: ["web-sm"], placement: "p", size_role: "small", state: "default" }] };
    const out = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(bad));
    assert.equal(out.code, "E_VALIDATION");
    assert.ok(out.errors.some((e) => e.includes("platform_combo (mobile_only) の範囲外")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-decision.mjs: --dry-run (§6 確定確認前の draft 事前検証、書き込みゼロ) ──

test("commit --dry-run: 検証 OK でも一切書き込まない (dry_run=true / plan 未生成 / state 未更新)", () => {
  const { root, app } = makeApp();
  try {
    const out = run(COMMIT, root, [APP, "generate", "--stdin", "--dry-run"], JSON.stringify(VALID_SLOTS));
    assert.equal(out.ok, true);
    assert.equal(out.dry_run, true);
    assert.equal(out.slot_count, 2);
    assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), false, "dry-run で plan 未生成");
    assert.equal("decision" in readState(app).screens.graphics, false, "dry-run で state 未更新");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit --dry-run: E_VALIDATION は本番と同一基準で返す / skip との併用は E_USAGE", () => {
  const { root } = makeApp();
  try {
    const bad = { slots: [{ graphic_id: "Bad-", screen: "01-login", platforms: ["web"], placement: "p", size_role: "content", state: "default" }] };
    const dry = run(COMMIT, root, [APP, "generate", "--stdin", "--dry-run"], JSON.stringify(bad));
    assert.equal(dry.code, "E_VALIDATION");
    assert.ok(dry.errors.some((e) => e.includes("pattern 違反")));
    assert.equal(run(COMMIT, root, [APP, "skip", "--dry-run"]).code, "E_USAGE"); // skip には検証対象の draft がない
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-decision.mjs: 再 assert (対話中の state 変化への防御) ─────────────

test("commit: decision 確定済みなら generate/skip とも E_DECISION_ALREADY_SET で二重 commit を拒否", () => {
  const { root, app } = makeApp({ decision: { decision: "generate" } });
  try {
    assert.equal(run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(VALID_SLOTS)).code, "E_DECISION_ALREADY_SET");
    assert.equal(run(COMMIT, root, [APP, "skip"]).code, "E_DECISION_ALREADY_SET");
    assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: 引数不正 → E_USAGE / Step 21 未承認 → E_SCREENS_NOT_APPROVED", () => {
  const { root } = makeApp({ notApproved: true });
  try {
    assert.equal(run(COMMIT, root, [APP, "bogus"]).code, "E_USAGE");
    assert.equal(run(COMMIT, root, [APP, "generate"], JSON.stringify(VALID_SLOTS)).code, "E_USAGE"); // generate は --stdin 必須 (usage 契約)
    assert.equal(run(COMMIT, root, [APP, "skip"]).code, "E_SCREENS_NOT_APPROVED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── PR レビュー指摘の回帰テスト ──────────────────────────────────────────────

test("dual_theme プロジェクト: gather は論理 stem を返し、commit は論理名の slot を受理する (finding 1)", () => {
  const { root, app } = makeApp({ dualTheme: true });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.deepEqual(out.screens, { web: ["01-login", "02-dashboard"], mobile: ["01-login"] }); // --light/--dark を剥がし --empty-- は除外
    assert.deepEqual(out.placeholder_hits, { "01-login": { web: 3, mobile: 1 } }); // theme variant 合算

    const commit = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(VALID_SLOTS));
    assert.equal(commit.ok, true, `dual_theme で generate が拒否された: ${JSON.stringify(commit)}`);
    assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit generate: 非 string field (JSON number) は型違反として拒否する (finding 3)", () => {
  const { root, app } = makeApp();
  try {
    const bad = { slots: [{ graphic_id: 123, screen: 123, platforms: ["web"], placement: 42, size_role: "content", state: "default" }] };
    const out = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(bad));
    assert.equal(out.code, "E_VALIDATION");
    for (const key of ["graphic_id", "screen", "placement"]) {
      assert.ok(out.errors.some((e) => e.includes(`${key} は string 型が必須`)), `${key} の型違反を検出する`);
    }
    assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit generate: platform_combo が不明値なら fail-open で全許容せず E_VALIDATION (finding 6)", () => {
  const { root, app } = makeApp({ platformCombo: "desktop_only" });
  try {
    const out = run(COMMIT, root, [APP, "generate", "--stdin"], JSON.stringify(VALID_SLOTS));
    assert.equal(out.code, "E_VALIDATION");
    assert.ok(out.errors.some((e) => e.includes("platform_combo 'desktop_only' が不明")));
    assert.equal(existsSync(join(app, "graphics", "graphic-plan.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: pipeline-state 破損は E_STATE_MISSING と報告する (E_SCREENS_NOT_APPROVED に誤縮退しない、finding 8)", () => {
  const { root, app } = makeApp();
  try {
    writeFileSync(join(app, "pipeline-state.json"), "not json {");
    assert.equal(run(COMMIT, root, [APP, "skip"]).code, "E_STATE_MISSING");
    assert.equal(run(GATHER, root, [APP]).code, "E_STATE_MISSING"); // gather と同一 code (共有 preflight)
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scripts は NUL byte を含まない text ファイルである (git diff 可能、finding 4)", () => {
  const scriptsDir = join(HERE, "..", "scripts");
  for (const f of readdirSync(scriptsDir).filter((n) => n.endsWith(".mjs"))) {
    const body = readFileSync(join(scriptsDir, f), "utf8");
    assert.equal(body.includes("\u0000"), false, `${f} に NUL byte`);
  }
});
