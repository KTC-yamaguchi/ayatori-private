#!/usr/bin/env node
// Step 21g (graphic-embed-review) の承認 / 却下 commit — 検証 + screens/*.md「使用グラフィック」節 +
// pipeline-state.json 書き込み。POCTEAMA-190 (F-7 埋め込み + 承認)
//
// usage:
//   node commit-approval.mjs <app_name> approve             # 人間ゲート承認確定
//   node commit-approval.mjs <app_name> approve --dry-run   # 検証のみ・書き込みゼロ (確定確認前の事前検証)
//   node commit-approval.mjs <app_name> reject --stdin      # per-slot 却下 (生成後の slot 取り下げ — 設計 §11、F-7 で採用)
//   node commit-approval.mjs <app_name> reject --stdin --dry-run
//   node commit-approval.mjs <app_name> specs [--screens a,b]
//     # Step 29 (delta) 用 — spec MD 再生成で消えた「使用グラフィック」節を state から決定的に
//     # 再 append する (承認済み前提。由来の承認日は approvals.step21g_approved_at を引用し、
//     # approvals は書き換えない)
//
// stdin 契約 (reject):
//   { "rejects": [ { "graphic_id": "...", "reason": "..." } ] }   # reason 必須 (無言の取り下げ禁止 — P4)
//
// 書き込み (approve、設計 §7 / §9-2):
//   - screens/{screen}.md: 「使用グラフィック」節 (graphic_id / 配置 / alt / 由来 = AI 生成 + 承認日) を
//     ayatori:graphics-used マーカー間に append/replace (冪等 — 再承認・Step 29 の再 append と同型)。
//     2nd Confluence save (Step 15) がこれを拾う。置換前に _backup/ へ self-backup。
//   - pipeline-state.json: approvals.graphics_human_approved = true (canonical フラグ — cascade /
//     Step 15・22 入口 assert はこれのみ読む) + approvals.step21g_approved_at (補助 timestamp)。
//     書き込み後に再 Read して write-back 検証する (Step 13 先例)。
// 書き込み (reject、設計 §11 の 2 点定義):
//   - (a) 当該 graphics.generated_files[] entry を削除 + excluded_slots[] に {graphic_id, reason, excluded_at}
//     を append (reason に「21g 却下:」prefix — excluded_by field が無い schema 上の由来識別)。
//   - (b) 正典 screens/_shared/graphics/ のファイルは**削除しない** (孤児として保持 — 21g は正典
//     ディレクトリへの書き込み権限を持たない。復活は設計 §5 の手動リセット運用)。
//   - 埋め込み済み <img> タグは全埋め込み先から除去 (self-backup 先行)。
//   - 却下の結果、埋め込み対象が 0 件になったら decision = "skip", decided_by = "step21g" を記録
//     (21e の全 slot excluded 規則と同型 — 空の 21g ゲートを回さない)。
// 検証 NG は一切書き込まない。exit code は常に 0 (routing は JSON の code)。

import fs from "node:fs";
import path from "node:path";
import {
  assertPreflight,
  atomicWriteFileSync,
  backupFile,
  computeEmbedTargets,
  findEmbeddedTags,
  isoNow,
  repoRoot,
  resolveMainScreens,
  verifyEmbeds,
} from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

const MARK_START = "<!-- ayatori:graphics-used:start -->";
const MARK_END = "<!-- ayatori:graphics-used:end -->";

/** 「使用グラフィック」節の組み立て (設計 §7: graphic_id / 位置 / alt / 由来 = AI 生成 + 承認日)。 */
export function buildGraphicsSection(rows, approvedAt) {
  const body = rows.map((r) => `| ${r.graphic_id} | ${r.placement.replace(/\|/g, "／")} | ${r.graphic_id} | AI 生成 (POCTEAMA-179) — 21g 承認 ${approvedAt} |`).join("\n");
  return `${MARK_START}
## 使用グラフィック

| graphic_id | 配置 | alt | 由来 |
|---|---|---|---|
${body}
${MARK_END}`;
}

