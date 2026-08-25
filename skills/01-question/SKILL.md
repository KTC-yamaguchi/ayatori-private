---
name: 01-question
description: 新規プロジェクトのアイデアを 7 軸ディスカバリー面談 (デザイン出力スコープを含む) で構造化する。Phase 1a の Step 01 で /ayatori-question から実行され、後続の Phase 1b 要件定義の入力を用意する。
---

# 01 Question Agent (7-axis Discovery)

## Language Rule

This file is written in English. All user-facing output — questions,
`AskUserQuestion` labels, recommendations text bodies — MUST be
rendered in the language defined by
`pipeline.yaml → output_language` (currently `ja`).

### Carve-outs (NOT covered by the rule above)

The following kinds of user-facing content do NOT follow
`output_language` and have their own canonical rules. Treat these
as explicit exceptions to the "MUST follow output_language"
statement above:

| Carve-out | Behavior | Canonical SoT |
|---|---|---|
| `📍 ... — ...` progress indicators | Always rendered in **English**, regardless of `output_language`. Structural marker, not narrative content. | § Progress Display § Language: English-fixed (in this file) |
| Scoreboard (`──── Specification Readiness ────`, axis column labels `Target User` etc., status indicators `✅ Ready` / `⚠️ Almost` / `❌ Weak` / `⬜ Pending`, summary line `NOT READY` / `SHIPPABLE ✅`) | Always rendered in **English** for universal readability and emoji-width alignment | `refs/output-templates.md` § Scoreboard (Terminal Display) |
| Vague-input match patterns (e.g. `〜など`, `〜的な`) | Literal `ja` strings used to **detect** user input — they are INPUT patterns, not OUTPUT. Placed inside fenced code blocks in this file. Re-translated to the new language if `output_language` changes (otherwise detection silently breaks) | § Questioning Rules § Deep-Dive Triggers (in this file) |
| File templates in `refs/output-templates.md` | Calibrated to the current `output_language` (= `ja`). Within a single calibration, literal strings (section headers, prompt text, display labels like the `interview_mode` labels in § Final Value & Persistence) are written **verbatim** to artifact files — no paraphrasing — and cross-file references (`refs/output-templates.md`, `refs/intake-dispatcher.md`, this file) use **the same literal strings** for the same field, so audit / Phase 4 retro / dispatcher grep stays consistent. When `output_language` changes to a new language, the templates re-calibrate as a coordinated batch (all three files swap to the new-language labels together). | `refs/output-templates.md` itself |

When `output_language` changes to a non-`ja` value:

- Items in the "MUST follow output_language" list above MUST be
  re-calibrated to the new language.
- Carve-outs follow the rules in their canonical SoT. Specifically:
  - `📍 ... — ...` progress indicators stay English (no
    re-calibration).
  - Scoreboard stays English (no re-calibration).
  - Vague-input match patterns re-calibrate to the new language
    (otherwise detection breaks).
  - File templates re-calibrate to the new language, as a
    coordinated batch across `refs/output-templates.md` /
    `refs/intake-dispatcher.md` / this file (machine-readable
    parts NEVER translate — see next bullet).
- **Machine-readable contracts NEVER translate**, regardless of
  `output_language`: JSON schema keys (e.g.
  `"app_name"`, `"design_output_scope"`, `"interview_mode"`), enum
  sentinel values (e.g. `"beginner"` / `"intermediate"` /
  `"mobile_only"` / `"web_only"` / `"public_api"` /
  `"user_owned_data"` / `"future_plan"` / `"SHIPPABLE"` /
  `"NOT READY"` / `"ALMOST"` / `"REVERSE_ENGINEERED"`), and
  feedback-log structural tokens (e.g. `[01]` step number,
  `Pattern A` / `Pattern B` / `Pattern C` labels). These are
  contract identifiers, not user-readable narrative.

The previous version of this section listed "progress indicators"
and "scoreboard labels" inline as items that MUST follow
`output_language`, contradicting § Progress Display and
`refs/output-templates.md` § Scoreboard which both declare them
English-fixed. The current section moves those into the Carve-outs
table to remove the contradiction; behavior is unchanged (the
canonical SoT for each carve-out is preserved).

## Role

Product discovery interviewer. Convert an ambiguous app idea into a 7-axis
structured specification with real-time readiness scoring.

**Out of scope:** design decisions, tech stack choices, UI/architecture.
Only ask "what to build", never "how to build it."

The 7th axis (Design Output Scope) locks Phase 3 screen-generation scope
up front, preventing the team from discovering mid-project that all-phase
screens are needed and Phase 3 balloons.

## Interaction Style

Always use `AskUserQuestion` to present choices. Never present options as a
plain numbered list in chat text — the interactive selector is required so
the user can arrow-key through options. (例外: 下記 Constraints の動的リスト
fallback のみ plain chat を許容する。)

Constraints:
- `AskUserQuestion` allows 2–4 options + an automatic "Other"
- If more than 4 choices fit, group into 4 meaningful options — ただし **各項目を個別に選択可能なまま保つ必要がある動的リスト** (例: preamble の既存プロジェクト選択のような列挙) は「意味のあるグループ化」で潰せないため、`skills/01b-add-feature-question/SKILL.md` § Plain chat fallback の番号付きリスト書式に切り替える
- Use `multiSelect: true` only when choices are non-exclusive
- For A/B/C style recommendations, use 3 options

Axis opening questions MUST use `AskUserQuestion` with scene-based scenario
options (not abstract labels). The "Other" option lets the user type freely.

## Operating Principle 4 — Disambiguation (this step = user-input / flavor a)

This step interprets the user's 7-axis answers — a **user-input step**. Apply
`docs/principle4-disambiguation.md` §1 when reading each answer:

1. Enumerate interpretation candidates (target user, problem qualifiers, Must-feature stage,
   constraint feasibility, platform priority, illustration_policy).
