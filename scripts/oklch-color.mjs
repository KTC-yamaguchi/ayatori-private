#!/usr/bin/env node
// scripts/oklch-color.mjs
//
// OKLCH ↔ HEX 変換 + WCAG 補正 solver + design-brief hex↔oklch 整合 lint の
// **決定論的** ユーティリティ。
//
// 背景: WCAG コントラストの「計算」は scripts/wcag-contrast.mjs で決定論化済だが、
//   その入力を作る側 — OKLCH→HEX 変換と補正量の算出 — は LLM 暗算のままだった
//   (旧 docs/wcag-standards.md §5.4「生成時は Claude の色空間計算能力に依存」)。
//   実測では 13 プロジェクト中 5 つで design-brief.yaml の記録 oklch と記録 hex が大幅不整合
//   (StudyLoop primary: hex #3B5BDB vs oklch 再変換 #0063B7、チャネル差 59)、LLM 補正案の予算超過
//   (OhiruMeshi: L +0.16 > 上限 ±0.15)、閾値ぎわの暗算ミスによるループ 1 周浪費
//   (ShinMemo: 2.99 vs 3.0) が発生していた。本 script は変換・補正・整合検証の 3 つを
//   決定論実装し、色数値の生成から方差を排除する。
//
// 責務境界:
//   - 本 script が出すのは「数値・hex・転写用 summary 文字列」まで。
//   - design-brief.yaml / wcag-history.json への書き込み・violation 整形は skill 08 / 11 (LLM) の
//     責務。本 script は何も書き込まない (stdout に JSON を返すのみ)。
//   - YAML は読まない (Node 標準に YAML parser が無く OP-1 上増やせない)。yaml→json 変換は
//     呼び出し側 skill の責務 (wcag-contrast.mjs と同じ規約)。
//
// 依存: scripts/wcag-contrast.mjs (contrast 計算の二重実装禁止 — 丸め挙動をパイプラインと一致させる)
//   以外は Node 標準のみ。CLAUDE.md Operating Principle 1 準拠。
//
// 数式の正典:
//   - OKLab ↔ linear sRGB: Björn Ottosson の公表行列 (https://bottosson.github.io/posts/oklab/)。
//     本 script がこの変換の repo 内正典実装 (docs/wcag-standards.md §5.4 が本 script を指す)。
//   - 補正ポリシー: docs/wcag-standards.md §5 (上限 L±0.15 / C−0.05 / H 完全固定)。
//
// ⚠ 線形化は 2 系統が意図的に併存する:
//   - 色変換 (本 script 内): IEC 61966-2-1 標準閾値 0.04045 / 0.0031308 (CSS Color 4 と一致)
//   - コントラスト計算 (wcag-contrast.mjs 内部): WCAG §4 の旧閾値 0.03928
//   8bit 入力では数値差は実質ゼロだが、それぞれの正典 (CSS Color 4 / WCAG 2.2) に忠実であるため
//   共有しない。コントラスト値は必ず import した contrastRatio で計算する。
//
// solve の探索仕様 (案 B' = 最小補正 + 安全マージン。§5 の解釈確定点):
//   1. 目標 ratio = required + margin (デフォルト 0.1)。閾値ちょうどに着地させない
//      (2.99 vs 3.0 型の再発防止)。既に required を満たす pair は触らない (冪等)。
//   2. 方向: fg の L を bg の輝度から離す方向 (§5 Step 1)。同輝度 tie-break は
//      bg 輝度 >= sqrt(1.05*0.05)-0.05 ≈ 0.1791 (暗方向/明方向の理論最大 ratio が等しくなる点) で暗く。
//   3. Stage 1 (L のみ・C/H 固定): dL を 0.001 刻みで 0 から予算 ±0.15 まで線形走査し、
//      「丸め済み oklch から導出した hex」が目標 ratio を満たす最小 |dL| を返す。
//      grid 走査なのは、hex 量子化で ratio が微小に非単調になり得るため (二分探索より頑健。
//      最大 150 候補なのでコストは無視できる)。目標不達でも予算端で required を満たすなら
//      margin_not_met:true でそれを返す (取れる余裕は全部取る)。
//   4. Stage 2 (C 削減): Stage 1 全滅時のみ。dC = -0.01 刻みで -0.05 まで下げ、各 C で
//      Stage 1 の L 走査を再実行 (「C を下げて明度調整の余地を作る」§5 Step 2)。C は減方向のみ。
//   5. gamut 外候補は写像せず不可扱い (写像すると C が予算外に動くため)。L 方向の gamut
//      領域は区間なので、外に出た時点で走査を打ち切る (厳密には GAMUT_EPS 判定が near-black に
//      微小な偽 in-gamut 域を作り得るが、打ち切りが除外するのは真の gamut 外のみ = 安全側)。
//   6. 出力の oklch は丸め済み (l/c 3 桁・h 1 桁)、hex はその丸め済み oklch から導出する。
//      よって solve の出力は常に lint (hex↔oklch 整合) をパスする self-consistent な組。
//      already_passing (hex 無改変で返す) 経路も同じ保証を持つ: 報告する oklch は素朴な丸め
//      ではなく解釈 7 の roundedOklchForHex を使う (素朴な丸めだと #0000FA 級の稀 hex で
//      gamut 外座標を報告してしまい、転記先で lint FAIL する)。
//   7. convert の hex 入力経路も同じ保証を持つ: 丸めで oklch が gamut 外に落ちる稀ケース
//      (全 hex の約 0.07%、例 #0000FA) は C を 0.001 刻みで下げ、「in-gamut かつ再導出 hex が
//      既定 tolerance 内」の丸め済み座標に決定論調整する (放置すると lint が drift 誤検出し、
//      「convert で書き直す」修復が収束しない)。
//
// exit code (⚠ wcag-contrast.mjs の 0/1 とは異なる。lint-design-samples-structure.mjs 系の規約):
//   0 = 成功 (convert / solve。lint は drift ゼロ)
//   1 = lint が drift または invalid エントリを検出 (semantic FAIL)
//   2 = usage エラー / JSON parse エラー / 入力 schema 不正 (エラー時 stdout には何も出さない)
//
// usage:
//   node scripts/oklch-color.mjs convert --hex "#3B5BDB"
//   node scripts/oklch-color.mjs convert --oklch '{"l":0.50,"c":0.18,"h":253}'
//   node scripts/oklch-color.mjs convert batch.json            # { items:[{id?, hex|oklch}] }
//   node scripts/oklch-color.mjs solve --fg "#8C847C" --bg "#EDE7DC" --required 3 [--margin 0.1]
//   node scripts/oklch-color.mjs solve pairs.json              # { pairs:[{id?, fg_hex, bg_hex, required_ratio, margin?}] }
//   node scripts/oklch-color.mjs lint [--tolerance 10] brief.json   # wcag-contrast と同じ brief JSON 形
//   (ファイル引数を省略すると stdin から読む)
//
// out of scope (将来拡張): H-1 forward-solver 化 (全 pair 同時充足でゼロから L を解く)、
//   複数 pair の同時充足、bg 側の調整 (§5 は fg のみ)。solveLForTarget は H-1 の部品として
//   再利用できる形で export してある。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hexToRgb, relativeLuminance, contrastRatio, passes } from "./wcag-contrast.mjs";

