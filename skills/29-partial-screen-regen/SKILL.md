---
name: 29-partial-screen-regen
description: impact-analysis.md で affected / new に分類された画面のみを部分再生成する。Phase 5 の Step 29 として実行され、preserved 画面には一切触れず、既存のデザインシステム (tokens.json / design-brief.yaml / _shared/) を READ-ONLY として扱って再デザインせず適応させる。
---

# 29 Partial Screen Regen

## Role
Process screens classified as `affected` or `new` in `impact-analysis.md`. `affected` 画面のうち HTML を再生成するのは `invasive` のみ — `additive` / `data-only` は MD spec のみ更新し HTML は保護する。Screens classified as `preserved` are never read, written, or modified. The existing design system (tokens.json, design-brief.yaml, _shared/) is treated as READ-ONLY — delta runs do not redesign, they adapt.

## Preconditions
- `artifacts/{app_name}/delta/impact-analysis.md` exists with human approval (Step 28 complete)
- `artifacts/{app_name}/screens/_shared/root-variables.css` exists
- `artifacts/{app_name}/tokens.json` exists (READ-ONLY in this step)

---

## Execution

### Step 0: Scope guard

Read `impact-analysis.md` and extract:
- `affected_screens` — all affected screens (invasive + additive + data-only)。change_type により HTML 再生成対象を invasive のみに限定する (下記参照)
- `new_screens` — screens to create from scratch
- `removed_screens` — screens to delete (HTML files only; Figma deletion is Step 30)
- `state_added_screens` — array of `{screen, added_states[]}`: default HTML を **preserve** しつつ追加 sub-state HTML (`{screen}--{state}.html`) のみを新規生成する画面群。`pipeline-state.json.delta.runs[-1].state_added_screens` でも同等のリストが取得可
- `screen_list_change` — whether `00-screen-list.md` needs updating
- `sub_state_aware` — 本プロジェクトが sub-state HTML を生成済みかどうか (`pipeline-state.json.delta.runs[-1].sub_state_aware` でも取得可)

`sub_state_aware == true` の場合、affected/new/removed 画面の sub-state HTML も併せて扱う (詳細は Step 4b / Step 5)。

**change_type 分類**: `impact-analysis.md` の Affected Screens 表 (Change Type 列) を元に各 affected エントリを `{screen, change_type}` dict として構築する。`pipeline-state.json.affected_screens` は string[] のまま (スキーマ互換、Step 30 `expand_with_substates` との後方互換)。Step 4 / 4b の HTML 再生成スコープを `change_type` で仕分ける:

```python
VALID_CHANGE_TYPES = {"invasive", "additive", "data-only"}
invasive_screens, skip_html_screens, coerced = [], [], []
for e in affected_screens:
    ct = (e.get("change_type") or "").strip()
    if ct not in VALID_CHANGE_TYPES:
        if ct:  # 空文字でない不正値 → ログ対象
            coerced.append((e["screen"], ct))
        ct = "invasive"  # 未設定・不正値とも安全側に倒す
    (invasive_screens if ct == "invasive" else skip_html_screens).append(e)
if coerced:
    detail = ", ".join(f"{s}={c!r}" for s, c in coerced)
    # feedback-log.md に Pattern B 記録
    log = f"- **[29] Pattern B**: change_type に不正値を検出 ({detail})。invasive にフォールバック。"
    append_to_feedback_log(log)
```

- `invasive_screens`: HTML 再生成対象 (Step 4 / 4b)
- `skip_html_screens`: MD spec のみ更新 (Step 3 対象、Step 4 / 4b を skip)
- `change_type` が未設定のエントリは **`invasive` フォールバック** — Change Type 列のない旧 `impact-analysis.md` との後方互換
- `change_type` に **不正値** (タイプミス・全角文字・空文字など `VALID_CHANGE_TYPES` に含まれない値) が入った場合も **`invasive` フォールバック** (安全側 = HTML 再生成) し、`feedback-log.md` に Pattern B として記録する。`.get(default=...)` はキー欠落のみ救済し不正値は素通りするため、正規化 + ホワイトリスト判定で両方をカバーする

分類結果を表示する:

| Screen | change_type | Step 4 HTML regen | Step 4b sub-state regen |
|---|---|---|---|
| (各 affected 画面) | invasive / additive / data-only | ✓ / skip | ✓ / skip |

**Hard constraint**: Do NOT read or write any screen outside this list. If in doubt, skip and log to `feedback-log.md`.

