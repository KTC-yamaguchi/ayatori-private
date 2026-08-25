#!/usr/bin/env node
// scripts/wcag-contrast.mjs
//
// WCAG 2.2 コントラスト比の **決定論的** 計算ユーティリティ。
//
// 背景: 従来 skill 11 (11-wcag-mapping) は `computeContrast(fgHex, bgHex)` を疑似コードで
//   宣言するのみで実装が無く、実行時は LLM が docs/wcag-standards.md §4 の数式を「推算」していた。
//   推算は実行ごとに揺れ、閾値 (4.5 / 3.0) 近傍で偽の violation → 不要な Phase 2 loop を誘発する。
//   本 script は §4 の数式を厳密実装し、計算から方差を排除する (LLM 非依存・100% 再現可能)。
//
// 責務境界:
//   - 本 script が出すのは「数値と pass/fail」まで。
//   - violation オブジェクトへの整形・suggested_correction 文の生成・wcag-history.json への
//     append は skill 11 (LLM) の責務。本 script は何も書き込まない (stdout に JSON を返すのみ)。
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠 — 外部 npm パッケージを増やさない。
//   W3C 公式は 20 行程度なので `wcag-contrast` 等のライブラリは敢えて使わず自前実装する。
//
// 数式の正典: docs/wcag-standards.md §4。検証用既知値は同 §4.4。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ── 数値計算コア (純関数) ────────────────────────────────

