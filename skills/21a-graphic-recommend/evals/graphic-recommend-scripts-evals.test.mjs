#!/usr/bin/env node
// skills/21a-graphic-recommend/evals/graphic-recommend-scripts-evals.test.mjs
//
// Step 21a の同梱 script 3 本 (scripts/extract-inventory.mjs / scripts/commit-completed.mjs /
// scripts/render-recommend-html.mjs) の
// **CLI 契約テスト**: 黒箱 CLI として fixture (tmpdir に組み立てた artifacts ツリー) に対して回し、
// stdout JSON の routing 契約 (ok / E_* code)・インベントリ抽出の分類 (正典アイコン署名一致 /
// role="img" 意味視覚 / illust-placeholder / raster / 絵文字 / sub-state 除外 / dual_theme 合算)・
// 書き込み副作用 (pipeline-state.json の step21a_completed_at)・視覚レポートの anchor 解決
// (icon/scene/text の注入 + fail-open fallback) を固定する。SKILL.md の
// routing 表・設計 docs/graphic-generation-design.md §8-4 / §9-1 との対応が回帰しないことを検出する。
//
// fixture 規約は skills/21b-graphic-hearing/evals/ と同じ: golden ファイルなし・makeApp() が
// tmpdir に毎回組み立て・AYATORI_REPO_ROOT env で差し込む (作業ツリーの artifacts/ を汚さない)。
//
// 使い方:
//   npm test                                                                                    # 検証 (node --test discovery)
//   node --test skills/21a-graphic-recommend/evals/graphic-recommend-scripts-evals.test.mjs     # 本 eval のみ
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACT = join(HERE, "..", "scripts", "extract-inventory.mjs");
const COMMIT = join(HERE, "..", "scripts", "commit-completed.mjs");
const RENDER = join(HERE, "..", "scripts", "render-recommend-html.mjs");
const APP = "testapp";

// 正典アイコン (icons/star.svg) — 画面 HTML には同一 path をインラインで置く (署名一致を再現)
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L15 9 L22 9 L16 14 L18 21 L12 17 L6 21 L8 14 L2 9 L9 9 Z"/></svg>';
// 正典に無い装飾 SVG (unmatched / decorative)
const DECOR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3 L21 21"/></svg>';
// データ駆動の意味視覚 (コア UI — ガードレール対象)
const RING_SVG = '<svg role="img" aria-label="候補向き円環" viewBox="0 0 300 300"><circle cx="150" cy="150" r="100"/></svg>';
// 形状署名の鲁棒性検証用: rect 正典 (icons/box.svg) と、属性順序入替 + 追加属性 (class) を持つ画面内コピー
// (署名は SHAPE_GEOM 命名属性のみ + sort で正規化されるため一致しなければならない — Copilot review M1 回帰)
const BOX_SVG_CANON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="3"/></svg>';
const BOX_SVG_REORDERED = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect rx="3" width="20" x="2" class="icon-box" height="20" y="2"/></svg>';
// イラスト正典 (screens/_shared/illustrations/moon.svg) — 画面には verbatim コピー
const MOON_ILLUST = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 A20 20 0 1 0 44 24 A16 16 0 0 1 24 4 Z"/></svg>';

