#!/usr/bin/env node
// Cluster the Figma screen-candidate enumeration (reverse Step 01 F1) into name families
// and pick one representative per family, deterministically.
//
// Why this exists: a production Figma file holds hundreds of screen-sized nodes,
// but most are state variants (公開中/非公開/…), platform variants (_pc/_sp),
// tutorial page runs (_1.._7), backup debris (bak_*), or anonymous containers
// (Frame 1234 / Group 567). Reverse-engineering needs each *distinct* screen once;
// capturing every variant multiplies design-context cost (thousands of tokens and
// minutes per frame) without adding requirements evidence — the variant *names*
// alone already document that the states exist. This script turns the raw
// enumeration into a small, reviewable capture proposal so the budget gate can ask
// "capture these N representatives?" instead of "pick a range out of 234 nodes".
//
// Input:  artifacts/{app}/ground-truth/figma/.enumeration-{file_key}.json
//         (written by the collector subagent's enumeration pass)
// Output: artifacts/{app}/ground-truth/figma/.clustering-{file_key}.json
//         + a human-readable proposal table on stdout (for the budget gate)
//
// Buckets (every candidate lands in exactly one):
//   representative  — capture this node (largest member of its family)
//   family_variant  — same family as a representative; name kept as evidence
//   duplicate_name  — same name as another node; loser of the same-name dedup
//   anonymous       — auto-generated name (Frame N / Group N …); may be a real
//                     screen that was never named — surfaced as opt-in, never
//                     silently dropped
//   debris          — explicitly marked leftovers (bak_* / 【DL用】…)
//
// Usage: node scripts/cluster-figma-candidates.mjs <app_name> [--stdout]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const appName = args.find((a) => !a.startsWith('--'));
if (!appName) {
  console.error('Usage: node scripts/cluster-figma-candidates.mjs <app_name> [--stdout]');
  process.exit(1);
}
const toStdout = args.includes('--stdout');

