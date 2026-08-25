---
name: 28-impact-analysis
description: change-manifest.json の変更を具体的な画面・遷移・デザインシステム要素にマッピングし、人間がレビュー可能な影響レポートを生成して再生成前の人間確認ゲートを通す。Phase 5 の Step 28 として実行され、非影響画面を preserved として明示することで Step 29 でのスコープ膨張を防ぐ。
---

# 28 Impact Analysis

## Role
Map the changes in `change-manifest.json` to specific screens, transitions, and design system elements. Produce a human-reviewable impact report and gate on human confirmation before any regeneration begins. Non-affected screens are explicitly listed as "preserved" — this prevents accidental scope creep in Step 29.

## Preconditions
- `artifacts/{app_name}/delta/change-manifest.json` exists (Step 27 complete)
- `artifacts/{app_name}/screens/00-screen-list.md` exists
- `artifacts/{app_name}/screens/00-transition-map.mmd` exists (SSoT; `.html` is a derived artifact)
- `artifacts/{app_name}/screens/00-screen-nav.json` (optional — 各画面の入口/出口 派生ビュー。存在すれば new/affected 画面の入口/出口要件の参照に使う。無い legacy では `.mmd` を直接参照)

---

## Execution

### Step 1: Load context

Read the following:
- `artifacts/{app_name}/delta/change-manifest.json`
- `artifacts/{app_name}/screens/00-screen-list.md`
- `artifacts/{app_name}/screens/00-transition-map.mmd` (SSoT — read this instead of the derived `.html`)
- `artifacts/{app_name}/screens/00-screen-nav.json` (optional — 各画面の入口/出口 派生ビュー。`new`/`affected` 画面の入口/出口要件を構造化列挙する際の参照)
- For each screen in the screen list: attempt to Read `artifacts/{app_name}/screens/{screen}.md`. If the file does not exist, flag that screen as a **missing-spec** candidate — treat it as `removed` in the classification step (Step 3) and log: "⚠️ {screen}.md が見つかりません。removed として分類します。" Do not abort.

### Step 1b: Detect sub-state awareness

判定: 本プロジェクトが plan-driven の sub-state 生成パス (25a proceed) を **完走** しているかを物理ファイル存在 + plan 存在 + 完了ゲート通過 (`approvals.completed_at_states`) で確認する。

```bash
# sub-state HTML が 1 件でも存在するか? (ただし dual_theme main HTML との衝突に注意 — 下記参照)
sub_state_html_count=$(find artifacts/__APP_NAME__/screens -type f -name '*--*.html' 2>/dev/null | wc -l)
# state-pattern-plan.json は 25a proceed でのみ生成される
test -f artifacts/__APP_NAME__/screens/state-pattern-plan.json && plan_exists=true || plan_exists=false
# 完了ゲート: 25c 採点 + 25d 人間承認を経て 25e が立てる合図。未 set = 中途状態 (下記参照)
states_completed=$(jq -r '.approvals.completed_at_states // ""' artifacts/__APP_NAME__/pipeline-state.json 2>/dev/null)
# 補助: pipeline-state.json.screens.state_pattern_skipped == true なら明示的に false
```

> **レビュー対応 (glob 誤検出 fix)**: `dual_theme_mode=true` プロジェクトでは Step 17 が `{screen}--light.html` / `{screen}--dark.html` を生成するため、`*--*.html` glob がこれらにもヒットして `sub_state_aware=true` を **誤検出** する。25a 未実行 (state-pattern-plan.json 不在) のまま delta が起動すると、Step 29 Step 4b が `--light.html` / `--dark.html` を sub-state HTML と誤認して **上書き** するリスクがあった。fix: `state-pattern-plan.json` 存在を **AND 条件** で要求する (plan は 25a proceed でのみ生成される SoT)。

Read `artifacts/{app_name}/pipeline-state.json` の `screens.state_pattern_skipped` も確認:

