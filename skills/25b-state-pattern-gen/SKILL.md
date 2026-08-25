---
name: 25b-state-pattern-gen
description: Phase 3 の Step 25b。state-pattern-plan.json に従い、全画面 × 全 state × 全 platform の組合せで sub-state HTML を生成する。1 ファイル単位で ayatori-screen-state-builder subagent を並列起動し、返された HTML を main 側で Write する。
---

# 25b パターン HTML 追加生成 (sub-state)

## 役割

`state-pattern-plan.json` (Step 25a で確定した loop 不変量) に従い、全画面 × 全 state × 全 platform の組合せで sub-state HTML (`screens/{platform}/{画面名}--{state}.html`) を生成する。1 ファイル単位で `ayatori-screen-state-builder` subagent を並列起動 (4-5 並列) し、return された HTML 文字列を main 側で Write する。

subagent 側 Phase 2 の生成戦略は inherit_main 方式 (本 skill の構造 = Phase 1 期待ファイル算出 / Phase 2 並列実行 / Phase 3 検証 は生成方式が変わっても extension point として固定維持)。

## 前提条件

- Step 25a 完了 (`pipeline-state.json.screens.step25a_completed_at` が立っている)
- `state-pattern-plan.json` が存在 (Step 25a Branch B で生成済)
- Step 17 で main HTML (`screens/{platform}/{画面名}.html`) が全画面分既存 (Step 21 / 23 で承認済)
- `tokens.json` / `_shared/root-variables.css` / `_shared/common-styles.css` が最新

---

## 実行指示

### Phase 0: Read inputs

以下を Read する:

1. `artifacts/{app_name}/screens/state-pattern-plan.json` — loop 不変量 (Read only)
2. `artifacts/{app_name}/tokens.json` — トークン SoT (subagent に渡す)
3. `artifacts/{app_name}/screens/_shared/root-variables.css` — :root 変数の staging
4. `artifacts/{app_name}/screens/_shared/common-styles.css` (存在すれば)
   - `artifacts/{app_name}/screens/_shared/illustrations/*.svg` (存在すれば、イラスト正典) — **READ-ONLY 参照のみ**。sub-state 固有の挿絵 (empty illustration 等) はここから verbatim ペーストする (SSB-15。必要な正典が無ければ `assertion_failed: canon_missing` を return — 本 agent は正典を作らない)
   - `artifacts/{app_name}/screens/_shared/components.html` / `components.css` (存在すれば、共通部品 chrome 正典) — **READ-ONLY 参照のみ**。chrome (ヘッダー / ボトムメニュー) は main HTML から byte-level 継承される (SSB-09 カテゴリ A) ため、sub-state 生成で本ファイルを直接ペーストする必要はない。main で固めた chrome がそのまま継承で揃う
5. `artifacts/{app_name}/pipeline-state.json` (or lazy init stub) — `screens.step25b.completed_files[]` を resume 用に読む
6. `artifacts/{app_name}/requirements.json` — `design_output_scope.dual_theme_mode` を読む (レビュー対応、subagent Phase 1-Pre assertion と orchestrator Phase 1b pair assertion で使用):

```python
import json, os
req_path = f"artifacts/{app_name}/requirements.json"
if os.path.exists(req_path):
    requirements = json.load(open(req_path))
    dual_theme_mode = requirements.get("design_output_scope", {}).get("dual_theme_mode", False)
else:
    # requirements.json 不在 (Standalone Phase 3 entry の最小 stub 未配置 / reverse-engineered project 等)
    # → single-mode (False) で fallback。dual_theme は明示宣言が必須なので欠落=false 扱いが安全側
    dual_theme_mode = False
```

`dual_theme_mode` の defense ロジック (3 段 fallback):
1. `requirements.json` 不在 → `False`
2. `requirements.json` 存在 + `design_output_scope` キー欠落 → `.get("design_output_scope", {})` で `False`
3. `requirements.json` 存在 + `design_output_scope` 存在 + `dual_theme_mode` キー欠落 → `.get("dual_theme_mode", False)` で `False`

`dual_theme_mode` は本 skill 内 (Phase 1b assertion) と subagent prompt の両方で必要。Phase 2 の subagent 起動 prompt template に必ず `dual_theme_mode: {true|false}` 行を含めること。

#### main HTML 存在 assert

main HTML の命名規約は theme 軸の有無で変わる (Step 17 の dual_theme 命名と整合):

