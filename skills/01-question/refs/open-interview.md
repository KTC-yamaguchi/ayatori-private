# Open Interview Mode (Intermediate+)

Orchestrator for the intermediate-level interview flow. Triggered when
the user picks `intermediate` in `SKILL.md` § Experience Level
Selection. This file owns the entire intermediate flow including
final output write-back; do NOT execute `SKILL.md` § Opening or the
7-axis loop while this orchestrator is active (the only exception is
the Mode Switch Exit below).

## Language Rule

This file is written in English. All user-facing output produced
by the orchestrator — the Round 1 opener narrative body (the
chat-message text below the progress-indicator header), the
short-input re-prompt, the pass-success message, the mode-switch
hint line, the Axis 7 estimation display, the Max-rounds Fallback
prompt, the implicit-trigger `AskUserQuestion` text, and any other
chat-message rendered to the user — MUST be in the language defined
by `pipeline.yaml → output_language` (currently `ja`). This matches
the convention in `skills/01-question/SKILL.md` § Language Rule and
`refs/question-composer.md` § Language Rule.

User-facing message templates in this file are shown in literal `ja`
because they are the calibrated rendering for the current
`output_language == "ja"`. The same calibration convention is used
by `refs/scoring-criteria.md` anchor examples and
`SKILL.md`'s vague-input match patterns.

### Exception: Progress indicator header is English-fixed

The `📍 Round N/5 — ...` progress indicator header used in this
file — at Round 1 opener (`📍 Round 1/5 — オープンインタビュー
(中級者モード)`) and inside the Composer-rendered question block
(`📍 Round N/5 — Deep-dive`, defined in
`refs/question-composer.md` § Output Format) — is an explicit
exception to the `output_language` rule.

- The `📍 {prefix} — ` portion (`📍 Round N/5 — `) is **always
  English** regardless of `output_language`, per the project-wide
  canonical SoT `skills/01-question/SKILL.md` § Progress Display
  § Language: English-fixed.
- The trailing label after the em-dash has two sub-cases (per
  SKILL.md § Progress Display § Sub-case):
  - **Section openers** (Round 1 opener: `オープンインタビュー
    (中級者モード)`) — the trailing label is a section title
    narrative rendered in `output_language`. This is the only
    section-opener instance in this file.
  - **In-flow progress markers** (Composer header: `Deep-dive`;
    scoreboard round-header insertion: `Round 3/5` inline) —
    fully English-fixed. The Composer's `Deep-dive` label is
    declared English-fixed in `refs/question-composer.md`
    § Language Rule § Exception: Progress indicator header is
    English-fixed.

If `output_language` ever switches to a non-`ja` value:
- `📍 Round N/5 — ` prefix stays English (exception persists).
- Composer's `Deep-dive` label stays English (exception persists,
  defined in question-composer.md).
- Round 1 opener's `オープンインタビュー (中級者モード)` narrative
  title MUST be re-calibrated to the new language (this is the
  section-opener sub-case content, not the structural marker).

If a future decision overrides the English-fixed convention,
update `skills/01-question/SKILL.md` § Progress Display first
(canonical SoT for the `📍 ... — ...` format), then mirror in this
file and in `refs/question-composer.md`.

### Exception: Scoreboard rendering is English-fixed

The scoreboard rendered at § Step 3 (and the round-header variant
inserted at the top of it) is an explicit exception to the
`output_language` rule. It is **always rendered in English**
regardless of `output_language`, because the canonical SoT
`refs/output-templates.md` § Scoreboard (Terminal Display) declares
this as a deliberate cross-project design choice:

> English column labels for universal readability (no box-drawing
> side borders — horizontal rules only, to avoid emoji width
> alignment issues).

This exception applies to:

- Header text: `Specification Readiness`, `Round N/5` insertion,
  `FINAL`
- Axis column labels: `Target User`, `Problem`, `Features`,
  `Competitors`, `Constraints`, `Platform`, `Design Scope`
- Status indicators: `✅ Ready`, `⚠️ Almost`, `❌ Weak`,
  `⬜ Pending`
- Summary line: `Overall: X/70 (Y%)  avg=Z.Z  →  NOT READY` /
  `→  SHIPPABLE ✅` (the `NOT READY` / `SHIPPABLE` enum values
  are also fixed English per `scoring-criteria.md` § Readiness
  Threshold and `requirements.schema.json` `readiness.status` enum)

