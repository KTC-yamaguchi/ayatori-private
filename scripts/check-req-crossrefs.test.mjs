#!/usr/bin/env node
// scripts/check-req-crossrefs.test.mjs
//
// check-req-crossrefs.mjs の白箱 unit test:
//   ID 抽出 (Entity の可変桁・スラッシュ表記・範囲表記・桁あふれの既知挙動)・主体 ID 導出
//   (section 優先 / summary fallback / impact_hint 不使用 / removed の除外規則)・
//   3 観点の集合演算 (特に観点 3 の full / partial 母集合切替) を検証する。
// CLI 統合 (golden 比較) は skills/33-req-revision/evals/check-req-crossrefs-evals.test.mjs が担う。
//
// 実行: npm test (= node --test) / 単体: node --test scripts/check-req-crossrefs.test.mjs
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkKanten1,
  checkKanten2,
  checkKanten3,
  coverageMode,
  deriveSets,
  extractIds,
  idKey,
  parseArgs,
  parseIdKey,
  parseSnapshotDocName,
  scanOccurrences,
  sortIdKeys,
  subjectIds,
} from "./check-req-crossrefs.mjs";

// ── CLI 引数解決 ─────────────────────────────────────

test("parseArgs: フラグ省略時は req-delta/ 配下の既定パス (従来動作)", () => {
  const args = parseArgs(["artifacts/app"]);
  assert.equal(args.error, undefined);
  assert.equal(args.appRoot, "artifacts/app");
  assert.equal(args.manifestPath, join("artifacts/app", "req-delta", "change-manifest.json"));
  assert.equal(args.snapshotsDir, join("artifacts/app", "req-delta", "snapshots"));
  assert.equal(args.reportPath, join("artifacts/app", "req-delta", "cross-reference-integrity-report.md"));
});

test("parseArgs: --manifest / --snapshots / --report は app ルート相対で解決される", () => {
  const args = parseArgs([
    "artifacts/app",
    "--manifest", "delta/req-promotion/change-manifest.json",
    "--snapshots", "delta/req-promotion/snapshots",
    "--report", "delta/req-promotion/cross-reference-integrity-report.md",
  ]);
  assert.equal(args.error, undefined);
  assert.equal(args.manifestPath, join("artifacts/app", "delta/req-promotion/change-manifest.json"));
  assert.equal(args.snapshotsDir, join("artifacts/app", "delta/req-promotion/snapshots"));
  assert.equal(args.reportPath, join("artifacts/app", "delta/req-promotion/cross-reference-integrity-report.md"));
});

test("parseArgs: 値なしフラグ / 不明フラグ / appRoot 欠落は error を返す", () => {
  assert.ok(parseArgs(["artifacts/app", "--manifest"]).error);
  assert.ok(parseArgs(["artifacts/app", "--manifest", "--report", "x"]).error);
  assert.ok(parseArgs(["artifacts/app", "--unknown", "x"]).error);
  assert.ok(parseArgs([]).error);
});

// ── ID 抽出 ──────────────────────────────────────────

test("extractIds: Entity は可変桁で最長一致 (Entity 10 が Entity 1 に化けない)", () => {
  assert.deepEqual(extractIds("Entity 10 を参照"), [{ kind: "Entity", number: 10 }]);
  assert.deepEqual(extractIds("Entity 1 と Entity 10"), [
    { kind: "Entity", number: 1 },
    { kind: "Entity", number: 10 },
  ]);
});

test("extractIds: スラッシュ表記 NFR-14/15 は NFR-14 のみ拾う (grep 同値の既知挙動)", () => {
  assert.deepEqual(extractIds("NFR-14/15 を参照"), [{ kind: "NFR", number: 14 }]);
});

test("extractIds: 範囲表記 AC-01〜AC-04 は両端とも拾う", () => {
  assert.deepEqual(extractIds("AC-01〜AC-04"), [
    { kind: "AC", number: 1 },
    { kind: "AC", number: 4 },
  ]);
});

test("extractIds: 2 桁固定のため F-081 からは F-08 が切り出される (grep 同値の既知挙動)", () => {
  assert.deepEqual(extractIds("F-081"), [{ kind: "F", number: 8 }]);
});

test("idKey / parseIdKey: 表示形の往復 (0 埋め / Entity スペース区切り)", () => {
  assert.equal(idKey({ kind: "F", number: 8 }), "F-08");
  assert.equal(idKey({ kind: "Entity", number: 10 }), "Entity 10");
  assert.deepEqual(parseIdKey("F-08"), { kind: "F", number: 8 });
  assert.deepEqual(parseIdKey("Entity 10"), { kind: "Entity", number: 10 });
});

