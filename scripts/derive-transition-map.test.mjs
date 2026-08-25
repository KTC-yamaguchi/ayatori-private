#!/usr/bin/env node
// scripts/derive-transition-map.test.mjs
//
// derive-transition-map.mjs の白箱 unit test。fixture は毎回 mkdtemp で組み立てるため、
// **実プロジェクト (artifacts/ 配下) には一切依存しない**。
//
// 実プロジェクトを検証台にしない理由 (check-marker-retention.test.mjs と同じ):
//   KAGEMUSHA-TEST の 03-user-flow.md は「入エッジゼロの菱形」「菱形同士の循環」「双方向
//   エッジ」を含まないため、実データが通ることは変換規則 R1〜R6 の網羅性の証明にならない。
//   異常系・境界形は fixture で明示的に作る。
//
// 実行: npm test (= node --test) / 単体: node --test scripts/derive-transition-map.test.mjs
// 依存: なし (Node 標準のみ)。CLAUDE.md Operating Principle 1 準拠。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseScreenList, parseTransitionMap } from "./derive-screen-nav.mjs";
import { validateConnectivity } from "./validate-connectivity.mjs";
import {
  composeFoldedLabel,
  derive,
  extractMermaidBlocks,
  hasMarker,
  run,
  sanitizeLabel,
  scanStatement,
  sidecarPathFor,
  splitStatements,
} from "./derive-transition-map.mjs";

// --- fixture helpers ---------------------------------------------------------

/** 画面一覧 (`画面名` 列を持つ markdown table)。「ホーム」「動画一覧」のみ画面として扱われる。 */
const SCREEN_LIST = [
  "# 画面一覧",
  "",
  "| # | 画面ID | 画面名 | 目的 |",
  "|---|---|---|---|",
  "| 01 | SCR-001 | ホーム | 起点 |",
  "| 02 | SCR-002 | 動画一覧 | 一覧 |",
  "",
].join("\n");

const FENCE = "```";

/** [{heading, code}] → 03-user-flow.md 相当の Markdown。 */
function flowDoc(sections) {
  return sections
    .map(({ heading, code }) => `## ${heading}\n\n${FENCE}mermaid\nflowchart TD\n${code}\n${FENCE}\n`)
    .join("\n");
}

/** 1 ブロックだけの Markdown を derive() に通し、.mmd 本文と summary を返す。 */
function deriveOne(code, { heading = "S1", screenList = SCREEN_LIST } = {}) {
  return derive({ markdown: flowDoc([{ heading, code }]), screenListText: screenList });
}

/** .mmd 本文からノード宣言行 / エッジ行だけを取り出す (先頭コメント・見出しコメントを除く)。 */
const bodyLines = (mmd) =>
  mmd
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("%%") && l !== "flowchart TD");

const edgeLines = (mmd) => bodyLines(mmd).filter((l) => l.includes("-->"));
const nodeLines = (mmd) => bodyLines(mmd).filter((l) => !l.includes("-->"));
const warningTypes = (summary) => summary.warnings.map((w) => w.type);

/** app ルートを組み立てる (CLI 契約の検証用)。 */
function makeApp({ flow, screenList = SCREEN_LIST, existingOut = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "derive-transition-map-"));
  mkdirSync(join(root, "requirements"), { recursive: true });
  mkdirSync(join(root, "screens"), { recursive: true });
  if (flow !== undefined) writeFileSync(join(root, "requirements", "03-user-flow.md"), flow, "utf8");
  if (screenList !== null) writeFileSync(join(root, "screens", "00-screen-list.md"), screenList, "utf8");
  if (existingOut !== null) writeFileSync(join(root, "screens", "00-transition-map.mmd"), existingOut, "utf8");
  return root;
}

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

// --- R1: 菱形の畳み込み -----------------------------------------------------

test("R1 菱形を入エッジ × 出エッジの直積に畳み、菱形記法を出力に残さない", () => {
  const { mmd, summary } = deriveOne(
    [
      '  A["ホーム"] --> D{"初回利用?"}',
      '  D -->|初回| B["動画一覧"]',
      '  D -->|2 回目以降| C["ログイン"]',
    ].join("\n"),
  );
  assert.equal(summary.folded_diamonds, 1);
  assert.deepEqual(edgeLines(mmd), ["A -->|初回利用?: 初回| B", "A -->|初回利用?: 2 回目以降| C"]);
  assert.ok(!mmd.includes("{"), "菱形記法は下流パーサが解釈しないため残してはならない");
  assert.ok(!nodeLines(mmd).some((l) => l.startsWith("D")), "畳んだ菱形のノード宣言は消える");
});

test("R1 入エッジにラベルがあれば `lin » D.label: lout` で合成する", () => {
  const { mmd } = deriveOne(
    ['  A["ホーム"] -->|再録画| D{"破棄しますか?"}', '  D -->|戻る| B["動画一覧"]'].join("\n"),
  );
  assert.deepEqual(edgeLines(mmd), ["A -->|再録画 » 破棄しますか?: 戻る| B"]);
});

test("R1 菱形連鎖は反復して解消され、合成ラベルが連結される", () => {
  const { mmd, summary } = deriveOne(
    [
      '  A["ホーム"] -->|l1| D1{"分岐1"}',
      "  D1 -->|l2| D2{\"分岐2\"}",
      '  D2 -->|l3| B["動画一覧"]',
    ].join("\n"),
  );
  assert.equal(summary.folded_diamonds, 2);
  assert.deepEqual(edgeLines(mmd), ["A -->|l1 » 分岐1: l2 » 分岐2: l3| B"]);
});

test("R1 2 入 × 2 出は 4 本の直積エッジになる", () => {
  const { mmd, summary } = deriveOne(
    [
      '  A["ホーム"] -->|in1| D{"状態"}',
      '  B["動画一覧"] -->|in2| D',
      '  D -->|out1| X["結果1"]',
      '  D -->|out2| Y["結果2"]',
    ].join("\n"),
  );
  assert.equal(summary.folded_diamonds, 1);
  assert.deepEqual(edgeLines(mmd), [
    "A -->|in1 » 状態: out1| X",
    "A -->|in1 » 状態: out2| Y",
    "B -->|in2 » 状態: out1| X",
    "B -->|in2 » 状態: out2| Y",
  ]);
});

test("R1 入エッジゼロの菱形はスタジアム化して残し warning に記録する (エッジを消滅させない)", () => {
  const { mmd, summary } = deriveOne(['  D{"孤立した分岐"} -->|Yes| A["ホーム"]'].join("\n"));
  assert.equal(summary.folded_diamonds, 0);
  assert.deepEqual(warningTypes(summary), ["diamond_no_in_edges"]);
  assert.ok(mmd.includes('D(["孤立した分岐"])'), "菱形はスタジアムとして宣言される");
  assert.deepEqual(edgeLines(mmd), ["D -->|Yes| A"], "出エッジは消えない");
});

