#!/usr/bin/env node
// skills/21d-graphic-prompts/evals/graphic-prompts-scripts-evals.test.mjs
//
// Step 21d の同梱 script 2 本 (gather-context / commit-prompts) の **CLI 契約テスト**:
// 黒箱 CLI として fixture (tmpdir に組み立てた artifacts ツリー) に対して回し、stdout JSON の
// routing 契約 (ok / E_* code) と書き込み副作用 (graphic-prompts.json / pipeline-state.json /
// rework_pending 消費 / _backup 退避) を固定する。
//
// fixture 規約: 21b / 21c の eval と同じ — golden なし、makeApp() が tmpdir に毎回組み立て、
// AYATORI_REPO_ROOT env で差し込む (作業ツリーの artifacts/ を汚さない)。
//
// 使い方:
//   npm test                                                                               # 検証 (node --test discovery)
//   node --test skills/21d-graphic-prompts/evals/graphic-prompts-scripts-evals.test.mjs    # 本 eval のみ
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATHER = join(HERE, "..", "scripts", "gather-context.mjs");
const COMMIT = join(HERE, "..", "scripts", "commit-prompts.mjs");
const APP = "testapp";

const STYLE_DIRECTIVE =
  "Soft watercolor illustration style without outlines, generous negative space, gentle muted colors harmonized with #0E7C90 (teal) and #EAF2F4 (light celadon), on a light background.";

/** tmpdir に artifacts/testapp の fixture ツリーを組み立てる。opts で状態を変形する。 */
function makeApp(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "21d-eval-"));
  const app = join(root, "artifacts", APP);
  mkdirSync(join(app, "graphics"), { recursive: true });

  const graphics = {
    decision: "generate",
    step21a_completed_at: "2026-07-16T10:00:00+09:00",
    taste_confirmed_at: "2026-07-17T09:00:00+09:00",
  };
  if (opts.noDecision) delete graphics.decision;
  if (opts.skipDecision) Object.assign(graphics, { decision: "skip", decided_by: "step21b" });
  if (opts.noTaste) delete graphics.taste_confirmed_at;
  if (opts.promptsConfirmed) graphics.prompts_confirmed_at = "2026-07-18T09:00:00+09:00";
  if (opts.rework) graphics.rework_pending = opts.rework;
  if (opts.excluded) graphics.excluded_slots = opts.excluded;
  const state = {
    schema_version: "2026-05-22",
    app_name: APP,
    approvals: { screens_human_approved: !opts.notApproved },
    screens: { graphics },
  };
  writeFileSync(join(app, "pipeline-state.json"), JSON.stringify(state, null, 2));

  if (!opts.noPlan) {
    const plan = {
      schema_version: "2026-07-14",
      app_name: APP,
      created_at: "2026-07-16T12:00:00+09:00",
      slots: opts.emptySlots
        ? []
        : [
            { graphic_id: "empty-cart", screen: "01-login", platforms: ["web"], placement: "empty state の illust-placeholder", size_role: "content", state: "default" },
            { graphic_id: "hero-dashboard", screen: "02-dashboard", platforms: ["web"], placement: "ヒーロー領域 (ヘッダー直下)", size_role: "hero", state: "default" },
          ],
      ...(opts.noPlanTaste
        ? {}
        : {
            taste: {
              level1_words: ["洗練"],
              level2_choice: "A",
              style_directive: STYLE_DIRECTIVE,
              sample_files: ["graphics/samples/taste-a.png"],
              palette_hints: ["#0E7C90 (global.color.primary)", "#EAF2F4 (global.color.bg)"],
              confirmed_at: "2026-07-17T09:00:00+09:00",
            },
          }),
    };
    writeFileSync(join(app, "graphics", "graphic-plan.json"), JSON.stringify(plan, null, 2));
  }

  if (opts.specFiles) {
    mkdirSync(join(app, "screens"), { recursive: true });
    for (const s of opts.specFiles) writeFileSync(join(app, "screens", `${s}.md`), `# ${s}\n`);
  }
  if (opts.mainHtml) {
    for (const [p, files] of Object.entries(opts.mainHtml)) {
      mkdirSync(join(app, "screens", p), { recursive: true });
      for (const f of files) writeFileSync(join(app, "screens", p, f), "<html></html>");
    }
  }
  if (opts.existingPrompts) {
    writeFileSync(join(app, "graphics", "graphic-prompts.json"), JSON.stringify(opts.existingPrompts, null, 2));
  }

  return { root, app };
}

