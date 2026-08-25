// scripts/build-code-inventory.test.mjs
//
// scripts/build-code-inventory.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/build-code-inventory.test.mjs
//
// テスト方針:
//   - 何も黙って消えないことを固定する — 全ファイルが tier か excluded (理由つき) のどちらかに
//     載り、未走査 dir も台帳に残る。範囲決定 (予算ゲート) は この台帳の数字だけを根拠にする。
//   - shard 計画の上限 (chars / files) と module 境界を固定する — 上限が壊れると解析 worker の
//     context が溢れ、無言の部分読みになる。
//   - 数千ファイル級でも完走し、提案表が module 単位に圧縮されることを固定する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "build-code-inventory.mjs");

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-code-inventory-"));
  return {
    root,
    write(app, relPath, content) {
      const p = join(root, "artifacts", app, "input-sources", relPath);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    },
    writeArtifact(app, relPath, content) {
      const p = join(root, "artifacts", app, relPath);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    },
    run(app = "app", extra = []) {
      const r = spawnSync(process.execPath, [SCRIPT, app, ...extra], { cwd: this.root, encoding: "utf8" });
      return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
    },
    inventory(app = "app") {
      return JSON.parse(
        readFileSync(join(this.root, "artifacts", app, "reverse-engineered", ".code-inventory.json"), "utf8"),
      );
    },
    fileEntry(doc, path) {
      return doc.files.find((f) => f.path === path);
    },
    cleanup() {
      rmSync(this.root, { recursive: true, force: true });
    },
  };
};

const kt = (n = 20) => Array.from({ length: n }, (_, i) => `// line ${i}`).join("\n");

test("app_name なしは Usage を出して終了する", () => {
  const fx = setup();
  try {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: fx.root, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage:/);
  } finally {
    fx.cleanup();
  }
});

test("input-sources 不在 / docs しか無い場合は明示エラーで止まる", () => {
  const fx = setup();
  try {
    assert.equal(fx.run("no-such-app").status, 1);
    fx.write("app", "docs/spec.md", "# doc");
    const { status, err } = fx.run();
    assert.equal(status, 1);
    assert.match(err, /no \{stack\} directory/);
  } finally {
    fx.cleanup();
  }
});

test("tier 分類: entry / navigation / screen / state / model / api / config", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/build.gradle.kts", kt());
    fx.write("app", "kmp/README.md", "# app");
    fx.write("app", "kmp/sharedUI/src/commonMain/kotlin/navigation/Routes.kt", kt());
    fx.write("app", "kmp/sharedUI/src/commonMain/kotlin/screens/home/HomeScreen.kt", kt());
    fx.write("app", "kmp/sharedLogic/src/commonMain/kotlin/vm/HomeViewModel.kt", kt());
    fx.write("app", "kmp/sharedLogic/src/commonMain/kotlin/domain/model/User.kt", kt());
    fx.write("app", "kmp/sharedLogic/src/commonMain/kotlin/data/remote/UserApi.kt", kt());
    fx.write("app", "kmp/sharedLogic/src/commonMain/kotlin/AppConfig.kt", kt());
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    const tierOf = (p) => fx.fileEntry(doc, `input-sources/${p}`).tier;
    assert.equal(tierOf("kmp/build.gradle.kts"), "entry");
    assert.equal(tierOf("kmp/README.md"), "entry");
    assert.equal(tierOf("kmp/sharedUI/src/commonMain/kotlin/navigation/Routes.kt"), "navigation");
    assert.equal(tierOf("kmp/sharedUI/src/commonMain/kotlin/screens/home/HomeScreen.kt"), "screen");
    assert.equal(tierOf("kmp/sharedLogic/src/commonMain/kotlin/vm/HomeViewModel.kt"), "state");
    assert.equal(tierOf("kmp/sharedLogic/src/commonMain/kotlin/domain/model/User.kt"), "model");
    assert.equal(tierOf("kmp/sharedLogic/src/commonMain/kotlin/data/remote/UserApi.kt"), "api");
    assert.equal(tierOf("kmp/sharedLogic/src/commonMain/kotlin/AppConfig.kt"), "config");
  } finally {
    fx.cleanup();
  }
});

