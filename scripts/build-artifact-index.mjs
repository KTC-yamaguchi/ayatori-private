#!/usr/bin/env node
// scripts/build-artifact-index.mjs
//
// artifacts/{app_name}/ 配下の全成果物を 1 つの index.html (左カテゴリ目次 + 右コンテンツ)
// に集約する決定論的 renderer。要件 / 画面 / デザイン / 遷移図 / 採点 / 監査 / 状態 の
// 各成果物を curated whitelist でスキャンし、HTML 成果物は live sibling への iframe src で、
// Markdown は in-script renderer で描画する。二重クリックで開くだけで動く (サーバ不要)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/build-artifact-index.mjs <app-name | artifacts/app-name> [--lang en]
//   --lang en は英語版エクスポート (/ayatori-export-en) の EN ミラー再生成専用。index の
//   chrome ラベルのみ英語化し、埋め込みコンテンツはディレクトリ内ファイル (EN ミラーでは
//   翻訳済み) をそのまま描画する。
//   出力: 同ディレクトリの index.html (毎回フル上書き、SoT = ディレクトリ自身のスキャン結果)
// exit: 0 = 成功 / 1 = 引数なし / 2 = app ディレクトリ不在

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

import { parseLangArgv } from "./parse-lang-arg.mjs";
// 旧フォーマット判定 (必須セクションの有無) は pipeline-status.mjs の定義を共有する —
// 目次の「未記載」マークと /ayatori-status のカウンタが別々の正規表現を持つと、
// セクション増減時に片方だけ直して表示が食い違う。pipeline-status.mjs は import 時に
// 何も実行しない (CLI 分岐は isMain ガード付き)。
import { SPEC_REQUIRED_SECTIONS } from "./pipeline-status.mjs";

// ── 引数解決 ────────────────────────────────────────────────
const { positional: arg, lang } = parseLangArgv(process.argv.slice(2));
if (!arg || (lang !== "ja" && lang !== "en")) {
  console.error("usage: node scripts/build-artifact-index.mjs <app-name | artifacts/app-name> [--lang ja|en]");
  process.exit(1);
}

// chrome 文言の言語スイッチ (ja 既定 = 従来出力と byte 同一)。
const J = (ja, en) => (lang === "en" ? en : ja);
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

