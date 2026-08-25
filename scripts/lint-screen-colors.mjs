#!/usr/bin/env node
// scripts/lint-screen-colors.mjs
//
// 画面 content の色トークン強制 (zero-literal) + 色一貫性 report の決定論 linter。
//
// 背景: ドリフトは「正典+機械照合+fail-closed」が効く場所 (:root / chrome) では起きず、
// 効かない場所 (画面 content の色・SVG fill/stroke) だけで起きる (事前調査で確認)。本スクリプトは
// その「最後の穴」に root-variables / chrome self-check と同型の機械照合を提供する。
//
// 2 層モデル (PR #103 / pipeline.yaml C-25):
//   L1 Hard (fail-closed、--check):
//     1. zero-literal — content に色リテラル (hex / rgb() / hsl() 等 / CSS 色名) を書かない。
//        :root 定義ブロック (5 形態) / コメント / <script> / スキャフォールド定数は除外。
//        許可: var(--…) / currentColor / none / transparent / inherit。
//        ※ 定義済み token と同じ値でも生書きは NG (テーマ切替を壊し、(B) ドリフトの主形態のため)。
//     2. var 解決 — 全 var(--x) 参照が当該 HTML の :root に定義されていること (自己完結 HTML 前提)。
//     3. SVG presentation 属性への var() 直書き検出 — fill="var(--x)" はブラウザで無効。
//        style="fill: var(--x)" / currentColor を使う (docs/html-generation-rules.md §2)。
//     4. イラスト正典一致 — _shared/illustrations/{name}.svg と path 署名が一致した埋め込みは
//        inner content が正典と byte 一致すること (chrome §11.5 と同型の verbatim 検証)。
//     5. :root 完全性 — _shared/root-variables.css の全変数名が当該 HTML の定義ブロックに揃っていること
//        (P-15「丸ごと inline copy」の機械強制。E2E CleanSnap で「使う変数だけ間引く」逸脱が 12/12 画面で
//        実発生し、紙の規約 (skill 17 self-check) では止まらないことが実証されたため lint に昇格。
//        画面固有の追加変数は許容 = superset OK、名前レベルの subset 検査)。
//   L2 Report (--report、人間ゲート用の事実収集):
//     - アイコン色変動マップ: 埋め込み SVG を path 署名で icons/{name}.svg と照合 (data 属性不要 =
//       chrome byte-check と無干渉)。同一アイコンの実効色ソースを (platform, theme) 別に列挙。
//       auto-fail しない (active/hover 等の正当な文脈変化と機械区別できないため。判断は Step 21 の人間)。
//     - 未照合 SVG: icons/ にもイラスト正典にも一致しない content SVG (正典化候補 or データ駆動)。
//     - 昇格キュー: 未解決の --color-illustration-* (Step 24 Step A-2b が読む)。
//     - 境界違反: --color-illustration-* が text color / 正典外で使われていないか (装飾専用ルール)。
//     - 台帳外 :root 色変数 (extra_root_vars): canon に無く色値を持つ :root 変数。superset 許容 (確定設計)
//       は維持するが、「リテラルを :root に持ち上げて var 化する」洗浄経路が L1/L2 とも不可視になる穴
//       (4ロールレビュー CRITICAL-1) を Step 21 人間ゲートで可視化する。auto-fail しない。
//
//   派生ファイル (basename に "--" を含む sub-state / theme 派生) の root_vars_incomplete は --check で
//   soft (soft_inherited) に分類する: 派生の :root は main から byte 継承 (SSB-11) され当該ファイルでは
//   修正不能のため (修正先 = main、Step 17/29 経路)。hard にすると 25b が直せない違反で死ぬ (CRITICAL-2)。
//
// report は derived artifact (HTML + tokens の決定的関数)。毎回丸ごと再生成 (上書き) するため
// append 台帳の世代管理問題は存在しない。人間の決定は従来の場所に残る (昇格→tokens.json via Step 24)。
//
// 使い方:
//   node scripts/lint-screen-colors.mjs --check <file.html> [...]   # L1 のみ。stdout JSON。違反あれば exit 1
//   node scripts/lint-screen-colors.mjs --report <artifacts/{app}>  # 全画面走査 → screens/color-lint-report.json
//   node scripts/lint-screen-colors.mjs --normalize-icons <artifacts/{app}>
//       # Step 17 Step 0 ヘルパー: icons/*.svg の stroke/fill="#hex" → "currentColor" に正規化 (冪等)
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

// ───────────────────────────── 定数 ─────────────────────────────

// スキャフォールド定数 (skill 17「モバイル画面のプレビュー構造」テンプレートの周囲グレー背景 / フォンフレーム影)。
// 製品 UI ではなくプレビュー足場のため、この **完全一致値のみ** リテラル許可。追加は本リストの改訂で行う。
const SCAFFOLD_ALLOW = new Set(["#e8e4df", "rgba(0,0,0,0.15)", "rgba(0,0,0,0.05)"]); // 小文字で保持し case-insensitive 照合

// 値として常に許可されるキーワード (色を「持ち込まない」表現)
const ALLOWED_KEYWORDS = new Set([
  "currentcolor",
  "transparent",
  "none",
  "inherit",
  "initial",
  "unset",
  "auto",
]);

