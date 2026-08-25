#!/usr/bin/env node
// Generate a deterministic, line-citable text extract next to every archive that
// was stored as raw ADF JSON (ground-truth pages whose tables/panels/macros do
// not survive markdown conversion are archived as a ```json fence).
//
// Why: the raw ADF file is the loss-free evidence master, but ~90%+ of its bytes
// are structural boilerplate. A downstream pass that reads the raw JSON burns a
// large context budget and mis-reads adjacent table rows when skimming. This
// script walks the node tree once and emits a compact markdown rendering
// (headings / paragraphs / tables / code blocks / list items), so downstream
// steps read and cite the extract instead of the raw JSON.
//
// The extract is a derived view, not a collection: it is regenerated (overwritten)
// from the archive on every run, carries no timestamp, and must never be
// hand-edited. Citation grammar `ground-truth/{file}.md:line` applies to it
// unchanged (it lives at ground-truth root and ends in .md).
//
// Usage:
//   node scripts/extract-adf-text.mjs <app_name> [--stdout] [--file <archive.md>]
//
//   --file <archive.md>  process only this archive (filename relative to ground-truth/)
//   --stdout             print extracts instead of writing them
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const toStdout = args.includes('--stdout');
const fileIdx = args.indexOf('--file');
const onlyFile = fileIdx >= 0 ? args[fileIdx + 1] : null;
const appName = args.find((a, i) => !a.startsWith('--') && (fileIdx < 0 || i !== fileIdx + 1));
if (!appName) {
  console.error('Usage: node scripts/extract-adf-text.mjs <app_name> [--stdout] [--file <archive.md>]');
  process.exit(1);
}

const dir = join('artifacts', appName, 'ground-truth');
if (!existsSync(dir)) {
  console.error(`not found: ${dir}`);
  process.exit(1);
}

const EXTRACT_SUFFIX = '.adf-extract.md';

// ── inline rendering: flatten a node's inline content to one string
const inlineText = (node) => {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(inlineText).join('');
  switch (node.type) {
    case 'text': {
      let t = node.text ?? '';
      const link = (node.marks || []).find((m) => m.type === 'link');
      if (link?.attrs?.href && link.attrs.href !== t) t = `${t} (${link.attrs.href})`;
      return t;
    }
    case 'hardBreak':
      return ' ';
    case 'mention':
      return `@${node.attrs?.text ?? ''}`;
    case 'emoji':
      return node.attrs?.shortName ?? '';
    case 'date':
      return node.attrs?.timestamp
        ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10)
        : '';
    case 'status':
      return `[${node.attrs?.text ?? 'status'}]`;
    case 'inlineCard':
    case 'embedCard':
      return `[card: ${node.attrs?.url ?? ''}]`;
    default:
      return inlineText(node.content || []);
  }
};

