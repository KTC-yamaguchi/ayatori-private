// scripts/pipeline-status.test.mjs
//
// scripts/pipeline-status.mjs の単体テスト。Node 標準の node:test + node:assert のみ (依存ゼロ)。
//   実行: node --test scripts/pipeline-status.test.mjs
//
// テスト方針:
//   - 受け入れ条件 3 点を最優先で固定する:
//       AC1: delta run 中断中のプロジェクトで resume 先 step を表示できる
//       AC2: retro 完了済みプロジェクトで Phase 4 complete を表示できる
//       AC3: stub モード (figma-state.json 不在) で Figma export を「skipped (stub)」表示できる
//   - fixture は os.tmpdir 配下に最小 artifact ツリーを都度構築する (repo の artifacts/ は触らない)。
//   - スクリプト本体は READ-ONLY のまま (書き込みはテストコードのみが行う)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  STATUS,
  DEFAULT_THRESHOLDS,
  loadProject,
  detectPhase0b,
  detectPhase1a,
  detectPhase1b,
  detectPhase0cVerify,
  detectPhase1c,
  detectPhase1d,
  detectPhase2,
  detectPhase3Main,
  detectPhase3SubState,
  detectPhase4,
  detectPhase5,
  detectPhase6,
  buildStatus,
  recommendNextAction,
} from "./pipeline-status.mjs";

const T = DEFAULT_THRESHOLDS;

// ── fixture ヘルパ ───────────────────────────────────────────
// makeRepo() → { repoRoot, artifactsRoot, app(name, spec), cleanup() }
// spec.files: { "相対パス": string | object (JSON 化) }
const makeRepo = () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "ayatori-status-test-"));
  const artifactsRoot = join(repoRoot, "artifacts");
  mkdirSync(artifactsRoot, { recursive: true });
  const app = (name, files = {}) => {
    const root = join(artifactsRoot, name);
    mkdirSync(root, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
    }
    return loadProject(artifactsRoot, name);
  };
  const cleanup = () => rmSync(repoRoot, { recursive: true, force: true });
  return { repoRoot, artifactsRoot, app, cleanup };
};

// 完走済プロジェクトの共通 state (Phase 3 main 完了直前まで全ゲート通過)
const completedStateBase = {
  schema_version: "2026-05-22",
  app_name: "x",
  approvals: {
    step07_approved_at: "2026-06-01T10:00:00+09:00",
    step13_approved_at: "2026-06-02T10:00:00+09:00",
    step16_approved_at: "2026-06-03T10:00:00+09:00",
    screens_human_approved: true,
    final_approved: true,
  },
  confluence: { design: { save_count: 2, save_status: "success" } },
};

// ── AC1: delta run 中断 → resume 先 step 表示 ────────────────
test("AC1: delta run (requirement mode) 中断 — impact 承認済なら Step 29 を resume 先に出す", () => {
  const { app, cleanup } = makeRepo();
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      delta: {
        runs: [{
          run_id: "2026-07-01-001",
          change_description: "料金表示の変更",
          initiated_at: "2026-07-01T10:00:00+09:00",
          impact_approved_at: "2026-07-01T11:00:00+09:00",
          // screens_approved_at / figma_approved_at 未 set = Step 29 で中断
        }],
      },
    },
  });
  const p5 = detectPhase5(ctx);
  assert.equal(p5.status, STATUS.IN_PROGRESS);
  assert.equal(p5.resume_step, "29-partial-screen-regen");
  assert.match(p5.detail, /run 2026-07-01-001/);
  assert.match(p5.detail, /resume at Step 29-partial-screen-regen/);
  // resume が next_action に昇格する (中断 run resume がダッシュボードの本務)
  const next = recommendNextAction([p5]);
  assert.equal(next.command, "/ayatori-delta");
  cleanup();
});

test("AC1: delta run 中断 — impact 未承認なら Step 28、screens 承認済なら Step 30", () => {
  const { app, cleanup } = makeRepo();
  const base = (extra) => ({
    ...completedStateBase,
    delta: { runs: [{ run_id: "r1", change_description: "c", initiated_at: "2026-07-01T10:00:00+09:00", ...extra }] },
  });
  assert.equal(detectPhase5(app("a", { "pipeline-state.json": base({}) })).resume_step, "28-impact-analysis");
  assert.equal(
    detectPhase5(app("b", {
      "pipeline-state.json": base({ impact_approved_at: "t", screens_approved_at: "t" }),
    })).resume_step,
    "30-partial-figma-update",
  );
  cleanup();
});

test("AC1: delta run 中断 (screen_edit mode) — 29b を resume 先に出す", () => {
  const { app, cleanup } = makeRepo();
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      delta: {
        runs: [{
          run_id: "r1", change_description: "手編集反映", initiated_at: "2026-07-01T10:00:00+09:00",
          mode: "screen_edit",
        }],
      },
    },
  });
  const p5 = detectPhase5(ctx);
  assert.equal(p5.resume_step, "29b-reverse-propagate");
  assert.equal(p5.mode, "screen_edit");
  cleanup();
});

test("AC1: req-delta run 中断 — impact 承認有無で Step 32/33 を出し分ける", () => {
  const { app, cleanup } = makeRepo();
  const base = (extra) => ({
    ...completedStateBase,
    req_delta: { runs: [{ run_id: "rq1", change_description: "c", initiated_at: "2026-07-01T10:00:00+09:00", ...extra }] },
  });
  const p32 = detectPhase1c(app("a", { "pipeline-state.json": base({}) }));
  assert.equal(p32.status, STATUS.IN_PROGRESS);
  assert.equal(p32.resume_step, "32-req-impact-analysis");
  const p33 = detectPhase1c(app("b", { "pipeline-state.json": base({ impact_approved_at: "t" }) }));
  assert.equal(p33.resume_step, "33-req-revision");
  cleanup();
});

