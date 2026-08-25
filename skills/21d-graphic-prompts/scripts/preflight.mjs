// Step 21d 共有ヘルパ — 前提 assert / 汎用 IO。
// F-4 箇所別プロンプト確定
//
// gather-context.mjs / commit-prompts.mjs が import する named-export モジュール
// (21b / 21c の preflight.mjs と同じ分離パターン)。前提条件を 1 実装に集約し、
// 全 script の返す E_* code を機械的に同一に保つ。21c の preflight とは assert 内容が
// 異なる (taste 確定済み / prompts 未確定 / plan.taste 実在) ため import 共有はせず、
// skill ディレクトリ単位で自己完結させる (skill の独立移動性を優先)。

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

/** ISO 8601 ローカル timezone offset 付き現在時刻 (例: 2026-07-17T15:00:00+09:00)。 */
export function isoNow() {
  const now = new Date();
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(now.getTime() + offMin * 60000);
  return local.toISOString().slice(0, 19) + `${sign}${pad(offMin / 60)}:${pad(offMin % 60)}`;
}

// 既定 tool の SoT は pipeline.yaml screens.graphic_generation.tool — 21d は確定 tool を
// graphic-prompts.json に**永続化**するため、単独残留の env が fixture yaml の tool を正式値として
// 無言で焼き込む事故を特に防ぐ必要がある (AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT [fixture] と
// 併用時のみ有効 — 21c/21e/21f と同一契約)。
const PIPELINE_YAML_PATH = (() => {
  const scriptRelative = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../pipeline.yaml");
  const override = process.env.AYATORI_PIPELINE_YAML;
  if (!override) return scriptRelative;
  if (process.env.AYATORI_REPO_ROOT) return override;
  console.error("[21d] warn: AYATORI_PIPELINE_YAML は AYATORI_REPO_ROOT (fixture) と併用時のみ有効 — 実 run では無視します");
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

/** プロンプト系 field の CJK 混入検査 (E_NON_ENGLISH 契約 — 21c preflight と同一実装)。
 *  対象: ひらがな・カタカナ (U+3040-30FF)、CJK 記号・句読点 (U+3000-303F)、
 *  CJK 統合漢字 + 拡張 A (U+3400-9FFF)、全角形・半角カナ (U+FF00-FFEF)。
 *  注: 本パイプラインの現実的な混入源 (日本語) に絞った heuristic であり「英語のみ」の完全担保では
 *  ない (Hangul / アラビア文字等は検出しない — 検出範囲拡大は 21c 側実装との lockstep で行う)。 */
export function containsNonEnglish(s) {
  return /[\u3000-\u30FF\u3400-\u9FFF\uFF00-\uFFEF]/.test(s ?? "");
}

/**
 * 21d 実行前提の assert (設計 docs/graphic-generation-design.md §3 / §9-1 / §9-2)。
 * 起動条件: decision == "generate" AND taste_confirmed_at set AND prompts_confirmed_at 未 set
 * (resume cascade §9-1 分岐 3 の `prompts_confirmed_at NOT set → Step 21d` と同値)。
 * 21g 差し戻し (プロンプト起因) の再入も orchestrator が prompts_confirmed_at をクリアして
 * rework_pending を積む契約 (§9-2b) のため、同じ条件で通る。
 * @returns {{error: object}} 前提 NG / {{appRoot, state, graphics, plan, excludedIds}} OK
 *   (excludedIds = excluded_slots の graphic_id set — 対象集合 plan.slots − excludedIds の共有素材)
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
        message: `グラフィック生成ブロックは skip 確定済み (decided_by=${graphics.decided_by ?? "?"}) — 21d は起動しない`,
      },
    };
  }
  if (graphics.decision !== "generate") {
    return { error: { ok: false, code: "E_21B_NOT_DONE", message: "Step 21b (要否ヒアリング) が未確定です — 21b へ差し戻し" } };
  }
  if (!graphics.taste_confirmed_at) {
    return { error: { ok: false, code: "E_TASTE_NOT_SET", message: "Step 21c (テイスト選定) が未確定です — 21c へ差し戻し" } };
  }
  if (graphics.prompts_confirmed_at) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_ALREADY_SET",
        prompts_confirmed_at: graphics.prompts_confirmed_at,
        message: `プロンプトは確定済み (${graphics.prompts_confirmed_at}) です — 再質問しない (P4-07)。routing は resume cascade に委ねる (次は 21e)。21g 差し戻しの再確定は orchestrator が prompts_confirmed_at をクリアしてから (設計 §9-2b)`,
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
  // state (taste_confirmed_at) と plan (taste) の不整合 — 21c の commit は両方を書くため、
  // 片方だけ set は手動編集 / 破損のシグナル。style_directive はプロンプト合成の必須入力。
  if (typeof plan.taste?.style_directive !== "string" || plan.taste.style_directive === "") {
    return {
      error: {
        ok: false,
        code: "E_TASTE_MISSING",
        message: "state は taste 確定済みだが graphic-plan.json の taste.style_directive が読めない (state↔plan 不整合) — 21c へ差し戻し",
      },
    };
  }

  // 全 slot が excluded — §8-4 は「全 slot excluded = ブロック中止と同義 (decision='skip',
  // decided_by='step21e')」を 21e の責務と定義しており、その記録前にここへ来るのは state 不整合。
  // gather / commit (confirm・skip とも) が同一 code を返すよう共有 assert に置く
  const excludedIds = new Set(
    (Array.isArray(graphics.excluded_slots) ? graphics.excluded_slots : []).map((e) => e?.graphic_id).filter(Boolean)
  );
  if (plan.slots.every((s) => excludedIds.has(s.graphic_id))) {
    return {
      error: {
        ok: false,
        code: "E_ALL_SLOTS_EXCLUDED",
        message: "plan の全 slot が excluded_slots に載っている — 21e がブロック中止 (decision='skip') を記録すべき状態 (設計 §8-4)。state を確認",
      },
    };
  }

  return { appRoot, state, graphics, plan, excludedIds };
}

const THEMES = new Set(["light", "dark"]);

/**
 * main 画面の論理 stem → 実ファイル名を platform ごとに解決する (21b preflight と同一実装 —
 * skill の独立移動性優先で import 共有はしない)。Step 17 の命名規約: 単一テーマ = {screen}.html /
 * dual_theme = {screen}--light.html + --dark.html。sub-state variant ({screen}--{state}[--{theme}].html)
 * は theme 軸を剥がした後に "--" が残るもので除外する。
 * 21d では人間ゲート preview の対象 HTML 解決に使う — plan.slots[].screen は論理 stem のため、
 * dual_theme プロジェクトでは suffix なしパスを組むとファイル不在 link になる。
 * @returns {{ files: Object<string, Object<string,string[]>> }} platform → 論理 stem → 実ファイル名
 */
export function resolveMainScreens(appRoot) {
  const files = {};
  for (const platform of ["web", "web-sm", "mobile"]) {
    const dir = path.join(appRoot, "screens", platform);
    if (!fs.existsSync(dir)) continue;
    const map = {};
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".html"))) {
      const parts = f.slice(0, -5).split("--");
      if (THEMES.has(parts[parts.length - 1])) parts.pop(); // theme 軸を剥がす
      if (parts.length > 1) continue; // 残った "--" 軸 = sub-state variant
      (map[parts[0]] ??= []).push(f);
    }
    files[platform] = map;
  }
  return { files };
}
