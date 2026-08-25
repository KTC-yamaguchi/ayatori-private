#!/usr/bin/env node
// Step 21g (graphic-embed-review) の視覚レポート生成 — 「どのグラフィックがどの箇所に入ったか」を
// 画面プレビュー上で確認する派生ビュー。POCTEAMA-190 (F-7 埋め込み + 承認)
//
// usage: node render-embed-review.mjs <app_name>
//
// SoT は screens/{platform}/*.html の埋め込み済み <img> タグ (embed-graphics.mjs の出力) +
// graphic-plan.json (配置メタ) + pipeline-state (対象集合) で、本 script は
// graphics/graphic-embed-review.html を**毎回丸ごと再生成する派生ビュー**
// (21a render-recommend-html.mjs と同じ「手焼き禁止」レンダラ)。各画面を <iframe srcdoc> で
// 埋め込み、対象 graphic_id の <img> (alt = graphic_id) にハイライトリング + バッジを重畳する。
// srcdoc 内の相対 <img> は data URI に内包して HTML 単体で自己完結させる — 相対参照のままだと
// 閲覧環境側の file:// 子リソース読取ブロック (macOS のフォルダ権限拒否 / 拡張機能等) で破像し、
// 人間ゲートが環境要因で止まる (POCTEAMA-401)。screens/{platform}/*.html 本体の C-26 正典
// 相対参照には触らない (展開は本派生ビューの render 時のみ)。
//
// 人間ゲート (SKILL Step 3) の auto-open 対象 (pipeline.yaml human_gate.artifact_preview.step_targets)。
// render 失敗は fail-open — SKILL 側が link 一覧のみ (screens HTML 直接確認) に degrade する。
//
// stdout に JSON を 1 個出力する (兄弟 script と同じ契約):
//   - 前提 NG:  { ok: false, code: "E_*", message }
//   - 生成 OK:  { ok: true, path, slots, screens, embedded, missing[] }
// exit code は常に 0 (routing は JSON の code)。予期しない内部エラーのみ exit 1。
// 依存: node stdlib のみ (Operating Principle 1 準拠)。DOM parser 不使用 — 文字列レベル走査。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, findEmbeddedTags, resolveCanonical, resolveMainScreens } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// srcdoc 属性値は quote と & のみ escape すれば HTML として完全に埋め込める
const escSrcdoc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// ── srcdoc プレビュー組み立て (対象 graphic_id の <img> をハイライト + 自動スクロール) ──

const overlayFor = (ids) => `
<style>
.ayatori-embed-ring{position:absolute;border:3px solid #FF2D78;border-radius:10px;box-shadow:0 0 0 4px rgba(255,45,120,.25);pointer-events:none;z-index:2147483000}
.ayatori-embed-tag{position:absolute;background:#FF2D78;color:#fff;font:700 12px/1.6 system-ui,sans-serif;padding:1px 8px;border-radius:6px;pointer-events:none;z-index:2147483001}
</style>
<script>(function(){
var IDS=${JSON.stringify(ids)};
document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();},true);
document.addEventListener('submit',function(e){e.preventDefault();},true);
function go(){var minTop=null;IDS.forEach(function(id){document.querySelectorAll('img[alt="'+id+'"]').forEach(function(el){var r=el.getBoundingClientRect();if(r.width===0&&r.height===0)return;if(minTop===null||r.top<minTop)minTop=r.top;var x=r.left+window.scrollX,y=r.top+window.scrollY;var ring=document.createElement('div');ring.className='ayatori-embed-ring';ring.style.left=(x-8)+'px';ring.style.top=(y-8)+'px';ring.style.width=(r.width+16)+'px';ring.style.height=(r.height+16)+'px';document.body.appendChild(ring);var tag=document.createElement('div');tag.className='ayatori-embed-tag';tag.textContent=id;tag.style.left=(x-8)+'px';tag.style.top=Math.max(0,y-32)+'px';document.body.appendChild(tag);});});
if(minTop!==null)window.scrollTo(0,Math.max(0,minTop+window.scrollY-window.innerHeight*.25));}
if(document.readyState==='complete'){setTimeout(go,120);}else{window.addEventListener('load',function(){setTimeout(go,120);});}})();</script>`;

const MIME_BY_EXT = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

