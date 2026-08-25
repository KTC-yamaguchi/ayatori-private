---
name: 25a-state-pattern-plan
description: Phase 3 の Step 25a。Step 23 で承認された main HTML 完了状態を起点に、sub-state パターン (empty / loading / error 等) を追加生成するか否かを user に確認する。proceed なら state-pattern-plan.json を生成、skip なら Step 25b-25e を飛ばして Phase 4 retro へ移行する。
---

# 25a パターン要否ヒアリング → state-pattern-plan.json 生成 OR skip

## 役割

Step 23 (final approval) で承認された main HTML 完了状態を起点に、**sub-state パターン (empty / loading / error 等) を追加生成するか否か** を user に確認する。proceed なら state-pattern-plan.json (loop 不変量) を初回のみ生成、skip なら `pipeline-state.json.screens.state_pattern_skipped=true` を立てて 25b-25e をスキップして Phase 4 retro へ移行する。

旧 Step 17 が main + 全 sub-state を一気に並列生成していたフローを、main → final_approved → 任意で sub-state 追加 の二段階モデルに分解する起点。

## 前提条件

- Step 23 (`final_approved == true`) 承認済み
- `artifacts/{app_name}/requirements.json` が存在 (design_output_scope.state_pattern が推奨デフォルト)
- `artifacts/{app_name}/screens/00-screen-list.md` が存在 (生成対象画面一覧)
- `artifacts/{app_name}/figma-state.json` が存在 (Step 22 で生成済、default Figma URL を質問本文に埋め込むのに使う)
- `artifacts/{app_name}/pipeline-state.json` の `app_name` と現ディレクトリ名が一致

---

## 実行指示

### Phase 0: Read inputs

以下を Read する:

1. `artifacts/{app_name}/requirements.json` — `design_output_scope.state_pattern` (推奨デフォルト) と `design_output_scope.platform_combo` (生成対象 platform) と `design_output_scope.dual_theme_mode` (theme 軸の決定)
2. `artifacts/{app_name}/figma-state.json` — `nodes.screens` から default 状態の Figma node URL を抽出 (質問本文に埋め込む)
3. `artifacts/{app_name}/screens/00-screen-list.md` — 画面リスト (全画面が sub-state 対象)
4. `artifacts/{app_name}/pipeline-state.json` (or lazy init stub `{ "app_name": "{app_name}" }`)

#### 再入 (後続生成) 検出

`pipeline-state.json.screens.state_pattern_skipped == true` で本 step に到達した場合、これは **一度「不要」を選んだ後の後続生成 再入** である (preamble の再入判定 AskUserQuestion で「生成する」を選んだ経路)。フラグ `{reentry_from_skip} = true` を立て、以下を後段で反映する:

- Q1 の質問本文に「以前 sub-state を skip しましたが、今回は生成できます」の一文を添える。
- Branch B (proceed) 時に `screens.state_pattern_skipped` を **`false` に解除** する (skip 状態のまま plan を作ると preamble 判定と矛盾するため)。
- Branch A で再び「不要」を選んだ場合は skip 状態を維持 (変更なし)。

`state_pattern_skipped` が未設定 / false の通常初回フローでは `{reentry_from_skip} = false`。

#### 推奨デフォルトの算出

`design_output_scope.state_pattern` の値に応じて Q1 の推奨ラベルを切替:

「Q1 推奨選択肢」は必ず下記 Q1 の **実在 option label**（`不要 (default のみで完了)` / `4 状態すべて (empty/loading/error)` / `個別指定` / `後で決める`）のいずれかを指す。`nature_based_extra_states` は専用 option を持たず（AskUserQuestion の option 上限 4 個のため増設しない）、**「4 状態すべて」を推奨し、生成時に画面性質依存の追加状態を自動付与する**形で表現する:

| state_pattern 値 | Q1 推奨選択肢 (実在 label) | 想定 user_decision |
|---|---|---|
| `default_only` (or 未設定 / 不明) | **"不要 (default のみで完了)"** を推奨 | `skip` |
| `required_4_states` | **"4 状態すべて (empty/loading/error)"** を推奨 | `all_four` |
| `nature_based_extra_states` | **"4 状態すべて (empty/loading/error)"** を推奨（生成時に画面性質依存の追加状態を自動付与、Step B-1 参照） | `nature_based` |