> **除外**: 上の制約は **LLM が preserved 画面を読み込み / 再生成すること** の禁止であり、決定論 script (`scripts/lint-screen-colors.mjs` 等) が **read-only で全画面を走査する**ことは含まない (本 skill 自身が Step 4 の Consistency rule で preserved の `:root` を spot-check する既存前例と同類)。色一貫性 report (Step 6) は全画面横断でのみ意味を持つため、script による preserved の read-only 走査を明示的に許可する。

**Design system freeze check**: If `impact-analysis.md` contains `design_system_affected: true`, immediately append to `artifacts/{app_name}/feedback-log.md`:
```
- **[29] Pattern C**: design_system_affected: true が設定されているが、ユーザーが Step 28 で Delta 続行を選択した。tokens.json / design-brief.yaml / _shared/ は READ-ONLY のため、新規・変更画面は既存デザインシステムのまま生成する。デザインシステムとの不整合が生じる可能性がある。
```
Then continue with regeneration as normal — do not abort.

**Zero-scope guard**: If `affected_screens`, `new_screens`, `removed_screens`, and `state_added_screens` are all empty, display:
> ℹ️ すべての画面が preserved です。再生成対象なし。Step 30（Figma 更新）へスキップします。

Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
data = json.loads(open(path).read())
data["delta"]["runs"][-1]["screens_approved_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: screens_approved_at written (zero-scope)")
PYEOF
```
Exit this skill — the delta orchestrator (`phases/delta/SKILL.md`) will proceed to Step 30.

### Step 1: Update `00-screen-list.md` (if `screen_list_change: true`)

Apply additions and removals to `artifacts/{app_name}/screens/00-screen-list.md`. Mark new entries with `[DELTA]` tag so Step 30 knows which frames are newly created vs. recaptured.

### Step 2-A: Update `00-transition-map.mmd` (SSoT, if transitions changed)

If `impact-analysis.md` lists transition changes, edit only the affected lines in `artifacts/{app_name}/screens/00-transition-map.mmd` (純 Mermaid SSoT). Preserve all unchanged edges/nodes/subgraphs verbatim.

SSoT は `.mmd` に切り出されているので、Step 29 はまず `.mmd` を編集する。

### Step 2-B: Regenerate `00-transition-map.html` from template + `.mmd` (derived)

After updating `.mmd` in Step 2-A, regenerate the HTML derived artifact:

1. Read `docs/templates/transition-map.template.html`
2. Read updated `artifacts/{app_name}/screens/00-transition-map.mmd`
3. Fill placeholders (`{{APP_NAME}}`, `{{SUBTITLE}}`, `{{MERMAID_BLOCKS}}`) and write to `artifacts/{app_name}/screens/00-transition-map.html`

This is fully mechanical — no AI editing of HTML wrapper / CSS. If `.mmd` contains multiple `flowchart` blocks separated by `---`, split and generate one `<h2>...</h2><div class="mermaid">...</div>` block per flowchart.

### Step 2-C: Regenerate `00-screen-nav.json` (derived, only if `.mmd` changed in Step 2-A)

If `.mmd` was edited in Step 2-A, regenerate the per-screen entry/exit derived view to keep it consistent with the SSoT:

1. Read the updated `artifacts/{app_name}/screens/00-transition-map.mmd` + `00-screen-list.md` (chrome columns)
2. Derive each screen node's `entries[]` / `exits[]` per `docs/screen-coverage-check.md` §4-5-1 (same rules as Step 14 Step 5-1)
3. Write `artifacts/{app_name}/screens/00-screen-nav.json` (schema: `schemas/screen-nav.schema.json`). This is a derived artifact — never authored directly.

Skip this step if `.mmd` was not modified (no transition changes in this delta run).

### Step 2-Figma: Sync FigJam (only when `FIGMA_MCP_ENABLED=true` AND transitions changed)

After Step 2-A (`.mmd` SSoT updated), also sync the change to the FigJam file (FigJam is a derived artifact kept consistent via clean overwrite).

**Conditions to run**:
- `FIGMA_MCP_ENABLED == "true"`
- `00-transition-map.mmd` was modified in Step 2-A (transitions changed)
- `artifacts/{app_name}/figma-state.json` exists AND `nodes.transition_map.file_key` is set

If any condition fails, skip this step (HTML派生のみで OK).

**Procedure**:
1. Read `artifacts/{app_name}/figma-state.json` and extract `nodes.transition_map.file_key` + `nodes.transition_map.node_id`
2. Read `skills/00-transition-figjam-sync/SKILL.md` and follow its procedure with inputs:
   - `app_name`
   - `mmd_path`: `artifacts/{app_name}/screens/00-transition-map.mmd` (SSoT)
   - `mode`: `"delta"`
   - `existing_file_key`: the value extracted in step 1
   - `existing_node_id`: optional — the value extracted in step 1 (現状の Step 3 (旧 diagram 削除) は name match で一括削除するため本 skill 内では未参照。互換用に渡しているだけで、`null` でも動作に差は無い)
3. The common skill reads the `.mmd` directly (no HTML extraction needed — the `.mmd` is the SSoT), removes the old diagram via `use_figma` (`node.remove()`), then regenerates a clean new diagram in the same `fileKey`. `figma-state.json.nodes.transition_map.node_id` and `generated_at` are updated (file_key is preserved).
4. The returned FigJam URL will be displayed in the Step 7 human approval gate.

**Why clean overwrite (not parallel addition)**: `.mmd` is SSoT — FigJam must always match the `.mmd`. Parallel addition would leave stale diagrams that diverge from the SSoT. For historical comparison, use `git log artifacts/{app_name}/screens/00-transition-map.mmd`.

### Step 3: Regenerate affected screen specs (`.md` files)

**対象: 全 `affected` 画面 (invasive + additive + data-only)。`change_type` に関わらず MD spec は全て更新する。**

For each `affected` screen:
1. Read the existing `artifacts/{app_name}/screens/{screen}.md`
2. Apply only the changes described in `change-manifest.json.requirement_changes[]` that are relevant to this screen
3. Preserve all unchanged sections verbatim
4. Write the updated spec back

For each `new` screen:
1. Generate a full spec following the standard format from `skills/17-screen-gen/SKILL.md`

### Step 4: Regenerate affected HTML files

**対象: `invasive_screens` + `new` 画面のみ。`additive` / `data-only` の `affected` 画面は HTML 再生成を skip し、MD spec のみ更新 (Step 3 実施済)。`change_type` 未設定のレガシー画面は `invasive` フォールバックで HTML 再生成する。**

For each screen in `invasive_screens` or `new_screens`:

**Selection logic — same as Step 17 but scope-restricted:**
- Read `_shared/root-variables.css` (do NOT regenerate it)
- Read `_shared/common-styles.css` (do NOT regenerate it)
- Read the updated `.md` spec
- Generate HTML files for the screen's states (default + all variants that exist for it)

Platform rules (`platform_combo` + `web_viewports` を Step 17 と同じ規則で platform dirs に展開する。展開結果ではなく **既存ディスク上の platform dirs** を正とする — 既に生成されている dir のみ再生成する):
- If `platform_combo == "mobile_only"` → regenerate `screens/mobile/{screen}*.html` only
- If `platform_combo ∋ web` → regenerate the web dirs that exist for this screen: `screens/web/` (web_viewports ∋ desktop) and/or `screens/web-sm/` (web_viewports ∋ sm)
- If `platform_combo == "mobile_and_web"` → additionally regenerate `screens/mobile/`
- `web-sm` の内容規約は Step 17 § Web スマホ幅画面のプレビュー構造に従う (ブラウザページ体裁、BottomTab なし)

**Consistency rule**: New HTML must use the same `:root` CSS variables as existing preserved screens. Spot-check by reading one preserved screen's `:root` block and verifying the new HTML's `:root` matches.

**Color rule（C-25）**: 再生成 / 新規 HTML は Step 17 と同じ zero-literal 規約に従う — 色リテラル禁止（定義済み値の生書きも NG）・色は `var(--token)` / `currentColor` のみ・アイコンは `icons/{name}.svg` verbatim（currentColor）・繰り返しイラストは `_shared/illustrations/{name}.svg` 正典を逐語ペースト。**既存正典の改変は禁止**（Role の `_shared` READ-ONLY）だが、**new 画面が新規の繰り返しイラストを要する場合は Step 17 Step 0c の手順で正典を追加してよい**（additive のみ — 追加は既存画面に影響しない。画面ごとのインライン再発明で (B) ドリフトを delta 経路から再発させない）。各画面の Write 直後に `node scripts/lint-screen-colors.mjs --check {file}` を実行し、**exit 1（hard）** は修正リトライ ≤3 → `feedback-log.md` Pattern B → abort（Step 17「色トークン適合 self-check」と同型・exit 2 は運用エラー）。`soft_promotions`（未解決 `--color-illustration-*`）のみなら exit 0 で続行（昇格候補 — Step 6 の report 経由で Step 7 ゲートに出し、tokens 登録は次回 Step 24 A-2b。実体化はさらに次の生成系 run）。

**Frame rule**: 再生成 / 新規 HTML は Step 17 の「HTML 固定サイズルール」にも従う（web = `body` 1440px / web-sm・mobile = `.screen` 390px ラッパー、幅 media query 禁止）。色 lint と併せて各画面の Write 直後に `node scripts/lint-screen-frame.mjs --check {file}` を実行し、exit 1 は同じリトライ ≤3 → Pattern B → abort 契約で扱う（fluid HTML が Step 30 の部分 Figma 更新に流れるとフレーム幅がブラウザ窓幅依存になるため）。

### Step 4a: Re-embed approved graphics (only when graphics approved)

**前提ゲート (設計 `docs/graphic-generation-design.md` §9-2b の 21g/29 共通契約)**: `pipeline-state.json` の `screens.graphics.decision == "generate"` **AND** `approvals.graphics_human_approved == true` のときのみ実行する。いずれかが不成立ならこの Step をスキップして Step 4b へ (graphic-plan.json / graphic-prompts.json の**ファイル存在は有効シグナルではない** — skip 済みプロジェクトにも残置される)。

Step 4 の HTML 再生成は spec からの再生成であり、**21g で承認済み (有料生成済み) の `<img>` 正典相対参照タグが脱落する**。放置すると色 lint は `<img>` を対象とせず検出機構が存在しないため、本 Step が決定的に復元する (復元 driver は `generated_files[]` − `excluded_slots[]`。plan は配置メタ参照のみ):

1. **対象確認 + 配置素材の取得** (`{regen_screens}` = Step 4 で再生成した `invasive_screens` + `new` 画面の CSV):

   ```bash
   node skills/21g-graphic-embed-review/scripts/gather-context.mjs {app_name} --delta --screens {regen_screens}
   ```

   `slot_count == 0` なら再生成画面にグラフィック slot は無い — この Step を終了して Step 4b へ。`E_*` は message に従い中断 (`feedback-log.md` に Pattern C を記録 — 承認済みプロジェクトで state 不整合は invariant violation)。
2. **再埋め込み**: 各 slot の挿入位置を `skills/21g-graphic-embed-review/refs/embed-guide.md` §1 (anchor 選定) に従い判断し、dry-run → 本実行する (再生成 HTML の markup が変わっていても spec の「使用グラフィック」節・plan の placement 記述から位置を再判断できる):

   ```bash
   node skills/21g-graphic-embed-review/scripts/embed-graphics.mjs {app_name} apply --stdin --delta --screens {regen_screens}
   ```

   `E_ANCHOR` は anchor を一意な逐語スニペットに選び直し、`E_VALIDATION` は `errors[]` に従い
   placements draft を直して再実行する (リトライ ≤3 → `feedback-log.md` Pattern B → abort — 4 の
   verify と同じ契約)。
3. **spec 節の復元**: Step 3 の spec 再生成で「使用グラフィック」節が消えているため、state から決定的に再 append する (由来の承認日は元の `step21g_approved_at` を引用。approvals は変更しない。**script は埋め込み完全性を機械検査する** — `E_EMBED_INCOMPLETE` は 2 が未完了のまま呼んだ順序違反 → 2 へ戻る):

   ```bash
   node skills/21g-graphic-embed-review/scripts/commit-approval.mjs {app_name} specs --screens {regen_screens}
   ```

4. **src↔正典存在照合** (21g と同じ検査 — C-26):

   ```bash
   node skills/21g-graphic-embed-review/scripts/embed-graphics.mjs {app_name} verify --delta --screens {regen_screens}
   ```

   `complete: false` は missing / violations に従い 2 をやり直す (リトライ ≤3 → `feedback-log.md` Pattern B → abort — Step 4 の lint 契約と同型)。

> **順序が load-bearing**: 本 Step は **Step 4 (main 再生成) の後・Step 4b (sub-state regen) の前** に置く。4b の `inherit_main` subagent は再生成した main HTML をタグごと継承するため、ここで復元した `<img>` は sub-state に自動継承される (逆順だと全 sub-state の個別パッチが要る)。Step 6 の色 lint 全走査・Step 7 ゲートより前に完結させる。preserved 画面には触れない (Step 0 の Hard constraint と同じ — `--screens` の対象絞りが機械的に保証する)。却下済み slot (`excluded_slots[]`) を復元しない点は driver 差集合が構造的に担保する。

### Step 4b: Regenerate sub-state HTML (only when `sub_state_aware == true`)

`sub_state_aware == false` の場合はこの Step をスキップして Step 5 へ。

**対象: `invasive_screens` + `new` 画面のみ。`additive` / `data-only` の `affected` 画面は sub-state も HTML 再生成を skip し保護される。**

各 `invasive_screens` / `new` 画面について、対応する sub-state HTML を再生成する:

1. Read `artifacts/{app_name}/screens/state-pattern-plan.json` を Read し、各画面の sub-state リスト (例: `["empty", "loading", "error"]`) を取得。**Step 28 の F (AND 条件) により sub_state_aware=true 時は plan 存在が保証されている** ため、Read 失敗は invariant violation として中断 (feedback-log.md に Pattern C 記録)
2. ~~state-pattern-plan.json が存在しない場合は `find artifacts/{app_name}/screens -name '{screen}--*.html'` で物理ファイル名から sub-state を導出~~ **レビュー対応で削除**: F の AND 条件成立により本経路は dead path。glob fallback は dual_theme HTML (`{screen}--light.html` 等) を sub-state と誤認するリスクがあり、削除した。今後 plan 不在で sub_state_aware=true になることは Step 28 の判定上不可能
3. 各画面 × 各 sub-state について `ayatori-screen-state-builder` subagent を起動して sub-state HTML を再生成 (25b と同じ subagent。inherit_main 方式が導入済 — Step 4 で再生成した main HTML を Phase 2-1 で Read して継承するため、affected/new 画面の sub-state も新 main から自動的に派生する)

   **subagent 起動 prompt template** (25b SKILL.md L209-226 と同型、`main_html_path` は Step 4 で **再生成した新 main** のパスを渡すこと):

   ```
   mode: subagent
   app_name: {app_name}
   screen_name: {画面名}             # affected / new リストの 1 要素 (例: 01-dashboard)
   platform: {platform}              # web または mobile (platform_combo に従って画面ごとに展開)
   state: {state}                    # state-pattern-plan.json の sub-state 1 要素 (例: empty)
   theme: {theme}                    # default / light / dark (requirements.json.design_output_scope.dual_theme_mode 由来)
   dual_theme_mode: {true|false}     # 同上、subagent Phase 1-Pre assertion に必須
   main_html_path: {repo_root}/artifacts/{app_name}/screens/{platform}/{画面名}{--theme suffix if dual_theme}.html
                                     # ↑ Step 4 で再生成した新 main HTML のパス。旧 main を誤って渡さないこと
                                     # theme == "default" → screens/{platform}/{画面名}.html
                                     # theme in {"light","dark"} → screens/{platform}/{画面名}--{theme}.html
   requirements_md_path: {repo_root}/artifacts/{app_name}/screens/{画面名}.md
   tokens_path: {repo_root}/artifacts/{app_name}/tokens.json
   shared_css_path: {repo_root}/artifacts/{app_name}/screens/_shared/root-variables.css
   expected_root_variables_md5: {Step 4 直前に root-variables.css から計算した md5}
   ```

   > **新 main のパス構築規則**: Step 4 (default HTML 再生成) の出力先は `screens/{platform}/{画面名}{--theme suffix}.html`。同じ規則で `main_html_path` を組み立てる。dual_theme プロジェクトでは light/dark の **2 instance** が必要 (cartesian product: 画面 × sub-state × theme)。`{画面名}--{theme}.html` の theme は subagent prompt の `theme` Input と必ず一致させる (light instance には `--light.html`、dark instance には `--dark.html` を渡す)。
   >
   > **25b との挙動差分**: 25b は pipeline 順次実行で main が常に存在するが、29 は delta フローで Step 4 が main を再生成した直後に本 step が走る。Step 4 が `removed` 扱いで main を削除した画面については本 step の対象外 (affected/new リストにのみ展開する Hard constraint)。preserved 画面の sub-state は **絶対に再生成しない** (Step 5 の保護対象)。
   >
   > **subagent から `status: "inheritance_failed"` が返った場合**: 当該 file を再生成済リストから除外し、`feedback-log.md` に Pattern C を記録。delta フローの本 Step は best-effort で continue (他の sub-state は再生成を継続)。当該画面 × sub-state は次回 delta 実行時に再 trigger される。
4. **capture.js 注入**: 生成された全 sub-state HTML について、`capture.js` script tag が `</head>` 直前に注入されているか確認し、欠落していたら追加する (25b の Step 3-1b と同型の idempotent 注入手順):

   ```python
   for path in regenerated_sub_state_files:
     html = Read(f"artifacts/{app_name}/{path}")
     if '<script src="https://mcp.figma.com/mcp/html-to-design/capture.js"' not in html:
       html = html.replace("</head>", '  <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>\n</head>')
       Write(f"artifacts/{app_name}/{path}", html)
   ```

   注入済みかどうかを先にチェックして idempotent にすること (再実行時の二重注入を防ぐ)。**この手順がないと delta の sub-state regen 後に Step 30 で Figma capture が全件 pending する** (25b で発生した Pattern B と同じパターン)。
5. preserved 画面の sub-state HTML は **絶対に Read / Write しない** — Step 0 で抽出した classification リストに含まれない sub-state ファイルには触れない

> **Hard constraint**: `find` で sub-state ファイルを列挙する際も、必ず affected / new リストに含まれる画面名でフィルタする。glob 結果をそのまま regen 対象にしないこと (preserved 保護を破壊する)。

### Step 4c: Generate state_added sub-state HTML

`state_added_screens` が空の場合はこの Step をスキップして Step 5 へ。

state_added は **default を preserve しつつ追加 sub-state HTML を新規生成** するパターン (Step 28 軸 5 由来)。Step 4b (sub-state regen) と独立した経路で、`state-pattern-plan.json` には依存しない (delta-driven ad-hoc; plan が無い run でも動作する)。

1. `state_added_screens` の各 entry (`{screen, added_states[]}`) について、追加する新規 sub-state を生成する:
   - `added_states[]` × `platforms` (× `themes` if `dual_theme_mode == true`) の cartesian で生成対象を確定
   - **`platforms` の出所**: `requirements.json.design_output_scope.platform_combo` から導出 (Step 4 と同じ rule、`mobile_only` → `["mobile"]` / `web_only` → `["web"]` / `mobile_and_web` → `["mobile", "web"]`)
   - **`dual_theme_mode` / `themes` の出所**: `requirements.json.design_output_scope.dual_theme_mode` (bool)。true なら `themes = ["light", "dark"]`、false なら theme 軸を product から除外 (Step 17 / 25b と同じ rule)
   - ファイル命名 (Step 17 / 25b と同型):
     - `dual_theme_mode == false` → `screens/{platform}/{screen}--{state}.html`
     - `dual_theme_mode == true` → `screens/{platform}/{screen}--{state}--{theme}.html`
2. 各組合せについて `ayatori-screen-state-builder` subagent を起動して HTML を新規生成。subagent への入力は Step 4b と同じ (画面仕様 `.md` + `tokens.json` + `_shared/root-variables.css`)。state-pattern-plan.json は Read しない (state_added は plan 外の delta ad-hoc 経路)。
3. **既存 default HTML は絶対に Read / Write しない**: `{screen}.html` / `{screen}--light.html` / `{screen}--dark.html` (dual_theme の default theme variants) は preserve。Phase 3 で生成済の Step 17 default HTML が破壊されないよう、subagent への target_path には必ず新規 state suffix が含まれていることを assert する。
4. **衝突チェック (最終 safety net)**: 生成先 `screens/{platform}/{screen}--{state}[--{theme}].html` が既存の場合は **上書きせず**、`feedback-log.md` に Pattern C として記録して中断する。命名規約 (Phase 3 既存 sub-state / dual_theme suffix / 同 screen 過去 run と衝突しない state 名) は skill 28 軸 5 末尾「命名指針 (collision avoidance)」で定義されており、本 Step ではその規約が守られているかをファイル存在で再検証する位置付け。
5. **capture.js 注入** (Step 4b と同型 idempotent 手順): 生成された全 state_added HTML について、`capture.js` script tag が `</head>` 直前に注入されているか確認し、欠落していたら追加する。これがないと Step 30 で Figma capture が pending 化する。
6. `00-screen-list.md` の更新は **不要** (state_added は既存 screen の追加状態であり、新規 screen ではない)。

> **Hard constraint**: state_added 経路は `affected` / `new` / `removed` のいずれのリストにも含まれない画面を対象とする。state_added 画面の default HTML は preserved 同等の保護下にあり、Step 30 でも default frame は recapture されない (append-only で追加 state frame のみ capture される)。

### Step 5: Delete removed screens

For each `removed` screen:
- Delete `artifacts/{app_name}/screens/{platform}/{screen}*.html` (default + sub-state HTML が glob で全て対象になる)
- Delete `artifacts/{app_name}/screens/{screen}.md`
- Do NOT touch Figma frames — that is Step 30's responsibility

> `{screen}*.html` glob は `{screen}.html` (default) と `{screen}--*.html` (sub-state) を両方マッチするため、`sub_state_aware` 真偽に関わらず removed 画面の sub-state HTML は自動的に削除対象になる (追加処理不要)。

### Step 6: Mini design review (abbreviated Step 18)

Run a focused 3-layer review on the **affected screens only**:
- Layer 1: Token consistency — do new/updated screens use only `var(--*)` references from `_shared/root-variables.css`?
- **Layer 1-COLOR（C-25）**: 色一貫性 report を **全画面横断で** 再生成する（script の read-only 走査は Step 0 Hard constraint の除外対象 — preserved を LLM が読むのではない）:

  ```bash
  node scripts/lint-screen-colors.mjs --report artifacts/{app_name}
  node scripts/render-color-report.mjs artifacts/{app_name}/screens/color-lint-report.json
  ```

  `summary` のみ Read し、(a) 再生成画面由来の L1 違反（literal / unresolved / canon mismatch）は inline fix（上の Step 4 Color rule のリトライ枠内）、(b) `icons_with_variance` / `promotion_queue` / `boundary_violations` は **Step 7 gate で `color-lint-report.html` を提示**して人間判断（「新画面 A は新色・preserved 画面 B は旧色」型の (B) ドリフトはこの横断 report でだけ見える）。承認された昇格は次回 Step 24 実行時（または `/ayatori-delta` 完了後の手動 Step 24）の A-2b が取り込む。
- Layer 2: UX consistency — do new/updated screens match the navigation and layout patterns of preserved screens?
- Layer 3: Brand consistency — do new/updated screens feel visually consistent with preserved screens?
- Layer-REQ (要件トレース監査、F-3b): delta は部分再生成 (生成) と本監査が **同一 session・同一 model** で self-bias が漏れる (Step 18 を経由しない独自パス + ablation 実証「生成 context を持つと検証の起点となる疑問が生成されない」)。これを構造分離で断つため、監査を **`ayatori-requirements-auditor` subagent (`layer="delta"`) に委譲**して生成 context を隔離する:
  - 起動 prompt (Task tool): `layer="delta"` / `app_name` / `repo_root` (絶対パス起点) / `requirements_json_path` (**変更後**、突合先) / `regenerated_screens` (本 step で再生成した画面 HTML パス list) / `screen_specs` (対応する画面仕様 `.md` パス list = 列挙源) / (任意) `design_brief_path` (motion/visual の突合先)。
  - subagent は再生成画面の **component + 挙動/インタラクション/状態** を独立 forced-enum し、変更後 `requirements.json` (+ design-brief) に literal トレース。マップできない要素を deviation candidates として return (REQ-AUD-01〜05。delta は generation-provenance が無いため provenance cross-check は不適用 = `self_bias_signal` は付かない)。
  - **main (本 step) が single writer** として `requirement-deviations.json` に append (`phase="delta"`, `raised_by_step="29-partial-screen-regen"`, `detected_at` を main 付与) + `coverage[]` に `{ phase:"delta", raised_by_step:"29-partial-screen-regen", enumerated_count, enumerated_refs, checked_at }` (**0 件でも必須**) を記録 → `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` で view を決定論生成 (手焼き禁止)。
  - ⚠️ **フォールバック (registry 未反映時)**: auditor 起動失敗時は §5.2 forced-enum を main が inline 実行して継続 + `feedback-log.md` に Pattern C 記録 (self-bias は残るが silent skip より良い)。
  delta は変更への過剰適応で要件外を足しやすいため必須。下記 Step 7 gate で view.html を提示。詳細は `docs/principle4-disambiguation.md` §5 (§5.3 表の delta 行も参照)。

If any critical issue is found: fix inline and log to `feedback-log.md` as Pattern B.

### Step 6b: L5 connectivity validation gate

画面追加時の未配線（最頻発ケース）を delta 経路で確実に止めるためのゲート。**`new` / `affected` 画面**について、`.mmd` 編集（Step 2-A）後のグラフが各画面の入口/出口を成立させているか検証する。

1. Read `artifacts/{app_name}/screens/00-screen-nav.json`（Step 2-C で再生成）/ `00-transition-map.mmd` / `00-screen-list.md`（chrome 列）。
2. `docs/screen-coverage-check.md` §4-5-4 の 5 ルールで validator を実行する。**ただし block 対象は `new` / `affected` リストの画面に関わる defect のみ**（`preserved` 画面の既存 defect は本 delta の責務外。delta で新たに壊した場合のみ拾う）。
   - `new` 画面の典型: `orphan_in_list`（`.mmd` 未配線で開けない）/ `unreachable`（入口エッジ無し）/ `dead_end`（戻り先無し）。Step 28「Screen Entry/Exit Requirements」表の入口/出口がすべて `.mmd` に配線されているかも突合する。
   - chrome 連携（§4-5-3）で false-positive を回避する（chrome=A タブ親 / chrome=B 子画面の暗黙到達性）。
3. **defect が見つかった場合の挙動（fix_hint 別）**:
   - `mmd_edge` / `wire_new_screen`（`.mmd` 構造）→ 本 step が `.mmd` をインライン補完（Step 2-A と同じ要領で不足エッジ・配線を追加）→ Step 2-B / 2-C をやり直して再検証（max 2 回）。
   - `back_affordance`（HTML 側の戻る導線）→ 当該画面 HTML（Step 4 で再生成済）に戻る導線を追加。
4. 補完しても解消しない defect が残る場合は、Step 7 human gate で **未解消 connectivity defect を明示提示**し、`feedback-log.md` に Pattern C（パイプライン設計 / 配線漏れ）として記録する。解消できないまま承認を強行させない（user に「このまま進める / Step 14 に戻って配線する」を選ばせる）。

> **preserved 画面を絶対に触らない原則との整合**: 本ゲートは `.mmd` のエッジ追加（new/affected 画面の配線）と当該画面 HTML のみを対象とする。preserved 画面の HTML / `.md` は読み書きしない（Step 0 の Hard constraint を踏襲）。

### Step 7: Human approval gate

Display updated HTML files for affected screens. また `requirement-deviations.json` に未 resolved の要件外追加がある場合は `requirement-deviations-view.html` も提示し、user が **修正依頼 / 容認 / 要件に昇格** を判断する。判断の受領は `docs/principle4-disambiguation.md` **§5.5 の per-item 判断プロトコル** に従い、main session が `resolution` + `resolved_at` + `resolution_mode` (per-item・番号指定 = individual / 全件容認の明示選択のみ = bulk) を書き戻す。**無言の全件容認への読み替えは禁止**。`color-lint-report.html` に人間判断項目 (icons_with_variance / promotion_queue / boundary_violations / unmatched_svgs) がある場合はそれも提示する (Step 6 Layer 1-COLOR 参照)。

`00-transition-map.html` が Step 2-B で再生成され、かつ Step 2-Figma で FigJam 同期まで完了している場合は、レビュー時に両方の表示が一致しているか確認できるよう FigJam URL も承認ゲートに含める (`.mmd` が未変更で 2-B / 2-Figma がスキップされた delta では本ブロックを表示しない):

```
遷移図: artifacts/{app_name}/screens/00-transition-map.html
遷移図 FigJam (FIGMA_MCP_ENABLED=true 時のみ更新): {figma-state.json.nodes.transition_map.url}
```

Then present AskUserQuestion:
- **部分再生成の確認**
  - Option A: 承認 — Step 30（Figma 部分更新）に進む
  - Option B: 修正指示 — 指定した画面を再生成する（Step 3 に戻る）
  - Option C: キャンセル — delta 実行を中止する（生成済み HTML は残る）

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
data["delta"]["runs"][-1]["screens_approved_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: screens_approved_at written")
PYEOF
```

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
Display "Delta 実行を中止しました。生成済み HTML は artifacts に残ります。" and exit.

