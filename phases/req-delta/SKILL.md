---
name: ayatori-req-delta
description: "Phase 1c: 要件レベルの仕様変更を ISO 29148 の 8 文書へ伝播する (検出→影響分析→改訂案→人間承認)。主に UI 生成前向けで、完成後プロジェクトでは原則 /ayatori-delta へ誘導する。entry: step07 承認済み。"
---

# /ayatori-req-delta — Phase 1c: Requirements Delta

## Purpose

When requirement documents exist but UI has not yet been generated, and a specification change occurs, this phase propagates the change consistently across all affected ISO 29148 documents. AYATORI generates revision proposals for each impacted document and applies them only after human approval.

**Entry condition**: `pipeline-state.json.approvals.step07_approved_at` is set.

**Typical trigger**: A new user type, role separation, flow restructure, or feature scope change that ripples across multiple requirement documents.

---

## Preamble

1. Read `pipeline.yaml` to confirm phase configuration. If `skip_phases` includes `"req_delta"`: display "⏭ req-delta フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/` and determine `{app_name}`.
4. Read `artifacts/{app_name}/pipeline-state.json` (or treat as `{}` if absent). If `approvals.step07_approved_at` is NOT set:
   - `artifacts/{app_name}/requirements.json` が存在し `status == "REVERSE_ENGINEERED"` の場合 (= reverse 成果はあるが、Completion の自動押印が入る前に完走した遺産プロジェクト。全遺産が押印済みになれば本分岐は削除可): display "⚠️ reverse 成果を検出しましたが要件承認印がありません。`/ayatori-reverse` を再実行すると Completion が承認印 (approvals.step07_approved_at) を記録します（Phase 0b 完走済みなら通常は数分で済みます。Step 07 の Confluence 保存が未完なら、そちらが先に走ります。未解決の確認事項 [pending-questions] が残っている場合は、再実行の入口で先にまとめて確認されます。手動 stub でも同じ印を立てられます — CLAUDE.md「Standalone Phase 実行」参照）。" and exit. **`/ayatori-requirements` へ誘導しないこと** — `phases/requirements/SKILL.md` の Preamble は REVERSE_ENGINEERED プロジェクトで Steps 02〜07 を skip して Completion へ直行するため、誘導に従っても押印されず行き止まる (成果物は壊れないが問題も解決しない)。
   - Otherwise: display "⚠️ Phase 1b（要件定義）が未完了です。`/ayatori-requirements` を先に完了してから `/ayatori-req-delta` を実行してください。" and exit.
5. **完走後ガード (入口ルーティング)**: `approvals.screens_human_approved == true` または `approvals.final_approved == true` または `approvals.completed_at_states` が set のとき（= UI 生成済み）は、以下で分岐する:
   - **例外 (正規ハンドオフ)**: `artifacts/{app_name}/req-delta/change-manifest.json` が存在し `source == "skill-01b"` の場合は、`/ayatori-add-feature`（Phase 1d）または `/ayatori-delta` の「機能追加」モードからの正規ハンドオフなので、本ガードを skip して step 6 へ進む。
   - それ以外は、完走後の変更の単一入口は `/ayatori-delta` であり `/ayatori-req-delta` の直接起動は誤用の可能性が高いため、AskUserQuestion で変更の起源を確認して分岐する:
     ```
     question: "このプロジェクトは既に UI が生成済みです。何を変更しますか?"
     options:
       - label: "画面 HTML を手修正した"
         description: "パイプライン外で手編集した画面を画面仕様へ反映したい"
       - label: "機能を追加したい"
         description: "新しい機能を追加する（要件・画面ともに更新）"
       - label: "要件文書だけを直したい"
         description: "UI は変更しない。要件文書のみの修正（誤字・表現・制約の調整など）"
       - label: "終了"
         description: "何もせず終了する"
     ```
     - "画面 HTML を手修正した" → 「UI 手修正の反映は `/ayatori-delta` の screen-edit モード（Mode Selection で「画面編集を起点」）が担当します。新しい会話で `/ayatori-delta` を実行してください。」と表示して **exit**。
     - "機能を追加したい" → 「完走後の機能追加は `/ayatori-delta` の「機能追加」モードから行います。新しい会話で `/ayatori-delta` を実行してください。」と表示して **exit**。
     - "要件文書だけを直したい" → 「要件文書のみを更新します（UI/Figma には反映されません）。」と表示して **continue**（step 6 へ）。
     - "終了" → end phase。