test("sortIdKeys: kind 順 (F→UC→NFR→S→AC→E→Entity) → 番号順", () => {
  assert.deepEqual(sortIdKeys(["Entity 2", "AC-01", "F-10", "F-02", "NFR-05"]), [
    "F-02",
    "F-10",
    "NFR-05",
    "AC-01",
    "Entity 2",
  ]);
});

// ── 主体 ID 導出 ─────────────────────────────────────

test("subjectIds: section のみから抽出 (summary / impact_hint の言及は主体にしない)", () => {
  assert.deepEqual(
    subjectIds({ section: "F-08 新規対局ダイアログ", summary: "F-09 も触る", impact_hint: "UC-01 に影響" }),
    new Set(["F-08"]),
  );
  // summary に ID があっても主体には採らない — 言及 (参照) を主体と誤認すると観点 1 が壊れる
  assert.deepEqual(
    subjectIds({ section: "新規対局ダイアログ", summary: "F-09 を追加", impact_hint: "UC-01 に影響" }),
    new Set(),
  );
});

test("deriveSets: modified の summary が削除 ID に言及しても removed は消えない (観点 1 無効化の防止)", () => {
  const manifest = {
    requirement_changes: [
      { doc: "05-features.md", section: "F-05 旧機能", type: "removed", summary: "F-05 を削除し F-08 に統合", impact_hint: "" },
      { doc: "05-features.md", section: "画面導線の整理", type: "modified", summary: "F-05 の削除に伴い一覧導線を整理", impact_hint: "" },
    ],
  };
  const sets = deriveSets(manifest);
  assert.deepEqual(sets.removed, new Set(["F-05"])); // 残存検査の対象を維持
  assert.deepEqual(sets.modified, new Set()); // summary の F-05 言及は主体にならない
  assert.deepEqual(sets.warnings, []);
});

test("deriveSets: removed entry の section に ID が無い場合は warnings で可視化する", () => {
  const manifest = {
    requirement_changes: [
      { doc: "05-features.md", section: "旧レポート機能", type: "removed", summary: "F-05 を削除", impact_hint: "" },
    ],
  };
  const sets = deriveSets(manifest);
  assert.deepEqual(sets.removed, new Set()); // 導出できない = 観点 1 は検証不能
  assert.equal(sets.warnings.length, 1);
  assert.match(sets.warnings[0], /requirement_changes\[0\].*観点 1 の残存検査対象になりません/);
});

// ── snapshot / coverage ──────────────────────────────

test("parseSnapshotDocName: 2 形式に対応、非 snapshot ファイルは null", () => {
  assert.equal(parseSnapshotDocName("05-features.md.snapshot.md"), "05-features.md");
  assert.equal(parseSnapshotDocName("05-features.snapshot.md"), "05-features.md");
  assert.equal(parseSnapshotDocName("readme.txt"), null);
});