- `themes == ["default"]` (single-theme project): `screens/{platform}/{screen}.html`
- `themes == ["light", "dark"]` (dual-theme project): `screens/{platform}/{screen}--light.html` と `screens/{platform}/{screen}--dark.html` の **両方**

```bash
for entry in state-pattern-plan.json.screens[]:
  themes = entry.themes if "themes" in entry else ["default"]
  for platform in entry.platforms:
    for theme in themes:
      if theme == "default":
        path = "artifacts/{app_name}/screens/{platform}/{entry.screen}.html"
      else:
        path = "artifacts/{app_name}/screens/{platform}/{entry.screen}--{theme}.html"
      test -f "$path" || exit 1
```

main HTML が 1 つでも欠けていたら、feedback-log.md に Pattern B を記録して中断。Step 17 → 21 → 23 のいずれかが壊れているサインなので、user に「Step 17 を再実行してください」を案内する (dual_theme プロジェクトでは light / dark 両方の main HTML が必要なので片 theme 欠落でも中断)。

#### root-variables.css の md5 を事前計算

```bash
expected_root_variables_md5=$(md5 -q artifacts/{app_name}/screens/_shared/root-variables.css 2>/dev/null \
  || md5sum artifacts/{app_name}/screens/_shared/root-variables.css | awk '{print $1}')
```

この値を subagent prompt に渡し、subagent 側 Phase 1 で再計算 → 一致を検証する。

### Phase 1: 期待ファイル算出 & resume 判定

期待ファイル算出 (`{screen × state × platform × theme}` の 4 次元 cartesian) / dual-theme pair assertion / resume 差集合は、決定論 script `scripts/expand-substate-plan.mjs` に一本化されている。**LLM 側で path 組み立てを再実装しない** こと:

```bash
node scripts/expand-substate-plan.mjs artifacts/{app_name}/screens/state-pattern-plan.json \
  --requirements artifacts/{app_name}/requirements.json \
  --diff artifacts/{app_name}/pipeline-state.json
```

- `--requirements` は Phase 0 と同じ 3 段 fallback で `dual_theme_mode` を script 内で解決する (Phase 0 で読んだ値と常に一致する)。
- `--diff` には `pipeline-state.json` をそのまま渡してよい (`screens.step25b.completed_files[]` を読む。欠落 = `[]` 扱い)。
- `themes` 欠落 (legacy plan) は `["default"]` と解釈され、現行 single-theme 経路 (theme suffix なし) が維持される。

exit code と対応:

| exit | 意味 | 対応 |
|---|---|---|
| 0 | 成功 | stdout JSON の `expected_files[]` / `pending[]` / `asymmetric_completed[]` を使う |
| 1 | plan 契約違反 or pair assertion 失敗 | plan or code の bug。**Pattern C を feedback-log.md に記録して即中断** (stdout JSON の `errors[]` / `violations[]` に詳細) |
| 2 | 運用エラー (ファイル不在 / JSON 破損 / 引数不正) | stderr を確認し入力を修復して再実行 |

出力 JSON の読み方:

- `expected_files[]` = 期待ファイル全件 (相対 path)。`summary.pattern_summary` は Step 3-4 の完了報告にそのまま使える。
- `pending[]` = `expected_files - completed_files` の差集合。`pending.length == 0` のとき即 Phase 3 (検証 & 完了処理) に進む (resume 完了済の状態)。
- `asymmetric_completed[]` 非空 = 前回 run が片 theme だけ書いて落ちた resume 経路の自動回復。現行 plan 内の不足 path は `recovered_paths[]` (必ず `pending[]` に含まれる)、plan から rename / 削除された画面の残骸は `stale_paths[]` (報告のみ — main HTML の無い画面の生成を誘発しないため enqueue しない)。**Pattern B (resume asymmetry recovered) を feedback-log.md に記録** して継続。`stale_paths[]` 非空の場合はその旨も Pattern B に含める (plan 変更の痕跡)。

#### Phase 1b: dual_theme pair assertion

light / dark の対称ペア検証は Phase 1 の script 実行に内蔵されている (LLM 側での再実装禁止):

