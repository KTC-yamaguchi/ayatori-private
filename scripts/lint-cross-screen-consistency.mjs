#!/usr/bin/env node
// scripts/lint-cross-screen-consistency.mjs
//
// 25c Step 1-2b「画面間横断一貫性 (cross-screen consistency) 評価」の機械照合パートを
// 独立 lint script として切り出したもの (skill 側の宣言済み方針: color-lint と同型の
// derived report 方式)。目視パート (レイアウトの微妙な差・ラベルの言い回し) は skill に残し、
// 本 script は **署名として抽出できるものの集合比較** だけを担う。
//
// 背景: sub-state HTML は 25b が画面ごとに独立並列生成するため「局所最適・大域不整合」が
// 構造的に起きる (振り返りの症状 A/D/E: empty 画面間でアイコン・CTA class・font がバラバラ)。
// 単体採点 (25c Step 1-2) では捕捉できず、同じ state を持つ画面を横に並べた集合比較が必要。
//
// 照合モデル:
//   sub-state HTML (`{screen}--{state}[--{theme}].html`) を (platform, state, theme) で
//   グルーピングし、2 画面以上あるグループ内で以下 4 次元の署名が 1 種類に収束するか比較する。
//   2 種以上に割れたら **drift 候補** として報告する (候補であって確定違反ではない —
//   「別画面だから正当に違う」ケースの判別は 25c / 人間の責務)。
//
//   | 次元 | 署名 | 25c tag |
//   |---|---|---|
//   | CTA class      | primary CTA 要素の class 文字列集合 (検出はランク法、下記) | cta_class_drift |
//   | CTA font       | primary CTA の font-family / font-size / font-weight (var レベル) | cta_font_drift |
//   | icon 形状      | primary CTA 内 / state container 内の SVG 形状署名 (slot 別) | cross_screen_icon_inconsistent |
//   | 配置           | state container の alignment 宣言 (text-align / align-items / justify-content) | button_position_inconsistent |
//
//   main との照合: CTA 正典は main HTML (`{screen}.html`) が SoT。グループ多数派が main の
//   primary CTA class と食い違う場合も drift 候補にする (majority ではなく main 側を基準に採る)。
//
// primary CTA の検出 (決定的ランク法 — 正典 class 名を事前に知らなくても働く):
//   rank 1: class token が `btn-primary` (正典そのもの)
//   rank 2: class token に `primary` を含む (例: primary-action = 正典から逸れた自作 class)
//   rank 3: class token に `cta` を含む (例: cta-button)
//   ファイル内で最良 rank の要素群を primary CTA とみなす。1 つも無ければ署名 `(none)` —
//   「グループ内の他画面には CTA があるのに、この画面だけ無い」も集合比較で drift になる。
//
// CSS 解決の近似: 自己完結 HTML の <style> に加え、<link> の **ローカル相対 stylesheet**
// (screens/_shared/*.css 等の実在ファイル) も読む。specificity は実装せず「class token を
// selector に含む宣言の後勝ち」で近似する。同一の共有 CSS を読む限り全画面で同じ近似に
// なるため、偽 drift は生まない (差が出る = どこかの画面がローカルで上書きした、が signal)。
//
// report は derived artifact (screens HTML + 共有 CSS の決定的関数)。毎回丸ごと再生成
// (上書き) するため世代管理を持たない。減点判断・採点への反映は 25c 側の責務。
//
// 使い方:
//   node scripts/lint-cross-screen-consistency.mjs --report <artifacts/{app}> [--out <path>]
//       # 全 sub-state 走査 → screens/cross-screen-consistency-report.json
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// ───────────────────────────── 定数 ─────────────────────────────

// 派生 basename の theme suffix (25b expected_files の dual_theme 規約)
const THEMES = new Set(["light", "dark"]);

