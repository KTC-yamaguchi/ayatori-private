#!/usr/bin/env node
// Step 21a (graphic-recommend) の Step 2b — 候補スロット視覚レポートの決定的生成。
// 「候補の場所を図で示す HTML レポート」(Producer 提案の 2 ファイル構成 — MD=テキスト詳細 /
// HTML=見た目で判断。SAMPLE: Confluence 4061397312)。
//
// usage: node render-recommend-html.mjs <app_name>
//
// SoT は graphics/graphic-recommend.md (§4 候補スロット表 + ayatori:slot-anchors コメント) で、
// 本 script はそこから graphics/graphic-recommend.html を**毎回丸ごと再生成する派生ビュー**
// (render-color-report.mjs / build-artifact-index.mjs と同じ「手焼き禁止」レンダラ)。
// 各 slot ごとに該当画面 HTML を <iframe srcdoc> で埋め込み、anchor が解決できた場合は
// ハイライトリング + 「候補 N」バッジを重畳して該当位置へ自動スクロールする。
// srcdoc 内の相対 <img> (delta / feature-add 再実行時は既存グラフィックの C-26 参照が画面に
// 埋まっている) は data URI に内包して自己完結させる — 21g render-embed-review.mjs と同型
// (POCTEAMA-401: 閲覧環境の file:// 子リソース読取ブロックで破像させない)。
//
// anchor 解決は fail-open — 解決不能でも画面プレビュー (リングなし) に degrade し、エラー停止
// しない (設計 docs/graphic-generation-design.md §8-4 と同方針)。anchor 語彙は
// refs/report-guide.md §7 が SoT: icon:{name}[:{nth}] / scene:{data-scene} / text:{逐語}。
//
// stdout に JSON を 1 個出力する (兄弟 script と同じ契約):
//   - 前提 NG:  { ok: false, code: "E_*", message }
//   - 生成 OK:  { ok: true, path, slots, highlighted, fallbacks[] }
// exit code は常に 0 (routing は JSON の code)。予期しない内部エラーのみ exit 1
// (SKILL.md 側で「render 失敗 → MD のみで続行」の fail-open に routing)。
// 依存: node stdlib のみ (Operating Principle 1 準拠)。DOM parser 不使用 — 文字列レベル走査
// (svg-scan.mjs 共有ヘルパ) で完結する。

import fs from "node:fs";
import path from "node:path";
import { repoRoot, resolveMainScreens, SCREEN_PLATFORMS } from "./preflight.mjs";
import { svgBlocks, svgSignature, enclosingStack, parseAttrs } from "./svg-scan.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// srcdoc 属性値は quote と & のみ escape すれば HTML として完全に埋め込める
const escSrcdoc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// ── graphic-recommend.md の §4 解析 (固定見出し構造 — refs/report-guide.md §1 が SoT) ──

function parseSection4(md) {
  const m = md.match(/^## 4\. [^\n]*\n([\s\S]*?)(?=^## |\n*$(?![\s\S]))/m);
  if (!m) return { rows: [], anchors: [], parse_error: "§4 見出しが見つかりません" };
  const body = m[1];

  const rows = [];
  for (const line of body.split("\n")) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] は先頭 "|" の左側 (空)。ヘッダ行 (# 列) と区切り行 (---) を除外
    if (!/^\d+$/.test(cells[1] ?? "")) continue;
    rows.push({
      n: Number(cells[1]),
      place: cells[2] ?? "",
      slot_type: cells[3] ?? "",
      recommendation: cells[4] ?? "",
    });
  }

  let anchors = [];
  let anchorError = null;
  const cm = body.match(/<!--\s*ayatori:slot-anchors\s*([\s\S]*?)-->/);
  if (cm) {
    try {
      const parsed = JSON.parse(cm[1]).slot_anchors ?? [];
      // slot-anchors は LLM が書くコメントのため、parse 成功でも形状違いはあり得る —
      // parse 失敗と同じ anchorError 経路 (リングなしプレビュー) に degrade する (fail-open)
      if (Array.isArray(parsed)) anchors = parsed;
      else anchorError = `slot_anchors が array ではありません (実際: ${typeof parsed})`;
    } catch (e) {
      anchorError = `slot-anchors コメントの JSON parse 失敗: ${e.message}`;
    }
  }
  return { rows, anchors, anchor_error: anchorError };
}

