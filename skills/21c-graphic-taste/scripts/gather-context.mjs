#!/usr/bin/env node
// Step 21c (graphic-taste) の入力収集 — 前提 assert + slot 要約 + palette ヒント導出 + sample cache 状態。
// F-3 テイスト選定
//
// usage: node gather-context.mjs <app_name>
//
// stdout に JSON を 1 個出力する (exit code は常に 0、routing は JSON の code。内部エラーのみ exit 1)。
// LLM の Read 代替として決定的に返せるものだけを返す (context 保護):
//   - slots 要約 + 代表 slot (お題設定の起点。hero > content > small の優先で先頭のもの)
//   - palette_hints: tokens.json の color token から決定的に導出した「HEX (token path)」文字列
//     ((C) DERIVED — 導出元 token 名併記、設計 §6 の逆方向調和)。役割名 (primary/accent 等) を優先。
//   - api_available: 生成 API キーの有無 (Step 3 の前に degrade 判断材料を出す)
//   - samples: 既存 sample cache の状態 (再入時の再利用判断 — 生成は低速・有料のため)
// design-brief.yaml は判断素材 (ヒアリング raw / avoid_styles) のため LLM が直接 Read する
// (YAML parser 依存を持たない — Operating Principle 1)。本 script は存在 pointer のみ返す。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, readJson, resolveApiKey } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** tokens.json ($type: "color" の W3C design tokens 形式) から palette ヒントを導出する。 */
function derivePaletteHints(tokens) {
  const found = [];
  const walk = (node, trail) => {
    if (!node || typeof node !== "object") return;
    if (node.$type === "color" && typeof node.$value === "string" && HEX_RE.test(node.$value)) {
      found.push({ path: trail.join("."), hex: node.$value.toUpperCase() });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$")) continue;
      walk(v, [...trail, k]);
    }
  };
  walk(tokens?.global ?? {}, ["global"]); // primitives 層のみ (semantic/component は global の参照で色の重複になる)

  // 役割名の優先順で並べ替え (プロンプトのカラーヒントに使う代表色を先頭に)
  const ROLE_PRIORITY = ["primary", "secondary", "accent", "cta", "brand", "bg", "surface", "on-surface"];
  const rank = (p) => {
    const leaf = p.split(".").pop();
    const i = ROLE_PRIORITY.findIndex((r) => leaf === r || leaf.startsWith(`${r}-`));
    return i === -1 ? ROLE_PRIORITY.length : i;
  };
  found.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  return found.slice(0, 8).map((t) => `${t.hex} (${t.path})`);
}

/** tokens.json のどこかに HEX 文字列があるか (W3C 形式に限らない)。導出 0 件のとき「color token
 *  自体が無い」のか「旧形式 (primitive.colors.*.value 等) で読めないだけ」なのかを切り分ける
 *  (PR #169 レビュー指摘 — 後者を「見つからず」と誤診しない)。 */
function containsHexAnywhere(node) {
  if (typeof node === "string") return HEX_RE.test(node);
  if (!node || typeof node !== "object") return false;
  return Object.values(node).some(containsHexAnywhere);
}

const SIZE_ROLE_PRIORITY = { hero: 0, content: 1, small: 2 };

try {
  const appName = process.argv[2];
  if (!appName) out({ ok: false, code: "E_USAGE", message: "usage: node gather-context.mjs <app_name>" });

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, plan } = pre;

  const warnings = [];

  // palette ヒント ((C) DERIVED)。tokens.json は Phase 2 承認済みなら必ず存在するはずだが、
  // 欠けていても 21c 自体は成立する (palette_hints は schema 上 optional) ため fail-open + 明示 warning。
  const tokens = readJson(path.join(appRoot, "tokens.json"));
  const paletteHints = tokens ? derivePaletteHints(tokens) : [];
  if (!tokens) warnings.push("tokens.json が読めません — palette_hints なしで進む (プロンプトのカラーヒント省略、要ユーザー告知)");
  else if (paletteHints.length === 0) {
    warnings.push(
      containsHexAnywhere(tokens)
        ? "tokens.json の形式が想定 (W3C $type/$value) と異なるため palette_hints を導出できません — 色定義自体は存在するとみられる。palette_hints はユーザーが手渡しでも確定可能 (要ユーザー告知)"
        : "tokens.json に color token が見つからず palette_hints を導出できませんでした — palette_hints はユーザーが手渡しでも確定可能 (要ユーザー告知)"
    );
  }

  const designBrief = fs.existsSync(path.join(appRoot, "design-brief.yaml")) ? "design-brief.yaml" : null;
  if (!designBrief) warnings.push("design-brief.yaml が不在 — ヒアリング raw (avoid_styles 等) を参照できない。requirements/01-overview.md のみで候補語を出す (要ユーザー告知)");

  // 代表 slot: size_role 優先 (hero > content > small)、同順位は plan の並び順
  const slots = plan.slots.map((s) => ({
    graphic_id: s.graphic_id,
    screen: s.screen,
    platforms: s.platforms,
    placement: s.placement,
    size_role: s.size_role,
  }));
  const representative = [...slots].sort(
    (a, b) => (SIZE_ROLE_PRIORITY[a.size_role] ?? 9) - (SIZE_ROLE_PRIORITY[b.size_role] ?? 9)
  )[0];

  // 既存 sample cache (中断→再入で生成済み画像を再利用する — 低速・有料)。
  // manifest entry ∪ ディスク実在 taste-{a,b,c}.png の和集合で列挙する (either/or にしない):
  //   - source="manifest": digest cache あり。subject / style_block を併載する — 再入時はこれを
  //     **逐語**再利用しないと digest 不一致で全量再課金になる (SKILL Step 2 の再入契約)
  //   - source="disk": manifest に entry が無いが実在するファイル = 手動生成 degrade (guide §7) の
  //     配置分。失敗 run も manifest を書くため「manifest 不在のときだけ disk を見る」形だと
  //     E_GENERATION_FAILED 経由の手動配置が再入時に不可視になる (external review 指摘 3)
  const manifest = readJson(path.join(appRoot, "graphics", "samples", "samples-manifest.json"));
  const byId = new Map(
    (manifest?.variants ?? [])
      .filter((v) => v?.id && v?.file && fs.existsSync(path.join(appRoot, v.file)))
      .map((v) => [v.id, { id: v.id, label: v.label ?? null, file: v.file, style_block: v.style_block ?? null, source: "manifest" }])
  );
  for (const id of ["A", "B", "C"]) {
    if (byId.has(id)) continue;
    const file = `graphics/samples/taste-${id.toLowerCase()}.png`;
    if (fs.existsSync(path.join(appRoot, file))) byId.set(id, { id, label: null, file, style_block: null, source: "disk" });
  }
  const cachedVariants = ["A", "B", "C"].map((id) => byId.get(id)).filter(Boolean);

  out({
    ok: true,
    app_name: appName,
    slot_count: slots.length,
    slots,
    representative_slot: representative,
    palette_hints: paletteHints,
    design_brief: designBrief,
    api_available: Boolean(resolveApiKey()),
    samples: {
      manifest: manifest ? "graphics/samples/samples-manifest.json" : null,
      cached_variants: cachedVariants,
      level1_words: manifest?.level1_words ?? null,
      subject: manifest?.subject ?? null, // 再入時の逐語再利用用 (style_block は cached_variants 側)
    },
    warnings,
  });
} catch (e) {
  console.error(`gather-context.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