test("reverse-verify: run 中断 — 到達済みの stamp で V2/V3 の resume 先を出し分ける", () => {
  const { app, cleanup } = makeRepo();
  const base = (extra) => ({
    app_name: "a",
    reverse_verify: {
      runs: [{ run_id: "rv1", target_description: "車両検索", initiated_at: "2026-08-12T10:00:00+09:00", scope_approved_at: "t", ...extra }],
    },
  });
  const pV2 = detectPhase0cVerify(app("a", { "pipeline-state.json": base({}) }));
  assert.equal(pV2.status, STATUS.IN_PROGRESS);
  assert.equal(pV2.phase, "0c");
  assert.equal(pV2.resume_step, "V2-targeted-crosscheck");
  assert.equal(pV2.run_id, "rv1");
  const pV3 = detectPhase0cVerify(app("b", { "pipeline-state.json": base({ crosscheck_completed_at: "t" }) }));
  assert.equal(pV3.resume_step, "V3-discrepancy-gate");
  // findings_resolved_at = 反映 + 台帳書き戻しまで完了。残るのは Completion だけで、
  // V3 へ戻すとスナップショットが訂正後で上書きされ検査の基準線が壊れる
  const pApply = detectPhase0cVerify(
    app("c", { "pipeline-state.json": base({ crosscheck_completed_at: "t", findings_resolved_at: "t" }) }),
  );
  assert.match(pApply.resume_step, /^Completion/);
  assert.doesNotMatch(pApply.resume_step, /V3/, "完了済の V3 へ戻す案内を出さない");
  cleanup();
});

test("reverse-verify: 範囲ゲートで中断した stub は V1 の再提示を案内する", () => {
  const { app, cleanup } = makeRepo();
  const ctx = app("a", {
    "pipeline-state.json": {
      app_name: "a",
      // scope_approved_at 未 set = V1 の人間ゲート提示中に中断した stub
      reverse_verify: { runs: [{ run_id: "rv1", target_description: "検索", initiated_at: "t" }] },
    },
  });
  const p = detectPhase0cVerify(ctx);
  assert.equal(p.status, STATUS.IN_PROGRESS);
  assert.match(p.resume_step, /^V1-target-scope/);
  cleanup();
});

test("reverse-verify: 完了・中止・保留件数を集計し、未実行なら行ごと非表示 (null)", () => {
  const { app, cleanup } = makeRepo();
  // 未実行 (reverse 完走済でも) → null。走っていないことは異常ではないため行を出さない
  const fresh = app("fresh", {
    "pipeline-state.json": { app_name: "fresh" },
    "requirements.json": { app_name: "fresh", status: "REVERSE_ENGINEERED" },
  });
  assert.equal(detectPhase0cVerify(fresh), null);
  const done = app("done", {
    "pipeline-state.json": {
      app_name: "done",
      reverse_verify: {
        runs: [
          { run_id: "rv1", target_description: "t", initiated_at: "t", cancelled_at: "t", cancel_reason: "user_abort" },
          { run_id: "rv2", target_description: "t", initiated_at: "t", crosscheck_completed_at: "t", findings_resolved_at: "t", findings_deferred: 2, completed_at: "t" },
        ],
      },
    },
  });
  const p = detectPhase0cVerify(done);
  assert.equal(p.status, STATUS.COMPLETE);
  assert.match(p.detail, /1 run\(s\) completed/);
  assert.match(p.detail, /1 cancelled/);
  assert.match(p.detail, /2 unresolved finding\(s\)/);
  cleanup();
});

test("reverse-verify: 台帳が読めて未解決 0 件なら runs[] の数値へ fallback しない", () => {
  const { app, cleanup } = makeRepo();
  // 台帳は読めて未解決 0 件。runs[] には古い findings_deferred が残っている
  // (?? を || に変えると 0 が falsy で fallback に流れ、解決済みの件数を掘り返す)
  const ctx = app("a", {
    "pipeline-state.json": {
      app_name: "a",
      reverse_verify: {
        runs: [{ run_id: "rv1", target_description: "t", initiated_at: "t", findings_resolved_at: "t", findings_deferred: 2, completed_at: "t" }],
      },
    },
    "requirement-deviations.json": {
      app_name: "a",
      entries: [
        { phase: "reverse_verify", run_id: "rv1", first_run_id: "rv1", raised_by_step: "02-targeted-crosscheck", artifact: "requirements/05-features.md", element: "x", deviation_kind: "要件矛盾", detected_at: "t", resolved_at: "t", resolution: "容認" },
      ],
    },
  });
  const p = detectPhase0cVerify(ctx);
  assert.equal(p.status, STATUS.COMPLETE);
  assert.doesNotMatch(p.detail, /unresolved/, "未解決 0 件なら deferred 表示を出さない");
  cleanup();
});

test("reverse-verify: 中止だけの履歴は complete と呼ばない (成果物は変わっていない)", () => {
  const { app, cleanup } = makeRepo();
  const ctx = app("a", {
    "pipeline-state.json": {
      app_name: "a",
      reverse_verify: {
        runs: [{ run_id: "rv1", target_description: "t", initiated_at: "t", cancelled_at: "t", cancel_reason: "user_abort" }],
      },
    },
  });
  const p = detectPhase0cVerify(ctx);
  assert.equal(p.status, STATUS.SKIPPED);
  assert.match(p.detail, /1 run\(s\) cancelled/);
  cleanup();
});

test("推奨アクション: 任意フェーズの中断 run は本流のゲート待ちを覆い隠さない", () => {
  const mainlineWaiting = { phase: "3", label: "Screens", command: "/ayatori-screens", status: STATUS.WAITING_APPROVAL, detail: "final approval (23)" };
  const optionalActive = { phase: "0c", label: "Reverse-verify", command: "/ayatori-reverse-verify", status: STATUS.IN_PROGRESS, detail: "run rv1 interrupted", optional: true };
  // 配列順で optional が先に来ても本流が採られる
  const next = recommendNextAction([optionalActive, mainlineWaiting]);
  assert.equal(next.command, "/ayatori-screens");
  // 本流に active が無ければ optional の resume を案内する
  const onlyOptional = recommendNextAction([
    { phase: "0b", label: "Reverse", command: "/ayatori-reverse", status: STATUS.COMPLETE },
    optionalActive,
  ]);
  assert.equal(onlyOptional.command, "/ayatori-reverse-verify");
});

