---
name: 25c-state-pattern-score
description: 25b で生成した sub-state HTML 群を Layer 2「状態可視性 & フィードバック」軸で sub-state 視点から再採点し、state-pattern-scores.json に記録する。Phase 3 の Step 25c として実行され、採点結果に応じて 25b との mini-loop (max 2 回) または 25d へ分岐する。
---

# 25c パターン採点 (sub-state)

## 役割

25b で生成した sub-state HTML 群に対し、Layer 2 「状態可視性 & フィードバック (6pt)」軸を **sub-state 視点** で再評価する。加えて **画面間横断一貫性 (cross-screen consistency) 軸** (Step 1-2b) を追加し、同じ state を持つ複数画面を横に並べて CTA クラス / フォント・アイコン・レイアウト位置・ラベル規約・ナビ慣習のばらつきを検出する (独立並列生成による大域不整合の捕捉)。Step 19 (`scores.json`) は main 視点の採点なので分離 (単一所有権原則)。本 step は `state-pattern-scores.json` のみを書く。

採点結果に応じて mini-loop (25b ↔ 25c, max_attempts: 2) を駆動する:
- `ai_improvable_deductions > 0` かつ `attempts.length < max_attempts (2)` → 25b に戻る (25b が pending を再計算して該当 sub-state を再生成)
- それ以外 → 25d (人間ゲート) へ進む


## 前提条件

- Step 25b 完了 (`pipeline-state.json.screens.step25b.completed_at` が立っている)
- `state-pattern-plan.json` 存在 (Read only)
- `pipeline-state.json.screens.step25b.completed_files[]` に全 sub-state HTML パスが記録済
- `docs/screen-coverage-check.md` (L1 ui_states 判定基準の参照スペック)
- `tokens.json` (state color の存在確認用)

---

## 実行指示

### Phase 0: Read inputs

以下を Read する:

1. `artifacts/{app_name}/screens/state-pattern-plan.json` — 採点対象 scope
2. `artifacts/{app_name}/pipeline-state.json` — `screens.step25b.completed_files[]` から sub-state HTML パス取得
3. `artifacts/{app_name}/tokens.json` — state color token (error-bg / loading-skeleton 等) の存在確認
4. `artifacts/{app_name}/screens/state-pattern-scores.json` (or lazy init stub `{ "app_name": "{app_name}", "attempts": [] }`)
5. `docs/screen-coverage-check.md` — L1 ui_states 判定基準 (sub-state 視点での再評価ロジック)
6. `pipeline.yaml` — `phases.screens.state_pattern_loop.max_attempts` (default 2)

### Phase 1: 採点ロジック

#### Step 1-1: sub-state HTML を順次 Read

`completed_files[]` の全ファイルを Read する。`completed_files[]` のパス形式は 25b と一致 (4 次元 cartesian):

- single-theme (`themes==["default"]`) → `screens/{platform}/{画面名}--{state}.html` (現行互換)
- dual-theme (`themes==["light","dark"]`) → `screens/{platform}/{画面名}--{state}--{theme}.html`

件数が多い場合 (> 20 件) は context 圧迫回避のため subagent isolation を検討する (現バージョンは main 側直接 Read で実装し、20 件超で chunk 分割 + sequential 採点する)。dual_theme プロジェクトでは件数が 2 倍になるため特に chunk 分割を意識する。

#### Step 1-1b: 継承整合性 spot-check (規約遵守の事後検出)

各 sub-state HTML について、対応する main HTML との `:root` ブロックの byte-level 一致を検証する。SSB-11 (`:root` touch 一切禁止) と SSB-09 (byte-level 継承) が subagent の規約遵守に依存するため、事後検出層として 25c で必ず実行する。

**`main_html_path` の導出規則** (sub-state file path から逆引き): 決定論 script `scripts/expand-substate-plan.mjs` の `--parse` に一本化されている (25b Phase 1 と同じ path 分解実装を共用。**LLM 側で path 分解を再実装しない** こと):

```bash
node scripts/expand-substate-plan.mjs --parse "{sub_state_path}"
```