test("R1 出エッジゼロの菱形もスタジアム化して残す (入エッジを消滅させない)", () => {
  const { mmd, summary } = deriveOne(['  A["ホーム"] -->|キャンセル| D{"中断しますか?"}'].join("\n"));
  assert.equal(summary.folded_diamonds, 0);
  assert.deepEqual(warningTypes(summary), ["diamond_no_out_edges"]);
  assert.ok(mmd.includes('D(["中断しますか?"])'));
  assert.deepEqual(edgeLines(mmd), ["A -->|キャンセル| D"]);
});

test("R1 菱形同士の循環は停止し、残りをスタジアム化して warning にする (無限ループ禁止)", () => {
  const { mmd, summary } = deriveOne(
    [
      '  A["ホーム"] -->|入口| D1{"分岐1"}',
      '  D1 -->|往| D2{"分岐2"}',
      "  D2 -->|復| D1",
    ].join("\n"),
  );
  assert.ok(summary.warnings.some((w) => w.type === "diamond_cycle"), "循環は warning に残す");
  assert.ok(!mmd.includes("{"), "循環に載った菱形もスタジアムとして出力される");
  assert.doesNotThrow(() => parseTransitionMap(mmd), "循環込みでも下流パーサを通ること");
});

test("R1 自己ループを持つ菱形は畳まずスタジアム化する", () => {
  const { mmd, summary } = deriveOne(
    ['  A["ホーム"] -->|in| D{"再試行?"}', "  D -->|もう一度| D", '  D -->|完了| B["動画一覧"]'].join("\n"),
  );
  assert.equal(summary.folded_diamonds, 0);
  assert.deepEqual(warningTypes(summary), ["diamond_cycle"]);
  assert.deepEqual(edgeLines(mmd), ["A -->|in| D", "D -->|もう一度| D", "D -->|完了| B"]);
});

test("R1 畳み込みが画面に作った自己ループは drop し folded_self_loop に記録する", () => {
  // 「削除 → 確認 → いいえ → 元の画面」の確認ダイアログ。畳むと HOME --> HOME になる
  const { mmd, summary } = deriveOne(
    [
      '  A["ホーム"] -->|削除| D{"確認"}',
      "  D -->|いいえ| A",
      '  D -->|はい| B["動画一覧"]',
    ].join("\n"),
  );
  assert.deepEqual(edgeLines(mmd), ["A -->|削除 » 確認: はい| B"], "自己ループ化したエッジは出力に残さない");
  assert.deepEqual(
    summary.warnings.filter((w) => w.type === "folded_self_loop"),
    [{ type: "folded_self_loop", id: "D", label: "確認", screen: "A", dropped_label: "削除 » 確認: いいえ" }],
    "drop したことは黙殺せず warning に残す",
  );
});

test("R1 双方向エッジが菱形に接する場合の自己ループも drop する", () => {
  const { mmd, summary } = deriveOne(
    ['  A["ホーム"] <-->|"開く / 閉じる"| D{"確認"}', '  A -->|一覧| B["動画一覧"]'].join("\n"),
  );
  assert.deepEqual(edgeLines(mmd), ["A -->|一覧| B"], "双方向を展開して畳むと A --> A になるので残らない");
  assert.equal(summary.warnings.filter((w) => w.type === "folded_self_loop").length, 1);
});

test("R1 自己ループを drop すると L5 が出口の無い画面を dead_end として検出できる", () => {
  // 本 drop の目的は「L5 の沈黙を防ぐ」ことなので、下流検査まで通して確かめる
  const { mmd } = deriveOne(
    ['  A["ホーム"] -->|詳細| B["動画一覧"]', '  B -->|削除| D{"確認"}', "  D -->|キャンセル| B"].join("\n"),
  );
  const parsed = parseTransitionMap(mmd);
  const { rows } = parseScreenList(SCREEN_LIST);
  const defects = validateConnectivity(parsed, rows);
  assert.deepEqual(
    defects.map((d) => [d.screen, d.defect_kind]),
    [
      ["SCR-001", "unreachable"], // fixture に entry ノードが無いための既知 defect (本題ではない)
      ["SCR-002", "dead_end"], // 自己ループを残すと「出口あり」と数えられて沈黙する
    ],
  );
});

test("R1 菱形に落ちる自己ループは残す (循環判定の手掛かりを消さない)", () => {
  const { summary } = deriveOne(
    ['  A["ホーム"] -->|入口| D1{"分岐1"}', '  D1 -->|往| D2{"分岐2"}', "  D2 -->|復| D1"].join("\n"),
  );
  assert.ok(
    summary.warnings.some((w) => w.type === "diamond_cycle"),
    "菱形同士の循環は diamond_cycle のまま (folded_self_loop に化けない)",
  );
  assert.equal(summary.warnings.filter((w) => w.type === "folded_self_loop").length, 0);
});

test("R1 無ラベル中間エッジの菱形連鎖は宣言順に畳まれ `lin » D » B: lout2` 形になる", () => {
  // 合成ラベルは結合的ではない (D 先 = `l1 » 分岐1 » 分岐2: l3` / D2 先 = `l1 » 分岐1: 分岐2: l3`)。
  // 畳み順は nodes の宣言順で決定論なので、現行の実出力 (宣言順 = D1 先) を固定する。
  const { mmd, summary } = deriveOne(
    [
      '  A["ホーム"] -->|l1| D1{"分岐1"}',
      '  D1 --> D2{"分岐2"}',
      '  D2 -->|l3| B["動画一覧"]',
    ].join("\n"),
  );
  assert.equal(summary.folded_diamonds, 2);
  assert.deepEqual(edgeLines(mmd), ["A -->|l1 » 分岐1 » 分岐2: l3| B"]);
});

// --- 未対応ノード形状の取りこぼし防止 (黙殺しない) ---------------------------

test("丸角 / 円 / 六角 / サブルーチンの 4 形状を parse し、unparsed_line で黙殺しない", () => {
  const { mmd, summary } = deriveOne(
    [
      '  RND("丸角") --> CIR(("円"))',
      '  CIR --> HEX{{"六角"}}',
      '  HEX --> SUB[["サブルーチン"]]',
      '  SUB --> A["ホーム"]',
    ].join("\n"),
  );
  assert.deepEqual(
    summary.warnings.filter((w) => w.type === "unparsed_line"),
    [],
    "4 形状のいずれも statement 全体を落とさない",
  );
  assert.equal(summary.nodes, 5);
  assert.equal(summary.edges, 4);
  // 4 形状は非 diamond (R1 の畳み込み対象にならない) + 画面一覧に無いので R3 でスタジアム化される
  assert.equal(summary.folded_diamonds, 0);
  for (const label of ["丸角", "円", "六角", "サブルーチン"]) {
    assert.ok(mmd.includes(`(["${label}"])`), `${label} は非 diamond としてスタジアム出力される`);
  }
  assert.ok(mmd.includes('A["ホーム"]'), "画面一覧に一致する矩形は矩形のまま");
  assert.doesNotThrow(() => parseTransitionMap(mmd), "出力は下流の strict parse を通ること");
});

