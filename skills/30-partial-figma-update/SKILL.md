---
name: 30-partial-figma-update
description: Phase 5 の Step 30。影響のある / 新規 / 削除された画面 (screen-edit モードでは手編集された画面) のみ Figma を部分更新し、保持画面には触れない。FIGMA_MCP_ENABLED と figma-state.json の有無で部分更新か fallback かを分岐する。
---

# 30 Partial Figma Update

## Role
Update Figma for ONLY the affected/new/removed screens (screen-edit モードでは手編集された画面のみ)。Preserved screens are never touched. Uses the same `figma-capture-runner` subagent as Step 22, but with a scoped `target_files` list and a `resume_layout_mode: "new_only"` grid layout pass.

`pipeline-state.json.delta.runs[-1].mode` で 2 つの起点を切り替える (absent ⇒ `"requirement"`、後方互換):
- **requirement モード**: scope を `impact-analysis.md` (Step 28 出力) から構築する従来フロー。
- **screen-edit モード**: scope を `delta.runs[-1].edited_screens[]` (Step 27b 確定) から構築する。Step 28 を経由しないため `impact-analysis.md` は存在しない。

## Preconditions
- **唯一の hard precondition**: Step 29 (requirement) / Step 29b (screen-edit) complete (`pipeline-state.json.delta.runs[-1].screens_approved_at` set)。
- Figma の実在は前提条件ではなく **分岐条件** — `FIGMA_MCP_ENABLED == true` かつ `artifacts/{app_name}/figma-state.json` (`nodes.screens` populated) が揃えば部分更新を行い、いずれか不在なら **Fallback** へ degrade する (エラーにしない)。
  - requirement モード: Fallback は Step 5 gate へ (approve without Figma)。
  - screen-edit モード: Fallback は追加ゲートなしで `figma_status` を記録して完了 (Step 29b で既に人間ゲート通過済)。

---

## Execution

### Step 1: Build target scope

**Mode 分岐** — `pipeline-state.json.delta.runs[-1].mode` を読む (absent ⇒ `"requirement"`、後方互換)。`mode == "screen_edit"` のときは **Step 1-0** で scope を構築して Step 2 へ。それ以外 (requirement モード) は **Step 1 (requirement モード)** の従来フローに従う。

#### Step 1-0: screen-edit モード scope (`mode == "screen_edit"`)

screen-edit run は Step 28 を経由しないため `impact-analysis.md` は存在しない。scope は Step 27b が確定した `delta.runs[-1].edited_screens[]` (`[{screen, platform, path}]`) から構築する。requirement モードの sub-state / state_added 拡張 (下記 Step 1-pre 〜 state_added scope) は **経由しない**。