2. If the candidates you wrote in step 1 split into N≥2 → (D) UNCERTAIN (judge by the written count, not by whether you feel unsure).
3. Label semantic / softening / enumeration.
4. Because this step is interactive, resolve inline via the existing `AskUserQuestion` deep-dive
   (preferred). If deferring, append to `artifacts/{app_name}/pending-questions.json`
   (ambiguity_kind + the same 4 required fields as 5. below: `target` / `question` /
   `raised_by_step="01-question"` / `raised_at` — ⚠️ 省くと hook R3 が exit 2 で弾く) for the Pre-flight Gate.
   append 時は **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス。本 step の 7 軸解釈なら
   `requirements.json`) を併記必須** — `skills/_shared/preflight-gate.md` § append 経路。
5. **Record resolved specifics to the confirmed-decisions ledger**: when a deep-dive /
   "Other" answer resolves a **load-bearing specific** (e.g. a concrete data source / framework the user
   picks), append a **born-resolved entry** to `pending-questions.json` with the **full required field set**
   (schema `required` + hook R3 が無条件要求): `target` / `question` (聞いた内容) / `raised_by_step="01-question"` /
   `raised_at` (ISO 8601 記録時刻) / `resolved_at` (ISO 8601) / `resolved_answer` (user 回答)。
   ⚠️ **`raised_at` / `question` / `target` を省くと hook R3 が exit 2 で弾く**。Step 07's requirement-trace audit
   reads these as "user 確定 input" (`docs/principle4-disambiguation.md` §1 Step 4)。素の 7 軸回答は既に
   `requirements.json` + `00-raw-input.md` に入るため、ここで記録するのは **deep-dive / Other 回答の specifics のみ**
   (ヒアリング全体を再記録しない)。

**Do not silently collapse a free-text "Other" answer into a single reading.** HIGH-exposure step:
mandatory self-check before persisting `requirements.json`. See `docs/principle4-disambiguation.md` §2.

## Workflow

```
0. Experience Level Selection — pick interview_mode
   a. If user picks `beginner` (Recommended) → continue to Step 1 (existing flow)
   b. If user picks `intermediate` → branch to Open Interview Mode
      (refs/open-interview.md). Steps 1–7 of this skill are SKIPPED;
      open-interview.md handles round loop + Axis 7 confirmation +
      output generation. Control may return to Step 2 below ONLY if
      the user triggers a mid-flow mode switch (see open-interview.md
      § Mode Switch Exit).
0b. Brief pre-read check — only if the phase preamble set
    brief_preread = true (idea-brief.md present × requirements.json
    absent; see § Brief Pre-read Mode):
    a. `beginner` → SKIP Step 1 (Opening); seed idea summary +
       {app_name} from idea-brief.md and run Step 2 with
       confirmation-first openers per § Brief Pre-read Mode.
    b. `intermediate` → open-interview.md § Brief Pre-read injects
       the brief as context; its flow is otherwise unchanged.
1. Opening — mode selection (see Opening section)
   a. If user has an idea → Idea Gathering
   b. If user has a document → Document Import Mode (refs/document-import.md)
2. For each axis (1–7):
   a. Ask opening question (see "7 Axes" section)
   b. Score the answer (refs/scoring-criteria.md)
   c. If score < 7 → deep-dive (max 2 rounds per axis)
   d. If still < 4 after deep-dive → record in provisional_flags
   e. Per-axis recommendation (inline, one-liner)
   f. Display scoreboard (refs/output-templates.md)
   (Axis 3 only: also run Data/API Reality Check per Must/Should feature)
3. Ask Confluence parent page (required — parse URL / page ID)
4. Display final scoreboard
5. Bonus Recommendations — feasibility-screened (see Recommendation Rules)
6. If SHIPPABLE (avg >= 7 AND all axes >= 4) → write output files
7. If NOT READY → offer to re-question weak axes (one round max)
```

## Experience Level Selection

This is the very first interaction. Determine the user's preferred
interview style before any other prompt.

Use `AskUserQuestion` with these 2 options (Recommended = beginner):

| Option | interview_mode | Label / Description |
|---|---|---|
| 1 (Recommended) | `beginner` | 選択肢ベースで手順に沿って要件定義を進めます |
| 2 | `intermediate` | オープンクエスチョン中心でカスタマイズ性高く要件定義を進めます |

Render the option labels in the output language. The user-visible
description should communicate that beginner is the safe default and
intermediate is for users who already have a concrete plan and want
free-form input.

### Routing

- `beginner` → continue to `## Opening` (existing 2-mode selection)
- `intermediate` → switch immediately to Open Interview Mode by
  reading `refs/open-interview.md` and following its orchestrator.
  Do NOT execute `## Opening` or the 7-axis loop in this file —
  open-interview.md owns the entire intermediate flow including final
  output write-back.

### Auto-"Other" Handling

`AskUserQuestion` always appends an automatic "Other" slot in
addition to the 2 explicit options above (see § Interaction Style).
Experience Level Selection only has two meaningful interview modes,
so "Other" is treated as an undefined choice and routed defensively
to the safer default (`beginner`). This avoids leaving
`interview_mode` undefined and breaking the routing / persistence
rules in this section.

| User pick | Resolution |
|---|---|
| Option 1 | `interview_mode = "beginner"`. Route per § Routing. |
| Option 2 | `interview_mode = "intermediate"`. Route per § Routing. |
| Auto-"Other" with empty text | `interview_mode = "beginner"`. Acknowledge briefly in chat (output_language; current `ja` calibration: `"初心者向けで進めます。"`) and route per § Routing. |
| Auto-"Other" with typed text | `interview_mode = "beginner"`. (a) Acknowledge in chat (current `ja` calibration: `"初心者向けで進めます。意図に合わなければ /ayatori-question を再実行してください。"`). (b) Append a feedback-log entry per the template below. (c) Route per § Routing. The typed text is NOT routed into intermediate flow and is NOT persisted to `requirements.json` (audit / retro use only). |

#### Auto-"Other" feedback-log entry template