exit 0 の stdout JSON `main_html_path` (相対 path) に `artifacts/{app_name}/` を前置して使う:

- dual-theme 派生 (`screens/{platform}/{screen}--{state}--{theme}.html`) → `screens/{platform}/{screen}--{theme}.html` (theme 別 main から派生)
- single-theme 派生 (`screens/{platform}/{screen}--{state}.html`) → `screens/{platform}/{screen}.html` (suffix `--{state}.html` を剥がした main)
- state 内の単一ハイフン (`modal-dialog` / `validation-error` 等) は保持される (末尾からの構造的 split)
- **exit 1** = sub-state path として parse 不能 (命名規約違反 / 空要素混入)。当該 file は下記「`main_html_path` が存在しない場合」と同じ扱い (+3 major) とし、details[] に parse 不能の旨を記録する

```bash
# 上で導出した main_html_path と sub_state_path に対して、
# インデントや brace 位置に依存しない POSIX 互換抽出を行う (Step 17 が出力する HTML の :root 行は
# 通常 4 スペースインデントだが、フォーマッタ差異で 2 スペース / tab の可能性もあるため、
# 行頭の空白を [[:space:]]* で許容し、:root { から最初の対応する } までを抽出する)
sub_state_root=$(sed -n '/^[[:space:]]*:root[[:space:]]*{/,/^[[:space:]]*}/p' "$sub_state_path")
main_root=$(sed -n '/^[[:space:]]*:root[[:space:]]*{/,/^[[:space:]]*}/p' "$main_html_path")
diff <(echo "$sub_state_root") <(echo "$main_root")
```

**`main_html_path` が存在しない場合**: tags[] に `base_css_inheritance_violation` + `main_html_not_found` を追加、`ai_improvable_deductions` に **+3 (major)** を加算、details[] に「対応する main HTML (`{main_html_path}`) が見つからない — sub-state file 命名規則違反 / Step 17 出力欠落 / `--parse` 逆引き結果の取り違えの可能性」を記録。spot-check 自体は skip する (main がなければ diff は不能)。

判定:
- **両方が空でない** かつ **diff 空** (完全一致) → pass、ai_improvable_deductions に加算なし
- **抽出結果が空** (sub_state_root もしくは main_root のいずれかが空文字、もしくは両方が空) → tags[] に `base_css_inheritance_violation` + `root_extraction_failed` を追加、ai_improvable_deductions に **+3 (major)** を加算、details[] に「:root ブロック抽出失敗 — フォーマッタ差異 / `:root` 構造破壊の可能性 (false negative 回避のため violation 扱い)」を記録
- **diff あり** → tags[] に `base_css_inheritance_violation` を追加、ai_improvable_deductions に **+3 (major)** を加算、details[] に「:root ブロックが main と不一致 — SSB-11 違反の可能性」を記録

> **schema 整合**: `ai_improvable_deductions` は `schemas/state-pattern-scores.schema.json` で `minimum: 0` (累積減点量を正値で保持する非負カウンタ)。本 step では「**+3 を加算**」と表現する (符号反転を skill 内で行わない)。25b への mini-loop 復帰判定は `ai_improvable_deductions > 0` のため意味は変わらない。
> **空抽出のガード意義**: sed パターンがインデントや brace 行の書式と不一致だった場合、`echo "$sub_state_root"` / `echo "$main_root"` が両方空文字になり naive な diff では誤 pass する。抽出が空になった時点で violation 扱いにすることで false negative を防ぐ。

> **検出意義**: independent 生成時代の「error.html の :root に state color 13 行 insert」事例 (subagent が main の :root が不完全と判断して現場補完したパターン) を本 step で確実に検出できる。当時も本 step が存在していれば即発見できた。`:root` 不一致が検出された場合は subagent が SSB-11 を破ったか、Step 17 規約 (root-variables.css 全変数 inline copy) が破られたかのいずれかなので、root cause 調査 (Step 1-4 details[] の `file` を辿って) が必須。

