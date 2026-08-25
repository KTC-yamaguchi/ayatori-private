---
name: 25e-figma-pattern-export
description: 25d で承認された sub-state HTML 群を figma-capture-runner subagent の substate モードで Figma に追加 capture し、既存の default frame を上書きせず sub-state node のみ idempotent に append する。Phase 3 の Step 25e として実行され、Phase 3 完全完了 (completed_at_states) の合図を立てる。FIGMA_MCP_ENABLED=false のときは stub として即終了する。
---

# 25e Figma 追加出力 (sub-state capture)

## 役割

25d で承認された sub-state HTML 群を Figma に追加 capture する。既存 `figma-capture-runner` subagent を **`mode: substate`** で起動し、Step 22 が生成済の default 状態 frame を絶対に上書きせず sub-state node のみ追加 (idempotent append)。

Phase 3 完全完了 (`completed_at_states`) の合図を立てる最終 step。

`FIGMA_MCP_ENABLED=false` のときは `figma_status = "skipped_stub_mode"` を記録して即終了 (Phase 4 retro へ)。

## 前提条件

- Step 25d 完了 (`pipeline-state.json.approvals.patterns_human_approved == true`)
- `state-pattern-plan.json` 存在
- `figma-state.json` 存在 (Step 22 で生成済)
- Step 25d で `decision == "approve"` (Branch A) を選択

---

## 実行指示

### Phase 0: 前提検証

#### Step 0-1: 承認状態 assert

```
pipeline-state = Read pipeline-state.json
assert pipeline-state.approvals.patterns_human_approved == true
assert pipeline-state.screens.step25d.decision == "approve"
# defense-in-depth: 25c が最新 25b 出力を採点済みであること (25d assert で保証済のはずだが、
# 承認 (patterns_human_approved) が 25c を経ずに書かれた異常系を 25e でも検出する)
assert pipeline-state.screens.step25c.completed_at is set
       and epoch(pipeline-state.screens.step25c.completed_at) >= epoch(pipeline-state.screens.step25b.completed_at)
       # 比較は epoch 換算 (+09:00 / Z 等の TZ 表記混在で文字列比較は新旧逆転するため)
```

assert 失敗時は warning を出して中断 ("25d で承認されていません、または 25c 採点が未実施です。25c → 25d を再実行してください")。

#### Step 0-2: Figma MCP mode 検出

`skills/00-figma-mode-detect/SKILL.md` を Read して mode を判定する (env var `FIGMA_MCP_ENABLED`)。

##### mode == "disabled" の場合

`pipeline-state.json` を Read or {init stub} → merge:

- `screens.step25e.completed_at = <現在 ISO 8601>`
- `screens.step25e.figma_status = "skipped_stub_mode"`
- `approvals.completed_at_states = <現在 ISO 8601>` (sub-state Figma 同期は skip だが、HTML 自体は揃っているので Phase 3 完全完了の合図は立てる)
- `app_name` assert
- Write back

完了報告:

```
FIGMA_MCP_ENABLED=false のため Figma 追加 capture を skip しました。
- sub-state HTML は artifacts/{app_name}/screens/{platform}/{画面名}--{state}.html に揃っています
- figma-state.json には追加していません

→ Phase 4 retro へ進みます
→ skills/26-retro/SKILL.md を Read して 26 を実行
```

##### mode == "enabled" の場合

Step 0-3 へ進む。

#### Step 0-3: figma-state.json 存在 assert

```
test -f artifacts/{app_name}/figma-state.json || abort "figma-state.json が存在しません。Step 22 が完了していますか?"
```

### Phase 1: target_files 算出

#### Step 1-1: 期待 sub-state capture 一覧の構築

`state-pattern-plan.json` からの (screen × state × platform × theme) 全組合せ構築は、決定論 script `scripts/expand-substate-plan.mjs` に一本化されている (25b Phase 1 と同一実装。**LLM 側で path / key 組み立てを再実装しない** こと):

```bash
node scripts/expand-substate-plan.mjs artifacts/{app_name}/screens/state-pattern-plan.json \
  --requirements artifacts/{app_name}/requirements.json
```

exit 0 の stdout JSON `expected[]` をそのまま `expected_substate_files` として使う。各要素は `{key, html_path, platform, screen, state, theme}`:

- `key` = capture キー (figma-state.json `nodes.screens` のキーと同形式)。single-theme は `{platform}/{screen}--{state}`、dual-theme は `{platform}/{screen}--{state}--{theme}`
- `html_path` = `screens/{platform}/{screen}--{state}.html` (single-theme、現行互換) / `screens/{platform}/{screen}--{state}--{theme}.html` (dual-theme)
- `themes` 欠落 (legacy plan) は `["default"]` と解釈され、theme suffix なしの現行 single-theme 経路が維持される
- **exit 1** (plan 契約違反 / pair assertion 失敗) は 25b と同様 Pattern C を `feedback-log.md` に記録して中断 (通常は 25b / 25c を通過済のため発生しない)。**exit 2** (運用エラー) は stderr を確認して入力を修復

> **dual_theme=true での件数**: 1 画面 × 1 state × 1 platform につき light / dark 2 件の expected が生まれる。Figma 側でも `{画面名}--{state}--light` / `{画面名}--{state}--dark` の 2 node が対称に capture される。Step 22 が dual_theme の main HTML で生成した node key (`{画面名}--light` / `--dark`) と命名規約が整合する。

#### Step 1-2: 既存 figma-state.json から差集合計算

```python
figma_state = Read figma-state.json
already_captured = set(figma_state.nodes.screens.keys())  # 既に Step 22 や前回 25e で capture 済

target_files = []
for e in expected_substate_files:
  if e.key not in already_captured:
    target_files.append(e.html_path)
```

`target_files.length == 0` なら全件 capture 済 → Phase 3 の完了処理へ直接 skip。

### Phase 2: figma-capture-runner 起動 (mode: substate)

`figma-capture-runner` subagent を **1 回だけ** 起動する。`mode: substate` は sub-state 用の mode (既存 `figma-capture-runner.md` 側で別途実装する想定。本 skill は呼び出しのみを定義)。

#### 起動 prompt

```
Agent({
  subagent_type: "figma-capture-runner",
  description: "Step 25e Figma substate capture for {target_files.length} files",
  prompt: """
mode: substate
resume: false
resume_layout_mode: null   # agent 側が layout 所有権で解決 (auto_grid* → full 全体再タイル化 / manual → new_only)
app_name: {app_name}
file_key: {figma-state.json.file_key}
page_id: {figma-state.json.page_id}
target_files: {target_files JSON array (theme 軸込みの 4 次元 cartesian path 群)}
scope_q1: {figma-state.json.scope.user_selected.platforms}   # state-pattern-plan と一致するはず
scope_q2_substate: {state-pattern-plan の states 一覧 (substate mode 専用 field)}
scope_q3_themes: {state-pattern-plan の themes 一覧 (追補、["default"] or ["light","dark"])}
"""
})
```

> **target_files の命名規約**: `theme == "default"` (single-theme) では `screens/{platform}/{画面名}--{state}.html`、`theme in {"light", "dark"}` (dual-theme) では `screens/{platform}/{画面名}--{state}--{theme}.html`。figma-capture-runner はこの suffix から theme と state を parse して Figma node key を構築する。

#### Q1 / Q2 / Q3 を再質問しないこと

`mode: substate` では:
- `scope_q1` (platform) は state-pattern-plan.json の `platforms` (= Step 22 で user_selected 済) と一致するため再質問不要
- `scope_q2` (state) は state-pattern-plan.json で確定済なので再質問不要
- `scope_q3` (theme) は state-pattern-plan.json で確定済 (`themes` 配列)。dual_theme プロジェクトでは light / dark の対称 capture が必須 (片 theme のみの capture は state-pattern-plan で禁止しているため自然と発生しない)

subagent 側で AskUserQuestion を起動しないように `mode: substate` の振る舞いを定義する (これは `.claude/agents/figma-capture-runner.md` 側で実装する。本 skill は呼び出し契約のみ定義)。

#### 既存 default node の扱い (layout 所有権ベース)

`resume_layout_mode` は agent (`figma-capture-runner` §2d-1) が `figma-state.json.scope.layout_status` から解決する:
- **`auto_grid*` (パイプラインが最後に整列した = 手動配置なし)** → **`full`**: default + sub-state 全 frame を grid 最終形 (cols = states × platforms) に再タイル化する。sub-state 追加時に全体座標を振り直さないと、新 frame が既存 default の位置に重なって生成されるため、これが既定動作。
- **manual / 不明 (人間が Figma 上で手動配置した可能性)** → **`new_only`**: 既存 frame の位置を保護し、新規 sub-state frame のみ配置。

