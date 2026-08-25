---
name: 00-memory-load
description: 各 Phase の開始時にユーザーメモリと関連するプロジェクト履歴を読み込む共通スキル。Phase 固有ステップを実行する前に、全 Phase の preamble から呼ばれる。
---

# 00: Memory & History Load

## Role
Load user memory and relevant project history at the start of any phase.
Called from every phase preamble before executing phase-specific steps.

## Execution

0. **CWD normalization** — run via Bash before any file reads:
   ```bash
   find . -maxdepth 3 -name "pipeline.yaml" 2>/dev/null | head -1
   ```
   - Result is `./pipeline.yaml` → proceed normally (`{repo_root}` = `.`)
   - Result is a deeper path (e.g. `./work/ayatori/pipeline.yaml`) → set `{repo_root}` to that directory; prepend `{repo_root}/` to all `artifacts/*` and `skills/*` paths used in this phase
   - Result is empty → display: `"⚠ pipeline.yaml not found within 3 directory levels. Run this skill from the ayatori/ repository root."` → stop.

1. If `user/AYATORI_MEMORY.md` exists: Read it and apply user preferences
   (design choices, environment settings, recurring patterns, emoji policy, etc.)

2. If `artifacts/history/index.md` exists:
   - Read the index table to identify the 1–2 past projects most similar to the current one by category
   - Read those `artifacts/history/{past-app-name}-summary.md` files
   - Apply any "次回類似アプリへの推奨事項" to improve question quality, rubric focus, and design decisions

3. If `artifacts/{app_name}/product-specs/` exists: Read all files inside it.
   These contain persistent product knowledge that carries across sessions (brand guidelines, fixed constraints, etc.)

If none of the above files exist (first ever run): proceed without any memory — this is expected.

## Standing Rules (active for the rest of this phase)

**Output language (scope-limited):**
Only the following MUST be written in `pipeline.yaml` → `output_language` (default: `ja`):
- Deliverables written to disk (`artifacts/**/*.md`, Confluence pages, Figma text labels)
- Direct user-interaction prompts (AskUserQuestion messages, approval gate text, error messages the user sees)

Everything else — agent reasoning, progress narration, tool invocation summaries, intermediate logs — SHOULD use English for maximum LLM comprehension and cross-agent consistency.

Rationale: LLM instruction-following is most reliable in English. The `output_language` constraint applies only at the human-consumer boundary.

**On-demand memory ("remember this"):**
If the user says "覚えておいて", "remember this", or equivalent at any point during this phase:
immediately append the specified information to `user/AYATORI_MEMORY.md` — do not wait until retro.

**Early exit:**
If the user explicitly ends the session early ("今日はここまで", "一旦止めて", "stop here", etc.):
Read and execute `skills/00-early-exit/SKILL.md` before the conversation ends.

**`AskUserQuestion` options minimum:**
`AskUserQuestion` requires **≥ 2 options** per question (an automatic
"Other" slot is added by the runtime — do not count it). Calling it with
0 or 1 explicit option returns
`InputValidationError: options too_small (minimum: 2)`.

If you only need a single free-form input from the user (e.g. a file
path, a URL, raw pasted text), do NOT call `AskUserQuestion` with one
option as a workaround. Instead, send a plain chat message asking the
user to type the answer in their next reply, and consume that next
message directly. Reserve `AskUserQuestion` for genuine 2–4 way choices.

**`AskUserQuestion` text encoding (non-ASCII):**
Write every user-visible string passed to `AskUserQuestion`
(`question` / `header` / option `label` / option `description`) as
**literal UTF-8 characters** — exactly the way text is written into
files with `Write`. Never encode Korean / Japanese / other non-ASCII
text as `\uXXXX` escape sequences: hand-assembled escapes silently
corrupt CJK / Hangul syllables into valid-but-wrong characters, and the
user receives a garbled question. This rule applies to any tool
parameter that carries user-visible text.

- Re-read the composed question text once before sending; if any
  fragment reads as broken or nonsensical, rewrite it first.

**`AskUserQuestion` presentation (context in chat, question kept short):**
Corruption probability rises with text length and with the number of
questions assembled in one call, so `question` / `header` / option
`label` / `description` must all stay short (one sentence; labels a few
words). But a short question alone gives the user nothing to judge
with — so the two halves of this rule always go together:

- **Immediately before** the `AskUserQuestion` call, send a plain chat
  message that identifies the subject of each question: which feature /
  screen / item it concerns, what was assumed or detected, and what the
  user is being asked to decide. This chat message is the carrier for
  all background and rationale.
- The `AskUserQuestion` text itself carries only the decision point
  (short question + short options). Never move the background into the
  question or option descriptions to "save a message".
- This applies to every `AskUserQuestion` use — human gates, hearing
  questions, pre-flight batches alike.