This exception applies in **both** beginner flow (SKILL.md
scoreboard display per axis completion) and intermediate flow (this
file's § Step 3 per round). Keeping it English in both flows
avoids visual / structural drift between the two modes — important
for `beginner_switched_from_intermediate` runs that render the
scoreboard in both phases of one session.

If `output_language` ever changes to a non-`ja` value:
- The scoreboard stays English (this exception persists)
- All other user-facing templates listed above MUST be re-calibrated
  to the new language

If a future decision overrides the scoreboard-English-fixed rule
(e.g., switching to localized scoreboards for a non-`ja`
deployment), the change MUST be applied in `refs/output-templates.md`
§ Scoreboard first (canonical SoT), and only then mirrored here.

### Re-calibration scope

Two categories of literal `ja` content appear in this file and MUST
be re-calibrated together if `output_language` ever changes. The
two § Exception subsections above (Progress indicator header is
English-fixed, Scoreboard rendering is English-fixed) define
content that is **excluded** from re-calibration — consult them
first before translating any literal string in this file. For
section openers covered by the Progress indicator exception (e.g.
Round 1 opener), only the trailing `output_language` narrative
title is re-calibrated; the `📍 Round N/5 — ` prefix stays English.

1. **User-facing templates** (the Round 1 opener, the short-input
   re-prompt, the pass-success message, the Axis 7 estimation
   display, the Max-rounds Fallback prompt, the implicit-trigger
   `AskUserQuestion` text, Composer's exit hint line, etc.) —
   translate to the new `output_language` verbatim while
   preserving structure / placeholders.
2. **Explicit trigger keyword list** in § Mode Switch Exit § Explicit
   trigger (e.g. `選択肢で`, `ガイドモード`, `初心者モード`) — these are
   INPUT match patterns scanning the user's reply. Because the user
   replies in `output_language`, the keyword list must be translated
   to the new language; otherwise the explicit trigger silently
   stops working.

Semantic / structural rules (loop parameters, pass conditions,
scorer / composer / dispatcher contracts, Hard Constraints) are
language-agnostic and remain unchanged across `output_language`
values.

## Principles

- **Open-ended only during the discovery loop.** Never use yes/no or
  three-choice formats from Round 1 through the last deep-dive round.
  Closed-format confirmations are allowed ONLY at the explicit
  confirmation steps (Axis 7 + Confluence) and at the mode-switch
  exit.
- **Scene-based, quote the user's words.** Each follow-up question
  must include at least one concrete noun the user already used.
- **Single rubric.** The internal evaluator uses
  `refs/scoring-criteria.md` (7-axis readiness 1-10). No new rubric
  is introduced. The same anchor examples apply.
- **Two-stage AI inference per round.** Each round runs Internal
  Scorer (refs/internal-scorer.md) first, then Question Composer
  (refs/question-composer.md). Mixing them collapses both quality
  and reproducibility.

## Loop Parameters

| Parameter | Value |
|---|---|
| max_rounds | 5 |
| pass_condition | `SHIPPABLE`: overall avg >= 7 AND all axes >= 4 (per `refs/scoring-criteria.md` § Readiness Threshold — the project-wide canonical definition shared with beginner flow / `skills/01-question/SKILL.md`) |
| min_score_per_axis_on_exit | 4 (axes < 4 go to provisional_flags) |
| round_1_min_chars | 50 (below → short-input re-prompt, no Scorer call) |
| questions_per_round_max | 3 (one per weakest axis) |

## Flow

Round numbering convention: `Round 1` is the opener phase (NOT
part of the 8-step deep-dive loop). The deep-dive loop runs only
for `Rounds 2..5`. Each loop iteration's Step 6 Composer call
produces the questions for that iteration's round (so Composer
runs at N=2, 3, 4, 5 — not at N=1). Step 2 Scorer at iteration N
scores `raw_text` containing Round 1 through Round (N-1) replies.

```
Round 0 (brief pre-read — only if the phase preamble set
   brief_preread = true; otherwise skip this step entirely):
   - Apply § Brief Pre-read (idea-brief.md 検出時) BEFORE rendering
     the Round 1 opener (brief digest display + context injection)
   ↓
Round 1 (opener phase, NOT part of the deep-dive loop):
   - Render free-form opener message (no Scorer, no Composer)
   - User replies → append to raw_text
   - Short-input re-prompt cycle if < round_1_min_chars (no Scorer
     during the cycle; Scorer first runs at Round 2 Step 2)
   ↓
   (transition: Round 1's reply is the most recent message when
    Round 2's loop iteration begins; orchestrator increments to
    N=2 and enters the loop)
   ↓
Deep-dive loop, Round N (N=2..5):
   1. Pre-check: mode switch trigger on raw_text's most recent
      reply (Round N-1's reply)? → exit to SKILL.md Step 2
   2. Internal Scorer → scores raw_text (Round 1..N-1 content) →
      produces final_scores + missing_slots + evidence_quotes
   3. Display scoreboard (refs/output-templates.md § Scoreboard,
      with "Round N/5" header line)
   4. Pass check: SHIPPABLE (avg >= 7 AND all axes >= 4)? → break to Axis 7 confirmation
   5. Max-rounds check: N == 5? → max_rounds fallback branch
   6. Question Composer → up to 3 open questions for Round N
   7. Render Round N's questions + exit hint, await user response
   8. Append Round N's user response to raw_text, N += 1
   ↓
Axis 7 + Confluence: closed confirmation (1 round)
   ↓
Feasibility Check (F1-F4): per-Must/Should feature data/API
   path confirmation (bulk-confirm pattern, mirrors SKILL.md
   § Axis 3 — Data/API Reality Check); produces
   feasibility_resolved
   ↓
Bonus Recommendations (B1-B4): adjacent-improvement candidate
   generation + Internal Feasibility Screening + multiSelect
   acceptance (mirrors SKILL.md § Bonus Recommendations); produces
   bonus_recommendations_resolved
   ↓
Write outputs (00-raw-input.md / requirements.json /
   feedback-log.md) — orchestrator passes feasibility_resolved
   + bonus_recommendations_resolved to Intake Dispatcher per
   § Output Write-back
```

## Brief Pre-read (idea-brief.md 検出時)

Applies ONLY when the phase preamble set `brief_preread = true`
(`artifacts/{app_name}/idea-brief.md` exists × `requirements.json`
absent — see SKILL.md § Brief Pre-read Mode for the activation
contract). Otherwise skip this section entirely; the flow below is
unchanged.

Before rendering the Round 1 opening prompt:

1. Read `artifacts/{app_name}/idea-brief.md` and display a digest in
   chat (output_language): ① 現在のアイデア像 (5 軸) + ⑦ 7 軸への
   引き継ぎヒント + 最新の固まり度スコア 1 行 (⑥)。
2. Treat the brief's confirmed items (② 確定事項 = resolved
   `idea_brief.*` entries in pending-questions.json) as
   **pre-computed context**: do NOT re-hear them from scratch
   (再ヒアリングしない)。 Follow-up questions may deepen or extend
   them, and anything the user corrects in-session takes precedence
   over the brief.
3. Render the Round 1 opening prompt as usual, appending one line
   inviting the user to point out anything in the digest that no
   longer holds.

v1 scope: this intermediate route is **context injection only** —
per-axis confirmation-type pre-fill (SKILL.md § Brief Pre-read Mode)
is the beginner route only, and this flow presents no per-axis
confirmation questions. The audit chain for brief-confirmed items is
carried by 01a's born-resolved ledger entries in
pending-questions.json.

## Round 1: Free-form Opening

Render the following in `output_language` (currently `ja` — the
template below is the `ja` calibration per § Language Rule) as a
chat message (NOT via `AskUserQuestion`):

```
📍 Round 1/5 — オープンインタビュー (中級者モード)

どんなアプリを考えていますか？ターゲットユーザー・解決したい課題・
主要機能・参考にしているアプリ・制約条件・配信プラットフォーム・
デザイン出力範囲まで、まずは思っていることを自由に話してください。

長さに制限はありません。一気に書いていただいて構いません。
```

### Short-input Re-prompt

If the user's response is < `round_1_min_chars` (= 50) characters
after stripping whitespace, do NOT call Scorer. Render this re-prompt
in `output_language` (template below is current `ja` calibration) as
a chat message and wait for a follow-up reply, then concatenate both
messages as the Round 1 input:

```
もう少し具体的に話してもらえますか？例えば「誰が、どんな場面で、
今どうやって困っていて、何が解決されると嬉しいか」が見えると
設計に落としやすいです。
```

Note: the 50-character threshold is calibrated for `ja` (Japanese
character density). If `output_language` changes, re-calibrate
`round_1_min_chars` to a value that captures the same intent —
"too short to evaluate meaningfully" — in the new language.

Re-prompt at most once. If the second response is still < 50
characters, proceed to Scorer with whatever was provided — the low
readiness score will drive Round 2 to surface the gaps.

## Rounds 2–5: Deep-dive Loop

### Step 1: Mode switch trigger check

Before invoking Scorer, scan the most recent user message (full
text, case-insensitive) for explicit switch triggers. The scan
scope MUST match § Mode Switch Exit → Explicit trigger exactly —
the two locations describe the same scan, not two different scans,
so any future change to scope (e.g., narrowing to last N
characters, or requiring sentence-boundary positions) must be
applied in both places.

See § Mode Switch Exit below for the trigger vocabulary and
post-trigger behavior.

### Step 2: Internal Scorer call

Invoke the prompt in `refs/internal-scorer.md` with this state:

```
{
  "raw_text": "<all rounds concatenated, separated by `---- Round N ----` markers>",
  "previous_scores": <previous round's scores dict, or all-zero for round 1>,
  "previous_missing_slots": <previous round's missing_slots dict, or all-full for round 1>,
  "round_num": <current N>
}
```

Scorer returns strict JSON. Validate the shape against
`refs/internal-scorer.md` § Output Schema; if malformed, retry the
Scorer call once. If still malformed after retry, fall back to
previous_scores unchanged and proceed (do not block the user).

### Step 3: Scoreboard display

Render the scoreboard per `refs/output-templates.md` § In-Progress
format, with a Round header line inserted. The scoreboard is
**always rendered in English** regardless of `output_language` —
this is an explicit exception to § Language Rule, declared as the
cross-project canonical decision in `refs/output-templates.md`
§ Scoreboard (Terminal Display) for universal readability and
emoji-width alignment. See § Language Rule § Exception: Scoreboard
rendering is English-fixed for the full scope.

```
──── Specification Readiness ──── Round 3/5 ────

  Target User    ████████░░   8/10  ✅ Ready
  Problem        ██████░░░░   6/10  ⚠️ Almost
  Features       ████░░░░░░   4/10  ⚠️ Almost
  Competitors    ██░░░░░░░░   2/10  ❌ Weak
  Constraints    ███████░░░   7/10  ✅ Ready
  Platform       █████░░░░░   5/10  ⚠️ Almost
  Design Scope   █░░░░░░░░░   1/10  ❌ Weak

─────────────────────────────────────────────
  Overall: 33/70 (47%)  avg=4.7  →  NOT READY
```

