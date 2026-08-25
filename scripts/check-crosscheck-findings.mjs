#!/usr/bin/env node
// scripts/check-crosscheck-findings.mjs
//
// 対象限定突合レポート (reverse-verify/crosscheck-report.md) の Findings 表の決定論 checker。
//
// なぜ機械検査するか:
//   本 phase の中核規律は「記述と証拠が食い違ったとき、まず自分の誤読を疑い、別角度で読み直して
//   から確定する」である。記述が誤りなのか読みが誤りなのかは同じ症状 (証拠と記述が合わない) を
//   示すため、再読を省くと正しい記述を壊す方向に倒れる。この規律は散文の指示と Completion Check の
//   チェックボックスだけでは守られたことを後から確かめられない — 再読引用の欠落は静かに通る。
//   そこで「Findings 表の各行に初読と再読の Evidence が両方あり、どちらも引用文法を満たす」ことを
//   ここで機械的に固定する (引用先の実在検証は check-source-citations.mjs の担当。本 script は
//   *列が埋まっているか + 引用の形をしているか* だけを見る = 責務を分ける)。
//
// 検査内容 (Findings 表の各データ行):
//   1. 列数が表ヘッダと一致する (列ずれのまま「空でない」と誤判定しないため)
//   2. 初読 Evidence 列が空でない / 引用文法を含む
//   3. 再読 Evidence 列が空でない / 引用文法を含む  ← 再読プロトコルの機械ゲート
//   4. 再読に「初読に無い行アンカー付き引用」が 1 件以上ある (単一条件 — 下記)
//   5. 「主張一覧」表で `不一致確定` と判定した行数 ≤ Findings 表の行数 (下記)
//   引用文法 = input-sources/…:line | ground-truth/….md|json:line | ground-truth/figma/….png
//   (行アンカー不要の .png は視覚的根拠専用。SoT は skills/reverse/02-source-analysis の
//    Source Evidence Rule で、本 script はその接頭辞と行アンカーの有無だけを見る)
//
// 4 を入れる理由: 「空でない + 引用文法」だけでは、初読の引用をそのまま複製したり、行アンカーを
// 持たない .png を貼るだけで列が埋まってしまう。再読プロトコルが要求するのは **別の位置を読んだ証跡**
// (呼び出し側 / 前後文脈 / 関連ファイル) であり、それは行アンカー付きの異なる引用として現れる。
// 「複製でない」と「行アンカーがある」を別条件に分けると隙間ができるため (実測: 初読の引用 +
// 行アンカー無しの .png で両方を満たしつつ位置は不変)、集合の差として 1 条件で判定する。
// 初読側に行アンカーを要求しないのは非対称だが意図的 — 純粋に視覚的な食い違い (図と記述の差) は
// .png 単独が正当な一次証跡になりうる。再読は「別角度で位置を特定し直す」行為なので位置が必要。
//
// 引用抽出の文字クラスは scripts/check-source-citations.mjs と **一致させる** (backtick を除外)。
// 片方が backtick を経路に飲み込むと、`input-sources/x.py`:1 のような書き方が本 script では
// 通り、実在検証側では抽出されない — 両ゲートが green なのに引用が検証されていない状態を作る。
//
// 5 を入れる理由: 検査は Findings 表に載った行しか見ないので、**表を空にすれば必ず PASS** になる。
// しかも本検査の exit 1 に対する正規の処方は「再読を書けない行は表から外す」であり、下流へ流す
// 確定項目 (台帳 append の根拠) は「主張一覧」の `不一致確定` 判定である。つまり "表から消す" が
// 最小努力の通過経路になりうる。両表の件数を突き合わせて、消したぶんが見えるようにする。
// (降格が正当な場合は主張一覧側の判定も `未確定` に変わるので、件数は自然に一致する。)
// 主張一覧の節・表・`判定` 列が見つからない場合も無言 skip せず疑義にする — 本報告書は本 phase で
// 新設した artifact で別書式の既存物は存在せず、欠落を skip 扱いにすると節の削除や列名の変更で
// 件数照合そのものを外せてしまう (Findings 見出しの欠落を疑義にするのと同じ理屈)。
//
// 表が 0 行 (食い違いなし) は正当な結果なので PASS。表そのものが無い場合は「書式が違う」として
// 疑義扱いにする (見出しの改変で検査が無言 skip されるのを防ぐ)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/check-crosscheck-findings.mjs <report_path> [--json]
// exit:   0 = PASS / 1 = 疑義あり (再読欠落・引用形式違反・列ずれ) / 2 = 入力不能

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * 引用文法 (接頭辞 + 行アンカー)。実在検証は check-source-citations.mjs の担当。
 * 文字クラスは同 script と一致させる (backtick を経路に含めない — 上記ヘッダの理由)。
 */
