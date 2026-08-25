#!/usr/bin/env node
// Step 21a (graphic-recommend) の Step 1 — 前提 assert + 画面インベントリの決定的抽出。
//
// usage: node extract-inventory.mjs <app_name>
//
// stdout に JSON を 1 個出力する:
//   - 前提 NG:  { ok: false, code: "E_*", message } — SKILL.md の routing 表で分岐する
//   - 前提 OK:  { ok: true, inventory, category_sources, ... } — Step 2 (推奨生成) の入力
// exit code は常に 0 (routing は JSON の code で行う)。予期しない内部エラーのみ exit 1
// (SKILL.md 側で「抽出スクリプトが非 0 exit → ②' 全体を degrade skip」に routing — 設計 §8-4 fail-open)。
//
// 抽出は決定的 (LLM 不要・node stdlib のみ = Operating Principle 1 準拠)。SVG ブロック列挙
// (入れ子対応) + 形状署名 (path d / points / 幾何属性のハッシュ) による正典照合は
// scripts/lint-screen-colors.mjs の svgBlocks / svgSignature と同方式
// (I-5 プロトタイプの本実装化)。
// SVG 走査の実装は render-recommend-html.mjs と共有するため svg-scan.mjs に集約している
// (lint 側との同期規約もそちらのヘッダ参照)。
// 確実性の根拠は Step 17 の生成規約 (正典アイコンの verbatim インライン + WCAG マークアップ) —
// 「アイコン / コア UI 可視化 / 装飾」が属性だけで機械判別できる (調査レポート §3-2)。
// AYATORI_REPO_ROOT env で repo root を差し替え可能 (回帰テスト用 fixture 差し込み口)。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, resolveMainScreens } from "./preflight.mjs";
import { svgBlocks, svgSignature, parseAttrs, openTagOf, lineOf, loadCanonSigs, enclosingStack, cssPxFor } from "./svg-scan.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

// pictographic 範囲の粗い emoji 検出 (emoji_casual policy の検出用)。
// U+1F1E6-1F1FF (Regional Indicator = 国旗 emoji の構成要素) を含め、逆に UI 文中に頻出する
// 記号 (★U+2605 / ☆U+2606 / ✓U+2713 / ✔U+2714 / ✕U+2715 / ✗U+2717 / ✘U+2718) は除外する
// (「絵文字あり」の誤検出で illustration_policy 不整合を虚報しない — subagent review m-3)。
// なお本検出は粗い heuristic であり、レポートでの扱いは refs/report-guide.md §4 の注記に従う。
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{2604}\u{2607}-\u{2712}\u{2716}\u{2719}-\u{27BF}]/u;

