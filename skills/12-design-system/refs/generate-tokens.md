# Generate tokens.json

## Overview

Generate a W3C DTCG-compliant tokens.json from design-brief.yaml (色 / typography の SoT)。contrast 実測は `scripts/wcag-contrast.mjs`、色非依存 constraints (touch target 等) は wcag-mapping.json を参照する。
Output format is compatible with Style Dictionary v5 multi-platform builds.
Token structure follows a 3-layer architecture: global (primitive) → semantic → component.

## Input

| File | Required | Content |
|---|---|---|
| `artifacts/{app_name}/design-brief.yaml` | ✅ | Human-approved design direction, colors, typography, UI constraints. Read `cases[selected_sample_id]` (from step ⑧ / ⑩) |
| `artifacts/{app_name}/wcag-mapping.json` | ✅ | 色非依存 constraints のみ (touch_target 44px 等、Step 5 で参照)。**色 hex / contrast ratio / design_decision は持たない** (W1 分離 — 旧記述「Verified color codes / design_decisions」は廃止) |
| `artifacts/{app_name}/wcag-history.json` | ✅ | 検証ゲート: 最新 attempt の **loop 対象 violations** (`pair_kind ∈ {palette, domain_surface}`) が空であること (skill 12 SKILL.md checklist「NFR 由来 pair の整合」と同一条件。warn-only の state_colors は残存可 — Step 21 経路)。**file 不在 or attempts 空 = 未検証** — 「違反なし」と読まず tokens.json 生成を中断し、Step 11 実行を要求する (preamble の resume 分岐は `draft:v1` 限定のため、`final:v1` + wcag-history 不在の legacy / 手動 stub 経路でここに到達し得る。skill 09 Phase 1 の `attempt_count == 0` と同じ扱い、レビュー対応) |
| `scripts/wcag-contrast.mjs` | ✅ | `$description` 用の実測 contrast ratio を決定論計算 (Step 1b。LLM は推算しない) |

## Output

| File | Format |
|---|---|
| `artifacts/{app_name}/tokens.json` | W3C DTCG (`$value` / `$type` / `$description`) — 3-layer structure |

---

## Agent Prompt

When executing this skill, apply the following instructions.

---

**You are a design system engineer with deep expertise in the W3C Design Token Community Group (DTCG) specification.**

Read `design-brief.yaml` (specifically `cases[selected_sample_id]`), then generate tokens.json by following Steps 1–7 in order (`wcag-mapping.json` は constraints 参照時のみ読む)。

The `selected_sample_id` field is set at the top level of `design-brief.yaml` (e.g., `selected_sample_id: "A"`). All case-specific data must be read from `cases[]` filtered by this id.

### Absolute Rules

1. **Human approval from step ⑧/⑩ takes highest priority**: Fonts, colors, and UI styles in `design-brief.yaml.cases[selected_sample_id]` are human-approved. Do NOT change, override, or replace them.
2. **Source compliance**: Every hex value in `global.color` must be traceable to `design-brief.yaml cases[selected_sample_id].palette` (`tokens[]` / `state_colors` / `domain_surfaces[]`). Do NOT derive, calculate, or invent colors (no HSL shifts, no tint/opacity mixing, no "darker variant" generation). If a color is not explicitly written in design-brief.yaml, do not include it. **wcag-mapping.json は色を持たない** (W1 分離 — 旧記述の `colors` object / `criteria[].design_decision` 参照は schema に存在しないため廃止)。focus-ring 色も `palette.tokens[]` の `--color-focus-ring` が SoT (pair 5 で Step ⑪ 検証済)。Colors from `design-brief.yaml` that are not covered by the Step ⑪ verification pair table must be marked "Unverified by ⑨" in `$description`. **明示例外**: `palette.illustration_colors[]` (Step 3f) は human-approved design-brief 由来の装飾専用パレットとして展開してよい — これも「brief に書かれた hex の transcription」であり発明ではない。WCAG 検証対象外のため `$description` に "decorative-only (Escape Hatch)" を必ず付記する。
3. **All $value formats must strictly follow `docs/dtcg-spec-ref.md`**: dimension uses `{"value": 16, "unit": "px"}`, fontFamily uses arrays, fontWeight uses numbers, shadow uses structured objects. CSS strings and bare numbers are non-compliant.
4. **Define shadows as DTCG composite tokens**: Use the exact object format in `docs/dtcg-spec-ref.md`. Do NOT use CSS strings like `"0 1px 3px rgba(...)"` or string offsets like `"0px"`.
5. **3-layer structure is mandatory**: global (primitive) → semantic → component. Flat token structures without a semantic layer are prohibited.
6. **Component tokens must reference semantic tokens via aliases**: `{semantic.interactive.primary-default}` not `{global.color.primary}` directly.

---

### Step 1: Extract Verified Colors

`design-brief.yaml cases[selected_sample_id].palette.tokens[]`（Step 10 で人間承認済みの色 SoT）から `verifiedColors` を構築し、実測 contrast ratio を `scripts/wcag-contrast.mjs` で取得する。

> 旧版の「wcag-mapping.json の `colors` object / `criteria[].design_decision` から色を抽出」は **W1 分離後の schema に存在しないフィールド参照**だったため廃止。wcag-mapping.json は色非依存 constraints のみを保持する。色 hex の SoT は design-brief.yaml、検証結果 (violations) は wcag-history.json。

