// Step 21e 共有ヘルパ — 前提 assert / digest / pending 差集合 / 生成 API リクエスト計画。
// F-5 グラフィック生成 + サイズ自動調整
//
// gather-context.mjs / generate-graphics.mjs / commit-degrade.mjs が import する named-export
// モジュール (21b/21c/21d の preflight.mjs と同じ分離パターン)。前提条件・digest 計算・
// サイズマッピングを 1 実装に集約し、全 script の判定を機械的に同一に保つ。21d の preflight
// とは assert 内容が異なる (prompts 確定済み / 21e 未完了 / prompts ファイル実在) ため
// import 共有はせず、skill ディレクトリ単位で自己完結させる (skill の独立移動性を優先)。

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot =
  process.env.AYATORI_REPO_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * read-modify-write する JSON の原子的置換 — 同 dir の tmp に書いてから rename する。
 * 直接 writeFileSync だと書き込み途中の kill / ENOSPC で元ファイルが半端な JSON に truncate され、
 * pipeline-state.json の場合は前 Phase 含む全 state を失う (readJson が null → E_STATE_MISSING で
 * resume 不能)。rename(2) は同一 filesystem 内で原子的 — 旧内容か新内容のどちらかしか観測されない。
 * write / rename どちらの失敗でも tmp を掃除してから rethrow する (残骸を artifacts に残さない —
 * ENOSPC の部分書き込み tmp も対象。掃除自体の失敗は握りつぶして元エラーを優先する)。
 */
export function atomicWriteFileSync(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 掃除失敗で元エラーを隠さない
    }
    throw e;
  }
}

/** ISO 8601 ローカル timezone offset 付き現在時刻 (例: 2026-07-17T15:00:00+09:00)。 */
export function isoNow() {
  const now = new Date();
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(now.getTime() + offMin * 60000);
  return local.toISOString().slice(0, 19) + `${sign}${pad(offMin / 60)}:${pad(offMin % 60)}`;
}

// ── 生成 API の恒久契約 (21c generate-samples の暫定契約を本 skill で確定 — 参照: docs/setup.md) ──
//   キー:            env AYATORI_IMAGE_API_KEY || ~/.ayatori/image-api-key (キーファイル直読)
//                    || env OPENAI_API_KEY
//   endpoint:        {AYATORI_IMAGE_API_BASE || https://api.openai.com/v1}/images/generations
//   非透過モデル:    graphic-prompts.json の tool (21d 確定値。実行時 override は AYATORI_IMAGE_MODEL)
//   透過モデル:      AYATORI_IMAGE_MODEL_TRANSPARENT || gpt-image-1.5
//     — gpt-image-2 は background: transparent 非サポート (指定エラー) のため、透過 slot のみ
//       gpt-image-1.5 系へルーティングする (I-3 調査結果)。値の SoT: pipeline.yaml
//       screens.graphic_generation.tool / tool_transparent。
//
// キー解決の優先順 (POCTEAMA-408):
//   ① env AYATORI_IMAGE_API_KEY — 明示 override (settings.local.json / 一時 env 注入を含む)
//   ② キーファイル ~/.ayatori/image-api-key — 運用推奨。実行時に直読するため設定後の再起動不要で、
//      起動方法 (VSCode / ターミナル / 非対話 shell) に依存しない (~/.zshrc は非対話 shell が読まず、
//      VSCode は起動時 env を固定するため、env 経路は「設定したのに見えない」事故が構造的に起きる)
//   ③ env OPENAI_API_KEY — 汎用 fallback (現状維持)
// ファイルを ③ より先に見るのは、AYATORI 専用に設置された鍵のほうが「環境にたまたま存在する
// 個人鍵」より具体的なため (個人アカウントへの誤課金を防ぐ)。
// 本 function は 21c/21e の 2 skill に複製されている (per-skill 自己完結の repo 方針) —
// 変更は 2 つ同時に。同期は 21e eval が function 本体の逐字一致で機械検証する。