/** tmpdir に artifacts/testapp の fixture ツリーを組み立てる。opts で状態を変形する。 */
function makeApp(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "21a-eval-"));
  const app = join(root, "artifacts", APP);
  mkdirSync(join(app, "requirements"), { recursive: true });
  mkdirSync(join(app, "screens", "web"), { recursive: true });
  mkdirSync(join(app, "screens", "mobile"), { recursive: true });
  mkdirSync(join(app, "icons"), { recursive: true });

  const state = {
    schema_version: "2026-05-22",
    app_name: APP,
    approvals: { screens_human_approved: true },
    confluence: { design: { save_count: opts.saveCount ?? 1 } },
  };
  if (opts.notApproved) state.approvals.screens_human_approved = false;
  if (opts.graphics) state.screens = { graphics: opts.graphics };
  if (!opts.noState) writeFileSync(join(app, "pipeline-state.json"), JSON.stringify(state, null, 2));

  const req = {
    app_name: APP,
    design_output_scope: {
      platform_combo: "mobile_and_web",
      graphic_generation: opts.upstreamSkip ? "skip" : "ask",
      illustration_policy: opts.illustrationPolicy ?? "pictogram",
    },
  };
  if (!opts.noRequirements) writeFileSync(join(app, "requirements.json"), JSON.stringify(req, null, 2));
  if (!opts.noRawInput) writeFileSync(join(app, "requirements", "00-raw-input.md"), "# 7 軸生回答\nゲームで遊びたい\n");

  writeFileSync(join(app, "icons", "star.svg"), STAR_SVG);

  if (opts.robustness) {
    // 署名鲁棒性 + イラスト正典 + 旗 emoji + 単引用符属性 + emoji 負例の複合 fixture
    writeFileSync(join(app, "icons", "box.svg"), BOX_SVG_CANON);
    mkdirSync(join(app, "screens", "_shared", "illustrations"), { recursive: true });
    writeFileSync(join(app, "screens", "_shared", "illustrations", "moon.svg"), MOON_ILLUST);
    writeFileSync(join(app, "screens", "web", "01-home.html"), `<html><body>${BOX_SVG_REORDERED}${MOON_ILLUST}日本 🇯🇵</body></html>`);
    // 02-check: ✓★ 等の頻出記号は emoji 扱いしない (m-3 負例) / 単引用符属性の意味視覚 (m-2) /
    // 本文 marker は script 出力に漏れない (context 保護契約)
    writeFileSync(
      join(app, "screens", "web", "02-check.html"),
      `<html><body><svg role='img' aria-label='単引用符ビジュアル' viewBox='0 0 10 10'><circle cx='5' cy='5' r='4'/></svg>✓ 完了 ★ 評価<p>SECRET-BODY-TEXT-MARKER</p></body></html>`
    );
    return { root, app };
  }

  if (!opts.noScreens) {
    if (opts.dualTheme) {
      writeFileSync(join(app, "screens", "web", "01-home--light.html"), `<html><body>${STAR_SVG}${RING_SVG}</body></html>`);
      writeFileSync(join(app, "screens", "web", "01-home--dark.html"), `<html><body>${STAR_SVG}</body></html>`);
      writeFileSync(join(app, "screens", "web", "01-home--empty--light.html"), "<html></html>"); // sub-state × theme (除外対象)
    } else {
      writeFileSync(
        join(app, "screens", "web", "01-home.html"),
        `<html><body>${STAR_SVG}${DECOR_SVG}${RING_SVG}<div role="img" aria-label="棒グラフ比較" class="ba-chart"></div><div class="illust-placeholder" data-scene="hero-welcome"></div><img src="../_shared/graphics/x.png" alt="x">お祝い🎉</body></html>`
      );
      writeFileSync(join(app, "screens", "web", "01-home--empty.html"), "<html></html>"); // sub-state variant (除外対象)
      writeFileSync(join(app, "screens", "mobile", "01-home.html"), `<html><body>${STAR_SVG}</body></html>`);
    }
  }
  if (opts.withReport) {
    mkdirSync(join(app, "graphics"), { recursive: true });
    writeFileSync(join(app, "graphics", "graphic-recommend.md"), "# グラフィック必要性 推奨レポート — testapp\n");
  }
  return { root, app };
}