- **expected 側** (cartesian の対称性): `dual_theme_mode == true` のとき、(screen, state, platform) triple ごとに theme 集合が `{light, dark}` と完全一致することを検証する。違反は **exit 1** — plan or code の bug を意味するので Pattern C を `feedback-log.md` に記録して即中断する。`dual_theme_mode == false` のときは skip される (従来挙動と同一)。
- **completed 側** (resume の対称性): resume 時に partial cartesian product (例: light のみ書き終えた状態で再起動) が発生していた場合、`asymmetric_completed[]` で報告する (現行 plan 内の不足 path は `pending[]` に含まれる。plan 外の stale 残骸は `stale_paths[]` 報告のみ)。これは resume 経路の正常動作なので Pattern B を記録して継続する。

path 分解 (script 内 `parseSubStatePath`) は末尾から `--{theme}` を切り出す構造的 split (rpartition 相当) のため、state 内の単一ハイフン (`modal-dialog` / `validation-error` 等 — 25a の選択肢で明示) を保持する。**subagent 側の Phase 1-Pre assertion と二段構えで「片寄り cartesian product が 25c に流入する」事態を物理的にブロック** する。

> **後方互換性**: `dual_theme_mode == false` のプロジェクト (または `themes` 欠落 legacy plan) では `themes == ["default"]` となり、生成される path は **theme suffix を持たない** (`{画面名}--{state}.html`)。これは初版 (theme 軸なし) と完全一致する。`dual_theme_mode == true` のときのみ `--{theme}` suffix が付与され、Step 17 の dual_theme 出力命名 (`{画面名}--{theme}.html`) と整合する。Phase 1b assertion は dual_theme_mode=false の場合は skip される。

#### `step25b.started_at` を記録

`pipeline-state.json` を Read or {init stub} → merge:

- `screens.step25b.started_at = <現在 ISO 8601>` (既に立っていれば上書きしない)
- `screens.step25b.expected_count = expected_files.length`
- `screens.step25b.completed_count = completed_files.length`
- `app_name` assert
- Write back

### Phase 2: subagent 並列実行 (4-5 並列、1 agent = 1 ファイル)

`pending[]` を 4-5 個ずつのバッチに分割し、バッチ単位で `ayatori-screen-state-builder` subagent を並列起動する。

> **コスト見積もり**: 各 subagent は Phase 2-1 で main HTML (典型 ~17KB / 410 行) を Read する。1 batch 4-5 並列 × 9 ファイル ≈ 2 batch で +~75KB の追加 Read token (旧 independent 方式から +9 × 17KB / instance)。subagent return HTML は main 側 context にも 9 × ~17KB ≈ 150KB が流入する設計 (従来と同等、回帰なし)。`pipeline.yaml phases.screens.state_pattern_loop.max_attempts` (default 2) との組合せで最悪ケース 2 倍。

#### subagent 起動 prompt

各 pending file (`{platform}/{画面名}--{state}.html` or `{platform}/{画面名}--{state}--{theme}.html`) について、`ayatori-screen-state-builder` を以下の構造化テキストで起動:

```
mode: subagent
app_name: {app_name}
screen_name: {画面名}             # 例: 01-login
platform: {platform}              # 例: web
state: {state}                    # 例: empty
theme: {theme}                    # default / light / dark (後追い追加)
dual_theme_mode: {true|false}     # requirements.json.design_output_scope.dual_theme_mode をそのまま伝播 (レビュー対応、subagent Phase 1-Pre assertion に必須)
main_html_path: {repo_root}/artifacts/{app_name}/screens/{platform}/{画面名}{--theme suffix if dual_theme}.html
requirements_md_path: {repo_root}/artifacts/{app_name}/screens/{画面名}.md
tokens_path: {repo_root}/artifacts/{app_name}/tokens.json
shared_css_path: {repo_root}/artifacts/{app_name}/screens/_shared/root-variables.css
expected_root_variables_md5: {Phase 0 で計算した値}
```

> **theme による main_html_path 切替**: `theme == "default"` (single-theme project) のとき `main_html_path = screens/{platform}/{画面名}.html`。`theme in {"light", "dark"}` (dual-theme project) のとき `main_html_path = screens/{platform}/{画面名}--{theme}.html` (Step 17 が dual_theme で生成した theme 別 main HTML)。inherit_main 方式では subagent Phase 2-1 がこのパスを Read して継承元とするため、orchestrator は theme に応じて正しいパスを渡す責務を持つ (light instance には `--light.html`、dark instance には `--dark.html` を渡す)。
>
> **dual_theme 時のペア生成保証**: 1 画面 × 1 state × 1 platform につき light / dark の 2 instance を **必ず両方** 起動する (片 theme のみ pending に残った状態でバッチが終わらないようにする)。25b は pending 算出時に light / dark 両方を expected_files に入れるため、自然と両方が pending として subagent に流れる。