test("除外は理由つきで台帳に残る (test / asset / generated / lockfile / binary / oversized)", () => {
  const fx = setup();
  try {
    fx.write("app", "rn/package.json", "{}");
    fx.write("app", "rn/src/screens/Home.tsx", kt());
    fx.write("app", "rn/src/screens/Home.test.tsx", kt());
    fx.write("app", "rn/src/__tests__/util.ts", kt());
    fx.write("app", "rn/assets/logo.png", "png");
    fx.write("app", "rn/lib/gen/api.g.dart", kt());
    fx.write("app", "rn/yarn.lock", "lock");
    fx.write("app", "rn/data.realm", "x");
    fx.write("app", "rn/huge.json", "x".repeat(250_001));
    const p = join(fx.root, "artifacts", "app", "input-sources", "rn", "blob.dat");
    writeFileSync(p, Buffer.from([0x41, 0x00, 0x42]));
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    const reasonOf = (p2) => fx.fileEntry(doc, `input-sources/${p2}`).excluded;
    assert.equal(reasonOf("rn/src/screens/Home.test.tsx"), "test");
    assert.equal(reasonOf("rn/src/__tests__/util.ts"), "test");
    assert.equal(reasonOf("rn/assets/logo.png"), "asset");
    assert.equal(reasonOf("rn/lib/gen/api.g.dart"), "generated");
    assert.equal(reasonOf("rn/yarn.lock"), "lockfile");
    assert.equal(reasonOf("rn/data.realm"), "binary");
    assert.equal(reasonOf("rn/huge.json"), "oversized");
    assert.equal(reasonOf("rn/blob.dat"), "binary");
    // 会計恒等式: 全ファイル = 解析候補 + 除外 (黙って消えたファイルが無い)
    const excludedTotal = Object.values(doc.summary.excluded).reduce((a, b) => a + b, 0);
    assert.equal(doc.summary.total_files, doc.summary.source_files + excludedTotal);
  } finally {
    fx.cleanup();
  }
});

test("dependency / build dir は中を歩かず未走査 dir 台帳に残す", () => {
  const fx = setup();
  try {
    fx.write("app", "rn/package.json", "{}");
    fx.write("app", "rn/src/App.tsx", kt());
    fx.write("app", "rn/node_modules/lib/index.js", kt());
    fx.write("app", "rn/build/out.js", kt());
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    const reasons = Object.fromEntries(doc.excluded_dirs.map((d) => [d.path, d.reason]));
    assert.equal(reasons["input-sources/rn/node_modules"], "dependency");
    assert.equal(reasons["input-sources/rn/build"], "build_output");
    // 中身は files に現れない (歩いていない)
    assert.equal(fx.fileEntry(doc, "input-sources/rn/node_modules/lib/index.js"), undefined);
  } finally {
    fx.cleanup();
  }
});

test("module 境界: manifest を持つ dir が module、無ければ src/lib/app は 2 セグメント", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/build.gradle.kts", kt());
    fx.write("app", "kmp/sharedLogic/build.gradle.kts", kt());
    fx.write("app", "kmp/sharedLogic/src/commonMain/kotlin/domain/model/User.kt", kt());
    fx.write("app", "rn/package.json", "{}");
    fx.write("app", "rn/src/screens/Home.tsx", kt());
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    assert.equal(
      fx.fileEntry(doc, "input-sources/kmp/sharedLogic/src/commonMain/kotlin/domain/model/User.kt").module,
      "kmp/sharedLogic",
    );
    assert.equal(fx.fileEntry(doc, "input-sources/rn/src/screens/Home.tsx").module, "rn/src/screens");
  } finally {
    fx.cleanup();
  }
});

