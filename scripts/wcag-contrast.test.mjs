// scripts/wcag-contrast.test.mjs
//
// scripts/wcag-contrast.mjs の単体テスト。Node 標準の node:test + node:assert のみ (依存ゼロ)。
//   実行: node --test scripts/wcag-contrast.test.mjs
//
// テスト方針:
//   - hard ground truth (黒×白=21 / 同色=1) は厳密 === で断言する。これらは浮動小数の
//     境界問題が無い (黒 L=0, 白 L=1 → (1.05)/(0.05)=21 ちょうど)。
//   - docs §4.4 / WebAIM 等の参照値は人手計算の近似なので許容差 (±0.05) で断言する。
//   - lookup の dual-mode / legacy 分岐, state lookup, evaluateCase の分類は構造で検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  passes,
  lookupTokenHex,
  lookupStateHex,
  lookupDomainSurfaceHex,
  evaluateCase,
  PALETTE_PAIRS,
  STATE_PAIRS,
} from "./wcag-contrast.mjs";

// ── hexToRgb: 書式 ──────────────────────────────────────
test("hexToRgb: 正常系", () => {
  assert.deepEqual(hexToRgb("#000000"), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb("#FFFFFF"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("#88aaCC"), { r: 136, g: 170, b: 204 }); // 大小文字混在 OK
});

test("hexToRgb: 不正書式は throw", () => {
  for (const bad of ["888888", "#FFF", "#GGGGGG", "#1234567", "", null, 123, undefined]) {
    assert.throws(() => hexToRgb(bad), /invalid hex/, `should throw for ${JSON.stringify(bad)}`);
  }
});

// ── 相対輝度: 端点 ──────────────────────────────────────
test("relativeLuminance: 黒=0, 白=1", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#FFFFFF"), 1);
});

// ── contrastRatio: hard ground truth (厳密) ─────────────
test("contrastRatio: 純黒×純白 = 21 ちょうど", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
});

test("contrastRatio: 同色 = 1", () => {
  assert.equal(contrastRatio("#345678", "#345678"), 1);
  assert.equal(contrastRatio("#000000", "#000000"), 1);
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF"), 1);
});

test("contrastRatio: fg/bg 入替で対称", () => {
  assert.equal(
    contrastRatio("#E8DCC8", "#141414"),
    contrastRatio("#141414", "#E8DCC8"),
  );
  assert.equal(
    contrastRatio("#C5A33C", "#0C0C0D"),
    contrastRatio("#0C0C0D", "#C5A33C"),
  );
});

// ── contrastRatio: WebAIM 公認の標定値 (ground truth, 厳密) ──
// WebAIM contrast checker が公表し、アクセシビリティ業界で反復検証されている基準灰。
// docs §4.4 (プロジェクト内の手計算表) より信頼できる外部 ground truth として採用する。
test("contrastRatio: WebAIM 標定灰と厳密一致", () => {
  assert.equal(contrastRatio("#767676", "#FFFFFF"), 4.54); // AA 通常テキストを満たす最低灰
  assert.equal(contrastRatio("#777777", "#FFFFFF"), 4.48); // AA に僅かに届かない灰
  assert.equal(contrastRatio("#595959", "#FFFFFF"), 7); // AAA 境界
});

// ── docs §4.4 検証表との突き合わせ (※ docs 側の誤りを固定する回帰テスト) ──
// 本タスクの裏付け: docs/wcag-standards.md §4.4 の記載値は WCAG 厳密式と一致しない行があり、
// 「対比度を手計算/LLM で見積もると揺れる」ことの実例 = 本 script が排除する対象そのもの。
// よって docs の値ではなく厳密計算値を ground truth として固定する。
// docs 側の数値を将来修正した場合も、本テストが厳密値を守るので script が docs の誤りに引きずられない。
test("docs §4.4: row3 は一致 / row1·row2 は docs が不正確 (厳密値で固定)", () => {
  assert.equal(contrastRatio("#888888", "#FFFFFF"), 3.54); // row3: docs と一致
  assert.equal(contrastRatio("#E8DCC8", "#141414"), 13.6); // row1: docs は 14.18 と誤記 (Δ0.58)
  assert.equal(contrastRatio("#C5A33C", "#0C0C0D"), 8.08); // row2: docs は 6.90 と誤記 (Δ1.18 — AAA 判定が覆る)
});

