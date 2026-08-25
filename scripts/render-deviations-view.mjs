#!/usr/bin/env node
// scripts/render-deviations-view.mjs
//
// Operating Principle 4 の output 側監査リスト: requirement-deviations.json → requirement-deviations-view.html
// を **決定論的に** 生成する単一 renderer。
//
// 背景: 旧設計では 4 writer (Step 13/18/29/25c) が各自フリーハンドで HTML を再生成していたため、
// 列構成 / severity 強調 / 未resolved 集計が pass ごとに drift していた (PR #79 セルフレビュー 6-7 体が指摘)。
// 本スクリプトに一本化し、各 writer は `node scripts/render-deviations-view.mjs <json-path>` を呼ぶだけにする
// (tokens.json → style-guide-view.html と同じ「machine SoT → 決定的 derived view」パターン)。
//
// readability 改修: 旧 8 列テーブルは監査ジャーゴンで人間が
// 判断しづらかった。1 deviation = 1 枚の「物語カード」に作り替え、「AI が補完した具体 / 種別 /
// 元の確定情報との関係(なぜ載ったか) / 検出元 / 状態・判断アクション」を平易なラベルで縦に並べる。
// データ構造 (schema) と監査 skill の書き方は無改修 = 既存 JSON フィールド (element / deviation_kind /
// requirement_ref / description / severity / resolution) をそのまま読み、見せ方だけ変える renderer-only 改修。
//
// per-item 判断導線: 各カードに安定番号 #N (= entries[] の 1-based index、
// append-only なので run をまたいで不変) を表示し、人間ゲートの端末対話 (docs/principle4-disambiguation.md
// §5.5) が「#2 修正 / #3 容認」のように番号で判断を返せるようにする。resolved バッジには resolution_mode
// (individual=個別判断 / bulk=一括容認) を併記し、**どの導線で判断が返ったか**を view 上でも確認できる
// ようにする (欠落 = 導入前の記録なし entry、無印で表示)。bulk は「見ずに素通しした証拠」ではない
// (読み取りの射程は docs/principle4-disambiguation.md §5.5 が SoT)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json
//   出力: 同ディレクトリの requirement-deviations-view.html

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("usage: node scripts/render-deviations-view.mjs <requirement-deviations.json>");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch (e) {
  console.error(`[render-deviations-view] cannot read/parse ${jsonPath}: ${e.message}`);
  process.exit(1);
}

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const entries = Array.isArray(data.entries) ? data.entries : [];
const unresolved = entries.filter((e) => !e.resolved_at);
const coverage = Array.isArray(data.coverage) ? data.coverage : [];
const enumerated = coverage.reduce((s, c) => s + (Number(c.enumerated_count) || 0), 0);
const hasCoverage = coverage.length > 0; // C-2 (Copilot): coverage[] 記録の有無で表示判定し、enumerated=0 (= N件監査して load-bearing 該当0件 の clean pass) を隠さない。F-2 (0件でも coverage 必須) と整合。
const phases = ["requirements", "design", "screens", "delta", "substate", "reverse", "reverse_verify"];
// #N = entries[] の 1-based index (§5.5.1)。severity ソート前に採番して安定させる。
const numbered = entries.map((e, i) => ({ e, no: i + 1 }));
const byPhase = (p) => numbered.filter(({ e }) => e.phase === p);

// severity 表示メタ (badge 絵文字 + カード内ソート順)
const SEV = {
  high: { rank: 0, icon: "🔴", label: "high" },
  medium: { rank: 1, icon: "🟡", label: "medium" },
  low: { rank: 2, icon: "⚪", label: "low" },
};
const sevMeta = (s) => SEV[s] || { rank: 3, icon: "•", label: s || "—" };

const PHASE_LABEL = {
  requirements: "要件定義 (Phase 1b / Step 07)",
  design: "デザイン (Phase 2 / Step 13)",
  screens: "画面 (Phase 3 / Step 18)",
  delta: "デルタ (Phase 5 / Step 29)",
  substate: "サブステート (Phase 3 / Step 25c)",
  reverse: "リバース推測検出 (Phase 0b / Step 05)",
  reverse_verify: "対象限定突合 (Phase 0c / verify 02〜03)",
};