test("shard 計画: 予算超の大型 module は単独で分割され、他 module と相乗りしない", () => {
  const fx = setup();
  try {
    const big = "x".repeat(30_000) + "\n";
    for (let i = 1; i <= 5; i++) fx.write("app", `kmp/modA/screens/S${i}.kt`, big); // 150k > 120k 予算
    fx.write("app", "kmp/modB/screens/S9.kt", big); // 30k → 小型 (packing 対象)
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    const modAShards = doc.shards.filter((s) => s.modules.includes("kmp/modA"));
    assert.ok(modAShards.length >= 2, "modA は複数 shard に分割される");
    for (const s of modAShards) {
      assert.ok(s.chars <= doc.constants.shard_char_budget, `shard ${s.id} が chars 予算内`);
      assert.deepEqual(s.modules, ["kmp/modA"], `大型 module の shard ${s.id} に他 module が相乗りしない`);
    }
  } finally {
    fx.cleanup();
  }
});

test("shard 計画: 小型 module は 1 つの shard に相乗り packing される (worker 固定費削減)", () => {
  const fx = setup();
  try {
    const small = "x".repeat(24_000) + "\n";
    fx.write("app", "kmp/modA/screens/A.kt", small);
    fx.write("app", "kmp/modB/screens/B.kt", small);
    fx.write("app", "kmp/modC/screens/C.kt", small); // 計 72k ≤ 120k → 1 shard に packing
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    assert.equal(doc.shards.length, 1);
    assert.deepEqual(doc.shards[0].modules, ["kmp/modA", "kmp/modB", "kmp/modC"]);
  } finally {
    fx.cleanup();
  }
});

test("shard 計画: packing もファイル数上限を守る (module 単位で次の shard へ)", () => {
  const fx = setup();
  try {
    for (const m of ["modA", "modB", "modC"]) {
      for (let i = 0; i < 15; i++) fx.write("app", `kmp/${m}/screens/S${String(i).padStart(2, "0")}.kt`, kt(3));
    }
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    assert.equal(doc.shards.length, 2);
    assert.deepEqual(doc.shards[0].modules, ["kmp/modA", "kmp/modB"]); // 30 files ≤ 40、modC は溢れる
    assert.deepEqual(doc.shards[1].modules, ["kmp/modC"]);
  } finally {
    fx.cleanup();
  }
});

test("shard 計画: 単一 module でもファイル数上限で分割する", () => {
  const fx = setup();
  try {
    for (let i = 0; i < 50; i++) fx.write("app", `kmp/modA/screens/S${String(i).padStart(2, "0")}.kt`, kt(3));
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    assert.equal(doc.shards.length, 2);
    assert.equal(doc.shards[0].files.length, doc.constants.shard_file_cap);
    assert.equal(doc.shards[1].files.length, 50 - doc.constants.shard_file_cap);
  } finally {
    fx.cleanup();
  }
});

test("--tiers で範囲が絞られ、対象外 tier は shard に入らない", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/Home.kt", kt());
    fx.write("app", "kmp/modA/notes/memo.txt", kt()); // other_source
    assert.equal(fx.run("app", ["--tiers", "screen"]).status, 0);
    const doc = fx.inventory();
    assert.equal(doc.summary.in_scope.files, 1);
    assert.equal(fx.fileEntry(doc, "input-sources/kmp/modA/notes/memo.txt").in_scope, false);
    const shardFiles = doc.shards.flatMap((s) => s.files);
    assert.deepEqual(shardFiles, ["input-sources/kmp/modA/screens/Home.kt"]);
    // other_source を明示 opt-in すれば in-scope に入る
    assert.equal(fx.run("app", ["--tiers", "screen,other_source"]).status, 0);
    assert.equal(fx.inventory().summary.in_scope.files, 2);
  } finally {
    fx.cleanup();
  }
});

test("--modules で module 単位の範囲調整ができる", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    fx.write("app", "kmp/modB/screens/B.kt", kt());
    assert.equal(fx.run("app", ["--modules", "kmp/modA"]).status, 0);
    const doc = fx.inventory();
    assert.equal(doc.summary.in_scope.files, 1);
    assert.deepEqual(doc.shards.flatMap((s) => s.files), ["input-sources/kmp/modA/screens/A.kt"]);
  } finally {
    fx.cleanup();
  }
});

