# Question Composer Prompt (Open Interview Mode)

Stage B of the two-stage per-round inference in
`refs/open-interview.md`. Consumes the Scorer's strict JSON and
produces up to 3 open-ended follow-up questions for the user. The
rendered output is sent directly to the user as a chat message.

## Language Rule

This file is written in English. All user-facing output produced
by Composer — the rendered question block body (axis labels in
each line + the question text after the colon) and the mode-switch
hint line — MUST be rendered in the language defined by
`pipeline.yaml → output_language` (currently `ja`). This matches
the convention in `skills/01-question/SKILL.md` § Language Rule.

The Hard Constraint forbidden / required question shapes (HC1, HC6),
the Output Format template, the axis label table, and the
Trigger-aware question angles table below all show literal `ja`
strings. They are kept in `ja` because they are calibrated against
real user answers, which arrive in `output_language` — the same
calibration pattern used by `refs/scoring-criteria.md` anchor
examples and `skills/01-question/SKILL.md`'s vague-input match
patterns.

### Exception: Progress indicator header is English-fixed

The `📍 Round N/5 — Deep-dive` header line at the top of the
rendered question block is an explicit exception to the
`output_language` rule. It is **always rendered in English**
regardless of `output_language`, following the project-wide
convention that the `📍 {Phase} — {short label}` progress
indicator is a structural marker rather than narrative content.

Supporting precedent:
- `skills/01-question/SKILL.md` § Progress Display defines the
  same `📍 ... — ...` format with all English examples
  (`📍 Opening — mode selection`, `📍 Axis 1/7: Target User`,
  `📍 Axis 3/7: Features — Deep-dive 1/2`, etc.).
- `refs/open-interview.md` § Step 3 Scoreboard inserts a
  `Round 3/5` round-header variant in English (per the
  scoreboard English-fixed exception in that file's Language
  Rule).
- `refs/open-interview.md` Round 1 opener uses
  `📍 Round 1/5 — オープンインタビュー (中級者モード)`, where the
  `📍 Round N/5 — ` prefix is English and only the narrative
  after the em-dash follows `output_language`. Composer's
  `📍 Round N/5 — Deep-dive` header is the round-2..5 counterpart
  of that opener prefix; the trailing `Deep-dive` is the structural
  label (same role as `オープンインタビュー (中級者モード)` in Round 1
  but for the deep-dive rounds), not narrative — keep it English.

If `output_language` ever switches to a non-`ja` value:
- The `📍 Round N/5 — Deep-dive` header stays English (this
  exception persists).
- The question block body (axis labels, question text, exit hint)
  MUST be re-calibrated to the new language per the main Language
  Rule above.

If a future decision overrides the progress-indicator-English-fixed
convention (e.g., switching to localized progress markers for a
non-`ja` deployment), the change MUST be applied in
`skills/01-question/SKILL.md` § Progress Display first (the
project-wide canonical SoT for the `📍 ... — ...` format), and
only then mirrored here and in `refs/open-interview.md`.

### Re-calibration scope

If `output_language` is ever switched to a non-`ja` value, the
literal patterns, axis labels, forbidden / required shape examples,
and trigger-aware angle examples in this file MUST be re-calibrated
to the new language before the intermediate flow is used in
production (the progress indicator header exception above is NOT
included). The Hard Constraints themselves (semantic rules — no
yes/no, no enumeration, scene-based, single-slot focus, etc.) are
language-agnostic and remain unchanged.

## Activation

Invoked by open-interview.md at Round N (N >= 2) Step 6. Skipped at
Round 1 (Round 1 uses the fixed free-form opener) and skipped at
Round 5 when the Max-rounds Fallback branch is taken.

## Input Contract

```json
{
  "scorer_output": { ... full JSON from refs/internal-scorer.md },
  "raw_text": "<all rounds concatenated>",
  "round_num": <current N, 2..5>
}
```

## Task

1. From `scorer_output.scores`, select up to 3 weakest axes.
2. For each selected axis, generate exactly 1 open-ended question
   honoring all Hard Constraints below.
3. Run the Self-Check (see below) on each question. Regenerate ONCE
   per failing question. If still failing after one regen, drop that
   axis from the output.
4. Render the final question block per § Output Format.

## Axis Selection

Sort axes by `scorer_output.scores[axis]` ascending. Tie-break by
the canonical 7-axis order:

```
target_user → problem → features → competitors →
constraints → platform → design_output_scope
```

Take the first 3. If fewer than 3 axes have score < 7, only include
axes with score < 7 (no need to ask about already-passing axes).

If all 7 axes have score >= 7, this stage should not have been
invoked — open-interview.md's pass check (Step 4) handles that case.
Return empty output if this happens.

## Hard Constraints

A generated question MUST satisfy ALL of these. Violation triggers
a regeneration attempt (max 1 per question).

