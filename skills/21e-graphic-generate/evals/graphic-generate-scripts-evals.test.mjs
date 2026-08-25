#!/usr/bin/env node
// skills/21e-graphic-generate/evals/graphic-generate-scripts-evals.test.mjs
//
// Step 21e の同梱 script 3 本 (gather-context / generate-graphics / commit-degrade) の
// **CLI 契約テスト** + サイズ計画・digest・PNG 処理の純関数テスト:
// 黒箱 CLI として fixture (tmpdir に組み立てた artifacts ツリー) に対して回し、stdout JSON の
// routing 契約 (ok / E_* code) と書き込み副作用 (raw/*.png / generation-manifest /
// pipeline-state の generated_files / excluded_slots / step21e_completed_at) を固定する。
// 生成 API は evals/mock-image-api.mjs (別プロセス — spawnSync が親のイベントループを塞ぐため)
// を AYATORI_IMAGE_API_BASE で差し込む。実 API は呼ばない (課金ゼロ)。
//
// fixture 規約: 21b/21c/21d の eval と同じ — golden なし、makeApp() が tmpdir に毎回組み立て、
// AYATORI_REPO_ROOT env で差し込む (作業ツリーの artifacts/ を汚さない)。
//
// 使い方:
//   npm test                                                                                  # 検証 (node --test discovery)
//   node --test skills/21e-graphic-generate/evals/graphic-generate-scripts-evals.test.mjs     # 本 eval のみ
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computePending, planGeneration, readGraphicGenerationKey, resolveApiKey, sourceDigestOf } from "../scripts/preflight.mjs";
import { centerCropRect, decodePng, encodePng, fitToTarget, hasTransparency } from "../scripts/png-resize.mjs";

// fixture tmpdir の一括掃除 — 各 test が作る全 tmp root を追跡し、テスト終了時に消す
// (放置すると npm test のたびに PNG バイナリ入りの 21e-eval-* が OS tmpdir に積み上がる)
const TMP_ROOTS = [];
const tmpRoot = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TMP_ROOTS.push(dir);
  return dir;
};
after(() => {
  for (const dir of TMP_ROOTS) rmSync(dir, { recursive: true, force: true });
});

const HERE = dirname(fileURLToPath(import.meta.url));
// SoT 現値の独立オラクル — 実装 (readGraphicGenerationKey 系) と別経路の素朴 parse。
// pipeline.yaml の tool / tool_transparent を編集する正規運用 (SoT 差し替え) で eval が
// 壊れないよう、現値の字面量 pin はしない (fallback 定数の検証は字面量のままで正)
const SOT_YAML = readFileSync(new URL("../../../pipeline.yaml", import.meta.url), "utf8");
const sotGraphicKey = (key) => {
  const block = SOT_YAML.split(/^  graphic_generation:.*$/m)[1]?.split(/^  \S/m)[0] ?? "";
  return block.match(new RegExp(`^    ${key}: *([^ #\\n]+)`, "m"))?.[1] ?? null;
};

const GATHER = join(HERE, "..", "scripts", "gather-context.mjs");
const GENERATE = join(HERE, "..", "scripts", "generate-graphics.mjs");
const DEGRADE = join(HERE, "..", "scripts", "commit-degrade.mjs");
const MOCK = join(HERE, "mock-image-api.mjs");
const APP = "testapp";

const ENTRIES = () => [
  { graphic_id: "hero-dashboard", prompt: "A hero illustration of a calm dashboard scene.", size_px: { width: 1216, height: 608 } },
  { graphic_id: "empty-cart", prompt: "A tiny friendly empty cart spot illustration.", size_px: { width: 64, height: 64 }, transparent_background: true },
];

/** tmpdir に artifacts/testapp の fixture ツリーを組み立てる。opts で状態を変形する。 */
function makeApp(opts = {}) {
  const root = tmpRoot("21e-eval-");
  const app = join(root, "artifacts", APP);
  mkdirSync(join(app, "graphics"), { recursive: true });

  const graphics = {
    decision: "generate",
    step21a_completed_at: "2026-07-16T10:00:00+09:00",
    taste_confirmed_at: "2026-07-17T09:00:00+09:00",
    prompts_confirmed_at: "2026-07-18T09:00:00+09:00",
  };
  if (opts.noPromptsConfirmed) delete graphics.prompts_confirmed_at;
  if (opts.skipDecision) Object.assign(graphics, { decision: "skip", decided_by: "step21b" });
  if (opts.completed) graphics.step21e_completed_at = "2026-07-19T09:00:00+09:00";
  if (opts.excluded) graphics.excluded_slots = opts.excluded;
  if (opts.generated) {
    graphics.generated_files = opts.generated;
    // fresh 判定は digest 一致 + file 実在 (computePending の appRoot 契約) — 記録に対応する実体を
    // 既定で置く。実体欠落ケースは opts.noRawFiles か個別 rmSync で作る
    if (!opts.noRawFiles) {
      mkdirSync(join(app, "graphics", "raw"), { recursive: true });
      for (const g of opts.generated) writeFileSync(join(app, g.file), "dummy-png-bytes");
    }
  }
  const state = {
    schema_version: "2026-05-22",
    app_name: APP,
    approvals: { screens_human_approved: !opts.notApproved },
    screens: { graphics },
  };
  writeFileSync(join(app, "pipeline-state.json"), JSON.stringify(state, null, 2));

  if (!opts.noPromptsFile) {
    const file = {
      app_name: APP,
      tool: "gpt-image-2",
      confirmed_at: "2026-07-18T09:00:00+09:00",
      prompts: opts.prompts ?? ENTRIES(),
    };
    writeFileSync(join(app, "graphics", "graphic-prompts.json"), JSON.stringify(file, null, 2));
  }
  return { root, app };
}