**1a.** `palette.tokens[]` の各 entry（`name` は CSS 変数形 `--color-*`）を読み、`--color-` prefix を外した名前を key として `verifiedColors` に格納する:
```
verifiedColors = { entry.name の "--color-" 除去形: entry.hex for entry in palette.tokens[] }
# 例: --color-bg → "bg" / --color-on-surface → "on-surface" / --color-focus-ring → "focus-ring"
```
dual-mode 案件は entry の `mode` ごとに分けて保持する（Step 3b-dual で使用）。

**1b.** 実測 contrast ratio の取得（LLM は数値を推算しない）: 選択 case を `{"cases":[ { "palette": <cases[selected_sample_id].palette> } ]}` 形の JSON にして `node scripts/wcag-contrast.mjs` に渡し（skill 11 Phase 5.0 と同じ入力 shape = 各 case は `palette` キーで包む。この wrapper を省くと `evaluateCase` が palette を引けず全 pair skip = 全 ratio N/A に silent degrade する。dual-mode 案件は `--modes dark,light`）、返る各 pair の `{fg_token, bg_token, actual_ratio, pass}` を `contrastResults` として保持する。`$description` には該当 token が参加する pair の `actual_ratio` を転記する。前提: 通常フローでは checklist「NFR 由来 pair の整合」により、この時点で `wcag-history.json` 最新 attempt の **loop 対象 violations** (palette + domain_surface) は空（AA pass 済）。ただし attempt 上限到達 (warning_passthrough) では loop 対象違反が残ったまま到達し得る — その場合も tokens.json は生成し、Step 13 人間ゲートで判断する（11 へ戻さない、interface-contracts.md:739 と同じ扱い）。warn-only の state_colors は常に残存し得るが tokens.json 生成には影響しない（Step 21 で再判断）。

**1c.** Token 名の mapping は機械的（`--color-{name}` → `color.{name}`）。旧版の semantic 読み替え表（`accent` → `color.primary` 等）は廃止 — skill 08 が書き出す CSS 変数名がそのまま token 名になる（例: `color.bg` / `color.on-surface` / `color.primary` / `color.focus-ring`。実プロジェクトの tokens.json と同形）。

**1d.** Identify colors NOT in `palette.tokens[]` but needed for the design.
All of the following must be marked "Unverified by ⑨" in `$description`（マーカー文字列は既存 tokens.json との互換のため歴史的表記 ⑨ のまま固定 — 意味は「Step ⑪ の検証 pair 表に含まれない」）:

*Neutral variants — check `design-brief.yaml cases[selected_sample_id].palette.tokens[]` first:*
- `color.surface-variant` — if not found in `palette.tokens[]`, mark "Unverified by ⑨"
- `color.on-surface-subtle` — if not found in `palette.tokens[]`, mark "Unverified by ⑨"

*Semantic status — check `design-brief.yaml cases[selected_sample_id].palette.tokens[]` for entries with usage mentioning success/error/warning:*
- `color.success` — use exact hex from `palette.tokens[]` if found; otherwise omit
- `color.error` — same
- `color.warning` — same

**Do NOT invent colors** — if a color is not in `cases[selected_sample_id].palette.tokens[]`, omit it. Do not derive bg-tints, hover/active states, or extended palette entries by HSL calculation.

Output of Step 1: `colorMap` — a complete map of token name → { hex, verified, description } + `contrastResults`

---

### Step 2: Extract Typography from Design Brief

Read `design-brief.yaml` and extract `cases[selected_sample_id].typography[]`.

**2a.** Iterate each entry in `typography[]`. Extract:
- `role`: identifies purpose (`display` / `base` / `numeric` / `display_jp`)
- `family`: exact font family name
- `weights`: array of numeric weights

**2b.** Assign fonts to token roles:
- `font-family-display` = entry with `role: "display"`, value from `.family`
- `font-family-base` = entry with `role: "base"`, value from `.family`
- CJK fallback: if an entry with `role: "display_jp"` exists, or if any family name is a CJK font (Noto Sans JP, Noto Serif JP, M PLUS, Zen Kaku Gothic, Shippori Mincho, etc.), append it to both display and base stacks. Append `sans-serif` or `serif` as the generic last fallback.

**2c.** If `typography[]` has no entry with `role: "display"` or `role: "base"`:
- Set both to `["system-ui", "sans-serif"]`
- Add `$description`: "No font specified in design-brief.yaml. Using system default."

**2d.** `font-family-numeric`: use entry with `role: "numeric"`, value from `.family`. If no such entry exists, default to `["DM Mono", "JetBrains Mono", "monospace"]`.

Output of Step 2: `typographyMap` — { display, base, numeric, variant }

---

### Step 3: Generate Global Color Tokens (global.color)

Using `colorMap` from Step 1, build the `global.color` group.

**3a.** For each verified color entry in `colorMap`:
```json
"{name}": {
  "$value": "{hex}",
  "$type": "color",
  "$description": "{usage description}. {contrast ratio if verified}"
}
```

**3b.** For unverified colors (surface-variant, on-surface-subtle, success/error/warning), use the exact hex from `design-brief.yaml cases[selected_sample_id].palette.tokens[]` where found. Do not calculate or invent new values.