> **完了 note**: 本 prompt の `main_html_path` は subagent Phase 2-1 で Read され、`<head>` / `<style>` / `<body>` 構造の継承元として使われる。本 skill の prompt 構造 / Input 契約 / Phase 1-3 構造は生成方式が変わっても extension point として固定維持。

#### return 受領 → main 側で Write

> **補足**: subagent return の構造化テキストには `main_html_inherited_from: {path}` フィールド (Phase 2-1 で Read した main HTML の path、informational) が含まれるが、本 orchestrator は parse 不要 (固定キー `screen_name` / `platform` / `state` / `status` / `failure_reason` / `expected_output_path` / `anti_slop_checklist` / `warnings` / `notes` のみ参照)。デバッグログ目的で `notes` に出力されるため、orchestrator 側で merge する必要なし。`status` / `failure_reason` は防御層として追加 (best-effort fallback 排除)。

subagent return は構造化テキスト + `---HTML---` セパレータ以降に HTML 全文を含む。main 側で:

1. セパレータ前のメタ情報を parse (`screen_name`, `platform`, `state`, `status`, `failure_reason`, `expected_output_path`, `anti_slop_checklist`, `warnings`, `notes`)
2. **`status: "inheritance_failed"` のとき (防御層)**: subagent が Phase 2-1 で main 不在 / `<style>` or `<body>` 抽出不能を検出した signal。本 orchestrator は当該 file を Write **せず**、`completed_files[]` にも積まない (pending 残し)。`feedback-log.md` に Pattern C (`subagent inheritance_failed: screen={screen_name} state={state} theme={theme} reason={failure_reason}`) を記録し、他 batch の処理は継続する。同 attempt 内で他の pending は処理を続行し、Phase 3 の `expected_files` 全件存在チェックで再度 missing として検出される (次 attempt or 25c mini-loop で再 trigger)。
3. `---HTML---` 以降を HTML 本文として抽出 (`status == "success"` の場合のみ存在する)
4. **既存 main HTML を絶対に上書きしないことを assert**: 出力 path が `--{state}` を含むことを確認 (suffix なしファイル / theme-only suffix ファイルへの Write 禁止):

```python
# 擬似コード
basename_str = basename(expected_output_path)
assert "--" in basename_str
if theme == "default":
  # single-theme: 末尾は --{state}.html
  assert basename_str.endswith(f"--{state}.html")
else:
  # dual-theme: 末尾は --{state}--{theme}.html
  assert basename_str.endswith(f"--{state}--{theme}.html")
# どちらの場合も Step 17 が生成した main HTML
#   ({画面名}.html / {画面名}--light.html / {画面名}--dark.html)
# とは絶対に一致しないことを path 文字列で確認 (state segment 必須)
```

assert 失敗時は Write せず feedback-log.md に Pattern C を記録 (skill design flaw)。

5. Write tool で `expected_output_path` に HTML 本文を書き出す

5b. **色トークン適合 self-check（C-25・Write 直後）**: `node scripts/lint-screen-colors.mjs --check artifacts/{app_name}/{path}` を実行する。**exit 1（hard 違反 = 色リテラル / typo の未解決 var / presentation 属性への var / イラスト正典不一致）** なら当該 file について subagent へ再指示（リトライ ≤3）→ 3 回連続で `feedback-log.md` に Pattern B（`step25b zero-literal violation`）を記録し当該 file を pending 残し（inheritance_failed と同じ degrade 経路。abort はしない — C-25 の「リトライ≤3 → Pattern B」の 25b 形）。**exit 0 で `soft_promotions`（未解決 `--color-illustration-*` = 昇格候補）または `soft_inherited`（`root_vars_incomplete` — main 由来の `:root` 変数欠落）のみ** の場合は続行してよい — sub-state の `:root` は main から byte 継承で不変（SSB-11）のため当該 run 内では解決不能が正常であり、前者は 25c の report → 25d 提示 → Step 24 A-2b 昇格 → **次回生成 run** で実体化、後者の修正先は **main**（Step 17/29 経路 — 25b への再指示では直らない。lint が派生ファイル名 `--` を検出して自動で soft 分類する）。exit 2 は運用エラー（リトライしない）。subagent が `assertion_failed: canon_missing`（SSB-15、必要なイラスト正典が無い）を return した場合は Write せず記録 — 正典の追加は main 側で Step 17 Step 0c の手順に従って行い、その後 resume する。なお main 継承部分は Step 17 で検査済のため、本チェックの実質対象は **state-specific に新規追加された要素**のみ。