// ── passes: 閾値判定 ────────────────────────────────────
test("passes: 閾値比較", () => {
  assert.equal(passes(4.5, 4.5), true); // ちょうどは合格
  assert.equal(passes(4.49, 4.5), false);
  assert.equal(passes(21, 3), true);
  assert.equal(passes(1, 3), false);
});

// ── lookupTokenHex: dual-mode / legacy ──────────────────
test("lookupTokenHex: dual-mode は (name,mode) で取り違えない", () => {
  const tokens = [
    { name: "--color-surface", hex: "#111111", mode: "dark" },
    { name: "--color-surface", hex: "#EEEEEE", mode: "light" },
    { name: "--color-on-surface", hex: "#FFFFFF", mode: "dark" },
    { name: "--color-on-surface", hex: "#000000", mode: "light" },
  ];
  assert.equal(lookupTokenHex(tokens, "--color-surface", "dark"), "#111111");
  assert.equal(lookupTokenHex(tokens, "--color-surface", "light"), "#EEEEEE");
  assert.equal(lookupTokenHex(tokens, "--color-on-surface", "light"), "#000000");
  assert.equal(lookupTokenHex(tokens, "missing", "dark"), null);
});

test("lookupTokenHex: legacy (mode field 無し) は name で取得", () => {
  const tokens = [
    { name: "--color-surface", hex: "#111111" },
    { name: "--color-on-surface", hex: "#FFFFFF" },
  ];
  // mode を渡しても mode 無しエントリにフォールバックする
  assert.equal(lookupTokenHex(tokens, "--color-surface", "dark"), "#111111");
  assert.equal(lookupTokenHex(tokens, "--color-on-surface", "light"), "#FFFFFF");
});

test("lookupTokenHex: 異常入力で throw せず null", () => {
  assert.equal(lookupTokenHex(null, "x", "dark"), null);
  assert.equal(lookupTokenHex(undefined, "x", "dark"), null);
  assert.equal(lookupTokenHex([], "x", "dark"), null);
});

// ── lookupStateHex: dark=top hex / light=light.hex ──────
test("lookupStateHex: mode による hex 切替", () => {
  const sc = {
    error: {
      bg: { hex: "#3B0D0D", light: { hex: "#FDECEC" } },
      text: { hex: "#FF8A8A", light: { hex: "#B00020" } },
      border: { hex: "#7A1F1F" }, // light 欠落
    },
  };
  assert.equal(lookupStateHex(sc, "error", "bg", "dark"), "#3B0D0D");
  assert.equal(lookupStateHex(sc, "error", "bg", "light"), "#FDECEC");
  assert.equal(lookupStateHex(sc, "error", "text", "light"), "#B00020");
  // light 欠落 → null (skill 側で skip 記録)
  assert.equal(lookupStateHex(sc, "error", "border", "light"), null);
  // 未定義 state / role → null
  assert.equal(lookupStateHex(sc, "success", "bg", "dark"), null);
  assert.equal(lookupStateHex(sc, "error", "outline", "dark"), null);
});

// ── lookupDomainSurfaceHex ──────────────────────────────
test("lookupDomainSurfaceHex: modes[] から当該 mode の hex", () => {
  const surface = {
    name: "board.cell",
    modes: [
      { mode: "dark", hex: "#1A1A1A" },
      { mode: "light", hex: "#F5F5F5" },
    ],
  };
  assert.equal(lookupDomainSurfaceHex(surface, "dark"), "#1A1A1A");
  assert.equal(lookupDomainSurfaceHex(surface, "light"), "#F5F5F5");
  assert.equal(lookupDomainSurfaceHex({ modes: [] }, "dark"), null);
  assert.equal(lookupDomainSurfaceHex({}, "dark"), null);
});

// ── pair table の健全性 ─────────────────────────────────
test("PAIR table: 件数と criterion enum", () => {
  assert.equal(PALETTE_PAIRS.length, 7);
  assert.equal(STATE_PAIRS.length, 8);
  for (const p of [...PALETTE_PAIRS, ...STATE_PAIRS]) {
    assert.ok(["1.4.3", "1.4.11"].includes(p.criterion_id));
    assert.ok([3, 4.5].includes(p.required));
  }
});

