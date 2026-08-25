#!/usr/bin/env node
// skills/11-wcag-mapping/evals/glue/grade-glue.mjs
//
// skill 整形ロジック eval (glue) の **プログラム採点器**。skill 11 を実行させた後に生成された
//   wcag-history.json (+ wcag-mapping.json) を読み、cases.json の
//   "checkable":"script" な assertion を機械判定する。
//   "checkable":"judgment" な assertion (suggested_correction の質 / mapping 不変等) は
//   人間 / LLM レビューに委ねる (本器は触らない)。
//
// これは「グレーダーを毎回手で書き直す」無駄を省くための再利用可能スクリプト
//   (skill-creator の grader.md 思想を repo-native に最小実装したもの)。
//
// 使い方:
//   node grade-glue.mjs --case dual-mode-first-write \
//        --history <artifacts>/glue-demo/wcag-history.json \
//        --mapping <artifacts>/glue-demo/wcag-mapping.json \
//        --brief   <fixture>/.../design-brief.yaml   # hex 無改変チェック用 (任意)
//
// 出力: grading.json 互換の { expectations:[{text,passed,evidence}], summary }。
// 依存: なし (Node 標準のみ)。

import { readFileSync, existsSync } from "node:fs";

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const caseName = arg("case");
const historyPath = arg("history");
const mappingPath = arg("mapping");
const briefPath = arg("brief"); // optional

const results = [];
const check = (id, text, fn) => {
  try {
    const { passed, evidence } = fn();
    results.push({ id, text, passed, evidence });
  } catch (e) {
    results.push({ id, text, passed: false, evidence: `採点中に例外: ${e.message}` });
  }
};

const history = historyPath && existsSync(historyPath)
  ? JSON.parse(readFileSync(historyPath, "utf8")) : null;
const mapping = mappingPath && existsSync(mappingPath)
  ? JSON.parse(readFileSync(mappingPath, "utf8")) : null;

// design-brief から原文 hex 集合を粗く抽出 (YAML を厳密 parse せず hex 値だけ拾う)
let briefHexSet = null;
if (briefPath && existsSync(briefPath)) {
  const txt = readFileSync(briefPath, "utf8");
  briefHexSet = new Set((txt.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase()));
}

const lastAttempt = history?.attempts?.[history.attempts.length - 1] ?? null;
const violations = lastAttempt?.violations ?? [];

// ── 機械判定可能な assertion 群 ──────────────────────────

check("history-exists", "wcag-history.json が存在し attempts を持つ", () => {
  const passed = !!history && Array.isArray(history.attempts) && history.attempts.length >= 1;
  return { passed, evidence: history ? `attempts.length=${history.attempts.length}` : "history null" };
});

check("mapping-firstwrite", "wcag-mapping.json が constraints と criteria を持つ", () => {
  const passed = !!mapping && !!mapping.constraints && Array.isArray(mapping.criteria) && mapping.criteria.length > 0;
  return { passed, evidence: mapping ? `criteria=${mapping.criteria?.length ?? 0}` : "mapping null" };
});

check("violation-fields-complete", "各 violation が schema 必須 field を全て持つ", () => {
  const req = ["candidate_id", "criterion_id", "pair", "actual_ratio", "required_ratio"];
  const bad = violations.filter((v) => req.some((k) => v[k] === undefined));
  return { passed: bad.length === 0, evidence: bad.length ? `欠落 ${bad.length} 件: ${JSON.stringify(bad[0])}` : `${violations.length} 件全て充足` };
});

check("pair-kind-present", "各 violation の pair_kind が enum 内", () => {
  const ok = new Set(["palette", "state_colors", "domain_surface", "schema_violation"]);
  const bad = violations.filter((v) => !ok.has(v.pair_kind));
  return { passed: bad.length === 0, evidence: bad.length ? `不正 pair_kind: ${bad.map((v) => v.pair_kind)}` : "全て enum 内" };
});

check("actual-ratio-min1", "全 violation の actual_ratio >= 1 (null→1 正規化)", () => {
  const bad = violations.filter((v) => typeof v.actual_ratio !== "number" || v.actual_ratio < 1);
  return { passed: bad.length === 0, evidence: bad.length ? `<1 or 非数値: ${bad.length} 件` : "全て >=1" };
});

check("hex-not-mutated", "violation の fg_hex/bg_hex が design-brief 原文 hex と一致", () => {
  if (!briefHexSet) return { passed: false, evidence: "--brief 未指定 (このチェックは brief が必要)" };
  const hexes = violations.flatMap((v) => [v.fg_hex, v.bg_hex]).filter(Boolean).map((h) => String(h).toUpperCase());
  const orphan = hexes.filter((h) => !briefHexSet.has(h));
  return { passed: orphan.length === 0, evidence: orphan.length ? `brief に無い hex: ${[...new Set(orphan)]}` : `${hexes.length} 件全て brief 由来` };
});

// case 別の固有チェック
if (caseName === "dual-mode-first-write") {
  check("mode-present-in-dual", "dual-mode なので各 violation に mode が埋まっている", () => {
    const bad = violations.filter((v) => v.mode !== "dark" && v.mode !== "light");
    return { passed: bad.length === 0, evidence: bad.length ? `mode 欠落 ${bad.length} 件` : "全て mode 充填" };
  });
  check("dark-primary-violation", "dark の primary(#2A4A55) vs surface(#141414) 違反が記録", () => {
    const hit = violations.find((v) =>
      v.mode === "dark" &&
      String(v.fg_hex).toUpperCase() === "#2A4A55" &&
      String(v.bg_hex).toUpperCase() === "#141414");
    return { passed: !!hit, evidence: hit ? `actual_ratio=${hit.actual_ratio}` : "該当 violation 無し" };
  });
}

// ── 集計出力 (grading.json 互換) ─────────────────────────
const passed = results.filter((r) => r.passed).length;
const out = {
  case: caseName,
  expectations: results.map(({ text, passed, evidence }) => ({ text, passed, evidence })),
  summary: { passed, failed: results.length - passed, total: results.length, pass_rate: results.length ? +(passed / results.length).toFixed(2) : 0 },
  note: "checkable=judgment な assertion (suggested_correction の質 / mapping 不変等) は本器の対象外。人間 / LLM が cases.json を見て別途判定する。",
};
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exitCode = out.summary.failed === 0 ? 0 : 1;
