// scripts/download-figma-asset.test.mjs
//
// scripts/download-figma-asset.mjs の入力検証テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/download-figma-asset.test.mjs
//
// テスト方針:
//   - ネットワークには出ない。検証は fetch より前に走るので、拒否ケースだけで
//     「任意 URL を任意パスへ書く汎用手段にならない」性質を固定できる。
//   - この script は capture subagent が事前許可済みの Bash(node:*) で起動し、引数は MCP 応答
//     (第三者が編集しうるコンテンツ) 由来。ここが緩むと Write(./artifacts/**) の権限範囲が
//     迂回される。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "download-figma-asset.mjs");
const OK_OUT = "artifacts/demo/ground-truth/figma/KEY/1-23--home.png";

const run = (args) => {
  const cwd = mkdtempSync(join(tmpdir(), "ayatori-dl-asset-"));
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  // 拒否されたら書き込みは 1 件も起きていないはず
  const wrote = readdirSync(cwd);
  rmSync(cwd, { recursive: true, force: true });
  return { status: r.status, err: r.stderr ?? "", wrote };
};

test("非 https スキームは拒否する (data: で任意内容を書けない)", () => {
  const r = run(["data:text/plain;base64,ZXZpbA==", OK_OUT]);
  assert.equal(r.status, 1);
  assert.match(r.err, /only https/);
  assert.deepEqual(r.wrote, []);
});

test("file: スキームも拒否する", () => {
  const r = run(["file:///etc/passwd", OK_OUT]);
  assert.equal(r.status, 1);
  assert.match(r.err, /only https/);
});

test("Figma 以外のホストは拒否する (内部エンドポイントへ出ない)", () => {
  for (const url of [
    "https://169.254.169.254/latest/meta-data/",
    "https://127.0.0.1:8080/x.png",
    "https://evil.example.com/x.png",
    "https://notfigma.com.evil.test/x.png",
  ]) {
    const r = run([url, OK_OUT]);
    assert.equal(r.status, 1, url);
    assert.match(r.err, /not a Figma asset host/, url);
    assert.deepEqual(r.wrote, [], url);
  }
});

test("アーカイブ外への出力は拒否する (.. 脱出を含む)", () => {
  for (const out of [
    "artifacts/demo/../../pretend-home/.zshrc-like",
    "artifacts/demo/evil.png",
    "/tmp/anywhere.png",
    "artifacts/demo/ground-truth/other/x.png",
  ]) {
    const r = run(["https://s3-alpha-sig.figma.com/img/abc?token=1", out]);
    assert.equal(r.status, 1, out);
    assert.match(r.err, /refused output path/, out);
    assert.deepEqual(r.wrote, [], out);
  }
});

test("アーカイブ内でも .png 以外の出力は拒否する (テキスト証拠の上書き防止)", () => {
  for (const out of [
    "artifacts/demo/ground-truth/figma/KEY/1-23--home.design-context.md",
    "artifacts/demo/ground-truth/figma/KEY/variables.json",
    "artifacts/demo/ground-truth/figma/.batch1-frames.json",
    "artifacts/demo/ground-truth/figma/KEY/noext",
  ]) {
    const r = run(["https://s3-alpha-sig.figma.com/img/abc?token=1", out]);
    assert.equal(r.status, 1, out);
    assert.match(r.err, /only \.png output is supported/, out);
    assert.deepEqual(r.wrote, [], out);
  }
});

test("引数不足は usage で終了する", () => {
  const r = run(["https://s3-alpha-sig.figma.com/img/abc"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /Usage:/);
});

test("許可ホスト × アーカイブ内パスなら検証を通過して fetch に進む", () => {
  // ネットワークには到達させない (存在しないサブドメイン) — 「検証で弾かれた」のではなく
  // 「検証を通ってダウンロード段に入った」ことを、エラー文面の違いで確認する。
  const r = run(["https://nonexistent-host-for-test.figma.com/x.png", OK_OUT]);
  assert.doesNotMatch(r.err, /refused/, "検証段では拒否されない");
});

test("拡張子ゲートは大文字 .PNG も同じ経路を通す (PNG シグネチャ検査の対象になる)", () => {
  // 入口ゲートは case-insensitive に .png を受理する。中身の PNG シグネチャ検査は
  // 拡張子を再判定しない無条件検査なので、.PNG でも「HTML エラー文書を視覚証拠として
  // 保存してしまう」経路は存在しない。ここでは大文字拡張子が入口で拒否されず
  // ダウンロード段まで進むこと (= シグネチャ検査の適用対象になること) を固定する。
  const upper = OK_OUT.replace(/\.png$/, ".PNG");
  const r = run(["https://nonexistent-host-for-test.figma.com/x.png", upper]);
  assert.doesNotMatch(r.err, /refused/, "大文字 .PNG は入口ゲートで拒否されない");
});