/** script を黒箱 CLI として実行し、stdout JSON を parse して返す。 */
function run(script, root, args = []) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, AYATORI_REPO_ROOT: root },
  });
  assert.equal(res.status, 0, `exit 0 契約 (routing は JSON の code で行う)。stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const readState = (app) => JSON.parse(readFileSync(join(app, "pipeline-state.json"), "utf8"));

// ── extract-inventory.mjs: 前提 assert (routing 契約) ──────────────────────────

test("extract: app 不在 → E_APP_NOT_FOUND", () => {
  const { root } = makeApp();
  assert.equal(run(EXTRACT, root, ["no-such-app"]).code, "E_APP_NOT_FOUND");
});

test("extract: pipeline-state 不在 → E_STATE_MISSING", () => {
  const { root } = makeApp({ noState: true });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_STATE_MISSING");
});

test("extract: requirements 不在 → E_REQUIREMENTS_MISSING", () => {
  const { root } = makeApp({ noRequirements: true });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_REQUIREMENTS_MISSING");
});

test("extract: Step 21 未承認 → E_SCREENS_NOT_APPROVED", () => {
  const { root } = makeApp({ notApproved: true });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_SCREENS_NOT_APPROVED");
});

test("extract: 2nd save 通過済み → E_PAST_2ND_SAVE (完走側ガード — 設計 §5/§9-1)", () => {
  const { root } = makeApp({ saveCount: 2 });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_PAST_2ND_SAVE");
});

test("extract: decision 確定済み → E_DECISION_ALREADY_SET (再分析しない)", () => {
  const { root } = makeApp({ graphics: { decision: "skip", decided_by: "step21b" } });
  const out = run(EXTRACT, root, [APP]);
  assert.equal(out.code, "E_DECISION_ALREADY_SET");
  assert.equal(out.decision, "skip");
});

test("extract: 上流 skip → E_UPSTREAM_SKIP (記録は orchestrator の責務、21a 判定より先に評価)", () => {
  const { root } = makeApp({ upstreamSkip: true });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_UPSTREAM_SKIP");
});

test("extract: 実行済み → E_ALREADY_DONE (idempotence — 21b へ誘導)", () => {
  const { root } = makeApp({ graphics: { step21a_completed_at: "2026-07-16T10:00:00+09:00" } });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_ALREADY_DONE");
});

test("extract: main HTML 0 件 → E_NO_SCREENS (degrade routing 用 — 設計 §8-4 fail-open)", () => {
  const { root } = makeApp({ noScreens: true });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_NO_SCREENS");
});

// ── extract-inventory.mjs: インベントリ抽出の分類 ──────────────────────────────

test("extract: 正典アイコン署名一致 / 意味視覚 / placeholder / raster / 絵文字 / sub-state 除外", () => {
  const { root } = makeApp();
  const out = run(EXTRACT, root, [APP]);
  assert.equal(out.ok, true);
  assert.equal(out.illustration_policy, "pictogram");
  assert.equal(out.category_material_available, true);
  assert.equal(out.category_sources["requirements/00-raw-input.md"], true);

  const web = out.inventory.platforms.web;
  assert.equal(web.length, 1, "sub-state variant (--empty) は main 画面として数えない");
  const home = web[0];
  assert.equal(home.screen, "01-home");
  assert.deepEqual(home.icons_used, ["star"], "icons/star.svg と署名一致");
  assert.equal(home.meaningful_visuals.length, 2, 'svg と div 両形式の role="img" 意味視覚 (コア UI) を分離');
  assert.equal(home.meaningful_visuals[0].aria_label, "候補向き円環");
  const domVisual = home.meaningful_visuals.find((v) => v.kind === "custom_dom_visual");
  assert.equal(domVisual?.tag, "div", '<div role="img"> のデータ可視化も検出 (svg のみの走査では取りこぼす — Pattern C 回帰)');
  assert.equal(domVisual?.aria_label, "棒グラフ比較");
  assert.equal(home.unmatched_svgs.length, 1, "正典に無い装飾 SVG は unmatched (decorative)");
  assert.equal(home.unmatched_svgs[0].decorative, true);
  assert.deepEqual(home.illust_placeholders.map((p) => p.scene), ["hero-welcome"], "data-scene 直取り");
  assert.equal(home.raster_imgs.length, 1);
  assert.equal(home.emoji_in_markup, true);

  assert.deepEqual(out.inventory.summary.distinct_icons_used, ["star"]);
  assert.deepEqual(out.inventory.summary.screens_with_emoji, ["01-home"]);
});

test("extract: dual_theme は同一 stem に合算し theme variant を別画面として数えない", () => {
  const { root } = makeApp({ dualTheme: true });
  const out = run(EXTRACT, root, [APP]);
  const web = out.inventory.platforms.web;
  assert.equal(web.length, 1);
  assert.deepEqual(web[0].files, ["01-home--dark.html", "01-home--light.html"]);
  assert.deepEqual(web[0].icons_used, ["star"], "両 theme ファイルのアイコンは union");
});

test("extract: 署名は属性順序・追加属性に不変 / イラスト正典は illustration_canon / 旗 emoji 検出", () => {
  const { root } = makeApp({ robustness: true });
  const out = run(EXTRACT, root, [APP]);
  const home = out.inventory.platforms.web.find((s) => s.screen === "01-home");
  assert.deepEqual(home.icons_used, ["box"], "rect の属性順序入替 + class 追加でも正典署名と一致する (M1 回帰)");
  assert.equal(home.meaningful_visuals.length, 1);
  assert.equal(home.meaningful_visuals[0].kind, "illustration_canon", "_shared/illustrations 正典との署名一致");
  assert.equal(home.meaningful_visuals[0].name, "moon");
  assert.equal(home.unmatched_svgs.length, 0);
  assert.equal(home.emoji_in_markup, true, "国旗 emoji (Regional Indicator) も検出する (N3 回帰)");
});

test("extract: ✓★ は emoji 扱いしない / 単引用符属性も意味視覚として解析 / 本文は出力に漏れない", () => {
  const { root } = makeApp({ robustness: true });
  const out = run(EXTRACT, root, [APP]);
  const check = out.inventory.platforms.web.find((s) => s.screen === "02-check");
  assert.equal(check.emoji_in_markup, false, "頻出記号 ✓★ を emoji と誤検出しない (m-3 負例)");
  assert.equal(check.meaningful_visuals.length, 1, "単引用符の role='img' も意味視覚に分類 (m-2 回帰)");
  assert.equal(check.meaningful_visuals[0].aria_label, "単引用符ビジュアル");
  assert.ok(!JSON.stringify(out).includes("SECRET-BODY-TEXT-MARKER"), "HTML 本文は script 出力に含めない (context 保護契約)");
});

test("extract: role=img 付き illust-placeholder は候補 (illust_placeholders) 単独 — ガードレールへ二重計上しない", () => {
  const { root, app } = makeApp({ noScreens: true });
  // 非正典マークアップ (正典は role なし): custom_dom_visual (§5 ガードレール) と illust_placeholders
  // (§4 候補直取り) の両方に載るとレポートが自己矛盾する (yena review — スタブ実測で確認された edge case)
  writeFileSync(
    join(app, "screens", "web", "01-home.html"),
    `<html><body><div role="img" aria-label="ヒーロー" class="hero illust-placeholder" data-scene="hero-x"></div></body></html>`
  );
  const out = run(EXTRACT, root, [APP]);
  const home = out.inventory.platforms.web[0];
  assert.deepEqual(home.illust_placeholders.map((p) => p.scene), ["hero-x"], "候補直取り側には従来どおり載る");
  assert.equal(home.meaningful_visuals.length, 0, "custom_dom_visual には計上しない (§4 候補 vs §5 ガードレールの矛盾防止)");
});

test("extract: E_PAST_2ND_SAVE は E_DECISION_ALREADY_SET より先に評価される (assert 順序の固定)", () => {
  const { root } = makeApp({ saveCount: 2, graphics: { decision: "skip", decided_by: "step21b" } });
  assert.equal(run(EXTRACT, root, [APP]).code, "E_PAST_2ND_SAVE", "完走側ガードが decision 判定より上流 (完走後は decision の有無に関わらず delta 領域へ誘導)");
});

test("extract: カテゴリ材料欠損 → ok のまま category_material_available=false (inventory-only degrade の signal)", () => {
  const { root } = makeApp({ noRawInput: true });
  const out = run(EXTRACT, root, [APP]);
  assert.equal(out.ok, true);
  assert.equal(out.category_material_available, false);
});

// ── commit-completed.mjs: 完了記録の契約 ───────────────────────────────────────

test("commit: レポート不在の通常完了 → E_REPORT_MISSING (書き込みゼロ)", () => {
  const { root, app } = makeApp();
  assert.equal(run(COMMIT, root, [APP]).code, "E_REPORT_MISSING");
  assert.equal(readState(app).screens?.graphics?.step21a_completed_at, undefined);
});

test("commit: レポートありの通常完了 → step21a_completed_at を merge write (mode=report)", () => {
  const { root, app } = makeApp({ withReport: true });
  const out = run(COMMIT, root, [APP]);
  assert.equal(out.ok, true);
  assert.equal(out.mode, "report");
  const s = readState(app);
  assert.equal(typeof s.screens.graphics.step21a_completed_at, "string");
  assert.equal(s.app_name, APP, "必須 field の保全");
  assert.equal(s.approvals.screens_human_approved, true, "既存キーを破壊しない merge write");
});

test("commit: --degraded はレポート不在でも完了記録する (fail-open — 21b の起動前提)", () => {
  const { root, app } = makeApp();
  const out = run(COMMIT, root, [APP, "--degraded", "screens HTML 0 件"]);
  assert.equal(out.ok, true);
  assert.equal(out.mode, "degraded");
  assert.equal(typeof readState(app).screens.graphics.step21a_completed_at, "string");
});

test("commit: --degraded に理由なし → E_USAGE", () => {
  const { root } = makeApp();
  assert.equal(run(COMMIT, root, [APP, "--degraded"]).code, "E_USAGE");
});

test("commit: 再 assert — decision 確定済みなら extract と同一 code で拒否", () => {
  const { root } = makeApp({ graphics: { decision: "generate" }, withReport: true });
  assert.equal(run(COMMIT, root, [APP]).code, "E_DECISION_ALREADY_SET");
});

test("commit: 廃止 field schema_version を能動的に書かない (docs/artifact-file-responsibility.md 設計原則 4 — 欠落 state に回填しない)", () => {
  const { root, app } = makeApp({ withReport: true });
  const statePath = join(app, "pipeline-state.json");
  const s = JSON.parse(readFileSync(statePath, "utf8"));
  delete s.schema_version;
  writeFileSync(statePath, JSON.stringify(s, null, 2));
  assert.equal(run(COMMIT, root, [APP]).ok, true);
  const after = readState(app);
  assert.equal(after.schema_version, undefined, "書き込みは廃止済み — legacy 残存値の carry-over のみ許容 (能動追加はしない)");
  assert.equal(typeof after.screens.graphics.step21a_completed_at, "string");
});

// ── render-recommend-html.mjs: 視覚レポート生成の契約 (2 ファイル構成) ──

// anchor 3 種 (icon / scene / text) + capture.js 除去を 1 画面で検証する専用画面
const RENDER_SCREEN = `<html><head><script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script></head><body>
<header>${STAR_SVG}</header>
<div class="illust-placeholder" data-scene="hero-welcome"></div>
<section><h2>ようこそ見出し</h2><p>本文 曖昧語 と 曖昧語</p></section>
</body></html>`;

/** graphics/graphic-recommend.md の §4 固定構造 fixture を組み立てる。 */
function writeReport(app, { rows = [], anchorsJson = null } = {}) {
  const table = rows.length
    ? ["| # | 箇所 | スロット種別 | 個別推奨 |", "|---|---|---|---|", ...rows].join("\n")
    : "候補なし";
  const anchors = anchorsJson ? `\n<!-- ayatori:slot-anchors\n${anchorsJson}\n-->\n` : "";
  mkdirSync(join(app, "graphics"), { recursive: true });
  writeFileSync(
    join(app, "graphics", "graphic-recommend.md"),
    `# グラフィック必要性 推奨レポート — ${APP}\n\n## 4. グラフィック候補スロット一覧（Step 21b 質問④への引き継ぎ材料）\n\n${table}\n${anchors}\n## 5. 分析対象外（ガードレール）\n\n- なし\n`
  );
}