test("reverse-verify: 保留件数は台帳の未解決数を出す (runs[] の合計は引き継ぎで重複計上する)", () => {
  const { app, cleanup } = makeRepo();
  const runs = [
    { run_id: "rv1", target_description: "A 機能", initiated_at: "t", findings_resolved_at: "t", findings_deferred: 2, completed_at: "t" },
    { run_id: "rv2", target_description: "B 機能", initiated_at: "t", findings_resolved_at: "t", findings_deferred: 1, completed_at: "t" },
  ];
  const dev = (entries) => ({ app_name: "a", entries });
  // 台帳が真値: rv1 の保留 2 件のうち 1 件が rv2 で引き継がれ未解決、rv1 固有の 1 件も未解決、
  // rv2 で新たに 1 件保留 → 実際の未解決は 3 件 (runs[] 合計 3 と一致するのは偶然、最新 run の 1 では取りこぼす)
  const ctx = app("a", {
    "pipeline-state.json": { app_name: "a", reverse_verify: { runs } },
    "requirement-deviations.json": dev([
      { phase: "reverse_verify", run_id: "rv1", raised_by_step: "02-targeted-crosscheck", artifact: "requirements/05-features.md", element: "x1", deviation_kind: "要件矛盾", detected_at: "t" },
      { phase: "reverse_verify", run_id: "rv2", raised_by_step: "02-targeted-crosscheck", artifact: "requirements/05-features.md", element: "x2", deviation_kind: "要件矛盾", detected_at: "t" },
      { phase: "reverse_verify", run_id: "rv2", raised_by_step: "02-targeted-crosscheck", artifact: "requirements/07-interfaces.md", element: "x3", deviation_kind: "要件矛盾", detected_at: "t" },
      // resolved 済みは数えない
      { phase: "reverse_verify", run_id: "rv1", raised_by_step: "02-targeted-crosscheck", artifact: "requirements/05-features.md", element: "x4", deviation_kind: "要件矛盾", detected_at: "t", resolved_at: "t", resolution: "容認" },
      // 他 phase は数えない
      { phase: "reverse", raised_by_step: "05-review-gate", artifact: "reverse-engineered/05-features.md", element: "y", deviation_kind: "根拠薄弱", detected_at: "t" },
    ]),
  });
  assert.match(detectPhase0cVerify(ctx).detail, /3 unresolved finding\(s\)/);

  // 台帳が読めない場合は runs[] から補完する (沈黙して 0 にしない)
  const noLedger = app("b", { "pipeline-state.json": { app_name: "b", reverse_verify: { runs } } });
  assert.match(detectPhase0cVerify(noLedger).detail, /1 unresolved finding\(s\)/);
  cleanup();
});

test("delta / req-delta: run 完了・中止で complete、未実行なら行ごと非表示 (null)", () => {
  const { app, cleanup } = makeRepo();
  // 未実行 → null
  const fresh = app("fresh", { "pipeline-state.json": { app_name: "fresh" } });
  assert.equal(detectPhase5(fresh), null);
  assert.equal(detectPhase1c(fresh), null);
  assert.equal(detectPhase6(fresh), null);
  // 完了 run (figma_approved_at) + 中止 run → complete
  const done = app("done", {
    "pipeline-state.json": {
      ...completedStateBase,
      delta: {
        runs: [
          { run_id: "r1", change_description: "c", initiated_at: "t", cancelled_at: "t", cancel_reason: "user_abort" },
          { run_id: "r2", change_description: "c", initiated_at: "t", impact_approved_at: "t", screens_approved_at: "t", figma_approved_at: "t" },
        ],
      },
    },
  });
  const p5 = detectPhase5(done);
  assert.equal(p5.status, STATUS.COMPLETE);
  assert.match(p5.detail, /1 run\(s\) completed/);
  assert.match(p5.detail, /1 cancelled/);
  cleanup();
});

// ── AC2: retro 完了 → Phase 4 complete ───────────────────────
test("AC2: approvals.retro_completed_at が set なら Phase 4 complete (恒久 key 先読み)", () => {
  const { artifactsRoot, app, cleanup } = makeRepo();
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      approvals: { ...completedStateBase.approvals, retro_completed_at: "2026-07-05T10:00:00+09:00" },
    },
  });
  assert.equal(detectPhase4(ctx, artifactsRoot).status, STATUS.COMPLETE);
  cleanup();
});

test("AC2: repo-level artifacts/pipeline-improvements.md の対象アプリ行から retro 完了を検出 (A-3 修正)", () => {
  const { artifactsRoot, app, cleanup } = makeRepo();
  writeFileSync(join(artifactsRoot, "pipeline-improvements.md"), [
    "# パイプライン改善レポート",
    "",
    "**セッション日時**: 2026-07-05",
    "**対象アプリ**: proj",
    "**要件定義スコア**: 88点",
    "",
    "---",
    "",
    "**セッション日時**: 2026-04-22",
    // 実データ形式: app_name 直後にスペースなしで全角括弧の注釈が連結される
    "**対象アプリ**: proj-annotated（トヨタ自動車・販売店向け AIアバター動画作成ツール）",
  ].join("\n"), "utf8");
  const ctx = app("proj", { "pipeline-state.json": completedStateBase });
  const p4 = detectPhase4(ctx, artifactsRoot);
  assert.equal(p4.status, STATUS.COMPLETE);
  assert.match(p4.detail, /pipeline-improvements\.md/);
  // 全角括弧注釈がスペースなしで連結された実データ形式でも検出できる
  const annotated = app("proj-annotated", { "pipeline-state.json": { ...completedStateBase, app_name: "proj-annotated" } });
  assert.equal(detectPhase4(annotated, artifactsRoot).status, STATUS.COMPLETE);
  // 別アプリは complete にならない (部分一致ではなくトークン一致)
  const other = app("proj-two", { "pipeline-state.json": { ...completedStateBase, app_name: "proj-two" } });
  assert.equal(detectPhase4(other, artifactsRoot).status, STATUS.NOT_STARTED);
  cleanup();
});

test("AC2: retro 未実施 — 完走済なら not_started、未完走なら entry guard を detail に出す", () => {
  const { artifactsRoot, app, cleanup } = makeRepo();
  const eligible = app("a", { "pipeline-state.json": completedStateBase });
  const p4a = detectPhase4(eligible, artifactsRoot);
  assert.equal(p4a.status, STATUS.NOT_STARTED);
  assert.equal(p4a.detail, null);
  const guarded = app("b", { "pipeline-state.json": { app_name: "b" } });
  const p4b = detectPhase4(guarded, artifactsRoot);
  assert.equal(p4b.status, STATUS.NOT_STARTED);
  assert.match(p4b.detail, /entry guard/);
  cleanup();
});

