# Illustration Policy — Design Spec (POCTEAMA-166)

**Goal:** Add an explicit `illustration_policy` decision to the AYATORI pipeline so that every app's icon and illustration style is locked early and propagated consistently through all downstream design and screen-generation steps.

**Architecture:** A new `illustration_policy` field is captured in Phase 1a (`01-question` Axis 7-f) for greenfield apps, or auto-detected in Phase 0b (`00b-source-analysis`) for reverse-engineered apps. The value flows single-directionally: `requirements.json` → `design-brief.yaml` → downstream skills (09, 12, 17, 22/24/25, ayatori-screen-state-builder). Phase 2 (`08-design-brainstorm`) may confirm or override the value before it becomes authoritative.

**Ticket:** POCTEAMA-166

---

## 1. Data Model

### 1.1 `requirements.json.design_output_scope.illustration_policy`

New field added to the existing `design_output_scope` object. Set by `01-question` (greenfield) or `00e-ayatori-format-convert` using 00b's detection result (reverse path).

```json
"design_output_scope": {
  "platform_combo": "mobile_only",
  "screen_coverage": "all_features",
  "state_pattern": "required_4_states",
  "mobile_framework": "native",
  "illustration_policy": "pictogram"
}
```

| Value                    | Meaning                                                  |
|--------------------------|----------------------------------------------------------|
| `pictogram`              | Symbolic line/solid icons (Heroicons, Phosphor etc.)     |
| `illustration_character` | Illustrated characters or mascots (game-style apps)      |
| `emoji_casual`           | Unicode emoji used directly as UI icons                  |

**Default:** `pictogram`

Schema change: `requirements.schema.json` — add `illustration_policy` to `design_output_scope.properties` with the above enum.

### 1.2 `design-brief.yaml.common.ui_constraints.illustration_policy`

Derived from `requirements.json`, potentially overridden by `08-design-brainstorm`. This is the authoritative value for all downstream skills.

```yaml
common:
  ui_constraints:
    emoji_allowed: false
    icon_style: "svg-line-round"
    illustration_policy: "pictogram"   # pictogram | illustration_character | emoji_casual
    icon_stroke_width: "1.5"
    numeric_font: "monospace-required"
    language_policy: "japanese-required"
```

`design-brief-template.md` is updated to include `illustration_policy` in the `ui_constraints` block.

---

## 2. Phase 1a — 01-question: Axis 7-f

A new sub-question `7-f` is added to Axis 7 (Design Output Scope). It is always asked (not conditional). It follows `7-e` (dual_theme_mode, POCTEAMA-121) and precedes the Confluence page question.

**Question prompt:**

```
7-f) Illustration Policy (illustration_policy)
このアプリで使うアイコン・イラストの種類は？

| Option | Value                    | Description                                              |
|--------|--------------------------|----------------------------------------------------------|
| 1      | pictogram                | 記号的なアイコン（ホーム・検索・ユーザーなど）— デフォルト推奨 |
| 2      | illustration_character   | キャラクター・マスコット系のイラスト（ゲーム系アプリ向け）    |
| 3      | emoji_casual             | 絵文字をそのまま使うパターン（軽量・サンプル向け）            |
```

- Presented via `AskUserQuestion` with `pictogram` as option 1 (recommended default)
- Selected value is written to `requirements.json.design_output_scope.illustration_policy`
- Applies to all illustration contexts: tab bar icons, empty states, onboarding, error screens

**Axis 7 consistency check** (existing): after collecting all sub-answers, 01-question verifies scope fits Axis 5 constraints. No additional check needed for `illustration_policy` — it has no scope-size implications.

---

## 3. Phase 0b — Reverse Path: 00b Auto-Detection

`00b-source-analysis` infers `illustration_policy` from the source app's icons and assets using the following signal table:

| Signal in source                                  | Inferred policy           |
|---------------------------------------------------|---------------------------|
| SVG line/solid icons (Heroicons, Phosphor, etc.)  | `pictogram`               |
| Raster image assets (PNG/WebP character images)   | `illustration_character`  |
| Unicode emoji used as UI icons (🏠 🔔 ✅)         | `emoji_casual`            |
| Mixed signals or unclear                          | `pictogram` (safe fallback) |

The inferred value is recorded in the `### B-06 Illustration Style` section of `raw-analysis.md` (already confirmed by user during 00b). It is written to `requirements.json.design_output_scope.illustration_policy` by `00e-ayatori-format-convert` (E1), which is responsible for generating `requirements.json`. `00c-requirements-gen` preserves the B-06 section verbatim in `raw-analysis.md` but does not write `requirements.json` itself. No changes to `00d-comparison`.

The user is shown the inferred value with a confirm-or-override prompt (consistent with how `screen_coverage` is handled in the reverse flow).

---

## 4. Phase 2 — 08-design-brainstorm: Confirm or Override

In Phase 1 (6-axis hearing), Axis 6 currently asks about UI expression constraints (`emoji_allowed`, `icon_style`, numeric policy). This axis is expanded to surface the pre-captured `illustration_policy`.

**Behaviour:**

1. Agent reads `requirements.json.design_output_scope.illustration_policy`
2. Presents the current value as a pre-filled answer:
   ```
   「イラスト方針は『ピクトグラム / アイコン系』に設定されています（01-question より）。
   このデザイン方向性と合っていますか？」
   → AskUserQuestion: そのまま使う / 変更する
   ```
