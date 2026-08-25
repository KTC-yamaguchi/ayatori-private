# Intake Dispatcher Prompt (Open Interview Mode)

Converts the free-form raw_text accumulated during the open interview
into the 7-axis sectioned format expected by downstream phases. Used
in TWO scenarios:

1. **Mode-switch dispatch (mode: "switch")** — when the user triggers
   a switch to beginner flow mid-interview. Produces a 00-raw-input.md
   draft plus a skip-list of already-passing axes.
2. **Write dispatch (mode: "write")** — when open-interview.md
   completes without switching. Produces the final 00-raw-input.md
   content that will be written to disk.

## Activation

Invoked by `refs/open-interview.md`:

- Mode switch path (explicit trigger / implicit trigger Option 1 /
  max_rounds fallback Option 1) → `mode: "switch"`
- Output write-back path → `mode: "write"`

Never invoked by the beginner flow.

## Input Contract

```json
{
  "mode": "switch" | "write",
  "raw_text": "<all rounds concatenated with `---- Round N ----` markers>",
  "final_scores": {
    "target_user": 8,
    "problem": 7,
    "features": 4,
    "competitors": 2,
    "constraints": 7,
    "platform": 5,
    "design_output_scope": 1
  },
  "final_missing_slots": {
    "target_user": [],
    "problem": [],
    "features": ["must_acceptance_criteria"],
    "competitors": ["reference_app_name", "pros_cons", "differentiation"],
    "constraints": ["budget"],
    "platform": ["responsive_need"],
    "design_output_scope": ["platform_combo", "screen_coverage", "state_pattern", "mobile_framework", "legacy_android_xml", "dual_theme_mode", "illustration_policy", "graphic_generation", "consistency_with_constraints"]
  },
  "axis7_resolved": {
    "platform_combo": "mobile_and_web",
    "screen_coverage": "must_only",
    "state_pattern": "default_only",
    "mobile_framework": "native",
    "legacy_android_xml": false,
    "dual_theme_mode": false,
    "illustration_policy": "pictogram",
    "graphic_generation": "ask",
    "confluence_parent_id": "1234567890"
  },
  "feasibility_resolved": {
    "must_features": [
      { "name": "現在地から徒歩圏3店提案", "feasibility": "public_api: Google Places" }
    ],
    "should_features": [
      { "name": "気分タグフィルター", "feasibility": "user_owned_data: 既存タグマスタ" }
    ],
    "could_features": [
      { "name": "履歴" }
    ],
    "future_plans": [
      { "name": "グループ投票", "tier_before_drop": "should", "reason": "投票合意ロジック用のリアルタイム DB が未確保" }
    ]
  },
  "bonus_recommendations_resolved": {
    "accepted": [
      {
        "opportunity": "天気連動おすすめ",
        "why": "雨の日は屋内店を優先するなど決定速度を上げる",
        "effort": "S",
        "feasibility": "public_api: OpenWeatherMap"
      }
    ],
    "screened_out": [
      { "opportunity": "AI 食事アドバイス", "reason": "個人健康データ源が未確保" }
    ]
  },
  "interview_mode_target": "beginner_switched_from_intermediate" | "intermediate",
  "round_count": 3
}
```

In `mode: "switch"`, `axis7_resolved` MAY be empty (the closed
confirmation step has not run yet), `feasibility_resolved` MAY be
omitted entirely (the Feasibility Check step has not run yet —
intermediate flow's Feasibility Check runs AFTER Axis 7 confirmation
but BEFORE Output Write-back; the switch path exits before
Feasibility Check), and `bonus_recommendations_resolved` MAY also
be omitted entirely (the Bonus Recommendations step runs AFTER
Feasibility Check; the switch path exits before it as well). In
`mode: "write"`, `axis7_resolved`, `feasibility_resolved`, AND
`bonus_recommendations_resolved` MUST all be present and fully
populated. See:
- `refs/open-interview.md` § Feasibility Check § Step F4 for the
  canonical shape of `feasibility_resolved`