> 初回フローでは `state_pattern` の既定値が `default_only` (pipeline.yaml の fallback も `default_only`) であり、**Q1 は「不要」を推奨**する。これは「main を素早く一周させ、sub-state は任意の追加出力にする」という二段階完了モデルの意図に沿う。sub-state を作りたい user は Q1 で「4 状態すべて」/「個別指定」を明示選択できる（推奨マークが付かないだけで選択は妨げない）。`required_4_states` / `nature_based_extra_states` は user が Step 01 7-c で「将来作るときの既定の広さ」を明示した場合にのみ立ち、その時は「4 状態すべて」を推奨する（`nature_based_extra_states` の追加状態は user_decision=`nature_based` として Step B-1 の生成ロジックが付与する）。

#### platform 一覧の算出

`design_output_scope.platform_combo` + `design_output_scope.web_viewports`（欠落時 `["desktop"]`）から生成対象 platform dirs を決める。Step 17 の展開規則と同一 (固定順 `["web", "web-sm", "mobile"]`):

| platform_combo | web_viewports | sub-state 生成対象 platform dirs |
|---|---|---|
| `web_only` | `["desktop"]` (or 欠落) | `["web"]` |
| `web_only` | `["desktop", "sm"]` | `["web", "web-sm"]` |
| `web_only` | `["sm"]` | `["web-sm"]` |
| `mobile_only` | — (無視) | `["mobile"]` |
| `mobile_and_web` | `["desktop"]` (or 欠落) | `["web", "mobile"]` |
| `mobile_and_web` | `["desktop", "sm"]` | `["web", "web-sm", "mobile"]` |
| `mobile_and_web` | `["sm"]` | `["web-sm", "mobile"]` |

**実装済み main HTML との整合ガード**: 上記で算出した platform dir に main HTML (`screens/{platform}/{画面名}.html`) が存在しない場合はその dir を対象から除外し、警告として表示する (25b は main 継承方式のため main 不在では生成できない)。

#### theme 一覧の算出

`design_output_scope.dual_theme_mode` から sub-state の theme 軸を決める。Step 17 の dual_theme 出力 (`{画面名}--light.html` / `--dark.html`) と整合させる:

| dual_theme_mode | sub-state 生成対象 theme | ファイル命名規約 |
|---|---|---|
| `false` or 未設定 | `["default"]` | `{画面名}--{state}.html` (theme suffix なし、現行 single-theme と完全互換) |
| `true` | `["light", "dark"]` | `{画面名}--{state}--{theme}.html` (light/dark の対称生成、Step 17 dual_theme 命名 `--{theme}` に state suffix を加えた形式) |

この `selected_themes` を Branch B Step B-1 で各 `screens[]` エントリの `themes` 配列にそのまま転記する。`true` のとき必ず light / dark の両 theme を含めて対称生成を保証する (片 theme のみの生成は禁止)。

### Phase 1: ヒアリング (2 段階 — Q1 は AskUserQuestion / Q2 は plain chat)

#### Q1: Sub-state 出力選択 (single select)

AskUserQuestion で以下を提示する。`header` は 12 文字以内厳守 (Unicode escape リスク回避のため絵文字は使わない):

```
header: "Sub-state 出力選択"

question: |
  Step 23 で main 画面の HTML が承認されました。続けて sub-state パターン
  (empty / loading / error 等) を追加生成しますか?
  {reentry_from_skip == true のときのみ添える: 「(以前 sub-state を skip しましたが、今回改めて生成できます)」}

  推奨デフォルト: {Q1 推奨ラベル}
  対象 platform: {selected_platforms}
  対象画面数: {N 画面}
  Figma default 状態 (確認用): {default_figma_url}

  追加生成すると 25b (HTML 生成) → 25c (採点) → 25d (承認) → 25e (Figma 追加)
  まで自動で進みます。今のセッションで決められない場合は「後で決める」を
  選んでください (state は確定せず、次回 25a が再起動します)。

options:
  - label: "不要 (default のみで完了)"
    description: "sub-state は生成せず Phase 4 retro へ進む。pipeline-state.json.screens.state_pattern_skipped=true を記録"
  - label: "4 状態すべて (empty/loading/error)"
    description: "empty / loading / error の sub-state を全画面に生成。source_enum が nature_based_extra_states のときは画面性質依存の追加状態も自動付与"
  - label: "個別指定"
    description: "Q2 で生成する state を複数選択する"
  - label: "後で決める"
    description: "state を確定せず終了。次回セッションで 25a が再起動する"
```