All 7 rows update on every round (this differs from beginner flow
where rows update per axis completion).

### Step 4: Pass check

If the readiness reaches `SHIPPABLE` — overall avg >= 7 AND all
axes >= 4 (per `refs/scoring-criteria.md` § Readiness Threshold,
the project-wide canonical definition shared with beginner flow) —
break the loop and proceed to Axis 7 + Confluence Closed
Confirmation. Display a one-line success message in
`output_language` (template below is current `ja` calibration per
§ Language Rule):

```
✅ readiness が SHIPPABLE 水準に達しました (avg ≥ 7、全軸 ≥ 4)。最終確認に進みます。
```

Note: the SHIPPABLE definition is **identical to beginner flow**
(`skills/01-question/SKILL.md` § Scoring: "All axes must be >= 4
for `SHIPPABLE`. Any axis <= 3 blocks the judgment regardless of
average. Maximum total: 70."). Do NOT impose a stricter
`all axes >= 7` gate here — intermediate flow produces the same
artifact (requirements.json) consumed by the same downstream Phase
1b, so the pass criterion must match.

### Step 5: Max-rounds check

If the current round is round 5 and the pass check did not break,
proceed to the Max-rounds Fallback branch (see § Max-rounds
Fallback below). Skip Step 6.

### Step 6: Question Composer call

Invoke the prompt in `refs/question-composer.md` with the Scorer's
output JSON plus `raw_text` and `round_num`. Composer returns the
rendered question block (up to 3 questions). See
`refs/question-composer.md` § Output Format.

If Composer returns fewer than 3 questions (some axes failed
self-check), that's acceptable — proceed with whatever passed.

### Step 7: Render and await

Send the Composer's output as a chat message (NOT via
`AskUserQuestion`). The exit hint line is included by Composer:

```
（ここから選択肢ベースに切り替えたい場合は「選択肢で」とお伝えください）
```

Await the user's reply. The reply is **Round N's content** — the
user is responding to the Round N questions that Composer just
rendered (the `📍 Round N/5 — Deep-dive` header at the top of the
question block uses the same N, and Composer's Input Contract
defines `round_num` as the same current N — see
`refs/question-composer.md` § Input Contract).

### Step 8: Increment

Append the user's reply to raw_text with the marker
`---- Round N ----` (Round N's content, matching the Round number
Composer used in the question header in Step 7). Then increment N
(the next loop iteration will process index N+1, and its Step 1 /
Step 2 will see raw_text now containing Round N's reply as the
most recent message). Loop back to Step 1.

Canonical round-numbering convention (single source of N across
all three contexts the user pointed at):

| Context | Value of N at iteration N |
|---|---|
| (a) Progress header rendered by Composer in Step 7 | `📍 Round N/5 — Deep-dive` — current iteration |
| (b) raw_text marker appended in Step 8 | `---- Round N ----` — same current iteration |
| (c) Composer's Input Contract `round_num` (refs/question-composer.md) | `<current N, 2..5>` — same current iteration |
| (d) `round_count` in Output Write-back payload (`feasibility_resolved` / `bonus_recommendations_resolved` companion field) | The highest Round number that contributed user content to raw_text. Round 1 (opener) always contributes; each completed Step 8 at iteration N adds Round N. So `round_count` = the N of the last iteration whose Step 8 completed, or `1` if only the opener happened (exited at Step 4 pass before any loop iteration completed Step 8). Range: 1..5. |

Previously, Steps 7-8 used `Round N+1` as the round number for the
user's reply (treating "Round N" as "the questioning session" and
"Round N+1" as "the reply session"). That created an off-by-one
ambiguity with the progress header, raw_text markers, and
`round_num` metadata — all of which used `current N`. The current
text uses `current N` everywhere so the three contexts above
agree.

## Mode Switch Exit

The user can convert the remaining flow to the beginner-mode 7-axis
loop at any point. Two trigger systems run on every round
(Step 1 above) and again whenever a free-form reply arrives.

### Explicit trigger

Scan the user's most recent reply (full text, case-insensitive) for
any of these patterns. This section is the **canonical SoT** for
the explicit trigger scan scope — § Rounds 2–5 § Step 1 (Mode
switch trigger check) refers to this same scope, so any change to
scope (e.g., narrowing to last N characters, or requiring
sentence-boundary positions to reduce domain-term false positives
such as `選択肢` in voting / quiz apps) must be applied here and the
Step 1 description kept in sync.

The patterns below are deliberately specific to keep full-text
scanning low in false positives. Design philosophy:

1. **No bare nouns / adjectives.** Bare tokens like `choice` /
   `choices` / `ガイド` / `ふつうの` / `普通の` / `通常の` were
   removed because they appear naturally in app-domain description
   (e.g. `ガイド機能`, `ユーザーが選択肢を選ぶ`, `普通のユーザー向けに...`,
   `通常の動作で...`) and would cause accidental mode switches.
2. **Prefer compound forms or particle suffixes.** Each remaining
   trigger has at least one of: (a) a mode-name compound
   (`ガイドモード` / `choice mode` / `初心者モード` / `普通モード`),
   (b) a particle suffix indicating switch intent
   (`選択肢で` / `選択肢に` / `ガイドで`), or (c) a strong intent
   prefix (`もう選択肢`).
3. **Command-like phrasing only.** Triggers should read as user
   commands ("switch to X mode" / "let's use X") rather than
   neutral descriptions of features.

If operational data later shows false positives are still a
problem, further tighten by either (a) narrowing the scan scope to
last N characters (e.g. last 100), or (b) requiring sentence-end
or message-end position (boundary checks). Both options require
updating § Step 1 (Mode switch trigger check) in tandem — see the
canonical SoT note at the top of this subsection.

These are INPUT match patterns scanning user replies in
`output_language` (current `ja` calibration); they MUST be
re-translated to the new language if `output_language` changes —
otherwise the explicit trigger silently stops working
(see § Language Rule).

```
選択肢で
選択肢に
選択肢ベース
もう選択肢
ガイドで
ガイドモード
普通モード
通常モード
choice mode
beginner mode
初心者モード
```

When matched, execute the full § Post-trigger behavior sequence
(pre-dispatch Scorer refresh in step 1 → Dispatcher invocation with
the switch-time payload spec'd in step 2 → state transitions in
steps 3–5) and exit to SKILL.md Step 2.

### Implicit trigger (rounds 2–4 only; round 5 handled by Max-rounds Fallback)

