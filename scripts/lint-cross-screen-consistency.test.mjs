// scripts/lint-cross-screen-consistency.test.mjs
//
// scripts/lint-cross-screen-consistency.mjs の単体テスト。Node 標準の node:test + node:assert
// のみ (依存ゼロ)。fixture は os.tmpdir() 配下に組み立て、repo の artifacts/ を汚さない。
//   実行: node --test scripts/lint-cross-screen-consistency.test.mjs
//
// テスト方針:
//   - parseDerivedName / compareDimension は入出力が閉じた純関数として厳密に断言する。
//   - extractSignatures / buildReport は最小 fixture (共有 CSS + sub-state HTML 群) を実際に
//     組んで end-to-end で断言する。drift の「注入 → 検出」を 4 次元それぞれで確認する。
//   - CLI (--report / --out) は execFileSync で 1 回だけ smoke する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseDerivedName,
  listScreenFiles,
  extractSignatures,
  compareDimension,
  compareGroup,
  buildReport,
} from "./lint-cross-screen-consistency.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "lint-cross-screen-consistency.mjs");

// ───────────────────────────── fixture ヘルパ ─────────────────────────────

// SVG 部品: 形状署名が互いに異なるアイコン 2 種
const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="m4.5 12.75 6 6 9-13.5"/></svg>';
const ICON_REFRESH = '<svg viewBox="0 0 24 24"><path d="M16 9h5V4M3 20v-5h5"/></svg>';
const ILLUST_USERS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>';
const ILLUST_INBOX = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/></svg>';

const SHARED_CSS = `
.btn-primary { font-family: var(--font-base); font-weight: 600; font-size: var(--fs-base); }
.empty-state { display: flex; align-items: center; justify-content: center; text-align: center; }
`;

// 最小 sub-state HTML。opts で drift を注入できる。
function emptyStateHtml({
  title = "screen",
  ctaClass = "btn-primary",
  ctaIcon = ICON_CHECK,
  illust = ILLUST_USERS,
  localStyle = "",
  cta = true,
} = {}) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <title>${title}</title>
  <link rel="stylesheet" href="../_shared/common-styles.css">
  <style>${localStyle}</style>
</head>
<body>
  <div class="empty-state">
    ${illust}
    <div class="empty-title">データがありません</div>
    ${cta ? `<button class="${ctaClass}">${ctaIcon} 追加する</button>` : ""}
  </div>