/** script を黒箱 CLI として実行する (mock サーバの port を API base に差し込む)。 */
function run(script, root, args, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      AYATORI_REPO_ROOT: root,
      AYATORI_IMAGE_API_KEY: "test-key",
      OPENAI_API_KEY: "",
      // 実行マシンの実 ~/.ayatori/image-api-key を読ませない (存在しないパスへ差し替え —
      // これが無いとキー設定済みマシンで E_NO_API_KEY 系の契約テストが成立しない)
      AYATORI_IMAGE_API_KEY_FILE: join(root, ".no-credentials"),
      AYATORI_IMAGE_MODEL: "",
      AYATORI_IMAGE_MODEL_TRANSPARENT: "",
      AYATORI_RETRY_BACKOFF_MS: "10,20",
      AYATORI_IMAGE_TIMEOUT_MS: "5000",
      ...env,
    },
  });
  assert.equal(res.status, 0, `exit 0 契約 (routing は JSON の code で行う)。stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** mock-image-api.mjs を別プロセスで起動し、PORT 行を待つ。 */
function startServer(mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MOCK, mode], { stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("mock server の起動 timeout")), 5000);
    timer.unref();
    child.stdout.on("data", (d) => {
      buf += d;
      const m = buf.match(/PORT=(\d+)/);
      if (!m) return;
      clearTimeout(timer);
      const port = Number(m[1]);
      resolve({
        base: `http://127.0.0.1:${port}/v1`,
        stop: () => child.kill(),
        stats: async () => (await fetch(`http://127.0.0.1:${port}/__stats`)).json(),
      });
    });
    child.on("error", reject);
  });
}

const readState = (app) => JSON.parse(readFileSync(join(app, "pipeline-state.json"), "utf8"));
const readManifest = (app) => JSON.parse(readFileSync(join(app, "graphics", "raw", "generation-manifest.json"), "utf8"));
const graphicsOf = (app) => readState(app).screens.graphics;

// ── 純関数: サイズ計画 (planGeneration) ──────────────────────────────────────────

test("planGeneration: ピクセルバジェット以上・16 の倍数・許容アスペクト比の確定寸はそのまま生成 (無加工)", () => {
  const p = planGeneration({ width: 1216, height: 608 }, false);
  assert.deepEqual(p.api_size, { width: 1216, height: 608 });
  assert.equal(p.resize, false);
  assert.equal(p.warnings.length, 0);
});

test("planGeneration: 縦長の準拠寸も浮動小数誤差で広げない (672x1200 等は無加工)", () => {
  // h*(w/h) の 1 ulp 誤差 → ceilTo が 1 グリッド広げる回帰 (672x1200 → 688x1200) の防止
  for (const [w, h] of [[672, 1200], [736, 1344], [800, 1248]]) {
    const p = planGeneration({ width: w, height: h }, false);
    assert.deepEqual(p.api_size, { width: w, height: h }, `${w}x${h} は準拠寸のまま`);
    assert.equal(p.resize, false);
  }
});

test("planGeneration: 最小ピクセルバジェット floor — 拒否される小解像度の要求を出さない (実測境界 718,848px)", () => {
  // 800x400 は 16 の倍数・AR 許容域だが面積 320,000px は実測で拒否される — floor で拡大される
  const p = planGeneration({ width: 800, height: 400 }, false);
  assert.deepEqual(p.api_size, { width: 1200, height: 608 });
  assert.equal(p.resize, true);
  for (const [w, h] of [[320, 200], [64, 64], [100, 100], [1200, 600]]) {
    const q = planGeneration({ width: w, height: h }, false);
    assert.ok(q.api_size.width * q.api_size.height >= 718_848, `${w}x${h} → ${q.api_size.width}x${q.api_size.height} は floor 以上`);
    assert.equal(q.api_size.width % 16, 0);
    assert.equal(q.api_size.height % 16, 0);
  }
});

test("planGeneration: 短辺 256 未満は supersample + floor (320x200 → 1088x672)", () => {
  const p = planGeneration({ width: 320, height: 200 }, false);
  assert.deepEqual(p.api_size, { width: 1088, height: 672 });
  assert.equal(p.resize, true);
});

test("planGeneration: 極小 slot (64x64 → 848x848 — floor 支配)", () => {
  const p = planGeneration({ width: 64, height: 64 }, false);
  assert.deepEqual(p.api_size, { width: 848, height: 848 });
});

test("planGeneration: アスペクト比 3:1 超は clamp + warning (1200x100)", () => {
  const p = planGeneration({ width: 1200, height: 100 }, false);
  const ar = p.api_size.width / p.api_size.height;
  assert.ok(ar <= 3.05, `生成キャンバスのアスペクト比は 3:1 以内 (実際 ${ar})`);
  assert.equal(p.api_size.width % 16, 0);
  assert.equal(p.api_size.height % 16, 0);
  assert.ok(p.api_size.width <= 1536 && p.api_size.height <= 1536, "長辺 cap 1536");
  assert.ok(p.api_size.width * p.api_size.height >= 718_848, "cap 後もピクセルバジェット floor を割らない");
  assert.ok(p.warnings.some((w) => w.includes("アスペクト比")));
});

test("planGeneration: 長辺 cap を浮動小数誤差で超えない (2105x2105 → 1536x1536)", () => {
  // cap 乗算が 1536 を 1 ulp 超え、ceil が 1552 へ丸める回帰の防止
  assert.deepEqual(planGeneration({ width: 2105, height: 2105 }, false).api_size, { width: 1536, height: 1536 });
});

test("planGeneration: 走査不変量 — 16 の倍数 / 長辺 ≤1536 / 面積 ≥ピクセルバジェット / AR 許容域", () => {
  for (let w = 16; w <= 2400; w += 89) {
    for (let h = 16; h <= 2400; h += 89) {
      const { api_size } = planGeneration({ width: w, height: h }, false);
      const label = `${w}x${h} → ${api_size.width}x${api_size.height}`;
      assert.equal(api_size.width % 16, 0, label);
      assert.equal(api_size.height % 16, 0, label);
      assert.ok(Math.max(api_size.width, api_size.height) <= 1536, `${label}: 長辺 cap`);
      assert.ok(api_size.width * api_size.height >= 718_848, `${label}: ピクセルバジェット floor`);
      const ar = api_size.width / api_size.height;
      assert.ok(ar >= 1 / 3 - 1e-6 && ar <= 3 + 1e-6, `${label}: AR 許容域`);
    }
  }
});

test("planGeneration: 透過 slot は固定サイズ族から最近アスペクトを選ぶ", () => {
  assert.deepEqual(planGeneration({ width: 64, height: 64 }, true).api_size, { width: 1024, height: 1024 });
  assert.deepEqual(planGeneration({ width: 800, height: 400 }, true).api_size, { width: 1536, height: 1024 });
  assert.deepEqual(planGeneration({ width: 300, height: 500 }, true).api_size, { width: 1024, height: 1536 });
});

// ── 純関数: digest / pending 差集合 ──────────────────────────────────────────────

