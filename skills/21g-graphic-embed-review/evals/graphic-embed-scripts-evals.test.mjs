// skills/21g-graphic-embed-review/evals/graphic-embed-scripts-evals.test.mjs
//
// Step 21g scripts の **CLI 契約テスト** — gather-context / embed-graphics / commit-approval /
// route-rework を black-box (spawn) で叩き、stdout JSON の routing 契約と書き込み副作用を固定する。
// POCTEAMA-190 (F-7 埋め込み + 承認)
//
// fixture 規約は 21b/21c/21d の eval と同じ — **golden なし**、`makeApp()` が tmpdir に毎回組み立て、
// `AYATORI_REPO_ROOT` env で差し込む (作業ツリーの artifacts/ を汚さない)。
// digest は 21e (writer) の `sourceDigestOf` から導出して埋める — writer 実装が変われば本 fixture は
// 自動追従し、乖離すれば digest 系テストが落ちて 21e↔21g の byte 一致契約 (設計 §9-2b) の破れを検知する。
//
// usage: npm test / node --test skills/21g-graphic-embed-review/evals/graphic-embed-scripts-evals.test.mjs
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceDigestOf } from "../../21e-graphic-generate/scripts/preflight.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATHER = path.join(HERE, "..", "scripts", "gather-context.mjs");
const EMBED = path.join(HERE, "..", "scripts", "embed-graphics.mjs");
const COMMIT = path.join(HERE, "..", "scripts", "commit-approval.mjs");
const ROUTE = path.join(HERE, "..", "scripts", "route-rework.mjs");
const RENDER = path.join(HERE, "..", "scripts", "render-embed-review.mjs");

const TOOL = "gpt-image-2";
const PROMPT_HERO = { graphic_id: "hero-home", prompt: "A cozy home hero. Soft watercolor style.", size_px: { width: 800, height: 400 } };
const PROMPT_CART = { graphic_id: "empty-cart", prompt: "An empty cart illustration. Soft watercolor style.", size_px: { width: 320, height: 200 }, transparent_background: true };

const HTML_HOME = `<!DOCTYPE html><html><head><title>home</title></head><body>
<header class="app-header">Header</header>
<main><h1 class="hero-title">Welcome</h1></main>
</body></html>`;
const HTML_CART = `<!DOCTYPE html><html><head><title>cart</title></head><body>
<main><div class="illust-placeholder" data-scene="empty-cart">empty</div></main>
</body></html>`;

