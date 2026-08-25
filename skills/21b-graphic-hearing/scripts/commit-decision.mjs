#!/usr/bin/env node
// Step 21b (graphic-hearing) の決定 commit — slot 検証 + artifact 書き込みの決定的部分。
//
// usage:
//   node commit-decision.mjs <app_name> generate --stdin              # stdin = {"slots":[...]} (人間ゲート確定済み draft)
//   node commit-decision.mjs <app_name> generate --stdin --dry-run    # 検証のみ・書き込みゼロ (§6 確定確認の前に draft を通す)
//   node commit-decision.mjs <app_name> skip                          # 「不要」確定
//
// --dry-run は preflight 再 assert + slot 検証まで本番と同一に実行し、一切書き込まずに結果を返す。
// user には検証済みの draft だけを §6 で見せる (確定後の E_VALIDATION → 無言修正 commit で
// 「user が確定した内容」と「書き込まれる内容」が乖離するのを防ぐ)。
//
// stdout に JSON を 1 個出力する:
//   - 検証 NG: { ok: false, code: "E_VALIDATION", errors: [...] } — 一切書き込まない (LLM が draft を直して再実行)
//   - 成功:    { ok: true, decision, ... }
// exit code は常に 0 (routing は JSON の code)。予期しない内部エラーのみ exit 1。
//
// generate 時の書き込み (設計 docs/graphic-generation-design.md §7 / §8-4 / §9-2):
//   - graphics/graphic-plan.json を 1 Write で一括生成 (taste キーは書かない = 21c territory の key 分離)。
//     slot 制約 (required / additionalProperties / type / pattern / enum / minItems) は
//     schemas/graphic-plan.schema.json を **実行時に読んで導出**する — 手書きミラーを持たない
//     (schema が SoT。schema 更新 [例: state enum の sub-state 拡張] に追従漏れしない)。
//     hook (schema-light-check.sh R9) は Write/Edit ツールにしか発火しないため、Bash 起動の本 script は
//     自前検証の責務を持つ (feedback-protocol の self-backup と同じ理由)。既存 plan が残置されていた
//     場合 (§5 手動リセット後の再ヒアリング) は _backup/graphics/ へ退避してから上書きする。
//   - pipeline-state.json に screens.graphics.decision="generate" を merge write。
// skip 時は pipeline-state.json に decision="skip", decided_by="step21b" のみ。
// 前提の再 assert は preflight.mjs を gather-context.mjs と共有 (同一の E_* code を返す)。
// AYATORI_REPO_ROOT env で repo root を差し替え可能 (回帰テスト用)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPreflight, atomicWriteFileSync, isoNow, readJson, repoRoot, resolveMainScreens } from "./preflight.mjs";

// schema は repo 本体の一部なので常に script 自身の位置から解決する
// (repoRoot は AYATORI_REPO_ROOT で artifacts fixture 差し込み用に上書きされ得るため使わない)
const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../schemas/graphic-plan.schema.json");

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

// web-sm は web viewport の変種 (web_viewports=["sm"]) のため web を含む combo で許容する。
// 実際に sm 画面が生成されているかは下の実在照合 (mainFiles) が判定する — combo は範囲、
// 実在は照合、の 2 段 (sm 未生成なら web-sm slot は実在照合で弾かれる)
const PLATFORMS_BY_COMBO = {
  web_only: ["web", "web-sm"],
  mobile_only: ["mobile"],
  mobile_and_web: ["web", "web-sm", "mobile"],
};

