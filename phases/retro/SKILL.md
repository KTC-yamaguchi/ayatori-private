---
name: ayatori-retro
description: "Phase 4: Retrospective + pipeline improvement. Deliverables review → final approval → feedback analysis → improvement proposals → pipeline patches."
---

# /retro — Phase 4 (Step 26)

## Preamble

1. Read `pipeline.yaml` to confirm Phase configuration. If `skip_phases` includes `"retro"`: display "⏭ retro フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/` and determine `{app_name}`
4. Read the following files:
   - `artifacts/{app_name}/requirements.json` — Project description (INPUT only)
   - `artifacts/{app_name}/pipeline-state.json` — Confluence page IDs / approvals / selections (cross-phase hot state)
   - `artifacts/{app_name}/rubric.json` — Requirements rubric criteria (loop invariant, read only)
   - `artifacts/{app_name}/scoring-history.json` — Phase 1b scoring attempts history (W4)
   - `artifacts/{app_name}/wcag-mapping.json` — Phase 2 WCAG constraints/criteria (read only)
   - `artifacts/{app_name}/wcag-history.json` — Phase 2 WCAG violation attempts history (W4)
   - `artifacts/{app_name}/scores.json` — Phase 3 design score (main HTML 採点)
   - `artifacts/{app_name}/screens/state-pattern-plan.json` (optional) — Sub-state 生成計画。25a で proceed 選択時のみ存在
   - `artifacts/{app_name}/screens/state-pattern-scores.json` (optional) — Sub-state 採点履歴。25c が attempt ごとに append
   - `artifacts/{app_name}/feedback-log.md` — Pattern A/B/C/D log
   - `artifacts/{app_name}/pending-questions.json` — Operating Principle 4 未確定項目キュー (Pattern D 集計の primary source)

4b. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = 5 / `gate_before_step` = 26
   - `target_artifacts` = `"requirements.json,screens/00-coverage-check.json"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (「例」を prose のまま渡すと path 形でない token として drop される)。本 phase は Phase 3 の残骸 entry の受け皿なので、この 2 つが受け付け対象。**`reflect_to` 未設定の残骸 (人間ゲートの持ち越し等) は R1 で無条件に ask される**ので受け皿として機能する。要件文書 (`requirements/*.md`) を足さないのは、retro が書くのは `pipeline-improvements.md` と承認済み改善の skill patch だけで**要件文書の writer ではない**ため (反映できない artifact を宣言すると、答えを受け取っても書き戻せない)
   - `append_sources` = なし (retro 自体は新規 (D) UNCERTAIN を生成しない)
   - 固有注記: retro は集計のみだが、Phase 3 で残った unresolved 残骸を catch して resolve させる責務がある

5. **Entry guard** (CLAUDE.md § 完走後 Phase 共通 Entry Guard 参照、他の完走後 Phase と SoT 統一): 共通判定 (`final_approved == true` OR `completed_at_states` is set) を実施し、いずれも立っていない場合は "⚠️ Phase 3 が完了していません。`/ayatori-screens` を完了してから `/ayatori-retro` を起動してください。" を表示して exit。
   - sub-state を skip したケース (`screens.state_pattern_skipped == true`) も 25a が `final_approved == true` を前提とするため本 2 条件で起動できる (`state_pattern_skipped` を独立条件として持たない)。
   - 起動できる場合、`state-pattern-plan.json` / `state-pattern-scores.json` が存在すれば retro レポートに sub-state 採点履歴も集計対象に含める。

6. **`figma_sync_status` の retro レポート扱い**: `pipeline-state.json.screens.step25e.figma_sync_status` を Read し、値に応じて retro レポートに sub-state Figma 同期状態を集計:
   - `complete` (通常完了 or `skipped_stub_mode`) → 「Sub-state Figma 同期: 完了」と表示
   - `partial` → 通常は entry gate で `completed_at_states` が立たないため retro 不到達。万一立っていた場合は「Sub-state Figma 同期: 部分完了 (deferred 残あり、resume 推奨)」と警告
   - `skipped_by_user` → 「Sub-state Figma 同期: ユーザー判断でスキップ (Option 2 escalation 経路)。Phase 5 delta は sub-state を扱わない経路で動作する」と明記。retro 提案の中で「Figma MCP 障害再発防止策」を改善候補に含めるよう Phase C に hint を与える
   - `null` / 未設定 → 「Sub-state Figma 同期: 適用外 (sub-state 未生成 or legacy run)」

## Execution

Read and execute `skills/26-retro/SKILL.md`.

This step includes the following phases:
- Phase 0: Deliverables review + final approval gate (request approval via AskUserQuestion)
- Phase A: Learning collection
- Phase B: Pattern analysis
- Phase C: Improvement proposal generation (max 10)
- Phase D: Numeric summary display
- Phase E: Human approval per proposal
- Phase F: Apply approved proposals to `skills/NN-*/SKILL.md`
- Phase G: Review
- Phase H: Report generation (`artifacts/pipeline-improvements.md`)
- Phase I: Memory + history update (`user/AYATORI_MEMORY.md`, `artifacts/history/{app_name}-summary.md`, `artifacts/history/index.md`)

## Completion

After completion:
- Use AskUserQuestion to present the next step:
  > "Phase 4 (Retro) complete. Deliverables are in `artifacts/`, pipeline improvement report is in `artifacts/pipeline-improvements.md`."
  > Option 1: "Start a new project"
  > Option 2: "End here for now"

When Option 1 is selected: run `pwd` via Bash to get `{repo_root}`, then display:
```
✅ Pipeline complete。新しいプロジェクトを開始するには、以下をコピーして新しい会話に貼り付けてください:

/ayatori-question をお願いします。作業ディレクトリ: {repo_root}
```

When Option 2 is selected: display:
```
Artifacts saved in `artifacts/{app_name}/`. お疲れ様でした。
```
