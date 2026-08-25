---
name: ayatori-status
description: "Pipeline status dashboard. Shows current progress of all AYATORI projects (5 Phase / 26 Step) and recommends next action."
---

# /ayatori-status — Pipeline Status Dashboard

## Execution

> **推奨: 決定論スクリプトを実行する。** 判定ロジックの SoT は `scripts/pipeline-status.mjs` (Node のみ・npm 依存ゼロ・READ-ONLY)。まず次を実行し、その出力をそのまま Dashboard として提示する:
> ```bash
> node scripts/pipeline-status.mjs [--markdown] [{app_name}]
> ```
> スクリプトは Phase 0b / **0c** / 1a / 1b / **1c** / **1d** / 2 / 3 (main + sub-state) / 4 / **5** / 6 と、完走後の未反映手編集 (screen-edit delta への誘導) まで判定する。node が使えない場合のみ、以下 Step 1〜4 の手動判定にフォールバックする。

### Step 1: Scan Projects

List all subdirectories under `artifacts/`. Each subdirectory is a project (`{app_name}`).

If no subdirectories exist:
> "No projects found. Run `/ayatori-question` to start a new project."
→ End.

### Step 2: For Each Project, Detect Phase Status

For each `{app_name}`, read the following files and determine status:

```
Phase 0b (Reverse — Steps 01~06):  [only shown if artifacts/{app_name}/reverse-engineered/ exists]
  CHECK: artifacts/{app_name}/requirements.json.status == "REVERSE_ENGINEERED"?
  - No reverse-engineered/ dir → skip this row entirely
  - reverse-engineered/ exists, but requirements.json.status != "REVERSE_ENGINEERED"
      → check which step output exists last (raw-analysis.md / 08-constraints.md / comparison-report.md)
      → status: "in_progress", detail: "last completed: {Step 02|Step 03|Step 04}"
  - requirements.json.status == "REVERSE_ENGINEERED" → status: "complete"

Phase 0c (Reverse-verify — Steps V1~V3):  [only shown if pipeline-state.json.reverse_verify.runs[] has ≥1 entry]
  CHECK: reverse_verify.runs[] entries?
  - none → skip this row entirely (走っていないことは異常ではない — 任意・反復の補正フェーズ)
  - completed が 1 件以上 → "complete" / completed 0 件で cancelled のみ → "skipped"
      (中止だけの履歴を complete と呼ばない — 成果物は何も変わっていない)
  - どちらも未 set → status: "in_progress"。resume 先は上から順に:
      findings_resolved_at set → Completion のみ (反映と台帳書き戻しは完了済) /
      crosscheck_completed_at set → V3 / scope_approved_at set → V2 /
      いずれも未 set → V1 の範囲ゲート再提示 (stub のみの中断)
  - complete 時は completed / cancelled の run 数と、**台帳 (requirement-deviations.json) の
      phase == "reverse_verify" かつ resolved_at 未 set の件数** を detail に併記する
      (runs[].findings_deferred の合計は使わない — 未解決項目は次の run が run_id を付け替えて
       引き継ぐ設計のため、合計すると同一項目を run の数だけ重複計上する)

Phase 1a (Question — Step 01):
  CHECK: artifacts/{app_name}/requirements/00-raw-input.md exists?
  - No  → status: "not_started"
  - Yes → status: "complete"

Phase 1b (Requirements — Steps 02~07):
  CHECK: artifacts/{app_name}/rubric.json exists?
  - No  → status: "not_started"
  - Yes → read rubric.json (criteria のみ) and scoring-history.json (loop history)。derive:
        attempts = scoring-history.json.attempts (空なら [])
        attempt_count = len(attempts)
        current = attempts[-1] if attempts else None
        total = current.total if current else 0
        scores = current.scores if current else {}
        axis_min_ok = all(scores[axis] >= pipeline.yaml.requirements.loop.per_axis_min) (default 12)
        save_status = pipeline-state.json.confluence.requirements.save_status
        step07_approved_at = pipeline-state.json.approvals.step07_approved_at
    - attempt_count == 0 → status: "not_started"
    - (total < 80 OR NOT axis_min_ok) AND attempt_count < 3 → status: "in_progress", detail: "scoring loop (attempt {attempt_count}/3, score {total}/100{, axis gap: <list> if axis_min_ok is false})"
    - total >= 80 AND axis_min_ok AND save_status != "success" → status: "in_progress", detail: "Confluence save pending"
    - total >= 80 AND axis_min_ok AND save_status == "success" AND step07_approved_at not set → status: "waiting_approval", detail: "Human approval gate (score {total}/100)"
    - step07_approved_at set → status: "complete"
  CHECK: Phase 2 artifacts exist? (design-brief.yaml OR tokens.json)
  - If yes → Phase 1b status override: "complete"

Phase 1c (Req-delta — Steps 31~33):  [only shown if pipeline-state.json.req_delta.runs[] has ≥1 entry]
  CHECK: req_delta.runs[] entries?
  - none → skip this row entirely
  - latest run: revisions_approved_at set → "complete"; cancelled_at set (未 approved) → cancelled 扱い
  - どちらも未 set → status: "in_progress", resume at Step 32 (impact_approved_at 未) or Step 33 (set)

Phase 1d (Add-feature — Step 01b):  [only shown if req-delta/change-manifest.json.source == "skill-01b"]
  CHECK: req-delta/change-manifest.json.source == "skill-01b"?
  - No / manifest 不在 → skip this row entirely
  - Yes → status: "complete", detail: "hearing done — continues in Phase 1c"

Phase 2 (Design — Steps 08~13):
  CHECK: artifacts/{app_name}/design-brief.yaml
  - Does not exist → status: "not_started"
  - derive:
        selected_sample_id = pipeline-state.json.selections.selected_sample_id
        step13_approved_at = pipeline-state.json.approvals.step13_approved_at
        wcag_attempts = wcag-history.json.attempts (空なら [])
        last_violations = wcag_attempts[-1].violations if wcag_attempts else []
        wcag_constraints_set = wcag-mapping.json.constraints exists
  - Exists, but artifacts/{app_name}/design-samples/ is empty → status: "in_progress", detail: "awaiting sample HTML generation (09)"
  - design-samples/ has 3 files, but selected_sample_id is null → status: "waiting_approval", detail: "sample selection gate (10)"
  - selected_sample_id set, but not wcag_constraints_set → status: "in_progress", detail: "WCAG mapping (11) — constraints/criteria 未確定"
  - wcag_constraints_set, last_violations not empty → status: "in_progress", detail: "WCAG correction loop (8↔11, attempt {len(wcag_attempts)}/{max_attempts})"
  - wcag_constraints_set AND last_violations empty, but tokens.json is empty → status: "in_progress", detail: "token generation (12)"
  - tokens.json populated, but step13_approved_at not set → status: "waiting_approval", detail: "style guide review (13)"
  - step13_approved_at set OR Phase 3 artifacts exist → status: "complete"

Phase 3 (Screens — Steps 14~25):
  CHECK: artifacts/{app_name}/screens/00-screen-list.md
  - Does not exist → status: "not_started"
  - derive:
        step16_approved_at = pipeline-state.json.approvals.step16_approved_at
        save_count = pipeline-state.json.confluence.design.save_count or 0
        screens_human_approved = pipeline-state.json.approvals.screens_human_approved == true
        final_approved = pipeline-state.json.approvals.final_approved == true
        step22_skipped = pipeline-state.json.screens.step22_figma_status == "skipped_stub_mode"
        step24_completed_at = pipeline-state.json.screens.step24_completed_at
        step25_completed_at = pipeline-state.json.screens.step25_completed_at
        baseline_approved_at = pipeline-state.json.approvals.baseline_approved_at
        baseline_approved_via = pipeline-state.json.approvals.baseline_approved_via
        reverse_origin = requirements.json.status == "REVERSE_ENGINEERED"
        screen_html_count = screens/{web,web-sm,mobile}/*.html の枚数 (3 ディレクトリ直下のみ。
                            screens/00-transition-map.html と screens/_shared/components.html は
                            screens-lite ルートの正当な生成物なので数えない)
  - baseline_approved_at set AND NOT final_approved AND completed_at_states 不在 AND reverse_origin AND screen_html_count == 0
      → status: "complete", detail: "基線確立済み (screens-lite、由来: {screens-lite ゲート|手動 stub|由来記録なし}) — 画面 HTML は未生成"

    (reverse 基線ルートは画面 HTML を作らない経路のため、以下の cascade に流すと「awaiting 1st Confluence save (15)」等で未完了と誤表示される。判定式の SoT は CLAUDE.md § 完走後 Phase 共通 Entry Guard — 由来検査 reverse_origin と screen_html_count == 0 の AND は、forward プロジェクトの手動 stub と Route B (フル実行) 進行中を基線扱いしないため。`scripts/pipeline-status.mjs` の isBaselineOnly と同条件)
  - Exists, but step16_approved_at not set → status: "waiting_approval", detail: "design doc review (16)"
  - step16_approved_at set, save_count == 0 → status: "in_progress", detail: "awaiting 1st Confluence save (15)"
  - save_count == 1, no screens/*.md → status: "in_progress", detail: "screen gen (17)"
  - screens/*.md exist, scores.json missing → status: "in_progress", detail: "screen gen (17)"
  - scores.json: ai_improvable_deductions > 0 → status: "in_progress", detail: "review loop (attempt {attempt_count}/3)"
  - ai_improvable_deductions == 0, not screens_human_approved → status: "waiting_approval", detail: "full-screen review (21)"
  - screens_human_approved, save_count < 2 → status: "in_progress", detail: "2nd Confluence save (15)"
  - save_count >= 2, figma-state.json.nodes.screens empty, not step22_skipped → status: "in_progress", detail: "Figma export (22)"
  - (figma-state.json.nodes.screens populated OR step22_skipped), not final_approved → status: "waiting_approval", detail: "final approval (23)"

    (step22_skipped 条件が無いと FIGMA_MCP_ENABLED=false 環境で nodes.screens が永久に空のため、final_approved 後も「Figma export (22)」を誤表示し続ける — phases/screens/SKILL.md の resume 規則と同じ state ベース判定でミラーを維持する)
  - final_approved, step24_completed_at AND step25_completed_at set → status: "complete"

    (`scripts/pipeline-status.mjs` detectPhase3Main の step2425Done 判定と同条件。disabled 経路では skill 24/25 のスタブ手順が両 completed_at を即座に書くため、この行が無いと 25a 待ちの間ずっと「(24~25) in_progress」を誤表示する)
  - final_approved → status: "in_progress", detail: "design system update + component build (24~25)"
  - pipeline-improvements.md or Phase 4 artifacts exist → status: "complete"

Phase 4 (Retro — Step 26):
  CHECK: approvals.retro_completed_at set? → status: "complete"
  - else: repo-level artifacts/pipeline-improvements.md にこのアプリの retro 見出し
    (「## Run: {app_name} — Phase 4 Retro」または「**対象アプリ**: {app_name}」) があれば "complete"
  - どちらも無く、上記 Phase 3 の基線分岐が成立 (reverse 基線プロジェクト) → "not_started" だが
    **推奨対象外** (optional)。detail: "entry guard: reverse 基線プロジェクトは対象外"
    (基線例外を accept するのは Phase 1d / 5 / 6 のみ — retro は画面レビューの振り返りで対象物が無い)
  - どちらも無く完走済 (final_approved / completed_at_states) → "not_started"
  - 未完走 → "not_started" (entry guard: Phase 3 未完了)

Phase 5 (Delta — Steps 27~30 + 27b/29b):  [only shown if pipeline-state.json.delta.runs[] has ≥1 entry]
  CHECK: delta.runs[] entries?
  - none → skip this row entirely
  - run 完了 = figma_approved_at set OR figma_status == "skipped_stub_mode"; cancelled_at set = 中止
  - latest run 未完了 → status: "in_progress", mode 別 resume (requirement: Step 28/29/30 の該当 /
    screen_edit: Step 29b/30 の該当)
  - 完走後に delta/edited-screens.json の未消費 (consumed_by_run == null) が N>0 →
    手編集 N 件未反映を表示し /ayatori-delta (screen-edit モード) を推奨

Phase 6 (Delta-mini — Step 34):  [only shown if delta.runs[] or req_delta.runs[] has at least one entry]
  CHECK: pipeline-state.json has delta.runs[] or req_delta.runs[] with at least one entry?
  - No (本プロジェクトでまだ delta / req_delta を実行していない) → skip this row entirely
  - At least one entry exists → derive:
        pending_delta    = [r for r in delta.runs if "mini_retro_completed_at" not in r]
        pending_req_delta = [r for r in req_delta.runs if "mini_retro_completed_at" not in r]
        total_pending = len(pending_delta) + len(pending_req_delta)
    - total_pending == 0 → status: "complete", detail: "all runs retrospected"
    - total_pending > 0 → status: "not_started", detail: "{total_pending} run(s) pending mini-retro ({len(pending_delta)} delta + {len(pending_req_delta)} req_delta)"
```