/** 画面 HTML 内の相対 <img src> を base64 data URI に置換して自己完結化する (POCTEAMA-401)。
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

function buildSrcdoc(body, platform, ids, screenDir) {
  // Figma キャプチャ script はレポート内 iframe では不要 (誤キャプチャ防止のため除去)
  body = body.replace(/<script[^>]*html-to-design\/capture\.js[^>]*>\s*<\/script>\s*/gi, "");
  // 画像は data URI に内包 (自己完結化)。<base> は inline できなかった残余参照と <a> リンクの
  // 相対解決用に従来どおり挿入する — srcdoc の base URL は親 (graphics/graphic-embed-review.html)
  // のため、screens/{platform}/ 基準へ戻す必要がある
  body = inlineLocalImages(body, screenDir);
  const base = `<base href="../screens/${platform}/">`;
  body = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => `${m}\n${base}`) : base + body;
  const overlay = overlayFor(ids);
  // replacement は function で渡す — overlay 内容に $ 系が混入しても GetSubstitution 展開させない
  body = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, () => `${overlay}\n</body>`) : body + overlay;
  return body;
}

// web-sm = Web スマホ幅 (CLAUDE.md {platform} 定義) — viewport は mobile と同じスマホ幅
const VIEWPORTS = { mobile: { w: 390, h: 780, scale: 0.62 }, "web-sm": { w: 390, h: 780, scale: 0.62 }, web: { w: 1280, h: 800, scale: 0.42 } };

function buildPage(appName, slotRows, sections) {
  const summary = slotRows
    .map(
      (s) =>
        `<tr><td><code>${esc(s.graphic_id)}</code></td><td>${esc(s.screens)}</td><td>${esc(s.placement)}</td><td>${esc(s.size)}</td><td>${s.complete ? '<span class="badge ok">埋め込み済み</span>' : `<span class="badge ng">未埋め込み ${esc(s.status)}</span>`}</td></tr>`
    )
    .join("\n");
  return `<!DOCTYPE html>
<!-- generated by skills/21g-graphic-embed-review/scripts/render-embed-review.mjs — 手焼き禁止。
     SoT は screens/{platform}/*.html の埋め込みタグ + graphic-plan.json。修正は embed をやり直して再実行する。 -->
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>グラフィック埋め込みレビュー — ${esc(appName)}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,"Hiragino Sans","Noto Sans JP",sans-serif;margin:0;padding:32px;background:#F6F7F9;color:#1c2430}
@media (prefers-color-scheme:dark){body{background:#14181f;color:#e6e9ee}.shot{background:#1c222c!important;border-color:#333c49!important}}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#5a6676;font-size:13px;margin:0 0 24px;max-width:72em}
.summary{border-collapse:collapse;font-size:13px;margin:0 0 24px;background:#fff;border:1px solid #dde2ea;border-radius:10px}
.summary th,.summary td{padding:6px 14px;text-align:left;border-bottom:1px solid #eef1f5}
.summary th{color:#5a6676;font-weight:600}
@media (prefers-color-scheme:dark){.summary{background:#1c222c;border-color:#333c49}.summary th,.summary td{border-color:#2a3240}}
.badge{font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px}
.badge.ok{background:#DCFCE7;color:#166534}
.badge.ng{background:#FDE0E4;color:#9F1239}
@media (prefers-color-scheme:dark){.badge.ok{background:#1d3b28;color:#9fe8b8}.badge.ng{background:#4a1d27;color:#ffb3c0}}
.shot{display:flex;gap:24px;align-items:flex-start;background:#fff;border:1px solid #dde2ea;border-radius:14px;padding:20px;margin:0 0 20px;flex-wrap:wrap}
.metas{flex:1 1 260px;min-width:240px}
.screen-h{font-size:16px;margin:0 0 12px}
.slot-line{font-size:13.5px;line-height:1.9}
code{background:rgba(127,127,127,.14);border-radius:4px;padding:1px 5px;font-size:.92em}
.frame{overflow:hidden;border:1px solid #cfd6e0;border-radius:12px;background:#fff;flex:0 0 auto}
.frame iframe{border:0;transform-origin:top left}
footer{color:#8a93a3;font-size:12px;margin-top:28px}
</style>
</head>
<body>
<h1>グラフィック埋め込みレビュー — ${esc(appName)}</h1>
<p class="sub">生成済みグラフィックが <strong style="color:#FF2D78">どの画面のどこに入ったか</strong> を実画面プレビュー上で視覚化した派生ビューです。ハイライトリングが埋め込み位置 (alt = graphic_id の <code>&lt;img&gt;</code>) を示します。承認・修正指示・却下は 21g の人間ゲート (チャット) で行ってください。</p>
${summary ? `<table class="summary"><thead><tr><th>graphic_id</th><th>画面</th><th>配置</th><th>size_px</th><th>状態</th></tr></thead><tbody>\n${summary}\n</tbody></table>` : ""}
${sections.join("\n")}
<footer>プレビューは main (default) HTML の埋め込み表示 (dual-theme は light 代表 — dark も同位置に埋め込み済み)。プレビュー内はスクロール可、クリック等の操作は無効化しています。</footer>
</body>
</html>
`;
}