const figmaDir = join('artifacts', appName, 'ground-truth', 'figma');
if (!existsSync(figmaDir)) {
  console.error(`not found: ${figmaDir}`);
  process.exit(1);
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
const ANONYMOUS = /^(frame|group|component|rectangle|ellipse|vector|union|slice|mask group|image|img)\s*\d*$/i;
const DEBRIS = /^(bak[_（(]|【DL用】)/i;
// Screen-ID prefix like R-10-2 / EV-7-1 / L-6-1: the strongest family signal —
// design files that use IDs keep one ID per logical screen across variants.
const SCREEN_ID = /^([A-Za-z]{1,3}-\d+(?:-\d+)*)/;

const familyOf = (rawName) => {
  // strip leading decorations: 【公開中】-style markers, emoji, bullets, whitespace
  let n = rawName.replace(/^【[^】]*】/, '');
  n = n.replace(/^[^0-9A-Za-z぀-ヿ㐀-鿿豈-﫿]+/u, '').trim();
  const id = n.match(SCREEN_ID);
  if (id) return id[1];
  // cut at fullwidth/halfwidth paren: スポット一覧（ランダム） → スポット一覧
  n = n.split(/[（(]/)[0].trim();
  // numbered series ("iPhone 13 mini - 1", "チュートリアル_2") are one family;
  // digits glued to a word ("web_detail1") stay — those are distinct screens.
  n = n.replace(/[\s_\-–—]+\d+$/, '');
  const segs = n.split('_').filter(Boolean);
  if (segs.length === 0) return n || rawName;
  // CJK first segment is descriptive enough (スポット詳細_公開中 → スポット詳細);
  // a short ASCII first segment is usually a namespace, not a screen (web_detail1_pc
  // and web_top_pc are different screens), so keep two segments for ASCII names.
  if (CJK.test(segs[0])) return segs[0];
  return segs.slice(0, 2).join('_');
};

const area = (c) => (c.width || 0) * (c.height || 0);
// frame beats component (frames are the authored screens; components are reusable
// symbols), then larger area (fullest state variant), then node_id for determinism.
const better = (a, b) => {
  const typeRank = (t) => (String(t).toLowerCase() === 'frame' ? 0 : 1);
  if (typeRank(a.type) !== typeRank(b.type)) return typeRank(a.type) - typeRank(b.type);
  if (area(a) !== area(b)) return area(b) - area(a);
  return String(a.node_id ?? '').localeCompare(String(b.node_id ?? ''));
};

const enumFiles = readdirSync(figmaDir).filter((f) => /^\.enumeration-.+\.json$/.test(f));
if (enumFiles.length === 0) {
  console.error(`no .enumeration-*.json found in ${figmaDir} — run the enumeration pass first`);
  process.exit(1);
}

for (const ef of enumFiles.sort()) {
  let input;
  try {
    input = JSON.parse(readFileSync(join(figmaDir, ef), 'utf8'));
  } catch (e) {
    console.error(`skip ${ef}: ${e.message}`);
    continue;
  }
  const fileKey = input.file_key ?? ef.replace(/^\.enumeration-/, '').replace(/\.json$/, '');
  // The enumeration is written by a collector subagent, so a missing or non-string
  // field is a realistic failure mode. A node without an id cannot be captured or
  // cited later, so it is dropped — but counted and reported, never silently. A node
  // with an id but no usable name is kept and treated as anonymous, which routes it
  // into the opt-in list the scope gate shows the user.
  const raw = (input.candidates ?? []).map((c) => ({ ...c }));
  const all = [];
  const droppedNoNodeId = [];
  for (const c of raw) {
    if (typeof c.node_id !== 'string' || !c.node_id) {
      droppedNoNodeId.push(c.name ?? '(unnamed)');
      continue;
    }
    if (typeof c.name !== 'string' || !c.name) c.name = `(unnamed ${c.node_id})`;
    all.push(c);
  }
  if (droppedNoNodeId.length) {
    console.error(
      `[cluster-figma-candidates] WARNING ${fileKey}: ${droppedNoNodeId.length} candidate(s) dropped — no node_id: ${droppedNoNodeId.slice(0, 5).join(', ')}${droppedNoNodeId.length > 5 ? ' …' : ''}`,
    );
  }

  // 1) same-name dedup — iteration copies share the exact name; keep the best one.
  // Keyed by page + name: the same screen name legitimately recurs on a per-platform
  // or per-flow page, and those are distinct screens rather than duplicates.
  const dedupKey = (c) => `${c.page ?? ''}\x00${c.name}`;
  const byName = new Map();
  for (const c of all) {
    const prev = byName.get(dedupKey(c));
    if (!prev || better(c, prev) < 0) byName.set(dedupKey(c), c);
  }
  for (const c of all) {
    if (byName.get(dedupKey(c)) !== c) c.bucket = 'duplicate_name';
  }

  // 2) classify the dedup survivors
  const named = [];
  for (const c of all) {
    if (c.bucket) continue;
    if (DEBRIS.test(c.name)) c.bucket = 'debris';
    else if (ANONYMOUS.test(c.name)) c.bucket = 'anonymous';
    else named.push(c);
  }

  // 3) family clustering + representative pick
  const families = new Map();
  for (const c of named) {
    c.family = familyOf(c.name);
    if (!families.has(c.family)) families.set(c.family, []);
    families.get(c.family).push(c);
  }
  for (const members of families.values()) {
    members.sort(better);
    members.forEach((c, i) => {
      c.bucket = i === 0 ? 'representative' : 'family_variant';
    });
  }

  const counts = {};
  for (const c of all) counts[c.bucket] = (counts[c.bucket] ?? 0) + 1;

  const output = {
    file_key: fileKey,
    ...(input.url ? { url: input.url } : {}),
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    summary: {
      total: all.length,
      families: families.size,
      representative: counts.representative ?? 0,
      family_variant: counts.family_variant ?? 0,
      duplicate_name: counts.duplicate_name ?? 0,
      anonymous: counts.anonymous ?? 0,
      debris: counts.debris ?? 0,
    },
    candidates: [...all].sort((a, b) => {
      const fa = a.family ?? '￿';
      const fb = b.family ?? '￿';
      if (fa !== fb) return fa.localeCompare(fb);
      return better(a, b);
    }),
  };

  const outPath = join(figmaDir, `.clustering-${fileKey}.json`);
  const json = JSON.stringify(output, null, 2) + '\n';
  if (toStdout) process.stdout.write(json);
  else writeFileSync(outPath, json);

  // ── human-readable proposal table (what the budget gate shows the user).
  // With --stdout the JSON owns stdout, so the table goes to stderr — otherwise the
  // two interleave and neither is parseable.
  const say = toStdout ? (...a) => console.error(...a) : (...a) => console.log(...a);
  const s = output.summary;
  say(`\n[cluster-figma-candidates] ${fileKey} — ${s.total} candidates`);
  say(
    `  representatives: ${s.representative} (families: ${s.families})  |  ` +
      `folded variants: ${s.family_variant}  |  same-name dups: ${s.duplicate_name}  |  ` +
      `anonymous: ${s.anonymous}  |  debris: ${s.debris}`,
  );

  const multi = [...families.entries()].filter(([, m]) => m.length > 1).sort((a, b) => b[1].length - a[1].length);
  if (multi.length) {
    say(`\n  families with folded variants (${multi.length}):`);
    for (const [fam, members] of multi) {
      const rep = members[0];
      say(`    ${fam} (${members.length}) → rep: ${rep.name} [${rep.node_id}] ${rep.width}x${rep.height} ${rep.page ?? ''}`);
    }
  }
  const singles = [...families.entries()].filter(([, m]) => m.length === 1);
  if (singles.length) {
    say(`\n  single-screen families (${singles.length}):`);
    for (const [, m] of singles.sort((a, b) => area(b[1][0]) - area(a[1][0]))) {
      const c = m[0];
      say(`    ${c.name} [${c.node_id}] ${c.width}x${c.height} ${c.page ?? ''}`);
    }
  }
  const anon = all.filter((c) => c.bucket === 'anonymous').sort((a, b) => area(b) - area(a));
  if (anon.length) {
    say(`\n  anonymous nodes (${anon.length}, opt-in — may be unnamed real screens; top 10 by area):`);
    for (const c of anon.slice(0, 10)) {
      say(`    ${c.name} [${c.node_id}] ${c.width}x${c.height} ${c.page ?? ''}`);
    }
  }
  // Same-name losers are shown for the same reason anonymous nodes are: dedup keeps
  // one node per page+name, and a mistaken fold is only visible if the user sees what
  // was folded. Silently dropping them hides real screens from the scope decision.
  const dups = all.filter((c) => c.bucket === 'duplicate_name').sort((a, b) => area(b) - area(a));
  if (dups.length) {
    say(`\n  same-name duplicates (${dups.length}, folded — top 10 by area):`);
    for (const c of dups.slice(0, 10)) {
      say(`    ${c.name} [${c.node_id}] ${c.width}x${c.height} ${c.page ?? ''}`);
    }
  }
  if (!toStdout) say(`\n  wrote ${outPath}`);
}
