# Illustration Policy Implementation Plan (POCTEAMA-166)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `illustration_policy` field (pictogram / illustration_character / emoji_casual) to the AYATORI pipeline so it is captured early in Phase 1a, auto-detected in Phase 0b, confirmed/overridable in Phase 2, and propagated consistently to all downstream design and screen-generation steps.

**Architecture:** Single-direction data flow: `requirements.json.design_output_scope.illustration_policy` (set by 01-question greenfield, or detected by 00b and written by 00e reverse path) → `design-brief.yaml.common.ui_constraints.illustration_policy` (confirmed/overridden by 08) → all downstream skills (ayatori-sample-html-builder, 12, 17, 24) read from `design-brief.yaml`. No new pipeline artifact files or formats are created (this plan doc and its paired spec are superpowers scaffolding, not pipeline artifacts).

**Tech Stack:** Markdown instruction files (skill.md), JSON Schema, YAML template

**Spec:** `docs/superpowers/specs/2026-05-26-illustration-policy-design.md`

---

## File Map

| File | Change |
|---|---|
| `schemas/requirements.schema.json` | Add `illustration_policy` enum to `design_output_scope.properties` |
| `skills/08-design-brainstorm/refs/design-brief-template.md` | Add `illustration_policy` to `ui_constraints` block |
| `skills/01-question/skill.md` | Add Axis 7-f sub-question (7-e is dual_theme_mode from POCTEAMA-121) |
| `skills/00b-source-analysis/skill.md` | Add Check B-06 illustration style detection |
| `skills/00c-requirements-gen/skill.md` | Preserve B-06 section in raw-analysis.md output (does not write requirements.json) |
| `skills/00e-ayatori-format-convert/skill.md` | Write `illustration_policy` from B-06 result to `requirements.json` E1 template |
| `skills/08-design-brainstorm/skill.md` | Add confirm/override block in Phase 1 Axis 6 |
| `.claude/agents/ayatori-sample-html-builder.md` | Add `illustration_policy` to Hard-constraint layer + Phase 4 rendering gate |
| `skills/12-design-system/refs/generate-style-guide.md` | Add `illustrationPolicy` to Step 2 extraction table |
| `skills/17-screen-gen/skill.md` | Gate Step 0 icon fetch on `illustration_policy`; adjust icon rule exceptions |
| `skills/24-design-system-update/skill.md` | Add suppression guard for non-pictogram policies |

---

## Task 1: Add `illustration_policy` to requirements.schema.json

**Files:**
- Modify: `schemas/requirements.schema.json:22-49`

- [ ] **Step 1: Read the current design_output_scope block**

```bash
grep -n "illustration\|mobile_framework\|design_output_scope" schemas/requirements.schema.json
```

Expected: `mobile_framework` entry exists, no `illustration_policy` entry.

- [ ] **Step 2: Add `illustration_policy` property after `mobile_framework`**

In `schemas/requirements.schema.json`, inside `"design_output_scope".properties`, add after the `"mobile_framework"` object (after its closing `}`):

```json
        "illustration_policy": {
          "type": "string",
          "description": "イラスト・アイコン方針。skills/01-question/skill.md 7-f と pipeline.yaml default_design_output_scope に対応。全画面一律適用 (タブバー / 空状態 / オンボーディング / エラー画面)。デフォルト: pictogram。",
          "enum": ["pictogram", "illustration_character", "emoji_casual"]
        }
```

- [ ] **Step 3: Validate JSON syntax**

```bash
python3 -c "import json; json.load(open('schemas/requirements.schema.json')); print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Confirm the new field is present**

```bash
grep -A5 "illustration_policy" schemas/requirements.schema.json
```

Expected: the enum block appears.

- [ ] **Step 5: Commit**

```bash
git add schemas/requirements.schema.json
git commit -m "feat(schema): add illustration_policy enum to design_output_scope (POCTEAMA-166)"
```

---

## Task 2: Add `illustration_policy` to design-brief-template.md

**Files:**
- Modify: `skills/08-design-brainstorm/refs/design-brief-template.md:51-56`

- [ ] **Step 1: Read the ui_constraints block**

```bash
grep -n "icon_style\|emoji_allowed\|ui_constraints" skills/08-design-brainstorm/refs/design-brief-template.md
```

Expected: `icon_style: "svg-line-round"` is present, no `illustration_policy`.

- [ ] **Step 2: Add `illustration_policy` after `icon_style`**

Find this block in `skills/08-design-brainstorm/refs/design-brief-template.md`:

```yaml
  ui_constraints:
    emoji_allowed: false
    icon_style: "svg-line-round"       # フォントアイコン禁止・SVG 線画のみ
    icon_stroke_width: "1.5"