At the START of a round (using `previous_scores` accumulated from
prior rounds — the current round's Scorer has not yet run), check
this single condition:

- Condition A: Same axis has scored <= 2 for 3 consecutive prior rounds

This trigger is intentionally NOT evaluated at round 5. The
Max-rounds Fallback (see § Max-rounds Fallback below) handles the
round-5 stuck case after Scorer (Step 5) using fresh round-5 scores
with a more context-specific question. Evaluating both at round 5
would surface near-identical `AskUserQuestion` prompts twice and
confuse the user.

The earliest Condition A can fire is round 4 start (rounds 1, 2, 3
all <= 2 for the same axis — 3 consecutive prior rounds). Therefore
Condition A is effectively evaluated only at round 4 in the current
loop length. (If `max_rounds` is ever increased beyond 5, this
condition continues to apply at all rounds N where N < max_rounds.)

If Condition A fires, ask the user via `AskUserQuestion` (2 options)
whether to switch. The prompt MUST name the specific stuck axis so
the user understands why the switch is being offered (Condition A
is a single-axis-stuck signal — the prompt would mislead if it
implied "multiple axes" or "general progress trouble"). Render the
question text and option labels in `output_language` (template
below is current `ja` calibration per § Language Rule):

```
{stuck_axis_label} の観点で 3 ラウンド連続してスコアが低い (<= 2/10) 状態が続いています。
同じ問いの形では深掘りが進みにくいようなので、選択肢ベースに切り替えて残りを補完しますか？

| Option | 意味 |
|---|---|
| 1 | はい、選択肢ベースに切り替える |
| 2 | いいえ、現状のまま provisional_flags に記録して進める |
```

Template substitution:

| Token | Value |
|---|---|
| `{stuck_axis_label}` | The Japanese axis label of the axis that triggered Condition A. Use the axis label table in `refs/question-composer.md` § Output Format (`target_user` → `ターゲットユーザー`, `problem` → `課題`, `features` → `主要機能`, `competitors` → `競合・参考アプリ`, `constraints` → `制約`, `platform` → `プラットフォーム`, `design_output_scope` → `デザイン出力範囲`). Single label only — Condition A always identifies exactly one axis. |

Edge case: if multiple axes simultaneously satisfy Condition A in
the same round (rare — would require two distinct axes both at <= 2
for 3 consecutive rounds), pick the axis with the lowest score in
the latest `previous_scores`; on tie, use the canonical axis order
`target_user → problem → features → competitors → constraints →
platform → design_output_scope` (same tie-break order as Composer
axis selection in `refs/question-composer.md` § Axis Selection).
This guarantees the prompt always names exactly one axis, keeping
the message accurate and unambiguous.

- Option 1 → execute the full § Post-trigger behavior sequence
  (pre-dispatch Scorer refresh + Dispatcher invocation with the
  switch-time payload + state transitions) and exit to SKILL.md
  Step 2.
- Option 2 → record axes < 4 in provisional_flags, skip to Axis 7 +
  Confluence Closed Confirmation (with current scores frozen)

### Post-trigger behavior

When a trigger fires:

1. **Pre-dispatch Scorer refresh** — ensure `final_scores` and
   `final_missing_slots` reflect the same raw_text content that will
   be sent to Dispatcher. Without this step, the explicit-trigger and
   implicit-trigger Option 1 paths produce a mismatched payload:
   raw_text contains the user's latest reply (which often includes
   new requirements info alongside the trigger keyword), but the
   last Scorer call scored only up through the previous round's
   reply. That mismatch makes Dispatcher's `skip_list` decisions
   inconsistent with `raw_input_draft` content (an axis can be
   skipped while the draft still surfaces newly added info for it).

   Branching by trigger origin:

   | Trigger origin | Scorer state at trigger time | Action |
   |---|---|---|
   | Explicit trigger (§ Step 1) | Scorer for current round has NOT yet run; `previous_scores` is from the prior round and is stale w.r.t. the just-arrived user reply | **Run Scorer once now** on the up-to-date raw_text (same call shape as § Step 2: Internal Scorer call, with `previous_scores` = the same `previous_scores` value Step 1 was about to pass). Use the returned scores / missing_slots as `final_scores` / `final_missing_slots` below. |
   | Implicit trigger Option 1 (§ Step 1) | Scorer for current round has NOT yet run; same staleness as explicit trigger | Same as explicit trigger — run Scorer once on the up-to-date raw_text before dispatching. |
   | Max-rounds Fallback Option 1 (§ Step 5) | Scorer for current round has ALREADY run at § Step 2 using the up-to-date raw_text | Skip the refresh — `final_scores` / `final_missing_slots` are already fresh and paired with raw_text. Reuse the Step 2 output directly. |

   The refresh is idempotent: if it has already run (Max-rounds
   Fallback case), running again would produce the same output, so
   the "skip" decision is purely an optimization to avoid one
   redundant Scorer call.

   If the refresh call returns malformed JSON (same failure mode as
   § Step 2), retry once; if still malformed, fall back to the
   pre-refresh `previous_scores` and proceed with the dispatch
   anyway (do not block the user's switch request on Scorer
   reliability).

2. Invoke `refs/intake-dispatcher.md` with the **full** input payload
   as defined by its § Input Contract. The orchestrator MUST pass all
   of the fields below — partial payloads cause missing or incorrect
   metadata in `raw_input_draft` (round count missing, frontmatter
   mode label drifting, etc.):

   ```json
   {
     "mode": "switch",
     "raw_text": "<all rounds concatenated with `---- Round N ----` markers>",
     "final_scores": { ... 7 axes from the refreshed Scorer call (step 1 above) ... },
     "final_missing_slots": { ... 7 axes from the refreshed Scorer call (step 1 above) ... },
     "axis7_resolved": {},
     "interview_mode_target": "beginner_switched_from_intermediate",
     "round_count": <current N, 1..5>
   }
   ```

   Field-by-field source mapping:

   | Field | Source / value at switch time |
   |---|---|
   | `mode` | Literal `"switch"` (this code path is always switch-time). |
   | `raw_text` | Orchestrator's accumulated raw_text including all rounds up to and including the current user reply that triggered the switch. |
   | `final_scores` | Output of the Pre-dispatch Scorer refresh in step 1 above. Guaranteed paired with the `raw_text` being dispatched. If the refresh fell back due to malformed JSON, the pre-refresh `previous_scores` (stale by one round) is used — note this in the feedback-log (Pattern B). |
   | `final_missing_slots` | Same Scorer call as `final_scores` (paired — never mix scores from one round with slots from another). |
   | `axis7_resolved` | Empty object `{}` at switch time — the closed confirmation step has not run yet. (Dispatcher § Input Contract explicitly allows this in `mode: "switch"`.) |
   | `interview_mode_target` | Literal `"beginner_switched_from_intermediate"` for this path. |
   | `round_count` | Current round number N (1..5) at the moment the trigger fired. |

   Dispatcher returns a `raw_input_draft` (markdown) and a `skip_list`
   (axes already passing the skip condition per Dispatcher § Required
   Slots). See `refs/intake-dispatcher.md` § Mode: "switch" for the
   exact return shape.
3. Set `interview_mode = "beginner_switched_from_intermediate"` in
   the working state (not yet written to disk).
4. Hand control to SKILL.md Step 2 (For each axis 1–7) WITH:
   - The 00-raw-input.md draft loaded as conversation context
   - The skip-list applied: axes in the skip-list are silently
     skipped (no question, score from Dispatcher carried forward)
   - Remaining axes execute the existing opening question + deep-dive
     flow per SKILL.md
5. After all remaining axes complete, SKILL.md continues normally
   (Confluence, final scoreboard, Bonus Recommendations, output
   write). When writing, use the
   `beginner_switched_from_intermediate` mode value.

## Axis 7 + Confluence Closed Confirmation

This is the ONE allowed closed-format step in the intermediate flow.
Reached when the loop passes `SHIPPABLE` (avg >= 7 AND all axes >= 4 per § Step 4) without mode switch, or
when the user chose Option 2 (proceed as-is) at an implicit trigger.

### Step C1: AI estimation pass

Read raw_text and infer values for:

- `platform_combo` (mobile_only / web_only / mobile_and_web)
- `screen_coverage` (must_only / must_and_should / all_features)
- `state_pattern` (default_only / required_4_states / nature_based_extra_states) — 証拠が無ければ `default_only` (既定。初回は追加パターンなしを推奨)
- `mobile_framework` (native / flutter / kmp) — only if
  platform_combo includes mobile
- `legacy_android_xml` (true / false) — only if platform_combo
  includes mobile — 証拠が無ければ `false` (既定は
  Compose のみ、Android View システム XML は legacy opt-in)