6. **1 ファイル Write 完了ごとに** `pipeline-state.json.screens.step25b.completed_files[]` に append (idempotent resume 用):

```
pipeline-state = Read pipeline-state.json or {init stub}
pipeline-state.screens.step25b.completed_files.append(relative_path)
pipeline-state.screens.step25b.completed_count = len(completed_files)
# app_name assert
Write pipeline-state.json
```

> **注**: 並列 subagent で main 側 Write が同時発生する場合は **sequential queue** で処理 (race condition 回避)。バッチ内 4-5 並列で subagent return を待ち、return 順に Write する。完全な並列 Write は pipeline-state.json の race condition を起こすため禁止。

#### バッチ単位の進捗報告

各バッチ完了ごとに main → user に短い進捗を表示:

```
25b: 12/24 files generated ({batch_index}/{total_batches} batches, elapsed_sec={N})
```

### Phase 2.5: subagent assertion_failed: pending_question ハンドリング

subagent (`ayatori-screen-state-builder`) の return に `{ "status": "assertion_failed", "reason": "pending_question", "target": "tokens.color.{state}-{role}" }` 形式が含まれる場合 (SSB-14 規約、main HTML に該当 state color token がない時の return):

1. **対象 entry の収集**: Phase 2 並列 invoke の全 subagent return から `target` を集める。
2. **pending-questions.json への append** (main session が単一 writer、AYATORI single writer 原則 / pipeline.yaml P4-05):
   - `artifacts/{app_name}/pending-questions.json` を Read。不在なら init stub `{ "app_name": "{app_name}", "entries": [] }` をメモリ初期化。
   - 各 target について新 entry を作成:
     ```
     {
       "target": "<subagent return の target、例: tokens.color.error-bg>",
       "question": "<該当 state color token を user に問う具体的質問文>",
       "header": "<max 12 chars>",
       "options": [<2-4 件、palette に近い OKLCH 派生候補 or 公式 error/warning palette>],
       "raised_by_step": "25b-state-pattern-gen",
       "raised_by_role": "subagent",
       "raised_at": "<ISO 8601 now>",
       "reflect_to": "tokens.json"
     }
     ```
   - **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス) は併記必須** — 本 step の未確定値は欠けている state color token なので反映先は `tokens.json` (`skills/_shared/preflight-gate.md` § append 経路)。
   - **`tokens.json` の受け手は Phase 2 (`/ayatori-design`) だけ** なので、本 step の中断からの復帰は必ず Phase 2 経由にする (下記 4 の誘導。`/ayatori-screens` を先に再開すると、この entry は Phase 3 の門では hold されたまま質問されず、同じ assertion_failed で再び中断する)。
   - `entries[]` に append (target literal で dedupe)。
   - 全体を Write back。
3. **counter 更新**: `pipeline-state.json.pending_questions_open` を再計算。
4. **Step 25b 中断**: 残り subagent invoke / Phase 3 検証はスキップし、user に次の 2 手を報告する — **(1) `/ayatori-design` を実行して token の未確定を確定させる** (Phase 2 の Pre-flight Gate が `tokens.json` 宛の entry を batch propose し、その場で `tokens.json` に反映される。Step 13 承認済みプロジェクトなら Gate 通過後そのまま Completion に抜ける) → **(2) その後 `/ayatori-screens` を resume する**。Step 25b の `completed_files[]` は Phase 3 で書く設計なので、本 phase で中断した状態は次回 resume 時に差集合で部分再生成される (設計通り)。
5. **feedback-log.md** に Pattern D で 1 行記録: `[25b] Pattern D (Operating Principle 4 違反): subagent SSB-14 が state color token missing {N} 件検出 → pending-questions.json に append → 次セッション resume`。

assertion_failed がない場合は Phase 3 へ進む。

### Phase 3: 検証 & 完了処理

#### Step 3-1: 期待ファイル全件存在チェック

```bash
for path in expected_files:
  test -f "artifacts/{app_name}/{path}" || missing.append(path)
```

`missing.length > 0` なら feedback-log.md に Pattern B を記録 (sub-state file missing)、user に再実行を促して中断。

#### Step 3-1b: Figma capture script 注入 (P-08 準拠)