**3b-dual. Dual-mode color tokens — symmetric D1-a structure**: 検出ルール (3a / 3b で使った `cases[selected_sample_id].palette.tokens[]` 配列を再走査):

1. **まず SoT を確認する**。`requirements.json.design_output_scope.dual_theme_mode == true` **または** `design-brief.yaml` の `common.themes_required` が `dark` + `light` の両方を要求している場合、この案件は **dual-mode 必須** とみなす。両 SoT が食い違う場合は requirements.json を優先する (Phase 1 出力が SoT、design-brief は派生)。
2. そのうえで、`palette.tokens[]` 配列内に `mode: "dark"` **かつ** `mode: "light"` の両方のエントリが存在するか確認する。
   - **dual-mode 必須の案件**で片側のみ存在する、または theme-aware token の一部に `dark` / `light` の片側欠落がある場合は、single-mode に silent downgrade してはならない。**エラー停止し、Phase 2 step 08-design-brainstorm へ差し戻す**: `palette.tokens[]` に両モードを揃えるよう design-brief.yaml の再生成を促す。エラーメッセージは skill 11 (skills/11-wcag-mapping/SKILL.md L264 "整合性ガード") の `suggested_correction` 文言と用語統一: 「08 で {name}.{mode} hex を補完してください (dual-mode 不完全)」。
   - **dual-mode 非必須の案件**で両方揃わない場合に限り、本ステップ全体を skip して single-mode 互換 (`global.color.{name}.$value` 直書き構造) のままとしてよい。
3. 両方揃っている場合 (dual-mode):
   - **すべての theme-aware カラートークン**を `global.color.{name}.modes.dark.$value` + `global.color.{name}.modes.light.$value` の **対称 nested 構造**で生成する。一方を「primary / unsuffixed」、もう一方を「override」として扱わない (対称化方針)。
   - 各 `name` の hex は `palette.tokens[]` から `(name, mode=="dark")` / `(name, mode=="light")` 複合 key で lookup する。`requirements.json.design_output_scope.dual_theme_mode == true` の案件では、**全 theme-aware token が `modes.dark` + `modes.light` を持つことが必須**。`mode` 未指定エントリ、または token ごとの片側欠落を検出した場合は **警告止まりにせずエラー停止 / 差し戻し**とする (上記 2 と同じハンドリング)。
   - `$description` は両 mode 共通の役割記述を `modes.{dark|light}.$value` の親に置き、各 mode の hex 固有メモは `$description` 末尾に「(dark slot)」/「(light slot)」を付けて補足してよい。

> **Single-mode の解釈**: `palette.tokens[]` の `mode` フィールドが未指定の場合、その entry は **light slot に格納される** (`global.color.{name}.$value` 直書き構造、`themes_required = ["light"]` と整合)。これは **dark default → light default に flip** した結果 (業界慣行に整合)。ただしこの解釈を使ってよいのは **SoT が dual-mode を要求していない案件のみ** (上記 1 で `dual_theme_mode == true` でも `themes_required ⊇ {dark,light}` でもないと判定された案件)。**旧仕様 legacy design-brief.yaml** (5 案件: DecisionPath / 15Puzzle / AmidaPick / TournamentBracket / KAGEMUSHA) は当時 dark 配色を mode 未指定で格納していたため、再走時に新解釈と不整合になる。再走する場合は palette.tokens[] の全 entry に `mode: "dark"` を明示追加 + `requirements.json.design_output_scope.dual_theme_mode` を明示 true 化する必要あり。

```json
// dual-mode の場合の対称構造 (D1-a)
"global": {
  "color": {
    "bg": {
      "modes": {
        "dark":  { "$value": "#1F2C36", "$type": "color", "$description": "全体背景 (dark slot)" },
        "light": { "$value": "#F5F1E6", "$type": "color", "$description": "全体背景 (light slot)" }
      }
    },
    "surface": {
      "modes": {
        "dark":  { "$value": "#283742", "$type": "color", "$description": "カード surface (dark slot)" },
        "light": { "$value": "#ECE7D6", "$type": "color", "$description": "カード surface (light slot)" }
      }
    }
  }
}
```

**3b-dual-alias.** semantic / component 層も dual-mode のとき同じ対称構造で fork する (theme-agnostic な値はそのまま flat):

```json
// theme-aware な alias (color) — 対称 fork
"semantic": {
  "interactive": {
    "primary-default": {
      "modes": {
        "dark":  { "$value": "{global.color.primary.modes.dark}",  "$type": "color", "$description": "メインのインタラクティブ要素 (dark slot)" },
        "light": { "$value": "{global.color.primary.modes.light}", "$type": "color", "$description": "メインのインタラクティブ要素 (light slot)" }
      }
    }
  }
}

// theme-agnostic な値 (dimension / fontFamily / shadow 等) は modes を持たず flat のまま
"component": {
  "button": {
    "border-radius": { "$value": "{global.border-radius.md}", "$type": "dimension" },
    "min-height":    { "$value": "{global.spacing.touch-target}", "$type": "dimension" }
  }
}
```