- `dual_theme_mode` (true / false)
- `illustration_policy` (pictogram / illustration_character / emoji_casual) — default `pictogram` if no evidence
- `graphic_generation` (ask / skip) — default `ask` if no evidence (AI グラフィック生成ブロック 21a-21g の起動方針。後方互換は「聞く」側に倒す)
- `confluence_parent_id` (extract page ID from URL or raw ID
  mentioned in raw_text)

For each field, also produce a one-line evidence quote from
raw_text justifying the inferred value. If no evidence exists for a
field, set the value to `null` and the evidence to the `output_language`
sentinel meaning "no inference basis" (current `ja` calibration:
`"推定根拠なし"`).

### Step C2: Bulk confirmation

Render the estimation as a chat message (NOT AskUserQuestion) in
`output_language` (template below is current `ja` calibration per
§ Language Rule; quoted user excerpts and bracketed examples are
shown for illustration and are replaced with actual `raw_text`
content at render time):

```
これまでの内容から以下のように理解しました。修正があればお知らせください。

| フィールド | 推定値 | 根拠 |
|---|---|---|
| platform_combo | mobile_and_web | 「PCとスマホ両方で使えると…」 |
| screen_coverage | must_only | 「まずMust機能だけで…」 |
| state_pattern | default_only | (推定根拠なし → 初回は追加パターンなしを既定) |
| mobile_framework | native | 「iOSはSwift、AndroidはKotlinで…」 |
| legacy_android_xml | false | (推定根拠なし → 既定は Compose のみ) |
| dual_theme_mode | false | (推定根拠なし) |
| illustration_policy | pictogram | (推定根拠なし) |
| graphic_generation | ask | (推定根拠なし → 既定 ask) |
| confluence_parent_id | 1234567890 | 「親ページは https://…/3740237924」 |
```

Then use `AskUserQuestion` (2 options, option labels in
`output_language` — current `ja` calibration) as a clean binary
choice. Free-form correction text is NOT collected on this call;
it is collected in a follow-up plain chat message when Option 2 is
chosen, mirroring the two-step pattern in
`refs/document-import.md` § Step 1 (option selection followed by
a plain chat prompt for free-form input).

| Option | Meaning |
|---|---|
| 1 | この理解で正しい (推定不能項目があれば次に個別質問) |
| 2 | 修正したい (この後、修正内容を自由記述で受け取ります) |

Routing:

- **Option 1** → proceed to Step C3.
- **Option 2** → DO NOT call `AskUserQuestion` again to collect the
  correction text. `AskUserQuestion` requires ≥ 2 options and a
  single-input prompt fails with
  `InputValidationError: options too_small` (same constraint as
  `refs/document-import.md` § Step 1). Instead, send a plain chat
  message in `output_language` (template below is current `ja`
  calibration per § Language Rule) and let the user type freely:

  ```
  修正したい点を自由にお書きください（複数行 OK、対象フィールド名が
  分かれば併記してください）。
  ```

  The user's next chat message is treated as `correction_text`.
  Re-run Step C1 with `raw_text + correction_text` as input, then
  redisplay Step C2. Allow up to 2 correction rounds; after the
  third attempt, fall through to Step C3 with whatever fields
  remain resolved.
- **Auto-"Other" with typed text** (the user typed corrections
  directly into `AskUserQuestion`'s auto-appended "Other" slot
  instead of picking Option 2) → normalize to "Option 2 + this
  text": use the typed text as `correction_text` and SKIP the
  follow-up plain chat prompt; proceed directly to re-running
  Step C1 with `raw_text + correction_text`. This avoids forcing
  the user to re-type the same content.
- **Auto-"Other" with empty text** (the user picked "Other" but
  typed nothing) → treat as Option 2 and send the follow-up plain
  chat prompt as described above.

### Step C3: Per-field gap fill

For each field still `null` after Step C2, ask via
`AskUserQuestion` with the SAME enum options used in SKILL.md
§ Axis 7 (sub-axes 7-a through 7-e). Confluence parent page uses
the same prompt as SKILL.md § Confluence Parent Page.

This is the only place in the intermediate flow where the original
closed-format Axis 7 prompts are reused verbatim.

## Feasibility Check (Must / Should features)

This is the intermediate-flow counterpart of SKILL.md § Axis 3 —
Data/API Reality Check. Beginner flow runs the feasibility check
inline per feature; intermediate flow runs it as a single bulk
confirmation here, AFTER the deep-dive loop and AFTER Axis 7 +
Confluence Closed Confirmation but BEFORE Output Write-back. This
placement respects intermediate users' preference for non-intrusive
confirmation (mirroring the C2 bulk-confirmation pattern) while
still enforcing the same `Feasibility Threshold` (70–80% confidence
that a `public_api` or `user_owned_data` path exists) that
SKILL.md mandates.

Could-tier features are exempt (same as beginner flow per SKILL.md
§ Axis 3 § Data/API Reality Check). Bonus Recommendations are
covered by a separate § Bonus Recommendations section below — that
section runs AFTER this Feasibility Check (consuming
`feasibility_resolved` as part of its candidate-generation context)
and BEFORE Output Write-back, and applies the same Feasibility
Threshold via its own Internal Feasibility Screening step.

### Step F1: Must / Should feature extraction

Read `raw_text` (all rounds) and `scorer_output.evidence_quotes.features`
(or the latest Scorer call's features-axis output) to extract every
feature the user named or implied. Apply MoSCoW classification
based on:

- Explicit MoSCoW signals in `raw_text` (e.g., "Must:", "v1 で必ず",
  "あれば嬉しい") — primary signal.
- Scorer's `features` slot fills (`moscow_classification`,
  `must_count`, `must_acceptance_criteria`) and missing slots —
  secondary signal.
- If MoSCoW classification is unclear for a feature, AI proposes a
  tier (default: Must for v1-critical descriptions, Could for
  "nice to have" language). The user gets to correct in Step F3.

Output internal `feature_candidates` list, structured as:

```json
[
  {
    "name": "<feature name as the user phrased it>",
    "tier": "must" | "should" | "could",
    "evidence_quote": "<verbatim raw_text excerpt that introduced this feature>"
  },
  ...
]
```

Filter Could-tier features out of subsequent steps (exempt per
Feasibility Threshold). Must and Should features proceed to F2.

### Step F2: Data / API inference