const ROWS3 = [
  "| 1 | `01-home` ロゴ位置 | hero_brand | **推奨** — 理由 1 |",
  "| 2 | `01-home` ヒーロー領域 | onboarding_explainer | **任意** — 理由 2 |",
  "| 3 | `01-home` 見出し | content_media | **必須級** — 理由 3 |",
];
const ANCHORS3 = `{ "slot_anchors": [
  { "n": 1, "screen": "01-home", "platform": "web", "anchor": "icon:star" },
  { "n": 2, "screen": "01-home", "platform": "web", "anchor": "scene:hero-welcome" },
  { "n": 3, "screen": "01-home", "platform": "web", "anchor": "text:ようこそ見出し" }
] }`;

test("render: レポート不在 → E_REPORT_MISSING (Step 2 の Write が先)", () => {
  const { root } = makeApp();
  assert.equal(run(RENDER, root, [APP]).code, "E_REPORT_MISSING");
});

test("render: §4 候補なし → slots 0・HTML 非生成 + stale 旧版を除去 (派生ビューの整合)", () => {
  const { root, app } = makeApp();
  writeReport(app, { rows: [] });
  const htmlPath = join(app, "graphics", "graphic-recommend.html");
  writeFileSync(htmlPath, "<html>stale</html>");
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, true);
  assert.equal(out.slots, 0);
  assert.equal(out.removed_stale, true);
  assert.equal(existsSync(htmlPath), false, "候補 0 件では視覚レポートを残さない");
});