// ── anchor 解決 (文字列レベル・決定的) — 対象タグに data-ayatori-slot="{n}" を注入する ──

// text: anchor 用 — idx 位置を包む最内の open tag の offset (tag stack 走査は svg-scan と共有)
const enclosingTagOffset = (body, idx) => {
  const stack = enclosingStack(body, idx);
  return stack.length ? stack[stack.length - 1].offset : -1;
};

const injectAttrAt = (body, tagOffset, n) => {
  const tagNameEnd = tagOffset + body.slice(tagOffset).match(/^<[a-zA-Z][a-zA-Z0-9-]*/)[0].length;
  return body.slice(0, tagNameEnd) + ` data-ayatori-slot="${n}"` + body.slice(tagNameEnd);
};

/**
 * @returns {{ body, resolved: boolean, reason?: string }} — 解決不能でも body は返す (fail-open)
 */
function resolveAnchor(body, anchor, n, appRoot) {
  if (!anchor) return { body, resolved: false, reason: "anchor 指定なし" };
  const [kind, ...rest] = String(anchor).split(":");
  const arg = rest.join(":");

  if (kind === "icon") {
    const parts = arg.split(":");
    const nth = parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]) ? Number(parts.pop()) : null;
    const name = parts.join(":");
    const canonPath = path.join(appRoot, "icons", `${name}.svg`);
    if (!fs.existsSync(canonPath)) return { body, resolved: false, reason: `正典 icons/${name}.svg 不在` };
    const canonSig = svgSignature(fs.readFileSync(canonPath, "utf8"));
    if (!canonSig) return { body, resolved: false, reason: `icons/${name}.svg が署名不能` };
    const hits = [];
    for (const { start, html } of svgBlocks(body)) if (svgSignature(html) === canonSig) hits.push(start);
    const targets = nth ? (hits[nth - 1] !== undefined ? [hits[nth - 1]] : []) : hits;
    if (!targets.length) return { body, resolved: false, reason: `icon:${arg} が画面内で未一致 (出現 ${hits.length} 件)` };
    for (const t of targets.sort((a, b) => b - a)) body = injectAttrAt(body, t, n);
    return { body, resolved: true };
  }

  if (kind === "scene") {
    const re = /<div(?:"[^"]*"|'[^']*'|[^>"'])*class=["'][^"']*illust-placeholder[^"']*["'](?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      if ((m[0].match(/data-scene=["']([^"']*)["']/) ?? [])[1] === arg) {
        return { body: injectAttrAt(body, m.index, n), resolved: true };
      }
    }
    return { body, resolved: false, reason: `scene:${arg} の illust-placeholder が未検出` };
  }

  if (kind === "text") {
    const hits = [];
    for (let i = body.indexOf(arg); i !== -1 && hits.length < 3; i = body.indexOf(arg, i + 1)) hits.push(i);
    if (hits.length !== 1) {
      return { body, resolved: false, reason: `text:「${arg}」の出現が ${hits.length} 件 (一意 1 件のみ解決可)` };
    }
    const off = enclosingTagOffset(body, hits[0]);
    if (off < 0) return { body, resolved: false, reason: `text:「${arg}」の包含タグを特定できません` };
    return { body: injectAttrAt(body, off, n), resolved: true };
  }

  if (kind === "class") {
    // 同一 class token を持つ**全要素**をハイライト (グループ slot 用 — 例: アクション一覧のサムネイル列)
    const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    const hits = [];
    let m;
    while ((m = re.exec(body)) !== null) {
      const cls = (parseAttrs(m[2])["class"] ?? "").split(/\s+/);
      if (cls.includes(arg)) hits.push(m.index);
    }
    if (!hits.length) return { body, resolved: false, reason: `class:${arg} の要素が未検出` };
    for (const t of hits.sort((a, b) => b - a)) body = injectAttrAt(body, t, n);
    return { body, resolved: true };
  }

  return { body, resolved: false, reason: `未知の anchor 種別: ${kind}` };
}

// ── srcdoc プレビュー組み立て (ハイライト overlay + 自動スクロールを注入) ──

