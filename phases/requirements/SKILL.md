---
name: ayatori-requirements
description: "Phase 1b: ISO 29148 requirements definition. Structuring → rubric generation → scoring → loop control → Confluence save → human approval."
---

# /requirements — Phase 1b (Steps 02~07)

## Preamble

1. Read `pipeline.yaml` to confirm Phase configuration and loop thresholds. If `skip_phases` includes `"requirements"`: display "⏭ requirements フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/` and determine `{app_name}`
4. Read `artifacts/{app_name}/requirements.json` to confirm project info (INPUT only — `confluence_parent_id` etc.). If absent, Step 02 can still start from `artifacts/{app_name}/requirements/00-raw-input.md` alone (Phase 1a normally writes `requirements.json`).
   - **If `requirements.json.status == "REVERSE_ENGINEERED"`**: this project came from `/ayatori-reverse`. Skip Steps 02–07 entirely and jump directly to Completion below.
5. Read `artifacts/{app_name}/scoring-history.json` (loop history) if it exists. Derive: `attempts = scoring-history.json.attempts`, `attempt_count = len(attempts)`, `current = attempts[-1] if attempts else None`, `total = current.total if current else 0`, `human_required_count = current.human_required_count if current else 0`.
6. Read `artifacts/{app_name}/pipeline-state.json` (cross-phase hot state) if it exists. Derive: `step07_approved_at = pipeline-state.approvals.step07_approved_at`, `confluence_save_status = pipeline-state.confluence.requirements.save_status`.
6b. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = 7 / `gate_before_step` = 02
   - `target_artifacts` = `"requirements.json"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (prose を渡すと path 形でない token として drop される)
   - `append_sources` = 本 phase 内 skill (02。07 は born-resolved 記録のみ)
7. Read `artifacts/{app_name}/rubric.json` (criteria-only file, INPUT to scoring) if it exists.
8. Read `pipeline.yaml → requirements.loop.per_axis_min` (default 12) and `pipeline.yaml → requirements.loop.max_attempts` (default 3). Compute `axis_min_ok` / `escalated` with a `current is None` guard (初回進入時 / Step 03 未実行 / `attempts: []` 初期化直後は `current = None` のまま L18 に到達するため `current.scores` を直接参照すると AttributeError で落ちる):
   - `current is None` の場合: `axis_min_ok = False`、`escalated = False`
   - それ以外: `axis_min_ok = all(current.scores[axis] >= per_axis_min for axis in ["correctness", "unambiguity", "completeness", "consistency", "feasibility"])`、`escalated = (attempt_count >= max_attempts AND (total < 80 OR not axis_min_ok))`
9. Determine resume position (evaluate top-to-bottom, first match wins):
   - `step07_approved_at` is set → Phase 1b complete → proceed directly to Completion
   - `escalated` OR `human_required_count >= 1` → jump to Step 07 (escalation; skip Steps 02–06)
   - `rubric.json` does not exist (Step 03 未実行), or `scoring-history.json.attempts` is empty (Step 04 未実行) → start from Step 02
   - (`total` < 80 OR not `axis_min_ok`) and `attempt_count` < `max_attempts` → re-execute loop from Step 02
   - `total` >= 80 and `axis_min_ok` and `confluence_save_status` != "success" → resume from Step 06
   - `confluence_save_status` == "success" → resume from Step 07

> **Artifact responsibility (本 Phase で書き込むファイル)**:
> - `rubric.json` ← Step 03 のみが書く (criteria 定義、ループ不変量)
> - `scoring-history.json` ← Step 04 が attempt ごとに append (loop history)
> - `pipeline-state.json` ← Step 06 (`confluence.requirements.*`) と Step 07 (`approvals.step07_approved_at`) が書く
> - `requirements.json` には書かない (INPUT 専用)

## Execution

Execute Steps in the following order:

### Step 02: ISO 29148 Requirements Structuring
Read and execute `skills/02-iso-breakdown/SKILL.md`.

### Step 03: Rubric Generation
Read and execute `skills/03-rubric-gen/SKILL.md`.

### Step 04: AI Scoring
Read and execute `skills/04-scoring/SKILL.md`.

### Step 05: Loop Control
Read and execute `skills/05-loop-req/SKILL.md`.
Loop logic (thresholds from `pipeline.yaml` → `requirements.loop`, score_file = `scoring-history.json`):
- All evaluations target `attempts[-1]` (last entry of `scoring-history.json.attempts`).
- `total` >= 80 AND all axes >= `per_axis_min` AND `human_required_count` == 0 → proceed to Step 06
- `len(attempts)` >= `max_attempts` → escalation → proceed to Step 07
- `human_required_count` >= 1 → escalation → proceed to Step 07
- Otherwise → go back to Step 02 (Step 04 will append a new attempt on the next pass)

### Step 06: Confluence Save
Read and execute `skills/06-confluence-save-req/SKILL.md`.
保存後に read-back 漏れチェック (skill 06 Step 3.5、パラメータ SoT = `pipeline.yaml → requirements.confluence_save.verification`) を実行する。漏れ検出時 (`verification.status == "failed"`) は `save_status = "failed"` が記録されるため、上記 Preamble の resume 判定 (`confluence_save_status != "success"` → Step 06 再実行) がそのまま再保存の再試行経路になる。read-back 不可で検証できない場合は `unverified` として fail-open (`save_status = "success"` 維持 + 目視確認の警告表示、skill 06 Step 4 参照)。

### Step 07: Human Approval Gate
Read and execute `skills/07-human-gate-req/SKILL.md`.

## Completion

After approval:
- Use AskUserQuestion to present the next step:
  > "Phase 1b (Requirements) complete. Would you like to proceed to the next step?"
  > Option 1: "Proceed to `/ayatori-design`"
  > Option 2: "End here for now"

When Option 1 is selected: run `pwd` via Bash to get `{repo_root}`, then display:
```
✅ Phase 1b complete。次のセッションを開始するには、以下をコピーして新しい会話に貼り付けてください:

/ayatori-design をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```

When Option 2 is selected: display:
```
Artifacts saved in `artifacts/{app_name}/`. 再開するには新しい会話で次を貼り付けてください:

/ayatori-design をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```