// 1 deviation = 1 枚の物語カード。テーブルでなく以下を縦並びにして
// 「要件のどこに対して AI が何を補ったか・なぜ確認が要るか」を人間が読める形にする。
const card = ({ e, no }) => {
  const m = sevMeta(e.severity);
  const resolved = !!e.resolved_at;
  // resolution_mode: individual=個別判断 / bulk=一括容認。欠落 = 導入前の記録なし (無印)。
  const modeSuffix = e.resolution_mode === "bulk" ? " (一括)" : e.resolution_mode === "individual" ? " (個別)" : "";
  const statusHtml = resolved
    ? `<span class="status resolved">✅ ${esc((e.resolution || "resolved") + modeSuffix)}</span>`
    : `<span class="status open">⏳ 未resolved</span>`;
  const anchor = e.requirement_ref ?? null;
  const descHtml = e.description
    ? `        <div class="field"><span class="k">補足</span><span class="v">${esc(e.description)}</span></div>\n`
    : "";
  const actionHtml = resolved
    ? ""
    : `        <div class="action">→ 判断: ゲートの質問で <b>#${no}</b> を <b>容認</b>（この内容で OK） ・ <b>修正依頼</b>（値を変える） ・ <b>要件に昇格</b>（正式な要件にする）のいずれかに指定</div>\n`;
  return `      <div class="card sev-${esc(m.label)}">
        <div class="card-head">
          <span class="no">#${no}</span>
          <span class="sev">${m.icon} ${esc(m.label)}</span>
          <span class="loc">${esc(e.artifact || "")}</span>
          ${statusHtml}
        </div>
        <div class="field"><span class="k">AI が補完した具体</span><span class="v">${esc(e.element)}</span></div>
        <div class="field"><span class="k">種別</span><span class="v">${esc(e.deviation_kind)}</span></div>
        <div class="field"><span class="k">元の確定情報との関係<br><small>（なぜこのリストに載ったか）</small></span><span class="v">${
          anchor === null ? "<em>(要件に対応なし ＝ 要件外)</em>" : esc(anchor)
        }</span></div>
${descHtml}        <div class="meta">検出: ${esc(e.raised_by_step || "")}${e.detected_at ? " ・ " + esc(e.detected_at) : ""}${
          // run 単位で reconcile する層 (reverse_verify) は複数 run の項目が同じセクションに並ぶ。
          // どの run の担当かを出さないと、人間が見ている一覧の内訳を追えない。
          e.run_id ? " ・ run " + esc(e.run_id) : ""
        }</div>
${actionHtml}      </div>`;
};

const section = (p) => {
  // severity 高い順 (high→medium→low→その他) に並べてスキャンしやすくする
  const rows = byPhase(p)
    .slice()
    .sort((a, b) => sevMeta(a.e.severity).rank - sevMeta(b.e.severity).rank);
  if (rows.length === 0) return "";
  // reverse 層は「実ソース根拠が無い / 薄い AI 推測」項目の重点レビューリスト。
  // 人間が見落とさないようセクション冒頭に強い注意バナーを出す。
  const banner =
    p === "reverse"
      ? `    <div class="focus-review">⚠️ <strong>重点レビュー対象</strong>: 以下の ${rows.length} 件は <strong>実ソースコード / 仕様ドキュメントに根拠が無い、または薄い AI の推測</strong>です (生成側の inferred 自己申告 ∪ 監査の指摘)。各項目を必ず確認し、修正依頼 / 容認 / 要件に昇格のいずれかを判断してください。</div>\n`
      : "";
  return `  <h2>${esc(PHASE_LABEL[p] || p)} <span class="count">(${rows.length} 件)</span></h2>
${banner}    <div class="cards">
${rows.map(card).join("\n")}
    </div>`;
};