- `refs/open-interview.md` § Bonus Recommendations § Step B4 for
  the canonical shape of `bonus_recommendations_resolved`

## Modes

### Mode: "switch"

Output object:

```json
{
  "raw_input_draft": "<markdown content for 00-raw-input.md>",
  "skip_list": ["target_user", "problem", "constraints"]
}
```

`skip_list` contains axes that satisfy BOTH:

- C1: `final_scores[axis] >= 7`
- C2: `final_missing_slots[axis]` does NOT contain any "required slot"
  for that axis (see § Required Slots)

The orchestrator hands `raw_input_draft` to SKILL.md Step 2 as
conversation context, and applies `skip_list` so the user is not
re-asked about those axes.

### Mode: "write"

Output object:

```json
{
  "raw_input_draft": "<markdown content for 00-raw-input.md, finalized>"
}
```

The orchestrator writes this content to
`artifacts/{app_name}/requirements/00-raw-input.md`. No `skip_list`
in this mode (the interview is complete; nothing to skip).

## Required Slots

For the skip-list determination (mode: "switch" only), an axis can
only be skipped if its required slots are all satisfied. Other
slots are advisory; their absence does not block skipping but is
recorded in the raw_input_draft as `(未確認: {slot_labels})`.

| Axis | Required slots |
|---|---|
| target_user | (none — audit-only axis) |
| problem | (none) |
| features | `moscow_classification` |
| competitors | (none — audit-only) |
| constraints | (none — provisional_flags can defer all) |
| platform | (none) |
| design_output_scope | `platform_combo`, `screen_coverage`, `state_pattern`, `dual_theme_mode`, `illustration_policy`, `graphic_generation`, plus `mobile_framework` and `legacy_android_xml` iff platform_combo includes mobile |

The design_output_scope axis is the strictest because the values are
enum-typed and consumed by downstream skills (schema-strict). The
audit-only axes (target_user, problem, competitors, constraints,
platform) have no enum-required values, only narrative quality.

## Raw_input_draft Generation Rules

The draft must match the format in
`refs/output-templates.md § 00-raw-input.md` exactly, with these
content rules:

### R1: Section assignment

For each sentence in `raw_text`, assign it to the section whose axis
it most directly addresses. The same sentence MAY appear in up to 2
sections if it spans two axes (no more than 2 to keep the draft
readable).

### R2: Time-ordered within section

Within each section, preserve the temporal order of the user's
statements (Round 1 → Round N).

### R3: Verbatim preservation

Do NOT paraphrase the user's words. Permitted edits only:

- Punctuation insertion / normalization
- Kanji conversion for clearly intended readings
- Removing filler ("えっと", "うーん")
- Joining fragments split across rounds when the meaning is identical

### R4: Missing-slot annotation

For each axis section, after the user-derived content, append on a
new line:

```
（未確認: {comma-separated slot_labels from final_missing_slots[axis]}）
```

Omit this line entirely if `final_missing_slots[axis]` is empty.

### R5: MoSCoW sub-sections

The "主要機能（MoSCoW）" section MUST have three sub-sections
(Must / Should / Could) per the template. Source selection rule:

- **If `feasibility_resolved` is present** (canonical path for
  `mode: "write"` invocations from intermediate flow): use
  `feasibility_resolved.must_features` / `should_features` /
  `could_features` directly as the source for each sub-section.
  Each entry is rendered per § R9 (feasibility annotation).
- **If `feasibility_resolved` is absent** (only in `mode: "switch"`
  during the dispatcher's switch-time invocation — Feasibility
  Check has not run yet): fall back to extracting features from
  `raw_text`. If the user's narrative doesn't classify, dump all
  features under Must and add a `(未確認: moscow_classification)`
  annotation. SKILL.md's beginner flow continues from this draft
  and re-runs the per-feature feasibility check, overwriting the
  Must / Should sub-sections with feasibility-annotated entries on
  final write.

### R6: design_output_scope rendering

The "デザイン出力範囲" section must render fields from
`axis7_resolved` if present. For `null` fields, write `未確定` and
add to missing-slot annotation.