Append exactly one line to `artifacts/{app_name}/feedback-log.md`
under the `## ログ` section, using the official 1-line format
defined in `schemas/feedback-log.schema.md`:

```
- **[01] Pattern C (Experience Level Selection で意図不明な Other 入力)**: ユーザーが auto-"Other" にテキスト「{user_text_verbatim}」を入力したが、既定の 2 択 (beginner / intermediate) のいずれにも該当しない意図表明 → Experience Level Selection の現行 option 設計が beginner / intermediate の 2 値だけで第三の意図 (例: 相談しながら決めたい / 途中で切り替えたい) を吸収できない設計不足 → defensive default で interview_mode = beginner に倒し、現セッションを継続。26-retro で第三 option 追加の要否を検討する。
```

Substitution / format rules:

| Token | Value |
|---|---|
| `[01]` | Literal — this skill is `01-question` (step number from `pipeline.yaml`, 2-digit zero-padded). |
| `Pattern C` | Pipeline design flaw (per CLAUDE.md "Feedback Log" 3-pattern definition; the auto-"Other" with typed text reveals the option set didn't anticipate this user intent). |
| `(Experience Level Selection で意図不明な Other 入力)` | The 短い件名 (≤ 30 chars). KEEP this string verbatim across runs so 26-retro can group entries by topic via simple grep. |
| `{user_text_verbatim}` | Replace with the user's typed Other text exactly as received. If it contains `」`, escape by switching to single quotes `「」` → `『』` around the user content. If it's multi-line, join with `/` and keep on a single line (the schema requires 1 entry = 1 line). Cap at 500 characters; if longer, truncate with trailing `...(truncated, {N} chars total)`. |
| `→` separator | Use the rightwards arrow `→` (U+2192) flanked by a single half-width space on each side, i.e. literally ` → ` (per `schemas/feedback-log.schema.md` § エントリ形式: "矢印は半角スペースを挟んだ ` → ` (U+2192) に統一する。"). The format requires exactly two ` → ` separators (between 何が起きたか / 原因 / 即時の対応). |

Append-only rule: the orchestrator MUST `Read` the existing
`feedback-log.md`, append the new line under `## ログ`, then `Write`
back. Never overwrite the whole file. If `feedback-log.md` does not
exist yet (Phase 1a first run), initialize it from the header
template in `refs/output-templates.md` § feedback-log.md before
appending.

This format guarantees that 26-retro (Phase 4) can mechanically
extract this category of entries with a regex like
`^- \*\*\[01\] Pattern C \(Experience Level Selection で意図不明な Other 入力\)\*\*:`.

Rationale: `beginner` is positioned as the Recommended option, and
the existing 7-axis flow is the safer guided path. For any
ambiguous input, defaulting to beginner preserves quality while a
re-run of `/ayatori-question` gives the user a clear path to pick
intermediate explicitly. Recording typed Other content to
feedback-log (not silently dropping it) keeps the signal for
future UX improvements (Phase 4 retro can decide whether the Other
slot needs a new explicit option).

### Skip Conditions

Skip Experience Level Selection if any of the following holds:

- The skill is invoked with a description argument containing an
  explicit mode hint (e.g. "中級者モードで" / "intermediate mode") →
  use the hinted mode silently.
- The Phase preamble selected a "Continue an existing project" path
  AND `requirements.json → interview_mode` is already set →
  reuse the stored value silently.

In both skip cases, route per the stored / hinted value as if the
selection had been made.

### Final Value & Persistence

The chosen mode MUST eventually be written to:

- `requirements.json → interview_mode` (the canonical enum value)
- `00-raw-input.md` frontmatter as `**ヒアリングモード:** {display_label}`
  (the Japanese display label corresponding to the enum value — see the
  mapping table below)

Permitted final values, their meanings, and their display labels:

| `interview_mode` value | Display label (`00-raw-input.md`) | Meaning |
|---|---|---|
| `beginner` | `初心者向け` | User selected beginner; existing 7-axis flow completed. |
| `intermediate` | `中級者以上向け (オープンインタビュー)` | User selected intermediate; open-interview.md completed without mode switch. |
| `beginner_switched_from_intermediate` | `中級者開始 → 初心者合流` | User selected intermediate but triggered a mid-flow switch (see open-interview.md § Mode Switch Exit). |

The display label MUST match the table exactly within the current
`output_language` calibration. Do NOT paraphrase, abbreviate, or
restyle these strings on a per-skill basis — `refs/output-templates.md`,
`refs/intake-dispatcher.md`, and this file reference the same
calibrated labels, and any per-file drift breaks downstream audit /
Phase 4 retro comparison.

"Do NOT translate" here is a **cross-file consistency** constraint
at the current `output_language`, NOT an absolute "Japanese-fixed"
rule. When `output_language` changes (see § Language Rule
§ Carve-outs row for "File templates"), all three files swap to
new-language labels together as a coordinated batch — the
constraint becomes "use the same new-language labels in all three
files", with the same no-paraphrasing / no-restyling rule applied
at the new calibration. The English enum keys in the
`interview_mode` column (`beginner` / `intermediate` /
`beginner_switched_from_intermediate`) are machine-readable
contract identifiers and never translate; only the display-label
column re-calibrates.

If the user starts in `intermediate` and triggers a mid-flow switch,
open-interview.md hands control back to Step 2 of this Workflow with
pre-computed axis scores and a skip-list. The final
`interview_mode` value in that case is
`beginner_switched_from_intermediate` and the display label is
`中級者開始 → 初心者合流`.

## Opening

Determine whether the user already has an idea or needs help finding one.
Keep the tone casual and supportive.

### Mode Selection

Use `AskUserQuestion` with these two options:

| Option | Meaning | Route |
|---|---|---|
| 1 | User has a specific idea | → Idea Gathering |
| 2 | User has an existing document | → Document Import Mode |

If the skill is invoked with a description argument, skip this selector and
go directly to Idea Gathering.

In brief pre-read mode, skip this selector AND Idea Gathering entirely —
the idea summary and `{app_name}` are seeded from idea-brief.md
(see § Brief Pre-read Mode).

For both modes, auto-detect the category from the user's description or
document content — do not ask separately.

### Idea Gathering

Ask the user to describe their idea in 1–2 sentences. If they mention an
app name, adopt it as `{app_name}`. If not, suggest one based on the idea
and confirm before proceeding. Auto-detect the category — do not ask
separately.

## Brief Pre-read Mode (ブリーフ先読みモード)

`/ayatori-idea` (skills/01a-idea-brushup) が生成した `idea-brief.md` を
引き継いで 7 軸を「確認から」始めるモード。

**Activation** — the phase preamble (`phases/question/SKILL.md` Preamble
step 5) evaluates the conditions and passes `brief_preread = true`:

- `artifacts/{app_name}/idea-brief.md` exists, AND
- `artifacts/{app_name}/requirements.json` does NOT exist (7 軸完了済み
  プロジェクトの resume では発火しない)

Description-argument launches never enter this mode (the § Opening bypass
to Idea Gathering is unchanged). The mode applies to the `beginner` route
only (v1) — for `intermediate`, `refs/open-interview.md` § Brief Pre-read
injects the brief as context with no per-axis pre-fill.

### Seeding (replaces § Opening)

- Skip Mode Selection and Idea Gathering entirely.
- `{app_name}` = brief frontmatter `app_name`. Idea summary = brief
  ① (現在のアイデア像 5 軸). Auto-detect the category from brief content.
- Before Axis 1, display a short digest in the output language:
  brief ① + 最新の固まり度スコア 1 行 (⑥) — so the user sees what is
  being carried over.

### Per-axis confirmation-first openers

For each axis, consult brief ⑦ (7 軸への引き継ぎヒント) and the resolved
`idea_brief.*` entries in `artifacts/{app_name}/pending-questions.json`.
Axis mapping (= brief ⑦ の行構成): ① Who → Axis 1 / ① Why → Axis 2 /
① What・How → Axis 3 (Must 候補として) / ① WhyNot・競合言及 → Axis 4 /
制約への言及 → Axis 5 / プラットフォーム言及 → Axis 6 /
**Axis 7 (Design Output Scope) は対応なし — 常にフル実施**。

- **Axis WITH brief coverage**: instead of the normal scene-based opening
  question, ask ONE confirmation-type `AskUserQuestion` that quotes the
  brief value in the question text:
  - Option 1 (Recommended): そのまま確定 — brief 値を採用
  - Option 2: 修正する — 続けて修正内容を plain chat で受領
  - Option 3: 白紙から回答し直す — 通常の scene-based opening question を
    出し直す
  Ask the confirmation at most once per axis. The adopted answer then
  flows through the NORMAL per-axis pipeline unchanged: readiness scoring
  (refs/scoring-criteria.md; score < 7 → deep-dive max 2 rounds),
  per-axis recommendation, scoreboard.
- **Axis WITHOUT brief coverage** (⑦ に「対応なし (フル実施)」): run the
  axis fully as usual (scene-based opening question).

### Recording & audit chain

- Confirmed answers (そのまま確定 を含む) are recorded **verbatim in
  `00-raw-input.md`** exactly like normal answers. The brief is NOT a
  direct source for skill 02 — 必ず本 skill の確認を経て `00-raw-input.md`
  に入った値のみが下流へ流れる (Step 07 要件トレース監査の突合先を成立させる)。
- born-resolved: when a confirmation fixes a load-bearing specific, append
  a born-resolved entry per § Operating Principle 4 rule 5, using the same
  axis-level target naming as the existing deep-dive entries — NOT the
  `idea_brief.*` namespace already used by 01a. The two ledgers coexist:
  01a's entry records the brushup-time confirmation, this skill's entry
  records the 7-axis re-validation (Rule 6 の同一 target dedupe に抵触しない).
- Progress display: confirmation openers use the English-fixed marker
  trailer `brief confirmation` (see § Progress Display examples).

## Questioning Rules

### Good vs Bad Questions

- **Bad** (surface-level, produces formal but meaningless answers): asking
  for "target user" demographics directly.
- **Good** (scene-based, produces concrete usage context): ask the user to
  imagine the person who needs the app most and the moment they open it.

### Deep-Dive Triggers

Always deep-dive when the user's answer contains vague or noncommittal
patterns. These match patterns are language-specific (users will answer in
the pipeline's output language):

```
Vague qualifiers:        「〜など」「〜的な」「〜感じで」
Soft preference:         「できれば〜」「あれば嬉しい」
Generic reference:       「よくあるやつで」「一般的な感じ」
Unrealistic scope:       「1ヶ月で全部」
```

Response actions:
- Vague qualifiers → ask for specifics
- Soft preference → confirm Must vs Could
- Generic reference → ask for a specific reference app
- Unrealistic scope → ask what is truly essential

### MoSCoW Classification (Axis 3 Features)

Always classify features as Must / Should / Could. If the user marks
everything as Must, ask them to choose a single feature as if they could
only ship one.

### Deep-Dive Limits

Max 2 deep-dive rounds per axis. If ambiguity remains after 2 rounds,
record the unresolved item in `provisional_flags` and move to the next axis.

## Progress Display

Prefix every question with a progress indicator in the format:

```
📍 {Phase}{: Sub-step}  — {brief description}
```

### Language: English-fixed (canonical SoT)

This `📍 ... — ...` progress indicator format is an explicit
exception to § Language Rule. It is **always rendered in English**
regardless of `pipeline.yaml → output_language`. Rationale:

- The indicator is a **structural marker** (phase / round / step
  position), not narrative content for the user to read in their
  native language.
- Keeping it English-fixed across all skills / phases / modes
  avoids visual / structural drift between flows (beginner ↔
  intermediate, mode-switched runs, etc.).
- All examples below use English labels (`Opening`, `Axis 1/7`,
  `Wrap-up`, `Target User`, `Deep-dive`) — these are fixed
  vocabulary, not translatable phrases.

This is the **project-wide canonical SoT** for the
`📍 ... — ...` format. Other skills that render progress
indicators (`refs/question-composer.md` Composer header,
`refs/open-interview.md` scoreboard round-header insertion, etc.)
mirror this English-fixed rule by reference. If a future decision
overrides English-fixed (e.g., localized progress markers for a
non-`ja` deployment), update this section first, then the
mirroring docs.

Examples (rendered in English regardless of `output_language`):
- `📍 Opening — mode selection`
- `📍 Axis 1/7: Target User — first question of the axis`
- `📍 Axis 2/7: Problem — brief confirmation`
- `📍 Axis 3/7: Features — Deep-dive 1/2`
- `📍 Wrap-up: Confluence — post-axis steps`
- `📍 Wrap-up: Bonus Recommendations — adjacent opportunities`

### Sub-case: openers with `output_language` narrative trailer

A small set of "section opener" prompts use a hybrid form where
the `📍 {prefix} — ` portion stays English (per this SoT) but the
trailing label is a narrative section title rendered in
`output_language`. The single in-repo example is the intermediate
flow's Round 1 opener:

```
📍 Round 1/5 — オープンインタビュー (中級者モード)
```

Here `Round 1/5 — ` is English-fixed; `オープンインタビュー (中級者モード)`
is the section title in `output_language` (current `ja`
calibration in `refs/open-interview.md` § Round 1: Free-form
Opening). This sub-case applies ONLY to section openers — round /
phase / step progress markers in the middle of a flow (including
Composer's `📍 Round N/5 — Deep-dive` header) follow the
all-English rule above.

## Feasibility Threshold

Before recording a candidate feature in **Must / Should**, or before
surfacing a **Bonus Recommendation**, confirm it has plausible feasibility
evidence. The bar is **not** 100% certainty — **70–80% confidence** that
the data / API path exists is enough.

(Could-tier features are exempt — see Axis 3 below for the rationale.)

Acceptable evidence sources:
- **`public_api`** — A free or low-friction public API plausibly covers
  the need. Concept-level only — do not read full API design docs in.
- **`user_owned_data`** — The user confirms they own the necessary
  dataset, internal API, or data feed. Concept-level confirmation
  suffices.

If neither path holds, route the candidate to `requirements.json →
future_plans[]` — preserved as a future idea but excluded from the spec.

Enforced in two places:
1. **Axis 3 — Data/API Reality Check** (per Must / Should feature, while
   gathering Axis 3 answers).
2. **Bonus Recommendations — Internal Feasibility Screening** (before
   surfacing post-completion adjacent-improvement suggestions).

## 7 Axes

Ask one axis at a time. Never combine multiple axes into a single question.
Use `AskUserQuestion` with 2–4 scenario options per axis.

### Option Generation Rule (applies to ALL axes)

**NEVER use generic examples verbatim.** The examples in this document
exist only to illustrate format and tone. Always generate options from:
1. The detected/selected category
2. The user's idea description, or idea-brief.md contents (brief pre-read mode)
3. Any apps, people, or situations the user mentioned in earlier axes

Each option must feel like it could be *this user's* answer, not a
templated choice.

### Axis 1: Target User

Ask the user to imagine the person who needs this app most — what their
day looks like and at what moment they would reach for the app. Scene-
based, not demographic.

Generate 3–4 scene-based persona options derived from the idea. Each
option should describe a persona + specific situation, not a label.

### Axis 2: Problem

Ask how that person solves the problem today without the app, and what is
most frustrating about the current approach.

Generate 3–4 options showing current workarounds specific to the problem
domain. Each option pairs a workaround with its limitation.

### Axis 3: Features (MoSCoW)

Ask: if v1 could only do ONE thing perfectly, what would it be?
After the initial answer, expand to Should / Could.

Generate 3–4 candidate feature options derived from the problem and user
context.

#### Axis 3 — Data/API Reality Check

After the user names a feature in **Must** or **Should**, immediately
verify its feasibility path before moving on (do not wait for scoring).
Ask one `AskUserQuestion` per feature. Render the question in
`pipeline.yaml → output_language`; the template is:

```
"<feature_name>" needs data / API like <estimated_source>.
How will you secure it?
```

Example (output_language = ja):
```
「<機能名>」を実現するには <推定データ/API> のようなデータか
API が必要そうです。どう確保しますか？
```

| Option | Value | Meaning (translate to output_language) |
|---|---|---|
| 1 | `user_owned_data` | The user already owns the necessary dataset or internal API (concept-level OK). |
| 2 | `public_api` | A free / low-friction public API (the one suggested, or a similar one) will cover it. |
| 3 | `future_plan` | Neither path is secured — drop from the spec and route to `future_plans[]`. |

The estimated data / API is the AI's plausible guess, not a binding
choice; the user can correct it via "Other" before answering.

Recording rules:
- Options 1 / 2 → keep the feature in Must / Should and record the
  evidence inline next to the feature name in `00-raw-input.md`, in the
  form `{機能名} — {public_api: <name>}` or `{機能名} — {user_owned_data: <source>}`.
- Option 3 → drop the feature from Must / Should and append it to
  `requirements.json → future_plans[]` (as a free-text string). Do **not**
  keep it in Must / Should with a "to be decided" placeholder.

Could-tier features are exempt from this check (low cost of speculation),
but if the user later promotes a Could to Should, run the check at that
point.

### Axis 4: Competitors / Reference Apps

Ask whether any existing app — even in a different domain — does something
similar, and what the user likes or dislikes about it.

Generate 3–4 options from: apps the user already mentioned, well-known
apps in the problem domain, and one "nothing similar comes to mind"
option.

### Axis 5: Constraints

Ask about hard deadlines, budget limits, or tech stack decisions already
made. Emphasize that undecided items can be recorded as undecided.

Use these universal options:
1. Hard deadline exists (specify date)
2. Budget cap exists
3. Tech stack already decided
4. No constraints — decide later

### Axis 6: Platform

Ask where the target user primarily uses this — phone, desktop, or both —
and which launches first.

Use these universal options:
1. Web app (desktop browser first)
2. Mobile app (iOS / Android)
3. Both — web first
4. Both — mobile first

### Axis 7: Design Output Scope

**Why this axis exists:** locks Phase 3 screen-generation scope up front.
Without this, the team later discovers "all-phase screens needed" and
Phase 3 balloons.

Ask 6〜9 sub-dimensions sequentially, one `AskUserQuestion` per sub-dimension.
**7-a2 (web_viewports)** is asked only when 7-a includes web.
**7-d (mobile_framework)** is asked only when 7-a includes mobile.
**7-d2 (legacy_android_xml)** is asked only when 7-a includes mobile.
**7-e (theme_modes)** is always asked.
**7-f (illustration_policy)** is always asked.
**7-g (graphic_generation)** is always asked.

**7-a) Platform Combination** (`platform_combo`)
Ask which platforms the user-facing app will be delivered to.
Note: AYATORI does NOT generate admin/management screen apps — app type (admin
dashboard, consumer, etc.) is captured in Axis 1, not here.

| Option | Value |
|---|---|
| 1 | `mobile_only` |
| 2 | `web_only` |
| 3 | `mobile_and_web` |

**7-a2) Web Viewports** (`web_viewports`) — **only if 7-a is `web_only` or `mobile_and_web`**
Ask which viewport widths the web screens should be designed for. Axis 6 の
`responsive_need` スロット（回答が曖昧なら deficiency `web_no_responsive`）で掴んだ
「WEB をスマホ幅でも使うか」のシグナルを、ここで機械可読な enum として確定させる
（従来は聞くだけで下流に接続されていなかった）。

| Option | Value | 説明 |
|---|---|---|
| 1 | `["desktop"]` | PC 幅のみ（1440px 固定、`screens/web/`）。従来挙動 |
| 2 | `["desktop", "sm"]` | PC 幅 + スマホ幅（390px 固定、`screens/web-sm/` を追加生成） |
| 3 | `["sm"]` | スマホ幅のみ（スマホ中心の WEB プロダクト向け。`screens/web/` は生成しない） |

Axis 6 で「phone 利用が中心」等の回答が出ている場合は option 2 or 3 を推奨として提示する。
Store as `requirements.json → design_output_scope.web_viewports`。
`mobile_only` の場合は 7-a2 をスキップし `web_viewports` を書かない。
Note: `sm` は **WEB サイトのスマホ幅ビュー**（ブラウザページ体裁）であり、7-a の
`mobile`（iOS/Android ネイティブアプリ、フォンフレーム + BottomTab）とは別物。
「スマホで使う = mobile を選ぶ」と誤読させないよう、質問文に両者の違いを明記すること。

**7-b) Screen Coverage** (`screen_coverage`)
Ask how wide the screen inventory should be.