// ── AC3: stub モード → Figma export "skipped (stub)" ─────────
test("AC3: figma-state.json 不在 (stub モード) は Figma export で塞き止めず skipped (stub) 表示", () => {
  const { app, cleanup } = makeRepo();
  // 21 承認 + 2nd save 済、final 未承認、figma-state.json 不在
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      approvals: { ...completedStateBase.approvals, final_approved: false },
    },
    "screens/00-screen-list.md": "# 画面一覧",
    "screens/01-home.md": "# ホーム",
    "scores.json": { app_name: "proj", current: { attempt: 1, total: 95, ai_improvable_deductions: 0 } },
  });
  const p3 = detectPhase3Main(ctx, T);
  assert.equal(p3.figma_export, "skipped (stub)");
  // Figma export (22) で in_progress に落ちず、final approval (23) 待ちへ進む
  assert.equal(p3.status, STATUS.WAITING_APPROVAL);
  assert.match(p3.detail, /final approval \(23\)/);
  assert.match(p3.detail, /skipped \(stub\)/);
  cleanup();
});

test("AC3 対比: figma-state.json あり + nodes.screens 空なら従来通り Figma export (22) を出す", () => {
  const { app, cleanup } = makeRepo();
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      approvals: { ...completedStateBase.approvals, final_approved: false },
    },
    "screens/00-screen-list.md": "# 画面一覧",
    "screens/01-home.md": "# ホーム",
    "scores.json": { app_name: "proj", current: { attempt: 1, total: 95, ai_improvable_deductions: 0 } },
    "figma-state.json": { app_name: "proj", nodes: { screens: {} } },
  });
  const p3 = detectPhase3Main(ctx, T);
  assert.equal(p3.status, STATUS.IN_PROGRESS);
  assert.equal(p3.figma_export, "pending");
  assert.match(p3.detail, /Figma export \(22\)/);
  cleanup();
});

test("AC3: figma-state.json 存在 + step22_figma_status = skipped_stub_mode なら skipped (stub) で 23 待ちへ進む", () => {
  const { app, cleanup } = makeRepo();
  // disabled 環境でも figma-state.json は別経路 (REVERSE_ENGINEERED bootstrap 等) で存在しうる。
  // その場合は Step 22 disabled fallback の skip 記録 (screens.step22_figma_status) で stub と判定する
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      approvals: { ...completedStateBase.approvals, final_approved: false },
      screens: { step22_figma_status: "skipped_stub_mode" },
    },
    "screens/00-screen-list.md": "# 画面一覧",
    "screens/01-home.md": "# ホーム",
    "scores.json": { app_name: "proj", current: { attempt: 1, total: 95, ai_improvable_deductions: 0 } },
    "figma-state.json": { app_name: "proj", nodes: { screens: {} } },
  });
  const p3 = detectPhase3Main(ctx, T);
  assert.equal(p3.figma_export, "skipped (stub)");
  assert.equal(p3.status, STATUS.WAITING_APPROVAL);
  assert.match(p3.detail, /final approval \(23\)/);
  cleanup();
});

test("AC3: sub-state 25e が skipped_stub_mode でも complete + skipped (stub) 表示", () => {
  const { app, cleanup } = makeRepo();
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      approvals: { ...completedStateBase.approvals, completed_at_states: "2026-07-01T10:00:00+09:00" },
      screens: { step25e: { completed_at: "t", figma_status: "skipped_stub_mode" } },
    },
  });
  const sub = detectPhase3SubState(ctx);
  assert.equal(sub.status, STATUS.COMPLETE);
  assert.equal(sub.figma_export, "skipped (stub)");
  cleanup();
});

// ── Step 21 承認後・2nd save 前の graphics ブロック表示 ────
test("Phase 3 main: graphics ブロックの 未解決 / generate 停止 / skip・21g 承認・上流 skip 解決を出し分ける", () => {
  const { app, cleanup } = makeRepo();
  // Step 21 承認済み・save_count == 1 (2nd save 前) の共通 fixture。opts で graphics 状態を変形する
  const mkFiles = (name, { graphics, graphicsApproved, upstreamSkip } = {}) => ({
    "pipeline-state.json": {
      schema_version: "2026-05-22",
      app_name: name,
      approvals: {
        step16_approved_at: "2026-06-03T10:00:00+09:00",
        screens_human_approved: true,
        ...(graphicsApproved ? { graphics_human_approved: true } : {}),
      },
      confluence: { design: { save_count: 1, save_status: "success" } },
      ...(graphics ? { screens: { graphics } } : {}),
    },
    "requirements.json": {
      app_name: name,
      design_output_scope: { graphic_generation: upstreamSkip ? "skip" : "ask" },
    },
    "screens/00-screen-list.md": "# 画面一覧",
    "screens/01-home.md": "# ホーム",
    "scores.json": { app_name: name, current: { attempt: 1, total: 95, ai_improvable_deductions: 0 } },
  });

  // decision 未定 (21a/21b 未了) → graphics ブロック進行中 (21a-21b)
  const undecided = detectPhase3Main(app("g1", mkFiles("g1")), T);
  assert.equal(undecided.status, STATUS.IN_PROGRESS);
  assert.match(undecided.detail, /graphic block \(21a-21b\)/);

  // decision == "generate" + 21g 未承認 → 21c-21g 進行中表示
  const generating = detectPhase3Main(
    app("g2", mkFiles("g2", { graphics: { decision: "generate", decided_by: "step21b" } })), T);
  assert.equal(generating.status, STATUS.IN_PROGRESS);
  assert.match(generating.detail, /graphic block \(21c-21g\)/);

  // decision == "skip" (21b で不要) → 解決済み: 従来どおり 2nd save 表示
  const skipped = detectPhase3Main(
    app("g3", mkFiles("g3", { graphics: { decision: "skip", decided_by: "step21b" } })), T);
  assert.match(skipped.detail, /2nd Confluence save \(15\)/);

  // decision == "generate" + graphics_human_approved (21g 承認済) → 解決済み: 2nd save 表示
  const approved = detectPhase3Main(
    app("g4", mkFiles("g4", { graphics: { decision: "generate", decided_by: "step21b" }, graphicsApproved: true })), T);
  assert.match(approved.detail, /2nd Confluence save \(15\)/);

  // 上流 scope == "skip" + orchestrator 記録前 (decision 未 set) → ブロックに入らないため 2nd save 表示のまま
  const upstream = detectPhase3Main(app("g5", mkFiles("g5", { upstreamSkip: true })), T);
  assert.match(upstream.detail, /2nd Confluence save \(15\)/);

  cleanup();
});