1. **Figma availability**: `skills/00-figma-mode-detect` の結果が `disabled`、**または** `artifacts/{app_name}/figma-state.json` が存在しない (= Figma export を一度も行っていない完成プロジェクト) 場合は、更新対象フレームが無いので部分更新できない。**Fallback (FIGMA_MCP_ENABLED == false) セクションへ直行**する (screen-edit 分岐: 追加ゲートなしで `figma_status` を記録し完了)。
2. **scope 構築** (Figma available のとき):
   - **node_id 解決 (platform 完全一致)**: 各編集画面の path から決定的に key を導出する。`path` は `screens/{platform}/{stem}.html` 形式なので、`screens/` prefix と `.html` suffix を除いた `{platform}/{stem}` がそのまま `figma-state.json.nodes.screens` の key に一致する (key は capture 時に同じ path から生成される: `screens/web/01-login.html` → key `web/01-login`)。**必ず platform を含めて完全一致で引く** — stem 単独の照合 (`endswith "/{stem}"`) は禁止。`mobile_and_web` プロジェクトで同名 stem の反対 platform フレームまで巻き込み、編集していない画面を Step 5b で誤削除するため。
   - `recapture` = key が引けた (= Figma に既存フレームがある) 編集画面のみ。引けた画面の `{key: node_id}` を Step 2 の `__STALE_NODE_IDS__` として渡す。該当 key が無い編集画面 (Figma 未エクスポート) は警告ログを出して **scope から除外** する (新規 frame は作らない — screen-edit は既存画面編集が前提)。
   - `target_files` = `recapture` に残った画面の path のみ (例: `screens/mobile/03-home.html`)。default HTML パスとして Step 3 に渡す。照合失敗画面は除外済のため新規 frame は発生しない。
   - `new_capture = []` / `delete_only = []` / `state_added_targets = []` / `sub_state_aware = false` — screen-edit は既存画面の手編集が前提で、新規・削除・sub-state 拡張は発生しない (`expand_with_substates` は使わない — path が正確なフレーム key を一意に決めるため拡張不要)。
   - **Zero-scope guard**: 上記フィルタ後に `recapture` が 0 件 (全編集画面が Figma 未エクスポート) の場合、Figma に touch する対象がなく破壊的操作も発生しない。**Step 2–5 を skip し、Fallback の screen-edit 分岐へ合流**して追加ゲートなしで `figma_status` を記録 + Step 7 を実行して完了する (29b で既に人間ゲート通過済のため Step 5 gate は出さない — Figma 不在 Fallback と同じ扱いに統一)。新規 frame は作らない。requirement モードの zero-scope (下記 Step 1) は意味が異なる (全画面 preserved の正常状態) ため従来どおり Step 5 gate へ進む。
   - `recapture` が 1 件以上あれば **Step 2 (rename) へ進む**。Step 3b は `sub_state_aware == false` かつ `state_added_targets` 空のため自動 skip される。

#### Step 1 (requirement モード): impact analysis から構築

Read `artifacts/{app_name}/delta/impact-analysis.md` and `figma-state.json`.

`sub_state_aware` を `pipeline-state.json.delta.runs[-1].sub_state_aware` から取得 (Step 28 で記録済)。

`state_added_screens` (array of `{screen, added_states[]}`) を `pipeline-state.json.delta.runs[-1].state_added_screens` から取得 (Step 28 で記録済)。空配列または key 不在の場合は state_added 経路を skip。

#### Step 1-pre: figma_sync_status / completed_at_states guard (レビュー対応、secondary)

**Guard 階層**: `skills/28-impact-analysis/SKILL.md` Step 1b が **primary guard** (sub_state_aware の単一判定入口、人間レビュー付き)。本 Step 1-pre は **secondary defense-in-depth** (28 が壊れた場合の safety net で、人間レビュー無しで動作する経路の最後の砦)。SoT は 28 側。

Step 28 で既に downgrade されているはずだが本 Step でも `pipeline-state.json.screens.step25e.figma_sync_status` と `approvals.completed_at_states` を Read して再度 guard:

```python
figma_sync_status = pipeline_state.get("screens", {}).get("step25e", {}).get("figma_sync_status")
states_completed = pipeline_state.get("approvals", {}).get("completed_at_states")
if sub_state_aware and figma_sync_status not in (None, "complete"):
    # 25e が "skipped_by_user" や "partial" のとき: Figma に sub-state frame が存在しない / 不完全
    # → sub_state_aware を false に強制 downgrade し default のみ処理する
    sub_state_aware = False
    log_to_feedback("Pattern C: figma_sync_status={status} のため delta sub-state Figma 更新を skip")
if sub_state_aware and not states_completed:
    # 再入経路の中途離脱 (25b 生成後に 25c 採点 / 25d 承認未通過でセッション中断) — Step 28 の
    # 完了ゲート条件 (PR #126 レビュー対応) をミラー。未承認 sub-state を Figma に流さない
    sub_state_aware = False
    log_to_feedback("Pattern C: completed_at_states 未 set (sub-state 25c/25d 未通過) のため delta sub-state Figma 更新を skip")
```

`figma_sync_status is None` は sub-state 対応前の legacy run。後方互換のため `complete` 相当扱いで通常処理する (sub-state HTML が存在する=Figma にもあるはず という仮定で動作してきた既存挙動)。

