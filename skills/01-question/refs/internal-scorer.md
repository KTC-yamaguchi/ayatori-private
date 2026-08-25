# Internal Scorer Prompt (Open Interview Mode)

Stage A of the two-stage per-round inference in
`refs/open-interview.md`. Reads the full accumulated raw_text and
produces strict JSON containing 7-axis scores, missing slots, and
evidence quotes. Used as the sole input for Stage B (Question
Composer). Never shown to the user.

## Activation

Invoked by open-interview.md at three call sites. The orchestrator
chooses which (if any) to fire per flow context. **This section
MUST stay in sync with `refs/open-interview.md` § Flow,
§ Round 1: Free-form Opening § Short-input Re-prompt, and § Mode
Switch Exit § Post-trigger behavior — those are the authoritative
sources for call-site decisions.**

### Call sites (when Scorer IS called)

| # | Call site | Trigger | open-interview.md location |
|---|---|---|---|
| 1 | Round N Step 2 (primary in-loop call) | Every deep-dive loop iteration N = 2..5 at Step 2, when Step 1 did NOT detect a mode-switch trigger. Scorer at iteration N scores `raw_text` containing Round 1 through Round (N-1) replies. Round 1 is the opener phase (NOT part of the deep-dive loop) and has no Step 2 — Scorer first runs at N=2 (scoring Round 1's content) after Round 1's reply has been appended to `raw_text` AND any short-input re-prompt cycle has completed. See `refs/open-interview.md` § Flow for the Round 1 ↔ deep-dive loop transition. | § Flow Deep-dive loop Step 2 |
| 2 | Pre-dispatch Scorer refresh | After an Explicit trigger or Implicit trigger Option 1 fires; ensures `final_scores` / `final_missing_slots` are paired with up-to-date `raw_text` (which now includes the trigger-bearing user reply) before the orchestrator hands off to Intake Dispatcher | § Mode Switch Exit § Post-trigger behavior Step 1 |
| 3 | Round 1 post-reprompt continuation | Round 1 initial input was < `round_1_min_chars` (= 50 characters after whitespace strip). The orchestrator re-prompts within Round 1 (no Scorer during the re-prompt cycle), then after the follow-up reply, control transitions to the deep-dive loop and Scorer runs at iteration N=2 Step 2 (= Call site 1) on the combined Round 1 raw_text. This row is a description of the deferred trigger for Call site 1 in the short-input scenario — it is NOT a separate Scorer call, just Call site 1 with a deferred start time. | § Round 1: Free-form Opening § Short-input Re-prompt |

### Cases where Scorer is genuinely NOT called

| Case | Why Scorer is skipped | open-interview.md location |
|---|---|---|
| Round 1 initial short input (< 50 chars, before re-prompt completes) | Scorer is NOT called on the raw short input alone. Orchestrator re-prompts first within Round 1; the short input is never scored in isolation. After the user's follow-up reply, control transitions to the deep-dive loop and Call site 1 runs at iteration N=2 Step 2 on the combined raw_text (per Call site 3 deferral description above). If the second reply is still < 50 chars after concatenation, orchestrator proceeds to the loop transition anyway with whatever was provided — see open-interview.md § Round 1 § Short-input Re-prompt for the exact fallback. | § Round 1: Free-form Opening § Short-input Re-prompt |
| Implicit trigger Option 2 (user chose "proceed as-is with provisional_flags") | Orchestrator records axes < 4 in `provisional_flags` and skips straight to Axis 7 Closed Confirmation using the prior round's `previous_scores` (stale by one round, frozen at trigger time). No current-round Scorer call, and no Pre-dispatch refresh because there is no dispatch. | § Mode Switch Exit § Implicit trigger Option 2 |
| In-round Step 2 when an Explicit / Implicit trigger fired at Step 1 | The in-loop call (Call site 1) for this round is skipped — Step 2-8 of the round do NOT execute. However, Call site 2 (Pre-dispatch refresh) runs on Explicit-trigger and Implicit-trigger-Option-1 paths and produces fresh scores before dispatch, so Scorer is effectively still called once on those paths. | § Rounds 2–5 § Step 1 + § Mode Switch Exit |
| Pre-dispatch refresh idempotency (Max-rounds Fallback Option 1) | Pre-dispatch refresh (Call site 2) is skipped as an optimization when Scorer has already run at the same round's Step 2 (Call site 1). In Max-rounds Fallback Option 1 specifically, § Step 5 fires AFTER § Step 2, so Scorer already produced fresh `final_scores` paired with the current `raw_text` — re-running would be a no-op. | § Mode Switch Exit § Post-trigger behavior Step 1 (branching table) |

The previous version of this section enumerated only two skip
cases ("Round 1 < 50 chars" and "Explicit mode switch trigger") and
inaccurately stated that the latter exits "without scoring". Both
were wrong relative to open-interview.md's actual behavior — Scorer
runs in the Pre-dispatch refresh on mode-switch paths, and < 50-char
Round 1 input is re-prompted then scored rather than truly skipped.
The current section reflects the actual call/skip behavior.

## Input Contract

The orchestrator passes the following object:

```json
{
  "raw_text": "<all rounds concatenated with `---- Round N ----` markers>",
  "previous_scores": {
    "target_user": 0,
    "problem": 0,
    "features": 0,
    "competitors": 0,
    "constraints": 0,
    "platform": 0,
    "design_output_scope": 0
  },
  "previous_missing_slots": {
    "target_user": ["persona_role", "usage_scene", "workaround_today", "pain_intensity"],
    "problem": ["workaround_path", "limitation", "impact_if_solved"],
    "features": ["moscow_classification", "must_count", "must_acceptance_criteria", "input_output_spec"],
    "competitors": ["reference_app_name", "pros_cons", "differentiation"],
    "constraints": ["timeline", "budget", "tech_stack", "team_size"],
    "platform": ["launch_target", "responsive_need", "usage_environment"],
    "design_output_scope": ["platform_combo", "screen_coverage", "state_pattern", "mobile_framework", "legacy_android_xml", "dual_theme_mode", "illustration_policy", "graphic_generation", "consistency_with_constraints"]
  },
  "round_num": 1
}
```

For Round 1, `previous_scores` is all-zero and `previous_missing_slots`
contains every slot from the vocabulary below.

## Output Schema (strict JSON, no prose)

```json
{
  "scores": {
    "target_user": 7,
    "problem": 5,
    "features": 3,
    "competitors": 1,
    "constraints": 4,
    "platform": 2,
    "design_output_scope": 1
  },
  "missing_slots": {
    "target_user": [],
    "problem": ["workaround_path", "limitation"],
    "features": ["moscow_classification", "must_acceptance_criteria", "input_output_spec"],
    "competitors": ["reference_app_name", "pros_cons", "differentiation"],
    "constraints": ["budget", "tech_stack", "team_size"],
    "platform": ["responsive_need", "usage_environment"],
    "design_output_scope": ["platform_combo", "screen_coverage", "state_pattern", "mobile_framework", "legacy_android_xml", "dual_theme_mode", "illustration_policy", "graphic_generation", "consistency_with_constraints"]
  },
  "evidence_quotes": {
    "target_user": "昼休みにオフィスで同僚と店を決めかねている営業職",
    "problem": "誰も決めないので結局同じ店",
    "features": "現在地から3店提案",
    "competitors": "",
    "constraints": "1ヶ月でPoC",
    "platform": "スマホ",
    "design_output_scope": ""
  },
  "trigger_hits": {
    "features": ["everything_is_must"]
  }
}
```

Output strict JSON only. No prose, no markdown fences, no
explanations. If you must reject the input (e.g. raw_text is
literally empty), still return the schema with all-zero scores and
all slots populated as missing.

## Scoring Constraints

Apply these rules WITHOUT exception. They are invariants that
downstream stages (Composer, scoreboard display, mode-switch
detection) depend on:

### Conservative bias

When in doubt between two anchor levels in `scoring-criteria.md`,
pick the LOWER one. Optimism leaks into question quality downstream
and prevents the loop from converging.

### Re-score the FULL history

Re-evaluate every axis every round. Scores MAY decrease if later
rounds contradict earlier statements (consistency penalty), but the
decrease is bounded — see "decrement cap" below.

### Decrement cap

An axis score MUST NOT drop by more than 2 points between
consecutive rounds, even if a contradiction is detected. Severe
contradictions accumulate across rounds rather than collapsing in a
single round.

### 0 → 7 jump guard

If `previous_scores[axis]` is 0 (not yet scored) AND the new score
would be >= 7, require at least 80 characters of supporting text in
`raw_text` whose content directly substantiates the score per
`scoring-criteria.md`. If the evidence is shorter, cap at 6.

### Minimum after Round 1

After Round 1 (raw_text non-empty), every axis MUST be >= 1. The
floor of 0 is reserved for "not yet evaluated".

### Anchor interpolation within tier

`scoring-criteria.md` defines four tiers per axis (1-3 / 4-6 / 7-8 /
9-10). Resolve the exact score within a tier using slot count:

- Tier 4-6
  - 3 or more missing slots remaining → 4
  - 2 missing slots → 5
  - 1 missing slot → 6
- Tier 7-8
  - All 7-8 anchor elements satisfied but none of the 9-10 elements
    → 7
  - All 7-8 anchor elements + 1 of the 9-10 elements → 8
- Tier 9-10
  - All 9-10 anchor elements satisfied but one is abstract → 9
  - All 9-10 anchor elements expressed via concrete nouns / numbers
    → 10
- Tier 1-3
  - Use slot count (3 missing → 1, 2 missing → 2, 1 missing → 3) but
    NEVER assign 3 if `previous_scores[axis]` was already > 3 (would
    violate decrement cap from > 5)

## Missing-Slot Vocabulary

These are the ONLY allowed slot labels. The Composer prompt indexes
into these to generate questions. Free-form "ふんわり指摘" is
forbidden — it makes Composer output drift.

### target_user

| Slot | Meaning |
|---|---|
| `persona_role` | Who (role / occupation / lifestyle) is unclear |
| `usage_scene` | When / where the app is opened is unclear |
| `workaround_today` | How the person currently solves the problem is unclear |
| `pain_intensity` | How painful the current situation is (frequency, cost) is unclear |

### problem

| Slot | Meaning |
|---|---|
| `workaround_path` | Current workflow / steps the user goes through today is unclear |
| `limitation` | What's wrong with the current workaround is unclear |
| `impact_if_solved` | What concretely changes when the app works is unclear |

### features

| Slot | Meaning |
|---|---|
| `moscow_classification` | Must / Should / Could labeling is absent |
| `must_count` | Must items are 4 or more (over-scope risk) |
| `must_acceptance_criteria` | Must items are stated abstractly, not at acceptance-criteria specificity |
| `input_output_spec` | Input and output specification is unclear for at least one Must item |

### competitors

| Slot | Meaning |
|---|---|
| `reference_app_name` | No concrete reference app is named |
| `pros_cons` | What the reference does well / poorly is not stated |
| `differentiation` | Differentiation point from references is not stated |

### constraints

| Slot | Meaning |
|---|---|
| `timeline` | No timeline (even rough) is stated |
| `budget` | Budget is not stated |
| `tech_stack` | Tech stack is not stated |
| `team_size` | Team size is not stated |

### platform

| Slot | Meaning |
|---|---|
| `launch_target` | Which platform launches first is unclear |
| `responsive_need` | Whether responsive layout is needed is unclear (回答は Axis 7-a2 で `design_output_scope.web_viewports` として機械可読化される) |
| `usage_environment` | Primary usage environment (PC / mobile / both) is unclear |

### design_output_scope

| Slot | Meaning |
|---|---|
| `platform_combo` | platform_combo (mobile_only / web_only / mobile_and_web) is unclear |
| `web_viewports` | web_viewports (desktop / sm subset) is unclear AND platform_combo includes web (Axis 6 responsive_need の下流確定先) |
| `screen_coverage` | screen_coverage (must_only / must_and_should / all_features) is unclear |
| `state_pattern` | state_pattern (default_only / required_4_states / nature_based_extra_states) is unclear (default は default_only) |
| `mobile_framework` | mobile_framework (native / flutter / kmp) is unclear AND platform_combo includes mobile |
| `legacy_android_xml` | legacy_android_xml (true / false — Android View システム XML の legacy opt-in) is unclear AND platform_combo includes mobile |
| `dual_theme_mode` | dual_theme_mode (true / false) is unclear |
| `illustration_policy` | illustration_policy (pictogram / illustration_character / emoji_casual) is unclear |
| `graphic_generation` | graphic_generation (ask / skip) is unclear (default は ask) |
| `consistency_with_constraints` | Cross-check vs Axis 5 constraints not yet established |

For each axis, `missing_slots` MUST be a subset of the vocabulary
labels above. Empty array `[]` means all slots are satisfied for
that axis.

## Trigger Hit Scanner

In addition to slots, scan raw_text for these deep-dive triggers
from `scoring-criteria.md`. Report all matches in the `trigger_hits`
field. These are passed to Composer as additional context for
question angle selection.

| Axis | Trigger | Match pattern (Japanese) |
|---|---|---|
| target_user | `vague_qualifiers` | `〜など` `〜的な` `〜感じで` |
| target_user | `age_range_only` | `\d+代` mentioned without scene |
| problem | `inconvenient_no_workaround` | `面倒` / `不便` without workaround_path slot filled |
| problem | `would_be_nice` | `あったらいい` `あれば嬉しい` |
| features | `everything_is_must` | More than 3 items classified as Must, or no MoSCoW classification |
| features | `standard_features` | `普通の` `一般的な` `よくあるやつ` |
| features | `preferably_x` | `できれば〜` |
| competitors | `something_similar_vague` | `似たアプリ` `似たような` without specific name |
| competitors | `no_competitors` | `知らない` `わからない` regarding competitors |
| constraints | `everything_in_one_month` | `1ヶ月で全部` `短期間で全部` |
| constraints | `all_undecided` | `未定` `TBD` for 3+ slots |
| platform | `both_no_priority` | `両方` without launch_target stated |
| platform | `web_no_responsive` | `Web` without responsive_need clarified |
| design_output_scope | `all_undecided_d7` | All sub-dimensions unstated |
| design_output_scope | `admin_web_no_rationale` | mobile + admin web mentioned without user-base reasoning |
| design_output_scope | `scope_balloon_risk` | `all_features` mentioned with tight or undecided constraints |

The trigger_hits field is OPTIONAL; if no triggers fire for an axis,
omit the axis key from the object (or set to empty array — both
shapes are accepted by Composer).

## Evidence Quotes

For each axis, `evidence_quotes[axis]` MUST be:

- A direct substring of raw_text (verbatim, no paraphrasing)
- ≤ 80 characters
- The most concrete / specific phrase available for that axis
- Empty string `""` if NO substring relevant to that axis exists in
  raw_text (DO NOT fabricate)

Composer uses these quotes for noun-citation; fabricated quotes
break the hallucination check downstream.

## Behavior on Malformed Input

| Condition | Behavior |
|---|---|
| raw_text is empty | All scores = 0, all slots missing, all evidence empty |
| raw_text has only whitespace | Same as empty |
| previous_scores key missing | Treat as 0 for that axis |
| previous_missing_slots key missing | Treat as full slot set (all slots missing) |
| round_num missing | Treat as 1 |

NEVER throw, NEVER return prose error messages. Always return the
schema shape. The orchestrator handles retry logic separately.

## Cross-reference

- Stage B (Composer): [question-composer.md](question-composer.md)
- Anchor examples: [scoring-criteria.md](scoring-criteria.md)
- Orchestrator: [open-interview.md](open-interview.md)