```

Replace with:

```yaml
  ui_constraints:
    emoji_allowed: false
    icon_style: "svg-line-round"       # フォントアイコン禁止・SVG 線画のみ
    illustration_policy: "pictogram"   # pictogram | illustration_character | emoji_casual
    icon_stroke_width: "1.5"
```

- [ ] **Step 3: Confirm the new field is present**

```bash
grep -n "illustration_policy" skills/08-design-brainstorm/refs/design-brief-template.md
```

Expected: one match on the `illustration_policy: "pictogram"` line.

- [ ] **Step 4: Commit**

```bash
git add skills/08-design-brainstorm/refs/design-brief-template.md
git commit -m "feat(design-brief): add illustration_policy to ui_constraints template (POCTEAMA-166)"
```

---

## Task 3: Add Axis 7-f to 01-question/skill.md

**Files:**
- Modify: `skills/01-question/skill.md` (Axis 7 section, around line 270)

- [ ] **Step 1: Read the Axis 7 section to find the exact insertion point**

```bash
grep -n "7-d\|mobile_framework\|Consistency check\|Store as separate" skills/01-question/skill.md
```

Expected: lines showing `7-d) Mobile Framework`, `Consistency check with Axis 5`, and `Store as separate fields`.

- [ ] **Step 2: Add Axis 7-f block before the Consistency check paragraph**

Find this text in `skills/01-question/skill.md`:

```
**Consistency check with Axis 5:** after collecting all sub-answers,
```

Insert the following block immediately before it:

```
**7-f) Illustration Policy** (`illustration_policy`)
Ask what visual language the app uses for icons, tab bar items, and illustration contexts (empty states, onboarding, error screens). Default if the user skips: `pictogram`.

Always asked (not conditional). Present with `AskUserQuestion` with `pictogram` as option 1 (recommended).

| Option | Value | Description |
|---|---|---|
| 1 | `pictogram` | 記号的なアイコン（ホーム・人・検索など）— デフォルト推奨 |
| 2 | `illustration_character` | キャラクター・マスコット系のイラスト（ゲーム系アプリ向け）|
| 3 | `emoji_casual` | 絵文字をそのまま使うパターン（軽量・サンプル・PoC 向け）|

Store as `requirements.json → design_output_scope.illustration_policy`.

```

- [ ] **Step 3: Confirm the insertion**

```bash
grep -n "illustration_policy\|7-f" skills/01-question/skill.md
```

Expected: at least 2 matches (the header and the store instruction).

- [ ] **Step 4: Commit**

```bash
git add skills/01-question/skill.md
git commit -m "feat(01-question): add Axis 7-f illustration_policy sub-question (POCTEAMA-166)"
```

---

## Task 4: Add Check B-06 to 00b-source-analysis/skill.md

**Files:**
- Modify: `skills/00b-source-analysis/skill.md` (before the `## Output` section, around line 145)

- [ ] **Step 1: Read the end of the B-05 check to find the exact insertion point**

```bash
grep -n "## Output\|B-05\|Navigation State" skills/00b-source-analysis/skill.md
```

Expected: `B-05: Navigation State` section ends before `## Output`.

- [ ] **Step 2: Add Check B-06 block before `## Output`**

Find this text in `skills/00b-source-analysis/skill.md`:

```
## Output
```

Insert the following block immediately before it:

