#!/usr/bin/env node
// Assemble artifacts/{app_name}/ground-truth/figma/figma-manifest.json from what is
// actually on disk, merging any per-batch fragments for human-readable frame names.
//
// Why a script owns this: capture runs in parallel batches (a single capture agent
// cannot hold many screens in context), and having each batch read-merge-write the
// shared manifest loses updates. Batches therefore drop `.batch*-frames.json`
// fragments and the manifest is assembled once, afterwards, from disk — disk being
// authoritative about which evidence files exist. Fragments only supply frame names.
//
// Matching is by node_id, never by slug prefix: sibling screens differ only by a
// suffix (`…_スポット詳細` vs `…_スポット詳細_viewer`), so prefix matching is ambiguous.
//
// Usage: node scripts/build-figma-manifest.mjs <app_name> [--stdout]
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const appName = args.find((a) => !a.startsWith('--'));
if (!appName) {
  console.error('Usage: node scripts/build-figma-manifest.mjs <app_name> [--stdout]');
  process.exit(1);
}
const toStdout = args.includes('--stdout');

const figmaDir = join('artifacts', appName, 'ground-truth', 'figma');
if (!existsSync(figmaDir)) {
  console.error(`not found: ${figmaDir}`);
  process.exit(1);
}
const rel = (p) => p.split(`artifacts/${appName}/`)[1] ?? p;

// ── fragments: node_id → name (parallel batches wrote these instead of the manifest)
const nameByNode = new Map();
const urlByFile = new Map();
for (const f of readdirSync(figmaDir)) {
  // any dotfile ending in -frames.json: per-batch fragments, or a name map recovered
  // from the enumeration when a batch died before writing its fragment.
  if (!/^\..*-frames\.json$/.test(f)) continue;
  let frag;
  try { frag = JSON.parse(readFileSync(join(figmaDir, f), 'utf8')); } catch { continue; }
  for (const fr of frag.frames ?? []) {
    if (fr.node_id && fr.name) nameByNode.set(fr.node_id, fr.name);
  }
  if (frag.file_key && frag.url) urlByFile.set(frag.file_key, frag.url);
}

// ── enumeration + clustering outputs: the enumeration dump is a name/url fallback;
// the clustering file additionally supplies families and the enumerated-but-not-
// captured record. Both are optional — captures that target explicit node-ids
// never produce them.
const clusterByFile = new Map();
for (const f of readdirSync(figmaDir)) {
  const m = f.match(/^\.(enumeration|clustering)-(.+)\.json$/);
  if (!m) continue;
  let doc;
  try { doc = JSON.parse(readFileSync(join(figmaDir, f), 'utf8')); } catch { continue; }
  const fileKey = doc.file_key ?? m[2];
  if (m[1] === 'clustering') clusterByFile.set(fileKey, doc);
  for (const c of doc.candidates ?? []) {
    if (c.node_id && c.name && !nameByNode.has(c.node_id)) nameByNode.set(c.node_id, c.name);
  }
  if (doc.url && !urlByFile.has(fileKey)) urlByFile.set(fileKey, doc.url);
}

const NOT_CAPTURED_REASON = {
  family_variant: 'family_variant',
  duplicate_name: 'duplicate_name',
  anonymous: 'anonymous_low_confidence',
  debris: 'debris',
};

// The confirmed capture set, written by the scope gate. Without it a
// representative that has no evidence on disk is indistinguishable from one the
// user left out — and recording a failure as `out_of_scope` tells the audit gate
// a human decided to skip the screen. The gate's default proposal is "all
// representatives", so absent the file we assume the representative was
// requested and report `capture_failed`.
const scopeByFile = new Map();
for (const f of readdirSync(figmaDir)) {
  const m = f.match(/^\.capture-scope-(.+)\.json$/);
  if (!m) continue;
  let doc;
  try { doc = JSON.parse(readFileSync(join(figmaDir, f), 'utf8')); } catch { continue; }
  const ids = doc.node_ids;
  if (Array.isArray(ids)) scopeByFile.set(doc.file_key ?? m[1], new Set(ids));
}