const OVERLAY = `
<style>
.ayatori-slot-ring{position:absolute;border:3px solid #FF2D78;border-radius:10px;box-shadow:0 0 0 4px rgba(255,45,120,.25);pointer-events:none;z-index:2147483000}
.ayatori-slot-tag{position:absolute;background:#FF2D78;color:#fff;font:700 12px/1.6 system-ui,sans-serif;padding:1px 8px;border-radius:6px;pointer-events:none;z-index:2147483001}
</style>
<script>(function(){
// クリック / submit は無効化する (mock 内リンクへの誤遷移防止) — スクロールは許可
// (同一画面に複数候補が重畳されるため、視口外のリングへ人がスクロールで到達できる必要がある)
document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();},true);
document.addEventListener('submit',function(e){e.preventDefault();},true);
function go(){var els=document.querySelectorAll('[data-ayatori-slot]');if(!els.length)return;var minTop=null;els.forEach(function(el){var r=el.getBoundingClientRect();if(r.width===0&&r.height===0)return;if(minTop===null||r.top<minTop)minTop=r.top;var x=r.left+window.scrollX,y=r.top+window.scrollY;var ring=document.createElement('div');ring.className='ayatori-slot-ring';ring.style.left=(x-8)+'px';ring.style.top=(y-8)+'px';ring.style.width=(r.width+16)+'px';ring.style.height=(r.height+16)+'px';document.body.appendChild(ring);var tag=document.createElement('div');tag.className='ayatori-slot-tag';tag.textContent='候補 '+el.getAttribute('data-ayatori-slot');tag.style.left=(x-8)+'px';tag.style.top=Math.max(0,y-32)+'px';document.body.appendChild(tag);});
// 最上位 (最小 top) のリングを基準にスクロール — 複数候補の包囲箱の先頭が視口に入る
if(minTop!==null)window.scrollTo(0,Math.max(0,minTop+window.scrollY-window.innerHeight*.25));}
if(document.readyState==='complete'){setTimeout(go,80);}else{window.addEventListener('load',function(){setTimeout(go,80);});}})();</script>`;

const MIME_BY_EXT = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

/** 画面 HTML 内の相対 <img src> を base64 data URI に置換して自己完結化する
 *  (21g render-embed-review.mjs の同名ヘルパと同型 — POCTEAMA-401)。
 *  解決できない参照 (絶対 URL / 未知拡張子 / 境界外 / ファイル不在・読取失敗 / 不正
 *  percent-encoding) はそのまま残す fail-open — 従来どおり <base> 経由の相対解決に委ねる。
 *  内包を許す境界は screens/ 根 (= screenDir の親)。C-26 正典参照 (../_shared/graphics/) は
 *  screenDir の外・screens/ の中にあるため screenDir 配下には絞れない。境界外へ出る参照
 *  (絶対パス / 過剰な ../) は書き換えない — 手編集画面経由で樹外ファイルが共有前提の
 *  レビュー HTML に混入するのを防ぐ (PR #199 Copilot レビュー対応)。 */
function inlineLocalImages(body, screenDir) {
  const boundary = path.dirname(screenDir) + path.sep; // screens/ 根
  return body.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (m, pre, url, post) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return m; // http(s): / data: / protocol-relative / アンカーは対象外
    try {
      const rel = decodeURIComponent(url);
      const mime = MIME_BY_EXT[path.extname(rel).toLowerCase()];
      if (!mime) return m;
      const abs = path.resolve(screenDir, rel);
      if (!abs.startsWith(boundary)) return m;
      return `${pre}data:${mime};base64,${fs.readFileSync(abs).toString("base64")}${post}`;
    } catch {
      // 不正 encoding / ENOENT / EACCES / TOCTOU いずれも fail-open (render 全体を落とさない)
      return m;
    }
  });
}

