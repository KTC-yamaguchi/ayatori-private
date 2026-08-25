#!/usr/bin/env node
// Step 21e (graphic-generate) の生成失敗 degrade 記録 — slot 除外 / ブロック中止 (設計 §8-4)。
// F-5 グラフィック生成 + サイズ自動調整
//
// usage:
//   node commit-degrade.mjs <app_name> exclude <graphic_id> --reason "<理由>"   # 当該 slot を除外して続行
//   node commit-degrade.mjs <app_name> abort --reason "<理由>"                  # ブロック中止 (decision=skip)
//
// 設計 §8-4 generation_failure の 3 択のうち「リトライ」は generate-graphics.mjs の再実行
// (pending 差集合が失敗分だけを再生成する) であり、本 script は残る 2 択の記録を担う:
//   - exclude: screens.graphics.excluded_slots[] へ {graphic_id, reason, excluded_at} を append。
//     記録なしの除外は禁止 (当該 slot が永久 pending 化し resume ごとに再生成試行・再質問 [P4-07
//     抵触] を繰り返す — 設計 §9-2b)。除外の結果 pending が空になれば step21e_completed_at を set、
//     全 slot が excluded になればブロック中止と同義として decision='skip' (decided_by='step21e')
//     を記録する (空の 21g ゲートを回さない)。
//   - abort: decision='skip', decided_by='step21e' を記録して 21f-21g を skip (Step 15 [2nd save]
//     → Step 22 へ素通し)。生成済み raw / generated_files は残置される (skip 後の再入は設計 §5 の
//     手動リセット運用のみ)。
//
// reason は必須 (無言の除外・中止の禁止 — Operating Principle 4)。
// stdout に JSON を 1 個出力する (exit 0 固定、routing は code。内部エラーのみ exit 1)。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, atomicWriteFileSync, computePending, isoNow } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const args = process.argv.slice(2);
  const [appName, mode] = args;
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? (args[reasonIdx + 1] ?? "") : "";
  const targetId = mode === "exclude" ? args[2] : null;
  const expectedLen = mode === "exclude" ? 5 : 4; // <app> <mode> [<id>] --reason <理由>
  if (
    !appName ||
    !["exclude", "abort"].includes(mode ?? "") ||
    (mode === "exclude" && (!targetId || targetId.startsWith("--"))) ||
    !reason.trim() ||
    args.length !== expectedLen
  ) {
    out({
      ok: false,
      code: "E_USAGE",
      message:
        'usage: node commit-degrade.mjs <app_name> exclude <graphic_id> --reason "<理由>" | abort --reason "<理由>" (reason は必須 — 無言の除外・中止は禁止)',
    });
  }

  // ── 前提の再 assert (generate 失敗後の対話中に state が変わっていないかの防御。gather と同一 code。
  // allowAllExcluded: E_ALL_SLOTS_EXCLUDED の message が本 script の abort を復旧手段として指示する
  // ため、その状態でも通す — preflight 側コメント参照) ──
  const pre = assertPreflight(appName, { allowAllExcluded: true });
  if (pre.error) out(pre.error);
  const { appRoot, state, graphics, promptsFile, entries, excludedIds } = pre;

  const statePath = path.join(appRoot, "pipeline-state.json");
  const graphicsState = { ...graphics };
  const writeState = () => {
    if (!state.app_name) state.app_name = appName; // 必須 field の保全 assert
    state.screens ??= {};
    state.screens.graphics = graphicsState;
    atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  };

  if (mode === "abort") {
    graphicsState.decision = "skip";
    graphicsState.decided_by = "step21e";
    writeState();
    out({
      ok: true,
      decision: "skip",
      decided_by: "step21e",
      warnings: [
        "生成済み raw / generated_files は残置される — 本ブロックの有効判定の SoT は decision (設計 §9-2b)。再入は設計 §5 の手動リセット運用のみ",
      ],
      next: "21f-21g を skip し Step 15 (2nd Confluence save) → Step 22 へ素通し",
    });
  }

  // ── exclude ──
  const entry = entries.find((e) => e.graphic_id === targetId);
  if (!entry) {
    out({
      ok: false,
      code: "E_SLOT_NOT_FOUND",
      message: `graphic_id '${targetId}' が graphic-prompts.json の prompts に存在しない (存在する slot: ${entries.map((e) => e.graphic_id).join(", ")})`,
    });
  }
  if (excludedIds.has(targetId)) {
    out({ ok: false, code: "E_ALREADY_EXCLUDED", message: `graphic_id '${targetId}' は除外済み — 再記録しない (P4-07)` });
  }
  const { fresh } = computePending(entries, promptsFile.tool, graphics, appRoot);
  if (fresh.some((e) => e.graphic_id === targetId)) {
    out({
      ok: false,
      code: "E_SLOT_ALREADY_GENERATED",
      message: `graphic_id '${targetId}' は生成成功済み (fresh) — 除外は生成失敗 slot の degrade 記録 (設計 §8-4)。生成後の取り下げは 21g 側の却下手順 (設計 §11) による`,
    });
  }

  graphicsState.excluded_slots = [
    ...(Array.isArray(graphicsState.excluded_slots) ? graphicsState.excluded_slots : []),
    { graphic_id: targetId, reason: reason.trim(), excluded_at: isoNow() },
  ];

  // 旧 run の正典残骸があれば掃除する (21f exclude と対称 — POCTEAMA-189)。到達経路: 正典化済み
  // slot が 21g 差し戻し / 21f retry で entry 削除 → 21e の再生成が失敗し続けて除外、のとき
  // screens/_shared/graphics/ に state 非参照の旧ファイルが残り、除外済みの古い絵が配布物・
  // index に紛れ込む。除外 slot の正典は残さない
  for (const ext of ["png", "webp"]) {
    const p = path.join(appRoot, "screens", "_shared", "graphics", `${targetId}.${ext}`);
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  // 除外後の残 slot を再評価: 全 slot excluded → ブロック中止と同義 (設計 §8-4) /
  // pending 空 (残りは全部 fresh) → 21e 完了記録を立てて 21f へ
  const after = computePending(entries, promptsFile.tool, { ...graphics, excluded_slots: graphicsState.excluded_slots }, appRoot);
  const allExcluded = entries.every((e) => after.excludedIds.has(e.graphic_id));
  if (allExcluded) {
    graphicsState.decision = "skip";
    graphicsState.decided_by = "step21e";
    writeState();
    out({
      ok: true,
      excluded: targetId,
      decision: "skip",
      decided_by: "step21e",
      warnings: ["全 slot が excluded になったためブロック中止と同義として記録 (設計 §8-4 — 埋め込み対象 0 件の空 21g ゲートを回さない)"],
      next: "21f-21g を skip し Step 15 (2nd Confluence save) → Step 22 へ素通し",
    });
  }
  if (after.pending.length === 0) {
    graphicsState.step21e_completed_at = isoNow();
    writeState();
    out({
      ok: true,
      excluded: targetId,
      step21e_completed_at: graphicsState.step21e_completed_at,
      remaining: { generated: after.fresh.map((e) => e.graphic_id), excluded: [...after.excludedIds] },
      next: "残 slot は全て生成済み — Step 21f (graphic-postprocess) へ",
    });
  }
  writeState();
  out({
    ok: true,
    excluded: targetId,
    remaining: { pending: after.pending.map((e) => e.graphic_id), generated: after.fresh.map((e) => e.graphic_id), excluded: [...after.excludedIds] },
    next: "pending が残っている — Step 2 (generate-graphics.mjs) を再実行する",
  });
} catch (e) {
  console.error(`commit-degrade.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