// md 内の相対リンクを「md ファイル自身の位置」基準から「index.html (app ルート) の位置」基準へ
// 付け替える。md 本文は index.html に埋め込んで表示されるため、素通しするとブラウザが
// index の位置で相対解決してしまい、`../requirements/*.md` 等が 1 階層ずれてリンク切れになる。
const rewriteRelLinks = (md, mdRel) => {
  const baseSegs = mdRel.split("/").slice(0, -1);
  // fenced code block と inline code span はコード例 (原文) なので付け替え対象にしない
  // (inline() の code span 保護は本関数の後段で効かないため、ここで両方マスクする)
  const fences = [];
  let masked = md.replace(/```[\s\S]*?```/g, (block) => { fences.push(block); return `\u0000f${fences.length - 1}\u0000`; });
  masked = masked.replace(/`[^`\n]+`/g, (span) => { fences.push(span); return `\u0000f${fences.length - 1}\u0000`; });
  const out = masked.replace(/\]\(([^)]+)\)/g, (m, url) => {
    if (/^(https?:|mailto:|#|\/)/i.test(url)) return m; // 外部 / アンカー / ルート絶対はそのまま
    const segs = [...baseSegs];
    for (const s of url.split("/")) {
      if (s === "" || s === ".") continue;
      if (s === "..") {
        // app ルートより上を指す ".." は握りつぶさず相対のまま残す (リンク先を app 内へ誤変換しない)
        if (segs.length && segs[segs.length - 1] !== "..") segs.pop();
        else segs.push("..");
      } else segs.push(s);
    }
    return `](${segs.join("/")})`;
  });
  return out.replace(/\u0000f(\d+)\u0000/g, (_, i) => fences[+i]);
};

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
    // ページ内アンカー以外は新しいタブで開く (index 自身が SPA 的な目次のため、本文リンクで遷移すると閲覧位置を失う)。
    /^(https?:|mailto:|#|\.{0,2}\/|[^:]*$)/i.test(url)
      ? `<a href="${url}"${url.startsWith("#") ? "" : ' target="_blank" rel="noopener"'}>${label}</a>`
      : label);
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

// ── 振る舞い詳細「操作イベント」表のパース (並べて表示ビューのカード材料) ──────
// rewriteRelLinks 済みの仕様書 md から「## 振る舞い詳細」配下の「### 操作イベント」表の行を
// 構造化して返す。7 列 (# / トリガー / 配置 / 事前条件・分岐 / 反応 / 異常・境界時 / 根拠) に
// 一致する行のみ採用し、旧フォーマット・表なしは空配列を返す fail-soft
// — 呼び出し側は空配列のとき並べて表示ビューを付与しない。列数不一致の行は
// テンプレート改定・セル崩れの信号として warn を残す (無音で捨てない)。
const parseOperationEvents = (mdRewritten, srcRel = "") => {
  const lines = mdRewritten.split("\n");
  const sect = lines.findIndex((ln) => /^##\s*振る舞い詳細/.test(ln));
  if (sect < 0) return [];
  const start = lines.findIndex((ln, i) => i > sect && /^###\s*操作イベント/.test(ln));
  if (start < 0) return [];
  const events = [];
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    // fenced code block 内はコード例 — 例示の |EV-…| 行を実イベントとして拾わない
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^#{1,6}\s/.test(lines[i])) break; // 次の見出し (h1〜h6) で終了
    const s = lines[i].trim();
    if (!s.startsWith("|") || !s.endsWith("|")) continue;
    // GFM エスケープ済みパイプ (\|) はセル区切りにせず、セル値として復元する
    const cells = s.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // 区切り行 (GFM 整列マーカー込み)
    if (cells[0] === "#") continue; // ヘッダ行
    if (cells.length !== 7) {
      console.warn(`[build-artifact-index] 操作イベント表の列数不一致 (${cells.length} 列, 期待 7) の行をスキップ: ${srcRel}`);
      continue;
    }
    events.push({ id: cells[0], trigger: cells[1], place: cells[2], precond: cells[3], reaction: cells[4], error: cells[5], evidence: cells[6] });
  }
  return events;
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
        ? J("要件承認 (Phase 0b reverse gate)", "Requirements approved (Phase 0b reverse gate)")
        : J("要件承認 (Phase 1b)", "Requirements approved (Phase 1b)"),
    baseline_approved_at:
      ap.baseline_approved_via === "screens-lite-gate"
        ? J("ベースライン承認", "Baseline approved")
        : ap.baseline_approved_via === "manual-stub"
          ? J("ベースライン承認 (手動 stub)", "Baseline approved (manual stub)")
          : J("ベースライン承認 (由来記録なし)", "Baseline approved (no provenance record)"),
    step13_approved_at: J("デザイン承認 (Phase 2)", "Design approved (Phase 2)"),
    step16_approved_at: J("画面設計承認 (遷移図・画面一覧)", "Screen design approved (transition map / screen list)"),
    screens_approved_at: J("画面 HTML 承認", "Screen HTML approved"),
    step23_approved_at: J("最終承認", "Final approval"),
    step24_completed_at: J("デザインシステム更新", "Design system updated"),
    step25_completed_at: J("コンポーネント生成", "Components built"),
    step25d_approved_at: J("サブステート承認", "Sub-states approved"),
    completed_at_states: J("完全完了 (sub-state 含む)", "Fully complete (incl. sub-states)"),
  };
  const events = Object.keys(APPROVAL_LABELS)
    .filter((k) => typeof ap[k] === "string" && ap[k])
    .map((k) => ({ label: APPROVAL_LABELS[k], t: ap[k] }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (events.length) {
    parts.push(`<h2>${J("タイムライン", "Timeline")}</h2><ul class="rs-timeline">` +
      events.map((e) => `<li>${esc(e.label)}<span class="t">${esc(fmtTime(e.t))}</span></li>`).join("") + `</ul>`);
  }

  const dl = [];
  const sel = (st && st.selections) || {};
  if (sel.selected_sample_direction || sel.selected_sample_id) {
    const id = sel.selected_sample_id
      ? J(`案${String(sel.selected_sample_id).toUpperCase()}`, `Option ${String(sel.selected_sample_id).toUpperCase()}`)
      : "";
    dl.push([J("選択デザイン", "Selected design"), `${id}${sel.selected_sample_direction ? " " + sel.selected_sample_direction : ""}`.trim()]);
  }
  if (scores && scores.current && scores.current.total != null) {
    const attempts = Array.isArray(scores.history) ? scores.history.length : (scores.current.attempt || null);
    dl.push([J("デザイン採点", "Design score"), `${scores.current.total}${J(" 点", " pts")}${attempts ? ` (${attempts} attempts)` : ""}`]);
  }
  if (dl.length) {
    parts.push(`<h2>${J("結果", "Results")}</h2><dl class="rs-dl">` +
      dl.map((kv) => `<dt>${esc(kv[0])}</dt><dd>${esc(kv[1])}</dd>`).join("") + `</dl>`);
  }

  const runs = (deltaHist && Array.isArray(deltaHist.runs)) ? deltaHist.runs : [];
  if (runs.length) {
    parts.push(`<h2>${J("デルタ変更履歴", "Delta change history")} <span class="rs-count">(${runs.length})</span></h2><ul class="rs-changes">` +
      runs.slice().reverse().map((r) => {
        const scr = (r.screens_affected != null) ? ` · ${J("影響画面", "screens affected")} ${esc(String(r.screens_affected))}` : "";
        return `<li><span class="d">${esc(fmtTime(r.date))}</span>${scr}<div>${esc(r.change_description || "")}</div></li>`;
      }).join("") + `</ul>`);
  }

  if (!parts.length) return null;
  parts.push(`<p class="rs-note">${J(
    "詳細な修正・指摘イベント (Pattern A/B/C/D) は「フィードバックログ」を参照。",
    "See \"Feedback log\" for detailed fix / review events (Pattern A/B/C/D).",
  )}</p>`);
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
  if (existsFile("ground-truth/index.md")) revEntries.push({ label: J("証拠アーカイブ索引 (文書)", "Evidence archive index (documents)"), rel: "ground-truth/index.md", kind: "md" });

  // デザイン (MD + HTML)
  const designEntries = [];
  if (existsFile("style-guide.md")) designEntries.push({ label: J("スタイルガイド (MD)", "Style guide (MD)"), rel: "style-guide.md", kind: "md" });
  if (existsFile("screens/style-guide-view.html")) designEntries.push({ label: J("パーツカタログ (HTML)", "Component catalog (HTML)"), rel: "screens/style-guide-view.html", kind: "html" });
  for (const plat of ["web", "mobile"]) {
    const live = `design-samples/${plat}/index.html`;
    if (existsFile(live)) designEntries.push({ label: J(`デザイン案 · ${plat} (3案切替)`, `Design options · ${plat} (3-way toggle)`), rel: live, kind: "html" });
    else {
      const arch = newestArchivedDesignSample(plat);
      if (arch) designEntries.push({ label: J(`デザイン案 · ${plat} (アーカイブ)`, `Design options · ${plat} (archived)`), rel: arch, kind: "html" });
    }
  }
  // 21a: グラフィック必要性の推奨レポート (存在時のみ — degrade skip 時は不在)
  if (existsFile("graphics/graphic-recommend.md")) designEntries.push({ label: J("グラフィック必要性 推奨レポート", "Graphics-need recommendation report"), rel: "graphics/graphic-recommend.md", kind: "md" });
  // 候補スロット視覚レポート (派生 HTML — 候補 0 件 / render 失敗時は不在)
  if (existsFile("graphics/graphic-recommend.html")) designEntries.push({ label: J("グラフィック候補スロット 視覚レポート", "Graphic candidate slots visual report"), rel: "graphics/graphic-recommend.html", kind: "html" });

  // 画面 (MD 仕様 + HTML、main → 状態バリアント順)
  // 仕様 md と画面 HTML は slug (ファイル名 stem) を共通キーとしてラベルに含め、目次上で同一画面と対応付けられるようにする
  const screenEntries = [];
  if (existsFile("screens/00-screen-list.md")) screenEntries.push({ label: J("画面一覧", "Screen list"), rel: "screens/00-screen-list.md", kind: "md" });
  const screenNameBySlug = new Map(); // slug → 画面名 (仕様 md の H1 から「 画面仕様」suffix を除いたもの)
  for (const f of listDir("screens").filter((f) => f.endsWith(".md") && !f.startsWith("00-") && !f.startsWith("_")).sort()) {
    const slug = f.replace(/\.md$/, "");
    const h1 = firstH1(`screens/${f}`) || "";
    const screenName = h1.replace(/\s*画面仕様\s*$/, "").trim();
    if (screenName) screenNameBySlug.set(slug, screenName);
    // EN ミラーでは見出しが LLM 翻訳されて日本語アンカーに一致しないため、旧フォーマット検知と
    // 並べて表示は ja 専用 (en で走らせると全画面を誤検知するだけで意味を持たない)。
    // 旧フォーマット (必須セクションが欠けているもの) を目次で見分けられるようにする。
    // どのセクションが無いかを並記する — 片方だけ欠けている仕様書も区別できるようにするため。
    // 読めないファイルは旧フォーマットと断定しない (fail-soft)。
    // 判定式は pipeline-status.mjs の SPEC_REQUIRED_SECTIONS を共有 (ここで再定義しない)。
    // 区切りは /ayatori-status の表示と同じ " / " — 同じ不足を 2 つの画面で見比べるときに
    // 表記が揺れないようにする。
    const md = readRel(`screens/${f}`);
    const jaSpec = lang === "ja" && md != null;
    const missingSections = jaSpec ? SPEC_REQUIRED_SECTIONS.filter((sec) => !sec.re.test(md)).map((sec) => sec.label) : [];
    const hasBehavior = jaSpec && !missingSections.includes("振る舞い詳細");
    const legacyMark = missingSections.length ? ` · ${missingSections.join(" / ")} 未記載` : "";
    // 並べて表示ビュー (左: 操作イベントカード / 右: 画面 HTML): 操作イベントが読み取れ、
    // かつ同じ slug の default 状態 HTML が 1 platform 以上あるときだけ付与する。
    // 仕様書は CSS セレクタを持たない設計のため、要素単位の対応付けはせず並置のみ。
    // 並べて表示は「振る舞い詳細」の操作イベント表が材料。データ項目 だけが欠けている
    // 仕様書でもビューは出す (欠けているセクションに依存しない判定にする)。
    let split = null;
    if (hasBehavior) {
      const events = parseOperationEvents(rewriteRelLinks(md, `screens/${f}`), `screens/${f}`);
      const frames = [];
      for (const plat of ["web", "web-sm", "mobile"]) {
        // default 状態の main HTML を探す。dual_theme プロジェクトの main は theme suffix 付き
        // ({slug}--light.html / --dark.html) なので、"--" の一括除外はせず、完全一致 →
        // --light → --dark の順で決定的に選ぶ (sub-state の --empty 等は一致しないため除外される)。
        const files = listDir(`screens/${plat}`).filter((x) => x.endsWith(".html"));
        const base = (x) => x.replace(/\.html$/, "");
        const hit = files.find((x) => base(x) === slug)
          || files.find((x) => base(x) === `${slug}--light`)
          || files.find((x) => base(x) === `${slug}--dark`);
        if (hit) frames.push({ plat, label: plat === "web" ? "Web" : plat === "web-sm" ? "Web (スマホ幅)" : "Mobile", rel: `screens/${plat}/${hit}` });
      }
      if (events.length && frames.length) split = { events, frames };
    }
    screenEntries.push({ label: `${J("仕様", "Spec")}: ${slug}${screenName ? ` (${screenName})` : ""}${legacyMark}`, rel: `screens/${f}`, kind: "md", split });
  }
  for (const plat of ["web", "web-sm", "mobile"]) {
    const platLabel = plat === "web" ? "Web" : plat === "web-sm" ? J("Web (スマホ幅)", "Web (phone width)") : "Mobile";
    const files = listDir(`screens/${plat}`).filter((f) => f.endsWith(".html"));
    files.sort((a, b) => {
      const pa = a.replace(/\.html$/, "").split("--"), pb = b.replace(/\.html$/, "").split("--");
      return pa[0].localeCompare(pb[0]) || pa.slice(1).join("--").localeCompare(pb.slice(1).join("--"));
    });
    for (const f of files) {
      const stem = f.replace(/\.html$/, "");
      const baseSlug = stem.split("--")[0]; // theme/state suffix は "--" 区切りなので先頭分だけで slug になる (-dark 等を再切断すると 04-mode-dark のような正当な slug を壊す)
      const screenName = screenNameBySlug.get(baseSlug);
      screenEntries.push({ label: `${platLabel} · ${stem.replace(/--/g, " · ")}${screenName ? ` (${screenName})` : ""}`, rel: `screens/${plat}/${f}`, kind: "html" });
    }
  }

  // 画面遷移 (HTML、Mermaid CDN 依存 = オフラインで空白の可能性)
  const transEntries = [];
  if (existsFile("screens/00-transition-map.html")) transEntries.push({ label: J("画面遷移図 ⚠ 要オンライン (Mermaid)", "Transition map ⚠ requires online (Mermaid)"), rel: "screens/00-transition-map.html", kind: "html" });

  // 採点 (HTML、相対 scoring.css 参照 → iframe 必須)
  const scoreEntries = [];
  if (existsFile("scoring-dashboard.html")) scoreEntries.push({ label: J("スコアダッシュボード", "Scoring dashboard"), rel: "scoring-dashboard.html", kind: "html" });
  if (existsFile("scoring-history.html")) scoreEntries.push({ label: J("スコア履歴", "Scoring history"), rel: "scoring-history.html", kind: "html" });

  // 監査 (HTML 派生ビュー + 突合レポート)
  const auditEntries = [];
  if (existsFile("requirement-deviations-view.html")) auditEntries.push({ label: J("要件外追加リスト", "Requirement deviation list"), rel: "requirement-deviations-view.html", kind: "html" });
  // 対象限定突合 (Phase 0c) のレポート。判断の根拠 (初読 / 再読の引用) を持つため、
  // 逸脱リストと並べて 1 画面から辿れるようにする。
  if (existsFile("reverse-verify/crosscheck-report.md")) auditEntries.push({ label: J("対象限定突合レポート", "Targeted cross-check report"), rel: "reverse-verify/crosscheck-report.md", kind: "md" });
  if (existsFile("screens/color-lint-report.html")) auditEntries.push({ label: J("色 lint レポート", "Color lint report"), rel: "screens/color-lint-report.html", kind: "html" });

  // 実行履歴 (合成サマリー + feedback-log)。session-handoff.md は実行状態 SoT でない
  // disposable メモのため非表示。
  const histEntries = [];
  const runSummary = buildRunSummary();
  if (runSummary) histEntries.push({ label: J("実行サマリー", "Run summary"), kind: "synth", html: runSummary });
  if (existsFile("feedback-log.md")) histEntries.push({ label: J("フィードバックログ", "Feedback log"), rel: "feedback-log.md", kind: "md" });

  return [
    { id: "reverse", label: J("リバース (証拠・ドラフト)", "Reverse (evidence / drafts)"), entries: revEntries },
    { id: "requirements", label: J("要件定義", "Requirements"), entries: reqEntries },
    { id: "design", label: J("デザイン", "Design"), entries: designEntries },
    { id: "screens", label: J("画面", "Screens"), entries: screenEntries },
    { id: "transition", label: J("画面遷移", "Transitions"), entries: transEntries },
    { id: "scoring", label: J("スコアリング", "Scoring"), entries: scoreEntries },
    { id: "audit", label: J("監査", "Audit"), entries: auditEntries },
    { id: "history", label: J("実行履歴", "Run history"), entries: histEntries },
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
  /* 先頭へ戻る: 内容が 4 画面分を超え、2 画面分スクロールしてから現れる (短い成果物では出さない)。
     位置は動かさない。scrim (z-index:30) より下に置き、モバイルでサイドバーを開いたときは覆われる。
     アイコンだけにせずテキストも出す (矢印だけでは意味が伝わらないため)。
     可視テキストがそのままアクセシブル名になるので aria-label は付けない。 */
  .totop{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:20;
    display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;
    font:inherit;font-size:13px;color:var(--accent-ink);background:var(--surface);
    border:1px solid var(--line);border-radius:999px;cursor:pointer;
    box-shadow:0 6px 20px -8px rgba(15,17,20,.28),0 1px 2px rgba(15,17,20,.06);
    opacity:0;visibility:hidden;pointer-events:none;}
  .totop.on{opacity:1;visibility:visible;pointer-events:auto;}
  .totop:hover{background:var(--accent-weak);}
  .totop:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  @media (prefers-reduced-motion: no-preference){ .totop{transition:opacity .18s;} }
  @media print{ .totop{display:none;} }
  #frame{position:absolute;inset:0;width:100%;height:100%;border:0;}
  .welcome{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:32px;}
  .welcome[hidden]{display:none;}
  .welcome-inner{max-width:460px;text-align:center;}
  .welcome-h{font-size:16px;font-weight:600;margin:0 0 8px;}
  .welcome-p{font-size:13px;color:var(--muted);margin:0;line-height:1.65;}

  /* Markdown pane */
  .md-body{padding:30px 36px;max-width:1080px;}
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
  .md-head{position:sticky;top:0;z-index:5;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:12px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--line);margin:-30px -36px 22px;padding:16px 36px 10px;}
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

  /* 振る舞い詳細 × 画面 並べて表示 */
  .split-btn{margin-left:auto;flex:0 0 auto;font-size:12.5px;font-weight:600;color:#fff;background:var(--accent);border:1px solid var(--accent);border-radius:8px;padding:7px 14px;cursor:pointer;letter-spacing:0;box-shadow:0 1px 4px rgba(59,91,219,.28);}
  .split-btn:hover{background:var(--accent-ink);border-color:var(--accent-ink);}
  .split-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  .split-body{position:absolute;inset:0;display:flex;min-height:0;background:var(--surface);}
  .split-body[hidden]{display:none;}
  .split-left{flex:1 1 auto;min-width:300px;overflow-y:auto;background:var(--bg);padding:12px 16px 24px;}
  .split-left-head{position:sticky;top:0;z-index:5;background:var(--bg);margin:-12px -16px 12px;padding:10px 16px 8px;border-bottom:1px solid var(--line);}
  .split-back{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--accent-ink);background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:7px 14px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.08);}
  .split-back:hover{background:var(--accent-weak);}
  .split-back:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  .ev-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:0 0 10px;}
  .ev-top{display:flex;align-items:center;gap:8px;margin-bottom:4px;}
  .ev-id{font-family:var(--mono);font-size:11px;color:var(--accent-ink);background:var(--accent-weak);border-radius:5px;padding:1px 6px;}
  .ev-place{font-family:var(--mono);font-size:10.5px;color:var(--muted);background:#EEF0F3;border-radius:999px;padding:1px 8px;}
  .ev-trigger{font-size:13.5px;font-weight:600;margin:0 0 3px;}
  .ev-react{font-size:12.5px;color:#2b3038;line-height:1.55;}
  .ev-react::before{content:"→ ";color:var(--muted);}
  .ev-more{margin-top:6px;}
  .ev-more summary{font-size:11.5px;color:var(--muted);cursor:pointer;}
  .ev-row{display:flex;gap:8px;font-size:12px;margin-top:5px;line-height:1.5;}
  .ev-k{flex:0 0 auto;color:var(--muted);}
  .ev-card a{color:var(--accent);text-decoration:none;}
  .ev-card a:hover{text-decoration:underline;}
  .ev-card code{font-family:var(--mono);font-size:.85em;background:#F2F3F5;padding:1px 4px;border-radius:4px;}
  .split-note{font-size:11.5px;color:var(--muted);margin:14px 2px 0;}
  .split-divider{flex:0 0 6px;cursor:col-resize;background:var(--line);transition:background .12s;touch-action:none;}
  .split-divider:hover{background:var(--accent);}
  .split-body.dragging{user-select:none;}
  .split-body.dragging .split-frame{pointer-events:none;}
  .split-right{flex:0 0 var(--split-right-w,55%);display:flex;flex-direction:column;min-width:320px;background:var(--surface);}
  .split-tabs{flex:0 0 auto;display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line);}
  .split-tabs:empty{display:none;}
  .split-tab{font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);cursor:pointer;color:var(--muted);}
  .split-tab.active{color:var(--accent-ink);background:var(--accent-weak);border-color:var(--accent-weak);font-weight:600;}
  .split-frame-wrap{flex:1 1 auto;position:relative;overflow:hidden;}
  .split-frame{position:absolute;top:0;left:0;width:100%;height:100%;border:0;transform-origin:top left;}

  /* Mobile: off-canvas drawer */
  @media (max-width:767px){
    .sidebar{position:fixed;top:var(--topbar-h);left:0;height:calc(100vh - var(--topbar-h));z-index:40;flex-basis:auto;width:var(--sidebar-w);transform:translateX(-100%);transition:transform .22s cubic-bezier(.4,0,.2,1);}
    [data-sidebar="open"] .sidebar{transform:translateX(0);}
    [data-sidebar="closed"] .sidebar{width:var(--sidebar-w);}
    .scrim{top:var(--topbar-h);}
    [data-sidebar="open"] .scrim{opacity:1;visibility:visible;}
    .md-body{padding:22px 18px;}
    .md-head{margin:-22px -18px 18px;padding:12px 18px 8px;}
    .topbar{padding:0 10px;gap:9px;}
    .brand-tag{display:none;}
    .split-body{flex-direction:column;}
    .split-left{flex:0 0 46%;min-width:0;border-bottom:1px solid var(--line);}
    .split-divider{display:none;}
    .split-right{flex:1 1 auto;min-width:0;}
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
  var HP='#v=';   // 表示状態ハッシュの接頭辞 (要素 id と衝突しない形にする)
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
  var splits=document.querySelectorAll('.split-body');
  function hideAll(){
    welcome.hidden=true; frame.hidden=true;
    for(var i=0;i<mds.length;i++){ mds[i].hidden=true; }
    for(var i=0;i<splits.length;i++){ splits[i].hidden=true; }
  }
  // 「戻る/進む」で離れる前のスクロール位置に帰るための記憶。表示切替のたびに
  // 離れる側の位置を控え、履歴移動のときだけ復元する — 目次の直接クリックは
  // 従来どおり先頭表示のまま (同じ項目をもう一度押して先頭に戻る操作を残す)。
  // セッション内のみのメモリ保持 (再読み込みで消える。読み直し時に途中から
  // 始まると驚くため永続化しない)。
  // 対象は md 成果物のみ — html 成果物 (#frame) は iframe 内部がスクロールするので
  // pane.scrollTop は常に 0 であり、復元も「先頭へ戻る」も原理的に効かない (仕様)。
  var scrollPos={};
  var WELCOME_KEY='~~welcome';
  function curKey(){
    var a=document.querySelector('.nav-link.active');
    return a ? (a.getAttribute('data-hash')||'') : (welcome.hidden ? '' : WELCOME_KEY);
  }
  function splitVisible(){
    for(var i=0;i<splits.length;i++){ if(!splits[i].hidden){ return true; } }
    return false;
  }
  function rememberScroll(){
    // split 表示中の実スクローラは .split-left であり pane は常に 0。
    // ここで記録すると仕様書の記憶位置が 0 で潰れる。
    if(!pane || splitVisible()){ return; }
    var k=curKey();
    if(k){ scrollPos[k]=pane.scrollTop; }
  }
  function applyScroll(key,restore){
    if(!pane){ return; }
    var y=(restore && key && scrollPos[key]!=null) ? scrollPos[key] : 0;
    pane.scrollTop=y;
  }
  function show(kind,ref,link,restore){
    rememberScroll();
    hideAll();
    var prev=document.querySelector('.nav-link.active'); if(prev){ prev.classList.remove('active'); }
    link.classList.add('active');
    if(kind==='md'){ var d=document.getElementById(ref); if(d){ d.hidden=false; } }
    else { if(frame.getAttribute('src')!==ref){ frame.setAttribute('src',ref); } frame.hidden=false; }
    curTitle.textContent = link.getAttribute('data-label') || ${JSON.stringify(J("成果物インデックス", "Artifact Index"))};
    var op=link.getAttribute('data-open');
    if(op){ curExt.setAttribute('href', op); curExt.hidden=false; } else { curExt.hidden=true; }
    var hk=link.getAttribute('data-hash');
    applyScroll(hk, restore);
    if(typeof queueTotop==='function'){ queueTotop(); }
    if(mq.matches){ setSidebar(false); }
    if(hk){ var want=HP+hk; if(location.hash!==want){ location.hash=want; } }
  }
  var links=document.querySelectorAll('.nav-link');
  for(var i=0;i<links.length;i++){ (function(a){ a.addEventListener('click', function(e){ e.preventDefault(); show(a.getAttribute('data-kind'), a.getAttribute('data-ref'), a, false); }); })(links[i]); }
  // ── 表示中の成果物を URL ハッシュに載せる (戻る/進む・ブックマーク・リンク共有) ──
  // file:// で開く前提のため history.pushState は使わない (file:// オリジンでは
  // SecurityError になる環境がある)。location.hash だけで表現する。
  // ハッシュが無い状態 = welcome なので、最初の遷移のあと「戻る」で welcome に帰る。
  // 並べて表示の開閉・platform タブ・ペイン幅は履歴に載せない (1 回の「戻る」で何が
  // 戻るのか予測できなくなるため。並べて表示からの復帰は「← 仕様書へ戻る」が担う)。
  function normKey(x){ try{ return decodeURIComponent(x); }catch(e){ return x; } }
  function linkByHash(key){
    // data-hash は encodeURIComponent 済み。location.hash をデコードして返す実装差に
    // 備え、両側をデコードして比較する (日本語ファイル名・synth キーで効く)
    var k=normKey(key);
    for(var i=0;i<links.length;i++){ if(normKey(links[i].getAttribute('data-hash')||'')===k){ return links[i]; } }
    return null;
  }
  function showWelcome(restore){
    rememberScroll();
    hideAll();
    var prev=document.querySelector('.nav-link.active'); if(prev){ prev.classList.remove('active'); }
    welcome.hidden=false;
    curTitle.textContent=${JSON.stringify(J("成果物インデックス", "Artifact Index"))};
    curExt.hidden=true;
    applyScroll(WELCOME_KEY, restore);
    if(typeof queueTotop==='function'){ queueTotop(); }
  }
  function applyHash(){
    var h=location.hash||'';
    // ハッシュ無し = welcome。それ以外で HP 接頭辞 以外のハッシュ (本文のページ内アンカー等) は
    // **自分のものではないので何もしない** — 奪うと読んでいた文書が消える。
    // ページ内アンカーを同一ページ遷移させる方針は md → HTML 変換側で宣言済み。
    if(h===''||h==='#'){ showWelcome(true); return; }
    if(h.indexOf(HP)!==0){ return; }
    var a=linkByHash(h.slice(HP.length));
    if(!a){ return; }                               // 未知のキー (古い共有リンク等) — 表示は壊さない
    if(a.classList.contains('active')){ return; }   // 自分が書いた hash — 再描画しない
    show(a.getAttribute('data-kind'), a.getAttribute('data-ref'), a, true);
  }
  window.addEventListener('hashchange', applyHash);
  if(location.hash.indexOf(HP)===0){ applyHash(); }
  // ── 先頭へ戻る ────────────────────────────────────────────
  // 出現条件は 2 段: 内容が 4 画面分より長い成果物で、かつ 2 画面分スクロールしたとき。
  // 短い成果物では出さない (常時表示は画面を塞ぐだけになる)。
  // 押したあとはフォーカスも先頭の操作要素へ移す — 画面が上に戻ったことは見えるが、
  // スクリーンリーダー利用者にはフォーカスが動かないと伝わらないため。
  var totop=document.getElementById('totop');
  var reduceMo=window.matchMedia('(prefers-reduced-motion: reduce)');
  var totopRaf=0;
  // 押した直後は smooth スクロールの途中で scroll イベントが走り、scrollTop がまだ深いため
  // ボタンが再点灯して点滅する。押下後は先頭付近 (h*2 以内) に戻るまで再点灯を抑える。
  var totopHold=false;
  function syncTotop(){
    totopRaf=0;
    if(!pane||!totop){ return; }
    var h=pane.clientHeight||1;
    var longEnough=pane.scrollHeight > h*4;
    var deep=pane.scrollTop > h*2;
    if(!deep){ totopHold=false; }
    totop.classList.toggle('on', !totopHold && longEnough && deep);
  }
  function queueTotop(){ if(!totopRaf){ totopRaf=requestAnimationFrame(syncTotop); } }
  if(pane && totop){
    pane.addEventListener('scroll', queueTotop, {passive:true});
    window.addEventListener('resize', queueTotop);
    totop.addEventListener('click', function(){
      totopHold=true;
      totop.classList.remove('on');
      pane.scrollTo({top:0, behavior: reduceMo.matches ? 'auto' : 'smooth'});
      // フォーカスは **表示中の成果物** の先頭の操作要素へ。非表示の .md-body も DOM に残っている
      // (hidden 属性で display:none) ので、pane 全体を document 順で探すと先頭の非表示文書の
      // リンクに当たり focus() が無音で失敗する。document 全体にもしない — topbar/サイドバーへ
      // 飛んで読んでいた文脈を失うため。
      var vis=pane.querySelector('.md-body:not([hidden]), .split-body:not([hidden])')||pane;
      var f=vis.querySelector('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if(!f){ vis.setAttribute('tabindex','-1'); f=vis; }
      try{ f.focus({preventScroll:true}); }catch(e){ f.focus(); }
    });
    syncTotop();
  }
  // 並べて表示ビュー: 仕様書ヘッダーのボタンで開き、左カード + 右 iframe を表示する。
  // iframe src は初回表示時に data-src から遅延セット (全 split を初期ロードしない)。
  // 右ペインが画面の設計幅 (data-w) より狭いときは切り取らず、scale で縮小して全体を見せる。
  function fitSplitFrame(sb){
    var wrap=sb.querySelector('.split-frame-wrap');
    var ifr=sb.querySelector('.split-frame');
    if(!wrap||!ifr){ return; }
    var natural=parseInt(ifr.getAttribute('data-w')||'0',10);
    var W=wrap.clientWidth, H=wrap.clientHeight;
    if(!natural || W>=natural){
      ifr.style.width='100%'; ifr.style.height='100%'; ifr.style.transform='none';
      return;
    }
    var s=W/natural;
    ifr.style.width=natural+'px';
    ifr.style.height=(H/s)+'px';
    ifr.style.transform='scale('+s+')';
  }
  var splitBtns=document.querySelectorAll('.split-btn');
  for(var i=0;i<splitBtns.length;i++){ (function(b){ b.addEventListener('click', function(){
    var d=document.getElementById(b.getAttribute('data-split'));
    if(!d){ return; }
    hideAll();
    d.hidden=false;
    var ifr=d.querySelector('.split-frame');
    if(ifr && !ifr.getAttribute('src')){ ifr.setAttribute('src', ifr.getAttribute('data-src')); }
    fitSplitFrame(d);
    curTitle.textContent=(b.getAttribute('data-label')||'')+' ⇆ 画面';
    if(pane){ pane.scrollTop=0; }
    if(typeof queueTotop==='function'){ queueTotop(); }
  }); })(splitBtns[i]); }
  window.addEventListener('resize', function(){
    for(var i=0;i<splits.length;i++){ if(!splits[i].hidden){ fitSplitFrame(splits[i]); } }
  });
  var backBtns=document.querySelectorAll('.split-back');
  for(var i=0;i<backBtns.length;i++){ (function(b){ b.addEventListener('click', function(){
    var nav=document.querySelector('.nav-link[data-kind="md"][data-ref="'+b.getAttribute('data-md')+'"]');
    if(nav){ nav.click(); }
  }); })(backBtns[i]); }
  // 左右の幅をドラッグで調整 (右ペイン幅 = split-body 右端からポインタまで。両側 320px を下限に clamp)
  var dividers=document.querySelectorAll('.split-divider');
  for(var i=0;i<dividers.length;i++){ (function(dv){
    dv.addEventListener('pointerdown', function(e){
      var sb=dv.parentElement;
      var rect=sb.getBoundingClientRect();
      sb.classList.add('dragging');
      dv.setPointerCapture(e.pointerId);
      var onMove=function(ev){
        var w=rect.right-ev.clientX;
        var min=320, max=Math.max(min, rect.width-320);
        if(w<min){ w=min; } if(w>max){ w=max; }
        sb.style.setProperty('--split-right-w', w+'px');
        fitSplitFrame(sb);
      };
      var onUp=function(){
        sb.classList.remove('dragging');
        dv.removeEventListener('pointermove', onMove);
        dv.removeEventListener('pointerup', onUp);
        dv.removeEventListener('pointercancel', onUp);
      };
      dv.addEventListener('pointermove', onMove);
      dv.addEventListener('pointerup', onUp);
      dv.addEventListener('pointercancel', onUp);
      e.preventDefault();
    });
  })(dividers[i]); }
  var splitTabs=document.querySelectorAll('.split-tab');
  for(var i=0;i<splitTabs.length;i++){ (function(t){ t.addEventListener('click', function(){
    var right=t.closest('.split-right'); if(!right){ return; }
    var ifr=right.querySelector('.split-frame');
    if(ifr){
      ifr.setAttribute('src', t.getAttribute('data-src'));
      ifr.setAttribute('data-w', t.getAttribute('data-w')||'0');
    }
    var tabs=right.querySelectorAll('.split-tab');
    for(var j=0;j<tabs.length;j++){ tabs[j].classList.remove('active'); }
    t.classList.add('active');
    fitSplitFrame(t.closest('.split-body'));
  }); })(splitTabs[i]); }
  // 本文内リンクの in-viewer 遷移: リンク先が index 登録済みの成果物なら、新しいタブではなく
  // 対応する目次リンクの click を発火して右ペイン内で表示を切り替える (未登録の宛先は従来どおり新しいタブ)。
  var relmap=window.__RELMAP__||{};
  var bodyLinks=document.querySelectorAll('.md-body a[href]:not(.ext), .split-left a[href]:not(.ext)');
  for(var i=0;i<bodyLinks.length;i++){ (function(a){
    var t=relmap[a.getAttribute('href')||''];
    if(!t){ return; }
    a.removeAttribute('target');
    a.addEventListener('click', function(e){
      e.preventDefault();
      var sel='.nav-link[data-kind="'+t.k+'"][data-ref="'+t.r+'"]';
      var nav=document.querySelector(sel);
      if(nav){ nav.click(); }
    });
  })(bodyLinks[i]); }
})();
`;