// state container 判定: class token がグループの state に対応する語彙を含む要素、または
// (error 系のみ) role="alert"。sub-state の慣習語彙 (25b 生成物で実在する形: empty-state /
// error-banner / is-error / err-stage / loading-overlay / skeleton-area 等) を包含で拾う。
// グループの state と無関係な container (empty 画面内の error-banner 等) を署名に混ぜると
// 偽 drift になるため、state ごとにフィルタを切り替える。未知の state は総称フィルタ。
const STATE_CONTAINER_FILTERS = [
  { states: ["empty"], re: /(?:^|-|_)empty(?:$|-|_)/, alertRole: false },
  { states: ["error", "validation-error"], re: /(?:^|-|_)(?:error|err|alert|invalid)(?:$|-|_)/, alertRole: true },
  { states: ["loading"], re: /(?:^|-|_)(?:loading|load|skeleton|spinner|progress)(?:$|-|_)/, alertRole: false },
  { states: ["modal", "dialog"], re: /(?:^|-|_)(?:modal|dialog|overlay|sheet)(?:$|-|_)/, alertRole: false },
];
const GENERIC_STATE_RE = /(?:^|-|_)(?:empty|error|err|loading|alert|state|modal|dialog)(?:$|-|_)/;

function containerFilterFor(state) {
  const f = STATE_CONTAINER_FILTERS.find((f) => f.states.includes(state));
  if (f) return f;
  return { states: [state], re: GENERIC_STATE_RE, alertRole: true };
}

// CTA 候補になりうるタグ
const CTA_TAGS = new Set(["button", "a"]);

// font 署名に使うプロパティ
const FONT_PROPS = ["font-family", "font-size", "font-weight"];

// 配置署名に使うプロパティ (state container の整列を表すもののみ。padding 等は含めない —
// 画面ごとに正当に違いうる寸法系を署名に入れると偽 drift だらけになる)
const PLACEMENT_PROPS = ["text-align", "align-items", "justify-content", "place-items"];

// HTML void 要素 (タグスタック管理用)
// prettier-ignore
const VOID_TAGS = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);

// report のファイルリスト上限 (context 爆発防止。総数は count で保持)
const CAP_FILES = 8;

// ───────────────────────────── 汎用ユーティリティ ─────────────────────────────
// maskRanges / findRanges / parseAttrs / cssDeclarations / svgBlocks / svgSignature は
// scripts/lint-screen-colors.mjs と同じ走査モデル (正規表現 + brace 追跡 + タグスタック)。
// 同 script は CLI を top-level 実行し export を持たないため、ここでは自己完結に保持する。

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function maskRanges(text, ranges) {
  if (ranges.length === 0) return text;
  const arr = text.split("");
  for (const [s, e] of ranges) {
    for (let i = s; i < e && i < arr.length; i++) if (arr[i] !== "\n") arr[i] = " ";
  }
  return arr.join("");
}

function findRanges(text, openRe, closeStr) {
  const ranges = [];
  let m;
  const re = new RegExp(openRe.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const end = text.indexOf(closeStr, m.index + m[0].length);
    if (end === -1) {
      ranges.push([m.index, text.length]);
      break;
    }
    ranges.push([m.index, end + closeStr.length]);
    re.lastIndex = end + closeStr.length;
  }
  return ranges;
}

const RE_TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const RE_ATTR = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttrs(raw) {
  const attrs = {};
  let m;
  RE_ATTR.lastIndex = 0;
  while ((m = RE_ATTR.exec(raw)) !== null) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
  return attrs;
}

// CSS 宣言の列挙 (brace 追跡)。selector / prop / value を yield する。
function* cssDeclarations(css) {
  const masked = maskRanges(css, findRanges(css, /\/\*/g, "*/"));
  const stack = [];
  let buf = "";
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      if (buf.trim()) yield* emitDecls(buf, stack);
      buf = "";
      stack.pop();
    } else if (ch === ";") {
      if (buf.trim()) yield* emitDecls(buf, stack);
      buf = "";
    } else {
      buf += ch;
    }
  }

  function* emitDecls(chunk, sels) {
    const colon = chunk.indexOf(":");
    if (colon === -1) return;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (!prop || !value) return;
    const selector = [...sels].reverse().find((s) => s && !s.startsWith("@")) || "";
    yield { prop, value, selector };
  }
}

