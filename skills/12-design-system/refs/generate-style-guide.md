# Generate style-guide.md & style-guide-view.html

## Overview

Generate a human-readable design system style guide from tokens.json and design-brief.yaml.
Outputs a Markdown summary and an HTML preview (6 sections: Color / Typography / Spacing / Border Radius / Components / Usage Rules).

## Input

| File | Required | Content |
|---|---|---|
| `artifacts/{app_name}/tokens.json` | ✅ | W3C DTCG design tokens (from step ⑩) |
| `artifacts/{app_name}/design-brief.yaml` | ✅ | App name, concept, UI constraints, expression rules. Read `cases[selected_sample_id]` (from step ⑧ / ⑩) |
| `artifacts/{app_name}/tokens.json` の `$description` | ✅ | 実測 contrast ratio の転記元 (generate-tokens Step 1b が `scripts/wcag-contrast.mjs` で計算・転記済)。**wcag-mapping.json は参照しない** (W1 分離で色 hex / ratio を持たない — 旧記述「Verified contrast ratios」は廃止) |

## Output

| File | Content |
|---|---|
| `artifacts/{app_name}/style-guide.md` | Markdown summary for Confluence (step ⑯) |
| `artifacts/{app_name}/screens/style-guide-view.html` | HTML preview for human review (step ⑪) |

---

## Agent Prompt

When executing this skill, apply the following instructions.

---

**You are a design system engineer generating a visual style guide for human review.**

Read `tokens.json` and `design-brief.yaml` (specifically `cases[selected_sample_id]`), then generate both output files by following Steps 1–6.

The `selected_sample_id` field is set at the top level of `design-brief.yaml` (e.g., `selected_sample_id: "A"`). All case-specific data must be read from `cases[]` filtered by this id.

### Absolute Rules

1. **All CSS variable values must be derived from tokens.json** — never hardcode hex values or pixel values directly in `:root`. Read the token and use its `$value`.
2. **Do not invent colors or tokens** — only use what exists in tokens.json.
3. **Component sample text must reflect the actual app** — read the app name and features from `design-brief.yaml` (`app_name`, `common.hearing`, `cases[selected_sample_id].concept`) and use them in button labels, input placeholders, card content, etc.
4. **Do/Don't rules must come from `design-brief.yaml`** — extract from `cases[selected_sample_id].donts[]` and `common.ui_constraints` (emoji ban, color restrictions, icon style rules, etc.) as-is.
5. **Generate in the project language** — if `common.ui_constraints.language_policy` is `"japanese-required"`, all UI text in the HTML must be in Japanese.

---

### Step 1: Extract Token Values

Read `artifacts/{app_name}/tokens.json` and build a flat value map.

**1a. Colors** — iterate ALL entries in `global.color` from tokens.json. Do not use a hardcoded list. Build colorMap dynamically:

- **single-mode (legacy / `dual_theme_mode = false`)**: 各 token は `$value` を直接持つ flat 構造。
  ```
  colorMap = {}
  for each [name, token] in tokens.global.color:
    colorMap[name] = token.$value  // resolve aliases if needed
  ```
- **dual-mode (D1-a)**: 各 token は `modes.dark.$value` + `modes.light.$value` の対称 nested 構造を持つ。両 mode の hex を別 map に分割して保持する。
  ```
  colorMap = { dark: {}, light: {} }
  for each [name, token] in tokens.global.color:
    if token.modes && token.modes.dark && token.modes.light:
      colorMap.dark[name]  = token.modes.dark.$value
      colorMap.light[name] = token.modes.light.$value
    else:
      // theme-agnostic token (rare); place into both
      colorMap.dark[name] = colorMap.light[name] = token.$value
  ```
- **dual-mode detection**: tokens.json のいずれかの color token に `modes.dark.$value` + `modes.light.$value` が存在すれば dual-mode。それ以外は single-mode。Step 12 build-tokens の 1b-dual と同じ検出ロジック。