// ── 色空間数学コア (純関数) ──────────────────────────────

// Björn Ottosson 公表の標準行列 (row-major flat 配列)。出典: https://bottosson.github.io/posts/oklab/
// 転記ミスは単体テストの外部参考値突合 (CSS Color 4 の純 RGB サンプル) で検出する。
const LSRGB_TO_LMS = [
  0.4122214708, 0.5363325363, 0.0514459929,
  0.2119034982, 0.6806995451, 0.1073969566,
  0.0883024619, 0.2817188376, 0.6299787005,
];
const LMS_TO_OKLAB = [
  0.2104542553, 0.7936177850, -0.0040720468,
  1.9779984951, -2.4285922050, 0.4505937099,
  0.0259040371, 0.7827717662, -0.8086757660,
];
const OKLAB_TO_LMS = [
  1.0, 0.3963377774, 0.2158037573,
  1.0, -0.1055613458, -0.0638541728,
  1.0, -0.0894841775, -1.2914855480,
];
const LMS_TO_LSRGB = [
  4.0767416621, -3.3077115913, 0.2309699292,
  -1.2684380046, 2.6097574011, -0.3413193965,
  -0.0041960863, -0.7034186147, 1.7076147010,
];

function mat3(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** sRGB (0-1) → linear。IEC 61966-2-1 標準閾値 (WCAG 用の 0.03928 とは意図的に別実装)。 */
function srgbToLinearIec(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** linear → sRGB (0-1)。 */
function linearToSrgbIec(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function linearRgbToOklab(rgb) {
  const lms = mat3(LSRGB_TO_LMS, rgb).map(Math.cbrt);
  const [L, a, b] = mat3(LMS_TO_OKLAB, lms);
  return { L, a, b };
}

function oklabToLinearRgb({ L, a, b }) {
  const lms = mat3(OKLAB_TO_LMS, [L, a, b]).map((v) => v * v * v);
  return mat3(LMS_TO_LSRGB, lms);
}

function oklabToOklch({ L, a, b }) {
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToOklab({ l, c, h }) {
  const rad = (h * Math.PI) / 180;
  return { L: l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
}

/** "#RRGGBB" → { l, c, h } (未丸め・フル精度)。書式不正は throw (hexToRgb 由来)。 */
export function hexToOklch(hex) {
  const { r, g, b } = hexToRgb(hex);
  return oklabToOklch(
    linearRgbToOklab([srgbToLinearIec(r / 255), srgbToLinearIec(g / 255), srgbToLinearIec(b / 255)]),
  );
}

const GAMUT_EPS = 1e-6;

/** oklch が sRGB gamut 内か (linear RGB 全チャネルが [-eps, 1+eps])。 */
export function isInSrgbGamut(oklch) {
  const rgb = oklabToLinearRgb(oklchToOklab(oklch));
  return rgb.every((v) => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);
}

/** oklch → "#RRGGBB" (大文字)。gamut 写像はしない (数値ノイズ分のみ clamp)。内部用。 */
function oklchToHexRaw(oklch) {
  const rgb = oklabToLinearRgb(oklchToOklab(oklch));
  const bytes = rgb.map((v) => {
    const s = linearToSrgbIec(Math.min(1, Math.max(0, v)));
    return Math.min(255, Math.max(0, Math.round(s * 255)));
  });
  return "#" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * gamut 外の oklch を L・H 固定のまま C だけ下げて gamut 内へ写像 (chroma reduction)。
 * 単純な RGB clamp は H/L を巻き添えにし §5 の不変量 (H 完全固定・L 優先) を壊すため使わない。
 * 固定 24 回の二分探索 = 決定論。solve の探索では使わない (ヘッダ解釈 5 参照) —
 * convert / lint が「記録済み oklch の解釈」に使うのみ。
 */
export function gamutMapChromaReduction(oklch) {
  const l = Math.min(1, Math.max(0, oklch.l));
  const h = oklch.h;
  let lo = 0;
  let hi = Math.max(0, oklch.c);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (isInSrgbGamut({ l, c: mid, h })) lo = mid;
    else hi = mid;
  }
  return { l, c: lo, h };
}

const round3 = (v) => Math.round(v * 1000) / 1000 + 0; // +0 で -0 を正規化
const round1 = (v) => Math.round(v * 10) / 10 + 0;

/** 表示/記録用の丸め: l/c 3 桁・h 1 桁。無彩色 (c→0) は h:0 (実 design-brief の規約)。 */
export function roundOklch({ l, c, h }) {
  const rl = round3(l);
  const rc = round3(c);
  let rh = round1(h);
  if (rc === 0) rh = 0;
  if (rh === 360) rh = 0;
  return { l: rl, c: rc, h: rh };
}

/**
 * hex → 「lint を必ずパスする丸め済み oklch」(ヘッダ解釈 7)。
 * 通常は roundOklch(hexToOklch(hex)) と同値 (k=0 で即 return)。丸めが gamut 外に落ちる /
 * 再導出 hex が離れる稀ケースのみ C を 0.001 刻みで下げて self-consistent な座標に調整する。
 */
// roundedOklchForHex の摂動候補 (dl 目盛り ∓4 × dh 目盛り ∓3) を摂動コスト順に固定生成。
// gamut cusp 近傍では丸め方向 1〜数目盛りが in-gamut 判定を左右する (yellow cusp = L に敏感、
// blue/cyan cusp = H に敏感: 例 #000582 は h 264.15 → 264.2 で Δ0、#00FFFA は h -0.2 で Δ1)。
// 摂動は量子化グリッド数目盛り (ΔL ≤ 0.004 / ΔH ≤ 0.3°) = 知覚的に同一の表現の選び直しであり、
// solve の「H 完全固定」ポリシーとは別問題 (色相を変えるのではなく記録表現を選ぶ)。
const HEX_ROUNDING_PERTURBATIONS = (() => {
  const list = [];
  for (let dli = -4; dli <= 4; dli++) for (let dhi = -3; dhi <= 3; dhi++) list.push([dli, dhi]);
  list.sort(
    (a, b) =>
      Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])) ||
      Math.abs(a[0]) - Math.abs(b[0]) ||
      a[0] - b[0] ||
      a[1] - b[1],
  );
  return list; // 先頭は [0,0] (素朴な丸め)、以降摂動の小さい順 = 決定論
})();

export function roundedOklchForHex(hex) {
  const cand = roundOklch(hexToOklch(hex));
  const target = hexToRgb(hex);
  let best = null;
  for (let k = 0; k * 0.001 <= cand.c + 1e-9; k++) {
    const c = round3(Math.max(0, cand.c - k * 0.001));
    for (const [dli, dhi] of HEX_ROUNDING_PERTURBATIONS) {
      const l = round3(cand.l + dli * 0.001);
      if (l < 0 || l > 1) continue;
      const adj = { l, c, h: round1((((cand.h + dhi * 0.1) % 360) + 360) % 360) };
      if (!isInSrgbGamut(adj)) continue;
      const d = hexToRgb(oklchToHexRaw(adj));
      const maxDelta = Math.max(Math.abs(target.r - d.r), Math.abs(target.g - d.g), Math.abs(target.b - d.b));
      if (maxDelta <= DEFAULT_TOLERANCE) return adj; // 早期確定: 通常色は k=0 の [0,0] で即 return
      if (!best || maxDelta < best.maxDelta) best = { adj, maxDelta };
    }
  }
  // tolerance 内が見つからない場合も best (in-gamut で最も近い候補) を返す = 出力は常に in-gamut。
  // 素朴な丸め (gamut 外になり得る) へは、近傍全域に in-gamut 候補が皆無の場合のみ落ちる (実質不到達)。
  return best ? best.adj : cand;
}

/**
 * oklch → { hex, in_gamut, mapped_oklch }。
 * gamut 外は chroma reduction で写像した hex を返し in_gamut:false + 写像後座標を報告する。
 */
export function oklchToHex(oklch) {
  if (isInSrgbGamut(oklch)) {
    return { hex: oklchToHexRaw(oklch), in_gamut: true, mapped_oklch: null };
  }
  const mapped = gamutMapChromaReduction(oklch);
  return { hex: oklchToHexRaw(mapped), in_gamut: false, mapped_oklch: roundOklch(mapped) };
}

// ── solve (§5 補正ポリシーの決定論実装) ─────────────────

const L_BUDGET = 0.15; // §5 Step 1: L の累積変化量上限
const C_BUDGET = 0.05; // §5 Step 2: C の累積削減量上限
const C_STEP = 0.01;   // Stage 2 の C 削減刻み
const DEFAULT_MARGIN = 0.1; // 安全マージン (required + margin を目標にする)

// 同輝度 tie-break: 暗方向と明方向の理論最大 ratio が等しくなる WCAG 輝度。
// (Y+0.05)^2 = 1.05*0.05 の解 = sqrt(0.0525) - 0.05。
const TIE_BREAK_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;

/**
 * C・H 固定で、fg の L を dir 方向へ動かして targetRatio を満たす最小 |dL| を探す。
 * H-1 (forward-solver 化) の部品として再利用できるよう export。
 * 候補の oklch は丸め済み・hex はそこから導出 (出力の self-consistency 保証)。
 * 返り値: { dl (符号付き・丸め済み), oklch, hex, ratio } または null (予算内に解なし)。
 * opts.atEdge=true なら「予算内で最も遠い実行可能候補」を返す (margin_not_met fallback 用)。
 */
export function solveLForTarget({ baseL, c, h, dir, bgHex, targetRatio, lBudget = L_BUDGET, atEdge = false }) {
  const maxDl = Math.min(lBudget, dir > 0 ? 1 - baseL : baseL);
  const K = Math.floor(maxDl * 1000 + 1e-9);
  let edge = null;
  for (let k = 1; k <= K; k++) {
    const cand = roundOklch({ l: baseL + dir * (k / 1000), c, h });
    if (cand.l < 0 || cand.l > 1) break;
    if (!isInSrgbGamut(cand)) break; // L 方向の gamut 領域は区間 → 以降も外
    const hex = oklchToHexRaw(cand);
    const ratio = contrastRatio(hex, bgHex);
    const out = { dl: round3(dir * (k / 1000)), oklch: cand, hex, ratio };
    if (!atEdge && passes(ratio, targetRatio)) return out;
    edge = out;
  }
  return atEdge ? edge : null;
}

function fmtDelta(v) {
  return (v > 0 ? "+" : "") + v.toFixed(3);
}

function buildSummary({ baseOklch, result, dc, required }) {
  const parts = [`L ${baseOklch.l}→${result.oklch.l} (${fmtDelta(result.oklch.l - baseOklch.l)})`];
  if (dc !== 0) parts.push(`C ${baseOklch.c}→${result.oklch.c} (${fmtDelta(dc)})`);
  const fixed = dc !== 0 ? "H 固定" : "C・H 固定";
  return `${parts.join("・")}、${fixed} → ${result.ratio}:1 (必要 ${required})`;
}

/**
 * 1 つの違反 pair (fg_hex / bg_hex / required_ratio) に対する §5 補正の決定論解。
 * fg_oklch は受け取らない — SoT は hex (記録 oklch の drift を solve に持ち込まない)。
 */
export function solvePair({ id, fg_hex, bg_hex, required_ratio, margin = DEFAULT_MARGIN }) {
  // margin ≥ 0 が「solved ⇒ required 達成」不変量の前提 (負値だと虚偽の合格を返し、
  // string だと required + margin が文字列連結で暴走する)。API としても機械検証する。
  if (typeof margin !== "number" || !Number.isFinite(margin) || margin < 0) {
    throw new InputError(`margin は 0 以上の数値を指定してください (受領: ${JSON.stringify(margin)})`);
  }
  const initial = contrastRatio(fg_hex, bg_hex);
  const baseFull = hexToOklch(fg_hex);
  // 報告用の base は roundedOklchForHex を使う (解釈 6)。already_passing が (fg_hex, base) を
  // 出力ペアとして返すため、素朴な roundOklch だと稀 hex (#0000FA 等) で gamut 外座標を報告し
  // lint FAIL する。通常色では fast path で roundOklch と同値。探索は baseFull (フル精度) 基準。
  const base = roundedOklchForHex(fg_hex);
  const target = Math.round((required_ratio + margin) * 100) / 100;

  const lumFg = relativeLuminance(fg_hex);
  const lumBg = relativeLuminance(bg_hex);
  let dir;
  if (lumBg > lumFg) dir = -1;
  else if (lumBg < lumFg) dir = +1;
  else dir = lumBg >= TIE_BREAK_LUMINANCE ? -1 : +1;

  const input = {
    ...(id !== undefined ? { id } : {}),
    fg_hex, bg_hex, required_ratio,
    margin, target_ratio: target,
    fg_oklch: base,
    initial_ratio: initial,
    direction: dir < 0 ? "darken" : "lighten",
  };
  const wrap = (fields) => ({ ...(id !== undefined ? { id } : {}), input, ...fields });

  // 冪等: 既に required を満たす色は触らない (margin 未達でも既存の合格色を動かさない)
  if (passes(initial, required_ratio)) {
    return wrap({
      solved: true, already_passing: true, margin_not_met: !passes(initial, target),
      policy_step: 0,
      result: {
        oklch: base, hex: fg_hex.toUpperCase(), achieved_ratio: initial,
        delta: { dl: 0, dc: 0 },
        summary: `補正不要 — ${initial}:1 (必要 ${required_ratio}) を既に満たす`,
      },
      reason: null,
    });
  }

  const finish = (hit, { policyStep, cBase, marginNotMet }) => {
    const dc = round3(hit.oklch.c - base.c);
    return wrap({
      solved: true, already_passing: false, margin_not_met: marginNotMet,
      policy_step: policyStep,
      result: {
        oklch: hit.oklch, hex: hit.hex, achieved_ratio: hit.ratio,
        delta: { dl: round3(hit.oklch.l - base.l), dc },
        summary:
          buildSummary({ baseOklch: base, result: hit, dc, required: required_ratio }) +
          (marginNotMet ? ` ※ 安全マージン (+${margin}) は未達` : ""),
      },
      reason: null,
    });
  };

  // ── Stage 1: L のみ (C・H 固定) ──
  const s1 = solveLForTarget({ baseL: baseFull.l, c: baseFull.c, h: baseFull.h, dir, bgHex: bg_hex, targetRatio: target });
  if (s1) return finish(s1, { policyStep: 1, marginNotMet: false });
  // 目標不達 → 予算端で required を満たすなら margin_not_met で返す (取れる余裕は全部取る)
  const s1edge = solveLForTarget({ baseL: baseFull.l, c: baseFull.c, h: baseFull.h, dir, bgHex: bg_hex, targetRatio: target, atEdge: true });
  if (s1edge && passes(s1edge.ratio, required_ratio)) {
    return finish(s1edge, { policyStep: 1, marginNotMet: true });
  }

  // ── Stage 2: C を -0.01 刻みで削減し、各 C で L を再走査 ──
  let fallback = null; // target 不達だが required 達成の最初の候補
  const seenC = new Set([round3(baseFull.c)]);
  for (let j = 1; j * C_STEP <= C_BUDGET + 1e-9; j++) {
    const c2 = Math.max(0, baseFull.c - j * C_STEP);
    const c2key = round3(c2);
    if (seenC.has(c2key)) continue; // C=0 clamp 等の重複候補を除去 (無彩色では Stage 2 は自然消滅)
    seenC.add(c2key);
    const hit = solveLForTarget({ baseL: baseFull.l, c: c2, h: baseFull.h, dir, bgHex: bg_hex, targetRatio: target });
    if (hit) return finish(hit, { policyStep: 2, marginNotMet: false });
    if (!fallback) {
      const edge = solveLForTarget({ baseL: baseFull.l, c: c2, h: baseFull.h, dir, bgHex: bg_hex, targetRatio: target, atEdge: true });
      if (edge && passes(edge.ratio, required_ratio)) fallback = edge;
    }
  }
  if (fallback) return finish(fallback, { policyStep: 2, marginNotMet: true });

  return wrap({
    solved: false, already_passing: false, margin_not_met: null,
    policy_step: null, result: null,
    reason: `§5 予算内 (L±${L_BUDGET}, C-${C_BUDGET}) に解なし → Step 4 (トークンの用途変更) へ`,
  });
}

// ── lint (design-brief の hex↔oklch 整合検証) ────────────

const DEFAULT_TOLERANCE = 10; // チャネル毎の許容絶対差 (0-255)。8bit 量子化 + 3 桁丸めの誤差を吸収する実測閾値

/**
 * 1 case の palette から { path, name, mode, hex, oklch } の flat リストを作る。
 * 構造の正典は schemas/design-brief.schema.json。dual theme では同名 token が
 * mode:"dark"/"light" で 2 回現れるため (name, mode) が実質キー。
 * state_colors の top-level は mode 情報を持たない (単一テーマなら唯一の値、dual なら dark 系) ため
 * mode:null とし、light sub-block のみ "light" を立てる。
 */
export function collectPaletteEntries(caseObj) {
  const palette = caseObj?.palette ?? {};
  const entries = [];

  (Array.isArray(palette.tokens) ? palette.tokens : []).forEach((t, i) => {
    if (!t || typeof t !== "object") return;
    entries.push({ path: `palette.tokens[${i}]`, name: t.name ?? null, mode: t.mode ?? null, hex: t.hex, oklch: t.oklch });
  });

  const sc = palette.state_colors ?? {};
  for (const state of ["error", "info", "warning", "success"]) {
    const s = sc[state];
    if (!s || typeof s !== "object") continue;
    for (const role of ["bg", "text", "border"]) {
      const v = s[role];
      if (!v || typeof v !== "object") continue;
      entries.push({
        path: `palette.state_colors.${state}.${role}`,
        name: `state_colors.${state}.${role}`, mode: null, hex: v.hex, oklch: v.oklch,
      });
      if (v.light && typeof v.light === "object") {
        entries.push({
          path: `palette.state_colors.${state}.${role}.light`,
          name: `state_colors.${state}.${role}`, mode: "light", hex: v.light.hex, oklch: v.light.oklch,
        });
      }
    }
  }

  (Array.isArray(palette.domain_surfaces) ? palette.domain_surfaces : []).forEach((surf, i) => {
    (Array.isArray(surf?.modes) ? surf.modes : []).forEach((m, j) => {
      if (!m || typeof m !== "object") return;
      entries.push({
        path: `palette.domain_surfaces[${i}].modes[${j}]`,
        name: `domain_surfaces[${surf?.name ?? i}]`, mode: m.mode ?? null, hex: m.hex, oklch: m.oklch,
      });
    });
  });

  (Array.isArray(palette.illustration_colors) ? palette.illustration_colors : []).forEach((ic, i) => {
    if (!ic || typeof ic !== "object") return;
    if (ic.hex !== undefined || ic.oklch !== undefined) {
      entries.push({
        path: `palette.illustration_colors[${i}]`,
        name: `illustration_colors[${ic.name ?? i}]`, mode: null, hex: ic.hex, oklch: ic.oklch,
      });
    }
    (Array.isArray(ic.modes) ? ic.modes : []).forEach((m, j) => {
      if (!m || typeof m !== "object") return;
      entries.push({
        path: `palette.illustration_colors[${i}].modes[${j}]`,
        name: `illustration_colors[${ic.name ?? i}]`, mode: m.mode ?? null, hex: m.hex, oklch: m.oklch,
      });
    });
  });

  return entries;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function validateOklchShape(oklch) {
  if (!oklch || typeof oklch !== "object") return "oklch がオブジェクトでない";
  const { l, c, h } = oklch;
  if (![l, c, h].every((v) => typeof v === "number" && Number.isFinite(v))) return "oklch の l/c/h が有限数でない";
  if (l < 0 || l > 1) return `oklch.l が範囲外 (${l}、期待 0..1)`;
  if (c < 0) return `oklch.c が負 (${c})`;
  return null;
}

/** brief JSON ({cases:[...]}) 全体の hex↔oklch 整合を検証。 */
export function lintBrief(brief, tolerance = DEFAULT_TOLERANCE) {
  const cases = Array.isArray(brief?.cases) ? brief.cases : [];
  const out = { tolerance, pass: true, summary: { entries_checked: 0, drift_count: 0, skipped_no_oklch: 0, invalid_count: 0 }, cases: [] };

  cases.forEach((c, i) => {
    const candidate_id = c?.candidate_id ?? c?.id ?? `case${i}`;
    const caseOut = { candidate_id, entries: [] };
    for (const e of collectPaletteEntries(c)) {
      const base = { path: e.path, name: e.name, mode: e.mode };
      if (e.oklch === undefined || e.oklch === null) {
        out.summary.skipped_no_oklch++;
        caseOut.entries.push({ ...base, skipped: true, skip_reason: "oklch 欠落" });
        continue;
      }
      const hexBad = typeof e.hex !== "string" || !HEX_RE.test(e.hex);
      const oklchBad = validateOklchShape(e.oklch);
      if (hexBad || oklchBad) {
        out.summary.invalid_count++;
        caseOut.entries.push({
          ...base, invalid: true,
          reason: hexBad ? `hex が不正 (${JSON.stringify(e.hex)})` : oklchBad,
        });
        continue;
      }
      const { hex: derived, in_gamut } = oklchToHex(e.oklch);
      const a = hexToRgb(e.hex);
      const b = hexToRgb(derived);
      const channel_delta = { r: Math.abs(a.r - b.r), g: Math.abs(a.g - b.g), b: Math.abs(a.b - b.b) };
      const max_channel_delta = Math.max(channel_delta.r, channel_delta.g, channel_delta.b);
      const drift = max_channel_delta > tolerance;
      out.summary.entries_checked++;
      if (drift) out.summary.drift_count++;
      caseOut.entries.push({
        ...base,
        recorded_hex: e.hex.toUpperCase(), recorded_oklch: e.oklch,
        derived_hex: derived, oklch_in_gamut: in_gamut,
        channel_delta, max_channel_delta, drift,
      });
    }
    out.cases.push(caseOut);
  });

  out.pass = out.summary.drift_count === 0 && out.summary.invalid_count === 0;
  return out;
}

// ── CLI ──────────────────────────────────────────────────

class InputError extends Error {}

function isMain() {
  // wcag-contrast.mjs と同じ理由: argv[1] は相対パスのことがあるため絶対 file URL に正規化して比較
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function readInput(fileArg) {
  if (fileArg) return readFileSync(fileArg, "utf8");
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** argv → { flags, positional }。未知フラグ・値欠落は InputError。 */
function parseArgs(argv, knownFlags) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (!knownFlags.has(a)) throw new InputError(`未知のフラグ: ${a}`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new InputError(`${a} には値が必要です`);
      flags[a] = v;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function parseNumberFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const n = Number(flags[name]);
  if (!Number.isFinite(n)) throw new InputError(`${name} が数値でない: ${flags[name]}`);
  return n;
}

function assertHex(hex, label) {
  if (typeof hex !== "string" || !HEX_RE.test(hex)) {
    throw new InputError(`${label} が不正な hex: ${JSON.stringify(hex)} (期待 "#RRGGBB")`);
  }
  return hex;
}

function assertOklch(oklch, label) {
  const bad = validateOklchShape(oklch);
  if (bad) throw new InputError(`${label}: ${bad}`);
  // h は mod 360 で正規化して受ける
  return { l: oklch.l, c: oklch.c, h: ((oklch.h % 360) + 360) % 360 };
}

function convertItem(item, label) {
  const hasHex = item?.hex !== undefined;
  const hasOklch = item?.oklch !== undefined;
  if (hasHex === hasOklch) {
    throw new InputError(`${label}: hex / oklch のどちらか一方だけを指定してください`);
  }
  const idPart = item.id !== undefined ? { id: item.id } : {};
  if (hasHex) {
    assertHex(item.hex, label);
    return {
      ...idPart, input_kind: "hex",
      hex: item.hex.toUpperCase(),
      oklch: roundedOklchForHex(item.hex), // 解釈 7: 出力ペアは既定 tolerance で lint-clean を保証
      in_gamut: true, mapped_oklch: null,
    };
  }
  const oklch = assertOklch(item.oklch, label);
  const { hex, in_gamut, mapped_oklch } = oklchToHex(oklch);
  return { ...idPart, input_kind: "oklch", hex, oklch: roundOklch(oklch), in_gamut, mapped_oklch };
}

async function cmdConvert(argv) {
  const { flags, positional } = parseArgs(argv, new Set(["--hex", "--oklch"]));
  if (flags["--hex"] !== undefined || flags["--oklch"] !== undefined) {
    let item;
    if (flags["--oklch"] !== undefined) {
      let parsed;
      try {
        parsed = JSON.parse(flags["--oklch"]);
      } catch (e) {
        throw new InputError(`--oklch が JSON として parse できません: ${e.message}`);
      }
      item = { oklch: parsed, ...(flags["--hex"] !== undefined ? { hex: flags["--hex"] } : {}) };
    } else {
      item = { hex: flags["--hex"] };
    }
    return { output: convertItem(item, "--hex/--oklch"), exitCode: 0 };
  }
  const raw = await readInput(positional[0]);
  const input = parseJson(raw);
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items) throw new InputError('convert のバッチ入力は { "items": [ { "hex" | "oklch" } ] } 形');
  return { output: { results: items.map((it, i) => convertItem(it, `items[${i}]`)) }, exitCode: 0 };
}

async function cmdSolve(argv) {
  const { flags, positional } = parseArgs(argv, new Set(["--fg", "--bg", "--required", "--margin"]));
  const single = ["--fg", "--bg", "--required"].filter((f) => flags[f] !== undefined);
  if (single.length > 0) {
    if (single.length < 3) throw new InputError("solve の単発モードは --fg --bg --required の 3 つが必須です");
    const pair = {
      fg_hex: assertHex(flags["--fg"], "--fg"),
      bg_hex: assertHex(flags["--bg"], "--bg"),
      required_ratio: parseNumberFlag(flags, "--required"),
      ...(flags["--margin"] !== undefined ? { margin: parseNumberFlag(flags, "--margin") } : {}),
    };
    if (pair.required_ratio <= 0) throw new InputError("--required は正の数を指定してください");
    return { output: solvePair(pair), exitCode: 0 };
  }
  // バッチモードで --margin を受理すると「渡したつもりで既定 0.1 が走る」silent ignore になる
  // ため fail-loud で拒否する。バッチの margin は JSON 側 (top-level "margin" / pairs[].margin)。
  if (flags["--margin"] !== undefined) {
    throw new InputError(
      'バッチモードでは --margin は使えません。JSON の top-level "margin" または pairs[].margin で指定してください',
    );
  }
  const raw = await readInput(positional[0]);
  const input = parseJson(raw);
  const pairs = Array.isArray(input?.pairs) ? input.pairs : null;
  if (!pairs) throw new InputError('solve のバッチ入力は { "pairs": [ { "fg_hex", "bg_hex", "required_ratio" } ] } 形');
  const defaultMargin = typeof input.margin === "number" ? input.margin : undefined;
  const results = pairs.map((p, i) => {
    assertHex(p?.fg_hex, `pairs[${i}].fg_hex`);
    assertHex(p?.bg_hex, `pairs[${i}].bg_hex`);
    if (typeof p.required_ratio !== "number" || !(p.required_ratio > 0)) {
      throw new InputError(`pairs[${i}].required_ratio が正の数でない`);
    }
    const margin = typeof p.margin === "number" ? p.margin : defaultMargin;
    return solvePair({ ...p, ...(margin !== undefined ? { margin } : {}) });
  });
  return { output: { pairs: results }, exitCode: 0 };
}

async function cmdLint(argv) {
  const { flags, positional } = parseArgs(argv, new Set(["--tolerance"]));
  const tolerance = parseNumberFlag(flags, "--tolerance") ?? DEFAULT_TOLERANCE;
  if (tolerance < 0) throw new InputError("--tolerance は 0 以上を指定してください");
  const raw = await readInput(positional[0]);
  const brief = parseJson(raw);
  const report = lintBrief(brief, tolerance);
  return { output: report, exitCode: report.pass ? 0 : 1 };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new InputError(`入力が JSON として parse できません: ${e.message}`);
  }
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const commands = { convert: cmdConvert, solve: cmdSolve, lint: cmdLint };
  if (!sub || !commands[sub]) {
    throw new InputError(
      `サブコマンドを指定してください: convert | solve | lint (受領: ${JSON.stringify(sub ?? null)})`,
    );
  }
  const { output, exitCode } = await commands[sub](rest);
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  process.exitCode = exitCode;
}

if (isMain()) {
  main().catch((e) => {
    // InputError も予期せぬ例外も exit 2 (エラー時 stdout には何も出さない契約)
    const msg = e instanceof InputError ? e.message : e.stack || e.message;
    process.stderr.write(`[oklch-color] ${msg}\n`);
    process.exit(2);
  });
}