const sectionsHtml = phases.map(section).filter(Boolean).join("\n");

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>要件逸脱リスト — ${esc(data.app_name || "")}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 940px; color: #1a1a1a; line-height: 1.55; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.05rem; margin: 1.7rem 0 .6rem; border-bottom: 2px solid #eee; padding-bottom: .3rem; }
  .count { color: #666; font-weight: 400; font-size: .9rem; }
  .summary { background: #f5f5f5; border-left: 4px solid #888; padding: .75rem 1rem; margin: 1rem 0; }
  .summary .big { font-size: 1.5rem; font-weight: 700; }
  .disclaimer { background: #fff8e1; border-left: 4px solid #f0a500; padding: .5rem 1rem; margin: 1rem 0; font-size: .9rem; }
  .focus-review { background: #fdecea; border-left: 4px solid #b00020; padding: .6rem 1rem; margin: .3rem 0 .8rem; font-size: .9rem; }
  .cards { display: flex; flex-direction: column; gap: .7rem; }
  .card { border: 1px solid #e2e2e2; border-left-width: 5px; border-radius: 6px; padding: .7rem .95rem; background: #fff; }
  .card.sev-high { border-left-color: #b00020; background: #fdecea; }
  .card.sev-medium { border-left-color: #f0a500; }
  .card.sev-low { border-left-color: #bbb; }
  .card-head { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin-bottom: .5rem; }
  .card-head .no { font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #eef1f4; border-radius: 4px; padding: .05rem .4rem; }
  .card-head .sev { font-weight: 700; }
  .card-head .loc { color: #666; font-size: .82rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .status { margin-left: auto; font-size: .82rem; padding: .12rem .55rem; border-radius: 999px; white-space: nowrap; }
  .status.resolved { background: #e6f4ea; color: #137333; }
  .status.open { background: #fff3e0; color: #9a6700; }
  .field { display: grid; grid-template-columns: 15rem 1fr; gap: .6rem; padding: .18rem 0; font-size: .9rem; align-items: start; }
  .field .k { color: #555; font-weight: 600; }
  .field .k small { color: #888; font-weight: 400; }
  .meta { color: #999; font-size: .78rem; margin-top: .45rem; }
  .action { margin-top: .5rem; font-size: .85rem; background: #f1f7ff; border: 1px dashed #b3d1ff; border-radius: 4px; padding: .4rem .6rem; }
  .empty { color: #666; }
  @media (max-width: 640px) {
    body { margin: 1rem; }
    .field { grid-template-columns: 1fr; gap: .05rem; }
  }
</style>
</head>
<body>
<h1>要件逸脱リスト <small>(${esc(data.app_name || "")})</small></h1>
<p style="color:#555;margin:.2rem 0 0">要件に無いのに生成物へ入った要素 (要件外追加 / 根拠薄弱 / 想像デフォルト)、および画面手編集と要件文書の食い違い (要件矛盾 / 要件削除) の監査リスト。種別は各カードの「種別」欄を参照。</p>

<div class="summary">
  <span class="big">未resolved: ${unresolved.length} 件</span> / flag 全 ${entries.length} 件${
  hasCoverage ? ` / spec-level 突合: ${enumerated} 要素` : ""
}
</div>

<div class="disclaimer">
  ⚠️ <strong>このリストは「監査がカバーした範囲」だけ</strong>です。floor (最低ここは見る) であって ceiling (ここだけ見ればいい) ではありません。
  <ul style="margin:.4rem 0">
    <li>監査は <strong>spec-level の構造化リスト</strong> (requirements の load-bearing specifics / 画面仕様 component / design-brief token) を上流の確定情報に突合した結果です${
      hasCoverage ? ` (今回 ${enumerated} 要素を突合)` : ""
    }。</li>
    <li><strong>自動チェック対象外 (＝あなたの目視が必須)</strong>: ① component 内のサブ詳細 (文言・軸ラベル・数値等) ② 仕様書に載っていない要素。</li>
    <li>検出は LLM の semantic 判断で確率的。<strong>本リストが空でも「逸脱ゼロ」とは限りません</strong> (best-effort 安全網)。</li>
  </ul>
</div>

${sectionsHtml || '<p class="empty">検出された逸脱はありません (未検出 / 全 resolved)。</p>'}

<p style="color:#888;font-size:.8rem">Generated by scripts/render-deviations-view.mjs from requirement-deviations.json (SoT)。手編集しないこと。</p>
</body>
</html>
`;

const outPath = join(dirname(jsonPath), "requirement-deviations-view.html");
writeFileSync(outPath, html, "utf8");
console.log(`[render-deviations-view] wrote ${outPath} (${entries.length} entries, ${unresolved.length} unresolved)`);
