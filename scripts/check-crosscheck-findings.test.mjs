// scripts/check-crosscheck-findings.test.mjs
//
// scripts/check-crosscheck-findings.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/check-crosscheck-findings.test.mjs
//
// テスト方針:
//   - 再読 Evidence の欠落が必ず疑義になることを固定する (本 script の存在理由)。
//   - 省略形引用が通らないことを固定する — 省略形は引用実在検証の抽出対象から外れるため、
//     通してしまうと「疑義なし」が「検証していない」を意味してしまう。
//   - 表そのものが無い / 見出しが変わった場合に無言 PASS にならないことを固定する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReport, splitRow, citationSet, anchoredCitationSet, hasNewAnchoredCitation, countConfirmedClaims, main } from "./check-crosscheck-findings.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HEADER = [
  "| ID | 比較軸 | 内容 | Severity | 修正提案先 | 初読 Evidence | 再読 Evidence |",
  "|---|---|---|---|---|---|---|",
];
// claims: 主張一覧に置く 判定 の配列 (既定は 0 件 = ヘッダ行のみの正当な形)
const report = (rows, { heading = "## 食い違い (Findings)", claims = [] } = {}) => {
  const claimsTable = [
    "| ID | 種別 | 主張 (原文) | 記述位置 | 判定 | 根拠 |",
    "|---|---|---|---|---|---|",
    ...claims.map((v, i) => `| C-0${i + 1} | 挙動 | 検索は部分一致 | requirements/05-features.md:120 | ${v} | input-sources/a/b.py:42 |`),
  ];
  return ["# 対象限定突合レポート — 検索", "", "## 主張一覧", "", ...claimsTable, "", heading, "", ...HEADER, ...rows, "", "## Coverage", ""].join("\n");
};

const row = (first, reread, id = "V-01") =>
  `| ${id} | 挙動詳細 | 記述は部分一致だがコードは前方一致 | medium | doc | ${first} | ${reread} |`;

test("初読・再読ともフルパス引用なら PASS", () => {
  const r = checkReport(
    report([
      row("input-sources/be-python/app/search.py:42", "input-sources/be-python/app/search.py:30-60 + input-sources/be-python/app/api.py:88"),
      row("ground-truth/cf-123-spec.md:88", "ground-truth/cf-123-spec.md:80-120", "V-02"),
    ]),
  );
  assert.equal(r.verdict, "PASS");
  assert.equal(r.rows, 2);
  assert.deepEqual(r.issues, []);
});

test("再読 Evidence が空なら疑義 (再読プロトコル未通過の行を確定させない)", () => {
  const r = checkReport(report([row("input-sources/be-python/app/search.py:42", "")]));
  assert.equal(r.verdict, "SUSPECT");
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0].problem, /再読 Evidence が空/);
  assert.equal(r.issues[0].row, "V-01");
});

test("省略形の引用は疑義 (引用実在検証の抽出対象から外れ、検証を素通りするため)", () => {
  const r = checkReport(report([row(".../search.py:42", ".../search.py:30-60 + .../api.py:88")]));
  assert.equal(r.verdict, "SUSPECT");
  assert.equal(r.issues.length, 2, "初読・再読の両方が引っかかる");
  assert.ok(r.issues.every((i) => /引用文法でない/.test(i.problem)));
});

test("行アンカーの無いテキスト引用は疑義 / 初読の視覚根拠 .png は許容", () => {
  const noAnchor = checkReport(
    report([row("ground-truth/cf-123-spec.md", "ground-truth/cf-123-spec.md:80")]),
  );
  assert.match(noAnchor.issues[0].problem, /初読 Evidence が引用文法でない/);
  const png = checkReport(
    report([
      row(
        "ground-truth/figma/AbC123/1-23--home.png",
        "ground-truth/figma/AbC123/1-23--home.design-context.md:12",
      ),
    ]),
  );
  assert.equal(png.verdict, "PASS", "初読の純粋に視覚的な根拠は行アンカーなしで成立する");
});

test("backtick で囲んだ経路は疑義 (実在検証側の抽出対象から外れ、両ゲートが素通りする)", () => {
  const r = checkReport(
    report([
      row("`input-sources/be-python/app/ghost.py`:999", "`input-sources/be-python/app/phantom.py`:777"),
    ]),
  );
  assert.equal(r.verdict, "SUSPECT");
  assert.equal(r.issues.length, 2, "初読・再読の両方が引っかかる");
  assert.ok(r.issues.every((i) => /引用文法でない/.test(i.problem)));
});