3. If "変更する": show the 3-choice selector (same options as 7-f)
4. If "そのまま使う": value passes through unchanged

**REVERSE_ENGINEERED Mode C fast-path:** same read-and-confirm block runs. The detected value from `00b` is shown for confirmation.

The confirmed/updated value is written to `design-brief.yaml.common.ui_constraints.illustration_policy`. This is the authoritative value for all downstream steps — `requirements.json` is not updated after this point.

---

## 5. Downstream Propagation

All downstream skills read `design-brief.yaml.common.ui_constraints.illustration_policy`.

### 5.1 09-sample-html-gen

Icon rendering in sample HOME screen HTML follows the policy:

| Policy                    | Behaviour                                                                 |
|---------------------------|---------------------------------------------------------------------------|
| `pictogram`               | Current behaviour — inline SVG from Heroicons/Phosphor                   |
| `illustration_character`  | Use `<div class="illust-placeholder" data-scene="…">` blocks instead of SVG icons |
| `emoji_casual`            | Use Unicode emoji directly                                                |

### 5.2 12-design-system

`generate-style-guide.md` already reads `common.ui_constraints` for `icon_style` and `emoji_allowed`. It gains a new `illustrationPolicy` section in the style-guide HTML output:

- Documents the chosen policy with a label and one-line description
- Adds a Do/Don't rule (e.g. "Do: Heroicons outline — Don't: PNG raster icons")
- For `emoji_casual`: marks `emoji_allowed: true` automatically

### 5.3 17-screen-gen

Step 0 (icon batch fetch) is gated by policy:

| Policy                    | Step 0 behaviour                                                          |
|---------------------------|---------------------------------------------------------------------------|
| `pictogram`               | Current behaviour — fetch from Heroicons/Phosphor, save to `icons/`      |
| `illustration_character`  | Skip SVG fetch. Use `<div class="illust-placeholder" data-scene="…">`. Create `icons-manifest.json` stub `{"library": "illustration_character", "icons": []}` so Step 23 validation does not break. |
| `emoji_casual`            | Skip SVG fetch. Use Unicode emoji directly. Create `icons-manifest.json` stub `{"library": "emoji_casual", "icons": []}` (consistent with `illustration_character`; no `icons/` directory created). |

### 5.4 22 / 24 / 25 (Figma export / design-system-update / component-build)

- `illustration_policy` is passed through to Figma component naming
- `illustration_character` replaces `icon_svg` with a Figma Rectangle placeholder in Step 24 D-2 (fills: transparent, strokes: #888 dashed); `emoji_casual` creates a Figma Text Node (32 px, characters = `variant.icon_svg` emoji value). ComponentSet is still created in both cases — SVG import is replaced to prevent Figma registration errors for missing SVGs.
- No other changes to component generation logic

### 5.5 ayatori-screen-state-builder (Step 25b)

Sub-state HTML is derived from the main HTML (`inherit_main` method, POCTEAMA-161). The builder's icon/emoji rules must respect `illustration_policy`:

- Read `icons-manifest.json.library` to detect the active policy (`"illustration_character"` / `"emoji_casual"` / pictogram otherwise)
- `emoji_casual`: SSB-04 emoji prohibition is lifted; Phase 3 WCAG pre-flight skips the "Unicode emoji unused" check
- `illustration_character`: `<div class="illust-placeholder">` blocks are valid content and do not count as SVG violations
- `pictogram` (default): existing SVG-only rules apply unchanged

### 5.6 No changes needed

11-wcag-mapping, 13, 14–16, 18–21, 23, 26 — unaffected.

---

## 6. Schema Changes Summary

| File                                              | Change                                                       |
|---------------------------------------------------|--------------------------------------------------------------|
| `schemas/requirements.schema.json`                | Add `illustration_policy` enum to `design_output_scope`      |
| `skills/08-design-brainstorm/refs/design-brief-template.md` | Add `illustration_policy` to `common.ui_constraints` block  |
| `skills/01-question/skill.md`                     | Add Axis 7-f with 3-option `AskUserQuestion` (7-e is dual_theme_mode from POCTEAMA-121) |
| `skills/00b-source-analysis/skill.md`             | Add signal table + confirm-or-override for `illustration_policy` |
| `skills/00c-requirements-gen/skill.md`            | Preserve B-06 section in raw-analysis.md (does not write requirements.json) |
| `skills/00e-ayatori-format-convert/skill.md`         | Add `illustration_policy` to E1 template, derived from B-06 section in raw-analysis.md |
| `skills/08-design-brainstorm/skill.md`            | Add confirm/override block in Phase 1 Axis 6                 |
| `skills/09-sample-html-gen/skill.md`              | Gate icon rendering on `illustration_policy`                 |
| `skills/12-design-system/refs/generate-style-guide.md` | Add `illustrationPolicy` section to style guide output  |
| `skills/17-screen-gen/skill.md`                   | Gate Step 0 icon fetch on `illustration_policy`              |
| `skills/22-figma-export/skill.md` (if exists)     | Pass policy to component naming; suppress icon sets for non-pictogram |
| `skills/24-design-system-update/skill.md`         | `illustration_character` → Rectangle placeholder; `emoji_casual` → Text Node (32 px emoji); ComponentSet still created |
| `.claude/agents/ayatori-screen-state-builder.md`     | Gate SSB-04 emoji check and Phase 3 WCAG pre-flight on `illustration_policy` from `icons-manifest.json` |