test("render: §4 見出し破損 → E_MD_PARSE (「候補 0 件」と混同せず既存 HTML を削除しない)", () => {
  const { root, app } = makeApp();
  mkdirSync(join(app, "graphics"), { recursive: true });
  // 見出しが固定書式 (## 4. ...) から壊れた MD — parse 不能は候補 0 件の正常経路と区別する
  writeFileSync(join(app, "graphics", "graphic-recommend.md"), "# グラフィック必要性 推奨レポート — testapp\n\n## 4 候補スロット一覧 (ピリオド欠落)\n\n| 1 | `01-home` | hero_brand | **推奨** — 理由 |\n");
  const htmlPath = join(app, "graphics", "graphic-recommend.html");
  writeFileSync(htmlPath, "<html>previous good render</html>");
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, false);
  assert.equal(out.code, "E_MD_PARSE", "構造破損は E_MD_PARSE で MD 修正へ差し戻す (ok:true にしない)");
  assert.equal(existsSync(htmlPath), true, "破損 MD を理由に既存の正常な視覚レポートを削除しない");
  assert.equal(readFileSync(htmlPath, "utf8"), "<html>previous good render</html>", "既存 HTML は無変更");
});

test("render: slot_anchors が array でない → fail-open (exit 0・リングなしプレビュー + 理由文字列)", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), RENDER_SCREEN);
  writeReport(app, {
    rows: ROWS3.slice(0, 1),
    anchorsJson: `{ "slot_anchors": { "n": 1, "anchor": "icon:star" } }`, // LLM が array でなく object を書いた敵対値
  });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, true, "parse 成功 + 型違いでも exit 1 (TypeError) にしない — parse 失敗と同じ degrade 経路");
  assert.equal(out.slots, 1);
  assert.equal(out.highlighted, 0);
  assert.equal(out.fallbacks.length, 1);
  assert.ok(out.fallbacks[0].reason.includes("array ではありません"), "fallback 理由に形状エラーを透出する");
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.ok(html.includes("srcdoc="), "画面プレビュー自体は生成する (リングなし degrade)");
});