test("素の 4 形状 (引用符なし) も parse する", () => {
  const { mmd, summary } = deriveOne(
    ['  RND(丸角) --> CIR((円))', '  CIR --> HEX{{六角}}', '  HEX --> SUB[[サブルーチン]]', '  SUB --> A["ホーム"]'].join(
      "\n",
    ),
  );
  assert.deepEqual(summary.warnings.filter((w) => w.type === "unparsed_line"), []);
  assert.equal(summary.edges, 4);
  for (const label of ["丸角", "円", "六角", "サブルーチン"]) {
    assert.ok(mmd.includes(`(["${label}"])`), `${label} のラベルが壊れず取り出せている`);
  }
});

test("形状の判定順序: 長い open を先に見るのでラベルが壊れない (scanStatement 単体)", () => {
  const shapeOf = (stmt) => scanStatement(stmt).map((t) => `${t.id}:${t.shape}:${t.label}`);
  assert.deepEqual(shapeOf('X(["スタジアム"])'), ["X:stadium:スタジアム"]);
  assert.deepEqual(shapeOf('X(("円"))'), ["X:rect:円"]);
  assert.deepEqual(shapeOf('X("丸角")'), ["X:rect:丸角"]);
  assert.deepEqual(shapeOf('X{{"六角"}}'), ["X:rect:六角"]);
  assert.deepEqual(shapeOf('X{"菱形"}'), ["X:diamond:菱形"]);
  assert.deepEqual(shapeOf('X[["サブルーチン"]]'), ["X:rect:サブルーチン"]);
  assert.deepEqual(shapeOf('X["矩形"]'), ["X:rect:矩形"]);
});

test("エッジを 1 本も抽出できない入力は空の .mmd を書かず exit 2 にする", () => {
  // 未対応記法で statement が全滅したケース (`==>` は arrow として受け付けない)
  const flow = flowDoc([{ heading: "S1", code: '  A["ホーム"] ==> B["動画一覧"]\n  B ==> A' }]);
  assert.throws(
    () => derive({ markdown: flow, screenListText: SCREEN_LIST }),
    (e) => /エッジを 1 本も抽出できなかった/.test(e.message) && /unparsed_line 2 件/.test(e.message),
    "理由に unparsed_line 件数を含める",
  );
  const root = makeApp({ flow });
  try {
    const r = run([root]);
    assert.equal(r.exitCode, 2);
    assert.match(r.error, /エッジを 1 本も抽出できなかった/);
    assert.ok(!existsSync(join(root, "screens", "00-transition-map.mmd")), "空の遷移図は書き出さない");
  } finally {
    cleanup(root);
  }
});

test("ノード宣言だけでエッジが無い入力も exit 2 (空の遷移図を完成扱いにしない)", () => {
  assert.throws(
    () => deriveOne('  A["ホーム"]\n  B["動画一覧"]'),
    /エッジを 1 本も抽出できなかった/,
  );
});

// --- 行コメント / statement 分割の順序 --------------------------------------

test("`%%` コメントは `;` 分割より先に落とす (コメント後半が幽霊ノードにならない)", () => {
  const { mmd, summary } = deriveOne(
    ["  %% note; TODO", '  A["ホーム"] --> B["動画一覧"]'].join("\n"),
  );
  assert.deepEqual(nodeLines(mmd), ['A["ホーム"]', 'B["動画一覧"]'], "TODO ノードを作らない");
  assert.equal(summary.stadium_converted, 0, "幽霊ノードのスタジアム化も起きない");
  assert.deepEqual(warningTypes(summary), []);
});

test("ラベル内の `;` で statement を分断しない (エッジを丸ごと失わない)", () => {
  const { mmd, summary } = deriveOne('  A["ホーム"] -->|"保存; 閉じる"| B["動画一覧"]');
  assert.deepEqual(edgeLines(mmd), ["A -->|保存; 閉じる| B"]);
  assert.equal(summary.warnings.filter((w) => w.type === "unparsed_line").length, 0);
});

test("splitStatements: 引用符 / エッジラベルの内側では区切らずコメントも見ない", () => {
  assert.deepEqual(splitStatements("A --> B; C --> D"), ["A --> B", "C --> D"]);
  assert.deepEqual(splitStatements("  %%{init: {...}}%%  "), [], "init ディレクティブは丸ごと落ちる");
  assert.deepEqual(splitStatements('A["100% 完了"] --> B'), ['A["100% 完了"] --> B'], "単独の % は本文");
  assert.deepEqual(splitStatements('A["進捗 100%% 済"]'), ['A["進捗 100%% 済"]'], "引用符内の %% はコメントでない");
  assert.deepEqual(splitStatements('A -->|"a; b"| B; C --> D'), ['A -->|"a; b"| B', "C --> D"]);
  assert.deepEqual(splitStatements("style A fill:#fff; %% 見た目"), ["style A fill:#fff"]);
});

// --- R2: 点線の正規化 -------------------------------------------------------

test("R2 点線は実線化し、マーカーの無いラベルに ※ 推測 (inferred) を付加する", () => {
  const { mmd, summary } = deriveOne(['  A["ホーム"] -.->|戻る| B["動画一覧"]'].join("\n"));
  assert.equal(summary.dotted_normalized, 1);
  assert.deepEqual(edgeLines(mmd), ["A -->|戻る ※ 推測 (inferred)| B"]);
  assert.ok(!mmd.includes("-.->"), "点線は下流パーサが解釈しないため残してはならない");
});

test("R2 ラベル無しの点線はマーカーだけをラベルにする", () => {
  const { mmd } = deriveOne(['  A["ホーム"] -.-> B["動画一覧"]'].join("\n"));
  assert.deepEqual(edgeLines(mmd), ["A -->|※ 推測 (inferred)| B"]);
});

test("R2 既にマーカーを持つ点線ラベルには二重付加しない", () => {
  const { mmd } = deriveOne(
    [
      '  A["ホーム"] -.->|仮パスワードでログイン後 ※ 推測 (inferred)| B["動画一覧"]',
      '  A -.->|対象 ※不明| C["別画面"]',
    ].join("\n"),
  );
  const lines = edgeLines(mmd);
  assert.deepEqual(lines, [
    "A -->|仮パスワードでログイン後 ※ 推測 (inferred)| B",
    "A -->|対象 ※不明| C",
  ]);
  for (const line of lines) {
    assert.equal((line.match(/※/g) ?? []).length, 1, `マーカーが二重付加されている: ${line}`);
  }
});

test("R2 実線エッジにはマーカーを付加しない (根拠ありの遷移にマーカーを発明しない)", () => {
  const { mmd, summary } = deriveOne(['  A["ホーム"] -->|次へ| B["動画一覧"]', "  A --> B"].join("\n"));
  assert.equal(summary.dotted_normalized, 0);
  assert.deepEqual(edgeLines(mmd), ["A -->|次へ| B", "A --> B"]);
  assert.ok(!mmd.includes("※"));
});