**Decision batching (ask together what is decidable together):**
Human response latency dominates pipeline wall-clock time, so one
round-trip per question is the most expensive way to ask. Before asking
the user anything, collect every decision point that is already
decidable at that moment and present them in ONE exchange (one
`AskUserQuestion` call with multiple questions, or one plain-chat
message with numbered items). A question whose prerequisite data is not
yet known (e.g. a collection-scope choice that needs enumeration counts
first) stays at its own gate — batching never means asking before the
numbers a question needs are available, and never re-asks an already
resolved target (P4-07).

**`AskUserQuestion` corruption fallback (non-ASCII text):**
If the rendered question/option text reaches the user corrupted (they
quote garbled syllables, reply "what does this mean", or reject the
call), retry AT MOST once — rewritten from scratch and shorter, not
copy-edited. If the retry is corrupted too, stop using
`AskUserQuestion` for that decision and switch to a plain chat message
with short numbered options (answerable with "1" / "2"). Plain chat
does not exhibit this corruption; two consecutive corrupted calls
predict a third, and each retry costs a full human round-trip.

**Never resolve issues by introducing external tooling (project-wide):**
For the full statement and rationale, see
`CLAUDE.md → Operating Principles → Never resolve issues by introducing
external tooling`. Operationally for this phase, when a tool call fails
because an external CLI dependency is missing
(e.g. `pdftoppm` / `poppler`, `imagemagick`, `ffmpeg`, …):

- DO NOT suggest installation commands such as `brew install ...`,
  `apt-get install ...`, or `npm install -g ...`.
- DO NOT keep the dependency as an "optional fallback", "opt-in" path,
  or "use it if it happens to be installed" branch.
- Instead, either (a) drop the feature and switch to a code path that
  does not require that dependency (for PDFs specifically, see the
  "PDF reading" rule below), or (b) ask the user to re-provide the
  input in a different format (paste as text, export to `.md` / `.txt`).

**PDF reading — never pass `pages` to `Read` on a PDF:**
This pipeline overrides the `Read` tool's built-in advice. The Read tool's
description says you "MUST provide the `pages` parameter for PDFs over
10 pages" — **ignore that.** Specifying `pages` switches `Read` to a
`pdftoppm` / `poppler`-dependent image-conversion path, and **this
pipeline deliberately does not depend on `poppler`** — it is never to
be installed, even as a fallback. The `pages` code path is therefore
unavailable to us at all.

Mandatory sequence whenever you call `Read` on a `.pdf` file:
1. Make exactly one call: `Read(file_path=<pdf>)` with **no** `pages`
   parameter, regardless of how large you suspect the file is. The
   native multimodal route handles PDFs up to ~10 pages with zero
   external dependencies, and that is the only PDF *reading* path this
   pipeline supports.
2. If step 1 fails with the too-many-pages error (the error names the
   page count): split the PDF with the repo-pinned pure-JS splitter —
   no external CLI involved, so this does not violate the rule above:
   ```bash
   node scripts/split-pdf.mjs "<pdf>" "<workdir>"
   ```
   `<workdir>` must be pipeline-owned (e.g.
   `artifacts/{app_name}/ground-truth/.pdf-split/{stem}/`; before
   `{app_name}` exists, a `mktemp -d` directory) — never the
   user-owned `input-sources/` tree. Then `Read` each part (again
   with **no** `pages`). Part filenames carry the ORIGINAL page range
   (`{stem}.p10-16.pdf`), so page references stay anchored to the
   source document.
3. If step 1 fails for any other reason, or the split script itself
   exits non-zero (encrypted / corrupt PDF):
   - Do NOT retry with `pages: "1-20"` or any range — chunked reading
     via `pages` is not part of this pipeline.
   - Do NOT propose installing `poppler` (see the
     "Never resolve issues by introducing external tooling" rule above
     and `CLAUDE.md → Operating Principles`).
   - Ask the user via `AskUserQuestion` (2 options) to either:
     (a) paste the content as text through the "Other" input
         (recommended), or
     (b) re-provide as plain text (`.md` / `.txt`, or a `.docx`
         exported as plain text).

   `Read` does not natively understand `.docx` binaries; always ask
   for a plain-text export, never the raw `.docx` file.

Do NOT preemptively pass `pages: "1"` or `pages: "1-5"` "to check the
page count" or "as a safe default" — that is the exact mistake that
broke Step 01 historically and is part of why this rule exists.

**Feedback Log Bootstrap:**
At the start of each phase, before executing any phase-specific steps:
- Check if `artifacts/{app_name}/feedback-log.md` exists
- If it does NOT exist: create it immediately with the header line:
  `# Feedback Log — {app_name}`
- This ensures the log file is always ready when a Pattern A/B/C event occurs mid-phase

**Feedback Log:**
When any of the following 3 patterns occur during this phase, immediately append to `artifacts/{app_name}/feedback-log.md` — do not wait until the end of the step:
- **Pattern A**: Human gate returned modification instructions (e.g. "remove emoji", "the numbers look wrong")
- **Pattern B**: Agent made a mistake and had to redo (e.g. generated MD instead of HTML)
- **Pattern C**: Discovered a pipeline design flaw (e.g. a step had no output definition)

Record format:
```
- **[Step number] Category**: {what happened} → {cause} → {immediate fix}
```