test("render: icon/scene/text anchor の解決と注入 (capture.js 除去 / base 注入 / srcdoc escape)", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), RENDER_SCREEN);
  writeReport(app, { rows: ROWS3, anchorsJson: ANCHORS3 });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, true);
  assert.equal(out.slots, 3);
  assert.equal(out.highlighted, 3, "3 anchor すべて解決 (fail-open 発生なし)");
  assert.deepEqual(out.fallbacks, []);
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.ok(html.includes('<svg data-ayatori-slot=&quot;1&quot;'), "icon: 正典署名一致の <svg> に slot 属性を注入");
  assert.ok(html.includes('<div data-ayatori-slot=&quot;2&quot;'), "scene: illust-placeholder div に注入");
  assert.ok(html.includes('<h2 data-ayatori-slot=&quot;3&quot;'), "text: 逐語一意テキストの包含タグ (h2) に注入");
  assert.ok(!html.includes("capture.js"), "Figma キャプチャ script は srcdoc から除去 (誤キャプチャ防止)");
  assert.ok(html.includes('<base href=&quot;../screens/web/&quot;>'), "相対参照を screens/{platform}/ 基準に戻す base 注入");
  assert.ok(html.includes("ayatori-slot-ring"), "ハイライト overlay の注入");
});

test("render: srcdoc 内の相対 <img> は data URI 内包で自己完結 / 不在ファイルは fail-open で残す (POCTEAMA-401)", () => {
  const { root, app } = makeApp();
  mkdirSync(join(app, "screens", "_shared", "graphics"), { recursive: true });
  writeFileSync(join(app, "screens", "_shared", "graphics", "hero.png"), "fakepng");
  // delta / feature-add 再実行の形 — 画面に既存グラフィックの C-26 参照が埋まっている
  writeFileSync(
    join(app, "screens", "web", "01-home.html"),
    RENDER_SCREEN.replace("<header>", '<header><img src="../_shared/graphics/hero.png" alt="hero"><img src="../_shared/graphics/ghost.png" alt="ghost">')
  );
  writeReport(app, { rows: ROWS3, anchorsJson: ANCHORS3 });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, true, JSON.stringify(out));
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.ok(html.includes(`data:image/png;base64,${Buffer.from("fakepng").toString("base64")}`), "実在する正典参照は data URI 内包 — 閲覧環境の file:// 読取ブロックで破像しない");
  assert.ok(!html.includes("src=&quot;../_shared/graphics/hero.png&quot;"), "内包済み参照は相対のまま残らない");
  assert.ok(html.includes("src=&quot;../_shared/graphics/ghost.png&quot;"), "不在ファイルの参照は書き換えず <base> 相対解決に委ねる (fail-open)");
});

test("render: screens/ 根の外へ出る相対 <img> は内包しない (樹外ファイルの混入防止 — PR #199 Copilot 対応)", () => {
  const { root, app } = makeApp();
  // 境界外 (screens/ の外 = graphics/ 直下) に実在ファイルを置き、手編集を模した参照を混入する
  mkdirSync(join(app, "graphics"), { recursive: true });
  writeFileSync(join(app, "graphics", "leak.png"), "leakpng");
  writeFileSync(
    join(app, "screens", "web", "01-home.html"),
    RENDER_SCREEN.replace("<header>", '<header><img src="../../graphics/leak.png" alt="leak">')
  );
  writeReport(app, { rows: ROWS3, anchorsJson: ANCHORS3 });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, true, JSON.stringify(out));
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.ok(html.includes("src=&quot;../../graphics/leak.png&quot;"), "境界外参照は書き換えず残す (fail-open)");
  assert.ok(!html.includes(Buffer.from("leakpng").toString("base64")), "境界外ファイルの中身を data URI として埋め込まない");
});