// キーファイルのパス — 既定 ~/.ayatori/image-api-key。AYATORI_IMAGE_API_KEY_FILE は
// AYATORI_REPO_ROOT (fixture) と併用時のみ有効なテスト注入 knob で、shell に単独残留した env が
// 実 run の鍵の読み取り先を無言で差し替えるのを防ぐ (AYATORI_PIPELINE_YAML と同一契約 —
// docs/setup.md「グラフィック生成 API キー」テスト専用の項)。警告 prefix を skill 名にしないのは
// 本 function も 21c/21e で逐字一致させる (21e eval が機械検証する) ため。
export function imageKeyFilePath() {
  const fallback = path.join(os.homedir(), ".ayatori", "image-api-key");
  const override = process.env.AYATORI_IMAGE_API_KEY_FILE;
  if (!override) return fallback;
  if (process.env.AYATORI_REPO_ROOT) return override;
  console.error("[image-key] warn: AYATORI_IMAGE_API_KEY_FILE は AYATORI_REPO_ROOT (fixture) と併用時のみ有効 — 実 run では無視します");
  return fallback;
}

// 貼り付け事故 (引用符 / `KEY=` 前置 / コメント行 / 複数行 / CRLF) は整形して吸収する。生値を
// そのまま Authorization ヘッダに載せると undici が invalid header value を throw し、呼び出し側は
// それを retryable な network 障害と誤判定して 3 回空リトライした末に原因不明のメッセージで失敗する
// (POCTEAMA-408 レビュー M5)。整形しても header に載せられない値 (空白・制御文字残り) は
// 「未設定」扱いにする — 壊れた鍵で課金 API を叩かない。
export function resolveApiKey() {
  const clean = (raw) => {
    const one = (line) => {
      const v = line
        .replace(/^export\s+/, "")
        .replace(/^(?:AYATORI_IMAGE_API_KEY|OPENAI_API_KEY)\s*=\s*/, "")
        .replace(/^(['"])([\s\S]*)\1$/, "$2")
        .trim();
      // header safe = 空白・制御文字を含まない可視 ASCII のみ (OpenAI 互換キーは base62 + -/_)
      return v && /^[!-~]+$/.test(v) ? v : null;
    };
    // 候補行を順に試し、最初に鍵として成立した行を採る。先頭行だけで打ち切ると
    // 「AYATORI_IMAGE_API_KEY=」で改行してから鍵を貼った 2 行貼り付けが、前置の剥がしで空になって
    // 未設定扱い (E_NO_API_KEY) になり、docs の「KEY= 前置・追加行は吸収する」という約束に反する。
    // コメント行は元から読み飛ばしていたので、その挙動に他の不成立行も揃えた形。
    for (const line of String(raw ?? "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const v = one(t);
      if (v) return v;
    }
    return null;
  };
  const envKey = clean(process.env.AYATORI_IMAGE_API_KEY);
  if (envKey) return envKey;
  let fileRaw = "";
  try {
    fileRaw = fs.readFileSync(imageKeyFilePath(), "utf8");
  } catch {
    // 不在・読取不能 (EACCES 等) とも未設定として次の fallback へ (詳細の切り分けは
    // scripts/setup-image-key.mjs --doctor が「読めません」と区別して報告する)
  }
  return clean(fileRaw) || clean(process.env.OPENAI_API_KEY) || null;
}

export function resolveApiBase() {
  return (process.env.AYATORI_IMAGE_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
}

// 既定 tool の SoT は pipeline.yaml screens.graphic_generation.tool / tool_transparent — 宣言だけで
// なく実際にそこから読む (読まないと「SoT を直したのに hardcode が勝つ」運用事故になる: 例えば
// 透過モデルの廃止時に pipeline.yaml を直しても旧モデルへ送り続け全 slot が 4xx で degrade 行き)。
// pipeline.yaml は repo 本体の一部なので script 自身の位置から解決する (AYATORI_REPO_ROOT は
// fixture 差し込み用で pipeline.yaml を含まない)。読めない場合は既知の値へ fail-open。
// env override (AYATORI_IMAGE_MODEL*) は digest に**含めない**: source_digest は環境非依存の
// 決定値でなければならず (schema graphic-prompts の tool description)、env は実行時の呼び出し先の
// 差し替えにのみ効く — pipeline.yaml の値は repo 状態であり digest 材料にしてよい (tool 差し替え =
// 全該当 slot が stale 化して再生成、が契約どおりの挙動)。
// AYATORI_PIPELINE_YAML は **AYATORI_REPO_ROOT (fixture 差し込み) と併用時のみ有効** な
// テスト注入 knob。単独で残った env が実 run の tool 既定値 / digest 材料を無言で差し替えると、
// 全 slot が stale 化 (再課金) / 誤モデルへの送信という静かな事故になるため、fixture mode 外では
// 警告して無視する (AYATORI_REPO_ROOT の残留は E_APP_NOT_FOUND で大声で落ちるのと対称)。
const PIPELINE_YAML_PATH = (() => {
  const scriptRelative = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../pipeline.yaml");
  const override = process.env.AYATORI_PIPELINE_YAML;
  if (!override) return scriptRelative;
  if (process.env.AYATORI_REPO_ROOT) return override;
  console.error("[21e] warn: AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT (fixture) と併用時のみ有効 — 実 run では無視します");
  return scriptRelative;
})();

/**
 * pipeline.yaml screens.graphic_generation ブロックの scalar を決定的に抽出する (YAML parser
 * 非依存 — Operating Principle 1 の範囲で `key: value` 行のみを対象にした限定文法。ブロックの
 * 終了は同レベル以浅のキー出現で判定する)。読めない / 見つからない場合は fallback (fail-open)。
 */
export function readGraphicGenerationKey(key, fallback, yamlPath = PIPELINE_YAML_PATH) {
  try {
    const lines = fs.readFileSync(yamlPath, "utf8").split("\n");
    const start = lines.findIndex((l) => /^ {2}graphic_generation:\s*(#.*)?$/.test(l));
    if (start < 0) return fallback;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\S/.test(line) || /^ {2}\S/.test(line)) break; // dedent = ブロック終了
      const m = line.match(new RegExp(`^ {4}${key}:\\s*([^\\s#]+)`));
      if (m) return m[1];
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export const DEFAULT_TOOL = readGraphicGenerationKey("tool", "gpt-image-2");
export const DEFAULT_TRANSPARENT_TOOL = readGraphicGenerationKey("tool_transparent", "gpt-image-1.5");

/** 実行時に実際へ呼ぶモデルの解決 (digest には使わない — 上記コメント)。 */
export function resolveModels(fileTool) {
  return {
    opaque: process.env.AYATORI_IMAGE_MODEL || fileTool || DEFAULT_TOOL,
    transparent: process.env.AYATORI_IMAGE_MODEL_TRANSPARENT || DEFAULT_TRANSPARENT_TOOL,
  };
}

/** transparent_background の正規化 (省略時 false — schema 既定)。 */
export const isTransparent = (entry) => entry?.transparent_background === true;

/**
 * slot 鮮度判定用 source_digest (設計 §9-2b / schemas/pipeline-state.schema.json generated_files)。
 * 当該 prompts entry (prompt + size_px + transparent_background + tool) から決定的に導出する。
 * tool は**その slot を実際に生成するモデル族**を採る: 非透過 slot は file-level tool (省略時は
 * pipeline 既定値へ正規化)、透過 slot は tool_transparent 側の既定値。透過 slot に非透過 tool を
 * 混ぜると (a) 透過モデルの差し替えが旧画像を stale 化できず新旧モデル混在のまま出荷される、
 * (b) 逆に非透過 tool の変更が透過 slot まで無意味に stale 化して再課金される、の両方向で壊れる。
 * env override (AYATORI_IMAGE_MODEL*) は digest に**含めない** (digest は環境非依存の決定値 —
 * 恒久的なモデル変更は pipeline.yaml / prompts.json 側で行う契約)。21e が機械付加する固定 tail
 * (generate-graphics.mjs) も digest に**含めない** — tail はコード定数であり、tail の改訂で
 * 全 slot が stale 化 (全量再課金) する経路を作らない。
 */
export function sourceDigestOf(entry, fileTool) {
  const transparent = isTransparent(entry);
  const tool = transparent ? DEFAULT_TRANSPARENT_TOOL : fileTool || DEFAULT_TOOL;
  const t = transparent ? "transparent" : "opaque";
  const material = `${tool}\n${entry.size_px.width}x${entry.size_px.height}\n${t}\n${entry.prompt}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

// ── サイズ自動調整 (ユーザーフロー ⑩) — 生成 API サイズへのマッピング計画 ──
//
// 確定 size_px (21d、<img> width/height の基準値) をそのまま正典寸法にする方針:
// raw/{graphic_id}.png は**必ず size_px ちょうど**で落とす (小さい箇所に巨大グラフィックを
// 載せない / 大きい箇所には十分なサイズで生成する、の両方を機械保証)。API 側の制約と
// 品質確保のため、生成キャンバスは size_px と別に計画し、差分は中心 crop + 面積平均縮小
// (png-resize.mjs) で吸収する。

// gpt-image-2: 任意解像度 (WIDTHxHEIGHT、各辺 16 の倍数、アスペクト比 1:3〜3:1 — I-3 調査)。
const AR_MIN = 1 / 3;
const AR_MAX = 3;
const GRID = 16;
// 生成キャンバス長辺の上限。gpt-image-2 の公開上限が不明のため、実測済みの動作域
// (1536×1024 世代の既知サイズ) に抑える。超過分は crop 後の拡大で吸収 (warning 併記)。
const MAX_LONG_SIDE = 1536;
// 小さい slot の品質確保 (supersample): min 辺がこの値未満なら整数倍 (上限 4x) で大きく生成して
// 縮小する — 極小キャンバス直接生成のディテール崩れを避ける。
const SUPERSAMPLE_MIN = 256;
const SUPERSAMPLE_MAX_K = 4;
// 最小ピクセルバジェット floor: gpt-image-2 は小さすぎる解像度を "below the current minimum
// pixel budget" (400) で拒否する。実測境界 (2026-08 の probe): 面積 606,208 px (1024×592) は拒否 /
// 718,848 px (864×832・1152×624) は受理 — アスペクト比・辺長でなく面積で判定されるため、
// 実測受理済みの最小面積を floor に採用する。"current" とある通り閾値は変動し得る —
// 変動時は generate-graphics.mjs のサイズ起因 400 fallback (固定サイズ族) が拾う。
const MIN_PIXEL_AREA = 718_848;

// gpt-image-1.5 (透過 slot 用): 固定サイズ族のみ (gpt-image-1 系と同じ 3 種)。
const FIXED_SIZES = [
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
];

// 16 の倍数への切り上げ。丸め前に 1e-9 の相対許容を引く — 長辺 cap の乗算 (× MAX_LONG_SIDE/long) が
// ちょうど 1536 を 1 ulp 上回る値を作り、素朴な ceil が cap 超えの 1552 へ丸める回帰の防止
// (実害: 実測済み動作域の外へ要求が出る)。許容は ulp 噪音のみを吸収し、実の端数 (0.5 等) は
// 従来どおり切り上げる。
const ceilTo = (v, unit) => Math.ceil(v / unit - 1e-9) * unit;

/**
 * 1 slot の生成 API リクエスト計画 (決定的)。
 * @param {{width:number,height:number}} sizePx 21d 確定の出力寸法
 * @param {boolean} transparent 透過 slot か (モデル族が変わりサイズ制約も変わる)
 * @returns {{api_size:{width:number,height:number}, resize:boolean, warnings:string[]}}
 *   resize=false は「API 出力をそのまま raw に置ける」(byte 無加工)。true は crop+scale が入る。
 */
export function planGeneration(sizePx, transparent) {
  const { width, height } = sizePx;
  const warnings = [];
  const ar = width / height;

  if (transparent) {
    // 固定サイズ族からアスペクト比が最も近いものを選ぶ (log 比で対称に比較)
    let best = FIXED_SIZES[0];
    let bestD = Infinity;
    for (const s of FIXED_SIZES) {
      const d = Math.abs(Math.log(ar / (s.width / s.height)));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (width > best.width || height > best.height) {
      warnings.push(
        `透過 slot の生成モデルは固定サイズ (最大 ${best.width}x${best.height}) — ${width}x${height} へは crop 後に拡大する (画質低下の可能性)`
      );
    }
    const resize = !(best.width === width && best.height === height);
    return { api_size: { ...best }, resize, warnings };
  }

  // 非透過 (gpt-image-2 系): 任意解像度
  const genAR = Math.min(AR_MAX, Math.max(AR_MIN, ar));
  if (genAR !== ar) {
    warnings.push(
      `アスペクト比 ${ar.toFixed(2)}:1 は API 許容域 (1:3〜3:1) 外 — ${genAR.toFixed(2)}:1 で生成し中心 crop する (端の内容が失われる)`
    );
  }
  const k = Math.min(SUPERSAMPLE_MAX_K, Math.max(1, Math.ceil(SUPERSAMPLE_MIN / Math.min(width, height))));
  // target*k を覆う genAR の最小キャンバス。比が実質同じなら再計算しない — 無条件に
  // genW = genH * genAR を通すと h*(w/h) の 1 ulp 誤差が w を僅かに超え、16 丸めが縦長寸法を
  // 1 グリッド無駄に広げて「準拠寸は無加工」の不変量 (guide §2) を壊す (例: 672x1200 → 688x1200)
  const AR_EPS = 1e-9;
  let genW = width * k;
  let genH = height * k;
  const boxAR = genW / genH;
  if (boxAR > genAR * (1 + AR_EPS)) genH = genW / genAR;
  else if (boxAR < genAR * (1 - AR_EPS)) genW = genH * genAR;
  // 最小ピクセルバジェット floor (比率維持で拡大 — 拒否される要求を最初から出さない)
  if (genW * genH < MIN_PIXEL_AREA) {
    const s = Math.sqrt(MIN_PIXEL_AREA / (genW * genH));
    genW *= s;
    genH *= s;
  }
  // 長辺 cap (比率維持)。cap で floor を割る場合は短辺側を伸ばして面積を保つ
  // (AR は正方形方向へ寄る = 中心 crop の切り落としが増えるだけで size_px 不変量は壊れない)
  const long = Math.max(genW, genH);
  if (long > MAX_LONG_SIDE) {
    const scale = MAX_LONG_SIDE / long;
    genW *= scale;
    genH *= scale;
    if (genW * genH < MIN_PIXEL_AREA) {
      if (genW >= genH) genH = MIN_PIXEL_AREA / genW;
      else genW = MIN_PIXEL_AREA / genH;
    }
  }
  genW = Math.max(GRID, ceilTo(genW, GRID));
  genH = Math.max(GRID, ceilTo(genH, GRID));
  if (genW < width || genH < height) {
    warnings.push(`生成キャンバス ${genW}x${genH} が確定寸 ${width}x${height} より小さい (長辺 cap) — crop 後に拡大する (画質低下の可能性)`);
  }
  const resize = !(genW === width && genH === height);
  return { api_size: { width: genW, height: genH }, resize, warnings };
}

// ── generated_files[].file の許容パス (21f preflight と同一規約 — 変更は両方同時に) ──
export const CANONICAL_DIR = "screens/_shared/graphics";
export const canonicalPath = (graphicId, ext) => `${CANONICAL_DIR}/${graphicId}.${ext}`;
export const rawPath = (graphicId) => `graphics/raw/${graphicId}.png`;
/** 当該 slot の generated_files[].file として正当なパスの全列挙 (完全一致で照合する)。 */
export const allowedFilesOf = (graphicId) => [rawPath(graphicId), canonicalPath(graphicId, "webp"), canonicalPath(graphicId, "png")];

/**
 * pending / fresh / excluded の差集合 (設計 §9-2b: pending = prompts[] のうち excluded_slots に
 * 載らず、fresh な generated_files entry を持たない slot。stale entry は再生成で上書き)。
 * @param {object[]} entries graphic-prompts.json の prompts[]
 * @param {string|undefined} fileTool graphic-prompts.json の tool
 * @param {object} graphics pipeline-state.screens.graphics
 * @param {string} [appRoot] artifacts/{app_name}/ の絶対パス。指定時、fresh 判定は digest 一致に
 *   加えて記録された file の実在を要求する — raw/ は中間物のため手動掃除され得るが、state 記録
 *   だけを根拠に fresh 扱いすると「pending 0 → 完了記録 → 21f が不在ファイルを踏む」経路になる。
 *   実体を失った slot は pending へ戻す (再生成 = 再課金だが、壊れた参照を下流へ流すよりよい)。
 *   省略時は実在チェックのみ省く (純関数としての単体テスト用)。
 *   file は appRoot の有無によらず**当該 slot 自身**の raw / 正典パスへの完全一致のみ受理する
 *   (allowedFilesOf — 21f computeTargets と同一規約)。手編集 state の path traversal / 別 slot の
 *   ファイルへのすり替えを fresh 扱いすると、21e が「完了」と言い 21f が E_21E_STALE で拒む
 *   矛盾 state に詰まる — 21e 側は不合格 entry を pending (再生成で正しいパスへ上書き) に落とす。
 * @returns {{pending: object[], fresh: object[], excludedIds: Set<string>, digests: Map<string,string>}}
 */
export function computePending(entries, fileTool, graphics, appRoot) {
  const excludedIds = new Set(
    (Array.isArray(graphics?.excluded_slots) ? graphics.excluded_slots : []).map((e) => e?.graphic_id).filter(Boolean)
  );
  const generated = new Map(
    (Array.isArray(graphics?.generated_files) ? graphics.generated_files : [])
      .filter((g) => g?.graphic_id)
      .map((g) => [g.graphic_id, g])
  );
  const digests = new Map(entries.map((e) => [e.graphic_id, sourceDigestOf(e, fileTool)]));
  const pending = [];
  const fresh = [];
  for (const e of entries) {
    if (excludedIds.has(e.graphic_id)) continue;
    const g = generated.get(e.graphic_id);
    const fileAllowed = typeof g?.file === "string" && allowedFilesOf(e.graphic_id).includes(g.file);
    const fileOk = fileAllowed && (!appRoot || fs.existsSync(path.join(appRoot, g.file)));
    if (g?.source_digest === digests.get(e.graphic_id) && fileOk) fresh.push(e);
    else pending.push(e);
  }
  return { pending, fresh, excludedIds, digests };
}

/**
 * 21e 実行前提の assert (設計 §3 / §9-1 / §9-2)。
 * 起動条件: decision == "generate" AND prompts_confirmed_at set AND step21e_completed_at 未 set
 * (resume cascade §9-1 分岐 3 の `step21e_completed_at NOT set → Step 21e` と同値)。
 * 21g 差し戻し (品質起因) の再入は orchestrator が step21e_completed_at をクリアして
 * generated_files entry を削除する契約 (§9-2b) のため、同じ条件で通る。
 * @param {object} [opts]
 * @param {boolean} [opts.allowAllExcluded] 全 slot excluded の state 不整合でも通す。
 *   E_ALL_SLOTS_EXCLUDED の復旧手段である commit-degrade (abort で decision='skip' を記録) 自身に
 *   使わせるための穴 — これが無いと「復旧コマンドが復旧対象の assert に弾かれる」円環になり、
 *   手動で pipeline-state.json を直す以外の出口が無くなる。gather / generate は渡さない (既定 false)。
 * @returns {{error: object}} 前提 NG /
 *   {{appRoot, state, graphics, promptsFile, entries, pending, fresh, excludedIds, digests}} OK
 */
export function assertPreflight(appName, opts = {}) {
  // app_name はパス部品 (artifacts/{app_name}/ 配下を read/write する) のため、`../` 等の
  // パス・トラバーサルを join 前に弾く (graphic_id の ID_PATTERN と同じ趣旨)。実在する app_name は
  // kebab-case + train 系の `_train-` 接頭のみのため、英数・`-`・`_` に制限する。
  if (typeof appName !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(appName)) {
    return {
      error: {
        ok: false,
        code: "E_INVALID_APP_NAME",
        message: `app_name が不正 (${JSON.stringify(appName ?? null)}) — artifacts/ 直下のディレクトリ名 (英数・-・_) のみ許容`,
      },
    };
  }
  const appRoot = path.join(repoRoot, "artifacts", appName);
  if (!fs.existsSync(appRoot)) {
    return { error: { ok: false, code: "E_APP_NOT_FOUND", message: `artifacts/${appName}/ が存在しません` } };
  }

  const state = readJson(path.join(appRoot, "pipeline-state.json"));
  if (!state) {
    return { error: { ok: false, code: "E_STATE_MISSING", message: "pipeline-state.json が読めません (Phase 3 未進行 or 破損)" } };
  }
  if (state?.approvals?.screens_human_approved !== true) {
    return { error: { ok: false, code: "E_SCREENS_NOT_APPROVED", message: "Step 21 (画面 HTML 承認) が未完了です" } };
  }

  const graphics = state?.screens?.graphics ?? {};
  if (graphics.decision === "skip") {
    return {
      error: {
        ok: false,
        code: "E_BLOCK_SKIPPED",
        decided_by: graphics.decided_by ?? null,
        message: `グラフィック生成ブロックは skip 確定済み (decided_by=${graphics.decided_by ?? "?"}) — 21e は起動しない`,
      },
    };
  }
  if (graphics.decision !== "generate") {
    return { error: { ok: false, code: "E_21B_NOT_DONE", message: "Step 21b (要否ヒアリング) が未確定です — 21b へ差し戻し" } };
  }
  if (!graphics.prompts_confirmed_at) {
    return { error: { ok: false, code: "E_PROMPTS_NOT_CONFIRMED", message: "Step 21d (プロンプト確定) が未完了です — 21d へ差し戻し" } };
  }

  const promptsFile = readJson(path.join(appRoot, "graphics", "graphic-prompts.json"));
  if (!promptsFile) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_MISSING",
        message: "state は prompts 確定済みだが graphics/graphic-prompts.json が読めない (state↔file 不整合) — 21d へ差し戻し",
      },
    };
  }
  const entries = Array.isArray(promptsFile.prompts) ? promptsFile.prompts : null;
  // graphic_id は raw/{graphic_id}.png のファイル名になるため、schema pattern (kebab-case) を
  // ここでも enforce する (手編集 file の path 逃避を書き込み前に弾く)
  const ID_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  const validEntry = (e) =>
    e &&
    typeof e.graphic_id === "string" &&
    ID_PATTERN.test(e.graphic_id) &&
    typeof e.prompt === "string" &&
    e.prompt &&
    Number.isInteger(e?.size_px?.width) &&
    e.size_px.width >= 1 &&
    Number.isInteger(e?.size_px?.height) &&
    e.size_px.height >= 1;
  if (!entries || entries.length === 0 || !entries.every(validEntry)) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_INVALID",
        message: "graphic-prompts.json の prompts が空/不正 (graphic_id / prompt / size_px の欠落) — schema 検証と 21d の確定経緯を確認",
      },
    };
  }
  // graphic_id 重複は 21d commit が書き込み前に弾く契約 (schema description) — ここへ来るのは
  // 手編集の疑い。素通しすると digests の Map (last-entry-wins) が別 prompt の digest を全重複 entry に
  // 使い、間違った prompt で生成した画像が fresh 判定のまま下流へ出荷される
  const dupIds = [...new Set(entries.map((e) => e.graphic_id).filter((id, i, a) => a.indexOf(id) !== i))];
  if (dupIds.length) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_INVALID",
        duplicates: dupIds,
        message: `graphic-prompts.json の prompts に graphic_id 重複 (${dupIds.join(", ")}) — 1 graphic_id = 1 確定プロンプトが契約 (21d commit は重複を書かない。手編集なら重複を解消して再実行)`,
      },
    };
  }

  const { pending, fresh, excludedIds, digests } = computePending(entries, promptsFile.tool, graphics, appRoot);

  // 全 slot が excluded — §8-4 は「全 slot excluded = ブロック中止と同義 (decision='skip',
  // decided_by='step21e')」を定義。exclude の記録経路 (commit-degrade.mjs) は同時に skip 転換する
  // ため、ここへ来るのは手動編集等の state 不整合。復旧コマンド (commit-degrade abort) だけは
  // opts.allowAllExcluded で通す — さもないと復旧コマンド自身が本 assert に弾かれ出口が無くなる。
  if (!opts.allowAllExcluded && entries.every((e) => excludedIds.has(e.graphic_id))) {
    return {
      error: {
        ok: false,
        code: "E_ALL_SLOTS_EXCLUDED",
        message:
          "prompts の全 slot が excluded_slots に載っている — ブロック中止と同義の状態 (設計 §8-4)。`node skills/21e-graphic-generate/scripts/commit-degrade.mjs <app_name> abort --reason \"全 slot 生成失敗除外\"` で decision='skip' を記録する",
      },
    };
  }

  if (graphics.step21e_completed_at) {
    // pending が残るのに completed_at が立っている = 手動編集等の不整合 (正規経路では 21d rework /
    // 21g 差し戻しの orchestrator が completed_at をクリアする)。P4-07 (再質問しない) に従い、
    // どちらも E_ALREADY_COMPLETED で止めて routing を resume cascade / 手動リセット運用 (設計 §5) に委ねる。
    return {
      error: {
        ok: false,
        code: "E_ALREADY_COMPLETED",
        step21e_completed_at: graphics.step21e_completed_at,
        ...(pending.length ? { stale_pending: pending.map((e) => e.graphic_id) } : {}),
        message: pending.length
          ? `21e は完了済み (${graphics.step21e_completed_at}) だが digest 不一致の slot が残る (${pending.length} 件) — 正規の再生成経路 (21g 差し戻し / 設計 §9-2b) 外の変更。設計 §5 の手動リセット運用を確認`
          : `21e は完了済み (${graphics.step21e_completed_at}) — Step 21f (postprocess) へ。再生成は 21g 差し戻し経路 (generated_files entry 削除、設計 §9-2b) による`,
      },
    };
  }

  return { appRoot, state, graphics, promptsFile, entries, pending, fresh, excludedIds, digests };
}