test("coverageMode: 00-* を除く NN-*.md 全件を覆えば full、欠けは partial + 未検査列挙", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crossrefs-cov-"));
  try {
    for (const f of ["00-raw-input.md", "01-overview.md", "05-features.md", "06-non-functional.md"]) {
      writeFileSync(join(tmp, f), "x");
    }
    const full = coverageMode(new Set(["01-overview.md", "05-features.md", "06-non-functional.md"]), tmp);
    assert.equal(full.mode, "full");
    const partial = coverageMode(new Set(["05-features.md"]), tmp);
    assert.equal(partial.mode, "partial");
    assert.deepEqual(partial.uncheckedDocs, ["01-overview.md", "06-non-functional.md"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanOccurrences: 再帰走査で file / base / line / kind / number を返す", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crossrefs-scan-"));
  try {
    writeFileSync(join(tmp, "05-features.md"), "## F-01: 機能\n関連: UC-02\n");
    mkdirSync(join(tmp, "sub"));
    writeFileSync(join(tmp, "sub", "note.md"), "Entity 3\n");
    const occ = scanOccurrences(tmp);
    assert.deepEqual(occ, [
      { file: "requirements/05-features.md", base: "05-features.md", line: 1, kind: "F", number: 1 },
      { file: "requirements/05-features.md", base: "05-features.md", line: 2, kind: "UC", number: 2 },
      { file: "requirements/sub/note.md", base: "note.md", line: 1, kind: "Entity", number: 3 },
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 観点 1 / 2 ───────────────────────────────────────

const occ = (base, line, kind, number) => ({ file: `requirements/${base}`, base, line, kind, number });

test("checkKanten1: 削除済 ID の残存を file:line 付きで検出", () => {
  const result = checkKanten1(new Set(["F-05"]), [occ("04-use-cases.md", 12, "F", 5), occ("05-features.md", 3, "F", 8)]);
  assert.deepEqual(result.violations, [
    { id: "F-05", occurrences: [{ file: "requirements/04-use-cases.md", line: 12 }] },
  ]);
  assert.deepEqual(checkKanten1(new Set(["F-05"]), [occ("05-features.md", 3, "F", 8)]).violations, []);
});

test("checkKanten2: expected は searchable_text 全体から、actual は basename 比較で superset 判定", () => {
  const manifest = {
    requirement_changes: [
      { doc: "05-features.md", section: "F-08 新機能", type: "added", summary: "追加", impact_hint: "UC-03 は F-08 参照に更新" },
      { doc: "04-use-cases.md", section: "UC-03", type: "modified", summary: "F-08 参照を追加", impact_hint: "" },
    ],
  };
  const pass = checkKanten2(new Set(["F-08"]), manifest, [occ("05-features.md", 1, "F", 8), occ("04-use-cases.md", 9, "F", 8)]);
  assert.deepEqual(pass.results, [
    { id: "F-08", status: "PASS", expected_docs: ["04-use-cases.md", "05-features.md"], actual_docs: ["04-use-cases.md", "05-features.md"], missing_docs: [] },
  ]);

  const fail = checkKanten2(new Set(["F-08"]), manifest, [occ("05-features.md", 1, "F", 8)]);
  assert.equal(fail.results[0].status, "FAIL");
  assert.deepEqual(fail.results[0].missing_docs, ["04-use-cases.md"]);
});

test("checkKanten2: Entity のスペース区切り表示形でも一致判定できる", () => {
  const manifest = {
    requirement_changes: [
      { doc: "07-data-definition.md", section: "Entity 10 履歴", type: "added", summary: "Entity 10 を追加", impact_hint: "" },
    ],
  };
  const r = checkKanten2(new Set(["Entity 10"]), manifest, [occ("07-data-definition.md", 5, "Entity", 10)]);
  assert.deepEqual(r.results[0], {
    id: "Entity 10",
    status: "PASS",
    expected_docs: ["07-data-definition.md"],
    actual_docs: ["07-data-definition.md"],
    missing_docs: [],
  });
});

// ── 観点 3 (母集合統一が本丸) ─────────────────────────

const baselineOf = (ids, docs) => ({ ids: ids.map(parseIdKey), docs: new Set(docs) });

test("checkKanten3 (a): baseline ID の消失を検出、removed 経由の正規削除は許容", () => {
  const baseline = baselineOf(["F-01", "F-02", "F-03"], ["05-features.md"]);
  const occurrences = [occ("05-features.md", 1, "F", 1)]; // F-02 / F-03 が消えた
  const r = checkKanten3(baseline, new Set(["F-03"]), occurrences, { mode: "full" });
  assert.deepEqual(r.violations, [{ kind: "F", type: "missing_existing", numbers: [2] }]);
});

test("checkKanten3 (b) partial: snapshot 外 doc の既存 ID を途中挿入と誤検出しない", () => {
  // snapshot は 05-features.md のみ (NFR-12 を含む)。06-non-functional.md には元から NFR-01..03 がある。
  const baseline = baselineOf(["NFR-12"], ["05-features.md"]);
  const occurrences = [
    occ("05-features.md", 10, "NFR", 12),
    occ("06-non-functional.md", 5, "NFR", 1),
    occ("06-non-functional.md", 6, "NFR", 2),
    occ("06-non-functional.md", 7, "NFR", 3),
  ];
  const partial = checkKanten3(baseline, new Set(), occurrences, { mode: "partial" });
  assert.deepEqual(partial.violations, []); // 母集合を snapshot 済み doc に揃えるため違反なし

  // full 扱い (snapshot が全 doc を覆う想定) なら同じ現状でも途中挿入として検出される
  const full = checkKanten3(baseline, new Set(), occurrences, { mode: "full" });
  assert.deepEqual(full.violations, [{ kind: "NFR", type: "below_max_addition", numbers: [1, 2, 3], max_baseline: 12 }]);
});

test("checkKanten3 (b): snapshot 済み doc 内の max 以下追加は partial でも検出する", () => {
  const baseline = baselineOf(["F-02", "F-05"], ["05-features.md"]);
  const occurrences = [
    occ("05-features.md", 1, "F", 2),
    occ("05-features.md", 2, "F", 3), // 途中挿入 (baseline に無い 3 ≤ max 5)
    occ("05-features.md", 3, "F", 5),
    occ("05-features.md", 4, "F", 6), // 末尾追加は許容
  ];
  const r = checkKanten3(baseline, new Set(), occurrences, { mode: "partial" });
  assert.deepEqual(r.violations, [{ kind: "F", type: "below_max_addition", numbers: [3], max_baseline: 5 }]);
});

test("checkKanten3: snapshots 不在 (baseline null) は skipped で違反なし", () => {
  const r = checkKanten3(null, new Set(["F-01"]), [occ("05-features.md", 1, "F", 1)], { mode: "skipped" });
  assert.deepEqual(r, { status: "skipped", violations: [] });
});
