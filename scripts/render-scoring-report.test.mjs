#!/usr/bin/env node
// scripts/render-scoring-report.test.mjs
//
// render-scoring-report.mjs の白箱 unit test:
//   閾値境界 (合計 80/50、軸 16/10/12)・Projection の重複加算防止・改善セル判定・
//   検算警告・ヒートマップ行順序などの純関数を検証する。
// CLI 統合 (golden 比較) は skills/04-scoring/evals/render-scoring-report-evals.test.mjs が担う。
// 実 artifact スモーク: artifacts/*/scoring-history.json が存在する環境でのみ、tmpdir へ複写して
//   CLI を通し、構造不変条件 (exit 0 / 出力 3 ファイル / 数値整合) を確認する (無ければ skip)。
//
// 実行: npm test (= node --test) / 単体: node --test scripts/render-scoring-report.test.mjs
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AXIS_ORDER,
  axisOfCheck,
  barFillClass,
  checkLabel,
  heatRowKeys,
  improvedSet,
  isPass,
  projections,
  renderDashboard,
  renderHistory,
  scoreLevel,
  simNote,
  sortBySeverity,
  truncate,
  verdictLabel,
  verifyAttempt,
} from "./render-scoring-report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const SCRIPT = join(HERE, "render-scoring-report.mjs");

// ── 閾値境界 ─────────────────────────────────────────

test("scoreLevel: 80 で yes / 79・50 で partial / 49 で no", () => {
  assert.equal(scoreLevel(80), "yes");
  assert.equal(scoreLevel(79), "partial");
  assert.equal(scoreLevel(50), "partial");
  assert.equal(scoreLevel(49), "no");
});

test("isPass: 総合 80 かつ全軸 12 以上のときのみ true", () => {
  const scores = { correctness: 20, unambiguity: 16, completeness: 16, consistency: 16, feasibility: 12 };
  assert.equal(isPass(80, scores), true);
  assert.equal(isPass(79, scores), false);
  assert.equal(isPass(80, { ...scores, feasibility: 11 }), false);
});

test("barFillClass: 16 で yes / 15・10 で partial / 9 で no", () => {
  assert.equal(barFillClass(16), "yes");
  assert.equal(barFillClass(15), "partial");
  assert.equal(barFillClass(10), "partial");
  assert.equal(barFillClass(9), "no");
});

// ── 表示変換 ─────────────────────────────────────────

test("verdictLabel: yes/partial/no → 合格/部分/不合格", () => {
  assert.equal(verdictLabel("yes"), "合格");
  assert.equal(verdictLabel("partial"), "部分");
  assert.equal(verdictLabel("no"), "不合格");
});

test("checkLabel: 末尾の C 番号を抽出 (C10 以上・drift・非標準 id に対応)", () => {
  assert.equal(checkLabel("correctness-C2"), "C2");
  assert.equal(checkLabel("feasibility-C10"), "C10");
  assert.equal(checkLabel("drift"), "drift");
  assert.equal(checkLabel("custom-id"), "custom-id");
});

test("axisOfCheck: axis field 優先、無ければ check_id 接頭から導出", () => {
  assert.equal(axisOfCheck({ axis: "consistency", check_id: "correctness-C1" }), "consistency");
  assert.equal(axisOfCheck({ check_id: "unambiguity-C3" }), "unambiguity");
  assert.equal(axisOfCheck({ check_id: "mystery-C1" }), null);
  assert.equal(axisOfCheck({ check_id: "drift" }), null);
});

test("truncate: ellipsis 込みで max 字に収める / 境界ちょうどは原文維持", () => {
  const s80 = "あ".repeat(80);
  assert.equal(truncate(s80, 80, "…"), s80);
  const s81 = "あ".repeat(81);
  const cut = truncate(s81, 80, "…");
  assert.equal(cut.length, 80);
  assert.ok(cut.endsWith("…"));
  assert.equal(truncate("えびでんす".repeat(30), 120), "えびでんす".repeat(30).slice(0, 120));
});

// ── Projection ───────────────────────────────────────

const baseAttempt = {
  attempt_count: 0,
  timestamp: "2026-07-01T10:00:00+09:00",
  total: 80,
  scores: { correctness: 20, unambiguity: 15, completeness: 15, consistency: 15, feasibility: 15 },
  check_results: [
    { check_id: "unambiguity-C1", axis: "unambiguity", verdict: "partial", awarded_points: 2 },
    { check_id: "completeness-C2", axis: "completeness", verdict: "no", awarded_points: 0 },
  ],
};

