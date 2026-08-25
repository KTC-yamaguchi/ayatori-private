// Step 21a 共有ヘルパ — 前提 assert / main 画面 stem 解決 / 汎用 IO。
//
// extract-inventory.mjs / commit-completed.mjs の両方が import する named-export モジュール
// (skills/21b-graphic-hearing/scripts/preflight.mjs と同じ分離パターン)。preflight 条件を
// 1 実装に集約することで、両 script の返す E_* code を機械的に同一に保つ。
// 21b 側の preflight を import しないのは skill 間の実装結合を作らないため (同名 code は
// 意味も揃えてある: E_SCREENS_NOT_APPROVED / E_DECISION_ALREADY_SET / E_UPSTREAM_SKIP)。

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

/** ISO 8601 ローカル timezone offset 付き現在時刻 (例: 2026-07-22T15:00:00+09:00)。 */
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
 * 21a 実行前提の assert (設計 docs/graphic-generation-design.md §3 / §5 / §9-1)。
 * extract (Step 1) と commit (Step 3/4 の再 assert) が同一実装を使い、同一の E_* code を返す。
 * @returns {{error: object}} 前提 NG / {{appRoot, state, graphics, requirements, scope}} OK
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
    return { error: { ok: false, code: "E_SCREENS_NOT_APPROVED", message: "Step 21 (画面 HTML 承認) が未完了です — 21a は承認済み main HTML を入力とする (設計 §3)" } };
  }
  // 完走側ガード (設計 §9-1 cascade guard の skill 単独起動向け防御): 2nd Confluence save 通過済み
  // プロジェクトへの graphics 後付けは delta 領域 (設計 §5)。承認済み HTML を完走後に書き換える事故を防ぐ。
  if ((state?.confluence?.design?.save_count ?? 0) >= 2) {
    return {
      error: {
        ok: false,
        code: "E_PAST_2ND_SAVE",
        message: "2nd Confluence save 通過済み — グラフィックの後付け追加は delta 領域です (設計 docs/graphic-generation-design.md §5)。21a は実行しません",
      },
    };
  }
  const graphics = state?.screens?.graphics ?? {};
  if (graphics.decision) {
    return {
      error: {
        ok: false,
        code: "E_DECISION_ALREADY_SET",
        decision: graphics.decision,
        decided_by: graphics.decided_by ?? null,
        message: `グラフィック要否は確定済み (${graphics.decision}) です — 分析を再実行しない`,
      },
    };
  }
  // 上流 skip 判定は step21a 判定より先 (21b preflight と同じ順序原則): 上流 skip の記録は
  // orchestrator の責務 (設計 §9-1) で、21a は起動自体しない
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
        message: "design_output_scope.graphic_generation == 'skip' — skip 記録は orchestrator の責務 (設計 §9-1)、21a は起動しない",
      },
    };
  }
  if (graphics.step21a_completed_at) {
    return {
      error: {
        ok: false,
        code: "E_ALREADY_DONE",
        step21a_completed_at: graphics.step21a_completed_at,
        message: "Step 21a は実行済みです — 再分析せず Step 21b (要否ヒアリング) へ進む",
      },
    };
  }

  return { appRoot, state, graphics, requirements, scope };
}

const THEMES = new Set(["light", "dark"]);

/**
 * main 画面の論理 stem を platform ごとに解決する (21b preflight と同系の規約)。
 * platform は screens/ ツリーの許容値 3 種すべて — web / web-sm / mobile (CLAUDE.md
 * Operating Principle 3 の {platform} 定義。web_viewports=["sm"] の sm-only 構成では
 * main HTML が screens/web-sm/ にのみ存在するため、web-sm を含めないと E_NO_SCREENS
 * 誤判定で分析全体が degrade skip される — review M-1)。21b 側 preflight の同名関数も
 * 同じ SCREEN_PLATFORMS 3 種で走査する (yena review — 21a が web-sm slot を提案するため
 * 消費側も同口径が必須)。skill 間で実装は共有しない (結合を作らない方針) ため、片側を
 * 変えるときは両方を揃えること。
 * Step 17 の命名規約: 単一テーマ = {screen}.html / dual_theme = {screen}--light.html + --dark.html。
 * sub-state variant ({screen}--{state}[--{theme}].html) は除外する。
 * @returns {{ stems: Object<string,string[]>, files: Object<string,Object<string,string[]>> }} — キーは web / web-sm / mobile
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