test("R2 点線が菱形経由で畳まれた場合は合成後ラベルにマーカーを付加する", () => {
  const { mmd } = deriveOne(
    ['  A["ホーム"] -.->|in| D{"分岐"}', '  D -->|out| B["動画一覧"]'].join("\n"),
  );
  assert.deepEqual(edgeLines(mmd), ["A -->|in » 分岐: out ※ 推測 (inferred)| B"]);
});

// --- R3: screen-list 突合による形状正規化 -----------------------------------

test("R3 画面一覧に一致する矩形は矩形のまま、一致しないものはスタジアムへ変換する", () => {
  const { mmd, summary } = deriveOne(
    ['  A["ホーム"] -->|次へ| M["削除してよろしいですか?"]', '  M -->|削除する| B["動画一覧"]'].join("\n"),
  );
  assert.equal(summary.screen_matched, 2);
  assert.equal(summary.stadium_converted, 1);
  assert.ok(mmd.includes('A["ホーム"]'));
  assert.ok(mmd.includes('B["動画一覧"]'));
  assert.ok(mmd.includes('M(["削除してよろしいですか?"])'), "画面一覧に無いモーダルはスタジアム");
});

test("R3 画面一覧の 遷移図ノードID 列があればラベル不一致でも矩形のまま残る", () => {
  // 画面名はフロー図のノードラベルと語彙が離れており (包含関係も無い) ラベルでは突合できないが、
  // ID 宣言があれば突合できる (リバース産で実測された「ラベル語彙の不一致」の再現)
  const listWithNodeId = [
    "# 画面一覧",
    "",
    "| # | 画面ID | 画面名 | 遷移図ノードID |",
    "|---|---|---|---|",
    "| 01 | SCR-001 | ダッシュボード | HOME |",
    "| 02 | SCR-002 | アバター映像の作成 | GUIDE |",
    "",
  ].join("\n");
  const { mmd, summary } = deriveOne('  HOME["ホーム"] -->|開始| GUIDE["撮影ガイド"]', { screenList: listWithNodeId });
  assert.equal(summary.screen_matched, 2);
  assert.equal(summary.stadium_converted, 0, "ID で突合できた画面をスタジアムに落とさない");
  assert.ok(mmd.includes('HOME["ホーム"]'));
  assert.ok(mmd.includes('GUIDE["撮影ガイド"]'));

  // ID 列が無い同じ画面一覧では従来どおりラベル不一致 → スタジアム化 (対比)
  const listWithoutNodeId = listWithNodeId
    .replace(" 遷移図ノードID |", "")
    .replace("|---|---|---|---|", "|---|---|---|")
    .replace(" HOME |", "")
    .replace(" GUIDE |", "");
  const noId = deriveOne('  HOME["ホーム"] -->|開始| GUIDE["撮影ガイド"]', { screenList: listWithoutNodeId });
  assert.equal(noId.summary.screen_matched, 0);
  assert.equal(noId.summary.stadium_converted, 2);
});

test("R3 ID 宣言で行に束縛された非矩形ノードは矩形へ昇格する (画面が図から消えない)", () => {
  // ソース側で既にスタジアムのノードを screen-list が「画面」と宣言しているケース
  const listWithNodeId = [
    "# 画面一覧",
    "",
    "| # | 画面ID | 画面名 | 遷移図ノードID |",
    "|---|---|---|---|",
    "| 01 | SCR-001 | ホーム | HOME |",
    "| 02 | SCR-002 | 予約一覧 | RSV |",
    "",
  ].join("\n");
  const { mmd, summary } = deriveOne('  HOME["ホーム"] -->|一覧| RSV(["予約一覧"])', { screenList: listWithNodeId });
  assert.ok(mmd.includes('RSV["予約一覧"]'), "スタジアムのまま残すと nav / L5 / 凡例から画面が消える");
  assert.equal(summary.promoted_to_screen, 1);
  assert.equal(summary.screen_matched, 2, "昇格分も突合済みとして数える");
  assert.deepEqual(
    summary.warnings.filter((w) => w.type === "node_id_promoted_to_screen"),
    [{ type: "node_id_promoted_to_screen", id: "RSV", label: "予約一覧", ref: "SCR-002" }],
    "glyph を書き換えたことは黙殺しない",
  );
});

test("R3 遷移図ノードID の重複は summary.warnings に duplicate_node_id として現れる", () => {
  const listDup = [
    "# 画面一覧",
    "",
    "| # | 画面ID | 画面名 | 遷移図ノードID |",
    "|---|---|---|---|",
    "| 01 | SCR-001 | ホーム | HOME |",
    "| 02 | SCR-002 | 動画一覧 | HOME |",
    "",
  ].join("\n");
  const { summary } = deriveOne('  HOME["ホーム"] -->|次へ| B["動画一覧"]', { screenList: listDup });
  assert.deepEqual(
    summary.warnings.filter((w) => w.type === "duplicate_node_id"),
    [{ type: "duplicate_node_id", node_id: "HOME", kept: "SCR-001", ignored: "SCR-002" }],
  );
});

// --- R4: ブロック合成 / 重複排除 --------------------------------------------

test("R4 全ブロックを 1 つの flowchart TD に統合し、見出しを %% from: で区切る", () => {
  const { mmd } = derive({
    markdown: flowDoc([
      { heading: "3.1 全体フロー", code: '  A["ホーム"] -->|次へ| B["動画一覧"]' },
      { heading: "3.2 前提ゲート", code: '  B -->|作成| C["新規作成"]' },
    ]),
    screenListText: SCREEN_LIST,
  });
  assert.equal((mmd.match(/^flowchart TD$/gm) ?? []).length, 1);
  assert.ok(mmd.includes("%% from: 3.1 全体フロー"));
  assert.ok(mmd.includes("%% from: 3.2 前提ゲート"));
  assert.equal((mmd.match(/^ {2}B/gm) ?? []).length, 2, "B の宣言は初出ブロックで 1 回 + 2 番目のブロックはエッジのみ");
  assert.equal(mmd.indexOf("%% from: 3.1"), mmd.search(/%% from: 3\.1/), "出力順序は入力の出現順");
  assert.ok(mmd.indexOf("%% from: 3.1") < mmd.indexOf("%% from: 3.2"));
});

test("R4 ノード宣言は初出位置で 1 回だけ出力する", () => {
  const { mmd } = derive({
    markdown: flowDoc([
      { heading: "S1", code: '  A["ホーム"] --> B["動画一覧"]' },
      { heading: "S2", code: '  A["ホーム"] --> C["別画面"]' },
    ]),
    screenListText: SCREEN_LIST,
  });
  assert.equal((mmd.match(/A\["ホーム"\]/g) ?? []).length, 1);
});