test("sourceDigestOf: prompt/size/透過/tool のどれが変わっても digest が変わり、tool 省略は既定値へ正規化される", () => {
  const e = { graphic_id: "a", prompt: "P.", size_px: { width: 100, height: 100 } };
  const base = sourceDigestOf(e, "gpt-image-2");
  assert.equal(sourceDigestOf(e, undefined), base, "tool 省略 = pipeline 既定値 (gpt-image-2) へ正規化");
  assert.notEqual(sourceDigestOf({ ...e, prompt: "Q." }, "gpt-image-2"), base);
  assert.notEqual(sourceDigestOf({ ...e, size_px: { width: 100, height: 101 } }, "gpt-image-2"), base);
  assert.notEqual(sourceDigestOf({ ...e, transparent_background: true }, "gpt-image-2"), base);
  assert.notEqual(sourceDigestOf(e, "other-tool"), base);
});

test("sourceDigestOf: 透過 slot の digest は tool_transparent 側由来 — 非透過 tool の変更に波及しない", () => {
  // 波及すると: 21d rework での tool 変更が透過 slot まで stale 化し、モデル・prompt とも同一の
  // 画像を再課金で作り直す。逆に透過既定モデルの差し替えは digest を変えて stale 化させる契約
  const t = { graphic_id: "b", prompt: "P.", size_px: { width: 100, height: 100 }, transparent_background: true };
  assert.equal(sourceDigestOf(t, "gpt-image-2"), sourceDigestOf(t, "other-tool"), "file tool 変更は透過 slot の digest に影響しない");
  assert.equal(sourceDigestOf(t, "gpt-image-2"), sourceDigestOf(t, undefined));
});

test("computePending: fresh は再利用・stale は pending・excluded は対象外 (設計 §9-2b)", () => {
  const entries = ENTRIES();
  const heroDigest = sourceDigestOf(entries[0], "gpt-image-2");
  const graphics = {
    generated_files: [
      { graphic_id: "hero-dashboard", file: "graphics/raw/hero-dashboard.png", source_digest: heroDigest },
      { graphic_id: "empty-cart", file: "graphics/raw/empty-cart.png", source_digest: "stale-digest" },
    ],
  };
  const r = computePending(entries, "gpt-image-2", graphics);
  assert.deepEqual(r.fresh.map((e) => e.graphic_id), ["hero-dashboard"]);
  assert.deepEqual(r.pending.map((e) => e.graphic_id), ["empty-cart"]);
  const r2 = computePending(entries, "gpt-image-2", { excluded_slots: [{ graphic_id: "empty-cart", reason: "x", excluded_at: "t" }] });
  assert.deepEqual(r2.pending.map((e) => e.graphic_id), ["hero-dashboard"], "excluded は pending に入らない (永久 pending 化の防止)");
});

test("computePending: file は当該 slot 自身の raw/正典パス完全一致のみ — traversal / 別 slot すり替えは pending (21f と同一規約)", () => {
  const entries = [ENTRIES()[0]];
  const digest = sourceDigestOf(entries[0], "gpt-image-2");
  const cases = ["../../outside.png", "graphics/raw/other-slot.png", "graphics/raw/hero-dashboard.png.bak", "screens/_shared/graphics/other.webp"];
  for (const file of cases) {
    const r = computePending(entries, "gpt-image-2", { generated_files: [{ graphic_id: "hero-dashboard", file, source_digest: digest }] });
    assert.deepEqual(r.pending.map((e) => e.graphic_id), ["hero-dashboard"], `不正パス ${file} を fresh 扱いしない (21e 完了 → 21f E_21E_STALE の矛盾 state を作らない)`);
  }
  // 正典パス (21f 正典化後の resume) は fresh — file 更新後の 21e 再実行が空転しない
  const r = computePending(entries, "gpt-image-2", {
    generated_files: [{ graphic_id: "hero-dashboard", file: "screens/_shared/graphics/hero-dashboard.png", source_digest: digest }],
  });
  assert.deepEqual(r.fresh.map((e) => e.graphic_id), ["hero-dashboard"]);
});

test("computePending: appRoot 指定時、digest 一致でも raw 実体が無い slot は pending へ戻す", () => {
  const entries = [ENTRIES()[0]];
  const graphics = {
    generated_files: [
      { graphic_id: "hero-dashboard", file: "graphics/raw/hero-dashboard.png", source_digest: sourceDigestOf(entries[0], "gpt-image-2") },
    ],
  };
  const appRoot = tmpRoot("21e-pending-");
  assert.deepEqual(computePending(entries, "gpt-image-2", graphics, appRoot).pending.map((e) => e.graphic_id), ["hero-dashboard"], "file 不在 → pending");
  mkdirSync(join(appRoot, "graphics", "raw"), { recursive: true });
  writeFileSync(join(appRoot, "graphics", "raw", "hero-dashboard.png"), "x");
  assert.deepEqual(computePending(entries, "gpt-image-2", graphics, appRoot).fresh.map((e) => e.graphic_id), ["hero-dashboard"], "file 実在 → fresh");
});

// ── 純関数: pipeline.yaml 既定 tool の抽出 (宣言 SoT を実際に読む契約) ──────────────

test("readGraphicGenerationKey: graphic_generation ブロックの scalar を抽出し、不在は fallback", () => {
  const dir = tmpRoot("21e-yaml-");
  const yaml = join(dir, "pipeline.yaml");
  writeFileSync(
    yaml,
    [
      "screens:",
      "  graphic_generation:",
      "    tool: custom-model                 # comment",
      "    tool_transparent: custom-transparent",
      "    embed_format: img_relative_ref",
      "  figma_export:",
      "    tool: should-not-match", // ブロック外の同名キーを拾わない (dedent で終了)
      "  graphic_generation_other: x",
    ].join("\n")
  );
  assert.equal(readGraphicGenerationKey("tool", "fb", yaml), "custom-model");
  assert.equal(readGraphicGenerationKey("tool_transparent", "fb", yaml), "custom-transparent");
  assert.equal(readGraphicGenerationKey("missing_key", "fb", yaml), "fb", "ブロック内に無いキーは fallback");
  assert.equal(readGraphicGenerationKey("tool", "fb", join(dir, "nonexistent.yaml")), "fb", "読めない場合は fail-open");
  // 実 repo の pipeline.yaml からも読めている (import 時に解決される既定値の健全性 — 期待値は
  // 独立オラクルから取り、SoT の現値を字面量で pin しない)
  assert.equal(readGraphicGenerationKey("tool", "fb"), sotGraphicKey("tool"));
  assert.equal(readGraphicGenerationKey("tool_transparent", "fb"), sotGraphicKey("tool_transparent"));
});