/** fixture app を tmpdir に組み立てる (opts で state / ファイル配置を変異させる)。 */
function makeApp(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "21g-eval-"));
  const app = path.join(root, "artifacts", "testapp");
  for (const d of ["graphics", "screens/web", "screens/mobile", "screens/_shared/graphics"]) {
    fs.mkdirSync(path.join(app, d), { recursive: true });
  }

  const graphics = {
    decision: opts.noDecision ? undefined : opts.skipDecision ? "skip" : "generate",
    ...(opts.skipDecision ? { decided_by: "step21b" } : {}),
    taste_confirmed_at: "2026-08-01T10:00:00+09:00",
    prompts_confirmed_at: "2026-08-02T10:00:00+09:00",
    step21e_completed_at: "2026-08-03T10:00:00+09:00",
    ...(opts.no21f ? {} : { step21f_completed_at: "2026-08-03T11:00:00+09:00" }),
    generated_files: [
      {
        graphic_id: "hero-home",
        file: "screens/_shared/graphics/hero-home.webp",
        generated_at: "2026-08-03T10:30:00+09:00",
        ...(opts.missingDigest ? {} : { source_digest: opts.staleDigest ? "sha256:stale" : sourceDigestOf(PROMPT_HERO, TOOL) }),
      },
      {
        graphic_id: "empty-cart",
        file: "screens/_shared/graphics/empty-cart.png",
        generated_at: "2026-08-03T10:31:00+09:00",
        source_digest: sourceDigestOf(PROMPT_CART, TOOL),
      },
    ],
    ...(opts.excluded
      ? { excluded_slots: [{ graphic_id: "empty-cart", reason: "生成失敗", excluded_at: "2026-08-03T10:40:00+09:00" }] }
      : {}),
    ...(opts.allExcluded
      ? {
          excluded_slots: [
            { graphic_id: "hero-home", reason: "生成失敗", excluded_at: "2026-08-03T10:40:00+09:00" },
            { graphic_id: "empty-cart", reason: "生成失敗", excluded_at: "2026-08-03T10:40:00+09:00" },
          ],
        }
      : {}),
    ...(opts.reworkPending ? { rework_pending: [{ graphic_id: "hero-home", instruction: "キャラクターにしたい" }] } : {}),
  };
  if (graphics.decision === undefined) delete graphics.decision;

  fs.writeFileSync(
    path.join(app, "pipeline-state.json"),
    JSON.stringify(
      {
        app_name: "testapp",
        schema_version: "2026-05-22",
        approvals: {
          screens_human_approved: opts.notApproved ? false : true,
          ...(opts.alreadyApproved ? { graphics_human_approved: true, step21g_approved_at: "2026-08-04T09:00:00+09:00" } : {}),
        },
        screens: { graphics },
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(app, "graphics", "graphic-plan.json"),
    JSON.stringify(
      {
        app_name: "testapp",
        created_at: "2026-08-01T09:00:00+09:00",
        slots: [
          { graphic_id: "hero-home", screen: "01-home", platforms: ["web", "mobile"], placement: "ヒーロー領域 (ヘッダー直下)", size_role: "hero", state: "default" },
          { graphic_id: "empty-cart", screen: "02-cart", platforms: ["mobile"], placement: "空カートの illust-placeholder", size_role: "content", state: "default" },
        ],
        taste: { level1_words: ["手描き風"], level2_choice: "A", style_directive: "Soft watercolor style.", confirmed_at: "2026-08-01T10:00:00+09:00" },
      },
      null,
      2
    ) + "\n"
  );

  if (!opts.noPrompts) {
    fs.writeFileSync(
      path.join(app, "graphics", "graphic-prompts.json"),
      JSON.stringify({ app_name: "testapp", tool: TOOL, confirmed_at: "2026-08-02T10:00:00+09:00", prompts: [PROMPT_HERO, PROMPT_CART] }, null, 2) + "\n"
    );
  }

  if (opts.dualTheme) {
    fs.writeFileSync(path.join(app, "screens/web/01-home--light.html"), HTML_HOME);
    fs.writeFileSync(path.join(app, "screens/web/01-home--dark.html"), HTML_HOME);
  } else {
    fs.writeFileSync(path.join(app, "screens/web/01-home.html"), HTML_HOME);
  }
  fs.writeFileSync(path.join(app, "screens/mobile/01-home.html"), HTML_HOME);
  fs.writeFileSync(path.join(app, "screens/mobile/02-cart.html"), HTML_CART);
  if (!opts.noSpec) {
    fs.writeFileSync(path.join(app, "screens/01-home.md"), "# 01-home\n\n## 概要\nホーム画面。\n");
    fs.writeFileSync(path.join(app, "screens/02-cart.md"), "# 02-cart\n\n## 概要\nカート画面。\n");
  }
  if (!opts.noCanon) {
    fs.writeFileSync(path.join(app, "screens/_shared/graphics/hero-home.webp"), "fakewebp");
  }
  fs.writeFileSync(path.join(app, "screens/_shared/graphics/empty-cart.png"), "fakepng");
  return root;
}

function run(script, root, args, stdin) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, AYATORI_REPO_ROOT: root, AYATORI_BACKUP_COOLDOWN_SECONDS: "0" },
  });
  assert.equal(res.status, 0, `exit 0 契約 (routing は JSON の code)。stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const readState = (root) => JSON.parse(fs.readFileSync(path.join(root, "artifacts/testapp/pipeline-state.json"), "utf8"));
const readFile = (root, rel) => fs.readFileSync(path.join(root, "artifacts/testapp", rel), "utf8");

const PLACEMENTS = {
  placements: [
    { graphic_id: "hero-home", file: "screens/web/01-home.html", insert_after: '<header class="app-header">Header</header>', attrs: { width: 800, height: 400 } },
    { graphic_id: "hero-home", file: "screens/mobile/01-home.html", insert_after: '<header class="app-header">Header</header>', attrs: { width: 800, height: 400, object_fit: "cover" } },
    { graphic_id: "empty-cart", file: "screens/mobile/02-cart.html", insert_before: '<div class="illust-placeholder" data-scene="empty-cart">empty</div>', attrs: { width: 320, height: 200, class: "empty-illust" } },
  ],
};
const applyAll = (root) => run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify(PLACEMENTS));

// ── gather-context ──

test("gather: ok — 対象集合 (fresh − excluded) + 配置メタ + 埋め込み先を返す", () => {
  const root = makeApp();
  const res = run(GATHER, root, ["testapp"]);
  assert.equal(res.ok, true);
  assert.equal(res.mode, "initial");
  assert.equal(res.slot_count, 2);
  const hero = res.slots.find((s) => s.graphic_id === "hero-home");
  assert.equal(hero.canonical.basename, "hero-home.webp");
  assert.deepEqual(hero.size_px, { width: 800, height: 400 });
  assert.equal(hero.embed_targets.length, 2); // web + mobile
  assert.equal(hero.placements[0].spec_file, "screens/01-home.md");
});

test("gather: dual-theme は --light/--dark の両 main へ展開する", () => {
  const root = makeApp({ dualTheme: true });
  const hero = run(GATHER, root, ["testapp"]).slots.find((s) => s.graphic_id === "hero-home");
  const webFiles = hero.embed_targets.filter((t) => t.platform === "web").map((t) => t.file).sort();
  assert.deepEqual(webFiles, ["screens/web/01-home--dark.html", "screens/web/01-home--light.html"]);
});

test("gather: excluded slot は対象集合から除かれる (§9-2b 差集合)", () => {
  const root = makeApp({ excluded: true });
  const res = run(GATHER, root, ["testapp"]);
  assert.equal(res.slot_count, 1);
  assert.equal(res.slots[0].graphic_id, "hero-home");
});

test("gather: 前提 NG の routing code (テーブル駆動)", () => {
  for (const [opts, code] of [
    [{ notApproved: true }, "E_SCREENS_NOT_APPROVED"],
    [{ skipDecision: true }, "E_BLOCK_SKIPPED"],
    [{ noDecision: true }, "E_21B_NOT_DONE"],
    [{ alreadyApproved: true }, "E_ALREADY_APPROVED"],
    [{ no21f: true }, "E_GEN_INCOMPLETE"],
    [{ noPrompts: true }, "E_PROMPTS_MISSING"],
    [{ staleDigest: true }, "E_PENDING_SLOTS"],
    [{ missingDigest: true }, "E_PENDING_SLOTS"], // digest 欠落 = not fresh (F-5 未突合を fresh 誤判定しない)
    [{ noCanon: true }, "E_CANON_MISSING"],
    [{ allExcluded: true }, "E_EMPTY_TARGET_SET"],
  ]) {
    assert.equal(run(GATHER, makeApp(opts), ["testapp"]).code, code, JSON.stringify(opts));
  }
});

test("gather: --delta --screens で対象画面を絞る (Step 29 用) / 範囲外 0 件は ok / 未知 flag は E_USAGE", () => {
  const root = makeApp({ alreadyApproved: true });
  const res = run(GATHER, root, ["testapp", "--delta", "--screens", "02-cart"]);
  assert.equal(res.slot_count, 1);
  assert.equal(res.slots[0].graphic_id, "empty-cart");
  const none = run(GATHER, root, ["testapp", "--delta", "--screens", "99-none"]);
  assert.equal(none.ok, true);
  assert.equal(none.slot_count, 0);
  const usage = run(GATHER, root, ["testapp", "--screnes", "x"]);
  assert.equal(usage.code, "E_USAGE");
  assert.deepEqual(usage.unknown_args, ["--screnes"]);
});

test("gather: rework_pending 残置は warning (承認は commit が E_REWORK_OPEN で拒否)", () => {
  const root = makeApp({ reworkPending: true });
  const res = run(GATHER, root, ["testapp"]);
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.includes("rework_pending")));
});

// ── embed-graphics ──

test("embed apply: dry-run は何も書かない", () => {
  const root = makeApp();
  const before = readFile(root, "screens/web/01-home.html");
  const res = run(EMBED, root, ["testapp", "apply", "--stdin", "--dry-run"], JSON.stringify(PLACEMENTS));
  assert.equal(res.ok, true);
  assert.equal(res.dry_run, true);
  assert.equal(readFile(root, "screens/web/01-home.html"), before);
});

test("embed apply: C-26 準拠タグを挿入し self-backup する / 再実行は冪等 (旧タグ除去)", () => {
  const root = makeApp();
  const res = applyAll(root);
  assert.equal(res.ok, true);
  assert.equal(res.placement_count, 3);
  assert.ok(res.backed_up.length >= 1);
  const html = readFile(root, "screens/mobile/02-cart.html");
  assert.ok(html.includes('<img src="../_shared/graphics/empty-cart.png" alt="empty-cart" width="320" height="200" class="empty-illust">'));
  assert.ok(readFile(root, "screens/mobile/01-home.html").includes('style="object-fit:cover"'));
  // 再実行 — タグが重複しない
  const again = applyAll(root);
  assert.equal(again.removed_stale_tags, 3);
  const count = (readFile(root, "screens/mobile/02-cart.html").match(/alt="empty-cart"/g) ?? []).length;
  assert.equal(count, 1);
});

test("embed apply: E_ANCHOR (出現 0 件 / 2 件以上) は書き込まない", () => {
  const root = makeApp();
  const bad = JSON.parse(JSON.stringify(PLACEMENTS));
  bad.placements[0].insert_after = "<nav>no-such-anchor</nav>";
  const res = run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify(bad));
  assert.equal(res.code, "E_ANCHOR");
  assert.ok(!readFile(root, "screens/web/01-home.html").includes("<img"));
  const dup = JSON.parse(JSON.stringify(PLACEMENTS));
  dup.placements[2].insert_before = "<main>"; // 02-cart.html 内で main は 1 件 — 代わりに多重出現を作る
  fs.appendFileSync(path.join(root, "artifacts/testapp/screens/mobile/02-cart.html"), "\n<main></main>");
  const res2 = run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify(dup));
  assert.equal(res2.code, "E_ANCHOR");
});

test("embed apply: E_VALIDATION — 対象外 id / 対象外 file / 取りこぼし / attrs 不正 / anchor 二重指定 / 重複", () => {
  const root = makeApp();
  const draft = JSON.parse(JSON.stringify(PLACEMENTS));
  draft.placements[0].graphic_id = "nope";
  draft.placements[1].file = "screens/web/02-cart.html";
  draft.placements[2].attrs.width = 0;
  draft.placements[2].insert_after = "<main>";
  const res = run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify(draft));
  assert.equal(res.code, "E_VALIDATION");
  assert.ok(res.errors.some((e) => e.includes("nope")));
  assert.ok(res.errors.some((e) => e.includes("埋め込み先")));
  assert.ok(res.errors.some((e) => e.includes("width")));
  assert.ok(res.errors.some((e) => e.includes("どちらか一方")));
  assert.ok(res.errors.some((e) => e.includes("placements に無い"))); // 取りこぼし
});

test("embed verify: 埋め込み前は missing、apply 後は complete、孤児タグ・C-26 違反を検出する", () => {
  const root = makeApp();
  const before = run(EMBED, root, ["testapp", "verify"]);
  assert.equal(before.complete, false);
  assert.equal(before.missing.length, 3);
  applyAll(root);
  const after = run(EMBED, root, ["testapp", "verify"]);
  assert.equal(after.complete, true);
  // 孤児 (対象外 alt) + width 欠落タグを手で混入
  const p = path.join(root, "artifacts/testapp/screens/mobile/02-cart.html");
  fs.appendFileSync(p, '\n<img src="../_shared/graphics/ghost.png" alt="ghost">');
  const dirty = run(EMBED, root, ["testapp", "verify"]);
  assert.equal(dirty.complete, false);
  assert.equal(dirty.orphans.length, 1);
});

test("embed: E_USAGE — 未知 flag / apply に --screens / verify に --stdin・--dry-run は fail-closed", () => {
  const root = makeApp();
  assert.equal(run(EMBED, root, ["testapp", "apply", "--stdin", "--dry-rnu"], "{}").code, "E_USAGE");
  assert.equal(run(EMBED, root, ["testapp", "apply", "--stdin", "--screens", "01-home"], "{}").code, "E_USAGE");
  assert.equal(run(EMBED, root, ["testapp", "verify", "--dry-run"]).code, "E_USAGE");
});

// ── render-embed-review ──

test("render: srcdoc 内の <img> は data URI 内包で自己完結する / 正典 screens HTML は相対参照のまま (POCTEAMA-401)", () => {
  const root = makeApp();
  applyAll(root);
  const out = run(RENDER, root, ["testapp"]);
  assert.equal(out.ok, true, JSON.stringify(out));
  const html = readFile(root, "graphics/graphic-embed-review.html");
  // makeApp の正典は "fakepng" / "fakewebp" バイト列 — 埋め込まれた data URI がそれと一致すること
  assert.ok(html.includes(`data:image/png;base64,${Buffer.from("fakepng").toString("base64")}`), "empty-cart.png を data URI 内包");
  assert.ok(html.includes(`data:image/webp;base64,${Buffer.from("fakewebp").toString("base64")}`), "hero-home.webp を data URI 内包");
  // srcdoc (escSrcdoc 済み = src=&quot;...) に相対参照が残らない — 閲覧環境の file:// 読取ブロックで破像しない
  assert.ok(!/src=&quot;\.\.\/_shared\/graphics\//.test(html), "srcdoc 内に _shared への相対参照が残らない");
  // 展開は派生ビューのみ — C-26 正典相対参照 (screens/{platform}/*.html) は不変
  assert.ok(readFile(root, "screens/mobile/02-cart.html").includes('src="../_shared/graphics/empty-cart.png"'));
});

test("render: screens/ 根の外へ出る相対 <img> は内包しない (樹外ファイルの混入防止 — PR #199 Copilot 対応)", () => {
  const root = makeApp();
  applyAll(root);
  // 境界外 (screens/ の外 = graphics/ 直下) に実在ファイルを置き、手編集を模した参照を混入する
  fs.writeFileSync(path.join(root, "artifacts/testapp/graphics/leak.png"), "leakpng");
  const p = path.join(root, "artifacts/testapp/screens/mobile/02-cart.html");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("</body>", '<img src="../../graphics/leak.png" alt="leak">\n</body>'));
  const out = run(RENDER, root, ["testapp"]);
  assert.equal(out.ok, true, JSON.stringify(out));
  const html = readFile(root, "graphics/graphic-embed-review.html");
  assert.ok(html.includes("src=&quot;../../graphics/leak.png&quot;"), "境界外参照は書き換えず残す (fail-open)");
  assert.ok(!html.includes(Buffer.from("leakpng").toString("base64")), "境界外ファイルの中身を data URI として埋め込まない");
});

test("render: 解決不能な相対 <img> は fail-open でそのまま残す (不在ファイルは <base> 相対解決に委ねる)", () => {
  const root = makeApp();
  applyAll(root);
  // 対象画面に不在ファイル参照の孤児 <img> を混入 (body 閉じタグ前 — verify は通らないが render は fail-open)
  const p = path.join(root, "artifacts/testapp/screens/mobile/02-cart.html");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("</body>", '<img src="../_shared/graphics/ghost.png" alt="ghost">\n</body>'));
  const out = run(RENDER, root, ["testapp"]);
  assert.equal(out.ok, true, JSON.stringify(out));
  const html = readFile(root, "graphics/graphic-embed-review.html");
  assert.ok(html.includes("src=&quot;../_shared/graphics/ghost.png&quot;"), "不在ファイルの参照は書き換えない");
});

// ── commit-approval ──

test("commit approve: 埋め込み不完全は E_EMBED_INCOMPLETE で何も書かない", () => {
  const root = makeApp();
  const res = run(COMMIT, root, ["testapp", "approve"]);
  assert.equal(res.code, "E_EMBED_INCOMPLETE");
  assert.equal(res.missing.length, 3);
  assert.notEqual(readState(root).approvals.graphics_human_approved, true);
});

test("commit approve: dry-run は何も書かない / 本実行でフラグ + 使用グラフィック節 (冪等マーカー)", () => {
  const root = makeApp();
  applyAll(root);
  const dry = run(COMMIT, root, ["testapp", "approve", "--dry-run"]);
  assert.equal(dry.dry_run, true);
  assert.notEqual(readState(root).approvals.graphics_human_approved, true);

  const res = run(COMMIT, root, ["testapp", "approve"]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.spec_updated.sort(), ["screens/01-home.md", "screens/02-cart.md"]);
  const st = readState(root);
  assert.equal(st.approvals.graphics_human_approved, true);
  assert.ok(st.approvals.step21g_approved_at);
  const md = readFile(root, "screens/01-home.md");
  assert.ok(md.includes("<!-- ayatori:graphics-used:start -->"));
  assert.ok(md.includes("## 使用グラフィック"));
  assert.ok(md.includes("| hero-home | ヒーロー領域 (ヘッダー直下) | hero-home | AI 生成 (POCTEAMA-179)"));
  assert.equal((md.match(/ayatori:graphics-used:start/g) ?? []).length, 1);
});

test("commit approve: rework_pending 残置は E_REWORK_OPEN / 再実行 (承認済み) は E_ALREADY_APPROVED", () => {
  const rework = makeApp({ reworkPending: true });
  applyAll(rework);
  assert.equal(run(COMMIT, rework, ["testapp", "approve"]).code, "E_REWORK_OPEN");

  const root = makeApp();
  applyAll(root);
  run(COMMIT, root, ["testapp", "approve"]);
  assert.equal(run(COMMIT, root, ["testapp", "approve"]).code, "E_ALREADY_APPROVED");
});

test("commit approve: spec 不在の画面は節追記を skip する (gather warning とセットの縮退挙動)", () => {
  const root = makeApp({ noSpec: true });
  applyAll(root);
  const res = run(COMMIT, root, ["testapp", "approve"]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.spec_updated, []);
});

test("commit reject: entry 削除 + excluded append (21g 却下 prefix) + タグ除去 + 正典は孤児保持", () => {
  const root = makeApp();
  applyAll(root);
  const res = run(COMMIT, root, ["testapp", "reject", "--stdin"], JSON.stringify({ rejects: [{ graphic_id: "empty-cart", reason: "不要と判断" }] }));
  assert.equal(res.ok, true);
  assert.deepEqual(res.rejected, ["empty-cart"]);
  assert.deepEqual(res.remaining_targets, ["hero-home"]);
  const g = readState(root).screens.graphics;
  assert.ok(!g.generated_files.some((f) => f.graphic_id === "empty-cart"));
  const ex = g.excluded_slots.find((e) => e.graphic_id === "empty-cart");
  assert.ok(ex.reason.startsWith("21g 却下:"));
  assert.ok(ex.excluded_at);
  assert.ok(!readFile(root, "screens/mobile/02-cart.html").includes("<img"));
  assert.ok(fs.existsSync(path.join(root, "artifacts/testapp/screens/_shared/graphics/empty-cart.png"))); // 孤児保持
  assert.equal(g.decision, "generate"); // 残 slot あり — decision 不変
});

test("commit reject: 全対象却下で decision=skip, decided_by=step21g (21e 全除外規則と同型)", () => {
  const root = makeApp();
  applyAll(root);
  const res = run(COMMIT, root, ["testapp", "reject", "--stdin"], JSON.stringify({ rejects: [
    { graphic_id: "hero-home", reason: "方針変更" },
    { graphic_id: "empty-cart", reason: "方針変更" },
  ] }));
  assert.equal(res.decision, "skip");
  const g = readState(root).screens.graphics;
  assert.equal(g.decision, "skip");
  assert.equal(g.decided_by, "step21g");
});

test("commit reject: E_VALIDATION (reason 欠落 / 対象外 id / 重複) は何も書かない / dry-run も無書込", () => {
  const root = makeApp();
  applyAll(root);
  const res = run(COMMIT, root, ["testapp", "reject", "--stdin"], JSON.stringify({ rejects: [
    { graphic_id: "empty-cart" },
    { graphic_id: "nope", reason: "x" },
    { graphic_id: "empty-cart", reason: "dup" },
  ] }));
  assert.equal(res.code, "E_VALIDATION");
  assert.equal(readState(root).screens.graphics.generated_files.length, 2);
  const dry = run(COMMIT, root, ["testapp", "reject", "--stdin", "--dry-run"], JSON.stringify({ rejects: [{ graphic_id: "empty-cart", reason: "確認中" }] }));
  assert.equal(dry.dry_run, true);
  assert.equal(readState(root).screens.graphics.generated_files.length, 2);
});

test("commit: E_USAGE — approve に --stdin / 未知 flag は fail-closed", () => {
  const root = makeApp();
  assert.equal(run(COMMIT, root, ["testapp", "approve", "--stdin"], "{}").code, "E_USAGE");
  assert.equal(run(COMMIT, root, ["testapp", "reject", "--stdin", "--force"], "{}").code, "E_USAGE");
});

// ── route-rework ──

test("route prompt: prompts_confirmed_at クリア + rework_pending append + 21e/21f クリアを単一 Write で行う", () => {
  const root = makeApp();
  applyAll(root);
  const res = run(ROUTE, root, ["testapp", "prompt", "--stdin"], JSON.stringify({ items: [{ graphic_id: "hero-home", instruction: "キャラクターにしたい" }] }));
  assert.equal(res.ok, true);
  const g = readState(root).screens.graphics;
  assert.equal(g.prompts_confirmed_at, undefined);
  assert.equal(g.step21e_completed_at, undefined);
  assert.equal(g.step21f_completed_at, undefined);
  assert.deepEqual(g.rework_pending, [{ graphic_id: "hero-home", instruction: "キャラクターにしたい" }]);
  assert.equal(g.decision, "generate"); // 差し戻しは decision を変えない
  assert.equal(g.generated_files.length, 2); // prompt 経路は entry を消さない (stale 化は digest 不一致で起きる)
});

test("route prompt: 同一 graphic_id の既存 entry は instruction を置き換える (二重積み禁止)", () => {
  const root = makeApp({ reworkPending: true });
  const res = run(ROUTE, root, ["testapp", "prompt", "--stdin"], JSON.stringify({ items: [{ graphic_id: "hero-home", instruction: "座っているポーズで" }] }));
  assert.equal(res.ok, true);
  const g = readState(root).screens.graphics;
  assert.equal(g.rework_pending.length, 1);
  assert.equal(g.rework_pending[0].instruction, "座っているポーズで");
});

test("route quality: generated_files entry 削除 + 21e/21f クリア (rework_pending は積まない)", () => {
  const root = makeApp();
  applyAll(root);
  const res = run(ROUTE, root, ["testapp", "quality", "--stdin"], JSON.stringify({ items: [{ graphic_id: "empty-cart" }] }));
  assert.equal(res.ok, true);
  const g = readState(root).screens.graphics;
  assert.ok(!g.generated_files.some((f) => f.graphic_id === "empty-cart"));
  assert.equal(g.step21e_completed_at, undefined);
  assert.equal(g.rework_pending, undefined);
  assert.equal(g.prompts_confirmed_at, "2026-08-02T10:00:00+09:00"); // quality は 21d を経由しない
});

test("route: E_VALIDATION (prompt の instruction 欠落 / quality に instruction / 対象外 id) / dry-run 無書込 / E_USAGE", () => {
  const root = makeApp();
  assert.equal(
    run(ROUTE, root, ["testapp", "prompt", "--stdin"], JSON.stringify({ items: [{ graphic_id: "hero-home" }] })).code,
    "E_VALIDATION"
  );
  assert.equal(
    run(ROUTE, root, ["testapp", "quality", "--stdin"], JSON.stringify({ items: [{ graphic_id: "hero-home", instruction: "x" }] })).code,
    "E_VALIDATION"
  );
  assert.equal(
    run(ROUTE, root, ["testapp", "prompt", "--stdin"], JSON.stringify({ items: [{ graphic_id: "nope", instruction: "x" }] })).code,
    "E_VALIDATION"
  );
  const dry = run(ROUTE, root, ["testapp", "prompt", "--stdin", "--dry-run"], JSON.stringify({ items: [{ graphic_id: "hero-home", instruction: "x" }] }));
  assert.equal(dry.dry_run, true);
  assert.equal(readState(root).screens.graphics.prompts_confirmed_at, "2026-08-02T10:00:00+09:00");
  assert.equal(run(ROUTE, root, ["testapp", "prompt"]).code, "E_USAGE"); // --stdin 必須 (hang 防止)
});

// ── delta mode (Step 29 再埋め込み — §9-2b の 21g/29 共通契約) ──

test("delta: --delta は承認済みを要求する (未承認 = E_NOT_APPROVED / 承認済み本流 = E_ALREADY_APPROVED)", () => {
  const root = makeApp();
  assert.equal(run(GATHER, root, ["testapp", "--delta"]).code, "E_NOT_APPROVED");
  const approved = makeApp({ alreadyApproved: true });
  assert.equal(run(GATHER, approved, ["testapp", "--delta"]).ok, true);
  assert.equal(run(GATHER, approved, ["testapp"]).code, "E_ALREADY_APPROVED");
});

test("delta: apply --delta --screens で再生成画面のみ再埋め込みできる (Step 29 Step 4a)", () => {
  const root = makeApp({ alreadyApproved: true });
  // Step 4 の再生成を模す: 01-home.html が素の HTML に戻っている (タグ消失) 状態から再埋め込み
  const res = run(EMBED, root, ["testapp", "apply", "--stdin", "--delta", "--screens", "01-home"], JSON.stringify({
    placements: PLACEMENTS.placements.filter((p) => p.file.includes("01-home")),
  }));
  assert.equal(res.ok, true);
  assert.equal(res.placement_count, 2);
  assert.ok(readFile(root, "screens/web/01-home.html").includes('alt="hero-home"'));
  assert.ok(!readFile(root, "screens/mobile/02-cart.html").includes("<img")); // 範囲外は触らない
  const verify = run(EMBED, root, ["testapp", "verify", "--delta", "--screens", "01-home"]);
  assert.equal(verify.complete, true);
});

test("delta: specs mode が使用グラフィック節を state から再 append する (approvals は不変)", () => {
  const root = makeApp({ alreadyApproved: true });
  // 埋め込み未完了のまま specs は書けない (Step 4a の順序違反 gate — Copilot R3-2)
  const premature = run(COMMIT, root, ["testapp", "specs", "--screens", "01-home"]);
  assert.equal(premature.code, "E_EMBED_INCOMPLETE");
  assert.ok(!readFile(root, "screens/01-home.md").includes("使用グラフィック"));
  // Step 4a の 2 (apply) を経てから specs (正規順序)
  run(EMBED, root, ["testapp", "apply", "--stdin", "--delta", "--screens", "01-home"], JSON.stringify({
    placements: PLACEMENTS.placements.filter((p) => p.file.includes("01-home")),
  }));
  const res = run(COMMIT, root, ["testapp", "specs", "--screens", "01-home"]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.spec_updated, ["screens/01-home.md"]);
  const md = readFile(root, "screens/01-home.md");
  assert.ok(md.includes("## 使用グラフィック"));
  assert.ok(md.includes("2026-08-04T09:00:00+09:00")); // 由来の承認日 = 元の step21g_approved_at
  assert.equal(readState(root).approvals.step21g_approved_at, "2026-08-04T09:00:00+09:00");
  // 冪等: 再実行でマーカー節は 1 つのまま
  run(COMMIT, root, ["testapp", "specs", "--screens", "01-home"]);
  assert.equal((readFile(root, "screens/01-home.md").match(/ayatori:graphics-used:start/g) ?? []).length, 1);
});

test("delta: E_USAGE — specs 以外に --screens / specs に --dry-run は fail-closed", () => {
  const root = makeApp({ alreadyApproved: true });
  assert.equal(run(COMMIT, root, ["testapp", "approve", "--screens", "01-home"]).code, "E_USAGE");
  assert.equal(run(COMMIT, root, ["testapp", "specs", "--dry-run"]).code, "E_USAGE");
});

// ── Round 1 self-review regression (POCTEAMA-190 多段レビュー) ──

test("route: 同一ゲート内で複数分類を続けて記録できる — prompt → quality / quality → prompt (M1)", () => {
  const root = makeApp();
  applyAll(root);
  assert.equal(run(ROUTE, root, ["testapp", "prompt", "--stdin"], JSON.stringify({ items: [{ graphic_id: "hero-home", instruction: "キャラクターにしたい" }] })).ok, true);
  const second = run(ROUTE, root, ["testapp", "quality", "--stdin"], JSON.stringify({ items: [{ graphic_id: "empty-cart" }] }));
  assert.equal(second.ok, true, `2 分類目が拒否された (指示の記録が消失する): ${JSON.stringify(second)}`);
  const g = readState(root).screens.graphics;
  assert.deepEqual(g.rework_pending, [{ graphic_id: "hero-home", instruction: "キャラクターにしたい" }]);
  assert.ok(!g.generated_files.some((f) => f.graphic_id === "empty-cart"));
  // 逆順 (quality → prompt) も記録できる — quality 済み slot への追加 prompt 指示も可
  const root2 = makeApp();
  applyAll(root2);
  assert.equal(run(ROUTE, root2, ["testapp", "quality", "--stdin"], JSON.stringify({ items: [{ graphic_id: "empty-cart" }] })).ok, true);
  assert.equal(run(ROUTE, root2, ["testapp", "prompt", "--stdin"], JSON.stringify({ items: [{ graphic_id: "empty-cart", instruction: "絵柄も変えて" }] })).ok, true);
});

test("route: 防御は rework mode でも維持 — excluded id は E_VALIDATION / 承認済みは E_ALREADY_APPROVED (M1)", () => {
  const root = makeApp({ excluded: true });
  assert.equal(run(ROUTE, root, ["testapp", "quality", "--stdin"], JSON.stringify({ items: [{ graphic_id: "empty-cart" }] })).code, "E_VALIDATION");
  const approved = makeApp({ alreadyApproved: true });
  assert.equal(run(ROUTE, approved, ["testapp", "prompt", "--stdin"], JSON.stringify({ items: [{ graphic_id: "hero-home", instruction: "x" }] })).code, "E_ALREADY_APPROVED");
});

test("preflight: app_name のパス・トラバーサルは E_INVALID_APP_NAME (M2 — 21e と同一 guard)", () => {
  const root = makeApp();
  assert.equal(run(GATHER, root, ["../outside"]).code, "E_INVALID_APP_NAME");
  assert.equal(run(EMBED, root, ["../outside", "verify"]).code, "E_INVALID_APP_NAME");
});

test("gather: E_PROMPTS_INVALID — 破損 entry (size_px 欠落) / graphic_id 重複は fail-closed (m3/m4)", () => {
  const root = makeApp();
  const p = path.join(root, "artifacts/testapp/graphics/graphic-prompts.json");
  const base = JSON.parse(fs.readFileSync(p, "utf8"));
  fs.writeFileSync(p, JSON.stringify({ ...base, prompts: [{ graphic_id: "hero-home", prompt: "x" }] }));
  assert.equal(run(GATHER, root, ["testapp"]).code, "E_PROMPTS_INVALID"); // exit 1 (TypeError) ではなく routing
  fs.writeFileSync(p, JSON.stringify({ ...base, prompts: [base.prompts[0], base.prompts[0], base.prompts[1]] }));
  const dup = run(GATHER, root, ["testapp"]);
  assert.equal(dup.code, "E_PROMPTS_INVALID");
  assert.deepEqual(dup.duplicates, ["hero-home"]);
});

test("commit approve: 埋め込み先 0 件の slot は E_TARGET_FILES_MISSING で fail-closed (m5 — 画面リネーム)", () => {
  const root = makeApp();
  const app = path.join(root, "artifacts", "testapp");
  fs.renameSync(path.join(app, "screens/web/01-home.html"), path.join(app, "screens/web/01-dashboard.html"));
  fs.renameSync(path.join(app, "screens/mobile/01-home.html"), path.join(app, "screens/mobile/01-dashboard.html"));
  const res = run(COMMIT, root, ["testapp", "approve", "--dry-run"]);
  assert.equal(res.code, "E_TARGET_FILES_MISSING");
  assert.deepEqual(res.combos, [
    { graphic_id: "hero-home", screen: "01-home", platform: "web" },
    { graphic_id: "hero-home", screen: "01-home", platform: "mobile" },
  ]);
  assert.ok(!readFile(root, "screens/01-home.md").includes("使用グラフィック")); // 節も書かれていない
});

test("embed apply: 対象外 graphic_id の孤児タグを除去する (m6 — 埋め込み後に excluded 化した slot)", () => {
  const root = makeApp();
  applyAll(root);
  // 21e commit-degrade 相当: empty-cart を excluded 化 (generated entry 削除 + excluded_slots append)
  const app = path.join(root, "artifacts", "testapp");
  const st = readState(root);
  st.screens.graphics.generated_files = st.screens.graphics.generated_files.filter((g) => g.graphic_id !== "empty-cart");
  st.screens.graphics.excluded_slots = [{ graphic_id: "empty-cart", reason: "再生成失敗", excluded_at: "2026-08-04T10:00:00+09:00" }];
  fs.writeFileSync(path.join(app, "pipeline-state.json"), JSON.stringify(st, null, 2) + "\n");
  assert.ok(readFile(root, "screens/mobile/02-cart.html").includes('alt="empty-cart"'));
  const heroOnly = { placements: PLACEMENTS.placements.filter((p) => p.graphic_id === "hero-home") };
  const dry = run(EMBED, root, ["testapp", "apply", "--stdin", "--dry-run"], JSON.stringify(heroOnly));
  assert.equal(dry.orphan_tags_to_remove.length, 1); // dry-run は予告のみ (無書込)
  assert.ok(readFile(root, "screens/mobile/02-cart.html").includes('alt="empty-cart"'));
  const res = run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify(heroOnly));
  assert.equal(res.removed_orphan_tags.length, 1);
  assert.ok(!readFile(root, "screens/mobile/02-cart.html").includes('alt="empty-cart"'));
  assert.equal(run(EMBED, root, ["testapp", "verify"]).complete, true); // 孤児解消 → approve が通る状態
});

test("embed apply: E_VALIDATION — insert_before が非 string は片側が有効でも fail-closed (n8)", () => {
  const root = makeApp();
  const bad = { placements: PLACEMENTS.placements.map((p, i) => (i === 0 ? { ...p, insert_before: 123 } : p)) };
  assert.equal(run(EMBED, root, ["testapp", "apply", "--stdin", "--dry-run"], JSON.stringify(bad)).code, "E_VALIDATION");
});

test("commit reject: 全 slot 却下で rework_pending 残置は破棄扱い warning を出す (n9 — 21d skip と同型)", () => {
  const root = makeApp({ reworkPending: true });
  applyAll(root);
  const res = run(COMMIT, root, ["testapp", "reject", "--stdin"], JSON.stringify({
    rejects: [
      { graphic_id: "hero-home", reason: "不要" },
      { graphic_id: "empty-cart", reason: "不要" },
    ],
  }));
  assert.equal(res.decision, "skip");
  assert.ok(res.warnings?.some((w) => w.includes("破棄扱い")), `warning 欠落: ${JSON.stringify(res)}`);
});

// ── Round 2 re-review regression ──

test("embed apply: anchor 内の $$ / $& を GetSubstitution 展開しない (R2-1 — 逐語保持)", () => {
  const root = makeApp();
  const app = path.join(root, "artifacts", "testapp");
  const priceAnchor = '<h1 class="hero-title">Total $$100 &amp; $&amp;</h1>';
  fs.writeFileSync(
    path.join(app, "screens/web/01-home.html"),
    readFile(root, "screens/web/01-home.html").replace('<h1 class="hero-title">Welcome</h1>', () => priceAnchor)
  );
  const placements = {
    placements: PLACEMENTS.placements.map((p) =>
      p.file === "screens/web/01-home.html" ? { ...p, insert_after: priceAnchor } : p
    ),
  };
  assert.equal(run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify(placements)).ok, true);
  const html = readFile(root, "screens/web/01-home.html");
  assert.ok(html.includes(priceAnchor), `anchor が $-展開で破壊された: ${html}`); // $$→$ / $&→match の混入なし
  assert.equal((html.match(/alt="hero-home"/g) ?? []).length, 1);
});

test("commit approve: placement 由来の $$ / $& が使用グラフィック節で展開されない (R2-1)", () => {
  const root = makeApp();
  const app = path.join(root, "artifacts", "testapp");
  const plan = JSON.parse(readFile(root, "graphics/graphic-plan.json"));
  plan.slots[0].placement = "ヒーロー領域 ($$100 表示と $& の隣)";
  fs.writeFileSync(path.join(app, "graphics/graphic-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  applyAll(root);
  assert.equal(run(COMMIT, root, ["testapp", "approve"]).ok, true);
  const md = readFile(root, "screens/01-home.md");
  assert.ok(md.includes("$$100"), `placement の $$ が展開された: ${md}`);
  assert.ok(md.includes("$&"), `placement の $& が展開された: ${md}`);
  // 再 approve (マーカー置換経路) でも逐語のまま
  const st = readState(root);
  delete st.approvals.graphics_human_approved;
  fs.writeFileSync(path.join(app, "pipeline-state.json"), JSON.stringify(st, null, 2) + "\n");
  assert.equal(run(COMMIT, root, ["testapp", "approve"]).ok, true);
  const md2 = readFile(root, "screens/01-home.md");
  assert.ok(md2.includes("$$100") && md2.includes("$&"));
  assert.equal((md2.match(/ayatori:graphics-used:start/g) ?? []).length, 1);
});

test("embed: 対象 slot でも埋め込み先集合に無いファイルへの残置タグは孤児 (R2-2 — plan 再確定で配置が移った)", () => {
  const root = makeApp();
  applyAll(root);
  // plan 再確定相当: hero-home の配置が web から外れて mobile のみになった
  const app = path.join(root, "artifacts", "testapp");
  const plan = JSON.parse(readFile(root, "graphics/graphic-plan.json"));
  plan.slots[0].platforms = ["mobile"];
  fs.writeFileSync(path.join(app, "graphics/graphic-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  const verify = run(EMBED, root, ["testapp", "verify"]);
  assert.equal(verify.complete, false);
  assert.deepEqual(verify.orphans, [{ file: "screens/web/01-home.html", alt: "hero-home", src: "../_shared/graphics/hero-home.webp" }]);
  // apply が移動元のタグを sweep する (mobile のみの placements で被覆)
  const res = run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify({
    placements: PLACEMENTS.placements.filter((p) => !p.file.startsWith("screens/web/")),
  }));
  assert.equal(res.removed_orphan_tags.length, 1);
  assert.ok(!readFile(root, "screens/web/01-home.html").includes('alt="hero-home"'));
  assert.equal(run(EMBED, root, ["testapp", "verify"]).complete, true);
});

test("gather / embed verify: --screens 単独 (--delta なし) は E_USAGE (R2-3 — 本流の誤絞り込み防止)", () => {
  const root = makeApp();
  assert.equal(run(GATHER, root, ["testapp", "--screens", "01-home"]).code, "E_USAGE");
  assert.equal(run(EMBED, root, ["testapp", "verify", "--screens", "01-home"]).code, "E_USAGE");
});

// ── Round 3 Copilot CLI review regression ──

test("部分欠落も E_TARGET_FILES_MISSING — 2 platform 中 1 つのリネームで黙って落とさない (R3-1)", () => {
  const root = makeApp();
  const app = path.join(root, "artifacts", "testapp");
  fs.renameSync(path.join(app, "screens/mobile/01-home.html"), path.join(app, "screens/mobile/01-dashboard.html"));
  const expected = [{ graphic_id: "hero-home", screen: "01-home", platform: "mobile" }];
  for (const [script, args] of [
    [GATHER, ["testapp"]],
    [EMBED, ["testapp", "verify"]],
    [COMMIT, ["testapp", "approve", "--dry-run"]],
  ]) {
    const res = run(script, root, args);
    assert.equal(res.code, "E_TARGET_FILES_MISSING", `${path.basename(script)} が部分欠落を素通しした`);
    assert.deepEqual(res.combos, expected);
  }
  // 却下は本状態からの復旧経路 — 同 assert に弾かれない (円環防止)
  const reject = run(COMMIT, root, ["testapp", "reject", "--stdin"], JSON.stringify({ rejects: [{ graphic_id: "hero-home", reason: "画面構成変更で不要" }] }));
  assert.equal(reject.ok, true);
});

test("delta gather: noSpec warning は --screens の対象範囲のみ (R3-3)", () => {
  const root = makeApp({ alreadyApproved: true, noSpec: true });
  const res = run(GATHER, root, ["testapp", "--delta", "--screens", "01-home"]);
  assert.equal(res.ok, true);
  const specWarnings = res.warnings.filter((w) => w.includes("画面仕様書"));
  assert.ok(specWarnings.length === 1 && specWarnings[0].includes("01-home") && !specWarnings[0].includes("02-cart"));
});

// ── Round 6 fixture standalone 実行の気づき regression ──

test("embed apply: anchor が末尾改行を含んでも <img> は独立行に正規化される (R6-1 — 同一行連結防止)", () => {
  const root = makeApp();
  const placements = {
    placements: PLACEMENTS.placements.map((p) =>
      p.file === "screens/web/01-home.html"
        ? { ...p, insert_after: '<header class="app-header">Header</header>\n' } // 末尾改行込みの合法 anchor
        : p
    ),
  };
  assert.equal(run(EMBED, root, ["testapp", "apply", "--stdin"], JSON.stringify(placements)).ok, true);
  for (const rel of ["screens/web/01-home.html", "screens/mobile/01-home.html", "screens/mobile/02-cart.html"]) {
    for (const line of readFile(root, rel).split("\n")) {
      if (!line.includes("_shared/graphics/")) continue;
      assert.ok(/^<img [^>]*>$/.test(line), `${rel}: <img> が独立行でない: ${JSON.stringify(line)}`);
    }
  }
});

test("commit approve: 置き換え指定 placeholder の残置を warning で検出する (R6-3 — Edit 除去漏れ)", () => {
  const root = makeApp();
  applyAll(root);
  // HTML_CART の placeholder (data-scene=empty-cart) を Edit 除去しないまま approve dry-run
  const dry = run(COMMIT, root, ["testapp", "approve", "--dry-run"]);
  assert.equal(dry.ok, true); // fail ではなく warning (data-scene ↔ graphic_id の一致は慣例で不変量ではない)
  assert.ok(
    dry.warnings?.some((w) => w.includes("placeholder 残置") && w.includes("empty-cart")),
    `残置 warning が無い: ${JSON.stringify(dry)}`
  );
  assert.ok(!dry.warnings?.some((w) => w.includes("hero-home"))); // placeholder が無い slot は警告しない
  // Edit 除去相当の置換後は warning 消滅 + 本実行の出力にも warning が無い
  const app = path.join(root, "artifacts", "testapp");
  fs.writeFileSync(
    path.join(app, "screens/mobile/02-cart.html"),
    readFile(root, "screens/mobile/02-cart.html").replace(/<div class="illust-placeholder"[^>]*>empty<\/div>\n?/, "")
  );
  const clean = run(COMMIT, root, ["testapp", "approve"]);
  assert.equal(clean.ok, true);
  assert.ok(!clean.warnings, `除去後も warning が残る: ${JSON.stringify(clean.warnings)}`);
});

test("commit reject: placeholder 置き換え型 slot の却下は復帰手順 warning を出す (E2E 派生 — 空白領域化の指摘)", () => {
  const root = makeApp();
  applyAll(root);
  // empty-cart の placement は「空カートの illust-placeholder」— placeholder 置き換え型
  const res = run(COMMIT, root, ["testapp", "reject", "--stdin"], JSON.stringify({ rejects: [{ graphic_id: "empty-cart", reason: "不要" }] }));
  assert.equal(res.ok, true);
  assert.ok(res.warnings?.some((w) => w.includes("empty-cart") && w.includes("_backup/")), `復帰 warning 欠落: ${JSON.stringify(res)}`);
  // placeholder 型でない hero-home の却下には出ない
  const root2 = makeApp();
  applyAll(root2);
  const res2 = run(COMMIT, root2, ["testapp", "reject", "--stdin"], JSON.stringify({ rejects: [{ graphic_id: "hero-home", reason: "不要" }] }));
  assert.ok(!res2.warnings?.some((w) => w.includes("placeholder 置き換え型")), JSON.stringify(res2.warnings));
});

// ── 横断 ──

test("scripts に NUL byte が無い (git diff 可能なテキストであること)", () => {
  for (const p of [GATHER, EMBED, COMMIT, ROUTE, RENDER, path.join(HERE, "..", "scripts", "preflight.mjs")]) {
    assert.ok(!fs.readFileSync(p).includes(0), `${path.basename(p)} に NUL byte`);
  }
});
