#!/usr/bin/env node
// scripts/render-scoring-report.mjs
//
// Phase 1b (Step 04) 採点レポートの決定論 renderer:
//   scoring-history.json → scoring-dashboard.html / scoring-history.html を全量再生成し、
//   skills/04-scoring/templates/scoring.css を同ディレクトリへ複写する。
// プレースホルダの手置換やマーカー間 Edit 挿入を挟まず、同一入力 → byte 同一出力を保証する
// (requirement-deviations-view / color-lint-report と同じ「派生 HTML は決定論生成」方針)。
// HTML 骨格は skills/04-scoring/templates/*.template が単一の視覚 SoT であり、本 script は
// それを実行時に Read して {{...}} を埋めるだけ。テンプレート自体は改変しない。
//
// 出力を入力の純関数に保つための確定仕様 (skill 手順の文面と挙動が異なる点):
//   - {{GENERATED_AT}} は実行日ではなく attempts[-1].timestamp の日付部を使う
//   - verdict セルの .lbl は verdict 語 (合格 / 部分 / 不合格)。ルーブリック設問からの
//     名詞句抽出は決定論化できないため行わない (rubric.json は入力に取らない)
//   - deficiency 行の col-check は check_id 末尾の "C{数字}" を正規表現で抽出 (C10 以上対応)
//   - Projection は同一 check_id を参照する deficiency を 1 回だけ加算する (重複加算防止)
//   - 履歴の軸セル色は dashboard の bar-fill と同じ閾値 (>=16 / >=10) で決める
//   - attempts が 4 件以上のときは列数上書きの <style> を </head> 直前に注入する
// 検算: scores / total / ai_improvable_count / human_required_count を check_results /
//   deficiencies から再計算し、保存値と食い違えば stderr へ警告する。描画は常に保存値
//   (scoring-history.json が SoT。loop 判定が読む値と HTML を乖離させない)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/render-scoring-report.mjs artifacts/{app_name}/scoring-history.json
// 出力:   入力と同じディレクトリへ scoring-dashboard.html / scoring-history.html / scoring.css
// exit:   0 = 成功 (検算警告のみでも 0) / 1 = 引数なし・読込/解析失敗・attempts が空

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// ── 定数 ─────────────────────────────────────────────

export const AXIS_ORDER = ["correctness", "unambiguity", "completeness", "consistency", "feasibility"];
export const AXIS_JP = {
  correctness: "正確性",
  unambiguity: "明確性",
  completeness: "完全性",
  consistency: "一貫性",
  feasibility: "実現可能性",
};
// 閾値は pipeline.yaml requirements.loop と同値のローカル定数 (総合 80 は pass_condition 文字列内、
// per_axis_min は field)。変更時は pipeline.yaml / scoring.css と併せて更新する。
export const TOTAL_MIN = 80;
export const PER_AXIS_MIN = 12;
export const MAX_POINTS = 5;
const DEFAULT_SLOT_COUNT = 3;

const TEMPLATES_DIR = new URL("../skills/04-scoring/templates/", import.meta.url);

// ── 純関数 (unit test 対象) ──────────────────────────

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 合計スコアの verdict クラス (hero の scale-fill 用)。 */
export function scoreLevel(total) {
  if (total >= TOTAL_MIN) return "yes";
  if (total >= 50) return "partial";
  return "no";
}

/** 合格判定: 総合が TOTAL_MIN 以上かつ全軸が PER_AXIS_MIN 以上。 */
export function isPass(total, scores) {
  if (total < TOTAL_MIN) return false;
  return AXIS_ORDER.every((axis) => (scores?.[axis] ?? 0) >= PER_AXIS_MIN);
}

/** 軸バー / 履歴軸セルの三段階クラス (余裕あり / 近接 / 危機)。 */
export function barFillClass(axisScore) {
  if (axisScore >= 16) return "yes";
  if (axisScore >= 10) return "partial";
  return "no";
}

/** verdict → セル表示語。 */
export function verdictLabel(verdict) {
  return { yes: "合格", partial: "部分", no: "不合格" }[verdict] ?? String(verdict ?? "");
}

/** check_id → 不備表のチェック列表示 ("correctness-C2" → "C2" / "drift" はそのまま)。 */
export function checkLabel(checkId) {
  if (checkId === "drift") return "drift";
  const m = /-(C\d+)$/.exec(checkId ?? "");
  return m ? m[1] : String(checkId ?? "");
}

