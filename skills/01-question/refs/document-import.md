# Document Import Mode

When the user has an existing planning document (spec, PRD, proposal,
etc.), use it as a starting point to pre-fill axes and skip redundant
questions.

## Step 1: File Collection

Ask the user **how** they want to provide their document. Use
`AskUserQuestion` with these two options (`AskUserQuestion` always
auto-adds an "Other" slot, so do not include one manually):

| Option | Label             | Description |
|---|---|---|
| 1 | ファイルパス       | ローカルファイルのパスを貼り付ける |
| 2 | テキスト貼り付け   | ドキュメントの内容を直接貼り付ける |

After the user picks a mode, **do NOT call `AskUserQuestion` a second
time** to collect the actual path or text. `AskUserQuestion` requires
≥ 2 options per question, and a single-input prompt will fail with
`InputValidationError: options too_small`. Instead, send a plain chat
message and let the user type their next reply freely:

- File path mode → say "ファイルのパスをこのチャットに貼り付けてください。"
- Paste text mode → say "ドキュメントの内容をこのチャットに貼り付けてください。"

The user's next chat message will contain the path or full text. Then
use the `Read` tool on the path (per the PDF reading rules below), or
treat the pasted text directly as the document content.

### PDF reading rules — IMPORTANT, overrides the `Read` tool's own docs

> ⚠️ The `Read` tool's built-in description tells you that for PDFs over
> 10 pages you "MUST provide the `pages` parameter". **In this pipeline,
> ignore that instruction.** Specifying `pages` switches `Read` to a
> `pdftoppm` / `poppler`-dependent image-conversion path, and **this
> pipeline deliberately does not depend on `poppler` — it is never to
> be installed.** As a result, the `pages` code path is unavailable to
> us in any form (not even as a fallback).

The `Read` tool has two PDF code paths:
- `pages` **omitted** → Claude's native multimodal PDF processing
  (no external deps; works for PDFs up to ~10 pages) — **the only path
  this pipeline uses**
- `pages` **specified** → image conversion via `pdftoppm` / `poppler`
  — **forbidden in this pipeline; never call `Read` with `pages` on a
  PDF**

**Mandatory call order — exactly three steps:**

1. **One and only one `Read` call: `Read(file_path=<pdf>)` with NO
   `pages` parameter.** Do not preemptively pass `pages: "1"`,
   `pages: "1-5"`, or any range "to be safe", "to check the page
   count", or "as a fallback". Make a single parameter-less call,
   regardless of suspected file size. Trust the native multimodal
   route.
2. If step 1 fails with the too-many-pages error: split the PDF with
   the repo-pinned pure-JS splitter (no external CLI — splitting is
   file-format surgery, not rendering), then `Read` each part with NO
   `pages`:
   ```bash
   node scripts/split-pdf.mjs "<pdf>" "$(mktemp -d)"
   ```
   (In this phase `{app_name}` may not exist yet, so a temp dir is the
   working directory; part filenames keep the original page range,
   e.g. `{stem}.p10-16.pdf`.)
3. If step 1 fails for any **other** reason, or the split script exits
   non-zero (encrypted / corrupt PDF):
   - **DO NOT** retry with `pages: "1-20"` or any range. Chunked
     reading via `pages` is not part of this pipeline.
   - **DO NOT** propose `brew install poppler` or any other
     system-dependency installation command.
   - Ask the user via `AskUserQuestion` (2 explicit options) to either:
     a) paste the PDF content as text through the "Other" input
        (recommended for most cases), or
     b) re-provide the document in plain-text form — `.md` / `.txt`,
        or a `.docx` exported as plain text.

   The `Read` tool does not natively understand `.docx` binaries; ask
   for plain-text export, never the raw `.docx` file.

**Anti-patterns (never do any of these):**
- Calling `Read` with `pages` on the first attempt — even with a small
  range like `pages: "1-5"` — because you assume the PDF might be long.
- Falling back to `Read(pdf, pages="1-20")` after a size-limit error.
  The pipeline has no `pages` retry path; split with
  `scripts/split-pdf.mjs` instead.
- Asking the user to split or re-export a PDF that
  `scripts/split-pdf.mjs` can split — user round-trips are the
  fallback for encrypted / corrupt input only.
- "Optimistically" trying `pages` to see if `poppler` happens to be
  installed. It is not, by design.

## Step 2: Document Analysis

Read the document and extract information relevant to each of the 7 axes:

| Axis | What to look for |
|---|---|
| Target User | user personas, target audience, user stories |
| Problem | pain points, problem statement, background, motivation |
| Features | feature lists, requirements, user stories, use cases |
| Competitors | competitor analysis, market research, alternatives |
| Constraints | timeline, budget, tech stack, team size |
| Platform | platform requirements, deployment targets |
| Design Output Scope | screen inventory hints, Phase 3 scope notes, platform-combo policy, state-pattern policy |

Documents rarely pre-fill **Design Output Scope** explicitly. When absent,
mark all 3 sub-dimensions as not-found and ask them during Step 4 gap-fill.

## Step 3: Pre-fill Summary

Present extracted content with per-axis coverage bars:

```
──── Document Analysis ──────────────────────

  Target User    ██████████  Covered — persona found
  Problem        ████████░░  Partial — needs detail
  Features       ██████████  Covered — 12 items found
  Competitors    ░░░░░░░░░░  Not found
  Constraints    ████░░░░░░  Partial — deadline only
  Platform       ██████████  Covered — web + mobile
  Design Scope   ░░░░░░░░░░  Not found

─────────────────────────────────────────────
```

Then confirm with `AskUserQuestion`:

| Option | Meaning | Route |
|---|---|---|
| A | Looks good, fill gaps only | → skip covered axes, ask only gaps |
| B | Walk through each axis first | → show extracted content per axis, confirm/correct |

## Step 4: Gap-Fill Questioning

For axes not covered, or only partially covered, by the document:
- Run the normal axis questioning flow (opening question + deep-dive)
- For partially covered axes, start by summarizing what was found, then
  ask for what is missing

For fully covered axes (document-derived score ≥ 7):
- Score based on document content
- Still offer per-axis recommendations if gaps are spotted
- User may request a deep-dive on any axis

## App Name

- If the document mentions an app / project name, use it as `{app_name}`
- Otherwise, suggest a working name based on document content and confirm

Then proceed to Axis 1, skipping or fast-tracking covered axes.