// ── Phase 0b / 1a / 1b ───────────────────────────────────────
test("Phase 0b: reverse-engineered/ 進捗ファイルから resume 位置を導出、非 reverse は非表示", () => {
  const { app, cleanup } = makeRepo();
  assert.equal(detectPhase0b(app("plain", {})), null);
  const mid = app("rev", {
    "reverse-engineered/raw-analysis.md": "# raw",
    "reverse-engineered/08-constraints.md": "# constraints",
  });
  const p0b = detectPhase0b(mid);
  assert.equal(p0b.status, STATUS.IN_PROGRESS);
  assert.match(p0b.detail, /resume from Step 04/);
  const done = app("rev-done", {
    "reverse-engineered/raw-analysis.md": "# raw",
    "requirements.json": { app_name: "rev-done", status: "REVERSE_ENGINEERED" },
  });
  assert.equal(detectPhase0b(done).status, STATUS.COMPLETE);
  // reverse 完了時 1a / 1b は skipped 扱い (00-raw-input.md / rubric.json は生成されない)
  assert.equal(detectPhase1a(done).status, STATUS.SKIPPED);
  assert.equal(detectPhase1b(done, T).status, STATUS.SKIPPED);
  cleanup();
});

test("Phase 1b: reverse 経路の自動押印 (step07_approved_via) は COMPLETE でなく SKIPPED、forward 押印は COMPLETE のまま", () => {
  const { app, cleanup } = makeRepo();
  // Phase 0b Completion の自動押印 (via あり) — Phase 1b は実行されていないので SKIPPED 表示を保つ
  const stamped = app("rev-stamped", {
    "reverse-engineered/raw-analysis.md": "# raw",
    "requirements.json": { app_name: "rev-stamped", status: "REVERSE_ENGINEERED" },
    "pipeline-state.json": {
      app_name: "rev-stamped",
      approvals: {
        step07_approved_at: "2026-08-11T11:13:31+09:00",
        step07_approved_via: "reverse-review-gate",
      },
    },
  });
  const r1 = detectPhase1b(stamped, T);
  assert.equal(r1.status, STATUS.SKIPPED);
  assert.match(r1.detail, /reverse flow/);
  // 自動押印導入前の遺産 + 手動 stub (via なし) でも reverse プロジェクトなら SKIPPED に倒す
  const legacyStub = app("rev-legacy", {
    "reverse-engineered/raw-analysis.md": "# raw",
    "requirements.json": { app_name: "rev-legacy", status: "REVERSE_ENGINEERED" },
    "pipeline-state.json": {
      app_name: "rev-legacy",
      approvals: { step07_approved_at: "2026-05-22T10:00:00+09:00" },
    },
  });
  assert.equal(detectPhase1b(legacyStub, T).status, STATUS.SKIPPED);
  // forward 経路の正規承認 (via なし・REVERSE_ENGINEERED でない) は従来どおり COMPLETE
  const forward = app("fwd", {
    "requirements.json": { app_name: "fwd" },
    "pipeline-state.json": {
      app_name: "fwd",
      approvals: { step07_approved_at: "2026-05-22T10:00:00+09:00" },
    },
  });
  assert.equal(detectPhase1b(forward, T).status, STATUS.COMPLETE);
  cleanup();
});

test("Phase 0b: 証拠収集済み (docs / figma) をソース別に見分ける", () => {
  const { app, cleanup } = makeRepo();
  // figma のみ収集済み — figma/ サブディレクトリだけで「文書も収集済み」と誤判定しない
  const figmaOnly = app("rev-figma", {
    "ground-truth/figma/figma-manifest.json": { app_name: "rev-figma", files: [] },
    "reverse-engineered/source-inventory.json": { app_name: "rev-figma", sources: {}, roles: {} },
  });
  const pf = detectPhase0b(figmaOnly);
  assert.equal(pf.status, STATUS.IN_PROGRESS);
  assert.match(pf.detail, /figma/);
  // 文書のみ収集済み
  const docsOnly = app("rev-docs", {
    "ground-truth/index.md": "# Ground-Truth Index",
    "ground-truth/cf-111-spec.md": "# Spec",
    "reverse-engineered/source-inventory.json": { app_name: "rev-docs", sources: {}, roles: {} },
  });
  const pd = detectPhase0b(docsOnly);
  assert.equal(pd.status, STATUS.IN_PROGRESS);
  assert.match(pd.detail, /docs|文書/);
  cleanup();
});

test("Phase 1b: scoring loop の attempt / axis gap / Confluence save / human gate を出し分ける", () => {
  const { app, cleanup } = makeRepo();
  const files = (attempts, conf = {}) => ({
    "rubric.json": { app_name: "p", criteria: [] },
    "scoring-history.json": { app_name: "p", attempts },
    "pipeline-state.json": { app_name: "p", confluence: conf },
  });
  // 軸割れ (axis gap) → in_progress + 軸名列挙
  const gap = detectPhase1b(app("a", files([{ total: 85, scores: { completeness: 10, clarity: 15 } }])), T);
  assert.equal(gap.status, STATUS.IN_PROGRESS);
  assert.match(gap.detail, /axis gap: completeness/);
  // pass + save 未 → Confluence save pending
  const save = detectPhase1b(app("b", files([{ total: 85, scores: { completeness: 15 } }])), T);
  assert.match(save.detail, /Confluence save pending/);
  // pass + save success → human gate 待ち
  const gate = detectPhase1b(
    app("c", files([{ total: 85, scores: { completeness: 15 } }], { requirements: { save_status: "success" } })), T);
  assert.equal(gate.status, STATUS.WAITING_APPROVAL);
  // max attempts 消化 + 未 pass → escalated 表示
  const esc = detectPhase1b(
    app("d", files([{ total: 70, scores: {} }, { total: 75, scores: {} }, { total: 78, scores: {} }])), T);
  assert.match(esc.detail, /escalated/);
  cleanup();
});