/** check の軸を解決する (axis field 優先、無ければ check_id の接頭 "correctness-C1" 形式から導出)。 */
export function axisOfCheck(check) {
  if (check?.axis) return check.axis;
  const m = /^([a-z]+)-C\d+$/.exec(check?.check_id ?? "");
  return m && AXIS_ORDER.includes(m[1]) ? m[1] : null;
}

/** 表示用切り詰め。ellipsis 指定時は結果全体が max 字以内に収まる。 */
export function truncate(s, max, ellipsis = "") {
  const str = String(s ?? "");
  if (str.length <= max) return str;
  return ellipsis ? str.slice(0, max - ellipsis.length) + ellipsis : str.slice(0, max);
}

/**
 * 改善シミュレーションの予測値。
 * 同一 check_id を参照する複数 deficiency は 1 回だけ加算する。check_id が "drift" /
 * 欠落 / check_results に存在しないものは加算対象外 (unknownCheckIds として報告のみ)。
 */
export function projections(attempt) {
  const total = attempt.total ?? 0;
  const byCheck = new Map();
  for (const c of attempt.check_results ?? []) byCheck.set(c.check_id, c.awarded_points ?? 0);

  const aiChecks = new Set();
  const allChecks = new Set();
  const unknownCheckIds = [];
  for (const d of attempt.deficiencies ?? []) {
    const id = d.check_id;
    if (!id || id === "drift") continue;
    if (!byCheck.has(id)) {
      unknownCheckIds.push(id);
      continue;
    }
    allChecks.add(id);
    if (d.tag === "AI改善可能") aiChecks.add(id);
  }
  const gap = (ids) => [...ids].reduce((sum, id) => sum + (MAX_POINTS - byCheck.get(id)), 0);
  return { ai: total + gap(aiChecks), full: total + gap(allChecks), unknownCheckIds };
}

/** Projection カード下の一文解説 (決定論の分岐)。 */
export function simNote(attempt, proj, aiCount, humanCount) {
  const defs = attempt.deficiencies ?? [];
  if (defs.length === 0) {
    // 不備 0 件でも合格とは限らない (check_results 未記録の attempt 等)。PASS/FAIL 表示と矛盾させない。
    return isPass(attempt.total ?? 0, attempt.scores)
      ? "不備 0 件。合格基準を満たしています。"
      : `不備は記録されていませんが、総合 ${attempt.total ?? 0} 点は合格基準 (総合 ${TOTAL_MIN} 点かつ全軸 ${PER_AXIS_MIN} 点以上) に未達です。`;
  }
  const zone = proj.ai >= TOTAL_MIN ? "合格圏" : "要改善圏";
  let note = `AI 改善 <strong>${aiCount} 件解消で ${proj.ai} 点</strong>（${zone}）到達見込み。`;
  if (humanCount > 0) note += `人間対応 <strong>${humanCount} 件</strong>はステークホルダー確認が必要。`;
  return note;
}

/** deficiencies から tag 別件数を導出する。 */
export function tagCounts(attempt) {
  const defs = attempt.deficiencies ?? [];
  return {
    ai: defs.filter((d) => d.tag === "AI改善可能").length,
    human: defs.filter((d) => d.tag === "人間対応必要").length,
  };
}

/**
 * 検算: 保存値と再計算値の食い違いを警告文字列の配列で返す (描画には影響しない)。
 * - 軸スコア: その軸の check が 4 件そろっている場合のみ awarded 合計と突合
 * - total: 保存 scores の合計と突合
 * - counts: 保存値が存在する場合のみ deficiencies 由来の件数と突合
 */
