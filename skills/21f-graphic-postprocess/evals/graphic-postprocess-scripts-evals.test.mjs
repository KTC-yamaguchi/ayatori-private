#!/usr/bin/env node
// skills/21f-graphic-postprocess/evals/graphic-postprocess-scripts-evals.test.mjs
//
// Step 21f の同梱 script 3 本 (gather-context / postprocess-graphics / commit-degrade) の
// **CLI 契約テスト** + 透過検証・対象差集合の純関数テスト:
// 黒箱 CLI として fixture (tmpdir に組み立てた artifacts ツリー) に対して回し、stdout JSON の
// routing 契約 (ok / E_* code) と書き込み副作用 (screens/_shared/graphics/*.png /
// postprocess-manifest / pipeline-state の generated_files[].file 正典更新 / transparency_waived /
// excluded_slots / step21f_completed_at) を固定する。正典化は raw バイト無加工の PNG コピー
// (圧縮 ⑫ は非搭載 — ユーザー判断でスコープ除外)。
//
// fixture 規約: 21b〜21e の eval と同じ — golden なし、makeApp() が tmpdir に毎回組み立て、
// AYATORI_REPO_ROOT env で差し込む (作業ツリーの artifacts/ を汚さない)。
//
// 使い方:
//   npm test                                                                                       # 検証 (node --test discovery)
//   node --test skills/21f-graphic-postprocess/evals/graphic-postprocess-scripts-evals.test.mjs    # 本 eval のみ
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedFilesOf, atomicWriteFileSync, computeTargets, sourceDigestOf, canonicalPath, isCanonical, readGraphicGenerationKey, sha256Of, DEFAULT_TOOL, DEFAULT_TRANSPARENT_TOOL } from "../scripts/preflight.mjs";
import { decodePng, alphaStats, verifyTransparency, ALPHA_TRANSPARENT_MAX } from "../scripts/png-inspect.mjs";
import {
  sourceDigestOf as sourceDigestOf21e,
  readGraphicGenerationKey as readGraphicGenerationKey21e,
  atomicWriteFileSync as atomicWriteFileSync21e,
  allowedFilesOf as allowedFilesOf21e,
  DEFAULT_TOOL as DEFAULT_TOOL_21E,
  DEFAULT_TRANSPARENT_TOOL as DEFAULT_TRANSPARENT_TOOL_21E,
} from "../../21e-graphic-generate/scripts/preflight.mjs";
import { atomicWriteFileSync as atomicWriteFileSync21a } from "../../21a-graphic-recommend/scripts/preflight.mjs";
import { atomicWriteFileSync as atomicWriteFileSync21b } from "../../21b-graphic-hearing/scripts/preflight.mjs";
import { atomicWriteFileSync as atomicWriteFileSync21c, readGraphicGenerationKey as readGraphicGenerationKey21c } from "../../21c-graphic-taste/scripts/preflight.mjs";
import { atomicWriteFileSync as atomicWriteFileSync21d, readGraphicGenerationKey as readGraphicGenerationKey21d } from "../../21d-graphic-prompts/scripts/preflight.mjs";
import { atomicWriteFileSync as atomicWriteFileSync21g } from "../../21g-graphic-embed-review/scripts/preflight.mjs";

// fixture tmpdir の一括掃除 — makeApp / 個別 test が作る全 tmp root を追跡し、テスト終了時に消す
// (放置すると npm test のたびに PNG/WebP バイナリ入りの 21f-eval-* が OS tmpdir に積み上がる)
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
const POSTPROCESS = join(HERE, "..", "scripts", "postprocess-graphics.mjs");
const DEGRADE = join(HERE, "..", "scripts", "commit-degrade.mjs");
const APP = "testapp";

const ENTRIES = () => [
  { graphic_id: "hero-dashboard", prompt: "A hero illustration of a calm dashboard scene.", size_px: { width: 64, height: 32 } },
  { graphic_id: "badge-cart", prompt: "A tiny friendly cart badge.", size_px: { width: 32, height: 32 }, transparent_background: true },
];