**1b. Typography** — from `global.typography`:
- `font-family-display`: array → join as CSS font-family string (e.g., `["Space Grotesk", "sans-serif"]` → `'Space Grotesk', sans-serif`)
- `font-family-base`: same
- `font-family-numeric`: same
- `font-size-*`: `$value.value` + `$value.unit` (e.g., `{"value": 16, "unit": "px"}` → `"16px"`)
- `font-weight-*`: `$value` as-is (number)
- `line-height-*`: `$value` as-is (unitless number)

**1c. Spacing** — from `global.spacing`:
- Each token: `$value.value` + `$value.unit` (e.g., `{"value": 16, "unit": "px"}` → `"16px"`)
- Build `spacingMap`: `{ xs, sm, md, lg, xl, "2xl", "touch-target" }` → px values

**1d. Border Radius** — from `global.border-radius`:
- Same pattern: `$value.value` + `$value.unit`
- Build `radiusMap`: `{ sm, md, lg, xl, full }` → px values

Output of Step 1: `colorMap`, `typographyMap`, `spacingMap`, `radiusMap`

---

### Step 2: Extract App Context from design-brief.yaml

Read `artifacts/{app_name}/design-brief.yaml` and extract the following. All case-specific fields use `cases[selected_sample_id]`.

| Field | yaml path | Example |
|---|---|---|
| `appName` | `app_name` (top-level) | "AI Avatar Video Tool" |
| `concept` | `cases[selected_sample_id].concept` | "計器盤の正確な静謐" |
| `briefDate` | `approved_at` (top-level, set by step ⑩) | "2026-04-08" |
| `generatedAt` | 現在のセッション日付（`currentDate` またはシステム日付） | "2026-04-14" |
| `primaryFunction` | `common.hearing_interpreted[axis=ブランド].sublimated` または `common.hearing.brand_direction` | "飲酒チェックと運行記録の法令対応" |
| `sampleActions` | `cases[selected_sample_id].agent_prompt_guide.additional_rules` や `narrative.agent_prompt_guide` から主要 CTA 動詞を 3–5 個抽出 | ["動画を生成", "キャンセル", "保存", "削除"] |
| `expressionConstraints` | `cases[selected_sample_id].donts[]` + `common.ui_constraints`（emoji_allowed / icon_style 等）。**ただし `illustration_policy == "emoji_casual"` のとき `emoji_allowed` の実効値は `true`** — yaml に `emoji_allowed: false` が残っていても "絵文字使用不可" ルールを `expressionConstraints` に含めない（`illustrationPolicy` セクションとの矛盾を防ぐ） | ["絵文字使用不可", "primary を大面積で使用しない"] |
| `iconStyle` | `common.ui_constraints.icon_style` | `"svg-line-round"` → "線画（アウトラインアイコン）のみ" |
| `illustrationPolicy` | `common.ui_constraints.illustration_policy` | `"pictogram"` → "ピクトグラム / アイコン系" / `"illustration_character"` → "キャラクター・イラスト系" / `"emoji_casual"` → "絵文字 / カジュアル系" **※ `emoji_casual` の場合 `emoji_allowed` を `true` として扱うこと（yaml 値に関わらず）** |
| `doRules` | `cases[selected_sample_id].narrative.agent_prompt_guide` または `agent_prompt_guide.additional_rules` から positive use cases を抽出 | ["CTAボタン背景", "選択状態の枠線"] |
| `dontRules` | `cases[selected_sample_id].donts[]` から primary color の negative use cases を抽出 | ["primary を大面積で使用しない"] |

**If a field is not found:** use reasonable inference from context, or omit that item.

Output of Step 2: `appContext`

---

### Step 3: Extract Contrast Ratios from tokens.json

Read `artifacts/{app_name}/tokens.json` and build `contrastMap` from each color token's `$description`（generate-tokens Step 1b が `scripts/wcag-contrast.mjs` の実測値を転記済）:

```
contrastMap = {
  "primary_on_surface":   global.color.primary の $description 中の ratio,   # 例 "... contrast 3.42:1"
  "text_on_surface":      global.color.on-surface の $description 中の ratio,
  ...
}
```

`$description` に ratio が無い token（"Unverified by ⑨" / "decorative-only"）は "N/A" と書き、未検証である旨を注記する。ratio を自分で推算しない。

> 旧版の「wcag-mapping.json の `colors` object / `criteria[].contrast_ratio` から抽出」は W1 分離後の schema に存在しないフィールド参照だったため廃止。

Output of Step 3: `contrastMap`

---

### Step 4: Generate screens/style-guide-view.html

Build the HTML file. Structure:

```
<!DOCTYPE html>
<html lang="{lang}">
<head>
  <style>
    :root { /* CSS variables from Step 1 */ }
    /* layout styles */
  </style>
</head>
<body>
  <!-- header: appName + concept + briefDate + generatedAt + theme toggle button -->
  <!-- 01 Color Tokens -->
  <!-- 02 Domain Surfaces (only if palette.domain_surfaces[] is non-empty) -->
  <!-- 03 Typography -->
  <!-- 04 Spacing -->
  <!-- 05 Border Radius -->
  <!-- 06 Components -->
  <!-- 07 Usage Rules -->
</body>
</html>
```

#### theme toggle UI (always rendered)

`requirements.json.design_output_scope.dual_theme_mode` の値に関わらず常にヘッダー右上にトグルを描画する (単一モードの場合は disabled 状態 + tooltip)。`prefers-color-scheme` の OS 設定に依存せず、ユーザーが view 内で明示的に dark / light を切り替えて視認確認できるようにする。

```html
<!-- header section -->
<header>
  <div class="meta">
    <h1>{appName} スタイルガイド</h1>
    <p>{concept} · ブリーフ {briefDate} · 生成 {generatedAt}</p>
  </div>
  <div class="theme-toggle" role="group" aria-label="テーマ切替">
    <button data-theme-value="auto" class="active" aria-pressed="true">OS 追従</button>
    <button data-theme-value="light" aria-pressed="false">Light</button>
    <button data-theme-value="dark" aria-pressed="false">Dark</button>
  </div>
</header>
<script>
  (function () {
    const root = document.documentElement;
    const buttons = document.querySelectorAll('.theme-toggle button');
    function apply(mode) {
      if (mode === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', mode);
      buttons.forEach(b => {
        const active = b.dataset.themeValue === mode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      try { localStorage.setItem('sg-theme', mode); } catch (_) {}
    }
    buttons.forEach(b => b.addEventListener('click', () => apply(b.dataset.themeValue)));
    try { const saved = localStorage.getItem('sg-theme'); if (saved) apply(saved); } catch (_) {}
  })();
</script>
```

CSS は D2 5 ブロック構造で生成する (skill 12 build-tokens.md の `css/variables-symmetric` format と同じ):

```css
:root {
  /* mode-agnostic tokens (typography / spacing / radius / shadow) */
}
:root[data-theme="light"] { /* light color tokens */ }
:root[data-theme="dark"]  { /* dark color tokens */ }
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) { /* light color tokens (OS preference fallback) */ }
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* dark color tokens (OS preference fallback) */ }
}
```

どちらの mode も `:root` 単独で primary 扱いしない (対称化方針)。`data-theme` 属性 → OS preference → なし の 3 段階で resolution。

**dual_theme_mode が false (single-mode、新仕様では light default) の場合**: light tokens のみを単独 `:root` に直書きし、`:root[data-theme]` / `@media (prefers-color-scheme)` のブロックは出力しない。トグル 3 ボタンは `disabled` にし、tooltip で「単一モードプロジェクトのため切替不要」と表示する。

**legacy 互換** (`dual_theme_mode` 未定義の旧仕様プロジェクト): 旧来通り単一 dark で生成。再走させる場合の移行手順は skill 01 7-e の Legacy 互換注記参照。