いずれの場合も default キーの **node_id 値は書き換えない** (再キャプチャしない、append-only)。

### Phase 3: Return 受信

`figma-capture-runner` の return summary を受領する。subagent は `figma-state.json` を直接 Write 済 (append-only、default key 保護)。

#### Step 3-1: figma-state.json を Read で結果検証

```python
figma_state = Read figma-state.json
captured_substate_keys = []
for e in expected_substate_files:
  if e.key in figma_state.nodes.screens:
    captured_substate_keys.append(e.key)

actual_count = len(captured_substate_keys)
expected_count = len(expected_substate_files)
```

#### Step 3-2: figma_status を判定

```
if actual_count == expected_count:
  figma_status = "success"
elif actual_count > 0:
  figma_status = "partial_success"
else:
  figma_status = "partial_success"   # 全件失敗も partial として扱い、resume で再試行を促す
```

#### Step 3-3: pipeline-state.json 更新

`pipeline-state.json` を Read or {init stub} → merge:

- `screens.step25e.completed_at = <現在 ISO 8601>`
- `screens.step25e.figma_status = {success | partial_success | skipped_stub_mode}`
- `screens.step25e.figma_sync_status` を以下のルールで書き込む (レビュー対応、Phase 5 delta の guard 用):
  - `figma_status == "success"` → `"complete"`
  - `figma_status == "partial_success"` (deferred 残あり、resume で再試行) → `"partial"`
  - `figma_status == "skipped_stub_mode"` (FIGMA_MCP_ENABLED=false) → `"complete"` (Figma 同期 path 自体が non-applicable、Phase 5 delta も同 flag で動かない経路に入るため `complete` 相当扱い)
  - 反復 partial_success の Option 2 escalation (下記「デッドロック対策」参照) → `"skipped_by_user"`
