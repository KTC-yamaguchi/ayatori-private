#!/usr/bin/env node
// Step 21f (graphic-postprocess) の degrade 記録 — 透過検証 fail / 後処理失敗の 4 経路 (設計 §8-4 同型)。
// POCTEAMA-189 (F-6)
//
// usage:
//   node commit-degrade.mjs <app_name> waive <graphic_id> --reason "<理由>"     # 透過 fail をそのまま採用 (ラベル付き)
//   node commit-degrade.mjs <app_name> retry <graphic_id> --reason "<理由>"     # 当該 slot を 21e から再生成
//   node commit-degrade.mjs <app_name> exclude <graphic_id> --reason "<理由>"   # 当該 slot を除外して続行
//   node commit-degrade.mjs <app_name> abort --reason "<理由>"                  # ブロック中止 (decision=skip)
//
// SKILL.md Step 3 の AskUserQuestion の選択を state に落とす:
//   - waive:   screens.graphics.transparency_waived[] へ {graphic_id, source_digest, raw_sha256,
//     reason, waived_at} を記録 (同 slot の旧記録は置換 — 1 slot 1 記録)。POCTEAMA-189 チケットの
//     fallback 方針「ラベルをつけて代わりの方法を提案」の「ラベル」の実体 — postprocess 再実行時に
//     当該 slot が不透明のまま正典化され、台帳に transparency: "waived" が記録される。
//     digest + raw バイトの複合単位のため、プロンプト改訂 (digest 変化) でも同 prompt の再抽選
//     (バイト変化 — 21g 品質差し戻し経路) でも失効する (受諾した当のバイト以外に引き回さない)。
//   - retry:   当該 generated_files entry を削除 + step21e_completed_at をクリア (§9-2b の
//     「品質起因は entry 削除がその記録」と同じ機構)。当該 slot の waiver も除去する — 残すと
//     リトライ後も fail する場合に waiver が自動適用され、透過を求めた user の意図に反して
//     不透明画像が黙って正典化される。
//   - exclude: screens.graphics.excluded_slots[] へ append (21e commit-degrade と同じ台帳)。
//     正典化前の slot のみ対象 (正典化済み slot の取り下げは 21g の却下手順 — 設計 §11、F-7)。
//     全 slot excluded はブロック中止と同義 (decision='skip')、pending が空になれば
//     step21f_completed_at を set する。
//   - abort:   decision='skip', decided_by='step21f' を記録して 21g を skip (Step 15 [2nd save]
//     → Step 22 へ素通し)。生成済み raw / 正典化済み分は残置される。
//
// reason は全 mode で必須 (無言の degrade の禁止 — Operating Principle 4)。
// stdout に JSON を 1 個出力する (exit 0 固定、routing は code。内部エラーのみ exit 1)。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, atomicWriteFileSync, canonicalPath, computeTargets, findWaiver, isoNow, isTransparent, sha256Of } from "./preflight.mjs";
import { decodePng, verifyTransparency } from "./png-inspect.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const args = process.argv.slice(2);
  const [appName, mode] = args;
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? (args[reasonIdx + 1] ?? "") : "";
  // --canonical: retry 専用 — 正典化済み slot を明示確認の上で 21e からやり直す (21g 差し戻し
  // routing [F-7] 実装までの暫定経路。waive 反悔などの正規ニーズを手編集に追い込まない)
  const canonicalFlag = args.includes("--canonical");
  const needsId = ["waive", "retry", "exclude"].includes(mode ?? "");
  const targetId = needsId ? args[2] : null;
  const expectedLen = (needsId ? 5 : 4) + (canonicalFlag ? 1 : 0); // <app> <mode> [<id>] --reason <理由> [--canonical]
  if (
    !appName ||
    !["waive", "retry", "exclude", "abort"].includes(mode ?? "") ||
    (needsId && (!targetId || targetId.startsWith("--"))) ||
    (canonicalFlag && mode !== "retry") ||
    !reason.trim() ||
    args.length !== expectedLen
  ) {
    out({
      ok: false,
      code: "E_USAGE",
      message:
        'usage: node commit-degrade.mjs <app_name> waive|retry|exclude <graphic_id> --reason "<理由>" [retry のみ --canonical 可] | abort --reason "<理由>" (reason は必須 — 無言の degrade は禁止)',
    });
  }

  // 復旧コマンドが復旧対象の assert に弾かれないよう、不整合系 (stale / 対象 0 件) と
  // 21e 未完了 (同一 run で先行 retry が step21e_completed_at をクリアした後の後続 degrade —
  // 順序依存で記録が落ちるのを防ぐ) は通す (21e commit-degrade の allowAllExcluded と同型)。
  // retry --canonical のみ 21f 完了済みでも通す — 反悔は 21f 完了後 (成果物確認後) に起きるのが自然なため
  const pre = assertPreflight(appName, {
    allowStale: true,
    allowNoTargets: true,
    allow21eIncomplete: true,
    ...(mode === "retry" && canonicalFlag ? { allowCompleted: true } : {}),
  });
  if (pre.error) out(pre.error);
  const { appRoot, state, graphics, promptsFile, entries, pendingSlots, doneSlots, excludedIds, generatedById, digests } = pre;

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
    graphicsState.decided_by = "step21f";
    writeState();
    out({
      ok: true,
      decision: "skip",
      decided_by: "step21f",
      warnings: [
        "生成済み raw / 正典化済み分は残置される — 本ブロックの有効判定の SoT は decision (設計 §9-2b)。再入は設計 §5 の手動リセット運用のみ",
      ],
      next: "21g を skip し Step 15 (2nd Confluence save) → Step 22 へ素通し",
    });
  }

  // ── id 系 mode の共通 assert ──
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
  const pendingSlot = pendingSlots.find((s) => s.entry.graphic_id === targetId) ?? null;
  const doneSlot = doneSlots.find((s) => s.entry.graphic_id === targetId) ?? null;

  if (mode === "retry") {
    // guard: 正典化済み (= 検証 pass or waived 済み) の健康な slot への素の retry を受けない —
    // 誤った graphic_id 指定で entry が消えると次の 21e run が正常品を再課金で作り直し、
    // 旧正典が state 非参照の残骸になる。意図的な再生成 (waive 反悔等) は --canonical で明示する
    // (21g 差し戻し routing [設計 §9-2b、F-7] 実装までの暫定の正規経路)
    if (doneSlot && !canonicalFlag) {
      out({
        ok: false,
        code: "E_ALREADY_CANONICAL",
        message: `graphic_id '${targetId}' は正典化済み (検証 pass or waived 済み) — 素の retry は後処理失敗 slot 専用。意図的に再生成する場合は --canonical を付けて再実行する (正典ファイルも削除して 21e からやり直す — 有料。21g [F-7] 実装後は差し戻し routing が正規経路)`,
      });
    }
    if (canonicalFlag && !doneSlot) {
      out({
        ok: false,
        code: "E_SLOT_NOT_CANONICAL",
        message: `graphic_id '${targetId}' は正典化されていない — --canonical は正典化済み slot の再生成専用。通常の retry を使う`,
      });
    }
    // guard: 生成記録が無い slot (retry 済み / 未生成) への再 retry は no-op — 記録せず案内のみ (P4-07)
    if (!generatedById.has(targetId)) {
      out({
        ok: false,
        code: "E_SLOT_NOT_GENERATED",
        message: `graphic_id '${targetId}' に生成記録が無い (retry 済み or 21e 未生成) — 追加の記録は不要。Step 21e (generate-graphics.mjs) の再実行で生成される`,
      });
    }
    // entry 削除 = 再生成の記録 (設計 §9-2b)。waiver も除去 — 残すとリトライ後に再 fail した場合
    // waiver が自動適用されて user のリトライ意図 (透過が欲しい) に反する
    graphicsState.generated_files = (Array.isArray(graphicsState.generated_files) ? graphicsState.generated_files : []).filter(
      (g) => g?.graphic_id !== targetId
    );
    if (Array.isArray(graphicsState.transparency_waived)) {
      graphicsState.transparency_waived = graphicsState.transparency_waived.filter((w) => w?.graphic_id !== targetId);
      if (graphicsState.transparency_waived.length === 0) delete graphicsState.transparency_waived;
    }
    delete graphicsState.step21e_completed_at;
    if (canonicalFlag) {
      // 正典ファイルを削除し 21f もやり直す — 旧正典を残すと state 非参照の残骸になり、
      // 21f 完了記録を残すと再生成後の 21f 再通過が resume cascade で飛ばされる
      for (const ext of ["png", "webp"]) {
        const cp = path.join(appRoot, canonicalPath(targetId, ext));
        if (fs.existsSync(cp)) fs.rmSync(cp);
      }
      delete graphicsState.step21f_completed_at;
    }
    writeState();
    out({
      ok: true,
      retried: targetId,
      reason: reason.trim(),
      ...(canonicalFlag ? { canonical_removed: true } : {}),
      next: "Step 21e (generate-graphics.mjs) を再実行する (pending 差集合により当該 slot のみ再生成 — 有料。完了後に 21f が再検証する)",
    });
  }

  if (mode === "waive") {
    if (!isTransparent(entry)) {
      out({
        ok: false,
        code: "E_NOT_TRANSPARENT_SLOT",
        message: `graphic_id '${targetId}' は透過指定 (transparent_background=true) の slot ではない — waive は透過検証 fail の受諾専用`,
      });
    }
    if (doneSlot) {
      out({
        ok: false,
        code: "E_ALREADY_CANONICAL",
        message: `graphic_id '${targetId}' は正典化済み (検証 pass or waived 済み) — 追加の記録は不要`,
      });
    }
    if (!pendingSlot) {
      out({
        ok: false,
        code: "E_SLOT_NOT_PENDING",
        message: `graphic_id '${targetId}' に fresh な生成記録が無い (21e 未生成 or stale) — waive の対象外。先に 21e を完了させる`,
      });
    }
    const digest = digests.get(targetId);
    // 現時点で本当に fail しているかを再確認 — pass する画像への waiver は不要な恒久ラベルになる。
    // raw バイトはここで読み、受諾対象の指紋 (raw_sha256) として記録に束縛する (waiver は
    // 「このバイトの不透明画像を受諾した」の記録 — 別バイトの再生成に自動適用させない)
    let rawBytes;
    let verdict;
    try {
      rawBytes = fs.readFileSync(path.join(appRoot, pendingSlot.generated.file));
      verdict = verifyTransparency(decodePng(rawBytes, entry.size_px));
    } catch (e) {
      out({
        ok: false,
        code: "E_RAW_UNREADABLE",
        message: `raw の読み込み/decode に失敗 (${String(e?.message ?? e).slice(0, 200)}) — waive でなく retry (再生成) か exclude を選ぶ`,
      });
    }
    const rawSha = sha256Of(rawBytes);
    if (findWaiver(graphicsState, targetId, digest, rawSha)) {
      out({ ok: false, code: "E_ALREADY_WAIVED", message: `graphic_id '${targetId}' は受諾記録済み — 再記録しない (P4-07)。postprocess を再実行する` });
    }
    if (verdict.pass) {
      out({
        ok: false,
        code: "E_WAIVER_NOT_NEEDED",
        message: `graphic_id '${targetId}' の透過検証は pass する — waive 不要。postprocess を再実行する`,
      });
    }
    // 同 slot の旧記録 (別バイトへの受諾 — 再生成で死んだ台帳) は置換する (1 slot 1 記録)
    graphicsState.transparency_waived = [
      ...(Array.isArray(graphicsState.transparency_waived) ? graphicsState.transparency_waived : []).filter(
        (w) => w?.graphic_id !== targetId
      ),
      { graphic_id: targetId, source_digest: digest, raw_sha256: rawSha, reason: reason.trim(), waived_at: isoNow() },
    ];
    writeState();
    out({
      ok: true,
      waived: targetId,
      reason: reason.trim(),
      warnings: [
        "不透明のまま正典化される — 21g は重ね置き前提の配置 (背景に他要素が透ける想定) を避け、台帳 (postprocess-manifest.json) の transparency: 'waived' を埋め込み判断の材料にする",
      ],
      next: "Step 2 (postprocess-graphics.mjs) を再実行する (当該 slot はラベル付きで正典化される)",
    });
  }

  // ── exclude ──
  if (doneSlot) {
    out({
      ok: false,
      code: "E_ALREADY_CANONICAL",
      message: `graphic_id '${targetId}' は正典化済み — 21f の除外は後処理失敗 slot の degrade 記録。正典化後の取り下げは 21g の却下手順 (設計 §11、F-7) による`,
    });
  }
  graphicsState.excluded_slots = [
    ...(Array.isArray(graphicsState.excluded_slots) ? graphicsState.excluded_slots : []),
    { graphic_id: targetId, reason: reason.trim(), excluded_at: isoNow() },
  ];
  // 旧 run の残骸があれば正典から掃除する (除外 slot の正典ファイルを残さない)
  for (const ext of ["png", "webp"]) {
    const p = path.join(appRoot, canonicalPath(targetId, ext));
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  const after = computeTargets(entries, promptsFile.tool, graphicsState, appRoot);
  const allExcluded = entries.every((e) => after.excludedIds.has(e.graphic_id));
  if (allExcluded) {
    graphicsState.decision = "skip";
    graphicsState.decided_by = "step21f";
    writeState();
    out({
      ok: true,
      excluded: targetId,
      decision: "skip",
      decided_by: "step21f",
      warnings: ["全 slot が excluded になったためブロック中止と同義として記録 (設計 §8-4 と同型 — 埋め込み対象 0 件の空 21g ゲートを回さない)"],
      next: "21g を skip し Step 15 (2nd Confluence save) → Step 22 へ素通し",
    });
  }
  // 完了記録は 21e 完了済みのときのみ (先行 retry で step21e_completed_at がクリアされた run では
  // 21e→21f の正規順で再通過させる — 21f だけ完了済みの矛盾 state を作らない)
  if (after.pendingSlots.length === 0 && after.staleIds.length === 0 && graphicsState.step21e_completed_at) {
    graphicsState.step21f_completed_at = isoNow();
    writeState();
    out({
      ok: true,
      excluded: targetId,
      step21f_completed_at: graphicsState.step21f_completed_at,
      remaining: { canonical: after.doneSlots.map((s) => s.entry.graphic_id), excluded: [...after.excludedIds] },
      next: "残 slot は全て正典化済み — Step 21g (graphic-embed-review) へ",
    });
  }
  writeState();
  // 次アクションは残 slot の状態で分岐する — stale が「21e 完了済みのまま」残っている場合に
  // 21e 再実行を案内すると E_ALREADY_COMPLETED で弾かれる死路になる (stale の正規復旧は
  // retry [entry 削除 → step21e クリア → 21e 再生成] 側)
  const next = !graphicsState.step21e_completed_at
    ? "生成待ちの slot が残っている (先行 retry 分) — Step 21e (generate-graphics.mjs) から再実行する"
    : after.staleIds.length > 0
      ? `fresh な生成記録の無い slot が残る (${after.staleIds.join(", ")}) — 21e は完了済みのため再実行では直らない。当該 slot を retry (entry 削除で 21e からやり直し — 有料) するか、設計 §5 の手動リセット運用を確認する`
      : "pending が残っている — Step 2 (postprocess-graphics.mjs) を再実行する";
  out({
    ok: true,
    excluded: targetId,
    remaining: {
      pending: after.pendingSlots.map((s) => s.entry.graphic_id),
      canonical: after.doneSlots.map((s) => s.entry.graphic_id),
      excluded: [...after.excludedIds],
      ...(after.staleIds.length ? { stale: after.staleIds } : {}),
    },
    next,
  });
} catch (e) {
  console.error(`commit-degrade.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