#### :root generation rule

Generate CSS variables dynamically from tokens.json. Do not use a hardcoded list. For each token in `global.*`, derive the CSS variable name using these naming conventions:

| Token group | CSS variable pattern | Example |
|---|---|---|
| `global.color.{name}` | `--color-{name}` | `color.primary` → `--color-primary` |
| `global.typography.font-family-{role}` | `--font-{role}` | `font-family-display` → `--font-display` |
| `global.typography.font-size-{scale}` | `--fs-{scale}` | `font-size-base` → `--fs-base` |
| `global.typography.font-weight-{weight}` | `--fw-{weight}` | `font-weight-bold` → `--fw-bold` |
| `global.typography.line-height-{name}` | `--lh-{name}` | `line-height-base` → `--lh-base` |
| `global.spacing.{name}` | `--sp-{name}` | `spacing.md` → `--sp-md` |
| `global.spacing.touch-target` | `--sp-touch` | (special case) |
| `global.border-radius.{name}` | `--radius-{name}` | `border-radius.md` → `--radius-md` |
| `global.shadow.{name}` | `--shadow-{name}` | `shadow.md` → `--shadow-md` |

> The same alias table is implemented in `skills/12-design-system/refs/build-tokens.md` (`canonicalName`) so that auto-generated CSS variables match the style-guide HTML and screen HTML var(--*) references. Keep both in sync if you change the conventions.

**Only output variables for tokens that exist in tokens.json.** Do not add variables for tokens that are not present.

#### Section 01: Color Tokens

**Color group structure** — classify each token in `global.color` (from tokens.json) into named subgroups using these rules. **Only include tokens that actually exist in tokens.json. Skip any group that has zero matching tokens.**

| Group heading | Classification rule (match token name) |
|---|---|
| `Primary — {brandName} Scale` | contains `primary` or `on-primary` or `processing` |
| `Semantic Colors — フィードバック` (B6-1) | contains `success` or `error` or `warning` or `info` (= state colors の全 bg/text/border 12 トークン) |
| `Neutral Colors — Dark` | contains `on-surface` (but NOT matched by Primary group) |
| `Neutral Colors — Border & Surface` | contains `border` or `surface` or `background` or `focus-ring` (but NOT matched by above groups) |

> **(domain_surface フィルタ)**: tokens.json の `$description` が `[domain_surface]` で始まるトークンは **Section 01 の classification から除外** し、Section 02 (Domain Surfaces) で専用レンダリングする。これは `cases[selected].palette.domain_surfaces[]` が tokens.json に flatten されたものを区別するため。filter ロジックは「`$description.startsWith('[domain_surface]')` なら 01 で skip、02 で render」。

If any tokens remain unclassified, add an `Extended Colors` group for them.

For each subgroup, render an `<h3>` heading (uppercase, letter-spacing) followed by a `.color-grid`.

For each color card:
- Show a color swatch (background = CSS variable)
- Token name
- Hex value + color name if available in `$description`
- WCAG badge if contrast ratio exists in `contrastMap` or `$description`
- Short description from `tokens.json`'s `$description` field