| 条件 | `sub_state_aware` |
|---|---|
| `state_pattern_skipped == true` | **false** (25a で明示的に skip された) |
| `screens.step25e.figma_sync_status not in (None, "complete")` | **false** (Figma 未同期のため node_id 参照を回避) |
| sub-state HTML 1 件以上存在 **AND** `state-pattern-plan.json` 存在 **AND** `approvals.completed_at_states` 未 set | **false** (再入経路の中途離脱 — 25b 生成後に 25c 採点 / 25d 人間承認を通らずセッション中断した状態。下記 note 参照) |
| sub-state HTML 1 件以上存在 **AND** `state-pattern-plan.json` 存在 **AND** `approvals.completed_at_states` set (レビュー対応 F) | **true** |
| sub-state HTML 1 件以上存在 **AND** `state-pattern-plan.json` 不在 | **false** (dual_theme main HTML が glob にヒットしただけ。25a 未実行の状態) |
| sub-state HTML ゼロ | **false** (sub-state 対応前の legacy / 25a 未到達) |

> **再入経路の中途離脱 guard (PR #126 レビュー対応)**: skip 解除 (`/ayatori-screens` 再入) → 25a proceed → 25b 生成まで進んでセッションを中断すると、採点 (25c) も人間承認 (25d) も通っていない sub-state HTML + plan がディスクに残る。delta の entry 条件は `final_approved` だけで満たせるため、この状態で `/ayatori-delta` を実行できてしまう。`completed_at_states` (25c→25d を経て 25e が立てる Phase 3 完全完了の合図) を AND 条件に加えることで、未承認の派生画面を Step 28 が「派生状態あり」と誤って扱う窓を塞ぐ。該当時は `sub_state_aware: false` に downgrade し、impact-analysis.md の Sub-state Awareness セクションに「sub-state は生成済みだが 25c 採点 / 25d 承認が未通過のため本 delta は default のみ扱う。`/ayatori-screens` を再実行して 25c→25d→25e を完了させてから delta を再実行すること」と明示する (silent 無視ではなく人間に見える形で報告する)。中途状態の sub-state HTML は本 delta では読みも書きもしない (preserve)。

> **レビュー対応 (`figma_sync_status` guard、Step 28 = primary)**: 25e の反復 partial_success 対策で user が Option 2「Figma スキップ」を選んだ場合、`completed_at_states` は立つが Figma には sub-state frame が存在しない。この状態で `sub_state_aware: true` のまま Step 30 に進むと、figma-state.json の sub-state node_id がそもそも書かれていないため `expand_with_substates` の結果は空集合になり Step 30 がクラッシュではなく **空振り** で通過してしまう (preserved 画面の sub-state も触らないので副作用なし)。ただし「sub-state を変更したつもりが Figma に反映されない」silent failure を避けるため、本 Step で `sub_state_aware: false` に明示 downgrade し、impact-analysis.md の Sub-state Awareness セクションに「Figma 未同期のため本 delta は default のみ扱う」と表示する。
>
> **Guard の階層構造**: 本 Step 28 が **primary guard** (sub_state_aware 判定の単一入口、人間が impact-analysis.md で確認可能)。`skills/30-partial-figma-update/SKILL.md` の Step 1-pre は **defense-in-depth secondary guard** (28 が壊れた場合の safety net、人間レビュー無しで動作する経路の最後の砦)。SoT は 28 側で、30 側は 28 と同じロジックを再評価するだけ。28 を直したら 30 も自動的に正しくなる関係。

また `sub_state_aware == true` の場合は、各画面の sub-state リストを取得しておく。**`sub_state_aware == true` の判定条件 (F: plan 存在 AND) により `state-pattern-plan.json` は必ず存在する** ため、plan を SoT として Read する:

```python
# state-pattern-plan.json を SoT として Read (F の AND 条件により plan 存在は保証されている)
plan = json.load(open(f"artifacts/{app_name}/screens/state-pattern-plan.json"))
sub_state_by_screen = {entry["screen"]: entry["states"] for entry in plan["screens"]}
```

> **レビュー対応 (dead-path 注記)**: 旧版では「plan が存在する場合は plan を優先、無ければ glob で sub-state HTML を find して抽出」という fallback があったが、これは dual_theme 命名衝突 (`{screen}--light.html` を sub-state と誤認) のリスクがあった。F の AND 条件 (sub_state_aware=true ⇔ plan 存在) により glob fallback は dead path となったため削除。plan の states[] が唯一の真実。

### Step 2: Trace impact

For each `requirement_changes[]` entry in the manifest, reason through:

1. **Which screens directly implement this requirement?**
   Check screen spec files for explicit references to the changed feature/user-type/flow.

2. **Which screens are transitionally affected?**
   A screen is transitionally affected if it links TO or FROM a directly-affected screen
   AND the transition itself carries the changed data (e.g. user role, new flow step).

3. **Does the change affect the design system?**
   Changes to brand, primary colours, typography scale → mark `design_system_affected: true`.
   Feature/flow/user-type changes → `design_system_affected: false` (tokens.json untouched).

4. **Does the screen list itself need updating?**
   New user types or entirely new flows may require new screens or removal of existing ones.
   Mark these explicitly as `screen_list_change: true` with the proposed addition/removal.

5. **Is the change an additive provisional UI?**
   A change is **additive provisional UI** when it adds a transient / conditional surface on top of an existing screen — the default state remains valid and visible, and the new UI only appears under a specific runtime condition. Heuristics (any one is sufficient):
   - (a) **Overlay / replace a region of default only when a runtime condition is true** — e.g. a 1.2s cancel window during a pending move, an undo toast for 3s, a confirmation modal after a destructive action.
   - (b) **Time-limited or user-dismissable** — timeout, explicit close, or acknowledge button returns the screen to default.
   - (c) **Type-analogous to an existing `{screen}--{state}.html` pattern** in this project — e.g. ReversiOne already had `settings--reset-dialog--{light,dark}.html` as state-per-file siblings of `settings--{light,dark}.html`.

   If any of (a)/(b)/(c) holds, **prefer the `state_added` classification** in Step 3 over `affected` — i.e. **preserve the default HTML / Figma frame** and add new `{screen}--{state}.html` file(s) + corresponding Figma frames (Step 30 append-only). This keeps file boundaries aligned with state boundaries and matches the user's expectation that each visible UI state has its own HTML file (set during Phase 3 reviews of dialog / modal sub-states). Folding an additive provisional UI into the default HTML, or stacking two states vertically in one file, are anti-patterns this axis is designed to prevent.

   **命名指針 (collision avoidance)**: 各 `added_states[]` value は (i) Phase 3 既存 sub-state 名 (例: `empty` / `loading` / `error` / `success`) と被らない、(ii) `dual_theme_mode` 環境下では theme suffix (`light` / `dark`) と被らない、(iii) 同 screen の過去 state_added run で既出の値と被らない、を満たすこと。命名は本 Step で impact-analysis.md State-Added Screens 表に列挙する時点で決定する。最終 safety net として Step 29 Step 4c でファイル存在 re-check が行われ、衝突検出時は Pattern C として中断される (実害は中断のみで上書きは絶対に起こらない)。

### Step 3: Classify each screen

For every screen in `00-screen-list.md`, assign one of:

| status | meaning |
|---|---|
| `affected` | Screen content / logic must be updated |
| `new` | Screen does not yet exist and must be created |
| `removed` | Screen is no longer needed and its Figma frame should be deleted |
| `preserved` | Screen is unaffected — HTML and Figma frame are not touched |
| `state_added` | Default HTML / Figma frame is **preserved**; one or more new sub-state HTML files (`{screen}--{state}.html`) are added and corresponding Figma frames are appended (Step 30 append-only). Use for additive provisional UI per Step 2 axis 5. Independent from the plan-driven sub-state pattern driven from Step 25a; `state_added` is **delta-driven ad-hoc state-per-file** and does not require `state-pattern-plan.json`. |

**Sub-state classification (only when `sub_state_aware == true`)**:

各画面の status から sub-state HTML / Figma frame の扱いを以下のルールで自動派生する:

| 画面 status | sub-state HTML | sub-state Figma frame |
|---|---|---|
| `affected` | **regen** (default と同時に再生成) | **recapture** (default frame と同時に old_ 化 → 再キャプチャ) |
| `new` | state-pattern-plan.json があれば**新規生成** / なければ default のみ | 新規キャプチャ |
| `removed` | default と同時に**削除** | default frame と同時に削除 |
| `preserved` | **絶対保護** (READ-ONLY) | **絶対保護** |

> **設計判断**: requirements 変更が default state に影響したなら sub-state にも波及している可能性が高いため、初期実装では `affected` 画面の sub-state は全て regen 対象とする。「default のみ regen / sub-state は preserve」というきめ細かい判断は将来拡張 (本 PR では分類粒度を画面単位に固定)。

> **`state_added` の取扱い (`sub_state_aware` の真偽と独立)**: `state_added` は plan-driven 経路の外にあり、本表の対象外。挙動は上の Step 3 主分類表 (`state_added` 行) に集約済で、要点は (i) 既存 default HTML / Figma frame は **絶対保護**、(ii) 新規 `{screen}--{state}.html` を Step 29 Step 4c が生成、(iii) 新規 sub-state frame を Step 30 Step 3b が **append-only** でキャプチャ。`sub_state_aware == false` の run でも動作する。

### Step 3b: `change_type` 分類

各 `affected` 画面エントリに **`change_type`** field を必須付与する。Step 29 (partial-screen-regen) の HTML 再生成スコープ判断に使う:

| change_type | 定義 | Step 29 の扱い |
|---|---|---|
| `invasive` | default snapshot の見た目 / レイアウト / 文言 / 遷移先が変わる | HTML 再生成 (従来の affected と同じ挙動) |
| `additive` | 既存 default snapshot は不変。新 state (新 enum 値 / 新 feature flag / 条件付き UI 追加) を additively 表示するのみ | **HTML 再生成を skip し、MD spec のみ更新** |
| `data-only` | UI 不変、内部データ流 / API 経路 / 内部 ID 等のみ変更 | **HTML 再生成を skip し、MD spec のみ更新** |

**分類ガイド**:
- ユーザーの change_description が「〜の場合に追加表示する」「〜モードで〜が出る」等、条件付きの additive 追加 → `additive`
- 「default 画面の文言を変える」「遷移先を変える (default 視点)」「レイアウトを変える」 → `invasive`
- 「裏で持つ ID を変える」「保存先を変える」等、画面に visible でない変更 → `data-only`
- **`additive` (change_type) と `state_added` (Step 3 status) の判別**: 両者は「default 不変で新 state を追加」という概念を共有するが、**HTML 成果物の有無**で明確に分かれる。新しい状態の **HTML 成果物 (`{screen}--{state}.html`) + Figma frame が必要** → Step 3 で `state_added` に分類すべき (Step 4c で新規 HTML 生成)。**仕様記述 (`.md`) の更新だけでよく HTML / Figma frame は不要** → `affected` + `additive` (本 change_type、MD spec のみ更新)。Step 3 で `affected` に分類した画面が実は `state_added` 相当だと気づいた場合は、Step 3 に戻って status を再分類する
- 判別が曖昧な場合は **`invasive` (安全側)** にし、Step 5 のゲートでユーザー確認を取る

**新規画面 (`new`)** / **削除画面 (`removed`)** / **不変画面 (`preserved`)** / **`state_added` 画面** は本 field 対象外 (各々 full 生成 / 削除 / 完全保護 / 既存 default は absolute preserve で新規 sub-state HTML のみ生成)。

**Rationale**: ある delta run (既存画面に新 state を additively 表示する変更) で、impact-analysis が当該画面を `affected` と判定し Step 29 が HTML 再生成スコープに含めたが、変更内容は実質 additive で default snapshot は不変だった。HTML を一律再生成すると default snapshot 自体が変更要求の新 state 専用の表示に書き換わり、変更前の default が表現していた代表的ユースケースの描写が出力 HTML から失われる結果になるため、ユーザー判断で MD spec のみ更新に手動 downgrade した経緯がある (Phase 6 mini-retro で feedback-log の `[29] Pattern C` エントリとして抽出)。本 field により判断を構造化し、Step 29 が自動的に正しいスコープで動くようにする。

### Step 4: Write `impact-analysis.md`

```markdown
# Impact Analysis — {change_description}

Run ID: {run_id}  |  Date: {YYYY-MM-DD}

## Summary
{1-2 sentence summary of what changed and overall scope}

## Sub-state Awareness

sub_state_aware: true | false
{sub_state_aware: true → "本プロジェクトは sub-state HTML を生成済み (proceed 経路)。affected/new/removed 画面の sub-state も連動して更新する。"}
{sub_state_aware: false → "sub-state HTML は存在しない。本 delta は default state のみを扱う。"}

## Affected Screens ({N} of {total})

`Sub-states` 列は `sub_state_aware == true` のときのみ記載。各画面に存在する sub-state を列挙し、扱いを `regen` / `new` / `delete` / `preserve` で示す。

`Change Type` 列は `status == affected` の行のみ記載 (Step 3b 参照)。**`Change Type` は Step 3 の sub-state 派生規則より優先される**: `invasive` = default + sub-state を再生成 (Step 3 の `affected` 規則と同じ)、`additive` / `data-only` = default も sub-state も再生成せず MD spec のみ更新する。`sub_state_aware == true` 環境下で `additive` / `data-only` 行の `Sub-states` 列は `(none)` または `all preserve` と記載して Step 29 対象外を明示する。

| Screen | Status | Change Type | Sub-states | Reason |
|---|---|---|---|---|
| scr-002-login | affected | invasive | empty, loading, error → all regen | アカウント種別選択UIを追加 (default snapshot 変更) |
| scr-003-register | affected | invasive | empty, loading, error → all regen | 種別フィールドが必須に変更 |
| scr-004-onboarding | affected | additive | (none) | 制作者 / 入力者 分岐フロー追加 (default は入力者 = 不変、制作者選択時のみ表示分岐) |
| scr-005-profile | affected | data-only | (none) | 内部 ID 保持方式変更、UI 不変 |
| scr-017-creator-dashboard | new | — | empty, loading, error → all new | 制作者専用ダッシュボード（新規） |

## State-Added Screens ({S} of {total})

> **判定ガイド** (Step 2 軸 5 由来): provisional / dialog / modal / window / toast / undo-snackbar 系の **追加 UI** は default 上書きではなく **state-per-file (`state_added`)** を第一選択肢とする。既存の `settings--reset-dialog--{light,dark}.html` が同型の前例。default HTML / Figma frame は preserve、新規 `{screen}--{state}.html` のみ生成、Figma は append-only。default に埋め込む / 同 HTML 内に縦に 2 状態を並べる、は anti-pattern (実プロジェクトで 3 回往復した failure mode)。

| Screen | Added States | New File Paths | Reason |
|---|---|---|---|
| scr-006-board | cancel-window | screens/{web,mobile}/board--cancel-window--{light,dark}.html | F-11 着手キャンセル機能 (1.2s 時限 UI、default の resting 状態は不変) |

## Preserved Screens ({M} of {total})

| Screen | Reason |
|---|---|
| scr-005-home | ユーザー種別に依存しない共通画面 |
| scr-011-video-detail | 動画表示ロジックに変更なし |
| ... | ... |

## Design System Impact
design_system_affected: true | false
{design_system_affected: false → "tokens.json / tokens / style-guide は変更なし。既存デザインシステムをそのまま流用する。"}
{design_system_affected: true → "ブランドカラー / タイポグラフィ等の変更を含む。`/ayatori-design` 再実行が必要。"}

## Screen List Changes
{screen_list_change: true → list of screens to add/remove from 00-screen-list.md}
{screen_list_change: false → "画面一覧への追加・削除なし"}

## Transition Map Changes
{list of transitions that change, or "遷移マップへの変更なし"}

## Screen Entry/Exit Requirements

> **目的**: 画面追加時に「どこから来て・閉じたらどこに戻るか」が未配線のまま生成される事故（最頻発ケース）を防ぐ。`new` / `affected` 画面ごとに、Step 29 で `.mmd` に必ず配線すべき **入口（遷移元）/ 出口（戻り先・前方遷移）** を構造化列挙する。Step 29 Step 2-A の `.mmd` 編集と、Step 29 後の L5 validator ゲートが本表を SoT として参照する。

`new` 画面は入口/出口が**両方とも必須**（少なくとも 1 入口 + 1 出口/戻り、ただし `is_entry_point` / `is_terminal` を除く）。`affected` 画面は遷移が変わる場合のみ記載。chrome 由来の暗黙遷移（ボトムタブ間 / ヘッダー B 子画面→親）は `.mmd` 明示不要（`docs/screen-coverage-check.md` §4-5-2）。

| Screen | Status | 入口（from → via） | 出口/戻り（via → to, kind） | chrome | 備考 |
|---|---|---|---|---|---|
| scr-017-creator-dashboard | new | scrHome →「制作者として開始」 | 「ログアウト」→ scrLogin (forward) / 戻る → scrHome (back) | A | タブ親（ボトムナビ着地） |
| scr-018-creator-detail | new | scr-017 →「詳細」 | 戻る → scr-017 (back) | B | 子画面 |
```

Write to `artifacts/{app_name}/delta/impact-analysis.md`.

### Step 5: Human gate

**Before presenting the gate**: if `design_system_affected: true` was noted in Step 2, display:
> ⚠️ **デザインシステム変更が必要です** — この変更はブランドカラー・タイポグラフィ等の変更を含みます。Delta では対応できないため、`/ayatori-design` 再実行が必要です。Delta として続行する場合はデザインシステムへの変更は反映されません。

Then present AskUserQuestion:
- **インパクト分析の確認** — `artifacts/{app_name}/delta/impact-analysis.md` を確認してください
  - Option A: 承認 — この範囲で Step 29（部分再生成）に進む
  - Option B: 範囲を修正 — 追加・除外する画面を指定する
  - Option C: キャンセル — delta 実行を中止する
  - Option D (only if `design_system_affected: true`): `/ayatori-design` 再実行が必要 — Delta を中止する

**On A (approved)** — run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。Step 27 が完了しているか確認してください。"); exit(1)
data = json.loads(open(path).read())
if not data.get("delta", {}).get("runs"):
    print("ERROR: delta.runs が空です。Step 27 が完了しているか確認してください。"); exit(1)
data["delta"]["runs"][-1].update({
    "affected_screens": __AFFECTED_SCREENS__,  # list[str]: affected 画面名一覧（schema: schemas/pipeline-state.schema.json）。change_type は impact-analysis.md の Affected Screens 表 (Change Type 列) に記載
    "new_screens": __NEW_SCREENS__,
    "removed_screens": __REMOVED_SCREENS__,
    "state_added_screens": __STATE_ADDED_SCREENS__,  # list of {screen, added_states[]} per schema (file paths derive from platform dirs [figma-state.json.scope.user_selected.platforms、fallback = platform_combo + web_viewports 展開] × added_states)
    "sub_state_aware": __SUB_STATE_AWARE__,  # bool
    "impact_approved_at": datetime.now(timezone.utc).isoformat()
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: impact_approved_at written")
PYEOF
```
→ proceed to Step 29.

**On B (modify)**: Ask the user: "修正を自由記述で入力してください。可能な変更は (1) `affected` / `new` / `removed` / `preserved` / `state_added` の各リストへの追加・除外、(2) `affected` 画面の `change_type` (`invasive` / `additive` / `data-only`) の変更、の 2 種類。`state_added` への変更は `{screen}: [{state1}, {state2}, ...]` 形式で追加する state suffix を明示してください (例: `scr-006-board: [cancel-window]`)。" Apply the corrections directly to the screen classification tables in `impact-analysis.md` (`## Affected Screens` / `## State-Added Screens` / `## Preserved Screens` の各セクション、change_type 修正の場合は Affected Screens 表の Change Type 列を更新)。Do **not** re-run Steps 1–4. Re-present the Step 5 gate immediately with the updated lists.

**On C (cancel)** — run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
data = json.loads(open(path).read())
data["delta"]["runs"][-1].update({
    "cancelled_at": datetime.now(timezone.utc).isoformat(),
    "cancel_reason": "user_abort"
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: cancelled_at / cancel_reason written")
PYEOF
```
Display "Delta 実行を中止しました。変更はありません。" and exit.

**On D** (design system change required) — run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
data = json.loads(open(path).read())
data["delta"]["runs"][-1].update({
    "cancelled_at": datetime.now(timezone.utc).isoformat(),
    "cancel_reason": "design_system_required"
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: cancelled_at / cancel_reason written")
PYEOF
```
Display "デザインシステム変更が必要なため Delta を中止しました。`/ayatori-design` を実行してください。" and exit.

---

## Output
- `artifacts/{app_name}/delta/impact-analysis.md`
- `pipeline-state.json` — `delta.runs[-1].{impact_approved_at, affected_screens, new_screens, removed_screens, state_added_screens, sub_state_aware}` set (`affected_screens` は affected 画面名の string 配列（schema: `schemas/pipeline-state.schema.json`）。change_type は `impact-analysis.md` の Affected Screens 表 (Change Type 列) に記載)
