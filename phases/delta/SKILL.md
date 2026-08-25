---
name: ayatori-delta
description: "Phase 5: 完成後変更の単一入口。requirement (要件変更の伝播) / screen-edit (手編集 HTML の逆伝播・要件昇格) / feature-add (機能追加) の 3 モードで、影響のある画面・Figma フレームだけを再生成し、無関係な画面には触れない。entry: 完走済 or ベースライン承認済み。"
---

# /ayatori-delta — Phase 5: Delta Update

## Purpose

When a completed project (docs + UI + Figma all done) receives a requirements change, this phase propagates it end-to-end without a full rebuild. Only affected screens are regenerated; the existing design system and preserved screens are left intact.

**3 つの起点モード** (入口の Mode Selection で選ぶ。完成後の変更はすべてこの単一入口から入る):
- **要件変更起点 (requirement)** — 要件ドキュメントの変更を画面へ伝播する従来フロー: Step 27 → 28 → 29 → 30。
- **画面編集起点 (screen-edit)** — 完成後にパイプライン外で手編集された画面 HTML を起点に、該当画面のみ採点し HTML→画面仕様書 (.md) / coverage / nav へ**逆伝播**する逆方向フロー: **Step 27b → 29b → (29c) → 30**（scope は 27b で確定済のため Step 28 は経由しない。29b の逆方向監査が編集 diff を要件文書と突合し、ゲートで「要件に昇格」に選ばれた逸脱があれば **Step 29c が `requirements/*.md` へ反映** [`requirements.json` は不変]、無ければ 29c は skip。Step 30 は必ず経由し、Figma 実在時のみフレームを更新、不在 / zero-scope 時は Step 30 Fallback が追加ゲートなしで figma_status を記録して完了）。`change-manifest.json.source == "screen_edit"` / `delta.runs[].mode == "screen_edit"` で識別する。
- **機能追加起点 (feature-add)** — 完成後に新機能を追加する。7 軸ヒアリング（Phase 1d と同一）で要件化し、要件文書への反映（`/ayatori-req-delta`）→ UI/Figma への反映（要件変更モード）へ接続する: **Step 27f**（ヒアリングのみ実施し、要件文書・UI への反映は後続コマンドへ委譲するため delta の 28/29/30 は経由しない）。

**Entry condition**: `pipeline-state.json.approvals.final_approved == true` OR `pipeline-state.json.approvals.completed_at_states` is set (二段階完了モデル: main 完了のみ / sub-state 含む完全完了のどちらでも起動可) OR (`pipeline-state.json.approvals.baseline_approved_at` is set **AND** `requirements.json.status == "REVERSE_ENGINEERED"`) (reverse 基線プロジェクト — CLAUDE.md § 完走後 Phase 共通 Entry Guard の Phase 1d / 5 / 6 限定例外と由来検査)

**Typical trigger**: A feature scope change, new user type, flow restructure, or removed functionality that impacts a subset of screens.

---

## Preamble

1. Read `pipeline.yaml` to confirm phase configuration. If `skip_phases` includes `"delta"`: display "⏭ delta フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/` and determine `{app_name}`.
4. Read `artifacts/{app_name}/pipeline-state.json` (or treat as `{}` if absent). **Entry guard** (CLAUDE.md § 完走後 Phase 共通 Entry Guard 参照 — Phase 5 は `baseline_approved_at` も accept する例外つき): 共通判定を実施する:
   - `approvals.final_approved == true` OR `approvals.completed_at_states` is set → 通過 (従来の完走済ルート)。
   - `approvals.baseline_approved_at` is set だが `requirements.json.status != "REVERSE_ENGINEERED"` → **通過させず下の exit 分岐に落とす** (forward 経路プロジェクトに基線印が立っている状態は誤操作。判定の SoT = CLAUDE.md § 完走後 Phase 共通 Entry Guard の「由来検査」)。
   - 上記が無く `approvals.baseline_approved_at` is set **かつ** `requirements.json.status == "REVERSE_ENGINEERED"` (由来検査 — 本例外は reverse 経路専用) → 通過し、`{baseline_mode} = true` を set。画面基盤を**実測**して announce を表示する (キーの有無から材料を推測しない — 材料の有無は実在検査が正): `ls artifacts/{app_name}/screens/00-transition-map.mmd` と `ls artifacts/{app_name}/screens/{web,web-sm,mobile}/*.html` を確認し、
     "📋 {app_name} | reverse 基線モード (baseline_approved_at で入場、由来: {baseline_approved_via ?? "記録なし"})。画面基盤の実測: 遷移図 {有/無} / 画面 HTML {N} 件"
   - いずれも無い → 次のメッセージを表示して exit: "⚠️ このプロジェクトはまだ Phase 3 が完了していません。`/ayatori-screens` を先に完了してから `/ayatori-delta` を実行してください。reverse 基線プロジェクトの場合はベースライン承認印 (baseline_approved_at) が立ってから実行できます。"