test("不明な tier 名は明示エラーで止まる", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    const { status, err } = fx.run("app", ["--tiers", "bogus"]);
    assert.equal(status, 1);
    assert.match(err, /unknown tier/);
  } finally {
    fx.cleanup();
  }
});

test("--stdout は JSON だけを stdout に出す (提案表は stderr)", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    const { status, out, err } = fx.run("app", ["--stdout"]);
    assert.equal(status, 0);
    assert.doesNotThrow(() => JSON.parse(out), "stdout が単体で parse できる");
    assert.match(err, /build-code-inventory/, "提案表は stderr 側");
  } finally {
    fx.cleanup();
  }
});

test("--out は指定パスへ書き、既定の台帳には触らない", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    const rel = join("artifacts", "app", "reverse-verify", ".code-inventory.json");
    const { status, out } = fx.run("app", ["--out", rel]);
    assert.equal(status, 0);
    const doc = JSON.parse(readFileSync(join(fx.root, rel), "utf8"));
    assert.ok(doc.shards.length >= 1, "指定パスに読み取り計画が書かれる");
    assert.match(out, /wrote .*reverse-verify/, "書き出し先が提案表に出る");
    assert.equal(
      existsSync(join(fx.root, "artifacts", "app", "reverse-engineered", ".code-inventory.json")),
      false,
      "既定の台帳 (reverse の resume / worker が読む) は作られない",
    );
  } finally {
    fx.cleanup();
  }
});

test("--out は正式ファイル名に限る (app 配下の任意 JSON を上書きさせない)", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    fx.writeArtifact("app", "requirements.json", "SENTINEL");
    // 実測された事故: 要件ファイルを inventory JSON で丸ごと置き換えられた。
    // Bash 経由の書き込みは backup / schema hook を通らないため復旧できない
    const clobber = fx.run("app", ["--out", join("artifacts", "app", "requirements.json")]);
    assert.equal(clobber.status, 1);
    assert.match(clobber.err, /ファイル名は \.code-inventory\.json/);
    assert.equal(
      readFileSync(join(fx.root, "artifacts", "app", "requirements.json"), "utf8"),
      "SENTINEL",
      "既存ファイルは書き換えられない",
    );
    // ディレクトリ自体も出力先ではない (EISDIR の internal error に落とさない)
    const dirTarget = fx.run("app", ["--out", join("artifacts", "app")]);
    assert.equal(dirTarget.status, 1);
    // 正式名ならサブディレクトリを自由に選べる
    const ok = fx.run("app", ["--out", join("artifacts", "app", "reverse-verify", ".code-inventory.json")]);
    assert.equal(ok.status, 0);
  } finally {
    fx.cleanup();
  }
});

test("--out は app 自身の artifacts 配下に限る / 値なしと --stdout 併用は拒否", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    const outside = fx.run("app", ["--out", join("artifacts", "other-app", ".code-inventory.json")]);
    assert.equal(outside.status, 1);
    assert.match(outside.err, /artifacts\/app\/ 配下/);
    const traversal = fx.run("app", ["--out", join("artifacts", "app", "..", ".code-inventory.json")]);
    assert.equal(traversal.status, 1, ".. で外へ出るパスも拒否する");
    assert.equal(fx.run("app", ["--out"]).status, 1, "値なしは Usage エラー");
    const both = fx.run("app", ["--out", join("artifacts", "app", "x.json"), "--stdout"]);
    assert.equal(both.status, 1);
    assert.match(both.err, /同時に指定できません/);
  } finally {
    fx.cleanup();
  }
});

test("提案表に見積り (tokens 内訳 / 分 / shard 数) が出る", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    const { out } = fx.run();
    assert.match(out, /予想: ~[\d,]+ tokens \(worker 固定費 ~[\d,]+ \+ 内容 ~[\d,]+\)/);
    assert.match(out, /shards\)/);
  } finally {
    fx.cleanup();
  }
});

