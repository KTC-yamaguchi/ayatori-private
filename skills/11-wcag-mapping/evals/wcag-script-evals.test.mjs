#!/usr/bin/env node
// skills/11-wcag-mapping/evals/wcag-script-evals.test.mjs
//
// Skill 11 (11-wcag-mapping) の **script CLI 契約テスト**: scripts/wcag-contrast.mjs を
//   黒箱 CLI として golden fixture に対して回し、stdout / exit code を固定する。
//
// ファイル名が *.test.mjs なのは `node --test` の規約 discovery に乗せるため
//   (package.json の test は `node --test` 一本。path を手で列挙しない)。
//
// なぜ unit test (scripts/wcag-contrast.test.mjs) と別に必要か:
//   unit test は内部関数 (contrastRatio / lookupTokenHex / evaluateCase 等) を白箱で検証する。
//   本 eval は CLI 統合 (argv/stdin/--modes parsing → 各 mode×case の反復 → 組み上がった
//   stdout JSON 全体の shape) を end-to-end で固定する。LLM 推算時代に偽 violation を
//   生んでいた閾値近傍 (threshold-edge fixture) もここで golden として pin する。
//   skill 11 が CLI 契約に依存する以上、契約自体の回帰検出が必要。
//
// node:test に統合されており `npm test` (= node --test) で自動実行される。
//
// fixture 規約 (fixtures/<name>/):
//   input.json   — script への入力。先頭の "modes" key が --modes 引数を指定する
//                  ("dark,light" / "light" / null=省略でデフォルト dark)。
//                  "_note" / "modes" は script が無視する inert key (brief.cases のみ読む)。
//   expected.json — script stdout の golden (本 runner --update で再生成)。
//                  error fixture (expect_error:true を meta に持つ) は expected.json を持たない。
//
// 使い方:
//   npm test                          # 検証 (CI、node --test の規約 discovery で本ファイルも拾われる)
//   npm run evals:regen-goldens       # golden 再生成 (= 本ファイルを --update 付きで直接実行)
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
const SCRIPT = join(REPO_ROOT, "scripts", "wcag-contrast.mjs");
const FIXTURES_DIR = join(HERE, "fixtures");

// error を期待する fixture (expected.json を持たず exit code / stderr を検証する)
const ERROR_FIXTURES = {
  "error-invalid-json": { exit_code: 1, stderr_includes: "JSON" },
};

/** fixtures/ 配下のディレクトリ名を列挙 (input.json を持つもの)。 */
function listFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(FIXTURES_DIR, d.name, "input.json")))
    .map((d) => d.name)
    .sort();
}

/** fixture の input.json を読み、--modes 引数を解決して script を回す。 */
function runFixture(name) {
  const inputPath = join(FIXTURES_DIR, name, "input.json");
  const raw = readFileSync(inputPath, "utf8");

  // modes は input.json の top-level key から読む (parse 失敗 fixture もあるので try)。
  // null のまま = 「--modes を渡さず script default (dark) 経路を踏む」意図。
  let modes = null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.modes === "string") modes = parsed.modes;
  } catch {
    // invalid-json fixture: そのまま stdin に流す (modes は使わない)
  }

  const args = [SCRIPT];
  if (modes) args.push("--modes", modes);

  // PATH 上の node ではなく実行中の Node と同じバイナリを使う (asdf/nvm/CI で版が食い違うのを防ぐ)
  return spawnSync(process.execPath, args, { input: raw, encoding: "utf8" });
}

// ── 検証 / 再生成 ──────────────────────────────────────

const UPDATE = process.argv.includes("--update");

if (UPDATE) {
  // golden 再生成モード (node script として直接起動された時のみ意味を持つ)
  for (const name of listFixtures()) {
    if (ERROR_FIXTURES[name]) continue;
    const res = runFixture(name);
    if (res.status !== 0) {
      console.error(`[update] ${name}: script が exit ${res.status} で失敗。stderr:\n${res.stderr}`);
      process.exitCode = 1;
      continue;
    }
    const out = JSON.parse(res.stdout); // 正規化のため round-trip
    writeFileSync(join(FIXTURES_DIR, name, "expected.json"), JSON.stringify(out, null, 2) + "\n");
    console.log(`[update] ${name}: expected.json を再生成`);
  }
} else {
  // node:test 検証モード
  for (const name of listFixtures()) {
    if (ERROR_FIXTURES[name]) {
      const spec = ERROR_FIXTURES[name];
      test(`wcag CLI (error): ${name} → exit ${spec.exit_code}`, () => {
        const res = runFixture(name);
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

    test(`wcag CLI: ${name} → stdout が golden 一致`, () => {
      const expectedPath = join(FIXTURES_DIR, name, "expected.json");
      assert.ok(
        existsSync(expectedPath),
        `${name}/expected.json が無い。生成: npm run evals:regen-goldens`,
      );
      const res = runFixture(name);
      assert.equal(res.status, 0, `script が exit ${res.status} で失敗。stderr:\n${res.stderr}`);

      const actual = JSON.parse(res.stdout);
      const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
      assert.deepEqual(
        actual,
        expected,
        `${name}: stdout が golden と不一致。意図的な script 変更なら --update で golden を更新`,
      );
    });
  }

  // ── CLI arg-parsing 回帰: 位置引数 (brief.json) を file として読む ──
  // regression: --modes 省略時に modesIdx === -1 → 除外 index が 0 になり、第 1 位置引数の
  //   ファイル名が誤って捨てられ stdin (空) に fallback して JSON parse error で落ちていた
  //   (commit 2056dd3 で value-compare → index-compare 化した際の混入)。
  //   既存 eval は全て stdin 経由のため CLI file 引数路が一度も踏まれず、この穴を素通しした。
  test("wcag CLI: 位置引数のファイルを読む (--modes 省略・stdin 空でも fallback しない)", () => {
    // legacy-dark は --modes 省略 (default dark) を pin する fixture。これを file 引数として渡す。
    const filePath = join(FIXTURES_DIR, "legacy-dark", "input.json");
    const viaFile = spawnSync(process.execPath, [SCRIPT, filePath], { input: "", encoding: "utf8" });

    assert.equal(
      viaFile.status, 0,
      `file 引数 + 空 stdin で exit ${viaFile.status} (fallback bug の兆候)。stderr:\n${viaFile.stderr}`,
    );
    // file 引数で読んだ結果が、同じ入力を stdin に流した結果と一致すること (読み口が違うだけ)。
    const raw = readFileSync(filePath, "utf8");
    const viaStdin = spawnSync(process.execPath, [SCRIPT, "--modes", "dark"], { input: raw, encoding: "utf8" });
    assert.equal(viaStdin.status, 0, `stdin 経路が exit ${viaStdin.status}。stderr:\n${viaStdin.stderr}`);
    assert.deepEqual(
      JSON.parse(viaFile.stdout),
      JSON.parse(viaStdin.stdout),
      "file 引数経路と stdin 経路の出力が一致すべき",
    );
  });
}