test("gather: pipeline.yaml の tool / tool_transparent 変更が実際にモデルルーティングへ反映される", () => {
  const dir = tmpRoot("21e-yaml-cli-");
  const yaml = join(dir, "pipeline.yaml");
  writeFileSync(yaml, "screens:\n  graphic_generation:\n    tool: next-gen-model\n    tool_transparent: next-gen-transparent\n");
  const { root } = makeApp({ prompts: [{ ...ENTRIES()[1] }] }); // 透過 slot のみ
  const r = run(GATHER, root, [APP], { AYATORI_PIPELINE_YAML: yaml });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.models.transparent, "next-gen-transparent", "SoT の編集が hardcode に負けない");
  assert.equal(r.models.opaque, "gpt-image-2", "prompts.json に記録済みの tool が優先 (21d 確定値)");
});

// ── 純関数: PNG decode / crop / resample ────────────────────────────────────────

test("png-resize: encode → decode の round-trip が恒等", () => {
  const width = 5;
  const height = 3;
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31) % 256;
  const back = decodePng(encodePng({ width, height, pixels }));
  assert.equal(back.width, width);
  assert.equal(back.height, height);
  assert.deepEqual([...back.pixels], [...pixels]);
});

test("png-resize: fitToTarget は 2x2 ブロックの面積平均で縮小し alpha を保持する", () => {
  // 4x4 → 2x2: 各 2x2 ブロックを単色にして平均が自明になるようにする
  const pixels = Buffer.alloc(4 * 4 * 4);
  const put = (x, y, [r, g, b, a]) => pixels.set([r, g, b, a], (y * 4 + x) * 4);
  for (const [bx, by, color] of [
    [0, 0, [255, 0, 0, 255]],
    [1, 0, [0, 255, 0, 255]],
    [0, 1, [0, 0, 255, 255]],
    [1, 1, [255, 255, 255, 127]],
  ]) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(bx * 2 + dx, by * 2 + dy, color);
  }
  const out = fitToTarget({ width: 4, height: 4, pixels }, 2, 2);
  const px = (x, y) => [...out.pixels.subarray((y * 2 + x) * 4, (y * 2 + x) * 4 + 4)];
  assert.deepEqual(px(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(1, 0), [0, 255, 0, 255]);
  assert.deepEqual(px(0, 1), [0, 0, 255, 255]);
  assert.deepEqual(px(1, 1), [255, 255, 255, 127], "半透明ブロックの alpha が保持される");
  assert.ok(hasTransparency(out));
});

test("png-resize: 破損 IHDR (0 寸法 / 上限超の寸法) はメモリ確保前に明示エラーで弾く", () => {
  // decodePng は chunk CRC を検証しないため、正常 PNG の IHDR 寸法 (data 先頭 = offset 16) を
  // 直接書き換えて破損応答を再現する
  const base = encodePng({ width: 1, height: 1, pixels: Buffer.from([10, 20, 30, 255]) });
  const patch = (w, h) => {
    const b = Buffer.from(base);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  for (const [w, h] of [[0, 1], [1, 0], [4097, 16], [16, 4097], [0xffffffff, 0xffffffff]]) {
    assert.throws(() => decodePng(patch(w, h)), /寸法/, `${w}x${h} は弾く`);
  }
  assert.deepEqual([...decodePng(base).pixels], [10, 20, 30, 255], "無加工の正常 PNG は通る");
});

test("png-resize: centerCropRect は中央寄せでアスペクト比を合わせる", () => {
  assert.deepEqual(centerCropRect(1024, 1024, 800, 400), { x: 0, y: 256, w: 1024, h: 512 });
  assert.deepEqual(centerCropRect(1536, 1024, 100, 100), { x: 256, y: 0, w: 1024, h: 1024 });
});

// ── CLI: gather-context の routing 契約 ─────────────────────────────────────────

test("gather: ok — pending の生成計画 (モデルルーティング / api_size / resize) を返す", () => {
  const { root } = makeApp();
  const r = run(GATHER, root, [APP]);
  assert.equal(r.ok, true);
  assert.equal(r.counts.pending, 2);
  const hero = r.pending.find((p) => p.graphic_id === "hero-dashboard");
  const cart = r.pending.find((p) => p.graphic_id === "empty-cart");
  assert.equal(hero.model, "gpt-image-2");
  assert.equal(hero.api_size, "1216x608");
  assert.equal(hero.resize, false);
  assert.equal(cart.model, sotGraphicKey("tool_transparent"), "透過 slot は透過対応モデル (SoT tool_transparent) へルーティング");
  assert.equal(cart.transparent, true);
  assert.equal(cart.api_size, "1024x1024");
  assert.equal(cart.resize, true);
});

test("gather: E_* routing (キー未設定 / 21d 未確定 / skip / 完了済み / 全 slot 除外 / 不正 id)", () => {
  const cases = [
    [makeApp(), { AYATORI_IMAGE_API_KEY: "", OPENAI_API_KEY: "" }, "E_NO_API_KEY"],
    [makeApp({ noPromptsConfirmed: true }), {}, "E_PROMPTS_NOT_CONFIRMED"],
    [makeApp({ skipDecision: true }), {}, "E_BLOCK_SKIPPED"],
    [makeApp({ completed: true }), {}, "E_ALREADY_COMPLETED"],
    [makeApp({ noPromptsFile: true }), {}, "E_PROMPTS_MISSING"],
    [
      makeApp({
        excluded: [
          { graphic_id: "hero-dashboard", reason: "x", excluded_at: "t" },
          { graphic_id: "empty-cart", reason: "x", excluded_at: "t" },
        ],
      }),
      {},
      "E_ALL_SLOTS_EXCLUDED",
    ],
    [makeApp({ prompts: [{ graphic_id: "../evil", prompt: "P.", size_px: { width: 16, height: 16 } }] }), {}, "E_PROMPTS_INVALID"],
    [
      // graphic_id 重複 (手編集の疑い): 素通しすると last-entry-wins の digest が別 prompt の画像を
      // fresh 扱いにする — 書き込み前に E_PROMPTS_INVALID で止める
      makeApp({
        prompts: [
          { graphic_id: "hero-dashboard", prompt: "P1.", size_px: { width: 1216, height: 608 } },
          { graphic_id: "hero-dashboard", prompt: "P2.", size_px: { width: 1216, height: 608 } },
        ],
      }),
      {},
      "E_PROMPTS_INVALID",
    ],
  ];
  for (const [{ root }, env, code] of cases) {
    const r = run(GATHER, root, [APP], env);
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
  }
});

test("gather: app_name のパス・トラバーサルは E_INVALID_APP_NAME で join 前に弾く", () => {
  const { root } = makeApp();
  for (const bad of ["../testapp", "testapp/../testapp", "a/b", ".."]) {
    const r = run(GATHER, root, [bad]);
    assert.equal(r.ok, false, bad);
    assert.equal(r.code, "E_INVALID_APP_NAME", bad);
  }
});

test("キー未設定でも pending ゼロの完了記録 run は通る (支払い済み成果を 21f へ進める)", () => {
  const entries = ENTRIES();
  const generated = entries.map((e) => ({
    graphic_id: e.graphic_id,
    file: `graphics/raw/${e.graphic_id}.png`,
    generated_at: "2026-07-19T09:00:00+09:00",
    source_digest: sourceDigestOf(e, "gpt-image-2"),
  }));
  const noKey = { AYATORI_IMAGE_API_KEY: "", OPENAI_API_KEY: "" };
  const g1 = makeApp({ generated });
  const rGather = run(GATHER, g1.root, [APP], noKey);
  assert.equal(rGather.ok, true, JSON.stringify(rGather));
  assert.equal(rGather.counts.pending, 0);
  const g2 = makeApp({ generated });
  const rGen = run(GENERATE, g2.root, [APP], noKey);
  assert.equal(rGen.ok, true, JSON.stringify(rGen));
  assert.ok(graphicsOf(g2.app).step21e_completed_at);
});

// ── CLI: generate-graphics (mock API) ───────────────────────────────────────────

test("generate: 正常系 — モデルルーティング・サイズ適合・増分記録・完了記録", async () => {
  const server = await startServer("ok");
  try {
    const { root, app } = makeApp();
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.generated.map((g) => g.graphic_id).sort(), ["empty-cart", "hero-dashboard"]);

    // raw は確定 size_px ちょうど (サイズ自動調整の不変量)
    const hero = decodePng(readFileSync(join(app, "graphics", "raw", "hero-dashboard.png")));
    assert.equal(`${hero.width}x${hero.height}`, "1216x608");
    const cart = decodePng(readFileSync(join(app, "graphics", "raw", "empty-cart.png")));
    assert.equal(`${cart.width}x${cart.height}`, "64x64");
    assert.ok(hasTransparency(cart), "透過 slot の alpha が縮小後も残る");

    // state: generated_files (digest 付き) + step21e_completed_at
    const g = graphicsOf(app);
    assert.equal(g.generated_files.length, 2);
    const entries = ENTRIES();
    for (const e of entries) {
      const rec = g.generated_files.find((x) => x.graphic_id === e.graphic_id);
      assert.equal(rec.file, `graphics/raw/${e.graphic_id}.png`);
      assert.equal(rec.source_digest, sourceDigestOf(e, "gpt-image-2"));
    }
    assert.ok(g.step21e_completed_at, "pending 空 + 失敗ゼロで完了記録");

    // 監査台帳 + API へ渡ったパラメタ (routing / 透過 / png 固定)
    const manifest = readManifest(app);
    const mHero = manifest.entries.find((e) => e.graphic_id === "hero-dashboard");
    assert.equal(mHero.resized, false, "寸法一致は API 出力バイトを無加工で置く");
    const mCart = manifest.entries.find((e) => e.graphic_id === "empty-cart");
    assert.equal(mCart.api_size, "1024x1024");
    assert.equal(mCart.resized, true);
    const { requests } = await server.stats();
    const reqHero = requests.find((q) => q.size === "1216x608");
    const reqCart = requests.find((q) => q.size === "1024x1024");
    assert.equal(reqHero.model, "gpt-image-2");
    assert.equal(reqHero.background, null);
    assert.equal(reqHero.output_format, "png");
    assert.equal(reqCart.model, sotGraphicKey("tool_transparent"));
    assert.equal(reqCart.background, "transparent");
  } finally {
    server.stop();
  }
});