test("projections: 同一 check_id の deficiency は 1 回だけ加算", () => {
  const attempt = {
    ...baseAttempt,
    deficiencies: [
      { axis: "unambiguity", doc: "a.md", issue: "x", severity: "medium", check_id: "unambiguity-C1", tag: "AI改善可能" },
      { axis: "unambiguity", doc: "b.md", issue: "y", severity: "low", check_id: "unambiguity-C1", tag: "AI改善可能" },
    ],
  };
  const proj = projections(attempt);
  assert.equal(proj.ai, 83); // 80 + (5-2)。素朴加算だと 86 になる
  assert.equal(proj.full, 83);
});

test("projections: drift / check_id 欠落は加算対象外、未知 check_id は報告のみ", () => {
  const attempt = {
    ...baseAttempt,
    deficiencies: [
      { axis: "unambiguity", doc: "a.md", issue: "x", severity: "medium", check_id: "drift", tag: "AI改善可能" },
      { axis: "completeness", doc: "b.md", issue: "y", severity: "high", tag: "人間対応必要" },
      { axis: "completeness", doc: "c.md", issue: "z", severity: "high", check_id: "completeness-C9", tag: "人間対応必要" },
    ],
  };
  const proj = projections(attempt);
  assert.equal(proj.ai, 80);
  assert.equal(proj.full, 80);
  assert.deepEqual(proj.unknownCheckIds, ["completeness-C9"]);
});

test("projections: AI タグのみ ai に、全 deficiency が full に効く", () => {
  const attempt = {
    ...baseAttempt,
    deficiencies: [
      { axis: "unambiguity", doc: "a.md", issue: "x", severity: "medium", check_id: "unambiguity-C1", tag: "AI改善可能" },
      { axis: "completeness", doc: "b.md", issue: "y", severity: "high", check_id: "completeness-C2", tag: "人間対応必要" },
    ],
  };
  const proj = projections(attempt);
  assert.equal(proj.ai, 83); // +3 (C1)
  assert.equal(proj.full, 88); // +3 (C1) +5 (C2)
});

// ── simNote ──────────────────────────────────────────

test("simNote: 不備 0 件は isPass に応じて文言を分ける / 合格圏 / 要改善圏 + 人間対応文の有無", () => {
  const passScores = { correctness: 20, unambiguity: 20, completeness: 20, consistency: 20, feasibility: 20 };
  assert.equal(
    simNote({ total: 100, scores: passScores, deficiencies: [] }, { ai: 100 }, 0, 0),
    "不備 0 件。合格基準を満たしています。",
  );
  // 不備 0 件でも合格基準未達 (check_results 未記録の attempt 等) なら未達文言 — PASS/FAIL 表示と矛盾させない
  const failScores = { correctness: 12, unambiguity: 12, completeness: 12, consistency: 12, feasibility: 12 };
  assert.match(simNote({ total: 60, scores: failScores, deficiencies: [] }, { ai: 60 }, 0, 0), /総合 60 点は合格基準.*未達/);
  const defs = [{ tag: "AI改善可能" }];
  assert.match(simNote({ deficiencies: defs }, { ai: 84 }, 1, 0), /合格圏/);
  assert.match(simNote({ deficiencies: defs }, { ai: 79 }, 1, 0), /要改善圏/);
  assert.ok(!simNote({ deficiencies: defs }, { ai: 84 }, 1, 0).includes("人間対応"));
  assert.match(simNote({ deficiencies: defs }, { ai: 84 }, 1, 2), /人間対応 <strong>2 件<\/strong>/);
});

// ── 検算 ─────────────────────────────────────────────

function fullChecks(axisPoints) {
  // 各軸 4 check。axisPoints[axis] を C1 に、残り 3 check は 5 点で埋める。
  const checks = [];
  for (const axis of AXIS_ORDER) {
    const first = axisPoints[axis] ?? 5;
    checks.push({ check_id: `${axis}-C1`, axis, verdict: "partial", awarded_points: first });
    for (let i = 2; i <= 4; i++) checks.push({ check_id: `${axis}-C${i}`, axis, verdict: "yes", awarded_points: 5 });
  }
  return checks;
}

test("verifyAttempt: 整合データでは警告なし", () => {
  const attempt = {
    attempt_count: 0,
    timestamp: "2026-07-01",
    total: 97,
    scores: { correctness: 17, unambiguity: 20, completeness: 20, consistency: 20, feasibility: 20 },
    check_results: fullChecks({ correctness: 2 }),
    deficiencies: [{ axis: "correctness", doc: "a.md", issue: "x", severity: "medium", check_id: "correctness-C1", tag: "AI改善可能" }],
    ai_improvable_count: 1,
    human_required_count: 0,
  };
  assert.deepEqual(verifyAttempt(attempt), []);
});