4b. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = 5 / `gate_before_step` = 27 (screen-edit モードは 27b)
   - `target_artifacts` = **モードで 1 つ選び、選んだリテラルをそのまま** (b) の `--target-artifacts` に渡す (prose や 2 つの連結を渡すと path 形でない token として drop される):
     - requirement モード / feature-add モード → `"requirements.json,requirements/*.md"`
     - screen-edit モード → `"screens/*.md,requirements/*.md"` (後者は 29c 昇格時の受け皿)
   - `append_sources` = 本 phase 内 skill (27 / 29b / 29c)
5. Read `artifacts/{app_name}/delta/change-manifest.json` if it exists.
   - If it does **not** exist → **go to Mode Selection** (below) for a new run.
   - If it exists: **verify** `change-manifest.json.app_name` matches the resolved `{app_name}`. If they differ, display: "⚠️ change-manifest.json の app_name（{manifest_app_name}）が現在のプロジェクト（{app_name}）と一致しません。正しいプロジェクトディレクトリで実行しているか確認してください。" and exit.
   - Determine the run mode: `delta.runs[-1].mode` (absent ⇒ `"requirement"`、後方互換)。`change-manifest.json.source == "screen_edit"` も screen-edit を示す。
   - Then look up its `run_id` in `pipeline-state.json.delta.runs[]`.
     - Entry found AND the run is **complete** (`mode != "screen_edit"` なら `figma_approved_at` set / `mode == "screen_edit"` なら `figma_approved_at` set OR `figma_status` set — Figma 実在時は Step 30 承認、不在時は figma_status skip で完了) → previous run complete. Display "前回のDelta実行（{run_id}）は完了済みです。新しい変更を入力してください。" and **go to Mode Selection** (new run — do not exit).
     - Entry found AND incomplete AND `cancelled_at` **not set** → incomplete run in progress; use **Resume logic** below.
     - Entry found AND `cancelled_at` **is set** → previous run was intentionally cancelled. Display "前回のDelta実行（{run_id}）はキャンセルされました（理由: {cancel_reason}）。新しい変更を入力してください。" and **go to Mode Selection** (new run).
     - Entry **not found** (manifest written but pipeline-state stub missing) → **go to Mode Selection** to restart that run.