// CSS named colors (CSS Color Module Level 4 の 148 色 + ベンダー無し基本形)。
// 色名の検出は「色を取りうる文脈」(COLOR_PROPS のプロパティ値 / SVG presentation 属性) に限定する。
// prettier-ignore
const NAMED_COLORS = new Set(("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" "));

// 色を取りうる CSS プロパティ (named color 検出と境界違反検出の文脈判定に使用)
// prettier-ignore
const COLOR_PROPS = new Set(["color","background","background-color","background-image","border","border-color","border-top","border-right","border-bottom","border-left","border-top-color","border-right-color","border-bottom-color","border-left-color","outline","outline-color","box-shadow","text-shadow","fill","stroke","stop-color","caret-color","accent-color","text-decoration","text-decoration-color","column-rule","column-rule-color","border-block","border-inline","background-blend-mode"]);

// SVG presentation 属性のうち色を取るもの
const COLOR_ATTRS = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"]);

// HTML void 要素 (タグスタック管理用)
const VOID_TAGS = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);

// 色リテラル検出正規表現
const RE_HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RE_COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/g;
const RE_VAR = /var\(\s*(--[A-Za-z0-9_-]+)/g;

// report の instance / screens リスト上限 (context 爆発防止。総数は count で保持)
const CAP_INSTANCES = 5;
const CAP_SCREENS = 8;

// ───────────────────────────── 汎用ユーティリティ ─────────────────────────────

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

// コメント / <script> 等を同じ長さの空白で潰す (index/line 番号を保ったまま走査対象から外す)
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

// ───────────────────────────── CSS 走査 ─────────────────────────────
//
// brace 追跡で「いまどのセレクタの中か」を持ちながら宣言を列挙する。
// :root 定義ブロック (5 形態: :root / :root[data-theme="light"] /
// :root[data-theme="dark"] / @media(prefers-color-scheme){ :root:not([data-theme]) } 等) は
// セレクタが ":root" で始まるかで判定し、その中の宣言は「定義」として扱う (リテラル検査対象外 +
// 変数定義の収集対象)。

function* cssDeclarations(css) {
  // CSS コメントを除去 (index 維持)
  const masked = maskRanges(css, findRanges(css, /\/\*/g, "*/"));
  const stack = []; // selector text の配列
  let buf = "";
  let bufStart = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
      bufStart = i + 1;
    } else if (ch === "}") {
      if (buf.trim()) yield* emitDecls(buf, bufStart, stack);
      buf = "";
      bufStart = i + 1;
      stack.pop();
    } else if (ch === ";") {
      if (buf.trim()) yield* emitDecls(buf + ";", bufStart, stack);
      buf = "";
      bufStart = i + 1;
    } else {
      buf += ch;
    }
  }

  function* emitDecls(chunk, start, sels) {
    const text = chunk.replace(/;$/, "");
    const colon = text.indexOf(":");
    if (colon === -1) return;
    const prop = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (!prop || !value) return;
    // 直近の非 @ セレクタで定義ブロック判定 (@media 内の :root も拾う)。
    // 定義ブロック = token を定義してよい場所。**セレクタの完全形** で判定する —
    // 前方一致だと `:root .promo { --x: #hex }` のような子孫セレクタが「定義」として通り、
    // literal 洗浄経路になる (レビュー#3 で実証された迂回路を封鎖)。
    // セレクタリスト (`:root,\n[data-theme="light"]` 等の inline-copy 実在形) はカンマ分割し、
    // **全パーツ** が許容形のときのみ定義ブロックとする (子孫形が 1 つでも混ざれば非定義)。
    // 許容形: :root / :root[…] / :root:not(…) (5 形態) + legacy の html[…] / [data-theme=…]
    const sel = [...sels].reverse().find((s) => s && !s.startsWith("@")) || "";
    const DEF_PART = /^(?::root(?:\[[^\]]*\])?(?::not\([^)]*\))?|html(?:\[[^\]]*\])?|\[data-theme=[^\]]*\])$/;
    const parts = sel.split(",").map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    const inDefBlock = parts.length > 0 && parts.every((p) => DEF_PART.test(p));
    yield { prop, value, selector: sel, selectorChain: [...sels], index: start, inDefBlock };
  }
}

// value 文字列から色リテラルを抽出。
// - var() の中身は除外しない (fallback リテラル `var(--x, #fff)` も検出対象)
// - url(#id) は色でない (gradient/clip 参照)。id が hex 字のみの語 (#fade 等) を誤検出しないよう
//   hex / color-fn 走査の前に url(...) を除去する (レビュー#3 修正)
function literalsInValue(value, propOrAttr, { namedContext }) {
  const found = [];
  let m;
  const scanBase = value.replace(/url\([^)]*\)/gi, (s) => " ".repeat(s.length));
  RE_HEX.lastIndex = 0;
  while ((m = RE_HEX.exec(scanBase)) !== null) found.push({ value: m[0], kind: "hex" });
  RE_COLOR_FN.lastIndex = 0;
  while ((m = RE_COLOR_FN.exec(scanBase)) !== null) {
    // 関数全体 (対応括弧まで) を切り出す
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < scanBase.length; j++) {
      if (scanBase[j] === "(") depth++;
      else if (scanBase[j] === ")") { depth--; if (depth === 0) break; }
    }
    found.push({ value: scanBase.slice(m.index, j + 1).replace(/\s+/g, ""), kind: "color-fn" });
  }
  if (namedContext) {
    // var(--color-tan) のような識別子内の単語に誤反応しないよう var(...) も除去してから判定
    const stripped = scanBase.toLowerCase().replace(/var\([^)]*\)/g, " ");
    for (const word of stripped.split(/[^a-z]+/)) {
      if (NAMED_COLORS.has(word) && !ALLOWED_KEYWORDS.has(word)) found.push({ value: word, kind: "named" });
    }
  }
  // scaffold allowlist は大文字小文字非依存で照合 (CSS の hex は case-insensitive)
  return found.filter((f) => !SCAFFOLD_ALLOW.has(f.value.toLowerCase()) && !ALLOWED_KEYWORDS.has(f.value.toLowerCase()));
}

