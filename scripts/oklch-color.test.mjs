#!/usr/bin/env node
// scripts/oklch-color.test.mjs
//
// scripts/oklch-color.mjs の単体テスト。
// 実行: node --test scripts/oklch-color.test.mjs (npm test で自動 discovery)
//
// テスト方針 (wcag-contrast.test.mjs と同じ):
//   - hard ground truth (純黒/純白) は厳密比較
//   - 外部参考値 (CSS Color 4 の純 RGB サンプル) は許容差付き比較 — **行列転記ミスの検出線**。
//     往復変換テストは自己整合しか検出できないため、外部値との突合が必須。
//   - solve の実データケース (ShinMemo / OhiruMeshi / 純赤) は probe で確定した決定論値を pin
//
// CLI 統合 (argv/stdin/exit code/stdout shape) は skills/08-design-brainstorm/evals/ の
// golden eval が担当する。ここは内部関数の白箱検証のみ。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hexToOklch,
  oklchToHex,
  roundedOklchForHex,
  isInSrgbGamut,
  gamutMapChromaReduction,
  roundOklch,
  solveLForTarget,
  solvePair,
  collectPaletteEntries,
  lintBrief,
} from "./oklch-color.mjs";
import { hexToRgb } from "./wcag-contrast.mjs";

const approx = (actual, expected, tol, label) => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: ${actual} は ${expected}±${tol} に収まるべき`,
  );
};

// ── 変換: hard ground truth ──────────────────────────────

test("hexToOklch: 純黒は厳密に {0,0,0}", () => {
  const k = hexToOklch("#000000");
  assert.equal(k.l, 0);
  assert.equal(k.c, 0);
  assert.equal(k.h, 0);
});

test("hexToOklch: 純白は l≈1・c≈0 (丸め後 {1,0,0})", () => {
  const w = hexToOklch("#FFFFFF");
  approx(w.l, 1, 1e-6, "white l");
  assert.ok(w.c < 1e-6, `white c は微小のはず: ${w.c}`);
  assert.deepEqual(roundOklch(w), { l: 1, c: 0, h: 0 });
});

// ── 変換: 外部参考値との突合 (CSS Color 4 spec の純 RGB サンプル) ──
// 行列定数の転記ミスはここで落ちる。参考値: oklch(0.627955 0.257683 29.2339) 等。

test("hexToOklch: 純赤/緑/青が CSS Color 4 参考値と一致", () => {
  const red = hexToOklch("#FF0000");
  approx(red.l, 0.627955, 0.001, "red l");
  approx(red.c, 0.257683, 0.001, "red c");
  approx(red.h, 29.2339, 0.1, "red h");

  const green = hexToOklch("#00FF00");
  approx(green.l, 0.86644, 0.001, "green l");
  approx(green.c, 0.294827, 0.001, "green c");
  approx(green.h, 142.4953, 0.1, "green h");

  const blue = hexToOklch("#0000FF");
  approx(blue.l, 0.452014, 0.001, "blue l");
  approx(blue.c, 0.313214, 0.001, "blue c");
  approx(blue.h, 264.052, 0.1, "blue h");
});

// ── 変換: 往復一致 ───────────────────────────────────────

test("往復変換: web-safe 216 色が hex→oklch→hex で厳密一致", () => {
  const steps = [0x00, 0x33, 0x66, 0x99, 0xcc, 0xff];
  for (const r of steps) {
    for (const g of steps) {
      for (const b of steps) {
        const hex =
          "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
        const back = oklchToHex(hexToOklch(hex));
        assert.equal(back.hex, hex, `roundtrip: ${hex}`);
        assert.equal(back.in_gamut, true, `roundtrip in_gamut: ${hex}`);
      }
    }
  }
});

// ── 変換: 実データ (レビュー実測の再現) ──────────────────

test("実データ: IdeaLoom primary の記録 oklch は記録 hex と整合 (整合例)", () => {
  // artifacts/IdeaLoom/design-brief.yaml:135-139
  const out = oklchToHex({ l: 0.542, c: 0.113, h: 236 });
  assert.equal(out.in_gamut, true);
  assert.equal(out.hex, "#0E78A8"); // 記録 hex と一致 (probe で確定)
});

test("実データ: StudyLoop primary の記録 oklch は色域外かつ記録 hex と大幅乖離 (drift 例)", () => {
  // artifacts/StudyLoop/design-brief.yaml:128-132 — 記録 hex #3B5BDB / 記録 oklch {0.50,0.18,253}
  const recorded = { l: 0.5, c: 0.18, h: 253 };
  assert.equal(isInSrgbGamut(recorded), false, "レビュー指摘どおり物理的に不可能な座標");
  const out = oklchToHex(recorded);
  assert.equal(out.in_gamut, false);
  const a = hexToRgb("#3B5BDB");
  const b = hexToRgb(out.hex);
  const maxDelta = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
  assert.ok(maxDelta > 30, `記録 hex とのチャネル差が drift 級のはず: ${maxDelta} (${out.hex})`);
});

// ── gamut ────────────────────────────────────────────────

test("gamut: 色域外座標は chroma reduction で L・H を保存したまま写像される", () => {
  const outOfGamut = { l: 0.5, c: 0.4, h: 30 };
  assert.equal(isInSrgbGamut(outOfGamut), false);
  const mapped = gamutMapChromaReduction(outOfGamut);
  assert.equal(mapped.l, 0.5, "L 固定");
  assert.equal(mapped.h, 30, "H 固定");
  assert.ok(mapped.c < 0.4, "C は削減される");
  assert.equal(isInSrgbGamut(mapped), true, "写像後は gamut 内");

  const converted = oklchToHex(outOfGamut);
  assert.equal(converted.in_gamut, false);
  assert.equal(converted.mapped_oklch.l, 0.5);
  assert.equal(converted.mapped_oklch.h, 30);
});

// ── roundOklch ───────────────────────────────────────────

test("roundOklch: 無彩色は h:0、h=360 は 0 に正規化、-0 を出さない", () => {
  assert.deepEqual(roundOklch({ l: 0.5, c: 0.0004, h: 123.4 }), { l: 0.5, c: 0, h: 0 });
  assert.deepEqual(roundOklch({ l: 0.5, c: 0.1, h: 359.97 }), { l: 0.5, c: 0.1, h: 0 });
  const r = roundOklch({ l: 0.0001, c: 0.0001, h: 0.01 });
  assert.ok(Object.is(r.l, 0) && Object.is(r.c, 0) && Object.is(r.h, 0), "-0 でなく +0");
});

// ── solve: 方向決定 ──────────────────────────────────────

test("solve 方向: 明るい bg → darken / 暗い bg → lighten / 同輝度は 0.1791 で分岐", () => {
  assert.equal(solvePair({ fg_hex: "#777777", bg_hex: "#EEEEEE", required_ratio: 4.5 }).input.direction, "darken");
  assert.equal(solvePair({ fg_hex: "#777777", bg_hex: "#111111", required_ratio: 4.5 }).input.direction, "lighten");
  // 同一色: 中間グレー (輝度 > 0.1791) は darken、暗グレー (輝度 < 0.1791) は lighten
  assert.equal(solvePair({ fg_hex: "#777777", bg_hex: "#777777", required_ratio: 1.5 }).input.direction, "darken");
  assert.equal(solvePair({ fg_hex: "#111111", bg_hex: "#111111", required_ratio: 1.5 }).input.direction, "lighten");
});

// ── solve: 実データケース (probe で確定した決定論値を pin) ──

test("solve ShinMemo (2.99 vs 3.0 の閾値エッジ): 最小補正 dl=-0.009 で target 3.1 達成", () => {
  // artifacts/ShinMemo/wcag-history.json — border 2.99:1 vs 必要 3.0 (0.01 差でループ 1 周浪費した実例)
  const r = solvePair({ fg_hex: "#8C847C", bg_hex: "#EDE7DC", required_ratio: 3.0 });
  assert.equal(r.solved, true);
  assert.equal(r.already_passing, false);
  assert.equal(r.margin_not_met, false);
  assert.equal(r.policy_step, 1);
  assert.equal(r.result.delta.dl, -0.009);
  assert.equal(r.result.delta.dc, 0);
  assert.ok(r.result.achieved_ratio >= 3.1, `target 3.1 以上: ${r.result.achieved_ratio}`);
  // H・C 完全固定 (§5 Step 1)
  assert.equal(r.result.oklch.h, r.input.fg_oklch.h);
  assert.equal(r.result.oklch.c, r.input.fg_oklch.c);
});

test("solve OhiruMeshi: LLM 案 (+0.16 予算超過) に対し予算内 dl=+0.092 の解を発見", () => {
  // artifacts/OhiruMeshi/wcag-history.json — LLM は「L 0.40→0.56 (+0.16)」を提案していた (上限 ±0.15 超過)
  const r = solvePair({ fg_hex: "#4A5E4C", bg_hex: "#232B24", required_ratio: 3.0 });
  assert.equal(r.solved, true);
  assert.equal(r.policy_step, 1);
  assert.equal(r.result.delta.dl, 0.092);
  assert.ok(Math.abs(r.result.delta.dl) <= 0.15, "予算内");
  assert.ok(r.result.achieved_ratio >= 3.1);
});

test("solve Stage 2 到達: 純赤 on 白 (gamut 頂点) は C 削減で解ける", () => {
  // #FF0000 は gamut 頂点のため L を動かすと即座に色域外 → Stage 1 不成立 → Stage 2 (C 削減)
  const r = solvePair({ fg_hex: "#FF0000", bg_hex: "#FFFFFF", required_ratio: 4.5 });
  assert.equal(r.solved, true);
  assert.equal(r.policy_step, 2);
  // dc は「報告 base (roundedOklchForHex) との差」。純赤は素朴丸め c 0.258 が gamut 外のため
  // base.c = 0.257 (in-gamut 表現) → dc -0.019 (探索と補正結果 hex は不変、報告値のみの差)
  assert.equal(r.result.delta.dc, -0.019);
  assert.equal(r.result.delta.dl, -0.037);
  assert.ok(r.result.achieved_ratio >= 4.6);
  assert.equal(r.result.oklch.h, r.input.fg_oklch.h, "H は Stage 2 でも固定");
});

test("solve margin_not_met: target 不達でも予算端で required を満たすなら best-effort で返す", () => {
  const r = solvePair({ fg_hex: "#777777", bg_hex: "#FFFFFF", required_ratio: 4.5, margin: 5 });
  assert.equal(r.solved, true);
  assert.equal(r.margin_not_met, true);
  assert.equal(r.result.delta.dl, -0.15, "予算端まで使う (取れる余裕は全部取る)");
  assert.ok(r.result.achieved_ratio >= 4.5, "required は満たす");
  assert.ok(r.result.summary.includes("安全マージン"), "summary に未達を明記");
});

test("solve 解なし: 近接グレー required 7 は予算内に解なし → Step 4 誘導", () => {
  const r = solvePair({ fg_hex: "#777777", bg_hex: "#888888", required_ratio: 7 });
  assert.equal(r.solved, false);
  assert.equal(r.policy_step, null);
  assert.equal(r.result, null);
  assert.ok(r.reason.includes("Step 4"), `reason に Step 4 誘導: ${r.reason}`);
});

test("solve 冪等: 既に required を満たす pair は色を触らない", () => {
  const r = solvePair({ fg_hex: "#000000", bg_hex: "#FFFFFF", required_ratio: 4.5 });
  assert.equal(r.solved, true);
  assert.equal(r.already_passing, true);
  assert.equal(r.policy_step, 0);
  assert.equal(r.result.hex, "#000000", "hex 無改変");
  assert.deepEqual(r.result.delta, { dl: 0, dc: 0 });
});

test("solve already_passing の self-consistency: 丸めが gamut 外に落ちる hex (#0000FA) でも lint-clean なペアを返す (PR レビュー指摘)", () => {
  // 修正前: result.oklch が素朴な丸め {0.445, 0.309, 264.1} (gamut 外) → lint Δ45 で FAIL し
  // ヘッダ解釈 6「solve の出力は常に lint をパスする」が already_passing 経路だけ破れていた
  const r = solvePair({ fg_hex: "#0000FA", bg_hex: "#FFFFFF", required_ratio: 3.0 });
  assert.equal(r.already_passing, true, "前提: #0000FA on 白 は 3.0 を既に満たす");
  assert.equal(r.result.hex, "#0000FA", "hex 無改変 (冪等は維持)");
  assert.equal(isInSrgbGamut(r.result.oklch), true, "報告 oklch は in-gamut");
  assert.deepEqual(r.result.oklch, roundedOklchForHex("#0000FA"), "解釈 6: convert と同じ丸めを使う");
  const report = lintBrief(
    { cases: [{ candidate_id: "A", palette: { tokens: [{ name: "--x", hex: r.result.hex, oklch: r.result.oklch }] } }] },
    10,
  );
  assert.equal(report.pass, true, "出力ペアは既定 tolerance で lint-clean");
  // input.fg_oklch も同じ座標を報告する (転記されても lint FAIL しない)
  assert.deepEqual(r.input.fg_oklch, r.result.oklch);
});

// ── solve: margin 入力検証 (セルフレビュー指摘: 負値=虚偽合格 / string=文字列連結暴走) ──

test("solve margin 検証: 負値・string・NaN は throw (solved⇒required の不変量を守る)", () => {
  const base = { fg_hex: "#8C847C", bg_hex: "#EDE7DC", required_ratio: 3.0 };
  assert.throws(() => solvePair({ ...base, margin: -0.5 }), /margin/);
  assert.throws(() => solvePair({ ...base, margin: "0.5" }), /margin/);
  assert.throws(() => solvePair({ ...base, margin: NaN }), /margin/);
  assert.equal(solvePair({ ...base, margin: 0 }).solved, true, "margin 0 は合法");
});

// ── convert hex 経路の self-consistency (セルフレビュー指摘: 丸め gamut 落ち → lint deadlock) ──

test("roundedOklchForHex: 丸めで gamut 外に落ちる hex (#0000FA) でも lint-clean なペアを返す", () => {
  // 修正前: roundOklch(hexToOklch("#0000FA")) = {0.445,0.309,264.1} が gamut 外 →
  // lint が chroma reduction 経由で #002DE3 を導出し Δ45 の偽 drift → convert で書き直しても収束しない
  const naive = roundOklch(hexToOklch("#0000FA"));
  assert.equal(isInSrgbGamut(naive), false, "前提: 素朴な丸めは gamut 外 (この hex が修正の動機)");

  const fixed = roundedOklchForHex("#0000FA");
  assert.equal(isInSrgbGamut(fixed), true);
  const report = lintBrief(
    { cases: [{ candidate_id: "A", palette: { tokens: [{ name: "--x", hex: "#0000FA", oklch: fixed }] } }] },
    10,
  );
  assert.equal(report.pass, true, "convert 出力ペアは既定 tolerance で lint-clean");
});

test("roundedOklchForHex: 通常色では素朴な丸めと同値 (fast path)", () => {
  for (const hex of ["#0E78A8", "#8C847C", "#FFFFFF", "#000000", "#808080"]) {
    assert.deepEqual(roundedOklchForHex(hex), roundOklch(hexToOklch(hex)), hex);
  }
});

test("convert self-consistency property: 粗グリッド全色で出力ペアが lint-clean", () => {
  const steps = [0x00, 0x1f, 0x3e, 0x5d, 0x7c, 0x9b, 0xba, 0xd9, 0xf8, 0xff];
  const tokens = [];
  for (const r of steps) for (const g of steps) for (const b of steps) {
    const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    tokens.push({ name: hex, hex, oklch: roundedOklchForHex(hex) });
  }
  const report = lintBrief({ cases: [{ candidate_id: "grid", palette: { tokens } }] }, 10);
  assert.equal(report.summary.drift_count, 0, `drift: ${JSON.stringify(report.cases[0].entries.filter((e) => e.drift).map((e) => e.name))}`);
});

// ── solve: 予算尊重と自己整合の property テスト ──────────

const PROPERTY_PAIRS = [
  { fg_hex: "#8C847C", bg_hex: "#EDE7DC", required_ratio: 3.0 },
  { fg_hex: "#4A5E4C", bg_hex: "#232B24", required_ratio: 3.0 },
  { fg_hex: "#FF0000", bg_hex: "#FFFFFF", required_ratio: 4.5 },
  { fg_hex: "#777777", bg_hex: "#FFFFFF", required_ratio: 4.5, margin: 5 },
  { fg_hex: "#C89020", bg_hex: "#FFFAEE", required_ratio: 3.0 }, // ShinMemo warning.border (warn-only 実例)
  { fg_hex: "#1E0804", bg_hex: "#CC4E1C", required_ratio: 4.5 }, // RamenLog on-primary 実例
];

test("solve property: 全ケースで §5 予算 (|dl|≤0.15, -0.05≤dc≤0) を厳守", () => {
  for (const p of PROPERTY_PAIRS) {
    const r = solvePair(p);
    if (!r.solved || r.already_passing) continue;
    assert.ok(Math.abs(r.result.delta.dl) <= 0.15 + 1e-9, `${p.fg_hex}: dl 予算超過 ${r.result.delta.dl}`);
    assert.ok(r.result.delta.dc <= 0 && r.result.delta.dc >= -0.05 - 1e-9, `${p.fg_hex}: dc 予算超過 ${r.result.delta.dc}`);
  }
});

test("solve property: 出力の oklch と hex は常に self-consistent (lint を通る組)", () => {
  for (const p of PROPERTY_PAIRS) {
    const r = solvePair(p);
    if (!r.solved || r.already_passing) continue;
    const rederived = oklchToHex(r.result.oklch);
    assert.equal(rederived.hex, r.result.hex, `${p.fg_hex}: 丸め済み oklch から hex が再導出できる`);
    assert.equal(rederived.in_gamut, true, `${p.fg_hex}: 出力は gamut 内`);
  }
});

// ── solveLForTarget (H-1 部品としての単体契約) ───────────

test("solveLForTarget: 単体で最小 dl を返す / atEdge で予算端候補を返す", () => {
  const hit = solveLForTarget({ baseL: 0.618, c: 0.015, h: 67.5, dir: -1, bgHex: "#EDE7DC", targetRatio: 3.1 });
  assert.equal(hit.dl, -0.009);
  assert.ok(hit.ratio >= 3.1);

  const edge = solveLForTarget({ baseL: 0.618, c: 0.015, h: 67.5, dir: -1, bgHex: "#EDE7DC", targetRatio: 99, atEdge: true });
  assert.equal(edge.dl, -0.15, "atEdge は予算端の実行可能候補");
});

// ── collectPaletteEntries ────────────────────────────────

test("collectPaletteEntries: tokens / state_colors(+light) / domain_surfaces / illustration の全形状を flat 化", () => {
  const caseObj = {
    candidate_id: "A",
    palette: {
      tokens: [
        { name: "--color-bg", hex: "#111111", oklch: { l: 0.18, c: 0, h: 0 } },
        { name: "--color-bg", mode: "dark", hex: "#111111", oklch: { l: 0.18, c: 0, h: 0 } },
        { name: "--color-bg", mode: "light", hex: "#FFFFFF" }, // oklch 欠落
      ],
      state_colors: {
        error: {
          bg: { hex: "#2C1214", oklch: { l: 0.13, c: 0.05, h: 15 } },
          text: {
            hex: "#FC8080", oklch: { l: 0.67, c: 0.14, h: 20 },
            light: { hex: "#B91C1C", oklch: { l: 0.5, c: 0.19, h: 25 } },
          },
          border: { hex: "#E05454" }, // oklch 欠落
        },
      },
      domain_surfaces: [
        { name: "board", modes: [{ mode: "dark", hex: "#223322", oklch: { l: 0.3, c: 0.03, h: 150 } }] },
      ],
      illustration_colors: [
        { name: "leaf", hex: "#88AA88", oklch: { l: 0.7, c: 0.05, h: 150 } },
        { name: "sky", modes: [{ mode: "dark", hex: "#334455" }] },
      ],
    },
  };
  const entries = collectPaletteEntries(caseObj);
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));

  // tokens 3 + state_colors (bg/text/text.light/border) 4 + domain 1 + illustration (leaf/sky.modes) 2
  assert.equal(entries.length, 10);
  assert.equal(byPath["palette.tokens[0]"].mode, null, "legacy token は mode:null");
  assert.equal(byPath["palette.tokens[1]"].mode, "dark", "(name, mode) 複合キー");
  assert.equal(byPath["palette.state_colors.error.text"].mode, null, "state top-level は mode 情報なし");
  assert.equal(byPath["palette.state_colors.error.text.light"].mode, "light");
  assert.equal(byPath["palette.state_colors.error.text.light"].hex, "#B91C1C");
  assert.equal(byPath["palette.domain_surfaces[0].modes[0]"].name, "domain_surfaces[board]");
  assert.equal(byPath["palette.illustration_colors[0]"].name, "illustration_colors[leaf]");
  assert.equal(byPath["palette.illustration_colors[1].modes[0]"].mode, "dark");
});

// ── lintBrief ────────────────────────────────────────────

/** hex の R チャネルを delta だけずらすヘルパ。 */
function shiftR(hex, delta) {
  const { r, g, b } = hexToRgb(hex);
  const nr = Math.min(255, Math.max(0, r + delta));
  return "#" + [nr, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

test("lintBrief: 閾値境界 — max_channel_delta == tolerance は非 drift、+1 で drift", () => {
  // 整合の取れた基準点: 丸め済み oklch とその導出 hex
  const oklch = roundOklch(hexToOklch("#808080"));
  const derived = oklchToHex(oklch).hex;
  const mkBrief = (hex) => ({
    cases: [{ candidate_id: "A", palette: { tokens: [{ name: "--color-x", hex, oklch }] } }],
  });

  const atTol = lintBrief(mkBrief(shiftR(derived, 10)), 10);
  assert.equal(atTol.summary.drift_count, 0, "== tolerance は許容");
  assert.equal(atTol.pass, true);
  assert.equal(atTol.cases[0].entries[0].max_channel_delta, 10);

  const overTol = lintBrief(mkBrief(shiftR(derived, 11)), 10);
  assert.equal(overTol.summary.drift_count, 1, "tolerance+1 は drift");
  assert.equal(overTol.pass, false);
  assert.equal(overTol.cases[0].entries[0].drift, true);
});

test("lintBrief: oklch 欠落は skip 計上 (drift 扱いしない)、不正エントリは invalid 計上", () => {
  const brief = {
    cases: [
      {
        candidate_id: "A",
        palette: {
          tokens: [
            { name: "--color-a", hex: "#808080" }, // oklch 欠落 → skip
            { name: "--color-b", hex: "not-a-hex", oklch: { l: 0.5, c: 0, h: 0 } }, // hex 不正 → invalid
            { name: "--color-c", hex: "#808080", oklch: { l: 1.5, c: 0, h: 0 } }, // l 範囲外 → invalid
          ],
        },
      },
    ],
  };
  const out = lintBrief(brief, 10);
  assert.equal(out.summary.skipped_no_oklch, 1);
  assert.equal(out.summary.invalid_count, 2);
  assert.equal(out.summary.entries_checked, 0);
  assert.equal(out.pass, false, "invalid があれば FAIL");
  assert.equal(out.cases[0].entries[0].skipped, true);
  assert.equal(out.cases[0].entries[1].invalid, true);
  assert.equal(out.cases[0].entries[2].invalid, true);
});

test("lintBrief: 色域外の記録 oklch は oklch_in_gamut:false を別フラグで報告", () => {
  const brief = {
    cases: [
      {
        candidate_id: "A",
        palette: { tokens: [{ name: "--color-primary", hex: "#3B5BDB", oklch: { l: 0.5, c: 0.18, h: 253 } }] },
      },
    ],
  };
  const out = lintBrief(brief, 10);
  const e = out.cases[0].entries[0];
  assert.equal(e.oklch_in_gamut, false, "StudyLoop 実例: 物理的に不可能な座標");
  assert.equal(e.drift, true);
  assert.ok(e.max_channel_delta > 30);
  assert.equal(out.pass, false);
});
