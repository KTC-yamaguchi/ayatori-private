#!/usr/bin/env node
// scripts/pipeline-status.mjs
//
// /ayatori-status の Phase 判定を決定論化する READ-ONLY スクリプト。
// phases/status/SKILL.md の擬似コード判定 (従来 LLM が毎回解釈実行) を Node 実装に落とし、
// 誤判定 (日向レビュー A-3: retro 完了の恒久 not_started / A-4: delta 系 resume 検出の不在)
// を解消する。artifacts/ をスキャンし、プロジェクト × Phase (0b/1a/1b/1c/1d/2/3[main/
// sub-state]/4/5/6) の status テーブル JSON + 推奨アクションを stdout に出力する。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 書き込みは一切しない (writeFileSync 不使用)。
//
// 使い方:
//   node scripts/pipeline-status.mjs                 # artifacts/ 全プロジェクト、JSON 出力
//   node scripts/pipeline-status.mjs kinto-unlimited # 指定プロジェクトのみ
//   node scripts/pipeline-status.mjs --markdown      # 人間向け Markdown テーブル出力
// exit: 0 = 成功 / 2 = artifacts ディレクトリ不在 / 3 = 指定プロジェクト不在
//
// 判定仕様の SoT:
//   - Phase 0b/1a/1b/2/3/4/6 … phases/status/SKILL.md Step 2 (本スクリプトは決定論移植 + 修正)
//   - Phase 1c/1d/5 (delta 系) … schemas/pipeline-state.schema.json の runs[] 契約 (A-4 新規)
//   - Phase 4 … approvals.retro_completed_at (key があれば読む。恒久対応は別チケット) +
//     artifacts/pipeline-improvements.md の「対象アプリ」行 fallback (A-3 修正)
//   - Figma stub … figma-state.json 不在 = FIGMA_MCP_ENABLED=false 稼働 → "skipped (stub)"

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

// ── fail-soft ヘルパ (scripts/build-artifact-index.mjs と同パターン) ──────────
const isDir = (p) => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};
const isFile = (p) => {
  try { return statSync(p).isFile(); } catch { return false; }
};
const readText = (p) => {
  try { return readFileSync(p, "utf8"); } catch { return null; }
};
const readJson = (p) => {
  const t = readText(p);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
};
const listDir = (p) => {
  try { return readdirSync(p); } catch { return []; }
};

// ── pipeline.yaml ループ閾値 (regex 抽出、失敗時は既定値に fallback) ──────────
export const DEFAULT_THRESHOLDS = {
  req_pass_total: 80,   // requirements.loop.pass_condition "total >= 80"
  req_per_axis_min: 12, // requirements.loop.per_axis_min
  req_max_attempts: 3,  // requirements.loop.max_attempts
  design_max_attempts: 3, // screens.loop (control_step: 20-loop-design) max_attempts
};
export const readThresholds = (repoRoot) => {
  const t = { ...DEFAULT_THRESHOLDS };
  const yaml = readText(join(repoRoot, "pipeline.yaml"));
  if (!yaml) return t;
  let m = yaml.match(/per_axis_min:\s*(\d+)/);
  if (m) t.req_per_axis_min = Number(m[1]);
  m = yaml.match(/pass_condition:\s*"[^"]*total\s*>=\s*(\d+)/);
  if (m) t.req_pass_total = Number(m[1]);
  // requirements loop の max_attempts は per_axis_min 直後に宣言されている
  m = yaml.match(/per_axis_min:\s*\d+\s*\n\s*max_attempts:\s*(\d+)/);
  if (m) t.req_max_attempts = Number(m[1]);
  m = yaml.match(/control_step:\s*20-loop-design[\s\S]*?max_attempts:\s*(\d+)/);
  if (m) t.design_max_attempts = Number(m[1]);
  return t;
};

// ── ステータス定数 ────────────────────────────────────────────
export const STATUS = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  WAITING_APPROVAL: "waiting_approval",
  COMPLETE: "complete",
  SKIPPED: "skipped", // reverse flow による 1a/1b skip / sub-state の user skip
};
const ICONS = {
  [STATUS.NOT_STARTED]: "⬜",
  [STATUS.IN_PROGRESS]: "🔄",
  [STATUS.WAITING_APPROVAL]: "⏳",
  [STATUS.COMPLETE]: "✅",
  [STATUS.SKIPPED]: "⏭️",
};

// row ファクトリ。optional = not_started のとき next-action 推奨から外す任意 phase (sub-state 等)。
// in_progress / waiting_approval は user が着手済み (25a proceed 選択済み) なので推奨対象に含める。
const row = (phase, label, command, status, detail = null, extra = {}) => ({
  phase,
  label,
  command,
  status,
  icon: ICONS[status] || "",
  detail,
  ...extra,
});

// ── プロジェクト単位のコンテキスト読み込み (すべて fail-soft) ──────────────
export const loadProject = (artifactsRoot, appName) => {
  const root = join(artifactsRoot, appName);
  return {
    appName,
    root,
    requirements: readJson(join(root, "requirements.json")),
    state: readJson(join(root, "pipeline-state.json")) || {},
    scoringHistory: readJson(join(root, "scoring-history.json")),
    wcagMapping: readJson(join(root, "wcag-mapping.json")),
    wcagHistory: readJson(join(root, "wcag-history.json")),
    scores: readJson(join(root, "scores.json")),
    figmaState: readJson(join(root, "figma-state.json")),
    figmaStateExists: isFile(join(root, "figma-state.json")),
    reqDeltaManifest: readJson(join(root, "req-delta", "change-manifest.json")),
    editedScreens: readJson(join(root, "delta", "edited-screens.json")),
    deviations: readJson(join(root, "requirement-deviations.json")),
    statePatternPlan: readJson(join(root, "screens", "state-pattern-plan.json")),
    hasReverseDir: isDir(join(root, "reverse-engineered")),
    hasRubric: isFile(join(root, "rubric.json")),
    hasRawInput: isFile(join(root, "requirements", "00-raw-input.md")),
    hasDesignBrief: isFile(join(root, "design-brief.yaml")),
    tokens: readJson(join(root, "tokens.json")),
    hasScreenList: isFile(join(root, "screens", "00-screen-list.md")),
    hasDeltaDir: isDir(join(root, "delta")),
    existsRel: (rel) => isFile(join(root, rel)),
    listRel: (rel) => listDir(join(root, rel)),
  };
};

