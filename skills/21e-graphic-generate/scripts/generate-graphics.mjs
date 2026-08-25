#!/usr/bin/env node
// Step 21e (graphic-generate) の生成本体 — pending slot の生成 API 呼び出し + サイズ自動調整 + 増分記録。
// F-5 グラフィック生成 + サイズ自動調整
//
// usage:
//   node generate-graphics.mjs <app_name>
//
// 決定的責務 (LLM に任せない部分):
//   - pending 差集合 (設計 §9-2b): excluded_slots に載らず fresh な generated_files entry を
//     持たない slot だけを生成する。確定 prompt は逐語使用し、no-text / no-brand の固定 tail を
//     機械付加する (21d guide §1 の分担 — 二重指定しない)。
//   - per-slot モデルルーティング (I-3 調査): transparent_background=true → 透過対応モデル
//     (gpt-image-1.5 系) + background: transparent / false → graphic-prompts.json の tool。
//   - サイズ自動調整 (ユーザーフロー ⑩): preflight.planGeneration の生成キャンバス計画 →
//     API 出力を png-resize.fitToTarget (中心 crop + 面積平均) で size_px ちょうどに合わせて
//     graphics/raw/{graphic_id}.png へ書く。寸法一致なら API 出力バイトを無加工で置く。
//   - リトライ: 429/408/5xx/ネットワーク/タイムアウトのみ既定 2 回まで再試行 (backoff)。その他の
//     4xx は即失敗 (プロンプト/パラメタ起因は再試行で直らない)。サイズ起因の 400 は固定サイズ族へ
//     の 1 回だけの fallback を試す (gpt-image-2 の任意解像度が拒否された場合の保険)。
//   - 増分記録: 成功のたびに pipeline-state.json の generated_files を書く (途中 kill でも課金済み
//     生成の digest を失わない — 21c samples-manifest と同じ契約)。併せて監査台帳
//     graphics/raw/generation-manifest.json (実使用モデル / API サイズ / resize 有無 / 試行回数)
//     を増分更新する。台帳は補助記録であり、resume / 埋め込み対象の SoT は pipeline-state 側。
//   - 完了判定: 失敗ゼロで pending が空になったら screens.graphics.step21e_completed_at を set。
//     一部失敗時は set しない (E_GENERATION_FAILED — SKILL.md の degrade 分岐 [設計 §8-4] へ)。
//
// stdout に JSON を 1 個出力する (exit 0 固定、routing は code。内部エラーのみ exit 1)。

import fs from "node:fs";
import path from "node:path";
import {
  assertPreflight,
  atomicWriteFileSync,
  isoNow,
  isTransparent,
  planGeneration,
  readJson,
  repoRoot,
  resolveApiBase,
  resolveApiKey,
  resolveModels,
} from "./preflight.mjs";
import { decodePng, encodePng, fitToTarget, hasTransparency } from "./png-resize.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

// 確定 prompt に機械付加する固定 tail (21d refs/prompts-guide.md §1 の分担 — 21d 側は書かない)。
// digest 対象外 (preflight.sourceDigestOf のコメント参照): tail の改訂は全 slot 再課金にしない。
const FIXED_TAIL = "No embedded text, no readable letters, no real brand likeness.";
// gpt-image 系は低速 (ツール比較実測で NanoBanana の 2〜3 倍) — 21c と同じ 240s。テスト時のみ env で短縮
const REQUEST_TIMEOUT_MS = Number(process.env.AYATORI_IMAGE_TIMEOUT_MS) || 240_000;
// リトライ backoff (ms のカンマ列 = 再試行回数)。テスト時のみ env で短縮
const BACKOFF_MS = (process.env.AYATORI_RETRY_BACKOFF_MS || "5000,15000")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);

// サイズ起因 4xx の判定 — 「本文に 'size' を含む」では広すぎる ("prompt exceeds the maximum size" /
// "batch size" 等の無関係な 4xx まで固定サイズ族へ fallback し、余計な課金 1 回 + 誤った台帳 warning
// で真因を隠す)。OpenAI 互換の構造化 signal (error.param == "size") を第一に、既知のピクセル
// バジェット文言と「size が不正/非対応/許容値列挙」の明示文言のみを受ける。AYATORI_IMAGE_API_BASE
// で OpenAI 互換 gateway (LiteLLM 等) に差し替えられる契約のため、pydantic 系の措辞も拾う:
//   - "param": "size"                                       (OpenAI 互換の構造化エラー)
//   - "below the current minimum pixel budget"              (実測済みの最小面積拒否 — preflight.mjs 参照)
//   - "size '1216x608' is not supported ..." /
//     "size must be one of ..." / "size: Input should be ..." (size → 不正/非対応/許容値列挙 が近接)
//   - "Invalid value for 'size'" / "unsupported size" 等     (不正/非対応 → size が近接)
// false positive 側の残余リスク ("batch size must be ...") は fallback 1 回の余計な課金で済むが、
// false negative は自動生成できたはずの slot が degrade 対話へ落ちる — 判定は再現率側に寄せる
const SIZE_REJECTED_RE = new RegExp(
  [
    `["']param["']\\s*:\\s*["']size["']`,
    `pixel budget`,
    `\\bsize\\b[^]{0,60}?\\b(invalid|not supported|unsupported|must be|should be|one of)\\b`,
    `\\b(invalid|unsupported|unexpected)\\b\\s+(value\\s+(for\\s+)?)?["']?size\\b`,
  ].join("|"),
  "i"
);

