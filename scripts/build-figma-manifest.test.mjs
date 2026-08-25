// scripts/build-figma-manifest.test.mjs
//
// scripts/build-figma-manifest.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/build-figma-manifest.test.mjs
//
// テスト方針:
//   - 本 script は CLI (cwd 相対の artifacts/ を読む) なので、tmpdir に最小ツリーを作り
//     cwd を移して子プロセスで実行する。repo の artifacts/ は触らない。
//   - 固定するのは「証拠を取りこぼさない」性質: node id の往復、命名規約違反の表面化、
//     収集失敗と範囲外の区別、証拠 0 件のときに収集済みと見せないこと。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "build-figma-manifest.mjs");

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-figma-manifest-"));
  return {
    root,
    figmaDir: (app) => join(root, "artifacts", app, "ground-truth", "figma"),
    write(rel, body) {
      const p = join(this.root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
      return p;
    },
    run(app) {
      const r = spawnSync(process.execPath, [SCRIPT, app], { cwd: this.root, encoding: "utf8" });
      return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
    },
    manifest(app) {
      return JSON.parse(readFileSync(join(this.figmaDir(app), "figma-manifest.json"), "utf8"));
    },
    cleanup() {
      rmSync(this.root, { recursive: true, force: true });
    },
  };
};

test("node id はコロンが複数あっても往復する (frames と未 capture の二重登録を防ぐ)", () => {
  const fx = setup();
  try {
    // ネストした instance の node id は `I1:2;3:4` 形式 — ファイル名では ':' が全て '-' になる
    fx.write("artifacts/app/ground-truth/figma/KEY/I1-2;3-4--instance.design-context.md", 'x <div data-node-id="I1:2;3:4"></div>');
    fx.write("artifacts/app/ground-truth/figma/KEY/I1-2;3-4--instance.png", "PNG");
    fx.write("artifacts/app/ground-truth/figma/.clustering-KEY.json", {
      file_key: "KEY",
      candidates: [{ node_id: "I1:2;3:4", name: "instance", bucket: "representative", family: "instance" }],
    });
    fx.run("app");
    const f = fx.manifest("app").files[0];
    assert.deepEqual(f.frames.map((x) => x.node_id), ["I1:2;3:4"]);
    assert.equal(f.frames[0].name, "instance", "fragment/列挙からの名前復元が効く");
    assert.equal(f.enumerated_not_captured, undefined, "capture 済みなのに未 capture として重複登録されない");
  } finally {
    fx.cleanup();
  }
});

test("命名規約に合わないファイルは無言で落とさず警告する", () => {
  const fx = setup();
  try {
    fx.write("artifacts/app/ground-truth/figma/KEY/1-23--home.design-context.md", 'a <div data-node-id="1:23"></div>');
    fx.write("artifacts/app/ground-truth/figma/KEY/1-27home.png", "PNG"); // '--' 区切りなし
    const { err } = fx.run("app");
    assert.match(err, /1-27home/, "落としたファイル名が stderr に出る");
    assert.match(err, /WARNING/);
    assert.deepEqual(fx.manifest("app").files[0].frames.map((x) => x.node_id), ["1:23"]);
  } finally {
    fx.cleanup();
  }
});

test("確定 capture セットがあれば失敗と範囲外を区別する", () => {
  const fx = setup();
  try {
    fx.write("artifacts/app/ground-truth/figma/KEY/1-10--a.design-context.md", 'a <div data-node-id="1:10"></div>');
    fx.write("artifacts/app/ground-truth/figma/.clustering-KEY.json", {
      file_key: "KEY",
      candidates: [
        { node_id: "1:10", name: "a", bucket: "representative", family: "a" },
        { node_id: "1:11", name: "b", bucket: "representative", family: "b" },
        { node_id: "1:12", name: "c", bucket: "representative", family: "c" },
        { node_id: "1:13", name: "b2", bucket: "family_variant", family: "b" },
      ],
    });
    // 確定セットは 1:10 と 1:11 のみ → 1:11 は「頼んだのに失敗」、1:12 は「頼んでいない」
    fx.write("artifacts/app/ground-truth/figma/.capture-scope-KEY.json", { file_key: "KEY", node_ids: ["1:10", "1:11"] });
    fx.run("app");
    const byId = Object.fromEntries(
      fx.manifest("app").files[0].enumerated_not_captured.map((n) => [n.node_id, n.reason]),
    );
    assert.equal(byId["1:11"], "capture_failed");
    assert.equal(byId["1:12"], "out_of_scope");
    assert.equal(byId["1:13"], "family_variant");
  } finally {
    fx.cleanup();
  }
});

test("確定セットが無いときは代表の欠落を capture_failed 扱いにする (失敗を人間の判断と誤記録しない)", () => {
  const fx = setup();
  try {
    fx.write("artifacts/app/ground-truth/figma/KEY/1-10--a.design-context.md", 'a <div data-node-id="1:10"></div>');
    fx.write("artifacts/app/ground-truth/figma/.clustering-KEY.json", {
      file_key: "KEY",
      candidates: [
        { node_id: "1:10", name: "a", bucket: "representative", family: "a" },
        { node_id: "1:11", name: "b", bucket: "representative", family: "b" },
      ],
    });
    fx.run("app");
    const nc = fx.manifest("app").files[0].enumerated_not_captured;
    assert.deepEqual(nc.map((n) => [n.node_id, n.reason]), [["1:11", "capture_failed"]]);
  } finally {
    fx.cleanup();
  }
});

test("証拠が 1 件も無いときは captured_at を書かない (収集済みと誤判定させない)", () => {
  const fx = setup();
  try {
    mkdirSync(join(fx.figmaDir("app"), "KEY"), { recursive: true });
    fx.run("app");
    const m = fx.manifest("app");
    assert.equal("captured_at" in m, false);
    assert.deepEqual(m.files[0].frames, []);
  } finally {
    fx.cleanup();
  }
});

test("screenshot だけの frame も登録する (design-context 取得不可は正常系)", () => {
  const fx = setup();
  try {
    fx.write("artifacts/app/ground-truth/figma/KEY/1-30--canvas.png", "PNG");
    fx.run("app");
    const fr = fx.manifest("app").files[0].frames;
    assert.equal(fr.length, 1);
    assert.equal(fr[0].design_context, null);
    assert.match(fr[0].screenshot, /1-30--canvas\.png$/);
  } finally {
    fx.cleanup();
  }
});