const approvals = (ctx) => ctx.state.approvals || {};
const screensState = (ctx) => ctx.state.screens || {};
const isReverseComplete = (ctx) =>
  ctx.requirements != null && ctx.requirements.status === "REVERSE_ENGINEERED";
// CLAUDE.md § 完走後 Phase 共通 Entry Guard の完走判定 (final_approved OR completed_at_states) 専用。
// NOTE: Phase 1d/5/6 の入場判定には reverse 基線例外 (approvals.baseline_approved_at) があるため、
// 入場可否の判定に本関数を流用しないこと (retro の完走判定と手編集ヒント用)。
const isProjectCompleted = (ctx) => {
  const ap = approvals(ctx);
  return ap.final_approved === true || ap.completed_at_states != null;
};
// screens/{web,web-sm,mobile} の 3 ディレクトリ直下の画面 HTML 枚数。
// screens/** を再帰で数えないのは、screens-lite ルートが正当に生成する
// screens/00-transition-map.html と screens/_shared/components.html を画面 HTML と誤検出しないため
// (この 3 platform 限定という集合は phases/screens/SKILL.md の lite resume 判定と同一)。
const countScreenHtml = (ctx) =>
  ["web", "web-sm", "mobile"].reduce(
    (n, p) => n + ctx.listRel(`screens/${p}`).filter((f) => f.endsWith(".html")).length,
    0,
  );
// reverse 基線 (screens-lite ルート) で完結したプロジェクト = ベースライン承認印だけがあり
// final_approved 系は未 set。画面 HTML を作らない経路なので、Phase 3 の従来 cascade
// (「awaiting 1st Confluence save (15)」等) に流すと未完了と誤表示され、次アクションも
// /ayatori-screens の続行に誘導してしまう (正解は /ayatori-add-feature | /ayatori-delta)。
// 判定式の SoT は CLAUDE.md § 完走後 Phase 共通 Entry Guard (Phase 1d/5/6 限定の基線例外)。
// 由来検査 (isReverseComplete) を AND するのは Entry Guard と同じ理由 — forward プロジェクトに
// 手動 stub で基線印だけを立てても Guard は入場を拒否するので、complete 表示と
// /ayatori-add-feature 推奨を出すと必ず弾かれる先へ誘導することになる。
// 画面 HTML 0 枚を AND するのは、基線印のあと Route B (フル実行) で画面 HTML を作り始めた
// 正当な進行状態を「画面 HTML は未生成」と誤表示し、/ayatori-screens 続行の案内を消さないため。
const isBaselineOnly = (ctx) => {
  const ap = approvals(ctx);
  return ap.baseline_approved_at != null && ap.final_approved !== true && ap.completed_at_states == null
    && isReverseComplete(ctx) && countScreenHtml(ctx) === 0;
};
// baseline_approved_via の由来ラベル (index.html の APPROVAL_LABELS 分岐と同じ流儀 —
// 欠落を信頼側に倒さず「記録なし」と明示する)
const baselineViaLabel = (via) =>
  via === "screens-lite-gate" ? "screens-lite ゲート"
    : via === "manual-stub" ? "手動 stub"
      : "由来記録なし";
// 完成後にパイプライン外で手編集され、まだ screen-edit delta で消費されていない画面数。
// delta/edited-screens.json の consumed_by_run == null が未消費。台帳が無ければ 0。
const countUnconsumedScreenEdits = (ctx) => {
  const entries = ctx.editedScreens?.entries;
  if (!Array.isArray(entries)) return 0;
  return entries.filter((e) => e.consumed_by_run == null).length;
};

// ── Phase 0b: Reverse (Steps 01~06) ──────────────────────────────
export const detectPhase0b = (ctx) => {
  if (!ctx.hasReverseDir && !isReverseComplete(ctx)) return null; // 非 reverse プロジェクトは行ごと非表示
  if (isReverseComplete(ctx)) return row("0b", "Reverse (Steps 01~06)", "/ayatori-reverse", STATUS.COMPLETE);
  // 最後に完了した step の出力ファイルから resume 位置を導出 (phases/reverse/SKILL.md preamble と同順)
  // ground-truth の収集済み判定はソース別: 文書 = root 直下の *.md (index.md 以外。figma/ サブディレクトリの
  // 存在だけでは文書収集済みとみなさない) / figma = figma-manifest.json
  const hasDocArchive = ctx
    .listRel("ground-truth")
    .some((f) => f.endsWith(".md") && f !== "index.md");
  const hasFigmaArchive = ctx.existsRel("ground-truth/figma/figma-manifest.json");
  let detail = "in progress (Step 01~02)";
  if (ctx.existsRel("reverse-engineered/comparison-report.md")) detail = "last completed: Step 04 — resume from Step 05";
  else if (ctx.existsRel("reverse-engineered/08-constraints.md")) detail = "last completed: Step 03 — resume from Step 04";
  else if (ctx.existsRel("reverse-engineered/raw-analysis.md")) detail = "last completed: Step 02 — resume from Step 03";
  else if (hasDocArchive || hasFigmaArchive) {
    const collected = [
      hasDocArchive ? "docs" : null,
      hasFigmaArchive ? "figma" : null,
    ].filter(Boolean).join("+");
    detail = `evidence collected (${collected}) — resume from Step 01/02`;
  }
  return row("0b", "Reverse (Steps 01~06)", "/ayatori-reverse", STATUS.IN_PROGRESS, detail);
};

