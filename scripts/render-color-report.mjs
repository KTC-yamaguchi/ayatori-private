#!/usr/bin/env node
// scripts/render-color-report.mjs
//
// color-lint-report.json → color-lint-report.html を **決定論的に** 生成する単一 renderer。
// render-deviations-view.mjs と同じ「machine SoT → 決定的 derived view」パターン。手焼き禁止。
//
// 人間ゲート (Step 21 / 25d) はこの HTML を見て判断する:
//   - L1 違反 (リテラル / 未解決 var 等) = 機械的事実。Step 17/20 ループの自動修正対象。
//   - アイコン色変動 / 未照合 SVG / 境界逸脱 = 機械では正誤判定できない事実 (正当な文脈変化かもしれない)。
//     人間が「正しい」「直す」「正典化する」「昇格する」を決める (機械では正誤判定しない設計)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/render-color-report.mjs artifacts/{app_name}/screens/color-lint-report.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("usage: node scripts/render-color-report.mjs <color-lint-report.json>");
  process.exit(1);
}

let r;
try {
  r = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch (e) {
  console.error(`[render-color-report] cannot read/parse ${jsonPath}: ${e.message}`);
  process.exit(1);
}

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const s = r.summary || {};
const v = r.violations || {};
const lits = v.literals || [];
const unres = v.unresolved_vars || [];
const other = v.other || [];
const iconSrc = v.icon_source_violations || [];
const illustSrc = v.illustration_source_violations || [];
const variance = r.icon_color_variance || [];
const unmatched = r.unmatched_svgs || [];
const promo = r.promotion_queue || [];
const boundary = r.boundary_violations || [];
const asym = r.theme_asymmetry || [];
const extraVars = r.extra_root_vars || [];

const swatch = (val) =>
  /^#[0-9a-fA-F]{3,8}$/.test(val) || /^rgba?\(/.test(val)
    ? `<span class="sw" style="background:${esc(val)}"></span>`
    : "";

const instCell = (instances, count) => {
  const shown = (instances || []).map((i) => `${esc(i.file)}${i.line ? ":" + i.line : ""}`).join("<br>");
  const more = count > (instances || []).length ? `<br><em>… 他 ${count - instances.length} 件</em>` : "";
  return shown + more;
};

const litRows = lits
  .map(
    (l) => `<tr><td>${swatch(l.value)}<code>${esc(l.value)}</code></td><td>${esc(l.platform)}/${esc(l.theme)}</td><td class="num">${l.count}</td><td class="inst">${instCell(l.instances, l.count)}<div class="ctx">${esc(l.instances?.[0]?.context || "")}</div></td></tr>`
  )
  .join("\n");

const unresRows = unres
  .map(
    (u) => `<tr><td><code>var(${esc(u.name)})</code></td><td>${esc(u.platform)}/${esc(u.theme)}</td><td class="num">${u.count}</td><td class="inst">${instCell(u.instances, u.count)}${u.hint ? `<div class="ctx">${esc(u.hint)}</div>` : ""}</td></tr>`
  )
  .join("\n");

const otherRows = other
  .map(
    (o) => `<tr><td><code>${esc(o.type)}</code></td><td class="inst"><code>${esc(o.value)}</code><br>${esc(o.file)}${o.line ? ":" + o.line : ""}${o.context ? `<div class="ctx">${esc(o.context)}</div>` : ""}${o.hint ? `<div class="ctx">${esc(o.hint)}</div>` : ""}</td></tr>`
  )
  .join("\n");

const srcRows = [...iconSrc.map((x) => ({ ...x, dir: "icons/" })), ...illustSrc.map((x) => ({ ...x, dir: "_shared/illustrations/" }))]
  .map((x) => `<tr><td><code>${esc(x.dir + x.file)}</code></td><td class="inst">${x.literals.map((l) => `<code>${esc(l)}</code>`).join(" ")}</td></tr>`)
  .join("\n");

const varianceCards = variance
  .map(
    (ic) => `<div class="card">
  <div class="card-head"><b>${esc(ic.icon)}</b> <span class="loc">${ic.kind === "illustration" ? "_shared/illustrations/" : "icons/"}${esc(ic.icon)}.svg</span></div>
  <table class="mini"><tr><th>実効色ソース</th><th>platform/theme</th><th class="num">件数</th><th>画面</th></tr>
  ${ic.usages.map((u) => `<tr><td><code>${esc(u.source)}</code></td><td>${esc(u.platform)}/${esc(u.theme)}</td><td class="num">${u.count}</td><td class="inst">${(u.screens || []).map(esc).join("<br>")}</td></tr>`).join("\n  ")}
  </table>
  <div class="action">→ 判断: <b>正当</b>（文脈による色変化 = active/状態/面の違い） ・ <b>統一</b>（親の color トークンを揃えて Step 17 ループへ）</div>
</div>`
  )
  .join("\n");

const unmatchedRows = unmatched
  .map(
    (u) => `<tr><td><code>${esc(u.signature)}</code></td><td class="num">${u.count}</td><td class="inst">${(u.screens || []).map(esc).join("<br>")}</td><td>${esc(u.sample?.file || "")}${u.sample?.line ? ":" + u.sample.line : ""}</td></tr>`
  )
  .join("\n");

const promoRows = promo
  .map((p) => `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.platform || "")}/${esc(p.theme || "")}</td><td class="num">${p.count}</td><td class="inst">${instCell(p.instances, p.count)}</td></tr>`)
  .join("\n");

const boundaryRows = boundary
  .map((b) => `<tr><td><code>${esc(b.var)}</code></td><td class="inst">${esc(b.file)}${b.line ? ":" + b.line : ""}<div class="ctx">${esc(b.note || "")}</div></td></tr>`)
  .join("\n");

const asymRows = asym.map((a) => `<tr><td><code>${esc(a.name)}</code></td><td class="inst">${(a.files || []).map(esc).join("<br>")}</td></tr>`).join("\n");

const sec = (title, count, body, note) =>
  count > 0
    ? `<h2>${esc(title)} <span class="count">(${count})</span></h2>${note ? `<p class="note">${note}</p>` : ""}\n${body}`
    : "";

const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>\n${rows}</table>`;

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>色 lint レポート — ${esc(r.app_name || "")}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 1020px; color: #1a1a1a; line-height: 1.55; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.05rem; margin: 1.7rem 0 .5rem; border-bottom: 2px solid #eee; padding-bottom: .3rem; }
  .count { color: #666; font-weight: 400; font-size: .9rem; }
  .summary { display: flex; flex-wrap: wrap; gap: .6rem; margin: 1rem 0; }
  .pill { border: 1px solid #ddd; border-radius: 8px; padding: .45rem .8rem; background: #fafafa; font-size: .85rem; }
  .pill b { font-size: 1.15rem; display: block; }
  .pill.bad b { color: #b00020; }
  .pill.zero b { color: #137333; }
  .note { background: #f1f7ff; border-left: 4px solid #7aa7e0; padding: .4rem .8rem; font-size: .85rem; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; margin: .4rem 0 1rem; }
  th, td { border: 1px solid #e4e4e4; padding: .35rem .55rem; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  td.num { text-align: right; white-space: nowrap; }
  td.inst { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; color: #444; }
  .ctx { color: #888; margin-top: .15rem; }
  .sw { display: inline-block; width: .9rem; height: .9rem; border: 1px solid #ccc; border-radius: 3px; vertical-align: -2px; margin-right: .35rem; }
  .card { border: 1px solid #e2e2e2; border-radius: 6px; padding: .6rem .9rem; margin: .5rem 0; }
  .card-head .loc { color: #888; font-size: .8rem; font-family: ui-monospace, monospace; margin-left: .5rem; }
  table.mini { margin: .4rem 0; }
  .action { font-size: .83rem; background: #f1f7ff; border: 1px dashed #b3d1ff; border-radius: 4px; padding: .35rem .6rem; }
  .empty { color: #137333; background: #e6f4ea; padding: .6rem 1rem; border-radius: 6px; }
  code { background: #f6f6f6; padding: 0 .25rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>色 lint レポート <small>(${esc(r.app_name || "")})</small></h1>
<p style="color:#777;font-size:.85rem">generated_at: ${esc(r.generated_at || "")} ・ 走査 ${r.scanned?.files ?? "?"} HTML ・ icons ${r.scanned?.icons ?? 0} ・ illustrations ${r.scanned?.illustrations ?? 0}</p>

<div class="summary">
  <span class="pill ${s.literal_colors ? "bad" : "zero"}"><b>${s.literal_colors ?? 0}</b>リテラル色 (${s.literal_occurrences ?? 0} 件)</span>
  <span class="pill ${s.unresolved_vars ? "bad" : "zero"}"><b>${s.unresolved_vars ?? 0}</b>未解決 var</span>
  <span class="pill ${s.other_violations ? "bad" : "zero"}"><b>${s.other_violations ?? 0}</b>その他違反</span>
  <span class="pill"><b>${s.icons_with_variance ?? 0}</b>色が割れたアイコン</span>
  <span class="pill"><b>${s.unmatched_svgs ?? 0}</b>未照合 SVG</span>
  <span class="pill"><b>${s.promotion_queue ?? 0}</b>昇格キュー</span>
  <span class="pill ${s.boundary_violations ? "bad" : ""}"><b>${s.boundary_violations ?? 0}</b>境界逸脱</span>
</div>

${sec("L1: リテラル色 (zero-literal 違反 — 自動修正対象)", lits.length, table(["値", "platform/theme", "件数", "出現箇所"], litRows), "content の色は <code>var(--token)</code> / <code>currentColor</code> のみ。定義済み token と同じ値でも生書きは NG (テーマ切替を壊すため)。")}
${sec("L1: 未解決 var", unres.length, table(["変数", "platform/theme", "件数", "出現箇所"], unresRows), "<code>--color-illustration-*</code> は未承認の装飾色 = 下の昇格キューにも出る。それ以外は typo か tokens.json 未定義。")}
${sec("L1: その他違反", other.length, table(["種別", "内容"], otherRows))}
${sec("L1: アセット source 内のリテラル", iconSrc.length + illustSrc.length, table(["ファイル", "リテラル"], srcRows), "icons/ は <code>node scripts/lint-screen-colors.mjs --normalize-icons</code> で機械修正できる。")}
${sec("アイコン色変動 (人間判断 — auto-fail しない)", variance.length, varianceCards, "同じアイコンが画面間で別の色ソースを持つ。<b>正当な文脈変化</b> (active タブ / 状態色) か <b>親色トークンの選び間違い</b> かは機械で区別できないため、ここで人間が判断する。")}
${sec("未照合 SVG (正典化候補 or データ駆動)", unmatched.length, table(["署名", "件数", "画面", "サンプル"], unmatchedRows), "icons/ にも _shared/illustrations/ にも一致しない content SVG。繰り返し登場する絵なら正典化 (§11.7)、データで形が変わるグラフィックなら対象外と判断する。")}
${sec("昇格キュー (Step 24 Step A-2b → tokens.json)", promo.length, table(["変数", "platform/theme", "件数", "出現箇所"], promoRows), "承認されると tokens.json の global 装飾グループに追加され、Figma Variables にも登録される。自動昇格はしない。")}
${sec("境界逸脱 (装飾色の load-bearing 転用疑い)", boundary.length, table(["変数", "箇所"], boundaryRows), "装飾色は装飾専用 (WCAG contrast 検証を通らないため)。文字・状態・操作要素に使うなら通常パレットへ。")}
${sec("テーマ非対称 (dual-theme の片側欠落シグナル)", asym.length, table(["変数", "ファイル"], asymRows))}
${sec("台帳外の :root 色変数 (人間判断 — リテラル洗浄の可視化)", extraVars.length, table(["変数", "値", "platform/theme", "件数", "画面"], extraVars.map((e) => `<tr><td><code>${esc(e.name)}</code></td><td>${swatch(e.value)}<code>${esc(e.value)}</code></td><td>${esc(e.platform)}/${esc(e.theme)}</td><td class="num">${e.count}</td><td class="inst">${(e.screens || []).map(esc).join("<br>")}</td></tr>`).join("\n")), "root-variables.css 正典に無い色値つき :root 変数。<b>正当な画面固有値</b> (足場 shadow 等) か <b>台帳を迂回したリテラル洗浄</b> かを人間が判断する。台帳に載せるべき色なら tokens.json へ (Phase 2 / Step 24 経由)。")}

${
  lits.length + unres.length + other.length + iconSrc.length + illustSrc.length + variance.length + unmatched.length + promo.length + boundary.length + asym.length + extraVars.length === 0
    ? '<p class="empty">✅ 違反・要判断項目はありません。</p>'
    : ""
}

<p style="color:#888;font-size:.8rem">Generated by scripts/render-color-report.mjs from color-lint-report.json (derived report — 毎回上書き再生成)。手編集しないこと。</p>
</body>
</html>
`;

const outPath = join(dirname(jsonPath), "color-lint-report.html");
writeFileSync(outPath, html, "utf8");
console.log(`[render-color-report] wrote ${outPath}`);