const ensurePeriod = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const buildPrompt = (prompt) => `${ensurePeriod(prompt)} ${FIXED_TAIL}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizeStr = (s) => `${s.width}x${s.height}`;

/** 1 回の生成 API 呼び出し。成功は PNG bytes、失敗は {retryable, sizeRejected, message} を throw。 */
async function callImageApi(apiKey, model, prompt, apiSize, transparent) {
  const body = {
    model,
    prompt,
    n: 1,
    size: sizeStr(apiSize),
    output_format: "png", // raw/ の中間物契約 (設計 §7)。正典も PNG のまま (圧縮 ⑫ は非搭載 — POCTEAMA-189)
    ...(transparent ? { background: "transparent" } : {}),
  };
  let res;
  try {
    res = await fetch(`${resolveApiBase()}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw { retryable: true, message: `network/timeout: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 400);
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    const sizeRejected = (res.status === 400 || res.status === 422) && SIZE_REJECTED_RE.test(text);
    // 401/403 は「キーが古い / 遮蔽されている」で起きる (ローテーション後に env 側の旧キーが
    // 優先される等) — 汎用の失敗一覧に埋もれさせず、その場で診断コマンドへ導く (POCTEAMA-408)
    // 案内はサーバ本文より **前** に置く — 失敗記録は failures[].error を 300 字で切るので、後置すると
    // 本文の長い gateway (LiteLLM / Azure 等の包装 401 は 200 字超) で案内だけが落ち、本 ticket が足した
    // 唯一の導線が届かない。401/403 は retryable=false なので再試行ログ (console.error) にも乗らず、
    // failures[].error が唯一の露出点であることが効いている。
    const authHint =
      res.status === 401 || res.status === 403
        ? "キーの認証失敗: `node scripts/setup-image-key.mjs --doctor` で実効ソースを確認する (env に残った旧キーがキーファイルを遮蔽している可能性) — "
        : "";
    throw { retryable, sizeRejected, message: `API ${res.status}: ${authHint}${text}` };
  }
  // 以降の await も retryable の形に必ず包む — 生の Error を投げると呼び出し側の
  // `if (!e?.retryable) break` が一時故障 (200 応答の途中切断 / download 中のネットワーク断・
  // タイムアウト) を恒久失敗と誤認し、残りの再試行 budget を捨てて degrade 対話へ直行する
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw { retryable: true, message: `response body parse: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  const item = json?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    try {
      const img = await fetch(item.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!img.ok) throw { retryable: true, message: `image download ${img.status}` };
      return Buffer.from(await img.arrayBuffer());
    } catch (e) {
      if (e?.retryable) throw e;
      throw { retryable: true, message: `image download: ${String(e?.message ?? e).slice(0, 200)}` };
    }
  }
  throw { retryable: false, message: "応答に data[0].b64_json / data[0].url がありません" };
}

/**
 * サイズ起因 400 の fallback: 固定サイズ族 (透過モデルと同じ 3 種) から最近アスペクトを選ぶ。
 * 返り値の warnings は透過 slot 向けの文面のため呼び出し側は捨て、fallback 文脈の警告
 * (拡大の可能性) を言い直して積む — そのまま流用すると非透過 slot の台帳に「透過 slot の
 * 生成モデルは…」と記録される。
 */
function fixedFallbackPlan(sizePx) {
  return planGeneration(sizePx, true); // 固定サイズ族の選定ロジックは透過側と同一
}

