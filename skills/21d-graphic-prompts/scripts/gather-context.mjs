#!/usr/bin/env node
// Step 21d (graphic-prompts) の入力収集 — 前提 assert + slot×taste の合成素材 + 再入/差し戻し状態。
// F-4 箇所別プロンプト確定
//
// usage: node gather-context.mjs <app_name>
//
// stdout に JSON を 1 個出力する (exit code は常に 0、routing は JSON の code。内部エラーのみ exit 1)。
// LLM の Read 代替として決定的に返せるものだけを返す (context 保護):
//   - slots: プロンプト確定の対象 slot (plan.slots から excluded_slots を除いた集合 — 設計 §9-2b の
//     pending 定義と同じ差集合方式)。各 slot に screens/{screen}.md への pointer (spec_file) と
//     size_role 起点の size_px_hint ((C) DERIVED、実機検証の 3 サイズ) を併載する。
//   - taste: 21c 確定値 (style_directive は全 slot プロンプトへ逐語合成する契約 — schema 参照)。
//   - mode: "rework" (21g 差し戻し — rework_pending あり) / "initial"。
//   - existing_prompts: 残置 graphic-prompts.json の逐語 entry (再入・rework 時の逐語再利用素材 —
//     未改訂 slot の prompt を 1 文字でも言い換えると digest 不一致 = 21e 再課金になる、設計 §9-2b)。
// 画面仕様書 (screens/{screen}.md) / requirements/01-overview.md は判断素材のため LLM が
// 直接 Read する。本 script は存在 pointer のみ返す。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, readJson, resolveMainScreens } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

// size_role → 生成ピクセル数の起点 ((C) DERIVED: 実機検証の 3 サイズ、
// schemas/graphic-plan.schema.json size_role description と同値)。最終値は 21d が
// 埋め込み先レイアウトに合わせて具体化する (guide §2) — ここは初期案の目安。
const SIZE_PX_HINTS = {
  hero: { width: 800, height: 400 },
  content: { width: 320, height: 200 },
  small: { width: 64, height: 64 },
};

try {
  const appName = process.argv[2];
  if (!appName) out({ ok: false, code: "E_USAGE", message: "usage: node gather-context.mjs <app_name>" });

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, graphics, plan, excludedIds } = pre;

  const warnings = [];

  // 対象 slot = plan.slots − excluded_slots (21e 生成失敗 degrade で除外された slot は
  // pending / 埋め込み対象から恒久に外れる — 設計 §9-2b。復活は §5 手動リセットの運用。
  // 全 slot excluded は preflight が E_ALL_SLOTS_EXCLUDED で弾いている)。
  // preview_files は人間ゲート preview 用の実ファイルパス — slot.screen は論理 stem のため
  // dual_theme では suffix なしパスが存在しない (--light/--dark へ解決して返す)
  const { files: mainFiles } = resolveMainScreens(appRoot);
  const excluded = Array.isArray(graphics.excluded_slots) ? graphics.excluded_slots : [];
  const noMainHtml = [];
  const slots = plan.slots
    .filter((s) => !excludedIds.has(s.graphic_id))
    .map((s) => {
      const specFile = `screens/${s.screen}.md`;
      const previewFiles = [];
      for (const p of s.platforms ?? []) {
        const names = mainFiles[p]?.[s.screen];
        if (!names) {
          noMainHtml.push(`${s.screen} (${p})`);
          continue;
        }
        for (const name of names) previewFiles.push(`screens/${p}/${name}`);
      }
      return {
        graphic_id: s.graphic_id,
        screen: s.screen,
        platforms: s.platforms,
        placement: s.placement,
        size_role: s.size_role,
        ...(s.rationale ? { rationale: s.rationale } : {}),
        spec_file: fs.existsSync(path.join(appRoot, specFile)) ? specFile : null,
        preview_files: previewFiles,
        size_px_hint: SIZE_PX_HINTS[s.size_role] ?? null,
      };
    });
  if (noMainHtml.length) {
    warnings.push(
      `main HTML が見つからない slot 対象: ${[...new Set(noMainHtml)].join(", ")} — 21b 確定後に screens/ が変わった可能性 (preview link から欠落する。要ユーザー告知)`
    );
  }
  const noSpec = slots.filter((s) => !s.spec_file).map((s) => s.screen);
  if (noSpec.length) {
    warnings.push(
      `画面仕様書が見つからない画面: ${[...new Set(noSpec)].join(", ")} (screens/{screen}.md) — placement は plan の記述と main HTML で判断する (要ユーザー告知)`
    );
  }

  // 21g 差し戻し (プロンプト起因) の per-slot 指示 queue (writer = orchestrator、設計 §9-2b)
  const reworkPending = Array.isArray(graphics.rework_pending) ? graphics.rework_pending : [];
  const slotIds = new Set(slots.map((s) => s.graphic_id));
  const staleRework = reworkPending.filter((r) => !slotIds.has(r?.graphic_id));
  if (staleRework.length) {
    warnings.push(
      `rework_pending に対象外 slot の entry: ${staleRework.map((r) => r?.graphic_id ?? "?").join(", ")} — plan/excluded と不整合 (要ユーザー確認。commit は対象 slot 分のみ消費する)`
    );
  }

  // 残置 graphic-prompts.json (中断再入 / 21g 差し戻しの逐語再利用素材)。
  // 21d 起動時点で prompts_confirmed_at は未 set (preflight が assert 済み) のため、
  // ファイルが在る = 前回確定後に差し戻された (rework) か、確定直後の中断。entry は逐語で返す。
  const promptsPath = path.join(appRoot, "graphics", "graphic-prompts.json");
  const existing = readJson(promptsPath);
  const existingPrompts = existing
    ? {
        file: "graphics/graphic-prompts.json",
        tool: existing.tool ?? null,
        confirmed_at: existing.confirmed_at ?? null,
        entries: Array.isArray(existing.prompts) ? existing.prompts : [],
      }
    : null;
  if (fs.existsSync(promptsPath) && !existing) {
    warnings.push("graphics/graphic-prompts.json が JSON として読めない (破損?) — 確定 commit 時に _backup/ へ退避して上書きする (要ユーザー告知)");
  }

  out({
    ok: true,
    app_name: appName,
    mode: reworkPending.length ? "rework" : "initial",
    slot_count: slots.length,
    slots,
    taste: {
      level1_words: plan.taste.level1_words,
      level2_choice: plan.taste.level2_choice,
      style_directive: plan.taste.style_directive,
      palette_hints: plan.taste.palette_hints ?? [],
      sample_files: plan.taste.sample_files ?? [], // 人間ゲート preview の提示素材 (SKILL Step 3)。テキスト比較 degrade で確定した taste は []
    },
    rework_pending: reworkPending,
    excluded_slots: excluded,
    existing_prompts: existingPrompts,
    warnings,
  });
} catch (e) {
  console.error(`gather-context.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