**3b-dual-rationale.** 対称構造を採用する理由:
- どちらの mode も「primary / default」として優位を持たない。design-brief.yaml の「主軸」narrative はファイル命名・token base のいずれにも影響しない (hearing artifact)
- alias は標準 SD reference resolution で解決される (`{...modes.dark}` / `{...modes.light}` の明示パス)。custom resolver は不要
- 下流 (Step 12 build-tokens) の CSS 出力は `css/variables-symmetric` 形式で、両 mode を `:root[data-theme="..."]` と `@media (prefers-color-scheme: ...) { :root:not([data-theme]) }` の対称 4 ブロック構造で emit する。詳細は build-tokens.md 参照。

**3b-state. State colors (必須)**: `design-brief.yaml cases[selected_sample_id].palette.state_colors` から、各 state (`success`/`error`/`warning`/`info`) について **bg / text / border の 3 役割を全部展開**する。命名規則: `{level}-{role}` (例: `error-bg` / `error-text` / `error-border`)。state プレフィックスは tokens 側では省略する。これは画面 HTML の error banner / info banner / similarity badge 等で必須 (Step 17 が `var(--color-error-bg)` 等を直書きせず参照する前提)。

dual_theme_mode の判定は 3b-dual と共通: `palette.state_colors.{level}.{role}.light` sub-block が 1 件でも存在すれば dual-mode 扱い、それ以外は single-mode 扱い。

- **single-mode** の場合 (legacy / `dual_theme_mode = false`): `global.color.{level}-{role}.$value` 直書きの flat 構造で出力。
- **dual-mode** の場合: 各 state_colors entry を `global.color.{level}-{role}.modes.dark/light.$value` の **対称 nested 構造**で出力 (3b-dual と同じ D1-a)。light hex は `state_colors.{level}.{role}.light.hex`、dark hex は `state_colors.{level}.{role}.hex` (legacy field、未指定なら同 entry の `dark.hex`)。

> **B-2 legacy fallback**: `palette.state_colors` 自体が未定義の **既存プロジェクト** (改修前に生成された design-brief.yaml) に対しては、state_colors 展開全件を **skip** して legacy モードで動作する (skill 12 が落ちないように `optional chaining` でガード)。次回 Phase 2 再実行時に skill 08 で state_colors を補完すれば自動的に有効化される。

```json
// single-mode (flat、現行互換)
"error-bg":     { "$value": "{hex from state_colors.error.bg}",     "$type": "color", "$description": "エラー banner 背景。contrast 4.5:1 以上 on error-text" },
"error-text":   { "$value": "{hex from state_colors.error.text}",   "$type": "color", "$description": "エラーテキスト・アイコン色" },
"error-border": { "$value": "{hex from state_colors.error.border}", "$type": "color", "$description": "エラー banner ボーダー (1.5px 線)" }

// dual-mode (対称 nested)
"error-bg": {
  "modes": {
    "dark":  { "$value": "{state_colors.error.bg.hex}",       "$type": "color", "$description": "エラー banner 背景 (dark slot)" },
    "light": { "$value": "{state_colors.error.bg.light.hex}", "$type": "color", "$description": "エラー banner 背景 (light slot)" }
  }
}
// info / warning / success も同様に 3 役割 × 2 mode で対称展開
```

state_colors が `design-brief.yaml` に未定義の場合は本 step を中断し、Phase 2 (skill 08) に差し戻すこと。hex を発明・推測しない。

**3c. $description rules:**
- If verified (Step ⑪ pair 表に参加): include contrast ratio (e.g., "Background #0F172A contrast 8.24:1 (AA/AAA)") — Step 1b の `contrastResults` から転記する（推算しない）
- If NOT verified: prefix with "Unverified by ⑨: "。ratio は書かない（検証 pair が無い色に推算値を書かない — 後続対応で旧記述「estimated contrast ratio」を廃止）
- For primary: explicitly state allowed/prohibited usage

**3d. Alias tokens:**
- `color.processing` → alias to `color.primary`: `"$value": "{global.color.primary}"`
- `color.focus-ring` = same hex as `color.primary` if `--color-focus-ring` is not present in `palette.tokens[]`（通常は pair 5 の検証対象として存在する）

**3f. Illustration colors — 装飾パレットの展開 (Escape Hatch):**

`design-brief.yaml cases[selected_sample_id].palette.illustration_colors[]` が存在し非空の場合のみ、各 entry を `global.color.illustration-{name}` として展開する (CSS 変数では `--color-illustration-{name}`。skill 17 のイラスト/`_shared/illustrations/` 正典がこれを参照する):

- **single-mode**: `"illustration-{name}": { "$value": "{hex}", "$type": "color", "$description": "{usage}. decorative-only (Escape Hatch) — 文字/状態/操作要素への使用禁止 (WCAG contrast 未検証)" }`
- **dual-mode** (3b-dual と同じ判定): `modes.dark/light` の対称 nested 構造で展開。**entry に light/dark の片側しか無い場合はエラー停止し Phase 2 (skill 08 Phase 3-illust) へ差し戻す** (silent downgrade 禁止 — 3b-dual の dual-mode 不完全ハンドリングと同型)。
- **legacy fallback**: `illustration_colors` 未定義の design-brief (改修前 / 装飾イラスト無し案件) では本 step を skip (state_colors B-2 fallback と同型)。
- semantic / component 層への alias は作らない (装飾色は意味を持たない primitive。semantic 経由の参照を強制すると「装飾の意味づけ」という無意味な層が生まれるため、global 直参照を例外的に許す — `$description` の decorative-only がその宣言)。

