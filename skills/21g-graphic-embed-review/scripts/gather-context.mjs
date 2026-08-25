#!/usr/bin/env node
// Step 21g (graphic-embed-review) の入力収集 — 前提 assert + 埋め込み対象集合 + 配置素材。
// POCTEAMA-190 (F-7 埋め込み + 承認)
//
// usage:
//   node gather-context.mjs <app_name>                          # 21g 本流 (全対象 slot)
//   node gather-context.mjs <app_name> --delta --screens a,b    # Step 29 (delta 再埋め込み) — 承認済み前提 + 対象画面を絞る
//
// stdout に JSON を 1 個出力する (exit code は常に 0、routing は JSON の code。内部エラーのみ exit 1)。
// LLM の Read 代替として決定的に返せるものだけを返す (context 保護):
//   - slots: 埋め込み対象 (fresh generated_files − excluded_slots — 設計 §9-2b の 21g/29 共通契約。
//     鮮度は 21e (writer) の sourceDigestOf で prompts entry から再導出して比較する)。
//     各 slot に正典実ファイル (canonical)・plan 配置メタ (placements[])・size_px (prompts 確定値 =
//     <img> width/height の基準、C-26)・埋め込み先実ファイル (embed_targets、dual-theme 展開済み)・
//     既埋め込み検出 (already_embedded — 再入/差し戻し後の冪等再実行判定) を併載する。
//   - mode: "re-embed" (既埋め込み <img> が 1 つでもある — 配置起因差し戻し後の再実行等) / "initial"。
// 画面仕様書 (screens/{screen}.md) / main HTML の該当ブロックは挿入位置判断の素材のため LLM が
// 直接 (部分) Read する。本 script は存在 pointer のみ返す。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, findEmbeddedTags, resolveCanonical, resolveMainScreens } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const args = process.argv.slice(2);
  const appName = args[0];
  // 未知 flag は fail-closed (21d commit と同判断 — typo の無言無視は「絞ったつもりが全量」を生む)
  let screensFilter = null;
  let delta = false;
  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--screens" && typeof rest[i + 1] === "string" && !rest[i + 1].startsWith("--")) {
      screensFilter = new Set(rest[i + 1].split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (rest[i] === "--delta") {
      delta = true;
    } else {
      out({
        ok: false,
        code: "E_USAGE",
        unknown_args: [rest[i]],
        message: "usage: node gather-context.mjs <app_name> [--delta] [--screens a,b] — 未知の引数 (typo なら直して再実行)",
      });
    }
  }
  if (!appName) out({ ok: false, code: "E_USAGE", message: "usage: node gather-context.mjs <app_name> [--delta] [--screens a,b]" });
  if (screensFilter && !delta) {
    // --screens は delta (Step 29) 専用 — 本流での誤指定は提示 slot 集合を無言で狭める (embed/commit と同判断)
    out({ ok: false, code: "E_USAGE", message: "--screens は --delta (Step 29) 専用 — 21g 本流は全対象 slot を提示する (何も書き込んでいない)" });
  }

  const pre = assertPreflight(appName, { delta });
  if (pre.error) out(pre.error);
  const { appRoot, graphics, prompts, targetEntries, slotMeta } = pre;

  const warnings = [];
  const { files: mainFiles } = resolveMainScreens(appRoot);
  const promptById = new Map(prompts.prompts.map((p) => [p?.graphic_id, p]));

  // 正典実ファイルの存在照合 (src↔正典 — C-26 / 設計 §7。欠落は埋め込み不能の hard error)
  const canonMissing = [];
  const noMainHtml = [];
  let anyEmbedded = false;

  const slots = targetEntries.map((g) => {
    const canonical = resolveCanonical(appRoot, g);
    if (!canonical) canonMissing.push(g.graphic_id);
    const entry = promptById.get(g.graphic_id);
    const placements = (slotMeta.get(g.graphic_id) ?? []).map((s) => ({
      screen: s.screen,
      platforms: s.platforms,
      placement: s.placement,
      size_role: s.size_role,
      ...(s.rationale ? { rationale: s.rationale } : {}),
      spec_file: fs.existsSync(path.join(appRoot, "screens", `${s.screen}.md`)) ? `screens/${s.screen}.md` : null,
    }));

    // 埋め込み先の実ファイル解決 (dual-theme は --light/--dark の両 main へ展開)
    const embedTargets = [];
    for (const p of placements) {
      if (screensFilter && !screensFilter.has(p.screen)) continue;
      for (const platform of p.platforms ?? []) {
        const names = mainFiles[platform]?.[p.screen];
        if (!names || names.length === 0) {
          // 同一 (id, screen, platform) の重複 push を防ぐ (computeEmbedTargets と同じ dedup)
          if (!noMainHtml.some((c) => c.graphic_id === g.graphic_id && c.screen === p.screen && c.platform === platform)) {
            noMainHtml.push({ graphic_id: g.graphic_id, screen: p.screen, platform });
          }
          continue;
        }
        for (const name of names) {
          const rel = `screens/${platform}/${name}`;
          const html = fs.readFileSync(path.join(appRoot, rel), "utf8");
          const embedded = findEmbeddedTags(html, g.graphic_id).length > 0;
          if (embedded) anyEmbedded = true;
          embedTargets.push({ file: rel, screen: p.screen, platform, already_embedded: embedded });
        }
      }
    }
    return {
      graphic_id: g.graphic_id,
      canonical: canonical ? { file: canonical.rel, basename: path.basename(canonical.rel) } : null,
      size_px: entry?.size_px ?? null,
      transparent_background: entry?.transparent_background === true,
      placements,
      embed_targets: embedTargets,
    };
  });

  if (canonMissing.length) {
    out({
      ok: false,
      code: "E_CANON_MISSING",
      graphic_ids: canonMissing,
      message: `正典 screens/_shared/graphics/ に実ファイルが無い対象 slot: ${canonMissing.join(", ")} — 21f 完了記録と矛盾 (src↔正典の存在照合、設計 §7)。21e/21f の再実行を確認する`,
    });
  }
  if (noMainHtml.length) {
    // 部分欠落も fail-closed (computeEmbedTargets の E_TARGET_FILES_MISSING と同一契約) — 警告で
    // 進めても apply / approve が同 code で止まる dead-end のため、最初の script で止めて誘導する
    out({
      ok: false,
      code: "E_TARGET_FILES_MISSING",
      combos: noMainHtml,
      message: `埋め込み先 main HTML が解決できない (screen, platform) 組: ${noMainHtml.map((c) => `(${c.graphic_id}: ${c.screen}/${c.platform})`).join(", ")} — 21b 確定後に screens/ が変わった可能性 (画面リネームなら plan の再確定、対象から外すなら reject による却下)。書き込みゼロのまま中断`,
    });
  }
  // noSpec は --screens の対象範囲のみ警告する (範囲外の欠落は当該 run の関心外 — Step 29 契約)
  const noSpec = [
    ...new Set(
      slots.flatMap((s) =>
        s.placements.filter((p) => !p.spec_file && (!screensFilter || screensFilter.has(p.screen))).map((p) => p.screen)
      )
    ),
  ];
  if (noSpec.length) {
    warnings.push(
      `画面仕様書が見つからない画面: ${noSpec.join(", ")} (screens/{screen}.md) — 「使用グラフィック」節の追記先が無い (承認 commit が当該画面のみ skip する。要ユーザー告知)`
    );
  }
  // 対象画面フィルタ (--screens) で対象 0 件は正常 (29 の再生成画面にグラフィックが無いケース)
  const effectiveSlots = slots.filter((s) => s.embed_targets.length > 0);
  if (screensFilter && effectiveSlots.length === 0) {
    out({ ok: true, app_name: appName, mode: "initial", slot_count: 0, slots: [], warnings, message: "--screens 指定範囲に埋め込み対象なし" });
  }

  // 差し戻し queue が残ったまま 21g に居るのは routing 不整合 (プロンプト起因差し戻しは
  // prompts_confirmed_at クリア → cascade が 21d へ戻す契約 — 設計 §9-2b)
  const reworkPending = Array.isArray(graphics.rework_pending) ? graphics.rework_pending : [];
  if (reworkPending.length) {
    warnings.push(
      `rework_pending が未消費のまま残っている: ${reworkPending.map((r) => r?.graphic_id ?? "?").join(", ")} — プロンプト起因差し戻しは 21d の再確定が先 (承認 commit は E_REWORK_OPEN で拒否する)`
    );
  }

  out({
    ok: true,
    app_name: appName,
    mode: anyEmbedded ? "re-embed" : "initial",
    slot_count: effectiveSlots.length,
    slots: effectiveSlots,
    excluded_slots: Array.isArray(graphics.excluded_slots) ? graphics.excluded_slots : [],
    rework_pending: reworkPending,
    warnings,
  });
} catch (e) {
  console.error(`gather-context.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