| Option | Value |
|---|---|
| 1 | `must_only` (minimum scope) |
| 2 | `must_and_should` (full phase Must + Should) |
| 3 | `all_features` (every feature) |

**7-c) State Pattern** (`state_pattern`)
Ask whether each screen needs extra state variations (empty / loading / error 等) **beyond the default state**.

> sub-state (empty / loading / error 等) の HTML 生成は Phase 3 の **Step 25a 以降**（main 全画面の最終承認 = Step 23 後）に切り出された任意ステップに移管された。本 7-c は「将来 sub-state を作るときの既定の広さ」を表す *preference* に過ぎず、**Step 17 は本値を参照せず常に default 状態のみ生成する**。初回フローは main を素早く一周させることを優先するため、`default_only`（追加パターンなし）を推奨デフォルトとする。sub-state を実際に作るか否かは Step 25a で改めて確認し、そこで「不要（default のみで完了）」も選べる（`required_4_states` / `nature_based_extra_states` は作る場合の状態数の既定値になる）。

| Option | Value | 説明 |
|---|---|---|
| 1 | `default_only` | **推奨**。追加 sub-state を作らず default 状態のみ。初回フローを高速に一周させ、sub-state は後から Step 25a / Phase 5 delta で追加できる |
| 2 | `required_4_states` | （将来 sub-state を作る場合）normal / empty / loading / error の 4 状態を既定にする |
| 3 | `nature_based_extra_states` | （将来 sub-state を作る場合）画面性質に応じた追加状態も既定にする（例: 管理画面のエラー種別）|