// ── 最小 PNG encoder (RGBA8 / filter 0 / 非 interlace) — fixture 用。実装 SoT の decodePng を
// テスト対象に含めるため、encode 側だけを test 内に持つ (21e png-resize.encodePng と同形式) ──
function makePng(width, height, px) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(x, y);
      raw.set([r, g, b, a], (stride + 1) * y + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 0);
    return Buffer.concat([head, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 不透明グラデーション (hero 用 / 透過 fail の badge 用)
const opaquePng = (w, h) => makePng(w, h, (x, y) => [(x * 7) % 256, (y * 11) % 256, 128, 255]);
// 中央に不透明被写体 + 透明背景 (透過 pass の badge 用 — 外周は完全透明)
const transparentPng = (w, h) =>
  makePng(w, h, (x, y) => {
    const inner = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
    return inner ? [200, 80, 40, 255] : [0, 0, 0, 0];
  });

/** tmpdir に artifacts/testapp の fixture ツリーを組み立てる。opts で状態を変形する。 */
function makeApp(opts = {}) {
  const root = tmpRoot("21f-eval-");
  const app = join(root, "artifacts", APP);
  mkdirSync(join(app, "graphics", "raw"), { recursive: true });

  const entries = opts.prompts ?? ENTRIES();
  const graphics = {
    decision: "generate",
    step21a_completed_at: "2026-07-16T10:00:00+09:00",
    taste_confirmed_at: "2026-07-17T09:00:00+09:00",
    prompts_confirmed_at: "2026-07-18T09:00:00+09:00",
    step21e_completed_at: "2026-07-19T09:00:00+09:00",
  };
  if (opts.no21eCompleted) delete graphics.step21e_completed_at;
  if (opts.skipDecision) Object.assign(graphics, { decision: "skip", decided_by: "step21b" });
  if (opts.completed21f) graphics.step21f_completed_at = "2026-07-20T09:00:00+09:00";
  if (opts.excluded) graphics.excluded_slots = opts.excluded;
  if (opts.waived) graphics.transparency_waived = opts.waived;

  // 既定: 全 entry を 21e 生成済み (raw に実体 + fresh digest) として置く
  graphics.generated_files =
    opts.generated ??
    entries.map((e) => ({
      graphic_id: e.graphic_id,
      file: `graphics/raw/${e.graphic_id}.png`,
      generated_at: "2026-07-19T08:00:00+09:00",
      source_digest: sourceDigestOf(e, "gpt-image-2"),
    }));
  if (!opts.noRawFiles) {
    for (const g of graphics.generated_files) {
      if (!g.file.startsWith("graphics/raw/")) continue;
      const e = entries.find((x) => x.graphic_id === g.graphic_id);
      const png =
        e?.transparent_background === true && !opts.opaqueTransparentSlots
          ? transparentPng(e.size_px.width, e.size_px.height)
          : opaquePng(e?.size_px.width ?? 8, e?.size_px.height ?? 8);
      writeFileSync(join(app, g.file), opts.corruptRaw?.includes(g.graphic_id) ? Buffer.from("not a png") : png);
    }
  }

  const state = {
    app_name: APP,
    approvals: { screens_human_approved: !opts.notApproved },
    screens: { graphics },
  };
  writeFileSync(join(app, "pipeline-state.json"), JSON.stringify(state, null, 2));
  writeFileSync(
    join(app, "graphics", "graphic-prompts.json"),
    JSON.stringify({ app_name: APP, tool: "gpt-image-2", confirmed_at: "2026-07-18T09:00:00+09:00", prompts: entries }, null, 2)
  );
  return { root, app };
}

/** script を黒箱 CLI として実行する。 */
function run(script, root, args, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, AYATORI_REPO_ROOT: root, ...env },
  });
  assert.equal(res.status, 0, `exit 0 契約 (routing は JSON の code で行う)。stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const readState = (app) => JSON.parse(readFileSync(join(app, "pipeline-state.json"), "utf8"));
const readManifest = (app) => JSON.parse(readFileSync(join(app, "graphics", "postprocess-manifest.json"), "utf8"));

// ═══ 純関数: digest / 対象差集合 / 透過検証 ═══

test("sourceDigestOf は 21e 実装と一致する (複製アルゴリズムの同期契約)", () => {
  for (const e of ENTRIES()) {
    assert.equal(sourceDigestOf(e, "gpt-image-2"), sourceDigestOf21e(e, "gpt-image-2"));
    assert.equal(sourceDigestOf(e, undefined), sourceDigestOf21e(e, undefined));
  }
});

test("21e↔21f 複製実装の同期契約は source レベルで機械検証する (片側だけの編集は必ずここで落ちる)", () => {
  // per-skill 自己完結 (skill の独立移動性優先) の repo 方針により digest / yaml 読み取りは
  // 21e と 21f に複製されている。出力サンプリング比較 (上の test) は「たまたま同じ結果になる
  // 編集差」を素通しし得るため、function 本体の逐字一致まで固定する — 片側だけの改修が
  // fresh/stale 判定を割ると、21f が 21e の成果を全 slot stale と誤認して空転 or 逆に stale を
  // fresh 扱いで出荷する (設計 §9-2b の鮮度契約が壊れる)
  assert.equal(sourceDigestOf.toString(), sourceDigestOf21e.toString(), "sourceDigestOf の本体が 21e と逐字一致すること (変更は両方同時に)");
  assert.equal(
    readGraphicGenerationKey.toString(),
    readGraphicGenerationKey21e.toString(),
    "readGraphicGenerationKey の本体が 21e と逐字一致すること (変更は両方同時に)"
  );
  // yaml 抽出文法は 21c/21d にも複製されている (per-skill 自己完結) — 4 skill 全部を固定する。
  // 片側だけ文法を改修すると、テイスト見本 (21c) / 永続化 tool (21d) が hardcode fallback に落ち、
  // user が承認したテイストと 21e の本生成モデルが食い違う
  assert.equal(readGraphicGenerationKey.toString(), readGraphicGenerationKey21c.toString(), "21c の複製も逐字一致すること (変更は 4 skill 同時に)");
  assert.equal(readGraphicGenerationKey.toString(), readGraphicGenerationKey21d.toString(), "21d の複製も逐字一致すること (変更は 4 skill 同時に)");
  assert.equal(DEFAULT_TOOL, DEFAULT_TOOL_21E, "既定 tool の解決結果が一致すること");
  assert.equal(DEFAULT_TRANSPARENT_TOOL, DEFAULT_TRANSPARENT_TOOL_21E, "既定 tool_transparent の解決結果が一致すること");
  assert.equal(
    atomicWriteFileSync.toString(),
    atomicWriteFileSync21e.toString(),
    "atomicWriteFileSync の本体が 21e と逐字一致すること (変更は両方同時に)"
  );
  // atomicWriteFileSync は 21a/21b/21c/21d/21g にも複製されている (計 7 skill) — pipeline-state を
  // 書く全 graphic skill で truncate 耐性 (原子的置換 + tmp 掃除) が同一契約であることを固定する。
  // 片側だけの改修は「どの skill の Write で state が壊れるか」が実行経路依存になる
  for (const [name, fn] of [
    ["21a", atomicWriteFileSync21a],
    ["21b", atomicWriteFileSync21b],
    ["21c", atomicWriteFileSync21c],
    ["21d", atomicWriteFileSync21d],
    ["21g", atomicWriteFileSync21g],
  ]) {
    assert.equal(fn.toString(), atomicWriteFileSync.toString(), `${name} の atomicWriteFileSync も逐字一致すること (変更は 7 skill 同時に)`);
  }
  for (const id of ["hero-dashboard", "badge-cart"]) {
    assert.deepEqual(allowedFilesOf(id), allowedFilesOf21e(id), "file 許容パスの規約が 21e と一致すること (割れると 21e 完了↔21f stale の矛盾 state になる)");
  }
});

test("computeTargets: pending (raw) / done (正典) / stale (digest 不一致・実体欠落) / excluded を分類する", () => {
  const { app } = makeApp();
  const entries = ENTRIES();
  const graphics = readState(app).screens.graphics;

  // 既定は全 slot pending (file = raw)
  let t = computeTargets(entries, "gpt-image-2", graphics, app);
  assert.deepEqual(t.pendingSlots.map((s) => s.entry.graphic_id), ["hero-dashboard", "badge-cart"]);
  assert.equal(t.doneSlots.length, 0);
  assert.equal(t.staleIds.length, 0);

  // 正典化済みの表現: file を正典パスにして実体を置く
  mkdirSync(join(app, "screens", "_shared", "graphics"), { recursive: true });
  writeFileSync(join(app, canonicalPath("hero-dashboard", "webp")), "x");
  graphics.generated_files[0].file = canonicalPath("hero-dashboard", "webp");
  t = computeTargets(entries, "gpt-image-2", graphics, app);
  assert.deepEqual(t.doneSlots.map((s) => s.entry.graphic_id), ["hero-dashboard"]);
  assert.deepEqual(t.pendingSlots.map((s) => s.entry.graphic_id), ["badge-cart"]);

  // digest 不一致 → stale / excluded は分類対象外
  graphics.generated_files[1].source_digest = "deadbeef";
  t = computeTargets(entries, "gpt-image-2", graphics, app);
  assert.deepEqual(t.staleIds, ["badge-cart"]);
  t = computeTargets(entries, "gpt-image-2", { ...graphics, excluded_slots: [{ graphic_id: "badge-cart" }] }, app);
  assert.equal(t.staleIds.length, 0);
  assert.deepEqual(t.doneSlots.map((s) => s.entry.graphic_id), ["hero-dashboard"]);

  assert.ok(isCanonical(canonicalPath("a", "webp")) && !isCanonical("graphics/raw/a.png"));
});

test("computeTargets: generated_files[].file は当該 slot の raw/正典パス完全一致のみ — traversal / 接尾辞 / 別 slot 横流しは stale", () => {
  const { app } = makeApp();
  const entries = ENTRIES();
  const graphics = readState(app).screens.graphics;
  mkdirSync(join(app, "screens", "_shared", "graphics"), { recursive: true });

  // path traversal: appRoot の外を指す (実在してもさせない — join 前に弾く)
  graphics.generated_files[0].file = "../../outside.png";
  let t = computeTargets(entries, "gpt-image-2", graphics, app);
  assert.ok(t.staleIds.includes("hero-dashboard"), "traversal パスは stale 扱い");

  // 接尾辞すり替え: 正典 dir 内でも .webp.bak は受理しない
  writeFileSync(join(app, canonicalPath("hero-dashboard", "webp") + ".bak"), "x");
  graphics.generated_files[0].file = canonicalPath("hero-dashboard", "webp") + ".bak";
  t = computeTargets(entries, "gpt-image-2", graphics, app);
  assert.ok(t.staleIds.includes("hero-dashboard"), "接尾辞すり替えは stale 扱い");

  // 別 slot の正典への横流し: hero の entry が badge の正典を指す
  writeFileSync(join(app, canonicalPath("badge-cart", "webp")), "x");
  graphics.generated_files[0].file = canonicalPath("badge-cart", "webp");
  t = computeTargets(entries, "gpt-image-2", graphics, app);
  assert.ok(t.staleIds.includes("hero-dashboard"), "別 slot の正典を指す entry は stale 扱い");

  // 正: 自 slot の正典パスは done
  graphics.generated_files[0].file = canonicalPath("hero-dashboard", "webp");
  writeFileSync(join(app, canonicalPath("hero-dashboard", "webp")), "x");
  t = computeTargets(entries, "gpt-image-2", graphics, app);
  assert.deepEqual(t.doneSlots.map((s) => s.entry.graphic_id), ["hero-dashboard"]);
});

test("verifyTransparency: 全画素不透明 → fail / 外周不透明 → fail / 中央被写体 → pass / full-bleed 気味 → pass+warn", () => {
  // 全画素不透明
  let v = verifyTransparency(decodePng(opaquePng(16, 16)));
  assert.equal(v.pass, false);
  assert.match(v.warnings[0], /不透明/);
  // 縁まで不透明・中央だけ透明 (背景残り) → 外周透明率 0 で fail
  v = verifyTransparency(decodePng(makePng(16, 16, (x, y) => (x > 4 && x < 12 && y > 4 && y < 12 ? [0, 0, 0, 0] : [10, 10, 10, 255]))));
  assert.equal(v.pass, false);
  assert.match(v.warnings[0], /外周/);
  // 中央被写体 + 透明背景 → pass (warn なし)
  v = verifyTransparency(decodePng(transparentPng(16, 16)));
  assert.equal(v.pass, true);
  assert.equal(v.warnings.length, 0);
  // 外周の一部だけ透明 (full-bleed 気味): 上辺のみ透明 → 比率 ~0.26 で pass+warn
  v = verifyTransparency(decodePng(makePng(16, 16, (x, y) => (y === 0 ? [0, 0, 0, 0] : [10, 10, 10, 255]))));
  assert.equal(v.pass, true);
  assert.match(v.warnings[0], /低め/);
  // alphaStats の閾値定数: alpha = ALPHA_TRANSPARENT_MAX は透明扱い
  const s = alphaStats(decodePng(makePng(2, 1, (x) => [0, 0, 0, x === 0 ? ALPHA_TRANSPARENT_MAX : 255])));
  assert.equal(s.transparent_ratio, 0.5);
});

test("AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT 併用時のみ有効 (単独残留 env は警告して無視)", () => {
  const dir = tmpRoot("21f-yaml-guard-");
  const bogus = join(dir, "pipeline.yaml");
  writeFileSync(bogus, "screens:\n  graphic_generation:\n    tool: bogus-model\n    tool_transparent: bogus-transparent\n");
  // preflight を fixture mode 外 (AYATORI_REPO_ROOT なし) で import し、既定値が実 repo の値のままであることを見る
  const probe = `import { DEFAULT_TOOL, DEFAULT_TRANSPARENT_TOOL } from ${JSON.stringify(new URL("../scripts/preflight.mjs", import.meta.url).href)}; console.log(JSON.stringify({ DEFAULT_TOOL, DEFAULT_TRANSPARENT_TOOL }));`;
  const env = { ...process.env, AYATORI_PIPELINE_YAML: bogus };
  delete env.AYATORI_REPO_ROOT;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", env });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(
    JSON.parse(res.stdout),
    { DEFAULT_TOOL: sotGraphicKey("tool"), DEFAULT_TRANSPARENT_TOOL: sotGraphicKey("tool_transparent") },
    "単独 env は digest 材料に効かない (期待値は SoT の現値 — 字面量 pin しない)"
  );
  assert.match(res.stderr, /併用時のみ有効/, "無言でなく警告する");
  // fixture mode (AYATORI_REPO_ROOT あり) では従来どおり注入が効く
  const res2 = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    env: { ...process.env, AYATORI_PIPELINE_YAML: bogus, AYATORI_REPO_ROOT: dir },
  });
  assert.equal(JSON.parse(res2.stdout).DEFAULT_TOOL, "bogus-model");
});

test("atomicWriteFileSync: 内容を原子的に置換し tmp 残骸を残さない (rename 失敗時も掃除して rethrow)", () => {
  const dir = tmpRoot("21f-atomic-");
  const file = join(dir, "state.json");
  writeFileSync(file, "old");
  atomicWriteFileSync(file, "new");
  assert.equal(readFileSync(file, "utf8"), "new");
  const leftovers = () => readdirSync(dir).filter((n) => n.includes(".tmp-"));
  assert.deepEqual(leftovers(), [], "成功時に tmp を残さない");
  // rename 先をディレクトリで塞ぐ → throw するが tmp は掃除される
  const blocked = join(dir, "blocked.json");
  mkdirSync(blocked);
  assert.throws(() => atomicWriteFileSync(blocked, "x"));
  assert.deepEqual(leftovers(), [], "失敗時も tmp を残さない");
  // write 段の失敗 (親 dir 不在 → ENOENT) も catch 経路を通り、残骸ゼロ + 元エラーが透過する
  assert.throws(() => atomicWriteFileSync(join(dir, "no-such-dir", "x.json"), "x"), /ENOENT/);
  assert.deepEqual(leftovers(), [], "write 失敗時も tmp を残さない");
  // tmp パスをディレクトリで塞ぐ → writeFileSync が EISDIR、掃除失敗は握りつぶされ元エラーが出る
  const victim = join(dir, "victim.json");
  mkdirSync(join(dir, `.victim.json.tmp-${process.pid}`));
  assert.throws(() => atomicWriteFileSync(victim, "x"), /EISDIR/, "掃除の失敗が元エラーを隠さない");
});

// ═══ CLI: gather-context ═══

test("gather: 前提 assert の routing (未承認 / skip / 21e 未完 / stale / 完了済み / 対象 0 件)", () => {
  let f = makeApp({ notApproved: true });
  assert.equal(run(GATHER, f.root, [APP]).code, "E_SCREENS_NOT_APPROVED");
  f = makeApp({ skipDecision: true });
  assert.equal(run(GATHER, f.root, [APP]).code, "E_BLOCK_SKIPPED");
  f = makeApp({ no21eCompleted: true });
  assert.equal(run(GATHER, f.root, [APP]).code, "E_21E_NOT_DONE");
  f = makeApp();
  rmSync(join(f.app, "graphics", "raw", "badge-cart.png")); // 実体欠落 → stale
  const stale = run(GATHER, f.root, [APP]);
  assert.equal(stale.code, "E_21E_STALE");
  assert.deepEqual(stale.stale, ["badge-cart"]);
  f = makeApp({ completed21f: true });
  assert.equal(run(GATHER, f.root, [APP]).code, "E_ALREADY_COMPLETED");
  f = makeApp({
    excluded: [
      { graphic_id: "hero-dashboard", reason: "x", excluded_at: "2026-07-19T10:00:00+09:00" },
      { graphic_id: "badge-cart", reason: "x", excluded_at: "2026-07-19T10:00:00+09:00" },
    ],
  });
  assert.equal(run(GATHER, f.root, [APP]).code, "E_NO_TARGETS");
  assert.equal(run(GATHER, f.root, []).code, "E_USAGE");
  assert.equal(run(GATHER, f.root, ["../evil"]).code, "E_INVALID_APP_NAME");
});

test("gather: ok — 処理計画 (透過検証対象 / raw サイズ) を返し、何も書かない", () => {
  const f = makeApp();
  const before = readFileSync(join(f.app, "pipeline-state.json"), "utf8");
  const res = run(GATHER, f.root, [APP]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.counts, { pending: 2, done: 0, excluded: 0 });
  const badge = res.pending.find((p) => p.graphic_id === "badge-cart");
  assert.equal(badge.verify_transparency, true);
  assert.ok(badge.bytes_raw > 0);
  assert.equal(res.pending.find((p) => p.graphic_id === "hero-dashboard").verify_transparency, false);
  assert.equal(readFileSync(join(f.app, "pipeline-state.json"), "utf8"), before, "READ-ONLY 契約");
});

// ═══ CLI: postprocess-graphics ═══

test("postprocess: 正常系 — raw バイト無加工の PNG 正典化 + state の file 正典更新 + manifest + step21f_completed_at", () => {
  const f = makeApp();
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.processed.length, 2);
  assert.ok(res.step21f_completed_at);

  for (const p of res.processed) {
    assert.ok(p.file.endsWith(".png"), "正典は PNG (圧縮 ⑫ 非搭載)");
    const canonicalBytes = readFileSync(join(f.app, p.file));
    const rawBytes = readFileSync(join(f.app, "graphics", "raw", `${p.graphic_id}.png`));
    assert.ok(canonicalBytes.equals(rawBytes), "raw バイトが無加工でコピーされる (再エンコードなし)");
    assert.equal(p.bytes, rawBytes.length);
  }
  assert.equal(res.processed.find((p) => p.graphic_id === "badge-cart").transparency, "verified");
  assert.equal(res.processed.find((p) => p.graphic_id === "hero-dashboard").transparency, "n/a");

  const st = readState(f.app).screens.graphics;
  assert.ok(st.generated_files.every((g) => g.file.startsWith("screens/_shared/graphics/")), "file が正典パスへ更新される");
  assert.ok(st.step21f_completed_at);

  const mf = readManifest(f.app);
  const badge = mf.entries.find((e) => e.graphic_id === "badge-cart");
  assert.equal(badge.transparency, "verified");
  assert.ok(badge.alpha.border_transparent_ratio > 0.9);

  // 冪等性: 再実行は E_ALREADY_COMPLETED (処理は走らない)
  assert.equal(run(POSTPROCESS, f.root, [APP]).code, "E_ALREADY_COMPLETED");
});

test("postprocess: 透過検証 fail — 当該 slot は正典化されず degrade 分岐へ、他 slot は正典化済み", () => {
  const f = makeApp({ opaqueTransparentSlots: true }); // badge の raw を不透明で置く
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.code, "E_POSTPROCESS_FAILED");
  assert.equal(res.transparency_failures.length, 1);
  const fail = res.transparency_failures[0];
  assert.equal(fail.graphic_id, "badge-cart");
  assert.equal(fail.alpha.transparent_ratio, 0);
  assert.deepEqual(res.processed.map((p) => p.graphic_id), ["hero-dashboard"]);

  const st = readState(f.app).screens.graphics;
  assert.equal(st.step21f_completed_at, undefined, "失敗が残る限り完了記録は立たない");
  assert.ok(!existsSync(join(f.app, canonicalPath("badge-cart", "png"))), "fail slot は正典に置かれない");
  assert.ok(st.generated_files.find((g) => g.graphic_id === "badge-cart").file.startsWith("graphics/raw/"));
  assert.ok(st.generated_files.find((g) => g.graphic_id === "hero-dashboard").file.startsWith("screens/_shared/"));
});

test("postprocess: 4096px 超の大判 slot も size_px 一致なら正典化される (固定 cap で billed slot を殺さない)", () => {
  // size_px は上流 schema に上限が無い — 21e が正規に生成・課金した大判 raw を 21f が拒むと
  // 「リトライ = 再課金で同じ失敗」の無限ループになる。防壁は size_px 完全一致の契約検証で持つ
  const wide = { graphic_id: "hero-wide", prompt: "Ultra wide hero band.", size_px: { width: 4200, height: 16 } };
  const f = makeApp({ prompts: [wide] });
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.processed[0].graphic_id, "hero-wide");
});

test("postprocess: raw 寸法が size_px と不一致 → 契約違反として file_failures (黙って正典化しない)", () => {
  const f = makeApp();
  // hero の raw を確定寸と違うサイズで差し替える (手動差し替え相当)
  writeFileSync(join(f.app, "graphics", "raw", "hero-dashboard.png"), opaquePng(10, 10));
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.code, "E_POSTPROCESS_FAILED");
  assert.equal(res.file_failures[0].graphic_id, "hero-dashboard");
  assert.match(res.file_failures[0].error, /不一致/);
});

test("postprocess: 正典書き込み失敗が per-slot で隔離される (他 slot は処理され、構造化 JSON が返る)", () => {
  const f = makeApp();
  // hero の正典パスをディレクトリで塞ぐ → writeFileSync が EISDIR で throw する slot 限定の書き込み失敗
  mkdirSync(join(f.app, canonicalPath("hero-dashboard", "webp")), { recursive: true });
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.code, "E_POSTPROCESS_FAILED", "exit 1 でなく構造化 JSON で返ること");
  assert.equal(res.file_failures.length, 1);
  assert.equal(res.file_failures[0].graphic_id, "hero-dashboard");
  assert.match(res.file_failures[0].error, /書き込み/);
  assert.deepEqual(res.processed.map((p) => p.graphic_id), ["badge-cart"], "失敗 slot 以外は処理が継続される");
  assert.equal(readState(f.app).screens.graphics.step21f_completed_at, undefined);
});

test("postprocess: manifest 書き込み失敗時は state を正典化済みにしない (再実行で台帳が必ず埋まる)", () => {
  const f = makeApp();
  // manifest パスをディレクトリで塞ぐ → writeManifest が throw (state より先に書く契約の検証)
  const manifestPath = join(f.app, "graphics", "postprocess-manifest.json");
  mkdirSync(manifestPath, { recursive: true });
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.code, "E_POSTPROCESS_FAILED");
  const g = readState(f.app).screens.graphics;
  assert.ok(
    g.generated_files.every((x) => x.file.startsWith("graphics/raw/")),
    "台帳が書けていないのに state だけ正典化済みにしない (doneSlots 化して台帳 entry が永久欠落する)"
  );
  // 障害を除去して再実行 → 全 slot 処理され、台帳に transparency ラベルも揃う
  rmSync(manifestPath, { recursive: true, force: true });
  const res2 = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res2.ok, true, JSON.stringify(res2));
  const mf = readManifest(f.app);
  assert.equal(mf.entries.length, 2);
  assert.equal(mf.entries.find((e) => e.graphic_id === "badge-cart").transparency, "verified");
});

test("postprocess: raw 破損 — file_failures に載り、正典化されない", () => {
  const f = makeApp({ corruptRaw: ["hero-dashboard"] });
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.code, "E_POSTPROCESS_FAILED");
  assert.equal(res.file_failures.length, 1);
  assert.match(res.file_failures[0].error, /decode/);
  assert.deepEqual(res.processed.map((p) => p.graphic_id), ["badge-cart"]);
});

test("postprocess: 旧仕様 (WebP 化) run の .webp 残骸は PNG 正典化時に掃除される", () => {
  const f = makeApp();
  // 旧仕様の run が残した体の .webp を正典 dir に置く
  mkdirSync(join(f.app, "screens", "_shared", "graphics"), { recursive: true });
  writeFileSync(join(f.app, canonicalPath("hero-dashboard", "webp")), "stale-webp-bytes");
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(f.app, canonicalPath("hero-dashboard", "png"))));
  assert.ok(!existsSync(join(f.app, canonicalPath("hero-dashboard", "webp"))), "両拡張子並存を残さない");
});

// ═══ CLI: commit-degrade (waive / retry / exclude / abort) ═══

test("degrade waive: fail 中の透過 slot のみ受諾でき、再実行でラベル付き正典化される", () => {
  const f = makeApp({ opaqueTransparentSlots: true });
  run(POSTPROCESS, f.root, [APP]); // badge が fail

  // guard: 非透過 slot / pass する slot / reason なし
  assert.equal(run(DEGRADE, f.root, [APP, "waive", "hero-dashboard", "--reason", "x"]).code, "E_NOT_TRANSPARENT_SLOT");
  assert.equal(run(DEGRADE, f.root, [APP, "waive", "badge-cart"]).code, "E_USAGE");

  const ok = run(DEGRADE, f.root, [APP, "waive", "badge-cart", "--reason", "背景ごと使う配置に変更"]);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const waived = readState(f.app).screens.graphics.transparency_waived;
  assert.equal(waived.length, 1);
  assert.equal(waived[0].graphic_id, "badge-cart");
  assert.ok(waived[0].source_digest);
  assert.equal(waived[0].raw_sha256, sha256Of(readFileSync(join(f.app, "graphics", "raw", "badge-cart.png"))), "受諾は raw バイトに束縛される");

  assert.equal(run(DEGRADE, f.root, [APP, "waive", "badge-cart", "--reason", "x"]).code, "E_ALREADY_WAIVED");

  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.processed.find((p) => p.graphic_id === "badge-cart").transparency, "waived");
  const mf = readManifest(f.app);
  assert.equal(mf.entries.find((e) => e.graphic_id === "badge-cart").transparency, "waived");
  assert.ok(readState(f.app).screens.graphics.step21f_completed_at);
});

test("degrade waive: pass する slot への waive は E_WAIVER_NOT_NEEDED", () => {
  const f = makeApp(); // badge は正しく透過
  assert.equal(run(DEGRADE, f.root, [APP, "waive", "badge-cart", "--reason", "x"]).code, "E_WAIVER_NOT_NEEDED");
});

test("degrade waive: waiver は raw バイト単位 — 同 digest の再生成 (別バイト) の再 fail には自動適用されない", () => {
  // 21g 品質差し戻し (F-7: entry 削除 + completed_at クリアのみ、waiver 未除去) → 21e 同 prompt
  // 再抽選 → 再 fail の経路で、旧バイトへの受諾が未見の新画像に黙って適用されないこと (PR #185 レビュー指摘)
  const f = makeApp({ opaqueTransparentSlots: true });
  run(DEGRADE, f.root, [APP, "waive", "badge-cart", "--reason", "一旦受諾"]);
  // 同 prompt 再抽選を模擬: digest (prompt/tool/size 由来) 不変のまま raw バイトだけ変える (依然 fail する不透明画像)
  writeFileSync(join(f.app, "graphics", "raw", "badge-cart.png"), makePng(32, 32, () => [10, 20, 30, 255]));
  const res = run(POSTPROCESS, f.root, [APP]);
  assert.equal(res.code, "E_POSTPROCESS_FAILED", "旧受諾は別バイトに適用されず degrade 質問に戻る");
  assert.ok(res.transparency_failures.some((t) => t.graphic_id === "badge-cart"));
  // 新バイトへの waive は E_ALREADY_WAIVED にならず受け付けられ、旧記録は置換される (1 slot 1 記録)
  const ok = run(DEGRADE, f.root, [APP, "waive", "badge-cart", "--reason", "新画像も受諾"]);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const waived = readState(f.app).screens.graphics.transparency_waived;
  assert.equal(waived.filter((w) => w.graphic_id === "badge-cart").length, 1);
  const done = run(POSTPROCESS, f.root, [APP]);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.processed.find((p) => p.graphic_id === "badge-cart").transparency, "waived");
});

test("degrade retry: entry 削除 + step21e_completed_at クリア + waiver 除去 → 21e へ戻る", () => {
  const f = makeApp({
    opaqueTransparentSlots: true,
    waived: [{ graphic_id: "badge-cart", source_digest: sourceDigestOf(ENTRIES()[1], "gpt-image-2"), reason: "旧受諾", waived_at: "2026-07-19T12:00:00+09:00" }],
  });
  const res = run(DEGRADE, f.root, [APP, "retry", "badge-cart", "--reason", "透過が必要なので再抽選"]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.match(res.next, /21e/);
  const g = readState(f.app).screens.graphics;
  assert.ok(!g.generated_files.some((x) => x.graphic_id === "badge-cart"), "entry 削除 = 再生成の記録 (設計 §9-2b)");
  assert.equal(g.step21e_completed_at, undefined);
  assert.equal(g.transparency_waived, undefined, "リトライ意図に反する旧 waiver を残さない");
  // 21f を再実行すると 21e 未完で差し戻される
  assert.equal(run(GATHER, f.root, [APP]).code, "E_21E_NOT_DONE");
});

test("degrade exclude: excluded_slots append + 残 slot 完了で step21f_completed_at / 全除外で decision=skip (step21f)", () => {
  // hero を先に正典化してから badge を除外 → 完了記録が立つ
  let f = makeApp({ opaqueTransparentSlots: true });
  run(POSTPROCESS, f.root, [APP]);

  // 正典化済み slot の除外は 21g の却下手順へ誘導 (21f 未完了のうちに guard を確認)
  assert.equal(run(DEGRADE, f.root, [APP, "exclude", "hero-dashboard", "--reason", "x"]).code, "E_ALREADY_CANONICAL");

  let res = run(DEGRADE, f.root, [APP, "exclude", "badge-cart", "--reason", "透過が作れないため見送り"]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.step21f_completed_at);
  let g = readState(f.app).screens.graphics;
  assert.equal(g.excluded_slots[0].graphic_id, "badge-cart");
  assert.equal(g.decision, "generate");

  // 21f 完了後の degrade は E_ALREADY_COMPLETED で 21g へ誘導 (完了後の取り下げは 21g 却下手順 — 設計 §11)
  assert.equal(run(DEGRADE, f.root, [APP, "exclude", "hero-dashboard", "--reason", "x"]).code, "E_ALREADY_COMPLETED");

  // 全 slot 除外 → ブロック中止と同義 (decided_by=step21f)
  f = makeApp({ prompts: [ENTRIES()[1]], opaqueTransparentSlots: true });
  run(POSTPROCESS, f.root, [APP]);
  res = run(DEGRADE, f.root, [APP, "exclude", "badge-cart", "--reason", "全滅"]);
  assert.equal(res.decision, "skip");
  assert.equal(res.decided_by, "step21f");
  g = readState(f.app).screens.graphics;
  assert.equal(g.decision, "skip");
  assert.equal(g.decided_by, "step21f");
});

test("degrade abort: decision=skip (decided_by=step21f)、reason 必須", () => {
  const f = makeApp();
  assert.equal(run(DEGRADE, f.root, [APP, "abort"]).code, "E_USAGE");
  const res = run(DEGRADE, f.root, [APP, "abort", "--reason", "後処理を見送り"]);
  assert.equal(res.ok, true);
  const g = readState(f.app).screens.graphics;
  assert.equal(g.decision, "skip");
  assert.equal(g.decided_by, "step21f");
});

test("degrade retry: 正典化済み slot / 生成記録なし slot への retry は guard される", () => {
  const f = makeApp({ opaqueTransparentSlots: true });
  run(POSTPROCESS, f.root, [APP]); // hero 正典化 / badge 透過 fail
  // 正典化済みの健康な slot への retry (graphic_id 誤指定) → 拒否 + 21g 差し戻しへ誘導
  const done = run(DEGRADE, f.root, [APP, "retry", "hero-dashboard", "--reason", "誤指定"]);
  assert.equal(done.code, "E_ALREADY_CANONICAL");
  const g = readState(f.app).screens.graphics;
  assert.ok(g.generated_files.some((x) => x.graphic_id === "hero-dashboard"), "entry が消えていないこと");
  assert.ok(g.step21e_completed_at, "21e 完了記録が消えていないこと");
  // 正規の retry (badge) → 2 回目の retry は生成記録なしで guard
  assert.equal(run(DEGRADE, f.root, [APP, "retry", "badge-cart", "--reason", "再抽選"]).ok, true);
  assert.equal(run(DEGRADE, f.root, [APP, "retry", "badge-cart", "--reason", "再抽選"]).code, "E_SLOT_NOT_GENERATED");
});

test("degrade exclude: stale slot が 21e 完了済みのまま残る場合、21e 再実行 (E_ALREADY_COMPLETED で弾かれる死路) を案内しない", () => {
  // S1 = hero を stale 化 (raw 手動削除)、S2 = badge 透過 fail。step21e_completed_at は set のまま
  const f = makeApp({ opaqueTransparentSlots: true });
  rmSync(join(f.app, "graphics", "raw", "hero-dashboard.png"));
  const res = run(DEGRADE, f.root, [APP, "exclude", "badge-cart", "--reason", "透過が作れないため見送り"]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.remaining.stale, ["hero-dashboard"]);
  assert.ok(!res.next.includes("先行 retry 分"), "stale の原因を retry と誤帰属しない");
  assert.match(res.next, /retry|手動リセット/, "実行可能な復旧 (retry / 手動リセット) を案内する");
  assert.ok(!/21e.*から再実行する/.test(res.next), "21e 完了済みのまま 21e 再実行を案内しない (E_ALREADY_COMPLETED の死路)");
});

test("degrade retry --canonical: 正典化済み slot を意図確認の上で 21e からやり直せる (21g 実装前の暫定経路)", () => {
  // waive → 正典化 → 反悔 (やはり透過が欲しい) の scenario — 素の retry は拒否されるが --canonical で通る
  const f = makeApp({ opaqueTransparentSlots: true });
  run(POSTPROCESS, f.root, [APP]); // badge が透過 fail
  run(DEGRADE, f.root, [APP, "waive", "badge-cart", "--reason", "一旦受諾"]);
  assert.equal(run(POSTPROCESS, f.root, [APP]).ok, true); // waived で正典化 + 21f 完了
  assert.ok(readState(f.app).screens.graphics.step21f_completed_at);

  // 素の retry は完了済み state で E_ALREADY_COMPLETED (allowCompleted は --canonical のみ)
  assert.equal(run(DEGRADE, f.root, [APP, "retry", "badge-cart", "--reason", "反悔"]).code, "E_ALREADY_COMPLETED");

  const res = run(DEGRADE, f.root, [APP, "retry", "badge-cart", "--reason", "やはり透過が必要", "--canonical"]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.canonical_removed, true);
  const g = readState(f.app).screens.graphics;
  assert.ok(!g.generated_files.some((x) => x.graphic_id === "badge-cart"), "entry 削除 = 再生成の記録");
  assert.equal(g.transparency_waived, undefined, "waiver も除去 (反悔の意図に反する自動適用を防ぐ)");
  assert.equal(g.step21e_completed_at, undefined);
  assert.equal(g.step21f_completed_at, undefined, "再生成後に 21f を再通過させる");
  assert.ok(!existsSync(join(f.app, canonicalPath("badge-cart", "png"))), "旧正典を残骸にしない");
  assert.ok(existsSync(join(f.app, canonicalPath("hero-dashboard", "png"))), "他 slot の正典は無傷");

  // guard: 未正典化 slot への --canonical は通常 retry へ誘導
  const f2 = makeApp({ opaqueTransparentSlots: true });
  run(POSTPROCESS, f2.root, [APP]);
  assert.equal(run(DEGRADE, f2.root, [APP, "retry", "badge-cart", "--reason", "x", "--canonical"]).code, "E_SLOT_NOT_CANONICAL");
  // guard: retry 以外への --canonical は E_USAGE
  assert.equal(run(DEGRADE, f2.root, [APP, "exclude", "badge-cart", "--reason", "x", "--canonical"]).code, "E_USAGE");
});

test("degrade: 同一 run の複数 slot degrade は順序非依存 (retry が先でも後続 exclude/abort が通る)", () => {
  // badge = 透過 fail / hero = decode fail の 2 失敗 run を想定
  let f = makeApp({ opaqueTransparentSlots: true, corruptRaw: ["hero-dashboard"] });
  run(POSTPROCESS, f.root, [APP]);
  // 先に hero を retry (step21e_completed_at がクリアされる)
  assert.equal(run(DEGRADE, f.root, [APP, "retry", "hero-dashboard", "--reason", "raw 破損を再生成"]).ok, true);
  assert.equal(readState(f.app).screens.graphics.step21e_completed_at, undefined);
  // 後続の exclude が E_21E_NOT_DONE で落ちず記録されること (順序依存の解消)
  const ex = run(DEGRADE, f.root, [APP, "exclude", "badge-cart", "--reason", "透過が作れないため見送り"]);
  assert.equal(ex.ok, true, JSON.stringify(ex));
  assert.match(ex.next, /21e/, "先行 retry 分が残るため次アクションは 21e 再実行");
  const g = readState(f.app).screens.graphics;
  assert.equal(g.excluded_slots[0].graphic_id, "badge-cart");
  assert.equal(g.step21f_completed_at, undefined, "21e 未完了のまま 21f 完了記録を立てない");

  // abort も同様に通る (別 fixture)
  f = makeApp({ opaqueTransparentSlots: true, corruptRaw: ["hero-dashboard"] });
  run(DEGRADE, f.root, [APP, "retry", "hero-dashboard", "--reason", "x"]);
  const ab = run(DEGRADE, f.root, [APP, "abort", "--reason", "全体を見送り"]);
  assert.equal(ab.ok, true, JSON.stringify(ab));
  assert.equal(readState(f.app).screens.graphics.decision, "skip");
});

test("degrade: 存在しない slot / 除外済み slot の guard", () => {
  const f = makeApp({ excluded: [{ graphic_id: "badge-cart", reason: "x", excluded_at: "2026-07-19T10:00:00+09:00" }] });
  assert.equal(run(DEGRADE, f.root, [APP, "retry", "nope", "--reason", "x"]).code, "E_SLOT_NOT_FOUND");
  assert.equal(run(DEGRADE, f.root, [APP, "exclude", "badge-cart", "--reason", "x"]).code, "E_ALREADY_EXCLUDED");
});