test("generate: 部分失敗 → 成功分は記録・完了は立たない → 再実行は失敗分のみ再生成", async () => {
  const prompts = ENTRIES();
  prompts[1].prompt = "FAILMARKER tiny cart.";
  const fail = await startServer("fail-marker");
  let root;
  let app;
  try {
    ({ root, app } = makeApp({ prompts }));
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: fail.base });
    assert.equal(r.ok, false);
    assert.equal(r.code, "E_GENERATION_FAILED");
    assert.deepEqual(r.failures.map((f) => f.graphic_id), ["empty-cart"]);
    assert.equal(r.failures[0].attempts, 3, "5xx は backoff 付きで既定 3 試行");
    const g = graphicsOf(app);
    assert.deepEqual(g.generated_files.map((x) => x.graphic_id), ["hero-dashboard"], "成功分は増分記録済み");
    assert.equal(g.step21e_completed_at, undefined, "失敗が残る間は完了記録しない");
  } finally {
    fail.stop();
  }

  const ok = await startServer("ok");
  try {
    const r2 = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: ok.base });
    assert.equal(r2.ok, true);
    assert.deepEqual(r2.generated.map((x) => x.graphic_id), ["empty-cart"], "digest 一致の成功分は再生成しない");
    assert.deepEqual(r2.reused, ["hero-dashboard"]);
    const { requests } = await ok.stats();
    assert.equal(requests.length, 1, "API 呼び出しは失敗分の 1 slot だけ");
    assert.ok(graphicsOf(app).step21e_completed_at);
  } finally {
    ok.stop();
  }
});

test("generate: url 形式応答の download 経路 + download の一時失敗は retryable として再試行される", async () => {
  const server = await startServer("url-flaky-download");
  try {
    const { root, app } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readManifest(app).entries[0].attempts, 2, "download 失敗は恒久失敗でなく再試行 budget を使う");
    const raw = decodePng(readFileSync(join(app, "graphics", "raw", "hero-dashboard.png")));
    assert.equal(`${raw.width}x${raw.height}`, "1216x608");
    const { downloadCalls } = await server.stats();
    assert.equal(downloadCalls, 2);
  } finally {
    server.stop();
  }
});

test("generate: 一時エラー (5xx) はリトライで成功し attempts が記録される", async () => {
  const server = await startServer("flaky2");
  try {
    const { root, app } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readManifest(app).entries[0].attempts, 3);
  } finally {
    server.stop();
  }
});

test("generate: 非リトライ対象の 400 は 1 試行で失敗にする", async () => {
  const server = await startServer("badreq");
  try {
    const { root } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.code, "E_GENERATION_FAILED");
    assert.equal(r.failures[0].attempts, 1);
    const { requests } = await server.stats();
    assert.equal(requests.length, 1);
  } finally {
    server.stop();
  }
});