test("大型 CLAUDE.md がツリー内にあると固定費警告を出す", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    fx.write("app", "kmp/CLAUDE.md", "x".repeat(25_000));
    const { status, err } = fx.run();
    assert.equal(status, 0, "警告は exit code を変えない");
    assert.match(err, /大型 CLAUDE\.md/);
  } finally {
    fx.cleanup();
  }
});

test("受け入れ基準: 数千ファイル級でも完走し、提案表は module 単位に圧縮される", () => {
  const fx = setup();
  try {
    for (let m = 0; m < 30; m++) {
      for (let i = 0; i < 100; i++) {
        fx.write("app", `kmp/mod${String(m).padStart(2, "0")}/screens/S${i}.kt`, kt(5));
      }
    }
    const { status, out } = fx.run();
    assert.equal(status, 0);
    const doc = fx.inventory();
    assert.equal(doc.summary.total_files, 3000);
    assert.ok(out.split("\n").length < 150, "提案表がファイル羅列にならない");
  } finally {
    fx.cleanup();
  }
});

test("同一入力での再実行は generated_at 以外が一致する (決定論)", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    fx.write("app", "kmp/modA/vm/AViewModel.kt", kt());
    assert.equal(fx.run().status, 0);
    const a = fx.inventory();
    assert.equal(fx.run().status, 0);
    const b = fx.inventory();
    a.generated_at = b.generated_at = "";
    assert.deepEqual(a, b);
  } finally {
    fx.cleanup();
  }
});

test("tier 分類: Next.js App Router / Flutter snake_case もデフォルト範囲に入る", () => {
  const fx = setup();
  try {
    fx.write("app", "web/package.json", "{}");
    fx.write("app", "web/app/page.tsx", kt());
    fx.write("app", "web/app/layout.tsx", kt());
    fx.write("app", "web/app/settings/page.tsx", kt());
    fx.write("app", "web/app/api/users/route.ts", kt());
    fx.write("app", "web/middleware.ts", kt());
    fx.write("app", "fl/pubspec.yaml", "name: fl");
    fx.write("app", "fl/lib/home_page.dart", kt());
    fx.write("app", "fl/lib/settings_view.dart", kt());
    fx.write("app", "fl/lib/home_bloc.dart", kt());
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    assert.equal(fx.fileEntry(doc, "input-sources/web/app/page.tsx").tier, "screen");
    assert.equal(fx.fileEntry(doc, "input-sources/web/app/layout.tsx").tier, "screen");
    assert.equal(fx.fileEntry(doc, "input-sources/web/app/settings/page.tsx").tier, "screen");
    assert.equal(fx.fileEntry(doc, "input-sources/web/app/api/users/route.ts").tier, "api");
    assert.equal(fx.fileEntry(doc, "input-sources/web/middleware.ts").tier, "navigation");
    assert.equal(fx.fileEntry(doc, "input-sources/fl/lib/home_page.dart").tier, "screen");
    assert.equal(fx.fileEntry(doc, "input-sources/fl/lib/settings_view.dart").tier, "screen");
    assert.equal(fx.fileEntry(doc, "input-sources/fl/lib/home_bloc.dart").tier, "state");
    for (const p of ["input-sources/web/app/page.tsx", "input-sources/fl/lib/home_page.dart"]) {
      assert.equal(fx.fileEntry(doc, p).in_scope, true, `${p} should be in default scope`);
    }
  } finally {
    fx.cleanup();
  }
});

test("credential ファイル (.env / .pem / local.properties) は secret として除外され台帳に残る", () => {
  const fx = setup();
  try {
    fx.write("app", "web/package.json", "{}");
    fx.write("app", "web/app/page.tsx", kt());
    fx.write("app", "web/.env", "API_KEY=secret");
    fx.write("app", "web/.env.production", "API_KEY=secret");
    fx.write("app", "web/config/server.pem", "-----BEGIN-----");
    fx.write("app", "web/local.properties", "sdk.dir=/x");
    assert.equal(fx.run().status, 0);
    const doc = fx.inventory();
    for (const p of [
      "input-sources/web/.env",
      "input-sources/web/.env.production",
      "input-sources/web/config/server.pem",
      "input-sources/web/local.properties",
    ]) {
      assert.equal(fx.fileEntry(doc, p).excluded, "secret", `${p} should be excluded as secret`);
    }
    assert.equal(doc.summary.excluded.secret, 4);
  } finally {
    fx.cleanup();
  }
});