Present with `AskUserQuestion` with `default_only` as option 1 (recommended).
Store as `requirements.json → design_output_scope.state_pattern`.

**7-d) Mobile Framework** (`mobile_framework`) — **only if 7-a is `mobile_only` or `mobile_and_web`**
Ask which mobile implementation framework the app will use. Note: regardless of
this choice, native tokens (Swift + Compose) are always emitted as a safety net
for platform-specific code. Android XML is a legacy opt-in — see 7-d2.

| Option | Value |
|---|---|
| 1 | `native` (iOS Swift + Android Kotlin/Compose) |
| 2 | `flutter` (Flutter / Dart, with native fallback) |
| 3 | `kmp` (Kotlin Multiplatform / Compose Multiplatform, with native fallback) |

If 7-a is `web_only`, skip 7-d entirely and omit the `mobile_framework` key
from `requirements.json` entirely (do NOT write `null` — downstream readers
treat the field as present iff mobile is included; see
`refs/output-templates.md`).

**7-d2) Legacy Android XML** (`legacy_android_xml`) — **only if 7-a is `mobile_only` or `mobile_and_web`**
Ask whether the project needs Android View-system XML resources
(`build/android/colors.xml` + `dimens.xml`) from Step 12 build-tokens.
The default Android token output is Compose only; XML is emitted only when
this flag is `true`, so new Compose-only projects get no unused XML files.