test("render: 同一画面の複数候補は 1 プレビューに重畳 (画面単位グループ化)", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), RENDER_SCREEN);
  writeReport(app, { rows: ROWS3, anchorsJson: ANCHORS3 });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.slots, 3);
  assert.equal(out.screens, 1, "3 候補とも 01-home → 画面グループは 1 つ");
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.equal((html.match(/srcdoc=/g) ?? []).length, 1, "iframe は画面につき 1 つ (候補ごとに複製しない)");
  for (const n of [1, 2, 3]) assert.ok(html.includes(`data-ayatori-slot=&quot;${n}&quot;`), `候補 ${n} のリングが同一 srcdoc に重畳`);
  assert.ok(html.includes("候補 #1 &amp; #2 &amp; #3"), "画面見出しに全候補番号を #N & 表記で (「1 / 3」の分数誤読を避ける + §4 の全体番号を維持)");
  assert.ok(html.includes("addEventListener('click'"), "プレビューはクリック無効化 + スクロール可 (視口外の候補へ到達できる — review M-1)");
  assert.ok(!html.includes("pointer-events:none}\n.frame"), "iframe の pointer-events:none は撤廃 (スクロール許可)");
});

test("render: icon:{name}:{nth} は文書順 nth の 1 箇所のみハイライト", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), `<html><body><header>${STAR_SVG}</header><main>${STAR_SVG}</main></body></html>`);
  writeReport(app, {
    rows: ["| 1 | `01-home` 2 個目の star | hero_brand | **推奨** — 理由 |"],
    anchorsJson: `{ "slot_anchors": [ { "n": 1, "screen": "01-home", "platform": "web", "anchor": "icon:star:2" } ] }`,
  });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.highlighted, 1);
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.equal((html.match(/data-ayatori-slot=&quot;1&quot;/g) ?? []).length, 1, "nth 指定時は該当 1 箇所のみ注入 (全出現ではない)");
  assert.ok(html.includes(`<main><svg data-ayatori-slot=&quot;1&quot;`), "文書順 2 番目 (main 内) に注入");
});

test("extract/render: sm-only 構成 (screens/web-sm のみ) を分析対象として認識する (review M-1 回帰)", () => {
  const { root, app } = makeApp({ noScreens: true });
  mkdirSync(join(app, "screens", "web-sm"), { recursive: true });
  writeFileSync(join(app, "screens", "web-sm", "01-home.html"), RENDER_SCREEN);

  const out = run(EXTRACT, root, [APP]);
  assert.equal(out.ok, true, "sm-only を E_NO_SCREENS (degrade skip) に誤判定しない — web_viewports=['sm'] は正規構成");
  assert.equal(out.inventory.platforms["web-sm"][0].screen, "01-home");
  assert.deepEqual(out.inventory.platforms["web-sm"][0].icons_used, ["star"]);

  // anchors の platform 明示 + 省略時の自動解決の両方が web-sm を扱えること
  writeReport(app, {
    rows: ROWS3.slice(0, 1),
    anchorsJson: `{ "slot_anchors": [ { "n": 1, "screen": "01-home", "platform": "web-sm", "anchor": "icon:star" } ] }`,
  });
  const r = run(RENDER, root, [APP]);
  assert.equal(r.highlighted, 1, "web-sm 画面上の anchor を解決できる");
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.ok(html.includes('<base href=&quot;../screens/web-sm/&quot;>'), "base は screens/web-sm/ を指す");

  writeReport(app, { rows: ROWS3.slice(0, 1) }); // anchors なし → platform 自動解決
  const r2 = run(RENDER, root, [APP]);
  assert.equal(r2.screens, 1, "platform 省略時のフォールバック探索にも web-sm が含まれる");
});

test("render: scene:{data-scene} 未検出は fail-open fallback", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), RENDER_SCREEN);
  writeReport(app, {
    rows: ["| 1 | `01-home` placeholder | mascot | **任意** — 理由 |"],
    anchorsJson: `{ "slot_anchors": [ { "n": 1, "screen": "01-home", "platform": "web", "anchor": "scene:no-such-scene" } ] }`,
  });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.highlighted, 0);
  assert.equal(out.fallbacks.length, 1, "scene 未検出はリングなしプレビューに degrade");
});

