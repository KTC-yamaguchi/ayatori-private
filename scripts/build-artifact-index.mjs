#!/usr/bin/env node
// scripts/build-artifact-index.mjs
//
// artifacts/{app_name}/ 配下の全成果物を 1 つの index.html (左カテゴリ目次 + 右コンテンツ)
// に集約する決定論的 renderer。要件 / 画面 / デザイン / 遷移図 / 採点 / 監査 / 状態 の
// 各成果物を curated whitelist でスキャンし、HTML 成果物は live sibling への iframe src で、
// Markdown は in-script renderer で描画する。二重クリックで開くだけで動く (サーバ不要)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/build-artifact-index.mjs <app-name | artifacts/app-name>
//   出力: 同ディレクトリの index.html (毎回フル上書き、SoT = ディレクトリ自身のスキャン結果)
// exit: 0 = 成功 / 1 = 引数なし / 2 = app ディレクトリ不在

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

// ── 引数解決 ────────────────────────────────────────────────
const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/build-artifact-index.mjs <app-name | artifacts/app-name>");
  process.exit(1);
}
const isDirAbs = (p) => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};
// "artifacts/kinto-jp" / 絶対パス / "kinto-jp" (artifacts 配下と解釈) のいずれも受ける
let ROOT = resolve(arg.replace(/\/+$/, ""));
if (!isDirAbs(ROOT)) ROOT = resolve("artifacts", arg.replace(/\/+$/, ""));
if (!isDirAbs(ROOT)) {
  console.error(`[build-artifact-index] app directory not found: ${arg}`);
  process.exit(2);
}
const APP = basename(ROOT);

// ── ROOT 相対ヘルパ (すべて fail-soft) ──────────────────────
const existsFile = (rel) => {
  try { return statSync(join(ROOT, rel)).isFile(); } catch { return false; }
};
const listDir = (rel) => {
  try { return readdirSync(join(ROOT, rel)); } catch { return []; }
};
const readRel = (rel) => {
  try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; }
};
const readJson = (rel) => {
  const t = readRel(rel);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
};
// ISO タイムスタンプ → "YYYY-MM-DD HH:MM" (タイムゾーン変換はせず記録値をそのまま表示)
const fmtTime = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(iso || "");
};
const firstH1 = (rel) => {
  const md = readRel(rel);
  if (!md) return null;
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
};

// ── エスケープ / URL エンコード ──────────────────────────────
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 属性 (href) 用: quote も escape (breakout 防止)
const escAttr = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
// パスは「セグメントごとに」encodeURIComponent する (全体を encode すると "/" が壊れる)。
// 日本語ファイル名 (ホーム.html / 契約詳細--error.html) を file:// iframe src / href で安全に扱う。
const enc = (rel) => rel.split("/").map(encodeURIComponent).join("/");

