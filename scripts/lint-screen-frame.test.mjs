// scripts/lint-screen-frame.test.mjs
//
// scripts/lint-screen-frame.mjs の単体テスト。Node 標準の node:test + node:assert のみ (依存ゼロ)。
// fixture は os.tmpdir() 配下に組み立て、repo の artifacts/ を汚さない。
//   実行: node --test scripts/lint-screen-frame.test.mjs
//
// 回帰の主対象: 「スマホ中心 WEB 案件で生成 LLM が固定幅ラッパー無しの fluid HTML を出力し、
// Figma キャプチャがブラウザ窓幅で行われて意図した幅にならない」実事故の再現 fixture
// (fluid: viewport meta + width:100% + ラッパー無し) を hard 違反として検出できること。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { platformOf, extractCss, extractRules, checkFile, checkFiles } from "./lint-screen-frame.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "lint-screen-frame.mjs");

// ───────────────────────────── fixture ヘルパ ─────────────────────────────

function makeApp(files) {
  const root = mkdtempSync(join(tmpdir(), "frame-lint-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
  return root;
}

const VALID_WEB = `<!DOCTYPE html><html lang="ja"><head><style>
:root { --color-bg: #fff; }
html, body { font-family: sans-serif; }
body { width: 1440px; min-height: 900px; margin: 0 auto; }
@media (prefers-reduced-motion: reduce) { * { animation-duration: 100ms !important; } }
</style></head><body><main>x</main></body></html>`;

const VALID_SM = `<!DOCTYPE html><html lang="ja"><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root { --color-bg: #fff; }
body { background: #E8E4DF; display: flex; align-items: center; }
.screen { width: 390px; min-height: 844px; background: var(--color-bg); }
</style></head><body><div class="screen"><main>x</main></div></body></html>`;

// 実事故の再現: 固定幅ラッパー無し・fluid・viewport meta あり
const FLUID_NO_FRAME = `<!DOCTYPE html><html lang="ja"><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root { --color-bg: #fff; }
html, body { font-family: sans-serif; background: var(--color-bg); }
.container { padding: 16px; }
.search-input { width: 100%; }
@media (prefers-reduced-motion: reduce) { * { animation-duration: 100ms !important; } }
</style></head><body><header class="header">CarMag</header><main class="container">x</main></body></html>`;

const WIDTH_MEDIA_QUERY_WEB = `<!DOCTYPE html><html><head><style>
body { width: 1440px; min-height: 900px; }
@media (max-width: 768px) { body { width: 100%; } }
</style></head><body><main>x</main></body></html>`;

// CSS ルールはあるが markup にラッパー要素が無い
const SM_CSS_ONLY = `<!DOCTYPE html><html><head><style>
.screen { width: 390px; min-height: 844px; }
</style></head><body><main class="screenshot-area">x</main></body></html>`;

// ───────────────────────────── 純関数 ─────────────────────────────

test("platformOf: screens 配下の platform セグメントで判定", () => {
  assert.equal(platformOf("/x/artifacts/app/screens/web/01-a.html"), "web");
  assert.equal(platformOf("/x/artifacts/app/screens/web-sm/01-a.html"), "web-sm");
  assert.equal(platformOf("/x/artifacts/app/screens/mobile/01-a--empty.html"), "mobile");
  assert.equal(platformOf("/x/artifacts/app/screens/01-a.md"), "other");
});

test("extractCss / extractRules: selector list と at-rule ネストを flat に分解", () => {
  const css = extractCss(VALID_WEB);
  const rules = extractRules(css);
  const sels = rules.map((r) => r.selector);
  assert.ok(sels.includes("html, body"));
  assert.ok(sels.includes("body"));
  // @media 内側のルールも列挙され、at-rule 自体は捨てられる
  assert.ok(sels.includes("*"));
  assert.ok(!sels.some((s) => s.startsWith("@")));
});

// ───────────────────────────── checkFile ─────────────────────────────

test("checkFile: 適合 web / web-sm / mobile は違反ゼロ", () => {
  const root = makeApp({
    "screens/web/01-a.html": VALID_WEB,
    "screens/web-sm/01-a.html": VALID_SM,
    "screens/mobile/01-a.html": VALID_SM,
  });
  try {
    for (const rel of ["screens/web/01-a.html", "screens/web-sm/01-a.html", "screens/mobile/01-a.html"]) {
      const r = checkFile(join(root, rel));
      assert.deepEqual(r.violations, [], rel);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkFile: fluid HTML (固定幅ラッパー無し) は fixed_frame_missing — 実事故の再現", () => {
  const root = makeApp({
    "screens/web/01-home.html": FLUID_NO_FRAME,
    "screens/web-sm/01-home.html": FLUID_NO_FRAME,
  });
  try {
    const web = checkFile(join(root, "screens/web/01-home.html"));
    assert.equal(web.violations.length, 1);
    assert.equal(web.violations[0].rule, "fixed_frame_missing");
    const sm = checkFile(join(root, "screens/web-sm/01-home.html"));
    assert.equal(sm.violations.length, 1);
    assert.equal(sm.violations[0].rule, "fixed_frame_missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkFile: 幅ベース media query は width_media_query (prefers-* は許容)", () => {
  const root = makeApp({ "screens/web/01-a.html": WIDTH_MEDIA_QUERY_WEB });
  try {
    const r = checkFile(join(root, "screens/web/01-a.html"));
    assert.deepEqual(r.violations.map((v) => v.rule), ["width_media_query"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkFile: CSS ルールのみで markup に .screen 要素が無い場合も fixed_frame_missing", () => {
  const root = makeApp({ "screens/mobile/01-a.html": SM_CSS_ONLY });
  try {
    const r = checkFile(join(root, "screens/mobile/01-a.html"));
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].rule, "fixed_frame_missing");
    assert.match(r.violations[0].detail, /markup 要素: 欠落/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkFile: platform 外パスは skipped (違反にしない)", () => {
  const root = makeApp({ "screens/style-guide-view.html": FLUID_NO_FRAME });
  try {
    const r = checkFile(join(root, "screens/style-guide-view.html"));
    assert.equal(r.skipped, true);
    assert.deepEqual(r.violations, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ───────────────────────────── CLI ─────────────────────────────

test("CLI: 適合ファイルは exit 0 / 違反は exit 1 / 不在パスは exit 2", () => {
  const root = makeApp({
    "screens/web/ok.html": VALID_WEB,
    "screens/web/bad.html": FLUID_NO_FRAME,
  });
  try {
    const out = execFileSync("node", [SCRIPT, "--check", join(root, "screens/web/ok.html")], { encoding: "utf8" });
    assert.equal(JSON.parse(out).hard_violations, 0);

    let code = 0;
    try {
      execFileSync("node", [SCRIPT, "--check", join(root, "screens/web/ok.html"), join(root, "screens/web/bad.html")], { encoding: "utf8" });
    } catch (e) {
      code = e.status;
      const parsed = JSON.parse(e.stdout);
      assert.equal(parsed.hard_violations, 1);
      assert.equal(checkFiles([join(root, "screens/web/ok.html"), join(root, "screens/web/bad.html")]).hard_violations, 1);
    }
    assert.equal(code, 1);

    let code2 = 0;
    try {
      execFileSync("node", [SCRIPT, "--check", join(root, "screens/web/nofile.html")], { encoding: "utf8" });
    } catch (e) {
      code2 = e.status;
    }
    assert.equal(code2, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