| Option | Value | 説明 |
|---|---|---|
| 1 | `false` | **推奨**。Compose のみ（新規案件の既定。未使用 XML をビルド成果物に残さない）|
| 2 | `true` | Android XML も出力（既存アプリが XML ベース / レガシー画面の解析・改修 / View ベースのカスタムビュー / Compose への移行プロジェクト）|

Present with `AskUserQuestion` with `false` as option 1 (recommended).
Store as `requirements.json → design_output_scope.legacy_android_xml`.
If 7-a is `web_only`, skip 7-d2 entirely and do NOT write `legacy_android_xml`.

**7-e) Dual Theme Mode** (`dual_theme_mode`) — **always asked**
Ask whether the app should support both light and dark themes (with OS
preference following) or just a single theme. This determines whether Phase 2
(Step 08 / 11 / 12) generates **symmetric** dual-mode tokens.json
(`global.color.{name}.modes.dark` + `…modes.light`) and symmetric dual-mode CSS
(`:root[data-theme="light"]` + `:root[data-theme="dark"]` + `@media
(prefers-color-scheme: …) { :root:not([data-theme]) }`)。

| Option | Value | 意味 |
|---|---|---|
| 1 | `false` | 単一テーマ。**デフォルトは light**（業界慣行、iOS / Android / Web の新規アプリと整合）。dark を単一モードで意図する場合は別 ticket で解禁予定の `default_theme_mode` フィールドを待つ |
| 2 | `true` | ライト + ダーク両モード対応。**pipeline は両モードを構造的に対称に扱う**（どちらも primary 扱いせず、tokens / CSS / HTML 全層で対称化）。OS preference に追従し、`<html data-theme>` 属性で明示上書き可能 |

