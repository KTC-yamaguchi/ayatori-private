---
name: 00-early-exit
description: retro フェーズに到達する前にセッションが終了した場合、feedback-log.md から得た学びを artifacts/pipeline-improvements.md に退避し、メモリと履歴を保存する。旧 CLAUDE.md ルール 10 相当で、失われる知見を保全する。
---

# 00: Early Exit Handler

## Role
Capture learnings when a session ends before reaching the retro phase.
Equivalent to the old CLAUDE.md rule 10 — preserves knowledge that would otherwise be lost.

## Execution

### Step 1: Append to `artifacts/pipeline-improvements.md`

Read `artifacts/{app_name}/feedback-log.md`.

Extract entries that reveal pipeline design flaws or AI-preventable mistakes (Pattern B and C).
Append them to `artifacts/pipeline-improvements.md`:
- Design flaws / recurring constraints → under `## アクティブ技術制約`
- Handoff items for the next run → under `## 次回パイプラインへの引き継ぎ事項`

If `feedback-log.md` is empty or does not exist: skip this step and note it.

### Step 2: Save memory and history

Read and execute `skills/00-memory-write/SKILL.md`.

If the pipeline did not reach retro, some fields will be unavailable — write what exists and
mark incomplete fields explicitly as "（未完了 — 早期終了のため）" so the next session
knows the data is partial rather than missing.