> **共通部品 chrome の継承検査**: 上記 `:root` byte 一致と同じ精神で、sub-state HTML の `<nav class="mobile-bottom-nav">` / `<header class="*-header*">` が対応 main HTML と byte 一致する (sub-state 由来の差分は content slot overlay のみ) ことも spot-check で確認する。chrome に main と異なるマークアップが混入していたら、tags[] に `base_css_inheritance_violation` + `chrome_drift` を追加し ai_improvable_deductions に +3 を加算する。chrome は SSB-09 カテゴリ A として byte-level 継承される領域であり、Step 17 で `_shared/components.html` から固めた形がそのまま伝播しているはず。

#### Step 1-1c: 色トークン適合 lint の横断再実行（C-25）

sub-state を含む全画面 HTML に対して色 lint report を再生成する（report は derived・毎回上書き。main 継承部分は Step 17 検査済のため、実質対象は **sub-state で新規追加された要素** = empty illustration / error banner 等）:

```bash
node scripts/lint-screen-colors.mjs --report artifacts/{app_name}
node scripts/render-color-report.mjs artifacts/{app_name}/screens/color-lint-report.json
```

`summary` のみ Read し:
- L1 違反 = 3 指標 **`literal_colors` / `unresolved_vars_excl_promotion` / `other_violations`**（25b の `--check` をすり抜けた分の backstop。**昇格候補 `--color-illustration-*` は減点しない** — summary の excl_promotion 値を使う、18/19 と同一規約）→ 非ゼロの指標 1 つにつき tags[] に `zero_literal_violation` を追加し ai_improvable_deductions に **+2/指標（上限 +6）** を加算（mini-loop で 25b 再指示の対象）。なお `other_violations` には `root_vars_incomplete` も集約計上されるが、これは **main 由来**（sub-state の `:root` は main から byte 継承され 25b では修正不能 — `--check` も派生ファイルでは `soft_inherited` として hard から除外する）。**25b への再指示対象にしない** — main を Step 17 経路で修正する必要がある旨を tags[] に文字列 `"root_vars_incomplete_main_fix_required"` で記録し人間（25d）へ送る（4ロールレビュー CRITICAL-2: 直せないものを再指示するデッドロックの防止）
- 人間判断項目（`icons_with_variance` / `unmatched_svgs` / `promotion_queue` / `boundary_violations`）→ 減点せず、**25d 承認ゲートで `color-lint-report.html` を提示**するため tags[] に文字列 `"color_lint_report_human_review"` を追加（**`state-pattern-scores.schema.json` の tags は文字列配列** — object を入れると schema 違反になる（4ロールレビュー MAJOR-2）。提示の詳細は 25d が color-lint-report.html を直接読むため tag には持たせない。details[] にも書かない — details[].file は修正対象 sub-state パスの規約のため）

#### Step 1-2: Layer 2 「状態可視性 & フィードバック (6pt)」軸を sub-state 視点で評価

各 state ごとの評価項目:

| state | 評価項目 | 減点トリガー (各 -1〜-3) |
|---|---|---|
| `empty` | 空状態の説明文 / アクション誘導 CTA が明確か | empty illustration が無い (-1) / 「データがありません」相当のメッセージ無し (-2) / 次のアクション (Add / Import / Help) への CTA が無い (-2) |
| `loading` | skeleton placeholder / spinner / progress が適切か | skeleton が main HTML の骨格と一致しない (-1) / spinner / progress どちらも無い (-2) / `prefers-reduced-motion` 未対応 (-1) |
| `error` | error message + retry CTA が明確か | error banner に `role="alert"` 無し (-1) / 具体的エラー文言無し (汎用 "エラーが発生しました" のみ) (-2) / retry button 無し (-2) |
| `modal` / `dialog` | overlay + dialog 構造が適切か | `role="dialog"` 無し (-1) / `aria-modal="true"` 無し (-1) / primary/secondary CTA 不明確 (-2) |
| `validation-error` | error message + 該当 input のハイライトが適切か | `aria-invalid="true"` 無し (-1) / error 該当 input の border が tokens 経由でない (-1) / message text が input 直下に無い (-1) |

