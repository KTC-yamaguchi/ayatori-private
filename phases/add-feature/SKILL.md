---
name: ayatori-add-feature
description: "Phase 1d: 完走済プロジェクトへの機能追加要望を 7 軸ヒアリングで要件化し、change-manifest.json を生成して Phase 1c→5 へ接続する。entry: 完走済 or ベースライン承認済み (Entry Guard 準拠)。"
---

# /ayatori-add-feature — Phase 1d: Add-Feature Hearing

## Purpose

完走済プロジェクト (条件は CLAUDE.md § 完走後 Phase 共通 Entry Guard 参照) に機能追加要望が来たとき、要件ヒアリングをスキップせず Phase 1a 相当の深掘りを行う。

> **入口について**: 完成後の変更の単一入口は `/ayatori-delta`。本ヒアリング (Step 01b) は `/ayatori-delta` の「機能追加を起点」モード (Step 27f) からも同一に起動でき、`/ayatori-add-feature` はそのヒアリングへの直接入口として同じ結果 (`source: "skill-01b"` の change-manifest) を生成する。

**Entry condition**: 完走済プロジェクト (`final_approved == true` OR `completed_at_states` is set) またはベースライン承認済みの reverse 基線プロジェクト (`baseline_approved_at` is set **AND** `requirements.json.status == "REVERSE_ENGINEERED"`)。CLAUDE.md § 完走後 Phase 共通 Entry Guard が SoT (Phase 1d / 5 / 6 限定の reverse 基線例外と、その由来検査を含む)

**Typical trigger**: 「アンドゥ機能を追加したい」「BLE 対戦を入れたい」「履歴機能が欲しい」等の追加要望

---

## Preamble

1. Read `pipeline.yaml` to confirm phase configuration. If `skip_phases` includes `"add_feature"`: display "⏭ add-feature フェーズをスキップします" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/` and determine `{app_name}`.
4. Read `artifacts/{app_name}/pipeline-state.json` (or `{}` if absent).
5. **Entry guard** (CLAUDE.md § 完走後 Phase 共通 Entry Guard 参照 — Phase 1d は `baseline_approved_at` も accept する例外つき): 共通判定を実施する:
   - `approvals.final_approved == true` OR `approvals.completed_at_states` is set → 通過 (従来の完走済ルート)。
   - 上記が無く `approvals.baseline_approved_at` is set **かつ** `requirements.json.status == "REVERSE_ENGINEERED"` (由来検査 — 本例外は reverse 経路専用) → 通過し、announce を表示: "📋 {app_name} | reverse 基線モード (baseline_approved_at で入場、由来: {baseline_approved_via ?? "記録なし"}。final_approved 系の印はありません)"
   - `approvals.baseline_approved_at` is set だが `requirements.json.status != "REVERSE_ENGINEERED"` → **通過させず下の exit 分岐に落とす** (forward 経路プロジェクトに基線印が立っている状態は誤操作。判定の SoT = CLAUDE.md § 完走後 Phase 共通 Entry Guard の「由来検査」)
   - いずれも無い → 以下のメッセージを表示して exit:
   > ⚠️ 本コマンドは完走済プロジェクト (Phase 3 final_approved もしくは sub-state 含む完全完了 completed_at_states)、またはベースライン承認済みの reverse 基線プロジェクト (baseline_approved_at) 用です。新規プロジェクトは `/ayatori-question` から開始してください。Phase 3 未完なら `/ayatori-screens` を続行してください。reverse 直後の要件手直しは `/ayatori-req-delta` が使えます (機能追加はベースライン承認後)。
6. **Existing manifest check**: `artifacts/{app_name}/req-delta/change-manifest.json` が既に存在し `source == "skill-01b"` の場合 (manifest の `run_id` を元に `pipeline-state.json.req_delta.runs[]` から **manifest と一致する run** を look-up し、その run state で分岐する。「最新 run」ではなく必ず run_id 一致で探索すること):
   - **一致する run が無い** → 「⚠️ manifest は存在しますが `pipeline-state.json` に該当 run の stub がありません。`skill-01b` 異常終了の可能性があります。`/ayatori-add-feature` を再実行してください。」を表示して exit (manifest 上書きはしない)
   - **`revisions_approved_at` 設定済** (前回の add-feature → req-delta が完了) → 「前回の機能追加 run ({run_id}) は完了済みです。新しい機能追加を開始しますか?」を AskUserQuestion で確認。Yes なら既存 manifest を退避 (`change-manifest.json.bak-{prev_run_id}` に rename) して新 run を開始、No なら exit
   - **`cancelled_at` 設定済** (前回 run はユーザーが中止 or design_system_required で停止) → 「前回 run ({run_id}) はキャンセル済みです (理由: {cancel_reason})。新しい機能追加を開始しますか?」を AskUserQuestion で確認。Yes なら既存 manifest を退避して新 run を開始、No なら exit
   - **それ以外 (= incomplete; `revisions_approved_at` も `cancelled_at` も未設定)** → 「未完了の機能追加 run ({run_id}) があります。`/ayatori-req-delta` の resume に委譲します。続行してください。」を表示して exit。**この case では絶対に新 run で上書きしない** (in-progress run の orphan 化を防ぐ)

---

## Execution

### Step 01b: Add-Feature Hearing
Read and execute `skills/01b-add-feature-question/SKILL.md`.

7 軸のヒアリング (機能スコープ / UC / ハードウェア要件 / NFR / データ定義 / 既存機能との関係 / フェーズ整合性) を実施し、`change-manifest.json` を `source: "skill-01b"` 付きで生成する。

ヒアリング結果は ISO 29148 8 観点に decompose され、`requirement_changes[]` に複数 entry として記録される。フェーズ整合性検証 (Axis 7) では既存文書の "Phase 2 / 将来検討 / Won't / v1 対象外" 記述を grep ベースで探索し、新機能と矛盾する箇所を `type: removed | modified` の entry として manifest に追加する。

---

## Completion

01b 完了後、以下を表示:

```
✅ 機能追加ヒアリング完了
   追加機能: {feature_name}
   change-manifest.json に {N} 件の requirement_changes を記録
   directly_changed_docs: {list}
   フェーズ整合性: {M} 件の矛盾検出 (manifest に removed/modified として記録済)

📋 次のステップ (新しい会話で実施):
   1. /ayatori-req-delta — 8 ISO 29148 文書への整合性ある反映 (Step 31 は自動 skip)
   2. /ayatori-delta — UI / Figma への反映
```

AskUserQuestion で次手選択:
- Option A: "終了 (/ayatori-req-delta は別会話で)" — Artifacts saved. End session
- Option B: "そのまま /ayatori-req-delta を続けて実行" — 同会話で `/ayatori-req-delta` の Preamble に進む (skill 31 は自動 skip、Step 32 から start)

> **設計判断**: Option B は同一会話で 1c へ続けるパス。長時間化リスクはあるが、ヒアリング結果が context に残っている状態で 32/33 を走らせると LLM の判断品質が高い。短いプロジェクトなら推奨。Option A は責務分離優先 (Phase 1d 完了 → 別会話で 1c) で、Phase 別会話運用フロー (`user/AYATORI_MEMORY.md` 参照) と整合する。
