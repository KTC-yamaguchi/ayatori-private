// scripts/check-source-citations.test.mjs
//
// scripts/check-source-citations.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/check-source-citations.test.mjs
//
// テスト方針:
//   - 「実在しない file:line 引用が混入したら検出される」を最優先で固定する — この検査は
//     文法 hook (存在を見ない) と review-gate 監査 (LLM・高価) の間の機械層なので、
//     すり抜けると偽引用がそのまま高価な監査へ流れる。
//   - 誤検出しない側も固定する — テンプレートのプレースホルダ (`path:line` / `{stack}`) や
//     表セル・括弧・日本語ファイル名を引用として壊さない。
//   - 検査は報告のみ (artifact を書き換えない) ことを固定する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-source-citations.mjs");

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-citations-"));
  return {
    root,
    write(app, relPath, content) {
      const p = join(root, "artifacts", app, relPath);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    },
    analysis(app, content) {
      this.write(app, "reverse-engineered/raw-analysis.md", content);
    },
    run(app = "app", extra = []) {
      const r = spawnSync(process.execPath, [SCRIPT, app, ...extra], { cwd: this.root, encoding: "utf8" });
      return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
    },
    cleanup() {
      rmSync(this.root, { recursive: true, force: true });
    },
  };
};

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

test("app_name なし / 対象ファイル不在は Usage・明示エラー (exit 2)", () => {
  const fx = setup();
  try {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: fx.root, encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage:/);
    const miss = fx.run("no-such-app");
    assert.equal(miss.status, 2);
    assert.match(miss.err, /no target found/);
  } finally {
    fx.cleanup();
  }
});

test("実在する引用 3 文法 (code / archive / figma png) は clean (exit 0)", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.write("app", "ground-truth/cf-1-仕様（最新）.md", lines(30));
    fx.write("app", "ground-truth/figma/KEY/1-2--home.design-context.md", lines(40));
    fx.write("app", "ground-truth/figma/KEY/1-2--home.png", "png");
    fx.analysis(
      "app",
      [
        "| 画面 | Source |",
        "|---|---|",
        "| ホーム | input-sources/kmp/src/Main.kt:10-20 |",
        "根拠 (ground-truth/cf-1-仕様（最新）.md:5)",
        "図: ground-truth/figma/KEY/1-2--home.design-context.md:12 と ground-truth/figma/KEY/1-2--home.png",
      ].join("\n"),
    );
    const { status, out } = fx.run();
    assert.equal(status, 0, out);
    assert.match(out, /引用の疑義なし/);
  } finally {
    fx.cleanup();
  }
});

test("受け入れ基準: 実在しない file:line 引用が混入したら検出される (exit 1)", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis(
      "app",
      ["OK: input-sources/kmp/src/Main.kt:10", "NG: input-sources/kmp/src/Ghost.kt:120"].join("\n"),
    );
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.match(out, /Ghost\.kt:120 — ファイル不在/);
    assert.doesNotMatch(out, /Main\.kt:10 —/);
  } finally {
    fx.cleanup();
  }
});

test("行番号が実ファイルの行数を超えたら検出される", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis("app", "input-sources/kmp/src/Main.kt:88");
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.match(out, /行番号が範囲外 \(実ファイル 50 行\)/);
  } finally {
    fx.cleanup();
  }
});

test("行範囲の逆転 (:20-10) を検出する", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis("app", "input-sources/kmp/src/Main.kt:20-10");
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.match(out, /行範囲が逆転/);
  } finally {
    fx.cleanup();
  }
});

test("大文字小文字の不一致は実体の綴りつきで検出する (macOS では開けても CI で壊れる)", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis("app", "input-sources/kmp/src/main.kt:10");
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.match(out, /大文字小文字の不一致 \(実体: Main\.kt\)/);
  } finally {
    fx.cleanup();
  }
});

test(".. を含む参照は artifacts 外への逸脱として検出する", () => {
  const fx = setup();
  try {
    fx.analysis("app", "input-sources/kmp/../../secret.txt:1");
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.match(out, /外を指す/);
  } finally {
    fx.cleanup();
  }
});

test("reverse-provenance.json の source_ref も既定で検査対象になる", () => {
  const fx = setup();
  try {
    fx.analysis("app", "本文に引用なし");
    fx.write(
      "app",
      "reverse-engineered/reverse-provenance.json",
      JSON.stringify({ items: [{ source_ref: "input-sources/kmp/src/Ghost.kt:3" }] }, null, 2),
    );
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.match(out, /Ghost\.kt:3 — ファイル不在/);
  } finally {
    fx.cleanup();
  }
});