// ── Phase 2 / 3 sub-state / 6 ────────────────────────────────
test("Phase 2: sample 選択 → WCAG → tokens → style guide review の順に判定する", () => {
  const { app, cleanup } = makeRepo();
  // brief のみ → sample 生成待ち
  const gen = detectPhase2(app("a", { "design-brief.yaml": "schema: draft:v1" }), T);
  assert.match(gen.detail, /sample HTML generation \(09\)/);
  // sample あり + 未選択 → 選択ゲート
  const sel = detectPhase2(app("b", {
    "design-brief.yaml": "schema: draft:v1",
    "design-samples/web/index.html": "<html></html>",
  }), T);
  assert.equal(sel.status, STATUS.WAITING_APPROVAL);
  // 選択済 + WCAG constraints + violations 空 + tokens → style guide review
  const review = detectPhase2(app("c", {
    "design-brief.yaml": "schema: draft:v1",
    "pipeline-state.json": { app_name: "c", selections: { selected_sample_id: "a" } },
    "wcag-mapping.json": { app_name: "c", constraints: {} },
    "wcag-history.json": { app_name: "c", attempts: [{ violations: [] }] },
    "tokens.json": { color: {} },
  }), T);
  assert.equal(review.status, STATUS.WAITING_APPROVAL);
  assert.match(review.detail, /style guide review \(13\)/);
  cleanup();
});

test("Phase 3 sub-state: skip / 25b 部分完了 resume / 25d gate を出し分ける", () => {
  const { app, cleanup } = makeRepo();
  // user skip → skipped
  const skipped = detectPhase3SubState(app("a", {
    "pipeline-state.json": { ...completedStateBase, screens: { state_pattern_skipped: true } },
  }));
  assert.equal(skipped.status, STATUS.SKIPPED);
  // 25b 部分完了 → resume 情報付き in_progress
  const partial = detectPhase3SubState(app("b", {
    "pipeline-state.json": {
      ...completedStateBase,
      screens: { step25a_completed_at: "t", step25b: { started_at: "t", expected_count: 6, completed_count: 2 } },
    },
  }));
  assert.equal(partial.status, STATUS.IN_PROGRESS);
  assert.equal(partial.resume_step, "25b-state-pattern-gen");
  assert.match(partial.detail, /2\/6/);
  // 25c 採点済 → 25d gate 待ち
  const gate = detectPhase3SubState(app("c", {
    "pipeline-state.json": {
      ...completedStateBase,
      screens: { step25a_completed_at: "t", step25b: { started_at: "t", completed_at: "t", expected_count: 6, completed_count: 6 }, step25c: { completed_at: "t", score: 91 } },
    },
  }));
  assert.equal(gate.status, STATUS.WAITING_APPROVAL);
  // main 未完 (final_approved 無し) → 行ごと非表示
  assert.equal(detectPhase3SubState(app("d", { "pipeline-state.json": { app_name: "d" } })), null);
  cleanup();
});

test("Phase 6: mini-retro pending run を delta / req_delta 横断で数える", () => {
  const { app, cleanup } = makeRepo();
  const ctx = app("proj", {
    "pipeline-state.json": {
      ...completedStateBase,
      delta: { runs: [
        { run_id: "d1", change_description: "c", initiated_at: "t", figma_approved_at: "t", mini_retro_completed_at: "t" },
        { run_id: "d2", change_description: "c", initiated_at: "t", figma_approved_at: "t" },
      ] },
      req_delta: { runs: [{ run_id: "q1", change_description: "c", initiated_at: "t", revisions_approved_at: "t" }] },
    },
  });
  const p6 = detectPhase6(ctx);
  assert.equal(p6.status, STATUS.NOT_STARTED);
  assert.match(p6.detail, /2 run\(s\) pending mini-retro \(1 delta \+ 1 req_delta\)/);
  cleanup();
});

// ── recommendNextAction: optional 行の扱い ───────────────────
test("recommendNextAction: optional の not_started は推奨から除外、active (着手済) は resume 推奨する", () => {
  const { app, cleanup } = makeRepo();
  // 25a 未決 (optional not_started) は飛ばして次の非 optional not_started を推奨する
  const undecided = detectPhase3SubState(app("a", { "pipeline-state.json": completedStateBase }));
  assert.equal(undecided.status, STATUS.NOT_STARTED);
  const retroRow = { phase: "4", label: "Retro (26)", command: "/ayatori-retro", status: STATUS.NOT_STARTED };
  assert.equal(recommendNextAction([undecided, retroRow]).command, "/ayatori-retro");
  // 25b 中断 (optional in_progress) = user が 25a proceed 選択済みの中断 run → resume を推奨する
  const interrupted = detectPhase3SubState(app("b", {
    "pipeline-state.json": {
      ...completedStateBase,
      screens: { step25a_completed_at: "t", step25b: { started_at: "t", expected_count: 6, completed_count: 2 } },
    },
  }));
  assert.equal(interrupted.status, STATUS.IN_PROGRESS);
  assert.equal(recommendNextAction([interrupted, retroRow]).command, "/ayatori-screens");
  cleanup();
});

// ── Phase 1d / buildStatus E2E ───────────────────────────────
test("Phase 1d: change-manifest.json source == skill-01b のときのみ行を出す", () => {
  const { app, cleanup } = makeRepo();
  assert.equal(detectPhase1d(app("a", {})), null);
  assert.equal(detectPhase1d(app("b", {
    "req-delta/change-manifest.json": { run_id: "r1", change_type: "spec_change", change_description: "c" },
  })), null);
  const p1d = detectPhase1d(app("c", {
    "req-delta/change-manifest.json": { run_id: "r1", source: "skill-01b", change_description: "c" },
  }));
  assert.equal(p1d.status, STATUS.COMPLETE);
  assert.match(p1d.detail, /run r1/);
  cleanup();
});