// 並べて表示ビュー (仕様書の操作イベントを左カードに、画面 HTML を右 iframe に並置)。
// 7 列表は左パネルにそのまま入らないため、イベントごとにカード 1 枚 (トリガー / 反応、
// 詳細は折りたたみ) へ再構成する。根拠リンクは md 本文と同じ in-viewer 遷移に接続される。
const renderSplit = (domId, e) => {
  const cards = e.split.events.map((ev) => {
    const rows = [];
    if (ev.precond && ev.precond !== "—") rows.push(`<div class="ev-row"><span class="ev-k">事前条件・分岐</span><span>${inline(ev.precond)}</span></div>`);
    if (ev.error && ev.error !== "—") rows.push(`<div class="ev-row"><span class="ev-k">異常・境界時</span><span>${inline(ev.error)}</span></div>`);
    rows.push(`<div class="ev-row"><span class="ev-k">根拠</span><span>${inline(ev.evidence)}</span></div>`);
    return `<article class="ev-card"><div class="ev-top"><span class="ev-id">${inline(ev.id)}</span><span class="ev-place">${inline(ev.place)}</span></div>` +
      `<div class="ev-trigger">${inline(ev.trigger)}</div>` +
      `<div class="ev-react">${inline(ev.reaction)}</div>` +
      `<details class="ev-more"><summary>詳細</summary>${rows.join("")}</details></article>`;
  }).join("");
  const tabs = e.split.frames.length > 1
    ? e.split.frames.map((fr, i) => `<button type="button" class="split-tab${i === 0 ? " active" : ""}" data-src="${escAttr(enc(fr.rel))}" data-w="${naturalFrameWidth(fr.plat)}">${esc(fr.label)}</button>`).join("")
    : "";
  // 右ペインの既定幅: モバイル画面はスマホ幅ぶんだけ確保し、残りを左のカードに使う
  // (50:50 固定だとカード文が無駄に折り返す)。Web 画面は広めに取る。境界はドラッグで調整可。
  const rightW = e.split.frames[0].plat === "mobile" ? "460px" : "55%";
  return `<div class="split-body" id="${domId}-split" hidden style="--split-right-w:${rightW}">` +
    `<div class="split-left"><div class="split-left-head"><button type="button" class="split-back" data-md="${domId}">← 仕様書へ戻る</button></div>` +
    `<div class="split-cards">${cards}</div>` +
    `<p class="split-note">入力チェック・操作制御・実装ノートは仕様書本文を参照。</p></div>` +
    `<div class="split-divider" title="ドラッグで幅を調整"></div>` +
    `<div class="split-right"><div class="split-tabs">${tabs}</div><div class="split-frame-wrap"><iframe class="split-frame" data-src="${escAttr(enc(e.split.frames[0].rel))}" data-w="${naturalFrameWidth(e.split.frames[0].plat)}" title="画面プレビュー"></iframe></div></div></div>`;
};

