#!/usr/bin/env node
// Step 21a (graphic-recommend) の完了 commit — pipeline-state への完了記録の決定的部分。
//
// usage:
//   node commit-completed.mjs <app_name>                      # 通常完了 (graphics/graphic-recommend.md の存在を assert)
//   node commit-completed.mjs <app_name> --degraded "<reason>" # fail-open 完了 (レポートなし — 設計 §8-4 degrade)
//
// 書き込みは pipeline-state.json の screens.graphics.step21a_completed_at のみ (key 分離 —
// decision / decided_by は 21b・orchestrator の territory)。degrade (fail-open) 完了でも
// 記録される — 21b preflight の起動前提 (E_21A_NOT_DONE) がこのキーを読むため
// (schemas/pipeline-state.schema.json の step21a_completed_at 記述)。
//
// stdout に JSON を 1 個出力する:
//   - 前提 NG: { ok: false, code: "E_*", message } — extract-inventory.mjs と同一の E_* code
//   - 成功:    { ok: true, step21a_completed_at, mode: "report" | "degraded" }
// exit code は常に 0 (routing は JSON の code)。予期しない内部エラーのみ exit 1。
// AYATORI_REPO_ROOT env で repo root を差し替え可能 (回帰テスト用)。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, atomicWriteFileSync, isoNow } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const args = process.argv.slice(2);
  const appName = args[0];
  const degraded = args.includes("--degraded");
  const degradeReason = degraded ? (args[args.indexOf("--degraded") + 1] ?? "") : null;
  if (!appName || (degraded && !degradeReason)) {
    out({ ok: false, code: "E_USAGE", message: 'usage: node commit-completed.mjs <app_name> [--degraded "<reason>"]' });
  }

  // ── 前提の再 assert (extract 後の生成中に state が変わっていないかの防御。extract と同一 code) ──
  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, state } = pre;

  // ── 通常完了はレポートの存在を assert (レポート未 Write のまま完了記録だけ立つ事故を防ぐ) ──
  const reportRel = "graphics/graphic-recommend.md";
  const reportExists = fs.existsSync(path.join(appRoot, reportRel));
  if (!degraded && !reportExists) {
    out({
      ok: false,
      code: "E_REPORT_MISSING",
      message: `${reportRel} が存在しません — 先にレポートを Write するか、fail-open 完了なら --degraded "<reason>" を付けて実行する`,
    });
  }

  // ── pipeline-state merge write (preflight が parse 済みの state に merge → Write back) ──
  // disk の再 read はしない — 万一 2 回目の read が失敗すると stub fallback が approvals を含む
  // 全 state を上書きする破壊経路になる。preflight 通過 = state は必ず存在し parse 済み。
  const statePath = path.join(appRoot, "pipeline-state.json");
  const s = state;
  if (!s.app_name) s.app_name = appName; // 必須 field の保全 assert (docs/artifact-file-responsibility.md 設計原則 4)
  s.screens ??= {};
  const completedAt = isoNow();
  s.screens.graphics = { ...(s.screens.graphics ?? {}), step21a_completed_at: completedAt };
  atomicWriteFileSync(statePath, JSON.stringify(s, null, 2) + "\n");

  out({
    ok: true,
    step21a_completed_at: completedAt,
    mode: degraded ? "degraded" : "report",
    ...(degraded ? { degrade_reason: degradeReason } : { report: reportRel }),
    next: "Step 21b (graphic-hearing) へ" + (degraded ? " — レポートなし (mode=plain) のユーザー完全判断で進む" : ""),
  });
} catch (e) {
  console.error(`commit-completed.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