test("R4 同一 (from, to, label) のエッジは重複排除する", () => {
  const { mmd, summary } = derive({
    markdown: flowDoc([
      { heading: "S1", code: '  A["ホーム"] -->|次へ| B["動画一覧"]' },
      { heading: "S2", code: "  A -->|次へ| B\n  A -->|戻る| B" },
    ]),
    screenListText: SCREEN_LIST,
  });
  assert.deepEqual(edgeLines(mmd), ["A -->|次へ| B", "A -->|戻る| B"]);
  assert.equal(summary.edges, 2);
});

// --- R5: 同名マージ ---------------------------------------------------------

test("R5 正規化ラベルが完全一致する矩形は初出 ID へマージし、エッジを書き換える", () => {
  const { mmd, summary } = derive({
    markdown: flowDoc([
      { heading: "S1", code: '  VDLIST["動画一覧"] -->|詳細| DETAIL["動画詳細"]' },
      { heading: "S2", code: '  LIST["動画一覧"] -->|状態| PROG["生成中"]' },
    ]),
    screenListText: SCREEN_LIST,
  });
  assert.equal(summary.merged_nodes, 1);
  assert.ok(mmd.includes("VDLIST -->|状態| PROG"), "エッジは初出 ID へ書き換わる");
  // `VDLIST[` に部分一致しないよう ID 境界つきで検査する
  assert.ok(!/(^|[^\w])LIST\[/.test(mmd), "マージされた ID の宣言は消える");
  assert.ok(!/(^|\n)\s*LIST /.test(mmd), "マージされた ID はエッジ端点にも残らない");
  assert.deepEqual(
    summary.warnings.filter((w) => w.type === "merged_same_label").map((w) => [w.id, w.merged_into]),
    [["LIST", "VDLIST"]],
  );
});

test("R5 ラベルが一致しない矩形は fuzzy マージしない (曖昧なものは L5 の人間レビューへ委ねる)", () => {
  const { summary } = deriveOne(
    ['  A["動画一覧"] --> B["動画一覧 または プレゼン一覧"]'].join("\n"),
  );
  assert.equal(summary.merged_nodes, 0);
});

test("R5 同名ノード間のエッジはマージで自己ループ化するので drop し warning に記録する", () => {
  // `A --> X` を添えているのは、エッジ 0 本の入力が exit 2 契約 (空の遷移図を書かない) に
  // なるため — 検査対象は「同名ノード間のエッジが 1 本も残らないこと」。
  const { mmd, summary } = deriveOne(
    ['  A["ホーム"] --> X["動画一覧"]', '  X -->|再掲| Y["動画一覧"]'].join("\n"),
  );
  assert.equal(summary.merged_nodes, 1);
  assert.deepEqual(edgeLines(mmd), ["A --> X"], "自己ループ化したエッジは出力に残らない");
  assert.deepEqual(
    summary.warnings.filter((w) => w.type === "merged_self_loop").map((w) => [w.from, w.to, w.merged_into]),
    [["X", "Y"]].map(([f, t]) => [f, t, "X"]),
  );
  // drop により X は in 1 / out 0 になり、L5 の未配線検出 (outbound ゼロ) が拾える
  assert.ok(!/X -->\|?.*\|? X/.test(mmd));
});

test("R5 元ソースで最初から自己ループだったエッジはマージ時にも保持する", () => {
  const { mmd, summary } = deriveOne(
    ['  A["ホーム"] --> X["動画一覧"]', "  X -->|もう一度| X", '  Y["動画一覧"] -->|再掲| X'].join("\n"),
  );
  assert.equal(summary.merged_nodes, 1, "Y は X へマージされる");
  assert.deepEqual(edgeLines(mmd), ["A --> X", "X -->|もう一度| X"], "作者が書いた自己遷移は残す");
  assert.deepEqual(
    summary.warnings.filter((w) => w.type === "merged_self_loop").map((w) => [w.from, w.to]),
    [["Y", "X"]],
    "drop 対象はマージが作った偽の自己ループのみ",
  );
});

// --- R6: ID 保持 / label_conflict -------------------------------------------

test("R6 同一 ID が異なるラベルを持つ場合は初出ラベル優先 + label_conflict を記録する", () => {
  const { mmd, summary } = derive({
    markdown: flowDoc([
      { heading: "S1", code: '  AGUIDE["録音ガイド これから1分の音声を録音します"] --> A["ホーム"]' },
      { heading: "S2", code: '  M1["音声を設定"] -->|音声を設定| AGUIDE["録音フロー"]' },
    ]),
    screenListText: SCREEN_LIST,
  });
  assert.ok(mmd.includes('AGUIDE(["録音ガイド これから1分の音声を録音します"])'), "初出ラベルが残る");
  assert.ok(!mmd.includes("録音フロー"), "後出のラベルは採用しない");
  const conflicts = summary.warnings.filter((w) => w.type === "label_conflict");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, "AGUIDE");
  assert.equal(conflicts[0].kept.label, "録音ガイド これから1分の音声を録音します");
  assert.equal(conflicts[0].ignored.label, "録音フロー");
});

test("R6 ID はリネームせず転写する", () => {
  const { mmd } = deriveOne('  SPLASH["スプラッシュ"] --> ONB["オンボーディング"]');
  assert.ok(mmd.includes("SPLASH"));
  assert.ok(mmd.includes("ONB"));
});

// --- マーカー逐語保持 -------------------------------------------------------

test("マーカーは空白付き・無空白・全角空白のいずれも逐語保持される", () => {
  const { mmd } = deriveOne(
    [
      '  A["ホーム ※ 推測 (inferred)"] -->|判定 ※推測| B["動画一覧"]',
      '  B -->|区分 ※　不明| C["表示 ※ 不明 (unknown)"]',
    ].join("\n"),
  );
  assert.ok(mmd.includes("ホーム ※ 推測 (inferred)"));
  assert.ok(mmd.includes("判定 ※推測"));
  assert.ok(mmd.includes("区分 ※　不明"), "全角空白のマーカーも改変しない");
  assert.ok(mmd.includes("表示 ※ 不明 (unknown)"));
});

test("連続空白の正規化はマーカー内部に及ばない", () => {
  assert.equal(sanitizeLabel("a  b ※　推測 (inferred)  c"), "a b ※　推測 (inferred) c");
  assert.equal(sanitizeLabel("x   y"), "x y");
});

test("<br/> は半角スペースへ、ラベル内の | は / へ正規化する", () => {
  const { mmd } = deriveOne(
    ['  A["ホーム<br/>タブ 1"] -->|次へ<br/>進む| B["動画一覧"]'].join("\n"),
  );
  // 「ホーム タブ 1」は matchScreens Pass 2 (包含) で画面「ホーム」に突合するため矩形のまま
  assert.ok(mmd.includes('A["ホーム タブ 1"]'));
  assert.ok(mmd.includes("A -->|次へ 進む| B"));
  assert.equal(sanitizeLabel("行き|戻り"), "行き/戻り");
});