// ───────────────────────────── HTML 走査 (タグスタック) ─────────────────────────────

const RE_TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const RE_ATTR = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttrs(raw) {
  const attrs = {};
  let m;
  RE_ATTR.lastIndex = 0;
  while ((m = RE_ATTR.exec(raw)) !== null) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
  return attrs;
}

// <svg>…</svg> ブロックを (入れ子対応で) 列挙
function* svgBlocks(body) {
  const re = /<svg\b|<\/svg>/gi;
  let m, depth = 0, start = -1;
  while ((m = re.exec(body)) !== null) {
    if (m[0].toLowerCase() === "<svg" || m[0].toLowerCase().startsWith("<svg")) {
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

// SVG の形状署名: path d / polyline points に加え、circle / ellipse / rect / line の幾何属性も含める。
// 「同じ絵か」をラベル (data 属性 / AI 命名) でなく **実物の形状データ** で決める。
// circle 系のみで構成された絵 (太陽の典型形) が署名 null で照合から脱落する盲点をレビュー#3 で修正。
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
  if (parts.length === 0) return null; // 形状要素を一切持たない SVG のみ署名不能
  parts.sort();
  return sha(parts.join("|"));
}

function svgInner(svgHtml) {
  const open = svgHtml.indexOf(">");
  const close = svgHtml.lastIndexOf("</svg");
  if (open === -1 || close === -1) return "";
  return svgHtml.slice(open + 1, close);
}

// ───────────────────────────── 単一ファイルの L1 検査 ─────────────────────────────

function platformOf(filePath) {
  const segs = resolve(filePath).split(sep);
  if (segs.includes("web-sm")) return "web-sm"; // web より先に判定 (dir 名は完全一致 segment なので順不同でも安全だが明示)
  if (segs.includes("web")) return "web";
  if (segs.includes("mobile")) return "mobile";
  return "other";
}

function themeOf(filePath, html) {
  const name = basename(filePath);
  if (/--light\.html$/.test(name) || /--light--/.test(name)) return "light";
  if (/--dark\.html$/.test(name) || /--dark--/.test(name)) return "dark";
  const m = html.match(/<html[^>]*\bdata-theme="(light|dark)"/);
  return m ? m[1] : "default";
}

function lintFile(filePath, { iconSigs, illustSigs, illustInner, canonVars }) {
  const raw = readFileSync(filePath, "utf8");
  // コメント / script を mask (line 番号維持)
  const masked = maskRanges(raw, [
    ...findRanges(raw, /<!--/g, "-->"),
    ...findRanges(raw, /<script\b/g, "</script>"),
  ]);

  const violations = []; // L1
  const definedVars = new Map(); // name → Set(rootSelector)
  const usedVars = []; // {name, line}
  const extraRootVars = []; // L2: canon 外で色値を持つ :root 変数 {name, value, line} (洗浄経路の可視化)
  let firstDefLine = null; // 最初の定義ブロック行 (root_vars_incomplete の報告位置)
  const fileMeta = { platform: platformOf(filePath), theme: themeOf(filePath, masked) };

  const push = (type, value, line, context, hint) =>
    violations.push({ type, value, line, context, ...(hint ? { hint } : {}) });

  // ── 外部 stylesheet <link> 検出 (CSS 自己完結ルール違反。Google Fonts は許可) ──
  for (const m of masked.matchAll(/<link\b[^>]*>/g)) {
    const attrs = parseAttrs(m[0]);
    if ((attrs.rel || "").toLowerCase() !== "stylesheet") continue;
    const href = attrs.href || "";
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(href)) continue;
    push("external_stylesheet", href, lineOf(masked, m.index), "<link rel=\"stylesheet\">",
      "CSS 自己完結ルール違反 (skill 17)。:root / 共通スタイルは各 HTML の <style> にインライン展開する。本ファイルの var 解決も全て失敗するため unresolved_var が併発する");
  }

  // ── <style> ブロック ──
  const styleRanges = findRanges(masked, /<style\b[^>]*>/g, "</style>");
  for (const [s, e] of styleRanges) {
    const open = masked.indexOf(">", s);
    const css = masked.slice(open + 1, e - "</style>".length);
    const cssBase = open + 1;
    // @import も <link> 同様に外部 CSS 参照 (CSS 自己完結ルール違反) として検出
    for (const mi of css.matchAll(/@import\b[^;]*;/g)) {
      push("external_stylesheet", mi[0].trim(), lineOf(masked, cssBase + mi.index), "<style> @import",
        "CSS 自己完結ルール違反 (skill 17)。@import も <link> と同様 file:// で読み込まれない");
    }
    for (const d of cssDeclarations(css)) {
      const line = lineOf(masked, cssBase + d.index);
      if (d.inDefBlock && d.prop.startsWith("--")) {
        // 定義ブロック内の custom property = token 定義。リテラル検査対象外。
        // alias 定義 (--a: var(--b)) の参照は解決チェック対象として収集する。
        if (firstDefLine === null) firstDefLine = line;
        if (!definedVars.has(d.prop)) definedVars.set(d.prop, new Set());
        definedVars.get(d.prop).add(d.selector);
        // L2: canon 外かつ色値を持つ定義 = 台帳外色の洗浄経路候補。違反にはしない (superset 許容) が
        // report の extra_root_vars に載せ Step 21 で人間が判断する (正当な画面固有値 / 洗浄の区別は人間)
        if (canonVars && canonVars.size > 0 && !canonVars.has(d.prop) &&
            literalsInValue(d.value, d.prop, { namedContext: true }).length > 0) {
          extraRootVars.push({ name: d.prop, value: d.value.trim(), line });
        }
        let mv;
        RE_VAR.lastIndex = 0;
        while ((mv = RE_VAR.exec(d.value)) !== null) usedVars.push({ name: mv[1], line });
        continue;
      }
      // 定義ブロック外での custom property 定義は「リテラルの洗浄経路」になるため、
      // 色値を持つ場合は通常宣言と同じく literal として検査する (定義としては数えない = SoT は定義ブロックのみ)
      const named = COLOR_PROPS.has(d.prop) || d.prop.startsWith("--");
      for (const lit of literalsInValue(d.value, d.prop, { namedContext: named })) {
        push("literal", lit.value, line, `${d.selector} { ${d.prop}: … }`,
          "var(--token) で参照する (zero-literal、docs/html-generation-rules.md §1)");
      }
      let m;
      RE_VAR.lastIndex = 0;
      while ((m = RE_VAR.exec(d.value)) !== null) usedVars.push({ name: m[1], line });
    }
  }

  // ── body (style 部分を mask して属性走査) ──
  const body = maskRanges(masked, styleRanges);

  RE_TAG.lastIndex = 0;
  let t;
  while ((t = RE_TAG.exec(body)) !== null) {
    if (t[1] === "/") continue;
    const attrs = parseAttrs(t[3]);
    const line = lineOf(body, t.index);
    for (const [attr, val] of Object.entries(attrs)) {
      if (COLOR_ATTRS.has(attr)) {
        if (/var\s*\(/.test(val)) {
          push("var_in_presentation_attr", `${attr}="${val}"`, line, `<${t[2]}>`,
            `SVG presentation 属性の var() はブラウザで無効。style="${attr}: ${val}" か currentColor を使う`);
          let m; RE_VAR.lastIndex = 0;
          while ((m = RE_VAR.exec(val)) !== null) usedVars.push({ name: m[1], line });
          continue;
        }
        for (const lit of literalsInValue(val, attr, { namedContext: true })) {
          push("literal", lit.value, line, `<${t[2]} ${attr}="…">`,
            `currentColor か style="${attr}: var(--token)" に置換する`);
        }
      }
      if (attr === "style") {
        for (const part of val.split(";")) {
          const c = part.indexOf(":");
          if (c === -1) continue;
          const prop = part.slice(0, c).trim().toLowerCase();
          const v = part.slice(c + 1).trim();
          for (const lit of literalsInValue(v, prop, { namedContext: COLOR_PROPS.has(prop) })) {
            push("literal", lit.value, line, `<${t[2]} style="${prop}: …">`,
              "var(--token) で参照する (zero-literal)");
          }
          let m; RE_VAR.lastIndex = 0;
          while ((m = RE_VAR.exec(v)) !== null) usedVars.push({ name: m[1], line });
        }
      }
    }
  }

  // ── var 解決 (L1-2): 自己完結 HTML なので :root 定義は同一ファイル内に必ずある前提 ──
  const definedNames = new Set(definedVars.keys());
  const unresolvedSeen = new Set();
  for (const u of usedVars) {
    if (!definedNames.has(u.name) && !unresolvedSeen.has(u.name + "@" + u.line)) {
      unresolvedSeen.add(u.name + "@" + u.line);
      push("unresolved_var", `var(${u.name})`, u.line, "",
        u.name.startsWith("--color-illustration-")
          ? "未承認の装飾色。color-lint-report の昇格キュー経由で Step 21 ゲート → Step 24 で tokens.json に昇格する"
          : ":root に定義が無い (typo か、tokens.json 未定義)。トークン名を確認する");
    }
  }

  // ── :root 完全性 (L1-5): P-15「root-variables.css を丸ごと inline copy」の機械照合 ──
  // main の :root が全 token 変数を持つことは main↔sub-state (25b inherit_main) 一貫性の前提。
  // skill 17 の手動カウント self-check は紙の規約で、E2E (CleanSnap) で 12/12 画面が
  // 「使う変数だけに間引く」逸脱をしたため fail-closed 検査に昇格。画面固有の追加変数 (--nav-height 等)
  // は許容する (superset OK)。値の検証はしない (名前レベルのみ — 値の改竄は P-15 単方向フロー +
  // Step 29 preserved :root spot-check の責務)。
  if (canonVars && canonVars.size > 0) {
    const missing = [...canonVars].filter((n) => !definedVars.has(n));
    if (missing.length > 0) {
      const shown = missing.slice(0, 10).join(", ") + (missing.length > 10 ? ` … (+${missing.length - 10} more)` : "");
      push("root_vars_incomplete", `${missing.length} vars missing from :root`, firstDefLine ?? 1, shown,
        "_shared/root-variables.css の :root ブロックを丸ごと inline copy する (使う変数だけの間引きは禁止 — skill 17「CSS 自己完結ルール」/ P-15。docs/html-generation-rules.md §12)。不足分を個別に足すより正典ブロックを丸ごと貼り直すのが確実");
    }
  }

  // ── SVG ブロック: 署名照合 (icons / illustrations) + 正典 verbatim 検証 (L1-4) ──
  const svgInfos = [];
  for (const blk of svgBlocks(body)) {
    const sig = svgSignature(blk.html);
    const line = lineOf(body, blk.start);
    let match = null;
    if (sig && iconSigs.has(sig)) match = { kind: "icon", name: iconSigs.get(sig) };
    else if (sig && illustSigs.has(sig)) {
      match = { kind: "illustration", name: illustSigs.get(sig) };
      const canon = illustInner.get(illustSigs.get(sig));
      if (canon !== undefined && svgInner(blk.html) !== canon) {
        push("illustration_canon_mismatch", illustSigs.get(sig), line, "<svg>",
          "イラストは _shared/illustrations/ の正典を verbatim ペーストする (サイズ系属性は外側 <svg> タグのみ可変)。正典を直して全画面へ再ペースト (§11.6 と同方針)");
      }
    }
    svgInfos.push({ sig, line, match, start: blk.start, end: blk.end });
  }

  // 変数定義の theme 非対称 (warning 相当 — report 側でまとめる)
  const themeAsymmetry = [];
  const rootSels = new Set([...definedVars.values()].flatMap((s) => [...s]));
  if (rootSels.size > 1) {
    for (const [name, sels] of definedVars) {
      if (sels.size < rootSels.size) themeAsymmetry.push({ name, definedIn: [...sels] });
    }
  }

  return { filePath, ...fileMeta, violations, definedVars, usedVars, extraRootVars, svgInfos, body, masked, themeAsymmetry };
}

// ───────────────────────────── 実効色ソース解決 (L2 アイコン色変動マップ用) ─────────────────────────────
//
// 各 HTML は自己完結 (CSS は同一ファイル内) なので静的に近似解決できる:
//   1. <svg> 自身または祖先要素の inline style の color/fill/stroke の var() → "style:var(--x)"
//   2. 祖先要素の class に対する、このファイル <style> 内の color/fill/stroke 宣言 → "class .cls→var(--x)"
//   3. 解決不能 → "indeterminate" (report にそのまま出し、人間ゲートで判断)
// cascade の完全実装はしない (決定論の範囲で近似し、曖昧なものは indeterminate と正直に言う)。

function buildClassColorIndex(fileResult) {
  const idx = new Map(); // ".cls" → [{prop, value, selector}]
  const styleRanges = findRanges(fileResult.masked, /<style\b[^>]*>/g, "</style>");
  for (const [s, e] of styleRanges) {
    const open = fileResult.masked.indexOf(">", s);
    const css = fileResult.masked.slice(open + 1, e - "</style>".length);
    for (const d of cssDeclarations(css)) {
      if (d.inDefBlock) continue;
      if (!["color", "fill", "stroke"].includes(d.prop)) continue;
      for (const m of d.selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        const cls = m[1];
        if (!idx.has(cls)) idx.set(cls, []);
        idx.get(cls).push({ prop: d.prop, value: d.value.trim(), selector: d.selector });
      }
    }
  }
  return idx;
}

function resolveIconColorSources(fileResult) {
  const classIdx = buildClassColorIndex(fileResult);
  const body = fileResult.body;
  const results = []; // {sig, name, source}
  // タグスタックを作りながら svg 開始位置で祖先を見る
  const stack = [];
  RE_TAG.lastIndex = 0;
  let t;
  // icon に加え illustration 正典一致分も対象にする (4ロールレビュー MAJOR-4: currentColor 正典は
  // verbatim 一致でも親色で描画色が変わるため、親色ソースの変動を variance map で人間に見せる)
  const svgAt = new Map(fileResult.svgInfos.filter((s) => s.match).map((s) => [s.start, s]));
  while ((t = RE_TAG.exec(body)) !== null) {
    const [full, slash, tag, rawAttrs, selfClose] = t;
    const lower = tag.toLowerCase();
    if (slash === "/") {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === lower) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = parseAttrs(rawAttrs);
    if (svgAt.has(t.index)) {
      const info = svgAt.get(t.index);
      let source = null;
      const chain = [...stack, { tag: lower, attrs }];
      for (let i = chain.length - 1; i >= 0 && !source; i--) {
        const st = chain[i].attrs?.style || "";
        const m = st.match(/(?:^|;)\s*(?:color|fill|stroke)\s*:\s*(var\(--[A-Za-z0-9_-]+\)|currentcolor)/i);
        if (m) source = `style:${m[1]}`;
      }
      for (let i = chain.length - 1; i >= 0 && !source; i--) {
        const classes = (chain[i].attrs?.class || "").split(/\s+/).filter(Boolean);
        const hits = [];
        for (const c of classes) for (const d of classIdx.get(c) || []) hits.push({ label: `.${c}{${d.prop}:${d.value}}`, value: d.value });
        if (hits.length === 1) source = `class ${hits[0].label}`;
        else if (hits.length > 1) {
          // 複数宣言でも解決値が同一なら 1 ソースに畳む (例: stroke:currentColor + color:var(--x) →
          // 実効値は var(--x)。indeterminate 乱発を避ける、レビュー#3 改善)
          const varVals = new Set(hits.map((h) => (h.value.match(/var\(--[A-Za-z0-9_-]+\)/) || [h.value])[0]));
          if (varVals.size === 1) source = `class(×${hits.length}) → ${[...varVals][0]}`;
          else source = `indeterminate(${hits.slice(0, 3).map((h) => h.label).join(" | ")})`;
        }
      }
      results.push({ name: info.match.name, kind: info.match.kind, source: source || "indeterminate" });
    }
    if (!VOID_TAGS.has(lower) && selfClose !== "/" && !full.endsWith("/>")) stack.push({ tag: lower, attrs });
  }
  return results;
}

// ───────────────────────────── 資産ロード ─────────────────────────────

function loadSvgDir(dir) {
  const sigs = new Map(); // sig → name
  const inner = new Map(); // name → inner (verbatim 比較用)
  const sourceViolations = [];
  if (!existsSync(dir)) return { sigs, inner, sourceViolations };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
    const html = readFileSync(join(dir, f), "utf8");
    const name = f.replace(/\.svg$/, "");
    const sig = svgSignature(html);
    if (sig) sigs.set(sig, name);
    inner.set(name, svgInner(html.trim()));
    // source 内のリテラル (currentColor 正規化漏れ / 正典内の生 hex) を検出。
    // presentation 属性に加え、inline style / <style> 内の宣言値も走査する (レビュー#3 m9)
    const lits = [];
    for (const m of html.matchAll(/(fill|stroke|stop-color)="([^"]+)"/g)) {
      const v = m[2];
      if (!ALLOWED_KEYWORDS.has(v.toLowerCase()) && !/^url\(/.test(v) && !/^var\(/.test(v) && literalsInValue(v, m[1], { namedContext: true }).length > 0) {
        lits.push(`${m[1]}="${v}"`);
      }
    }
    for (const m of html.matchAll(/style="([^"]*)"/g)) {
      for (const part of m[1].split(";")) {
        const c = part.indexOf(":");
        if (c === -1) continue;
        const prop = part.slice(0, c).trim().toLowerCase();
        const v = part.slice(c + 1).trim();
        for (const lit of literalsInValue(v, prop, { namedContext: COLOR_PROPS.has(prop) })) lits.push(`style ${prop}: ${lit.value}`);
      }
    }
    for (const sm of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      for (const d of cssDeclarations(sm[1])) {
        for (const lit of literalsInValue(d.value, d.prop, { namedContext: COLOR_PROPS.has(d.prop) || d.prop.startsWith("--") })) lits.push(`<style> ${d.prop}: ${lit.value}`);
      }
    }
    if (lits.length > 0) sourceViolations.push({ file: f, literals: [...new Set(lits)].slice(0, CAP_INSTANCES) });
  }
  return { sigs, inner, sourceViolations };
}

// P-15 正典 (_shared/root-variables.css) の変数名集合をロードする。
// 不在 (legacy プロジェクト / Step 17 Phase A 実行前) は null を返し、L1-5 検査は skip される
// (後方互換: 正典が無い世界では「丸ごと copy」規約自体が存在しないため)。
function loadCanonVars(appRoot) {
  if (!appRoot) return null;
  const p = join(appRoot, "screens", "_shared", "root-variables.css");
  if (!existsSync(p)) return null;
  const names = new Set();
  for (const d of cssDeclarations(readFileSync(p, "utf8"))) {
    if (d.inDefBlock && d.prop.startsWith("--")) names.add(d.prop);
  }
  return names.size > 0 ? names : null;
}

function appRootOf(filePath) {
  // …/{appRoot}/screens/{platform}/x.html から {appRoot} を導出。
  // 'screens' セグメント基準 (テスト用に artifacts/_scratch/... 等へ nest しても正しく解決する)。
  const segs = resolve(filePath).split(sep);
  const i = segs.lastIndexOf("screens");
  if (i > 0) return segs.slice(0, i).join(sep);
  // fallback: artifacts/{app} 形
  const a = segs.lastIndexOf("artifacts");
  if (a !== -1 && a + 1 < segs.length) return segs.slice(0, a + 2).join(sep);
  return null;
}

function listScreenHtml(appRoot) {
  const out = [];
  for (const plat of ["web", "web-sm", "mobile"]) {
    const dir = join(appRoot, "screens", plat);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".html") && !/\.bak/.test(f)) out.push(join(dir, f));
    }
  }
  return out.sort();
}