</body>
</html>`;
}

// {relPath: content} を tmp app root に書き出す
function makeApp(files) {
  const root = mkdtempSync(join(tmpdir(), "xsc-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
  return root;
}

// ───────────────────────────── parseDerivedName ─────────────────────────────

test("parseDerivedName: sub-state / theme / main の判別", () => {
  assert.deepEqual(parseDerivedName("01-login--empty.html"), {
    screen: "01-login",
    state: "empty",
    theme: "default",
  });
  assert.deepEqual(parseDerivedName("01-login--loading--dark.html"), {
    screen: "01-login",
    state: "loading",
    theme: "dark",
  });
  // main (派生 suffix 無し) は対象外
  assert.equal(parseDerivedName("01-login.html"), null);
  // theme 単独派生 ({screen}--dark) は sub-state ではない
  assert.equal(parseDerivedName("01-login--dark.html"), null);
  assert.equal(parseDerivedName("01-login--light.html"), null);
});

test("parseDerivedName: screen 名自体に -- を含む形も分解できる", () => {
  assert.deepEqual(parseDerivedName("a--b--empty.html"), {
    screen: "a--b",
    state: "empty",
    theme: "default",
  });
});

// ───────────────────────────── compareDimension ─────────────────────────────

test("compareDimension: 1 種に収束したら converged", () => {
  const r = compareDimension([
    { file: "a.html", value: "btn-primary" },
    { file: "b.html", value: "btn-primary" },
  ]);
  assert.equal(r.converged, true);
  assert.equal(r.majority, "btn-primary");
  assert.deepEqual(r.minority_files, []);
  assert.equal(r.main_mismatch, false);
});

test("compareDimension: 2 種に割れたら多数派 / 少数派を判定", () => {
  const r = compareDimension([
    { file: "a.html", value: "btn-primary" },
    { file: "b.html", value: "btn-primary" },
    { file: "c.html", value: "primary-action" },
  ]);
  assert.equal(r.converged, false);
  assert.equal(r.majority, "btn-primary");
  assert.deepEqual(r.minority_files, [{ file: "c.html", value: "primary-action" }]);
});

test("compareDimension: 同数 tie は main の値があればそれを多数派に採る", () => {
  const r = compareDimension(
    [
      { file: "a.html", value: "primary-action" },
      { file: "b.html", value: "btn-primary" },
    ],
    "btn-primary"
  );
  assert.equal(r.majority, "btn-primary");
  assert.deepEqual(r.minority_files, [{ file: "a.html", value: "primary-action" }]);
});

test("compareDimension: 収束していても main と食い違えば main_mismatch", () => {
  const r = compareDimension(
    [
      { file: "a.html", value: "primary-action" },
      { file: "b.html", value: "primary-action" },
    ],
    "btn-primary"
  );
  assert.equal(r.converged, true);
  assert.equal(r.main_mismatch, true);
  assert.equal(r.main_value, "btn-primary");
});

test("compareDimension: minority_files は cap (8 件) され総数は minority_total に残る", () => {
  const entries = [
    ...Array.from({ length: 5 }, (_, i) => ({ file: `maj-${i}.html`, value: "btn-primary" })),
    ...Array.from({ length: 10 }, (_, i) => ({ file: `min-${i}.html`, value: `variant-${i}` })),
  ];
  const r = compareDimension(entries);
  assert.equal(r.majority, "btn-primary");
  assert.equal(r.minority_files.length, 8); // CAP_FILES
  assert.equal(r.minority_total, 10);
});

// ───────────────────────────── extractSignatures ─────────────────────────────

test("extractSignatures: 正典 CTA + 共有 CSS の font 解決", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({}),
  });
  try {
    const sig = extractSignatures(join(root, "screens/web/01-a--empty.html"), { state: "empty" });
    assert.equal(sig.cta_class, "btn-primary");
    assert.equal(
      sig.cta_font,
      "font-family=var(--font-base); font-size=var(--fs-base); font-weight=600"
    );
    assert.match(sig.placement, /align-items:center/);
    assert.match(sig.placement, /text-align:center/);
    assert.notEqual(sig.icon_primary_cta, "(none)");
    assert.notEqual(sig.icon_state_illustration, "(none)");
    // CTA 内 icon と state illustration は別 slot に入る
    assert.notEqual(sig.icon_primary_cta, sig.icon_state_illustration);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractSignatures: ランク法 — btn-primary 不在なら primary 含み token に落ちる", () => {
  const root = makeApp({
    "screens/web/01-a--empty.html": emptyStateHtml({ ctaClass: "primary-action fancy" }),
  });
  try {
    const sig = extractSignatures(join(root, "screens/web/01-a--empty.html"), { state: "empty" });
    assert.equal(sig.cta_class, "fancy primary-action"); // class tokens は sorted
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractSignatures: CTA が無いファイルは全 CTA 次元が (none)", () => {
  const root = makeApp({
    "screens/web/01-a--loading.html": emptyStateHtml({ cta: false, illust: "" }),
  });
  try {
    const sig = extractSignatures(join(root, "screens/web/01-a--loading.html"), { state: "loading" });
    assert.equal(sig.cta_class, "(none)");
    assert.equal(sig.cta_font, "(none)");
    assert.equal(sig.icon_primary_cta, "(none)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractSignatures: inline <style> のローカル上書きが共有 CSS に勝つ", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({
      localStyle: ".btn-primary { font-family: var(--font-display); }",
    }),
  });
  try {
    const sig = extractSignatures(join(root, "screens/web/01-a--empty.html"), { state: "empty" });
    assert.match(sig.cta_font, /font-family=var\(--font-display\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractSignatures: グループ state と無関係な container は署名に混ぜない", () => {
  // empty グループの照合中は、同ファイル内の error-banner を placement/illustration に含めない
  const root = makeApp({
    "screens/web/01-a--empty.html": emptyStateHtml({
      localStyle: ".error-banner { align-items: flex-start; }",
    }).replace(
      '<div class="empty-state">',
      '<div class="error-banner">x</div><div class="empty-state">'
    ),
  });
  try {
    const sig = extractSignatures(join(root, "screens/web/01-a--empty.html"), { state: "empty" });
    assert.doesNotMatch(sig.placement, /flex-start/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractSignatures: app root 外を指す <link href> は読まない (traversal 封じ)", () => {
  const root = mkdtempSync(join(tmpdir(), "xsc-test-"));
  // app root (= screens の親) の外側に、読まれたら署名が変わる CSS を実際に置く。
  // 共有 tmpdir 直下の固定名は並列実行で衝突するため、root 名に紐づく一意な sibling にする
  const outsideDir = `${root}-outside`;
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, "evil.css"), ".btn-primary { font-family: EvilFont; }", "utf8");
  const htmlPath = join(root, "screens/web/01-a--empty.html");
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(
    htmlPath,
    emptyStateHtml({}).replace(
      'href="../_shared/common-styles.css"',
      `href="../../../${outsideDir.split("/").pop()}/evil.css"`
    ),
    "utf8"
  );
  try {
    const sig = extractSignatures(join(root, "screens/web/01-a--empty.html"), { state: "empty" });
    assert.doesNotMatch(sig.cta_font, /EvilFont/);
    assert.equal(sig.cta_font, "font-family=inherit; font-size=inherit; font-weight=inherit");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ───────────────────────────── buildReport (end-to-end) ─────────────────────────────

test("buildReport: 全画面が揃っていれば drift 候補ゼロ", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({ illust: ILLUST_USERS }),
    "screens/web/02-b--empty.html": emptyStateHtml({ illust: ILLUST_USERS }),
    "screens/web/03-c--empty.html": emptyStateHtml({ illust: ILLUST_USERS }),
  });
  try {
    const r = buildReport(root);
    assert.equal(r.summary.groups, 1);
    assert.equal(r.summary.drift_candidates, 0);
    assert.equal(r.groups[0].checks.cta_class.converged, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: CTA class / font drift の注入 → 検出 (少数派ファイル特定)", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({}),
    "screens/web/02-b--empty.html": emptyStateHtml({}),
    // 正典 .btn-primary でなく自作 class + ローカル font
    "screens/web/03-c--empty.html": emptyStateHtml({
      ctaClass: "primary-action",
      localStyle: ".primary-action { font-family: Comic Sans; }",
    }),
  });
  try {
    const r = buildReport(root);
    const classDrift = r.drift_candidates.find((d) => d.tag === "cta_class_drift");
    assert.ok(classDrift, "cta_class_drift が検出されること");
    assert.equal(classDrift.majority, "btn-primary");
    assert.deepEqual(
      classDrift.minority_files.map((m) => m.file),
      ["screens/web/03-c--empty.html"]
    );
    const fontDrift = r.drift_candidates.find((d) => d.tag === "cta_font_drift");
    assert.ok(fontDrift, "cta_font_drift が検出されること");
    assert.deepEqual(
      fontDrift.minority_files.map((m) => m.file),
      ["screens/web/03-c--empty.html"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: CTA icon 形状 drift の注入 → 検出", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }),
    "screens/web/02-b--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }),
    "screens/web/03-c--empty.html": emptyStateHtml({ ctaIcon: ICON_REFRESH }),
  });
  try {
    const r = buildReport(root);
    const iconDrift = r.drift_candidates.find(
      (d) => d.tag === "cross_screen_icon_inconsistent" && d.dimension === "icon_primary_cta"
    );
    assert.ok(iconDrift, "icon drift が検出されること");
    assert.deepEqual(
      iconDrift.minority_files.map((m) => m.file),
      ["screens/web/03-c--empty.html"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractSignatures: icon は best rank の CTA 配下のみ (rank3 の icon は混ぜない)", () => {
  // btn-primary (rank1) の icon に加え、secondary な cta-link (rank3) が別 icon を持つ
  const root = makeApp({
    "screens/web/01-a--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }).replace(
      "</button>",
      `</button><a class="cta-link">${ICON_REFRESH} 詳しく見る</a>`
    ),
  });
  try {
    const sig = extractSignatures(join(root, "screens/web/01-a--empty.html"), { state: "empty" });
    assert.equal(sig.cta_class, "btn-primary"); // class 署名は best rank のみ (従来どおり)
    assert.doesNotMatch(sig.icon_primary_cta, / \| /); // icon 署名も 1 種のみ = rank3 分が混ざらない
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: secondary CTA (rank3) の icon 有無差は偽 drift にしない", () => {
  // チームレビュー再現シナリオ: primary CTA icon は全画面同一だが、片方の画面にだけ
  // rank3 の cta-link (別 icon) がある。修正前は「余計な要素が無い側のきれいな画面」が
  // 少数派として指摘されていた。
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }).replace(
      "</button>",
      `</button><a class="cta-link">${ICON_REFRESH} 詳しく見る</a>`
    ),
    "screens/web/02-b--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }),
  });
  try {
    const r = buildReport(root);
    const iconDrift = r.drift_candidates.find((d) => d.dimension === "icon_primary_cta");
    assert.equal(iconDrift, undefined, "primary CTA icon が揃っていれば drift にしない");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: state illustration の欠落も icon drift 候補になる", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({ illust: ILLUST_INBOX }),
    "screens/web/02-b--empty.html": emptyStateHtml({ illust: ILLUST_INBOX }),
    "screens/web/03-c--empty.html": emptyStateHtml({ illust: "" }), // illustration 欠落
  });
  try {
    const r = buildReport(root);
    const drift = r.drift_candidates.find((d) => d.dimension === "icon_state_illustration");
    assert.ok(drift);
    assert.deepEqual(drift.minority_files, [
      { file: "screens/web/03-c--empty.html", value: "(none)" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: 配置 drift の注入 → 検出", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({}),
    "screens/web/02-b--empty.html": emptyStateHtml({}),
    "screens/web/03-c--empty.html": emptyStateHtml({
      localStyle: ".empty-state { text-align: left; align-items: flex-start; }",
    }),
  });
  try {
    const r = buildReport(root);
    const drift = r.drift_candidates.find((d) => d.tag === "button_position_inconsistent");
    assert.ok(drift, "配置 drift が検出されること");
    assert.deepEqual(
      drift.minority_files.map((m) => m.file),
      ["screens/web/03-c--empty.html"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: main 正典との食い違い (グループ内収束でも drift 候補)", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    // main は正典 .btn-primary
    "screens/web/01-a.html": emptyStateHtml({}),
    "screens/web/02-b.html": emptyStateHtml({}),
    // sub-state 群は揃って自作 class に逸脱 (収束はしている)
    "screens/web/01-a--empty.html": emptyStateHtml({ ctaClass: "primary-action" }),
    "screens/web/02-b--empty.html": emptyStateHtml({ ctaClass: "primary-action" }),
  });
  try {
    const r = buildReport(root);
    const drift = r.drift_candidates.find((d) => d.tag === "cta_class_drift");
    assert.ok(drift, "main 正典との食い違いが drift 候補になること");
    assert.equal(drift.main_canon, "btn-primary");
    assert.equal(drift.main_mismatch, true);
    // 収束していても main から逸脱した全ファイルが修正対象として載る
    assert.deepEqual(
      drift.minority_files.map((m) => m.file).sort(),
      ["screens/web/01-a--empty.html", "screens/web/02-b--empty.html"]
    );
    assert.equal(drift.minority_total, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compareDimension: main_mismatch 時は minority を main 基準に切替える", () => {
  // 収束 + main 食い違い → 全 entries が少数派
  const conv = compareDimension(
    [
      { file: "a.html", value: "primary-action" },
      { file: "b.html", value: "primary-action" },
    ],
    "btn-primary"
  );
  assert.equal(conv.main_mismatch, true);
  assert.equal(conv.minority_total, 2);
  assert.deepEqual(
    conv.minority_files.map((m) => m.file).sort(),
    ["a.html", "b.html"]
  );
  // 非収束 + main 食い違い → main と異なる全ファイルが少数派 (多数派基準ではない)
  const split = compareDimension(
    [
      { file: "a.html", value: "primary-action" },
      { file: "b.html", value: "primary-action" },
      { file: "c.html", value: "btn-primary" },
    ],
    "btn-primary"
  );
  assert.equal(split.main_mismatch, true);
  assert.deepEqual(
    split.minority_files.map((m) => m.file).sort(),
    ["a.html", "b.html"]
  );
});

test("buildReport: 全ファイル CTA 無し (loading 等) は「一貫して無し」で収束扱い", () => {
  const root = makeApp({
    "screens/web/01-a--loading.html": emptyStateHtml({ cta: false }),
    "screens/web/02-b--loading.html": emptyStateHtml({ cta: false }),
  });
  try {
    const r = buildReport(root);
    assert.equal(
      r.drift_candidates.filter((d) => d.tag === "cta_class_drift").length,
      0,
      "CTA 不在同士は drift にしない"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: 1 画面しかないグループは比較対象外 (skipped 集計)", () => {
  const root = makeApp({
    "screens/web/01-a--empty.html": emptyStateHtml({}),
    "screens/web/01-a--error.html": emptyStateHtml({}),
  });
  try {
    const r = buildReport(root);
    assert.equal(r.summary.groups, 0);
    assert.equal(r.scanned.singleton_groups_skipped, 2);
    assert.equal(r.summary.drift_candidates, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: theme suffix は別グループに分離される", () => {
  const root = makeApp({
    "screens/web/01-a--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }),
    "screens/web/02-b--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }),
    "screens/web/01-a--empty--dark.html": emptyStateHtml({ ctaIcon: ICON_REFRESH }),
    "screens/web/02-b--empty--dark.html": emptyStateHtml({ ctaIcon: ICON_REFRESH }),
  });
  try {
    const r = buildReport(root);
    assert.equal(r.summary.groups, 2);
    // light/dark 間で icon が違っても、グループが分かれているので drift にならない
    assert.equal(r.summary.drift_candidates, 0);
    assert.deepEqual(
      r.groups.map((g) => g.theme).sort(),
      ["dark", "default"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: icons/ 正典があれば署名に icon 名を注釈する", () => {
  const root = makeApp({
    "icons/check.svg": ICON_CHECK,
    "screens/web/01-a--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }),
    "screens/web/02-b--empty.html": emptyStateHtml({ ctaIcon: ICON_CHECK }),
  });
  try {
    const r = buildReport(root);
    const sig = r.groups[0].checks.icon_primary_cta.majority;
    assert.match(sig, /^check@/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listScreenFiles: 正規 topology と legacy flat 配置の両方を拾う", () => {
  const root = makeApp({
    "screens/web/01-a--empty.html": "x",
    "screens/web-sm/01-a--empty.html": "x", // web-sm platform dir
    "screens/mobile/01-a--empty.html": "x",
    "screens/02-b--empty.html": "x", // legacy flat (web 扱い)
    "screens/mobile-03-c--empty.html": "x", // legacy flat (mobile 扱い)
    "screens/web/01-a.html.bak": "x", // .bak は無視
    "screens/web-sm/01-a.html.bak": "x", // .bak は web-sm でも無視
  });
  try {
    const files = listScreenFiles(root);
    const names = files.map((f) => `${f.platform}:${f.name}`).sort();
    assert.deepEqual(names, [
      "mobile:01-a--empty.html",
      "mobile:mobile-03-c--empty.html",
      "web-sm:01-a--empty.html",
      "web:01-a--empty.html",
      "web:02-b--empty.html",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildReport: groups[].files は cap (8 件) され総数は files_total に残る", () => {
  const files = { "screens/_shared/common-styles.css": SHARED_CSS };
  for (let i = 1; i <= 10; i++) {
    files[`screens/web/${String(i).padStart(2, "0")}-s--empty.html`] = emptyStateHtml({});
  }
  const root = makeApp(files);
  try {
    const r = buildReport(root);
    assert.equal(r.groups[0].files.length, 8); // CAP_FILES
    assert.equal(r.groups[0].files_total, 10);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ───────────────────────────── CLI smoke ─────────────────────────────

test("CLI: --report --out で report JSON が書かれる", () => {
  const root = makeApp({
    "screens/_shared/common-styles.css": SHARED_CSS,
    "screens/web/01-a--empty.html": emptyStateHtml({}),
    "screens/web/02-b--empty.html": emptyStateHtml({ ctaClass: "primary-action" }),
  });
  try {
    const out = join(root, "report.json");
    const stdout = execFileSync(process.execPath, [SCRIPT, "--report", root, "--out", out], {
      encoding: "utf8",
    });
    assert.match(stdout, /wrote /);
    assert.ok(existsSync(out));
    const r = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(r.summary.drift_candidates > 0, true);
    assert.equal(r.summary.by_tag.cta_class_drift, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: --out の親ディレクトリが未作成でも書き込める", () => {
  const root = makeApp({
    "screens/web/01-a--empty.html": emptyStateHtml({}),
    "screens/web/02-b--empty.html": emptyStateHtml({}),
  });
  try {
    const out = join(root, "not-yet", "nested", "report.json");
    execFileSync(process.execPath, [SCRIPT, "--report", root, "--out", out], { encoding: "utf8" });
    assert.ok(existsSync(out));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: screens/ の無いパスは exit 2", () => {
  const root = mkdtempSync(join(tmpdir(), "xsc-noscreens-"));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT, "--report", root], { encoding: "utf8" }),
      (e) => e.status === 2
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
