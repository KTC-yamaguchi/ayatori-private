#!/usr/bin/env node
// skills/21c-graphic-taste/evals/graphic-taste-scripts-evals.test.mjs
//
// Step 21c の同梱 script 3 本 (gather-context / generate-samples / commit-taste) の **CLI 契約テスト**:
// 黒箱 CLI として fixture (tmpdir に組み立てた artifacts ツリー) に対して回し、stdout JSON の
// routing 契約 (ok / E_* code) と書き込み副作用 (samples / manifest / compare HTML /
// graphic-plan.json taste / pipeline-state.json / _backup 退避) を固定する。生成 API は
// node:http のローカル mock server (AYATORI_IMAGE_API_BASE で差し込み) で代替し、
// ネットワーク非依存で cache / 部分失敗の契約を検証する。
//
// fixture 規約: 21b の eval と同じ — golden なし、makeApp() が tmpdir に毎回組み立て、
// AYATORI_REPO_ROOT env で差し込む (作業ツリーの artifacts/ を汚さない)。
//
// 使い方:
//   npm test                                                                            # 検証 (node --test discovery)
//   node --test skills/21c-graphic-taste/evals/graphic-taste-scripts-evals.test.mjs     # 本 eval のみ
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const GENERATE = join(HERE, "..", "scripts", "generate-samples.mjs");
const COMMIT = join(HERE, "..", "scripts", "commit-taste.mjs");
const APP = "testapp";

// 1x1 透過 PNG (mock 応答用)
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_B64, "base64");

/** tmpdir に artifacts/testapp の fixture ツリーを組み立てる。opts で状態を変形する。 */
function makeApp(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "21c-eval-"));
  const app = join(root, "artifacts", APP);
  mkdirSync(join(app, "graphics"), { recursive: true });

  const graphics = { decision: "generate", step21a_completed_at: "2026-07-16T10:00:00+09:00" };
  if (opts.noDecision) delete graphics.decision;
  if (opts.skipDecision) Object.assign(graphics, { decision: "skip", decided_by: "step21b" });
  if (opts.tasteConfirmed) graphics.taste_confirmed_at = "2026-07-17T09:00:00+09:00";
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
            // content を先頭に置く: representative_slot が並び順でなく size_role 優先で選ばれることの検証用
            { graphic_id: "empty-cart", screen: "01-login", platforms: ["web"], placement: "empty state", size_role: "content", state: "default" },
            { graphic_id: "hero-dashboard", screen: "02-dashboard", platforms: ["web"], placement: "ヒーロー領域", size_role: "hero", state: "default" },
          ],
      ...(opts.planExtra ?? {}),
    };
    writeFileSync(join(app, "graphics", "graphic-plan.json"), JSON.stringify(plan, null, 2));
  }

  if (opts.legacyTokens) {
    // 旧形式 (W3C $type/$value でない) — 色は存在するが導出できないケース (PR #169 レビュー指摘)
    writeFileSync(
      join(app, "tokens.json"),
      JSON.stringify({ primitive: { colors: { primary: { value: "#0E7C90" }, bg: { value: "#EAF2F4" } } } })
    );
  } else if (opts.colorlessTokens) {
    // W3C 形式だが color token が 1 つも無いケース (HEX 文字列自体が不在)
    writeFileSync(
      join(app, "tokens.json"),
      JSON.stringify({ global: { size: { "space-md": { $value: "16px", $type: "dimension" } } } })
    );
  } else if (!opts.noTokens) {
    writeFileSync(
      join(app, "tokens.json"),
      JSON.stringify({
        global: {
          color: {
            bg: { $value: "#EAF2F4", $type: "color" },
            primary: { $value: "#0e7c90", $type: "color" },
            "on-surface": { $value: "#13242B", $type: "color" },
          },
        },
        semantic: { color: { cta: { $value: "{global.color.primary}", $type: "color" } } }, // 参照 (HEX でない) は導出対象外
      })
    );
  }
  if (opts.designBrief) writeFileSync(join(app, "design-brief.yaml"), "schema: design-brief:final:v1\n");

  return { root, app };
}