- `approvals.completed_at_states` の書き込みは **条件付き** (レビュー対応 H-1、不変条件 #4 「full success 時のみ」との整合):

  | `figma_status` | escalation 経路 | `completed_at_states` | `figma_sync_status` | Phase 4 retro 起動 | Phase 5 delta `sub_state_aware` |
  |---|---|---|---|---|---|
  | `success` | (なし、通常) | **書き込む** | `complete` | OK | true (sub-state を扱う) |
  | `skipped_stub_mode` | (なし、`FIGMA_MCP_ENABLED=false`) | **書き込む** | `complete` (non-applicable) | OK | true (legacy 経路、副作用なし) |
  | `partial_success` | Option 2 (user が「Figma スキップで完了」を明示選択) | **書き込む** | `skipped_by_user` | OK | **false に downgrade** (Step 28 / 30 guard) |
  | `partial_success` | (通常、Option 2 未選択 / Option 1 / 3) | **書き込まない** | `partial` | block (resume 再試行) | (Phase 5 不到達) |

  state machine の本質: `completed_at_states` 立つ = 「Phase 3 完全完了として Phase 4 retro 起動 OK」を意味する。Figma 同期の実態は `figma_sync_status` 独立フラグで表現し、Phase 5 delta は両方を Read して sub_state_aware を判定する (28 = primary、30 = defense-in-depth)。
- `app_name` assert
- Write back

#### Step 3-4: 完了報告

`figma_status == "success"` の場合:

```
25e: sub-state を Figma に追加 capture しました。
- 追加 capture 件数: {actual_count}/{expected_count}
- figma_status: success
- Figma file URL: {figma-state.json から抽出}
- approvals.completed_at_states を記録 (Phase 3 完全完了)

→ Phase 4 retro へ進みます
→ skills/26-retro/SKILL.md を Read して 26 を実行
```

`figma_status == "partial_success"` の場合:

```
25e: 一部 sub-state の capture が deferred として残っています。
- capture 成功: {actual_count}/{expected_count}
- deferred: {expected_count - actual_count} 件 (figma-state.json.scope.deferred_remaining 参照)

完全完了するには次回 /ayatori-screens 起動時に 25e を再実行してください。
それまでは Phase 4 retro に進まずここで一旦終了します。
```

`figma_status == "skipped_stub_mode"` の場合 (Phase 0 で既に処理済なので通常通らない、defensive):

```
FIGMA_MCP_ENABLED=false のため Figma 追加 capture を skip しました。
→ Phase 4 retro へ進みます
→ skills/26-retro/SKILL.md を Read して 26 を実行
```

---

## Resume 挙動

- セッション中断で `screens.step25e.completed_at` が立たないまま終了した場合、次回 25e 起動時に Phase 1 の差集合計算で **未 capture の sub-state のみ** target_files に乗る (idempotent append)
- `figma-capture-runner.scope.deferred_remaining[]` (P-15 既存機構) に未 capture が残っている場合、figma-capture-runner 側の resume mode が自動検出する

## 失敗時の挙動

| 失敗 | 対応 |
|---|---|
| `patterns_human_approved` が false (assert 失敗) | warning → 中断、user に 25d 再実行を案内 |
| `figma-state.json` 不在 | warning → 中断、Step 22 完了確認を案内 |
| `figma-capture-runner` が `mode: substate` 未対応 | feedback-log.md に Pattern C (skill design flaw) 記録、figma_status = `partial_success` で記録して中断 |
| capture 全件失敗 | figma_status = `partial_success`、`approvals.completed_at_states` は **書かない** (Phase 3 完全完了の合図を立てない)。次回 resume で再試行 |

### 反復 partial_success のデッドロック対策

Figma MCP server の長期障害等で 25e が partial_success のまま 3 回連続で抜けられない場合、`completed_at_states` が立たず Phase 4 retro へ進めないデッドロックに陥る。これを回避するため、本 skill は以下を実装する:

1. `screens.step25e.partial_attempt_count` (整数、`schemas/pipeline-state.schema.json` で定義済) を partial_success のたびに加算する
2. `partial_attempt_count >= 3` を検出したら、AskUserQuestion で user に escalation:
   - "Option 1: 再試行 (`figma-capture-runner` を再度起動)"
   - "Option 2: skip-figma で Phase 3 完了 (`completed_at_states` を強制的に立てて Phase 4 retro へ進む。Figma との同期は手動 / 別 PR で対応)"
   - "Option 3: 中断 (本セッション終了、次回 25e 再起動)"
3. Option 2 選択時は `figma_status = "partial_success"` のまま `completed_at_states` を立て、**さらに `figma_sync_status = "skipped_by_user"` を書き込む**。feedback-log.md に Pattern C (Figma sync deferred) を記録

これにより Figma MCP の長期障害があっても user が明示判断すれば Phase 4 retro に進める経路を確保する。**ただし `figma_sync_status = "skipped_by_user"` が立つことで、Phase 5 delta は本フィールドを Read して `sub_state_aware` を false に強制 downgrade する (Step 28 / Step 30 の pre-flight で実装)** — Figma に存在しない sub-state node_id を参照しようとして Step 30 がクラッシュする事態を避ける。

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/figma-state.json` | `nodes.screens.{key}` に sub-state node を append (subagent が直接 Write、default key 保護) |
| `artifacts/{app_name}/pipeline-state.json` | `screens.step25e.{completed_at, figma_status, figma_sync_status, partial_attempt_count}`, `approvals.completed_at_states` (success / skipped_stub_mode / Option 2 escalation 時のみ — 詳細は Step 3-3 の state machine 表参照) |

## 不変条件

1. **既存 default node の node_id を絶対に書き換えない** (再キャプチャ禁止、append-only)。frame の **位置** は layout 所有権ルールに従い agent が再タイル化してよい (`auto_grid*` → full / manual → new_only、Phase 2「既存 default node の扱い」参照)
2. **AskUserQuestion を起動しない**: state-pattern-plan.json で全 scope 確定済 (Q1/Q2 不要)
3. **patterns_human_approved=true を assert**: 承認なし状態での figma-capture-runner 起動を禁止
4. **completed_at_states は full success / skipped_stub_mode / Option 2 escalation 時のみ**: 通常の partial_success (deferred 残あり) で立てると Phase 4 retro が中途半端な状態で起動する。詳細は Step 3-3 の state machine 表参照 (レビュー対応 H-1 で 4 ケース条件付き化済)

## 参照

- `schemas/pipeline-state.schema.json` — `screens.step25e`, `approvals.completed_at_states`
- `schemas/figma-state.schema.json` — `nodes.screens` append schema
- `.claude/agents/figma-capture-runner.md` — `mode: substate` の実装 (本 skill と並行追加予定)
- `skills/22-figma-export/SKILL.md` — Step 22 default capture (本 skill が補完する形)
- `skills/00-figma-mode-detect/SKILL.md` — env var 判定
- `skills/26-retro/SKILL.md` — 次ステップ