test("verifyAttempt: 軸・total・counts の不一致をそれぞれ警告する", () => {
  const attempt = {
    attempt_count: 2,
    timestamp: "2026-07-01",
    total: 99, // scores 合計は 97
    scores: { correctness: 20, unambiguity: 20, completeness: 20, consistency: 20, feasibility: 17 }, // correctness 再計算は 17
    check_results: fullChecks({ correctness: 2 }),
    deficiencies: [],
    ai_improvable_count: 3,
    human_required_count: 1,
  };
  const warnings = verifyAttempt(attempt);
  assert.equal(warnings.length, 5, warnings.join("\n"));
  assert.match(warnings[0], /scores\.correctness 保存値 20 ≠ check_results 再計算 17/);
  assert.match(warnings[1], /scores\.feasibility 保存値 17 ≠ check_results 再計算 20/);
  assert.match(warnings[2], /total 保存値 99 ≠ scores 合計 97/);
  assert.match(warnings[3], /ai_improvable_count 保存値 3 ≠ deficiencies 再計算 0/);
  assert.match(warnings[4], /human_required_count 保存値 1 ≠ deficiencies 再計算 0/);
});

test("verifyAttempt: check 数が 4 件でない軸は軸検算を skip しつつ警告する (無警告で素通りさせない)", () => {
  const attempt = {
    attempt_count: 0,
    timestamp: "2026-07-01",
    total: 100,
    scores: { correctness: 20, unambiguity: 20, completeness: 20, consistency: 20, feasibility: 20 },
    check_results: [{ check_id: "correctness-C1", axis: "correctness", verdict: "no", awarded_points: 0 }],
  };
  const warnings = verifyAttempt(attempt);
  assert.equal(warnings.length, 5, warnings.join("\n")); // correctness=1 件 + 残り 4 軸 =0 件
  assert.match(warnings[0], /correctness の check 数が 4 件ではありません \(1 件\)/);
  assert.match(warnings[1], /unambiguity の check 数が 4 件ではありません \(0 件\)/);
});

test("verifyAttempt: check_results が未記録の attempt は check 数警告を出さない (schema 上 optional)", () => {
  const attempt = {
    attempt_count: 0,
    timestamp: "2026-07-01",
    total: 60,
    scores: { correctness: 12, unambiguity: 12, completeness: 12, consistency: 12, feasibility: 12 },
  };
  assert.deepEqual(verifyAttempt(attempt), []);
});

test("verifyAttempt: 警告の attempt 表記は 1 始まり (第N回) + attempt_count 併記", () => {
  const attempt = {
    attempt_count: 2,
    timestamp: "2026-07-03",
    total: 90, // scores 合計 80 と不一致
    scores: { correctness: 16, unambiguity: 16, completeness: 16, consistency: 16, feasibility: 16 },
  };
  const warnings = verifyAttempt(attempt);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^第3回 \(attempt_count=2\): total 保存値 90/);
});

test("renderHistory: 非標準 check_id のヒートマップ行ラベルも esc される", () => {
  const history = minimalHistory(1);
  history.attempts[0].check_results.push({
    check_id: "correctness-<script>",
    axis: "correctness",
    verdict: "no",
    awarded_points: 0,
    evidence: "非標準 id",
  });
  const html = renderHistory(history, historyTpl);
  assert.ok(html.includes("正確性 · correctness-&lt;script&gt;"), "fallback ラベルが esc されていない");
  assert.ok(!html.includes("正確性 · correctness-<script>"));
});

// ── 並び順・改善セル ─────────────────────────────────

test("sortBySeverity: high → medium → low、同 severity 内は入力順を保持", () => {
  const defs = [
    { severity: "low", issue: "l1" },
    { severity: "high", issue: "h1" },
    { severity: "medium", issue: "m1" },
    { severity: "high", issue: "h2" },
  ];
  assert.deepEqual(
    sortBySeverity(defs).map((d) => d.issue),
    ["h1", "h2", "m1", "l1"],
  );
});

test("heatRowKeys: 軸順 → C 番号順の和集合、軸不明 (drift 等) は末尾", () => {
  const attempts = [
    {
      check_results: [
        { check_id: "feasibility-C1", axis: "feasibility" },
        { check_id: "correctness-C2", axis: "correctness" },
      ],
    },
    {
      check_results: [
        { check_id: "correctness-C1", axis: "correctness" },
        { check_id: "drift" },
      ],
    },
  ];
  assert.deepEqual(
    heatRowKeys(attempts).map((r) => r.checkId),
    ["correctness-C1", "correctness-C2", "feasibility-C1", "drift"],
  );
});