5b. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = 6 / `gate_before_step` = 31
   - `target_artifacts` = `"requirements.json,requirements/*.md"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (prose を渡すと path 形でない token として drop される)
   - `append_sources` = 本 phase 内 skill (31)
6. Read `artifacts/{app_name}/req-delta/change-manifest.json` if it exists.
   - If it does **not** exist → start from Step 31.
   - If it exists: **verify** `change-manifest.json.app_name` matches resolved `{app_name}`. If they differ, display: "⚠️ change-manifest.json の app_name が現在のプロジェクトと一致しません。" and exit.
   - **Skill 01b handoff detection**: `change-manifest.json.source == "skill-01b"` の場合は、`/ayatori-add-feature` で manifest が既に生成済のため **Step 31 (change-detect) を完全にスキップ** し、Step 32 から start する。表示: "🔗 /ayatori-add-feature 経由で生成された change-manifest を検出 (run_id={run_id})。Step 31 を skip し Step 32 から開始します。"
   - Look up its `run_id` in `pipeline-state.json.req_delta.runs[]`:
     - Entry found AND `revisions_approved_at` **is set** → previous run complete. Display "前回の Req-Delta 実行（{run_id}）は完了済みです。新しい変更を入力してください。" and **proceed to Step 31** (new run).
     - Entry found AND `revisions_approved_at` **not set** AND `cancelled_at` **not set** → incomplete run; use resume logic below (skill 01b 由来の場合も同じ resume logic、Step 31 へのフォールバックは取らない)
     - Entry found AND `cancelled_at` **is set** → previous run cancelled. Display "前回の Req-Delta 実行（{run_id}）はキャンセルされました（理由: {cancel_reason}）。" and **proceed to Step 31** (new run).
     - Entry **not found** → proceed to Step 31 to restart that run. (skill 01b 由来の manifest なのに run stub が無い場合は 01b が異常終了した状態。**Step 31 にフォールバックせず**「⚠️ skill 01b の manifest が pipeline-state.json と整合していません。`/ayatori-add-feature` を再実行してください。」と表示して exit)

**Resume logic** (only for incomplete runs; uses `pipeline-state.json` already loaded in preamble step 4; first match wins):

**Step 0: Stale artifact guard** — Before applying any resume rule, verify that a pre-existing `req-delta/doc-impact-analysis.md` belongs to the current run. The skill 01b handoff path is repeatable per run, but req-delta artifacts are not auto-archived between runs, so a previous run's `doc-impact-analysis.md` can otherwise be misread as "resume this incomplete run" and flow stale F-N analysis into the F-N+1 human gate as a silent false-positive.

- If `artifacts/{app_name}/req-delta/doc-impact-analysis.md` exists:
  - Read its header and extract the `Run ID: {prev_run_id}` line (written by Step 32 Step 4 template — header is e.g. `Run ID: 2026-05-26-001  |  Date: ...`).
  - Compare with the current `change-manifest.json.run_id`.
  - **Match** → proceed to the resume rules below.
  - **Mismatch (or `Run ID:` line absent / malformed)** → previous run's artifacts were not archived. Rename each of the following to `*.bak-{prev_run_id}` (use `prev-unknown` when the header is missing): `doc-impact-analysis.md`, `cross-reference-integrity-report.md`, `phase-consistency-report.md`. Then **skip the resume rules below and start from Step 32 Step 1** (fresh analysis for the current run).

After the stale guard:
- `artifacts/{app_name}/req-delta/doc-impact-analysis.md` exists AND `pipeline-state.json.req_delta.runs[-1].impact_approved_at` is set → resume from Step 33
- `artifacts/{app_name}/req-delta/doc-impact-analysis.md` exists AND `impact_approved_at` **not** set → resume at Step 32 Step 5 only (gate — analysis already written, skip re-analysis)
- Otherwise → resume from Step 32

---

## Execution

### Step 31: Requirements Change Detection
Read and execute `skills/31-req-change-detect/SKILL.md`.

Accepts human-provided change description + selected requirement docs. Produces `req-delta/change-manifest.json` and snapshots the full requirement doc set.

### Step 32: Cross-Document Impact Analysis
Read and execute `skills/32-req-impact-analysis/SKILL.md`.

Traces the change across all 8 ISO 29148 documents using a dependency map. Classifies each document as `directly_changed`, `impacted`, or `preserved`. **Human gate** — scope confirmed before any revisions are written.

### Step 33: Requirements Revision + Apply
Read and execute `skills/33-req-revision/SKILL.md`.

Generates revision proposals for each directly_changed and impacted document. Presents proposals to the user for review. On approval, writes updated documents and optionally updates Confluence.

---

## Completion

After Step 33 approval:

Display:
```
✅ Req-Delta 実行完了 ({run_id})
   変更: {change_description}
   直接変更: {N_directly_changed} 件 / 波及更新: {N_impacted} 件 / 維持: {N_preserved} 件
```

If `screens_human_approved == true` or `final_approved == true`:
> 📋 **UI/Figma への反映**: この変更を UI と Figma にも反映するには、新しい会話で `/ayatori-delta` を実行してください。

Else if `baseline_approved_at` is set AND `requirements.json.status == "REVERSE_ENGINEERED"` (reverse 基線プロジェクト — ベースライン承認済み。由来検査は誘導先 `/ayatori-delta` の Entry Guard と同条件にする — 通らない先を案内しないため):
> 📋 **画面への反映**: この変更を画面へ反映するには、新しい会話で `/ayatori-delta` (要件変更を起点) を実行してください。(画面基盤 [遷移図等] が未生成の間は開始前の材料検査で停止します — `/ayatori-screens` の「基線確立 (screens-lite)」ルートで整えてから再実行してください)

Else if `requirements.json.status == "REVERSE_ENGINEERED"` (reverse 基線プロジェクト — UI 生成前):
> 📋 **次のステップ**: 要件の手直しが済んだら、新しい会話で `/ayatori-design` から UI 生成に進んでください。

Use AskUserQuestion:
- Option A: "終了" — Artifacts saved. End session.
- Option B: "別の変更を続けて入力" — 同じセッションで次の req-delta run を開始する（Step 31 に戻る）