### R7: Confluence

The "Confluence 保存先" section renders `axis7_resolved.confluence_parent_id`
if present, else `未定`.

### R8: Mode metadata at top

The frontmatter MUST include:

```
**ヒアリングモード:** {japanese label for interview_mode_target}
**ラウンド数:** {round_count}/5
```

Japanese labels:

| interview_mode_target | Label |
|---|---|
| `intermediate` | 中級者以上向け (オープンインタビュー) |
| `beginner_switched_from_intermediate` | 中級者開始 → 初心者合流 |

### R9: Feasibility annotation (Must / Should features)

When `feasibility_resolved` is present (intermediate flow
`mode: "write"`), each Must / Should feature MUST be rendered
inline in the `主要機能（MoSCoW）` section with its feasibility
evidence appended via an em-dash:

```
- {feature_name} — {feasibility_string}
```

Where `{feasibility_string}` is the string-typed `feasibility`
field on the corresponding `feasibility_resolved.must_features[i]`
or `should_features[i]` entry. The expected format follows
`skills/01-question/SKILL.md` § Axis 3 § Recording rules:

- `public_api: <api_name>` (e.g. `public_api: OpenWeatherMap free tier`)
- `user_owned_data: <description>` (e.g. `user_owned_data: 既存タグマスタ`)

If `feasibility` is missing or malformed for a particular feature
(should never happen if F4 runs correctly), render the feature
without the em-dash suffix and append a
`(未確認: feasibility annotation)` line at the section end.

