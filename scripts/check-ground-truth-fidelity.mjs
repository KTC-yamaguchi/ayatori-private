#!/usr/bin/env node
// Verify transcription fidelity of the document archives under
// artifacts/{app_name}/ground-truth/ (Confluence pages / Jira issues / local docs).
//
// Why a script owns this: collection workers self-report "verbatim done", and a
// worker that silently summarized a long page produces an archive that looks
// complete. The check must therefore be mechanical and independent of the
// worker's own report:
//   1. summary-marker scan  — marker *forms* ("(中略)" / "[OUTPUT TRUNCATED" …) plus
//      natural-language disclaimer phrases ("due to length" …). The forms never match
//      bare words, so legitimate prose (「入力を省略できる」) and the Jira
//      attachment convention ("[添付: 図.png]") do not false-positive.
//   2. expected-vs-actual   — the expected body length comes, in priority order, from:
//      (a) .probe-pages.json / .probe-issues.json — lengths measured by an independent
//          probe pass (same agent, mode: probe) that fetches the same sources but never
//          writes archives. A summarizing collector cannot shrink this value to match
//          its own shortened output, which is exactly how a self-reported expectation
//          gets defeated ("write less, report less").
//      (b) fragment files (.batch{N}-pages.json / .batch{N}-issues.json) — the
//          collector's self-report, kept only as a fallback for archives without
//          probe data (legacy collections).
//      Flag when actual < expected * 0.5; skip when expected < 500 (the ratio is
//      unstable on small pages — shells are the index's job, not this check's).
//   3. coverage accounting  — always print how many files were scanned and how
//      many fragment entries were joined. A run that scanned nothing must never
//      read as "clean" (same lesson as the figma backstop).
//
// The verdict is only a re-collect trigger: this script never deletes or renames
// an archive (both signals are false-positive-prone; a wrongly removed archive is
// unrecoverable evidence).
//
// Usage: node scripts/check-ground-truth-fidelity.mjs <app_name> [--json]
// Exit:  0 = clean / 1 = suspects found (or fragments present but 0 files scanned)
//        2 = usage / path error
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const appName = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
if (!appName) {
  console.error('Usage: node scripts/check-ground-truth-fidelity.mjs <app_name> [--json]');
  process.exit(2);
}

const dir = join('artifacts', appName, 'ground-truth');
if (!existsSync(dir)) {
  console.error(`not found: ${dir}`);
  process.exit(2);
}

