#!/usr/bin/env node
// skills/04-scoring/evals/render-scoring-report-evals.test.mjs
//
// Step 04 採点レポート renderer (scripts/render-scoring-report.mjs) の **CLI 契約テスト**:
//   黒箱 CLI として golden fixture に対して回し、生成 HTML 2 種を byte 単位で固定する。
// unit test (scripts/render-scoring-report.test.mjs) が純関数を白箱で検証するのに対し、
// 本 eval は「入力 JSON → 出力 HTML 全体」の決定論 (同一入力 → byte 同一出力) を固定し、
// テンプレート改変や置換ロジック変更の意図しない回帰を検出する。
//
// fixture 規約 (fixtures/<name>/):
//   input.json              — scoring-history.json として与える入力
//   expected-dashboard.html — scoring-dashboard.html の golden (--update で再生成)
//   expected-history.html   — scoring-history.html の golden (--update で再生成)
// 実行は fixture を tmpdir へ複写してから行う (script は入力の隣へ書き出すため。
// fixture ディレクトリと作業ツリーを汚さない = npm test 後も git status はクリーン)。
// scoring.css は golden を持たず「テンプレートと byte 一致」を検証する (重複管理を避ける)。
//
// 使い方:
//   npm test                                                        # 検証 (node --test discovery)
//   node skills/04-scoring/evals/render-scoring-report-evals.test.mjs --update   # golden 再生成
//
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "render-scoring-report.mjs");
const FIXTURES_DIR = join(HERE, "fixtures");
const CSS_TEMPLATE = join(REPO_ROOT, "skills", "04-scoring", "templates", "scoring.css");

// stderr の検算警告を契約として固定する fixture (含まれるべき部分文字列)
const STDERR_FIXTURES = {
  "mismatch-warning": [
    "検算警告",
    "total 保存値 90 ≠ scores 合計 80",
    "ai_improvable_count 保存値 5 ≠ deficiencies 再計算 1",
  ],
};

function listFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(FIXTURES_DIR, d.name, "input.json")))
    .map((d) => d.name)
    .sort();
}

/** fixture の input.json を tmpdir へ scoring-history.json として複写し、script を回す。 */
function runFixture(name) {
  const tmp = mkdtempSync(join(tmpdir(), `render-scoring-eval-${name}-`));
  cpSync(join(FIXTURES_DIR, name, "input.json"), join(tmp, "scoring-history.json"));
  const res = spawnSync(process.execPath, [SCRIPT, join(tmp, "scoring-history.json")], { encoding: "utf8" });
  return { tmp, res };
}

const UPDATE = process.argv.includes("--update");

if (UPDATE) {
  for (const name of listFixtures()) {
    const { tmp, res } = runFixture(name);
    try {
      if (res.status !== 0) {
        console.error(`[update] ${name}: script が exit ${res.status} で失敗。stderr:\n${res.stderr}`);
        process.exitCode = 1;
        continue;
      }
      cpSync(join(tmp, "scoring-dashboard.html"), join(FIXTURES_DIR, name, "expected-dashboard.html"));
      cpSync(join(tmp, "scoring-history.html"), join(FIXTURES_DIR, name, "expected-history.html"));
      console.log(`[update] ${name}: expected-dashboard.html / expected-history.html を再生成`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
} else {
  for (const name of listFixtures()) {
    test(`render-scoring CLI: ${name} → HTML 2 種が golden 一致`, () => {
      const dashGolden = join(FIXTURES_DIR, name, "expected-dashboard.html");
      const histGolden = join(FIXTURES_DIR, name, "expected-history.html");
      assert.ok(existsSync(dashGolden) && existsSync(histGolden), `${name}: golden が無い。生成: node ${join("skills/04-scoring/evals", "render-scoring-report-evals.test.mjs")} --update`);

      const { tmp, res } = runFixture(name);
      try {
        assert.equal(res.status, 0, `script が exit ${res.status} で失敗。stderr:\n${res.stderr}`);
        assert.equal(
          readFileSync(join(tmp, "scoring-dashboard.html"), "utf8"),
          readFileSync(dashGolden, "utf8"),
          `${name}: dashboard が golden と不一致。意図的な変更なら --update で golden を更新`,
        );
        assert.equal(
          readFileSync(join(tmp, "scoring-history.html"), "utf8"),
          readFileSync(histGolden, "utf8"),
          `${name}: history が golden と不一致。意図的な変更なら --update で golden を更新`,
        );
        assert.equal(
          readFileSync(join(tmp, "scoring.css"), "utf8"),
          readFileSync(CSS_TEMPLATE, "utf8"),
          "scoring.css はテンプレートの byte 複写であるべき",
        );

        const expectedStderr = STDERR_FIXTURES[name];
        if (expectedStderr) {
          for (const s of expectedStderr) {
            assert.ok(res.stderr.includes(s), `stderr に "${s}" を含むべき。実際:\n${res.stderr}`);
          }
        } else {
          assert.ok(!res.stderr.includes("検算警告"), `整合 fixture で検算警告が出ている:\n${res.stderr}`);
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  test("render-scoring CLI: attempts が空なら exit 1 で何も書かない", () => {
    const tmp = mkdtempSync(join(tmpdir(), "render-scoring-eval-empty-"));
    try {
      writeFileSync(join(tmp, "scoring-history.json"), JSON.stringify({ app_name: "empty", attempts: [] }));
      const res = spawnSync(process.execPath, [SCRIPT, join(tmp, "scoring-history.json")], { encoding: "utf8" });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /attempts が空/);
      assert.ok(!existsSync(join(tmp, "scoring-dashboard.html")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
