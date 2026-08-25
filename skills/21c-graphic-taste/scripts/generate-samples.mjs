#!/usr/bin/env node
// Step 21c (graphic-taste) のテイスト 2 段階目サンプル生成 — gpt-image-2 呼び出し + cache + 比較 HTML。
// F-3 テイスト選定
//
// usage:
//   node generate-samples.mjs <app_name> --stdin                        # stdin = {level1_words, subject, variants[A/B/C]}
//   node generate-samples.mjs <app_name> --stdin --force                # id+digest 一致でも強制再生成
//   node generate-samples.mjs <app_name> --stdin --allow-non-english    # 日本語混入を意図的として明示続行 (既定は E_NON_ENGLISH で生成前に停止)
//
// stdin 契約:
//   { "level1_words": ["洗練"],
//     "subject": "A friendly compact illustration of ... (英語、全 variant 共通のお題)",
//     "variants": [ { "id": "A", "label": "洗練A (無描線ソフト水彩)", "style_block": "..." }, ×3 ] }
//
// 決定的責務 (LLM に任せない部分):
//   - prompt の機械組み立て: prompt = style_block + subject + 固定 tail。subject を全 variant で
//     機械的に共通化する (「同一お題・テイストのみ可変」の比較前提を構造で保証 — 生成ツール比較の
//     ペア比較方法論と同型)。tail で no-text / 1:1 / 1024x1024 を固定する。
//   - cache / 再利用 (チケット設計観点): graphics/samples/samples-manifest.json に per-variant の
//     prompt digest を記録し、digest 一致 + ファイル実在なら再生成しない (gpt-image-2 は低速・有料。
//     追加指示での再生成は style_block が変わる = digest 不一致で該当 variant のみ自動再生成)。
//   - 比較 HTML (graphics/samples/taste-compare.html) の決定論生成 (render-color-report.mjs と同じ
//     「手焼き禁止」線引き)。画像は base64 data URI で内包し HTML 単体で自己完結させる —
//     相対参照だと閲覧環境側の file:// 子リソース読取ブロック (macOS のフォルダ権限拒否 /
//     拡張機能等) で破像し、人間ゲートが環境要因で止まる (POCTEAMA-401)。PNG 正典は
//     graphics/samples/*.png のまま (本 HTML は表示用の派生ビュー)。
//
// 生成 API (21e graphic-generate と共通の恒久契約 — docs/setup.md「グラフィック生成 API キー」):
//   - キー:       env AYATORI_IMAGE_API_KEY || ~/.ayatori/image-api-key || env OPENAI_API_KEY
//                 (無ければ E_NO_API_KEY — SKILL.md が degrade 分岐。優先順の根拠は preflight.mjs resolveApiKey)
//   - endpoint:   {AYATORI_IMAGE_API_BASE || https://api.openai.com/v1}/images/generations
//   - モデル:     AYATORI_IMAGE_MODEL || pipeline.yaml screens.graphic_generation.tool || gpt-image-2
//     — SoT を実際に読む (hardcode だけだと pipeline.yaml のツール差し替え後もテイスト見本が旧モデルで
//     生成され、user が承認したテイストと 21e の本生成モデルが食い違う。21e preflight と同じ判断)
// 応答は data[0].b64_json (優先) / data[0].url (fallback download) の両対応。
//
// stdout に JSON を 1 個出力する (exit 0 固定、routing は code。内部エラーのみ exit 1)。
// 部分失敗 (一部 variant のみ成功) は E_GENERATION_FAILED でも manifest に成功分を残す —
// リトライ時は成功分が cache hit して失敗分だけ再生成される (コスト暴発防止)。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertPreflight, atomicWriteFileSync, containsNonEnglish, isoNow, pipelineDefaultTool, readJson, resolveApiKey } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

const VARIANT_IDS = ["A", "B", "C"];
const SIZE = "1024x1024"; // sample は用途サイズと無関係の見本 (ILLUSTRATIVE) のため正方 1 種に固定
const FIXED_TAIL = "No embedded text, no readable letters, no real brand likeness. Square 1:1, resolution 1024x1024 pixels.";
const REQUEST_TIMEOUT_MS = 240_000; // gpt-image-2 は低速 (NanoBanana の 2〜3 倍)