test("生の山括弧は全角へ置換する (派生 HTML で DOM を抜け出す字を残さない)", () => {
  // `.mmd` は 00-transition-map.html に生連結され human gate でブラウザに開かれる
  assert.equal(sanitizeLabel("<b>強調</b>"), "＜b＞強調＜/b＞");
  assert.equal(sanitizeLabel('完了</div><script>alert(1)</script>'), "完了＜/div＞＜script＞alert(1)＜/script＞");
  assert.equal(sanitizeLabel("保存 & 完了"), "保存 & 完了", "& は text context では構造を変えないので触らない");
  assert.equal(sanitizeLabel("ホーム<br/>タブ"), "ホーム タブ", "<br/> は山括弧置換より前に空白化する");
  const { mmd } = deriveOne('  A["ホーム"] -->|"</div><img src=x>"| B["動画一覧"]');
  assert.ok(!mmd.includes("<"), "生成 .mmd に `<` を残さない (本 fixture は双方向記法 `<-->` を含まない)");
  assert.deepEqual(edgeLines(mmd), ["A -->|＜/div＞＜img src=x＞| B"]);
});

test("山括弧の全角化はコメント行 (ブロック見出し / 由来のソースパス) にも適用する", () => {
  // `%%` は mermaid のコメント記法であって HTML のエスケープではないので、見出しを素通しにすると
  // ラベルだけ塞いでも `{{MERMAID_BLOCKS}}` 経由の DOM 抜け出し経路が残る
  const { mmd } = derive({
    markdown: flowDoc([{ heading: '</div><script>alert(1)</script>', code: '  A["ホーム"] --> B["動画一覧"]' }]),
    screenListText: SCREEN_LIST,
    sourceLabel: "requirements/<img src=x>.md",
  });
  assert.ok(!mmd.includes("<"), "コメント行を含む .mmd 全体に `<` を残さない");
  assert.ok(mmd.includes("%% from: ＜/div＞＜script＞alert(1)＜/script＞"), "見出しコメントも全角化する");
  assert.ok(mmd.includes("from requirements/＜img src=x＞.md"), "由来コメントのソースパスも全角化する");
});

test("hasMarker は 4 表記すべてを検出し、マーカーでない ※ は検出しない", () => {
  assert.ok(hasMarker("※ 推測 (inferred)"));
  assert.ok(hasMarker("※推測"));
  assert.ok(hasMarker("※ 不明 (unknown)"));
  assert.ok(hasMarker("※不明"));
  assert.ok(!hasMarker("※ 未捕捉"));
  assert.ok(!hasMarker(undefined));
});

// --- 純関数の境界 -----------------------------------------------------------

test("composeFoldedLabel は lin / lout 欠落を対称に扱い、どちらのラベルも捨てない", () => {
  assert.equal(composeFoldedLabel("in", "D", "out"), "in » D: out");
  assert.equal(composeFoldedLabel(undefined, "D", "out"), "D: out");
  assert.equal(composeFoldedLabel("in", "D", undefined), "in » D");
  assert.equal(composeFoldedLabel(undefined, "D", undefined), "D");
});

test("R1 出エッジが無ラベルでも入エッジのラベルを保持する (却下 » 却下後の分岐)", () => {
  const { mmd } = deriveOne(
    [
      '  DETAIL["ホーム"] -->|却下| REJ{"却下後の分岐"}',
      '  REJ --> REGEN["再生成しますか?"]',
      '  REJ --> DELIN["入力情報を削除しますか?"]',
    ].join("\n"),
  );
  assert.deepEqual(edgeLines(mmd), [
    "DETAIL -->|却下 » 却下後の分岐| REGEN",
    "DETAIL -->|却下 » 却下後の分岐| DELIN",
  ]);
});

test("extractMermaidBlocks は直前の見出しを拾い、mermaid 以外の fence を無視する", () => {
  const md = [
    "# H1",
    "",
    "```js",
    "not mermaid",
    "```",
    "",
    "## 3.1 見出し",
    "",
    "```mermaid",
    "flowchart TD",
    "  A --> B",
    "```",
  ].join("\n");
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].heading, "3.1 見出し");
  assert.match(blocks[0].code, /A --> B/);
});

test("scanStatement はインライン宣言つきのチェーンを分解し、解釈できない形で null を返す", () => {
  const tokens = scanStatement('A["x"] -->|l| B{"y"} --> C');
  assert.deepEqual(
    tokens.map((t) => (t.kind === "node" ? `${t.id}:${t.shape ?? "-"}` : `${t.op}:${t.label ?? "-"}`)),
    ["A:rect", "-->:l", "B:diamond", "-->:-", "C:-"],
  );
  assert.equal(scanStatement("A ==> B"), null);
  assert.equal(scanStatement("1A --> B"), null);
});

test("解釈できなかった行は unparsed_line として warning に残す (黙って落とさない)", () => {
  const { summary } = deriveOne(['  A["ホーム"] ==> B["動画一覧"]', '  A --> B'].join("\n"));
  const unparsed = summary.warnings.filter((w) => w.type === "unparsed_line");
  assert.equal(unparsed.length, 1);
  assert.match(unparsed[0].text, /==>/);
});

test("宣言のないノードは Mermaid 既定の矩形として ID をラベルに補い、宣言を出力する", () => {
  const { mmd } = deriveOne(['  A["ホーム"] --> LATER', '  LATER["後で宣言"] --> B["動画一覧"]'].join("\n"));
  assert.ok(mmd.includes('LATER(["後で宣言"])'), "後続の明示宣言のラベルを採用する (初出は bare 参照)");
  const { mmd: mmd2 } = deriveOne('  A["ホーム"] --> BARE');
  assert.ok(mmd2.includes('BARE(["BARE"])'));
});

// --- 出力が下流パーサを通ること (roundtrip) ---------------------------------

test("出力は parseTransitionMap (derive-screen-nav.mjs) の strict parse を通る", () => {
  const { mmd, summary } = derive({
    markdown: flowDoc([
      {
        heading: "3.1 全体フロー",
        code: [
          '  SPLASH["スプラッシュ<br/>KAGEMUSHA"] --> OB{"初回利用?<br/>※ 推測 (inferred)"}',
          '  OB -->|初回| ONB["オンボーディング"]',
          '  OB -->|2 回目以降| LOGIN["ホーム"]',
          '  LOGIN -.->|仮パスワード| PWSET["新しいパスワード設定"]',
          '  LOGIN <--> ACC["アカウント"]',
        ].join("\n"),
      },
      {
        heading: "3.2 一覧",
        code: [
          '  VDLIST["動画一覧"] --> STATE{"動画の状態"}',
          '  STATE -->|生成中| PROG["生成中"]',
          '  STATE -->|失敗| FAIL["失敗"]',
          '  LIST["動画一覧"] -->|再掲| PROG',
        ].join("\n"),
      },
    ]),
    screenListText: SCREEN_LIST,
  });
  const parsed = parseTransitionMap(mmd);
  assert.equal(parsed.nodes.size, summary.nodes, "implicit ノードが増えない = 全ノードを宣言している");
  assert.equal(parsed.edges.length, summary.edges);
  for (const node of parsed.nodes.values()) {
    assert.notEqual(node.shape, "implicit");
    assert.ok(["rect", "stadium"].includes(node.shape));
  }
  assert.ok(mmd.includes("※ 推測 (inferred)"), "マーカーは下流へ伝播する");
});