/** "#RRGGBB" → { r, g, b } (各 0-255)。書式不正は throw。 */
export function hexToRgb(hex) {
  if (typeof hex !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new Error(`invalid hex: ${JSON.stringify(hex)} (expected "#RRGGBB")`);
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** sRGB チャンネル (0-1 正規化済) → リニア値。docs §4.1。内部関数 (export しない)。 */
function srgbToLinear(c) {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** "#RRGGBB" → 相対輝度 L (0=黒 〜 1=白)。docs §4.2。 */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * 2 色のコントラスト比。docs §4.3。範囲 1 (同色) 〜 21 (純黒×純白)。
 * 小数第 2 位に丸める: 表示値と pass 判定値を一致させ、docs §4.4 の表 (2 桁) とも整合する
 * (WebAIM contrast checker と同じ慣例)。閾値ぎりぎりの色は元々人間ゲートで再確認される領域。
 */
export function contrastRatio(fgHex, bgHex) {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const raw = (lighter + 0.05) / (darker + 0.05);
  return Math.round(raw * 100) / 100;
}

/** ratio >= required を満たすか。round 済 ratio で比較する。 */
export function passes(ratio, required) {
  return ratio >= required;
}

// ── token / state / domain surface の hex lookup ─────────
// design-brief.yaml (schema:draft) の palette 構造に対する決定論 lookup。
// 構造は schemas/design-brief.schema.json を正とする。

/**
 * palette.tokens[] から hex を引く (dual-mode 対応)。
 *   - dual / explicit single: (name, mode) 複合一致を優先
 *   - legacy single (mode field 無し): name 一致の先頭を採用 (mode を跨いで混ぜない)
 * 見つからなければ null。
 */
export function lookupTokenHex(tokens, name, mode) {
  if (!Array.isArray(tokens)) return null;
  const exact = tokens.find((t) => t && t.name === name && t.mode === mode);
  if (exact) return exact.hex;
  const legacy = tokens.find((t) => t && t.name === name && t.mode === undefined);
  return legacy ? legacy.hex : null;
}

/**
 * state_colors.{state}.{role} から hex を引く。
 *   - mode=dark : top-level hex (例 state_colors.error.bg.hex)
 *   - mode=light: light.hex     (例 state_colors.error.bg.light.hex)
 * 該当 state / role / mode の hex が無ければ null (skill 側で skip 記録)。
 */
export function lookupStateHex(stateColors, state, role, mode) {
  // 注意: この dark=top-level / light=nested の非対称は design-brief.schema.json `stateColorValue`
  //   の legacy 形 (dark-only の上に light を後付け) をそのまま写したもの。
  //   domain_surfaces の対称な modes:[{mode,hex}] 形へ schema を正規化すれば本分岐は消せる (upstream マター)。
  const v = stateColors?.[state]?.[role];
  if (!v) return null;
  if (mode === "light") return v.light?.hex ?? null;
  return v.hex ?? null; // dark (= legacy single の SoT)
}

/** domain_surfaces[] の 1 surface から当該 mode の hex を引く。modes[] = [{mode,hex}]。 */
export function lookupDomainSurfaceHex(surface, mode) {
  const m = surface?.modes?.find((x) => x && x.mode === mode);
  return m ? m.hex : null;
}

// ── pair table (機械可読の正典 = 本 script) ─────
// fg/bg token・required・criterion_id の **機械的に load-bearing な列** は本 script が正典。
// skill 11 Phase 5 table / docs/wcag-standards.md §6 の同じ列は本 script に合わせる (逆ではない)。
// それらの prose 表は「根拠」「warn-only」等の人間向け解説を併記するため残すが、
// pair 追加・required 変更時は必ず本配列を先に直し prose 表を追従させること。
// 注意: 現状この 3-way 一致を機械検出する手段は無い (drift は人間レビュー頼み)。
//   将来は docs §6 / skill 表の行を本配列と突合する eval を足すのが望ましい。

/** palette pairs 1-7。loop trigger 対象 (pair_kind: palette)。 */
// token 名は skill 08 が design-brief.yaml に書き出す CSS 変数形 (`--color-*`) に一致させる。
// lookupTokenHex は exact 一致なので、ここが実 brief (artifacts/*/design-brief.yaml) と
// skill 08 template (refs/design-brief-template.md) の name と揃っていないと palette 1-7 が
// 全 skip → 全件偽 violation → loop 誤発火する (レビュー指摘)。
export const PALETTE_PAIRS = [
  { n: 1, fg: "--color-on-surface", bg: "--color-surface", required: 4.5, criterion_id: "1.4.3" },
  { n: 2, fg: "--color-on-surface-variant", bg: "--color-surface", required: 4.5, criterion_id: "1.4.3" },
  { n: 3, fg: "--color-primary", bg: "--color-surface", required: 3, criterion_id: "1.4.11" },
  { n: 4, fg: "--color-on-primary", bg: "--color-primary", required: 4.5, criterion_id: "1.4.3" },
  { n: 5, fg: "--color-focus-ring", bg: "--color-surface", required: 3, criterion_id: "1.4.11" },
  { n: 6, fg: "--color-border", bg: "--color-surface", required: 3, criterion_id: "1.4.11" },
  { n: 7, fg: "--color-on-bg", bg: "--color-bg", required: 4.5, criterion_id: "1.4.3" },
];

/** state_colors pairs 8-15。warn-only (pair_kind: state_colors)。state ごとに optional。 */
export const STATE_PAIRS = [
  { n: 8, state: "error", fg_role: "text", bg_role: "bg", required: 4.5, criterion_id: "1.4.3" },
  { n: 9, state: "error", fg_role: "border", bg_role: "bg", required: 3, criterion_id: "1.4.11" },
  { n: 10, state: "info", fg_role: "text", bg_role: "bg", required: 4.5, criterion_id: "1.4.3" },
  { n: 11, state: "info", fg_role: "border", bg_role: "bg", required: 3, criterion_id: "1.4.11" },
  { n: 12, state: "warning", fg_role: "text", bg_role: "bg", required: 4.5, criterion_id: "1.4.3" },
  { n: 13, state: "warning", fg_role: "border", bg_role: "bg", required: 3, criterion_id: "1.4.11" },
  { n: 14, state: "success", fg_role: "text", bg_role: "bg", required: 4.5, criterion_id: "1.4.3" },
  { n: 15, state: "success", fg_role: "border", bg_role: "bg", required: 3, criterion_id: "1.4.11" },
];

// ── case 単位の評価 ──────────────────────────────────────

/**
 * 1 case (= 1 palette 案) を 1 mode で評価し、全 pair の素の結果を返す。
 * 返り値の各要素: { pair_kind, n, criterion_id, mode, fg_token, bg_token, fg_hex, bg_hex,
 *                   actual_ratio, required_ratio, pass, skipped?, skip_reason? }
 * hex が引けない pair は skipped:true で記録 (空 hex で計算しない)。違反判定・整形は skill 側。
 */
export function evaluateCase(caseObj, mode) {
  const palette = caseObj?.palette ?? {};
  const out = [];

  const evalPair = (base, fgHex, bgHex, fg_token, bg_token) => {
    if (!fgHex || !bgHex) {
      // lookup* は欠落時 null を返す (undefined を返さない) ので、ここでは fgHex/bgHex を素通しでよい。
      out.push({
        ...base, mode, fg_token, bg_token,
        fg_hex: fgHex, bg_hex: bgHex,
        actual_ratio: null, required_ratio: base.required_ratio,
        pass: false, skipped: true,
        skip_reason: `hex 欠落 (fg=${fgHex ?? "∅"} / bg=${bgHex ?? "∅"})`,
      });
      return;
    }
    const ratio = contrastRatio(fgHex, bgHex);
    out.push({
      ...base, mode, fg_token, bg_token, fg_hex: fgHex, bg_hex: bgHex,
      actual_ratio: ratio, required_ratio: base.required_ratio,
      pass: passes(ratio, base.required_ratio),
    });
  };

  // palette pairs 1-7
  for (const p of PALETTE_PAIRS) {
    const fgHex = lookupTokenHex(palette.tokens, p.fg, mode);
    const bgHex = lookupTokenHex(palette.tokens, p.bg, mode);
    evalPair(
      { pair_kind: "palette", n: p.n, criterion_id: p.criterion_id, required_ratio: p.required },
      fgHex, bgHex, p.fg, p.bg,
    );
  }

  // state_colors pairs 8-15 (state 未定義は skip。legacy: state_colors 自体が無ければ全 skip)
  const sc = palette.state_colors;
  if (sc) {
    for (const p of STATE_PAIRS) {
      if (!sc[p.state]) continue; // optional な state は登録しない
      const fgHex = lookupStateHex(sc, p.state, p.fg_role, mode);
      const bgHex = lookupStateHex(sc, p.state, p.bg_role, mode);
      evalPair(
        { pair_kind: "state_colors", n: p.n, criterion_id: p.criterion_id, required_ratio: p.required },
        fgHex, bgHex, `state_colors.${p.state}.${p.fg_role}`, `state_colors.${p.state}.${p.bg_role}`,
      );
    }
  }

  // domain_surface pairs (NFR 由来、数は動的)。loop trigger 対象。
  for (const surface of palette.domain_surfaces ?? []) {
    for (const pair of surface.contrast_pairs ?? []) {
      const fgHex = lookupTokenHex(palette.tokens, pair.fg, mode);
      const bgHex = lookupDomainSurfaceHex(surface, mode);
      evalPair(
        { pair_kind: "domain_surface", n: null, criterion_id: pair.criterion ?? "1.4.11", required_ratio: pair.required_ratio },
        fgHex, bgHex, pair.fg, surface.name,
      );
    }
  }

  return out;
}

// ── CLI ──────────────────────────────────────────────────
// 入力は design-brief の **JSON** 表現 (YAML ではない — Node 標準に YAML parser が無く、
//   OP-1 上 parser を増やせないため。yaml→json 変換は呼び出し側 skill の責務)。
//   { cases: [ { candidate_id?, palette: { tokens, state_colors?, domain_surfaces? } } ] }
// usage: node scripts/wcag-contrast.mjs <brief.json> [--modes dark,light]
//        cat brief.json | node scripts/wcag-contrast.mjs --modes dark
// 出力: { cases: [ { candidate_id, mode, results: [...] } ] } を stdout に。

function isMain() {
  // process.argv[1] は CLI で渡されたパスがそのまま入るため相対パスのことがある
  // (例: `node scripts/wcag-contrast.mjs`)。素朴に `file://${argv[1]}` と比較すると
  // import.meta.url (常に絶対 file URL) と一致せず main() が走らない。
  // pathToFileURL で cwd 基準の絶対 file URL に正規化してから比較する。
  // argv[1] は `node -e` / REPL から import された場合 undefined になり pathToFileURL が
  // throw するため先にガードする (oklch-color.mjs がライブラリとして import する際の要件)。
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function readInput(fileArg) {
  if (fileArg) {
    return readFileSync(fileArg, "utf8");
  }
  // stdin
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const argv = process.argv.slice(2);
  const modesIdx = argv.indexOf("--modes");
  let modes = ["dark"];
  if (modesIdx >= 0) {
    // --modes の直後に値が必要。末尾 / 次トークンが別フラグ (--xxx) だと値欠落。
    // 素朴に argv[modesIdx + 1].split() すると undefined.split で生スタックトレースになるため
    // 明示エラーで exit する。値は空要素を除去して組み立てる。
    const modesVal = argv[modesIdx + 1];
    if (modesVal === undefined || modesVal.startsWith("--")) {
      process.stderr.write(
        `[wcag-contrast] --modes には値が必要です (例: --modes dark,light)\n`,
      );
      process.exit(1);
    }
    modes = modesVal.split(",").map((s) => s.trim()).filter(Boolean);
    if (modes.length === 0) {
      process.stderr.write(
        `[wcag-contrast] --modes の値が空です (例: --modes dark,light)\n`,
      );
      process.exit(1);
    }
  }
  // 位置引数 (brief.json) を index で拾う: --modes の値は modesIdx+1 に居るので除外する
  // (値で比較すると "dark" という名前のファイルを取りこぼすため index で判定する)。
  // --modes 省略時は modesIdx === -1 なので除外 index を無効値 (-1) に倒す。
  // (素直に modesIdx + 1 すると 0 になり、第 1 位置引数のファイル名を誤って除外してしまう)
  const modesValIdx = modesIdx >= 0 ? modesIdx + 1 : -1;
  const fileArg = argv.find((a, i) => !a.startsWith("--") && i !== modesValIdx);

  const raw = await readInput(fileArg);
  let brief;
  try {
    brief = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`[wcag-contrast] 入力が JSON として parse できません: ${e.message}\n`);
    process.exit(1);
  }

  const cases = Array.isArray(brief?.cases) ? brief.cases : [];
  const result = { cases: [] };
  cases.forEach((c, i) => {
    const candidate_id = c.candidate_id ?? c.id ?? `case${i}`;
    for (const mode of modes) {
      result.cases.push({ candidate_id, mode, results: evaluateCase(c, mode) });
    }
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (isMain()) {
  main().catch((e) => {
    process.stderr.write(`[wcag-contrast] ${e.stack || e.message}\n`);
    process.exit(1);
  });
}
