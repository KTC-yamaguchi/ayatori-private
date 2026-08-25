// scripts/cluster-figma-candidates.test.mjs
//
// scripts/cluster-figma-candidates.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/cluster-figma-candidates.test.mjs
//
// テスト方針:
//   - 入力 `.enumeration-*.json` は collector subagent (LLM) の出力なので、フィールド欠落で
//     範囲確定ゲートの手前が落ちないことを固定する。
//   - 何を畳んだかが人間に見えることも固定する — 黙って捨てると実画面が範囲決定から消える。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "cluster-figma-candidates.mjs");

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-figma-cluster-"));
  return {
    root,
    figmaDir: (app = "app") => join(root, "artifacts", app, "ground-truth", "figma"),
    enumerate(candidates, { app = "app", fileKey = "KEY" } = {}) {
      const p = join(this.figmaDir(app), `.enumeration-${fileKey}.json`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ file_key: fileKey, candidates }, null, 2));
    },
    run(app = "app", extra = []) {
      const r = spawnSync(process.execPath, [SCRIPT, app, ...extra], { cwd: this.root, encoding: "utf8" });
      return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
    },
    clustering(app = "app", fileKey = "KEY") {
      return JSON.parse(readFileSync(join(this.figmaDir(app), `.clustering-${fileKey}.json`), "utf8"));
    },
    bucketOf(doc, nodeId) {
      return doc.candidates.find((c) => c.node_id === nodeId)?.bucket;
    },
    cleanup() {
      rmSync(this.root, { recursive: true, force: true });
    },
  };
};

const frame = (node_id, name, extra = {}) => ({
  node_id,
  name,
  type: "frame",
  width: 390,
  height: 844,
  ...extra,
});

test("name 欠落でも停止せず、無名として opt-in 候補に回す", () => {
  const fx = setup();
  try {
    fx.enumerate([frame("1:10", "ホーム"), { node_id: "1:11", type: "frame", width: 390, height: 844 }]);
    const { status } = fx.run();
    assert.equal(status, 0, "全体が落ちない");
    const doc = fx.clustering();
    assert.equal(doc.summary.total, 2);
    assert.match(doc.candidates.find((c) => c.node_id === "1:11").name, /unnamed/);
  } finally {
    fx.cleanup();
  }
});

test("node_id 欠落の候補は落とすが件数を警告する (無言で消さない)", () => {
  const fx = setup();
  try {
    fx.enumerate([frame("1:10", "ホーム"), { name: "no-id", type: "frame", width: 390, height: 844 }]);
    const { status, err } = fx.run();
    assert.equal(status, 0);
    assert.match(err, /no node_id/);
    assert.match(err, /no-id/);
    assert.equal(fx.clustering().summary.total, 1);
  } finally {
    fx.cleanup();
  }
});

test("同名 dedup はページを見る (別ページの同名画面を重複扱いしない)", () => {
  const fx = setup();
  try {
    fx.enumerate([
      frame("1:10", "スポット詳細", { page: "PC" }),
      frame("1:11", "スポット詳細", { page: "SP" }),
      frame("1:12", "スポット詳細", { page: "PC", height: 800 }),
    ]);
    fx.run();
    const doc = fx.clustering();
    // 同ページ内の小さい方だけが重複、別ページの同名は重複にしない
    assert.equal(fx.bucketOf(doc, "1:12"), "duplicate_name");
    assert.notEqual(fx.bucketOf(doc, "1:11"), "duplicate_name");
  } finally {
    fx.cleanup();
  }
});

test("同名で畳んだ分も提案表に出す (範囲決定から実画面が消えない)", () => {
  const fx = setup();
  try {
    fx.enumerate([
      frame("1:10", "スポット詳細", { page: "PC" }),
      frame("1:12", "スポット詳細", { page: "PC", height: 800 }),
    ]);
    const { out } = fx.run();
    assert.match(out, /same-name duplicates/);
    assert.match(out, /1:12/);
  } finally {
    fx.cleanup();
  }
});

test("--stdout は JSON だけを stdout に出す (提案表は stderr)", () => {
  const fx = setup();
  try {
    fx.enumerate([frame("1:10", "ホーム"), frame("1:11", "詳細")]);
    const { out, err } = fx.run("app", ["--stdout"]);
    assert.doesNotThrow(() => JSON.parse(out), "stdout が単体で parse できる");
    assert.match(err, /cluster-figma-candidates/, "提案表は stderr 側");
  } finally {
    fx.cleanup();
  }
});

test("バケット分類: 残骸 / 自動命名 / 家族変形 / 代表", () => {
  const fx = setup();
  try {
    fx.enumerate([
      frame("1:10", "スポット詳細"),
      frame("1:11", "スポット詳細_公開中"),
      frame("1:12", "Frame 1234"),
      frame("1:13", "bak_旧トップ"),
    ]);
    fx.run();
    const doc = fx.clustering();
    assert.equal(fx.bucketOf(doc, "1:10"), "representative");
    assert.equal(fx.bucketOf(doc, "1:11"), "family_variant");
    assert.equal(fx.bucketOf(doc, "1:12"), "anonymous");
    assert.equal(fx.bucketOf(doc, "1:13"), "debris");
  } finally {
    fx.cleanup();
  }
});