// --- CLI 契約 ---------------------------------------------------------------

const CLI_FLOW = flowDoc([
  { heading: "3.1 全体フロー", code: '  A["ホーム"] -.->|次へ| D{"分岐"}\n  D -->|Yes| B["動画一覧"]' },
]);

test("CLI は既定パスを使い、summary JSON と .mmd を出力する", () => {
  const root = makeApp({ flow: CLI_FLOW });
  try {
    const { exitCode, summary, out } = run([root]);
    assert.equal(exitCode, 0);
    assert.equal(summary.verdict, "OK");
    assert.equal(out, join(root, "screens", "00-transition-map.mmd"));
    const written = readFileSync(out, "utf8");
    assert.match(
      written.split("\n")[0],
      /^%% generated by scripts\/derive-transition-map\.mjs from requirements\/03-user-flow\.md — 手編集する場合はソース側を直して再生成すること$/,
    );
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(written), "タイムスタンプを出力に含めない (byte 決定論)");
  } finally {
    cleanup(root);
  }
});

test("CLI --out は出力先をリダイレクトし、親ディレクトリを作る", () => {
  const root = makeApp({ flow: CLI_FLOW });
  const outPath = join(root, "elsewhere", "map.mmd");
  try {
    const { exitCode, out } = run([root, "--out", outPath]);
    assert.equal(exitCode, 0);
    assert.equal(out, outPath);
    assert.ok(existsSync(outPath));
    assert.ok(!existsSync(join(root, "screens", "00-transition-map.mmd")), "既定の出力先には書かない");
  } finally {
    cleanup(root);
  }
});

test("CLI は既存の出力先を --force なしでは上書きせず exit 2 にする", () => {
  const root = makeApp({ flow: CLI_FLOW, existingOut: "%% 既存の SSoT\nflowchart TD\n  A --> B\n" });
  try {
    const first = run([root]);
    assert.equal(first.exitCode, 2);
    assert.match(first.error, /出力先が既存/);
    assert.match(readFileSync(join(root, "screens", "00-transition-map.mmd"), "utf8"), /既存の SSoT/);
    const forced = run([root, "--force"]);
    assert.equal(forced.exitCode, 0);
    assert.ok(!readFileSync(join(root, "screens", "00-transition-map.mmd"), "utf8").includes("既存の SSoT"));
  } finally {
    cleanup(root);
  }
});

test("同一入力に対する 2 回実行は byte 同一の出力を返す (決定論)", () => {
  const root = makeApp({ flow: CLI_FLOW });
  try {
    const first = run([root]);
    const bytes1 = readFileSync(first.out);
    const second = run([root, "--force"]);
    const bytes2 = readFileSync(second.out);
    assert.equal(bytes1.equals(bytes2), true, "同一入力 → byte 同一出力は絶対要件");
    // backed_up は退避先ファイル名 (時刻依存)、backup_warning は退避の失敗理由 (環境依存) なので
    // 決定論比較から除く。退避自体は self-backup のテスト群で検証する (時刻は .mmd 本文には一切
    // 入らないため、出力の決定論は上の byte 比較が担保)。
    const { backed_up: _backedUp, backup_warning: _backupWarning, ...secondSummary } = second.summary;
    assert.deepEqual(secondSummary, first.summary);
  } finally {
    cleanup(root);
  }
});

test("CLI は派生 summary sidecar を .mmd の隣に書く (後続 phase が生成時 warnings を読めるように)", () => {
  const flow = flowDoc([
    { heading: "3.1", code: '  A["ホーム"] --> B["動画一覧"]\n  classDef x fill:#fff\n  ??? 未対応記法' },
  ]);
  const root = makeApp({ flow });
  try {
    const { exitCode, summary, out } = run([root]);
    assert.equal(exitCode, 0);
    const sidecarPath = join(root, "screens", "00-transition-map.derive-summary.json");
    assert.equal(summary.summary_sidecar, sidecarPath);
    assert.equal(sidecarPathFor(out), sidecarPath, "sidecar は .mmd と同じ stem");
    const doc = JSON.parse(readFileSync(sidecarPath, "utf8"));
    assert.equal(doc.derived_from, "requirements/03-user-flow.md");
    assert.equal(doc.mmd, "screens/00-transition-map.mmd", "app ルート相対で記録する");
    assert.equal(doc.mmd_md5, createHash("md5").update(readFileSync(out)).digest("hex"), "手修正の検知材料");
    assert.equal(
      doc.summary.warnings.filter((w) => w.type === "unparsed_line").length,
      1,
      "元図の遷移が欠けた信号が永続化されている",
    );
    assert.ok(doc.summary.backed_up === undefined, "run 固有の I/O 情報 (時刻入りパス) は入れない");
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(readFileSync(sidecarPath, "utf8")), "sidecar も決定論 (時刻を含めない)");
  } finally {
    cleanup(root);
  }
});

test("CLI --source / --screen-list はパスを上書きし、由来コメントに実ソースを書く", () => {
  const root = makeApp({ flow: CLI_FLOW });
  try {
    writeFileSync(join(root, "requirements", "99-alt-flow.md"), CLI_FLOW, "utf8");
    writeFileSync(join(root, "screens", "alt-list.md"), SCREEN_LIST, "utf8");
    const { exitCode, mmd } = run([
      root,
      "--source",
      "requirements/99-alt-flow.md",
      "--screen-list",
      "screens/alt-list.md",
    ]);
    assert.equal(exitCode, 0);
    assert.match(mmd.split("\n")[0], /from requirements\/99-alt-flow\.md —/);
  } finally {
    cleanup(root);
  }
});

test("CLI は入力不能 (app ルート / ソース / 画面一覧の不在) を exit 2 にする", () => {
  assert.equal(run([]).exitCode, 1, "app ルート未指定は使い方エラー (exit 1)");
  assert.equal(run([join(tmpdir(), "no-such-app-derive-transition-map")]).exitCode, 2);
  const noFlow = makeApp({});
  try {
    const r = run([noFlow]);
    assert.equal(r.exitCode, 2);
    assert.match(r.error, /ソースが見つからない/);
  } finally {
    cleanup(noFlow);
  }
  const noList = makeApp({ flow: CLI_FLOW, screenList: null });
  try {
    const r = run([noList]);
    assert.equal(r.exitCode, 2);
    assert.match(r.error, /画面一覧が見つからない/);
  } finally {
    cleanup(noList);
  }
});