// 対象限定突合 (Phase 0c) の未解決 (= 保留) 件数。台帳が読めなければ null (呼び出し側が補完する)。
const countUnresolvedVerifyFindings = (ctx) => {
  const entries = ctx.deviations?.entries;
  if (!Array.isArray(entries)) return null;
  return entries.filter((e) => e?.phase === "reverse_verify" && e?.resolved_at == null).length;
};

// ── Phase 0c: Reverse-verify (V1~V3) ─────────────────────────
// 対象限定突合は reverse 完走後に任意・反復で走る補正フェーズ。run 完了 = completed_at set。
// cancelled_at set は中止扱い (resume しない)。未実行プロジェクトは行ごと非表示にする —
// 走っていないことは異常ではないため、未実行を NOT_STARTED として並べると常時 1 行の
// ノイズになり「着手待ち」の意味が薄れる (Phase 1c と同じ扱い)。
export const detectPhase0cVerify = (ctx) => {
  const runs = ctx.state.reverse_verify?.runs || [];
  if (runs.length === 0) return null;
  // optional: 任意・反復の補正フェーズ (走らせなくても本流は進む) を sub-state 行と同じ印で表す。
  // 中断 run が active な間は recommendNextAction がこの行を拾う — sub-state と同じく
  // 「in-flight の作業をまず再開する」意図どおり。放置したくない場合は phase Preamble 6b が
  // 破棄を選ばせるため、行き止まりにはならない。
  const mk = (status, detail, extra) =>
    row("0c", "Reverse-verify (V1~V3)", "/ayatori-reverse-verify", status, detail, { optional: true, ...extra });
  const latest = runs[runs.length - 1];
  const doneCount = runs.filter((r) => r.completed_at != null).length;
  const cancelledCount = runs.filter((r) => r.cancelled_at != null).length;
  if (latest.completed_at == null && latest.cancelled_at == null) {
    // 中断 run → resume 先を導出 (phases/reverse-verify/SKILL.md Preamble step 6 の ladder と同順)。
    // findings_resolved_at は「反映 + 台帳書き戻しまで完了」の印なので、残るのは Completion だけ
    // (V3 へ戻すとスナップショットが訂正後で上書きされ検査の基準線が壊れる)。
    // scope_approved_at 未 set の entry は V1 の範囲ゲートで中断した stub。
    const resumeStep =
      latest.findings_resolved_at != null
        ? "Completion (run 完了の記録のみ)"
        : latest.crosscheck_completed_at != null
          ? "V3-discrepancy-gate"
          : latest.scope_approved_at != null
            ? "V2-targeted-crosscheck"
            : "V1-target-scope (範囲ゲートの再提示)";
    return mk(
      STATUS.IN_PROGRESS,
      `run ${latest.run_id} interrupted — resume at Step ${resumeStep}`,
      { resume_step: resumeStep, run_id: latest.run_id },
    );
  }
  // 中止だけの履歴を complete と呼ばない (成果物は何も変わっていない)
  if (doneCount === 0) {
    return mk(STATUS.SKIPPED, `${cancelledCount} run(s) cancelled — 反映済みの訂正なし`);
  }
  const parts = [`${doneCount} run(s) completed`];
  if (cancelledCount) parts.push(`${cancelledCount} cancelled`);
  // 未解決の保留数は台帳を数える。runs[].findings_deferred の合計は使えない — 未解決 entry は次の run が
  // run_id を付け替えて引き継ぐ設計なので、引き継がれた項目を run の数だけ重複計上する。逆に「最新 run の
  // 数」だけでも足りない (別の対象を突合した run では前 run の保留が再検出されず引き継がれないため
  // 取りこぼす)。台帳の unresolved が唯一正確な現在値。台帳が読めない場合のみ runs[] から補完する。
  // ラベルは "unresolved" — 台帳の未解決には「人間が保留にした」ものと「V3 の判断前に run が中止された」
  // ものが混ざりうるため、"deferred (保留)" と言い切らない。
  // 0 は有効値なので ?? で受ける (|| だと台帳 0 件が fallback に落ちる)。fallback 側は
  // Number(undefined) = NaN になるため有限判定を挟む (NaN をそのまま出力に流さない)。
  const fromLedger = countUnresolvedVerifyFindings(ctx);
  const fromRuns = Number([...runs].reverse().find((r) => r.findings_deferred != null)?.findings_deferred);
  const deferred = fromLedger ?? (Number.isFinite(fromRuns) ? fromRuns : 0);
  if (deferred) parts.push(`${deferred} unresolved finding(s)`);
  return mk(STATUS.COMPLETE, parts.join(", "));
};

// ── Phase 1a: Question (01) ──────────────────────────────────
export const detectPhase1a = (ctx) => {
  if (ctx.hasRawInput) return row("1a", "Question (01)", "/ayatori-question", STATUS.COMPLETE);
  if (isReverseComplete(ctx))
    return row("1a", "Question (01)", "/ayatori-question", STATUS.SKIPPED, "skipped (reverse flow)");
  return row("1a", "Question (01)", "/ayatori-question", STATUS.NOT_STARTED);
};

