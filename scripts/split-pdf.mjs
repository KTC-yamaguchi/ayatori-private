#!/usr/bin/env node
// Split a PDF into parts small enough for the Read tool's native (no-`pages`)
// route, which handles roughly 10 pages per call. Page *rendering* requires
// poppler (never installed, by design — Operating Principle 1), but page
// *splitting* is pure file-format surgery, so the repo-pinned pure-JS
// dependency `pdf-lib` can do it with no external CLI involved.
//
// Input:  any local PDF (typically artifacts/{app}/input-sources/docs/*.pdf)
// Output: <out-dir>/{stem}.p{first}-{last}.pdf per part. Part filenames keep
//         the ORIGINAL page numbers so a transcription can anchor its
//         "## Page N" headings to the source document, not to the part.
//         A JSON summary goes to stdout for the calling skill.
//
// The out-dir must be a pipeline-owned working dir (e.g.
// artifacts/{app}/ground-truth/.pdf-split/{stem}/) — never input-sources/,
// which is user-owned. Existing part files are overwritten (idempotent).
//
// Uses pdf-lib (© 2019 Andrew Dillon, MIT — see licenses/pdf-lib-MIT).
//
// Usage: node scripts/split-pdf.mjs <input.pdf> <out-dir> [--max-pages N]
// Exit:  0 = success (summary.split tells whether parts were written;
//            a PDF already within the limit reports split:false, no files)
//        1 = bad arguments / unreadable input (encrypted or corrupt PDFs
//            land here — callers fall back to asking the user for a
//            re-export, exactly as before this script existed)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";

// Default chosen to stay safely under the native route's ~10-page ceiling.
const DEFAULT_MAX_PAGES = 9;

export async function splitPdf(inputPath, outDir, maxPages = DEFAULT_MAX_PAGES) {
  const bytes = await readFile(inputPath);
  const src = await PDFDocument.load(bytes); // throws on encrypted / corrupt input
  const total = src.getPageCount();
  const stem = basename(inputPath).replace(/\.pdf$/i, "");

  const summary = {
    input: inputPath,
    pages: total,
    max_pages_per_part: maxPages,
    split: total > maxPages,
    parts: [],
  };
  if (!summary.split) return summary;

  await mkdir(outDir, { recursive: true });
  for (let start = 0; start < total; start += maxPages) {
    const end = Math.min(start + maxPages, total); // exclusive
    const part = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    for (const page of await part.copyPages(src, indices)) part.addPage(page);
    const file = join(outDir, `${stem}.p${start + 1}-${end}.pdf`);
    await writeFile(file, await part.save());
    summary.parts.push({ file, pages: `${start + 1}-${end}`, page_count: end - start });
  }
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = [];
  let maxPages = DEFAULT_MAX_PAGES;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-pages") {
      maxPages = Number.parseInt(args[++i], 10);
    } else {
      positional.push(args[i]);
    }
  }
  const [inputPath, outDir] = positional;
  if (!inputPath || !outDir || !Number.isInteger(maxPages) || maxPages < 1) {
    console.error("Usage: node scripts/split-pdf.mjs <input.pdf> <out-dir> [--max-pages N]");
    process.exit(1);
  }
  try {
    const summary = await splitPdf(inputPath, outDir, maxPages);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error(`split-pdf: cannot split ${inputPath}: ${err.message}`);
    console.error(
      "split-pdf: fall back to asking the user for a re-export (md / txt, or a decrypted PDF)."
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