test("generate: 401 は 1 試行で失敗させ、キー診断 (--doctor) への導線を error に載せる", async () => {
  const server = await startServer("unauthorized");
  try {
    const { root } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.code, "E_GENERATION_FAILED");
    assert.equal(r.failures[0].attempts, 1, "認証失敗はリトライしても直らない");
    assert.match(r.failures[0].error, /API 401/);
    assert.match(r.failures[0].error, /setup-image-key\.mjs --doctor/, "古いキーの遮蔽を自力で診断できる導線");
  } finally {
    server.stop();
  }
});

// 上の mock の 401 本文は 61 字で、案内を本文の後ろに置いても 300 字の切り詰めに掛からない —
// つまり案内の位置を取り違えても検出できない。gateway が包んだ長い 401 (本文 320 字) で
// 「案内が残り、切られるのは本文側」を固定する。
test("generate: 本文の長い 401 でも --doctor 導線が切り詰めで消えない (案内は本文より前)", async () => {
  const server = await startServer("unauthorized-verbose");
  try {
    const { root } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.code, "E_GENERATION_FAILED");
    const err = r.failures[0].error;
    assert.equal(err.length, 300, "300 字で切り詰められている状況であることが前提のテスト");
    assert.match(err, /setup-image-key\.mjs --doctor/, "切られるのは本文側 — 導線は必ず残る");
    assert.match(err, /^API 401: キーの認証失敗/, "status の直後が案内 (本文より前)");
  } finally {
    server.stop();
  }
});

test("generate: 'size' の語を含むだけの無関係な 4xx は fallback を誤発火しない (即失敗・追加課金なし)", async () => {
  const server = await startServer("size-word-4xx"); // "Your prompt exceeds the maximum size limit."
  try {
    const { root } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.code, "E_GENERATION_FAILED");
    assert.equal(r.failures[0].attempts, 1, "非 retryable として即失敗する");
    assert.match(r.failures[0].error, /maximum size limit/, "真因のエラーがそのまま user に届く (fallback 失敗で上書きされない)");
    const { requests } = await server.stats();
    assert.equal(requests.length, 1, "固定サイズ族への追加リクエスト (余計な課金) を送らない");
  } finally {
    server.stop();
  }
});

test("generate: OpenAI 互換 gateway の size 拒否措辞 (pydantic 列挙形) でも fallback が発火する", async () => {
  const server = await startServer("rejectsize-gateway"); // "size: Input should be '1024x1024', ..."
  try {
    const { root, app } = makeApp({ prompts: [ENTRIES()[0]] }); // 1216x608 → 拒否 → 1536x1024 へ
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = readManifest(app).entries[0];
    assert.equal(m.api_size, "1536x1024");
    assert.ok(m.warnings.some((w) => w.includes("fallback")));
  } finally {
    server.stop();
  }
});

test("generate: サイズ起因の 400 は固定サイズ族へ fallback して成功する", async () => {
  const server = await startServer("rejectsize");
  try {
    const { root, app } = makeApp({ prompts: [ENTRIES()[0]] }); // 1216x608 → 拒否 → 1536x1024 へ
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = readManifest(app).entries[0];
    assert.equal(m.api_size, "1536x1024");
    assert.ok(m.warnings.some((w) => w.includes("fallback")));
    const raw = decodePng(readFileSync(join(app, "graphics", "raw", "hero-dashboard.png")));
    assert.equal(`${raw.width}x${raw.height}`, "1216x608", "fallback 後もサイズ適合の不変量は保たれる");
  } finally {
    server.stop();
  }
});

test("generate: fallback 固定サイズが確定寸より小さい場合、拡大警告が fallback 文脈の文面で台帳に残る", async () => {
  const server = await startServer("rejectsize");
  try {
    // 1400x1400 → 通常計画 1408x1408 (警告なし) → 拒否 → fallback 1024x1024 → 1400x1400 へ拡大
    const { root, app } = makeApp({
      prompts: [{ graphic_id: "big-square", prompt: "A big square illustration.", size_px: { width: 1400, height: 1400 } }],
    });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = readManifest(app).entries[0];
    assert.equal(m.api_size, "1024x1024");
    assert.ok(m.warnings.some((w) => w.includes("fallback")));
    assert.ok(
      m.warnings.some((w) => w.includes("拡大する (画質低下の可能性)")),
      `fallback 起因の拡大警告が捨てられない: ${JSON.stringify(m.warnings)}`
    );
    assert.ok(
      m.warnings.every((w) => !w.includes("透過")),
      `非透過 slot の台帳に透過 slot 向け文面を流用しない: ${JSON.stringify(m.warnings)}`
    );
    const raw = decodePng(readFileSync(join(app, "graphics", "raw", "big-square.png")));
    assert.equal(`${raw.width}x${raw.height}`, "1400x1400");
  } finally {
    server.stop();
  }
});

test("generate: 最終試行での size 拒否でも fallback は必ず送信される (fallback は試行回数を消費しない)", async () => {
  const server = await startServer("flaky2-rejectsize"); // 500×2 で budget を使い切った後に size 400
  try {
    const { root, app } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = readManifest(app).entries[0];
    assert.equal(m.api_size, "1536x1024");
    assert.ok(m.warnings.some((w) => w.includes("fallback")));
    const { requests } = await server.stats();
    assert.equal(requests.length, 4, "500, 500, size 400, fallback 成功の計 4 リクエスト");
  } finally {
    server.stop();
  }
});

test("generate: API 出力が要求サイズと異なっても実寸から size_px へ適合する", async () => {
  const server = await startServer("wrongsize");
  try {
    const { root, app } = makeApp({ prompts: [ENTRIES()[0]] });
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    const raw = decodePng(readFileSync(join(app, "graphics", "raw", "hero-dashboard.png")));
    assert.equal(`${raw.width}x${raw.height}`, "1216x608");
    assert.ok(readManifest(app).entries[0].warnings.some((w) => w.includes("API 出力が要求サイズと異なる")));
  } finally {
    server.stop();
  }
});

test("generate: pending ゼロ (全 slot fresh) は API を呼ばず完了記録だけ立てる", async () => {
  const entries = ENTRIES();
  const { root, app } = makeApp({
    generated: entries.map((e) => ({
      graphic_id: e.graphic_id,
      file: `graphics/raw/${e.graphic_id}.png`,
      generated_at: "2026-07-19T09:00:00+09:00",
      source_digest: sourceDigestOf(e, "gpt-image-2"),
    })),
  });
  // API base をあえて不通のポートにする — 呼ばれたら失敗する
  const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: "http://127.0.0.1:9/v1" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.generated, []);
  assert.deepEqual(r.reused.sort(), ["empty-cart", "hero-dashboard"]);
  assert.ok(graphicsOf(app).step21e_completed_at);
});