```
---

**Check B-06: Illustration Style**

*Why*: The existing app's icon and illustration choices reveal which visual language the team has committed to. Detecting this early prevents Phase 2 (design brainstorm) from silently overriding an established pattern with the default.

- For GitHub source repos: scan `assets/`, `images/`, `drawable/`, `res/drawable*/` for PNG/WebP/JPG files whose names suggest character illustrations (e.g. `character_`, `mascot_`, `onboarding_`, `empty_`)
- Scan icon usage across screen files: look for `🏠` / `🔔` / `✅` or similar Unicode emoji used as tab bar or action icons
- Look for SVG icon library imports: `heroicons`, `phosphor`, `material-icons`, `lucide`, or `<svg>` inline usage
- For Confluence doc-import: look for image assets referenced in screen spec pages (PNG/character illustrations vs. icon-only SVG specs)

Signal table:

| Signal | Inferred policy |
|---|---|
| SVG line/solid icons (heroicons, phosphor, lucide, material-icons) | `pictogram` |
| Raster image assets named `character_*`, `mascot_*`, `onboarding_*`, `empty_*` | `illustration_character` |
| Unicode emoji used as tab bar / action icons in UI code | `emoji_casual` |
| Mixed signals or no icons found | `pictogram` (safe fallback) |

Record the inferred value and present it to the user as a confirm-or-override prompt:
```
「アイコン・イラスト方針を『ピクトグラム / アイコン系』と推定しました（ソース分析より）。
確認してください:」
→ AskUserQuestion: そのまま使う / 変更する（3 択セレクタ表示）
```

Extract: record the confirmed value as `illustration_policy_detected` in the analysis output. 00e-ayatori-format-convert will write this to `requirements.json` (E1 template). 00c-requirements-gen preserves the B-06 section in raw-analysis.md but does not write requirements.json.

```

- [ ] **Step 3: Confirm the insertion**

```bash
grep -n "B-06\|illustration_policy_detected\|Illustration Style" skills/00b-source-analysis/skill.md
```

Expected: at least 3 matches.

- [ ] **Step 4: Commit**

```bash
git add skills/00b-source-analysis/skill.md
git commit -m "feat(00b): add Check B-06 illustration style detection (POCTEAMA-166)"
```

---

## Task 5: Add `illustration_policy` to 00e-ayatori-format-convert E1 template, and B-06 note to 00c

**Files:**
- Modify: `skills/00e-ayatori-format-convert/skill.md` (E1 template JSON)
- Modify: `skills/00c-requirements-gen/skill.md` (add B-06 note clarifying 00e is the writer)

Note: 00c-requirements-gen only writes the 8 ISO docs in `reverse-engineered/` and preserves B-06 in `raw-analysis.md`. `requirements.json` itself is generated exclusively by `00e-ayatori-format-convert` (E1). This task wires illustration_policy into the 00e E1 template and adds a clarifying note in 00c.

- [ ] **Step 1: Add `illustration_policy` to 00e E1 template**

In `skills/00e-ayatori-format-convert/skill.md`, find the E1 `design_output_scope` JSON block and add:

```json
"illustration_policy": "{illustration_policy_detected from B-06, default: pictogram}"
```

Derivation note: read `### B-06 Illustration Style` section from `raw-analysis.md`; use `"pictogram"` as safe default if absent or inconclusive.

- [ ] **Step 2: Add B-06 note to 00c**

In `skills/00c-requirements-gen/skill.md`, add a note:

```
**B-06 Illustration note**: The `illustration_policy` field belongs in `requirements.json`, which is generated by `00e-ayatori-format-convert` (E1), not by this skill. This skill only preserves the B-06 section verbatim in `raw-analysis.md`.
```

- [ ] **Step 3: Confirm**

```bash
grep -n "B-06\|illustration_policy" skills/00e-ayatori-format-convert/skill.md
grep -n "B-06\|illustration_policy" skills/00c-requirements-gen/skill.md
```

- [ ] **Step 4: Commit**

```bash
git add skills/00e-ayatori-format-convert/skill.md skills/00c-requirements-gen/skill.md
git commit -m "feat(00e): add illustration_policy to E1 template from B-06 detection (POCTEAMA-166)"
```

---

## Task 6: Add confirm/override block to 08-design-brainstorm/skill.md