const files = [];
const unparsedStems = [];
for (const entry of readdirSync(figmaDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const fileKey = entry.name;
  const sub = join(figmaDir, fileKey);
  const frames = [];
  // A frame's evidence is screenshot and/or design-context — either can be missing
  // (e.g. get_design_context fails on a non-frame/canvas node). Enumerate the union
  // of both extensions' stems so a screenshot-only capture isn't silently dropped.
  const stems = new Set();
  for (const name of readdirSync(sub).sort()) {
    if (name.endsWith('.design-context.md')) stems.add(name.replace(/\.design-context\.md$/, ''));
    else if (name.endsWith('.png')) stems.add(name.replace(/\.png$/, ''));
  }
  for (const stem of [...stems].sort()) {
    const sepAt = stem.indexOf('--');
    if (sepAt < 0) {
      // Evidence exists on disk but its filename breaks the naming convention, so
      // its node identity is unrecoverable. Never drop it silently — a dropped file
      // is evidence that vanishes from every downstream step's view.
      unparsedStems.push(`${fileKey}/${stem}`);
      continue;
    }
    // filename encodes the node id with every ':' replaced by '-'
    const nodeId = stem.slice(0, sepAt).replaceAll('-', ':');
    const slug = stem.slice(sepAt + 2);
    const png = join(sub, `${stem}.png`);
    const dc = join(sub, `${stem}.design-context.md`);
    frames.push({
      node_id: nodeId,
      name: nameByNode.get(nodeId) ?? null,
      slug,
      screenshot: existsSync(png) ? rel(png) : null,
      design_context: existsSync(dc) ? rel(dc) : null,
    });
  }

  // enumerated-but-not-captured: everything the clustering saw that has no evidence
  // on disk. Recorded so downstream never reads "not in the archive" as "the screen
  // does not exist" — and so a later differential capture can target node_ids directly.
  const cluster = clusterByFile.get(fileKey);
  const scope = scopeByFile.get(fileKey);
  const notCaptured = [];
  if (cluster) {
    const captured = new Set(frames.map((fr) => fr.node_id));
    for (const c of cluster.candidates ?? []) {
      if (!c.node_id || captured.has(c.node_id)) continue;
      const requested = scope ? scope.has(c.node_id) : c.bucket === 'representative';
      notCaptured.push({
        node_id: c.node_id,
        name: c.name ?? null,
        family: c.family ?? null,
        reason: requested ? 'capture_failed' : (NOT_CAPTURED_REASON[c.bucket] ?? 'out_of_scope'),
      });
    }
    const familyByNode = new Map((cluster.candidates ?? []).map((c) => [c.node_id, c.family ?? null]));
    for (const fr of frames) {
      if (familyByNode.has(fr.node_id)) fr.family = familyByNode.get(fr.node_id);
    }
  }

  const vars = join(sub, 'variables.json');
  files.push({
    file_key: fileKey,
    ...(urlByFile.has(fileKey) ? { url: urlByFile.get(fileKey) } : {}),
    variables_file: existsSync(vars) ? rel(vars) : null,
    frames,
    ...(notCaptured.length ? { enumerated_not_captured: notCaptured } : {}),
  });
}

// Newest evidence mtime across every file_key. When nothing was captured there is
// no capture time to report — emitting the epoch instead would both be false and
// let a run whose captures all failed look like a completed collection.
const evidenceMtimes = files.flatMap((f) =>
  f.frames
    .map((fr) => fr.design_context ?? fr.screenshot)
    .filter(Boolean)
    .map((evidence) => statSync(join('artifacts', appName, evidence)).mtimeMs),
);

const manifest = {
  app_name: appName,
  ...(evidenceMtimes.length
    ? {
        captured_at: new Date(Math.max(...evidenceMtimes))
          .toISOString()
          .replace(/\.\d{3}Z$/, 'Z'),
      }
    : {}),
  files,
};

const out = JSON.stringify(manifest, null, 2) + '\n';
if (toStdout) {
  process.stdout.write(out);
} else {
  writeFileSync(join(figmaDir, 'figma-manifest.json'), out);
  const total = files.reduce((s, f) => s + f.frames.length, 0);
  const noPng = files.reduce((s, f) => s + f.frames.filter((fr) => !fr.screenshot).length, 0);
  const noDc = files.reduce((s, f) => s + f.frames.filter((fr) => !fr.design_context).length, 0);
  const noName = files.reduce((s, f) => s + f.frames.filter((fr) => !fr.name).length, 0);
  const notCap = files.reduce((s, f) => s + (f.enumerated_not_captured?.length ?? 0), 0);
  const failed = files.reduce(
    (s, f) => s + (f.enumerated_not_captured ?? []).filter((n) => n.reason === 'capture_failed').length,
    0,
  );
  console.log(
    `[build-figma-manifest] wrote ${join(figmaDir, 'figma-manifest.json')} ` +
      `(${files.length} file(s), ${total} frames, ${noPng} without screenshot, ${noDc} without design-context, ${noName} without name, ${notCap} enumerated-not-captured [${failed} capture-failed])`,
  );
  if (unparsedStems.length) {
    console.error(
      `[build-figma-manifest] WARNING: ${unparsedStems.length} file(s) skipped — name does not follow {node-id}--{slug}: ${unparsedStems.join(', ')}`,
    );
  }
}
