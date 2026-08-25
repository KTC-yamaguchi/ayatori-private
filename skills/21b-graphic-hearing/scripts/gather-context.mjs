#!/usr/bin/env node
// Step 21b (graphic-hearing) preflight — 前提 assert + 入力収集の決定的部分。
//
// usage: node gather-context.mjs <app_name>
//
// stdout に JSON を 1 個出力する:
//   - 前提 NG:  { ok: false, code: "E_*", message } — SKILL.md の routing 表で分岐する
//   - 前提 OK:  { ok: true, mode, screens, placeholder_hits, ... } — ヒアリングの入力コンテキスト
// exit code は常に 0 (routing は JSON の code で行う)。予期しない内部エラーのみ exit 1。
//
// LLM の Read 代替として動く: pipeline-state / requirements の該当キーだけを抽出し、
// screens HTML は全文を返さず illust-placeholder の出現数だけを数える (context 保護)。
// 前提 assert / main 画面 stem 解決 (dual_theme 対応) は preflight.mjs と共有 —
// commit-decision.mjs の再 assert と同一の E_* code を返すことを機械的に保証する。
// AYATORI_REPO_ROOT env で repo root を差し替え可能 (回帰テスト用 fixture 差し込み口)。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, resolveMainScreens } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const appName = process.argv[2];
  if (!appName) {
    out({ ok: false, code: "E_USAGE", message: "usage: node gather-context.mjs <app_name>" });
  }

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, scope } = pre;

  // ── モード判定 (レポート有無、fail-open — 設計 §8-4 degrade) ──
  const recommendRel = "graphics/graphic-recommend.md";
  const mode = fs.existsSync(path.join(appRoot, recommendRel)) ? "report" : "plain";

  // ── main 画面インベントリ (論理 stem、dual_theme / sub-state variant 対応) + placeholder 出現数 ──
  const { stems, files } = resolveMainScreens(appRoot);
  const placeholderHits = {};
  for (const [platform, map] of Object.entries(files)) {
    for (const [stem, names] of Object.entries(map)) {
      let hits = 0;
      for (const name of names) {
        const html = fs.readFileSync(path.join(appRoot, "screens", platform, name), "utf8");
        hits += html.split("illust-placeholder").length - 1;
      }
      if (hits > 0) (placeholderHits[stem] ??= {})[platform] = hits;
    }
  }

  out({
    ok: true,
    app_name: appName,
    mode, // "report" = 推奨レポートあり / "plain" = ユーザー完全判断モード
    recommend_report: mode === "report" ? recommendRel : null,
    platform_combo: scope.platform_combo ?? null,
    illustration_policy: scope.illustration_policy ?? null,
    screens: stems, // platform → main 画面の論理 stem (slot.screen の値域。dual_theme では --light/--dark を剥がした名前)
    placeholder_hits: placeholderHits, // 論理 stem → platform → illust-placeholder 出現数 (theme variant 合算)
  });
} catch (e) {
  console.error(`gather-context.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