> **減点配分の参考**: Step 19 の Layer 2 6pt 軸とは別計算 (本 step 専用)。本 step では state-pattern-scores.json.attempts[].score を 0-100 で出すが、内訳は「Layer 2 (6pt 軸を sub-state 視点で再評価) を 100pt 換算した値」を採用する (例: 6pt 中 4pt → 67 点)。

#### Step 1-2b: 画面間横断一貫性 (cross-screen consistency) 評価

Step 1-2 が各 sub-state を **単体で** (対応 main との継承整合は Step 1-1b) 評価するのに対し、本 step は **同じ state を持つ複数画面を横に並べて比較** し、画面間でばらつく一貫性逸脱を検出する。振り返り (Confluence 3965452789) の症状 A (empty 画面間でアイコン・ボタン位置・ラベル・CTA フォントがバラバラ) / D (慣習無視: 戻るボタン・「＋」アイコンの有無) / E (デザインシステム逸脱: CTA が正典 `.btn-primary` でなく font まちまち) は、いずれも「独立並列生成 = 局所最適・大域不整合」に起因し、単体採点では捕捉できない。本軸がその横断チェックを担う。

**評価単位**: `completed_files[]` を `(platform, state[, theme])` でグルーピングする (例: 全 `web/*--empty.html`、全 `mobile/*--error.html`)。各グループ内で 2 画面以上あるとき、以下を機械的 + 目視で照合する。

| 観点 | 照合内容 | 減点トリガー (各 -1〜-2) | tag |
|---|---|---|---|
| **CTA クラス一貫性** | グループ内の primary CTA が全て同一正典クラス (`.btn-primary` 等 tokens/style-guide 定義) を使っているか | 画面によって CTA の class / font-family / weight / size が異なる (-2) | `cta_class_drift` / `cta_font_drift` |
| **アイコン一貫性** | 同一意味役割 (空状態アイコン・追加アイコン等) に画面間で同じ icon (`icons/{name}.svg`) を使っているか | 同役割で画面ごとに別アイコン / 一部だけアイコン欠落 (-2) | `cross_screen_icon_inconsistent` |
| **レイアウト位置一貫性** | 空状態の illustration + message + CTA の配置 (中央寄せ / 上寄せ) がグループ内で揃っているか | 画面によって配置・整列が異なる (-1) | `button_position_inconsistent` |
| **ラベル規約一貫性** | 空状態メッセージ・CTA ラベルの言い回しがグループ内で統一されているか (「データがありません」系の表記ゆれ、要件外の勝手なラベル追加を含む) | 表記ゆれ / 要件に無い発明ラベル (-1〜-2) | `label_convention_drift` |
| **ナビ慣習一貫性** | 戻るボタン・「＋」アイコン等のナビ要素の有無がグループ内 (および main の慣習) と揃っているか | 一部画面にだけ戻るボタン / 不要 CTA が付く等の慣習逸脱 (-1) | `nav_convention_drift` |

**照合の進め方 (機械 + 目視のハイブリッド)**:
- 機械: グループ内各 HTML から primary CTA の class 属性・`font-*` var / アイコン svg の形状署名 (Step 0 で currentColor 正規化済) を抽出し、集合が 1 種類に収束するか比較する (2 種以上に割れたら drift 候補)。
- 目視: 抽出だけでは判別しづらいレイアウト位置・ラベル言い回しは、グループ内 HTML を並べて Claude が横断確認する。
- **main との照合**: CTA 正典 / ナビ慣習は main HTML (`screens/{platform}/{screen}.html`) が SoT。グループが main の慣習から外れていたら逸脱として扱う。

減点は `ai_improvable_deductions` に加算し、details[] に `{file, issue, severity}` を記録する (どの画面が基準からずれているかを file 単位で特定する)。基準は「グループ内多数派 or main の慣習」とし、少数派・逸脱画面を減点対象にする。