Produce three lists:
```
recapture  = affected screens (existing Figma frames will be renamed old_{name} then re-captured)
new_capture = new screens (Figma frames do not yet exist)
delete_only = removed screens (Figma frames renamed old_{name}, no new capture)
```

**sub-state 拡張** (`sub_state_aware == true` のときのみ):

`figma-state.json.nodes.screens` の key を走査し、各 list を sub-state まで含めて拡張する:

```python
# 例: affected = ["メモ一覧"] → recapture = {"mobile/メモ一覧", "mobile/メモ一覧--empty", "mobile/メモ一覧--loading", "mobile/メモ一覧--error"}
def expand_with_substates(screen_names, nodes_screens_keys):
    expanded = set()
    for name in screen_names:
        # default frame
        expanded.update(k for k in nodes_screens_keys if k.endswith(f"/{name}") or k == name)
        # sub-state frames (--state suffix)
        expanded.update(k for k in nodes_screens_keys if f"/{name}--" in k or k.startswith(f"{name}--"))
    return expanded

recapture_keys   = expand_with_substates(affected_screens, figma_state.nodes.screens.keys())
new_capture_keys = expand_with_substates(new_screens,       figma_state.nodes.screens.keys())  # new は plan から導出
delete_only_keys = expand_with_substates(removed_screens,   figma_state.nodes.screens.keys())
```

`new` 画面は figma-state.json にまだ存在しないため、state-pattern-plan.json から sub-state リストを取得して target_files を構築する (Step 3 の sub-state run で使用)。

> **Hard constraint**: preserved 画面の sub-state frame は `figma-state.json.nodes.screens` に登録済でも絶対に上記 3 リストに含めない。`expand_with_substates` は affected/new/removed リストの画面名のみを引数に取り、preserved 画面名は決して渡さない。

**state_added scope** (only when `state_added_screens` is non-empty):

`state_added` 画面は **default frame を絶対 preserve** (rename / recapture なし)、追加 sub-state frame のみ **append-only** で capture する。`expand_with_substates` は使わず (default frame を含めてしまうため不適)、`added_states[]` から target_files を直接算出する:

```python
# 変数の出所:
#   state_added_screens: pipeline-state.json.delta.runs[-1].state_added_screens (Step 28 で記録)
#   platforms_for_run:   Phase 3 Step 22 で確定済の platform 集合と同じ source。Step 3 の subagent prompt に
#                        `scope_q1: {same platforms as original Step 22 run}` として渡される値と同一。
#                        **SoT は figma-state.json.scope.user_selected.platforms** (Step 22 Q1 の確定値、
#                        subset of ["web", "web-sm", "mobile"])。figma-state.json が欠落する
#                        fallback 時のみ platform_combo + web_viewports を skills/17-screen-gen の展開規則で
#                        platform dirs に展開して使う (旧「platform_combo 単独導出」は web-sm を取りこぼすため廃止)。
#   dual_theme_mode:     requirements.json.design_output_scope.dual_theme_mode (bool)。
state_added_targets = []  # list of HTML paths
for entry in state_added_screens:  # [{screen, added_states[]}, ...]
    screen = entry["screen"]
    for state in entry["added_states"]:
        for platform in platforms_for_run:
            if dual_theme_mode:
                for theme in ["light", "dark"]:
                    state_added_targets.append(f"screens/{platform}/{screen}--{state}--{theme}.html")
            else:
                state_added_targets.append(f"screens/{platform}/{screen}--{state}.html")
```

`state_added_targets` は Step 3b の `target_files` に **append** される。Step 2 (rename) / Step 3 (default capture) には **絶対に流さない** (default frame 保護)。

> **Hard constraint**: state_added 画面の default frame (`figma-state.json.nodes.screens["{platform}/{screen}"]`) は preserved 同等の保護下にある。`recapture_keys` / `new_capture_keys` / `delete_only_keys` のいずれにも絶対に含めない。

**Zero-scope guard**: If all four sets are empty (recapture / new_capture / delete_only / state_added_targets), display:
> ℹ️ Figma に更新対象フレームがありません。すべての画面は preserved です。