test("--file で単一ファイルだけを検査できる", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis("app", "input-sources/kmp/src/Ghost.kt:1"); // 既定対象は疑義あり
    const p = join(fx.root, "findings.md");
    writeFileSync(p, "input-sources/kmp/src/Main.kt:10");
    const { status } = fx.run("app", ["--file", "findings.md"]);
    assert.equal(status, 0, "--file 指定時は既定対象を読まない");
  } finally {
    fx.cleanup();
  }
});

test("テンプレートのプレースホルダ (path:line / {stack}) は引用として数えない", () => {
  const fx = setup();
  try {
    fx.analysis(
      "app",
      ["引用文法: input-sources/{stack}/path/to/file.ext:line", "figma: ground-truth/figma/{file_key}/{node}--{slug}.design-context.md:line"].join("\n"),
    );
    const { status, out } = fx.run();
    assert.equal(status, 3, out); // 引用 0 件 = 検証対象なし — exit 3 で「検証済み (0)」と区別する
    assert.match(out, /unique 0/);
    assert.match(out, /引用が 1 件も見つからない/);
  } finally {
    fx.cleanup();
  }
});

test("--json は構造化結果を stdout に出す", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis("app", "input-sources/kmp/src/Main.kt:99");
    const { status, out } = fx.run("app", ["--json"]);
    assert.equal(status, 1);
    const doc = JSON.parse(out);
    assert.equal(doc.suspects.length, 1);
    assert.equal(doc.suspects[0].citation, "input-sources/kmp/src/Main.kt:99");
    assert.equal(doc.counts.unique, 1);
  } finally {
    fx.cleanup();
  }
});

test("検査は報告のみで artifact を書き換えない", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    const body = "input-sources/kmp/src/Ghost.kt:1";
    fx.analysis("app", body);
    fx.run();
    const after = readFileSync(join(fx.root, "artifacts", "app", "reverse-engineered", "raw-analysis.md"), "utf8");
    assert.equal(after, body);
  } finally {
    fx.cleanup();
  }
});

test("同一引用の繰り返しは 1 回だけ検証・報告する", () => {
  const fx = setup();
  try {
    fx.analysis("app", ["input-sources/kmp/src/Ghost.kt:1", "再掲: input-sources/kmp/src/Ghost.kt:1"].join("\n"));
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.equal(out.match(/Ghost\.kt:1 —/g).length, 1);
    assert.match(out, /unique 1/);
  } finally {
    fx.cleanup();
  }
});

test("EOF+1 の行番号引用は通過しない (末尾改行を行として数えない)", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Two.kt", "line1\nline2\n");
    fx.analysis("app", "実在: input-sources/kmp/src/Two.kt:2 / 幽霊: input-sources/kmp/src/Two.kt:3");
    const { status, out } = fx.run();
    assert.equal(status, 1);
    assert.match(out, /Two\.kt:3 — 行番号が範囲外/);
    assert.doesNotMatch(out, /Two\.kt:2 —/);
  } finally {
    fx.cleanup();
  }
});

test("--file にディレクトリを渡すと exit 2 (疑義扱いにしない)", () => {
  const fx = setup();
  try {
    fx.analysis("app", "input-sources/kmp/src/A.kt:1");
    const r = fx.run("app", ["--file", join("artifacts", "app", "reverse-engineered")]);
    assert.equal(r.status, 2);
    assert.match(r.err, /not a file/);
  } finally {
    fx.cleanup();
  }
});

test("app_name にパス区切りが含まれると exit 2", () => {
  const fx = setup();
  try {
    const r = fx.run("../evil");
    assert.equal(r.status, 2);
    assert.match(r.err, /invalid app_name/);
  } finally {
    fx.cleanup();
  }
});

test("疑義なしでも引用 0 件なら exit 3 (exit code だけで機械ゲートできる)", () => {
  const fx = setup();
  try {
    fx.analysis("app", "引用を 1 件も含まない解析本文");
    const zero = fx.run();
    assert.equal(zero.status, 3);
    assert.match(zero.out, /引用が 1 件も見つからない/);

    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis("app", "実在引用: input-sources/kmp/src/Main.kt:10");
    assert.equal(fx.run().status, 0);
  } finally {
    fx.cleanup();
  }
});

test("全件 inferred の provenance (引用 0 件) は exit 3 にしない — raw-analysis が clean なら exit 0", () => {
  const fx = setup();
  try {
    fx.write("app", "input-sources/kmp/src/Main.kt", lines(50));
    fx.analysis("app", "実在引用: input-sources/kmp/src/Main.kt:10");
    fx.write(
      "app",
      "reverse-engineered/reverse-provenance.json",
      JSON.stringify({ specifics: [{ ref: "OV-01", provenance: "inferred" }] }, null, 2),
    );
    const { status, out } = fx.run();
    assert.equal(status, 0, out);
    assert.match(out, /reverse-provenance\.json: 引用が 1 件も見つからない \(全件 inferred の run では正当/);
  } finally {
    fx.cleanup();
  }
});