> **なぜ 25c に置くか**: これらは「採点 (25c) を通していれば防げた」問題の中核 (振り返り §4 の A/D/E は "◎ 機械的に防げる")。将来的には color-lint と同型の独立 cross-screen lint script (`scripts/lint-*.mjs`) への切り出しが望ましいが (別途対応)、まず採点軸として明示することで「25c が走れば横断一貫性が必ず評価される」状態を担保する。

#### Step 1-3: coverage-check.json の L1 ui_states を sub-state 群に対して再走

`artifacts/{app_name}/screens/00-coverage-check.json` の `layers.l1_ui_states[]` を sub-state HTML 群に対して再評価:

- main HTML 時点で `l1_ui_states.missing[]` が空でも、sub-state 生成で「loading が無い画面が見つかった」場合は本 step で `missing[]` に追加候補として記録
- 評価結果は `state-pattern-scores.json.attempts[].coverage_check` (schema: `coverage-check.schema.json#/$defs/layer_result`) に書く

#### Step 1-3b: 要件トレース監査（要件外追加検出）

各 state の **主要要素を列挙し `requirements.json` に全件マップ** (§5.2 forced-enumeration、`coverage[]` `phase="substate"` に記録)。マップできない要素 / 挙動（例: 要件に無いエラー時の
復旧挙動を想像で追加）を `artifacts/{app_name}/requirement-deviations.json` に append
（`phase="substate"`, `raised_by_step="25c-state-pattern-score"`）し、`node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` で view を決定論生成（手焼き禁止）。
手順詳細は `docs/principle4-disambiguation.md` §5。Step 25d gate で view.html を提示する。

#### Step 1-4: tags[] と details[] を構築

各減点について:

```json
{
  "file": "screens/web/01-login--loading.html",
  "issue": "skeleton placeholder が main HTML の骨格と一致しない (form 入力欄を反映していない)",
  "severity": "major"
}
```

> **dual_theme プロジェクトでの file path 形式**: `themes==["light","dark"]` の場合は `screens/web/01-login--loading--dark.html` のように `--{theme}` suffix を持つ (25b expected_files と整合)。`themes==["default"]` の場合は theme suffix なし (現行互換)。`details[].file` には実際に減点された **theme 別 file** を記録する (light は問題なくて dark のみ問題があるケースを正確に表現できる)。

タグ例 (retro での集計用):
- `missing_loading_skeleton`
- `error_message_unclear`
- `empty_cta_missing`
- `modal_role_missing`
- `validation_aria_invalid_missing`
- `state_color_token_missing` (subagent から warning として上がってきたもの)
- `base_css_inheritance_violation` (Step 1-1b で検出された SSB-09 / SSB-11 違反)
- `chrome_drift` (Step 1-1b で検出された共通部品 chrome の byte 不一致。`base_css_inheritance_violation` と併記して付与する)
- `cta_class_drift` / `cta_font_drift` (Step 1-2b: 画面間で CTA の正典クラス / font がばらつく)
- `cross_screen_icon_inconsistent` (Step 1-2b: 同役割アイコンが画面間で不統一)
- `button_position_inconsistent` (Step 1-2b: 空状態レイアウト位置・整列が画面間で不統一)
- `label_convention_drift` (Step 1-2b: ラベル表記ゆれ / 要件外の発明ラベル)
- `nav_convention_drift` (Step 1-2b: 戻るボタン・「＋」アイコン等のナビ慣習逸脱)

#### Step 1-5: ai_improvable_deductions を算出

```
ai_improvable_deductions = sum(全減点)   # sub-state 視点での Layer 2 不足分
```

`ai_improvable_deductions == 0` なら採点 pass、それ以外は mini-loop 候補。

### Phase 2: Output

#### Step 2-1: state-pattern-scores.json.attempts[] に append

`state-pattern-scores.json` を Read or {init stub} → append:

```json
{
  "app_name": "{app_name}",
  "attempts": [
    ...(既存),
    {
      "attempt": {次の連番},
      "scored_at": "<現在 ISO 8601>",
      "score": 67,
      "ai_improvable_deductions": 4,
      "coverage_check": {
        "missing": []
      },
      "tags": ["missing_loading_skeleton", "error_message_unclear"],
      "details": [
        {
          "file": "screens/web/01-login--loading.html",
          "issue": "skeleton placeholder が form 構造を反映していない",
          "severity": "major"
        }
      ]
    }
  ]
}
```