test("--modules の誤記は exit 1 で有効な module 一覧を出す / in-scope 0 の計画は書き出さない", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    const typo = fx.run("app", ["--modules", "kmp/modAAA"]);
    assert.equal(typo.status, 1);
    assert.match(typo.err, /unknown module/);
    assert.match(typo.err, /kmp\/modA/);
    const empty = fx.run("app", ["--tiers", "api"]);
    assert.equal(empty.status, 1);
    assert.match(empty.err, /in-scope が 0 件/);
  } finally {
    fx.cleanup();
  }
});

test("--require-files: tier 外の導出ファイルは計画に固定 (pin) され shard に入る", () => {
  const fx = setup();
  try {
    // util/Format.kt はどの tier パターンにも当たらず other_source → 既定 tier では in_scope 外
    fx.write("app", "kmp/modA/util/Format.kt", kt());
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    const pinned = fx.run("app", [
      "--modules", "kmp/modA",
      "--require-files", "input-sources/kmp/modA/util/Format.kt",
      "--stdout",
    ]);
    assert.equal(pinned.status, 0);
    assert.match(pinned.err, /require-files 固定: 1 件/);
    const doc = JSON.parse(pinned.out);
    const entry = fx.fileEntry(doc, "input-sources/kmp/modA/util/Format.kt");
    assert.equal(entry.in_scope, true);
    assert.equal(entry.pinned, true);
    // worker が読むのは files[] ではなく shards[] — pin が shard まで届くことを固定する
    const shardFiles = doc.shards.flatMap((s) => s.files);
    assert.ok(shardFiles.includes("input-sources/kmp/modA/util/Format.kt"));
    assert.deepEqual(doc.selection.require_files, ["input-sources/kmp/modA/util/Format.kt"]);
  } finally {
    fx.cleanup();
  }
});

test("--require-files: module 外は pin せず exit 1 + --modules 拡張の再実行案を出す", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    fx.write("app", "kmp/modB/screens/B.kt", kt());
    const r = fx.run("app", [
      "--modules", "kmp/modA",
      "--require-files", "input-sources/kmp/modB/screens/B.kt",
      "--stdout",
    ]);
    assert.equal(r.status, 1);
    assert.match(r.err, /module kmp\/modB が --modules 外/);
    assert.match(r.err, /--modules kmp\/modA,kmp\/modB で再実行/);
    assert.match(r.err, /意図的に除外した module/);
  } finally {
    fx.cleanup();
  }
});

test("--require-files: 引用形 (artifacts/ 接頭辞 + :line) をそのまま受け付け、パス誤りは exit 1", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    // raw-analysis の引用文字列をそのまま渡せる (接頭辞と行アンカーは script 側で剥がす)
    const cited = fx.run("app", [
      "--modules", "kmp/modA",
      "--require-files", "artifacts/app/input-sources/kmp/modA/screens/A.kt:8",
      "--stdout",
    ]);
    assert.equal(cited.status, 0);
    const missing = fx.run("app", [
      "--require-files", "input-sources/kmp/modA/screens/NoSuch.kt",
      "--stdout",
    ]);
    assert.equal(missing.status, 1);
    assert.match(missing.err, /台帳に無い/);
    assert.equal(fx.run("app", ["--require-files"]).status, 1, "値なしはエラー");
  } finally {
    fx.cleanup();
  }
});