**Mode Selection** (choose the delta mode for a new run):
Read `artifacts/{app_name}/delta/edited-screens.json` if it exists and count entries with `consumed_by_run == null` as `N` (= 手編集済みでまだどの run も処理していない画面数). Present AskUserQuestion。**並び順の優先規則 (上から先勝ちで 1 つだけ適用)**:
1. `{baseline_mode} == true` (Entry guard を baseline_approved_at で通過) → 「機能追加を起点」を先頭 (このとき N は必ず 0 — 編集台帳の writer である lint hook は final_approved 系でしか発火しないため、規則 2/3 と衝突しない)
2. `N > 0` → 「画面編集を起点」を先頭・件数併記
3. それ以外 → 「要件変更を起点」を先頭
```
question: "delta の起点を選んでください。"
header: "delta モード"
options:
  - label: "画面編集を起点 (screen-edit)"
    description: "完成後に手編集した画面 HTML を反映する{N>0 なら『（編集 N 件検出）』}。検知 → 該当画面のみ採点 → 画面仕様書(.md) へ逆伝播。{baseline_mode かつ announce の実測で画面 HTML 0 件なら『⚠️ 画面 HTML が未生成のため使えません。』}"
  - label: "要件変更を起点"
    description: "要件ドキュメントの変更を画面へ伝播する従来の delta。{baseline_mode なら『⚠️ 画面基盤 (遷移図等) が未生成の場合、開始前の材料検査で停止します。』}"
  - label: "機能追加を起点 (feature-add)"
    description: "完成後に新機能を追加する。7 軸ヒアリングで要件化し、要件文書 → UI へ接続する。"
  - label: "終了"
    description: "何もせず終了する。"
```
- "画面編集を起点" → `{baseline_mode}` なら**先に下記の材料検査** → proceed to **Step 27b** (screen-edit mode)。
- "要件変更を起点" → `{baseline_mode}` なら**先に下記の材料検査** → proceed to **Step 27** (requirement mode)。
- **材料検査 ({baseline_mode} == true で requirement / screen-edit が選ばれた場合、Step 27 / 27b に入る前に必ず実施 — Step の中で検査するのではない)**: **選ばれたモードが到達する step の `Preconditions` 節を読み、そこに列挙された artifact の実在を `ls` で確認する** (キーの有無から材料を推測しない)。**材料リストを本ファイルに写さないこと** — 各 step の `Preconditions` が SoT であり、写せば step 側の前提が変わった時点で追従できず drift する (本 phase の Entry Guard 判定式が 13 箇所のミラーで drift した前例と同じ構造):
  - **requirement モード** — 到達する step は 27 → 28 → 29 → 30。`skills/28-impact-analysis/SKILL.md` と `skills/29-partial-screen-regen/SKILL.md` の `Preconditions` 節を読む (27 は entry 条件のみ、30 は artifact を hard precondition にしない)
  - **screen-edit モード** — 到達する step は 27b → 29b → 29c → 30。`skills/27b-screen-edit-detect/SKILL.md` / `skills/29b-reverse-propagate/SKILL.md` / `skills/29c-req-propagate/SKILL.md` の `Preconditions` 節を読む
  - パスは必ず `artifacts/{app_name}/` prefix つきで `ls` すること (repo root から実行するため、prefix を落とすと材料が揃っていても常に「無 / 0 件」になる)
  - **当該 run の step 自身が生成する artifact は検査対象外** (例: `delta/change-manifest.json` = Step 27 の出力 / `delta/impact-analysis.md` = Step 28 の出力 / `delta.runs[-1].*` の完了印)。検査するのは **run 開始前に揃っているべき材料** のみ。`Preconditions` 節は前提材料と直前 step の完了印を同一リストに持つため、逐語で全項目を実在検査すると材料が揃っていても常に不足判定になり requirement モードに入れない
  - **検査はそのモードが最後に到達する step まで辿る** (最初の consumer で止めない)。遷移図だけを見て通すと、Step 28 の人間ゲートを通過させた後に Step 29 の precondition で止まり、防ごうとした死んだ run が一段先送りになるだけになる
  - **モード固有の材料 (遷移図 ↔ 画面 HTML) を 2 モード束ねて AND で検査しないこと** (基線が保証する材料集合は遷移図を含み画面 HTML を含まない [`docs/two-phase-completion-model.md`] — 束ねると材料整備後の正常状態でも requirement モードを誤って弾く)。両モードが共通で必須参照する材料は、上記 SoT を読めば両方に現れるため自然に検査される

  当該モードの材料が 1 つでも不足していれば「⚠️ 画面基盤が未生成のため、このモードはまだ使えません (不足: {不足したパスを列挙})。遷移図・共通部品の正典は `/ayatori-screens` の「基線確立 (screens-lite)」ルートで整えられます。画面 HTML が必要なモードは同コマンドの「フル実行」で生成してください。機能追加は feature-add モードが使えます。」と表示して **Mode Selection に戻る**。**change-manifest / snapshots / `delta.runs[]` stub を書き込む前に止める**こと — 材料不足のまま Step 27 が run を作ると、resume ladder が Step 28 で永久に詰まり、死んだ run と孤児 artifact が残る。