**Could-tier features are exempt from this annotation** (per
SKILL.md § Axis 3 § Recording rules: "Could-tier features are
exempt from this check"). Render them as bare `- {feature_name}`
with no em-dash suffix.

This rule is intermediate-flow-specific. When
`feasibility_resolved` is absent (switch-time invocation or
beginner-flow re-use), this rule does NOT apply; the Must /
Should / Could sub-sections are populated from `raw_text` text
only and the beginner flow's per-feature
`AskUserQuestion` (SKILL.md § Axis 3 — Data/API Reality Check)
overwrites them later.

### R10: Future plans rendering (merged sources)

The `将来プラン（実現性未確保）` section in `00-raw-input.md`
aggregates entries from **two sources** when intermediate flow
write-time invocation provides them:

1. **`feasibility_resolved.future_plans`** — features dropped during
   the Feasibility Check (Must / Should features that failed the
   per-feature feasibility threshold).
2. **`bonus_recommendations_resolved.screened_out`** — Bonus
   Recommendation candidates that failed the Internal Feasibility
   Screening (silently screened out before being shown to the user).

Render each entry on its own bullet line. Use the source-specific
format below:

- For `feasibility_resolved.future_plans` entries:
  ```
  - {feature_name} — {reason} (元 tier: {tier_before_drop})
  ```
- For `bonus_recommendations_resolved.screened_out` entries (no
  `tier_before_drop`, since these were never assigned a tier):
  ```
  - {opportunity} — {reason} (Bonus 候補)
  ```

Ordering: render `feasibility_resolved.future_plans` entries first
(in their array order), then `bonus_recommendations_resolved.screened_out`
entries (in their array order). This preserves a stable ordering
that retro / audit can rely on.

If BOTH sources are empty (or absent), render the section body as
the literal string `なし` (matching `refs/output-templates.md` §
00-raw-input.md template default
`{future_plans があれば箇条書き、なければ「なし」}`). Do NOT
omit the section heading itself — keep the `## 将来プラン
（実現性未確保）` line even when empty, for consistency with
beginner flow output.

For `requirements.json → future_plans[]` (top-level array defined
in `schemas/requirements.schema.json`), populate with
one free-text string per entry from BOTH sources, in the same order
as the markdown rendering above. Format:

- From `feasibility_resolved.future_plans`:
  `{feature_name} — {reason}` (matching SKILL.md § Axis 3 §
  Recording rules: "append it to `requirements.json →
  future_plans[]` (as a free-text string)"). The `tier_before_drop`
  field is preserved in `00-raw-input.md` only (human-readable
  audit) and is NOT emitted into the JSON array.
- From `bonus_recommendations_resolved.screened_out`:
  `{opportunity} — {reason}` (matching SKILL.md § Bonus
  Recommendations: "are still appended to `requirements.json →
  future_plans[]` with a brief reason"). The `(Bonus 候補)` suffix
  used in markdown is NOT emitted into the JSON array.

The JSON variant intentionally drops source markers (`tier_before_drop`,
`Bonus 候補`) so the array shape stays interchangeable with the
beginner flow output (beginner flow also merges these into the same
flat array). The markdown variant preserves source markers because
retro is human-readable.

When BOTH `feasibility_resolved` AND `bonus_recommendations_resolved`
are absent (switch-time invocation), this rule does NOT apply;
render the section with body `なし` and leave
`requirements.json → future_plans[]` empty. The beginner flow re-run
after switch will then populate both via its own per-feature
feasibility check + Bonus Recommendations screening.

### R11: Recommendations section + recommendations_accepted rendering

When `bonus_recommendations_resolved` is present, the
`## Recommendations` section in `00-raw-input.md` MUST be populated
from `bonus_recommendations_resolved.accepted` (the user-selected
Bonus Recommendations that survived screening).

Render each accepted entry on its own bullet line in the following
multi-line format (mirroring SKILL.md § Bonus Recommendations §
"Format each surviving recommendation as"):

```
- {opportunity} — {why}
  Feasibility: {feasibility}
  Effort: {effort}
```

If `feasibility` carries the `user_manual_addition` sentinel
(meaning the user typed it into AskUserQuestion's auto-"Other"
slot in § Step B3), render the Feasibility line literally as
`Feasibility: user_manual_addition (ユーザー追加 / screening 未実施)`
to flag the entry as a non-screened user override.

If `bonus_recommendations_resolved.accepted` is an empty array,
render the section body as the literal string `なし` (matching
`refs/output-templates.md` § 00-raw-input.md template default
`{採用した提案を箇条書き}` interpreted with the same "なし" fallback
convention as the 将来プラン section). Do NOT omit the section
heading itself.

For `requirements.json → recommendations_accepted[]` (top-level
array per `refs/output-templates.md`), populate with one free-text
string per accepted entry in the form (matching SKILL.md § Bonus
Recommendations § Rules):

- Standard: `{opportunity} — {feasibility}` (e.g.
  `天気連動おすすめ — public_api: OpenWeatherMap`)
- `user_manual_addition`: `{opportunity} — user_manual_addition`
  (the sentinel is preserved verbatim so downstream consumers can
  identify non-screened entries)

`why` and `effort` are preserved in `00-raw-input.md` only — they
are not emitted into the JSON array, matching beginner flow's
recommendations_accepted format.

Non-selected surviving candidates (presented in § Step B3 but not
picked by the user) are explicitly NOT recorded anywhere (per
SKILL.md § Bonus Recommendations: "Non-selected items are not
recorded"). The Dispatcher does NOT receive these entries —
orchestrator already filtered them out at § Step B4.

When `bonus_recommendations_resolved` is absent (switch-time
invocation or beginner-flow re-use), this rule does NOT apply.
Render `## Recommendations` section body as `なし` and leave
`requirements.json → recommendations_accepted[]` empty. The
beginner flow re-run after switch will populate both via its own
Bonus Recommendations step.

## Switch-time Behavior Detail

When `mode: "switch"`, the orchestrator will hand control to
SKILL.md Step 2 with:

- `raw_input_draft` as a conversation context document — DO NOT
  pre-write it to disk. SKILL.md eventually writes the final version
  via the standard output flow (with axes filled in for non-skipped
  axes added on top of this draft).
- `skip_list` applied: for each axis in skip_list, SKILL.md MUST
  silently bypass the opening question and deep-dive (use the
  Dispatcher's text + final_scores[axis] as the recorded score).
- The remaining axes (not in skip_list) execute the full beginner
  Axis flow per SKILL.md.

After SKILL.md finishes the remaining axes, the FINAL
00-raw-input.md will combine:

- Sections from skipped axes: as produced by this Dispatcher
- Sections from non-skipped axes: as collected by SKILL.md from the
  user's beginner-mode answers

Implementation guidance for the orchestrator: maintain the
`raw_input_draft` as in-memory state during SKILL.md execution, and
overwrite each non-skipped axis's section with the beginner-mode
content before writing to disk.

## Write-time Behavior Detail

When `mode: "write"`, the orchestrator writes `raw_input_draft`
directly to `artifacts/{app_name}/requirements/00-raw-input.md`.
This is the terminal path for `interview_mode: "intermediate"`
(no mode switch occurred).

The orchestrator separately writes `requirements.json` using:

- `final_scores` → `readiness` section
- `axis7_resolved` → `design_output_scope` and
  `confluence_parent_id` fields
- `feasibility_resolved.future_plans` + `bonus_recommendations_resolved.screened_out`
  → `future_plans[]` (per `requirements.schema.json`
  definition: features dropped during Feasibility Check + Bonus
  Recommendation candidates that failed Internal Feasibility
  Screening)
- `bonus_recommendations_resolved.accepted` →
  `recommendations_accepted[]` (per `requirements.schema.json` —
  user-selected Bonus Recommendations)

### `provisional_flags` population (intermediate flow)

`provisional_flags` (per `schemas/requirements.schema.json`) is
`"未確定項目のリスト。ヒアリングで「未定」「TBD」と回答された項目"` —
user-declared TBD / undecided items, **NOT** machine-generated
missing-slot labels. Populate it using BOTH of the following
sources (mirroring `skills/01-question/SKILL.md` § Workflow Step
2d: "If still < 4 after deep-dive → record in provisional_flags"):

1. **Axes that exited the intermediate loop with `final_scores[axis] < 4`** —
   one free-text string per such axis describing what is undecided.
   Phrase each entry as `{axis_japanese_label}: {one-line summary
   of what remains undecided}`, deriving the summary from
   `final_missing_slots[axis]` translated into human-readable
   language (NOT raw slot labels). Example: if `final_scores.constraints = 3`
   and `final_missing_slots.constraints = ["timeline", "budget"]`,
   the entry is `制約: 期間と予算が未定` — NOT
   `["timeline", "budget"]` as raw slot strings.
2. **Explicit user-declared TBD statements in `raw_text`** —
   AI scans `raw_text` for phrases like `未定`, `TBD`, `決まっていない`,
   `あとで決める`, `判断保留` and captures them as their own free-text
   entries. Format: `{axis_japanese_label} ({引用フレーズ})`. These
   are independent of `final_scores[axis] < 4` — even an axis at
   score 7 can have a TBD entry if the user explicitly deferred a
   sub-aspect.

Both source paths produce free-text strings (matching
`requirements.schema.json` `provisional_flags.items.type: "string"`).
The intermediate flow's `final_missing_slots` is a machine-readable
loop-state artifact and MUST NOT be flattened directly into
`provisional_flags` — it stays confined to:

- 00-raw-input.md `（未確認: ...）` annotations per axis section
  (per § R4 — those use the raw slot labels for cross-file grep /
  retro tooling)
- Internal orchestrator loop state (Scorer / Composer / Dispatcher
  payload) — never persisted to `requirements.json`.

If both sources are empty (no axes < 4 AND no TBD phrases in
raw_text), write `provisional_flags: []`. The empty array is a
valid outcome.

The previous version of this section said the orchestrator
flattens `final_missing_slots` directly into `provisional_flags`
as a string list. That conflicted with the canonical schema
definition (machine-generated slot labels are not user-declared
TBD items) and would have polluted the audit-purpose
`provisional_flags` with implementation-internal slot vocabulary.
The current text routes machine-generated slot labels to
`00-raw-input.md` annotations only, and reserves
`provisional_flags` for human-readable TBD items derived from
either low-score axes or explicit user "未定" statements.

## Output Schema (strict JSON in both modes)

```json
{
  "raw_input_draft": "<full markdown string, no escaping artifacts>",
  "skip_list": ["target_user", ...]
}
```

In `mode: "write"`, omit `skip_list` (or set to `[]`).

Output strict JSON only. No prose, no markdown fences, no
explanations outside the `raw_input_draft` value.

## Behavior on Edge Cases

| Condition | Behavior |
|---|---|
| `raw_text` empty | Generate a draft with all sections empty + full missing-slot annotations |
| `final_scores` missing keys | Treat missing keys as 0 (will not be skipped) |
| `axis7_resolved` partially null | Render filled fields, mark null fields as `未確定` in narrative |
| `round_count` missing | Render `**ラウンド数:** ?/5` |
| All axes pass skip condition | Output `skip_list` covering all 7 axes; SKILL.md will skip the entire Axis 1–7 loop and go straight to Confluence + scoreboard (this is a degenerate but valid case) |
| `feasibility_resolved` absent in `mode: "write"` (should not happen — F4 always produces it) | Treat as absent (R5 fallback path): extract features from `raw_text`, dump under Must with `(未確認: moscow_classification)` and `(未確認: feasibility annotation)` annotations. Render `将来プラン` section body as `なし`. Log this as feedback-log Pattern B (Agent mistake) since intermediate flow F4 should always have produced it. |
| `feasibility_resolved` present in `mode: "switch"` (should not happen — switch-time invocation exits before Feasibility Check) | Ignore the field entirely. Switch-time R5 fallback (raw_text extraction) applies; R9 / R10 do not apply. The beginner flow's per-feature feasibility check will run after the switch and populate Must / Should / future_plans correctly on final write. |
| `feasibility_resolved.must_features` and `should_features` both empty AND `future_plans` non-empty | Render the MoSCoW section with the existing Could entries plus a note `(全 Must / Should 機能が feasibility 未達のため将来プランへ降格)` at the top of the Must sub-section. Render the 将来プラン section per R10. |
| `feasibility_resolved.future_plans[].reason` is empty string | Render as `- {feature_name} — (理由未記録) (元 tier: {tier_before_drop})` to preserve the section structure. |
| `bonus_recommendations_resolved` absent in `mode: "write"` (should not happen — B4 always produces it) | Treat as absent: render `## Recommendations` section body as `なし` and contribute no entries to the 将来プラン section. Log feedback-log Pattern B since intermediate flow B4 should always have produced it. |
| `bonus_recommendations_resolved` present in `mode: "switch"` (should not happen — switch-time invocation exits before Bonus Recommendations) | Ignore the field entirely. R11 does not apply; R10 does not merge `screened_out` (the field is treated as absent). Beginner flow's Bonus Recommendations step will run after the switch and populate both sections correctly. |
| `bonus_recommendations_resolved.accepted` empty AND `screened_out` empty | Render `## Recommendations` body as `なし`. Render 将来プラン section using only `feasibility_resolved.future_plans` (per R10). Both arrays empty is a valid outcome — either AI couldn't generate candidates (B1 zero), or all were screened out and the user picked none. |
| `bonus_recommendations_resolved.accepted[].feasibility` is missing or malformed | Render the Feasibility line as `Feasibility: (記録不能)` to preserve structure, and append the entry to `recommendations_accepted[]` as `{opportunity} — (記録不能)`. Log feedback-log Pattern B. |
| `bonus_recommendations_resolved.screened_out[].reason` is empty string | Render as `- {opportunity} — (理由未記録) (Bonus 候補)` in the 将来プラン section, matching the analogous empty-reason behavior for `feasibility_resolved.future_plans`. |

## Cross-reference

- Orchestrator: [open-interview.md](open-interview.md)
- Output format reference: [output-templates.md](output-templates.md)
- Scorer (source of final_scores / final_missing_slots): [internal-scorer.md](internal-scorer.md)