test("render: 解決不能 anchor は fail-open — リングなしプレビューに degrade して HTML は生成する", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), RENDER_SCREEN);
  writeReport(app, {
    rows: ROWS3.slice(0, 2),
    anchorsJson: `{ "slot_anchors": [
      { "n": 1, "screen": "01-home", "platform": "web", "anchor": "icon:no-such-icon" },
      { "n": 2, "screen": "01-home", "platform": "web", "anchor": "text:曖昧語" }
    ] }`,
  });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, true);
  assert.equal(out.slots, 2);
  assert.equal(out.highlighted, 0);
  assert.equal(out.fallbacks.length, 2, "正典不在 icon + 出現 2 件の text はどちらも fallback");
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.ok(!html.includes("data-ayatori-slot=&quot;"), "解決不能なら slot 属性は注入しない");
  assert.ok(html.includes("srcdoc="), "プレビュー iframe 自体は出す (エラー停止しない)");
  assert.ok(html.includes("位置ハイライトなし"), "fallback 理由を人間可読で表示");
});

test("render: anchors コメントなし → §4 表の backtick stem から画面を解決 (後方互換 fail-open)", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), RENDER_SCREEN);
  writeReport(app, { rows: ROWS3.slice(0, 1) });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.ok, true);
  assert.equal(out.slots, 1);
  assert.equal(out.highlighted, 0);
  assert.equal(out.fallbacks[0].reason, "anchor 指定なし");
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.ok(html.includes("srcdoc="), "画面プレビューは backtick stem 解決で出す");
});

test("extract: icon_occurrences は代表ファイル内の出現数を返す (anchor nth 選定材料)", () => {
  const { root } = makeApp();
  const out = run(EXTRACT, root, [APP]);
  assert.deepEqual(out.inventory.platforms.web[0].icon_occurrences, { star: 1 });
});

// ── アイコン用途分類の文脈特徴量 (①機能 / ②代替候補 — guide §8) ──

const CTX_SCREEN = `<html><head><style>.big-icon { width: 64px; border-width: 2px; } .big-icon-xl { width: 120px; } .thumb { width: 343px; } .thumb svg { width: 24px; }</style></head><body>
<nav><a href="#">${STAR_SVG}</a></nav>
<div class="big-icon">${STAR_SVG}</div>
<div class="thumb">${STAR_SVG}</div><div class="thumb">${STAR_SVG}</div><div class="thumb">${STAR_SVG}</div>
</body></html>`;

test("extract: icon_contexts — CSS px 推定 / nav・control 判定 / siblings (同型コンテナ数)", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), CTX_SCREEN);
  const out = run(EXTRACT, root, [APP]);
  const ctx = out.inventory.platforms.web[0].icon_contexts;
  assert.equal(ctx.length, 5);
  assert.equal(ctx[0].in_nav, true, "nav 内アイコン = 機能アイコン signal");
  assert.equal(ctx[0].in_control, true, "a/button 内 = 機能アイコン signal");
  assert.equal(ctx[1].parent_class, "big-icon");
  assert.equal(ctx[1].px, 64, "CSS width: 64px を推定 (border-width は誤検出しない / `.big-icon-xl` 120px に語境界で誤 hit しない)");
  assert.equal(ctx[2].parent_class, "thumb");
  assert.equal(ctx[2].px, 24, "`.thumb svg { width: 24px }` を採用 — `.thumb { width: 343px }` はレイアウト幅 (>160px) として無視");
  assert.equal(ctx[2].siblings, 3, "同一 parent_class の出現数 = サムネイル列 signal");
});

test("render: class:{token} anchor は同一 class の全要素をハイライト (グループ slot 用)", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), CTX_SCREEN);
  writeReport(app, {
    rows: ["| 1 | `01-home` サムネイル列 | content_media | **推奨** — 理由 |"],
    anchorsJson: `{ "slot_anchors": [ { "n": 1, "screen": "01-home", "platform": "web", "anchor": "class:thumb" } ] }`,
  });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.highlighted, 1);
  const html = readFileSync(join(app, "graphics", "graphic-recommend.html"), "utf8");
  assert.equal(html.split('<div data-ayatori-slot=&quot;1&quot; class=&quot;thumb&quot;').length - 1, 3, "thumb 3 要素すべてに注入");
});

test("render: class:{token} 未検出は fail-open fallback", () => {
  const { root, app } = makeApp();
  writeFileSync(join(app, "screens", "web", "01-home.html"), CTX_SCREEN);
  writeReport(app, {
    rows: ["| 1 | `01-home` サムネイル列 | content_media | **推奨** — 理由 |"],
    anchorsJson: `{ "slot_anchors": [ { "n": 1, "screen": "01-home", "platform": "web", "anchor": "class:no-such" } ] }`,
  });
  const out = run(RENDER, root, [APP]);
  assert.equal(out.highlighted, 0);
  assert.equal(out.fallbacks.length, 1);
});