export const CITATION_RE =
  /(?:input-sources\/[^\s|`]+?:\d+(?:-\d+)?)|(?:ground-truth\/[^\s|`]+?\.(?:md|json):\d+(?:-\d+)?)|(?:ground-truth\/figma\/[^\s|`]+?\.png)/;

/** 行アンカー付きの引用 (再読が「別の位置を読んだ」ことを示す最小条件)。 */
const ANCHORED_CITATION_RE =
  /(?:input-sources\/[^\s|`]+?:\d+(?:-\d+)?)|(?:ground-truth\/[^\s|`]+?\.(?:md|json):\d+(?:-\d+)?)/;

/**
 * セルから引用だけを抽出した集合を返す。判定は必ずこの集合で行う — セル文字列の比較では
 * 「同じ引用 + 注記」(例: `…/search.py:42 (呼び出し側)`) が別物として通ってしまい、位置は
 * 変わっていないのに「別角度」の証跡として認められる (報告書テンプレート自身が注記付きの形を
 * 例示しているため、実際に出やすい形)。
 */
export function citationSet(cell) {
  const re = new RegExp(CITATION_RE.source, "g");
  return new Set([...String(cell).matchAll(re)].map((m) => m[0]));
}

/** セルのうち **行アンカー付き** の引用だけの集合。再読の「別位置」判定はこれで行う。 */
export function anchoredCitationSet(cell) {
  const re = new RegExp(ANCHORED_CITATION_RE.source, "g");
  return new Set([...String(cell).matchAll(re)].map((m) => m[0]));
}

/**
 * 再読が「初読と別の位置を読んだ」ことを 1 つの条件で判定する。
 * 条件: 再読の **行アンカー付き引用** のうち、初読に無いものが 1 件以上あること。
 *
 * 「複製でない」と「行アンカーを持つ」を別々の条件に分けると隙間ができる — 実測された抜け道は
 * 「初読の引用をそのまま置き、行アンカーの無い .png を 1 つ足す」形で、png のせいで部分集合では
 * なくなり、行アンカー条件は初読と同じ `:42` が満たしてしまう。両方を同時に満たしていながら
 * 読んだ位置は 1 ミリも増えていない。集合の差で見れば 1 条件で塞がる。
 */
export function hasNewAnchoredCitation(first, reread) {
  const firstSet = citationSet(first);
  for (const c of anchoredCitationSet(reread)) {
    if (!firstSet.has(c)) return true;
  }
  return false;
}

const FINDINGS_HEADING = /^##\s+食い違い/;
const CLAIMS_HEADING = /^##\s+主張一覧/;
const NEXT_HEADING = /^##\s+/;
const SEPARATOR_ROW = /^\|[\s:|-]+\|$/;
const CONFIRMED_VERDICT = "不一致確定";

/** markdown の表 1 行をセル配列にする (前後の | を落として分割)。 */
export function splitRow(line) {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

/** 見出し正規表現に一致する節の表行 (| 始まり) を返す。節が無ければ null。 */
export function tableLinesOf(lines, headingRe) {
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (NEXT_HEADING.test(lines[i])) { end = i; break; }
  }
  const rows = lines.slice(start + 1, end).filter((l) => l.trim().startsWith("|"));
  return rows.length === 0 ? [] : rows;
}

/**
 * 「主張一覧」表で `不一致確定` と判定された行数を数える。{ count, problem } を返し、
 * 節・表・`判定` 列が見つからない場合は count を null にして problem に理由を入れる。
 * 本報告書は本 phase で新設した artifact であり別書式の既存物は存在しない — 欠落を黙って skip
 * すると、「表を空にする通過経路を塞ぐ」件数照合そのものが節の削除・列名の変更で無効化できて
 * しまうため、Findings 見出しの欠落と同じく疑義として報告する (無言 skip の経路を残さない)。
 */
export function countConfirmedClaims(lines) {
  const rows = tableLinesOf(lines, CLAIMS_HEADING);
  if (rows === null) {
    return { count: null, problem: "『## 主張一覧』見出しが無い — 報告書の書式が想定と異なる (件数照合を無言 skip しない)" };
  }
  if (rows.length === 0) {
    return { count: null, problem: "『## 主張一覧』節に表が無い — 主張 0 件でもヘッダ行は残す (未記入と 0 件を区別するため)" };
  }
  const header = splitRow(rows[0]);
  const verdictIdx = header.findIndex((h) => h.includes("判定"));
  if (verdictIdx === -1) {
    return { count: null, problem: "主張一覧の表ヘッダに『判定』列が無い — 列名の変更で件数照合が skip される書式は疑義扱いにする" };
  }
  const data = rows.slice(1).filter((l) => !SEPARATOR_ROW.test(l.trim()));
  const count = data.filter((l) => {
    const cells = splitRow(l);
    return (cells[verdictIdx] ?? "").includes(CONFIRMED_VERDICT);
  }).length;
  return { count, problem: null };
}

/**
 * report 本文から Findings 表を抜き、各行を検査する。
 * { verdict, rows, issues, table_found } を返す。
 */
export function checkReport(text) {
  const lines = text.split("\n");
  const tableLines = tableLinesOf(lines, FINDINGS_HEADING);
  if (tableLines === null) {
    return {
      verdict: "SUSPECT",
      table_found: false,
      rows: 0,
      issues: [{ row: null, problem: "『## 食い違い』見出しが無い — 報告書の書式が想定と異なる (検査を無言 skip しない)" }],
    };
  }
  if (tableLines.length === 0) {
    return {
      verdict: "SUSPECT",
      table_found: false,
      rows: 0,
      issues: [{ row: null, problem: "『## 食い違い』節に表が無い — 食い違い 0 件でもヘッダ行は残す (未記入と 0 件を区別するため)" }],
    };
  }
  const header = splitRow(tableLines[0]);
  const colCount = header.length;
  const idx = (name) => header.findIndex((h) => h.includes(name));
  const firstIdx = idx("初読");
  const rereadIdx = idx("再読");
  const issues = [];
  if (firstIdx === -1) issues.push({ row: null, problem: "表ヘッダに『初読 Evidence』列が無い" });
  if (rereadIdx === -1) issues.push({ row: null, problem: "表ヘッダに『再読 Evidence』列が無い (再読プロトコルの記録先)" });

  // データ行 = ヘッダと区切り行を除いた残り
  const dataLines = tableLines.slice(1).filter((l) => !SEPARATOR_ROW.test(l.trim()));
  let checked = 0;
  for (const line of dataLines) {
    const cells = splitRow(line);
    const label = cells[0] || "(ID 不明)";
    checked += 1;
    if (cells.length !== colCount) {
      issues.push({ row: label, problem: `列数がヘッダと不一致 (${cells.length} / ${colCount}) — 列ずれのまま検査すると空欄を見逃す` });
      continue;
    }
    if (firstIdx === -1 || rereadIdx === -1) continue; // ヘッダ不備は上で報告済
    const first = cells[firstIdx];
    const reread = cells[rereadIdx];
    if (first === "") issues.push({ row: label, problem: "初読 Evidence が空" });
    else if (!CITATION_RE.test(first)) issues.push({ row: label, problem: `初読 Evidence が引用文法でない (省略形・backtick 込みの経路は実在検証で抽出されない): ${first}` });
    if (reread === "") {
      issues.push({ row: label, problem: "再読 Evidence が空 — 再読プロトコル未通過の行は食い違いとして確定できない" });
    } else if (!CITATION_RE.test(reread)) {
      issues.push({ row: label, problem: `再読 Evidence が引用文法でない (省略形・backtick 込みの経路は実在検証で抽出されない): ${reread}` });
    } else if (first !== "" && !hasNewAnchoredCitation(first, reread)) {
      issues.push({
        row: label,
        problem:
          "再読 Evidence に「初読に無い行アンカー付き引用」が 1 件も無い — 注記の追加・.png の追加・" +
          "初読と同じ行の再掲では別位置を読んだ証跡にならない (呼び出し側 / 前後の行範囲 / 関連ファイルを引用する)",
      });
    }
  }
  // 主張一覧の 不一致確定 件数と突き合わせる (表を空にする通過経路を塞ぐ)。
  // 節・列が見つからない場合も無言 skip せず疑義にする (書式の改変で件数照合を外せないように)。
  const confirmed = countConfirmedClaims(lines);
  if (confirmed.problem !== null) {
    issues.push({ row: null, problem: confirmed.problem });
  } else if (confirmed.count > checked) {
    issues.push({
      row: null,
      problem:
        `主張一覧の「不一致確定」${confirmed.count} 件に対し Findings 表は ${checked} 行しかない — ` +
        "確定項目が表から抜けている (表から外した項目は主張一覧側も 未確定 等へ判定を変える。" +
        "台帳へ append する根拠は主張一覧の判定なので、表だけ削っても下流には流れる)",
    });
  }

  return {
    verdict: issues.length === 0 ? "PASS" : "SUSPECT",
    table_found: true,
    rows: checked,
    confirmed_claims: confirmed.count,
    issues,
  };
}

export function main(argv) {
  const asJson = argv.includes("--json");
  const path = argv.find((a) => !a.startsWith("--"));
  if (!path || !existsSync(path)) {
    process.stderr.write(
      "入力不能: 報告書のパスを指定してください。node scripts/check-crosscheck-findings.mjs artifacts/{app}/reverse-verify/crosscheck-report.md\n",
    );
    return 2;
  }
  const result = checkReport(readFileSync(path, "utf8"));
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`[check-crosscheck-findings] ${result.verdict} — ${result.rows} 行を検査\n`);
    for (const i of result.issues) {
      process.stdout.write(`  - ${i.row ? `${i.row}: ` : ""}${i.problem}\n`);
    }
  }
  return result.verdict === "PASS" ? 0 : 1;
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMainModule()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch {
    process.exitCode = 2; // 想定外エラーは入力不能扱い (exit 1 は疑義 verdict 専用)
  }
}