const ensurePeriod = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const buildPrompt = (styleBlock, subject) => `${ensurePeriod(styleBlock)} ${ensurePeriod(subject)} ${FIXED_TAIL}`;
const digestOf = (model, prompt) => crypto.createHash("sha256").update(`${model}\n${SIZE}\n${prompt}`).digest("hex");

/** 比較 HTML (self-contained — 画像は base64 data URI 内包、外部参照ゼロ) を決定論生成する。 */
function renderCompareHtml(manifest, appRoot) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cards = manifest.variants
    .map(
      (v) => `    <section class="card">
      <h2>案 ${esc(v.id)} — ${esc(v.label)}</h2>
      <img src="data:image/png;base64,${fs.readFileSync(path.join(appRoot, v.file)).toString("base64")}" alt="taste-sample-${esc(v.id.toLowerCase())}" width="1024" height="1024">
      <details><summary>style block (prompt 抜粋)</summary><p>${esc(v.style_block)}</p></details>
    </section>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>テイスト比較 A/B/C — ${esc(manifest.app_name)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; margin: 24px; max-width: 1280px; }
  h1 { font-size: 1.3rem; }
  .meta { color: #666; font-size: .85rem; margin-bottom: 16px; }
  .notice { background: #fff8e1; border: 1px solid #e0c96b; border-radius: 6px; padding: 8px 12px; font-size: .85rem; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
  .card { border: 1px solid #ccc; border-radius: 8px; padding: 12px; }
  .card h2 { font-size: 1rem; margin: 0 0 8px; }
  .card img { width: 100%; height: auto; border-radius: 4px; background: #f3f3f3; }
  details { font-size: .8rem; margin-top: 8px; color: #555; }
  @media (prefers-color-scheme: dark) {
    .notice { background: #3a3320; border-color: #6b5f2e; }
    .card { border-color: #555; }
    .meta, details { color: #aaa; }
  }
</style>
</head>
<body>
<h1>テイスト 2 段階目: サンプルグラフィック比較 (A/B/C)</h1>
<p class="meta">app: ${esc(manifest.app_name)} / 1 段階目の選択: ${esc((manifest.level1_words ?? []).join("・"))} / 共通お題: ${esc(manifest.subject)} / 生成: ${esc(manifest.model)} / updated: ${esc(manifest.updated_at)}</p>
<div class="notice">⚠️ これは <strong>テイスト選定用の見本 (ILLUSTRATIVE)</strong> です。本番グラフィックは 21d でプロンプト確定後、21e で slot ごとに生成されます — 本画像は実データに昇格しません。</div>
<div class="grid">
${cards}
</div>
</body>
</html>
`;
}