// Marker *forms*, not bare words. Each pattern requires the marker punctuation
// (brackets / line-initial colon form), so ordinary prose containing 省略/要約 and
// the legitimate Jira attachment placeholder "[添付: …]" stay unmatched.
const MARKERS = [
  { re: /\[OUTPUT TRUNCATED/i, label: '[OUTPUT TRUNCATED' },
  { re: /[（(]中略[）)]/, label: '(中略)' },
  { re: /[（(]以下略[）)]/, label: '(以下略)' },
  { re: /[（(]省略[）)]/, label: '(省略)' },
  { re: /for brevity/i, label: 'for brevity' },
  { re: /omitted for/i, label: 'omitted for' },
  { re: /^要約[:：]/m, label: '行頭の要約:' },
  // Natural-language disclaimer phrases, deliberately unqualified (no punctuation requirement):
  // a worker that replaces content with a summary announces it in prose rather than in marker
  // punctuation, so the *forms* above never match it. English disclaimer phrasing inside an
  // otherwise-Japanese archive is a strong signal on its own; false positives are absorbed by
  // the re-collect loop breaker (a verdict only triggers re-collection, never deletion).
  { re: /due to length/i, label: 'due to length' },
  { re: /summary (is|has been) provided/i, label: 'summary is provided' },
  { re: /refer to the original/i, label: 'refer to the original' },
  { re: /content continues/i, label: 'content continues' },
  // Japanese phrasings of the same disclaimer behavior. Kept as distinctive clause forms
  // (not bare common words like 長い/参照) so ordinary spec prose does not false-positive.
  { re: /原本を参照/, label: '原本を参照' },
  { re: /元ページを参照/, label: '元ページを参照' },
  { re: /ページは長いため/, label: 'ページは長いため' },
];

const RATIO = 0.5; // actual < expected * RATIO → 本文長不足
const MIN_EXPECTED = 500; // below this the ratio is noise — skip the length check

// ── probe: id → body_chars measured by the independent probe pass (authoritative
//    expected source — see header comment 2a). Keyed by source id (page id / issue key).
const probeById = new Map();
let probeEntries = 0;
for (const f of readdirSync(dir)) {
  if (!/^\.probe-(pages|issues)\.json$/.test(f)) continue;
  let probe;
  try {
    probe = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch {
    console.error(`[check-ground-truth-fidelity] WARNING: could not parse ${f} — ignored`);
    continue;
  }
  const items = probe.pages ?? probe.issues ?? [];
  for (const it of items) {
    if (!it || it.id == null || typeof it.body_chars !== 'number') continue;
    probeEntries++;
    probeById.set(String(it.id), it.body_chars);
  }
}

// Archive filenames embed the source id (cf-{page_id}-… / jira-{KEY}.md), which is how
// probe entries join to files — the archive header is written by the collector and is
// therefore not used as the join key.
const idFromFilename = (file) => {
  const cf = file.match(/^cf-(\d+)-/);
  if (cf) return cf[1];
  const jira = file.match(/^jira-(.+)\.md$/);
  if (jira) return jira[1];
  return null;
};

// ── fragments: id → { file, expected_body_chars } (last batch wins, ledger convention)
const fragmentByFile = new Map();
let fragmentEntries = 0;
for (const f of readdirSync(dir)) {
  if (!/^\.batch\d+-(pages|issues)\.json$/.test(f)) continue;
  let frag;
  try {
    frag = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch {
    console.error(`[check-ground-truth-fidelity] WARNING: could not parse ${f} — ignored`);
    continue;
  }
  const items = frag.pages ?? frag.issues ?? [];
  for (const it of items) {
    if (!it || typeof it.file !== 'string') continue;
    fragmentEntries++;
    fragmentByFile.set(it.file, it);
  }
}

// ── scan archives (root-level *.md except index.md — same population as the index)
const suspects = [];
const warnings = [];
let scanned = 0;
const seenFiles = new Set();
for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith('.md') || file === 'index.md') continue;
  // Derived extracts (scripts/extract-adf-text.mjs) are regenerated views of an
  // archive, not collections — they have no probe/fragment entry, and their
  // compact rendering would false-positive the length ratio against the raw ADF.
  if (file.endsWith('.adf-extract.md')) continue;
  scanned++;
  seenFiles.add(file);
  const raw = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');

  // body = everything after the archiver header separator (raw, deliberately
  // unfiltered — the index's proseLen strips headings/URLs and would understate
  // the actual transcription volume).
  const sepIdx = raw.indexOf('\n---\n');
  const body = sepIdx >= 0 ? raw.slice(sepIdx + 5) : raw;

  for (const m of MARKERS) {
    if (m.re.test(body)) {
      suspects.push({ file, reason: `要約マーカー検出: ${m.label}` });
      break;
    }
  }

  // ADF archives (```json fence) inflate several-fold over the markdown-measured
  // probe chars, so the length-ratio check below cannot catch a truncated JSON —
  // even a half-cut archive still exceeds the markdown-based threshold. A parse
  // check closes that hole mechanically: truncation always breaks JSON syntax.
  // Scope: only when the WHOLE body is a single ```json fence (the ADF archive
  // format). A fence found mid-body is a JSON example inside a normal markdown
  // page — parsing across example blocks and the prose between them always
  // fails, turning healthy pages into unrecoverable false-positive suspects.
  const trimmedBody = body.trimStart();
  if (trimmedBody.startsWith('```json\n')) {
    const rest = trimmedBody.slice('```json\n'.length);
    const fenceClose = rest.lastIndexOf('```');
    const payload = (fenceClose >= 0 ? rest.slice(0, fenceClose) : rest).trim();
    try {
      JSON.parse(payload);
    } catch (e) {
      suspects.push({
        file,
        id: idFromFilename(file),
        reason: `ADF JSON が parse 不能 (${e.message.slice(0, 80)}) — 転写の途中切断の疑い`,
      });
    }
  }

  const frag = fragmentByFile.get(file);
  const probeChars = probeById.get(idFromFilename(file) ?? '');

  let expected = null;
  let expectedSource = null;
  if (typeof probeChars === 'number') {
    expected = probeChars;
    expectedSource = 'probe';
  } else if (frag && typeof frag.expected_body_chars === 'number') {
    expected = frag.expected_body_chars;
    expectedSource = 'fragment 自己申告';
  }

  if (expected != null && expected >= MIN_EXPECTED) {
    const actual = body.length;
    if (actual < expected * RATIO) {
      suspects.push({
        file,
        id: frag?.id ?? idFromFilename(file) ?? null,
        reason: `本文長不足: 受信 ${expected} 字 (${expectedSource}) に対しアーカイブ ${actual} 字 (閾値 ${Math.floor(expected * RATIO)})`,
      });
    }
  }
  if (!frag) {
    // Legacy archives (collected before fragments existed) are not an error —
    // the marker scan (and the probe length check, when probe data exists) still covers them.
    warnings.push(`${file}: fragment に記録が無い (収集メタ無し${typeof probeChars === 'number' ? '。本文長照合は probe で実施' : 'のため本文長照合は skip'})`);
  }
}

// fragment entry whose archive file vanished = the collection claims something
// disk cannot back — surface as suspect, not warning.
for (const [file, it] of fragmentByFile) {
  if (!seenFiles.has(file)) {
    suspects.push({ file, id: it.id ?? null, reason: 'ファイル不在 (fragment に記録があるがアーカイブが無い)' });
  }
}

// fragments present but nothing scanned: a wrong path / empty dir must be loud.
const zeroScanWithFragments = fragmentEntries > 0 && scanned === 0;

// ── report
const result = {
  scanned,
  fragment_entries: fragmentEntries,
  probe_entries: probeEntries,
  suspects,
  warnings,
};
if (asJson) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  console.log(`[check-ground-truth-fidelity] scanned: ${scanned} files / fragment entries: ${fragmentEntries} / probe entries: ${probeEntries}`);
  if (suspects.length) {
    console.log(`  再収集対象 (${suspects.length} 件):`);
    for (const s of suspects) console.log(`  - ${s.file}${s.id ? ` (id: ${s.id})` : ''} — ${s.reason}`);
  } else {
    console.log('  汚染疑いなし');
  }
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (zeroScanWithFragments) {
    console.log('  ⚠ fragment はあるがアーカイブを 1 件も走査していない — パス誤り / 収集全滅の疑い');
  }
}

process.exit(suspects.length > 0 || zeroScanWithFragments ? 1 : 0);