try {
  const appName = process.argv[2];
  if (!appName || process.argv.length > 3) {
    out({ ok: false, code: "E_USAGE", message: "usage: node generate-graphics.mjs <app_name>" });
  }

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, state, graphics, promptsFile, pending, fresh, excludedIds, digests } = pre;

  // ── pipeline-state merge write の共通部 (preflight parse 済み state をベースに merge —
  // disk 再読込 + stub fallback は読込失敗時に全 state を潰す破壊経路、21a/21d と同判断) ──
  const statePath = path.join(appRoot, "pipeline-state.json");
  const graphicsState = { ...graphics };
  const writeState = () => {
    if (!state.app_name) state.app_name = appName; // 必須 field の保全 assert
    state.screens ??= {};
    state.screens.graphics = graphicsState;
    atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  };
  const upsertGeneratedFile = (entry) => {
    const list = Array.isArray(graphicsState.generated_files) ? [...graphicsState.generated_files] : [];
    const i = list.findIndex((g) => g?.graphic_id === entry.graphic_id);
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    graphicsState.generated_files = list;
    writeState();
  };
  const markCompleted = () => {
    graphicsState.step21e_completed_at = isoNow();
    writeState();
  };

  // pending ゼロ (全 slot fresh or excluded) — 完了記録だけ立てて 21f へ (resume の収束点)。
  // API キー検査より先に判定する: この経路は生成 API を一切呼ばないため、キー無し環境
  // (最終 slot 書き込み後・markCompleted 前の中断からの、キーが失効した別環境での resume 等) でも
  // 生成済み・支払い済みの成果を 21f へ進められなければならない
  if (pending.length === 0) {
    markCompleted();
    out({
      ok: true,
      generated: [],
      reused: fresh.map((e) => e.graphic_id),
      excluded: [...excludedIds],
      step21e_completed_at: graphicsState.step21e_completed_at,
      message: "pending slot なし (全 slot が生成済み digest 一致 or 除外済み) — 生成 API は未呼び出し",
      next: "Step 21f (graphic-postprocess) へ",
    });
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    out({
      ok: false,
      code: "E_NO_API_KEY",
      message:
        "生成 API キーが未設定 (env AYATORI_IMAGE_API_KEY / ~/.ayatori/image-api-key / env OPENAI_API_KEY のいずれにも有効な値が無し — 引用符・`KEY=` 前置・コメント行は自動除去するが、空白/制御文字が混じる値は無効扱い。`node scripts/setup-image-key.mjs --doctor` で確認できる) — `node scripts/setup-image-key.mjs` で設定できる (再起動不要・docs/setup.md「グラフィック生成 API キー」参照)。SKILL.md の degrade 分岐へ",
    });
  }
  const models = resolveModels(promptsFile.tool);

  // ── 監査台帳 (補助記録) — 旧 entry で seed し、処理のたびに増分 Write する ──
  const rawDir = path.join(appRoot, "graphics", "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const manifestPath = path.join(rawDir, "generation-manifest.json");
  const prevManifest = readJson(manifestPath);
  const manifestById = new Map(
    (Array.isArray(prevManifest?.entries) ? prevManifest.entries : [])
      .filter((e) => e?.graphic_id && e?.file && fs.existsSync(path.join(appRoot, e.file)))
      .map((e) => [e.graphic_id, e])
  );
  const writeManifest = () => {
    atomicWriteFileSync(
      manifestPath,
      JSON.stringify(
        { app_name: appName, updated_at: isoNow(), entries: [...manifestById.values()] },
        null,
        2
      ) + "\n"
    );
  };

  // ── 生成 loop (直列 — rate limit と進捗可視性を優先。21c と同判断) ──
  const generated = [];
  const failures = [];
  for (const entry of pending) {
    const transparent = isTransparent(entry);
    const model = transparent ? models.transparent : models.opaque;
    let plan = planGeneration(entry.size_px, transparent);
    const prompt = buildPrompt(entry.prompt);
    const warnings = [...plan.warnings];
    const maxAttempts = BACKOFF_MS.length + 1;
    let attempts = 0;
    let bytes = null;
    let lastError = null;
    let sizeFallbackUsed = false;

    while (attempts < maxAttempts && !bytes) {
      attempts++;
      try {
        console.error(
          `[21e] ${entry.graphic_id}: 生成中 (${model}, ${sizeStr(plan.api_size)}${transparent ? ", transparent" : ""}, 試行 ${attempts}/${maxAttempts}) ...`
        );
        bytes = await callImageApi(apiKey, model, prompt, plan.api_size, transparent);
      } catch (e) {
        lastError = e?.message ?? String(e);
        if (e?.sizeRejected && !transparent && !sizeFallbackUsed) {
          // 任意解像度がモデル側で拒否された場合の保険 — 固定サイズ族に切り替えて続行 (1 回のみ)。
          // 切替は試行回数を消費しない: size 拒否が最終試行で来た場合 (一時エラーで budget を
          // 使い切った後など) でも、fallback 送信そのものが必ず 1 回は走ることを保証する —
          // 消費すると warning は「fallback した」と記録するのに実際は未送信のまま失敗する
          sizeFallbackUsed = true;
          attempts--;
          plan = { ...fixedFallbackPlan(entry.size_px), resize: true };
          warnings.push(`任意解像度が拒否されたため固定サイズ ${sizeStr(plan.api_size)} へ fallback (${lastError})`);
          if (entry.size_px.width > plan.api_size.width || entry.size_px.height > plan.api_size.height) {
            warnings.push(
              `fallback 固定サイズ ${sizeStr(plan.api_size)} は確定寸 ${sizeStr(entry.size_px)} より小さい — crop 後に拡大する (画質低下の可能性)`
            );
          }
          continue;
        }
        if (!e?.retryable) break;
        if (attempts < maxAttempts) {
          const wait = BACKOFF_MS[attempts - 1];
          console.error(`[21e] ${entry.graphic_id}: 失敗 (${lastError}) — ${wait}ms 待って再試行`);
          await sleep(wait);
        }
      }
    }

    if (!bytes) {
      failures.push({ graphic_id: entry.graphic_id, attempts, error: String(lastError).slice(0, 300) });
      writeManifest();
      continue;
    }

    // ── サイズ自動調整 (⑩): decode で実寸を検証し、size_px ちょうどへ適合させる ──
    const file = `graphics/raw/${entry.graphic_id}.png`;
    const absFile = path.join(appRoot, file);
    try {
      const decoded = decodePng(bytes);
      const { width, height } = entry.size_px;
      const exact = decoded.width === width && decoded.height === height;
      if (!exact && (decoded.width !== plan.api_size.width || decoded.height !== plan.api_size.height)) {
        warnings.push(`API 出力が要求サイズと異なる (${decoded.width}x${decoded.height} ≠ ${sizeStr(plan.api_size)}) — 実寸から適合`);
      }
      if (transparent && !hasTransparency(decoded)) {
        warnings.push("透過指定だが alpha が全画素不透明 — 21f の透過検証で要確認");
      }
      // 寸法一致なら API 出力バイトを無加工で置く (再圧縮による劣化とサイズ増を避ける)
      fs.writeFileSync(absFile, exact ? bytes : encodePng(fitToTarget(decoded, width, height)));
      const generatedAt = isoNow();
      // 台帳 → state の順で書く (POCTEAMA-189 review) — state (generated_files) が先だと、直後の
      // manifest 書き込み失敗で slot が fresh 扱いのまま台帳 entry が永久欠落する。逆順なら台帳の
      // 先行 entry は無害 (slot は pending のままなので再実行時に上書きされる)
      manifestById.set(entry.graphic_id, {
        graphic_id: entry.graphic_id,
        file,
        model,
        transparent,
        requested_size: sizeStr(entry.size_px),
        api_size: sizeStr(plan.api_size),
        resized: !exact,
        attempts,
        generated_at: generatedAt,
        source_digest: digests.get(entry.graphic_id),
        ...(warnings.length ? { warnings } : {}),
      });
      writeManifest();
      upsertGeneratedFile({
        graphic_id: entry.graphic_id,
        file,
        generated_at: generatedAt,
        source_digest: digests.get(entry.graphic_id),
      });
      generated.push({ graphic_id: entry.graphic_id, file, size: sizeStr(entry.size_px), model, resized: !exact });
      console.error(`[21e] ${entry.graphic_id}: 完了 (${file}, ${sizeStr(entry.size_px)}${exact ? "" : " — resize 済み"})`);
    } catch (e) {
      // decode / resize 不能 (対応外 PNG 等) — 課金は発生済みだが raw に置けないため失敗扱い
      failures.push({ graphic_id: entry.graphic_id, attempts, error: `出力の decode/resize に失敗: ${String(e?.message ?? e).slice(0, 200)}` });
      writeManifest();
    }
  }

  if (failures.length) {
    out({
      ok: false,
      code: "E_GENERATION_FAILED",
      failures,
      succeeded: generated,
      reused: fresh.map((e) => e.graphic_id),
      message:
        "一部/全部の slot 生成に失敗 — 成功分は generated_files 記録済み。リトライは失敗分のみ再生成される (設計 §8-4 の degrade 分岐へ: リトライ / 当該 slot 除外 / ブロック中止)",
    });
  }

  markCompleted();
  out({
    ok: true,
    generated,
    reused: fresh.map((e) => e.graphic_id),
    excluded: [...excludedIds],
    step21e_completed_at: graphicsState.step21e_completed_at,
    manifest: "graphics/raw/generation-manifest.json",
    next: "Step 21f (graphic-postprocess) へ",
  });
} catch (e) {
  console.error(`generate-graphics.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