> **運用中の増分**: Step 17 で不足した装飾色は Step 24 Step A-2b が人間ゲート経由で本グループに増分追加する (writer = 12 [初回] + 24 [増分・gate 付き])。

---

### Step 4: Generate Non-Color Tokens

Build typography, spacing, border-radius, and shadow groups.
**All values must come from `design-brief.yaml cases[selected_sample_id]`.** The tables below show the token structure and default fallbacks — use them only when the yaml does not specify a value.

**4a. Typography** — using `typographyMap` from Step 2:

| Token | $type | Source (yaml path) | Fallback |
|---|---|---|---|
| `typography.font-family-display` | fontFamily | `cases[selected_sample_id].typography[role=display].family` | `["system-ui", "sans-serif"]` |
| `typography.font-family-base` | fontFamily | `cases[selected_sample_id].typography[role=base].family` | `["system-ui", "sans-serif"]` |
| `typography.font-family-numeric` | fontFamily | `cases[selected_sample_id].typography[role=numeric].family` | `["DM Mono", "JetBrains Mono", "monospace"]` |
| `typography.font-variant-numeric` | *(omit $type)* | `"tabular-nums"` if `common.ui_constraints.numeric_font` is `"monospace-required"` | Omit entirely if not set |
| `typography.font-size-*` | dimension | `cases[selected_sample_id].layout.spacing_scale` で比例サイズを推定、または 08 brief に明示サイズがあれば優先 | Default scale: xs=12, sm=14, base=16, lg=20, xl=24, 2xl=32 |
| `typography.font-weight-*` | fontWeight | `cases[selected_sample_id].typography[role=X].weights[]` から Regular=400相当, Bold=700相当を対応付け | Default: regular=400, medium=500, semibold=600, bold=700 |
| `typography.line-height-*` | number | `cases[selected_sample_id].narrative.component_stylings` に明示があれば使用 | Default: tight=1.25, base=1.5, relaxed=1.75 |

**Important**: Only generate font-size tokens for sizes derivable from the yaml. Do not add 2xl=32px unless it appears in the brief.

**4b. Spacing** — read from `cases[selected_sample_id].layout.spacing_scale[]`. All `$type: "dimension"` with `{value, unit}` object format.

| Token | Source | Fallback |
|---|---|---|
| `spacing.xs` through `spacing.2xl` | `cases[selected_sample_id].layout.spacing_scale[]` (ascending order → xs, sm, md, lg, xl, 2xl) | 8pt grid: xs=4, sm=8, md=16, lg=24, xl=32, 2xl=48 |
| `spacing.touch-target` | wcag-mapping.json WCAG 2.5.8 (always 44px) | `{"value": 44, "unit": "px"}` |

**4c. Border Radius** — check `cases[selected_sample_id].narrative.component_stylings` for explicit border-radius mentions (e.g., "4〜8px + 揺らぎ" or "0〜2px 直角"). If no explicit values are found, use the default scale. All `$type: "dimension"` with `{value, unit}` object format.

| Token | Source | Fallback |
|---|---|---|
| `border-radius.sm` through `border-radius.full` | `cases[selected_sample_id].narrative.component_stylings` の border-radius 記述 | sm=4, md=8, lg=12, xl=16, full=9999 |

**4d. Shadow** — DTCG composite tokens. Follow `docs/dtcg-spec-ref.md` shadow format exactly.
color must be a color object, offsetX/Y/blur/spread must be `{value, unit}` objects. CSS strings are non-compliant.

```json
"shadow": {
  "sm": {
    "$value": {
      "color":   { "colorSpace": "srgb", "components": [0, 0, 0], "alpha": 0.1 },
      "offsetX": { "value": 0, "unit": "px" },
      "offsetY": { "value": 1, "unit": "px" },
      "blur":    { "value": 3, "unit": "px" },
      "spread":  { "value": 0, "unit": "px" }
    },
    "$type": "shadow",
    "$description": "Subtle elevation for cards and list items"
  },
  "md": {
    "$value": {
      "color":   { "colorSpace": "srgb", "components": [0, 0, 0], "alpha": 0.07 },
      "offsetX": { "value": 0, "unit": "px" },
      "offsetY": { "value": 4, "unit": "px" },
      "blur":    { "value": 6, "unit": "px" },
      "spread":  { "value": 0, "unit": "px" }
    },
    "$type": "shadow",
    "$description": "Hovered cards, active dropdowns, modals"
  },
  "lg": {
    "$value": {
      "color":   { "colorSpace": "srgb", "components": [0, 0, 0], "alpha": 0.12 },
      "offsetX": { "value": 0, "unit": "px" },
      "offsetY": { "value": 8, "unit": "px" },
      "blur":    { "value": 24, "unit": "px" },
      "spread":  { "value": 0, "unit": "px" }
    },
    "$type": "shadow",
    "$description": "Modal dialogs, bottom sheets, floating panels"
  }
}
```

> **Shadow alpha values**: Use values from `cases[selected_sample_id].depth` (e.g., `shadow_sm: "0 1px 2px rgba(3,10,30,0.35)"`) if specified — extract alpha from rgba. Otherwise use the defaults above.

