// Step 21f 共有ヘルパ — 前提 assert / digest / 対象 slot 差集合 / 正典パス規約。
// POCTEAMA-189 (F-6 透過検証 → 正典化。圧縮 ⑫ は非搭載 — ユーザー判断でスコープ除外)
//
// gather-context.mjs / postprocess-graphics.mjs / commit-degrade.mjs が import する named-export
// モジュール (21e の preflight.mjs と同じ分離パターン)。21e とは assert 内容が異なる
// (21e 完了済み / 21f 未完了 / 対象 = fresh generated_files − excluded) ため import 共有はせず、
// skill ディレクトリ単位で自己完結させる (skill の独立移動性を優先 — 21e preflight と同判断)。
// digest 計算 (sourceDigestOf) は 21e と同一アルゴリズムの複製 — 食い違うと 21e が fresh と
// 判定した slot を 21f が stale と誤判定して空転するため、変更時は両方を同時に直すこと
// (契約の SoT は設計 §9-2b と schemas/pipeline-state.schema.json generated_files.source_digest)。
// 同期は 21f eval が sourceDigestOf / readGraphicGenerationKey の **function 本体の逐字一致** で
// 機械検証する — 片側だけの編集は npm test で必ず落ちる。

import crypto from "node:crypto";
import fs from "node:fs";
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

// ── pipeline.yaml graphic_generation の既定値読み取り (21e preflight と同一の限定文法) ──
// AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT (fixture) と併用時のみ有効なテスト注入 knob —
// 単独残留の env が digest 材料を無言で差し替える事故を防ぐ (21e preflight と同一契約)
const PIPELINE_YAML_PATH = (() => {
  const scriptRelative = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../pipeline.yaml");
  const override = process.env.AYATORI_PIPELINE_YAML;
  if (!override) return scriptRelative;
  if (process.env.AYATORI_REPO_ROOT) return override;
  console.error("[21f] warn: AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT (fixture) と併用時のみ有効 — 実 run では無視します");
  return scriptRelative;
})();

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

/** transparent_background の正規化 (省略時 false — schema 既定)。 */
export const isTransparent = (entry) => entry?.transparent_background === true;

/**
 * slot 鮮度判定用 source_digest — 21e preflight.sourceDigestOf と同一アルゴリズム (設計 §9-2b)。
 * 21f は自分で digest を「作る」のではなく、generated_files[].source_digest が現在の prompts
 * entry と一致するか (= 21e の成果が fresh か) の照合にのみ使う。
 */