**Files:**
- Modify: `skills/08-design-brainstorm/skill.md` (Phase 1 Axis 6, around line 119)

- [ ] **Step 1: Read Phase 1 Axis 6 to find the exact insertion point**

```bash
grep -n "UI表現制約\|6\. \*\*UI\|emoji_allowed\|icon_style" skills/08-design-brainstorm/skill.md | head -10
```

Expected: Axis 6 line showing `**UI表現制約** — 絵文字可否・アイコンスタイル・数値の表記方針`.

- [ ] **Step 2: Extend Axis 6 with the illustration_policy confirm/override block**

Find this exact text in `skills/08-design-brainstorm/skill.md`:

```
6. **UI表現制約** — 絵文字可否・アイコンスタイル・数値の表記方針
```

Replace with:

```
6. **UI表現制約** — 絵文字可否・アイコンスタイル・数値の表記方針、イラスト方針確認

   After collecting emoji / icon_style / numeric answers, also surface the illustration policy:

   a. Read `artifacts/{app_name}/requirements.json.design_output_scope.illustration_policy`
   b. Present to the user as a pre-filled answer:
      ```
      「イラスト方針は『ピクトグラム / アイコン系』に設定されています（01-question より）。
      このデザイン方向性と合っていますか？」
      → AskUserQuestion: そのまま使う / 変更する
      ```
   c. If 「変更する」: show the 3-choice selector (pictogram / illustration_character / emoji_casual)
   d. If 「そのまま使う」: carry the value through unchanged
   e. Store the confirmed value as an in-session variable — **do not write to `design-brief.yaml` here**. Phase 7 §7.2 is the single write point for `common.ui_constraints.illustration_policy`. An early write would be clobbered by Phase 7's full yaml regeneration.

   For **REVERSE_ENGINEERED Mode C fast-path**: same read-and-confirm block runs. Show the B-06 detected value for confirmation.

   If `requirements.json` does not have `illustration_policy` (legacy project): default to `pictogram` and present it as the pre-filled option.
```

- [ ] **Step 3: Confirm the insertion**

```bash
grep -n "illustration_policy\|イラスト方針\|変更する" skills/08-design-brainstorm/skill.md | head -10
```

Expected: at least 3 matches covering the new block.

- [ ] **Step 4: Confirm design-brief.yaml write instruction is present**

```bash
grep -n "common.ui_constraints.illustration_policy" skills/08-design-brainstorm/skill.md
```

Expected: 1 match (the write instruction in step e).

- [ ] **Step 5: Commit**

```bash
git add skills/08-design-brainstorm/skill.md
git commit -m "feat(08): add illustration_policy confirm/override block in Phase 1 Axis 6 (POCTEAMA-166)"
```

---

## Task 7: Add illustration_policy rendering gate to ayatori-sample-html-builder.md

**Files:**
- Modify: `.claude/agents/ayatori-sample-html-builder.md` (Phase 2a Hard-constraint table, around line 90; Phase 4, after 4.4)

- [ ] **Step 1: Read Phase 2a Hard-constraint table**

```bash
grep -n "ui_constraints\|emoji_allowed\|icon_style\|illustration" .claude/agents/ayatori-sample-html-builder.md | head -10
```

Expected: `common.ui_constraints` row with `emoji_allowed・icon_style・numeric_font・language_policy`, no `illustration_policy`.

- [ ] **Step 2: Update Phase 2a Hard-constraint table to include illustration_policy**

Find this text in `.claude/agents/ayatori-sample-html-builder.md`:

```
| `common.ui_constraints` | アプリ名・emoji_allowed・icon_style・numeric_font・language_policy | HTML title / 絵文字使用判定 |
```

Replace with:

```
| `common.ui_constraints` | アプリ名・emoji_allowed・icon_style・illustration_policy・numeric_font・language_policy | HTML title / 絵文字使用判定 / アイコン・イラスト種別判定 |
```

- [ ] **Step 3: Add illustration_policy rendering gate section after Phase 4.4**

Find this text in `.claude/agents/ayatori-sample-html-builder.md`:

