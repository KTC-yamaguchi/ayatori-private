#!/usr/bin/env node
// Build artifacts/{app_name}/ground-truth/index.md deterministically from the
// archived document files (Step 01 document collection output).
//
// Why this is a script and not hand-written: the index must record a per-file
// **content status**. Confluence pages whose payload is a diagram (draw.io macro)
// or an attached image archive as heading-only shells — downstream steps would
// otherwise read "no information" as a fact, or an auditor would cite an empty
// section as `ground-truth/{file}.md:{line}`. Measuring prose length and image
// placeholder count mechanically keeps that judgement reproducible.
//
// Usage:
//   node scripts/build-ground-truth-index.mjs <app_name> [--stdout] [--failed <json>]
//
//   --stdout          print the index instead of writing it
//   --failed <json>   path to a JSON file listing pages that could not be
//                     archived: [{ "page_id": "...", "title": "...", "reason": "..." }]
//                     They are listed in the index so downstream never mistakes
//                     an unrecoverable page for a non-existent one.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const toStdout = args.includes('--stdout');
const failedIdx = args.indexOf('--failed');
const failedArg = failedIdx >= 0 ? args[failedIdx + 1] : null;
// `--failed <path>` takes a value, so that value must not be mistaken for the
// positional app_name when the flag comes first.
const appName = args.find((a, i) => !a.startsWith('--') && (failedIdx < 0 || i !== failedIdx + 1));
if (!appName) {
  console.error('Usage: node scripts/build-ground-truth-index.mjs <app_name> [--stdout] [--failed <json>]');
  process.exit(1);
}

const dir = join('artifacts', appName, 'ground-truth');
if (!existsSync(dir)) {
  console.error(`not found: ${dir}`);
  process.exit(1);
}

// ── content status thresholds (prose = body minus headings/zero-width/whitespace)
// Per source, because the same character count means different things: a spec page
// of 100 characters really is a shell, while a Jira issue of 100 Japanese characters
// is a complete change request. Using the page thresholds on issues classifies most
// of them as uncitable and silently withholds valid evidence from downstream steps.
const THRESHOLDS = {
  confluence: { shell: 100, thin: 400 },
  local: { shell: 100, thin: 400 },
  jira: { shell: 40, thin: 200 },
};
const SHELL_MAX = THRESHOLDS.confluence.shell;
const THIN_MAX = THRESHOLDS.confluence.thin;

// Titles and failure reasons come from Confluence/Jira, where `|` is ordinary
// punctuation. Unescaped it shifts every following column, and this table is what
// downstream reads to decide whether a file may be cited at all.
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