Special cases:
- `on-primary` (#FFFFFF) and `background` (#FFFFFF): add `border: 1px solid var(--color-border)` to swatch so the white is visible
- **state_colors banner sample (B6-1)**: For each state with `{state}-bg` / `{state}-text` / `{state}-border` triplet present (state ∈ {error, info, warning, success}), render a **dedicated banner mock** below the swatch grid:
  - Mock structure: `<div style="background: var(--color-{state}-bg); border: 1.5px solid var(--color-{state}-border); color: var(--color-{state}-text); padding: 12px 16px; border-radius: 8px;">{state} banner sample text</div>`
  - Sample text examples: error="入力にエラーがあります" / info="新着のお知らせがあります" / warning="まもなく期限切れです" / success="保存しました"
  - Show contrast ratio caption beneath (e.g., "text on bg: 7.13:1 ✅ AAA / border on bg: 5.5:1 ✅ AA")

Also show a "Contrast Demo" row below all color groups: 2–3 text-on-background pairs with contrast ratios.

#### Section 02: Domain Surfaces (dual-theme × domain 拡張)

`cases[selected_sample_id].palette.domain_surfaces[]` を design-brief.yaml から Read し、各 surface について専用カードを生成する。`domain_surfaces == []` (空配列) の場合は本 Section 全体を **skip** する (renderしない、見出しも出さない)。代わりに `domain_surfaces_rationale` が記載されている前提で、Section 01 末尾に小さく「Domain Surfaces: 該当なし ({rationale})」と 1 行 caption を表示する。

surface 1 件あたりのカード構造:

```html
<article class="domain-surface-card">
  <header>
    <h3>{surface.name}</h3>
    <p class="role">{surface.role}</p>
    <p class="drivers">主体 token: {driver_tokens.join(', ') or '(なし、空マス)'}</p>
  </header>

  <!-- mode-grid: 両テーマの hex を side-by-side で表示 -->
  <div class="mode-grid">
    {for each mode in surface.modes:}
    <div class="mode-cell">
      <div class="mode-label">{mode.mode} mode</div>
      <div class="surface-swatch" style="background: {mode.hex};">
        <!-- driver_tokens があれば各 driver の駒をオーバーレイ -->
        {for each driver in surface.driver_tokens:}
        <span class="piece" style="background: var(--color-{driver});" title="{driver}"></span>
        {/for}
      </div>
      <div class="hex-label">{mode.hex}</div>
      <div class="contrast-label">{mode.contrast_label or '(契約 pair なし)'}</div>
    </div>
    {/for}
  </div>

  <!-- contrast_pairs テーブル: 必須 pair を一覧 (NFR back-link なし、NFR 対応は skill 19 nfr_coverage で集中管理) -->
  {if surface.contrast_pairs is non-empty:}
  <table class="pairs-table">
    <thead><tr><th>fg</th><th>required</th><th>criterion</th></tr></thead>
    <tbody>
      {for each pair in surface.contrast_pairs:}
      <tr>
        <td>{pair.fg}</td>
        <td>≥ {pair.required_ratio}:1</td>
        <td>{pair.criterion}</td>
      </tr>
      {/for}
    </tbody>
  </table>
  <p class="pairs-note">NFR 対応 (NFR-16/17 等) は scores.json.current.nfr_coverage が一元管理 (本表に back-link なし)</p>
  {/if}
</article>
```

CSS 設計の要点:
- `.surface-swatch`: 幅 200px × 高 120px 程度、border-radius 4px、内側に駒オーバーレイを 24-32px の `<span>` で表示。drivers が空の場合は swatch のみ
- `.piece`: 円形 (`border-radius: 50%`)、size 32px、`background: var(--color-{driver})`
- `.mode-grid`: `display: grid; grid-template-columns: repeat(N, 1fr)` で modes 配列長に応じて自動列分割
- `.pairs-table`: 簡素な table。pass/fail は contrast_label に既に含まれるためここでは不要

これにより、人間レビュアーは Section 02 を見て:
1. 各 surface に対応する両テーマ hex を比較できる
2. driver_tokens がその surface 上で視認できるか目視できる (例: piece-black 円が board-dark-square swatch の上で見える)
3. NFR 由来の必須 pair が wcag-history.json 検証済みかを retrospective に確認できる

#### Section 03: Typography

Show the type scale from xs to 2xl:
- Left column: token name + size + font weight
- Right column: sample text using `appContext.primaryFunction` or app-relevant phrases
  - 2xl/xl: headline (app name, main feature name)
  - lg/base: body text (feature description sentence)
  - sm/xs: caption (date, ID, metadata)

Also show a numeric font demo if `font-family-numeric` exists:
- Sample: number formatting relevant to the app (e.g., "1,234,567 / 00:04:59" for a video tool, "¥12,000 / 件" for a commerce app)

#### Section 04: Spacing

For each token in `spacingMap`:
- Token name + pixel value
- Visual bar (width = px value, color = `--color-primary`)

Also show `touch-target` with a square box demo and WCAG 2.5.8 note.

#### Section 05: Border Radius

For each token in `radiusMap`:
- A square with that border-radius applied
- Token name + pixel value label below

#### Section 06: Components

Generate 4–5 component groups using `appContext.sampleActions` for labels:

**Buttons** (required):
- Primary: first action from sampleActions (e.g., "動画を生成")
- Outline: second action (e.g., "キャンセル")  
- Ghost: back/cancel variant
- Danger: destructive action (last item in sampleActions, or infer from app context)
- All buttons: `min-height: var(--sp-touch)`

**Input Fields** (required):
- Normal state with app-relevant placeholder
- Focus state with `--color-focus-ring` border

**Card** (required):
- Use app-relevant content (e.g., avatar card for avatar app, product card for commerce app)
- Apply `--color-surface`, `--radius-lg`, `--sp-md` padding

**Status Badges** (if app has async operations or status states):
- Derive status types from `cases[selected_sample_id].narrative.agent_prompt_guide` or `common.hearing_interpreted` (processing/success/error states)
- Show dot + label for each state

**Focus Ring** (required, WCAG 2.4.7):
- **Section 05 の独立 component として配置すること** (Slack 指摘 1)。Button の variant ではなく、独立 Component (Step 24 で `figma-state.json.nodes.components.atoms['focus-ring']` に登録される対象)
- Show an element with `outline: 2px solid var(--color-focus-ring)` and offset
- Display contrast ratio

#### Section 07: Usage Rules

Build a 2×2 Do/Don't grid from `appContext`:
- **DO (primary color)**: list `doRules`
- **DON'T (primary color)**: list `dontRules` with a visual "overuse" example (5+ badges using primary)
- **DO (success/error)**: correct usage of status colors
- **DON'T (expression constraints)**: list `expressionConstraints` with visual examples

After the 2×2 grid, append an **Illustration Policy** subsection using `illustrationPolicy`:
- Policy name and one-line description (e.g. "ピクトグラム / アイコン系 — 記号的な線画アイコンのみ使用")
- Do example keyed to the policy:
  - `pictogram`: "Do: Heroicons / Phosphor 系の SVG アウトラインアイコン"
  - `illustration_character`: "Do: キャラクター / マスコットのイラスト画像を空状態・オンボーディングに使用"
  - `emoji_casual`: "Do: Unicode 絵文字をタブバー・アクションアイコンに直接使用"
- Don't example keyed to the policy:
  - `pictogram`: "Don't: PNG ラスター画像をアイコンとして使用 / フォントアイコン"
  - `illustration_character`: "Don't: SVG 幾何学アイコンをキャラクター画面に混在させる"
  - `emoji_casual`: "Don't: SVG アイコンと絵文字を混在させる"

---

### Step 5: Generate style-guide.md

Generate a Markdown summary for Confluence. Sections:

**Color chip prefix (color tables).** Prefix every table cell that displays a `#RRGGBB` color value with its color chip — `{chip} #RRGGBB` (e.g. `🟦 #1D3557`). This applies to the `値` column of the color-token tables, and to any other table cell that shows a `#RRGGBB` value (for example a `→ #RRGGBB` reference target, such as in a component quick-reference table when the style guide includes one). It gives an at-a-glance hue cue in Markdown contexts (Confluence / GitHub / the artifact index) that cannot render CSS color swatches.

Derive `{chip}` from the token's `$value` hex using the shared deterministic mapping in **`skills/_shared/color-chip-mapping.md`** (same hex → same chip). Add a chip only to cells that hold a real `#RRGGBB`; cells with no color (`—`, `N/A`, alias-only rows) get none.

```markdown
# {appName} — スタイルガイド

**コンセプト**: {concept}  
**ブリーフ決定日**: {briefDate}  
**スタイルガイド生成**: {generatedAt}

## カラートークン

> **注記**: "Unverified by ⑨" は Step ⑪ の検証 pair 表に含まれないカラーです（マーカー文字列は既存 tokens.json との互換のため歴史的表記 ⑨ のまま）。

### Primary — {brandName} Scale

| トークン名 | 値 | 用途 | コントラスト比 |
|---|---|---|---|
| global.color.primary | {chip} #{hex} | ... | {ratio} |
...

### Semantic Colors — フィードバック

| トークン名 | 値 | 用途 | コントラスト比 |
|---|---|---|---|
| global.color.success | {chip} #{hex} | ... | {ratio} |
...

### Neutral Colors — Dark

| トークン名 | 値 | 用途 | コントラスト比 |
|---|---|---|---|
| global.color.on-surface | {chip} #{hex} | ... | {ratio} |
...

### Neutral Colors — Border & Surface

| トークン名 | 値 | 用途 | コントラスト比 |
|---|---|---|---|
| global.color.border | {chip} #{hex} | ... | {ratio} |
...

*(If any tokens remain unclassified by the above groups, add an Extended Colors section here.)*

## タイポグラフィ

| トークン名 | サイズ | ウェイト | 用途 |
|---|---|---|---|
...

## スペーシング

| トークン名 | 値 | 用途 |
|---|---|---|
...

## ボーダーラジウス

| トークン名 | 値 |
|---|---|
...

## 表現制約

### DO
- {doRule1}
- {doRule2}

### DON'T
- {dontRule1}
- {dontRule2}
```

---

### Step 6: Write Files

1. Write `artifacts/{app_name}/screens/style-guide-view.html`
2. Write `artifacts/{app_name}/style-guide.md`

---

## Verification Checklist (self-check after generation)

- [ ] `:root` has NO hardcoded hex or px values — all values read from tokens.json
- [ ] All 6 sections are present in style-guide-view.html
- [ ] Component labels use app-relevant text from `design-brief.yaml` `app_name` / `cases[selected_sample_id].concept` (not generic "Button" / "Submit")
- [ ] All buttons have `min-height: var(--sp-touch)`
- [ ] Focus ring section is present with WCAG 2.4.7 reference
- [ ] Color swatches show hex values as badges
- [ ] Contrast ratios are shown for primary and text colors (from tokens.json `$description`)
- [ ] Do/Don't rules are sourced from `cases[selected_sample_id].donts[]` and `common.ui_constraints`
- [ ] `illustrationPolicy` section is present in the style guide HTML (Section 07 Usage Rules), documenting: policy name, description, a Do example, and a Don't example appropriate to the policy
- [ ] style-guide.md contains all color tokens as a table
- [ ] In style-guide.md, every `#RRGGBB` value (color-token tables and any `→ #RRGGBB` reference) is prefixed with its mapped color chip per "Color chip prefix"; cells that hold no color have no chip
- [ ] Language of UI text matches `common.ui_constraints.language_policy`

## Prohibited

- Hardcoding any color hex value in `:root` (must read from tokens.json)
- Adding CSS variables for tokens that do not exist in tokens.json
- Displaying color cards, typography rows, or spacing rows for tokens that do not exist in tokens.json
- Using generic placeholder text ("Lorem ipsum", "Button", "Submit") — use app-relevant text
- Inventing components or patterns not derivable from tokens.json or `design-brief.yaml cases[selected_sample_id]`
- In style-guide.md, omitting the color-chip prefix on a `#RRGGBB` value, or adding a chip to a cell that holds no color (see "Color chip prefix")
- Using emoji in UI text if the **effective** `emoji_allowed` is false — where effective = `common.ui_constraints.emoji_allowed` OR (`common.ui_constraints.illustration_policy == "emoji_casual"`, which implicitly sets emoji_allowed to true regardless of the yaml field value)
- Using font icons (e.g., Font Awesome) — use inline SVG if icons are needed