```
#### 4.5 violations 警告バッジ（`wcag_gate_decision == "warning_passthrough"` の時のみ）
```

Insert the following block immediately before it:

```
#### 4.5 イラスト方針による実装分岐

Read `common.ui_constraints.illustration_policy` from `design-brief.yaml` (extracted in Phase 2a).

| policy | タブバー・アクションアイコン | 空状態・オンボーディング・エラー画面のイラスト |
|---|---|---|
| `pictogram` | インライン SVG（Heroicons/Phosphor 風の線画、`stroke-linecap="round"`）| SVG 幾何形状プレースホルダー |
| `illustration_character` | `<div class="illust-placeholder" data-scene="{scene}">` ブロック（SVG フェッチ不要） | 同左 |
| `emoji_casual` | Unicode 絵文字をそのまま使用（`emoji_allowed: true` を前提） | 絵文字またはプレースホルダー |

`illustration_character` の場合は `emoji_allowed` が true であっても絵文字をアイコンとして使わない。

フォントアイコン禁止（4.4 リスト内）は全ポリシー共通で常に適用する。`illustration_character` / `emoji_casual` ではそれに加えて SVG 前提チェック（インライン SVG 必須・`stroke-linecap` 指定）をスキップし、代わりにプレースホルダー / 絵文字の一貫使用を確認する。

```

- [ ] **Step 4: Confirm both changes**

```bash
grep -n "illustration_policy\|illust-placeholder\|イラスト方針" .claude/agents/ayatori-sample-html-builder.md
```

Expected: at least 4 matches (Hard-constraint table update + the new section).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/ayatori-sample-html-builder.md
git commit -m "feat(sample-html-builder): add illustration_policy rendering gate (POCTEAMA-166)"
```

---

## Task 8: Gate Step 0 on illustration_policy in 17-screen-gen/skill.md

**Files:**
- Modify: `skills/17-screen-gen/skill.md` (アイコン実装ルール section ~line 278; Step 0 section ~line 288)

- [ ] **Step 1: Read the icon rule section to find insertion points**

```bash
grep -n "アイコン実装ルール\|Step 0\|絵文字\|emoji" skills/17-screen-gen/skill.md | head -15
```

Expected: `アイコン実装ルール（必須）` heading at ~line 278, `Step 0: アイコン一括取得` at ~line 288, emoji prohibition at ~line 284.

- [ ] **Step 2: Add policy exception to the アイコン実装ルール section**

Find this exact text in `skills/17-screen-gen/skill.md`:

```
- フォントアイコン（Material Icons 等）とUnicode 絵文字（🔔 🏠 ✅ など）を UI アイコンとして使用すること（Figmaキャプチャ時にフォントが読み込まれずアイコンが表示されない問題が発生するため）
```

Replace with:

```
- フォントアイコン（Material Icons 等）を UI アイコンとして使用すること（Figmaキャプチャ時にフォントが読み込まれずアイコンが表示されない問題が発生するため）
- Unicode 絵文字（🔔 🏠 ✅ など）を UI アイコンとして使用すること — **ただし `design-brief.yaml.common.ui_constraints.illustration_policy == "emoji_casual"` の場合はこの禁止を解除し、絵文字を直接使用すること**
```

- [ ] **Step 3: Add policy gate at the start of Step 0**

Find this exact text in `skills/17-screen-gen/skill.md`:

```
#### Step 0: アイコン一括取得（全画面 HTML 生成の前に 1 回だけ実行）

**個別画面ごとの WebFetch は禁止。**
```

Replace with:

```
#### Step 0: アイコン一括取得（全画面 HTML 生成の前に 1 回だけ実行）

**事前: `illustration_policy` ゲート判定**

`artifacts/{app_name}/design-brief.yaml` の `common.ui_constraints.illustration_policy` を Read して分岐する:

| policy | Step 0 の挙動 |
|---|---|
| `pictogram` | 以下の通常手順を実行する（デフォルト） |
| `illustration_character` | SVG フェッチをスキップ。`artifacts/{app_name}/icons-manifest.json` に `{"library": "illustration_character", "icons": []}` を書き込み Step 0 を終了（スキーマ準拠: `library` を sentinel として使用）。各画面 HTML では `<div class="illust-placeholder" data-scene="{scene_name}">` ブロックを使用する |
| `emoji_casual` | SVG フェッチをスキップ。`artifacts/{app_name}/icons-manifest.json` に `{"library": "emoji_casual", "icons": []}` を書き込み Step 0 を終了（スキーマ準拠）。各画面 HTML では Unicode 絵文字を直接使用する |

`illustration_character` / `emoji_casual` の場合は以下の手順を実行しない。`pictogram` の場合のみ続行:

**個別画面ごとの WebFetch は禁止。**
```

- [ ] **Step 4: Confirm both changes**

```bash
grep -n "illustration_policy\|emoji_casual\|illust-placeholder\|ゲート判定" skills/17-screen-gen/skill.md | head -10
```

Expected: at least 5 matches covering the icon rule exception and the Step 0 gate table.

- [ ] **Step 5: Commit**

```bash
git add skills/17-screen-gen/skill.md
git commit -m "feat(17-screen-gen): gate Step 0 icon fetch on illustration_policy (POCTEAMA-166)"
```

---

## Task 9: Add illustrationPolicy to 12-design-system generate-style-guide.md

**Files:**
- Modify: `skills/12-design-system/refs/generate-style-guide.md` (Step 2 table, around line 91)

- [ ] **Step 1: Read the Step 2 extraction table**

```bash
grep -n "iconStyle\|icon_style\|expressionConstraints\|illustrationPolicy" skills/12-design-system/refs/generate-style-guide.md
```

Expected: `iconStyle` row at ~line 91, no `illustrationPolicy`.

- [ ] **Step 2: Add illustrationPolicy row after iconStyle in Step 2 extraction table**

Find this text in `skills/12-design-system/refs/generate-style-guide.md`:

```
| `iconStyle` | `common.ui_constraints.icon_style` | `"svg-line-round"` → "線画（アウトラインアイコン）のみ" |
```

Replace with:

```
| `iconStyle` | `common.ui_constraints.icon_style` | `"svg-line-round"` → "線画（アウトラインアイコン）のみ" |
| `illustrationPolicy` | `common.ui_constraints.illustration_policy` | `"pictogram"` → "ピクトグラム / アイコン系" / `"illustration_character"` → "キャラクター・イラスト系" / `"emoji_casual"` → "絵文字 / カジュアル系" |
```

- [ ] **Step 3: Add illustrationPolicy section rule to the checklist**

Find this text in `skills/12-design-system/refs/generate-style-guide.md`:

```
- [ ] Do/Don't rules are sourced from `cases[selected_sample_id].donts[]` and `common.ui_constraints`
```

Replace with:

```
- [ ] Do/Don't rules are sourced from `cases[selected_sample_id].donts[]` and `common.ui_constraints`
- [ ] `illustrationPolicy` section is present in the style guide HTML (Section 07 Usage Rules), documenting: policy name, description, a Do example, and a Don't example appropriate to the policy
```

- [ ] **Step 4: Confirm both changes**

```bash
grep -n "illustrationPolicy\|illustration_policy" skills/12-design-system/refs/generate-style-guide.md
```

Expected: at least 2 matches.

- [ ] **Step 5: Commit**

```bash
git add skills/12-design-system/refs/generate-style-guide.md
git commit -m "feat(12-design-system): add illustrationPolicy extraction to style guide (POCTEAMA-166)"
```

---

## Task 10: Add suppression guard to 24-design-system-update/skill.md

**Files:**
- Modify: `skills/24-design-system-update/skill.md` (Step D section)

- [ ] **Step 1: Read the Step D section to find icon_svg processing location**

```bash
grep -n "icon_svg\|Step D\|illustration\|ui_constraints" skills/24-design-system-update/skill.md | head -20
```

Expected: `icon_svg` used in Step D-2, `createNodeFromSvg` call, no illustration_policy guard.

- [ ] **Step 2: Read the Step D-1 section (where component-spec.json is read)**

```bash
grep -n "Step D-1\|component-spec.json\|Read(" skills/24-design-system-update/skill.md | head -10
```

Expected: Step D-1 reads `build/component-spec.json`.

- [ ] **Step 3: Add illustration_policy guard before Step D-2 icon_svg processing**

Find this text in `skills/24-design-system-update/skill.md`:

```
- Step D-2 では variants[] 全件 loop / literal_content の全 key 配置 / icon_svg の createNodeFromSvg 取り込み
```

Replace with:

```
- Step D-2 では variants[] 全件 loop / literal_content の全 key 配置 / icon_svg の createNodeFromSvg 取り込み
  **ただし** `illustration_character` の場合は `icon_svg` の `createNodeFromSvg` をスキップし `figma.createRectangle()` による placeholder 矩形（fills: 透明 / strokes: #888 破線 / dashPattern）を配置、`emoji_casual` の場合は `figma.createText()` + `t.characters = variant.icon_svg`（32px）で絵文字 Text Node を配置する（ComponentSet 自体は作成される）