/** 1 variant を生成 API で生成し PNG bytes を返す。失敗は throw。 */
async function generateImage(apiKey, model, prompt) {
  const base = (process.env.AYATORI_IMAGE_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, n: 1, size: SIZE }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    // 401/403 はキーが古い / 遮蔽されている場合に出る — 診断コマンドへ導く (POCTEAMA-408)
    // 案内はサーバ本文より **前** に置く — 失敗記録は failures[].error を 300 字で切るので、後置すると
    // 本文の長い gateway (LiteLLM / Azure 等の包装 401 は 200 字超) で案内だけが落ち、本 ticket が足した
    // 唯一の導線が届かない。401/403 は retryable=false なので再試行ログ (console.error) にも乗らず、
    // failures[].error が唯一の露出点であることが効いている。
    const authHint =
      res.status === 401 || res.status === 403
        ? "キーの認証失敗: `node scripts/setup-image-key.mjs --doctor` で実効ソースを確認する (env に残った旧キーがキーファイルを遮蔽している可能性) — "
        : "";
    throw new Error(`API ${res.status}: ${authHint}${body}`);
  }
  const json = await res.json();
  const item = json?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!img.ok) throw new Error(`image download ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("応答に data[0].b64_json / data[0].url がありません");
}

try {
  const args = process.argv.slice(2);
  const appName = args[0];
  const force = args.includes("--force");
  const allowNonEnglish = args.includes("--allow-non-english");
  if (!appName || !args.includes("--stdin")) {
    out({ ok: false, code: "E_USAGE", message: "usage: node generate-samples.mjs <app_name> --stdin [--force] [--allow-non-english]" });
  }

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot } = pre;

  // ── stdin 検証 (書き込み・API 呼び出しの前に全部弾く) ──
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin が JSON として parse できません" });
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin は {level1_words, subject, variants} の JSON object が必須" });
  }
  const errors = [];
  const words = input?.level1_words;
  if (!Array.isArray(words) || words.length === 0 || !words.every((w) => typeof w === "string" && w.trim())) {
    errors.push("level1_words は非空 string の 1 件以上の配列が必須 (1 段階目の user 選択)");
  }
  if (typeof input?.subject !== "string" || !input.subject.trim()) {
    errors.push("subject (全 variant 共通のお題、英語) が必須");
  }
  const variants = input?.variants;
  if (!Array.isArray(variants) || variants.length !== 3 || VARIANT_IDS.some((id, i) => variants[i]?.id !== id)) {
    errors.push("variants は id A/B/C のちょうど 3 件 (この順) が必須");
  } else {
    variants.forEach((v, i) => {
      for (const f of ["label", "style_block"]) {
        if (typeof v[f] !== "string" || !v[f].trim()) errors.push(`variants[${i}] (${VARIANT_IDS[i]}): ${f} が欠落/空`);
      }
    });
  }
  if (errors.length) out({ ok: false, code: "E_VALIDATION", errors });

  // 日本語混入は生成 (低速・有料 ×3) の前に止める — warning を最終 JSON で返すだけだと
  // 「3 回課金した後に英訳して再実行 = さらに 3 回課金」になる (self-review 2nd round finding 2)。
  // 固有名詞の原語表記等の意図的なケースは --allow-non-english で明示して通す (OP4: 無言で進めない。
  // 文字入れ [embedded text] 指示は意図的でも不可 — guide §3 の禁止事項)
  const warnings = [];
  if (containsNonEnglish(input.subject + variants.map((v) => v.style_block).join(""))) {
    if (!allowNonEnglish) {
      out({
        ok: false,
        code: "E_NON_ENGLISH",
        message:
          "subject / style_block に日本語が含まれる — プロンプトは英語が前提 (生成ツール比較の前提条件)。誤りなら英訳して再実行、意図的なら --allow-non-english を付けて再実行する (API は未呼び出し・課金なし)",
      });
    }
    warnings.push("subject / style_block に日本語が含まれる (--allow-non-english で明示続行)");
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    out({
      ok: false,
      code: "E_NO_API_KEY",
      message:
        "生成 API キーが未設定 (env AYATORI_IMAGE_API_KEY / ~/.ayatori/image-api-key / env OPENAI_API_KEY のいずれにも有効な値が無し — 引用符・`KEY=` 前置・コメント行は自動除去するが、空白/制御文字が混じる値は無効扱い。`node scripts/setup-image-key.mjs --doctor` で確認できる) — `node scripts/setup-image-key.mjs` で設定できる (再起動不要)。SKILL.md の degrade 分岐 (設定して続行 / テキスト比較 / 手動生成 / 中断) へ",
    });
  }
  const model = process.env.AYATORI_IMAGE_MODEL || pipelineDefaultTool();

  // ── cache 照合 → 生成 (直列 — rate limit と進捗可視性を優先) ──
  const samplesDir = path.join(appRoot, "graphics", "samples");
  fs.mkdirSync(samplesDir, { recursive: true });
  const manifestPath = path.join(samplesDir, "samples-manifest.json");
  const prev = readJson(manifestPath);
  const prevById = new Map((prev?.variants ?? []).filter((v) => v?.id && v?.digest).map((v) => [v.id, v]));

  // manifest は per-variant の「最新の有効な生成記録」台帳。契約 (external review 指摘 2/5 の再発防止):
  //   - cache hit は id + digest の複合一致 — digest 単独だと style_block の variant 間入れ替えで
  //     「別 id の旧画像」を誤 hit する (self-review finding 1)。file 名は id 由来のため id 束縛で保証
  //   - 成功/失敗のたびに増分 Write する — 3 件完了後の一括 Write だと、途中 kill (Bash timeout 等) で
  //     課金済み生成の digest が失われ、リトライが全量再課金になる
  //   - 今回失敗した variant は、旧 entry + 旧 PNG がディスクに残っていれば旧 entry を保持する —
  //     旧 digest ⇔ 旧 PNG の対応は正のまま (style を旧に戻したリトライが cache hit する)。
  //     捨てると同一出力が disk にあるのに再課金になる
  const entriesById = new Map();
  // 台帳を旧 entry で seed する — 増分 Write は entriesById だけで manifest を丸ごと上書きするため、
  // seed なしだと loop 途中 kill で「未処理」variant の有効 entry が落ち、PNG が disk に残っているのに
  // 次 run で cache miss → 再課金になる (PR #169 レビュー指摘)。処理済み variant は loop 内で上書きされる
  for (const id of VARIANT_IDS) {
    const e = prevById.get(id);
    if (e?.file && fs.existsSync(path.join(appRoot, e.file))) entriesById.set(id, e);
  }
  const writeManifest = () => {
    const manifest = {
      app_name: appName,
      updated_at: isoNow(),
      model,
      size_px: SIZE,
      level1_words: input.level1_words,
      subject: input.subject,
      variants: VARIANT_IDS.map((id) => entriesById.get(id)).filter(Boolean),
    };
    atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  };

  const results = [];
  const failures = [];
  for (const v of variants) {
    const prompt = buildPrompt(v.style_block, input.subject);
    const digest = digestOf(model, prompt);
    const file = `graphics/samples/taste-${v.id.toLowerCase()}.png`;
    const absFile = path.join(appRoot, file);
    const prevEntry = prevById.get(v.id);
    if (!force && prevEntry?.digest === digest && fs.existsSync(absFile)) {
      entriesById.set(v.id, { id: v.id, label: v.label, style_block: v.style_block, prompt, digest, file, generated_at: prevEntry.generated_at });
      results.push({ id: v.id, label: v.label, file, cached: true });
      console.error(`[21c] 案 ${v.id}: cache 再利用 (id + digest 一致)`);
      writeManifest();
      continue;
    }
    try {
      console.error(`[21c] 案 ${v.id}: 生成中 (${model}, ${SIZE}) ...`);
      const bytes = await generateImage(apiKey, model, prompt);
      fs.writeFileSync(absFile, bytes);
      entriesById.set(v.id, { id: v.id, label: v.label, style_block: v.style_block, prompt, digest, file, generated_at: isoNow() });
      results.push({ id: v.id, label: v.label, file, cached: false });
      writeManifest(); // 成功ごとの増分保存 — 途中 kill でも課金済み digest を失わない
    } catch (e) {
      const priorKept = Boolean(prevEntry && fs.existsSync(absFile));
      if (priorKept) entriesById.set(v.id, prevEntry); // 旧世代 entry を台帳に残す (上記契約)
      else entriesById.delete(v.id); // PNG が消えた旧 entry は seed 済みでも外す (digest ⇔ PNG の対応が負)
      failures.push({
        id: v.id,
        error: String(e?.message ?? e).slice(0, 300),
        // 旧世代 PNG がディスクに残っている印 — 改訂後 style とは別物なので人間ゲートの比較材料に使わない
        ...(priorKept ? { prior_cache_kept: true, prior_file: file } : {}),
      });
      writeManifest();
    }
  }

  const manifest = writeManifest(); // 最終形 (updated_at を run 完了時刻に揃える)

  const compareHtml = path.join(samplesDir, "taste-compare.html");
  if (failures.length) {
    // 過去 run の比較 HTML を残置しない — manifest と食い違った旧内容 (改訂前の style / 画像) が
    // 「最新」に見える stale view を防ぐ (self-review finding 4)。derived view なので削除で失うものはない
    fs.rmSync(compareHtml, { force: true });
    out({
      ok: false,
      code: "E_GENERATION_FAILED",
      failures,
      succeeded: results.map((r) => ({ id: r.id, file: r.file, cached: r.cached })),
      ...(warnings.length ? { warnings } : {}),
      message: "一部/全部の variant 生成に失敗 — 成功分は cache 済み。リトライは失敗分のみ再生成される (旧 taste-compare.html は stale 防止のため削除済み)",
    });
  }

  fs.writeFileSync(compareHtml, renderCompareHtml(manifest, appRoot));

  out({
    ok: true,
    samples: results.map((r) => ({ id: r.id, label: r.label, file: r.file, cached: r.cached })),
    compare_html: "graphics/samples/taste-compare.html",
    manifest: "graphics/samples/samples-manifest.json",
    ...(warnings.length ? { warnings } : {}),
    next: "人間ゲート preview (taste-compare.html) → A/B/C 選択へ",
  });
} catch (e) {
  console.error(`generate-samples.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