### Step 3: Display Dashboard

For each project, display a table:

```
## {app_name}

| Phase | Status | Detail | Command |
|---|---|---|---|
| 0b Reverse (Steps 01~06) | ✅ Complete | — | — |   ← only shown for reverse-flow projects
| 1a Question (01) | ✅ Complete | — | — |
| 1b Requirements (02~07) | 🔄 In Progress | scoring loop (attempt 1/3, score 71/100) | `/ayatori-requirements` |
| 2 Design (08~13) | ⬜ Not Started | — | `/ayatori-design` |
| 3 Screens (14~25) | ⬜ Not Started | — | `/ayatori-screens` |
| 4 Retro (26) | ⬜ Not Started | — | `/ayatori-retro` |
| 6 Delta-mini (34) | ⬜ Not Started | 1 run(s) pending mini-retro (1 delta + 0 req_delta) | `/ayatori-delta-mini` |   ← only shown when delta / req_delta runs exist
```

Status icons:
- ✅ Complete
- 🔄 In Progress
- ⏳ Waiting Approval (human gate)
- ⬜ Not Started

### Step 4: Recommend Next Action

Based on the status, recommend the next command to run:

- Find the first phase that is NOT "complete"
- If it's "in_progress" or "waiting_approval": recommend that phase's command
- If it's "not_started": recommend that phase's command (推奨対象外 = optional の行は飛ばす)
- reverse 基線プロジェクト (Phase 3 が基線分岐で complete・Phase 4 は対象外) で他に着手待ちが無い場合:
  `/ayatori-add-feature` を推奨する (変更の画面反映は `/ayatori-delta`、要件の手直しは `/ayatori-req-delta`)
- If ALL phases are complete: "Pipeline complete! All phases finished."

Display:
> **Next action:** Run `/ayatori-{phase}` to continue.