test("generate: raw 実体が消えた fresh slot は再生成される (完了記録の空振り防止)", async () => {
  const entries = ENTRIES();
  const server = await startServer("ok");
  try {
    const { root, app } = makeApp({
      generated: entries.map((e) => ({
        graphic_id: e.graphic_id,
        file: `graphics/raw/${e.graphic_id}.png`,
        generated_at: "2026-07-19T09:00:00+09:00",
        source_digest: sourceDigestOf(e, "gpt-image-2"),
      })),
    });
    rmSync(join(app, "graphics", "raw", "empty-cart.png")); // 中間物の手動掃除を模す
    const r = run(GENERATE, root, [APP], { AYATORI_IMAGE_API_BASE: server.base });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.generated.map((g) => g.graphic_id), ["empty-cart"], "実体欠落分のみ再生成");
    assert.deepEqual(r.reused, ["hero-dashboard"]);
    assert.ok(existsSync(join(app, "graphics", "raw", "empty-cart.png")));
  } finally {
    server.stop();
  }
});

// ── CLI: commit-degrade (設計 §8-4) ─────────────────────────────────────────────

test("degrade exclude: 除外記録 + 残りが全部 fresh なら完了記録を立てる", () => {
  const entries = ENTRIES();
  const { root, app } = makeApp({
    generated: [
      {
        graphic_id: "hero-dashboard",
        file: "graphics/raw/hero-dashboard.png",
        generated_at: "2026-07-19T09:00:00+09:00",
        source_digest: sourceDigestOf(entries[0], "gpt-image-2"),
      },
    ],
  });
  const r = run(DEGRADE, root, [APP, "exclude", "empty-cart", "--reason", "コンテンツポリシーで生成不可"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const g = graphicsOf(app);
  assert.equal(g.excluded_slots[0].graphic_id, "empty-cart");
  assert.equal(g.excluded_slots[0].reason, "コンテンツポリシーで生成不可");
  assert.ok(g.excluded_slots[0].excluded_at);
  assert.ok(g.step21e_completed_at, "pending が空になったので 21f へ進める");
  assert.equal(g.decision, "generate");
});

test("degrade exclude: 旧 run の正典残骸 (screens/_shared/graphics/) を掃除する (21f exclude と対称)", () => {
  // 到達経路: 正典化済み slot が 21g 差し戻し / 21f retry で entry 削除 → 再生成が失敗し続けて除外。
  // entry は無い (= fresh でない) が正典ファイルだけが残っている状態を再現する
  const { root, app } = makeApp();
  const canonicalDir = join(app, "screens", "_shared", "graphics");
  mkdirSync(canonicalDir, { recursive: true });
  writeFileSync(join(canonicalDir, "empty-cart.webp"), "stale-canonical-bytes");
  const r = run(DEGRADE, root, [APP, "exclude", "empty-cart", "--reason", "再生成が失敗し続けるため見送り"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!existsSync(join(canonicalDir, "empty-cart.webp")), "除外 slot の正典残骸を残さない");
});

test("degrade exclude: 全 slot 除外はブロック中止と同義 (decision=skip, decided_by=step21e)", () => {
  const { root, app } = makeApp({ excluded: [{ graphic_id: "hero-dashboard", reason: "x", excluded_at: "t" }] });
  const r = run(DEGRADE, root, [APP, "exclude", "empty-cart", "--reason", "生成失敗が解消しない"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const g = graphicsOf(app);
  assert.equal(g.decision, "skip");
  assert.equal(g.decided_by, "step21e");
  assert.equal(g.excluded_slots.length, 2);
});

test("degrade exclude: 生成成功済み (fresh) slot は除外できない / reason なしは E_USAGE", () => {
  const entries = ENTRIES();
  const { root } = makeApp({
    generated: [
      {
        graphic_id: "hero-dashboard",
        file: "graphics/raw/hero-dashboard.png",
        generated_at: "2026-07-19T09:00:00+09:00",
        source_digest: sourceDigestOf(entries[0], "gpt-image-2"),
      },
    ],
  });
  const r = run(DEGRADE, root, [APP, "exclude", "hero-dashboard", "--reason", "気が変わった"]);
  assert.equal(r.code, "E_SLOT_ALREADY_GENERATED");
  const r2 = run(DEGRADE, root, [APP, "exclude", "empty-cart"]);
  assert.equal(r2.code, "E_USAGE");
});

test("degrade abort: 全 slot excluded の不整合 state でも通る (E_ALL_SLOTS_EXCLUDED の復旧手段)", () => {
  // gather / generate は E_ALL_SLOTS_EXCLUDED で止まり「commit-degrade abort を実行せよ」と案内する —
  // その abort 自身が同じ assert に弾かれると復旧経路が円環して手動 state 編集しか出口が無くなる
  const { root, app } = makeApp({
    excluded: [
      { graphic_id: "hero-dashboard", reason: "x", excluded_at: "t" },
      { graphic_id: "empty-cart", reason: "x", excluded_at: "t" },
    ],
  });
  const r = run(DEGRADE, root, [APP, "abort", "--reason", "全 slot 生成失敗除外の不整合を閉じる"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const g = graphicsOf(app);
  assert.equal(g.decision, "skip");
  assert.equal(g.decided_by, "step21e");
});

test("degrade abort: decision=skip (decided_by=step21e) を記録する", () => {
  const { root, app } = makeApp();
  const r = run(DEGRADE, root, [APP, "abort", "--reason", "API 障害が長引くため今回は見送り"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const g = graphicsOf(app);
  assert.equal(g.decision, "skip");
  assert.equal(g.decided_by, "step21e");
  assert.equal(g.step21e_completed_at, undefined, "中止は完了ではない");
});

// ── resolveApiKey — キー解決チェーンの契約 (POCTEAMA-408) ──────────────────────
// env AYATORI_IMAGE_API_KEY → キーファイル ~/.ayatori/image-api-key → env OPENAI_API_KEY。
// process.env を直接読む純関数のため、退避 → 差し替え → finally 復元で検証する。

function withKeyEnv(overrides, fn) {
  const KEYS = ["AYATORI_IMAGE_API_KEY", "OPENAI_API_KEY", "AYATORI_IMAGE_API_KEY_FILE", "AYATORI_REPO_ROOT"];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    // AYATORI_REPO_ROOT は fixture mode marker — 無いと AYATORI_IMAGE_API_KEY_FILE は
    // 「単独残留 env」として警告付きで無視される (imageKeyFilePath の契約)
    Object.assign(process.env, { AYATORI_REPO_ROOT: HERE, ...overrides });
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("resolveApiKey: キーファイルを直読する (末尾改行は trim / 再起動不要経路)", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  const file = join(root, "image-api-key");
  writeFileSync(file, "sk-from-file\n");
  withKeyEnv({ AYATORI_IMAGE_API_KEY_FILE: file }, () => {
    assert.equal(resolveApiKey(), "sk-from-file");
  });
});

test("resolveApiKey: env AYATORI_IMAGE_API_KEY はキーファイルより優先 (明示 override)", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  const file = join(root, "image-api-key");
  writeFileSync(file, "sk-from-file");
  withKeyEnv({ AYATORI_IMAGE_API_KEY: "sk-from-env", AYATORI_IMAGE_API_KEY_FILE: file }, () => {
    assert.equal(resolveApiKey(), "sk-from-env");
  });
});

test("resolveApiKey: キーファイルは env OPENAI_API_KEY より優先 (AYATORI 専用鍵 > 汎用鍵)", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  const file = join(root, "image-api-key");
  writeFileSync(file, "sk-from-file");
  withKeyEnv({ OPENAI_API_KEY: "sk-openai", AYATORI_IMAGE_API_KEY_FILE: file }, () => {
    assert.equal(resolveApiKey(), "sk-from-file");
  });
});

test("resolveApiKey: ファイル不在は OPENAI_API_KEY へ fallthrough (現行互換)", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  withKeyEnv({ OPENAI_API_KEY: "sk-openai", AYATORI_IMAGE_API_KEY_FILE: join(root, "nonexistent") }, () => {
    assert.equal(resolveApiKey(), "sk-openai");
  });
});

test("resolveApiKey: 貼り付け事故 (コメント行 / KEY= 前置 / 引用符 / CRLF) を整形して吸収する", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  for (const [label, body] of [
    ["コメント行 + 追加行", "# ayatori-openai\nsk-pasted\n"],
    ["KEY= 前置", 'AYATORI_IMAGE_API_KEY="sk-pasted"\n'],
    // KEY= で改行してから鍵を貼る 2 行貼り付け — 先頭行だけ見て打ち切ると前置の剥がしで空になり
    // 未設定扱いになる (docs の「KEY= 前置・追加行は吸収」に反する)。候補行の走査で吸収する。
    ["KEY= のみの行 + 次行に鍵", "AYATORI_IMAGE_API_KEY=\nsk-pasted\n"],
    ["export 行", "export OPENAI_API_KEY='sk-pasted'\n"],
    ["CRLF", "sk-pasted\r\n"],
  ]) {
    const file = join(root, `key-${Buffer.from(label).toString("hex")}`);
    writeFileSync(file, body);
    withKeyEnv({ AYATORI_IMAGE_API_KEY_FILE: file }, () => {
      assert.equal(resolveApiKey(), "sk-pasted", label);
    });
  }
});

test("resolveApiKey: 整形しても header に載せられない値は null (壊れた鍵で課金 API を叩かない)", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  const file = join(root, "image-api-key");
  writeFileSync(file, "sk-broken key-with-space\n");
  withKeyEnv({ AYATORI_IMAGE_API_KEY_FILE: file }, () => {
    assert.equal(resolveApiKey(), null, "空白混入は未設定扱い (E_NO_API_KEY へ)");
  });
  // env 側も同じ契約
  withKeyEnv({ AYATORI_IMAGE_API_KEY: "sk-broken key", AYATORI_IMAGE_API_KEY_FILE: join(root, "nonexistent") }, () => {
    assert.equal(resolveApiKey(), null);
  });
});

test("resolveApiKey: 空白のみのファイル + env 無し → null (E_NO_API_KEY 経路)", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  const file = join(root, "image-api-key");
  writeFileSync(file, "  \n");
  withKeyEnv({ AYATORI_IMAGE_API_KEY_FILE: file }, () => {
    assert.equal(resolveApiKey(), null);
  });
});

test("imageKeyFilePath: AYATORI_IMAGE_API_KEY_FILE は AYATORI_REPO_ROOT 併用時のみ有効 (単独残留 env は警告して無視)", () => {
  const root = tmpRoot("21e-eval-keyfile-");
  const file = join(root, "image-api-key");
  writeFileSync(file, "sk-fixture-only");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  // 子プロセスで import して評価する (module 側は process.env を実行時に読むが、HOME 差し替えを
  // 親プロセスに持ち込まないため — 21f の AYATORI_PIPELINE_YAML guard テストと同じ形)
  const probe = `import { imageKeyFilePath, resolveApiKey } from ${JSON.stringify(new URL("../scripts/preflight.mjs", import.meta.url).href)}; console.log(JSON.stringify({ path: imageKeyFilePath(), key: resolveApiKey() }));`;
  const env = { ...process.env, HOME: home, USERPROFILE: home, AYATORI_IMAGE_API_KEY_FILE: file, AYATORI_IMAGE_API_KEY: "", OPENAI_API_KEY: "" };
  delete env.AYATORI_REPO_ROOT;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", env });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { path: join(home, ".ayatori", "image-api-key"), key: null }, "単独 env は既定パスへ落とす");
  assert.match(res.stderr, /併用時のみ有効/, "無言でなく警告する");
  // fixture mode (AYATORI_REPO_ROOT あり) では従来どおり注入が効く
  const res2 = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    env: { ...env, AYATORI_REPO_ROOT: root },
  });
  assert.equal(JSON.parse(res2.stdout).key, "sk-fixture-only");
});

test("imageKeyFilePath / resolveApiKey は 21c/21e で逐字一致 (per-skill 複製の同期検証 — readGraphicGenerationKey の 21f 方式と同じ)", () => {
  const extract = (p, name) => {
    const m = readFileSync(p, "utf8").match(new RegExp(`export function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(m, `${p} に ${name} が見つからない`);
    return m[0];
  };
  for (const name of ["imageKeyFilePath", "resolveApiKey"]) {
    assert.equal(
      extract(join(HERE, "..", "scripts", "preflight.mjs"), name),
      extract(join(HERE, "..", "..", "21c-graphic-taste", "scripts", "preflight.mjs"), name),
      `21c/21e の ${name} が乖離 — 変更は 2 つ同時に`
    );
  }
});