Skip Steps 2–4 and proceed directly to Step 5 gate, noting "no Figma frames to update".

### Step 2: Rename stale Figma frames to `old_{name}`

> **state_added scope guard**: state_added 画面の default frame は本 Step で **絶対に rename しない**。append-only 動作のため preserve 同等扱い。`recapture` / `delete_only` リストにのみ含まれる画面を対象とする。

For each `recapture` and `delete_only` screen:
1. Look up `node_id` from `figma-state.json.nodes.screens["{screen}"]`
2. Use `mcp__figma__use_figma` to rename those nodes (do NOT delete yet):

```js
const toRename = __STALE_NODE_IDS__;  // from figma-state.json
for (const [screenName, rawId] of Object.entries(toRename)) {
  const id = typeof rawId === 'string' ? rawId : rawId.node_id;
  const node = await figma.getNodeByIdAsync(id);
  if (node) node.name = `old_${node.name}`;
}
return { renamed: Object.keys(toRename).length };
```

3. Write the renamed entries to `figma-state.json.old_node_ids` (keyed by screen name) so the approval path knows what to clean up:

```json
"old_node_ids": {
  "{screen_name}": "{node_id}",
  ...
}
```

Do NOT remove the entries from `figma-state.json.nodes.screens` yet — that happens on approval in Step 5b.

### Step 3: Capture updated + new screens

Build `target_files` from `recapture + new_capture` screens only (no preserved screens). default HTML パス (例: `screens/mobile/メモ一覧.html`) のみを含める — sub-state HTML は **Step 3b** で別 run として処理する。

Delegate to `figma-capture-runner` subagent exactly as in Step 22:

```
Agent({
  subagent_type: "figma-capture-runner",
  description: "Step 30 delta Figma capture for {N} files (default)",
  prompt: """
mode: orchestrator
resume: true
app_name: {app_name}
file_key: {figma-state.json.file_key}
page_id: {figma-state.json.page_id}
scope_q1: {same platforms as original Step 22 run}
scope_q2: ["default"]
target_files: {target_files JSON — affected/new screens default HTML only}
resume_layout_mode: "new_only"
"""
})
```

`resume: true` skips Q1/Q2 re-question (scope was set in Step 22 and is not changing). The self-check detects no deferred frames and proceeds as a fresh targeted run using the provided `target_files`.
`resume_layout_mode: "new_only"` tells the subagent to run the grid layout pass but ONLY reposition the newly captured frames — existing preserved frames keep their positions.

### Step 3b: Capture sub-state frames (+ state_added)

`sub_state_aware == false` **かつ** `state_added_targets` が空の場合はこの Step をスキップして Step 4 へ。それ以外は両ソースを統合した `target_files` で 1 回 subagent を起動する。

`target_files` 構築:
- plan-driven sub-state (`sub_state_aware == true` のときのみ): 従来通り plan-driven の sub-state HTML パス (例: `screens/mobile/メモ一覧--empty.html`)
- state_added (`state_added_targets` 非空のときのみ): Step 1 で算出した新規 state HTML パス (例: `screens/mobile/board--cancel-window--light.html`)

両者とも append-only / preserved 保護機構を共有するため、figma-capture-runner を `mode: substate` で 1 回起動し、両ソースを 1 つの `target_files` に統合して渡す (25e と同じ呼び出し方):

```
Agent({
  subagent_type: "figma-capture-runner",
  description: "Step 30 delta Figma capture for {N} sub-state files",
  prompt: """
mode: substate
resume: true
app_name: {app_name}
file_key: {figma-state.json.file_key}
page_id: {figma-state.json.page_id}
scope_q1: {same platforms as Step 22}
scope_q2_substate: {sub-state list, e.g. ["empty", "loading", "error"] — derived from state-pattern-plan.json}
target_files: {sub-state HTML paths from affected/new screens only}
state_pattern_plan_path: artifacts/{app_name}/screens/state-pattern-plan.json
resume_layout_mode: "new_only"
"""
})
```