- "機能追加を起点" → proceed to **Step 27f** (feature-add mode)。
- "終了" → end phase。

> `N == 0` でも「画面編集を起点」は選べる（外部エディタ編集など台帳に残らない場合、Step 27b が画面の手動選択を提供する）。

**Resume logic** (only reached when an incomplete run is in progress; first read `delta.runs[-1].mode`, absent ⇒ `"requirement"`; evaluate top-to-bottom, first match wins):

**`mode == "requirement"` (従来):**
- `delta.runs[-1].screens_approved_at` is set → resume from Step 30 *(this includes runs where Step 29's zero-scope guard fired — both the normal approval path and the zero-scope path set `screens_approved_at`, so the resume destination is identical)*
- `artifacts/{app_name}/delta/impact-analysis.md` exists AND `delta.runs[-1].impact_approved_at` is set → resume from Step 29
- `artifacts/{app_name}/delta/impact-analysis.md` exists AND `impact_approved_at` **not** set → resume from `skills/28-impact-analysis/SKILL.md` **Step 5 only** (gate — `impact-analysis.md` already written, skip re-analysis)
- Otherwise → resume from Step 28 (full re-run)

**`mode == "screen_edit"`:** (Step 27b → 29b → (29c) → 30。Step 28 は経由しない — scope は 27b で確定済。manifest は 27b 作成済で resume でも再実行しない)
- `delta.runs[-1].figma_approved_at` is set OR `figma_status` is set → screen-edit run は**完了** (Figma 実在時は Step 30 承認済、不在時は figma_status skip 済)
- `delta.runs[-1].screens_approved_at` is set AND `requirement-deviations.json` に `phase == "delta"` かつ `raised_by_step == "29b-reverse-propagate"` かつ `resolution == "要件に昇格"` かつ `resolved_at` 未設定の entry がある → **昇格の要件反映が未完**。resume from **Step 29c** (反映完了後 Step 30 へ)
- `delta.runs[-1].screens_approved_at` is set (かつ上記 未充足) → 採点・逆伝播は承認済み。resume from **Step 30** (Figma 実在判定は Step 30 が行い、不在なら追加ゲートなしで完了)
  > この経路は Step 30 導入前の旧フローで 29b 承認をもって「完了」扱いだった screen_edit run も拾う (当時 Step 30 は deferred で Figma 未更新)。その run はここで Step 30 を実行して Figma を補完するのが正しい。Figma 実在時の破壊的操作 (rename→delete) は Step 30 の Step 5 gate 承認後にのみ確定し、cancel で完全復元できるため silent な損失は起きない。
- Otherwise → resume from **Step 29b**

> **Mini-retro 補足**: 完了後の振り返りは Phase 6 `/ayatori-delta-mini` が担当。Step 30 承認で本 phase は完了し、mini-retro はユーザーが明示的に `/ayatori-delta-mini` で起動する。Phase 4 retro と同じ運用パターン。

## Figma MCP Flag

> **Mode 判定は `skills/00-figma-mode-detect/SKILL.md` で一元化されている。** ここでは結果のみを参照し、独自の env var チェックは行わない。

Read and execute `skills/00-figma-mode-detect/SKILL.md` to resolve `mode` ("enabled" or "disabled"). The skill checks the OS env var `FIGMA_MCP_ENABLED` via Bash (推測禁止).

- `mode == "enabled"`: Step 30 (Partial Figma Update) performs real Figma MCP operations.
- `mode == "disabled"`: Step 30 skips Figma operations and proceeds to the approval gate directly.

---

## Execution

> **モード分岐**: `runs[-1].mode == "screen_edit"`（Mode Selection で screen-edit を選択、または既存 screen_edit run を resume）のとき、フローは **Step 27b → 29b → (29c) → 30** になる（29c は 29b ゲートで「要件に昇格」に選ばれた逸脱がある場合のみ）。**Step 28（影響分析）は経由しない**（scope は 27b の検知 + 人間確認で確定済）。**Step 30（Figma 部分更新）は両モード共通**で screen-edit も**必ず経由**する。screen-edit は scope を `edited_screens[]` から取得し、**Figma 実在時のみ** フレームを部分更新する（`FIGMA_MCP_ENABLED == false` / figma-state.json 不在 / zero-scope なら Step 30 Fallback が追加ゲートなしで figma_status を記録して完了）。**機能追加モード** (Step 27f) はヒアリングのみを行い、要件文書・UI への反映は後続の `/ayatori-req-delta` → `/ayatori-delta`（要件変更を起点）に委譲するため、delta の 28/29/30 は経由しない。

### Step 27: Change Detection
Read and execute `skills/27-change-detect/SKILL.md`.

Accepts human-provided change description + selected requirement docs. Produces `delta/change-manifest.json` and snapshots the changed documents.

### Step 27b: Screen-Edit Detection (screen-edit mode)
Read and execute `skills/27b-screen-edit-detect/SKILL.md`.

The screen-edit replacement for Step 27. Detects screen HTML hand-edited outside the pipeline (edit ledger + manual selection; **git-independent**), confirms scope with the user, and produces `delta/change-manifest.json` with `source: "screen_edit"` plus a `delta.runs[]` stub (`mode: "screen_edit"`, `edited_screens[]`). No requirement docs are selected — the edited HTML is the change vector.

### Step 27f: Add-Feature Hearing  *(feature-add mode)*
Read and execute `skills/01b-add-feature-question/SKILL.md`.

`/ayatori-add-feature`（Phase 1d）と同一の 7 軸ヒアリングを実施し、`req-delta/change-manifest.json` を `source: "skill-01b"` 付きで生成する。ヒアリング完了後は次の 2 手を**新しい会話で**実施するよう案内して本 run を終える（feature-add モードは delta の 28/29/30 を経由しない — 要件文書と UI への反映は後続コマンドが担当する）:
> 📋 次のステップ (新しい会話で実施):
>   1. `/ayatori-req-delta` — 要件文書への整合反映（`source == "skill-01b"` のため Step 31 は自動 skip）
>   2. `/ayatori-delta` — 「要件変更を起点」で UI / Figma へ反映 (reverse 基線プロジェクトでは画面基盤 [遷移図等] が未生成の間、開始前の材料検査で停止します — `/ayatori-screens` の「基線確立 (screens-lite)」ルートで整えてから再実行してください)

### Step 28: Impact Analysis  *(requirement mode only)*
Read and execute `skills/28-impact-analysis/SKILL.md`.

Maps changes to affected screens. Classifies every screen as `affected`, `new`, `removed`, or `preserved`. **Human gate** — delta scope is confirmed before any files are modified.

> **screen-edit モードでは経由しない**: scope（反映対象の画面）は Step 27b の検知 + 人間確認で確定済みのため、screen-edit run は Step 28 を skip して直接 Step 29b に進む。

### Step 29: Partial Screen Regen
Read and execute `skills/29-partial-screen-regen/SKILL.md`.

Regenerates ONLY affected/new screens. Reads the existing design system as READ-ONLY. Runs a mini design review for consistency. **Human gate** — updated HTML files reviewed before Figma update.

> If Step 29 exits early via the zero-scope guard (all screens preserved), proceed directly to Step 30.

### Step 29b: Reverse-Propagate + Scoped Scoring (screen-edit mode)
Read and execute `skills/29b-reverse-propagate/SKILL.md`.

The screen-edit replacement for Step 29 — the inverse direction. Regenerates the full color-lint report, runs the Step 19 rubric **scoped to the edited screens** (→ `delta.runs[-1].score_total`, not `scores.json`), then reverse-propagates each HTML diff into its `screens/{screen}.md` spec (+ `00-transition-map.mmd` / `00-screen-nav.json` / coverage when navigation changed) and runs the **reverse requirement audit** — the edit diff is traced against `requirements/*.md`, recording untraceable changes as `要件外追加` / `要件矛盾` / `要件削除` deviations in `requirement-deviations.json` (diff-bounded: pre-existing gaps the edit did not introduce are out of scope). The design system stays READ-ONLY. **Human gate** — score + updated specs + deviations reviewed; approved runs then select which deviations to promote (「要件に昇格」→ Step 29c, others 容認で終端).

### Step 29c: Requirement Promotion (screen-edit mode)
Read and execute `skills/29c-req-propagate/SKILL.md`.

Runs only when the 29b gate selected one or more deviations for promotion (or a previous run left promotions pending). Revises the target `requirements/NN-*.md` sections behind its own confirmation gate (append-only ID rule; `requirements.json` stays untouched), verifies with `scripts/check-req-crossrefs.mjs`, then stamps `resolved_at` on the promoted deviations and records the decisions in `pending-questions.json`. **Human gate** — proposed requirement revisions reviewed before writing. Zero pending promotions → no-op, straight to Step 30.

### Step 30: Partial Figma Update
Read and execute `skills/30-partial-figma-update/SKILL.md`.

Deletes stale Figma frames for recaptured/removed screens. Recaptures updated HTML. Repositions new frames in the existing grid using `resume_layout_mode: "new_only"` (preserved frames not moved). **Human gate** — Figma result confirmed.

> **screen-edit モード**: 対象画面は `delta.runs[-1].edited_screens[]` から取得する（Step 30 skill の Step 1-0）。Figma 実在時（`FIGMA_MCP_ENABLED == true` かつ figma-state.json 存在）は編集画面のフレームのみ rename→recapture→delete し `figma_approved_at` で完了。Figma 不在 / zero-scope 時は Step 30 Fallback が追加ゲートなしで `figma_status = "skipped_stub_mode"` を記録して完了する（29b で既に人間ゲート通過済のため二重ゲートを避ける）。

---

## Design System Freeze

During a delta run, the following files are **READ-ONLY** and must not be modified:
- `artifacts/{app_name}/tokens.json`
- `artifacts/{app_name}/design-brief.yaml`
- `artifacts/{app_name}/screens/_shared/root-variables.css`
- `artifacts/{app_name}/screens/_shared/common-styles.css`
- `artifacts/{app_name}/figma-state.json` (node_ids for preserved screens)

If the requirements change also requires design system changes (e.g. new brand colour, new token), that is a separate `/ayatori-design` re-run, not a delta. Display a warning if the impact analysis detects this case.

---

## Completion

Completion point depends on mode — **requirement**: after Step 30 approval. **screen-edit**: 必ず Step 30 を経由 — Figma 実在時は Step 30 承認 (`figma_approved_at`)、不在 / zero-scope 時は Step 30 Fallback が追加ゲートなしで `figma_status` を記録して完了。

Display (requirement モード):
```
✅ Delta 実行完了 ({run_id})
   変更: {change_description}
   更新画面: {affected_N + new_N} 件 / 削除: {removed_N} 件 / 維持: {preserved_N} 件
   次の変更がある場合は新しい会話で /ayatori-delta を実行してください。
   振り返りを行う場合は /ayatori-delta-mini で軽量 retrospective を実行できます (Phase 6)。
```

Display (screen-edit モード):
```
✅ Delta 実行完了 ({run_id} / screen-edit)
   変更: {change_description}
   反映画面: {edited_N} 件 / 採点: {score_total}/100
   画面仕様書 (.md) / coverage / nav を更新しました。
   {昇格ありの場合のみ表示} 要件昇格: {promoted_N} 件 — requirements/*.md を更新しました (requirements.json は不変)。
   {Figma 実在時のみ表示} Figma フレーム更新: {edited_N} 件
   次の変更がある場合は新しい会話で /ayatori-delta を実行してください。
   振り返りを行う場合は /ayatori-delta-mini で軽量 retrospective を実行できます (Phase 6)。
```

Use AskUserQuestion:
- Option A: "終了" — Artifacts saved. End session.
- Option B: "別の変更を続けて入力" — 同じセッションで次の delta run を開始する（**Mode Selection** に戻る）