// ── Phase 1b: Requirements (02~07) ───────────────────────────
export const detectPhase1b = (ctx, thresholds) => {
  const mk = (status, detail) => row("1b", "Requirements (02~07)", "/ayatori-requirements", status, detail);
  const ap = approvals(ctx);
  // Phase 2 成果物が既に存在するなら complete 扱い (SKILL.md override)
  const phase2Started = ctx.hasDesignBrief || (ctx.tokens != null && Object.keys(ctx.tokens).length > 0);
  if (ap.step07_approved_at != null) {
    // reverse 経路の自動押印 (Phase 0b Completion) は Phase 1b を実行していない — SKIPPED 表示の区別を保つ。
    // isReverseComplete も見るのは、自動押印導入前の遺産プロジェクトに手動 stub (via なし) で
    // step07 を立てた場合に COMPLETE 誤表示へ戻さないため。
    if (ap.step07_approved_via === "reverse-review-gate" || isReverseComplete(ctx)) {
      return mk(STATUS.SKIPPED, "skipped (reverse flow, 承認印は Phase 0b が押印)");
    }
    return mk(STATUS.COMPLETE);
  }
  if (!ctx.hasRubric) {
    if (phase2Started) return mk(STATUS.COMPLETE);
    if (isReverseComplete(ctx)) return mk(STATUS.SKIPPED, "skipped (reverse flow)");
    return mk(STATUS.NOT_STARTED);
  }
  if (phase2Started) return mk(STATUS.COMPLETE);
  const attempts = (ctx.scoringHistory && Array.isArray(ctx.scoringHistory.attempts))
    ? ctx.scoringHistory.attempts : [];
  if (attempts.length === 0) return mk(STATUS.NOT_STARTED);
  const current = attempts[attempts.length - 1];
  const total = current.total ?? 0;
  const axisScores = current.scores || {};
  const axisGaps = Object.entries(axisScores)
    .filter(([, v]) => typeof v === "number" && v < thresholds.req_per_axis_min)
    .map(([k]) => k);
  const pass = total >= thresholds.req_pass_total && axisGaps.length === 0;
  if (!pass) {
    const gapNote = axisGaps.length ? `, axis gap: ${axisGaps.join(", ")}` : "";
    if (attempts.length >= thresholds.req_max_attempts)
      return mk(STATUS.IN_PROGRESS, `scoring loop escalated (attempt ${attempts.length}/${thresholds.req_max_attempts}, score ${total}/100${gapNote})`);
    return mk(STATUS.IN_PROGRESS, `scoring loop (attempt ${attempts.length}/${thresholds.req_max_attempts}, score ${total}/100${gapNote})`);
  }
  const saveStatus = ctx.state.confluence?.requirements?.save_status;
  if (saveStatus !== "success" && saveStatus !== "skipped")
    return mk(STATUS.IN_PROGRESS, "Confluence save pending (06)");
  return mk(STATUS.WAITING_APPROVAL, `Human approval gate (07, score ${total}/100)`);
};

// ── Phase 1c: Req-delta (31~33) — A-4 新規 (resume 検出) ─────
// run 完了 = revisions_approved_at set。cancelled_at set は中止扱い (resume しない)。
export const detectPhase1c = (ctx) => {
  const runs = ctx.state.req_delta?.runs || [];
  if (runs.length === 0) return null; // req-delta 未実行プロジェクトは行ごと非表示
  const mk = (status, detail, extra) => row("1c", "Req-delta (31~33)", "/ayatori-req-delta", status, detail, extra);
  const latest = runs[runs.length - 1];
  const doneCount = runs.filter((r) => r.revisions_approved_at != null).length;
  const cancelledCount = runs.filter((r) => r.cancelled_at != null).length;
  if (latest.revisions_approved_at == null && latest.cancelled_at == null) {
    // 中断 run → resume 先 step を導出 (31 が run stub を作るので 31 は完了済)
    const resumeStep = latest.impact_approved_at == null ? "32-req-impact-analysis" : "33-req-revision";
    return mk(
      STATUS.IN_PROGRESS,
      `run ${latest.run_id} interrupted — resume at Step ${resumeStep}`,
      { resume_step: resumeStep, run_id: latest.run_id },
    );
  }
  const parts = [`${doneCount} run(s) completed`];
  if (cancelledCount) parts.push(`${cancelledCount} cancelled`);
  return mk(STATUS.COMPLETE, parts.join(", "));
};

// ── Phase 1d: Add-feature (01b) ──────────────────────────────
// 01b は req_delta.runs[] に run stub を append し change-manifest.json (source ==
// "skill-01b") を生成して Phase 1c Step 32 へ接続する。ヒアリング自体の完了 = manifest 存在。
// 以降の resume は Phase 1c 行が担う。
export const detectPhase1d = (ctx) => {
  const manifest = ctx.reqDeltaManifest;
  if (!manifest || manifest.source !== "skill-01b") return null;
  return row("1d", "Add-feature (01b)", "/ayatori-add-feature", STATUS.COMPLETE,
    `hearing done (run ${manifest.run_id ?? "?"}) — continues in Phase 1c`);
};

