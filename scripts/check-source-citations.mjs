#!/usr/bin/env node
// Verify that the citations written by the reverse analysis actually resolve:
// every `input-sources/{stack}/path:line`, `ground-truth/{file}.md:line` and
// `ground-truth/figma/...` reference in the target artifacts must point to a file
// that exists (exact case) with the cited line inside the file.
//
// Why a script owns this: analysis passes cite evidence per finding, and a pass
// that hallucinates a path or line produces a citation that *looks* valid — the
// schema hook validates the grammar only, and the review-gate auditor verifies
// content at LLM cost per item. This check is the cheap mechanical layer in
// between: it cannot judge whether the cited line supports the claim, but it
// proves the reference is at least openable, so the expensive audit never burns
// tokens on references that cannot exist.
//
//   1. extraction  — regex over the raw text of each target (works for .md prose
//      and .json alike). The `:digits` / `.png` anchors bound each citation, so
//      table cells, parens and Japanese filenames survive extraction; template
//      placeholders (`path:line`, `{stack}`) never match because the line part
//      must be numeric.
//   2. resolution  — paths resolve under artifacts/{app}/ via a per-segment
//      directory-listing walk, which is case-SENSITIVE on every filesystem: a
//      citation that only works on case-insensitive macOS is reported as a
//      case mismatch (with the on-disk spelling) instead of passing locally and
//      breaking in CI.
//   3. line check  — cited line (or range) must be 1-based and inside the file;
//      a reversed range is reported as such.
//
// The verdict is only a re-verify trigger: this script never edits an artifact.
// (The caller re-asks the responsible shard once, then demotes the finding to
// 未確認 — see the Step 02 loop breaker.)
//
// Usage: node scripts/check-source-citations.mjs <app_name> [--file <path>] [--json]
//   default targets: artifacts/{app}/reverse-engineered/raw-analysis.md
//                    artifacts/{app}/reverse-engineered/reverse-provenance.json
//   --file <path>    check exactly one file instead (path relative to cwd)
// Exit: 0 = clean / 1 = suspects found / 2 = usage error, no target file, or internal error
//       3 = no suspects but warnings — zero citations in raw-analysis.md or an
//           explicit --file target ("nothing was verifiable" must not read as
//           "verified" to exit-code-only callers). Zero citations in
//           reverse-provenance.json alone is informational (notes), not exit 3:
//           an all-inferred run legitimately has no source_ref.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Internal failures (EISDIR/permission …) must not exit 1 — the caller treats exit 1
// as "citation suspects to re-verify", which would send a crash into that loop.
const die = (err) => {
  console.error(`internal error: ${err?.message ?? err}`);
  process.exit(2);
};
process.on('uncaughtException', die);
process.on('unhandledRejection', die);

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const fileIdx = args.indexOf('--file');
const onlyFile = fileIdx >= 0 ? args[fileIdx + 1] : null;
// `--file <path>` takes a value, so that value must not be mistaken for the positional app_name
const appName = args.find((a, i) => !a.startsWith('--') && (fileIdx < 0 || i !== fileIdx + 1));
if (!appName) {
  console.error('Usage: node scripts/check-source-citations.mjs <app_name> [--file <path>] [--json]');
  process.exit(2);
}
// app_name is a directory name under artifacts/, never a path (same rule as
// build-code-inventory.mjs).
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(appName)) {
  console.error(`invalid app_name: ${appName} (英数字と . _ - のみ — パス区切りは使えません)`);
  process.exit(2);
}

const appDir = join('artifacts', appName);
const targets = (onlyFile
  ? [onlyFile]
  : [
      join(appDir, 'reverse-engineered', 'raw-analysis.md'),
      join(appDir, 'reverse-engineered', 'reverse-provenance.json'),
    ]
).filter((p) => existsSync(p));
if (targets.length === 0) {
  console.error(
    onlyFile
      ? `not found: ${onlyFile}`
      : `no target found under ${join(appDir, 'reverse-engineered')} (raw-analysis.md / reverse-provenance.json)`,
  );
  process.exit(2);
}
// A directory passed via --file would crash readFileSync with EISDIR (exit 2 via the
// handler, but with a stack trace) — reject it up front with a usable message.
for (const t of targets) {
  if (!statSync(t).isFile()) {
    console.error(`not a file: ${t}`);
    process.exit(2);
  }
}