For each remaining Must / Should feature in `feature_candidates`,
AI infers a plausible data / API source. The inference is concept-
level only (per SKILL.md § Feasibility Threshold: "do not read
full API design docs in"). Output internal `feature_feasibility`
list:

```json
[
  {
    "name": "<feature name>",
    "tier": "must" | "should",
    "inferred_source": "<one-line description of the likely data / API path>",
    "ai_recommendation": "public_api" | "user_owned_data" | "future_plan",
    "ai_rationale": "<one-line reason, e.g. 'OpenWeatherMap free tier covers this' or 'requires private corporate sales data the user has not confirmed'>"
  },
  ...
]
```

The `ai_recommendation` is the AI's best guess at the
Feasibility Threshold (70–80% confidence). The user gets to
override in Step F3.

### Step F3: Bulk confirmation

Render the inferred feasibility table as a chat message (NOT
`AskUserQuestion`) in `output_language` (template below is current
`ja` calibration per § Language Rule). Field labels in the table
stay English-fixed because they encode the canonical enum values
(`public_api` / `user_owned_data` / `future_plan`) shared with
`SKILL.md § Axis 3 — Data/API Reality Check`:

```
各 Must / Should 機能の実現性 (Feasibility Threshold: 70-80% 信頼) を確認します。
判定は AI の推測です。修正があればこの後お知らせください。

| 機能 | tier | 推定データ / API | 判定 | 根拠 |
|---|---|---|---|---|
| {feature_name_1} | Must | {inferred_source_1} | public_api | {rationale_1} |
| {feature_name_2} | Must | {inferred_source_2} | user_owned_data | {rationale_2} |
| {feature_name_3} | Should | {inferred_source_3} | future_plan | {rationale_3} |
...
```

After rendering, use `AskUserQuestion` (2 options) as a clean
binary choice. Free-form correction text is NOT collected on this
call; it is collected in a follow-up plain chat message when
Option 2 is chosen — same two-step pattern as § Step C2 Bulk
confirmation.

| Option | Meaning |
|---|---|
| 1 | この判定で正しい (全機能の判定を確定) |
| 2 | 修正したい (この後、修正内容を自由記述で受け取ります) |

Routing:

- **Option 1** → confirm all rows as-is. Proceed to Step F4.
- **Option 2** → DO NOT call `AskUserQuestion` again. Send a plain
  chat message in `output_language` (current `ja` calibration):

  ```
  修正したい点を自由にお書きください（機能名と希望の判定を併記してください。
  例: 「機能A は public_api じゃなく future_plan にして」「機能B の推定 API は
  OpenWeatherMap じゃなく気象庁公開 API」）。
  ```

  The user's next chat message is treated as `feasibility_correction_text`.
  Re-run Step F2 with `feature_feasibility + feasibility_correction_text`
  as input (AI re-parses to update the table), then redisplay
  Step F3. Allow up to 2 correction rounds; after the third
  attempt, fall through to Step F4 with whatever rows remain
  resolved (rows still ambiguous default to `future_plan` per
  SKILL.md § Axis 3 conservative bias).
- **Auto-"Other" with typed text** → normalize to "Option 2 + this
  text" (same pattern as § Step C2): use typed text as
  `feasibility_correction_text` and skip the follow-up prompt.
- **Auto-"Other" with empty text** → treat as Option 2 and send the
  follow-up plain chat prompt.

### Step F4: Routing to feasibility_resolved

After Step F3 confirms (or max-correction-rounds reached), assemble
the final structured object the orchestrator will pass to Intake
Dispatcher in § Output Write-back. The object name in the dispatcher
payload is `feasibility_resolved`:

```json
{
  "must_features": [
    { "name": "<feature name>", "feasibility": "public_api: <name>" },
    { "name": "<feature name>", "feasibility": "user_owned_data: <description>" }
  ],
  "should_features": [
    { "name": "<feature name>", "feasibility": "public_api: <name>" }
  ],
  "could_features": [
    { "name": "<feature name>" }
  ],
  "future_plans": [
    { "name": "<feature name>", "tier_before_drop": "must" | "should", "reason": "<one-line reason from F2 ai_rationale or user correction>" }
  ]
}
```

Routing rules:

- Features with confirmed `public_api` or `user_owned_data` →
  stay in their tier (`must_features` / `should_features`) with
  `feasibility` annotation in the format
  `{evidence_path}: {detail}` (matches the inline format defined
  in `skills/01-question/SKILL.md` § Axis 3 § Recording rules:
  `{機能名} — {public_api: <name>}` / `{機能名} — {user_owned_data: <source>}`).
- Features with confirmed `future_plan` → moved to `future_plans`,
  with `tier_before_drop` recorded for audit (so retro can
  evaluate "how many Must features were dropped to future_plans?").
- Could-tier features → `could_features` with no feasibility
  annotation (exempt per SKILL.md § Axis 3).

The orchestrator passes `feasibility_resolved` to Intake
Dispatcher; the Dispatcher uses it to:

- Annotate Must / Should features in the `主要機能（MoSCoW）`
  section of `00-raw-input.md` (per Dispatcher § R5 + § R9 — new
  rules added in `refs/intake-dispatcher.md` for this integration).
- Populate `00-raw-input.md` § 将来プラン (実現性未確保) section
  from `future_plans[].name + " — " + reason`.
- Populate `requirements.json → future_plans[]` array (per
  `refs/output-templates.md` requirements.json template and
  `schemas/requirements.schema.json` `future_plans` property).

### Failure modes (Feasibility Check)

| Failure | Recovery |
|---|---|
| F1 finds zero Must / Should features (raw_text describes no concrete features) | Skip F2 / F3 entirely. `feasibility_resolved` is `{"must_features": [], "should_features": [], "could_features": [...], "future_plans": []}`. Proceed to Output Write-back. |
| F2 cannot infer any data / API for a feature | Set `ai_recommendation` = `future_plan`, `ai_rationale` = "データ / API 源を推測できず". User can override in F3. |
| F3 max-correction-rounds (3 attempts) reached with rows still ambiguous | Default ambiguous rows to `future_plan` (conservative bias per SKILL.md § Axis 3). Log a feedback-log entry of Pattern C with the unresolved rows. |
| User reply is empty when expecting `feasibility_correction_text` | Re-render the same correction prompt once; if still empty, accept the current table as-is and proceed to Step F4. |

## Bonus Recommendations

This is the intermediate-flow counterpart of SKILL.md § Bonus
Recommendations (Post-Completion). Beginner flow runs Bonus
Recommendations as a post-completion step (after all 7 axes are
scored). Intermediate flow runs the equivalent here, AFTER the
Feasibility Check and BEFORE Output Write-back. This placement keeps
the post-completion semantics intact while preserving the
intermediate user's bulk-confirmation style.

The Internal Feasibility Screening logic is identical to beginner
flow (per SKILL.md § Bonus Recommendations § "Internal Feasibility
Screening"): candidates that fail the screen are NOT surfaced to
the user, but ARE appended to `future_plans[]` with a brief reason
for audit trail.

### Step B1: Candidate generation

AI generates 3–4 adjacent improvement candidates (the same target
as SKILL.md § Bonus Recommendations: "adjacent improvements the
user likely hasn't thought of. Concrete, derived from the user's
problem and context — not generic"). Input sources:

- `raw_text` (the full 7-axis content the user provided)
- `feasibility_resolved.must_features` / `should_features` (already
  confirmed features to derive adjacency from)
- `axis7_resolved` (platform / scope context to guide what's
  realistically adjacent)

Output internal `bonus_candidates` list, structured as:

```json
[
  {
    "opportunity": "<concise label of the suggested adjacent improvement>",
    "why": "<one-line rationale tying it to the user's problem context>",
    "effort": "S" | "M" | "L"
  },
  ...
]
```

Cap at 4 candidates (per beginner flow rule "Max 4 opportunities —
pick the top 4 if more exist"; `AskUserQuestion` is limited to 4
options per question). If AI produces fewer than 3, still
proceed with whatever count (down to 0, in which case skip to
Output Write-back with empty `bonus_recommendations_resolved`).

### Step B2: Internal Feasibility Screening (silent)

For EACH candidate in `bonus_candidates`, internally check whether a
`public_api` or `user_owned_data` path exists at the Feasibility
Threshold (70–80% confidence) — same screening as SKILL.md
§ Bonus Recommendations § "Internal Feasibility Screening".

The screening is fully internal (no user-facing AskUserQuestion).
Output two structured lists:

```json
{
  "surviving": [
    {
      "opportunity": "<from B1>",
      "why": "<from B1>",
      "effort": "S" | "M" | "L",
      "feasibility": "public_api: <name>" | "user_owned_data: <description>"
    },
    ...
  ],
  "screened_out": [
    {
      "opportunity": "<from B1>",
      "reason": "<one-line reason why feasibility path was not established>"
    },
    ...
  ]
}
```

Routing per SKILL.md § Bonus Recommendations:

- `surviving` candidates → proceed to Step B3 (user-facing selection)
- `screened_out` candidates → NOT surfaced to the user, BUT
  preserved for audit trail. They will be routed to
  `bonus_recommendations_resolved.screened_out` in Step B4 and
  ultimately merged into `future_plans[]` by the Dispatcher
  (per `refs/intake-dispatcher.md` § R10 — updated to handle this
  source). This mirrors beginner flow's "Candidates that fail the
  screen are not surfaced to the user, but are still appended to
  `requirements.json → future_plans[]` with a brief reason".

If `surviving` is empty, skip Step B3 (no user-facing selection
needed) and pass directly to Step B4 with `accepted` = `[]` and
`screened_out` populated from this step.

### Step B3: User-facing selection

Render the `surviving` list as a chat message in `output_language`
(template below is current `ja` calibration per § Language Rule),
followed by an `AskUserQuestion` with `multiSelect: true`. The
format matches SKILL.md § Bonus Recommendations § "Format each
surviving recommendation as":

```
以下の Bonus Recommendations はあなたの課題に隣接する追加アイデアです。
仕様に含めるものを選んでください。選ばなかったものは記録されません。

1. {opportunity_1} — {why_1}
   Feasibility: {feasibility_1}
   Effort: {effort_1}

2. {opportunity_2} — {why_2}
   Feasibility: {feasibility_2}
   Effort: {effort_2}

...
```

Then use `AskUserQuestion` with `multiSelect: true` and each
candidate as an option:

| Option index | Label | Description |
|---|---|---|
| 1 | `{opportunity_1}` (concise) | `{why_1}` / Feasibility / Effort condensed |
| 2 | `{opportunity_2}` | ... |
| ... | ... | ... |

`AskUserQuestion` auto-appends an "Other" option. Treat "Other"
selections the same as for the bulk-confirmation pattern in § Step
C2 / § Step F3: if the user types text into Other, normalize it to
"manual addition" by parsing the text as a free-form
recommendation (caveat: no Internal Feasibility Screening is run
on user-typed Other text — the user explicitly opted in, so trust
their judgment, but log a feedback-log entry of Pattern C to flag
that the user added a non-screened candidate for retro review).

### Step B4: Routing to bonus_recommendations_resolved

After Step B3 completes (or B2 short-circuited with empty
surviving), assemble the final structured object the orchestrator
will pass to Intake Dispatcher in § Output Write-back. The object
name in the dispatcher payload is `bonus_recommendations_resolved`:

```json
{
  "accepted": [
    {
      "opportunity": "<from surviving>",
      "why": "<from surviving>",
      "effort": "S" | "M" | "L",
      "feasibility": "public_api: <name>" | "user_owned_data: <description>"
    },
    ...
  ],
  "screened_out": [
    {
      "opportunity": "<from B2 screened_out>",
      "reason": "<from B2 screened_out>"
    },
    ...
  ]
}
```

Routing rules:

- Accepted (user picked in B3 multiSelect) → kept in `accepted` as
  selected. Per SKILL.md § Bonus Recommendations: "Selected items
  default to Should priority (no follow-up question)". The
  Dispatcher renders them in the `## Recommendations` section of
  `00-raw-input.md` (per `refs/intake-dispatcher.md` § R11 — new)
  and appends free-text strings to
  `requirements.json → recommendations_accepted[]` in the format
  `{opportunity} — {feasibility}` (matching SKILL.md's format).
- Non-selected surviving candidates → discarded entirely (per
  SKILL.md § Bonus Recommendations: "Non-selected items are not
  recorded"). They do NOT enter `accepted`, `screened_out`, or
  any other artifact. This is a deliberate beginner-flow rule —
  surviving-but-not-picked is treated as the user actively
  rejecting an idea worth proposing.
- Screened-out (B2 failures) → `screened_out` array. The
  Dispatcher merges these with `feasibility_resolved.future_plans`
  when producing the `## 将来プラン (実現性未確保)` section of
  `00-raw-input.md` and the `requirements.json → future_plans[]`
  array (per `refs/intake-dispatcher.md` § R10 — updated to
  handle this source).
- User-typed Other (Step B3) → added to `accepted` with
  `feasibility: "user_manual_addition"` sentinel value to flag
  this is a non-screened user override. Dispatcher renders it
  per § R11 but without the standard feasibility annotation
  format (uses the sentinel verbatim).

### Failure modes (Bonus Recommendations)

| Failure | Recovery |
|---|---|
| B1 produces zero candidates (AI cannot find adjacent improvements) | `bonus_recommendations_resolved` = `{"accepted": [], "screened_out": []}`. Proceed to Output Write-back. Log feedback-log Pattern C noting "B1 zero candidates" for retro (may indicate user context too narrow). |
| B2 screens out ALL candidates (all fail Feasibility Threshold) | `accepted` = `[]`, `screened_out` populated with all. Skip B3. Proceed to Output Write-back. |
| B3 multiSelect returns zero selections (user picked none, no Other text) | `accepted` = `[]`, `screened_out` populated per B2. This is a valid outcome — user reviewed and rejected all. Proceed to Output Write-back. |
| B3 user picks Other with empty text | Treat as "no Other input"; proceed with whatever standard options were picked. |
| Cross-validation: `bonus_candidates` (B1) count != `surviving + screened_out` (B2) count | Indicates B2 dropped or duplicated candidates. Re-run B2 once; if still inconsistent, fall back to surfacing all B1 candidates without screening (set `screened_out` = `[]`) and log feedback-log Pattern B noting the inconsistency. |

## Output Write-back

When the closed confirmation completes, write the same three files
as the beginner flow (`refs/output-templates.md`):

1. `artifacts/{app_name}/requirements/00-raw-input.md`
2. `artifacts/{app_name}/requirements.json`
3. `artifacts/{app_name}/feedback-log.md`

Use the Intake Dispatcher (`refs/intake-dispatcher.md`) to convert
raw_text into the 7-axis sectioned 00-raw-input.md content. The
Dispatcher is reused here in non-switch mode; the same prompt
serves both switch-time and write-time invocations, differing only
in the input payload.

Invoke the Dispatcher with the **full** input payload as defined by
its § Input Contract:

```json
{
  "mode": "write",
  "raw_text": "<all rounds concatenated with `---- Round N ----` markers>",
  "final_scores": { ... 7 axes from latest Scorer call ... },
  "final_missing_slots": { ... 7 axes from latest Scorer call ... },
  "axis7_resolved": {
    "platform_combo": "<resolved enum>",
    "screen_coverage": "<resolved enum>",
    "state_pattern": "<resolved enum>",
    "mobile_framework": "<resolved enum or omitted if platform_combo == web_only>",
    "legacy_android_xml": <true | false; omitted if platform_combo == web_only>,
    "dual_theme_mode": <true | false>,
    "illustration_policy": "<pictogram | illustration_character | emoji_casual>",
    "graphic_generation": "<ask | skip>",
    "confluence_parent_id": "<page id or null>"
  },
  "feasibility_resolved": {
    "must_features": [
      { "name": "<feature name>", "feasibility": "public_api: <name>" }
    ],
    "should_features": [
      { "name": "<feature name>", "feasibility": "user_owned_data: <description>" }
    ],
    "could_features": [
      { "name": "<feature name>" }
    ],
    "future_plans": [
      { "name": "<feature name>", "tier_before_drop": "must" | "should", "reason": "<one-line reason>" }
    ]
  },
  "bonus_recommendations_resolved": {
    "accepted": [
      {
        "opportunity": "<concise label>",
        "why": "<one-line rationale>",
        "effort": "S" | "M" | "L",
        "feasibility": "public_api: <name>" | "user_owned_data: <description>" | "user_manual_addition"
      }
    ],
    "screened_out": [
      { "opportunity": "<concise label>", "reason": "<why feasibility path was not established>" }
    ]
  },
  "interview_mode_target": "intermediate",
  "round_count": <final N, 1..5>
}
```

Field-by-field source mapping (orchestrator → Dispatcher input):

| Field | Source / value at write time |
|---|---|
| `mode` | Literal `"write"`. |
| `raw_text` | Orchestrator's accumulated raw_text covering all completed rounds. |
| `final_scores` / `final_missing_slots` | Most recent Scorer output (from the round that triggered the pass check at § Step 4, or the last round before § Max-rounds Fallback Option 2). Always paired. |
| `axis7_resolved` | The 6 enum fields (`platform_combo` / `screen_coverage` / `state_pattern` / `mobile_framework` / `illustration_policy` / `graphic_generation`), the 2 boolean flags (`legacy_android_xml` / `dual_theme_mode`), and `confluence_parent_id` resolved by § Axis 7 + Confluence Closed Confirmation (Steps C1–C3). All fields MUST be populated (no `null` enum values at this point); `mobile_framework` and `legacy_android_xml` are omitted entirely when `platform_combo == "web_only"`. |
| `feasibility_resolved` | The structured Feasibility Check output produced by § Feasibility Check Step F4. All four sub-arrays (`must_features` / `should_features` / `could_features` / `future_plans`) MUST be present; any of them may be empty `[]`. See § Feasibility Check § Step F4 for the field shape and routing rules. |
| `bonus_recommendations_resolved` | The structured Bonus Recommendations output produced by § Bonus Recommendations Step B4. Both sub-arrays (`accepted` / `screened_out`) MUST be present; either may be empty `[]`. The `feasibility` field on each `accepted` entry uses `public_api: <name>` / `user_owned_data: <description>` for standard candidates and the sentinel `user_manual_addition` for user-typed Other entries. See § Bonus Recommendations § Step B4 for the field shape and routing rules. |
| `interview_mode_target` | Literal `"intermediate"` (this write path is reached only when no mode switch occurred). |
| `round_count` | Final round number reached (1..5). |

Payload field → produced section of `00-raw-input.md` (Dispatcher
output): the orchestrator MUST pass every field in the payload
above, because each one drives a specific section of the draft.
Omitting any field leaves the corresponding output empty or
incorrect — for example, omitting `round_count` causes the
`**ラウンド数:**` line to render as `?/5` (see Dispatcher § Edge
Cases), and omitting `interview_mode_target` makes the
`**ヒアリングモード:**` line undefined.

| Payload field | Drives this part of `00-raw-input.md` | Dispatcher rule |
|---|---|---|
| `interview_mode_target` | Frontmatter `**ヒアリングモード:** {label}` line | § Raw_input_draft Generation Rules § R8 (mode metadata at top); label mapping defined in § Required Slots → labels table |
| `round_count` | Frontmatter `**ラウンド数:** {N}/5` line | § Raw_input_draft Generation Rules § R8 |
| `raw_text` | Bodies of the 7 axis sections (ターゲットユーザー / 課題 / 主要機能 / 競合・参考アプリ / 制約 / プラットフォーム / デザイン出力範囲) | § R1–R3 (section assignment / time-ordered / verbatim preservation) |
| `final_missing_slots` | `（未確認: ...）` annotation appended to each axis section | § R4 |
| `final_scores` | Determines whether `final_missing_slots` is dispatched at all (slots already satisfied per scores produce empty annotations); used in `mode: "switch"` for skip_list but available in `mode: "write"` for consistency | § R4 indirectly |
| `axis7_resolved` | Body of the `デザイン出力範囲` section (platform_combo / screen_coverage / etc.) and `Confluence 保存先` section | § R6, § R7 |
| `feasibility_resolved.must_features` / `should_features` / `could_features` | `主要機能（MoSCoW）` section — each feature rendered as `{機能名} — {feasibility}` for must/should (per SKILL.md § Axis 3 § Recording rules format), bare `{機能名}` for could | § R5 (MoSCoW sub-sections), § R9 (new: feasibility annotation rule) |
| `feasibility_resolved.future_plans` | `将来プラン（実現性未確保）` section — together with `bonus_recommendations_resolved.screened_out`, merged into one section per § R10 (updated to handle both sources). `requirements.json → future_plans[]` array populated from both sources. | § R10 (updated: merges feasibility drops + bonus screening drops) |
| `bonus_recommendations_resolved.accepted` | `## Recommendations` section — each entry rendered as `- {opportunity} — {why}` followed by `Feasibility: {feasibility}` / `Effort: {effort}` (or condensed inline). `requirements.json → recommendations_accepted[]` array populated with free-text strings `{opportunity} — {feasibility}` per SKILL.md § Bonus Recommendations § Rules. | § R11 (new: Recommendations section + recommendations_accepted rendering) |
| `bonus_recommendations_resolved.screened_out` | Merged into `将来プラン（実現性未確保）` section alongside `feasibility_resolved.future_plans`. `requirements.json → future_plans[]` array also receives these entries. | § R10 (updated to handle this source) |
| `mode` | Selects which of § Mode: "switch" vs § Mode: "write" Dispatcher logic runs (no `skip_list` returned in `"write"`) | § Modes |

Dispatcher returns `raw_input_draft` only (no `skip_list` in
`mode: "write"`). The orchestrator writes the returned markdown
directly to `artifacts/{app_name}/requirements/00-raw-input.md`.
See `refs/intake-dispatcher.md` § Mode: "write" for the exact
return shape.

`requirements.json → interview_mode` is `intermediate` for this
non-switch path. The frontmatter `**ヒアリングモード:**` and
`**ラウンド数:**` lines in `00-raw-input.md` are produced by the
Dispatcher per the payload mapping above — the orchestrator does
NOT write them directly.

## Max-rounds Fallback

When round 5 ends without reaching `SHIPPABLE` (avg >= 7 AND all axes >= 4 per § Step 4), present a final fork via
`AskUserQuestion` (2 options). Render the question text and option
labels in `output_language` (template below is current `ja`
calibration per § Language Rule):

```
5 ラウンドの自由記述で詰めきれなかった軸があります。
どう進めますか？

| Option | 意味 |
|---|---|
| 1 | 選択肢ベースで残りを補完する (推奨) |
| 2 | このまま provisional_flags に記録して終了する |
```

- Option 1 → execute the full § Post-trigger behavior sequence
  (NOTE: at Max-rounds Fallback, the pre-dispatch Scorer refresh
  in step 1 is a no-op because Scorer already ran fresh at § Step 2
  of this round — see the branching table there). Then exit to
  SKILL.md Step 2 (same as explicit trigger path). Final mode =
  `beginner_switched_from_intermediate`.
- Option 2 → axes < 4 go into provisional_flags, proceed to Axis 7
  + Confluence closed confirmation, write with mode =
  `intermediate`.

## Failure Modes

| Failure | Recovery |
|---|---|
| Scorer returns malformed JSON | Retry once; if still malformed, carry previous_scores forward |
| Composer returns 0 valid questions after self-check | Fall back to a single question on the axis with lowest score, hand-crafted in `output_language` (current `ja` calibration: `"{evidence_quote} について、もう少し詳しく教えてください。"` — re-calibrate per § Language Rule if `output_language` changes) |
| User reply is empty (0 chars) | Re-render the same Composer output once; if still empty, fall through to Mode Switch Exit confirmation |
| Axis 7 estimation yields all null | Skip C2, go directly to C3 (per-field gap fill) for all 5 fields |

## Resources

- Internal Scorer prompt: [internal-scorer.md](internal-scorer.md)
- Question Composer prompt: [question-composer.md](question-composer.md)
- Intake Dispatcher prompt: [intake-dispatcher.md](intake-dispatcher.md)
- Shared scoring criteria: [scoring-criteria.md](scoring-criteria.md)
- Output templates: [output-templates.md](output-templates.md)