---

### Step 5: Generate Semantic Tokens

Build the `semantic` group by referencing `global.color.*` via aliases.
**Do NOT write hex values directly. All values must be `{global.color.*}` references.**
**Only create semantic tokens for global.color tokens that actually exist.**

> **Dual-mode adjustment**: dual_theme_mode のとき、semantic 層の **すべての color alias を `modes.dark` / `modes.light` で対称 fork** する (3b-dual-alias 参照)。alias パスも mode を含める (例: `{global.color.primary.modes.dark}`)。**theme-agnostic な dimension / fontFamily / string / shadow alias は fork しない (flat のまま)**。下記の single-mode 例は legacy / `dual_theme_mode = false` 用テンプレ。

```json
"semantic": {
  "interactive": {
    "primary-default":     { "$value": "{global.color.primary}",           "$type": "color", "$description": "メインのインタラクティブ要素の既定色" },
    "destructive-default": { "$value": "{global.color.error}",             "$type": "color", "$description": "削除・破壊的操作の既定色" },
    "disabled-bg":         { "$value": "{global.color.border}",            "$type": "color", "$description": "無効状態の背景色" },
    "disabled-text":       { "$value": "{global.color.on-surface-subtle}", "$type": "color", "$description": "無効状態のテキスト色" }
  },
  "feedback": {
    // B-1 修正: error/info/warning/success の bg/text/border を全 12 alias で対称化。
    //   旧版は error/info の 6 件 + success-text の 7 件のみで、warning/success の bg/border が
    //   alias 欠落 → component layer から参照すると未定義エラー。
    //   global.color.{level}-{bg,text,border} に対応する semantic.feedback alias を全件展開。
    "error-bg":       { "$value": "{global.color.error-bg}",       "$type": "color", "$description": "エラー banner 背景 (Step 17 / Step 24 で参照)" },
    "error-text":     { "$value": "{global.color.error-text}",     "$type": "color", "$description": "エラーテキスト・アイコン色" },
    "error-border":   { "$value": "{global.color.error-border}",   "$type": "color", "$description": "エラー banner ボーダー" },
    "info-bg":        { "$value": "{global.color.info-bg}",        "$type": "color", "$description": "情報 banner 背景 / similarity badge 背景" },
    "info-text":      { "$value": "{global.color.info-text}",      "$type": "color", "$description": "情報テキスト色" },
    "info-border":    { "$value": "{global.color.info-border}",    "$type": "color", "$description": "情報 banner ボーダー" },
    "warning-bg":     { "$value": "{global.color.warning-bg}",     "$type": "color", "$description": "警告 banner 背景 (B-1 補完)" },
    "warning-text":   { "$value": "{global.color.warning-text}",   "$type": "color", "$description": "警告テキスト・アイコン色" },
    "warning-border": { "$value": "{global.color.warning-border}", "$type": "color", "$description": "警告 banner ボーダー" },
    "success-bg":     { "$value": "{global.color.success-bg}",     "$type": "color", "$description": "成功 banner 背景 (B-1 補完)" },
    "success-text":   { "$value": "{global.color.success-text}",   "$type": "color", "$description": "成功テキスト・アイコン色" },
    "success-border": { "$value": "{global.color.success-border}", "$type": "color", "$description": "成功 banner ボーダー (B-1 補完)" }
    // 補完ルール: design-brief.yaml.palette.state_colors に warning / success が定義されている
    //   場合のみ対応する alias を生成。未定義の場合は global 側に存在しないため alias も生成しない。
  },
  "text": {
    "primary":     { "$value": "{global.color.on-surface}",        "$type": "color", "$description": "最も重要なテキスト（見出し・本文）" },
    "tertiary":    { "$value": "{global.color.on-surface-variant}", "$type": "color", "$description": "補助テキスト（ラベル・キャプション）" },
    "placeholder": { "$value": "{global.color.on-surface-subtle}", "$type": "color", "$description": "プレースホルダー・ヒントテキスト・無効テキスト" },
    "on-primary":  { "$value": "{global.color.on-primary}",        "$type": "color", "$description": "メインカラー背景上のテキスト（白）" },
    "link":        { "$value": "{global.color.primary}",           "$type": "color", "$description": "リンクテキスト色" }
  },
  "icon": {
    // アイコン色ロール語彙。アイコンは currentColor で親の color: を継承するため、
    // 親要素にどの token を与えるかの「推奨ボキャブラリ」を定義する (skill 17 の生成ガイド +
    // color-lint-report の icon_color_variance を人間が判断する際の共通語彙)。
    // 対応する global token が存在するロールのみ生成する (発明しない)。
    // ⚠ ロール名は固定語彙 {default, muted, on-primary, active} のみ — design-brief palette の
    // token 名 (accent / accent_text 等) を icon ロール名に流用しない。プロジェクト間で語彙が揺れると
    // 「共通のものさし」の意味が失われる (E2E CleanSnap で active → accent の混同が実発生)。
    // 生成後に下記 Validation Checklist の jq 検証を必ず実行する (目視チェック非依存)。
    "default":    { "$value": "{global.color.on-surface}",         "$type": "color", "$description": "通常のアイコン色 (本文と同格)" },
    "muted":      { "$value": "{global.color.on-surface-variant}", "$type": "color", "$description": "非アクティブ・補助アイコン色" },
    "on-primary": { "$value": "{global.color.on-primary}",         "$type": "color", "$description": "primary 背景上のアイコン色 (FAB / 主ボタン内)" },
    "active":     { "$value": "{global.color.primary}",            "$type": "color", "$description": "アクティブ状態のアイコン色 (選択中タブ等)" }
  }
}
```