test("--require-files: 除外ファイル・空値 (カンマのみ)・フラグ重複は exit 1 で黙って通さない", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    fx.write("app", "kmp/modA/screens/A.test.kt", kt());
    const excluded = fx.run("app", [
      "--require-files", "input-sources/kmp/modA/screens/A.test.kt",
      "--stdout",
    ]);
    assert.equal(excluded.status, 1);
    assert.match(excluded.err, /除外済み \(test\)/);
    // カンマ・空白だけの値は「核 0 件で全通過」になってはならない (無言の脱落防止という目的の反転)
    assert.equal(fx.run("app", ["--require-files", ",", "--stdout"]).status, 1);
    assert.equal(fx.run("app", ["--require-files", "  ", "--stdout"]).status, 1);
    // 値フラグの重複指定は 2 個目が黙って落ちるため拒否する
    const dup = fx.run("app", [
      "--require-files", "input-sources/kmp/modA/screens/A.kt",
      "--require-files", "input-sources/kmp/modA/screens/A.test.kt",
      "--stdout",
    ]);
    assert.equal(dup.status, 1);
    assert.match(dup.err, /1 回だけ指定/);
  } finally {
    fx.cleanup();
  }
});

test("shard 予算を超える単一ファイルは solo shard に隔離され over_budget が立つ", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/Big.kt", "x".repeat(240_000));
    fx.write("app", "kmp/modA/screens/Small.kt", kt());
    const { err } = fx.run();
    const doc = fx.inventory();
    const over = doc.shards.filter((s) => s.over_budget);
    assert.equal(over.length, 1);
    assert.equal(over[0].files.length, 1);
    assert.match(over[0].files[0], /Big\.kt$/);
    assert.match(err, /shard 予算.*超える単一ファイル/);
  } finally {
    fx.cleanup();
  }
});

test("input-sources 直下のファイルは警告され summary.unassigned_root_files に残る", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/src/Main.kt", kt());
    fx.write("app", "package.json", "{}");
    fx.write("app", "README.md", "# direct");
    const { status, err } = fx.run();
    assert.equal(status, 0);
    assert.match(err, /直下にファイルが 2 件/);
    assert.match(err, /直置きした可能性/);
    assert.deepEqual(fx.inventory().summary.unassigned_root_files, ["README.md", "package.json"]);
  } finally {
    fx.cleanup();
  }
});

test("app_name にパス区切りが含まれると exit 1 (artifacts 外への書き込み禁止)", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/src/Main.kt", kt());
    const r = fx.run("../evil");
    assert.equal(r.status, 1);
    assert.match(r.err, /invalid app_name/);
  } finally {
    fx.cleanup();
  }
});

test("loc は末尾改行を行として数えない / input-sources が通常ファイルなら exit 2", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/src/Main.kt", "line1\nline2\n");
    assert.equal(fx.run().status, 0);
    assert.equal(fx.fileEntry(fx.inventory(), "input-sources/kmp/src/Main.kt").loc, 2);

    const fx2 = setup();
    try {
      mkdirSync(join(fx2.root, "artifacts", "app2"), { recursive: true });
      writeFileSync(join(fx2.root, "artifacts", "app2", "input-sources"), "not a dir");
      const r = fx2.run("app2");
      assert.equal(r.status, 2);
      assert.match(r.err, /internal error/);
    } finally {
      fx2.cleanup();
    }
  } finally {
    fx.cleanup();
  }
});

test("summary.budget_gate が閾値と超過判定を機械可読で出す", () => {
  const fx = setup();
  try {
    fx.write("app", "kmp/modA/screens/A.kt", kt());
    assert.equal(fx.run().status, 0);
    const gate = fx.inventory().summary.budget_gate;
    assert.equal(gate.exceeded, false);
    assert.equal(gate.threshold_files, 120);
    assert.equal(gate.threshold_chars, 400_000);

    for (let i = 0; i < 121; i++) fx.write("app2", `kmp/modA/screens/S${String(i).padStart(3, "0")}.kt`, kt());
    const { out } = fx.run("app2");
    assert.equal(fx.inventory("app2").summary.budget_gate.exceeded, true);
    assert.match(out, /予算ゲート: 超過/);
  } finally {
    fx.cleanup();
  }
});