test("buildStatus E2E: 新規プロジェクトは /ayatori-question を、全完了プロジェクトは null を推奨する", () => {
  const { repoRoot, artifactsRoot, app, cleanup } = makeRepo();
  app("fresh", { "feedback-log.md": "# log" });
  app("finished", {
    "pipeline-state.json": {
      ...completedStateBase,
      app_name: "finished",
      approvals: { ...completedStateBase.approvals, retro_completed_at: "t" },
      screens: { step24_completed_at: "t", step25_completed_at: "t", state_pattern_skipped: true },
    },
    "requirements/00-raw-input.md": "# raw",
    "screens/00-screen-list.md": "# 画面一覧",
    "screens/01-home.md": "# ホーム",
    "design-brief.yaml": "schema: draft:v1",
    "tokens.json": { color: {} },
    "scores.json": { app_name: "finished", current: { attempt: 1, total: 95, ai_improvable_deductions: 0 } },
  });
  const result = buildStatus(repoRoot);
  assert.equal(result.error, undefined);
  const byName = Object.fromEntries(result.projects.map((p) => [p.app_name, p]));
  assert.equal(byName.fresh.next_action.command, "/ayatori-question");
  assert.equal(byName.finished.next_action, null); // all complete (sub-state は user skip)
  // 存在しないプロジェクト指定はエラー
  assert.match(buildStatus(repoRoot, ["nope"]).error, /project not found/);
  cleanup();
});

// ── detectPhase4: 実出力形式 "## Run: {app} — Phase 4 Retro" の検出 ──────────
test("Phase 4: 実出力形式「## Run: {app} — Phase 4 Retro」から retro 完了を検出する", () => {
  const { artifactsRoot, app, cleanup } = makeRepo();
  writeFileSync(join(artifactsRoot, "pipeline-improvements.md"), [
    "# ACAD Pipeline Improvements",
    "",
    "## Run: proj — Phase 4 Retro (2026-06-25)",
    "",
    "**Approved at**: 2026-06-25",
  ].join("\n"), "utf8");
  const ctx = app("proj", { "pipeline-state.json": completedStateBase });
  assert.equal(detectPhase4(ctx, artifactsRoot).status, STATUS.COMPLETE);
  // 部分一致で誤検出しない: "proj" 行があっても "proj-two" は not_started
  const other = app("proj-two", { "pipeline-state.json": { ...completedStateBase, app_name: "proj-two" } });
  assert.equal(detectPhase4(other, artifactsRoot).status, STATUS.NOT_STARTED);
  cleanup();
});

// ── dispatcher: 完走後の未反映手編集を screen-edit delta へ誘導 ───────────────
test("dispatcher: 完走後に未消費の手編集があれば /ayatori-delta を推奨、消費済なら推奨しない", () => {
  const { repoRoot, app, cleanup } = makeRepo();
  const doneFiles = (entries) => ({
    "pipeline-state.json": {
      ...completedStateBase,
      approvals: { ...completedStateBase.approvals, retro_completed_at: "t" },
      screens: { step24_completed_at: "t", step25_completed_at: "t", state_pattern_skipped: true },
    },
    "requirements/00-raw-input.md": "# raw",
    "screens/00-screen-list.md": "# 画面一覧",
    "screens/01-home.md": "# ホーム",
    "design-brief.yaml": "schema: draft:v1",
    "tokens.json": { color: {} },
    "scores.json": { current: { attempt: 1, total: 95, ai_improvable_deductions: 0 } },
    "delta/edited-screens.json": { app_name: "x", entries },
  });
  // 未消費 1 件 → screen-edit delta を推奨
  app("edited", doneFiles([
    { screen: "01-home", platform: "web", path: "screens/web/01-home.html", edited_at: "t", tool: "Edit", consumed_by_run: null },
    { screen: "01-home", platform: "mobile", path: "screens/mobile/01-home.html", edited_at: "t", tool: "Edit", consumed_by_run: "r1" },
  ]));
  const edited = buildStatus(repoRoot, ["edited"]).projects[0];
  assert.equal(edited.pending_screen_edits, 1);
  assert.equal(edited.next_action.command, "/ayatori-delta");
  assert.match(edited.next_action.reason, /手編集/);
  // 全件消費済 → override せず null (完了のまま)
  app("clean", doneFiles([
    { screen: "01-home", platform: "web", path: "screens/web/01-home.html", edited_at: "t", tool: "Edit", consumed_by_run: "r1" },
  ]));
  const clean = buildStatus(repoRoot, ["clean"]).projects[0];
  assert.equal(clean.pending_screen_edits, 0);
  assert.equal(clean.next_action, null);
  cleanup();
});

// ── reverse 基線 (screens-lite ルート) の表示 ─────────────────
// 基線印だけがある (final_approved 系は未 set) プロジェクトは、画面 HTML を作らない経路で
// 完結しているため Phase 3 を「基線確立済み」で complete 表示し、retro (基線例外の対象外) を
// 推奨せず /ayatori-add-feature 系へ誘導する。
const baselineFiles = (name, via, extra = {}) => ({
  "requirements.json": { app_name: name, status: "REVERSE_ENGINEERED" },
  "reverse-engineered/raw-analysis.md": "# raw",
  "requirements/01-overview.md": "# 01",
  "tokens.json": { color: {} },
  "design-brief.yaml": "schema: final:v1",
  "screens/00-screen-list.md": "# 画面一覧",
  "screens/00-transition-map.mmd": "flowchart TD",
  "screens/01-home.md": "# ホーム",
  "pipeline-state.json": {
    app_name: name,
    approvals: {
      step07_approved_at: "2026-08-01T11:00:00+09:00",
      step07_approved_via: "reverse-review-gate",
      step13_approved_at: "2026-08-02T11:00:00+09:00",
      step16_approved_at: "2026-08-03T11:00:00+09:00",
      baseline_approved_at: "2026-08-04T11:00:00+09:00",
      ...(via ? { baseline_approved_via: via } : {}),
      ...extra,
    },
  },
});