- `attempt` は `existing.attempts.length + 1` (1-indexed)
- **app_name field assert** (docs/artifact-file-responsibility.md § 設計原則 4)
- additionalProperties: false なので余計な field を入れない

#### Step 2-2: pipeline-state.json 更新

`pipeline-state.json` を Read or {init stub} → merge:

- `screens.step25c.completed_at = <現在 ISO 8601>`
- `screens.step25c.score = {今回 attempt の score}`
- `screens.step25c.attempt_count = {state-pattern-scores.attempts.length}`
- `screens.state_pattern_attempt_count = {state-pattern-scores.attempts.length}` (loop 累積カウント、pipeline.yaml の max_attempts 判定で参照)
- `app_name` assert
- Write back

### Phase 3: Loop 判定

```
max_attempts = pipeline.yaml.screens.state_pattern_loop.max_attempts (default 2)
current_attempt = state-pattern-scores.json.attempts.length

if ai_improvable_deductions > 0 and current_attempt < max_attempts:
  → 25b に戻る (25b が pending = expected - completed の差集合で該当 sub-state を再生成。
     再生成対象は details[].file をヒントに 25b が完了済から除外する形で再生成)
else:
  → 25d (人間ゲート) へ進む
```

#### 25b に戻る場合の準備

mini-loop で 25b に戻る場合、25b が pending を再計算するためには「該当 sub-state file を `completed_files[]` から外す」必要がある。本 step で以下を実行:

- `details[].file` に列挙されたファイルを `pipeline-state.json.screens.step25b.completed_files[]` から **remove**
- `screens.step25b.completed_count = len(completed_files)` を更新
- `screens.step25b.completed_at` を **unset** (resume mode signal)
- `app_name` assert + Write back

これにより 25b 再起動時の Phase 1 で `pending = expected - completed` の差集合が details で指摘された file 群と一致し、自動的に再生成される。

完了報告:

```
25c attempt {n}/{max}: ai_improvable_deductions = {N}, score = {score}/100
{details の主要指摘 1-2 行を抜粋}
→ 25b に戻ります (該当 {len(details)} 件の sub-state HTML を再生成)
→ skills/25b-state-pattern-gen/SKILL.md を Read して 25b を実行
```

#### 25d へ進む場合

完了報告:

```
25c attempt {n}/{max}: ai_improvable_deductions = {N}, score = {score}/100
{合格理由 or max_attempts 到達理由}
→ 25d 人間ゲートへ進みます
→ skills/25d-state-pattern-approval/SKILL.md を Read して 25d を実行
```

---

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/screens/state-pattern-scores.json` | `attempts[]` に新 attempt を append (loop history) |
| `artifacts/{app_name}/pipeline-state.json` | `screens.step25c.{completed_at, score, attempt_count}`, `screens.state_pattern_attempt_count`, (mini-loop 時) `step25b.completed_files[]` 更新 |

## 単一所有権

- `state-pattern-scores.json` は 25c が唯一の writer (`docs/artifact-file-responsibility.md` 参照)
- `scores.json` (Step 19 が writer) には絶対に書かない
- `00-coverage-check.json` には書かない (Step 14 / 21 の責務)。本 step は coverage-check の judgment criteria を**読むだけ**で、結果は state-pattern-scores.json.attempts[].coverage_check に独立記録

## 参照

- `schemas/state-pattern-scores.schema.json` — 出力 schema
- `schemas/coverage-check.schema.json#/$defs/layer_result` — coverage_check field の型
- `docs/screen-coverage-check.md` — L1 ui_states 判定基準
- `skills/19-rubric-score/SKILL.md` — Layer 2 採点ロジックの本家 (本 step は 6pt 軸を sub-state 視点で再評価)
- `skills/25b-state-pattern-gen/SKILL.md` — mini-loop の back_to 先
- `skills/25d-state-pattern-approval/SKILL.md` — 次ステップ