// ── Phase 2: Design (08~13) ──────────────────────────────────
export const detectPhase2 = (ctx, thresholds) => {
  const mk = (status, detail) => row("2", "Design (08~13)", "/ayatori-design", status, detail);
  const ap = approvals(ctx);
  const tokensPopulated = ctx.tokens != null && Object.keys(ctx.tokens).length > 0;
  if (ap.step13_approved_at != null || ctx.hasScreenList) return mk(STATUS.COMPLETE);
  if (!ctx.hasDesignBrief) {
    if (tokensPopulated) return mk(STATUS.COMPLETE); // legacy: brief 不在でも tokens があれば通過済
    return mk(STATUS.NOT_STARTED);
  }
  const sel = ctx.state.selections || {};
  if (sel.selected_sample_id == null) {
    // sample HTML は design-samples/{platform}/index.html (3 案切替式 1 ファイル)
    const hasSamples = ["web", "mobile"].some((p) => ctx.existsRel(`design-samples/${p}/index.html`));
    if (!hasSamples) return mk(STATUS.IN_PROGRESS, "awaiting sample HTML generation (09)");
    return mk(STATUS.WAITING_APPROVAL, "sample selection gate (10)");
  }
  const wcagConstraintsSet = ctx.wcagMapping != null && ctx.wcagMapping.constraints != null;
  if (!wcagConstraintsSet) return mk(STATUS.IN_PROGRESS, "WCAG mapping (11) — constraints/criteria 未確定");
  const wcagAttempts = (ctx.wcagHistory && Array.isArray(ctx.wcagHistory.attempts)) ? ctx.wcagHistory.attempts : [];
  const lastViolations = wcagAttempts.length ? (wcagAttempts[wcagAttempts.length - 1].violations || []) : [];
  if (lastViolations.length > 0)
    return mk(STATUS.IN_PROGRESS, `WCAG correction loop (08↔11, attempt ${wcagAttempts.length}/${thresholds.design_max_attempts})`);
  if (!tokensPopulated) return mk(STATUS.IN_PROGRESS, "token generation (12)");
  return mk(STATUS.WAITING_APPROVAL, "style guide review (13)");
};

// ── Phase 3 main: Screens (14~25) — Figma stub 対応込み ──────
// figma_export field: "done" | "pending" | "skipped (stub)" | null (Step 22 未到達)
export const detectPhase3Main = (ctx, thresholds) => {
  const mk = (status, detail, extra) => row("3", "Screens main (14~25)", "/ayatori-screens", status, detail, extra);
  if (!ctx.hasScreenList) return mk(STATUS.NOT_STARTED);
  const ap = approvals(ctx);
  const sc = screensState(ctx);
  // reverse 基線ルート (screens-lite) で完結 → 画面 HTML を作らない経路なので専用行で先に返す。
  // フル実行途中 (step16 承認済み・基線印なし) の従来表示はこの分岐を通らないため不変。
  if (isBaselineOnly(ctx))
    return mk(STATUS.COMPLETE,
      `基線確立済み (screens-lite、由来: ${baselineViaLabel(ap.baseline_approved_via)}) — 画面 HTML は未生成`,
      { baseline_only: true });
  if (ap.step16_approved_at == null) return mk(STATUS.WAITING_APPROVAL, "design doc review (16)");
  const saveCount = ctx.state.confluence?.design?.save_count ?? 0;
  if (saveCount === 0) return mk(STATUS.IN_PROGRESS, "awaiting 1st Confluence save (15)");
  const screenMds = ctx.listRel("screens").filter((f) => f.endsWith(".md") && !f.startsWith("00-") && !f.startsWith("_"));
  if (screenMds.length === 0) return mk(STATUS.IN_PROGRESS, "screen gen (17)");
  if (ctx.scores == null || ctx.scores.current == null) return mk(STATUS.IN_PROGRESS, "screen review + scoring (18~19)");
  const cur = ctx.scores.current;
  if ((cur.ai_improvable_deductions ?? 0) > 0) {
    const attemptCount = Array.isArray(ctx.scores.history) ? ctx.scores.history.length : (cur.attempt ?? "?");
    return mk(STATUS.IN_PROGRESS, `review loop (20, attempt ${attemptCount}/${thresholds.design_max_attempts})`);
  }
  if (ap.screens_human_approved !== true) return mk(STATUS.WAITING_APPROVAL, "full-screen review (21)");
  // Step 21 承認後・2nd save 前はグラフィック生成ブロック (21a-21g) が挟まる。
  // 「decision=skip 確定 or 21g 承認済み」以外は 21a-21g 進行中と表示する (上流 scope=skip は
  // orchestrator の記録前でもブロックに入らないため 2nd save 表示のままで良い)。
  const gfx = screensState(ctx).graphics ?? {};
  const gfxResolved = gfx.decision === "skip" || ap.graphics_human_approved === true;
  const upstreamGfxSkip = ctx.requirements?.design_output_scope?.graphic_generation === "skip";
  if (saveCount < 2 && !gfxResolved && !upstreamGfxSkip)
    return mk(STATUS.IN_PROGRESS, gfx.decision === "generate" 
      ? "graphic block (21c-21g)"
      : "graphic block (21a-21b)");
  if (saveCount < 2) return mk(STATUS.IN_PROGRESS, "2nd Confluence save (15)");
  // Step 22 Figma export — stub モード (figma-state.json 不在、または disabled fallback の skip 記録
  // screens.step22_figma_status == "skipped_stub_mode") は「skipped (stub)」で通過扱い (受け入れ条件 3)。
  // 後者は figma-state.json が別経路 (REVERSE_ENGINEERED bootstrap 等) で存在する disabled 環境をカバーする。
  const stubMode = !ctx.figmaStateExists || sc.step22_figma_status === "skipped_stub_mode";
  const figmaScreens = ctx.figmaState?.nodes?.screens || {};
  const figmaExport = stubMode ? "skipped (stub)"
    : (Object.keys(figmaScreens).length > 0 ? "done" : "pending");
  const stubNote = stubMode ? " — Figma export: skipped (stub)" : "";
  if (figmaExport === "pending")
    return mk(STATUS.IN_PROGRESS, "Figma export (22)", { figma_export: figmaExport });
  if (ap.final_approved !== true)
    return mk(STATUS.WAITING_APPROVAL, `final approval (23)${stubNote}`, { figma_export: figmaExport });
  // final_approved 後: 24 (design-system-update) / 25 (component-build)
  const subStateActivity = sc.step25a_completed_at != null || sc.state_pattern_skipped === true
    || ap.completed_at_states != null;
  const step2425Done = sc.step24_completed_at != null && sc.step25_completed_at != null;
  if (step2425Done || subStateActivity)
    return mk(STATUS.COMPLETE, stubMode ? `Figma export: skipped (stub)` : null, { figma_export: figmaExport });
  const pending = [
    sc.step24_completed_at == null ? "design system update (24)" : null,
    sc.step25_completed_at == null ? "component build (25)" : null,
  ].filter(Boolean).join(" + ");
  return mk(STATUS.IN_PROGRESS, `${pending}${stubNote}`, { figma_export: figmaExport });
};

