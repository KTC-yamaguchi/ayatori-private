// scripts/extract-adf-text.test.mjs
//
// scripts/extract-adf-text.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/extract-adf-text.test.mjs
//
// テスト方針:
//   - CLI (cwd 相対の artifacts/ を読む) なので tmpdir にツリーを作って子プロセス実行
//     (check-ground-truth-fidelity.test.mjs と同じハーネス)。
//   - 固定するのは (a) ADF の表・見出し・コード・パネルが行引用可能な markdown に展開されること
//     (表セルの `|` エスケープ含む)、(b) 生 ADF doc / ページ応答ラップ (body が object・
//     閉じフェンスが行末に癒着) の両形状を受理すること、(c) 非 ADF アーカイブに触れないこと。
//     抽出本は doc_backed 引用の突合先になるため、取りこぼしは下流の証拠喪失に直結する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "extract-adf-text.mjs");

const ADF_DOC = {
  type: "doc",
  version: 1,
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "API一覧" }] },
    { type: "paragraph", content: [{ type: "text", text: "本文の段落。" }] },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Method" }] }] },
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Path" }] }] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "GET" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "/v1/a|b" }] }] },
          ],
        },
      ],
    },
    { type: "codeBlock", attrs: { language: "python" }, content: [{ type: "text", text: "def gate(noi, bak): ..." }] },
    { type: "panel", attrs: { panelType: "warning" }, content: [{ type: "paragraph", content: [{ type: "text", text: "32MB上限あり" }] }] },
    { type: "mediaSingle", content: [{ type: "media", attrs: {} }] },
  ],
};

const header = (id, title) =>
  `# ${title}\n\n**Page ID**: ${id}\n**URL**: https://example.atlassian.net/wiki/pages/${id}\n**Last updated**: 2026-08-01T00:00:00Z\n\n---\n\n`;

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-adf-extract-"));
  const gt = join(root, "artifacts", "app", "ground-truth");
  mkdirSync(gt, { recursive: true });
  return {
    root,
    gt,
    write(name, body) {
      writeFileSync(join(gt, name), body);
    },
    run(args = ["app"]) {
      return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8" });
    },
  };
};

test("bare ADF doc fence: headings/tables/code/panel/media are rendered and cell pipes escaped", (t) => {
  const s = setup();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  s.write("cf-111-api.md", header("111", "API 検証") + "```json\n" + JSON.stringify(ADF_DOC, null, 2) + "\n```\n");

  const res = s.run();
  assert.equal(res.status, 0, res.stderr);
  const out = readFileSync(join(s.gt, "cf-111-api.adf-extract.md"), "utf8");
  assert.match(out, /^## API一覧$/m);
  assert.match(out, /^本文の段落。$/m);
  assert.match(out, /\| GET \| \/v1\/a\\\|b \|/);
  assert.match(out, /```python\ndef gate\(noi, bak\): \.\.\.\n```/);
  assert.match(out, /> \[panel:warning\]/);
  assert.match(out, /\[図: media\]/);
  assert.match(out, /^\*\*Page ID\*\*: 111$/m);
  assert.match(out, /adf-extract \(元アーカイブ: cf-111-api\.md/);
});

test("page-response wrapper with object body and glued closing fence is accepted", (t) => {
  const s = setup();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  const wrapped = { id: "222", type: "page", title: "wrapped", body: ADF_DOC };
  // 実在アーカイブに合わせ、閉じフェンスを最終行に癒着させる (改行なしで }``` )
  s.write("cf-222-wrapped.md", header("222", "wrapped") + "```json\n" + JSON.stringify(wrapped, null, 2) + "```\n");

  const res = s.run();
  assert.equal(res.status, 0, res.stderr);
  const out = readFileSync(join(s.gt, "cf-222-wrapped.adf-extract.md"), "utf8");
  assert.match(out, /^## API一覧$/m);
  assert.match(out, /\| GET \|/);
});

test("non-ADF markdown archives and index.md are untouched; reruns overwrite idempotently", (t) => {
  const s = setup();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  s.write("cf-333-plain.md", header("333", "plain") + "ただの本文。\n");
  s.write("index.md", "# Ground-Truth Index\n");
  s.write("cf-111-api.md", header("111", "API") + "```json\n" + JSON.stringify(ADF_DOC) + "\n```\n");

  assert.equal(s.run().status, 0);
  assert.equal(s.run().status, 0); // 再実行 (上書き) もエラーなし
  const files = readdirSync(s.gt).sort();
  assert.ok(files.includes("cf-111-api.adf-extract.md"));
  assert.ok(!files.includes("cf-333-plain.adf-extract.md"));
  assert.ok(!files.includes("index.adf-extract.md"));
});

test("broken json fence is skipped with a warning, not a crash", (t) => {
  const s = setup();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  s.write("cf-444-broken.md", header("444", "broken") + "```json\n{ not json\n```\n");

  const res = s.run();
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /does not parse/);
  assert.ok(!existsSync(join(s.gt, "cf-444-broken.adf-extract.md")));
});

test("CRLF アーカイブでもフェンスを検出して抽出する (無言スキップしない)", (t) => {
  const s = setup();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  const lf = header("555", "crlf") + "```json\n" + JSON.stringify(ADF_DOC) + "\n```\n";
  s.write("cf-555-crlf.md", lf.replace(/\n/g, "\r\n"));

  const res = s.run();
  assert.equal(res.status, 0, res.stderr);
  const out = readFileSync(join(s.gt, "cf-555-crlf.adf-extract.md"), "utf8");
  assert.match(out, /^## API一覧$/m);
});

test("--stdout では抽出データが stdout、サマリは stderr に分離される", (t) => {
  const s = setup();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  s.write("cf-111-api.md", header("111", "API") + "```json\n" + JSON.stringify(ADF_DOC) + "\n```\n");

  const res = s.run(["app", "--stdout"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^===== cf-111-api\.adf-extract\.md =====/);
  assert.ok(!res.stdout.includes("[extract-adf-text]"), "stdout にサマリ行を混ぜない");
  assert.match(res.stderr, /\[extract-adf-text\] 1 extract\(s\) generated/);
});

test("本文中に JSON 例ブロックを含む通常ページは抽出も warning もしない (ADF アーカイブではない)", (t) => {
  const s = setup();
  t.after(() => rmSync(s.root, { recursive: true, force: true }));
  const body =
    "散文です。\n\n```json\n" + JSON.stringify({ ok: 1 }) + "\n```\n\n" +
    "続きの散文。\n\n```json\n" + JSON.stringify({ ok: 2 }) + "\n```\n";
  s.write("cf-666-api-spec.md", header("666", "api spec") + body);

  const res = s.run();
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(join(s.gt, "cf-666-api-spec.adf-extract.md")), "抽出本を作らない");
  assert.ok(!res.stderr.includes("cf-666-api-spec"), "warning も出さない");
});
