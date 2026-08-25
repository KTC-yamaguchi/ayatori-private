#!/usr/bin/env node
// scripts/profile-context.test.mjs
//
// profile-context.mjs の fixture ベース integration test:
//   合成 transcript (JSONL) を tmpdir に書き、CLI を `--session <fixture> --json` で通して
//   解析 JSON の不変条件を検証する。対象は PR #152 レビュー指摘の回帰ガード:
//   - composition の按分から subagent:* / meta:* / other:* を除外 (byte rollup には残す)
//   - sidechain 行の usage を peak/ctx に混入させない
//   - stale / after-edit の再 Read 分類、is_error 集計、MCP target の method 名 fold
//   - --window の検証 (非数値は exit 1) と window_inferred の null 判定
//   - -h / --h / --help、--session 不正パスの明示エラー (exit 1)
//   - HTML 出力の doctype / charset (テンプレート先頭 + 生成物)
//
// 実行: npm test (= node --test) / 単体: node --test scripts/profile-context.test.mjs
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "profile-context.mjs");

// ---------------------------------------------------------------------------
// fixture transcript
// ---------------------------------------------------------------------------
// A minimal but structurally faithful session: command envelope, Read → re-Read (stale)
// → Edit → re-Read (after edit), a failed Bash call, an MCP call, a sidechain pair with
// its own (foreign) usage, a meta bookkeeping line, and one unparseable line.
const A = "/tmp/proj/a.txt";
const ts = (i) => `2026-07-01T00:00:${String(i).padStart(2, "0")}.000Z`;
const asst = (i, blocks, usage) => ({ type: "assistant", timestamp: ts(i), message: { role: "assistant", content: blocks, usage } });
const result = (i, id, content, extra = {}) => ({ type: "user", timestamp: ts(i), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...extra }] } });
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const usage = (input, cr, cc) => ({ input_tokens: input, cache_read_input_tokens: cr, cache_creation_input_tokens: cc, output_tokens: 10 });