const field = (body, label) => {
  const m = body.match(new RegExp(`^\\*\\*${label}\\*\\*:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};

const rows = [];
for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith('.md') || file === 'index.md') continue;
  // Normalise line endings first: the header separator below is matched literally,
  // and on a CRLF archive a failed match makes the whole header count as body prose —
  // which promotes a heading-only shell into a citable "thin" page.
  const raw = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const title = (raw.match(/^#\s+(.*)$/m) || [, file.replace(/\.md$/, '')])[1].trim();
  const pageId = field(raw, 'Page ID');
  const url = field(raw, 'URL');
  const updated = field(raw, 'Last updated');
  // The archived `**Source**:` line is free-form ("jira (ABC-123)" /
  // "input-sources/docs/spec.md (local)"), so normalise it to a kind before it is
  // used as a THRESHOLDS key — a raw string key silently falls back to the
  // confluence thresholds and misclassifies short-but-complete Jira issues as shells.
  const sourceRaw = field(raw, 'Source');
  const source = file.endsWith('.adf-extract.md') || /^adf-extract\b/.test(sourceRaw)
    ? 'adf-extract'
    : /\bjira\b/i.test(sourceRaw) || file.startsWith('jira-')
      ? 'jira'
      : /\blocal\b/i.test(sourceRaw) || file.startsWith('local-')
        ? 'local'
        : sourceRaw || pageId
          ? 'confluence'
          : 'local';

  // body = everything after the archiver header separator
  const sepIdx = raw.indexOf('\n---\n');
  const body = sepIdx >= 0 ? raw.slice(sepIdx + 5) : raw;
  const prose = body
    .replace(/^#{1,6} .*$/gm, '')       // headings carry no evidence by themselves
    // Confluence structural nodes are references, not content. Counting them inflates
    // a link-only page into a "has body" page — the screen-transition page in the Prism
    // run measured 566 chars while holding nothing but headings and three smartlinks.
    .replace(/<custom\b[^>]*>[\s\S]*?<\/custom>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')  // image refs (the image itself is not archived)
    .replace(/https?:\/\/\S+/g, '')        // bare URLs are pointers, not prose
    .replace(/[​‌]/g, '')     // zero-width chars Confluence emits for empty blocks
    .replace(/\s+/g, '');
  const proseLen = prose.length;
  const placeholders = (body.match(/!\[[^\]]*\]\(blob:/g) || []).length;

  // Pages whose ADF body exceeded the server-side markdown conversion limit are
  // archived as raw ADF JSON. Line-based citation still works, but a consumer
  // expecting prose/tables must read node structure instead — flag it explicitly.
  const isAdfJson = /"type"\s*:\s*"doc"/.test(body) && /```json/.test(body);

  // Unfilled template detection: a spec page can carry enough label/heading text
  // to look substantial while every table cell is blank. Prose length alone reads
  // that as citable, so measure table fill separately.
  let dataCells = 0;
  let blankCells = 0;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|');
    // Separator row = every cell is `---` / `:--` / `--:` style. Checking per cell
    // matters: an all-blank data row (`|  |  |  |`) is also made only of spaces and
    // pipes, so a whole-line character-class test would swallow it and hide exactly
    // the unfilled tables we are trying to detect.
    const isSeparator = cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
    if (isSeparator) continue;
    for (const c of cells) {
      dataCells++;
      if (c.replace(/[\s​‌*]/g, '') === '') blankCells++;
    }
  }
  const tableBlankRatio = dataCells ? blankCells / dataCells : 0;
  const unfilledTemplate = dataCells >= 6 && tableBlankRatio >= 0.6;

  const th = THRESHOLDS[source] ?? THRESHOLDS.confluence;
  let status;
  if (isAdfJson) status = 'ADF生JSON';
  else if (proseLen < th.shell) status = placeholders > 0 ? '図のみ' : '殻';
  else if (unfilledTemplate) status = 'テンプレート未記入';
  else if (proseLen < th.thin) status = placeholders > 0 ? '薄い+図依存' : '薄い';
  else status = placeholders > 0 ? '本文+図依存' : '本文';

  // Confluence page links found in the body (plain markdown links, smartlinks,
  // and URLs inside raw ADF JSON alike — a page id in any URL form counts).
  // These feed the "referenced but not collected" section below: a page that is
  // linked from the archive but lives outside the enumerated tree leaves no
  // trace in the failed ledger, and downstream would read its absence as
  // "does not exist" unless the index surfaces it.
  const linkedIds = new Set();
  for (const m of raw.matchAll(/atlassian\.net\/wiki\/[^\s"'()\\]*?\/pages\/(?:edit-v2\/)?(\d+)/g)) {
    linkedIds.add(m[1]);
  }

  rows.push({ file, title, source, pageId, url, updated, proseLen, placeholders, status, linkedIds });
}

// The failed/out-of-scope ledger is what keeps downstream from reading "absent from
// the archive" as "does not exist", so a malformed or missing ledger must be loud:
// never let it take the index down with it, and never let it disappear in silence.
// When the flag is omitted the conventional path is used, so forgetting it does not
// drop the section.
const failedPath = failedArg ?? join(dir, '.collection-failed.json');
let failed = [];
if (existsSync(failedPath)) {
  try {
    const parsed = JSON.parse(readFileSync(failedPath, 'utf8'));
    if (Array.isArray(parsed)) failed = parsed;
    else console.error(`[build-ground-truth-index] WARNING: ${failedPath} is not a JSON array — ignored`);
  } catch (e) {
    console.error(`[build-ground-truth-index] WARNING: could not parse ${failedPath} (${e.message}) — ignored`);
  }
} else if (failedArg) {
  console.error(`[build-ground-truth-index] WARNING: --failed ${failedArg} does not exist — ignored`);
}

const count = (pred) => rows.filter(pred).length;
const shells = rows.filter((r) => r.status === '殻' || r.status === '図のみ');
const templates = rows.filter((r) => r.status === 'テンプレート未記入');
const adf = rows.filter((r) => r.status === 'ADF生JSON');
const extracts = rows.filter((r) => r.source === 'adf-extract');
const imgDependent = rows.filter((r) => r.placeholders > 0);

// Referenced-but-uncollected: page ids linked from any archive body that are
// neither collected (rows) nor already accounted for in the failed/out-of-scope
// ledger. Sorted for deterministic output.
const knownIds = new Set([
  ...rows.map((r) => r.pageId).filter(Boolean),
  ...failed.map((f) => String(f.page_id ?? f.key ?? f.id ?? '')).filter(Boolean),
]);
const referencedBy = new Map();
for (const r of rows) {
  for (const id of r.linkedIds ?? []) {
    if (knownIds.has(id)) continue;
    if (!referencedBy.has(id)) referencedBy.set(id, new Set());
    referencedBy.get(id).add(r.file);
  }
}
const uncollectedRefs = [...referencedBy.entries()].sort(([a], [b]) => a.localeCompare(b));

const lines = [];
lines.push(`# Ground-Truth Index — ${appName}`);
lines.push('');
lines.push(`**Generated**: ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} (\`scripts/build-ground-truth-index.mjs\` — 手編集しない)`);
lines.push(`**Archived documents**: ${rows.length}`);
lines.push('');
lines.push('## Content status サマリ');
lines.push('');
lines.push('| status | 件数 | 意味 |');
lines.push('|---|---|---|');
lines.push(`| 本文 | ${count((r) => r.status === '本文')} | 実質本文あり。doc_backed の引用先として使える |`);
lines.push(`| 本文+図依存 | ${count((r) => r.status === '本文+図依存')} | 本文はあるが図・画像が本文の一部。図の内容はアーカイブに含まれない |`);
lines.push(`| 薄い / 薄い+図依存 | ${count((r) => r.status.startsWith('薄い'))} | 本文が ${SHELL_MAX}〜${THIN_MAX} 文字 (Jira 課題は ${THRESHOLDS.jira.shell}〜${THRESHOLDS.jira.thin} 文字 — 課題は短くても 1 件の変更要求として成立するため)。引用可だが根拠としては弱い |`);
lines.push(`| テンプレート未記入 | ${templates.length} | **表のセルがほぼ空の未記入テンプレート。ラベルだけで本文量はあるが仕様値は無い → 仕様として引用してはならない** |`);
if (adf.length) lines.push(`| ADF生JSON | ${adf.length} | 構造化コンテンツ (表・パネル等) を損失なく保存した生 ADF JSON。**下流は直接読まず、並置の抽出本 (.adf-extract.md) を読む・引用する** (\`scripts/extract-adf-text.mjs\` で決定論生成) |`);
if (extracts.length) lines.push(`| 抽出本 (adf-extract) | ${extracts.length} | ADF生JSON アーカイブからの決定論テキスト抽出。行番号引用可 — ADF生JSON を読む代わりにこちらを読む |`);
lines.push(`| 殻 / 図のみ | ${shells.length} | **実質本文なし (見出しのみ or 図のみ)。doc_backed の引用先として使えない** |`);
lines.push('');
lines.push('⚠️ **殻 / 図のみ のページを「情報が無い」と解釈してはならない** — 元ページには図 (draw.io マクロ / 添付画像) で情報が存在するが、markdown 取得では本文化されないため落ちている。これらを根拠に「その仕様は存在しない」と結論づけたり、空セクションを `ground-truth/{file}.md:{line}` として引用したりしないこと。図の実体が必要な場合は元ページから画像をエクスポートして `input-sources/docs/` に配置する。');
lines.push('');
if (imgDependent.length) {
  lines.push(`画像プレースホルダ (\`![](blob:…)\`) 総数: **${imgDependent.reduce((s, r) => s + r.placeholders, 0)}** / 該当 ${imgDependent.length} ファイル。`);
  lines.push('');
}

if (failed.length) {
  lines.push('## 未収集 / 収集失敗 (アーカイブに存在しない)');
  lines.push('');
  lines.push('元ソース (Confluence ページ / Jira 課題 / ローカル文書) には存在するが、下記理由でアーカイブに入っていないもの。予算ゲートで範囲外にしたものもここに載る。**「存在しない」と誤認しないこと** — 必要になったら差分収集で足す。');
  lines.push('');
  lines.push('| ID | Title | 理由 |');
  lines.push('|---|---|---|');
  for (const f of failed) {
    lines.push(`| ${cell(f.page_id ?? f.key ?? f.id) || '—'} | ${cell(f.title) || '(不明)'} | ${cell(f.reason) || '(不明)'} |`);
  }
  lines.push('');
}

if (uncollectedRefs.length) {
  lines.push('## 参照されているが未収集 (リンク検出)');
  lines.push('');
  lines.push('アーカイブ本文がリンクで参照しているのに、収集済みにも未収集台帳にも存在しないページ。収集ツリーの外 (別の親・別スペース) にあるため列挙に現れなかったものが典型。**「存在しない」と誤認しないこと** — 内容が必要なら該当 page ID を差分収集で追加する。');
  lines.push('');
  lines.push('| Page ID | 参照元アーカイブ |');
  lines.push('|---|---|');
  for (const [id, files] of uncollectedRefs) {
    lines.push(`| ${cell(id)} | ${cell([...files].sort().join(', '))} |`);
  }
  lines.push('');
}

lines.push('## Documents');
lines.push('');
lines.push('| File | Title | Source | Page ID | Updated | Content | 本文長 | 図 |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const strong = r.status === '殻' || r.status === '図のみ' || r.status === 'テンプレート未記入' || r.status === 'ADF生JSON';
  const mark = strong ? `**${r.status}**` : r.status;
  lines.push(
    `| ${cell(r.file)} | ${cell(r.title)} | ${cell(r.source)} | ${cell(r.pageId) || '—'} | ${cell(r.updated) || '—'} | ${mark} | ${r.proseLen} | ${r.placeholders || ''} |`,
  );
}
lines.push('');
lines.push('> Figma capture は本 index の対象外 — `ground-truth/figma/figma-manifest.json` を参照。');

const out = lines.join('\n') + '\n';
if (toStdout) {
  process.stdout.write(out);
} else {
  writeFileSync(join(dir, 'index.md'), out);
  console.log(`[build-ground-truth-index] wrote ${join(dir, 'index.md')} (${rows.length} docs, ${shells.length} shell/diagram-only, ${templates.length} unfilled-template, ${failed.length} failed, ${uncollectedRefs.length} referenced-but-uncollected)`);
}
