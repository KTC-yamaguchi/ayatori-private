#!/usr/bin/env node
// skills/08-design-brainstorm/evals/oklch-script-evals.test.mjs
//
// Skill 08 (08-design-brainstorm) の **script CLI 契約テスト**: scripts/oklch-color.mjs を
//   黒箱 CLI として golden fixture に対して回し、stdout / exit code を固定する。
//
// 雛形は skills/11-wcag-mapping/evals/wcag-script-evals.test.mjs (wcag-contrast 用)。
//   本 runner の拡張点は 2 つ:
//   - input.json の inert key "argv" — サブコマンド + フラグ (例 ["lint","--tolerance","10"])。
//     wcag runner の "modes" に相当する一般化。input.json 全文はそのまま stdin にも流す
//     (script は argv/_note/expect_exit を無視して items/pairs/cases のみ読む)。
//   - input.json の inert key "expect_exit" (default 0) — lint の drift 検出 fixture は
//     「stdout が golden 一致 かつ exit 1」を pin する (wcag runner は exit 0 前提だった)。
//
// なぜ unit test (scripts/oklch-color.test.mjs) と別に必要か:
//   unit test は内部関数 (hexToOklch / solvePair / lintBrief 等) を白箱で検証する。
//   本 eval は CLI 統合 (subcommand dispatch / フラグ / stdin / exit code 契約 0-1-2 /
//   組み上がった stdout JSON 全体の shape) を end-to-end で固定する。
//   skill 08 (mode B 補正・Phase 7.5 lint self-check) と skill 11 (Phase 6 suggested_correction)
//   が CLI 契約に依存する以上、契約自体の回帰検出が必要。
//
// 使い方:
//   npm test                              # 検証 (node --test の規約 discovery で本ファイルも拾われる)
//   npm run evals:regen-goldens:oklch     # golden 再生成 (= 本ファイルを --update 付きで直接実行)
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "oklch-color.mjs");
const FIXTURES_DIR = join(HERE, "fixtures");

// error を期待する fixture (expected.json を持たず exit code / stderr を検証する)。
// input.json が invalid JSON のケースがあるため argv はここで持つ。
const ERROR_FIXTURES = {
  "error-invalid-json": { argv: ["lint"], exit_code: 2, stderr_includes: "JSON" },
  "error-unknown-subcommand": { argv: ["frobnicate"], exit_code: 2, stderr_includes: "[oklch-color]" },
  // バッチ + --margin は silent ignore ではなく fail-loud (PR レビュー nitpick 対応)
  "error-solve-batch-margin-flag": { argv: ["solve", "--margin", "0.5"], exit_code: 2, stderr_includes: "margin" },
};

/** fixtures/ 配下のディレクトリ名を列挙 (input.json を持つもの)。 */
function listFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(FIXTURES_DIR, d.name, "input.json")))
    .map((d) => d.name)
    .sort();
}

/** fixture の input.json を読み、argv / expect_exit を解決して script を回す。 */
function runFixture(name) {
  const raw = readFileSync(join(FIXTURES_DIR, name, "input.json"), "utf8");

  let argv = ERROR_FIXTURES[name]?.argv ?? [];
  let expectExit = ERROR_FIXTURES[name]?.exit_code ?? 0;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.argv)) argv = parsed.argv;
    if (typeof parsed?.expect_exit === "number") expectExit = parsed.expect_exit;
  } catch {
    // invalid-json fixture: ERROR_FIXTURES の argv をそのまま使う
  }

  // PATH 上の node ではなく実行中の Node と同じバイナリを使う (asdf/nvm/CI で版が食い違うのを防ぐ)
  const res = spawnSync(process.execPath, [SCRIPT, ...argv], { input: raw, encoding: "utf8" });
  return { res, expectExit };
}

// ── 検証 / 再生成 ──────────────────────────────────────

const UPDATE = process.argv.includes("--update");

if (UPDATE) {
  for (const name of listFixtures()) {
    if (ERROR_FIXTURES[name]) continue;
    const { res, expectExit } = runFixture(name);
    if (res.status !== expectExit) {
      console.error(
        `[update] ${name}: exit ${res.status} (期待 ${expectExit})。stderr:\n${res.stderr}`,
      );
      process.exitCode = 1;
      continue;
    }
    const out = JSON.parse(res.stdout); // 正規化のため round-trip
    writeFileSync(join(FIXTURES_DIR, name, "expected.json"), JSON.stringify(out, null, 2) + "\n");
    console.log(`[update] ${name}: expected.json を再生成 (exit ${res.status})`);
  }
} else {
  for (const name of listFixtures()) {
    if (ERROR_FIXTURES[name]) {
      const spec = ERROR_FIXTURES[name];
      test(`oklch CLI (error): ${name} → exit ${spec.exit_code}`, () => {
        const { res } = runFixture(name);
        assert.equal(res.status, spec.exit_code, `exit code mismatch (stderr: ${res.stderr})`);
        if (spec.stderr_includes) {
          assert.ok(
            res.stderr.includes(spec.stderr_includes),
            `stderr に "${spec.stderr_includes}" を含むべき。実際:\n${res.stderr}`,
          );
        }
        assert.equal(res.stdout.trim(), "", "error 時は stdout に出力しない");
      });
      continue;
    }

    test(`oklch CLI: ${name} → stdout が golden 一致`, () => {
      const expectedPath = join(FIXTURES_DIR, name, "expected.json");
      assert.ok(
        existsSync(expectedPath),
        `${name}/expected.json が無い。生成: npm run evals:regen-goldens:oklch`,
      );
      const { res, expectExit } = runFixture(name);
      assert.equal(
        res.status, expectExit,
        `exit ${res.status} (期待 ${expectExit})。stderr:\n${res.stderr}`,
      );

      const actual = JSON.parse(res.stdout);
      const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
      assert.deepEqual(
        actual,
        expected,
        `${name}: stdout が golden と不一致。意図的な script 変更なら --update で golden を更新`,
      );
    });
  }

  // ── CLI 単発フラグモードの回帰 (fixture は全て stdin 経由のため別途 pin) ──
  test("oklch CLI: convert --hex 単発モードは stdin なしで動く", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "convert", "--hex", "#0E78A8"], {
      input: "", encoding: "utf8",
    });
    assert.equal(res.status, 0, `exit ${res.status}。stderr:\n${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.input_kind, "hex");
    assert.deepEqual(out.oklch, { l: 0.542, c: 0.113, h: 236.2 });
  });

  test("oklch CLI: solve --fg/--bg/--required 単発モードは stdin なしで動く", () => {
    const res = spawnSync(
      process.execPath,
      [SCRIPT, "solve", "--fg", "#8C847C", "--bg", "#EDE7DC", "--required", "3"],
      { input: "", encoding: "utf8" },
    );
    assert.equal(res.status, 0, `exit ${res.status}。stderr:\n${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.solved, true);
    assert.equal(out.result.delta.dl, -0.009);
  });
}