const FIXTURE_LINES = [
  { type: "user", timestamp: ts(0), message: { role: "user", content: "<command-message>status</command-message>\n<command-name>/ayatori-status</command-name>" } },
  asst(1, [use("tu1", "Read", { file_path: A })], usage(1000, 0, 0)),          // ctx 1000
  result(2, "tu1", "line one of a.txt\nline two"),
  asst(3, [use("tu2", "Read", { file_path: A })], usage(0, 1000, 1000)),       // ctx 2000; re-Read with no edit between → stale
  result(4, "tu2", "line one of a.txt\nline two"),
  asst(5, [use("tu3", "Edit", { file_path: A })], usage(0, 2000, 1000)),       // ctx 3000
  result(6, "tu3", "ok"),
  asst(7, [use("tu4", "Read", { file_path: A })], usage(0, 3000, 1000)),       // ctx 4000; re-Read after Edit → fresh
  result(8, "tu4", "line one of a.txt\nline two (edited)"),
  asst(9, [use("tu5", "Bash", { command: "false" })], usage(0, 4000, 500)),    // ctx 4500
  result(10, "tu5", "command failed", { is_error: true }),
  asst(11, [use("tu6", "mcp__figma__get_metadata", {})], usage(0, 4500, 500)), // ctx 5000 = peak
  result(12, "tu6", '{"nodes":[]}'),
  // sidechain pair: its usage is a FOREIGN window measurement (must not touch peak/ctx),
  // and its bytes must stay out of the composition apportionment.
  { isSidechain: true, type: "assistant", timestamp: ts(13), message: { role: "assistant", content: [{ type: "text", text: "subagent reply " + "x".repeat(400) }], usage: usage(500000, 400000, 99999) } },
  { isSidechain: true, type: "user", timestamp: ts(14), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-side", content: "y".repeat(600) }] } },
  { type: "file-history-snapshot", timestamp: ts(15), snapshot: "z".repeat(500) },
];
const N_PARSED = FIXTURE_LINES.length;

function writeFixture(dir) {
  const p = join(dir, "fixture-session.jsonl");
  const body = FIXTURE_LINES.map((o) => JSON.stringify(o)).join("\n") + "\nnot json {{ garbage\n";
  writeFileSync(p, body, "utf8");
  return p;
}

function run(args, opts = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

function runJson(fixture, extra = []) {
  const r = run(["--session", fixture, "--json", ...extra]);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
test("fixture session: aggregation invariants (--json)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "profctx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = runJson(writeFixture(dir));

  assert.equal(data.n_sessions, 1);
  assert.equal(data.scope, "all-sessions"); // --session forces --all
  const s = data.sessions[0];
  assert.equal(s.id, "fixture-session");
  assert.equal(s.nlines, N_PARSED); // the garbage line is skipped, not counted

  // command envelope detection (prose mentions would not count)
  assert.deepEqual(s.cmds, ["ayatori-status"]);

  // sidechain usage is a foreign window: peak comes from the main thread only
  assert.equal(s.peak_ctx, 5000);
  assert.equal(s.last_ctx, 5000);
  assert.equal(s.window, 200000);
  assert.equal(s.window_inferred, true);

  // cache totals: main-thread assistant turns only
  assert.equal(s.cache_input, 1000);
  assert.equal(s.cache_read, 0 + 1000 + 2000 + 3000 + 4000 + 4500);
  assert.equal(s.cache_create, 0 + 1000 + 1000 + 1000 + 500 + 500);

  // failed tool call accounting
  assert.equal(s.err_count, 1);
  assert.ok(s.err_bytes > 0);

  // byte rollup keeps ALL sources, including the ones excluded from composition
  assert.ok(s.rollup["subagent:tool_result"], "rollup keeps subagent sources");
  assert.ok(s.rollup["meta:file-history-snapshot"], "rollup keeps meta sources");

  // composition: only main-window sources, slices summing to ~peak (rounding drift ≤ 1/slice)
  const comp = s.composition;
  assert.ok(comp.length > 0);
  for (const c of comp) assert.ok(!/^(subagent:|meta:|other:)/.test(c.source), `composition must exclude ${c.source}`);
  const sum = comp.reduce((a, c) => a + c.tokens, 0);
  assert.ok(Math.abs(sum - s.peak_ctx) <= comp.length, `slices sum ${sum} ≉ peak ${s.peak_ctx}`);

  // re-Read ledger: 3 reads of the same file → 1 stale (no edit between), 1 fresh (after Edit)
  const read = (data.tool_targets.Read || []).find((it) => it.full === A);
  assert.ok(read, "Read target ledger entry exists");
  assert.equal(read.count, 3);
  assert.equal(read.stale, 1);
  assert.equal(read.fresh, 1);

  // MCP fold: family "MCP", target keyed on the method name
  const mcp = data.tool_targets.MCP || [];
  assert.ok(mcp.some((it) => it.target === "get_metadata"), "MCP targets keyed by method name");
});

test("--window override: valid value is applied, non-numeric is rejected", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "profctx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = writeFixture(dir);

  const s = runJson(fixture, ["--window", "300000"]).sessions[0];
  assert.equal(s.window, 300000);
  assert.equal(s.window_inferred, false);

  const bad = run(["--session", fixture, "--json", "--window", "abc"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invalid --window/);
});

test("help flags: -h / --h / --help all print usage and exit 0", () => {
  for (const f of ["-h", "--h", "--help"]) {
    const r = run([f]);
    assert.equal(r.status, 0, `${f} should exit 0`);
    assert.match(r.stdout, /profile-context/);
  }
});

test("--session with an unreadable path fails loudly (exit 1), not with an empty report", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "profctx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(["--session", dir, "--json"]); // a directory is unreadable as a session file
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot read session file/);
});

test("HTML output: doctype + charset in templates and rendered reports", (t) => {
  for (const tpl of ["profile-context.index.template.html", "profile-context.session.template.html"]) {
    const head = readFileSync(join(HERE, tpl), "utf8").slice(0, 200);
    assert.match(head, /^<!doctype html>/i, `${tpl} must start with a doctype`);
    assert.match(head, /<meta charset="utf-8">/, `${tpl} must declare charset`);
  }

  const dir = mkdtempSync(join(tmpdir(), "profctx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = writeFixture(dir);
  const out = join(dir, "reports");
  const r = run(["--session", fixture, "--out-dir", out]);
  assert.equal(r.status, 0, r.stderr);
  const index = join(out, "context-profile.html");
  const detail = join(out, "context-profile", "fixture-session.html");
  assert.ok(existsSync(index) && existsSync(detail));
  const html = readFileSync(index, "utf8");
  assert.match(html.slice(0, 60), /^<!doctype html>/i);
  assert.ok(html.includes("ayatori-status"), "payload is injected");
  assert.ok(!html.includes("__DATA_INJECT__"), "placeholder replaced");
});

test("session template: gap inflow apportionment excludes sidechain rows", () => {
  // The decomposition runs client-side; guard the exclusion at the source level.
  const tpl = readFileSync(join(HERE, "profile-context.session.template.html"), "utf8");
  const gapFilter = tpl.split("\n").find((l) => l.includes("gap.push"));
  assert.ok(gapFilter, "gap collection line exists");
  for (const pfx of ["meta:", "other:", "subagent:"]) {
    assert.ok(gapFilter.includes(`"${pfx}"`), `gap collection must exclude ${pfx} rows`);
  }
});