```

- [ ] **Step 4: Add policy read instruction to the Step D preamble**

Find the section where Step D begins (search for `### Step D`) and add after the Step D heading:

```bash
grep -n "### Step D\|Step D:" skills/24-design-system-update/skill.md | head -5
```

Find this text in `skills/24-design-system-update/skill.md` (line 573):

```
### Step D: ComponentSet 構築

#### D-0. Components 大セクションタイトル + section wrapper + ComponentSet vs Preview Frame の責務分離 (必須)
```

Replace with:

```
### Step D: ComponentSet 構築

**illustration_policy チェック（Step D 開始時に 1 回実行）:**
`artifacts/{app_name}/design-brief.yaml` を Read し、`common.ui_constraints.illustration_policy` を取得する。`pictogram` の場合は通常通り（`createNodeFromSvg` で VECTOR ノードを生成）。`illustration_character` / `emoji_casual` の場合は **`createNodeFromSvg` のみを置換する** — `icon_svg` ブランチ自体は引き続き実行され、`illustration_character` は Rectangle placeholder（透明 fill / #888 破線 stroke）、`emoji_casual` は Text ノード（32px、characters = 絵文字文字）を生成する。

#### D-0. Components 大セクションタイトル + section wrapper + ComponentSet vs Preview Frame の責務分離 (必須)
```

- [ ] **Step 5: Confirm changes**

```bash
grep -n "illustration_policy\|illust-placeholder\|icon_svg.*スキップ" skills/24-design-system-update/skill.md | head -10
```

Expected: at least 2 matches.

- [ ] **Step 6: Commit**

```bash
git add skills/24-design-system-update/skill.md
git commit -m "feat(24): suppress icon_svg createNodeFromSvg for non-pictogram policies (POCTEAMA-166)"
```

---

## Verification Checklist (run after all tasks)

- [ ] `python3 -c "import json; json.load(open('schemas/requirements.schema.json'))"` → OK
- [ ] `grep "illustration_policy" schemas/requirements.schema.json` → shows enum with 3 values
- [ ] `grep "illustration_policy" skills/08-design-brainstorm/refs/design-brief-template.md` → 1 match
- [ ] `grep "7-f\|illustration_policy" skills/01-question/skill.md` → multiple matches
- [ ] `grep "B-06\|illustration_policy_detected" skills/00b-source-analysis/skill.md` → multiple matches
- [ ] `grep "B-06\|illustration_policy" skills/00c-requirements-gen/skill.md` → multiple matches
- [ ] `grep "イラスト方針\|illustration_policy" skills/08-design-brainstorm/skill.md` → multiple matches
- [ ] `grep "illustration_policy\|illust-placeholder" .claude/agents/ayatori-sample-html-builder.md` → multiple matches
- [ ] `grep "ゲート判定\|illustration_policy" skills/17-screen-gen/skill.md` → multiple matches
- [ ] `grep "illustrationPolicy\|illustration_policy" skills/12-design-system/refs/generate-style-guide.md` → multiple matches
- [ ] `grep "illustration_policy\|icon_svg.*スキップ" skills/24-design-system-update/skill.md` → multiple matches