test("再読に初読と同じ位置しか無ければ疑義 (注記・.png の追加では別位置の証跡にならない)", () => {
  const same = "input-sources/be-python/app/search.py:42";
  const r = checkReport(report([row(same, same)]));
  assert.equal(r.verdict, "SUSPECT");
  assert.match(r.issues[0].problem, /初読に無い行アンカー付き引用/);
  // 空白・backtick 差だけの複製
  const cosmetic = checkReport(report([row(same, `  ${same}  `)]));
  assert.match(cosmetic.issues[0].problem, /初読に無い行アンカー付き引用/);
  // 注記だけ足した形 (テンプレートが例示する書式ゆえ出やすい) も弾く
  const annotated = checkReport(report([row(same, `${same} (呼び出し側)`)]));
  assert.match(annotated.issues[0].problem, /初読に無い行アンカー付き引用/);
  // 初読を含みつつ別位置を足したものは正当 (前後文脈 + 呼び出し側)
  const extended = checkReport(
    report([row(same, "input-sources/be-python/app/search.py:30-60 + input-sources/be-python/app/api.py:88 (呼び出し側)")]),
  );
  assert.equal(extended.verdict, "PASS");
});

test("citationSet は引用だけを抽出する (注記は含めない)", () => {
  assert.deepEqual(
    [...citationSet("input-sources/a/b.py:42 (呼び出し側) + ground-truth/spec.md:9")].sort(),
    ["ground-truth/spec.md:9", "input-sources/a/b.py:42"],
  );
  assert.equal(citationSet("根拠なし").size, 0);
});

test("再読が行アンカーを持たない (.png 単独) なら疑義", () => {
  const r = checkReport(
    report([
      row("ground-truth/figma/AbC123/1-23--home.design-context.md:12", "ground-truth/figma/AbC123/1-24--detail.png"),
    ]),
  );
  assert.equal(r.verdict, "SUSPECT");
  assert.match(r.issues[0].problem, /初読に無い行アンカー付き引用/);
});

test("初読の引用 + アンカー無しの .png で両条件を満たす抜け道を塞ぐ (実測された迂回)", () => {
  const same = "input-sources/be-python/app/search.py:42";
  const r = checkReport(report([row(same, `${same} + ground-truth/figma/K/1-23--home.png`)]));
  assert.equal(r.verdict, "SUSPECT", "png のせいで部分集合でなくなり、アンカーは初読の :42 が満たす形");
  assert.match(r.issues[0].problem, /初読に無い行アンカー付き引用/);
});

test("列ずれは空欄検査より先に報告する (ずれたまま『空でない』と誤判定しない)", () => {
  const r = checkReport(report(["| V-01 | 挙動詳細 | medium | doc | input-sources/a/b.py:1 |"]));
  assert.equal(r.verdict, "SUSPECT");
  assert.match(r.issues[0].problem, /列数がヘッダと不一致/);
});

test("食い違い 0 件 (ヘッダのみ) は PASS", () => {
  const r = checkReport(report([]));
  assert.equal(r.verdict, "PASS");
  assert.equal(r.rows, 0);
});

test("見出しや表が無い報告書は無言 PASS にしない", () => {
  const noHeading = checkReport(report([row("input-sources/a/b.py:1", "input-sources/a/b.py:1-9")], { heading: "## 差分" }));
  assert.equal(noHeading.verdict, "SUSPECT");
  assert.equal(noHeading.table_found, false);
  assert.match(noHeading.issues[0].problem, /見出しが無い/);

  const noTable = checkReport(["# レポート", "", "## 食い違い (Findings)", "", "なし", "", "## Coverage"].join("\n"));
  assert.equal(noTable.verdict, "SUSPECT");
  assert.match(noTable.issues[0].problem, /表が無い/);
});

test("再読列がヘッダから消えていれば疑義", () => {
  const text = [
    "# レポート", "", "## 食い違い (Findings)", "",
    "| ID | 比較軸 | 内容 | Severity | 修正提案先 | 初読 Evidence |",
    "|---|---|---|---|---|---|",
    "| V-01 | 挙動詳細 | x | medium | doc | input-sources/a/b.py:1 |",
    "", "## Coverage",
  ].join("\n");
  const r = checkReport(text);
  assert.equal(r.verdict, "SUSPECT");
  assert.match(r.issues.map((i) => i.problem).join("\n"), /『再読 Evidence』列が無い/);
});