// ── Markdown → HTML (stdlib only、build-md-export.py の md_to_html と同一サブセット) ──
// 対応: 見出し (#..####) / ul・ol (1 段) / テーブル / fenced code / blockquote / hr /
//       段落 / インライン (code → link → bold の順、link href は escAttr)。
// 非対応 (元 Python も同様): italic / 入れ子リスト / 画像 / autolink / 取り消し線 / HTML passthrough。
const inline = (text) => {
  let t = esc(text); // & < > " のみ
  // コードスパンを placeholder に退避してから link/bold を適用し、最後に復元する。
  // これによりコードスパン内の [x](y) / **x** を誤ってリンク/強調として解釈しない。
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000c${codes.length - 1}\u0000`; });
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    // url は既に esc() 済 → 再エスケープしない (& の二重化を防ぐ)。安全 scheme のみ linkify (javascript:/data: を排除)。
    /^(https?:|mailto:|#|\.{0,2}\/|[^:]*$)/i.test(url) ? `<a href="${url}">${label}</a>` : label);
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  t = t.replace(/\u0000c(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return t;
};
const mdToHtml = (md) => {
  const lines = md.split("\n");
  const out = [];
  let inCode = false, inTable = false, inList = null, inBlockquote = false;
  let tableRows = [], para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
  const flushBq = () => { if (inBlockquote) { out.push("</blockquote>"); inBlockquote = false; } };
  const flushTable = () => {
    if (inTable && tableRows.length) {
      out.push("<table>");
      out.push("<thead><tr>" + tableRows[0].map((c) => `<th>${inline(c.trim())}</th>`).join("") + "</tr></thead>");
      out.push("<tbody>");
      for (const row of tableRows.slice(2)) out.push("<tr>" + row.map((c) => `<td>${inline(c.trim())}</td>`).join("") + "</tr>");
      out.push("</tbody></table>");
    }
    inTable = false; tableRows = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const s = ln.replace(/\s+$/, "");
    if (s.startsWith("```")) {
      flushPara(); flushList(); flushBq(); flushTable();
      if (!inCode) { out.push("<pre><code>"); inCode = true; } else { out.push("</code></pre>"); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(ln)); continue; }
    if (s.startsWith("|") && s.endsWith("|") && s.slice(1, -1).includes("|")) {
      flushPara(); flushList(); flushBq();
      const cells = s.replace(/^\|/, "").replace(/\|$/, "").split("|");
      if (!inTable) { inTable = true; tableRows = [cells]; } else tableRows.push(cells);
      continue;
    } else if (inTable) { flushTable(); }
    let m = s.match(/^(#{1,4})\s+(.+)$/);
    if (m) { flushPara(); flushList(); flushBq(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^-{3,}\s*$/.test(s)) { flushPara(); flushList(); flushBq(); out.push("<hr/>"); continue; }
    if (s.startsWith("> ")) {
      flushPara(); flushList();
      if (!inBlockquote) { out.push("<blockquote>"); inBlockquote = true; }
      out.push(`<p>${inline(s.slice(2))}</p>`);
      continue;
    } else if (inBlockquote && !s.startsWith(">")) { flushBq(); }
    m = ln.match(/^(\s*)[-*]\s+(.+)$/);
    if (m) { flushPara(); if (inList !== "ul") { flushList(); out.push("<ul>"); inList = "ul"; } out.push(`<li>${inline(m[2])}</li>`); continue; }
    m = ln.match(/^(\s*)\d+\.\s+(.+)$/);
    if (m) { flushPara(); if (inList !== "ol") { flushList(); out.push("<ol>"); inList = "ol"; } out.push(`<li>${inline(m[2])}</li>`); continue; }
    if (!s.trim()) { flushPara(); flushList(); continue; }
    para.push(s.trim());
  }
  flushPara(); flushList(); flushBq(); flushTable();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
};

// ── 最新アーカイブ design-samples フォールバック ─────────────
// live の design-samples/{plat}/index.html が無い場合、.archive/design-samples-*/{plat}/index.html
// のうち最新 (タイムスタンプ名の降順) を採用する。
const newestArchivedDesignSample = (plat) => {
  const dirs = listDir(".archive").filter((d) => d.startsWith("design-samples-")).sort().reverse();
  for (const d of dirs) {
    const rel = `.archive/${d}/${plat}/index.html`;
    if (existsFile(rel)) return rel;
  }
  return null;
};

// ── Discovery (curated whitelist、blind glob 禁止) ──────────
// 除外は「見に行かない」ことで構造的に担保: _backup/ / delta/snapshots/ / build/ / icons/ /
// screens/_shared/ / *.json / *.mmd / *.yaml / *.css は列挙対象に含めない。
// 実行履歴サマリーの合成。pipeline-state.json / scores.json / delta/run-history.json を
// 読み取り (書き込みはしない) 、承認タイムライン + 選択デザイン + 採点 + デルタ変更履歴を
// 人間が読める 1 枚に束ねる。対象データが無ければ null。
const buildRunSummary = () => {
  const st = readJson("pipeline-state.json");
  const scores = readJson("scores.json");
  const deltaHist = readJson("delta/run-history.json");
  const parts = [];

  const ap = (st && st.approvals) || {};
  const req = readJson("requirements.json");
  const APPROVAL_LABELS = {
    // reverse 経路の押印 (Phase 0b Completion) を Phase 1b 実行と誤表示しない。
    // via 欠落 (自動押印導入前の手動 stub) は requirements.json.status で補完 — 欠落を信頼側に倒さない
    step07_approved_at:
      ap.step07_approved_via === "reverse-review-gate" || (req && req.status === "REVERSE_ENGINEERED")
        ? "要件承認 (Phase 0b reverse gate)"
        : "要件承認 (Phase 1b)",
    baseline_approved_at:
      ap.baseline_approved_via === "screens-lite-gate"
        ? "ベースライン承認"
        : ap.baseline_approved_via === "manual-stub"
          ? "ベースライン承認 (手動 stub)"
          : "ベースライン承認 (由来記録なし)",
    step13_approved_at: "デザイン承認 (Phase 2)",
    step16_approved_at: "画面設計承認 (遷移図・画面一覧)",
    screens_approved_at: "画面 HTML 承認",
    step23_approved_at: "最終承認",
    step24_completed_at: "デザインシステム更新",
    step25_completed_at: "コンポーネント生成",
    step25d_approved_at: "サブステート承認",
    completed_at_states: "完全完了 (sub-state 含む)",
  };
  const events = Object.keys(APPROVAL_LABELS)
    .filter((k) => typeof ap[k] === "string" && ap[k])
    .map((k) => ({ label: APPROVAL_LABELS[k], t: ap[k] }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (events.length) {
    parts.push(`<h2>タイムライン</h2><ul class="rs-timeline">` +
      events.map((e) => `<li>${esc(e.label)}<span class="t">${esc(fmtTime(e.t))}</span></li>`).join("") + `</ul>`);
  }

  const dl = [];
  const sel = (st && st.selections) || {};
  if (sel.selected_sample_direction || sel.selected_sample_id) {
    const id = sel.selected_sample_id ? `案${String(sel.selected_sample_id).toUpperCase()}` : "";
    dl.push(["選択デザイン", `${id}${sel.selected_sample_direction ? " " + sel.selected_sample_direction : ""}`.trim()]);
  }
  if (scores && scores.current && scores.current.total != null) {
    const attempts = Array.isArray(scores.history) ? scores.history.length : (scores.current.attempt || null);
    dl.push(["デザイン採点", `${scores.current.total} 点${attempts ? ` (${attempts} attempts)` : ""}`]);
  }
  if (dl.length) {
    parts.push(`<h2>結果</h2><dl class="rs-dl">` +
      dl.map((kv) => `<dt>${esc(kv[0])}</dt><dd>${esc(kv[1])}</dd>`).join("") + `</dl>`);
  }

  const runs = (deltaHist && Array.isArray(deltaHist.runs)) ? deltaHist.runs : [];
  if (runs.length) {
    parts.push(`<h2>デルタ変更履歴 <span class="rs-count">(${runs.length})</span></h2><ul class="rs-changes">` +
      runs.slice().reverse().map((r) => {
        const scr = (r.screens_affected != null) ? ` · 影響画面 ${esc(String(r.screens_affected))}` : "";
        return `<li><span class="d">${esc(fmtTime(r.date))}</span>${scr}<div>${esc(r.change_description || "")}</div></li>`;
      }).join("") + `</ul>`);
  }

  if (!parts.length) return null;
  parts.push(`<p class="rs-note">詳細な修正・指摘イベント (Pattern A/B/C/D) は「フィードバックログ」を参照。</p>`);
  return parts.join("\n");
};

const buildCategories = () => {
  // 要件 (MD): canonical 順 → 残りの requirements/*.md を alpha
  const reqEntries = [];
  const seenReq = new Set();
  const REQ_ORDER = ["00-raw-input", "01-overview", "02-scope", "03-user-flow", "04-use-cases", "05-features", "06-non-functional", "07-data-definition", "08-constraints"];
  for (const stem of REQ_ORDER) {
    const rel = `requirements/${stem}.md`;
    if (existsFile(rel)) { reqEntries.push({ label: firstH1(rel) || stem, rel, kind: "md" }); seenReq.add(`${stem}.md`); }
  }
  for (const f of listDir("requirements").filter((f) => f.endsWith(".md") && !f.startsWith("_") && !seenReq.has(f)).sort()) {
    reqEntries.push({ label: firstH1(`requirements/${f}`) || f.replace(/\.md$/, ""), rel: `requirements/${f}`, kind: "md" });
  }

  // リバース (Phase 0b — 生成した要件ドラフトと収集した証拠)。
  // Step 05 の人間ゲートは Step 06 より前に走るため requirements/ も screens/ もまだ無い。
  // 被監査物である reverse-engineered/01-08.md を index に出さないと、承認者がゲート時点で
  // 確認すべきものが index から見えない。
  const revEntries = [];
  const REV_ORDER = ["raw-analysis", "comparison-report", "01-overview", "02-scope", "03-user-flow", "04-use-cases", "05-features", "06-non-functional", "07-data-definition", "08-constraints"];
  const seenRev = new Set();
  for (const stem of REV_ORDER) {
    const rel = `reverse-engineered/${stem}.md`;
    if (existsFile(rel)) { revEntries.push({ label: firstH1(rel) || stem, rel, kind: "md" }); seenRev.add(`${stem}.md`); }
  }
  for (const f of listDir("reverse-engineered").filter((f) => f.endsWith(".md") && !seenRev.has(f)).sort()) {
    revEntries.push({ label: firstH1(`reverse-engineered/${f}`) || f.replace(/\.md$/, ""), rel: `reverse-engineered/${f}`, kind: "md" });
  }
  // 証拠アーカイブの索引 (どの文書が引用可能かの機械判定結果 / capture 済み frame 一覧)
  if (existsFile("ground-truth/index.md")) revEntries.push({ label: "証拠アーカイブ索引 (文書)", rel: "ground-truth/index.md", kind: "md" });

  // デザイン (MD + HTML)
  const designEntries = [];
  if (existsFile("style-guide.md")) designEntries.push({ label: "スタイルガイド (MD)", rel: "style-guide.md", kind: "md" });
  if (existsFile("screens/style-guide-view.html")) designEntries.push({ label: "パーツカタログ (HTML)", rel: "screens/style-guide-view.html", kind: "html" });
  for (const plat of ["web", "mobile"]) {
    const live = `design-samples/${plat}/index.html`;
    if (existsFile(live)) designEntries.push({ label: `デザイン案 · ${plat} (3案切替)`, rel: live, kind: "html" });
    else {
      const arch = newestArchivedDesignSample(plat);
      if (arch) designEntries.push({ label: `デザイン案 · ${plat} (アーカイブ)`, rel: arch, kind: "html" });
    }
  }
  // 21a: グラフィック必要性の推奨レポート (存在時のみ — degrade skip 時は不在)
  if (existsFile("graphics/graphic-recommend.md")) designEntries.push({ label: "グラフィック必要性 推奨レポート", rel: "graphics/graphic-recommend.md", kind: "md" });
  // 候補スロット視覚レポート (派生 HTML — 候補 0 件 / render 失敗時は不在)
  if (existsFile("graphics/graphic-recommend.html")) designEntries.push({ label: "グラフィック候補スロット 視覚レポート", rel: "graphics/graphic-recommend.html", kind: "html" });

  // 画面 (MD 仕様 + HTML、main → 状態バリアント順)
  const screenEntries = [];
  if (existsFile("screens/00-screen-list.md")) screenEntries.push({ label: "画面一覧", rel: "screens/00-screen-list.md", kind: "md" });
  for (const f of listDir("screens").filter((f) => f.endsWith(".md") && !f.startsWith("00-") && !f.startsWith("_")).sort()) {
    screenEntries.push({ label: `仕様: ${firstH1(`screens/${f}`) || f.replace(/\.md$/, "")}`, rel: `screens/${f}`, kind: "md" });
  }
  for (const plat of ["web", "web-sm", "mobile"]) {
    const platLabel = plat === "web" ? "Web" : plat === "web-sm" ? "Web (スマホ幅)" : "Mobile";
    const files = listDir(`screens/${plat}`).filter((f) => f.endsWith(".html"));
    files.sort((a, b) => {
      const pa = a.replace(/\.html$/, "").split("--"), pb = b.replace(/\.html$/, "").split("--");
      return pa[0].localeCompare(pb[0]) || pa.slice(1).join("--").localeCompare(pb.slice(1).join("--"));
    });
    for (const f of files) {
      const stem = f.replace(/\.html$/, "");
      screenEntries.push({ label: `${platLabel} · ${stem.replace(/--/g, " · ")}`, rel: `screens/${plat}/${f}`, kind: "html" });
    }
  }

  // 画面遷移 (HTML、Mermaid CDN 依存 = オフラインで空白の可能性)
  const transEntries = [];
  if (existsFile("screens/00-transition-map.html")) transEntries.push({ label: "画面遷移図 ⚠ 要オンライン (Mermaid)", rel: "screens/00-transition-map.html", kind: "html" });

  // 採点 (HTML、相対 scoring.css 参照 → iframe 必須)
  const scoreEntries = [];
  if (existsFile("scoring-dashboard.html")) scoreEntries.push({ label: "スコアダッシュボード", rel: "scoring-dashboard.html", kind: "html" });
  if (existsFile("scoring-history.html")) scoreEntries.push({ label: "スコア履歴", rel: "scoring-history.html", kind: "html" });

  // 監査 (HTML 派生ビュー + 突合レポート)
  const auditEntries = [];
  if (existsFile("requirement-deviations-view.html")) auditEntries.push({ label: "要件外追加リスト", rel: "requirement-deviations-view.html", kind: "html" });
  // 対象限定突合 (Phase 0c) のレポート。判断の根拠 (初読 / 再読の引用) を持つため、
  // 逸脱リストと並べて 1 画面から辿れるようにする。
  if (existsFile("reverse-verify/crosscheck-report.md")) auditEntries.push({ label: "対象限定突合レポート", rel: "reverse-verify/crosscheck-report.md", kind: "md" });
  if (existsFile("screens/color-lint-report.html")) auditEntries.push({ label: "色 lint レポート", rel: "screens/color-lint-report.html", kind: "html" });

  // 実行履歴 (合成サマリー + feedback-log)。session-handoff.md は実行状態 SoT でない
  // disposable メモのため非表示。
  const histEntries = [];
  const runSummary = buildRunSummary();
  if (runSummary) histEntries.push({ label: "実行サマリー", kind: "synth", html: runSummary });
  if (existsFile("feedback-log.md")) histEntries.push({ label: "フィードバックログ", rel: "feedback-log.md", kind: "md" });

  return [
    { id: "reverse", label: "リバース (証拠・ドラフト)", entries: revEntries },
    { id: "requirements", label: "要件定義", entries: reqEntries },
    { id: "design", label: "デザイン", entries: designEntries },
    { id: "screens", label: "画面", entries: screenEntries },
    { id: "transition", label: "画面遷移", entries: transEntries },
    { id: "scoring", label: "スコアリング", entries: scoreEntries },
    { id: "audit", label: "監査", entries: auditEntries },
    { id: "history", label: "実行履歴", entries: histEntries },
  ].filter((c) => c.entries.length > 0);
};

// ── HTML 組み立て ───────────────────────────────────────────
const STYLE = `
  :root{
    --bg:#FBFBFC; --surface:#FFFFFF; --line:#E8EAED; --ink:#15171C; --muted:#626873;
    --accent:#3B5BDB; --accent-weak:#EEF1FD; --accent-ink:#2E49B0; --hover:#EEF0F3;
    --sidebar-w:284px; --topbar-h:52px;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Roboto Mono",monospace;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;}
  body{font-family:var(--sans);color:var(--ink);background:var(--surface);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;height:100vh;overflow:hidden;}

  /* Top app bar (full width) */
  .topbar{flex:0 0 auto;height:var(--topbar-h);display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--line);background:var(--surface);z-index:50;}
  .burger{flex:0 0 auto;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);cursor:pointer;padding:0;transition:background .12s,border-color .12s;}
  .burger:hover{background:var(--hover);border-color:var(--muted);}
  .burger:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  .burger svg{width:17px;height:17px;}
  .brand{flex:0 0 auto;display:flex;align-items:baseline;gap:6px;white-space:nowrap;}
  .brand-mark{font-size:15px;}
  .brand-name{font-weight:700;font-size:15px;letter-spacing:-.01em;}
  .brand-tag{font-family:var(--mono);font-size:11px;color:var(--accent);letter-spacing:.04em;}
  .cur-title{flex:1 1 auto;min-width:0;font-size:14px;font-weight:500;color:var(--muted);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cur-title:not(:empty)::before{content:"›";color:#c2c6cc;margin-right:11px;font-weight:400;}
  .cur-ext{flex:0 0 auto;font-family:var(--mono);font-size:12px;color:var(--accent);text-decoration:none;padding:5px 10px;border-radius:7px;border:1px solid var(--accent-weak);background:var(--accent-weak);}
  .cur-ext:hover{border-color:var(--accent);}
  .cur-ext:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}

  /* Shell: sidebar + content */
  .shell{flex:1 1 auto;display:flex;min-height:0;overflow:hidden;}
  .sidebar{flex:0 0 var(--sidebar-w);width:var(--sidebar-w);background:var(--bg);border-right:1px solid var(--line);overflow-y:auto;overflow-x:hidden;transition:flex-basis .22s cubic-bezier(.4,0,.2,1),width .22s cubic-bezier(.4,0,.2,1);}
  [data-sidebar="closed"] .sidebar{flex-basis:0;width:0;}
  .sidebar-inner{width:var(--sidebar-w);}
  .sidebar-head{padding:16px 18px 4px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--muted);white-space:nowrap;}
  .toc{padding:4px 12px 28px;}
  .cat{margin-bottom:2px;}
  .cat>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 8px 5px;white-space:nowrap;}
  .cat>summary::-webkit-details-marker{display:none;}
  .cat>summary::before{content:"";width:5px;height:5px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;flex:0 0 auto;}
  .cat[open]>summary::before{transform:rotate(45deg);}
  .cat-label{font-family:var(--mono);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);}
  .cat>summary .n{font-family:var(--mono);font-size:10px;color:var(--muted);background:#EEF0F3;border-radius:999px;padding:1px 7px;}
  .cat>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:5px;}
  .cat ul{list-style:none;margin:2px 0 10px 11px;padding:0;border-left:1px solid var(--line);}
  .cat li{display:flex;align-items:center;}
  .nav-link{flex:1 1 auto;min-width:0;display:block;font-size:13px;color:#2b3038;text-decoration:none;padding:6px 10px;margin-left:-1px;border-left:3px solid transparent;border-radius:0 6px 6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .nav-link:hover{background:var(--hover);}
  .nav-link.active{background:var(--accent-weak);color:var(--accent-ink);border-left-color:var(--accent);font-weight:600;}
  .nav-link:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}
  .ext{flex:0 0 auto;color:var(--muted);text-decoration:none;font-size:12px;padding:4px 8px;border-radius:5px;opacity:0;transition:opacity .12s;}
  .cat li:hover .ext{opacity:1;}
  .ext:hover{color:var(--accent);}
  .ext:focus-visible{opacity:1;outline:2px solid var(--accent);outline-offset:-2px;}

  /* Scrim (mobile drawer) */
  .scrim{position:fixed;inset:0;background:rgba(15,17,20,.42);z-index:30;opacity:0;visibility:hidden;transition:opacity .2s;}

  .pane{flex:1 1 auto;min-width:0;position:relative;overflow:auto;background:var(--surface);}
  #frame{position:absolute;inset:0;width:100%;height:100%;border:0;}
  .welcome{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:32px;}
  .welcome[hidden]{display:none;}
  .welcome-inner{max-width:460px;text-align:center;}
  .welcome-h{font-size:16px;font-weight:600;margin:0 0 8px;}
  .welcome-p{font-size:13px;color:var(--muted);margin:0;line-height:1.65;}

  /* Markdown pane */
  .md-body{padding:30px 36px;max-width:880px;}
  .rs-timeline{list-style:none;margin:0 0 10px;padding:0;}
  .rs-timeline li{position:relative;padding:7px 0 7px 20px;font-size:13.5px;border-left:2px solid var(--line);margin-left:4px;}
  .rs-timeline li:last-child{border-left-color:transparent;}
  .rs-timeline li::before{content:"";position:absolute;left:-6px;top:12px;width:9px;height:9px;border-radius:50%;background:var(--accent);border:2px solid var(--surface);}
  .rs-timeline .t{font-family:var(--mono);font-size:11px;color:var(--muted);margin-left:10px;}
  .rs-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;font-size:13.5px;margin:0 0 10px;}
  .rs-dl dt{color:var(--muted);}
  .rs-dl dd{margin:0;font-weight:500;}
  .rs-count{font-weight:400;color:var(--muted);font-size:.85em;}
  .rs-changes{list-style:none;margin:0;padding:0;}
  .rs-changes li{padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px;}
  .rs-changes li:last-child{border-bottom:0;}
  .rs-changes li .d{font-family:var(--mono);font-size:11px;color:var(--muted);}
  .rs-note{color:var(--muted);font-size:12.5px;margin-top:18px;}
  .md-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:22px;}
  .md-head>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .md-head .ext{opacity:1;color:var(--accent);flex:0 0 auto;padding:0;}
  .md-body h1{font-size:24px;font-weight:700;letter-spacing:-.015em;margin:0 0 14px;}
  .md-body h2{font-size:18px;font-weight:650;margin:28px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--line);}
  .md-body h3{font-size:15px;font-weight:600;margin:22px 0 8px;}
  .md-body h4{font-size:13.5px;font-weight:600;color:var(--muted);margin:16px 0 6px;}
  .md-body p{margin:0 0 12px;}
  .md-body ul,.md-body ol{margin:0 0 14px;padding-left:22px;}
  .md-body li{margin:4px 0;}
  .md-body a{color:var(--accent);text-decoration:none;}
  .md-body a:hover{text-decoration:underline;}
  .md-body code{font-family:var(--mono);font-size:.85em;background:#F2F3F5;padding:1.5px 5px;border-radius:4px;}
  .md-body pre{background:#0F1117;color:#E6E8EB;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:12.5px;line-height:1.5;}
  .md-body pre code{background:none;color:inherit;padding:0;}
  .md-body blockquote{margin:14px 0;padding:8px 14px;border-left:3px solid var(--accent);background:var(--accent-weak);border-radius:0 6px 6px 0;}
  .md-body table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px;}
  .md-body th,.md-body td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top;}
  .md-body th{background:#F5F6F8;font-weight:600;}
  .md-body hr{border:0;border-top:1px solid var(--line);margin:24px 0;}
  .err{color:#b00020;}

  /* Mobile: off-canvas drawer */
  @media (max-width:767px){
    .sidebar{position:fixed;top:var(--topbar-h);left:0;height:calc(100vh - var(--topbar-h));z-index:40;flex-basis:auto;width:var(--sidebar-w);transform:translateX(-100%);transition:transform .22s cubic-bezier(.4,0,.2,1);}
    [data-sidebar="open"] .sidebar{transform:translateX(0);}
    [data-sidebar="closed"] .sidebar{width:var(--sidebar-w);}
    .scrim{top:var(--topbar-h);}
    [data-sidebar="open"] .scrim{opacity:1;visibility:visible;}
    .md-body{padding:22px 18px;}
    .topbar{padding:0 10px;gap:9px;}
    .brand-tag{display:none;}
  }
  @media (prefers-reduced-motion:reduce){
    .sidebar,.scrim,.burger,.cat>summary::before{transition:none;}
  }`;

const SCRIPT = `
(function(){
  var body=document.body;
  var frame=document.getElementById('frame');
  var welcome=document.getElementById('welcome');
  var curTitle=document.getElementById('cur-title');
  var curExt=document.getElementById('cur-ext');
  var burger=document.getElementById('burger');
  var scrim=document.getElementById('scrim');
  var mds=document.querySelectorAll('.md-body');
  var pane=document.querySelector('.pane');
  var mq=window.matchMedia('(max-width:767px)');
  var STORE='ayatori-index-sidebar';
  function setSidebar(open){
    body.setAttribute('data-sidebar', open?'open':'closed');
    burger.setAttribute('aria-expanded', open?'true':'false');
    if(!mq.matches){ try{ localStorage.setItem(STORE, open?'open':'closed'); }catch(e){} }
  }
  function isOpen(){ return body.getAttribute('data-sidebar')==='open'; }
  function initState(){
    if(mq.matches){ setSidebar(false); return; }
    var open=true;
    try{ if(localStorage.getItem(STORE)==='closed'){ open=false; } }catch(e){}
    setSidebar(open);
  }
  initState();
  burger.addEventListener('click', function(){ setSidebar(!isOpen()); });
  scrim.addEventListener('click', function(){ setSidebar(false); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && mq.matches && isOpen()){ setSidebar(false); } });
  var onMq=function(){ initState(); };
  if(mq.addEventListener){ mq.addEventListener('change', onMq); } else if(mq.addListener){ mq.addListener(onMq); }
  function show(kind,ref,link){
    welcome.hidden=true; frame.hidden=true;
    for(var i=0;i<mds.length;i++){ mds[i].hidden=true; }
    var prev=document.querySelector('.nav-link.active'); if(prev){ prev.classList.remove('active'); }
    link.classList.add('active');
    if(kind==='md'){ var d=document.getElementById(ref); if(d){ d.hidden=false; } }
    else { if(frame.getAttribute('src')!==ref){ frame.setAttribute('src',ref); } frame.hidden=false; }
    curTitle.textContent = link.getAttribute('data-label') || '成果物インデックス';
    var op=link.getAttribute('data-open');
    if(op){ curExt.setAttribute('href', op); curExt.hidden=false; } else { curExt.hidden=true; }
    if(pane){ pane.scrollTop=0; }
    if(mq.matches){ setSidebar(false); }
  }
  var links=document.querySelectorAll('.nav-link');
  for(var i=0;i<links.length;i++){ (function(a){ a.addEventListener('click', function(e){ e.preventDefault(); show(a.getAttribute('data-kind'), a.getAttribute('data-ref'), a); }); })(links[i]); }
})();
`;

const render = (categories) => {
  const total = categories.reduce((s, c) => s + c.entries.length, 0);
  if (total === 0) {
    return `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="utf-8"><title>成果物インデックス — ${esc(APP)}</title>` +
      `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN",sans-serif;margin:3rem;color:#15171C;line-height:1.6}h1{font-weight:700}p{color:#626873}</style></head>` +
      `<body><h1>📦 ${esc(APP)}</h1><p>まだ成果物が見つかりません（部分実行 / 生成前）。パイプラインを進めてから再実行してください。</p></body></html>\n`;
  }
  let nav = "", pane = "", idc = 0;
  for (const cat of categories) {
    nav += `<details open class="cat"><summary><span class="cat-label">${esc(cat.label)}</span> <span class="n">${cat.entries.length}</span></summary><ul>`;
    for (const e of cat.entries) {
      const domId = `item-${idc++}`;
      const encRel = e.rel ? enc(e.rel) : "";
      const label = escAttr(e.label);
      if (e.kind === "synth") {
        nav += `<li><a class="nav-link" href="#" data-kind="md" data-ref="${domId}" data-label="${label}">${esc(e.label)}</a></li>`;
        pane += `<div class="md-body" id="${domId}" hidden><div class="md-head"><span>${esc(e.label)}</span></div>${e.html}</div>`;
      } else if (e.kind === "md") {
        nav += `<li><a class="nav-link" href="#" data-kind="md" data-ref="${domId}" data-label="${label}" data-open="${escAttr(encRel)}">${esc(e.label)}</a>` +
          `<a class="ext" href="${escAttr(encRel)}" target="_blank" rel="noopener" title="新しいタブで開く" aria-label="${label} を新しいタブで開く">↗</a></li>`;
        const md = readRel(e.rel);
        const body = md == null ? `<p class="err">読み込み失敗: ${esc(e.rel)}</p>` : mdToHtml(md);
        pane += `<div class="md-body" id="${domId}" hidden><div class="md-head"><span>${esc(e.label)}</span>` +
          `<a class="ext" href="${escAttr(encRel)}" target="_blank" rel="noopener">↗ 原文</a></div>${body}</div>`;
      } else {
        nav += `<li><a class="nav-link" href="#" data-kind="html" data-ref="${escAttr(encRel)}" data-label="${label}" data-open="${escAttr(encRel)}">${esc(e.label)}</a>` +
          `<a class="ext" href="${escAttr(encRel)}" target="_blank" rel="noopener" title="新しいタブで開く" aria-label="${label} を新しいタブで開く">↗</a></li>`;
      }
    }
    nav += `</ul></details>`;
  }
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>成果物インデックス — ${esc(APP)}</title>
<style>${STYLE}</style>
</head>
<body data-sidebar="open">
<header class="topbar">
  <button class="burger" id="burger" type="button" aria-expanded="true" aria-controls="sidebar" aria-label="サイドバーの表示切り替え"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
  <div class="brand"><span class="brand-mark">📦</span><span class="brand-name">${esc(APP)}</span><span class="brand-tag">index</span></div>
  <h1 class="cur-title" id="cur-title"></h1>
  <a class="cur-ext" id="cur-ext" href="#" target="_blank" rel="noopener" hidden>↗ 新しいタブ</a>
</header>
<div class="shell">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-inner">
      <div class="sidebar-head">${total} 件の成果物</div>
      <nav class="toc" aria-label="成果物目次">
        ${nav}
      </nav>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <main class="pane">
    <div id="welcome" class="welcome"><div class="welcome-inner">
      <p class="welcome-h">← 左のリストから成果物を選択</p>
      <p class="welcome-p">HTML 成果物はそのまま埋め込み表示、Markdown は整形して表示します。埋め込みが空白のときは各項目やヘッダーの ↗ で直接開けます。</p>
    </div></div>
    <iframe id="frame" hidden title="成果物プレビュー"></iframe>
    ${pane}
  </main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
};

// ── 実行 ────────────────────────────────────────────────────
const categories = buildCategories();
const html = render(categories);
const outPath = join(ROOT, "index.html");
writeFileSync(outPath, html, "utf8");
const total = categories.reduce((s, c) => s + c.entries.length, 0);
console.log(`[build-artifact-index] wrote ${outPath} (${categories.length} categories, ${total} items)`);