---

## Output
- Updated `artifacts/{app_name}/screens/00-screen-list.md` (if changed)
- Updated `artifacts/{app_name}/screens/00-transition-map.mmd` (if changed; **SSoT**)
- Updated `artifacts/{app_name}/screens/00-transition-map.html` (if changed; derived from template + `.mmd`)
- Updated `artifacts/{app_name}/screens/00-screen-nav.json` (if `.mmd` changed; derived per-screen entry/exit view)
- Updated `artifacts/{app_name}/screens/00-coverage-check.json` (`layers.l5_connectivity.defects[]` if Step 6b detected/resolved connectivity defects)
- Updated/new `artifacts/{app_name}/screens/{screen}.md` (affected screens only)
- Updated/new `artifacts/{app_name}/screens/{platform}/{screen}*.html` (`invasive` + `new` 画面のみ — `additive` / `data-only` は HTML 非再生成。`sub_state_aware == true` の場合は `invasive` / `new` 画面の sub-state HTML も同時に再生成)
- New `artifacts/{app_name}/screens/{platform}/{screen}--{state}[--{theme}].html` for each `state_added_screens` entry (default HTML は preserve)
- Updated `artifacts/{app_name}/figma-state.json` (`nodes.transition_map.node_id` and `generated_at`; only when `FIGMA_MCP_ENABLED=true` and transitions changed)
- `pipeline-state.json` — `delta.runs[-1].screens_approved_at` set