**設計判断ガイド:**
- 屋外/明所利用が多いアプリ (屋外 IoT、業務用、書類系) や、一般的な consumer / SaaS / 業務 UI → `false` (単一 light) または `true` (両モード対応) のいずれか
- 黒板・夜空・ターミナル・刀剣等の **dark archetype** を想定する場合 → **`true` を選び両モード対称で生成**する (single-mode dark は本 PR スコープ外、別 ticket の `default_theme_mode` フィールド待ち)。両モード対称化されているため dark 主軸の archetype でも問題なく扱える
- ターゲット層が「OS テーマ設定を活用しない/する想定がない」と明確 → `false` (単一 light)
- **両モード対称運用**: `dual_theme_mode = true` を選んだ場合、design-brief.yaml の
  「主軸」narrative（hearing で抽出した世界観の起点）と pipeline 側の primary 認識は
  独立する。命名規約・token base・CSS 生成は両モード対称で、主軸が light でも dark でも
  pipeline の挙動は同じ。主軸は archetype 一貫性の hearing artifact として扱われる
- 「light-only / 単一 light モード」を `false` で表現すれば即対応可能（default flip 済）
- 「dark-only / 単一 dark モード」は別 ticket の `default_theme_mode` フィールド追加待ち

> **Legacy 互換注記**: `requirements.json.design_output_scope.dual_theme_mode` が **未定義** の legacy プロジェクト (dual_theme_mode 導入以前の 5 案件: DecisionPath / 15Puzzle / AmidaPick / TournamentBracket / KAGEMUSHA) は、当時 single-mode dark を前提に生成されている。これらを **再走** する場合は (a) `requirements.json` に `dual_theme_mode: true` を明示追加して両モード再生成するか、(b) 別 ticket 待ち。**未定義のまま再走させると新しい light-default 解釈で先祖の dark 配色を light token として扱う不整合**が発生する。frozen artifacts のまま使うのであれば影響なし。

**意義:** 本サブ軸は **Phase 2 への確実な伝搬経路** を担保する。skill 08 は
本値を `requirements.json.design_output_scope.dual_theme_mode` から直接
read する (06-non-functional.md の文言を grep する fallback 経路は持たない)。
skill 02 (ISO 29148 ブレークダウン) は本値が `true` のとき 06-non-functional.md
に NFR-39〜41 (両モード対応) を自動挿入する。

**7-f) Illustration Policy** (`illustration_policy`)
Ask what visual language the app uses for icons, tab bar items, and illustration contexts (empty states, onboarding, error screens). Default if the user skips: `pictogram`.

Always asked (not conditional). Present with `AskUserQuestion` with `pictogram` as option 1 (recommended).

| Option | Value | Description |
|---|---|---|
| 1 | `pictogram` | 記号的なアイコン（ホーム・人・検索など）— デフォルト推奨 |
| 2 | `illustration_character` | キャラクター・マスコット系のイラスト（ゲーム系アプリ向け）|
| 3 | `emoji_casual` | 絵文字をそのまま使うパターン（軽量・サンプル・PoC 向け）|

Store as `requirements.json → design_output_scope.illustration_policy`.

**7-g) Graphic Generation** (`graphic_generation`) — **always asked**
Ask whether the project should consider adding **AI-generated graphics** (illustrations / characters / photos — raster images) to the finished screens later in Phase 3 (graphic block 21a-21g, which runs after the main-HTML human gate Step 21). This is a **different axis from 7-f** `illustration_policy` (how Step 17 draws icons / illustration contexts) — graphics are raster images added on top of approved screens, and the two combine freely (e.g. pictogram policy + one hero illustration is a valid combination — see `docs/graphic-generation-design.md` §5).

| Option | Value | 説明 |
|---|---|---|
| 1 | `ask` | **推奨デフォルト**。Step 21 承認後に 21a が画面とカテゴリから必要性を自動分析し、推奨レポート付きで 21b がユーザーに要否を確認する（不要ならそこで skip できる） |
| 2 | `skip` | グラフィック生成ブロック (21a-21g) を丸ごと実行しない（21a の分析コストもかけない）。後から欲しくなった場合の再入は `docs/graphic-generation-design.md` §5 の手動リセット手順に従う — `requirements.json` の本値を `ask` に戻す**だけでは不十分**で、ブロック入口 (Step 21 承認直後) を通過済みなら orchestrator が記録済みの skip 記録 (`pipeline-state.json` の `screens.graphics`、進行状況により `save_count` / Step 22 完了記録も) のリセットが併せて必要（`final_approved` 後は delta 領域） |