export function verifyAttempt(attempt) {
  const warnings = [];
  // 表示は HTML / stdout と同じ 1 始まり (第N回)。JSON field の生値も併記して特定を誤らせない。
  const raw = attempt.attempt_count;
  const n = Number.isInteger(raw) ? `第${raw + 1}回 (attempt_count=${raw})` : `attempt_count=${raw ?? "?"}`;
  const checks = attempt.check_results ?? [];

  const byAxis = new Map(AXIS_ORDER.map((a) => [a, []]));
  for (const c of checks) {
    const axis = axisOfCheck(c);
    if (axis) byAxis.get(axis).push(c);
  }
  for (const axis of AXIS_ORDER) {
    const list = byAxis.get(axis);
    if (list.length !== 4) {
      // check が 1 件も記録されていない attempt (schema 上 optional) は対象外。
      // 記録があるのに 4 件でない軸は check 数ドリフトの徴候なので、検算 skip を沈黙させない。
      if (checks.length > 0) {
        warnings.push(`${n}: ${axis} の check 数が 4 件ではありません (${list.length} 件) — 軸検算を skip`);
      }
      continue;
    }
    const recomputed = list.reduce((sum, c) => sum + (c.awarded_points ?? 0), 0);
    const stored = attempt.scores?.[axis];
    if (stored !== undefined && stored !== recomputed) {
      warnings.push(`${n}: scores.${axis} 保存値 ${stored} ≠ check_results 再計算 ${recomputed}`);
    }
  }

  if (attempt.scores) {
    const sum = AXIS_ORDER.reduce((acc, a) => acc + (attempt.scores[a] ?? 0), 0);
    if (attempt.total !== undefined && attempt.total !== sum) {
      warnings.push(`${n}: total 保存値 ${attempt.total} ≠ scores 合計 ${sum}`);
    }
  }

  const counts = tagCounts(attempt);
  if (attempt.ai_improvable_count !== undefined && attempt.ai_improvable_count !== counts.ai) {
    warnings.push(`${n}: ai_improvable_count 保存値 ${attempt.ai_improvable_count} ≠ deficiencies 再計算 ${counts.ai}`);
  }
  if (attempt.human_required_count !== undefined && attempt.human_required_count !== counts.human) {
    warnings.push(`${n}: human_required_count 保存値 ${attempt.human_required_count} ≠ deficiencies 再計算 ${counts.human}`);
  }

  const proj = projections(attempt);
  for (const id of proj.unknownCheckIds) {
    warnings.push(`${n}: deficiency の check_id "${id}" が check_results に存在しない (Projection から除外)`);
  }
  return warnings;
}

/** severity 順 (high → medium → low)。同 severity 内は入力順を保つ。 */
export function sortBySeverity(deficiencies) {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...deficiencies].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

/**
 * 履歴ヒートマップの行キー集合: 全 attempt の check_id の和集合を
 * 軸順 → C 番号順に並べる (軸不明の check は末尾に check_id 辞書順)。
 */