---

### Step 6: Generate Component Tokens

Build `component` group. **All values must reference `semantic.*` tokens via aliases.**
Do not reference `global.color.*` directly from component tokens.

> **Dual-mode adjustment**: dual_theme_mode のとき、component 層の **color alias のみ `modes.dark` / `modes.light` で対称 fork** する (3b-dual-alias 参照)。alias パスは mode を含める (例: `{semantic.interactive.primary-default.modes.dark}`)。**dimension (border-radius / padding / min-height) / shadow alias は fork しない (flat のまま、theme-agnostic)**。下記の single-mode 例は legacy / `dual_theme_mode = false` 用テンプレ。

```json
"component": {
  "button": {
    "bg":             { "$value": "{semantic.interactive.primary-default}",    "$type": "color" },
    "text":           { "$value": "{semantic.text.on-primary}",                "$type": "color" },
    "border":         { "$value": "{semantic.interactive.primary-default}",    "$type": "color" },
    "bg-destructive": { "$value": "{semantic.interactive.destructive-default}","$type": "color" },
    "bg-disabled":    { "$value": "{semantic.interactive.disabled-bg}",        "$type": "color" },
    "text-disabled":  { "$value": "{semantic.interactive.disabled-text}",      "$type": "color" },
    "border-radius":  { "$value": "{global.border-radius.md}",                 "$type": "dimension" },
    "min-height":     { "$value": "{global.spacing.touch-target}",             "$type": "dimension" },
    "padding-x":      { "$value": "{global.spacing.md}",                       "$type": "dimension" }
  },
  "input": {
    "bg":             { "$value": "{global.color.surface}",                    "$type": "color" },
    "bg-disabled":    { "$value": "{global.color.surface-variant}",            "$type": "color" },
    "border":         { "$value": "{global.color.border}",                     "$type": "color" },
    "border-focus":   { "$value": "{semantic.interactive.primary-default}",    "$type": "color" },
    "border-error":   { "$value": "{semantic.feedback.error-text}",            "$type": "color" },
    "border-success": { "$value": "{semantic.feedback.success-text}",          "$type": "color" },
    "text":           { "$value": "{semantic.text.primary}",                   "$type": "color" },
    "placeholder":    { "$value": "{semantic.text.placeholder}",               "$type": "color" },
    "border-radius":  { "$value": "{global.border-radius.md}",                 "$type": "dimension" },
    "min-height":     { "$value": "{global.spacing.touch-target}",             "$type": "dimension" },
    "padding-x":      { "$value": "{global.spacing.md}",                       "$type": "dimension" }
  },
  "card": {
    "bg":            { "$value": "{global.color.surface}",    "$type": "color" },
    "border":        { "$value": "{global.color.border}",     "$type": "color" },
    "border-selected":{ "$value": "{semantic.interactive.primary-default}", "$type": "color" },
    "border-radius": { "$value": "{global.border-radius.lg}", "$type": "dimension" },
    "padding":       { "$value": "{global.spacing.md}",       "$type": "dimension" },
    "shadow":        { "$value": "{global.shadow.sm}",        "$type": "shadow" },
    "shadow-hover":  { "$value": "{global.shadow.md}",        "$type": "shadow" }
  },
  "badge": {
    "border-radius": { "$value": "{global.border-radius.full}",      "$type": "dimension" },
    "success-text":  { "$value": "{semantic.feedback.success-text}", "$type": "color" },
    "error-text":    { "$value": "{semantic.feedback.error-text}",   "$type": "color" },
    "info-text":     { "$value": "{semantic.feedback.info-text}",    "$type": "color" }
  },
  "focus-ring": {
    "color":  { "$value": "{global.color.focus-ring}",         "$type": "color" },
    "width":  { "$value": { "value": 2, "unit": "px" },        "$type": "dimension" },
    "offset": { "$value": { "value": 2, "unit": "px" },        "$type": "dimension" }
  }
}
```

---

### Step 7: Assemble and Write

Combine all groups into the final JSON structure and write to `artifacts/{app_name}/tokens.json`:

```json
{
  "global": {
    "color": { /* Step 3 output */ },
    "typography": { /* Step 4a output */ },
    "spacing": { /* Step 4b output */ },
    "border-radius": { /* Step 4c output */ },
    "shadow": { /* Step 4d output */ }
  },
  "semantic": { /* Step 5 output */ },
  "component": { /* Step 6 output */ }
}
```

After writing, run the Verification Checklist below.

---

## Verification Checklist (self-check after generation)