/** script を黒箱 CLI として実行する。env で生成 API キー系を既定 disable (テストごとに差し込む)。 */
function run(script, root, args, stdin, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      AYATORI_REPO_ROOT: root,
      OPENAI_API_KEY: "",
      AYATORI_IMAGE_API_KEY: "",
      // 実行マシンの実 ~/.ayatori/image-api-key を読ませない (存在しないパスへ差し替え —
      // これが無いとキー設定済みマシンで E_NO_API_KEY 系の契約テストが成立しない)
      AYATORI_IMAGE_API_KEY_FILE: join(root, ".no-credentials"),
      AYATORI_IMAGE_API_BASE: "",
      AYATORI_IMAGE_MODEL: "",
      ...env,
    },
    input: stdin,
  });
  assert.equal(res.status, 0, `exit 0 契約 (routing は JSON の code で行う)。stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** mock server (親プロセスの event loop 上) と併用する async 版 run — spawnSync は親 loop を
 *  塞いで server が応答できず deadlock するため、mock を使うテストは必ずこちらを使う。 */
function runAsync(script, root, args, stdin, env = {}, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        AYATORI_REPO_ROOT: root,
        OPENAI_API_KEY: "",
        AYATORI_IMAGE_API_KEY: "",
        // 同期版 run と対称に保つ — 落とすと将来 async 経路で no-key ケースを書いたときに
        // 実行マシンの実 ~/.ayatori/image-api-key を読み、API base 未差し替えなら実 API へ
        // 課金しうる (現状は全 call site が mock.env でキーを渡すため無害)
        AYATORI_IMAGE_API_KEY_FILE: join(root, ".no-credentials"),
        AYATORI_IMAGE_API_BASE: "",
        AYATORI_IMAGE_MODEL: "",
        ...env,
      },
    });
    onSpawn?.(child); // 途中 kill 系テスト用に child を露出する
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (status) => {
      try {
        assert.equal(status, 0, `exit 0 契約 (routing は JSON の code で行う)。stderr: ${stderr}`);
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(stdin ?? "");
  });
}

const readState = (app) => JSON.parse(readFileSync(join(app, "pipeline-state.json"), "utf8"));
const readPlan = (app) => JSON.parse(readFileSync(join(app, "graphics", "graphic-plan.json"), "utf8"));

/** 生成 API の mock server。failWhen(prompt) が true の間は 500 を返す。
 *  hangWhen(prompt) が true なら応答を返さず保留する (呼び出し側 kill による途中中断の再現用。
 *  保留到達は state.onHang で通知)。
 *  urlMode: b64_json の代わりに data[0].url を返し、GET でその PNG を配信する (fallback 経路の検証)。 */
function startMock(opts = {}) {
  const requests = [];
  const state = { failWhen: opts.failWhen ?? (() => false), hangWhen: () => false, onHang: null };
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      // urlMode の画像配信 endpoint
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG_BYTES);
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      requests.push({ url: req.url, ...parsed });
      if (state.hangWhen(parsed.prompt ?? "")) {
        state.onHang?.(); // 応答せず保留 — client 側 socket が破棄されるまでこの request は完了しない
        return;
      }
      if (state.failWhen(parsed.prompt ?? "")) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock failure" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: [opts.urlMode ? { url: `http://${req.headers.host}/img.png` } : { b64_json: PNG_B64 }],
        })
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        requests,
        state,
        env: { AYATORI_IMAGE_API_KEY: "test-key", AYATORI_IMAGE_API_BASE: `http://127.0.0.1:${port}/v1` },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const VARIANTS_INPUT = {
  level1_words: ["洗練"],
  subject: "A small friendly compact car parked under a tree's cool shadow, centered composition.",
  variants: [
    { id: "A", label: "洗練A (無描線ソフト水彩)", style_block: "soft watercolor illustration style without outlines, gentle muted colors harmonized with #0E7C90 on a light background" },
    { id: "B", label: "洗練B (細線ミニマル)", style_block: "minimal thin line art style, generous negative space, single accent color #0E7C90" },
    { id: "C", label: "洗練C (フラットベクター)", style_block: "flat vector illustration style, rounded geometric shapes, soft gradients" },
  ],
};

const VALID_TASTE = {
  level1_words: ["洗練"],
  level2_choice: "A",
  style_directive: "Soft watercolor illustration style without outlines, generous negative space, gentle muted colors harmonized with #0E7C90 (teal) and #EAF2F4 (light celadon), on a light background.",
  sample_files: ["graphics/samples/taste-a.png"],
  palette_hints: ["#0E7C90 (global.color.primary)", "#EAF2F4 (global.color.bg)"],
};

// ── gather-context.mjs ───────────────────────────────────────────────────────

