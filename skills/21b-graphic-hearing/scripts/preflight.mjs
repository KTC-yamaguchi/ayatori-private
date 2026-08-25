// Step 21b 共有ヘルパ — 前提 assert / main 画面 stem 解決 / 汎用 IO。
//
// gather-context.mjs / commit-decision.mjs の両方が import する named-export モジュール
// (scripts/lint-cross-screen-consistency.mjs と同じ分離パターン)。preflight 条件を 1 実装に
// 集約することで、両 script の返す E_* code を機械的に同一に保つ (コピペ drift の再発防止)。

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

/** ISO 8601 ローカル timezone offset 付き現在時刻 (例: 2026-07-16T15:00:00+09:00)。 */
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

/**
 * 21b 実行前提の assert (設計 docs/graphic-generation-design.md §3 / §5 / §9-1)。
 * gather (Step 1) と commit (Step 4 の再 assert) が同一実装を使い、同一の E_* code を返す。
 * @returns {{error: object}} 前提 NG (error はそのまま stdout JSON に出せる形) / {{appRoot, state, graphics, scope}} OK
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
  if (graphics.decision) {
    return {
      error: {
        ok: false,
        code: "E_DECISION_ALREADY_SET",
        decision: graphics.decision,
        decided_by: graphics.decided_by ?? null,
        message: `グラフィック要否は確定済み (${graphics.decision}) です — 再質問しない (P4-07)`,
      },
    };
  }
  // 上流 skip 判定は 21a 判定より先に行う: 上流 skip のプロジェクトは 21a 自体が走らず
  // step21a_completed_at 未設定が正常状態のため、順序が逆だと E_21A_NOT_DONE が先に返り
  // routing が「21a へ差し戻し」に誤誘導される (PR #165 レビュー指摘)
  const requirements = readJson(path.join(appRoot, "requirements.json"));
  if (!requirements) {
    return { error: { ok: false, code: "E_REQUIREMENTS_MISSING", message: "requirements.json が読めません" } };
  }
  const scope = requirements.design_output_scope ?? {};
  if (scope.graphic_generation === "skip") {
    return {
      error: {
        ok: false,
        code: "E_UPSTREAM_SKIP",
        message: "design_output_scope.graphic_generation == 'skip' — skip 記録は orchestrator の責務 (設計 §9-1)、21b は起動しない",
      },
    };
  }

  if (!graphics.step21a_completed_at) {
    return { error: { ok: false, code: "E_21A_NOT_DONE", message: "Step 21a (必要性分析) が未実行です" } };
  }

  if (!fs.existsSync(path.join(appRoot, "screens", "00-screen-list.md"))) {
    return { error: { ok: false, code: "E_SCREEN_LIST_MISSING", message: "screens/00-screen-list.md が存在しません (Step 14 未完了?)" } };
  }

  return { appRoot, state, graphics, scope };
}

const THEMES = new Set(["light", "dark"]);

/**
 * main 画面の論理 stem を platform ごとに解決する。
 * platform は screens/ ツリーの許容値 3 種すべて — web / web-sm / mobile (CLAUDE.md の {platform}
 * 定義。web_viewports=["sm"] の sm-only 構成では main HTML が screens/web-sm/ にのみ存在する。
 * 21a が web-sm slot を提案できるため、消費側の本 skill も同じ口径で走査しないと
 * commit-decision の実在照合が web-sm slot を素通しする — PR #168 yena review)。
 * Step 17 の命名規約: 単一テーマ = {screen}.html / dual_theme = {screen}--light.html + --dark.html。
 * sub-state variant ({screen}--{state}[--{theme}].html、25b の命名契約) は除外する。
 * theme 軸を剥がしてから残りに "--" があるものが sub-state — dual_theme プロジェクトで
 * suffix なしファイルが存在しない点に対応する (単純な `includes("--")` 除外は main を全滅させる)。
 * @returns {{ stems: Object<string,string[]>, files: Object<string,Object<string,string[]>> }} — キーは web / web-sm / mobile
 *   files は論理 stem → 実ファイル名 (拡張子付き) の対応 (dual_theme では 1 stem に 2 ファイル)。
 */
export const SCREEN_PLATFORMS = ["web", "web-sm", "mobile"];
export function resolveMainScreens(appRoot) {
  const stems = {};
  const files = {};
  for (const platform of SCREEN_PLATFORMS) {
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
    stems[platform] = Object.keys(map).sort();
  }
  return { stems, files };
}