test("Phase 3: reverse 基線 (screens-lite) 完結は complete + 由来併記、retro は推奨対象外", () => {
  const { repoRoot, app, cleanup } = makeRepo();
  const ctx = app("baseline", baselineFiles("baseline", "screens-lite-gate"));
  const p3 = detectPhase3Main(ctx, T);
  assert.equal(p3.status, STATUS.COMPLETE);
  assert.equal(p3.baseline_only, true);
  assert.match(p3.detail, /基線確立済み \(screens-lite/);
  assert.match(p3.detail, /screens-lite ゲート/);
  assert.match(p3.detail, /画面 HTML は未生成/);
  // sub-state 行は出さない (final_approved 系が未 set のため)
  assert.equal(detectPhase3SubState(ctx), null);
  // retro は基線例外を accept しない → 行は残すが optional で推奨対象外
  const p4 = detectPhase4(ctx, join(repoRoot, "artifacts"));
  assert.equal(p4.status, STATUS.NOT_STARTED);
  assert.equal(p4.optional, true);
  assert.match(p4.detail, /reverse 基線プロジェクトは対象外/);
  // dispatcher: /ayatori-screens 続行でも /ayatori-retro でもなく機能追加系へ誘導
  const proj = buildStatus(repoRoot, ["baseline"]).projects[0];
  assert.equal(proj.next_action.command, "/ayatori-add-feature");
  assert.match(proj.next_action.reason, /基線確立済み/);
  assert.match(proj.next_action.reason, /\/ayatori-delta/);
  assert.match(proj.next_action.reason, /\/ayatori-req-delta/);
  cleanup();
});

test("Phase 3: baseline_approved_via で由来ラベルを出し分ける (manual-stub / 欠落)", () => {
  const { app, cleanup } = makeRepo();
  const stub = detectPhase3Main(app("stub", baselineFiles("stub", "manual-stub")), T);
  assert.equal(stub.status, STATUS.COMPLETE);
  assert.match(stub.detail, /手動 stub/);
  // via 欠落 (自動押印より前の手作業等) は信頼側に倒さず「記録なし」と明示する
  const noVia = detectPhase3Main(app("no-via", baselineFiles("no-via", null)), T);
  assert.equal(noVia.status, STATUS.COMPLETE);
  assert.match(noVia.detail, /由来記録なし/);
  cleanup();
});

test("Phase 3: 基線印が無い従来経路 / 完走済 + 基線印 併存の表示は変えない", () => {
  const { repoRoot, app, cleanup } = makeRepo();
  // 基線印なし・step16 承認済み・1st save 前 → 従来どおり in_progress (15 待ち)
  const fwdFiles = baselineFiles("fwd", "screens-lite-gate");
  delete fwdFiles["pipeline-state.json"].approvals.baseline_approved_at;
  delete fwdFiles["pipeline-state.json"].approvals.baseline_approved_via;
  const fwd = detectPhase3Main(app("fwd", fwdFiles), T);
  assert.equal(fwd.status, STATUS.IN_PROGRESS);
  assert.match(fwd.detail, /awaiting 1st Confluence save \(15\)/);
  assert.equal(fwd.baseline_only, undefined);
  const fwdProj = buildStatus(repoRoot, ["fwd"]).projects[0];
  assert.equal(fwdProj.next_action.command, "/ayatori-screens");
  // 基線印 + final_approved 併存 (基線で始め後からフル実行した) → 基線分岐に入らず通常判定
  const bothFiles = baselineFiles("both", "screens-lite-gate", { screens_human_approved: true, final_approved: true });
  bothFiles["pipeline-state.json"].confluence = { design: { save_count: 2, save_status: "success" } };
  bothFiles["scores.json"] = { current: { attempt: 1, total: 95, ai_improvable_deductions: 0 } };
  const both = detectPhase3Main(app("both", bothFiles), T);
  assert.equal(both.baseline_only, undefined);
  assert.match(both.detail ?? "", /Figma export: skipped \(stub\)|design system update|component build/);
  cleanup();
});

test("Phase 3: 由来検査 — forward プロジェクト (status 不在) の手動基線印は基線扱いしない", () => {
  const { repoRoot, app, cleanup } = makeRepo();
  const files = baselineFiles("fwd-stub", "manual-stub");
  // reverse 由来ではないプロジェクト = requirements.json.status なし + reverse-engineered/ なし。
  // 基線印だけを手動 stub で立てても Entry Guard は入場を拒否するため、complete 表示と
  // /ayatori-add-feature 推奨 (必ず弾かれる先) を出してはいけない。
  delete files["requirements.json"].status;
  delete files["reverse-engineered/raw-analysis.md"];
  delete files["pipeline-state.json"].approvals.step07_approved_via;
  const ctx = app("fwd-stub", files);
  const p3 = detectPhase3Main(ctx, T);
  assert.equal(p3.baseline_only, undefined);
  assert.equal(p3.status, STATUS.IN_PROGRESS);
  assert.match(p3.detail, /awaiting 1st Confluence save \(15\)/);
  // retro 行も基線例外扱いにしない (未完走の通常メッセージ)
  const p4 = detectPhase4(ctx, join(repoRoot, "artifacts"));
  assert.equal(p4.optional, undefined);
  assert.match(p4.detail, /Phase 3 未完了/);
  const proj = buildStatus(repoRoot, ["fwd-stub"]).projects[0];
  assert.equal(proj.next_action.command, "/ayatori-screens");
  cleanup();
});

test("Phase 3: 基線印のあと Route B で画面 HTML を作り始めた進行状態は基線扱いしない", () => {
  const { repoRoot, app, cleanup } = makeRepo();
  const files = baselineFiles("route-b", "screens-lite-gate");
  files["screens/mobile/01-home.html"] = "<html><body>home</body></html>";
  const ctx = app("route-b", files);
  const p3 = detectPhase3Main(ctx, T);
  assert.equal(p3.baseline_only, undefined);
  assert.equal(p3.status, STATUS.IN_PROGRESS);
  assert.match(p3.detail, /awaiting 1st Confluence save \(15\)/);
  // 続行の案内が消えない
  const proj = buildStatus(repoRoot, ["route-b"]).projects[0];
  assert.equal(proj.next_action.command, "/ayatori-screens");
  // screens/ 直下と _shared/ の HTML は screens-lite ルートの正当な生成物 — 画面 HTML と数えない
  const liteFiles = baselineFiles("lite-html", "screens-lite-gate");
  liteFiles["screens/00-transition-map.html"] = "<html><body>map</body></html>";
  liteFiles["screens/_shared/components.html"] = "<html><body>components</body></html>";
  const lite = detectPhase3Main(app("lite-html", liteFiles), T);
  assert.equal(lite.status, STATUS.COMPLETE);
  assert.equal(lite.baseline_only, true);
  cleanup();
});