// <svg>…</svg> ブロックを (入れ子対応で) 列挙
function* svgBlocks(body) {
  const re = /<svg\b|<\/svg>/gi;
  let m,
    depth = 0,
    start = -1;
  while ((m = re.exec(body)) !== null) {
    if (m[0].toLowerCase().startsWith("<svg")) {
      if (depth === 0) start = m.index;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start !== -1) {
        const end = m.index + m[0].length;
        yield { start, end, html: body.slice(start, end) };
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
}

// SVG の形状署名: 「同じ絵か」を class 名や data 属性でなく **実物の形状データ** で決める。
const SHAPE_GEOM = {
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx"],
  line: ["x1", "y1", "x2", "y2"],
};
function svgSignature(svgHtml) {
  const parts = [];
  let m;
  const reD = /\sd="([^"]+)"/g;
  while ((m = reD.exec(svgHtml)) !== null) parts.push("d:" + m[1].replace(/\s+/g, " ").trim());
  const reP = /\spoints="([^"]+)"/g;
  while ((m = reP.exec(svgHtml)) !== null) parts.push("p:" + m[1].replace(/\s+/g, " ").trim());
  for (const [tag, attrs] of Object.entries(SHAPE_GEOM)) {
    const reT = new RegExp(`<${tag}\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>`, "gi");
    while ((m = reT.exec(svgHtml)) !== null) {
      const a = parseAttrs(m[1]);
      parts.push(tag[0] + ":" + attrs.map((k) => a[k] ?? "").join(","));
    }
  }
  if (parts.length === 0) return null;
  parts.sort();
  return sha(parts.join("|"));
}

// ───────────────────────────── ファイル名 / グルーピング ─────────────────────────────

// `{screen}--{state}[--{theme}].html` を分解する。sub-state でない (main / theme 単独派生 /
// "--" 無し) は null を返す。theme 単独派生 (`{screen}--dark.html`) は「main の theme 違い」
// であって state 派生ではないため対象外。
export function parseDerivedName(name) {
  const stem = name.replace(/\.html$/, "");
  const segs = stem.split("--");
  if (segs.length < 2) return null;
  let theme = "default";
  if (segs.length >= 3 && THEMES.has(segs[segs.length - 1])) {
    theme = segs.pop();
  }
  if (segs.length < 2) return null;
  const state = segs.pop();
  if (THEMES.has(state)) return null; // {screen}--dark.html = theme 派生であって sub-state でない
  return { screen: segs.join("--"), state, theme };
}

// screens/ 配下の HTML を列挙し platform を付す。正規 topology (screens/{web,web-sm,mobile}/)
// に加え、legacy の flat 配置 (screens/ 直下、`mobile-` prefix で platform を表す形) も走査する。
export function listScreenFiles(appRoot) {
  const out = [];
  const screensDir = join(appRoot, "screens");
  if (!existsSync(screensDir)) return out;
  for (const plat of ["web", "web-sm", "mobile"]) {
    const dir = join(screensDir, plat);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (f.endsWith(".html") && !/\.bak/.test(f)) out.push({ path: join(dir, f), platform: plat, name: f });
    }
  }
  for (const f of readdirSync(screensDir).sort()) {
    const p = join(screensDir, f);
    if (!f.endsWith(".html") || /\.bak/.test(f) || !statSync(p).isFile()) continue;
    out.push({ path: p, platform: f.startsWith("mobile-") ? "mobile" : "web", name: f });
  }
  return out;
}

// ───────────────────────────── 署名抽出 (1 ファイル) ─────────────────────────────

// class token → prop → value の索引 (後勝ち)。linked CSS → inline <style> の順に読むため
// inline (画面ローカル) が共有 CSS を上書きする関係が保たれる。
function buildClassStyleIndex(cssSources, props) {
  const idx = new Map();
  const wanted = new Set(props);
  for (const css of cssSources) {
    for (const d of cssDeclarations(css)) {
      if (!wanted.has(d.prop)) continue;
      for (const m of d.selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        const cls = m[1];
        if (!idx.has(cls)) idx.set(cls, new Map());
        idx.get(cls).set(d.prop, d.value.replace(/\s+/g, " ").trim());
      }
    }
  }
  return idx;
}

function classTokens(attrs) {
  return (attrs.class || "").split(/\s+/).filter(Boolean);
}

function ctaRank(tokens) {
  if (tokens.includes("btn-primary")) return 1;
  if (tokens.some((t) => t.includes("primary"))) return 2;
  if (tokens.some((t) => t.includes("cta"))) return 3;
  return 0;
}

function isStateContainer(tokens, attrs, filter) {
  if (filter.alertRole && (attrs.role || "").toLowerCase() === "alert") return true;
  return tokens.some((t) => filter.re.test(t));
}

