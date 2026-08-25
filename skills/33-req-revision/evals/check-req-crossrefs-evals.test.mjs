#!/usr/bin/env node
// skills/33-req-revision/evals/check-req-crossrefs-evals.test.mjs
//
// Step 33 sub-step 4.5 相互参照 checker (scripts/check-req-crossrefs.mjs) の **CLI 契約テスト**:
//   黒箱 CLI として golden fixture (ミニ app ディレクトリ) に対して回し、stdout の JSON verdict と
//   生成 report md を byte 単位で固定する。exit code (0=PASS / 1=FAIL / 2=入力不能) も検証する。
// unit test (scripts/check-req-crossrefs.test.mjs) が集合演算を白箱で検証するのに対し、
// 本 eval は「app ディレクトリ → verdict + report」の end-to-end 決定論を固定する。
//
// fixture 規約 (fixtures/<name>/):
//   app/                 — ミニ app (requirements/*.md + req-delta/{change-manifest.json, snapshots/})
//   expected.json        — stdout JSON の golden (--update で再生成)
//   expected-report.md   — 生成 report md の golden (--update で再生成)
//   error fixture (ERROR_FIXTURES 登録) は golden を持たず exit code / stderr を検証する。
// 実行は app/ を tmpdir へ複写してから行う (script は report を app 内へ書くため。
// fixture と作業ツリーを汚さない = npm test 後も git status はクリーン)。
//
// 使い方:
//   npm test                                                          # 検証 (node --test discovery)
//   node skills/33-req-revision/evals/check-req-crossrefs-evals.test.mjs --update   # golden 再生成
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
const SCRIPT = join(REPO_ROOT, "scripts", "check-req-crossrefs.mjs");
const FIXTURES_DIR = join(HERE, "fixtures");

// error を期待する fixture (golden を持たず exit code / stderr を検証する)
const ERROR_FIXTURES = {
  "phase5-variant-error": { exit_code: 2, stderr_includes: "Phase 5" },
  "invalid-entry-missing-doc": { exit_code: 2, stderr_includes: "doc" },
};

function listFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(FIXTURES_DIR, d.name, "app")))
    .map((d) => d.name)
    .sort();
}

/** fixture の app/ を tmpdir へ複写して script を回す。 */
function runFixture(name) {
  const tmp = mkdtempSync(join(tmpdir(), `check-crossrefs-eval-${name}-`));
  const appDir = join(tmp, "app");
  cpSync(join(FIXTURES_DIR, name, "app"), appDir, { recursive: true });
  const res = spawnSync(process.execPath, [SCRIPT, appDir], { encoding: "utf8" });
  return { tmp, appDir, res };
}

const reportPath = (appDir) => join(appDir, "req-delta", "cross-reference-integrity-report.md");

const UPDATE = process.argv.includes("--update");

if (UPDATE) {
  for (const name of listFixtures()) {
    if (ERROR_FIXTURES[name]) continue;
    const { tmp, appDir, res } = runFixture(name);
    try {
      if (res.status !== 0 && res.status !== 1) {
        console.error(`[update] ${name}: script が exit ${res.status} で失敗。stderr:\n${res.stderr}`);
        process.exitCode = 1;
        continue;
      }
      const out = JSON.parse(res.stdout); // 正規化のため round-trip
      writeFileSync(join(FIXTURES_DIR, name, "expected.json"), JSON.stringify(out, null, 2) + "\n");
      cpSync(reportPath(appDir), join(FIXTURES_DIR, name, "expected-report.md"));
      console.log(`[update] ${name}: expected.json / expected-report.md を再生成 (verdict=${out.verdict})`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
} else {
  for (const name of listFixtures()) {
    if (ERROR_FIXTURES[name]) {
      const spec = ERROR_FIXTURES[name];
      test(`check-crossrefs CLI (error): ${name} → exit ${spec.exit_code}`, () => {
        const { tmp, appDir, res } = runFixture(name);
        try {
          assert.equal(res.status, spec.exit_code, `exit code mismatch (stderr: ${res.stderr})`);
          assert.ok(res.stderr.includes(spec.stderr_includes), `stderr に "${spec.stderr_includes}" を含むべき。実際:\n${res.stderr}`);
          assert.equal(res.stdout.trim(), "", "error 時は stdout に出力しない");
          assert.ok(!existsSync(reportPath(appDir)), "error 時は report を書かない");
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      });
      continue;
    }

    test(`check-crossrefs CLI: ${name} → verdict / report が golden 一致`, () => {
      const expectedJsonPath = join(FIXTURES_DIR, name, "expected.json");
      const expectedReportPath = join(FIXTURES_DIR, name, "expected-report.md");
      assert.ok(
        existsSync(expectedJsonPath) && existsSync(expectedReportPath),
        `${name}: golden が無い。生成: node skills/33-req-revision/evals/check-req-crossrefs-evals.test.mjs --update`,
      );
      const expected = JSON.parse(readFileSync(expectedJsonPath, "utf8"));
      const expectedExit = expected.verdict === "PASS" ? 0 : 1;

      const { tmp, appDir, res } = runFixture(name);
      try {
        assert.equal(res.status, expectedExit, `exit code mismatch (stderr: ${res.stderr})`);
        assert.deepEqual(
          JSON.parse(res.stdout),
          expected,
          `${name}: stdout が golden と不一致。意図的な変更なら --update で golden を更新`,
        );
        assert.equal(
          readFileSync(reportPath(appDir), "utf8"),
          readFileSync(expectedReportPath, "utf8"),
          `${name}: report md が golden と不一致。意図的な変更なら --update で golden を更新`,
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
}