test("gather: ok — slot 要約 / 代表 slot (size_role 優先) / palette 導出 (役割優先 + 導出元併記) / api_available=false", () => {
  const { root } = makeApp();
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.equal(out.slot_count, 2);
    assert.equal(out.representative_slot.graphic_id, "hero-dashboard"); // 並び順 2 番目でも hero が代表
    assert.deepEqual(out.palette_hints, [
      "#0E7C90 (global.color.primary)", // 小文字 hex は大文字正規化 + primary が先頭
      "#EAF2F4 (global.color.bg)",
      "#13242B (global.color.on-surface)",
    ]);
    assert.equal(out.api_available, false);
    assert.equal(out.design_brief, null);
    assert.ok(out.warnings.some((w) => w.includes("design-brief.yaml")), "design-brief 不在は明示 warning");
    assert.deepEqual(out.samples.cached_variants, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: design-brief あり + キー設定で design_brief/api_available が立つ / tokens 不在は warning + 空 hints", () => {
  const { root } = makeApp({ designBrief: true, noTokens: true });
  try {
    const out = run(GATHER, root, [APP], undefined, { AYATORI_IMAGE_API_KEY: "k" });
    assert.equal(out.ok, true);
    assert.equal(out.design_brief, "design-brief.yaml");
    assert.equal(out.api_available, true);
    assert.deepEqual(out.palette_hints, []);
    assert.ok(out.warnings.some((w) => w.includes("tokens.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: 旧形式 tokens (W3C 以外) は「見つからず」でなく形式相違 + 手渡し可を warning する (PR #169 レビュー指摘)", () => {
  const { root } = makeApp({ legacyTokens: true });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.deepEqual(out.palette_hints, []);
    const w = out.warnings.find((x) => x.includes("tokens.json"));
    assert.ok(w.includes("形式が想定") && w.includes("手渡し"), `形式相違の誤診防止文言: ${w}`);
    assert.ok(!w.includes("見つからず"), "色定義が存在するのに「見つからず」と誤診しない");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: color token が本当に無い tokens は従来どおり「見つからず」+ 手渡し可を warning する", () => {
  const { root } = makeApp({ colorlessTokens: true });
  try {
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.deepEqual(out.palette_hints, []);
    const w = out.warnings.find((x) => x.includes("tokens.json"));
    assert.ok(w.includes("見つからず") && w.includes("手渡し"), `color token 不在の文言: ${w}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, opts, code] of [
  ["Step 21 未承認", { notApproved: true }, "E_SCREENS_NOT_APPROVED"],
  ["21b 未確定", { noDecision: true }, "E_21B_NOT_DONE"],
  ["ブロック skip 確定", { skipDecision: true }, "E_BLOCK_SKIPPED"],
  ["テイスト確定済み", { tasteConfirmed: true }, "E_TASTE_ALREADY_SET"],
  ["plan 不在", { noPlan: true }, "E_PLAN_MISSING"],
  ["plan slots 空", { emptySlots: true }, "E_PLAN_INVALID"],
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

test("gather: manifest 不在でも配置済み taste-*.png を列挙する (手動生成 degrade の再入で見落とさない)", () => {
  const { root, app } = makeApp();
  try {
    mkdirSync(join(app, "graphics", "samples"), { recursive: true });
    for (const f of ["taste-a.png", "taste-c.png"]) writeFileSync(join(app, "graphics", "samples", f), PNG_BYTES);
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.equal(out.samples.manifest, null);
    assert.equal(out.samples.level1_words, null); // 手動配置 = 1 段階目の記録なし
    assert.deepEqual(out.samples.cached_variants, [
      { id: "A", label: null, file: "graphics/samples/taste-a.png", style_block: null, source: "disk" },
      { id: "C", label: null, file: "graphics/samples/taste-c.png", style_block: null, source: "disk" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gather: 失敗 run の manifest があっても手動配置 disk ファイルを見落とさない (manifest∪disk union + 逐語再利用素材)", async () => {
  const { root, app } = makeApp();
  const mock = await startMock({ failWhen: (p) => p.includes("flat vector") }); // C だけ落とす (初回 = prior なし)
  try {
    const gen = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env);
    assert.equal(gen.code, "E_GENERATION_FAILED");
    assert.equal("prior_cache_kept" in gen.failures[0], false, "初回失敗 = 旧世代なし");

    writeFileSync(join(app, "graphics", "samples", "taste-c.png"), PNG_BYTES); // guide §7 手動配置
    const out = run(GATHER, root, [APP]);
    assert.equal(out.ok, true);
    assert.equal(out.samples.subject, VARIANTS_INPUT.subject, "再入の逐語再利用用に subject を返す");
    assert.deepEqual(
      out.samples.cached_variants.map((v) => [v.id, v.source]),
      [["A", "manifest"], ["B", "manifest"], ["C", "disk"]],
      "manifest 存在時も disk-only ファイルを union で列挙 (either/or にしない)"
    );
    assert.equal(out.samples.cached_variants[0].style_block, VARIANTS_INPUT.variants[0].style_block);
    assert.equal(out.samples.cached_variants[2].style_block, null);
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
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

// ── generate-samples.mjs ─────────────────────────────────────────────────────

test("generate: キー未設定 → E_NO_API_KEY (API 呼び出し・書き込みなし)", () => {
  const { root, app } = makeApp();
  try {
    const out = run(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT));
    assert.equal(out.code, "E_NO_API_KEY");
    assert.equal(existsSync(join(app, "graphics", "samples")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: E_VALIDATION — variants 3 件 A/B/C 順・subject・level1_words を検証し API を呼ばない", () => {
  const { root } = makeApp();
  try {
    for (const [stdin, frag] of [
      [{ ...VARIANTS_INPUT, variants: VARIANTS_INPUT.variants.slice(0, 2) }, "ちょうど 3 件"],
      [{ ...VARIANTS_INPUT, variants: [VARIANTS_INPUT.variants[1], VARIANTS_INPUT.variants[0], VARIANTS_INPUT.variants[2]] }, "ちょうど 3 件"],
      [{ ...VARIANTS_INPUT, subject: "" }, "subject"],
      [{ ...VARIANTS_INPUT, level1_words: [] }, "level1_words"],
      [{ ...VARIANTS_INPUT, variants: [{ id: "A", label: "a" }, VARIANTS_INPUT.variants[1], VARIANTS_INPUT.variants[2]] }, "style_block"],
    ]) {
      const out = run(GENERATE, root, [APP, "--stdin"], JSON.stringify(stdin), { AYATORI_IMAGE_API_KEY: "k" });
      assert.equal(out.code, "E_VALIDATION", JSON.stringify(out));
      assert.ok(out.errors.some((e) => e.includes(frag)), `errors に「${frag}」を含む: ${JSON.stringify(out.errors)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: ok — 3 枚生成 + manifest (digest) + 比較 HTML。prompt は style_block + 共通 subject + 固定 tail", async () => {
  const { root, app } = makeApp();
  const mock = await startMock();
  try {
    const out = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(out.samples.map((s) => [s.id, s.cached]), [["A", false], ["B", false], ["C", false]]);
    assert.equal(mock.requests.length, 3);
    for (const req of mock.requests) {
      assert.equal(req.model, sotGraphicKey("tool"), "モデルは SoT (pipeline.yaml tool) から解決される");
      assert.equal(req.size, "1024x1024");
      assert.ok(req.prompt.includes(VARIANTS_INPUT.subject), "全 prompt に共通 subject (機械保証)");
      assert.ok(req.prompt.includes("No embedded text"), "固定 tail が付加される");
    }
    for (const f of ["taste-a.png", "taste-b.png", "taste-c.png"]) {
      assert.deepEqual(readFileSync(join(app, "graphics", "samples", f)), PNG_BYTES);
    }
    const manifest = JSON.parse(readFileSync(join(app, "graphics", "samples", "samples-manifest.json"), "utf8"));
    assert.equal(manifest.variants.length, 3);
    assert.ok(manifest.variants.every((v) => /^[0-9a-f]{64}$/.test(v.digest)));
    const html = readFileSync(join(app, "graphics", "samples", "taste-compare.html"), "utf8");
    assert.ok(html.includes(`src="data:image/png;base64,${PNG_B64}"`) && html.includes("洗練B (細線ミニマル)"));
    assert.ok(!html.includes('src="taste-a.png"'), "相対参照ではなく data URI 内包 — 閲覧環境の file:// 読取ブロックで破像しない (POCTEAMA-401)");
    assert.ok(html.includes("ILLUSTRATIVE"), "見本 (実データ非昇格) の明示");
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: cache — 同一入力の再実行は再生成ゼロ / style_block 改訂は当該 variant のみ再生成 / --force は全再生成", async () => {
  const { root } = makeApp();
  const mock = await startMock();
  try {
    await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env);
    assert.equal(mock.requests.length, 3);

    const again = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env);
    assert.equal(again.ok, true);
    assert.ok(again.samples.every((s) => s.cached === true), "digest 一致 + ファイル実在 → 全 cache 再利用");
    assert.equal(mock.requests.length, 3, "API 呼び出しが増えない");

    const revised = structuredClone(VARIANTS_INPUT);
    revised.variants[1].style_block += ", thinner lines"; // B のみ改訂 (§5 追加指示の再生成)
    const partial = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(revised), mock.env);
    assert.deepEqual(partial.samples.map((s) => [s.id, s.cached]), [["A", true], ["B", false], ["C", true]]);
    assert.equal(mock.requests.length, 4, "改訂した B だけ再生成");

    await runAsync(GENERATE, root, [APP, "--stdin", "--force"], JSON.stringify(revised), mock.env);
    assert.equal(mock.requests.length, 7, "--force は 3 件とも再生成");
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: cache は id + digest の複合キー — style_block の入れ替えは両 variant とも再生成する (finding 1 回帰)", async () => {
  const { root } = makeApp();
  const mock = await startMock();
  try {
    await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env);
    assert.equal(mock.requests.length, 3);

    const swapped = structuredClone(VARIANTS_INPUT);
    [swapped.variants[0].style_block, swapped.variants[1].style_block] = [swapped.variants[1].style_block, swapped.variants[0].style_block];
    const out = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(swapped), mock.env);
    assert.equal(out.ok, true);
    assert.deepEqual(out.samples.map((s) => [s.id, s.cached]), [["A", false], ["B", false], ["C", true]],
      "digest 単独 hit だと旧 B の画像が A のラベルで提示される — id 束縛で両方再生成");
    assert.equal(mock.requests.length, 5);
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: 部分失敗 → E_GENERATION_FAILED + stale 比較 HTML 削除 + 成功分は manifest 残置 → リトライは失敗分のみ再生成", async () => {
  const { root, app } = makeApp();
  const compareHtml = join(app, "graphics", "samples", "taste-compare.html");
  const mock = await startMock();
  try {
    await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env); // 全成功
    assert.equal(existsSync(compareHtml), true);
    assert.equal(mock.requests.length, 3);

    mock.state.failWhen = (p) => p.includes("flat vector"); // C だけ落とす
    const revised = structuredClone(VARIANTS_INPUT);
    revised.variants[2].style_block += ", flat vector revised"; // C を stale 化して再生成を強制
    const out = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(revised), mock.env);
    assert.equal(out.code, "E_GENERATION_FAILED");
    assert.deepEqual(out.failures.map((f) => f.id), ["C"]);
    assert.deepEqual(out.succeeded.map((s) => [s.id, s.cached]), [["A", true], ["B", true]]);
    assert.equal(existsSync(compareHtml), false, "失敗時は旧 run の比較 HTML を残置しない (finding 4 回帰)");
    assert.equal(mock.requests.length, 4);

    mock.state.failWhen = () => false; // 復旧
    const retry = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(revised), mock.env);
    assert.equal(retry.ok, true);
    assert.deepEqual(retry.samples.map((s) => [s.id, s.cached]), [["A", true], ["B", true], ["C", false]]);
    assert.equal(mock.requests.length, 5, "リトライは失敗した C のみ再生成 (コスト暴発防止)");
    assert.equal(existsSync(compareHtml), true, "全成功で比較 HTML が再生成される");
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: 失敗 variant の旧 entry は保持され、style を旧に戻すと再課金なしで cache hit する", async () => {
  const { root, app } = makeApp();
  const mock = await startMock();
  try {
    await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env); // 全成功 (3 req)
    mock.state.failWhen = (p) => p.includes("REVISEDFAIL");
    const revised = structuredClone(VARIANTS_INPUT);
    revised.variants[2].style_block += ", REVISEDFAIL";
    const failed = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(revised), mock.env); // C のみ再生成試行 → 失敗 (4 req)
    assert.equal(failed.code, "E_GENERATION_FAILED");
    assert.equal(failed.failures[0].prior_cache_kept, true, "旧世代 PNG 残置の印");
    const manifest = JSON.parse(readFileSync(join(app, "graphics", "samples", "samples-manifest.json"), "utf8"));
    assert.equal(manifest.variants.length, 3, "失敗 variant の旧 entry を manifest から落とさない");

    mock.state.failWhen = () => false;
    const revert = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env); // 旧 style に戻す
    assert.equal(revert.ok, true);
    assert.ok(revert.samples.every((s) => s.cached === true), "旧 digest ⇔ 旧 PNG の対応が生きている");
    assert.equal(mock.requests.length, 4, "revert で再課金しない (disk に同一出力があるのに再生成しない)");
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: loop 途中 kill でも未処理 variant の旧 entry を manifest から落とさない (増分 Write の seed / PR #169 指摘回帰)", async () => {
  const { root, app } = makeApp();
  const manifestPath = join(app, "graphics", "samples", "samples-manifest.json");
  const mock = await startMock();
  let child;
  try {
    await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env); // 全成功 (3 req)

    // A/B を改訂 → A 再生成完了後、B の生成中に kill する (C は未処理のまま到達しない)
    const revised = structuredClone(VARIANTS_INPUT);
    revised.variants[0].style_block += ", revised-a";
    revised.variants[1].style_block += ", HANG-B";
    mock.state.hangWhen = (p) => p.includes("HANG-B");
    const hangReached = new Promise((r) => (mock.state.onHang = r));
    const interrupted = runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(revised), mock.env, (c) => (child = c))
      .catch(() => null); // SIGKILL による異常終了は exit 0 契約の対象外 (中断そのものが被験シナリオ)
    await hangReached; // A の増分 Write は B の request 送信より前に完了している (直列 loop)
    const mid = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.deepEqual(mid.variants.map((v) => v.id), ["A", "B", "C"],
      "A 完了直後の増分 Write 時点でも、未処理の B/C の旧 entry が seed されて残る (seed なしだと A のみになる)");
    child.kill("SIGKILL");
    await interrupted;

    // リトライ: A (改訂済 digest + PNG 実在) と C (旧 entry 温存) は cache hit、再課金は B の 1 件だけ
    mock.state.hangWhen = () => false;
    const retry = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(revised), mock.env);
    assert.equal(retry.ok, true);
    assert.deepEqual(retry.samples.map((s) => [s.id, s.cached]), [["A", true], ["B", false], ["C", true]]);
    assert.equal(mock.requests.length, 6, "run1=3 + 中断 run (A 再生成 + B 保留) =2 + リトライ B=1 — C を再課金しない");
  } finally {
    child?.kill("SIGKILL"); // assertion fail 時も保留 connection を確実に破棄 (mock.close の永久待機防止)
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: data[0].url 応答は download fallback で保存する (b64_json 不在の API 互換)", async () => {
  const { root, app } = makeApp();
  const mock = await startMock({ urlMode: true });
  try {
    const out = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(VARIANTS_INPUT), mock.env);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(readFileSync(join(app, "graphics", "samples", "taste-a.png")), PNG_BYTES);
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate: 日本語混入は生成前 (課金前) に E_NON_ENGLISH で停止 / --allow-non-english で明示続行 / --stdin なしは E_USAGE", async () => {
  const { root } = makeApp();
  const mock = await startMock();
  try {
    const jp = structuredClone(VARIANTS_INPUT);
    jp.subject = "小さな車のイラスト"; // 英語前提
    const blocked = await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(jp), mock.env);
    assert.equal(blocked.code, "E_NON_ENGLISH");
    assert.equal(mock.requests.length, 0, "API 未呼び出し (課金前に止める)");

    const halfWidth = structuredClone(VARIANTS_INPUT);
    halfWidth.subject = "ﾐﾆﾏﾙ ｽﾀｲﾙ illustration"; // 半角カナ (U+FF61-FF9F) も検出対象
    assert.equal((await runAsync(GENERATE, root, [APP, "--stdin"], JSON.stringify(halfWidth), mock.env)).code, "E_NON_ENGLISH");

    const allowed = await runAsync(GENERATE, root, [APP, "--stdin", "--allow-non-english"], JSON.stringify(jp), mock.env);
    assert.equal(allowed.ok, true);
    assert.ok(allowed.warnings?.some((w) => w.includes("明示続行")), "明示続行の記録 warning");
    assert.equal(mock.requests.length, 3);

    assert.equal((await runAsync(GENERATE, root, [APP], "{}", mock.env)).code, "E_USAGE");
  } finally {
    await mock.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ── commit-taste.mjs ─────────────────────────────────────────────────────────

/** commit 系テスト用: sample_files の実在照合を通すためダミー PNG を配置する。 */
function placeSamples(app) {
  mkdirSync(join(app, "graphics", "samples"), { recursive: true });
  for (const f of ["taste-a.png", "taste-b.png", "taste-c.png"]) {
    writeFileSync(join(app, "graphics", "samples", f), PNG_BYTES);
  }
}

test("commit: ok — plan へ taste append (slots 保全・confirmed_at 採番) + state taste_confirmed_at 同値", () => {
  const { root, app } = makeApp();
  placeSamples(app);
  try {
    const out = run(COMMIT, root, [APP, "--stdin"], JSON.stringify(VALID_TASTE));
    assert.equal(out.ok, true, JSON.stringify(out));
    const plan = readPlan(app);
    assert.equal(plan.slots.length, 2, "slots は不変 (key 分離)");
    assert.equal(plan.created_at, "2026-07-16T12:00:00+09:00", "21b の init field は不変");
    assert.deepEqual(plan.taste.level1_words, ["洗練"]);
    assert.equal(plan.taste.level2_choice, "A");
    assert.match(plan.taste.confirmed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const g = readState(app).screens.graphics;
    assert.equal(g.taste_confirmed_at, plan.taste.confirmed_at, "plan と state の confirmed_at 同値契約");
    assert.equal(g.decision, "generate", "merge write で既存キー保全");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit --dry-run: 検証 OK でも一切書き込まない", () => {
  const { root, app } = makeApp();
  placeSamples(app);
  try {
    const out = run(COMMIT, root, [APP, "--stdin", "--dry-run"], JSON.stringify(VALID_TASTE));
    assert.equal(out.ok, true);
    assert.equal(out.dry_run, true);
    assert.equal("taste" in readPlan(app), false, "dry-run で plan 未更新");
    assert.equal("taste_confirmed_at" in readState(app).screens.graphics, false, "dry-run で state 未更新");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: sample_files 省略 (テキスト比較 degrade) でも確定できる (schema 上 optional)", () => {
  const { root, app } = makeApp();
  try {
    const { sample_files, ...noSamples } = VALID_TASTE;
    const out = run(COMMIT, root, [APP, "--stdin"], JSON.stringify(noSamples));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal("sample_files" in readPlan(app).taste, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: E_VALIDATION — required/enum/未知キー/palette 書式/実在照合/confirmed_at 持ち込みを列挙し書き込みゼロ", () => {
  const { root, app } = makeApp();
  placeSamples(app);
  try {
    for (const [patch, frag] of [
      [{ style_directive: undefined }, "'style_directive' が欠落"],
      [{ level2_choice: "D" }, "enum (A/B/C) 外"],
      [{ level1_words: [] }, "'level1_words' が欠落"],
      [{ extra_key: 1 }, "schema に無い field"],
      [{ palette_hints: ["teal っぽい色"] }, "導出元 token path"],
      [{ palette_hints: ["#12345 (global.color.x)"] }, "導出元 token path"], // 非正規桁 HEX (finding 6 回帰)
      [{ sample_files: ["graphics/samples/no-such.png"] }, "存在しません"],
      [{ sample_files: 5 }, "sample_files は array 型が必須"], // 非 iterable でも exit 1 にしない (finding 2 回帰)
      [{ palette_hints: 7 }, "palette_hints は array 型が必須"],
      [{ palette_hints: "" }, "palette_hints は array 型が必須"], // 空文字列を欠落扱いで素通りさせない (2nd round finding 1 回帰)
      [{ sample_files: "" }, "sample_files は array 型が必須"],
      [{ sample_files: null }, "「値なし」はキー省略で表現"], // null を素通りさせない (schema 違反のまま plan に固定される)
      [{ palette_hints: null }, "「値なし」はキー省略で表現"],
      [{ confirmed_at: "2026-07-17T00:00:00+09:00" }, "本 script が採番"],
    ]) {
      const draft = { ...structuredClone(VALID_TASTE), ...patch }; // undefined 値のキーは JSON.stringify が落とす (= 欠落)
      const out = run(COMMIT, root, [APP, "--stdin"], JSON.stringify(draft));
      assert.equal(out.code, "E_VALIDATION", JSON.stringify(out));
      assert.ok(out.errors.some((e) => e.includes(frag)), `errors に「${frag}」: ${JSON.stringify(out.errors)}`);
    }
    assert.equal("taste" in readPlan(app), false, "検証 NG で plan 未更新");
    assert.equal("taste_confirmed_at" in readState(app).screens.graphics, false, "検証 NG で state 未更新");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: style_directive の日本語混入は確定前に E_NON_ENGLISH で停止 / --allow-non-english で明示続行 / level1_words の日本語は対象外", () => {
  const { root, app } = makeApp();
  placeSamples(app);
  try {
    const jp = { ...structuredClone(VALID_TASTE), style_directive: "淡い水彩で洗練された感じ" };
    const blocked = run(COMMIT, root, [APP, "--stdin"], JSON.stringify(jp));
    assert.equal(blocked.code, "E_NON_ENGLISH");
    assert.equal("taste" in readPlan(app), false, "確定前に止める (何も書かない)");

    // VALID_TASTE は level1_words に日本語 (「洗練」) を含む — user 選択語の日本語は正であり flag 不要
    const allowed = run(COMMIT, root, [APP, "--stdin", "--allow-non-english"], JSON.stringify(jp));
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.equal(readPlan(app).taste.style_directive, "淡い水彩で洗練された感じ");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: 残置 taste (§5 手動リセット後) は _backup/graphics/ へ退避してから上書き", () => {
  const { root, app } = makeApp({
    planExtra: { taste: { level1_words: ["旧"], level2_choice: "B", style_directive: "old", confirmed_at: "2026-07-01T00:00:00+09:00" } },
  });
  placeSamples(app);
  try {
    const out = run(COMMIT, root, [APP, "--stdin"], JSON.stringify(VALID_TASTE));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.ok(out.backed_up);
    const backups = readdirSync(join(app, "_backup", "graphics")).filter((f) => /^graphic-plan\.\d{8}_\d{6}\.json$/.test(f));
    assert.equal(backups.length, 1);
    assert.equal(JSON.parse(readFileSync(join(app, "_backup", "graphics", backups[0]), "utf8")).taste.level2_choice, "B");
    assert.equal(readPlan(app).taste.level2_choice, "A");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit: 再 assert — テイスト確定済みなら E_TASTE_ALREADY_SET / --stdin なしは E_USAGE", () => {
  const { root } = makeApp({ tasteConfirmed: true });
  try {
    assert.equal(run(COMMIT, root, [APP, "--stdin"], JSON.stringify(VALID_TASTE)).code, "E_TASTE_ALREADY_SET");
    assert.equal(run(COMMIT, root, [APP], "{}").code, "E_USAGE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parse 不能 / 非 object stdin は E_BAD_INPUT (generate / commit とも exit 0 契約を守る)", () => {
  const { root } = makeApp();
  try {
    // generate: stdin parse は API キー検査より前 — キーありでも API を呼ばず E_BAD_INPUT
    assert.equal(run(GENERATE, root, [APP, "--stdin"], "not json {", { AYATORI_IMAGE_API_KEY: "k" }).code, "E_BAD_INPUT");
    assert.equal(run(GENERATE, root, [APP, "--stdin"], "[1,2]", { AYATORI_IMAGE_API_KEY: "k" }).code, "E_BAD_INPUT"); // 非 object も per-field エラーに縮退させない
    assert.equal(run(GENERATE, root, [APP, "--stdin"], "null", { AYATORI_IMAGE_API_KEY: "k" }).code, "E_BAD_INPUT");
    assert.equal(run(COMMIT, root, [APP, "--stdin"], "not json {").code, "E_BAD_INPUT");
    assert.equal(run(COMMIT, root, [APP, "--stdin"], "[1,2]").code, "E_BAD_INPUT"); // array は taste object でない
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backupFile: 同一秒の連続退避は -{i} 連番で衝突回避する (backup-on-edit.sh 規約と同型・silent 上書きしない)", async () => {
  const { backupFile } = await import("../scripts/preflight.mjs");
  const { root, app } = makeApp();
  try {
    const target = join(app, "graphics", "graphic-plan.json");
    const first = backupFile(app, target);
    writeFileSync(target, '{"v":2}');
    const second = backupFile(app, target);
    assert.notEqual(first, second, "同一秒でも別ファイルに退避される");
    assert.ok(existsSync(first) && existsSync(second));
    assert.match(second, /graphic-plan\.\d{8}_\d{6}(-\d+)?\.json$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pipelineDefaultTool: pipeline.yaml の tool SoT を実際に読む (hardcode に勝つ) / 読めなければ fail-open", async () => {
  const { pipelineDefaultTool } = await import("../scripts/preflight.mjs");
  // 実 repo の pipeline.yaml から読めている (期待値は独立オラクル — SoT の現値を字面量で pin しない)
  assert.equal(pipelineDefaultTool(), sotGraphicKey("tool"));
  // yamlPath 指定で SoT の差し替えが反映される
  const dir = mkdtempSync(join(tmpdir(), "21c-yaml-"));
  try {
    const yaml = join(dir, "pipeline.yaml");
    writeFileSync(yaml, "screens:\n  graphic_generation:\n    tool: next-gen-model\n");
    assert.equal(pipelineDefaultTool(yaml), "next-gen-model");
    assert.equal(pipelineDefaultTool(join(dir, "nonexistent.yaml")), "gpt-image-2", "読めない場合は fail-open");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scripts は NUL byte を含まない text ファイルである (git diff 可能)", () => {
  const scriptsDir = join(HERE, "..", "scripts");
  for (const f of readdirSync(scriptsDir).filter((n) => n.endsWith(".mjs"))) {
    const body = readFileSync(join(scriptsDir, f), "utf8");
    assert.equal(body.includes("\u0000"), false, `${f} に NUL byte`);
  }
});