### HC1: No yes/no format

Forbidden question shapes:

- Ends with a binary `〜ですか？` that admits only yes / no
- "A か B か" / "A か B か C か" enumerations
- "いくつか思い当たることはありますか" (forces a list-or-deny)

Required question shapes (in `output_language`; examples shown in
current `ja` per § Language Rule):

- `どんな〜` (what kind of)
- `どの場面で〜` (in what situations)
- `今は〜どうしていますか` (how do you currently)
- `もし〜だとしたら` (if X, then)
- `なぜ〜` (why) — use sparingly, prefer scene-based forms

### HC2: No multi-choice presentation

Do NOT enumerate "1, 2, 3" options inside the question text. The
intermediate flow forbids closed-format prompts during the loop.

### HC3: Slot label citation

Each question MUST address at least one slot label from
`scorer_output.missing_slots[axis]`. The slot drives WHAT to ask;
the trigger drives HOW to ask. If `missing_slots[axis]` is empty
(score >= 7), this axis shouldn't be selected — but if it is, fall
back to the trigger_hits or the lowest-scoring sub-aspect.

### HC4: Noun citation from evidence_quote

The question MUST quote at least one concrete noun from
`scorer_output.evidence_quotes[axis]`. "Concrete noun" = a noun
that names a specific thing in the user's domain (e.g. "営業職",
"GPS座標", "昼休み"). Generic nouns ("アプリ", "機能", "ユーザー")
do NOT count.

#### Fallback chain (canonical SoT for HC4 relaxation)

The fallback chain below is the **only** way HC4 may be relaxed.
Composer MUST attempt steps in order and stop at the first one
that succeeds. Length-of-`raw_text` alone is NOT a valid
relaxation trigger — even a short `raw_text` can contain a
quotable concrete noun, and conversely a long `raw_text` may have
no concrete noun for a given axis.

1. **Primary**: Cite a concrete noun from
   `evidence_quotes[axis]` (the axis being asked about).
2. **Fallback 1**: If `evidence_quotes[axis]` is empty OR contains
   only generic nouns, cite a noun from another axis's
   `evidence_quote` that thematically connects. Composer chooses
   the most relevant cross-axis link.
3. **Fallback 2**: If no concrete noun exists anywhere in
   `evidence_quotes` (all axes empty or generic-only), emit a
   slot-only question (HC3 still applies — at least one slot label
   from `missing_slots[axis]` must be addressed). This case is the
   sole HC4 relaxation; Self-Check C4 PASSes with a warning per
   the rule in § Self-Check.

The fallback is path-dependent: Composer enters Fallback 2 ONLY
after both Primary and Fallback 1 fail. Composer MUST NOT skip
ahead based on heuristics like `raw_text` length.

### HC5: Length limit

≤ 80 characters per question (counted in the rendered
`output_language`; the 80-char limit is calibrated for current `ja`
and may need adjustment if `output_language` changes). Long
questions cause intermediate users to skim and answer partially.

### HC6: Scene-based, not meta

Forbidden:

- "ターゲットユーザーをもっと具体的に教えてください" (meta about the axis name)
- "もう少し詳しく教えてください" (no concrete angle)
- "他に何かありますか" (open-ended-vacuum)

Required:

- Quote a noun from evidence_quote
- Anchor in a time / place / situation
- Single-slot focus (do NOT combine 2 slots into one question with
  "かつ" or "と")

## Output Format

Render the following as a single chat message. The header line is
**English-fixed** regardless of `output_language` (per § Language
Rule § Exception: Progress indicator header is English-fixed). The
question block body and the exit hint line follow `output_language`
(currently `ja`; the template below shows the `ja` calibration per
§ Language Rule). Use plain prose / markdown — NOT
`AskUserQuestion`.

```
📍 Round {N}/5 — Deep-dive                                   ← English-fixed header (do NOT translate)

1. **{axis_label}**: {質問本文}                                ← body: axis label + question in output_language
2. **{axis_label}**: {質問本文}                                ← body: same
3. **{axis_label}**: {質問本文}                                ← body: same

（ここから選択肢ベースに切り替えたい場合は「選択肢で」とお伝えください） ← exit hint in output_language
```

Axis labels in the current `output_language` (= `ja`). Use exactly
these strings while `output_language == "ja"`; if `output_language`
changes, re-calibrate per § Language Rule.

| axis key | Axis label (current `ja` calibration) |
|---|---|
| target_user | ターゲットユーザー |
| problem | 課題 |
| features | 主要機能 |
| competitors | 競合・参考アプリ |
| constraints | 制約 |
| platform | プラットフォーム |
| design_output_scope | デザイン出力範囲 |

If a question is dropped after self-check failure, output fewer
items (no placeholder). If zero questions remain after self-check
(extreme case), output:

```
📍 Round {N}/5 — Deep-dive

（自動生成した質問が品質基準を満たさなかったため、フォールバック質問を提示します）

1. **{lowest-score axis label}**: 「{evidence_quote}」について、もう少し具体的に教えてください。

（ここから選択肢ベースに切り替えたい場合は「選択肢で」とお伝えください）
```

## Self-Check

Before emitting the final output, evaluate each question against the
following internal checks. Each FAIL triggers ONE regeneration
attempt for that question; FAIL on regen drops the question.

| Check | Pass criterion |
|---|---|
| C1 | HC1 not violated (no yes/no) |
| C2 | HC2 not violated (no enumeration) |
| C3 | HC3 satisfied (at least 1 missing_slots label addressed) |
| C4 | HC4 satisfied per its § Fallback chain. Two PASS modes: (a) **noun-cited mode** — verify the cited noun actually appears in `raw_text` (substring match against `evidence_quotes` source content); otherwise it's a hallucination → FAIL. (b) **slot-only fallback mode** — Composer entered HC4 § Fallback 2 because no concrete noun exists anywhere in `evidence_quotes`; the question has no noun citation by design → PASS with a warning logged (the warning is internal; do NOT surface to the user). Slot-only mode is allowed ONLY when both HC4 Primary and Fallback 1 genuinely fail — Composer MUST NOT use slot-only mode as a shortcut to skip noun citation. |
| C5 | HC5 satisfied (length ≤ 80 chars) |
| C6 | HC6 satisfied — no axis-name meta phrasing |
| C7 | Single-slot focus (no "かつ", "および", "そして" connecting multiple slots into one question) |

Self-check is internal. Do not emit the check results to the user.

## Trigger-aware question angles

When `scorer_output.trigger_hits[axis]` contains a hit, prefer the
following angles (derived from `scoring-criteria.md` § Deep-dive
triggers per axis):

| Trigger | Preferred angle |
|---|---|
| `vague_qualifiers` | Ask for the specific instance behind the vague phrase |
| `age_range_only` | "その人は 1 日のどんな瞬間にこのアプリを開きそうですか？" pattern |
| `inconvenient_no_workaround` | "今はどうしていますか？" pattern |
| `would_be_nice` | "解決されると何が変わりますか？" pattern |
| `everything_is_must` | "もし v1 で 1 つだけしか実装できないとしたら、どれですか？" pattern |
| `standard_features` | "どのアプリの どの機能 を念頭においていますか？" pattern |
| `preferably_x` | "それは Must ですか、Could ですか？" — rephrased open (situation / impact / alternative): "それが無い場合、ユーザーはどの場面でどう代替しますか？" |
| `something_similar_vague` | "具体的にはどのアプリですか？" pattern |
| `no_competitors` | "近い領域で参考にしているサービスは？" pattern |
| `everything_in_one_month` | "その期間で本当に必要な最小限は何ですか？" pattern |
| `all_undecided` | "現時点で最も確からしい仮置きの値は？" pattern |
| `both_no_priority` | "どちらを先に出しますか？" — rephrased open: "どちらの利用者が早く必要としますか？" |
| `web_no_responsive` | "モバイルでも使いますか？" — rephrased open (scene-based, aspects of responsive_need slot): "モバイルでこのアプリを開くのは、どんな場面・どの端末・どんな利用中の制約のもとですか？" (場面 / 端末 / 制約 are example aspects; pick the most informative based on raw_text) |
| `all_undecided_d7` | "Phase 3 で何を作るかが固まらないと進めません。最小限のスコープでよければ何を残しますか？" pattern |
| `admin_web_no_rationale` | "管理者と一般ユーザーの利用比率はどんなイメージですか？" pattern |
| `scope_balloon_risk` | "制約に対してスコープが大きい可能性があります。優先度の低い機能を後回しにできますか？" pattern |

Pick at most ONE preferred angle per question (combining angles
violates C7 single-slot focus).

## Behavior on Edge Cases

| Condition | Behavior |
|---|---|
| `scorer_output.scores` all >= 7 | Return empty output (orchestrator handles via pass check) |
| `scorer_output.evidence_quotes` all empty (or all generic-only) | Enter HC4 § Fallback 2 (slot-only mode): emit slot-only questions; Self-Check C4 PASSes in slot-only fallback mode per § Self-Check. This is the canonical relaxation path — `raw_text` length is NOT a separate trigger (see HC4 § Fallback chain). |
| `round_num` >= 6 (out of range) | Return empty output; orchestrator should have already exited via max_rounds fallback |

## Cross-reference

- Stage A (Scorer): [internal-scorer.md](internal-scorer.md)
- Orchestrator: [open-interview.md](open-interview.md)
- Deep-dive triggers (anchor source): [scoring-criteria.md](scoring-criteria.md)