全 sub-state HTML ファイルの `</head>` 直前に Figma capture script を注入する (Step 17 P-08 と同様の要件。25e の Figma capture はこの script がないと全件 pending になる):

```bash
for path in expected_files:
  html = Read("artifacts/{app_name}/{path}")
  if '<script src="https://mcp.figma.com/mcp/html-to-design/capture.js"' not in html:
    html = html.replace("</head>", '  <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>\n</head>')
    Write("artifacts/{app_name}/{path}", html)
```

注入済みかどうかを先にチェックして idempotent にすること (再実行時の二重注入を防ぐ)。

#### Step 3-2: :root 変数の md5 spot check

`expected_files[]` から先頭 1 件と末尾 1 件を Read し、`<style>` 内の `:root { ... }` ブロックを抽出して md5 を計算。`expected_root_variables_md5` と一致するかを比較:

```bash
# 擬似コード
for file in [expected_files[0], expected_files[-1]]:
  html = Read(file)
  root_block = extract(html, /<style>.*?:root\s*\{(.+?)\}/s)
  actual_md5 = md5(root_block)
  if actual_md5 != expected_root_variables_md5:
    feedback-log.md に Pattern B (root-variables md5 mismatch in {file})
```

不一致は致命傷ではない (subagent 側で root-variables.css を Read してインライン展開しているため、差分は微小な whitespace 程度のはず) が、retro で集計するために Pattern B として記録。

#### Step 3-3: pipeline-state.json 完了処理

`pipeline-state.json` を Read or {init stub} → merge:

- `screens.step25b.completed_at = <現在 ISO 8601>`
- `screens.step25b.completed_count = expected_files.length` (全件完了確認)
- `app_name` assert
- Write back

#### Step 3-4: 完了報告

```
25b: sub-state HTML を {expected_files.length} 件生成しました。
- 対象: {pattern_summary} (例: 6 画面 × 3 state × 2 platform × 2 theme = 72 件 [dual_theme=true])
                       (single-theme 時は theme 軸 = 1 として計算、例: 6 × 3 × 2 × 1 = 36 件)
- 完了ファイル: pipeline-state.json.screens.step25b.completed_files[] 参照
- md5 spot check: {OK | WARN}

次に 25c で sub-state 採点を行います。
→ skills/25c-state-pattern-score/SKILL.md を Read して 25c を実行
```

---

## Resume 挙動

- セッション中断で `pipeline-state.json.screens.step25b.completed_at` が立たないまま終了した場合、次回 25b 起動時に Phase 1 で `pending = expected_files - completed_files` の差集合のみ subagent 起動 (ファイル単位 idempotent resume)
- `state-pattern-plan.json` は loop 不変量なので resume 中も変更しない (途中で plan を変更したい場合は 25a に戻って plan を作り直す必要がある)

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/screens/{platform}/{画面名}--{state}.html` | 各 sub-state HTML (subagent return → main Write) |
| `artifacts/{app_name}/pipeline-state.json` | `screens.step25b.{started_at, completed_at, expected_count, completed_count, completed_files[]}` を更新 |
| `artifacts/{app_name}/feedback-log.md` | md5 mismatch / missing main HTML / Pattern C (assert 失敗) があれば追記 |

## 不変条件 (必ず守る)

1. **既存 main HTML を絶対に上書きしない**: Write 直前に suffix `--{state}.html` の存在を assert
2. **state-pattern-plan.json は Read only**: 25b 中に plan を変更しない (25a へ戻る必要あり)
3. **1 subagent = 1 ファイル**: 複数 state や複数 platform を 1 subagent に詰め込まない (context isolation の前提が崩れる)
4. **並列 Write 禁止**: 4-5 並列 subagent return を sequential queue で Write (pipeline-state.json race 回避)

## 参照

- `schemas/state-pattern-plan.schema.json` — 入力 schema
- `scripts/expand-substate-plan.mjs` — Phase 1 / 1b の期待ファイル算出・pair assertion・resume 差集合の実装本体 (25c / 25e と共用)
- `schemas/pipeline-state.schema.json` — `screens.step25b` block
- `.claude/agents/ayatori-screen-state-builder.md` — 起動する subagent
- `skills/17-screen-gen/SKILL.md` — 旧 sub-state 生成ロジック (本 skill の Phase 2 の元)
- `skills/25c-state-pattern-score/SKILL.md` — 次ステップ
