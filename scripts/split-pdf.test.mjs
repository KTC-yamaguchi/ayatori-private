// scripts/split-pdf.test.mjs
//
// scripts/split-pdf.mjs の単体テスト。Node 標準の node:test + node:assert のみ
// (fixture 生成には repo pin 済みの pdf-lib を使う)。
//   実行: node --test scripts/split-pdf.test.mjs
//
// テスト方針:
//   - CLI 契約 (skill 手順が呼ぶ形) を spawnSync の子プロセスで検証する
//     (check-ground-truth-fidelity.test.mjs と同じハーネス)。
//   - 固定するのは (a) 上限超過 PDF が原本ページ番号を保った part 名で分割されること、
//     (b) 上限以内の PDF は split:false でファイルを書かないこと、(c) 壊れた入力が
//     exit 1 で fallback 経路に落ちること。part 名の原本ページ番号は転写の
//     "## Page N" 見出しの根拠なので、命名が崩れると provenance が原本とずれる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "split-pdf.mjs");

async function makePdf(path, pageCount) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([300, 400]);
  writeFileSync(path, await doc.save());
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

test("splits a 16-page PDF into 9+7 parts named by original page numbers", async () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-split-pdf-"));
  try {
    const input = join(root, "サンプル仕様書.pdf");
    const outDir = join(root, "out");
    await makePdf(input, 16);

    const res = run([input, outDir]);
    assert.equal(res.status, 0, res.stderr);
    const summary = JSON.parse(res.stdout);
    assert.equal(summary.pages, 16);
    assert.equal(summary.split, true);
    assert.deepEqual(
      summary.parts.map((p) => [p.pages, p.page_count]),
      [["1-9", 9], ["10-16", 7]]
    );

    const written = readdirSync(outDir).sort();
    assert.deepEqual(written, ["サンプル仕様書.p1-9.pdf", "サンプル仕様書.p10-16.pdf"].sort());
    for (const part of summary.parts) {
      const reloaded = await PDFDocument.load(readFileSync(part.file));
      assert.equal(reloaded.getPageCount(), part.page_count, part.file);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a PDF within the limit reports split:false and writes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-split-pdf-"));
  try {
    const input = join(root, "short.pdf");
    const outDir = join(root, "out");
    await makePdf(input, 9);

    const res = run([input, outDir]);
    assert.equal(res.status, 0, res.stderr);
    const summary = JSON.parse(res.stdout);
    assert.equal(summary.split, false);
    assert.deepEqual(summary.parts, []);
    assert.throws(() => readdirSync(outDir)); // out-dir was never created
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--max-pages overrides the part size", async () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-split-pdf-"));
  try {
    const input = join(root, "doc.pdf");
    const outDir = join(root, "out");
    await makePdf(input, 10);

    const res = run([input, outDir, "--max-pages", "4"]);
    assert.equal(res.status, 0, res.stderr);
    const summary = JSON.parse(res.stdout);
    assert.deepEqual(
      summary.parts.map((p) => p.pages),
      ["1-4", "5-8", "9-10"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-PDF input exits 1 with a fallback hint (no crash, no partial writes)", async () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-split-pdf-"));
  try {
    const input = join(root, "not-a-pdf.pdf");
    const outDir = join(root, "out");
    writeFileSync(input, "plain text pretending to be a pdf");

    const res = run([input, outDir]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /cannot split/);
    assert.throws(() => readdirSync(outDir));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing arguments exit 1 with usage", () => {
  const res = run([]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Usage:/);
});