// Table cells collapse to single-line text; `|` must be escaped or every
// following column shifts in the rendered markdown table.
const cellText = (cellNode) =>
  (cellNode.content || [])
    .map((n) => inlineText(n))
    .join(' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();

// ── block rendering: walk the tree, emit markdown lines
const renderBlocks = (nodes, out, depth = 0) => {
  for (const node of nodes || []) {
    switch (node.type) {
      case 'heading': {
        const lvl = Math.min(Math.max(node.attrs?.level ?? 1, 1), 6);
        out.push('', `${'#'.repeat(lvl)} ${inlineText(node.content || []).trim()}`, '');
        break;
      }
      case 'paragraph': {
        const t = inlineText(node.content || []).trim();
        if (t) out.push(t, '');
        break;
      }
      case 'table': {
        const rows = (node.content || []).filter((r) => r.type === 'tableRow');
        if (!rows.length) break;
        const rendered = rows.map((r) =>
          `| ${(r.content || []).map(cellText).join(' | ')} |`,
        );
        const colCount = (rows[0].content || []).length;
        out.push(rendered[0], `|${' --- |'.repeat(colCount)}`, ...rendered.slice(1), '');
        break;
      }
      case 'codeBlock': {
        out.push('```' + (node.attrs?.language ?? ''));
        out.push(inlineText(node.content || []));
        out.push('```', '');
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        let i = 1;
        for (const item of node.content || []) {
          const marker = node.type === 'orderedList' ? `${i++}.` : '-';
          const inner = [];
          renderBlocks(item.content || [], inner, depth + 1);
          const text = inner.filter((l) => l !== '').join(' / ');
          out.push(`${'  '.repeat(depth)}${marker} ${text}`);
        }
        out.push('');
        break;
      }
      case 'taskList': {
        for (const item of node.content || []) {
          const state = item.attrs?.state === 'DONE' ? 'x' : ' ';
          out.push(`- [${state}] ${inlineText(item.content || []).trim()}`);
        }
        out.push('');
        break;
      }
      case 'panel': {
        const inner = [];
        renderBlocks(node.content || [], inner, depth);
        out.push(`> [panel:${node.attrs?.panelType ?? 'info'}]`);
        for (const l of inner) if (l) out.push(`> ${l}`);
        out.push('');
        break;
      }
      case 'blockquote': {
        const inner = [];
        renderBlocks(node.content || [], inner, depth);
        for (const l of inner) if (l) out.push(`> ${l}`);
        out.push('');
        break;
      }
      case 'expand':
      case 'nestedExpand': {
        out.push(`▸ ${node.attrs?.title ?? '(expand)'}`);
        renderBlocks(node.content || [], out, depth);
        break;
      }
      case 'mediaSingle':
      case 'mediaGroup':
      case 'media': {
        out.push('[図: media]', '');
        break;
      }
      case 'rule': {
        out.push('---', '');
        break;
      }
      case 'extension':
      case 'bodiedExtension':
      case 'inlineExtension': {
        out.push(`[macro: ${node.attrs?.extensionKey ?? node.attrs?.extensionType ?? 'extension'}]`, '');
        renderBlocks(node.content || [], out, depth);
        break;
      }
      case 'layoutSection':
      case 'layoutColumn':
      case 'tableRow':
      case 'tableCell':
      case 'tableHeader':
      case 'listItem':
      case 'doc':
      default: {
        // Structural wrappers and unknown nodes: recurse so no text is dropped.
        if (node.content) renderBlocks(node.content, out, depth);
        break;
      }
    }
  }
};

const extractOne = (file) => {
  // Normalize line endings first: fence detection below matches "```json\n"
  // literally, and on a CRLF archive a failed match silently skips the file.
  const raw = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  // An ADF archive stores its WHOLE body as one ```json fence right after the
  // header separator. A fence found mid-body is a JSON example inside a normal
  // markdown page — not an ADF archive, so it must not be extracted (nor warned
  // about). Same scoping rule as check-ground-truth-fidelity's parse check.
  const sepIdx = raw.indexOf('\n---\n');
  const bodyStart = (sepIdx >= 0 ? raw.slice(sepIdx + 5) : raw).trimStart();
  if (!bodyStart.startsWith('```json\n')) return null;
  // Archives in the wild close the fence inconsistently (some collectors append
  // ``` on the same line as the final `}`), so take everything from the opening
  // fence to the last ``` instead of requiring a well-formed close.
  const rest = bodyStart.slice('```json\n'.length);
  const close = rest.lastIndexOf('```');
  const payload = (close >= 0 ? rest.slice(0, close) : rest).trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (e) {
    console.error(`[extract-adf-text] WARNING: ${file}: json fence does not parse (${e.message}) — skipped`);
    return null;
  }
  // Accept both archive shapes: the bare ADF doc, or a whole page-fetch response
  // whose `body` field holds the ADF doc (as an object or as a JSON string).
  let doc = parsed;
  if (doc?.type !== 'doc' && !Array.isArray(doc?.content)) {
    let body = doc?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    doc = body;
  }
  if (!doc || (doc.type !== 'doc' && !Array.isArray(doc.content))) {
    console.error(`[extract-adf-text] WARNING: ${file}: fence is JSON but not an ADF doc — skipped`);
    return null;
  }

  const header = (label) => {
    const m = raw.match(new RegExp(`^\\*\\*${label}\\*\\*:\\s*(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const title = (raw.match(/^#\s+(.*)$/m) || [, file])[1].trim();

  const body = [];
  renderBlocks(doc.content || [], body);
  // Collapse runs of blank lines so line anchors stay stable and compact.
  const compact = [];
  for (const l of body) {
    if (l === '' && compact[compact.length - 1] === '') continue;
    compact.push(l);
  }

  const out = [];
  out.push(`# ${title}`);
  out.push('');
  out.push(`**Page ID**: ${header('Page ID')}`);
  out.push(`**Source**: adf-extract (元アーカイブ: ${file} — \`scripts/extract-adf-text.mjs\` の決定論生成。手編集しない)`);
  if (header('URL')) out.push(`**URL**: ${header('URL')}`);
  if (header('Last updated')) out.push(`**Last updated**: ${header('Last updated')}`);
  out.push('');
  out.push('---');
  out.push('');
  out.push(...compact);
  return out.join('\n').replace(/\n+$/, '') + '\n';
};

let processed = 0;
let skipped = 0;
const files = onlyFile
  ? [onlyFile]
  : readdirSync(dir)
      .filter((f) => f.endsWith('.md') && f !== 'index.md' && !f.endsWith(EXTRACT_SUFFIX))
      .sort();

for (const file of files) {
  if (!existsSync(join(dir, file))) {
    console.error(`[extract-adf-text] not found: ${file}`);
    process.exitCode = 1;
    continue;
  }
  const extract = extractOne(file);
  if (extract === null) {
    skipped++;
    continue;
  }
  const outName = file.replace(/\.md$/, EXTRACT_SUFFIX);
  if (toStdout) {
    process.stdout.write(`===== ${outName} =====\n${extract}`);
  } else {
    writeFileSync(join(dir, outName), extract);
  }
  processed++;
}

// With --stdout the data channel is stdout, so keep the summary on stderr —
// mixing them makes the piped output non-machine-readable.
(toStdout ? console.error : console.log)(
  `[extract-adf-text] ${processed} extract(s) generated, ${skipped + (files.length - processed - skipped)} non-ADF file(s) untouched`,
);
