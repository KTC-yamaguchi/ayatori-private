// Step 21c 共有ヘルパ — 前提 assert / 汎用 IO。
// F-3 テイスト選定
//
// gather-context.mjs / generate-samples.mjs / commit-taste.mjs が import する named-export
// モジュール (21b の preflight.mjs と同じ分離パターン)。前提条件を 1 実装に集約し、
// 全 script の返す E_* code を機械的に同一に保つ。21b の preflight とは assert 内容が
// 異なる (decision==generate / taste 未確定 / plan 実在) ため import 共有はせず、
// skill ディレクトリ単位で自己完結させる (skill の独立移動性を優先)。

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

/** ISO 8601 ローカル timezone offset 付き現在時刻 (例: 2026-07-17T15:00:00+09:00)。 */
export function isoNow() {
  const now = new Date();
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(now.getTime() + offMin * 60000);
  return local.toISOString().slice(0, 19) + `${sign}${pad(offMin / 60)}:${pad(offMin % 60)}`;
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

/** _backup/ ミラー規約 (pipeline.yaml § artifact_backup: {stem}.{YYYYMMDD_HHMMSS}.{ext}) への退避。
 *  同一秒の衝突は backup-on-edit.sh と同じ `-{i}` 連番で回避する (silent 上書きによる退避消失を防ぐ)。 */
export function backupFile(appRoot, absPath) {
  const rel = path.relative(appRoot, absPath);
  const stamp = isoNow().slice(0, 19).replace(/-|:/g, "").replace("T", "_");
  const dir = path.join(appRoot, "_backup", path.dirname(rel));
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(absPath);
  const stem = path.basename(absPath, ext);
  let dest = path.join(dir, `${stem}.${stamp}${ext}`);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(dir, `${stem}.${stamp}-${i}${ext}`);
  fs.copyFileSync(absPath, dest);
  return dest;
}

/** プロンプト系 field の CJK 混入検査 (E_NON_ENGLISH 契約の単一実装 — generate / commit で共有し
 *  copy-paste drift を防ぐ)。対象: ひらがな・カタカナ (U+3040-30FF)、CJK 記号・句読点 (U+3000-303F)、
 *  CJK 統合漢字 + 拡張 A (U+3400-9FFF)、全角形・半角カナ (U+FF00-FFEF)。 */
export function containsNonEnglish(s) {
  return /[\u3000-\u30FF\u3400-\u9FFF\uFF00-\uFFEF]/.test(s ?? "");
}

/**
 * 21c 実行前提の assert (設計 docs/graphic-generation-design.md §3 / §9-1 / §9-2)。
 * 起動条件: decision == "generate" AND taste_confirmed_at 未 set (resume cascade §9-1 分岐 3 と同値)。
 * @returns {{error: object}} 前提 NG / {{appRoot, state, graphics, plan}} OK
 */
export function assertPreflight(appName) {
  const appRoot = path.join(repoRoot, "artifacts", appName ?? "");
  if (!appName || !fs.existsSync(appRoot)) {
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
        message: `グラフィック生成ブロックは skip 確定済み (decided_by=${graphics.decided_by ?? "?"}) — 21c は起動しない`,
      },
    };
  }
  if (graphics.decision !== "generate") {
    return { error: { ok: false, code: "E_21B_NOT_DONE", message: "Step 21b (要否ヒアリング) が未確定です — 21b へ差し戻し" } };
  }
  if (graphics.taste_confirmed_at) {
    return {
      error: {
        ok: false,
        code: "E_TASTE_ALREADY_SET",
        taste_confirmed_at: graphics.taste_confirmed_at,
        message: `テイストは確定済み (${graphics.taste_confirmed_at}) です — 再質問しない (P4-07)。やり直しは §5 手動リセットの運用手順による`,
      },
    };
  }

  const plan = readJson(path.join(appRoot, "graphics", "graphic-plan.json"));
  if (!plan) {
    return { error: { ok: false, code: "E_PLAN_MISSING", message: "graphics/graphic-plan.json が読めません (21b の generate 確定が不完全?)" } };
  }
  if (!Array.isArray(plan.slots) || plan.slots.length === 0) {
    return { error: { ok: false, code: "E_PLAN_INVALID", message: "graphic-plan.json の slots が空/不正 (schema minItems 1)" } };
  }

  return { appRoot, state, graphics, plan };
}

// 生成 API キーの解決 — 21e と共通の恒久契約 (docs/setup.md「グラフィック生成 API キー」)。
// 優先順 (POCTEAMA-408):
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

// 既定 tool の SoT は pipeline.yaml screens.graphic_generation.tool — 宣言だけでなく実際に読む
// (hardcode だけだと SoT のツール差し替え後もテイスト見本が旧モデルで生成され、user が承認した
// テイストと 21e の本生成モデルが食い違う)。抽出文法・fail-open は 21e preflight の
// readGraphicGenerationKey と同一 (skill の独立移動性を優先して import 共有はしない)。
// AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT (fixture) と併用時のみ有効なテスト注入 knob
// (21d/21e/21f と同一契約 — 単独残留の env に実 run の tool を差し替えさせない)。
const PIPELINE_YAML_PATH = (() => {
  const scriptRelative = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../pipeline.yaml");
  const override = process.env.AYATORI_PIPELINE_YAML;
  if (!override) return scriptRelative;
  if (process.env.AYATORI_REPO_ROOT) return override;
  console.error("[21c] warn: AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT (fixture) と併用時のみ有効 — 実 run では無視します");
  return scriptRelative;
})();

/**
 * pipeline.yaml screens.graphic_generation ブロックの scalar を決定的に抽出する (YAML parser
 * 非依存 — Operating Principle 1 の範囲で `key: value` 行のみを対象にした限定文法。ブロックの
 * 終了は同レベル以浅のキー出現で判定する)。読めない / 見つからない場合は fallback (fail-open)。
 * 本 function は 21c/21d/21e/21f の 4 skill に複製されている (per-skill 自己完結の repo 方針) —
 * 変更は 4 つ同時に。同期は 21f eval が function 本体の逐字一致で機械検証する。
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

/** pipeline.yaml screens.graphic_generation.tool の既定値 (読めない場合は既知の値へ fail-open)。 */
export const pipelineDefaultTool = (yamlPath = PIPELINE_YAML_PATH) => readGraphicGenerationKey("tool", "gpt-image-2", yamlPath);