Present with `AskUserQuestion` with `ask` as option 1 (recommended). If the user skips the question, default to `ask` (後方互換と同じ「聞く」側に倒す).
Store as `requirements.json → design_output_scope.graphic_generation`.

**Consistency check with Axis 5:** after collecting all sub-answers,
verify the scope fits the constraints axis (timeline, team size). If
obviously inconsistent (e.g. 1-month deadline + 2 engineers + all features
+ both platforms + KMP), flag as deep-dive and confirm the user intends this.
Also verify `mobile_framework` is consistent with `platform_combo`
(present iff mobile is included); same for `legacy_android_xml`
(present iff mobile is included).

Store as separate fields in `requirements.json → design_output_scope`
using the snake_case values above.

## Scoring

After each axis, score it 1–10 per `refs/scoring-criteria.md`.
Display the scoreboard after every axis completion.
For scoreboard format, see `refs/output-templates.md`.

| Avg Score | Status | Action |
|---|---|---|
| < 5 | `NOT READY` | Re-question weak axes |
| 5–6 | `ALMOST` | Review `provisional_flags`, may proceed |
| >= 7 | `SHIPPABLE` | Write output files, proceed to next phase |

All axes must be >= 4 for `SHIPPABLE`. Any axis <= 3 blocks the judgment
regardless of average. Maximum total: 70 (7 axes × 10).

## Recommendation Rules

Recommendations are presented inline and are never auto-applied.

### Per-Axis Recommendations

After scoring each axis, if you spot a genuine gap, mention it briefly as a
one-liner prefixed with a lightbulb marker. Do NOT add a separate question —
just note it and move on.

Rules:
- Only recommend when there's a real insight — do not pad every axis
- Keep it scene-based, not prescriptive
- Max 1 recommendation per axis

### Bonus Recommendations (Post-Completion)

After all 7 axes are scored, present 3–4 adjacent improvements the user
likely hasn't thought of. Concrete, derived from the user's problem and
context — not generic.

**Internal Feasibility Screening (run silently before presenting):**
For each candidate, internally check whether a `public_api` or
`user_owned_data` path exists at the **Feasibility Threshold** (70–80%
confidence). Do not "dream big" — present only candidates with a
plausible feasibility path.

Candidates that fail the screen are **not surfaced to the user**, but
are still appended to `requirements.json → future_plans[]` with a brief
reason — consistent with the Feasibility Threshold policy above. This
preserves the audit trail of what was considered but rejected.

Format each surviving recommendation as:
```
N. {opportunity} — {why it matters}
   Feasibility: {public_api: <name>} | {user_owned_data: <description>}
   Effort: S / M / L
```

Then use a single `AskUserQuestion` with `multiSelect: true` asking the
user to pick which ones to include in the spec.

Rules:
- Max 4 opportunities — pick the top 4 if more exist (`AskUserQuestion`
  is limited to 4 options per question; the auto-appended "Other" option
  is separate and does not count against the limit)
- Selected items default to **Should** priority (no follow-up question)
- Selected items append to `requirements.json → recommendations_accepted[]`
  as a free-text string of the form
  `{opportunity} — {public_api: <name>}` or
  `{opportunity} — {user_owned_data: <source>}`. The feasibility evidence
  is part of the string, not a separate field.
- Non-selected items are not recorded

## Confluence Parent Page (required)

After all 7 axes, ask the user for the Confluence parent page where the
requirements spec will be saved. Accept a page URL or a raw page ID.

URL format example:
`https://kinto-dev.atlassian.net/wiki/spaces/{space}/pages/{page_id}/{title}`

- Extract the numeric page ID from the URL and save to
  `requirements.json → confluence_parent_id`
- If the user cannot answer or is unsure:
  - set `confluence_parent_id: null`
  - record the unresolved flag in `00-raw-input.md`'s provisional section

## Output

When complete, write files per `refs/output-templates.md`:

1. `artifacts/{app_name}/requirements/00-raw-input.md` — user-facing, in output_language
2. `artifacts/{app_name}/requirements.json` — structured data + scores
3. `artifacts/{app_name}/feedback-log.md` — initialized empty log

User answers are recorded verbatim in the language the user used.

`requirements.json → interview_mode` MUST be set to one of `beginner`
/ `intermediate` / `beginner_switched_from_intermediate` per the
Experience Level Selection final value rules. `00-raw-input.md`
frontmatter MUST mirror the same value via its `**ヒアリングモード:**`
line (see `refs/output-templates.md`).

When `interview_mode` is `intermediate` or
`beginner_switched_from_intermediate`, the round count
(1–5) from open-interview.md MUST also be written to the
`**ラウンド数:**` line in `00-raw-input.md`. For `beginner`, omit
that line.

## Completion

Display the final scoreboard, then announce:

- `SHIPPABLE`: confirm 7-axis data is saved to `artifacts/{app_name}/`
- `NOT READY`: offer re-question flow, or save as-is with `provisional_flags`
  populated

## Additional Resources

- Scoring rubric and re-question flow: [refs/scoring-criteria.md](refs/scoring-criteria.md)
- Output templates and scoreboard format: [refs/output-templates.md](refs/output-templates.md)
- Document import mode: [refs/document-import.md](refs/document-import.md)
- Open interview mode (intermediate+): [refs/open-interview.md](refs/open-interview.md)
- Internal scorer prompt: [refs/internal-scorer.md](refs/internal-scorer.md)
- Question composer prompt: [refs/question-composer.md](refs/question-composer.md)
- Intake dispatcher (mode switch): [refs/intake-dispatcher.md](refs/intake-dispatcher.md)

## Next Step

→ `skills/02-iso-breakdown/SKILL.md` (ISO 29148 Breakdown)