// ── Phase 3 sub-state: 25a~25e (optional) ──────
// main 未完 (final_approved 未 set) の間は行ごと非表示。optional: true = not_started の
// とき next-action の推奨対象から外す (25a は user 選択ゲートであり未実行は「未決」で
// しかないため)。着手後の in_progress / waiting_approval は通常どおり resume 推奨される。
export const detectPhase3SubState = (ctx) => {
  const ap = approvals(ctx);
  const sc = screensState(ctx);
  const mk = (status, detail, extra = {}) =>
    row("3-sub", "Screens sub-state (25a~25e)", "/ayatori-screens", status, detail, { optional: true, ...extra });
  if (ap.final_approved !== true && ap.completed_at_states == null) return null;
  if (ap.completed_at_states != null) {
    const st25e = sc.step25e || {};
    const stubbed = st25e.figma_status === "skipped_stub_mode";
    const detailParts = [];
    if (stubbed) detailParts.push("Figma export: skipped (stub)");
    else if (st25e.figma_sync_status != null) detailParts.push(`figma_sync: ${st25e.figma_sync_status}`);
    return mk(STATUS.COMPLETE, detailParts.join(", ") || null,
      stubbed ? { figma_export: "skipped (stub)" } : {});
  }
  if (sc.state_pattern_skipped === true) return mk(STATUS.SKIPPED, "skipped by user (25a)");
  const st25b = sc.step25b || {};
  const st25c = sc.step25c || {};
  const st25d = sc.step25d || {};
  if (st25d.decision === "skip_without_figma") return mk(STATUS.COMPLETE, "approved without Figma (25d: skip_without_figma)");
  if (st25d.approved === true) {
    // detectPhase3Main の stubMode と同条件 (disabled + figma-state.json 存在ケースをカバー)
    const stubMode = !ctx.figmaStateExists || sc.step22_figma_status === "skipped_stub_mode";
    if (stubMode) return mk(STATUS.IN_PROGRESS, "figma pattern export (25e) — Figma: skipped (stub) 予定", { figma_export: "skipped (stub)" });
    return mk(STATUS.IN_PROGRESS, "figma pattern export (25e)");
  }
  if (st25d.decision === "revise") return mk(STATUS.IN_PROGRESS, "revise loop — back to sub-state gen (25b)");
  if (st25c.completed_at != null) return mk(STATUS.WAITING_APPROVAL, `sub-state approval gate (25d, score ${st25c.score ?? "?"})`);
  if (st25b.started_at != null) {
    const done = st25b.completed_count ?? 0;
    const expected = st25b.expected_count ?? "?";
    if (st25b.completed_at == null || (typeof expected === "number" && done < expected))
      return mk(STATUS.IN_PROGRESS, `sub-state gen (25b, ${done}/${expected} files) — resume 可能`, { resume_step: "25b-state-pattern-gen" });
    return mk(STATUS.IN_PROGRESS, "sub-state scoring (25c)");
  }
  if (sc.step25a_completed_at != null || ctx.statePatternPlan != null)
    return mk(STATUS.IN_PROGRESS, "sub-state gen (25b)");
  return mk(STATUS.NOT_STARTED, "sub-state plan (25a) 未実行 — optional");
};