test("improvedSet: 直前 attempt から awarded が増えた check のみ / 初回は空", () => {
  const attempts = [
    { check_results: [{ check_id: "a-C1", awarded_points: 0 }, { check_id: "a-C2", awarded_points: 5 }] },
    { check_results: [{ check_id: "a-C1", awarded_points: 2 }, { check_id: "a-C2", awarded_points: 2 }, { check_id: "a-C3", awarded_points: 5 }] },
  ];
  assert.deepEqual(improvedSet(attempts, 0), new Set());
  assert.deepEqual(improvedSet(attempts, 1), new Set(["a-C1"])); // C2 は低下、C3 は前回に無い
});

// ── レンダリング (テンプレート統合の最小確認) ──────────

const dashboardTpl = readFileSync(join(REPO_ROOT, "skills/04-scoring/templates/scoring-dashboard.html.template"), "utf8");
const historyTpl = readFileSync(join(REPO_ROOT, "skills/04-scoring/templates/scoring-history.html.template"), "utf8");

function minimalHistory(attemptCount) {
  const attempts = [];
  for (let i = 0; i < attemptCount; i++) {
    attempts.push({
      attempt_count: i,
      timestamp: `2026-07-0${i + 1}T10:00:00+09:00`,
      total: 70 + i * 10,
      scores: { correctness: 14 + i, unambiguity: 14 + i, completeness: 14 + i, consistency: 14 + i, feasibility: 14 + i * 3 },
      check_results: fullChecks({}),
      deficiencies: [],
    });
  }
  return { app_name: "unit-app", attempts };
}

test("renderDashboard: プレースホルダが残らず、判定・日付が入力由来", () => {
  const html = renderDashboard(minimalHistory(1), dashboardTpl);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), "未置換プレースホルダが残っている");
  assert.match(html, /<title>unit-app 採点ダッシュボード · 第1回<\/title>/);
  assert.match(html, /2026-07-01/); // GENERATED_AT は timestamp 日付部
  assert.match(html, /pill fail/); // total 70 → 要改善
});

test("renderHistory: 3 attempt 以下は列上書きなし / 4 attempt で <style> 注入", () => {
  const h3 = renderHistory(minimalHistory(2), historyTpl);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(h3));
  assert.ok(!h3.includes("grid-template-columns: repeat(4"), "3 スロット時に上書き不要");
  assert.match(h3, /<!-- attempts:start -->/); // マーカーは保持

  const h4 = renderHistory(minimalHistory(4), historyTpl);
  assert.match(h4, /body\.history \.attempts \{ grid-template-columns: repeat\(4, 1fr\); \}/);
  assert.match(h4, /180px repeat\(4, 1fr\)/);
  assert.match(h4, /220px repeat\(4, 1fr\)/);
  assert.match(h4, /第4回/);
});

// ── 実 artifact スモーク (存在する環境のみ) ────────────

test("実 artifact スモーク: 各 scoring-history.json を tmpdir で描画できる", (t) => {
  const artifactsDir = join(REPO_ROOT, "artifacts");
  if (!existsSync(artifactsDir)) {
    t.skip("artifacts/ が無い環境 (fresh clone / worktree) では skip");
    return;
  }
  const apps = readdirSync(artifactsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(artifactsDir, d.name, "scoring-history.json")))
    .map((d) => d.name);
  if (apps.length === 0) {
    t.skip("scoring-history.json を持つプロジェクトが無い");
    return;
  }

  for (const app of apps) {
    const tmp = mkdtempSync(join(tmpdir(), `render-scoring-${app}-`));
    try {
      cpSync(join(artifactsDir, app, "scoring-history.json"), join(tmp, "scoring-history.json"));
      const res = spawnSync(process.execPath, [SCRIPT, join(tmp, "scoring-history.json")], { encoding: "utf8" });
      assert.equal(res.status, 0, `${app}: exit ${res.status}. stderr:\n${res.stderr}`);
      for (const f of ["scoring-dashboard.html", "scoring-history.html", "scoring.css"]) {
        assert.ok(existsSync(join(tmp, f)), `${app}: ${f} が生成されていない`);
      }
      const dash = readFileSync(join(tmp, "scoring-dashboard.html"), "utf8");
      assert.ok(!/\{\{[A-Z_]+\}\}/.test(dash), `${app}: 未置換プレースホルダ`);

      // kinto-jp の既知値 (データが変わっていない場合のみ検証)
      const history = JSON.parse(readFileSync(join(tmp, "scoring-history.json"), "utf8"));
      if (app === "kinto-jp" && history.attempts.length === 1 && history.attempts[0].total === 82) {
        assert.match(dash, /sim-val">94</); // AI 改善後
        assert.match(dash, /sim-val">100</); // 全解消後
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
});