/** script を黒箱 CLI として実行する。 */
function run(script, root, args, stdin, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, AYATORI_REPO_ROOT: root, AYATORI_IMAGE_MODEL: "", ...env },
    input: stdin,
  });
  assert.equal(res.status, 0, `exit 0 契約 (routing は JSON の code で行う)。stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const readState = (app) => JSON.parse(readFileSync(join(app, "pipeline-state.json"), "utf8"));
const readPrompts = (app) => JSON.parse(readFileSync(join(app, "graphics", "graphic-prompts.json"), "utf8"));
const promptsPath = (app) => join(app, "graphics", "graphic-prompts.json");

const entry = (id, over = {}) => ({
  graphic_id: id,
  prompt: `A slot-specific English subject for ${id}, centered composition. ${STYLE_DIRECTIVE}`,
  size_px: id === "hero-dashboard" ? { width: 800, height: 400 } : { width: 320, height: 200 },
  ...over,
});
const VALID_DRAFT = { prompts: [entry("empty-cart", { transparent_background: true }), entry("hero-dashboard")] };

// ── gather-context.mjs ───────────────────────────────────────────────────────

test("gather: ok — slot 要約 (spec pointer + preview_files + size_px_hint) / taste 返却 / mode=initial / spec 不在 warning", () => {
  const { root } = makeApp({ specFiles: ["01-login"], mainHtml: { web: ["01-login.html", "02-dashboard.html"] } });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.mode, "initial");
    assert.equal(out.slot_count, 2);
    assert.equal(out.slots[0].spec_file, "screens/01-login.md");
    assert.equal(out.slots[1].spec_file, null, "仕様書不在は null pointer");
    assert.deepEqual(out.slots[0].preview_files, ["screens/web/01-login.html"]);
    assert.deepEqual(out.slots[1].preview_files, ["screens/web/02-dashboard.html"]);
    assert.deepEqual(out.slots[0].size_px_hint, { width: 320, height: 200 }); // content
    assert.deepEqual(out.slots[1].size_px_hint, { width: 800, height: 400 }); // hero
    assert.equal(out.taste.style_directive, STYLE_DIRECTIVE);
    assert.deepEqual(out.taste.palette_hints, ["#0E7C90 (global.color.primary)", "#EAF2F4 (global.color.bg)"]);
    assert.deepEqual(out.taste.sample_files, ["graphics/samples/taste-a.png"], "人間ゲート preview 用に sample_files も返す (review 1st round finding 2 回帰)");
    assert.deepEqual(out.rework_pending, []);
    assert.equal(out.existing_prompts, null);
    assert.ok(out.warnings.some((w) => w.includes("02-dashboard")), "仕様書不在の画面を warning で明示");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, opts, code] of [
  ["Step 21 未承認", { notApproved: true }, "E_SCREENS_NOT_APPROVED"],
  ["21b 未確定", { noDecision: true }, "E_21B_NOT_DONE"],
  ["ブロック skip 確定", { skipDecision: true }, "E_BLOCK_SKIPPED"],
  ["テイスト未確定", { noTaste: true }, "E_TASTE_NOT_SET"],
  ["プロンプト確定済み", { promptsConfirmed: true }, "E_PROMPTS_ALREADY_SET"],
  ["plan 不在", { noPlan: true }, "E_PLAN_MISSING"],
  ["plan slots 空", { emptySlots: true }, "E_PLAN_INVALID"],
  ["plan taste 欠落 (state と不整合)", { noPlanTaste: true }, "E_TASTE_MISSING"],
]) {
  test(`gather: ${name} → ${code}`, () => {
    const { root } = makeApp(opts);
    try {
      const out = run(GATHER, root, [APP]);
      assert.equal(out.ok, false);
      assert.equal(out.code, code);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("gather: preview_files は dual_theme 命名 (--light/--dark) へ解決し、main HTML 不在は空配列 + warning (review 2nd round 回帰)", () => {
  const { root } = makeApp({
    mainHtml: { web: ["01-login--light.html", "01-login--dark.html", "01-login--empty--light.html"] }, // 02-dashboard は不在
  });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(
      [...out.slots[0].preview_files].sort(), // readdir 順は環境非保証のため順序非依存で比較
      ["screens/web/01-login--dark.html", "screens/web/01-login--light.html"],
      "論理 stem → dual_theme 実ファイル 2 件へ解決 (sub-state variant --empty は除外)"
    );
    assert.deepEqual(out.slots[1].preview_files, []);
    assert.ok(out.warnings.some((w) => w.includes("main HTML が見つからない") && w.includes("02-dashboard (web)")), JSON.stringify(out.warnings));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: rework_pending あり → mode=rework + 残置 prompts の逐語 entry 返却 / 対象外 id は warning", () => {
  const existing = {
    schema_version: "2026-07-14",
    app_name: APP,
    tool: "gpt-image-2",
    confirmed_at: "2026-07-18T09:00:00+09:00",
    prompts: VALID_DRAFT.prompts,
  };
  const { root } = makeApp({
    rework: [
      { graphic_id: "hero-dashboard", instruction: "キャラクターを 2 人にしたい" },
      { graphic_id: "no-such-slot", instruction: "stale" },
    ],
    existingPrompts: existing,
  });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.mode, "rework");
    assert.equal(out.existing_prompts.file, "graphics/graphic-prompts.json");
    assert.deepEqual(out.existing_prompts.entries, VALID_DRAFT.prompts, "逐語再利用素材として entry をそのまま返す");
    assert.ok(out.warnings.some((w) => w.includes("no-such-slot")), "plan に無い rework entry は warning");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: excluded_slots の slot は対象から除外して列挙 / 全 slot 除外は E_ALL_SLOTS_EXCLUDED", () => {
  const one = makeApp({ excluded: [{ graphic_id: "empty-cart", reason: "生成失敗", excluded_at: "2026-07-18T00:00:00+09:00" }] });
  try {
    const out = run(GATHER, one.root, [APP]);
    assert.equal(out.ok, true);
    assert.deepEqual(out.slots.map((s) => s.graphic_id), ["hero-dashboard"]);
    assert.equal(out.excluded_slots.length, 1);
  } finally {
    rmSync(one.root, { recursive: true, force: true });
  }
  const all = makeApp({
    excluded: [
      { graphic_id: "empty-cart", reason: "生成失敗", excluded_at: "2026-07-18T00:00:00+09:00" },
      { graphic_id: "hero-dashboard", reason: "生成失敗", excluded_at: "2026-07-18T00:00:00+09:00" },
    ],
  });
  try {
    assert.equal(run(GATHER, all.root, [APP]).code, "E_ALL_SLOTS_EXCLUDED");
    assert.equal(run(COMMIT, all.root, [APP, "skip"]).code, "E_ALL_SLOTS_EXCLUDED", "共有 preflight — commit (skip 含む) も同一 code (decided_by=step21e の責務を step21d が奪わない)");
  } finally {
    rmSync(all.root, { recursive: true, force: true });
  }
});

test("gather: 引数なし → E_USAGE / 不在 app → E_APP_NOT_FOUND / state 破損 → E_STATE_MISSING", () => {
  const { root, app } = makeApp();
  try {
    assert.equal(run(GATHER, root, []).code, "E_USAGE");
    assert.equal(run(GATHER, root, ["no-such-app"]).code, "E_APP_NOT_FOUND");
    writeFileSync(join(app, "pipeline-state.json"), "not json {");
    assert.equal(run(GATHER, root, [APP]).code, "E_STATE_MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-prompts.mjs: confirm ──────────────────────────────────────────────

test("commit confirm: ok — prompts ファイル一括生成 (tool 既定値 / confirmed_at 採番) + state 同値 + 既存キー保全", () => {
  const { root, app } = makeApp();
  try {
    const out = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(VALID_DRAFT));
    assert.equal(out.ok, true, JSON.stringify(out));
    const file = readPrompts(app);
    assert.equal("schema_version" in file, false, "deprecated field は新規に書かない (schema description)");
    assert.equal(file.app_name, APP);
    assert.equal(file.tool, "gpt-image-2", "tool 省略時は既定値を明示記録");
    assert.equal(file.prompts.length, 2);
    assert.equal(file.prompts[0].transparent_background, true);
    assert.match(file.confirmed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const g = readState(app).screens.graphics;
    assert.equal(g.prompts_confirmed_at, file.confirmed_at, "file と state の confirmed_at 同値契約");
    assert.equal(g.decision, "generate", "merge write で既存キー保全");
    assert.equal(g.taste_confirmed_at, "2026-07-17T09:00:00+09:00");
    assert.deepEqual(out.omitted, []);
    assert.ok(out.next.includes("21e"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: tool 明示指定の反映 / AYATORI_IMAGE_MODEL (env) は永続 tool を汚染しない", () => {
  const a = makeApp();
  try {
    run(COMMIT, a.root, [APP, "confirm", "--stdin"], JSON.stringify({ ...VALID_DRAFT, tool: "custom-tool" }));
    assert.equal(readPrompts(a.app).tool, "custom-tool");
  } finally {
    rmSync(a.root, { recursive: true, force: true });
  }
  const b = makeApp();
  try {
    // env はあくまで 21e の実行時呼び出し先を差し替える一時 knob — 21d が確定・永続化する tool
    // (21e の source_digest 材料) には混ぜない。shell に残った実験用 env がプロジェクトの正式 tool
    // として無言で焼き込まれる事故 (digest の環境非依存不変量の破り) の回帰テスト
    run(COMMIT, b.root, [APP, "confirm", "--stdin"], JSON.stringify(VALID_DRAFT), { AYATORI_IMAGE_MODEL: "env-model" });
    assert.equal(readPrompts(b.app).tool, "gpt-image-2", "省略時は env を見ず pipeline.yaml 既定値に落ちる");
  } finally {
    rmSync(b.root, { recursive: true, force: true });
  }
});

test("commit confirm --dry-run: 検証 OK でも一切書き込まない", () => {
  const { root, app } = makeApp();
  try {
    const out = run(COMMIT, root, [APP, "confirm", "--stdin", "--dry-run"], JSON.stringify(VALID_DRAFT));
    assert.equal(out.ok, true);
    assert.equal(out.dry_run, true);
    assert.equal(existsSync(promptsPath(app)), false, "dry-run でファイル未生成");
    assert.equal("prompts_confirmed_at" in readState(app).screens.graphics, false, "dry-run で state 未更新");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: omit — 取り下げ slot は entry を書かず記録は出力に残る", () => {
  const { root, app } = makeApp();
  try {
    const draft = { prompts: [entry("hero-dashboard")], omit: [{ graphic_id: "empty-cart", reason: "空状態は絵文字の現行表現を維持する" }] };
    const out = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(draft));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(out.omitted, ["empty-cart"]);
    assert.deepEqual(readPrompts(app).prompts.map((p) => p.graphic_id), ["hero-dashboard"], "省略 = 取り下げの正規記録 (schema description)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: E_VALIDATION — 重複/plan 外/取りこぼし/omit 不正/型/未知キー/confirmed_at 持ち込みを列挙し書き込みゼロ", () => {
  const { root, app } = makeApp();
  try {
    for (const [draft, frag] of [
      // graphic_id 重複 (チケット指定: schema で表現不能な契約の書き込み前チェック)
      [{ prompts: [entry("empty-cart"), entry("empty-cart"), entry("hero-dashboard")] }, "が重複"],
      // plan に無い graphic_id (チケット指定: plan との 1:1 対応)
      [{ prompts: [...VALID_DRAFT.prompts, entry("not-in-plan")] }, "slots に存在しない"],
      // 取りこぼし (omit なしの無言省略)
      [{ prompts: [entry("hero-dashboard")] }, "omit で明示"],
      // omit と prompts の両載せ
      [{ prompts: VALID_DRAFT.prompts, omit: [{ graphic_id: "empty-cart", reason: "x" }] }, "両方に載って"],
      // omit の reason 欠落 / plan 外 / 重複
      [{ prompts: [entry("hero-dashboard")], omit: [{ graphic_id: "empty-cart" }] }, "reason"],
      [{ prompts: VALID_DRAFT.prompts, omit: [{ graphic_id: "ghost", reason: "x" }] }, "slots に存在しない"],
      [{ prompts: [entry("hero-dashboard")], omit: [{ graphic_id: "empty-cart", reason: "x" }, { graphic_id: "empty-cart", reason: "y" }] }, "omit 内で重複"],
      // entry の required / 型 / pattern / size_px
      [{ prompts: [entry("empty-cart"), { ...entry("hero-dashboard"), prompt: "" }] }, "'prompt' が欠落"],
      [{ prompts: [entry("empty-cart"), { ...entry("hero-dashboard"), size_px: { width: 800 } }] }, "size_px.height が欠落"],
      [{ prompts: [entry("empty-cart"), entry("hero-dashboard", { size_px: { width: 0, height: 400 } })] }, "1 以上の整数"],
      [{ prompts: [entry("empty-cart"), entry("hero-dashboard", { size_px: { width: 800.5, height: 400 } })] }, "1 以上の整数"],
      [{ prompts: [entry("empty-cart"), entry("hero-dashboard", { size_px: { width: 800, height: 400, depth: 1 } })] }, "schema に無い field"],
      [{ prompts: [entry("empty-cart"), entry("hero-dashboard", { transparent_background: "yes" })] }, "boolean 型が必須"],
      [{ prompts: [entry("empty-cart"), entry("hero-dashboard", { transparent_background: "" })] }, "boolean 型が必須"], // 空文字列を欠落扱いで素通りさせない (21c 2nd round finding 1 と同穴)
      // optional field の null を素通りさせない — schema 違反のまま disk に固定され hook R10 が以後の
      // Write/Edit を block する (review 1st round finding 1 回帰)
      [{ prompts: [entry("empty-cart", { transparent_background: null }), entry("hero-dashboard")] }, "キー省略で表現"],
      [{ prompts: [entry("empty-cart", { notes: null }), entry("hero-dashboard")] }, "キー省略で表現"],
      [{ prompts: VALID_DRAFT.prompts, omit: null }, "omit は array が必須"], // null を空 array に黙って縮退させない (review 1st round finding 4 回帰)
      [{ prompts: [entry("empty-cart"), entry("hero-dashboard", { extra: 1 })] }, "schema に無い field"],
      [{ prompts: [entry("empty-cart"), entry("hero-dashboard", { graphic_id: "Hero_Dashboard" })] }, "pattern 違反"],
      // top-level
      [{ prompts: VALID_DRAFT.prompts, confirmed_at: "2026-07-18T00:00:00+09:00" }, "採番"],
      [{ prompts: VALID_DRAFT.prompts, tool: "" }, "tool は非空 string"],
      [{ prompts: [] }, "skip を使う"],
    ]) {
      const out = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(draft));
      assert.equal(out.code, "E_VALIDATION", JSON.stringify(out));
      assert.ok(out.errors.some((e) => e.includes(frag)), `errors に「${frag}」: ${JSON.stringify(out.errors)}`);
    }
    assert.equal(existsSync(promptsPath(app)), false, "検証 NG でファイル未生成");
    assert.equal("prompts_confirmed_at" in readState(app).screens.graphics, false, "検証 NG で state 未更新");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: excluded slot は prompts に載せられず、omit にも不要 (対象集合から除外済み)", () => {
  const { root, app } = makeApp({ excluded: [{ graphic_id: "empty-cart", reason: "生成失敗", excluded_at: "2026-07-18T00:00:00+09:00" }] });
  try {
    // excluded を prompts に載せる → エラー
    const withExcluded = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(VALID_DRAFT));
    assert.equal(withExcluded.code, "E_VALIDATION");
    assert.ok(withExcluded.errors.some((e) => e.includes("除外済み")), JSON.stringify(withExcluded.errors));
    // excluded を omit に載せる → エラー (既に対象外)
    const omitExcluded = run(
      COMMIT, root, [APP, "confirm", "--stdin"],
      JSON.stringify({ prompts: [entry("hero-dashboard")], omit: [{ graphic_id: "empty-cart", reason: "x" }] })
    );
    assert.equal(omitExcluded.code, "E_VALIDATION");
    assert.ok(omitExcluded.errors.some((e) => e.includes("omit の対象外")), JSON.stringify(omitExcluded.errors));
    // excluded 抜きの残 slot だけで確定できる (取りこぼし検査は対象集合 = plan − excluded)
    const ok = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify({ prompts: [entry("hero-dashboard")] }));
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.deepEqual(readPrompts(app).prompts.map((p) => p.graphic_id), ["hero-dashboard"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: 日本語混入は E_NON_ENGLISH で確定前に停止 / --allow-non-english は warning 付きで続行", () => {
  const { root, app } = makeApp();
  try {
    const jp = { prompts: [entry("empty-cart", { prompt: `空のカートのイラスト。 ${STYLE_DIRECTIVE}` }), entry("hero-dashboard")] };
    const blocked = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(jp));
    assert.equal(blocked.code, "E_NON_ENGLISH");
    assert.deepEqual(blocked.graphic_ids, ["empty-cart"], "混入 slot を特定して返す");
    assert.equal(existsSync(promptsPath(app)), false, "確定前に止める (何も書かない)");

    const allowed = run(COMMIT, root, [APP, "confirm", "--stdin", "--allow-non-english"], JSON.stringify(jp));
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.ok(allowed.warnings.some((w) => w.includes("--allow-non-english")), "明示続行の記録 warning");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: style_directive 非逐語は E_STYLE_DEVIATION / 空白・改行の揺れは許容 / --allow-style-deviation で続行", () => {
  const { root, app } = makeApp();
  try {
    const deviated = {
      prompts: [entry("empty-cart"), entry("hero-dashboard", { prompt: "A hero image in soft watercolor style." })], // 要約 (逐語でない)
    };
    const blocked = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(deviated));
    assert.equal(blocked.code, "E_STYLE_DEVIATION");
    assert.deepEqual(blocked.graphic_ids, ["hero-dashboard"]);
    assert.equal(existsSync(promptsPath(app)), false);

    // 改行 + 連続空白での折り返しは逐語扱い (whitespace 正規化)
    const wrapped = {
      prompts: [entry("empty-cart"), entry("hero-dashboard", { prompt: `A hero subject.\n  ${STYLE_DIRECTIVE.replace("generous negative space,", "generous  negative space,\n")}` })],
    };
    assert.equal(run(COMMIT, root, [APP, "confirm", "--stdin", "--dry-run"], JSON.stringify(wrapped)).ok, true);

    const allowed = run(COMMIT, root, [APP, "confirm", "--stdin", "--allow-style-deviation"], JSON.stringify(deviated));
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.ok(allowed.warnings.some((w) => w.includes("--allow-style-deviation")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: rework 再確定 — 全 rework slot の再確定を強制 / 消費で rework_pending 除去 + 残置ファイル退避", () => {
  const existing = {
    schema_version: "2026-07-14",
    app_name: APP,
    tool: "gpt-image-2",
    confirmed_at: "2026-07-18T09:00:00+09:00",
    prompts: VALID_DRAFT.prompts,
  };
  const { root, app } = makeApp({
    rework: [{ graphic_id: "hero-dashboard", instruction: "キャラクターを 2 人に" }],
    existingPrompts: existing,
  });
  try {
    // rework slot を omit で外す → エラー (生成済み slot の取り下げは 21g 側の領域)
    const omitted = run(
      COMMIT, root, [APP, "confirm", "--stdin"],
      JSON.stringify({ prompts: [entry("empty-cart")], omit: [{ graphic_id: "hero-dashboard", reason: "x" }] })
    );
    assert.equal(omitted.code, "E_VALIDATION");
    assert.ok(omitted.errors.some((e) => e.includes("omit できない")), JSON.stringify(omitted.errors));

    // 差し戻し slot のみ改訂 + 他 slot 逐語 → ok。rework_pending が消費される
    const revised = {
      prompts: [VALID_DRAFT.prompts[0], entry("hero-dashboard", { prompt: `Two friendly characters on the dashboard hero. ${STYLE_DIRECTIVE}` })],
    };
    const out = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(revised));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(out.rework_consumed, ["hero-dashboard"]);
    assert.ok(out.backed_up, "残置ファイルは退避してから上書き");
    const backups = readdirSync(join(app, "_backup", "graphics")).filter((f) => /^graphic-prompts\.\d{8}_\d{6}\.json$/.test(f));
    assert.equal(backups.length, 1);
    assert.equal(JSON.parse(readFileSync(join(app, "_backup", "graphics", backups[0]), "utf8")).confirmed_at, "2026-07-18T09:00:00+09:00");
    const g = readState(app).screens.graphics;
    assert.equal("rework_pending" in g, false, "全 entry 消費 = queue 除去 (設計 §9-2b)");
    assert.ok(g.prompts_confirmed_at);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: rework scope 凍結 — 対象外 entry の改変 / 取り下げ / tool 変更は E_REWORK_SCOPE (guide §6 の機械担保)", () => {
  const existing = {
    app_name: APP,
    tool: "gpt-image-2",
    confirmed_at: "2026-07-18T09:00:00+09:00",
    prompts: VALID_DRAFT.prompts,
  };
  const mk = () => makeApp({ rework: [{ graphic_id: "hero-dashboard", instruction: "2 人に" }], existingPrompts: existing });
  const reworkEntry = entry("hero-dashboard", { prompt: `Two friendly characters on the dashboard hero. ${STYLE_DIRECTIVE}` });

  // (a) 対象外 entry (empty-cart) の言い換え → E_REWORK_SCOPE・書き込みゼロ
  const a = mk();
  try {
    const reworded = {
      prompts: [entry("empty-cart", { transparent_background: true, prompt: `A reworded empty cart subject. ${STYLE_DIRECTIVE}` }), reworkEntry],
    };
    const out = run(COMMIT, a.root, [APP, "confirm", "--stdin"], JSON.stringify(reworded));
    assert.equal(out.code, "E_REWORK_SCOPE", JSON.stringify(out));
    assert.ok(out.violations.some((v) => v.startsWith("empty-cart:")), "違反 slot を名指し");
    assert.equal(readPrompts(a.app).confirmed_at, "2026-07-18T09:00:00+09:00", "既存ファイルは無傷 (書き込みゼロ)");
  } finally {
    rmSync(a.root, { recursive: true, force: true });
  }

  // (b) 対象外 entry の omit への移動 (= 生成済み slot の取り下げ) → E_REWORK_SCOPE
  const b = mk();
  try {
    const out = run(
      COMMIT, b.root, [APP, "confirm", "--stdin"],
      JSON.stringify({ prompts: [reworkEntry], omit: [{ graphic_id: "empty-cart", reason: "やっぱり不要" }] })
    );
    assert.equal(out.code, "E_REWORK_SCOPE", JSON.stringify(out));
    assert.ok(out.violations.some((v) => v.includes("21g 側の却下手順")));
  } finally {
    rmSync(b.root, { recursive: true, force: true });
  }

  // (c) tool: draft 省略時は前回確定値を継承する (env 既定へ黙って落として全 slot stale 化しない)
  const c = mk();
  try {
    const out = run(
      COMMIT, c.root, [APP, "confirm", "--stdin"],
      JSON.stringify({ prompts: [VALID_DRAFT.prompts[0], reworkEntry] }),
      { AYATORI_IMAGE_MODEL: "env-model" }
    );
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(readPrompts(c.app).tool, "gpt-image-2", "rework では env 既定 (env-model) ではなく前回確定値を継承");
  } finally {
    rmSync(c.root, { recursive: true, force: true });
  }

  // (d) tool の明示変更 → E_REWORK_SCOPE。--allow-rework-scope-change で明示続行 + warning
  const d = mk();
  try {
    const draft = { tool: "other-model", prompts: [VALID_DRAFT.prompts[0], reworkEntry] };
    const blocked = run(COMMIT, d.root, [APP, "confirm", "--stdin"], JSON.stringify(draft));
    assert.equal(blocked.code, "E_REWORK_SCOPE");
    assert.ok(blocked.violations.some((v) => v.includes("tool")));
    const allowed = run(COMMIT, d.root, [APP, "confirm", "--stdin", "--allow-rework-scope-change"], JSON.stringify(draft));
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.equal(allowed.tool, "other-model");
    assert.ok(allowed.warnings.some((w) => w.includes("--allow-rework-scope-change")));
  } finally {
    rmSync(d.root, { recursive: true, force: true });
  }

  // (e) 前回 omit された slot (前回 file に entry が無い対象 slot) の復活 → E_REWORK_SCOPE。
  //     omit のまま維持すれば ok (取りこぼし検査は omit 記載で満たす)
  const e = makeApp({
    rework: [{ graphic_id: "hero-dashboard", instruction: "2 人に" }],
    existingPrompts: { ...existing, prompts: [VALID_DRAFT.prompts[1]] }, // empty-cart は前回 omit
  });
  try {
    const resurrect = run(
      COMMIT, e.root, [APP, "confirm", "--stdin"],
      JSON.stringify({ prompts: [entry("empty-cart"), reworkEntry] })
    );
    assert.equal(resurrect.code, "E_REWORK_SCOPE", JSON.stringify(resurrect));
    assert.ok(resurrect.violations.some((v) => v.startsWith("empty-cart:") && v.includes("復活")), JSON.stringify(resurrect.violations));
    const kept = run(
      COMMIT, e.root, [APP, "confirm", "--stdin"],
      JSON.stringify({ prompts: [reworkEntry], omit: [{ graphic_id: "empty-cart", reason: "前回取り下げを維持" }] })
    );
    assert.equal(kept.ok, true, JSON.stringify(kept));
  } finally {
    rmSync(e.root, { recursive: true, force: true });
  }

  // (f) 入れ子 object (size_px) の key 順のみ違う同値 entry は violation にしない (JSON.stringify key 順依存の誤検出回帰)
  const f = makeApp({
    rework: [{ graphic_id: "hero-dashboard", instruction: "2 人に" }],
    existingPrompts: {
      ...existing,
      prompts: [{ ...VALID_DRAFT.prompts[0], size_px: { height: 200, width: 320 } }, VALID_DRAFT.prompts[1]],
    },
  });
  try {
    const out = run(COMMIT, f.root, [APP, "confirm", "--stdin"], JSON.stringify({ prompts: [VALID_DRAFT.prompts[0], reworkEntry] }));
    assert.equal(out.ok, true, JSON.stringify(out));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("commit confirm: 残置の空 rework_pending: [] も掃除される (空 queue と不在を区別しない — Copilot review 回帰)", () => {
  const { root, app } = makeApp({ rework: [] });
  try {
    const out = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(VALID_DRAFT));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal("rework_pending" in readState(app).screens.graphics, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit confirm: 対象外 slot の stale rework entry は消費されず残る (gather warning とセットの縮退挙動)", () => {
  const { root, app } = makeApp({
    rework: [
      { graphic_id: "hero-dashboard", instruction: "2 人に" },
      { graphic_id: "no-such-slot", instruction: "stale" },
    ],
  });
  try {
    const out = run(COMMIT, root, [APP, "confirm", "--stdin"], JSON.stringify(VALID_DRAFT));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(readState(app).screens.graphics.rework_pending, [{ graphic_id: "no-such-slot", instruction: "stale" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-prompts.mjs: skip / usage / 再 assert ─────────────────────────────

test("commit skip: decision=skip + decided_by=step21d を記録し prompts ファイルは書かない (§8-4 gate_21d_all_cancel)", () => {
  const { root, app } = makeApp();
  try {
    const out = run(COMMIT, root, [APP, "skip"]);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.decision, "skip");
    const g = readState(app).screens.graphics;
    assert.equal(g.decision, "skip");
    assert.equal(g.decided_by, "step21d");
    assert.equal(g.taste_confirmed_at, "2026-07-17T09:00:00+09:00", "既存キー保全");
    assert.equal(existsSync(promptsPath(app)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit skip: 残置の空 rework_pending: [] は confirm 全消費時と同じ経路で掃除される", () => {
  const { root, app } = makeApp({ rework: [] });
  try {
    const out = run(COMMIT, root, [APP, "skip"]);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal("rework_pending" in readState(app).screens.graphics, false, "空 queue と不在を区別しない");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit skip: rework_pending / 残置 prompts ファイルがあるときは warning を返す (破棄扱いの明示)", () => {
  const { root } = makeApp({
    rework: [{ graphic_id: "hero-dashboard", instruction: "x" }],
    existingPrompts: { schema_version: "2026-07-14", app_name: APP, confirmed_at: "2026-07-18T09:00:00+09:00", prompts: VALID_DRAFT.prompts },
  });
  try {
    const out = run(COMMIT, root, [APP, "skip"]);
    assert.equal(out.ok, true);
    assert.ok(out.warnings.some((w) => w.includes("rework_pending")));
    assert.ok(out.warnings.some((w) => w.includes("残置")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: 再 assert — プロンプト確定済みは E_PROMPTS_ALREADY_SET / usage 違反は E_USAGE / parse 不能は E_BAD_INPUT", () => {
  const confirmed = makeApp({ promptsConfirmed: true });
  try {
    assert.equal(run(COMMIT, confirmed.root, [APP, "confirm", "--stdin"], JSON.stringify(VALID_DRAFT)).code, "E_PROMPTS_ALREADY_SET");
    assert.equal(run(COMMIT, confirmed.root, [APP, "skip"]).code, "E_PROMPTS_ALREADY_SET", "確定後の中止は 21g/手動リセット領域 — skip も弾く");
  } finally {
    rmSync(confirmed.root, { recursive: true, force: true });
  }
  const { root, app } = makeApp();
  try {
    assert.equal(run(COMMIT, root, [APP], "").code, "E_USAGE");
    assert.equal(run(COMMIT, root, [APP, "confirm"], "{}").code, "E_USAGE", "confirm は --stdin 必須");
    assert.equal(run(COMMIT, root, [APP, "skip", "--dry-run"]).code, "E_USAGE", "--dry-run は confirm 専用");
    assert.equal(run(COMMIT, root, [APP, "skip", "--stdin"], "{}").code, "E_USAGE", "skip は flag を取らない (--stdin の誤用も fail-closed)");
    const typo = run(COMMIT, root, [APP, "confirm", "--stdin", "--dry-rnu"], JSON.stringify(VALID_DRAFT));
    assert.equal(typo.code, "E_USAGE", "未知 flag (--dry-run の typo) を無視して本書き込みしない (fail-closed)");
    assert.deepEqual(typo.unknown_args, ["--dry-rnu"], "typo した token を名指しして self-correct を助ける");
    assert.equal(existsSync(promptsPath(app)), false, "未知 flag 検出時は何も書かない");
    assert.equal(run(COMMIT, root, [APP, "confirm", "--stdin"], "not json {").code, "E_BAD_INPUT");
    assert.equal(run(COMMIT, root, [APP, "confirm", "--stdin"], "[1,2]").code, "E_BAD_INPUT");
    assert.equal(run(COMMIT, root, [APP, "confirm", "--stdin"], "null").code, "E_BAD_INPUT");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scripts は NUL byte を含まない text ファイルである (git diff 可能)", () => {
  const scriptsDir = join(HERE, "..", "scripts");
  for (const f of readdirSync(scriptsDir).filter((n) => n.endsWith(".mjs"))) {
    const body = readFileSync(join(scriptsDir, f), "utf8");
    assert.equal(body.includes("\u0000"), false, `${f} に NUL byte`);
  }
});
