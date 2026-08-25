---
name: ayatori-delta-mini
description: "Phase 6: delta / req-delta 実行後の軽量振り返り。Pattern A/B/C を集計し、改善提案を artifacts/pipeline-improvements.md (artifacts/ 直下・全プロジェクト共有) へ追記する。entry: 完走済 or ベースライン承認済み + 未処理 run あり。"
---

# /ayatori-delta-mini — Phase 6: Delta / Req-Delta Mini-Retro

## Purpose

完走済プロジェクトで実行された `/ayatori-delta` (Phase 5) や `/ayatori-req-delta` (Phase 1c) の振り返りを行う軽量 retrospective。Phase 4 retro (`/ayatori-retro`) と対称な独立 phase として動作する。

**Entry condition**: Phase 5 と同じ完了条件 (`pipeline-state.json.approvals.final_approved == true` OR `pipeline-state.json.approvals.completed_at_states is set`、二段階完了モデル、OR (`baseline_approved_at` is set AND `requirements.json.status == "REVERSE_ENGINEERED"` — reverse 基線例外 + 由来検査)) AND pending run が存在する。基線プロジェクトを accept する理由: Phase 5 delta を基線で開ける以上、その run の振り返り (改善ループ) も同じ資格で回せないと、基線プロジェクトの delta 運用データだけが改善ループから漏れる。本 phase は画面 HTML を読まない (run 記録 + feedback-log のみ) ため材料不足の懸念もない。

**Pending run の定義**:
- `delta.runs[]` または `req_delta.runs[]` に **`mini_retro_completed_at` が未 set** のエントリが 1 件以上あること。

**Scope B** (covers both phases):
- Phase 5 delta の steps **27 / 28 / 29 / 30** 由来エントリ
- Phase 1c req_delta の steps **31 / 32 / 33** 由来エントリ

両 phase の retro gap を一括解決する設計。

---

## Preamble

1. Read `pipeline.yaml` to confirm phase configuration. If `skip_phases` includes `"delta_mini"`: display "⏭ delta_mini フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/` and determine `{app_name}`.
4. Read `artifacts/{app_name}/pipeline-state.json` (or treat as `{}` if absent). **Entry guard** (CLAUDE.md § 完走後 Phase 共通 Entry Guard 参照 — Phase 6 は `baseline_approved_at` も accept する例外つき): 共通判定を実施する:
   - `approvals.final_approved == true` OR `approvals.completed_at_states` is set → 通過 (従来の完走済ルート)。
   - `approvals.baseline_approved_at` is set だが `requirements.json.status != "REVERSE_ENGINEERED"` → **通過させず下の exit 分岐に落とす** (forward 経路プロジェクトに基線印が立っている状態は誤操作。判定の SoT = CLAUDE.md § 完走後 Phase 共通 Entry Guard の「由来検査」)。
   - 上記が無く `approvals.baseline_approved_at` is set **かつ** `requirements.json.status == "REVERSE_ENGINEERED"` (由来検査 — 本例外は reverse 経路専用) → 通過し、announce を表示: "📋 {app_name} | reverse 基線モード (baseline_approved_at で入場、由来: {baseline_approved_via ?? "記録なし"})"
   - いずれも無い → 次のメッセージを表示して exit: "⚠️ このプロジェクトはまだ Phase 3 が完了していません。`/ayatori-screens` を先に完了してから `/ayatori-delta-mini` を実行してください。reverse 基線プロジェクトの場合はベースライン承認印 (baseline_approved_at) が立ってから実行できます。"
5. Build the pending run lists:
   ```
   pending_delta    = [r for r in pipeline_state.delta.runs if "mini_retro_completed_at" not in r]
   pending_req_delta = [r for r in pipeline_state.req_delta.runs if "mini_retro_completed_at" not in r]
   ```
6. If both lists are empty:
   - Display:
     ```
     ✅ Phase 6 mini-retro 対象なし

     すべての delta / req_delta runs は振り返り済みです。
     新たに /ayatori-delta または /ayatori-req-delta を実行した後で再度 /ayatori-delta-mini を起動してください。
     ```
   - **Exit phase**. Do not proceed to Step 34.
7. **Pending runs を表示** (ユーザーに retrospect 対象を見せる):
   ```
   【Phase 6 mini-retro 対象】

   Delta runs (pending):     {len(pending_delta)} 件
     - {run_id} / {initiated_at} / {change_description}
     ...
   Req-delta runs (pending): {len(pending_req_delta)} 件
     - {run_id} / {initiated_at} / {change_description}
     ...

   feedback-log.md と上記 pending runs を対象に軽量 retrospective を実行します。
   ```

---

## Execution

### Step 34: Delta / Req-Delta Mini-Retro

Read and execute `skills/34-delta-mini-retro/SKILL.md`.

Phase A (trigger 判定 + marker filter + step 27-33 filter + 0 件分岐) → B (パターン分析) → C (改善提案生成、上限 5 件) → D (数値サマリ) → E (inline 承認ゲート: E-1 提案表示 → E-2 一括/個別/全件却下択一 → E-3 個別指示はチャット) → F (提案 append + SKILL.md Edit 適用 + marker 書き込み + pending 全 run の mini_retro_* 更新) → G (レビュー表示)。

**Human gate** (条件付き):
- Pattern 検出 0 件 → 1 度だけ skip 確認 (Recommended: Skip)
- Pattern 検出 1 件以上 → 改善提案表示 → 一括承認 / 個別指示 / 全件却下

---

## Completion

After Step 34 completes (skip path / 全件却下 path / 承認 append path のいずれでも `mini_retro_completed_at` が pending 全 run に set される):

Display:
```
✅ Phase 6 mini-retro 完了

   対象 runs: delta {n_delta} 件 / req_delta {n_req} 件
   検出 Pattern: A={N_A} / B={N_B} / C={N_C} (合計 {total} 件)
   改善提案: {M} 件生成 / 承認 {approved} 件 / 却下 {rejected} 件
   出力先: artifacts/pipeline-improvements.md (承認件数 > 0 のみ)
```