> **推奨マーカーの付け方**: option label / description はユーザー向け表示文のみとし、推奨の表現は **本注釈と質問本文の `推奨デフォルト:` 行で完結させる**（option description に「(推奨)」やその付与条件を直接埋め込まない）。具体的には、上記「推奨デフォルトの算出」表で決まった 1 つの選択肢を `推奨デフォルト:` 行に label 名で記載する。`default_only` / 未設定の初回フローでは `推奨デフォルト: 不要 (default のみで完了)` となる。AskUserQuestion の option ラベル文字列・並び順は固定する（option の並び替え・「(推奨)」追記はしない）。

> **注**: AskUserQuestion を **直接** 呼ぶ (本 repo に `skills/00-ask-with-proofread/` は現状存在しない。将来導入されたら proofread 経由に切り替える)。option label は **絵文字 / 全角丸括弧の単独使用を避け**、ASCII 純度を高めに保つ (Unicode escape failure 回避、memory `feedback_askuserquestion_unicode_escape.md` 参照)。動的展開する `default_figma_url` は質問本文ではなく option description にも分散すると校閲ノイズを減らせる。

#### Q2: 個別指定時のみ — plain chat 番号付きリスト (AskUserQuestion 不使用)

Q1 で「個別指定」を選んだ場合のみ、候補 state を plain chat の番号付きリストで提示する。候補が 5 種あり AskUserQuestion の option 上限 4 を超えるため、`skills/01b-add-feature-question/SKILL.md` § Plain chat fallback の書式に統一する:

```
生成する sub-state を 1 つ以上選んでください。
選択した state は全画面 × 全 platform に対して生成されます
(画面ごとの個別カスタマイズは現バージョンでは未対応)。

1. empty (データなし状態)
2. loading (skeleton / spinner)
3. error (失敗 + retry)
4. modal-dialog (確認・選択ダイアログ)
5. validation-error (フォーム入力エラー)

選択方法: 該当する番号をカンマ区切りで返信してください (例: 「1, 2, 3」)。複数選択可。
全件の場合は「all」と返信してください。
```

返信された番号を state 名に解決し、`selected_states[]` に格納する (例: `["empty", "loading", "error"]`。「all」は全 5 state)。番号 / `all` のいずれにも解決できない返信、または解決できない番号が含まれる返信は同リストを再提示する。ただし「やめる」「後で決める」等の中止意図の返信は再提示ループに固定せず、Q1 の「後で決める」(Branch A) と同じ扱いにする。

### Phase 2: Output

#### Branch A: Q1 == "不要" or "後で決める"

- **"不要"**: pipeline-state.json を `Read or {init stub}` → merge → Write back:
  - `screens.state_pattern_skipped = true`
  - `screens.step25a_completed_at = <現在 ISO 8601>`
  - **app_name field が存在し非空であることを Write 前に assert** (docs/artifact-file-responsibility.md § 設計原則 4)
- **"後で決める"**: `screens.step25a_completed_at` を **書かない** (state 未確定 = 次回 25a 再起動の signal)。pipeline-state.json は更新しない (空 update を避ける)。
- 完了報告:

```
Sub-state 生成を skip しました (state_pattern_skipped=true)。Phase 4 retro へ進みます。
→ skills/26-retro/SKILL.md を Read して 26 を実行
```

または「後で決める」の場合:

```
Sub-state 生成の決定を保留しました。次回セッションで 25a が再起動します。
本セッションは Phase 4 retro に進まずここで一旦終了します。
```

#### Branch B: Q1 == "4 状態すべて" or "個別指定"

##### Step B-1: state-pattern-plan.json を生成

`artifacts/{app_name}/screens/state-pattern-plan.json` を新規作成 (Write):

```json
{
  "app_name": "{app_name}",
  "created_at": "<現在 ISO 8601>",
  "source_enum": "{default_only | required_4_states | nature_based_extra_states}",
  "user_decision": "{all_four | individual | nature_based}",
  "screens": [
    {
      "screen": "01-login",
      "states": ["empty", "loading", "error"],
      "platforms": ["web", "mobile"],
      "themes": ["light", "dark"]
    },
    {
      "screen": "02-dashboard",
      "states": ["empty", "loading", "error"],
      "platforms": ["web", "mobile"],
      "themes": ["light", "dark"]
    }
  ],
  "user_approved_at": "<現在 ISO 8601>"
}
```

> **注**: 上記 JSON 例は `dual_theme_mode == true` の場合 (`themes: ["light", "dark"]`)。`dual_theme_mode == false` (or 未設定) の場合は各エントリの `themes` を `["default"]` に置き換える (ファイル命名規約は theme suffix なしになり現行互換)。

