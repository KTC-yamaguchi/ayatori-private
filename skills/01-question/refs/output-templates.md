# Output Templates

File templates generated upon question agent completion.

## Directory Structure

```
artifacts/{app_name}/
├── requirements/
│   └── 00-raw-input.md
├── requirements.json
└── feedback-log.md
```

## 00-raw-input.md

Output in Japanese. User-facing deliverable.

```markdown
# 01 ブレスト回答（生入力）

**アプリ名:** {app_name}
**記録日時:** {today}
**ヒアリングモード:** {初心者向け | 中級者以上向け (オープンインタビュー) | 中級者開始 → 初心者合流}
**ラウンド数:** {N}/5  （※ ヒアリングモードが中級者系のときのみ記録、初心者向けでは本行ごと省略）

---

## ターゲットユーザー
{回答をそのまま記録}

## 解決したい課題
{回答をそのまま記録}

## 主要機能（MoSCoW）

### Must（必須）
{must 機能を箇条書き}

### Should（重要）
{should 機能を箇条書き}

### Could（あれば良い）
{could 機能を箇条書き}

## 競合・参考アプリ
{回答をそのまま記録}

## 制約条件
- 開発期間: {period}
- 予算: {budget}
- 技術スタック: {tech_stack}

## 対応プラットフォーム
{回答をそのまま記録}

## デザイン出力範囲
- プラットフォーム組合せ: {platform_combo}
- Web ビューポート幅: {web_viewports または「—（web なし）」}
- 画面カバー範囲: {screen_coverage}
- 状態パターン: {state_pattern}
- イラスト方針: {illustration_policy}
- グラフィック生成方針: {graphic_generation}

## 仮決定事項（provisional_flags）
{未決定の項目があれば箇条書き、なければ「なし」}

## Recommendations
{採用した提案を箇条書き}

## 将来プラン（実現性未確保）
{future_plans があれば箇条書き、なければ「なし」}

## Confluence 保存先
- 親ページID: {confluence_parent_id または「未定」}
```

## requirements.json

```json
{
  "app_name": "{app_name}",
  "created_at": "{today}",
  "interview_mode": "{beginner | intermediate | beginner_switched_from_intermediate}",
  "confluence_parent_id": "{page_id or null}",
  "design_output_scope": {
    "platform_combo": "mobile_only | web_only | mobile_and_web",
    "web_viewports": ["desktop", "sm"],
    "screen_coverage": "must_only | must_and_should | all_features",
    "state_pattern": "default_only | required_4_states | nature_based_extra_states",
    "mobile_framework": "native | flutter | kmp",
    "legacy_android_xml": false,
    "dual_theme_mode": true,
    "illustration_policy": "pictogram | illustration_character | emoji_casual",
    "graphic_generation": "ask | skip"
  },
  "readiness": {
    "overall": 0,
    "status": "NOT READY",
    "axes": {
      "target_user": 0,
      "problem": 0,
      "features": 0,
      "competitors": 0,
      "constraints": 0,
      "platform": 0,
      "design_output_scope": 0
    }
  },
  "provisional_flags": [],
  "recommendations_accepted": [],
  "future_plans": []
}
```

Notes:
- `design_output_scope` values use snake_case tokens listed above for
  downstream pipeline consumption. Human-readable labels live in
  `00-raw-input.md`.
- `mobile_framework` is required iff `platform_combo` includes mobile
  (`mobile_only` or `mobile_and_web`). When `platform_combo` is `web_only`,
  omit `mobile_framework` from the JSON entirely (do NOT write `null`).
- `legacy_android_xml` is written iff `platform_combo`
  includes mobile, from 7-d2. When `platform_combo` is `web_only`, omit it
  entirely. Missing field (legacy artifacts included) is read as `false`
  downstream — Step 12 build-tokens emits Android View-system XML
  (`build/android/colors.xml` + `dimens.xml`) only when this is `true`.