// ── evaluateCase: 統合 (構造検証) ───────────────────────
test("evaluateCase: palette pass/fail 分類が正しい", () => {
  const caseObj = {
    candidate_id: "A",
    palette: {
      tokens: [
        // surface=黒, on-surface=白 → pair1 は 21:1 合格
        { name: "--color-surface", hex: "#000000", mode: "dark" },
        { name: "--color-on-surface", hex: "#FFFFFF", mode: "dark" },
        { name: "--color-on-surface-variant", hex: "#FFFFFF", mode: "dark" },
        { name: "--color-primary", hex: "#777777", mode: "dark" }, // primary/surface(黒) → 高 contrast 合格
        { name: "--color-on-primary", hex: "#808080", mode: "dark" }, // on-primary/primary(#777) → 低 contrast 不合格
        { name: "--color-focus-ring", hex: "#FFFFFF", mode: "dark" },
        { name: "--color-border", hex: "#FFFFFF", mode: "dark" },
        { name: "--color-bg", hex: "#000000", mode: "dark" },
        { name: "--color-on-bg", hex: "#FFFFFF", mode: "dark" },
      ],
    },
  };
  const results = evaluateCase(caseObj, "dark");
  // palette pair 7 件すべて出る (state/domain 無し)
  assert.equal(results.length, 7);
  assert.ok(results.every((r) => r.pair_kind === "palette"));

  const pair1 = results.find((r) => r.n === 1);
  assert.equal(pair1.actual_ratio, 21);
  assert.equal(pair1.pass, true);

  // pair4 (on-primary #808080 / primary #777777) は contrast ほぼ 1 → 不合格
  const pair4 = results.find((r) => r.n === 4);
  assert.equal(pair4.pass, false);
  assert.equal(pair4.required_ratio, 4.5);
});

test("evaluateCase: hex 欠落 pair は skipped で記録 (throw しない)", () => {
  const caseObj = {
    palette: {
      tokens: [{ name: "--color-surface", hex: "#000000", mode: "dark" }], // on-surface 等が欠落
    },
  };
  const results = evaluateCase(caseObj, "dark");
  const pair1 = results.find((r) => r.n === 1);
  assert.equal(pair1.skipped, true);
  assert.equal(pair1.actual_ratio, null);
  assert.equal(pair1.pass, false);
  assert.match(pair1.skip_reason, /hex 欠落/);
});

test("evaluateCase: state_colors 未定義 (legacy) でも palette だけ評価し落ちない", () => {
  const caseObj = {
    palette: { tokens: [{ name: "--color-surface", hex: "#000000", mode: "dark" }] },
  };
  const results = evaluateCase(caseObj, "dark");
  // state_colors 由来の結果は 0 件
  assert.equal(results.filter((r) => r.pair_kind === "state_colors").length, 0);
});

test("evaluateCase: state_colors 定義時は該当 state の pair が出る (pair_kind 正しい)", () => {
  const caseObj = {
    palette: {
      tokens: [],
      state_colors: {
        error: { bg: { hex: "#FDECEC" }, text: { hex: "#000000" }, border: { hex: "#B00020" } },
        info: { bg: { hex: "#E8F0FE" }, text: { hex: "#000000" }, border: { hex: "#1A73E8" } },
        // warning / success は未定義 → pair 12-15 は出ない
      },
    },
  };
  const results = evaluateCase(caseObj, "dark");
  const stateResults = results.filter((r) => r.pair_kind === "state_colors");
  assert.equal(stateResults.length, 4); // error(8,9) + info(10,11)
  assert.ok(stateResults.every((r) => r.pair_kind === "state_colors"));
  // error.text(#000) / error.bg(#FDECEC) は高 contrast 合格
  const pair8 = results.find((r) => r.n === 8);
  assert.equal(pair8.pass, true);
});

test("evaluateCase: domain_surface pair が NFR 由来 required で評価される", () => {
  const caseObj = {
    palette: {
      tokens: [{ name: "--color-on-surface", hex: "#FFFFFF", mode: "dark" }],
      domain_surfaces: [
        {
          name: "board.cell",
          modes: [{ mode: "dark", hex: "#000000" }],
          contrast_pairs: [{ fg: "--color-on-surface", required_ratio: 7, criterion: "1.4.11" }],
        },
      ],
    },
  };
  const results = evaluateCase(caseObj, "dark");
  const dom = results.find((r) => r.pair_kind === "domain_surface");
  assert.ok(dom);
  assert.equal(dom.actual_ratio, 21); // 白/黒
  assert.equal(dom.required_ratio, 7);
  assert.equal(dom.pass, true);
});