// ───────────────────────────── モード実装 ─────────────────────────────

// --check の出力契約 (レビュー#3 で改訂、4ロールレビューで soft_inherited 追加):
// - hard / soft を分離: soft = (a) 未解決の --color-illustration-* (= 昇格候補。欠陥でなく Escape Hatch の
//   正常経路、soft_promotions)、(b) 派生ファイルの root_vars_incomplete (= main 由来で当該ファイル修正不能、
//   soft_inherited — 修正先は main)。**exit 1 は hard がある場合のみ** — 「soft だけなら続行可」の判定が
//   機械化され、orchestrator が stdout を解釈して exit code を上書きする必要は無い。
// - (type, value) で dedup + instances cap (リトライループで LLM が読む入力。旧実装は legacy 1 ファイルで
//   53KB に達した)。総数は count で保持。
function groupViolations(violations) {
  const map = new Map();
  for (const v of violations) {
    const key = `${v.type}|${v.value}`;
    if (!map.has(key)) map.set(key, { type: v.type, value: v.value, count: 0, instances: [], ...(v.hint ? { hint: v.hint } : {}) });
    const g = map.get(key);
    g.count++;
    if (g.instances.length < CAP_INSTANCES) g.instances.push({ line: v.line, ...(v.context ? { context: v.context } : {}) });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

const isSoft = (v) => v.type === "unresolved_var" && v.value.startsWith("var(--color-illustration-");

function runCheck(files) {
  let hardTotal = 0;
  const results = [];
  for (const fp of files) {
    let r;
    try {
      const appRoot = appRootOf(fp);
      const icons = loadSvgDir(appRoot ? join(appRoot, "icons") : "");
      const illust = loadSvgDir(appRoot ? join(appRoot, "screens", "_shared", "illustrations") : "");
      const canonVars = loadCanonVars(appRoot);
      r = lintFile(fp, { iconSigs: icons.sigs, illustSigs: illust.sigs, illustInner: illust.inner, canonVars });
    } catch (e) {
      // 運用エラー (ENOENT 等) は「違反」と区別して exit 2 (リトライ浪費防止)
      console.error(`[lint-screen-colors] cannot lint ${fp}: ${e.message}`);
      process.exit(2);
    }
    // 派生ファイル (sub-state / theme 派生 = basename に "--") の root_vars_incomplete は soft_inherited:
    // 派生の :root は main から byte 継承 (SSB-11) され当該ファイルでは修正不能 (修正先 = main、Step 17/29)。
    // hard にすると 25b が直せない違反でリトライ全滅する (4ロールレビュー CRITICAL-2)
    const isDerived = basename(fp).includes("--");
    const isInherited = (v) => isDerived && v.type === "root_vars_incomplete";
    const hard = r.violations.filter((v) => !isSoft(v) && !isInherited(v));
    const soft = r.violations.filter(isSoft);
    const inherited = r.violations.filter(isInherited);
    hardTotal += hard.length;
    results.push({
      file: fp,
      hard_count: hard.length,
      soft_count: soft.length + inherited.length,
      hard: groupViolations(hard),
      soft_promotions: groupViolations(soft),
      ...(inherited.length > 0 ? { soft_inherited: groupViolations(inherited) } : {}),
    });
  }
  process.stdout.write(JSON.stringify({ mode: "check", hard_violations: hardTotal, files: results }, null, 2) + "\n");
  process.exit(hardTotal > 0 ? 1 : 0);
}

function runReport(appRoot, outOverride) {
  if (!existsSync(join(appRoot, "screens"))) {
    console.error(`[lint-screen-colors] not an app root (screens/ not found): ${appRoot}`);
    process.exit(2);
  }
  const appName = basename(resolve(appRoot));
  const icons = loadSvgDir(join(appRoot, "icons"));
  const illust = loadSvgDir(join(appRoot, "screens", "_shared", "illustrations"));
  const canonVars = loadCanonVars(appRoot);
  const files = listScreenHtml(appRoot);

  const litAgg = new Map(); // key=(value|platform|theme) → {…}
  const unresolvedAgg = new Map();
  const otherViolations = [];
  const iconMap = new Map(); // icon → Map(source|platform|theme → {screens,count})
  const unmatchedAgg = new Map(); // sig → {…}
  const boundary = [];
  const asymmetry = new Map();
  const extraAgg = new Map(); // 台帳外 :root 色変数 (name|value|platform|theme → {…})

  for (const fp of files) {
    const r = lintFile(fp, { iconSigs: icons.sigs, illustSigs: illust.sigs, illustInner: illust.inner, canonVars });
    const screen = basename(fp);
    for (const v of r.violations) {
      if (v.type === "literal") {
        const key = `${v.value}|${r.platform}|${r.theme}`;
        if (!litAgg.has(key)) litAgg.set(key, { value: v.value, platform: r.platform, theme: r.theme, count: 0, instances: [] });
        const a = litAgg.get(key);
        a.count++;
        if (a.instances.length < CAP_INSTANCES) a.instances.push({ file: screen, line: v.line, context: v.context });
      } else if (v.type === "unresolved_var") {
        const key = `${v.value}|${r.platform}|${r.theme}`;
        if (!unresolvedAgg.has(key)) unresolvedAgg.set(key, { name: v.value.replace(/^var\(|\)$/g, ""), platform: r.platform, theme: r.theme, count: 0, instances: [], hint: v.hint });
        const a = unresolvedAgg.get(key);
        a.count++;
        if (a.instances.length < CAP_INSTANCES) a.instances.push({ file: screen, line: v.line });
      } else {
        otherViolations.push({ ...v, file: screen, platform: r.platform, theme: r.theme });
      }
    }
    // アイコン / イラスト色変動マップ (illustration は currentColor 正典の親色ドリフト検出用)
    for (const ic of resolveIconColorSources(r)) {
      const mapKey = `${ic.kind}:${ic.name}`;
      if (!iconMap.has(mapKey)) iconMap.set(mapKey, new Map());
      const key = `${ic.source}|${r.platform}|${r.theme}`;
      const m = iconMap.get(mapKey);
      if (!m.has(key)) m.set(key, { source: ic.source, platform: r.platform, theme: r.theme, count: 0, screens: [] });
      const e = m.get(key);
      e.count++;
      if (e.screens.length < CAP_SCREENS && !e.screens.includes(screen)) e.screens.push(screen);
    }
    // 未照合 SVG
    for (const s of r.svgInfos) {
      if (s.match || !s.sig) continue;
      if (!unmatchedAgg.has(s.sig)) unmatchedAgg.set(s.sig, { signature: s.sig, count: 0, screens: [], sample: { file: screen, line: s.line } });
      const u = unmatchedAgg.get(s.sig);
      u.count++;
      if (u.screens.length < CAP_SCREENS && !u.screens.includes(screen)) u.screens.push(screen);
    }
    // 境界違反: --color-illustration-* が SVG の外 (CSS の text color / UI 要素) で使われた (装飾専用ルール)。
    // 「いずれかの inline SVG の内側」での使用は装飾とみなし flag しない — 正典未登録の inline 装飾で
    // 昇格キューと境界違反が同時掲載される偽ペア (レビュー#3) を回避する (正典化の促しは unmatched_svgs が担う)。
    for (const u of r.usedVars) {
      if (u.name.startsWith("--color-illustration-")) {
        const insideAnySvg = r.svgInfos.some((s) => u.line >= lineOf(r.body, s.start) && u.line <= lineOf(r.body, s.end));
        if (!insideAnySvg) boundary.push({ var: u.name, file: screen, line: u.line, note: "SVG 外での装飾色使用 (text/UI への転用は通常パレットへ — §4.6 境界ルール)" });
      }
    }
    for (const a of r.themeAsymmetry) {
      if (!asymmetry.has(a.name)) asymmetry.set(a.name, { name: a.name, files: [] });
      if (asymmetry.get(a.name).files.length < CAP_SCREENS) asymmetry.get(a.name).files.push(screen);
    }
    // 台帳外 :root 色変数 (L2 — 「リテラルの :root 持ち上げ」洗浄経路の可視化、auto-fail しない)
    for (const ev of r.extraRootVars) {
      const key = `${ev.name}|${ev.value}|${r.platform}|${r.theme}`;
      if (!extraAgg.has(key)) extraAgg.set(key, { name: ev.name, value: ev.value, platform: r.platform, theme: r.theme, count: 0, screens: [] });
      const a = extraAgg.get(key);
      a.count++;
      if (a.screens.length < CAP_SCREENS && !a.screens.includes(screen)) a.screens.push(screen);
    }
  }

  // 同一アイコンで色ソースが複数あるものだけ variance として残す (currentColor 追従は除外しない —
  // ソースが「どの token か」のレベルで割れている事実を人間に見せる。判断は Step 21)
  const iconVariance = [];
  for (const [mapKey, m] of iconMap) {
    const [kind, ...rest] = mapKey.split(":");
    const entries = [...m.values()];
    const distinctSources = new Set(entries.map((e) => e.source));
    if (distinctSources.size > 1) iconVariance.push({ icon: rest.join(":"), kind, usages: entries });
  }

  const promotionQueue = [...unresolvedAgg.values()]
    .filter((u) => u.name.startsWith("--color-illustration-"))
    .map((u) => ({ kind: "illustration_color", name: u.name, platform: u.platform, theme: u.theme, count: u.count, instances: u.instances }));

  const report = {
    app_name: appName,
    generated_at: new Date().toISOString(),
    scanned: { files: files.length, icons: icons.sigs.size, illustrations: illust.sigs.size },
    violations: {
      literals: [...litAgg.values()].sort((a, b) => b.count - a.count),
      unresolved_vars: [...unresolvedAgg.values()].sort((a, b) => b.count - a.count),
      other: otherViolations,
      icon_source_violations: icons.sourceViolations,
      illustration_source_violations: illust.sourceViolations,
    },
    icon_color_variance: iconVariance,
    unmatched_svgs: [...unmatchedAgg.values()].sort((a, b) => b.count - a.count),
    promotion_queue: promotionQueue,
    boundary_violations: boundary,
    theme_asymmetry: [...asymmetry.values()],
    extra_root_vars: [...extraAgg.values()].sort((a, b) => b.count - a.count),
    summary: {
      literal_colors: litAgg.size,
      literal_occurrences: [...litAgg.values()].reduce((s, a) => s + a.count, 0),
      unresolved_vars: unresolvedAgg.size,
      unresolved_vars_excl_promotion: unresolvedAgg.size - promotionQueue.length,
      other_violations: otherViolations.length,
      other_by_type: otherViolations.reduce((acc, o) => ((acc[o.type] = (acc[o.type] || 0) + 1), acc), {}),
      icons_with_variance: iconVariance.length,
      unmatched_svgs: unmatchedAgg.size,
      promotion_queue: promotionQueue.length,
      boundary_violations: boundary.length,
      extra_root_vars: extraAgg.size,
    },
  };

  const outPath = outOverride || join(appRoot, "screens", "color-lint-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  const s = report.summary;
  console.log(
    `[lint-screen-colors] wrote ${outPath}\n` +
      `  files=${files.length} literals=${s.literal_colors}色/${s.literal_occurrences}件 unresolved=${s.unresolved_vars} ` +
      `other=${s.other_violations} icon-variance=${s.icons_with_variance} unmatched-svg=${s.unmatched_svgs} ` +
      `promote=${s.promotion_queue} boundary=${s.boundary_violations} extra-root-vars=${s.extra_root_vars}`
  );
}

function runNormalizeIcons(appRoot) {
  const dir = join(appRoot, "icons");
  if (!existsSync(dir)) {
    console.error(`[lint-screen-colors] icons dir not found: ${dir}`);
    process.exit(1);
  }
  let changed = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
    const p = join(dir, f);
    const before = readFileSync(p, "utf8");
    // fill/stroke の色値を currentColor へ (none / currentColor / url(...) / var(...) は保持)。冪等。
    // stop-color は意図的に対象外 (gradient stop を currentColor に潰すと gradient が崩れるため)。
    // gradient 入り icon の source literal は icon_source_violations (report) → 人間判断に委ねる。
    const after = before.replace(/(fill|stroke)="([^"]+)"/g, (all, attr, v) => {
      const lower = v.toLowerCase();
      if (ALLOWED_KEYWORDS.has(lower) || lower.startsWith("url(") || lower.startsWith("var(")) return all;
      if (literalsInValue(v, attr, { namedContext: true }).length === 0) return all;
      return `${attr}="currentColor"`;
    });
    if (after !== before) {
      writeFileSync(p, after, "utf8");
      changed++;
    }
  }
  console.log(`[lint-screen-colors] normalize-icons: ${changed} file(s) rewritten to currentColor (idempotent)`);
}

// ───────────────────────────── CLI ─────────────────────────────

const args = process.argv.slice(2);
const mode = args[0];
if (mode === "--check" && args.length >= 2) {
  runCheck(args.slice(1));
} else if (mode === "--report" && args[1]) {
  // --out <path>: report の出力先 override (検証時に READ-ONLY fixture を汚さない用途)
  const outIdx = args.indexOf("--out");
  if (outIdx !== -1 && !args[outIdx + 1]) {
    console.error("[lint-screen-colors] --out requires a path argument");
    process.exit(2);
  }
  runReport(args[1], outIdx !== -1 ? args[outIdx + 1] : undefined);
} else if (mode === "--normalize-icons" && args[1]) {
  runNormalizeIcons(args[1]);
} else {
  console.error(
    "usage:\n" +
      "  node scripts/lint-screen-colors.mjs --check <file.html> [...]\n" +
      "  node scripts/lint-screen-colors.mjs --report <artifacts/{app}>\n" +
      "  node scripts/lint-screen-colors.mjs --normalize-icons <artifacts/{app}>"
  );
  process.exit(1);
}