export function sourceDigestOf(entry, fileTool) {
  const transparent = isTransparent(entry);
  const tool = transparent ? DEFAULT_TRANSPARENT_TOOL : fileTool || DEFAULT_TOOL;
  const t = transparent ? "transparent" : "opaque";
  const material = `${tool}\n${entry.size_px.width}x${entry.size_px.height}\n${t}\n${entry.prompt}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

// ── 正典パス規約 (設計 §7: screens/_shared/graphics/{graphic_id}.{png|webp}) ──
export const CANONICAL_DIR = "screens/_shared/graphics";
export const canonicalPath = (graphicId, ext) => `${CANONICAL_DIR}/${graphicId}.${ext}`;
export const isCanonical = (file) => typeof file === "string" && file.startsWith(`${CANONICAL_DIR}/`);
export const rawPath = (graphicId) => `graphics/raw/${graphicId}.png`;
/** 当該 slot の generated_files[].file として正当なパスの全列挙 (完全一致で照合する)。 */
export const allowedFilesOf = (graphicId) => [rawPath(graphicId), canonicalPath(graphicId, "webp"), canonicalPath(graphicId, "png")];

/**
 * 対象 slot の分類 (設計 §9-2b の 21g/29 共通契約を 21f 入力側から見た形):
 *   埋め込み対象集合 = fresh な generated_files entry を持ち excluded_slots に載らない slot。
 *   21f の pending  = 対象のうち、まだ正典化されていない slot (file が raw のまま or 正典 file 不在)。
 *   21f の done     = 対象のうち、file が正典パスを指し実在する slot (再実行は no-op — 冪等)。
 *   stale           = 除外されていないのに fresh entry が無い slot (21e 完了済みなら state 不整合)。
 * @returns {{pendingSlots, doneSlots, staleIds, excludedIds, generatedById, digests}}
 */
export function computeTargets(entries, fileTool, graphics, appRoot) {
  const excludedIds = new Set(
    (Array.isArray(graphics?.excluded_slots) ? graphics.excluded_slots : []).map((e) => e?.graphic_id).filter(Boolean)
  );
  const generatedById = new Map(
    (Array.isArray(graphics?.generated_files) ? graphics.generated_files : [])
      .filter((g) => g?.graphic_id)
      .map((g) => [g.graphic_id, g])
  );
  const digests = new Map(entries.map((e) => [e.graphic_id, sourceDigestOf(e, fileTool)]));
  const pendingSlots = [];
  const doneSlots = [];
  const staleIds = [];
  for (const e of entries) {
    if (excludedIds.has(e.graphic_id)) continue;
    const g = generatedById.get(e.graphic_id);
    // file は**当該 slot 自身**の raw / 正典パスへの完全一致のみ受理する — schema は string と
    // pattern しか縛れず、手編集 state の path traversal (`../../outside.png`)・接尾辞すり替え
    // (`.webp.bak`)・別 slot の正典への横流しは、join(appRoot, file) で読む前にここで弾いて
    // E_21E_STALE の不整合経路に載せる (正典化・埋め込みの対象にしない)
    const fileAllowed = typeof g?.file === "string" && allowedFilesOf(e.graphic_id).includes(g.file);
    const fileExists = fileAllowed && fs.existsSync(path.join(appRoot, g.file));
    if (!g || g.source_digest !== digests.get(e.graphic_id) || !fileExists) {
      staleIds.push(e.graphic_id);
    } else if (isCanonical(g.file)) {
      doneSlots.push({ entry: e, generated: g });
    } else {
      pendingSlots.push({ entry: e, generated: g });
    }
  }
  return { pendingSlots, doneSlots, staleIds, excludedIds, generatedById, digests };
}

/** raw 画像バイトの同一性指紋 — waiver のバイト束縛 (下記 findWaiver) 用。 */
export const sha256Of = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * 当該 slot の有効な透過 waiver (透過検証失敗を user が「そのまま採用」した記録) を返す。
 * waiver は source_digest + raw バイト (raw_sha256) の複合単位:
 *   - digest 変化 (プロンプト改訂) で失効する (旧 prompt への受諾を新 prompt に引き回さない)。
 *   - digest 不変でも raw バイトが変われば失効する — 同 prompt の再抽選 (21g 品質差し戻し
 *     [F-7、設計 §9-2b] は entry 削除 + completed_at クリアのみで waiver に触れない) で生まれた
 *     **別画像**の再 fail に旧受諾を自動適用しない。user が受諾したのは「あのバイトの不透明画像」
 *     であり未見の新画像ではないため、不一致なら degrade 質問に戻す (PR #185 レビュー指摘)。
 * 21f 自身の retry (commit-degrade) は当該 slot の waiver を明示的に除去する (死んだ台帳を
 * 残さない — commit-degrade 側コメント参照)。
 */
export function findWaiver(graphics, graphicId, digest, rawSha256) {
  if (!rawSha256) return null;
  const list = Array.isArray(graphics?.transparency_waived) ? graphics.transparency_waived : [];
  return list.find((w) => w?.graphic_id === graphicId && w?.source_digest === digest && w?.raw_sha256 === rawSha256) ?? null;
}

/**
 * 21f 実行前提の assert (設計 §3 / §9-1 / §9-2)。
 * 起動条件: decision == "generate" AND step21e_completed_at set AND step21f_completed_at 未 set
 * (resume cascade §9-1 分岐 3 の `step21f_completed_at NOT set → Step 21f` と同値)。
 * 21g 差し戻し (生成レイヤ再入) は orchestrator が step21e/21f_completed_at をクリアする契約
 * (§9-2b) のため 21e からやり直しになり、本 assert は変更なしで整合する。
 * @param {object} [opts]
 * @param {boolean} [opts.allowStale] E_21E_STALE (fresh でない非除外 slot が残る不整合) でも通す。
 *   復旧手段である commit-degrade (retry = entry 削除で 21e へ戻す / abort) 自身に使わせるための
 *   穴 — 無いと「復旧コマンドが復旧対象の assert に弾かれる」円環になる (21e allowAllExcluded と同型)。
 * @param {boolean} [opts.allowNoTargets] E_NO_TARGETS (対象 0 件) でも通す。E_NO_TARGETS の
 *   message が本 skill の commit-degrade abort を復旧手段として指示するため (同上)。
 * @param {boolean} [opts.allowCompleted] E_ALREADY_COMPLETED (21f 完了済み) でも通す。
 *   commit-degrade の retry --canonical (正典化済み slot の意図的な再生成 — 21g 差し戻し routing
 *   [F-7] 実装までの暫定経路) 専用。反悔は 21f 完了後に起きるのが自然なため、この経路だけは
 *   完了済み state でも degrade 記録を受け付ける。
 * @param {boolean} [opts.allow21eIncomplete] E_21E_NOT_DONE (21e 未完了) でも通す。同一 run の
 *   複数失敗 slot に degrade を順に記録する際、先行する retry が step21e_completed_at をクリア
 *   すると後続の waive / exclude / abort が本 assert に弾かれ、記録が黙って落ちる (順序依存) —
 *   degrade 記録の安全性は mode ごとの per-slot guard (pendingSlot / doneSlot / fresh 判定) が
 *   担うため、commit-degrade はこの穴で通す。postprocess / gather は渡さない (既定 false)。
 */
export function assertPreflight(appName, opts = {}) {
  // app_name はパス部品のため、パス・トラバーサルを join 前に弾く (21e preflight と同一)
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
        message: `グラフィック生成ブロックは skip 確定済み (decided_by=${graphics.decided_by ?? "?"}) — 21f は起動しない`,
      },
    };
  }
  if (graphics.decision !== "generate") {
    return { error: { ok: false, code: "E_21B_NOT_DONE", message: "Step 21b (要否ヒアリング) が未確定です — 21b へ差し戻し" } };
  }
  if (!opts.allow21eIncomplete && !graphics.step21e_completed_at) {
    return { error: { ok: false, code: "E_21E_NOT_DONE", message: "Step 21e (生成) が未完了です — 21e へ差し戻し" } };
  }

  const promptsFile = readJson(path.join(appRoot, "graphics", "graphic-prompts.json"));
  if (!promptsFile) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_MISSING",
        message: "graphics/graphic-prompts.json が読めない (21e 完了済みなのに prompts 不在 = state↔file 不整合) — 設計 §5 の手動リセット運用を確認",
      },
    };
  }
  const entries = Array.isArray(promptsFile.prompts) ? promptsFile.prompts : null;
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
  const dupIds = [...new Set(entries.map((e) => e.graphic_id).filter((id, i, a) => a.indexOf(id) !== i))];
  if (dupIds.length) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_INVALID",
        duplicates: dupIds,
        message: `graphic-prompts.json の prompts に graphic_id 重複 (${dupIds.join(", ")}) — 1 graphic_id = 1 確定プロンプトが契約 (手編集なら重複を解消して再実行)`,
      },
    };
  }

  const targets = computeTargets(entries, promptsFile.tool, graphics, appRoot);

  // 21e 完了済みなのに fresh でない非除外 slot が残る = 手動編集等の state 不整合 (21e 側の
  // E_ALREADY_COMPLETED stale_pending と同じ穴を 21f 入口でも塞ぐ — 不在/古い raw を正典化しない)
  if (!opts.allowStale && targets.staleIds.length) {
    return {
      error: {
        ok: false,
        code: "E_21E_STALE",
        stale: targets.staleIds,
        message: `21e 完了済みだが fresh な生成記録の無い slot が残る (${targets.staleIds.join(", ")}) — prompts の手編集 / raw・正典ファイルの手動削除 / generated_files[].file のパス不正 (当該 slot の graphics/raw/{id}.png・screens/_shared/graphics/{id}.{png|webp} 以外) の疑い。正規の再生成経路 (21g 差し戻し、設計 §9-2b) または設計 §5 の手動リセット運用を確認`,
      },
    };
  }

  // 対象 0 件 (全 slot excluded) — 21e 側の契約 (commit-degrade) で decision='skip' に転換済みの
  // はずの状態。ここへ来るのは手動編集の疑いだが、復旧手段の案内だけ返す (21e と同判断)
  if (!opts.allowNoTargets && targets.pendingSlots.length === 0 && targets.doneSlots.length === 0) {
    return {
      error: {
        ok: false,
        code: "E_NO_TARGETS",
        message:
          "正典化対象の slot が 0 件 (全 slot excluded の疑い) — ブロック中止と同義の状態 (設計 §8-4)。`node skills/21f-graphic-postprocess/scripts/commit-degrade.mjs <app_name> abort --reason \"対象 slot なし\"` で decision='skip' を記録する",
      },
    };
  }

  if (!opts.allowCompleted && graphics.step21f_completed_at) {
    return {
      error: {
        ok: false,
        code: "E_ALREADY_COMPLETED",
        step21f_completed_at: graphics.step21f_completed_at,
        ...(targets.pendingSlots.length ? { stale_pending: targets.pendingSlots.map((s) => s.entry.graphic_id) } : {}),
        message: targets.pendingSlots.length
          ? `21f は完了済み (${graphics.step21f_completed_at}) だが未正典化の slot が残る (${targets.pendingSlots.length} 件) — 正規経路外の変更。設計 §5 の手動リセット運用を確認`
          : `21f は完了済み (${graphics.step21f_completed_at}) — Step 21g (embed-review) へ。再処理は 21g 差し戻し経路 (設計 §9-2b) による`,
      },
    };
  }

  return { appRoot, state, graphics, promptsFile, entries, ...targets };
}
