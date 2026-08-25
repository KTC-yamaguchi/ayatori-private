#!/usr/bin/env node
// Step 21g 差し戻し routing の原子的 state 書き込み — orchestrator (phases/screens/SKILL.md § Step 21g)
// の道具として呼ばれる CLI。POCTEAMA-190 (F-7 埋め込み + 承認)
//
// usage:
//   node route-rework.mjs <app_name> prompt --stdin [--dry-run]    # プロンプト起因 → 21d へ差し戻し
//     stdin: { "items": [ { "graphic_id": "...", "instruction": "..." } ] }
//   node route-rework.mjs <app_name> quality --stdin [--dry-run]   # 生成品質起因 (同 prompt リトライ) → 21e へ
//     stdin: { "items": [ { "graphic_id": "..." } ] }
//
// 設計 §9-2b の 3 分類 routing のうち生成レイヤへ戻る 2 経路を担う (配置起因は 21g 内で
// embed-graphics.mjs apply の再実行 — state 書き込み不要のため本 script の対象外):
//   - prompt:  graphics.prompts_confirmed_at のクリア + rework_pending[] への {graphic_id, instruction}
//     append を**同一 Write で原子的に**行う (routing の意図を必ずディスク状態に落とす — 記録なしの
//     「口頭 routing」は中断後に cascade が 21d を飛ばし修正指示が消失する)。同一 graphic_id の
//     既存 entry は instruction を置き換える (指示の二重積みを作らない)。
//   - quality: 当該 graphics.generated_files[] entry を削除する (digest 記録の削除 = 21e の pending 化)。
//   - 両経路とも step21e_completed_at / step21f_completed_at をクリアする (cascade / 連続セッションが
//     pending slot のみで 21e/21f を再通過する)。decision は変更しない (generate のまま —
//     skip への転換は 21b/21d/21e/21g 却下の経路のみ)。
//
// 注: rework_pending の schema 上の writer は phase orchestrator (単一所有権) — 本 script は
// orchestrator の指示でのみ起動する (21g SKILL からの直接呼び出しは 差し戻し分岐の routing 節経由)。
// 検証 NG は一切書き込まない。exit code は常に 0 (routing は JSON の code)。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, atomicWriteFileSync } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const args = process.argv.slice(2);
  const [appName, mode] = args;
  const KNOWN_FLAGS = ["--stdin", "--dry-run"];
  const unknownArgs = args.slice(2).filter((a) => !KNOWN_FLAGS.includes(a));
  const dryRun = args.includes("--dry-run");
  if (!appName || !["prompt", "quality"].includes(mode ?? "") || unknownArgs.length > 0 || !args.includes("--stdin")) {
    out({
      ok: false,
      code: "E_USAGE",
      ...(unknownArgs.length ? { unknown_args: unknownArgs } : {}),
      message: `usage: node route-rework.mjs <app_name> prompt|quality --stdin [--dry-run]${unknownArgs.length ? ` — 未知の引数 ${JSON.stringify(unknownArgs)} (typo なら直して再実行。何も書き込んでいない)` : ""}`,
    });
  }

  // rework mode: 同一ゲート内で prompt / quality の複数分類を続けて記録できるようにする —
  // 1 回目の routing が step21e/21f_completed_at をクリア (quality は generated entry も削除) した
  // 状態を E_GEN_INCOMPLETE / E_PENDING_SLOTS と誤判定すると、2 件目の指示が記録されず消失する
  // (設計 §9-2b)。routing 可能集合も fresh 判定に依存させず prompts − excluded で判定する
  // (quality 済み slot への追加 prompt 指示を弾かない)。
  const pre = assertPreflight(appName, { rework: true });
  if (pre.error) out(pre.error);
  const { appRoot, graphics, prompts, excludedIds } = pre;
  const statePath = path.join(appRoot, "pipeline-state.json");
  const state = pre.state;
  const targetIds = new Set(
    prompts.prompts.map((p) => p?.graphic_id).filter((id) => typeof id === "string" && !excludedIds.has(id))
  );

  const raw = fs.readFileSync(0, "utf8");
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin が JSON として parse できません" });
  }
  const items = draft?.items;
  if (typeof draft !== "object" || draft === null || Array.isArray(draft) || !Array.isArray(items) || items.length === 0) {
    out({ ok: false, code: "E_BAD_INPUT", message: `stdin は { items: [{graphic_id${mode === "prompt" ? ", instruction" : ""}}] } (1 件以上) の JSON object が必須` });
  }

  const errors = [];
  const extraTop = Object.keys(draft).filter((k) => k !== "items");
  if (extraTop.length) errors.push(`stdin に想定外の top-level key ${JSON.stringify(extraTop)} (許容: items)`);
  const ITEM_KEYS = mode === "prompt" ? ["graphic_id", "instruction"] : ["graphic_id"];
  const seen = new Set();
  items.forEach((it, i) => {
    const at = `items[${i}]`;
    if (typeof it !== "object" || it === null || Array.isArray(it)) {
      errors.push(`${at}: entry は object が必須`);
      return;
    }
    const extra = Object.keys(it).filter((k) => !ITEM_KEYS.includes(k));
    if (extra.length) errors.push(`${at}: 想定外の field ${JSON.stringify(extra)} (許容: ${ITEM_KEYS.join("/")})`);
    if (typeof it.graphic_id !== "string" || !targetIds.has(it.graphic_id)) {
      errors.push(`${at}: graphic_id '${it.graphic_id}' が routing 可能集合 (prompts − excluded) に無い (対象: ${[...targetIds].join(", ")})`);
      return;
    }
    if (seen.has(it.graphic_id)) errors.push(`${at}: graphic_id '${it.graphic_id}' が重複`);
    seen.add(it.graphic_id);
    if (mode === "prompt" && (typeof it.instruction !== "string" || !it.instruction.trim())) {
      errors.push(`${at}: instruction (修正指示) が欠落 — 記録なしの routing は中断後に指示が消失する (設計 §9-2b)`);
    }
  });
  if (errors.length) out({ ok: false, code: "E_VALIDATION", errors });

  if (dryRun) {
    out({
      ok: true,
      dry_run: true,
      mode,
      graphic_ids: items.map((it) => it.graphic_id),
      next: "検証 OK (何も書き込んでいない) — --dry-run なしで再実行する",
    });
  }

  const nextGraphics = { ...graphics };
  delete nextGraphics.step21e_completed_at;
  delete nextGraphics.step21f_completed_at;
  if (mode === "prompt") {
    delete nextGraphics.prompts_confirmed_at;
    const existing = (Array.isArray(graphics.rework_pending) ? graphics.rework_pending : []).filter(
      (r) => !seen.has(r?.graphic_id)
    );
    nextGraphics.rework_pending = [...existing, ...items.map((it) => ({ graphic_id: it.graphic_id, instruction: it.instruction.trim() }))];
  } else {
    nextGraphics.generated_files = (Array.isArray(graphics.generated_files) ? graphics.generated_files : []).filter(
      (g) => !seen.has(g?.graphic_id)
    );
  }

  if (!state.app_name) state.app_name = appName; // 必須 field の保全 assert
  if (!state.schema_version) state.schema_version = "2026-05-22"; // 欠落 = legacy の書き込み時補完
  state.screens ??= {};
  state.screens.graphics = nextGraphics;
  atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); // 単一 Write = 原子的 routing 記録 (tmp+rename で truncate 耐性 — 21a-21f と同一契約)

  out({
    ok: true,
    mode,
    graphic_ids: items.map((it) => it.graphic_id),
    cleared: ["step21e_completed_at", "step21f_completed_at", ...(mode === "prompt" ? ["prompts_confirmed_at"] : [])],
    next:
      mode === "prompt"
        ? "Step 21d (差し戻しモード — rework_pending を提示して当該 slot のみ再確定) へ。resume cascade が prompts_confirmed_at 未 set を検知する"
        : "Step 21e (同 prompt で当該 slot のみ再生成 — digest 記録を削除済み) へ。resume cascade が step21e_completed_at 未 set を検知する",
  });
} catch (e) {
  console.error(`route-rework.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