**生成ロジック**:

- まず Q1 で選んだ実在 option label と `source_enum` から `user_decision` を確定する:
  - Q1 = "個別指定" → `user_decision = individual`
  - Q1 = "4 状態すべて (empty/loading/error)" かつ `source_enum == nature_based_extra_states` → `user_decision = nature_based`（「4 状態すべて」は専用 option を持たない nature_based の到達経路を兼ねる。推奨表参照）
  - Q1 = "4 状態すべて (empty/loading/error)" かつ それ以外の source_enum → `user_decision = all_four`
- `screens[]` は `00-screen-list.md` の **全画面** をループ
- 各画面の `states[]` は確定した `user_decision` から決定:
  - `all_four` → `["empty", "loading", "error"]` (default は含めない、main HTML が既存)
  - `individual` → Q2 で選択された `selected_states[]` をそのまま
  - `nature_based` → `["empty", "loading", "error"]` + 画面性質に応じた追加 (フォーム画面なら `modal-dialog` / `validation-error`、削除画面なら `modal-dialog`)。性質判定は画面仕様 MD (`screens/{画面名}.md`) を Read して `## 状態パターン` セクションから抽出
- 各画面の `platforms[]` は Phase 0 で算出した `selected_platforms` をそのまま
- 各画面の `themes[]` は Phase 0 で算出した `selected_themes` をそのまま (`dual_theme_mode==true` なら `["light", "dark"]`、それ以外なら `["default"]`)。**全画面で同じ themes 配列を持つ** (画面ごとに theme を変えるユースケースは現バージョン未対応)
- `nature_based` で画面ごとに state が異なる場合は `rationale` フィールドに理由を書く

**schema 整合性**:

`schemas/state-pattern-plan.schema.json` に準拠 (additionalProperties: false)。`required: ["app_name", "created_at", "screens"]`。

##### Step B-2: pipeline-state.json 更新

`pipeline-state.json` を `Read or {init stub}` → merge → Write back:

- `screens.step25a_completed_at = <現在 ISO 8601>`
- **`{reentry_from_skip} == true` の場合**: `screens.state_pattern_skipped = false` に解除 (skip したまま plan を持つと preamble 判定が矛盾するため。以降は通常の 25b→25c→25d→25e フローに乗る)
- **app_name field が存在し非空であることを Write 前に assert**

##### Step B-3: 完了報告

```
state-pattern-plan.json を生成しました。
- 対象画面: {N} 画面
- state 種別: {states[]} (例: empty / loading / error)
- platform: {platforms[]}
- 推定生成ファイル数: {N × states.length × platforms.length}

次に 25b で sub-state HTML を生成します。
→ skills/25b-state-pattern-gen/SKILL.md を Read して 25b を実行
```

---

## 失敗時の挙動

| 失敗 | 対応 |
|---|---|
| Q1 AskUserQuestion で ESC (user cancel)、または Q2 plain chat で中止意図の返信 | `pipeline-state.json.screens.step25a_completed_at` を **書かない** → 次回再質問。Branch A "後で決める" と同じ扱い |
| `00-screen-list.md` が存在しない | エラー出力 → ユーザーに「Step 14 が完了していないようです。`/ayatori-screens` を最初から実行してください」を表示して中断 |
| `figma-state.json` が存在しない | warning を出して Q1 の質問本文の Figma URL 欄を空にする (sub-state plan 生成は継続) |
| state-pattern-plan.json schema validation 失敗 | ファイルを書かず feedback-log.md に Pattern B を記録、user に再実行を促す |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/screens/state-pattern-plan.json` | Branch B のみ新規作成 (schema: state-pattern-plan.schema.json) |
| `artifacts/{app_name}/pipeline-state.json` | `screens.step25a_completed_at` (Branch A "不要" + Branch B), `screens.state_pattern_skipped=true` (Branch A "不要" のみ), `screens.state_pattern_skipped=false` (Branch B かつ `{reentry_from_skip}==true` のとき解除) |

## 参照

- `schemas/state-pattern-plan.schema.json` — 出力 schema
- `schemas/pipeline-state.schema.json` — `screens.step25a_completed_at` / `screens.state_pattern_skipped`
- `skills/25b-state-pattern-gen/SKILL.md` — 次ステップ (Branch B 時)
- `skills/26-retro/SKILL.md` — 次ステップ (Branch A "不要" 時)