try {
  const args = process.argv.slice(2);
  const [appName, mode] = args;
  const KNOWN_FLAGS = ["--stdin", "--dry-run", "--screens"];
  const flagArgs = args.slice(2);
  const unknownArgs = [];
  let screensFilter = null;
  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i];
    if (a === "--screens" && typeof flagArgs[i + 1] === "string" && !flagArgs[i + 1].startsWith("--")) {
      screensFilter = new Set(flagArgs[i + 1].split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (!KNOWN_FLAGS.includes(a) || a === "--screens") {
      unknownArgs.push(a);
    }
  }
  const dryRun = args.includes("--dry-run");
  if (
    !appName ||
    !["approve", "reject", "specs"].includes(mode ?? "") ||
    unknownArgs.length > 0 ||
    (mode === "reject" && !args.includes("--stdin")) ||   // pipe なし起動の stdin 待ち hang 防止
    (mode === "approve" && args.includes("--stdin")) ||   // approve に stdin は無い — flag 誤用も fail-closed
    (mode !== "specs" && screensFilter) ||                // --screens は specs (Step 29) 専用
    (mode === "specs" && (args.includes("--stdin") || dryRun)) // specs は state から決定的 — flag 誤用も fail-closed
  ) {
    out({
      ok: false,
      code: "E_USAGE",
      ...(unknownArgs.length ? { unknown_args: unknownArgs } : {}),
      message: `usage: node commit-approval.mjs <app_name> approve [--dry-run] | reject --stdin [--dry-run] | specs [--screens a,b]${unknownArgs.length ? ` — 未知の引数 ${JSON.stringify(unknownArgs)} (typo なら直して再実行。何も書き込んでいない)` : ""}`,
    });
  }

  // ── 前提の再 assert (gather 後の対話中に state が変わっていないかの防御。gather と同一 code)。
  //    specs (Step 29) は承認済みが前提のため delta mode で assert する ──
  const pre = assertPreflight(appName, { delta: mode === "specs" });
  if (pre.error) out(pre.error);
  const { appRoot, graphics, targetEntries, slotMeta } = pre;
  const statePath = path.join(appRoot, "pipeline-state.json");
  const state = pre.state;

  // pipeline-state merge write の共通部 — preflight で読み込み済みの state をベースに merge する
  // (disk 再読込 + stub fallback は読込失敗時に全 state を潰す破壊経路 — 21c/21d commit と同判断)
  const writeState = (patch) => {
    if (!state.app_name) state.app_name = appName; // 必須 field の保全 assert
    if (!state.schema_version) state.schema_version = "2026-05-22"; // 欠落 = legacy の書き込み時補完
    if (patch.graphics) {
      state.screens ??= {};
      state.screens.graphics = patch.graphics;
    }
    if (patch.approvals) {
      state.approvals = { ...(state.approvals ?? {}), ...patch.approvals };
    }
    atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); // tmp+rename で truncate 耐性 (21a-21f と同一契約)
  };

  const { files: mainFiles } = resolveMainScreens(appRoot);
  // specs (Step 29) は --screens の対象画面のみ検査する — 範囲外の drift (E_TARGET_FILES_MISSING 等)
  // で無関係画面の delta を block しない (Step 29 の「無関係画面に触れない」契約)。
  // reject は E_TARGET_FILES_MISSING 状態からの復旧経路のため allowLost で通す (円環防止)
  const computed = computeEmbedTargets(appRoot, targetEntries, slotMeta, mainFiles, mode === "specs" ? screensFilter : null, {
    allowLost: mode === "reject",
  });
  if (computed.error) out(computed.error);
  const { targets } = computed;

  // ── specs (Step 29 delta 用): 「使用グラフィック」節の決定的再 append (approvals は書かない) ──
  if (mode === "specs") {
    // 埋め込み完全性を先に機械検査する — Step 4a の順序 (apply → specs) が守られず <img> が
    // 未着地のまま節だけ書くと、仕様書が「HTML に無い絵」を主張する (approve と同じ gate)
    const specVerify = verifyEmbeds(appRoot, targets, mainFiles, screensFilter);
    if (!specVerify.complete) {
      out({
        ok: false,
        code: "E_EMBED_INCOMPLETE",
        missing: specVerify.missing,
        duplicates: specVerify.duplicates,
        violations: specVerify.violations,
        orphans: specVerify.orphans,
        message: "埋め込みが不完全なまま specs は書けない — Step 29 Step 4a の 2 (apply) を完了させてから再実行する (何も書き込んでいない)",
      });
    }
    const specResidues = specVerify.placeholder_residues ?? [];
    const approvedAt = state?.approvals?.step21g_approved_at ?? "(承認日不明 — step21g_approved_at 未記録)";
    const backedUp = [];
    const specUpdated = [];
    const specMissing = [];
    const bySpecScreen = new Map();
    for (const g of targetEntries) {
      for (const s of slotMeta.get(g.graphic_id) ?? []) {
        if (screensFilter && !screensFilter.has(s.screen)) continue;
        (bySpecScreen.get(s.screen) ?? bySpecScreen.set(s.screen, []).get(s.screen)).push({ graphic_id: g.graphic_id, placement: s.placement });
      }
    }
    for (const [screen, rows] of bySpecScreen) {
      const abs = path.join(appRoot, "screens", `${screen}.md`);
      if (!fs.existsSync(abs)) {
        specMissing.push(`screens/${screen}.md`);
        continue;
      }
      let md = fs.readFileSync(abs, "utf8");
      const section = buildGraphicsSection(rows, approvedAt);
      const re = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`);
      // replacement は function で渡す — placement 由来の $$ / $& が GetSubstitution 展開されるのを防ぐ
      md = re.test(md) ? md.replace(re, () => section) : md.replace(/\s*$/, () => `\n\n${section}\n`);
      const dest = backupFile(appRoot, abs);
      if (dest) backedUp.push(path.relative(repoRoot, dest));
      fs.writeFileSync(abs, md);
      specUpdated.push(`screens/${screen}.md`);
    }
    out({
      ok: true,
      spec_updated: specUpdated,
      ...(specMissing.length ? { spec_missing: specMissing } : {}),
      ...(backedUp.length ? { backed_up: backedUp } : {}),
      ...(specResidues.length
        ? { warnings: [`placeholder 残置: ${specResidues.map((r) => `(${r.graphic_id}, ${r.file})`).join(", ")} — 再生成 HTML に illust-placeholder が復活している。置き換え指定の slot は Edit 除去 (21g SKILL Step 2-4) を確認する`] }
        : {}),
      next: "Step 29 の後続 (sub-state regen / mini design review) へ — approvals は変更していない",
    });
  }

  // ── reject: per-slot 却下 (設計 §11 — F-7 で採用確定) ──
  if (mode === "reject") {
    const raw = fs.readFileSync(0, "utf8");
    let draft;
    try {
      draft = JSON.parse(raw);
    } catch {
      out({ ok: false, code: "E_BAD_INPUT", message: "stdin が JSON として parse できません" });
    }
    const rejects = draft?.rejects;
    if (typeof draft !== "object" || draft === null || Array.isArray(draft) || !Array.isArray(rejects) || rejects.length === 0) {
      out({ ok: false, code: "E_BAD_INPUT", message: "stdin は { rejects: [{graphic_id, reason}] } (1 件以上) の JSON object が必須" });
    }
    const errors = [];
    const extraTop = Object.keys(draft).filter((k) => k !== "rejects");
    if (extraTop.length) errors.push(`stdin に想定外の top-level key ${JSON.stringify(extraTop)} (許容: rejects)`);
    const seen = new Set();
    rejects.forEach((r, i) => {
      const at = `rejects[${i}]`;
      if (typeof r !== "object" || r === null || Array.isArray(r)) {
        errors.push(`${at}: entry は {graphic_id, reason} の object が必須`);
        return;
      }
      const extra = Object.keys(r).filter((k) => !["graphic_id", "reason"].includes(k));
      if (extra.length) errors.push(`${at}: 想定外の field ${JSON.stringify(extra)}`);
      if (typeof r.graphic_id !== "string" || !targets.has(r.graphic_id)) {
        errors.push(`${at}: graphic_id '${r.graphic_id}' が埋め込み対象集合に無い (対象: ${[...targets.keys()].join(", ")})`);
        return;
      }
      if (seen.has(r.graphic_id)) errors.push(`${at}: graphic_id '${r.graphic_id}' が重複`);
      seen.add(r.graphic_id);
      if (typeof r.reason !== "string" || !r.reason.trim()) {
        errors.push(`${at}: reason (却下理由) が欠落 — 無言の取り下げは禁止 (Operating Principle 4)`);
      }
    });
    if (errors.length) out({ ok: false, code: "E_VALIDATION", errors });

    const rejectIds = new Set(rejects.map((r) => r.graphic_id));
    const remaining = targetEntries.filter((g) => !rejectIds.has(g.graphic_id));
    const allRejected = remaining.length === 0;

    if (dryRun) {
      out({
        ok: true,
        dry_run: true,
        reject_count: rejects.length,
        remaining_targets: remaining.map((g) => g.graphic_id),
        ...(allRejected ? { note: "全対象 slot の却下 — 確定するとブロック中止 (decision=skip, decided_by=step21g) と同義になる" } : {}),
        next: "検証 OK (何も書き込んでいない) — 確認を経て --dry-run なしで再実行する",
      });
    }

    // 埋め込み済みタグの除去 (self-backup 先行)
    const cleaned = [];
    const backedUp = [];
    for (const id of rejectIds) {
      for (const rel of targets.get(id).files) {
        const abs = path.join(appRoot, rel);
        let html = fs.readFileSync(abs, "utf8");
        const tags = findEmbeddedTags(html, id);
        if (!tags.length) continue;
        const dest = backupFile(appRoot, abs);
        if (dest) backedUp.push(path.relative(repoRoot, dest));
        for (const { tag } of tags) html = html.replace(tag + "\n", "").replace(tag, "");
        fs.writeFileSync(abs, html);
        cleaned.push(rel);
      }
    }

    // placeholder 置き換え型 slot の却下は、embed 時に placeholder が Edit 除去済みのため
    // タグ除去後に「イラストも placeholder も無い」空白領域を作る — guide §6 の復帰手順
    // (Edit で _backup から戻す) へ誘導する warning を出す (placement 記述の文字列 match は
    // heuristic のため warning 止まり — fail はしない)
    const placeholderRejects = [...rejectIds].filter((id) =>
      (slotMeta.get(id) ?? []).some((s) => /placeholder/i.test(s?.placement ?? ""))
    );
    const rejectWarnings = placeholderRejects.length
      ? [
          `placeholder 置き換え型 slot の却下: ${placeholderRejects.join(", ")} — 当該領域はイラストも placeholder も無い状態になる。_backup/ の apply 前スナップショットから旧 placeholder ブロックを Edit で戻す (guide §6)`,
        ]
      : [];

    const excludedAt = isoNow();
    const nextGraphics = {
      ...graphics,
      generated_files: (Array.isArray(graphics.generated_files) ? graphics.generated_files : []).filter((g) => !rejectIds.has(g?.graphic_id)),
      excluded_slots: [
        ...(Array.isArray(graphics.excluded_slots) ? graphics.excluded_slots : []),
        ...rejects.map((r) => ({ graphic_id: r.graphic_id, reason: `21g 却下: ${r.reason.trim()}`, excluded_at: excludedAt })),
      ],
    };
    if (allRejected) {
      nextGraphics.decision = "skip";
      nextGraphics.decided_by = "step21g";
      if (!(Array.isArray(graphics.rework_pending) && graphics.rework_pending.length)) delete nextGraphics.rework_pending;
    }
    writeState({ graphics: nextGraphics });

    out({
      ok: true,
      rejected: [...rejectIds],
      cleaned_files: [...new Set(cleaned)],
      remaining_targets: remaining.map((g) => g.graphic_id),
      orphan_canonicals: rejects.map((r) => `screens/_shared/graphics/ の ${r.graphic_id}.* は保持 (孤児 — 削除しない)`),
      ...(backedUp.length ? { backed_up: backedUp } : {}),
      ...((() => {
        const w = [
          ...rejectWarnings,
          ...(allRejected && Array.isArray(graphics.rework_pending) && graphics.rework_pending.length
            ? [`rework_pending ${graphics.rework_pending.length} 件が残ったまま全 slot 却下 — 差し戻し指示は破棄扱いになる (decision=skip で 21d-21g は走らない)`]
            : []),
        ];
        return w.length ? { warnings: w } : {};
      })()),
      ...(allRejected
        ? { decision: "skip", decided_by: "step21g", next: "全対象 slot を却下 — ブロック中止。Step 15 (2nd Confluence save) へ素通し" }
        : { next: "残りの対象 slot で 21g を続行 (視覚レポートを再生成して再提示)" }),
    });
  }

  // ── approve: 埋め込み完全性 + rework 未消化の検査 → MD 追記 + state 書き込み ──
  // (埋め込み先の部分/全欠落は computeEmbedTargets の E_TARGET_FILES_MISSING が fail-closed 済み)
  const reworkPending = Array.isArray(graphics.rework_pending) ? graphics.rework_pending : [];
  if (reworkPending.length) {
    out({
      ok: false,
      code: "E_REWORK_OPEN",
      rework_pending: reworkPending.map((r) => r?.graphic_id),
      message: "rework_pending が未消費のまま承認できない — プロンプト起因差し戻しは 21d の再確定 → 21e/21f 再生成 → 21g 再提示が先 (設計 §9-2b)",
    });
  }
  const verify = verifyEmbeds(appRoot, targets, mainFiles);
  if (!verify.complete) {
    out({
      ok: false,
      code: "E_EMBED_INCOMPLETE",
      missing: verify.missing,
      duplicates: verify.duplicates,
      violations: verify.violations,
      orphans: verify.orphans,
      message: "埋め込みが不完全なまま承認できない — embed-graphics.mjs apply で全対象を埋め込み、C-26 違反 / 孤児タグを解消してから再実行する (何も書き込んでいない)",
    });
  }

  const residueWarnings = (verify.placeholder_residues ?? []).length
    ? [
        `placeholder 残置: ${verify.placeholder_residues.map((r) => `(${r.graphic_id}, ${r.file})`).join(", ")} — <img> と illust-placeholder が同時表示されている。置き換え指定の slot なら Edit 除去 (SKILL Step 2-4) を済ませてから承認する`,
      ]
    : [];

  // 「使用グラフィック」節の対象画面 (spec 不在は gather が warning 済み — 当該画面のみ skip)
  const specTargets = new Map(); // screen → rows
  for (const g of targetEntries) {
    for (const s of slotMeta.get(g.graphic_id) ?? []) {
      if (!fs.existsSync(path.join(appRoot, "screens", `${s.screen}.md`))) continue;
      (specTargets.get(s.screen) ?? specTargets.set(s.screen, []).get(s.screen)).push({ graphic_id: g.graphic_id, placement: s.placement });
    }
  }

  if (dryRun) {
    out({
      ok: true,
      dry_run: true,
      target_count: targets.size,
      spec_files: [...specTargets.keys()].map((s) => `screens/${s}.md`),
      ...(residueWarnings.length ? { warnings: residueWarnings } : {}),
      next: "検証 OK (何も書き込んでいない) — 確定確認を経て --dry-run なしで再実行する",
    });
  }

  const approvedAt = isoNow();
  const backedUp = [];
  const specUpdated = [];
  for (const [screen, rows] of specTargets) {
    const abs = path.join(appRoot, "screens", `${screen}.md`);
    let md = fs.readFileSync(abs, "utf8");
    const section = buildGraphicsSection(rows, approvedAt);
    const re = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`);
    // replacement は function で渡す — placement 由来の $$ / $& が GetSubstitution 展開されるのを防ぐ
    md = re.test(md) ? md.replace(re, () => section) : md.replace(/\s*$/, () => `\n\n${section}\n`);
    const dest = backupFile(appRoot, abs);
    if (dest) backedUp.push(path.relative(repoRoot, dest));
    fs.writeFileSync(abs, md);
    specUpdated.push(`screens/${screen}.md`);
  }

  writeState({ approvals: { graphics_human_approved: true, step21g_approved_at: approvedAt } });

  // write-back 検証 (Step 13 先例 — silent progression の禁止)
  let verified = null;
  try {
    verified = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    verified = null;
  }
  if (verified?.approvals?.graphics_human_approved !== true) {
    out({
      ok: false,
      code: "E_WRITE_VERIFY",
      message: "承認フラグの write-back 検証に失敗 — pipeline-state.json を確認して再実行する (MD 追記は完了済み・冪等のため再実行可)",
    });
  }

  out({
    ok: true,
    graphics_human_approved: true,
    step21g_approved_at: approvedAt,
    target_count: targets.size,
    spec_updated: specUpdated,
    ...(backedUp.length ? { backed_up: backedUp } : {}),
    ...(residueWarnings.length ? { warnings: residueWarnings } : {}),
    next: "Step 15 (2nd Confluence save — 使用グラフィック節を含む仕様書を保存) → Step 22 (Figma export) へ",
  });
} catch (e) {
  console.error(`commit-approval.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