// ── main ──

try {
  const appName = process.argv[2];
  if (!appName || process.argv.length > 3) {
    out({ ok: false, code: "E_USAGE", message: "usage: node render-embed-review.mjs <app_name>" });
  }

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, prompts, targetEntries, slotMeta } = pre;

  const { files: mainFiles } = resolveMainScreens(appRoot);
  const promptById = new Map(prompts.prompts.map((p) => [p?.graphic_id, p]));
  const htmlPath = path.join(appRoot, "graphics", "graphic-embed-review.html");

  // (platform, screen) 単位に代表 main HTML 1 枚を選び、対象 graphic_id を重畳する (21a と同型)。
  // dual-theme は --light を代表にする (両 theme とも同位置に埋め込み済みが embed script の契約)
  const groups = new Map(); // "{platform}/{screen}" → { platform, screen, file, ids: [] }
  const missing = [];
  const slotRows = [];
  for (const g of targetEntries) {
    const entry = promptById.get(g.graphic_id);
    const canonical = resolveCanonical(appRoot, g);
    const placements = slotMeta.get(g.graphic_id) ?? [];
    let total = 0;
    let embedded = 0;
    for (const s of placements) {
      for (const platform of s.platforms ?? []) {
        const names = mainFiles[platform]?.[s.screen];
        if (!names) continue;
        for (const name of names) {
          total++;
          const rel = `screens/${platform}/${name}`;
          if (findEmbeddedTags(fs.readFileSync(path.join(appRoot, rel), "utf8"), g.graphic_id).length > 0) embedded++;
          else missing.push({ graphic_id: g.graphic_id, file: rel });
        }
        const key = `${platform}/${s.screen}`;
        if (!groups.has(key)) {
          const file = names.find((f) => f.includes("--light.")) ?? [...names].sort()[0];
          groups.set(key, { platform, screen: s.screen, file, ids: [] });
        }
        if (!groups.get(key).ids.includes(g.graphic_id)) groups.get(key).ids.push(g.graphic_id);
      }
    }
    slotRows.push({
      graphic_id: g.graphic_id,
      screens: placements.map((s) => `${s.screen} (${(s.platforms ?? []).join("/")})`).join(", "),
      placement: placements.map((s) => s.placement).join(" / "),
      size: entry?.size_px ? `${entry.size_px.width}×${entry.size_px.height}` : "?",
      complete: total > 0 && embedded === total,
      status: `${embedded}/${total}`,
      canonical: canonical?.rel ?? null,
    });
  }

  const sections = [];
  for (const g of groups.values()) {
    const body = fs.readFileSync(path.join(appRoot, "screens", g.platform, g.file), "utf8");
    const vp = VIEWPORTS[g.platform] ?? VIEWPORTS.mobile;
    const metas = g.ids
      .map((id) => {
        const row = slotRows.find((r) => r.graphic_id === id);
        return `<div class="slot-line"><code>${esc(id)}</code> — ${esc(row?.placement ?? "")} (${esc(row?.size ?? "?")}${row?.complete ? "" : ` / 未埋め込み ${esc(row?.status ?? "")}`})</div>`;
      })
      .join("\n");
    sections.push(`<section class="shot">
<div class="metas">
<h2 class="screen-h">画面 <code>${esc(g.screen)}</code> (${esc(g.platform)})</h2>
${metas}
</div>
<div class="frame" style="width:${Math.round(vp.w * vp.scale)}px;height:${Math.round(vp.h * vp.scale)}px">
  <iframe loading="lazy" title="${esc(g.screen)}" style="width:${vp.w}px;height:${vp.h}px;transform:scale(${vp.scale})" srcdoc="${escSrcdoc(buildSrcdoc(body, g.platform, g.ids, path.join(appRoot, "screens", g.platform)))}"></iframe>
</div>
</section>`);
  }

  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, buildPage(appName, slotRows, sections));
  out({
    ok: true,
    path: `artifacts/${appName}/graphics/graphic-embed-review.html`,
    slots: slotRows.length,
    screens: groups.size,
    embedded: slotRows.filter((r) => r.complete).length,
    missing,
  });
} catch (e) {
  console.error(`render-embed-review.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