export function heatRowKeys(attempts) {
  const seen = new Map();
  for (const a of attempts) {
    for (const c of a.check_results ?? []) {
      if (!seen.has(c.check_id)) seen.set(c.check_id, axisOfCheck(c));
    }
  }
  const cnum = (id) => {
    const m = /-C(\d+)$/.exec(id);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const keys = [...seen.keys()];
  keys.sort((x, y) => {
    const ax = seen.get(x) ? AXIS_ORDER.indexOf(seen.get(x)) : AXIS_ORDER.length;
    const ay = seen.get(y) ? AXIS_ORDER.indexOf(seen.get(y)) : AXIS_ORDER.length;
    if (ax !== ay) return ax - ay;
    if (cnum(x) !== cnum(y)) return cnum(x) - cnum(y);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return keys.map((id) => ({ checkId: id, axis: seen.get(id) }));
}

/** attempts[i] で直前 attempt より awarded_points が上がった check_id の集合。 */
export function improvedSet(attempts, i) {
  const improved = new Set();
  if (i <= 0) return improved;
  const prev = new Map((attempts[i - 1].check_results ?? []).map((c) => [c.check_id, c.awarded_points ?? 0]));
  for (const c of attempts[i].check_results ?? []) {
    if (prev.has(c.check_id) && (c.awarded_points ?? 0) > prev.get(c.check_id)) improved.add(c.check_id);
  }
  return improved;
}

// ── HTML 組み立て ────────────────────────────────────

const dateOf = (attempt) => String(attempt.timestamp ?? "").slice(0, 10);

function fillTemplate(tpl, replacements) {
  let out = tpl;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${key}}}`, String(value));
  }
  return out;
}

function axisBarRows(attempt) {
  return AXIS_ORDER.map((axis) => {
    const score = attempt.scores?.[axis] ?? 0;
    const width = score * 5; // = score / 20 * 100。整数演算にして浮動小数の表現揺れ (55.00000000000001% 等) を避ける
    return [
      '<div class="axis-row">',
      `  <div class="axis-label">${AXIS_JP[axis]}</div>`,
      '  <div class="bar-track">',
      `    <div class="bar-fill ${barFillClass(score)}" style="width:${width}%"><span class="bar-value">${score}</span></div>`,
      '    <div class="pass-line"></div>',
      "  </div>",
      `  <div class="axis-score">${score}/20</div>`,
      "</div>",
    ].join("\n");
  }).join("\n");
}

function checkGridRows(attempt) {
  const byAxis = new Map(AXIS_ORDER.map((a) => [a, []]));
  for (const c of attempt.check_results ?? []) {
    const axis = axisOfCheck(c);
    if (axis) byAxis.get(axis).push(c);
  }
  const cnum = (id) => {
    const m = /-C(\d+)$/.exec(id ?? "");
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return AXIS_ORDER.map((axis) => {
    const score = attempt.scores?.[axis] ?? 0;
    const checks = byAxis.get(axis).sort((a, b) => cnum(a.check_id) - cnum(b.check_id)).slice(0, 4);
    const cells = checks.map(
      (c) =>
        `  <td class="verdict-cell vc-${c.verdict}"><span class="pts">${c.awarded_points ?? 0}</span><span class="lbl">${verdictLabel(c.verdict)}</span></td>`,
    );
    while (cells.length < 4) cells.push('  <td class="verdict-cell"><span class="pts">—</span><span class="lbl">—</span></td>');
    return ["<tr>", `  <td class="verdict-row-label">${AXIS_JP[axis]}</td>`, `  <td class="verdict-row-score">${score}/20</td>`, ...cells, "</tr>"].join("\n");
  }).join("\n");
}

function deficiencyTableRows(attempt) {
  const sevLabel = { high: "High", medium: "Medium", low: "Low" };
  return sortBySeverity(attempt.deficiencies ?? [])
    .map((d) =>
      [
        "<tr>",
        "  <td>",
        `    <span class="sev-dot sev-${d.severity}"></span>`,
        `    <span class="sev-label ${d.severity}">${sevLabel[d.severity] ?? d.severity}</span>`,
        "  </td>",
        `  <td>${AXIS_JP[d.axis] ?? esc(d.axis)}</td>`,
        `  <td class="col-check">${esc(checkLabel(d.check_id))}</td>`,
        `  <td class="col-doc">${esc(d.doc)}</td>`,
        `  <td>${esc(truncate(d.issue, 80, "…"))}</td>`,
        `  <td><span class="tag ${d.tag === "人間対応必要" ? "tag-human" : "tag-ai"}">${esc(d.tag)}</span></td>`,
        "</tr>",
      ].join("\n"),
    )
    .join("\n");
}

/** dashboard HTML (最新 attempt の単回レポート)。 */
export function renderDashboard(history, tpl) {
  const attempts = history.attempts ?? [];
  const attempt = attempts[attempts.length - 1];
  const counts = tagCounts(attempt);
  const aiCount = attempt.ai_improvable_count ?? counts.ai;
  const humanCount = attempt.human_required_count ?? counts.human;
  const proj = projections(attempt);
  const total = attempt.total ?? 0;
  const passBadge = isPass(total, attempt.scores)
    ? '<span class="pill pass">合格</span>'
    : '<span class="pill fail">要改善</span>';

  return fillTemplate(tpl, {
    APP_NAME: esc(history.app_name),
    GENERATED_AT: dateOf(attempt),
    ATTEMPT: (attempt.attempt_count ?? attempts.length - 1) + 1,
    CHECK_COUNT: (attempt.check_results ?? []).length,
    TOTAL: total,
    SCORE_LEVEL: scoreLevel(total),
    PASS_FAIL_BADGE: passBadge,
    AXIS_BAR_ROWS: axisBarRows(attempt),
    CHECK_GRID_ROWS: checkGridRows(attempt),
    DEFICIENCY_COUNT: (attempt.deficiencies ?? []).length,
    DEFICIENCY_ROWS: deficiencyTableRows(attempt),
    AI_IMPROVABLE_COUNT: aiCount,
    HUMAN_REQUIRED_COUNT: humanCount,
    PROJECTED_AI_ONLY: proj.ai,
    PROJECTED_FULL: proj.full,
    SIM_NOTE: simNote(attempt, proj, aiCount, humanCount),
  });
}

function attemptCards(attempts, slotCount) {
  const cards = [];
  for (let i = 0; i < slotCount; i++) {
    if (i < attempts.length) {
      const a = attempts[i];
      const passLabel = isPass(a.total ?? 0, a.scores) ? "合格" : "要改善";
      let delta;
      if (i === 0) {
        delta = `初回 · ${passLabel}`;
      } else {
        const diff = (a.total ?? 0) - (attempts[i - 1].total ?? 0);
        const span =
          diff > 0
            ? `<span class="delta-up">+${diff}</span>`
            : diff < 0
              ? `<span class="delta-down">${diff}</span>`
              : "±0";
        delta = `${span} · ${passLabel}`;
      }
      cards.push(
        [
          '      <div class="attempt-card">',
          `        <div class="a-n">ATTEMPT #${i + 1} · ${dateOf(a)}</div>`,
          `        <div class="a-v">${a.total ?? 0}</div>`,
          `        <div class="a-delta">${delta}</div>`,
          "      </div>",
        ].join("\n"),
      );
    } else {
      cards.push(
        [
          '      <div class="attempt-card empty">',
          `        <div class="a-n">ATTEMPT #${i + 1}</div>`,
          '        <div class="a-v">—</div>',
          '        <div class="a-delta">未実施</div>',
          "      </div>",
        ].join("\n"),
      );
    }
  }
  return cards.join("\n");
}