// Citation grammars (Source Evidence Rule). `[^\s|\`]` keeps markdown table pipes
// and code-span backticks out of the path while letting parens and CJK filenames
// through — the numeric `:line` / `.png` tail is what terminates the match.
const PATTERNS = [
  { kind: 'code', re: /input-sources\/[^\s|`]+?:(\d+)(?:-(\d+))?/g, lineCheck: true },
  { kind: 'archive', re: /ground-truth\/[^\s|`]+?\.(?:md|json):(\d+)(?:-(\d+))?/g, lineCheck: true },
  { kind: 'figma_png', re: /ground-truth\/figma\/[^\s|`]+?\.png/g, lineCheck: false },
];

// Case-sensitive resolution: existsSync answers with the platform's semantics
// (insensitive on default macOS volumes), so each segment is matched against the
// actual directory listing instead.
const listingCache = new Map();
const listing = (dir) => {
  if (!listingCache.has(dir)) {
    try {
      listingCache.set(dir, new Set(readdirSync(dir)));
    } catch {
      listingCache.set(dir, null);
    }
  }
  return listingCache.get(dir);
};
const resolveExact = (relPath) => {
  const segs = relPath.split('/');
  if (segs.includes('..')) return { ok: false, reason: `参照が ${appDir}/ の外を指す (.. を含む)` };
  let dir = appDir;
  for (const seg of segs) {
    const names = listing(dir);
    if (names === null) return { ok: false, reason: 'ファイル不在' };
    if (!names.has(seg)) {
      const ci = [...names].find((n) => n.toLowerCase() === seg.toLowerCase());
      return ci
        ? { ok: false, reason: `大文字小文字の不一致 (実体: ${ci})` }
        : { ok: false, reason: 'ファイル不在' };
    }
    dir = join(dir, seg);
  }
  let st;
  try {
    st = statSync(dir);
  } catch {
    return { ok: false, reason: 'ファイル不在' };
  }
  if (!st.isFile()) return { ok: false, reason: 'ファイルではない (ディレクトリ)' };
  return { ok: true, abs: dir };
};

const lineCountCache = new Map();
// Trailing newline is a terminator, not an extra line — split('\n') alone counts the
// empty tail and would let an EOF+1 line citation pass verification.
const lineCount = (abs) => {
  if (!lineCountCache.has(abs)) {
    const parts = readFileSync(abs, 'utf8').split('\n');
    lineCountCache.set(abs, parts[parts.length - 1] === '' ? parts.length - 1 : parts.length);
  }
  return lineCountCache.get(abs);
};

// citation string → { kind, found_in: [target,...] } — the same citation is
// verified once however many findings repeat it.
const seen = new Map();
const counts = { code: 0, archive: 0, figma_png: 0 };
const warnings = []; // exit 3 の対象 (raw-analysis.md / --file 対象の引用ゼロ等)
const notes = []; // 参考情報のみ — exit code に影響しない
for (const target of targets) {
  const text = readFileSync(target, 'utf8');
  let found = 0;
  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      found++;
      counts[kind]++;
      const cite = m[0];
      if (!seen.has(cite)) seen.set(cite, { kind, found_in: [] });
      const rec = seen.get(cite);
      if (!rec.found_in.includes(target)) rec.found_in.push(target);
    }
  }
  if (found === 0) {
    // Zero citations gates exit 3 only for raw-analysis.md (and an explicit --file
    // target): an analysis without a single citation is "nothing verifiable".
    // reverse-provenance.json alone may be legitimately citation-free — an
    // all-inferred run has no source_ref by design — so that case is informational
    // and must not wedge the Step 05 gate with nothing to fix.
    const gates = onlyFile !== null || target.endsWith('raw-analysis.md');
    if (gates) {
      warnings.push(`${target}: 引用が 1 件も見つからない (対象が空 / 引用文法違反の疑い)`);
    } else {
      notes.push(`${target}: 引用が 1 件も見つからない (全件 inferred の run では正当 — 参考情報)`);
    }
  }
}

const suspects = [];
for (const [cite, rec] of seen) {
  const { kind } = rec;
  const lineMatch = kind === 'figma_png' ? null : cite.match(/:(\d+)(?:-(\d+))?$/);
  const relPath = lineMatch ? cite.slice(0, cite.length - lineMatch[0].length) : cite;
  const res = resolveExact(relPath);
  if (!res.ok) {
    suspects.push({ citation: cite, kind, reason: res.reason, found_in: rec.found_in });
    continue;
  }
  if (lineMatch) {
    const from = Number(lineMatch[1]);
    const to = lineMatch[2] ? Number(lineMatch[2]) : from;
    if (to < from) {
      suspects.push({ citation: cite, kind, reason: `行範囲が逆転 (${from}-${to})`, found_in: rec.found_in });
      continue;
    }
    const lines = lineCount(res.abs);
    if (from < 1 || to > lines) {
      suspects.push({
        citation: cite,
        kind,
        reason: `行番号が範囲外 (実ファイル ${lines} 行)`,
        found_in: rec.found_in,
      });
    }
  }
}
suspects.sort((a, b) => a.citation.localeCompare(b.citation));

const result = {
  app_name: appName,
  targets,
  counts: { ...counts, unique: seen.size },
  suspects,
  warnings,
  notes,
};
if (asJson) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  console.log(`[check-source-citations] ${appName} — targets: ${targets.join(', ')}`);
  console.log(
    `  citations: code ${counts.code} / archive ${counts.archive} / figma png ${counts.figma_png} (unique ${seen.size})`,
  );
  if (suspects.length) {
    console.log(`  疑義 (${suspects.length} 件 — 該当 finding を再確認するか ※ 未確認 へ降格する):`);
    for (const s of suspects) console.log(`  - ${s.citation} — ${s.reason}`);
  } else {
    console.log('  引用の疑義なし');
  }
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const n of notes) console.log(`  ℹ ${n}`);
}

// warnings alone (zero extracted citations etc.) are not "clean": exit 3 lets a
// caller that only checks the exit code distinguish "verified, no suspects" (0)
// from "nothing was verifiable" (3) without parsing the output.
process.exit(suspects.length > 0 ? 1 : warnings.length > 0 ? 3 : 0);