// inline style 文字列 → prop → value
function inlineStyleMap(styleAttr) {
  const m = new Map();
  for (const part of (styleAttr || "").split(";")) {
    const c = part.indexOf(":");
    if (c === -1) continue;
    m.set(part.slice(0, c).trim().toLowerCase(), part.slice(c + 1).replace(/\s+/g, " ").trim());
  }
  return m;
}

// 要素 (class tokens + inline style) に対する prop の解決値。inline > class 索引 (後勝ち)。
function resolveProp(prop, tokens, styleAttr, classIdx) {
  const inline = inlineStyleMap(styleAttr);
  if (inline.has(prop)) return inline.get(prop);
  let val = null;
  for (const t of tokens) {
    const v = classIdx.get(t)?.get(prop);
    if (v !== undefined) val = v; // token 順で後勝ち (近似 — 全画面で同一規則なので比較としては公平)
  }
  return val;
}

// …/{appRoot}/screens/… から {appRoot} を導出 ('screens' セグメント基準、color-lint と同じ規則)
function appRootOf(filePath) {
  const segs = resolve(filePath).split(sep);
  const i = segs.lastIndexOf("screens");
  return i > 0 ? segs.slice(0, i).join(sep) : null;
}

// 1 ファイルから 4 次元の署名を抽出する。state はグループの state (container フィルタの
// 切替に使う)。iconSigs (sig → name) は表示名の注釈用 (任意)。
export function extractSignatures(filePath, { iconSigs = new Map(), state = "" } = {}) {
  const containerFilter = containerFilterFor(state);
  const rootDir = appRootOf(filePath);
  const raw = readFileSync(filePath, "utf8");
  const masked = maskRanges(raw, [
    ...findRanges(raw, /<!--/g, "-->"),
    ...findRanges(raw, /<script\b/g, "</script>"),
  ]);

  // CSS ソース収集: ローカル相対 <link> stylesheet (実在するもののみ) → inline <style>
  const cssSources = [];
  for (const m of masked.matchAll(/<link\b[^>]*>/g)) {
    const attrs = parseAttrs(m[0]);
    if ((attrs.rel || "").toLowerCase() !== "stylesheet") continue;
    const href = attrs.href || "";
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("//")) continue; // 外部 URL は読まない
    const p = resolve(dirname(filePath), href);
    // app root 外への相対パス (壊れた / 悪意ある href) は読まない — report 生成が
    // 意図しないローカルファイルへ到達する経路を封じる (Copilot レビュー指摘)
    if (rootDir && p !== rootDir && !p.startsWith(rootDir + sep)) continue;
    if (existsSync(p)) cssSources.push(readFileSync(p, "utf8"));
  }
  const styleRanges = findRanges(masked, /<style\b[^>]*>/g, "</style>");
  for (const [s, e] of styleRanges) {
    const open = masked.indexOf(">", s);
    cssSources.push(masked.slice(open + 1, e - "</style>".length));
  }

  const fontIdx = buildClassStyleIndex(cssSources, FONT_PROPS);
  const placementIdx = buildClassStyleIndex(cssSources, PLACEMENT_PROPS);

  // body 走査: <style> を mask してタグスタックで祖先 chain を追う
  const body = maskRanges(masked, styleRanges);
  const svgAt = new Map();
  for (const blk of svgBlocks(body)) svgAt.set(blk.start, blk);

  const ctaElems = []; // {rank, classStr, tokens, styleAttr}
  const containers = []; // {tokens, styleAttr}
  const ctaIconRaw = []; // {sig, rank} — 祖先 CTA の最良 rank。bestRank 確定後に post-filter
  const stateIconSigs = new Set();

  const stack = []; // {tag, tokens, styleAttr, rank, isContainer, isCta}
  RE_TAG.lastIndex = 0;
  let t;
  while ((t = RE_TAG.exec(body)) !== null) {
    const [full, slash, tag, rawAttrs, selfClose] = t;
    const lower = tag.toLowerCase();
    if (slash === "/") {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === lower) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = parseAttrs(rawAttrs);
    const tokens = classTokens(attrs);
    const rank = CTA_TAGS.has(lower) ? ctaRank(tokens) : 0;
    const container = isStateContainer(tokens, attrs, containerFilter);
    if (rank > 0) ctaElems.push({ rank, classStr: [...tokens].sort().join(" "), tokens, styleAttr: attrs.style });
    if (container) containers.push({ tokens, styleAttr: attrs.style });

    if (svgAt.has(t.index)) {
      const sig = svgSignature(svgAt.get(t.index).html);
      if (sig) {
        // slot 判定: CTA (button/a) 内の icon か、state container 内の illustration か。
        // どちらでもない SVG (header / brand / hero 等の chrome) は対象外 — chrome の
        // 画面内一貫性は Step 1-1b (main からの byte 継承検証) の責務で、別画面同士の
        // chrome は正当に違いうるため横断比較すると偽 drift になる。
        // CTA icon は祖先 CTA の最良 rank 付きで収集し、bestRank 確定後に post-filter で
        // best rank 配下のものだけへ絞る — class/font 署名 (best rank のみ) と対象を揃える。
        // rank フィルタ無しだと secondary な rank3 CTA (cta-link 等) の icon が混ざり、
        // 余計な要素が無い側のきれいな画面が少数派として指摘される偽 drift になる
        // (チームレビュー指摘)。CTA 内 icon は rank を問わず illustration には数えない。
        const ctaRanks = stack.filter((n) => n.isCta).map((n) => n.rank);
        if (ctaRanks.length > 0) ctaIconRaw.push({ sig, rank: Math.min(...ctaRanks) });
        else if (stack.some((n) => n.isContainer)) stateIconSigs.add(sig);
      }
    }
    if (!VOID_TAGS.has(lower) && selfClose !== "/" && !full.endsWith("/>")) {
      stack.push({ tag: lower, tokens, rank, isCta: rank > 0, isContainer: container });
    }
  }

  // ── CTA class 署名: 最良 rank の要素群の class 文字列 (sorted unique) ──
  const bestRank = ctaElems.reduce((b, e) => (b === 0 || e.rank < b ? e.rank : b), 0);
  const primaryCtas = ctaElems.filter((e) => e.rank === bestRank && bestRank > 0);
  const ctaClassSig = primaryCtas.length === 0 ? "(none)" : [...new Set(primaryCtas.map((e) => e.classStr))].sort().join(" | ");

  // ── CTA font 署名: primary CTA の font-* 解決値 ──
  let ctaFontSig = "(none)";
  if (primaryCtas.length > 0) {
    const sigs = new Set(
      primaryCtas.map((e) =>
        FONT_PROPS.map((p) => `${p}=${resolveProp(p, e.tokens, e.styleAttr, fontIdx) ?? "inherit"}`).join("; ")
      )
    );
    ctaFontSig = [...sigs].sort().join(" | ");
  }

  // ── 配置署名: state container の整列宣言 (sorted unique) ──
  const placementParts = new Set();
  for (const c of containers) {
    for (const p of PLACEMENT_PROPS) {
      const v = resolveProp(p, c.tokens, c.styleAttr, placementIdx);
      if (v !== null) placementParts.add(`${p}:${v}`);
    }
  }
  const placementSig = placementParts.size === 0 ? "(none)" : [...placementParts].sort().join("; ");

  // ── icon 署名: slot 別の形状署名集合 (icons/ 正典名で注釈) ──
  // primary CTA icon は class/font 署名と同じ「best rank の CTA 配下」のみ採用する
  const ctaIconSigs = new Set(
    ctaIconRaw.filter((i) => bestRank > 0 && i.rank === bestRank).map((i) => i.sig)
  );
  const annotate = (sigs) =>
    [...sigs].sort().map((s) => (iconSigs.has(s) ? `${iconSigs.get(s)}@${s}` : s)).join(" | ") || "(none)";

  return {
    cta_class: ctaClassSig,
    cta_font: ctaFontSig,
    placement: placementSig,
    icon_primary_cta: annotate(ctaIconSigs),
    icon_state_illustration: annotate(stateIconSigs),
  };
}