function gridHeads(slotCount) {
  const heads = [];
  for (let i = 0; i < slotCount; i++) heads.push(`      <div class="grid-h">第${i + 1}回</div>`);
  return heads.join("\n");
}

function axisGridRows(attempts, slotCount) {
  return AXIS_ORDER.map((axis) => {
    const cells = [`      <div class="grid-label axis">${AXIS_JP[axis]}</div>`];
    for (let i = 0; i < slotCount; i++) {
      if (i < attempts.length) {
        const score = attempts[i].scores?.[axis] ?? 0;
        cells.push(`      <div class="cell-num ${barFillClass(score)}">${score}</div>`);
      } else {
        cells.push('      <div class="cell-num empty">—</div>');
      }
    }
    return cells.join("\n");
  }).join("\n\n");
}

function heatGridRows(attempts, slotCount) {
  const rows = heatRowKeys(attempts);
  const improvedByAttempt = attempts.map((_, i) => improvedSet(attempts, i));
  const byAttempt = attempts.map((a) => new Map((a.check_results ?? []).map((c) => [c.check_id, c])));

  return rows
    .map(({ checkId, axis }) => {
      const label =
        checkId === "drift"
          ? "drift"
          : axis
            ? `${AXIS_JP[axis]} · ${esc(checkLabel(checkId))}`
            : esc(checkId);
      const cells = [`      <div class="grid-label check">${label}</div>`];
      for (let i = 0; i < slotCount; i++) {
        const c = i < attempts.length ? byAttempt[i].get(checkId) : undefined;
        if (c) {
          const improved = improvedByAttempt[i].has(checkId) ? " improved" : "";
          const title = `${c.verdict} (${c.awarded_points ?? 0}/${MAX_POINTS}) — ${truncate(c.evidence, 120)}`;
          cells.push(`      <div class="cell-num ${c.verdict}${improved}" title="${esc(title)}">${c.awarded_points ?? 0}</div>`);
        } else {
          cells.push('      <div class="cell-num empty">—</div>');
        }
      }
      return cells.join("\n");
    })
    .join("\n\n");
}

function deficiencyTrendRows(attempts, slotCount) {
  const rows = [];
  for (let i = 0; i < slotCount; i++) {
    if (i < attempts.length) {
      const a = attempts[i];
      const defs = a.deficiencies ?? [];
      const count = (sev) => defs.filter((d) => d.severity === sev).length;
      const high = count("high");
      const medium = count("medium");
      const low = count("low");
      const width = (n) => (defs.length === 0 ? 0 : Math.round((n / defs.length) * 100));
      rows.push(
        [
          `      <div class="a-n">第${i + 1}回 (${dateOf(a)})</div>`,
          '      <div class="stack">',
          `        <div class="stack-high" style="width:${width(high)}%"></div>`,
          `        <div class="stack-medium" style="width:${width(medium)}%"></div>`,
          `        <div class="stack-low" style="width:${width(low)}%"></div>`,
          "      </div>",
          `      <div class="def-count">High: ${high} · Medium: ${medium} · Low: ${low}</div>`,
        ].join("\n"),
      );
    } else {
      rows.push(
        [
          `      <div class="a-n">第${i + 1}回</div>`,
          '      <div class="stack"><div style="width:100%;background:var(--surface-2)"></div></div>',
          '      <div class="def-count">— 未実施 —</div>',
        ].join("\n"),
      );
    }
  }
  return rows.join("\n\n");
}

