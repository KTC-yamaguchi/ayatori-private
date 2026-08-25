// Step 21a 共有ヘルパ — SVG ブロック列挙 + 形状署名 + タグ属性の文字列レベル解析。
//
// extract-inventory.mjs (インベントリ抽出) と render-recommend-html.mjs (視覚レポート生成、
// 視覚レポート生成) の両方が import する named-export モジュール。DOM parser を
// 使わない文字列レベル走査で完結する (node stdlib のみ = Operating Principle 1 準拠)。
//
// svgBlocks / svgSignature は scripts/lint-screen-colors.mjs の同名実装からの逐語移植 —
// 移植元とアルゴリズムを一致させること (Copilot review M1: I-5 プロトタイプは parts.sort()
// 欠落 + 形状タグの生テキストハッシュだったため、属性の順序入替や class 等の追加属性で
// 正典照合が崩れる退化があった)。署名の照合は 21a script 内 (正典 vs 画面) で閉じるため
// digest 形式まで lint 側と一致させる必要はないが、正規化ロジック (SHAPE_GEOM 命名属性抽出 +
// sort) は lint-screen-colors.mjs と同期を保つ。

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** body 中のトップレベル <svg>...</svg> ブロックを開始 offset 付きで列挙する (入れ子対応)。 */
export function* svgBlocks(body) {
  const re = /<svg\b|<\/svg>/gi;
  let depth = 0,
    start = -1,
    m;
  while ((m = re.exec(body)) !== null) {
    if (m[0].toLowerCase().startsWith("<svg")) {
      if (depth === 0) start = m.index;
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        const end = m.index + m[0].length;
        yield { start, html: body.slice(start, end) };
        start = -1;
      }
    }
  }
}

const RE_ATTR = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
/** open tag 文字列から属性 map (キーは lowercase) を取り出す。 */
export function parseAttrs(raw) {
  const attrs = {};
  let m;
  RE_ATTR.lastIndex = 0;
  while ((m = RE_ATTR.exec(raw)) !== null) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
  return attrs;
}

// 形状署名: path d / polyline points + circle/ellipse/rect/line の**命名幾何属性のみ** —
// 色・class・属性順序の差異に不変 (「同じ絵か」を実物の形状データで決める、scripts/lint-screen-colors.mjs の svgSignature と同方式)
const SHAPE_GEOM = {
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx"],
  line: ["x1", "y1", "x2", "y2"],
};
export function svgSignature(svgHtml) {
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
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** open tag の取り出しは引用符感知で行う (属性値内の ">" / 単引用符属性に安全 — subagent review m-2)。 */
export function openTagOf(tagHtml) {
  let q = null;
  for (let i = 0; i < tagHtml.length; i++) {
    const c = tagHtml[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === ">") {
      return tagHtml.slice(0, i + 1);
    }
  }
  return tagHtml;
}

export const lineOf = (body, idx) => body.slice(0, idx).split("\n").length;

// ── 包含タグ stack (text anchor の包含タグ特定 + アイコン用途分類の文脈特徴量で共用) ──

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * idx 位置を包む open tag の stack を文書順で返す (最後 = 最内)。
 * 各 entry: { tag, offset, cls } (cls = class 属性値、なければ null)。
 */
export function enclosingStack(body, idx) {
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m.index >= idx) break;
    const tag = m[1].toLowerCase();
    if (m[0][1] === "/") {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.splice(i);
          break;
        }
      }
    } else if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      stack.push({ tag, offset: m.index, cls: parseAttrs(m[2])["class"] ?? null });
    }
  }
  return stack;
}

/**
 * 同一ファイル <style> 内の CSS から、class token 群に対する表示 width (px) の最大値を
 * 推定する (best-effort heuristic — セレクタに `.{token}` を含む rule の `width: Npx`)。
 * - token は語境界で照合する (`.action-icon` が `.action-icon-large` に誤 hit しない)
 * - 160px 超の width はレイアウト幅 (カード / コンテナ) とみなし無視する — 親 class の
 *   布局 rule でアイコン表示サイズが過大推定されるのを防ぐ (アイコン系ビジュアルの
 *   表示サイズは実測レンジで最大 ~120px 級)
 * - stroke-width / border-width / min- / max- 等は lookbehind で除外
 * 見つからなければ null。
 */
const LAYOUT_WIDTH_PX = 160;
export function cssPxFor(styleText, classTokens) {
  let max = null;
  for (const token of classTokens.filter(Boolean)) {
    const re = new RegExp(`\\.${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])[^{}]*\\{[^}]*(?<![-\\w])width\\s*:\\s*([\\d.]+)px`, "g");
    let m;
    while ((m = re.exec(styleText)) !== null) {
      const px = Number(m[1]);
      if (px > LAYOUT_WIDTH_PX) continue;
      if (max === null || px > max) max = px;
    }
  }
  return max;
}

/** dir 直下の *.svg を読み、形状署名 → basename の Map を返す (正典署名の読込)。 */
export function loadCanonSigs(dir) {
  const sigs = new Map(); // sig -> name
  if (!fs.existsSync(dir)) return sigs;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
    const sig = svgSignature(fs.readFileSync(path.join(dir, f), "utf8"));
    if (sig) sigs.set(sig, path.basename(f, ".svg"));
  }
  return sigs;
}