`mode: substate` は 25e と同じ pre-flight (§2d) を実行し、`pre_existing_keys` snapshot により preserved 画面の default frame と sub-state frame の Figma 上の手動レイアウトを絶対に破壊しない (既存機構を再利用)。state_added 経路でも同じ snapshot 機構によって既存 default frame の位置が保護される。

> **Hard constraint**: preserved 画面の sub-state HTML パスは絶対に `target_files` に含めない。Step 1 の `recapture_keys + new_capture_keys + state_added_targets` のいずれかに含まれる sub-state key のみを対象とする。state_added 経路は **default frame を target_files に絶対に含めない** (default は preserve)。

### Step 4: Verify capture results

Read `figma-state.json` written by the subagent. Confirm:
- All `recapture` + `new_capture` screens have new `node_id` entries (default + sub-state も `sub_state_aware == true` の場合)
- No `preserved` screen node_ids were modified (default + sub-state frame の両方)
- `scope.html_files_captured` reflects the delta count (not the full original count). Step 3 + Step 3b の合算が反映されているか確認

### Step 5: Final approval gate

**Recapture limit**: Track how many times Step 3 has been re-run in this session. After 3 recapture attempts, replace Option B with "再キャプチャ上限（3回）到達 — キャンセル" which executes Option C behavior.

Note: `old_{name}` frames from Step 2 are still visible in Figma at this point — they will be permanently deleted only on Option A approval (Step 5b). If in doubt, the human can open Figma and compare old vs new frames before deciding.

Present AskUserQuestion:
- **Figma 部分更新の確認**
  - Option A: 承認 — delta 完了。`pipeline-state.json` を更新する（zero-scope の場合: 削除する `old_` フレームはなく、`pipeline-state.json` の `figma_approved_at` を設定するのみ）
  - Option B: 再キャプチャ — 指定した画面を再キャプチャする（Step 3 に戻る）**※ zero-scope guard が発動した場合は Option A/C のみ表示する。3回試行済みの場合も表示しない**
  - Option C: キャンセル — 新規キャプチャを破棄し、`old_` フレームを元の名前に戻す（zero-scope の場合: 復元する `old_` フレームはなく、`cancelled_at` を設定するのみ）

### Step 5b: Post-approval cleanup (Option A only)

Delete the `old_` frames from Figma and clean up `figma-state.json`:

```js
const oldIds = __OLD_NODE_IDS__;  // from figma-state.json.old_node_ids
for (const rawId of Object.values(oldIds)) {
  const id = typeof rawId === 'string' ? rawId : rawId.node_id;
  const node = await figma.getNodeByIdAsync(id);
  if (node) node.remove();
}
return { deleted: Object.keys(oldIds).length };
```

Then remove `old_node_ids` from `figma-state.json` and remove the stale entries from `nodes.screens` (the entries that were renamed — new captures already updated `nodes.screens` via the subagent).

**On Option C (cancel)**: Restore original frame names in Figma:

```js
const oldIds = __OLD_NODE_IDS__;  // from figma-state.json.old_node_ids
for (const [screenName, rawId] of Object.entries(oldIds)) {
  const id = typeof rawId === 'string' ? rawId : rawId.node_id;
  const node = await figma.getNodeByIdAsync(id);
  if (node) node.name = node.name.replace(/^old_/, '');
}
return { restored: Object.keys(oldIds).length };
```

Then remove `old_node_ids` from `figma-state.json`. Display:
> "キャンセルしました。Figma は元の状態に戻りました。新規キャプチャフレームは手動で削除してください。"

Then write `cancelled_at` / `cancel_reason` to `pipeline-state.json` so resume logic treats this run as aborted (not as "ready to resume Step 30"):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。"); exit(1)
data = json.loads(open(path).read())
if not data.get("delta", {}).get("runs"):
    print("ERROR: delta.runs が空です。"); exit(1)