// 画面 HTML の設計幅 (platform 別)。右ペインがこの幅より狭いときは iframe を切り取らず、
// この幅でレンダリングしたものを transform: scale で縮小して全体を見せる (サムネイル的挙動)。
// file:// では iframe の中身を実測できない (Chrome は file 同士でも cross-origin 扱い) ため固定値。
// 判定キーは platform ディレクトリ名 (web / web-sm / mobile) — 表示ラベル文字列に結合させない。
// web の 1440 は scripts/lint-screen-frame.mjs の WEB_FRAME_WIDTH (body 固定幅の SoT) に一致させる
// (小さい値だと右端が切れ、1280≤幅<1440 では縮小 scale も発火しない)。
const naturalFrameWidth = (plat) => (plat === "web" ? 1440 : 430);

const render = (categories) => {
  const total = categories.reduce((s, c) => s + c.entries.length, 0);
  if (total === 0) {
    return `<!DOCTYPE html>\n<html lang="${lang}"><head><meta charset="utf-8"><title>${J("成果物インデックス", "Artifact Index")} — ${esc(APP)}</title>` +
      `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN",sans-serif;margin:3rem;color:#15171C;line-height:1.6}h1{font-weight:700}p{color:#626873}</style></head>` +
      `<body><h1>📦 ${esc(APP)}</h1><p>${J("まだ成果物が見つかりません（部分実行 / 生成前）。パイプラインを進めてから再実行してください。", "No artifacts found yet (partial run / before generation). Advance the pipeline and re-run.")}</p></body></html>\n`;
  }
  let nav = "", pane = "", idc = 0;
  // 本文内リンクの in-viewer 遷移用: 埋め込み md の相対リンク (app ルート基準に付け替え済) が
  // index に登録済みの成果物を指す場合、新しいタブではなく目次クリックと同じ表示切替に接続する。
  // キー = raw rel (本文 href と同値)、値 = 対応する目次リンクの data-kind / data-ref。
  const relToNav = {};
  // 表示状態を URL ハッシュに載せるための安定キー。rel パス基準にする —
  // domId (item-N) は目次内の位置連番なので、成果物が 1 つ増えると同じ URL が
  // 別の文書を指してしまい、共有リンク・ブックマークが静かに壊れる。
  // 同じ rel が 2 度出る場合は 2 件目以降に ~2 を付けて一意にする。
  const hashSeen = new Set();
  const hashKey = (e) => {
    const base = e.rel ? e.rel : `~${e.label}`;   // synth は rel を持たないので label で代替
    let k = base, n = 1;
    while (hashSeen.has(k)) { n += 1; k = `${base}~${n}`; }
    hashSeen.add(k);
    return escAttr(encodeURIComponent(k).replace(/%2F/g, "/"));
  };
  for (const cat of categories) {
    nav += `<details open class="cat"><summary><span class="cat-label">${esc(cat.label)}</span> <span class="n">${cat.entries.length}</span></summary><ul>`;
    for (const e of cat.entries) {
      const domId = `item-${idc++}`;
      const encRel = e.rel ? enc(e.rel) : "";
      const label = escAttr(e.label);
      const hk = hashKey(e);
      if (e.kind === "synth") {
        nav += `<li><a class="nav-link" href="#" data-kind="md" data-ref="${domId}" data-label="${label}" data-hash="${hk}">${esc(e.label)}</a></li>`;
        pane += `<div class="md-body" id="${domId}" hidden><div class="md-head"><span>${esc(e.label)}</span></div>${e.html}</div>`;
      } else if (e.kind === "md") {
        if (!(e.rel in relToNav)) relToNav[e.rel] = { k: "md", r: domId };
        nav += `<li><a class="nav-link" href="#" data-kind="md" data-ref="${domId}" data-label="${label}" data-open="${escAttr(encRel)}" data-hash="${hk}">${esc(e.label)}</a>` +
          `<a class="ext" href="${escAttr(encRel)}" target="_blank" rel="noopener" title="${J("新しいタブで開く", "Open in a new tab")}" aria-label="${J(`${label} を新しいタブで開く`, `${label} — open in a new tab`)}">↗</a></li>`;
        const md = readRel(e.rel);
        const body = md == null ? `<p class="err">${J("読み込み失敗", "Failed to load")}: ${esc(e.rel)}</p>` : mdToHtml(rewriteRelLinks(md, e.rel));
        // split は ja 専用 (screenEntries 構築時に lang でゲート済み) のためボタン文言は日本語のみ
        const splitBtn = e.split
          ? `<button class="split-btn" type="button" data-split="${domId}-split" data-label="${label}">⇆ 画面と並べて表示</button>`
          : "";
        pane += `<div class="md-body" id="${domId}" hidden><div class="md-head"><span>${esc(e.label)}</span>${splitBtn}` +
          `<a class="ext" href="${escAttr(encRel)}" target="_blank" rel="noopener">↗ ${J("原文", "Source")}</a></div>${body}</div>`;
        if (e.split) pane += renderSplit(domId, e);
      } else {
        if (e.rel && !(e.rel in relToNav)) relToNav[e.rel] = { k: "html", r: encRel };
        nav += `<li><a class="nav-link" href="#" data-kind="html" data-ref="${escAttr(encRel)}" data-label="${label}" data-open="${escAttr(encRel)}" data-hash="${hk}">${esc(e.label)}</a>` +
          `<a class="ext" href="${escAttr(encRel)}" target="_blank" rel="noopener" title="${J("新しいタブで開く", "Open in a new tab")}" aria-label="${J(`${label} を新しいタブで開く`, `${label} — open in a new tab`)}">↗</a></li>`;
      }
    }
    nav += `</ul></details>`;
  }
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${J("成果物インデックス", "Artifact Index")} — ${esc(APP)}</title>
<style>${STYLE}</style>
</head>
<body data-sidebar="open">
<header class="topbar">
  <button class="burger" id="burger" type="button" aria-expanded="true" aria-controls="sidebar" aria-label="${J("サイドバーの表示切り替え", "Toggle sidebar")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
  <div class="brand"><span class="brand-mark">📦</span><span class="brand-name">${esc(APP)}</span><span class="brand-tag">index</span></div>
  <h1 class="cur-title" id="cur-title"></h1>
  <a class="cur-ext" id="cur-ext" href="#" target="_blank" rel="noopener" hidden>↗ ${J("新しいタブ", "New tab")}</a>
</header>
<div class="shell">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-inner">
      <div class="sidebar-head">${total}${J(" 件の成果物", " artifacts")}</div>
      <nav class="toc" aria-label="${J("成果物目次", "Artifact table of contents")}">
        ${nav}
      </nav>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <main class="pane">
    <div id="welcome" class="welcome"><div class="welcome-inner">
      <p class="welcome-h">${J("← 左のリストから成果物を選択", "← Select an artifact from the list on the left")}</p>
      <p class="welcome-p">${J("HTML 成果物はそのまま埋め込み表示、Markdown は整形して表示します。埋め込みが空白のときは各項目やヘッダーの ↗ で直接開けます。", "HTML artifacts are embedded as-is; Markdown is rendered inline. If an embed is blank, open it directly via the ↗ on each item or in the header.")}</p>
    </div></div>
    <iframe id="frame" hidden title="${J("成果物プレビュー", "Artifact preview")}"></iframe>
    ${pane}
  </main>
  <button type="button" id="totop" class="totop">
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 11.5V3M3.2 6.3 7 2.5l3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span>${J("先頭へ戻る", "Back to top")}</span>
  </button>
</div>
<script>window.__RELMAP__=${JSON.stringify(relToNav).replace(/</g, "\\u003c")};</script>
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