function scanFile(body, file, iconSigs, illustSigs) {
  const rec = {
    file,
    icons: [],
    meaningful_visuals: [],
    unmatched_svgs: [],
    illust_placeholders: [],
    raster_imgs: [],
    emoji_in_markup: false,
  };
  // アイコン用途分類 (①機能 / ②グラフィック代替候補、refs/report-guide.md §8) の文脈特徴量用:
  // 同一ファイル <style> の CSS を表示 px 推定 (cssPxFor) の材料として先に取り出す
  const styleText = [...body.matchAll(/<style[\s\S]*?<\/style>/gi)].map((m) => m[0]).join("\n");
  const blocks = [...svgBlocks(body)];
  for (const { start, html } of blocks) {
    const sig = svgSignature(html);
    const line = lineOf(body, start);
    const a = parseAttrs(openTagOf(html));
    const ariaLabel = a["aria-label"];
    const role = a["role"];
    const viewBox = a["viewbox"]; // parseAttrs は属性名を lowercase 化する
    const hidden = a["aria-hidden"] === "true";
    let area = null;
    if (viewBox) {
      const p = viewBox.trim().split(/\s+/).map(Number);
      if (p.length === 4) area = p[2] * p[3];
    }
    if (sig && iconSigs.has(sig)) {
      const stack = enclosingStack(body, start);
      const parent = stack[stack.length - 1] ?? null;
      const svgClass = a["class"] ?? null;
      rec.icons.push({
        name: iconSigs.get(sig),
        line,
        parent_class: parent?.cls ?? null,
        svg_class: svgClass,
        px: cssPxFor(styleText, [...(svgClass ?? "").split(/\s+/), ...(parent?.cls ?? "").split(/\s+/)]),
        in_nav: stack.some((t) => t.tag === "nav"),
        in_control: stack.some((t) => t.tag === "a" || t.tag === "button"),
      });
    } else if (sig && illustSigs.has(sig)) {
      rec.meaningful_visuals.push({ kind: "illustration_canon", name: illustSigs.get(sig), line, aria_label: ariaLabel ?? null });
    } else if (role === "img" || (ariaLabel && !hidden)) {
      // データ駆動の可視化等「意味を持つ視覚要素」= コア UI。グラフィック候補から除外する (ガードレール)
      rec.meaningful_visuals.push({ kind: "custom_svg_visual", line, aria_label: ariaLabel ?? null, viewBox: viewBox ?? null, viewbox_area: area });
    } else {
      rec.unmatched_svgs.push({ sig, line, viewBox: viewBox ?? null, decorative: hidden });
    }
  }
  // svg 以外の要素の role="img" (例: <div role="img"> のデータ可視化) もガードレール対象として
  // 検出する — svg ブロックのみの走査では取りこぼす (my-green-step 実測の Pattern C 対応)。
  // svg ブロック内部の要素は上の走査で扱い済みのため offset 範囲で除外する
  const svgRanges = blocks.map((b) => [b.start, b.start + b.html.length]);
  const reTag = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let tm;
  while ((tm = reTag.exec(body)) !== null) {
    const tag = tm[1].toLowerCase();
    if (tag === "svg" || svgRanges.some(([s, e]) => tm.index >= s && tm.index < e)) continue;
    const ta = parseAttrs(tm[2]);
    if (ta["role"] !== "img") continue;
    // illust-placeholder は下の rePl 走査 (§4 候補直取り) の territory — role="img" 付きの非正典
    // マークアップでも二重計上しない (§4 候補 vs §5 ガードレールの自己矛盾防止。判定は rePl と
    // 同じ class 部分文字列口径)
    if ((ta["class"] ?? "").includes("illust-placeholder")) continue;
    rec.meaningful_visuals.push({
      kind: "custom_dom_visual",
      tag,
      line: lineOf(body, tm.index),
      aria_label: ta["aria-label"] ?? null,
      class: ta["class"] ?? null,
    });
  }
  let m;
  // illustration_character policy の候補箇所は HTML に既にマーキング済み (data-scene 直取り — LLM 裁量ゼロ)
  const rePl = /<div[^>]*class=["'][^"']*illust-placeholder[^"']*["'][^>]*>/gi;
  while ((m = rePl.exec(body)) !== null) rec.illust_placeholders.push({ line: lineOf(body, m.index), scene: parseAttrs(m[0])["data-scene"] ?? null });
  const reImg = /<img\b[^>]*>/gi;
  while ((m = reImg.exec(body)) !== null) {
    const ia = parseAttrs(m[0]);
    rec.raster_imgs.push({ line: lineOf(body, m.index), src: (ia["src"] || "").slice(0, 60), alt: ia["alt"] ?? null });
  }
  const textish = body.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  rec.emoji_in_markup = EMOJI_RE.test(textish);
  return rec;
}

try {
  const appName = process.argv[2];
  if (!appName) {
    out({ ok: false, code: "E_USAGE", message: "usage: node extract-inventory.mjs <app_name>" });
  }

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, scope } = pre;

  // ── main 画面の解決 (dual_theme の theme variant は同一 stem に合算、sub-state は除外) ──
  const { stems, files } = resolveMainScreens(appRoot);
  const totalScreens = Object.values(stems).reduce((n, arr) => n + arr.length, 0);
  if (totalScreens === 0) {
    // 設計 §8-4 degrade: screens HTML 0 件 → SKILL.md が「②' 全体を skip (fail-open)」に routing する
    out({ ok: false, code: "E_NO_SCREENS", message: "screens/{web,web-sm,mobile}/ に main HTML が 0 件 — 分析対象なし (degrade routing 用)" });
  }

  // ── 正典署名の読込 (アイコン / イラスト) ──
  const iconSigs = loadCanonSigs(path.join(appRoot, "icons"));
  const illustSigs = loadCanonSigs(path.join(appRoot, "screens", "_shared", "illustrations"));

  // ── 走査 (論理 stem 単位。dual_theme は両 theme ファイルを per_file に併記) ──
  const platforms = {};
  for (const [platform, map] of Object.entries(files)) {
    const screens = [];
    for (const stem of stems[platform] ?? []) {
      const perFile = (map[stem] ?? []).sort().map((name) => {
        const body = fs.readFileSync(path.join(appRoot, "screens", platform, name), "utf8");
        return scanFile(body, name, iconSigs, illustSigs);
      });
      // anchor `icon:{name}[:{nth}]` (視覚レポート、refs/report-guide.md §7) の nth 基準と揃える:
      // 代表ファイル (dual_theme は --light、単一テーマはその 1 件) 内の文書順出現数を数える
      const rep = perFile.find((r) => r.file.includes("--light.")) ?? perFile[0];
      const iconOccurrences = {};
      for (const i of rep?.icons ?? []) iconOccurrences[i.name] = (iconOccurrences[i.name] ?? 0) + 1;
      // アイコン用途分類 (guide §8) 用の文脈特徴量: siblings = 同一 parent_class の出現数
      // (≥3 でコンテンツサムネイル列の signal — 06-actions のようなリスト先頭アイコン群)
      const byParentClass = {};
      for (const i of rep?.icons ?? []) if (i.parent_class) byParentClass[i.parent_class] = (byParentClass[i.parent_class] ?? 0) + 1;
      const iconContexts = (rep?.icons ?? []).map((i) => ({ ...i, siblings: i.parent_class ? byParentClass[i.parent_class] : 1 }));
      screens.push({
        screen: stem,
        files: perFile.map((r) => r.file),
        icons_used: [...new Set(perFile.flatMap((r) => r.icons.map((i) => i.name)))].sort(),
        icon_occurrences: iconOccurrences,
        icon_contexts: iconContexts,
        meaningful_visuals: perFile.flatMap((r) => r.meaningful_visuals.map((v) => ({ ...v, file: r.file }))),
        unmatched_svgs: perFile.flatMap((r) => r.unmatched_svgs.map((v) => ({ ...v, file: r.file }))),
        illust_placeholders: perFile.flatMap((r) => r.illust_placeholders.map((v) => ({ ...v, file: r.file }))),
        raster_imgs: perFile.flatMap((r) => r.raster_imgs.map((v) => ({ ...v, file: r.file }))),
        emoji_in_markup: perFile.some((r) => r.emoji_in_markup),
      });
    }
    if (screens.length) platforms[platform] = screens;
  }

  const all = Object.values(platforms).flat();
  const inventory = {
    icon_canon: [...iconSigs.values()].sort(),
    platforms,
    summary: {
      screens: all.length,
      distinct_icons_used: [...new Set(all.flatMap((s) => s.icons_used))].sort(),
      meaningful_visuals: all.reduce((n, s) => n + s.meaningful_visuals.length, 0),
      unmatched_svgs: all.reduce((n, s) => n + s.unmatched_svgs.length, 0),
      illust_placeholders: all.reduce((n, s) => n + s.illust_placeholders.length, 0),
      raster_imgs: all.reduce((n, s) => n + s.raster_imgs.length, 0),
      screens_with_emoji: all.filter((s) => s.emoji_in_markup).map((s) => s.screen),
    },
  };

  // ── カテゴリ判定材料の所在 (欠損 = inventory-only degrade の signal — 設計 §8-4 / 調査 §7) ──
  const categorySources = {};
  for (const rel of ["requirements/00-raw-input.md", "requirements/01-overview.md"]) {
    categorySources[rel] = fs.existsSync(path.join(appRoot, rel));
  }

  out({
    ok: true,
    app_name: appName,
    illustration_policy: scope.illustration_policy ?? null,
    platform_combo: scope.platform_combo ?? null,
    category_sources: categorySources,
    category_material_available: Object.values(categorySources).some(Boolean),
    inventory,
  });
} catch (e) {
  console.error(`extract-inventory.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