test("CLI は mermaid ブロック 0 件を exit 2 にする (推測で図を作らない)", () => {
  const root = makeApp({ flow: "# 03. User Flow\n\nフロー図はまだ無い。\n" });
  try {
    const r = run([root]);
    assert.equal(r.exitCode, 2);
    assert.match(r.error, /mermaid/);
    assert.ok(!existsSync(join(root, "screens", "00-transition-map.mmd")), "失敗時は出力を書かない");
  } finally {
    cleanup(root);
  }
});

// --- self-backup (script 経由の上書きは hook が発火しないため script の義務) ---------------

/** `_backup/screens/` 配下の遷移図バックアップ一覧 (ディレクトリ不在なら空配列)。 */
const backupsOf = (root) => {
  const dir = join(root, "_backup", "screens");
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith("00-transition-map.")).sort() : [];
};

test("self-backup: --force 上書き時に現行 SSoT を _backup/ ミラーへ退避する", () => {
  const root = makeApp({ flow: CLI_FLOW, existingOut: "%% 既存の SSoT\nflowchart TD\n  A --> B\n" });
  try {
    const { exitCode, summary } = run([root, "--force"]);
    assert.equal(exitCode, 0);
    const backups = backupsOf(root);
    assert.equal(backups.length, 1, "上書き前の 1 件が退避される");
    assert.match(backups[0], /^00-transition-map\.\d{8}_\d{6}\.mmd$/, "命名は {stem}.{YYYYMMDD_HHMMSS}.{ext}");
    assert.match(
      readFileSync(join(root, "_backup", "screens", backups[0]), "utf8"),
      /既存の SSoT/,
      "退避されるのは上書き前の内容",
    );
    assert.equal(summary.backed_up, join(root, "_backup", "screens", backups[0]));
  } finally {
    cleanup(root);
  }
});

test("self-backup: 新規生成 (出力先が不在) では退避しない", () => {
  const root = makeApp({ flow: CLI_FLOW });
  try {
    const { exitCode, summary } = run([root]);
    assert.equal(exitCode, 0);
    assert.deepEqual(backupsOf(root), []);
    assert.equal(summary.backed_up, undefined);
  } finally {
    cleanup(root);
  }
});

test("self-backup: 直前バックアップと内容が同一なら退避しない (md5 dedup)", () => {
  const root = makeApp({ flow: CLI_FLOW, existingOut: "%% 既存の SSoT\nflowchart TD\n  A --> B\n" });
  try {
    run([root, "--force"]); // 1 件目: 上書き前の「既存の SSoT」
    run([root, "--force"]); // 2 件目: 生成結果 (1 件目とは内容が違う)
    assert.equal(backupsOf(root).length, 2);
    const third = run([root, "--force"]); // 生成結果は同一 → dedup
    assert.equal(third.exitCode, 0);
    assert.equal(backupsOf(root).length, 2, "no-op rewrite でバックアップを増殖させない");
    assert.equal(third.summary.backed_up, undefined);
  } finally {
    cleanup(root);
  }
});

test("self-backup: 退避に失敗しても .mmd 生成は成功し、失敗理由が backup_warning に載る (fail-open)", () => {
  const root = makeApp({ flow: CLI_FLOW, existingOut: "%% 既存の SSoT\nflowchart TD\n  A --> B\n" });
  try {
    writeFileSync(join(root, "_backup"), "退避先をファイルで塞ぐ", "utf8"); // mkdir を失敗させる
    const { exitCode, summary } = run([root, "--force"]);
    assert.equal(exitCode, 0, "退避できなくても本処理は止めない");
    assert.equal(summary.backed_up, undefined);
    assert.equal(typeof summary.backup_warning, "string", "黙って失敗せず理由を summary に載せる");
    assert.ok(summary.backup_warning.length > 0);
    assert.ok(!readFileSync(join(root, "screens", "00-transition-map.mmd"), "utf8").includes("既存の SSoT"));
  } finally {
    cleanup(root);
  }
});

test("self-backup: 成功時 / 非対象時の summary に backup_warning は出ない", () => {
  const backedUp = makeApp({ flow: CLI_FLOW, existingOut: "%% 既存の SSoT\nflowchart TD\n  A --> B\n" });
  try {
    const { summary } = run([backedUp, "--force"]);
    assert.equal(typeof summary.backed_up, "string");
    assert.equal(summary.backup_warning, undefined, "退避成功時は失敗 key を出さない");
  } finally {
    cleanup(backedUp);
  }
  const fresh = makeApp({ flow: CLI_FLOW });
  try {
    const { summary } = run([fresh]); // 新規生成 = 退避対象外
    assert.equal(summary.backed_up, undefined);
    assert.equal(summary.backup_warning, undefined, "非対象は「何もしなかった」= 警告も出さない");
  } finally {
    cleanup(fresh);
  }
});

test("self-backup: バックアップ対象外の --out パスは退避しない (許可リスト方式)", () => {
  const root = makeApp({ flow: CLI_FLOW });
  try {
    const outRel = "screens/alt-map.mmd";
    writeFileSync(join(root, "screens", "alt-map.mmd"), "%% 既存の別ファイル\n", "utf8");
    const { exitCode, summary } = run([root, "--out", outRel, "--force"]);
    assert.equal(exitCode, 0);
    assert.deepEqual(backupsOf(root), []);
    assert.equal(summary.backed_up, undefined);
    assert.ok(!existsSync(join(root, "_backup")), "対象外パスでは _backup/ 自体を作らない");
  } finally {
    cleanup(root);
  }
});

test("CLI は使い方エラー (不明フラグ / 値なしフラグ / 引数過多) を exit 1 にする", () => {
  // 呼び出し側のバグを材料不足の fail-open (exit 2) に合流させない = 兄弟 derive-screen-nav と同契約
  assert.equal(run(["app", "--bogus"]).exitCode, 1);
  assert.equal(run(["app", "--out"]).exitCode, 1);
  assert.match(run(["app", "--out"]).error, /--out に値がありません/);
  assert.equal(run(["app", "extra"]).exitCode, 1);
});

test("CLI は app ルート外への --out を exit 1 で拒否する (退避なしの任意パス上書きを防ぐ)", () => {
  const root = makeApp({ flow: CLI_FLOW });
  try {
    const outside = run([root, "--out", "../escaped.mmd"]);
    assert.equal(outside.exitCode, 1);
    assert.match(outside.error, /app ルート配下/);
    assert.equal(run([root, "--out", join(tmpdir(), "abs-escaped.mmd")]).exitCode, 1, "絶対パスでも app 外は拒否");
    assert.ok(!existsSync(join(tmpdir(), "abs-escaped.mmd")), "拒否した経路では書き込まない");
    assert.equal(run([root, "--out", "screens/alt.mmd"]).exitCode, 0, "app ルート配下なら従来どおり通る");
  } finally {
    cleanup(root);
  }
});