// ── Phase 4: Retro (26) — A-3 修正 ───────────────────────────
// 従来 SKILL.md は実在しないパス artifacts/{app}/pipeline-improvements.md を見ていた。
// 判定を 2 経路に修正:
//   1. pipeline-state.json.approvals.retro_completed_at (恒久対応 key。存在すれば読む)
//   2. fallback: repo-level artifacts/pipeline-improvements.md (retro の実出力先) の見出し
//      行マッチ。2 形式を許容する:
//        - 実出力: 「## Run: {app_name} — Phase 4 Retro (date)」
//        - テンプレート (skill 26 Phase H): 「**対象アプリ**: {app_name}」。後者は app_name 直後に
//          スペースなしで全角括弧の注釈が連結される (例: 「app-name（説明）」) ため括弧も区切り文字に含める
export const detectPhase4 = (ctx, artifactsRoot) => {
  const mk = (status, detail) => row("4", "Retro (26)", "/ayatori-retro", status, detail);
  const ap = approvals(ctx);
  if (ap.retro_completed_at != null) return mk(STATUS.COMPLETE);
  const improvements = readText(join(artifactsRoot, "pipeline-improvements.md"));
  if (improvements != null) {
    const mentioned = improvements.split("\n").some((line) => {
      // 実出力形式: 「## Run: {app_name} — Phase 4 Retro (date)」(dash は em/en/hyphen いずれも許容)
      const runMatch = line.match(/^##\s+Run:\s*(.+?)\s+[—–-]\s+Phase\s*4\s*Retro\b/);
      if (runMatch != null && runMatch[1].trim() === ctx.appName) return true;
      // テンプレート形式 (skill 26 Phase H): 「**対象アプリ**: {app_name}」
      const legacyMatch = line.match(/^\*\*対象アプリ\*\*:\s*(.+)$/);
      return legacyMatch != null && legacyMatch[1].split(/[,、/\s（(）)]+/).includes(ctx.appName);
    });
    if (mentioned) return mk(STATUS.COMPLETE, "detected via artifacts/pipeline-improvements.md");
  }
  if (isBaselineOnly(ctx))
    // reverse 基線プロジェクトは retro の対象外 — CLAUDE.md § 完走後 Phase 共通 Entry Guard の
    // 基線例外は Phase 1d / 5 / 6 限定 (retro は画面レビューの振り返りで対象物が無い)。
    // 行は残すが optional で推奨対象から外す (通らない先を Next action に出さない)。
    return row("4", "Retro (26)", "/ayatori-retro", STATUS.NOT_STARTED,
      "entry guard: reverse 基線プロジェクトは対象外 (retro は基線例外を accept しない)", { optional: true });
  if (!isProjectCompleted(ctx)) return mk(STATUS.NOT_STARTED, "entry guard: Phase 3 未完了 (final_approved / completed_at_states 不在)");
  return mk(STATUS.NOT_STARTED);
};

// ── Phase 5: Delta (27~30 + 27b/29b) — A-4 新規 (resume 検出) ─
// run 完了 = figma_approved_at set (Step 30、delta phase 完了の合図) または
// figma_status == "skipped_stub_mode" (Step 30 Fallback)。cancelled_at set = 中止。
export const detectPhase5 = (ctx) => {
  const runs = ctx.state.delta?.runs || [];
  if (runs.length === 0) return null; // delta 未実行プロジェクトは行ごと非表示
  const mk = (status, detail, extra) => row("5", "Delta (27~30)", "/ayatori-delta", status, detail, extra);
  const latest = runs[runs.length - 1];
  const isRunDone = (r) => r.figma_approved_at != null || r.figma_status === "skipped_stub_mode";
  const doneCount = runs.filter(isRunDone).length;
  const cancelledCount = runs.filter((r) => r.cancelled_at != null && !isRunDone(r)).length;
  if (!isRunDone(latest) && latest.cancelled_at == null) {
    // 中断 run → mode 別に resume 先 step を導出 (受け入れ条件 1)
    const mode = latest.mode ?? "requirement"; // 欠落は後方互換で requirement
    let resumeStep;
    if (mode === "screen_edit") {
      resumeStep = latest.screens_approved_at == null ? "29b-reverse-propagate" : "30-partial-figma-update";
    } else if (latest.impact_approved_at == null) {
      resumeStep = "28-impact-analysis";
    } else if (latest.screens_approved_at == null) {
      resumeStep = "29-partial-screen-regen";
    } else {
      resumeStep = "30-partial-figma-update";
    }
    return mk(
      STATUS.IN_PROGRESS,
      `run ${latest.run_id} (mode: ${mode}) interrupted — resume at Step ${resumeStep}`,
      { resume_step: resumeStep, run_id: latest.run_id, mode },
    );
  }
  const parts = [`${doneCount} run(s) completed`];
  if (cancelledCount) parts.push(`${cancelledCount} cancelled`);
  const extra = {};
  if (isRunDone(latest) && latest.figma_status === "skipped_stub_mode") {
    parts.push("Figma update: skipped (stub)");
    extra.figma_export = "skipped (stub)";
  }
  return mk(STATUS.COMPLETE, parts.join(", "), extra);
};

// ── Phase 6: Delta-mini (34) ─────────────────────────────────
export const detectPhase6 = (ctx) => {
  const deltaRuns = ctx.state.delta?.runs || [];
  const reqDeltaRuns = ctx.state.req_delta?.runs || [];
  if (deltaRuns.length === 0 && reqDeltaRuns.length === 0) return null; // 行ごと非表示
  const pendingDelta = deltaRuns.filter((r) => r.mini_retro_completed_at == null).length;
  const pendingReqDelta = reqDeltaRuns.filter((r) => r.mini_retro_completed_at == null).length;
  const totalPending = pendingDelta + pendingReqDelta;
  if (totalPending === 0)
    return row("6", "Delta-mini (34)", "/ayatori-delta-mini", STATUS.COMPLETE, "all runs retrospected");
  return row("6", "Delta-mini (34)", "/ayatori-delta-mini", STATUS.NOT_STARTED,
    `${totalPending} run(s) pending mini-retro (${pendingDelta} delta + ${pendingReqDelta} req_delta)`);
};

// ── プロジェクト全体の判定 ────────────────────────────────────
export const detectProject = (artifactsRoot, appName, thresholds) => {
  const ctx = loadProject(artifactsRoot, appName);
  const phases = [
    detectPhase0b(ctx),
    detectPhase0cVerify(ctx),
    detectPhase1a(ctx),
    detectPhase1b(ctx, thresholds),
    detectPhase1c(ctx),
    detectPhase1d(ctx),
    detectPhase2(ctx, thresholds),
    detectPhase3Main(ctx, thresholds),
    detectPhase3SubState(ctx),
    detectPhase4(ctx, artifactsRoot),
    detectPhase5(ctx),
    detectPhase6(ctx),
  ].filter(Boolean);
  const pendingScreenEdits = countUnconsumedScreenEdits(ctx);
  let nextAction = recommendNextAction(phases);
  // reverse 基線プロジェクト: Phase 3 は基線確立で完結 (complete) し retro は対象外 (optional) の
  // ため既定 cascade では推奨が出ない。基線から先へ進む正規の入口を案内する
  // (accept する Phase は 1d / 5 / 6 — CLAUDE.md § 完走後 Phase 共通 Entry Guard)。
  if (nextAction == null && isBaselineOnly(ctx)) {
    nextAction = {
      phase: "1d",
      command: "/ayatori-add-feature",
      reason: "基線確立済み (screens-lite) — 機能追加は /ayatori-add-feature、変更の画面反映は /ayatori-delta、要件の手直しは /ayatori-req-delta",
    };
  }
  // 完走後で他に着手待ちが無く、未反映の手編集がある → screen-edit delta を案内する。
  // (/ayatori-delta を完走後変更の単一入口として推奨: 要件変更 / 画面手修正 / 機能追加のいずれもここから)
  if (nextAction == null && isProjectCompleted(ctx) && pendingScreenEdits > 0) {
    nextAction = {
      phase: "5",
      command: "/ayatori-delta",
      reason: `未反映の手編集 ${pendingScreenEdits} 件 — screen-edit モードで反映してください`,
    };
  }
  return { app_name: appName, phases, next_action: nextAction, pending_screen_edits: pendingScreenEdits };
};

// ── 推奨アクション ────────────────────────────────────────────
// 1. in_progress / waiting_approval の行が最優先 (中断 run の resume がダッシュボードの本務)。
//    ただし **本流 (optional でない) の active を optional より先に採る** — 任意フェーズ
//    (sub-state / 対象限定突合) の中断 run が、本流の承認待ちを恒久的に覆い隠さないため。
//    optional な active も本流に active が無ければ採る (resume 案内は必要)
// 2. なければ最初の not_started (optional 行 = sub-state 未決はここでのみ除外)
// 3. 全 complete/skipped → null (完了)
export const recommendNextAction = (phases) => {
  const isActive = (p) => p.status === STATUS.IN_PROGRESS || p.status === STATUS.WAITING_APPROVAL;
  // 本流 (optional でない) の active を先に採る。任意フェーズの中断 run が本流のゲート待ちを
  // 覆い隠さないようにするため — 中断した補正フェーズは「やってもよい作業」であり、
  // 本流の承認待ちより優先して案内すべきものではない。本流に active が無ければ optional を採る
  // (中断 run の resume 案内は依然として必要)。
  const active = phases.find((p) => isActive(p) && p.optional !== true) ?? phases.find(isActive);
  if (active) {
    return {
      phase: active.phase,
      command: active.command,
      reason: active.status === STATUS.WAITING_APPROVAL
        ? `human gate 待ち: ${active.detail ?? active.label}`
        : `再開: ${active.detail ?? active.label}`,
    };
  }
  const next = phases.find((p) => p.status === STATUS.NOT_STARTED && p.optional !== true);
  if (next) return { phase: next.phase, command: next.command, reason: `次 Phase: ${next.label}` };
  return null; // all complete
};

// ── 出力 ─────────────────────────────────────────────────────
export const renderMarkdown = (result) => {
  const lines = [];
  for (const proj of result.projects) {
    lines.push(`## ${proj.app_name}`, "");
    lines.push("| Phase | Status | Detail | Command |");
    lines.push("|---|---|---|---|");
    for (const p of proj.phases) {
      const statusLabel = `${p.icon} ${p.status}`;
      lines.push(`| ${p.phase} ${p.label} | ${statusLabel} | ${p.detail ?? "—"} | \`${p.command}\` |`);
    }
    lines.push("");
    if (proj.next_action)
      lines.push(`> **Next action:** \`${proj.next_action.command}\` — ${proj.next_action.reason}`, "");
    else {
      lines.push(`> **Pipeline complete!** All phases finished.`, "");
      lines.push(`> 変更が必要になったら \`/ayatori-delta\` から入れます（要件変更 / 画面手修正 / 機能追加）。`, "");
    }
    if (proj.pending_screen_edits > 0 &&
        !(proj.next_action && proj.next_action.command === "/ayatori-delta" && /手編集/.test(proj.next_action.reason)))
      lines.push(`> ℹ️ 未反映の手編集 ${proj.pending_screen_edits} 件（\`/ayatori-delta\` の screen-edit 対象）`, "");
  }
  return lines.join("\n");
};

export const buildStatus = (repoRoot, appNames = null) => {
  const artifactsRoot = join(repoRoot, "artifacts");
  if (!isDir(artifactsRoot)) return { error: `artifacts directory not found: ${artifactsRoot}` };
  const all = listDir(artifactsRoot)
    .filter((d) => !d.startsWith(".") && !d.startsWith("_") && isDir(join(artifactsRoot, d)))
    .sort();
  const targets = appNames && appNames.length ? appNames : all;
  const missing = targets.filter((a) => !all.includes(a));
  if (missing.length) return { error: `project not found under artifacts/: ${missing.join(", ")}` };
  const thresholds = readThresholds(repoRoot);
  return {
    artifacts_root: "artifacts",
    thresholds,
    projects: targets.map((a) => detectProject(artifactsRoot, a, thresholds)),
  };
};

// ── CLI エントリポイント ─────────────────────────────────────
const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const markdown = args.includes("--markdown");
  const appNames = args.filter((a) => !a.startsWith("--")).map((a) => basename(a.replace(/\/+$/, "")));
  // repo root = このスクリプトの親の親 (scripts/ の上)
  const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
  const result = buildStatus(repoRoot, appNames);
  if (result.error) {
    console.error(`[pipeline-status] ${result.error}`);
    process.exit(result.error.startsWith("project not found") ? 3 : 2);
  }
  if (markdown) console.log(renderMarkdown(result));
  else console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