test("主張一覧の不一致確定より Findings 行が少なければ疑義 (表を空にする通過経路を塞ぐ)", () => {
  // 確定 2 件を主張一覧に残したまま Findings 表を空にする = 従来は PASS だった抜け道
  const emptied = checkReport(report([], { claims: ["不一致確定", "不一致確定"] }));
  assert.equal(emptied.verdict, "SUSPECT");
  assert.equal(emptied.confirmed_claims, 2);
  assert.equal(emptied.rows, 0);
  assert.match(emptied.issues[0].problem, /主張一覧の「不一致確定」2 件に対し Findings 表は 0 行/);

  // 件数が揃っていれば PASS
  const matched = checkReport(
    report([row("input-sources/a/b.py:42", "input-sources/a/c.py:88")], { claims: ["不一致確定", "誤読訂正"] }),
  );
  assert.equal(matched.verdict, "PASS");
  assert.equal(matched.confirmed_claims, 1);

  // 降格して主張一覧側も 未確定 にすれば整合する (正当な処方)
  const demoted = checkReport(report([], { claims: ["未確定", "誤読訂正"] }));
  assert.equal(demoted.verdict, "PASS");
});

test("主張一覧の節・表・判定列の欠落は疑義 (書式の改変で件数照合を無言 skip させない)", () => {
  // 節そのものが無い (Findings 表は正当な形で残っている)
  const noSection = checkReport(
    ["# レポート", "", "## 食い違い (Findings)", "", ...HEADER, row("input-sources/a/b.py:1", "input-sources/a/b.py:1-9"), "", "## Coverage"].join("\n"),
  );
  assert.equal(noSection.verdict, "SUSPECT");
  assert.equal(noSection.confirmed_claims, null);
  assert.match(noSection.issues[0].problem, /『## 主張一覧』見出しが無い/);

  // 節はあるが表が無い (未記入と 0 件を区別する)
  const noTable = checkReport(
    ["# レポート", "", "## 主張一覧", "", "なし", "", "## 食い違い (Findings)", "", ...HEADER, "", "## Coverage"].join("\n"),
  );
  assert.equal(noTable.verdict, "SUSPECT");
  assert.match(noTable.issues[0].problem, /『## 主張一覧』節に表が無い/);

  // 判定列が無い (列名の変更で照合が外れる形)
  const noVerdictCol = countConfirmedClaims(["## 主張一覧", "| ID | 根拠 |", "|---|---|"]);
  assert.equal(noVerdictCol.count, null);
  assert.match(noVerdictCol.problem, /『判定』列が無い/);
  const r = checkReport(
    ["# レポート", "", "## 主張一覧", "", "| ID | 根拠 |", "|---|---|", "", "## 食い違い (Findings)", "", ...HEADER, "", "## Coverage"].join("\n"),
  );
  assert.equal(r.verdict, "SUSPECT");
  assert.match(r.issues[0].problem, /『判定』列が無い/);
});

test("splitRow は前後の | を落としてセルを返す", () => {
  assert.deepEqual(splitRow("| a | b |  c |"), ["a", "b", "c"]);
});

test("anchoredCitationSet は行アンカーの無い .png を含めない", () => {
  const cell = "input-sources/a/b.py:42 + ground-truth/figma/K/1--home.png";
  assert.deepEqual([...citationSet(cell)].sort(), ["ground-truth/figma/K/1--home.png", "input-sources/a/b.py:42"]);
  assert.deepEqual([...anchoredCitationSet(cell)], ["input-sources/a/b.py:42"]);
});

test("hasNewAnchoredCitation: 初読に無い行アンカー付き引用の有無で判定する", () => {
  const first = "input-sources/a/b.py:42";
  assert.equal(hasNewAnchoredCitation(first, "input-sources/a/b.py:42"), false, "同一");
  assert.equal(hasNewAnchoredCitation(first, "input-sources/a/b.py:42 (呼び出し側)"), false, "注記だけ追加");
  assert.equal(hasNewAnchoredCitation(first, "input-sources/a/b.py:42 + ground-truth/figma/K/1--home.png"), false, "アンカー無しの .png 追加");
  assert.equal(hasNewAnchoredCitation(first, "input-sources/a/c.py:88"), true, "別ファイル");
  assert.equal(hasNewAnchoredCitation(first, "input-sources/a/b.py:30-60"), true, "同ファイルの別行範囲");
});

test("main: PASS で exit 0 / 疑義で exit 1 / 入力不能で exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "crosscheck-findings-"));
  try {
    const ok = join(dir, "ok.md");
    writeFileSync(ok, report([row("input-sources/a/b.py:1", "input-sources/a/b.py:1-9")]));
    assert.equal(main([ok, "--json"]), 0);
    const bad = join(dir, "bad.md");
    writeFileSync(bad, report([row("input-sources/a/b.py:1", "")]));
    assert.equal(main([bad]), 1);
    assert.equal(main([join(dir, "missing.md")]), 2);
    assert.equal(main([]), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