- `web_viewports` is written iff `platform_combo` includes
  web (`web_only` or `mobile_and_web`) — subset of `["desktop", "sm"]`,
  from 7-a2. When `platform_combo` is `mobile_only`, omit it entirely.
  Missing field on legacy artifacts is read as `["desktop"]` downstream.
- `interview_mode` records which Experience Level Selection branch was
  taken (see `SKILL.md` § Experience Level Selection). It serves two
  purposes: (1) audit / Phase 4 retro mode-based quality comparison,
  and (2) SoT for external consumers (e.g. illustration
  policy) that branch on it. The current in-pipeline skills (Phase 1b
  through 4) do NOT branch on this field. Exception:
  `skills/27-change-detect/refs/feature-add-interview.md` (Steps 27/31,
  Phase 5 / Phase 1c) reads it to branch between Beginner / Intermediate
  interview paths. It is otherwise a propagation field,
  not a control-flow field within the pipeline. External consumers,
  however, ARE expected to read it as a branching key. See
  `schemas/requirements.schema.json` `interview_mode` description for
  the canonical definition. Legacy artifacts generated before this field
  was introduced are treated as `beginner`-equivalent.
- `requirements.json` is INPUT-only after this step — do NOT add cross-phase
  state fields (approvals / selections / confluence page IDs). Those belong
  in `pipeline-state.json`, written by later gate / save skills (06 / 07 /
  10 / 13 / 15 / 16 / 21 / 23). See `schemas/requirements.schema.json` for
  the canonical field list.

## feedback-log.md

Output in Japanese.

```markdown
# フィードバックログ

> パイプライン実行中に発生した修正・指摘・設計変更を記録する。
> 26 振り返りエージェントが skills/NN-*/SKILL.md の改善提案を生成する際の唯一のソース。
> CLAUDE.md の実行ルール 6（3パターン）に従い、発生のたびに即追記すること。

## ログ

```

## Scoreboard (Terminal Display)

Display after each axis is completed. English column labels for universal
readability (no box-drawing side borders — horizontal rules only, to avoid
emoji width alignment issues).

### In-Progress (after each axis)

```
──── Specification Readiness ────────────────

  Target User    ████████░░   8/10  ✅ Ready
  Problem        ██████░░░░   6/10  ⚠️ Almost
  Features       ░░░░░░░░░░   -/10  ⬜ Pending
  Competitors    ░░░░░░░░░░   -/10  ⬜ Pending
  Constraints    ░░░░░░░░░░   -/10  ⬜ Pending
  Platform       ░░░░░░░░░░   -/10  ⬜ Pending
  Design Scope   ░░░░░░░░░░   -/10  ⬜ Pending

─────────────────────────────────────────────
  Overall: 14/70 (20%)  avg=2.0  →  NOT READY
```

### Final (after all 7 axes + ceremony)

```
──── Specification Readiness ──── FINAL ─────

  Target User    █████████░   9/10  ✅ Ready
  Problem        ███████░░░   7/10  ✅ Ready
  Features       ███████░░░   7/10  ✅ Ready
  Competitors    ██████░░░░   6/10  ⚠️ Almost
  Constraints    ███████░░░   7/10  ✅ Ready
  Platform       ████████░░   8/10  ✅ Ready
  Design Scope   ███████░░░   7/10  ✅ Ready

─────────────────────────────────────────────
  Overall: 51/70 (73%)  avg=7.3  →  SHIPPABLE ✅
  All axes >= 4, avg >= 7
```

Status indicators:
- `✅ Ready` — Score 7+, proceed to next axis
- `⚠️ Almost` — Score 4–6, one more deep-dive possible
- `❌ Weak` — Score 1–3, deep-dive required
- `⬜ Pending` — Not started

Progress bar: `█` per score point, `░` for remainder (total 10 chars).

Column layout (left-aligned, no right border):
- Axis name: 15 chars padded ("Design Scope" fits in 12 chars)
- Progress bar: 10 chars (█/░)
- Score: right-aligned in 5 chars (e.g. ` 8/10`)
- Status: emoji + label

Maximum total: **70 points** (7 axes × 10).
