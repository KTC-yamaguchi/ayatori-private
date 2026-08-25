#!/usr/bin/env node
// scripts/lint-screen-frame.mjs
//
// 画面 HTML の「フレーム固定幅」適合を機械検証する決定的 lint (fail-closed)。
//
// 背景: Figma キャプチャ機構はブラウザで HTML を開き figmaselector で要素を切り出す方式で、
//   viewport 幅を制御できない。したがって各画面 HTML は「固定幅要素」を持つことが capture の
//   前提になる (skills/17-screen-gen/SKILL.md「HTML 固定サイズルール」/ docs/html-generation-rules.md §4)。
//   生成 LLM は「スマホ向け WEB = レスポンシブ」という事前分布に引っ張られ、fluid レイアウト
//   (width:100% + viewport meta + 固定幅ラッパー無し) を出力しがちで、その場合 Figma フレームが
//   ブラウザ窓幅に依存した意図しない幅で出力される。prose 規約だけでは止まらないため、
//   色 lint (lint-screen-colors.mjs) と同型の機械検証を生成直後 (Step 17 self-check) と
//   キャプチャ直前 (Step 22 pre-flight / figma-capture-runner 二次ガード) に置く。
//
// 検査内容 (platform はファイルパスの screens/{platform}/ セグメントから決定):
//   - web:            <style> 内に `body` ルール (selector list 可: `html, body` 等) が
//                     `width: 1440px` を宣言していること → 欠落は hard `fixed_frame_missing`
//   - web-sm / mobile: <style> 内に `.screen` ルールが `width: 390px` を宣言し、かつ
//                     <body> 配下に class="screen" 要素が存在すること → 欠落は hard `fixed_frame_missing`
//   - 全 platform:    幅ベースの media query (`@media ... (min-width|max-width)`) が無いこと
//                     → 存在は hard `width_media_query` (固定幅 capture の決定性を壊すため。
//                       prefers-reduced-motion / prefers-color-scheme 等の幅非依存クエリは許容)
//   - screens/{web,web-sm,mobile}/ 以外のパスは skipped として報告のみ (違反にしない)
//
// 注意: <meta name="viewport"> は検査対象外 (既存 mobile 画面も付与しており、固定幅ラッパーが
//   あればデスクトップブラウザでの capture に影響しない)。
//
// 使い方:
//   node scripts/lint-screen-frame.mjs --check <file.html> [<file2.html> ...]
//
// exit code 契約 (lint-screen-colors.mjs と同型):
//   0 = pass / 1 = hard 違反あり (修正対象) / 2 = 運用エラー (パス間違い等。違反と誤認しない)
//
// stdout: JSON { files: [{file, platform, violations: [{rule, detail}]}], hard_violations }

import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const WEB_FRAME_WIDTH = "1440px";
export const SM_FRAME_WIDTH = "390px";

export function platformOf(filePath) {
  const segs = resolve(filePath).split(sep);
  if (segs.includes("web-sm")) return "web-sm";
  if (segs.includes("web")) return "web";
  if (segs.includes("mobile")) return "mobile";
  return "other";
}

// <style> ブロックを全て連結して返す
export function extractCss(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out.join("\n");
}

// CSS を {selector, body} の flat なルール列に分解する軽量 parser。
// at-rule (@media 等) はネスト内側のルールをそのまま列挙し、at-rule 自体は捨てる
// (幅クエリの検出は raw CSS への regex で別途行う)。コメントは事前に除去。
export function extractRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const stack = [];
  let selStart = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") {
      stack.push(stripped.slice(selStart, i).trim());
      selStart = i + 1;
    } else if (ch === "}") {
      const body = stripped.slice(selStart, i);
      const sel = stack.pop();
      if (sel !== undefined && sel !== "" && !sel.startsWith("@")) {
        rules.push({ selector: sel, body });
      }
      selStart = i + 1;
    }
  }
  return rules;
}

function selectorListHas(selector, predicate) {
  return selector.split(",").some((part) => predicate(part.trim()));
}

function declaresWidth(body, widthValue) {
  return new RegExp(`(^|[;\\s])width\\s*:\\s*${widthValue}\\b`, "i").test(body);
}

export function checkFile(filePath) {
  const platform = platformOf(filePath);
  const violations = [];
  if (platform === "other") return { file: filePath, platform, skipped: true, violations };

  const html = readFileSync(filePath, "utf8");
  const css = extractCss(html);

  // 幅ベース media query (raw CSS へ直接 regex — at-rule ネストに依存しない)
  const widthQueries = css.match(/@media[^{]*\((?:min|max)-width[^)]*\)/gi) || [];
  for (const q of widthQueries) {
    violations.push({
      rule: "width_media_query",
      detail: `幅ベース media query は固定幅 capture の決定性を壊すため禁止: ${q.trim().slice(0, 80)}。幅ごとの表現は screens/{web,web-sm,mobile}/ の別ファイル派生で行う`,
    });
  }

  const rules = extractRules(css);
  if (platform === "web") {
    const ok = rules.some(
      (r) => selectorListHas(r.selector, (p) => p === "body" || /(^|\s)body$/.test(p)) && declaresWidth(r.body, WEB_FRAME_WIDTH)
    );
    if (!ok) {
      violations.push({
        rule: "fixed_frame_missing",
        detail: `web 画面は body { width: ${WEB_FRAME_WIDTH}; min-height: 900px; } の固定幅が必須 (fluid レイアウトはブラウザ窓幅で capture され幅が不定になる)`,
      });
    }
  } else {
    // web-sm / mobile: .screen ルール (390px) + markup 上の .screen 要素
    const cssOk = rules.some(
      (r) => selectorListHas(r.selector, (p) => p === ".screen" || /(^|[\s>+~])\.screen$/.test(p)) && declaresWidth(r.body, SM_FRAME_WIDTH)
    );
    const bodyHtml = (html.split(/<body[^>]*>/i)[1] || "");
    // class 属性値を空白 split したトークンとして "screen" を厳密比較 (screen-inner 等への誤 hit を防ぐ)
    const markupOk = [...bodyHtml.matchAll(/class\s*=\s*["']([^"']*)["']/gi)].some((m) =>
      m[1].split(/\s+/).includes("screen")
    );
    if (!cssOk || !markupOk) {
      violations.push({
        rule: "fixed_frame_missing",
        detail:
          `${platform} 画面は固定幅ラッパー (.screen { width: ${SM_FRAME_WIDTH}; min-height: 844px; } + <body> 直下の <div class="screen">) が必須` +
          ` (figmaselector=.screen がこの要素を切り出す。不在だと capture がブラウザ窓幅に fallback する)` +
          ` — CSS ルール: ${cssOk ? "OK" : "欠落"} / markup 要素: ${markupOk ? "OK" : "欠落"}`,
      });
    }
  }

  return { file: filePath, platform, skipped: false, violations };
}

export function checkFiles(paths) {
  const files = paths.map((p) => checkFile(p));
  const hard = files.reduce((n, f) => n + f.violations.length, 0);
  return { files, hard_violations: hard };
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "--check" || args.length < 2) {
    process.stderr.write("usage: node scripts/lint-screen-frame.mjs --check <file.html> [...]\n");
    process.exit(2);
  }
  const paths = args.slice(1);
  for (const p of paths) {
    if (!existsSync(p)) {
      process.stderr.write(`file not found: ${p}\n`);
      process.exit(2);
    }
  }
  let result;
  try {
    result = checkFiles(paths);
  } catch (e) {
    process.stderr.write(`lint-screen-frame error: ${e.message}\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.hard_violations > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