try {
  const args = process.argv.slice(2);
  const [appName, decision] = args;
  const dryRun = args.includes("--dry-run");
  if (
    !appName ||
    !["generate", "skip"].includes(decision ?? "") ||
    (dryRun && decision !== "generate") ||
    // generate は --stdin 必須 (usage 契約と一致させる。pipe なし起動の stdin 待ち hang / E_BAD_INPUT 化も防ぐ)
    (decision === "generate" && !args.includes("--stdin"))
  ) {
    // --dry-run は generate 専用 (skip には検証対象の draft がない)
    out({ ok: false, code: "E_USAGE", message: "usage: node commit-decision.mjs <app_name> generate --stdin [--dry-run] | skip" });
  }

  // ── 前提の再 assert (gather 後の対話中に state が変わっていないかの防御。gather と同一 code) ──
  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, scope } = pre;
  const statePath = path.join(appRoot, "pipeline-state.json");

  // ── pipeline-state merge write の共通部 (Read or init stub → merge → Write back、docs/artifact-file-responsibility.md 設計原則 4) ──
  const writeState = (patch) => {
    const s = readJson(statePath) ?? { app_name: appName };
    if (!s.app_name) s.app_name = appName; // 必須 field の保全 assert
    s.screens ??= {};
    s.screens.graphics = { ...(s.screens.graphics ?? {}), ...patch };
    atomicWriteFileSync(statePath, JSON.stringify(s, null, 2) + "\n");
  };

  // ── skip: state のみ (plan は書かない — 設計 §8-4 gate_21b) ──
  if (decision === "skip") {
    writeState({ decision: "skip", decided_by: "step21b" });
    out({ ok: true, decision: "skip", decided_by: "step21b", next: "Step 15 (2nd Confluence save) へ素通し" });
  }

  // ── generate: slot 制約を schema (SoT) から導出 ──
  const planSchema = readJson(SCHEMA_PATH);
  const slotSchema = planSchema?.properties?.slots?.items;
  if (!slotSchema?.required || !slotSchema?.properties) {
    out({ ok: false, code: "E_SCHEMA_UNREADABLE", message: "schemas/graphic-plan.schema.json が読めない/形が想定外 — 検証不能のため書き込まない" });
  }
  const allowedKeys = Object.keys(slotSchema.properties);

  // ── stdin の slots draft を検証 ──
  const raw = fs.readFileSync(0, "utf8");
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin が JSON として parse できません" });
  }
  const slots = Array.isArray(input) ? input : input?.slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    out({ ok: false, code: "E_VALIDATION", errors: ["slots は 1 件以上の配列が必須 (minItems 1 — 0 件なら skip を使う)"] });
  }

  const errors = [];
  const combo = scope.platform_combo;
  const allowedPlatforms = PLATFORMS_BY_COMBO[combo];
  if (!allowedPlatforms) {
    // fail-open で全 platform に広げない: 範囲検査は本 script にしかなく、黙って消えると
    // web_only プロジェクトに mobile slot が通る (Operating Principle 4: UNCERTAIN は補完しない)
    errors.push(`requirements.json の design_output_scope.platform_combo '${combo ?? "(未設定)"}' が不明 (web_only/mobile_only/mobile_and_web) — requirements.json を確認`);
  }
  const { files: mainFiles } = resolveMainScreens(appRoot);
  // 範囲/実在検査の対象 platform は schema enum (SoT) から導出 — enum 外の値は items.enum 検査が
  // 担うため、known 判定は二重報告の回避のみが目的 (手書きの ["web","mobile"] 硬直で web-sm が
  // 両検査を素通しした欠陥の再発防止 — PR #168 yena review)
  const knownPlatforms = slotSchema.properties.platforms?.items?.enum ?? ["web", "web-sm", "mobile"];
  const seen = new Set();

  slots.forEach((slot, i) => {
    const at = `slots[${i}]`;
    for (const field of slotSchema.required) {
      if (slot[field] === undefined || slot[field] === null || slot[field] === "") {
        errors.push(`${at}: 必須 field '${field}' が欠落`);
      }
    }
    const extra = Object.keys(slot).filter((k) => !allowedKeys.includes(k));
    if (extra.length) errors.push(`${at}: schema に無い field ${JSON.stringify(extra)} (additionalProperties: false)`);

    // schema properties の type / pattern / enum / items.enum / minItems / uniqueItems を解釈して検証
    for (const [key, def] of Object.entries(slotSchema.properties)) {
      const v = slot[key];
      if (v === undefined || v === null || v === "") continue; // 欠落は required 検査が担う
      if (def.type === "string") {
        if (typeof v !== "string") {
          errors.push(`${at}: ${key} は string 型が必須 (実際: ${Array.isArray(v) ? "array" : typeof v})`);
          continue; // 型違いに pattern/enum は適用しない
        }
        if (def.pattern && !new RegExp(def.pattern).test(v)) {
          errors.push(`${at}: ${key} '${v}' が pattern 違反 (${def.pattern})`);
        }
        if (def.enum && !def.enum.includes(v)) {
          errors.push(`${at}: ${key} '${v}' は enum (${def.enum.join("/")}) 外`);
        }
      } else if (def.type === "array") {
        if (!Array.isArray(v)) {
          errors.push(`${at}: ${key} は array 型が必須 (実際: ${typeof v})`);
          continue;
        }
        if (def.minItems && v.length < def.minItems) errors.push(`${at}: ${key} は ${def.minItems} 件以上が必須`);
        if (def.uniqueItems && new Set(v).size !== v.length) errors.push(`${at}: ${key} に重複`);
        if (def.items?.enum) {
          for (const item of v) {
            if (!def.items.enum.includes(item)) errors.push(`${at}: ${key} 値 '${item}' は enum (${def.items.enum.join("/")}) 外`);
          }
        }
      }
    }

    // schema では表現できない実在照合 (設計 §7 src↔正典と同系の決定的検査)
    if (Array.isArray(slot.platforms) && typeof slot.screen === "string" && slot.screen) {
      for (const p of slot.platforms) {
        if (allowedPlatforms && !allowedPlatforms.includes(p) && knownPlatforms.includes(p)) {
          errors.push(`${at}: platform '${p}' は platform_combo (${combo}) の範囲外`);
        }
        if (knownPlatforms.includes(p) && !mainFiles[p]?.[slot.screen]) {
          // 実在 stem を列挙して self-correct 可能にする (compaction 後に gather の出力が失われていても再 draft できる)
          const available = Object.keys(mainFiles[p] ?? {}).sort().join(", ") || "(なし)";
          errors.push(`${at}: screens/${p}/ に main 画面 '${slot.screen}' が存在しません (dual_theme では --light/--dark を除いた論理名で指定。存在する main 画面: ${available})`);
        }
      }
    }
    // platforms は並び順を正規化してから比較 (["web","mobile"] と ["mobile","web"] は同一 slot)
    const key = JSON.stringify([slot.graphic_id, slot.screen, [...(slot.platforms ?? [])].sort(), slot.placement]);
    if (seen.has(key)) errors.push(`${at}: 完全重複 slot (同一 graphic_id/screen/platforms/placement)`);
    seen.add(key);
  });

  if (errors.length) out({ ok: false, code: "E_VALIDATION", errors });

  // ── --dry-run: 検証 OK をここで返す (書き込みゼロ) ──
  if (dryRun) {
    out({
      ok: true,
      dry_run: true,
      decision: "generate",
      slot_count: slots.length,
      graphic_ids: slots.map((s) => s.graphic_id),
      next: "検証 OK (何も書き込んでいない) — §6 確定確認を経て --dry-run なしで再実行する",
    });
  }

  // ── graphic-plan.json 一括生成 (taste は書かない) ──
  const plan = {
    app_name: appName,
    created_at: isoNow(),
    ...(fs.existsSync(path.join(appRoot, "graphics", "graphic-recommend.md"))
      ? { recommend_report_ref: "graphics/graphic-recommend.md" }
      : {}), // 省略 = 推奨レポートなし (degrade) で確定した記録
    slots,
  };

  const planPath = path.join(appRoot, "graphics", "graphic-plan.json");
  let backedUp = null;
  if (fs.existsSync(planPath)) {
    // §5 手動リセット後の再ヒアリング等で残置 plan がある場合のみ。
    // _backup/ ミラー規約 (pipeline.yaml § artifact_backup: {stem}.{YYYYMMDD_HHMMSS}.{ext}) に合わせる
    const stamp = isoNow().slice(0, 19).replace(/-|:/g, "").replace("T", "_");
    const backupDir = path.join(appRoot, "_backup", "graphics");
    fs.mkdirSync(backupDir, { recursive: true });
    backedUp = path.join(backupDir, `graphic-plan.${stamp}.json`);
    fs.copyFileSync(planPath, backedUp);
  }
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  atomicWriteFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");

  writeState({ decision: "generate" });

  out({
    ok: true,
    decision: "generate",
    plan_path: path.relative(repoRoot, planPath),
    slot_count: slots.length,
    graphic_ids: slots.map((s) => s.graphic_id),
    ...(backedUp ? { backed_up: path.relative(repoRoot, backedUp) } : {}),
    next: "Step 21c graphic-taste (テイスト選定) へ",
  });
} catch (e) {
  console.error(`commit-decision.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