function buildSrcdoc(body, platform, screenDir) {
  // Figma キャプチャ script はレポート内 iframe では不要 (誤キャプチャ防止のため除去)
  body = body.replace(/<script[^>]*html-to-design\/capture\.js[^>]*>\s*<\/script>\s*/gi, "");
  // 画像は data URI に内包 (自己完結化)。<base> は inline できなかった残余参照と <a> リンクの
  // 相対解決用に従来どおり挿入する — srcdoc の base URL は親 (graphics/graphic-recommend.html)
  // のため、screens/{platform}/ 基準へ戻す必要がある
  body = inlineLocalImages(body, screenDir);
  const base = `<base href="../screens/${platform}/">`;
  body = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => `${m}\n${base}`) : base + body;
  body = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${OVERLAY}\n</body>`) : body + OVERLAY;
  return body;
}

// ── レポート HTML (このページ自体) の組み立て ──

// web-sm = Web スマホ幅 (CLAUDE.md {platform} 定義) — viewport は mobile と同じスマホ幅
const VIEWPORTS = { mobile: { w: 390, h: 780, scale: 0.62 }, "web-sm": { w: 390, h: 780, scale: 0.62 }, web: { w: 1280, h: 800, scale: 0.42 } };

function recBadge(rec) {
  const v = (rec.match(/\*\*([^*]+)\*\*/) ?? [, rec])[1].trim();
  const cls = v.startsWith("必須") ? "must" : v.startsWith("推奨") ? "should" : "opt";
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

// 候補番号は §4 の # をそのまま使う (MD 表 ↔ 21b 箇所選択の返信番号 ↔ 本 HTML で同一番号 —
// 画面内連番 [1-1 等] に振り直すと同じ候補に 2 系統の番号ができ、ゲートでの指示が食い違うため)
function slotMeta(slot) {
  return [
    `<div class="slot-head"><span class="slot-no">候補 ${slot.n}</span>${recBadge(slot.recommendation)}<code>${esc(slot.slot_type)}</code></div>`,
    `<div class="slot-place">${esc(slot.place.replace(/`/g, ""))}</div>`,
    `<div class="slot-reason">${esc(slot.recommendation.replace(/\*\*[^*]+\*\*\s*—?\s*/, ""))}</div>`,
    slot.note ? `<div class="slot-note">ℹ️ ${esc(slot.note)}</div>` : "",
  ].join("\n");
}

// 画面単位の section (同一画面の複数候補は 1 プレビューに重畳表示)
function screenSection(group) {
  const metas = group.slots.map((s) => `<div class="slot-meta">\n${slotMeta(s)}\n</div>`).join("\n");
  let preview;
  if (group.srcdoc) {
    const vp = VIEWPORTS[group.platform] ?? VIEWPORTS.mobile;
    preview = `<div class="frame" style="width:${Math.round(vp.w * vp.scale)}px;height:${Math.round(vp.h * vp.scale)}px">
  <iframe loading="lazy" title="${esc(group.screen)}" style="width:${vp.w}px;height:${vp.h}px;transform:scale(${vp.scale})" srcdoc="${escSrcdoc(group.srcdoc)}"></iframe>
</div>`;
  } else {
    preview = `<div class="frame frame-empty">画面プレビューなし</div>`;
  }
  // "1 / 7" は「7 件中 1 件目」に誤読されるため "#1 & #7" 表記にする (Slack FB r3)
  const nums = esc(group.slots.map((s) => `#${s.n}`).join(" & "));
  const heading = group.screen
    ? `画面 <code>${esc(group.screen)}</code>${group.platform ? ` (${esc(group.platform)})` : ""} — 候補 ${nums}`
    : `画面不明 — 候補 ${nums}`;
  return `<section class="slot">\n<div class="metas">\n<h2 class="screen-h">${heading}</h2>\n${metas}\n</div>\n${preview}\n</section>`;
}

// 優先度順 (§4 の表順) のサマリ — 画面グループ化で失われる全体の優先度読みを先頭で補う
function summaryTable(slots) {
  const rows = slots
    .map((s) => `<tr><td>候補 ${s.n}</td><td><code>${esc(s.screen ?? "?")}</code></td><td><code>${esc(s.slot_type)}</code></td><td>${recBadge(s.recommendation)}</td></tr>`)
    .join("\n");
  return `<table class="summary"><thead><tr><th>#</th><th>画面</th><th>種別</th><th>個別推奨</th></tr></thead><tbody>\n${rows}\n</tbody></table>`;
}

function buildPage(appName, slots, groups) {
  return `<!DOCTYPE html>
<!-- generated by skills/21a-graphic-recommend/scripts/render-recommend-html.mjs — 手焼き禁止。
     SoT は graphic-recommend.md (§4 候補スロット表 + ayatori:slot-anchors)。修正はそちらを直して再実行する。 -->
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>グラフィック候補スロット 視覚レポート — ${esc(appName)}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,"Hiragino Sans","Noto Sans JP",sans-serif;margin:0;padding:32px;background:#F6F7F9;color:#1c2430}
@media (prefers-color-scheme:dark){body{background:#14181f;color:#e6e9ee}.slot{background:#1c222c!important;border-color:#333c49!important}.slot-note{background:#2a2f1a!important}}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#5a6676;font-size:13px;margin:0 0 24px;max-width:72em}
.proposed{display:inline-block;background:#FFF3CD;color:#7a5c00;border:1px solid #E6C34A;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;margin-bottom:16px}
.slot{display:flex;gap:24px;align-items:flex-start;background:#fff;border:1px solid #dde2ea;border-radius:14px;padding:20px;margin:0 0 20px;flex-wrap:wrap}
.metas{flex:1 1 260px;min-width:240px}
.screen-h{font-size:16px;margin:0 0 12px}
.slot-meta{padding:10px 0;border-top:1px dashed #dde2ea}
.slot-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.slot-no{font-weight:800;font-size:15px}
.summary{border-collapse:collapse;font-size:13px;margin:0 0 24px;background:#fff;border:1px solid #dde2ea;border-radius:10px}
.summary th,.summary td{padding:6px 14px;text-align:left;border-bottom:1px solid #eef1f5}
.summary th{color:#5a6676;font-weight:600}
@media (prefers-color-scheme:dark){.summary{background:#1c222c;border-color:#333c49}.summary th,.summary td{border-color:#2a3240}.slot-meta{border-color:#333c49}}
.badge{font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px}
.badge.must{background:#FDE0E4;color:#9F1239}
.badge.should{background:#DCFCE7;color:#166534}
.badge.opt{background:#E5E7EB;color:#374151}
@media (prefers-color-scheme:dark){.badge.must{background:#4a1d27;color:#ffb3c0}.badge.should{background:#1d3b28;color:#9fe8b8}.badge.opt{background:#333a45;color:#c9d1dc}}
.slot-place{font-weight:700;margin-bottom:6px}
.slot-type{font-size:13px;color:#5a6676;margin-bottom:10px}
.slot-reason{font-size:13.5px;line-height:1.75}
.slot-note{font-size:12.5px;background:#FFFBE6;border-radius:8px;padding:6px 10px;margin-top:10px}
code{background:rgba(127,127,127,.14);border-radius:4px;padding:1px 5px;font-size:.92em}
.frame{overflow:hidden;border:1px solid #cfd6e0;border-radius:12px;background:#fff;flex:0 0 auto}
.frame iframe{border:0;transform-origin:top left}
.frame-empty{display:flex;align-items:center;justify-content:center;width:242px;height:200px;color:#8a93a3;font-size:13px}
footer{color:#8a93a3;font-size:12px;margin-top:28px}
</style>
</head>
<body>
<h1>グラフィック候補スロット 視覚レポート — ${esc(appName)}</h1>
<p class="sub">推奨レポート (<code>graphic-recommend.md</code>) の「4. グラフィック候補スロット一覧」を、実際の画面プレビュー上で
<strong style="color:#FF2D78">ここが画像生成の候補箇所です</strong> と視覚化した派生ビューです。<strong>画面単位</strong>にまとめ、同一画面の複数候補は 1 つのプレビューに重畳表示します。候補番号は MD の表・箇所選択の返信番号と共通です。分析詳細 (推奨・根拠・ガードレール) は MD 本文を参照してください。</p>
<div class="proposed">本レポート全体は (E) PROPOSED — 要否の最終判断は Step 21b の人間ゲートで行います</div>
${summaryTable(slots)}
${groups.map(screenSection).join("\n")}
<footer>プレビューは main (default) HTML の埋め込み表示。プレビュー内は<strong>スクロール可</strong> (画面が長い場合は下方の候補位置も確認できます)、クリック等の操作は無効化しています。ハイライト位置は anchor 解決結果に基づく自動描画です。</footer>
</body>
</html>
`;
}

// ── main ──

try {
  const appName = process.argv[2];
  if (!appName) out({ ok: false, code: "E_USAGE", message: "usage: node render-recommend-html.mjs <app_name>" });

  const appRoot = path.join(repoRoot, "artifacts", appName);
  if (!fs.existsSync(appRoot)) out({ ok: false, code: "E_APP_NOT_FOUND", message: `artifacts/${appName}/ が存在しません` });

  const mdPath = path.join(appRoot, "graphics", "graphic-recommend.md");
  if (!fs.existsSync(mdPath)) out({ ok: false, code: "E_REPORT_MISSING", message: "graphics/graphic-recommend.md が未生成です — Step 2 (レポート Write) が先" });

  const htmlPath = path.join(appRoot, "graphics", "graphic-recommend.html");
  const { rows, anchors, anchor_error, parse_error } = parseSection4(fs.readFileSync(mdPath, "utf8"));

  if (parse_error) {
    // §4 見出しの構造破損は「正当な候補 0 件」と区別する — 既存 HTML は削除せず MD 修正へ差し戻す
    out({
      ok: false,
      code: "E_MD_PARSE",
      message: `${parse_error} — graphic-recommend.md の §4 見出し構造が壊れています。Step 2-5 (レポート Write) に戻って修正してから再実行する (既存の視覚レポートは削除していない)`,
    });
  }

  if (rows.length === 0) {
    // 候補 0 件 = 視覚化対象なし。stale な旧版が残っていれば除去する (派生ビューの整合)
    let removedStale = false;
    if (fs.existsSync(htmlPath)) {
      fs.rmSync(htmlPath, { force: true });
      removedStale = true;
    }
    out({ ok: true, slots: 0, removed_stale: removedStale, message: "§4 に候補スロットなし — 視覚レポートは生成しない" });
  }

  const { files } = resolveMainScreens(appRoot);
  const anchorByN = new Map(anchors.map((a) => [Number(a.n), a]));
  const fallbacks = [];
  const slots = [];
  // 画面単位グループ: 同一 platform/screen の候補は 1 プレビューに重畳する。
  // Map の挿入順 = §4 の表順 (優先度順) — 各画面の最上位候補の順に section が並ぶ
  const groups = new Map(); // "{platform}/{screen}" -> { screen, platform, body, slots[] }

  for (const row of rows) {
    const a = anchorByN.get(row.n) ?? {};
    // screen: anchors 指定 > §4 表の箇所セル先頭の `{stem}` backtick 表記 (report-guide §1 の固定書式)
    const screen = a.screen ?? (row.place.match(/`([^`]+)`/) ?? [])[1] ?? null;
    let platform = a.platform && files[a.platform]?.[screen] ? a.platform : null;
    if (!platform && screen) platform = SCREEN_PLATFORMS.find((p) => files[p]?.[screen]) ?? null;

    const slot = { ...row, screen, platform, note: null };
    slots.push(slot);
    if (!screen || !platform) {
      slot.note = anchor_error ?? "対象画面ファイルを特定できません (画面プレビューなし)";
      fallbacks.push({ n: row.n, reason: slot.note });
      groups.set(`?/${row.n}`, { screen, platform, body: null, slots: [slot] });
      continue;
    }
    const key = `${platform}/${screen}`;
    if (!groups.has(key)) {
      const names = files[platform][screen];
      const file = names.find((f) => f.includes("--light.")) ?? names.sort()[0];
      groups.set(key, { screen, platform, body: fs.readFileSync(path.join(appRoot, "screens", platform, file), "utf8"), slots: [] });
    }
    const g = groups.get(key);
    const r = resolveAnchor(g.body, a.anchor ?? null, row.n, appRoot);
    g.body = r.body;
    if (!r.resolved) {
      // anchors 全体が落ちている (parse 失敗 / 非 array) 場合は個別の「指定なし」より原因を出す
      const reason = !a.anchor && anchor_error ? anchor_error : r.reason;
      slot.note = `位置ハイライトなし — ${reason}`;
      fallbacks.push({ n: row.n, reason });
    }
    g.slots.push(slot);
  }

  const groupList = [...groups.values()].map((g) => ({ ...g, srcdoc: g.body ? buildSrcdoc(g.body, g.platform, path.join(appRoot, "screens", g.platform)) : null }));

  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, buildPage(appName, slots, groupList));
  out({
    ok: true,
    path: `artifacts/${appName}/graphics/graphic-recommend.html`,
    slots: slots.length,
    screens: groupList.filter((g) => g.srcdoc).length,
    highlighted: slots.filter((s) => !s.note).length,
    fallbacks,
  });
} catch (e) {
  console.error(`render-recommend-html.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