// ───────────────────────────── 集合比較 (グループ) ─────────────────────────────

// signature → files の分布を作り、収束/多数派/少数派を判定する。
// 多数派の決定: 件数最大 → 同数なら main の値 (あれば) → それも無ければ辞書順 (決定論)。
export function compareDimension(entries, mainValue = null) {
  const byValue = new Map();
  for (const { file, value } of entries) {
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(file);
  }
  const variants = [...byValue.entries()]
    .map(([value, files]) => ({ value, count: files.length, files: files.slice(0, CAP_FILES) }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
  const converged = variants.length <= 1;
  let majority = variants[0]?.value ?? null;
  if (variants.length > 1 && variants[0].count === variants[1].count) {
    const tied = variants.filter((v) => v.count === variants[0].count).map((v) => v.value);
    if (mainValue !== null && tied.includes(mainValue)) majority = mainValue;
  }
  const mainMismatch = mainValue !== null && majority !== null && majority !== mainValue;
  // 少数派の基準: 通常はグループ多数派。main 正典と食い違うときは main を基準に切替える —
  // 「グループ内は収束したが全画面が main から逸脱」のケースで minority が空になり、
  // 25c 側が修正対象ファイルを特定できなくなるため (チームレビュー指摘)。converged でも
  // main_mismatch なら全 files が少数派 (= 修正対象) として載る。
  const basis = mainMismatch ? mainValue : majority;
  const minorityAll = entries.filter((e) => e.value !== basis).map((e) => ({ file: e.file, value: e.value }));
  return {
    converged,
    majority,
    variants,
    minority_files: minorityAll.slice(0, CAP_FILES),
    minority_total: minorityAll.length,
    main_value: mainValue,
    main_mismatch: mainMismatch,
  };
}

// 次元 → 25c tag の対応 (skill Step 1-2b の表と同一語彙)
const DIMENSION_TAGS = {
  cta_class: "cta_class_drift",
  cta_font: "cta_font_drift",
  icon_primary_cta: "cross_screen_icon_inconsistent",
  icon_state_illustration: "cross_screen_icon_inconsistent",
  placement: "button_position_inconsistent",
};

// CTA が存在しない state (loading 等) では CTA 系 3 次元が全ファイル "(none)" に収束する。
// それは「一貫して CTA 無し」であり正常 (converged=true で通過する)。

export function compareGroup(group) {
  const checks = {};
  const drifts = [];
  for (const dim of Object.keys(DIMENSION_TAGS)) {
    const entries = group.files.map((f) => ({ file: f.relPath, value: f.signatures[dim] }));
    // main 照合は「CTA 正典」にのみ適用する (icon / 配置は state 専用要素で main に対応物が無い)
    const mainApplies = dim === "cta_class" || dim === "cta_font";
    // main が複数画面ある場合、全 main が同一値のときだけ「main の慣習」として採用する
    let mainValue = null;
    if (mainApplies && group.mains.length > 0) {
      const mv = new Set(group.mains.map((m) => m.signatures[dim]));
      if (mv.size === 1) {
        const v = [...mv][0];
        if (v !== "(none)") mainValue = v;
      }
    }
    const result = compareDimension(entries, mainValue);
    checks[dim] = result;
    if (!result.converged || result.main_mismatch) {
      drifts.push({
        tag: DIMENSION_TAGS[dim],
        dimension: dim,
        platform: group.platform,
        state: group.state,
        theme: group.theme,
        majority: result.majority,
        ...(result.main_value !== null ? { main_canon: result.main_value, main_mismatch: result.main_mismatch } : {}),
        variants: result.variants,
        // 修正対象の当たり: 多数派 (or main 正典) からずれている少数派ファイル (CAP_FILES 上限、総数は total)
        minority_files: result.minority_files,
        minority_total: result.minority_total,
      });
    }
  }
  return { checks, drifts };
}

// ───────────────────────────── report 生成 ─────────────────────────────

function loadIconSigs(appRoot) {
  const sigs = new Map();
  const dir = join(appRoot, "icons");
  if (!existsSync(dir)) return sigs;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
    const sig = svgSignature(readFileSync(join(dir, f), "utf8"));
    if (sig) sigs.set(sig, f.replace(/\.svg$/, ""));
  }
  return sigs;
}

export function buildReport(appRoot) {
  const appName = basename(resolve(appRoot));
  const iconSigs = loadIconSigs(appRoot);
  const all = listScreenFiles(appRoot);

  // sub-state / main の仕分けと (platform, state, theme) グルーピング
  const groups = new Map(); // key → {platform, state, theme, files[], mains[]}
  const mainByKey = new Map(); // `${platform}|${screen}` → file entry (遅延抽出)
  const relOf = (p) => resolve(p).split(sep).slice(-3).join("/").replace(/^.*?(screens\/)/, "$1");

  const substates = [];
  for (const f of all) {
    const parsed = parseDerivedName(f.name);
    if (parsed) substates.push({ ...f, ...parsed });
    else if (!f.name.includes("--")) mainByKey.set(`${f.platform}|${f.name.replace(/\.html$/, "")}`, f);
  }

  // cache key は path + state: 同じ main が複数グループ (empty/error/…) から参照されるとき、
  // container フィルタが state で切り替わるため署名も state 別になる
  const extractCache = new Map();
  const extract = (f, state) => {
    const key = `${f.path}|${state}`;
    if (!extractCache.has(key)) {
      extractCache.set(key, extractSignatures(f.path, { iconSigs, state }));
    }
    return extractCache.get(key);
  };

  for (const s of substates) {
    const key = `${s.platform}|${s.state}|${s.theme}`;
    if (!groups.has(key)) groups.set(key, { platform: s.platform, state: s.state, theme: s.theme, files: [], mains: [] });
    groups.get(key).files.push({ relPath: relOf(s.path), signatures: extract(s, s.state) });
    const main = mainByKey.get(`${s.platform}|${s.screen}`);
    if (main && !groups.get(key).mains.some((m) => m.relPath === relOf(main.path))) {
      groups.get(key).mains.push({ relPath: relOf(main.path), signatures: extract(main, s.state) });
    }
  }

  const groupReports = [];
  const driftCandidates = [];
  let skippedSingletons = 0;
  for (const g of [...groups.values()].sort((a, b) => (a.platform + a.state + a.theme < b.platform + b.state + b.theme ? -1 : 1))) {
    if (g.files.length < 2) {
      skippedSingletons++; // 比較相手がいないグループは対象外 (skill: 2 画面以上あるとき)
      continue;
    }
    const { checks, drifts } = compareGroup(g);
    groupReports.push({
      platform: g.platform,
      state: g.state,
      theme: g.theme,
      // ファイルリストは CAP_FILES 上限 (context 爆発防止)、総数は *_total で保持
      files: g.files.map((f) => f.relPath).slice(0, CAP_FILES),
      files_total: g.files.length,
      mains: g.mains.map((m) => m.relPath).slice(0, CAP_FILES),
      mains_total: g.mains.length,
      checks,
    });
    driftCandidates.push(...drifts);
  }

  const byTag = {};
  for (const d of driftCandidates) byTag[d.tag] = (byTag[d.tag] || 0) + 1;

  return {
    app_name: appName,
    generated_at: new Date().toISOString(),
    scanned: {
      substate_files: substates.length,
      groups: groupReports.length,
      singleton_groups_skipped: skippedSingletons, // 暗黙 cap の明示 (silent truncation 防止)
      icons: iconSigs.size,
    },
    groups: groupReports,
    drift_candidates: driftCandidates,
    summary: {
      groups: groupReports.length,
      groups_with_drift: new Set(driftCandidates.map((d) => `${d.platform}|${d.state}|${d.theme}`)).size,
      drift_candidates: driftCandidates.length,
      by_tag: byTag,
    },
  };
}

// ───────────────────────────── CLI ─────────────────────────────

function runReport(appRoot, outOverride) {
  if (!existsSync(join(appRoot, "screens"))) {
    console.error(`[lint-cross-screen-consistency] not an app root (screens/ not found): ${appRoot}`);
    process.exit(2);
  }
  const report = buildReport(appRoot);
  const outPath = outOverride || join(appRoot, "screens", "cross-screen-consistency-report.json");
  mkdirSync(dirname(outPath), { recursive: true }); // --out の退避先ディレクトリ未作成でも落ちない
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  const s = report.summary;
  console.log(
    `[lint-cross-screen-consistency] wrote ${outPath}\n` +
      `  groups=${s.groups} groups-with-drift=${s.groups_with_drift} drift-candidates=${s.drift_candidates} ` +
      `tags=${Object.entries(s.by_tag).map(([k, v]) => `${k}:${v}`).join(",") || "(none)"}`
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "--report" && args[1]) {
    const outIdx = args.indexOf("--out");
    if (outIdx !== -1 && !args[outIdx + 1]) {
      console.error("[lint-cross-screen-consistency] --out requires a path argument");
      process.exit(2);
    }
    runReport(args[1], outIdx !== -1 ? args[outIdx + 1] : undefined);
  } else {
    console.error(
      "usage:\n  node scripts/lint-cross-screen-consistency.mjs --report <artifacts/{app}> [--out <path>]"
    );
    process.exit(1);
  }
}