data["delta"]["runs"][-1].update({
    "cancelled_at": datetime.now(timezone.utc).isoformat(),
    "cancel_reason": "user_abort"
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: cancelled_at / cancel_reason written")
PYEOF
```

### Step 6: Update `pipeline-state.json` (Option A only)

**Only execute Steps 6 and 7 when Option A was chosen.** Option C exits in Step 5b after writing `cancelled_at` — do not run Steps 6/7 on cancel.

Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

# affected_screens, new_screens, removed_screens, state_added_screens, sub_state_aware already written by Step 28 — do not re-write them here
path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。Step 27 が完了しているか確認してください。"); exit(1)
data = json.loads(open(path).read())
if not data.get("delta", {}).get("runs"):
    print("ERROR: delta.runs が空です。Step 27 が完了しているか確認してください。"); exit(1)
data["delta"]["runs"][-1]["figma_approved_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: figma_approved_at written")
PYEOF
```

### Step 7: Update `delta/run-history.json`

> **screen-edit モード**: `__N_AFFECTED__` = 編集画面数 (`edited_screens[]` の件数)、`__N_NEW__` / `__N_REMOVED__` = 0、`__N_TOTAL__` = run 時点の全画面数。スキーマは共通。

Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/delta/run-history.json"
os.makedirs(os.path.dirname(path), exist_ok=True)
data = json.loads(open(path).read()) if os.path.exists(path) else {"runs": []}
data["runs"].append({
    "run_id": "__RUN_ID__",
    "date": "__DATE__",
    "change_description": "__CHANGE_DESCRIPTION__",
    "screens_affected": __N_AFFECTED__,
    "screens_new": __N_NEW__,
    "screens_removed": __N_REMOVED__,
    "screens_total": __N_TOTAL__  # affected + new + removed + preserved (all project screens at run time)
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: run-history.json entry appended")
PYEOF
```

---

## Fallback (Figma 不在: `FIGMA_MCP_ENABLED == false` / figma-state.json 不在 / screen-edit zero-scope)

Skip Steps 2–4. **まずモードを判定** (`delta.runs[-1].mode`、absent ⇒ `"requirement"`) し、モードごとに以下を実行する。両モード共通の `figma_status` 書き込みは次の python (substitute `__PLACEHOLDERS__`):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
data = json.loads(open(path).read())
data["delta"]["runs"][-1]["figma_status"] = "skipped_stub_mode"
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: figma_status = skipped_stub_mode written")
PYEOF
```

- **requirement モード**: 上記 `figma_status` を記録 → **Step 5 gate** (approve without Figma) へ。**On approval, execute Step 6 and Step 7 in full** — `figma_approved_at` must be set to mark the run complete.
- **screen-edit モード** (Step 1-0 の Figma 不在 / zero-scope から到達): 追加の承認ゲートは出さない (Step 29b で既に人間ゲートを通過済)。上記 `figma_status = "skipped_stub_mode"` を記録 → **Step 7 (run-history.json append) を実行** (Figma を skip しても run を履歴に残す。`__N_AFFECTED__` = 編集画面数、new / removed = 0) → 本 run は **完了** (`figma_status` set が完了シグナル。`figma_approved_at` は set しない)。完了メッセージ「ℹ️ Figma 未設定のため部分更新を skip しました (画面仕様書の更新は反映済)」を表示して終了する。Step 5 / 6 は実行しない。

---

## Output
- Updated `artifacts/{app_name}/figma-state.json` (affected frames only — preserved frames unchanged; `old_node_ids` key present during Step 2–5, removed on approval/cancel; `sub_state_aware == true` の場合は default + sub-state frame の両方が affected/new/removed の対象画面分のみ更新; `state_added_screens` に含まれる画面は default frame を preserve しつつ追加 sub-state frame のみ append-only でキャプチャ)
- `artifacts/{app_name}/delta/run-history.json` (appended)
- `pipeline-state.json` — `delta.runs[-1]` に `figma_approved_at` (承認時) を追記
- **screen-edit モード**: 編集画面のフレームのみ再キャプチャ (preserved frames unchanged)。Figma 不在時は `delta.runs[-1].figma_status = "skipped_stub_mode"` を記録 + run-history.json に append し (`figma_approved_at` は set しない)、figma-state.json は変更しない