- [ ] Fonts from `design-brief.yaml cases[selected_sample_id].typography[]` are used as-is (not replaced by AI preference)
- [ ] All colors from `design-brief.yaml cases[selected_sample_id].palette.tokens[]` are included
- [ ] Colors unverified by ⑨ are marked with "Unverified by ⑨" in $description
- [ ] All dimension $value are `{"value": N, "unit": "px"}` objects — no CSS strings like `"12px"`
- [ ] All fontFamily $value are arrays — no CSS font-family strings like `"'Inter', sans-serif"`
- [ ] All fontWeight $value are numbers — no string values like `"400"`
- [ ] All shadow $value use DTCG object format: color as `{colorSpace, components, alpha}`, offsets as `{value, unit}`
- [ ] No `$type: "string"` exists anywhere — use `$extensions` or omit `$type` instead
- [ ] **3-layer structure present**: `global` + `semantic` + `component` all exist at the top level
- [ ] **No invented colors**: every token in `global.color` has its hex traceable to `design-brief.yaml cases[selected_sample_id].palette.tokens[]` (例外: `illustration-{name}` は `palette.illustration_colors[]` にトレースできること)
- [ ] **Illustration colors (`palette.illustration_colors[]` 非空のときのみ)**: 全 entry が `global.color.illustration-{name}` として存在し、`$description` に "decorative-only" が付記されている。dual-mode 案件では各 entry が `modes.dark` + `modes.light` の対称構造 (片側欠落はエラー停止 → skill 08 Phase 3-illust へ差し戻し)。未定義の design-brief では `illustration-*` token を一切生成していない (legacy fallback)
- [ ] **semantic.icon ロール語彙**: 対応する global token が存在する範囲で `semantic.icon.{default, muted, on-primary, active}` が alias として存在する (発明しない — 対応 global が無いロールは省略可)。**目視でなく必ず以下を Bash 実行して機械検証する** (E2E CleanSnap で `active`→`accent` の語彙混同が実発生したため。`false` / non-zero exit なら修正してから次へ進む):

  ```bash
  jq -e '((((.semantic.icon) // {}) | keys) - ["default", "muted", "on-primary", "active"]) == []
         and (if .global.color.primary != null then ((.semantic.icon // {}) | has("active")) else true end)' \
    artifacts/{app_name}/tokens.json
  # true = pass。false/exit 1 = 語彙外ロールの発明 (accent 等) または active 欠落 (global.color.primary が存在するのに)
  # `// {}` は semantic.icon グループ自体が無い tokens.json (legacy / minimal) で `keys` が
  # jq エラー (exit 5) になるのを防ぐ fallback — その場合「語彙違反なし・active 欠落」として判定される
  # dual_theme 案件で各ロールの値が modes 構造でも、ロール名の階層 (semantic.icon 直下) は同一のため本式のまま使える
  ```
- [ ] **Dual-mode symmetric structure policy (D1-a)**: `cases[selected_sample_id].palette.tokens[]` に `mode: "light"` エントリが 1 件でも存在する場合のみ全 theme-aware color token を `modes.dark.$value` + `modes.light.$value` の **対称 nested 構造**で出力する。semantic / component の color alias パスも `{...modes.dark}` / `{...modes.light}` で mode 明示する (dimension / fontFamily / shadow alias は theme-agnostic として flat のまま)。存在しない場合は **生成しない** (single-mode 互換、flat `global.color.{name}.$value` 直書き構造)。生成時は `modes.dark` のキー集合と `modes.light` のキー集合が完全一致 (orphan mode 禁止)
- [ ] **Semantic layer complete**: `interactive`, `feedback`, `text` groups all present in `semantic`
- [ ] **Semantic values are aliases only**: No hex values in `semantic.*` — all values are `{global.color.*}` references
- [ ] **Component values reference semantic**: `component.button.bg` = `{semantic.interactive.primary-default}`, NOT `{global.color.primary}`
- [ ] `spacing.touch-target` is `{"value": 44, "unit": "px"}`
- [ ] `typography.font-size-xs` is `{"value": 12, "unit": "px"}` or larger
- [ ] Each accent color's $description states where it CAN and CANNOT be used

## Prohibited

- Color-name-based naming like `blue-500`, `gray-200`
- Adding colors whose hex values do not appear in `design-brief.yaml cases[selected_sample_id].palette.tokens[]` or `palette.illustration_colors[]` (装飾専用) (regardless of "Unverified by ⑨" marking)
- Putting load-bearing colors (text / state / interactive) into the `illustration-*` group — 装飾以外の色を Escape Hatch に紛れ込ませて WCAG 検証を迂回すること (境界ルール)
- Deriving colors by HSL calculation, tint/opacity mixing, or any other computation
- Changing fonts specified in `design-brief.yaml cases[selected_sample_id].typography[]` for any reason (e.g., "too generic")
- Using CSS string for dimension values (e.g., `"12px"` — use `{"value": 12, "unit": "px"}`)
- Using bare numbers for dimensions (e.g., `"12"`)
- Using CSS font-family string for fontFamily (e.g., `"'Inter', sans-serif"` — use `["Inter", "sans-serif"]`)
- Using string values for fontWeight (e.g., `"400"` — use `400`)
- Using CSS string format for shadows (e.g., `"0 1px 3px rgba(...)"`)
- Using string offsets in shadow (e.g., `"0px"` — use `{"value": 0, "unit": "px"}`)
- Using `$type: "string"` — this type does not exist in DTCG
- Writing hex values directly in `semantic.*` tokens — must be `{global.color.*}` aliases
- Writing `{global.color.*}` directly in `component.*` tokens — must go through `semantic.*`