/** history HTML (全 attempt の推移。テンプレートのマーカーコメントは出力にも保持される)。 */
export function renderHistory(history, tpl) {
  const attempts = history.attempts ?? [];
  const latest = attempts[attempts.length - 1];
  const slotCount = Math.max(DEFAULT_SLOT_COUNT, attempts.length);

  let html = fillTemplate(tpl, {
    APP_NAME: esc(history.app_name),
    GENERATED_AT: dateOf(latest),
    ATTEMPT_CURRENT: (latest.attempt_count ?? attempts.length - 1) + 1,
    TOTAL_CURRENT: latest.total ?? 0,
    SLOT_COUNT: slotCount,
    ATTEMPT_CARDS: attemptCards(attempts, slotCount),
    AXIS_HEADS: gridHeads(slotCount),
    AXIS_ROWS: axisGridRows(attempts, slotCount),
    HEAT_HEADS: gridHeads(slotCount),
    HEAT_ROWS: heatGridRows(attempts, slotCount),
    DEFICIENCY_ROWS: deficiencyTrendRows(attempts, slotCount),
  });

  if (slotCount > DEFAULT_SLOT_COUNT) {
    // scoring.css は 3 スロット前提の repeat(3, ...) 固定のため、超過時のみ列数を上書きする。
    const override = [
      "<style>",
      `  body.history .attempts { grid-template-columns: repeat(${slotCount}, 1fr); }`,
      `  body.history .axis-grid { grid-template-columns: 180px repeat(${slotCount}, 1fr); }`,
      `  body.history .heatmap { grid-template-columns: 220px repeat(${slotCount}, 1fr); }`,
      "</style>",
      "</head>",
    ].join("\n");
    html = html.replace("</head>", override);
  }
  return html;
}

// ── CLI ──────────────────────────────────────────────

export function main(argv) {
  const jsonPath = argv[0];
  if (!jsonPath) {
    console.error("usage: node scripts/render-scoring-report.mjs artifacts/{app_name}/scoring-history.json");
    return 1;
  }

  let history;
  try {
    history = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    console.error(`[render-scoring-report] cannot read/parse ${jsonPath}: ${e.message}`);
    return 1;
  }

  const attempts = history.attempts ?? [];
  if (attempts.length === 0) {
    console.error(`[render-scoring-report] ${jsonPath}: attempts が空のため描画対象がありません`);
    return 1;
  }

  let dashboardTpl;
  let historyTpl;
  let css;
  try {
    dashboardTpl = readFileSync(new URL("scoring-dashboard.html.template", TEMPLATES_DIR), "utf8");
    historyTpl = readFileSync(new URL("scoring-history.html.template", TEMPLATES_DIR), "utf8");
    css = readFileSync(new URL("scoring.css", TEMPLATES_DIR), "utf8");
  } catch (e) {
    console.error(`[render-scoring-report] cannot read templates (skills/04-scoring/templates/): ${e.message}`);
    return 1;
  }

  for (const attempt of attempts) {
    for (const w of verifyAttempt(attempt)) console.error(`[render-scoring-report] 検算警告 ${w}`);
  }

  const outDir = dirname(jsonPath);
  writeFileSync(join(outDir, "scoring-dashboard.html"), renderDashboard(history, dashboardTpl), "utf8");
  writeFileSync(join(outDir, "scoring-history.html"), renderHistory(history, historyTpl), "utf8");
  writeFileSync(join(outDir, "scoring.css"), css, "utf8");

  const latest = attempts[attempts.length - 1];
  console.log(
    `[render-scoring-report] wrote ${join(outDir, "scoring-dashboard.html")} / scoring-history.html / scoring.css (attempt ${(latest.attempt_count ?? attempts.length - 1) + 1}, total ${latest.total})`,
  );
  return 0;
}

function isMain() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMain()) {
  process.exitCode = main(process.argv.slice(2));
}
