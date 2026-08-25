// scripts/derive-screen-nav.test.mjs
//
// scripts/derive-screen-nav.mjs の単体テスト。Node 標準の node:test + node:assert のみ (依存ゼロ)。
//   実行: node --test scripts/derive-screen-nav.test.mjs
//
// テスト方針:
//   - パーサは現行記法 (skills/14) の各構文要素を fixture で網羅し、記法外の構文
//     (classDef / :::class / 点線矢印 等) が MmdParseError になることを断言する (strict parse 契約)。
//   - edge_kind / bidirectional 展開は schemas/screen-nav.schema.json:103-107 の enum 規則を
//     ground truth として断言する。
//   - CLI の exit code 契約 (0/2) は spawnSync で実プロセスを起動して検証する
//     (lint-screen-colors.mjs と同型の契約が deliverable のため)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  parseTransitionMap,
  parseScreenList,
  matchScreens,
  buildDirectedEdges,
  computeNav,
  deriveNav,
  splitBidiLabel,
  edgeKind,
  MmdParseError,
  InputError,
} from "./derive-screen-nav.mjs";

// ── fixtures ────────────────────────────────────────────

// skills/14 現行記法テンプレート準拠のミニ .mmd (4 種ノード + 有/無ラベル + bidirectional + subgraph)
const MMD_MINI = `%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TD
    start([アプリ起動])

    subgraph auth [認証]
      scrLogin[ログイン]
      errLogin([ログイン失敗])
    end
    style auth fill:#EDE9FE

    scrHome[ホーム]
    scrNotice[お知らせ詳細]
    mdlConfirm([確認ダイアログ])
    extWeb[\\契約変更 Web\\]

    start --> scrLogin
    scrLogin -->|認証成功| scrHome
    scrLogin -->|認証失敗| errLogin
    errLogin -->|再試行| scrLogin
    scrHome <-->|"お知らせ / 戻る"| scrNotice
    scrNotice -->|確認| mdlConfirm
    mdlConfirm -->|閉じる| scrNotice
    scrHome -->|契約変更| extWeb

    style start fill:#D1FAE5,stroke:#10B981
    style scrLogin fill:#FFFFFF,stroke:#E5E7EB
    style errLogin fill:#FEF3C7,stroke:#F59E0B
    style scrHome fill:#FFFFFF,stroke:#E5E7EB
    style scrNotice fill:#FFFFFF,stroke:#E5E7EB
    style mdlConfirm fill:#FEF3C7,stroke:#F59E0B
    style extWeb fill:#F5F5F5,stroke:#9CA3AF
`;

// kinto 系 screen-list (chrome 列あり)。表記ゆれ (空白 / 全角括弧 / 包含) を意図的に含む。
const LIST_CHROME = `# 画面一覧

| # | 画面名 | 目的 | ヘッダー | ボトムメニュー | 現在タブ | 備考 |
|---|---|---|---|---|---|---|
| 01 | ログイン | 認証 | なし | 無 | — | |
| 02 | ホーム | 概要 | A | 有 | home | |
| 03 | お知らせ詳細 | 通知 | B | 無 | — | |
`;

// legacy 系 screen-list (画面ID 列あり / chrome 列なし)
const LIST_LEGACY = `# 画面一覧

| No | 画面ID | 画面名 | 種別 | 概要 |
|---|---|---|---|---|
| 1 | \`01-home\` | ホーム | 主要 | |
| 2 | \`02-notice\` | お知らせ詳細 | 子 | |
`;

// ── parseTransitionMap: 正常系 ──────────────────────────

test("parseTransitionMap: 4 種ノードの形状と category 分類", () => {
  const p = parseTransitionMap(MMD_MINI);
  assert.equal(p.nodes.get("scrLogin").category, "screen");
  assert.equal(p.nodes.get("scrLogin").label, "ログイン");
  assert.equal(p.nodes.get("errLogin").category, "modal"); // stadium + modal 塗り
  assert.equal(p.nodes.get("mdlConfirm").category, "modal");
  assert.equal(p.nodes.get("extWeb").category, "external"); // trapezoid
  assert.equal(p.nodes.get("extWeb").label, "契約変更 Web");
  assert.equal(p.nodes.get("start").category, "entry"); // stadium + #D1FAE5 塗り
});

test("parseTransitionMap: entry 識別は style 塗りが無くても id の start プレフィクスで成立", () => {
  const p = parseTransitionMap("flowchart TD\n  start([起動])\n  scrA[画面A]\n  start --> scrA\n");
  assert.equal(p.nodes.get("start").category, "entry");
});

test("parseTransitionMap: エッジ (有/無ラベル・quoted・bidirectional) と行番号", () => {
  const p = parseTransitionMap(MMD_MINI);
  const e0 = p.edges.find((e) => e.from === "start");
  assert.equal(e0.label, undefined);
  const bidi = p.edges.find((e) => e.op === "<-->");
  assert.equal(bidi.from, "scrHome");
  assert.equal(bidi.label, "お知らせ / 戻る"); // quotes は strip 済み
});

test("parseTransitionMap: 未宣言ノードへのエッジは implicit screen として補われる", () => {
  const p = parseTransitionMap("flowchart TD\n  scrA[画面A]\n  scrA --> scrGhost\n");
  assert.equal(p.nodes.get("scrGhost").shape, "implicit");
  assert.equal(p.nodes.get("scrGhost").category, "screen");
});

test("parseTransitionMap: `---` 区切りの複数 flowchart をマージし、同一再宣言を許容", () => {
  const p = parseTransitionMap(
    "flowchart TD\n  scrA[画面A]\n  scrB[画面B]\n  scrA --> scrB\n---\nflowchart TD\n  scrA[画面A]\n  scrC[画面C]\n  scrA --> scrC\n",
  );
  assert.deepEqual([...p.nodes.keys()], ["scrA", "scrB", "scrC"]);
  assert.equal(p.edges.length, 2);
});

// ── parseTransitionMap: strict parse (現行記法外は throw) ────

test("parseTransitionMap: 現行記法外の記法は MmdParseError", () => {
  const base = "flowchart TD\n  scrA[画面A]\n";
  for (const bad of [
    "classDef screen fill:#FFF", // classDef は現行記法で廃止 (skills/14)
    "scrB[画面B]:::screen", // :::class 記法
    "scrA -.-> scrB", // 点線矢印
    "scrA ==> scrB", // 太矢印
    "scrA --> scrB --> scrC", // チェーン記法
  ]) {
    assert.throws(() => parseTransitionMap(base + bad + "\n"), MmdParseError, `should reject: ${bad}`);
  }
});

test("parseTransitionMap: subgraph 不整合 / flowchart ヘッダ欠落 / shape 食い違い再宣言は throw", () => {
  assert.throws(() => parseTransitionMap("flowchart TD\n  subgraph a [A]\n  scrA[画面A]\n"), MmdParseError); // unclosed
  assert.throws(() => parseTransitionMap("flowchart TD\n  end\n"), MmdParseError); // orphan end
  assert.throws(() => parseTransitionMap("  scrA[画面A]\n"), MmdParseError); // no flowchart header
  assert.throws(
    () => parseTransitionMap("flowchart TD\n  scrA[画面A]\n---\nflowchart TD\n  scrA([画面A])\n"),
    MmdParseError, // 同一 id を別 shape で再宣言
  );
});

// ── edge_kind / bidirectional 展開 (schema:103-107) ─────

test("splitBidiLabel: ' / ' 区切りで [順方向, 逆方向]、単一 label は両方向共有", () => {
  assert.deepEqual(splitBidiLabel("お知らせ / 戻る"), ["お知らせ", "戻る"]);
  assert.deepEqual(splitBidiLabel("BottomNav: 履歴"), ["BottomNav: 履歴", "BottomNav: 履歴"]);
  assert.deepEqual(splitBidiLabel(undefined), [undefined, undefined]);
  assert.deepEqual(splitBidiLabel("a / b / c"), ["a", "b / c"]);
});

test("edgeKind: キーワード (戻る/キャンセル/閉じる) と external 宛/bidi 逆方向の規則", () => {
  const ext = { category: "external" };
  const scr = { category: "screen" };
  assert.equal(edgeKind("ホームへ戻る", scr, false), "back"); // 「〜系」= 部分一致
  assert.equal(edgeKind("キャンセル", scr, false), "back");
  assert.equal(edgeKind("閉じる", scr, false), "close");
  assert.equal(edgeKind("契約変更", ext, false), "external"); // 宛先 trapezoid が最優先
  assert.equal(edgeKind("再試行", scr, false), "forward"); // キーワード無し
  assert.equal(edgeKind("選択", scr, true), "back"); // bidi 逆方向はキーワード無しでも back
  assert.equal(edgeKind(undefined, scr, false), "forward");
});

test("buildDirectedEdges: <--> は順方向 + 戻りの 2 本に展開される", () => {
  const p = parseTransitionMap(MMD_MINI);
  const d = buildDirectedEdges(p);
  const fwd = d.find((e) => e.from === "scrHome" && e.to === "scrNotice");
  const rev = d.find((e) => e.from === "scrNotice" && e.to === "scrHome");
  assert.deepEqual(fwd, { from: "scrHome", to: "scrNotice", via: "お知らせ", kind: "forward" });
  assert.deepEqual(rev, { from: "scrNotice", to: "scrHome", via: "戻る", kind: "back" });
});

test("computeNav: entries/exits の正規化と is_entry_point", () => {
  const p = parseTransitionMap(MMD_MINI);
  const nav = computeNav(p);
  const login = nav.get("scrLogin");
  assert.equal(login.is_entry_point, true); // start (entry ノード) から inbound
  // 無ラベルエッジは via を持たない (via の発明禁止)
  assert.deepEqual(login.entries.find((e) => e.from === "start"), { from: "start", kind: "forward" });
  const home = nav.get("scrHome");
  assert.equal(home.is_entry_point, false);
  // modal からの close は entries に kind=close で現れる
  const notice = nav.get("scrNotice");
  assert.deepEqual(notice.entries.find((e) => e.from === "mdlConfirm"), {
    from: "mdlConfirm",
    via: "閉じる",
    kind: "close",
  });
});

// ── parseScreenList ─────────────────────────────────────

test("parseScreenList: chrome 列あり (kinto 系)", () => {
  const { rows, hasChrome } = parseScreenList(LIST_CHROME);
  assert.equal(hasChrome, true);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], { no: "02", name: "ホーム", chrome: "A", bottom_nav: true, ref: "02-ホーム" });
  assert.deepEqual(rows[2], { no: "03", name: "お知らせ詳細", chrome: "B", bottom_nav: false, ref: "03-お知らせ詳細" });
  assert.equal(rows[0].chrome, "なし");
});

test("parseScreenList: 画面ID 列あり / chrome 列なし (legacy 系)。backtick は strip、ref は 画面ID", () => {
  const { rows, hasChrome } = parseScreenList(LIST_LEGACY);
  assert.equal(hasChrome, false);
  assert.deepEqual(rows[0], { no: "1", name: "ホーム", screen_id: "01-home", ref: "01-home" });
  assert.equal(rows[0].chrome, undefined);
});

test("parseScreenList: 画面名列を持つテーブルが無ければ InputError", () => {
  assert.throws(() => parseScreenList("# doc\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"), InputError);
});

// 複数テーブル (reverse 産 = 機能カテゴリごとに表が分かれる形式)
// forward 産の 1 テーブル構成では上記 2 test のとおり挙動不変。

test("parseScreenList: 画面名列を持つ全テーブルを文書順に連結する (最初の表で打ち切らない)", () => {
  const md = `# 画面一覧

## 認証・アカウント

| # | 画面ID | 画面名 | 目的 |
|---|---|---|---|
| 01 | SCR-001 | ログイン | 認証 |
| 02 | SCR-002 | アカウント | 設定 |

## 動画管理

| # | 画面ID | 画面名 | 目的 |
|---|---|---|---|
| 03 | SCR-003 | 動画一覧 | 一覧 |
| 04 | SCR-004 | 動画詳細 | 再生 |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.deepEqual(
    rows.map((r) => r.ref),
    ["SCR-001", "SCR-002", "SCR-003", "SCR-004"],
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["ログイン", "アカウント", "動画一覧", "動画詳細"],
  );
  assert.deepEqual(
    warnings,
    [],
    "重複が無い入力では複数テーブル対応も dedupe も no-op — 行を落とさず warning も出さない (不変性の固定)",
  );
});

test("parseScreenList: 再掲テーブルの重複行は画面ID で初出優先 dedupe する", () => {
  const md = `# 画面一覧

## 認証

| # | 画面ID | 画面名 | 目的 |
|---|---|---|---|
| 01 | SCR-001 | ログイン | 認証 |

## 再掲 (同じ画面を別カテゴリの表が再掲)

| # | 画面ID | 画面名 | 目的 |
|---|---|---|---|
| 02 | SCR-001 | ログイン | 認証 (再掲) |
| 03 | SCR-002 | ホーム | 起点 |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.deepEqual(
    rows.map((r) => [r.ref, r.name]),
    [
      ["SCR-001", "ログイン"],
      ["SCR-002", "ホーム"],
    ],
    "再掲された SCR-001 は初出のみ採用し、再掲表だけにある SCR-002 は拾う",
  );
  assert.equal(rows[0].no, "01", "初出行の値を保つ (再掲側の列構成で上書きしない)");
  assert.deepEqual(
    warnings,
    [{ type: "duplicate_screen_row", name: "ログイン", kept: "SCR-001", dropped: "SCR-001" }],
    "落とした行は黙殺せず warning に積む",
  );
});

// 画面一覧テーブルの判定 (`画面名` 列 + 標識列)。`画面名` だけを条件にすると別目的の表を読む。

test("parseScreenList: 標識列を持たない `画面名` 表 (状態パターン節) は読まず skipped_table warning", () => {
  const md = `# 画面一覧

| # | 画面ID | 画面名 | 目的 |
|---|---|---|---|
| 01 | SCR-001 | ログイン | 認証 |

## 状態パターン

| 画面ID | 画面名 | frame 数 | default | loading | error | empty |
|---|---|---|---|---|---|---|
| SCR-001 | ログイン | 4 | ✅ | ✅ |  |  |
| SCR-002 | ホーム | 14 | ✅ | ✅ |  |  |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.deepEqual(
    rows.map((r) => [r.ref, r.name]),
    [["SCR-001", "ログイン"]],
    "状態パターン表だけに現れる SCR-002 を画面として拾わない (幽霊行を作らない)",
  );
  assert.deepEqual(warnings, [
    {
      type: "skipped_table",
      line: 9,
      headers: "画面ID | 画面名 | frame 数 | default | loading | error | empty",
    },
  ]);
});

test("parseScreenList: 標識列なし表を除外することで hasChrome が実態どおりになる", () => {
  const md = `# 画面一覧

| # | 画面名 | 目的 | ヘッダー | ボトムメニュー |
|---|---|---|---|---|
| 01 | ホーム | 起点 | A | 有 |

## 状態パターン

| 画面ID | 画面名 | frame 数 |
|---|---|---|
| S01 | ホーム | 3 |
`;
  const { rows, hasChrome } = parseScreenList(md);
  assert.equal(rows.length, 1);
  assert.equal(hasChrome, true, "chrome 列を持つのは画面一覧表だけ = 除外した表を全表 AND に混ぜない");
});

test("parseScreenList: 標識列の照合は表記ゆれを吸収する (全角 ＃ / NO. / 空白入り / 全角 ＩＤ)", () => {
  // 生比較にすると全角 `＃` 列だけを持つ正当な画面一覧が InputError で落ちる
  const variants = [
    "| ＃ | 画面名 |\n|---|---|\n| 01 | ホーム |\n",
    "| NO. | 画面名 |\n|---|---|\n| 01 | ホーム |\n",
    "| 画面名 | 目 的 |\n|---|---|\n| ホーム | 起点 |\n",
    "| 画面名 | 対応機能 ID |\n|---|---|\n| ホーム | F-1 |\n",
    "| 画面名 | 対応機能ＩＤ |\n|---|---|\n| ホーム | F-1 |\n",
  ];
  for (const table of variants) {
    const { rows, warnings } = parseScreenList(`# 画面一覧\n\n${table}`);
    assert.equal(rows.length, 1, `標識列として認識されるべき: ${table.split("\n")[0]}`);
    assert.deepEqual(warnings, [], "正当な画面一覧を skipped_table にしない");
  }
});

test("parseScreenList: 標識列を持つ表が 1 つも無ければ InputError (幽霊行を作って進まない)", () => {
  const md = `# 状態一覧\n\n| 画面ID | 画面名 | frame 数 |\n|---|---|---|\n| S01 | ホーム | 3 |\n`;
  assert.throws(() => parseScreenList(md), InputError);
});

test("parseScreenList: 初出行が画面ID 付き・再掲行が画面ID なしでも dedupe する (鍵は ID と画面名の両方)", () => {
  const md = `# 画面一覧

| # | 画面ID | 画面名 | 目的 | 遷移図ノードID |
|---|---|---|---|---|
| 01 | S00 | ホーム | 起点 | HOME |
| 02 | S01 | 予約一覧 | 一覧 |  |

## 再掲 (画面ID 列なし)

| # | 画面名 | 目的 | 遷移図ノードID |
|---|---|---|---|
| 03 | 予約一覧 | 一覧の再掲 | RSVLIST |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.deepEqual(
    rows.map((r) => r.ref),
    ["S00", "S01"],
    "同名の再掲行はすり抜けさせない (両側一意の突合を壊してスタジアム降格させないため)",
  );
  assert.equal(rows[1].node_id, "RSVLIST", "初出行が持たない 遷移図ノードID の宣言だけは引き継ぐ");
  assert.deepEqual(warnings, [
    {
      type: "duplicate_screen_row",
      name: "予約一覧",
      kept: "S01",
      dropped: "03-予約一覧",
      merged_node_id: "RSVLIST",
    },
  ]);
});

test("parseScreenList: 引き継げなかった再掲行の 遷移図ノードID は ignored_node_id に載せる", () => {
  const md = `# 画面一覧

| # | 画面名 | 目的 | 遷移図ノードID |
|---|---|---|---|
| 01 | 予約一覧 | 一覧 | RSVLIST |
| 02 | 予約一覧 | 再掲 | OTHER |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].node_id, "RSVLIST", "初出行の宣言を上書きしない");
  assert.deepEqual(warnings, [
    {
      type: "duplicate_screen_row",
      name: "予約一覧",
      kept: "01-予約一覧",
      dropped: "02-予約一覧",
      ignored_node_id: "OTHER",
    },
  ]);
});

test("parseScreenList: 異なる画面ID を持つ同名行 (正規化衝突) は両方残して screen_name_collision", () => {
  const md = `# 画面一覧

| # | 画面ID | 画面名 | 目的 |
|---|---|---|---|
| 01 | S02 | 入庫予約（カレンダー） | 予約 |
| 02 | S03 | 入庫予約カレンダー | 別画面 |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.deepEqual(
    rows.map((r) => r.ref),
    ["S02", "S03"],
    "norm() は括弧を除去するが、画面ID が違えば意図的な区別名として両方残す",
  );
  assert.deepEqual(warnings, [
    { type: "screen_name_collision", name: "入庫予約カレンダー", kept: "S02", also: "S03" },
  ]);
});

test("parseScreenList: 画面ID 列が無い表の重複は正規化画面名で dedupe する", () => {
  const md = `# 画面一覧

| # | 画面名 | 目的 |
|---|---|---|
| 01 | UG 商品詳細 | 詳細 |

## 再掲

| # | 画面名 | 目的 |
|---|---|---|
| 02 | UG商品詳細 | 詳細 (空白ゆれの再掲) |
| 03 | ホーム | 起点 |
`;
  const { rows } = parseScreenList(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["UG 商品詳細", "ホーム"],
  );
});

test("parseScreenList: 行番号 fallback の連番はテーブルをまたいで連続する", () => {
  const md = `# 画面一覧

| 画面名 | 目的 |
|---|---|
| ログイン | 認証 |

## 次のカテゴリ

| 画面名 | 目的 |
|---|---|
| ホーム | 起点 |
| 設定 | 設定 |
`;
  const { rows } = parseScreenList(md);
  assert.deepEqual(
    rows.map((r) => [r.no, r.ref]),
    [
      ["01", "01-ログイン"],
      ["02", "02-ホーム"],
      ["03", "03-設定"],
    ],
  );
});

test("parseScreenList: 列構成はテーブルごとに独立に解決し、hasChrome は全表が chrome 列を持つときだけ true", () => {
  const withChrome = `| # | 画面名 | ヘッダー | ボトムメニュー |
|---|---|---|---|
| 01 | ホーム | A | 有 |
`;
  const withoutChrome = `| # | 画面名 | 目的 |
|---|---|---|
| 02 | 設定 | 設定 |
`;
  const both = parseScreenList(`# 画面一覧\n\n${withChrome}\n## 別カテゴリ\n\n${withoutChrome}`);
  assert.equal(both.hasChrome, false, "chrome 列を持たない表が混ざれば chrome 連携は主張しない");
  assert.deepEqual(both.rows[0], { no: "01", name: "ホーム", chrome: "A", bottom_nav: true, ref: "01-ホーム" });
  assert.deepEqual(both.rows[1], { no: "02", name: "設定", ref: "02-設定" }, "chrome 列が無い表の行に chrome は付かない");

  const allChrome = parseScreenList(
    `# 画面一覧\n\n${withChrome}\n## 別カテゴリ\n\n| # | 画面名 | ヘッダー | ボトムメニュー |\n|---|---|---|---|\n| 02 | 設定 | B | 無 |\n`,
  );
  assert.equal(allChrome.hasChrome, true);
  assert.equal(allChrome.rows[1].chrome, "B");
});

// 遷移図ノードID 列 (reverse Step 06 E3 の任意列。forward Step 14 は付けない)

test("parseScreenList: 遷移図ノードID 列を拾い、文法外の値は ID 無しとして扱う (非空値は warning)", () => {
  const md = `# 画面一覧

| # | 画面ID | 画面名 | 遷移図ノードID |
|---|---|---|---|
| 01 | SCR-001 | ホーム | \`HOME\` |
| 02 | SCR-002 | 撮影ガイド | GUIDE |
| 03 | SCR-003 | 設定 |  |
| 04 | SCR-004 | 履歴 | — |
| 05 | SCR-005 | 通知 | ホーム画面のノード |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.equal(rows[0].node_id, "HOME", "backtick は cleanCell が strip する");
  assert.equal(rows[1].node_id, "GUIDE");
  assert.equal(rows[2].node_id, undefined, "空欄は ID 無し (発明しない)");
  assert.equal(rows[3].node_id, undefined, "— は ID 無し");
  assert.equal(rows[4].node_id, undefined, "Mermaid ID 文法に合わない値は無視");
  assert.deepEqual(
    warnings,
    [{ type: "invalid_node_id", value: "ホーム画面のノード", ref: "SCR-005" }],
    "空欄 / — は警告にしない (ID 無し記法) が、文法外の非空値は黙殺せず warning を積む",
  );
});

test("parseScreenList: 文法外の非空 node_id は invalid_node_id warning + ID なし扱い", () => {
  const md = `# 画面一覧

| # | 画面ID | 画面名 | 遷移図ノードID |
|---|---|---|---|
| 01 | SCR-001 | 一覧 | AV-LIST |
| 02 | SCR-002 | ホーム | HOME (タブ 1) |
| 03 | SCR-003 | 動画 | 1VIDEO |
| 04 | SCR-004 | 履歴 | — |
| 05 | SCR-005 | 設定 |  |
`;
  const { rows, warnings } = parseScreenList(md);
  for (const row of rows) assert.equal(row.node_id, undefined, "文法外 / ID 無しはどちらも node_id を持たない");
  assert.deepEqual(warnings, [
    { type: "invalid_node_id", value: "AV-LIST", ref: "SCR-001" },
    { type: "invalid_node_id", value: "HOME (タブ 1)", ref: "SCR-002" },
    { type: "invalid_node_id", value: "1VIDEO", ref: "SCR-003" },
  ], "ダッシュ 1 文字 (—) と空欄は warning 対象外");
});

test("parseScreenList: 列が無い screen-list は node_id を持たない (従来挙動)", () => {
  const { rows, warnings } = parseScreenList(LIST_LEGACY);
  for (const row of rows) assert.equal(row.node_id, undefined);
  assert.deepEqual(warnings, []);
});

test("parseScreenList: 同一 遷移図ノードID の重複は初出優先 + duplicate_node_id warning", () => {
  const md = `# 画面一覧

| # | 画面ID | 画面名 | 遷移図ノードID |
|---|---|---|---|
| 01 | SCR-001 | ホーム | HOME |
| 02 | SCR-002 | ホーム (タブ切替後) | HOME |
`;
  const { rows, warnings } = parseScreenList(md);
  assert.equal(rows[0].node_id, "HOME");
  assert.equal(rows[1].node_id, undefined, "2 件目は無視してラベル一致に委ねる");
  assert.deepEqual(warnings, [{ type: "duplicate_node_id", node_id: "HOME", kept: "SCR-001", ignored: "SCR-002" }]);
});

// ── matchScreens (表記ゆれ突合) ─────────────────────────

test("matchScreens: 完全一致 + 空白/全角括弧の正規化 + 一意包含", () => {
  const p = parseTransitionMap(
    "flowchart TD\n  scrA[UG商品詳細・適合判定]\n  scrB[入庫予約カレンダー]\n  scrC[スコア推移]\n  scrA --> scrB\n  scrB --> scrC\n",
  );
  const rows = [
    { no: "01", name: "UG 商品詳細・適合判定", ref: "01-UG 商品詳細・適合判定" }, // 空白ゆれ
    { no: "02", name: "入庫予約（カレンダー）", ref: "02-入庫予約（カレンダー）" }, // 全角括弧ゆれ
    { no: "03", name: "運転診断スコア推移", ref: "03-運転診断スコア推移" }, // 包含 (node ⊂ list)
  ];
  const m = matchScreens(p, rows);
  assert.equal(m.nodeToRow.get("scrA").ref, "01-UG 商品詳細・適合判定");
  assert.equal(m.nodeToRow.get("scrB").ref, "02-入庫予約（カレンダー）");
  assert.equal(m.nodeToRow.get("scrC").ref, "03-運転診断スコア推移");
  assert.equal(m.unmatchedNodes.length, 0);
  assert.equal(m.unmatchedRows.length, 0);
});

test("matchScreens: 曖昧な包含 (候補 2 件) は採用しない = 過検出側", () => {
  const p = parseTransitionMap("flowchart TD\n  scrA[設定]\n  scrB[設定]\n  scrA --> scrB\n");
  // 同一 label ノード 2 つが 1 行を取り合う → どちらも未マッチのまま
  const rows = [{ no: "01", name: "設定", ref: "01-設定" }];
  const m = matchScreens(p, rows);
  assert.equal(m.nodeToRow.size, 0);
  assert.equal(m.unmatchedNodes.length, 2);
  assert.equal(m.unmatchedRows.length, 1);
});

test("matchScreens: Pass 0 — ラベルが一致しなくても 遷移図ノードID で突合できる", () => {
  const p = parseTransitionMap("flowchart TD\n  HOME[ホーム]\n  GUIDE[撮影ガイド]\n  HOME --> GUIDE\n");
  const rows = [
    { no: "01", name: "ホーム画面 (ダッシュボード)", ref: "SCR-001", node_id: "HOME" },
    { no: "02", name: "アバター映像の作成 (撮影ガイド)", ref: "SCR-002", node_id: "GUIDE" },
  ];
  const m = matchScreens(p, rows);
  assert.equal(m.nodeToRow.get("HOME").ref, "SCR-001");
  assert.equal(m.nodeToRow.get("GUIDE").ref, "SCR-002");
  assert.equal(m.unmatchedNodes.length, 0);
  assert.equal(m.unmatchedRows.length, 0, "ラベル語彙が離れていても orphan_in_list を出さない");
});

test("matchScreens: node_id が .mmd に無い行はラベル一致 (Pass 1/2) に fallback する", () => {
  const p = parseTransitionMap("flowchart TD\n  scrHome[ホーム]\n  scrList[動画一覧]\n  scrHome --> scrList\n");
  const rows = [
    { no: "01", name: "ホーム", ref: "SCR-001", node_id: "HOME" }, // .mmd に HOME ノードは無い
    { no: "02", name: "動画一覧", ref: "SCR-002" },
  ];
  const m = matchScreens(p, rows);
  assert.equal(m.nodeToRow.get("scrHome").ref, "SCR-001", "ID 空振り → ラベル完全一致で拾う");
  assert.equal(m.nodeToRow.get("scrList").ref, "SCR-002");
  assert.deepEqual(
    m.warnings,
    [{ type: "unknown_node_id", node_id: "HOME", ref: "SCR-001" }],
    "文法は合法でも .mmd に無い宣言は黙って fallback せず warning を積む",
  );
});

test("matchScreens: Pass 0 の候補は diamond 以外の全ノード (stadium にも ID で届く) → screen へ昇格", () => {
  // スタジアム (modal 扱いの glyph) を screen-list が ID 宣言している = 旧 .mmd で変換済みのノード
  const p = parseTransitionMap("flowchart TD\n  HOME[ホーム]\n  TOAST([保存しました])\n  HOME --> TOAST\n");
  const rows = [
    { no: "01", name: "ホーム", ref: "SCR-001", node_id: "HOME" },
    { no: "02", name: "保存完了", ref: "SCR-002", node_id: "TOAST" },
  ];
  const m = matchScreens(p, rows);
  assert.equal(m.nodeToRow.get("TOAST").ref, "SCR-002", "明示 ID 宣言は glyph より強い (screen 形状に限らない)");
  assert.equal(m.unmatchedRows.length, 0, "宣言が届いた行は orphan_in_list にしない");
  assert.equal(
    p.nodes.get("TOAST").category,
    "screen",
    "行を消費したまま nav / L5 の検査対象から外れる (= 検査を受けていない) 状態を作らない",
  );
  assert.deepEqual(m.unmatchedNodes, [], "昇格したノードも突合済みなので unmatchedNodes には出ない");
  assert.deepEqual(m.warnings, [
    { type: "node_id_bound_to_non_screen", node_id: "TOAST", category: "modal", ref: "SCR-002", promoted: true },
  ]);
});

test("matchScreens: entry ノード (アプリ起動) への束縛は昇格させず warning のみ", () => {
  const p = parseTransitionMap('flowchart TD\n  start1(["アプリ起動"])\n  HOME[ホーム]\n  start1 --> HOME\n');
  const rows = [{ no: "01", name: "起動", ref: "SCR-000", node_id: "start1" }];
  const m = matchScreens(p, rows);
  assert.equal(p.nodes.get("start1").category, "entry", "昇格させると is_entry_point の判定元が消える");
  assert.deepEqual(m.warnings, [
    { type: "node_id_bound_to_non_screen", node_id: "start1", category: "entry", ref: "SCR-000", promoted: false },
  ]);
});

test("matchScreens: diamond ノードは Pass 0 の候補にしない", () => {
  // derive-transition-map の probe 形 (shape つき) を模す — diamond は分岐 glyph であり画面ではない
  const nodes = new Map([
    ["DEC", { id: "DEC", shape: "diamond", label: "ログイン済み?", category: "modal" }],
    ["HOME", { id: "HOME", shape: "rect", label: "ホーム", category: "screen" }],
  ]);
  const rows = [{ no: "01", name: "判定", ref: "SCR-001", node_id: "DEC" }];
  const m = matchScreens({ nodes, edges: [] }, rows);
  assert.equal(m.nodeToRow.has("DEC"), false, "diamond は ID 宣言があっても突合しない");
  assert.equal(m.unmatchedRows.length, 1);
});

test("matchScreens: node_id 一致はラベル一致より優先する", () => {
  // ラベルだけ見れば scrA↔「設定」/ scrB↔「ホーム」だが、ID 宣言が逆を指している
  const p = parseTransitionMap("flowchart TD\n  scrA[ホーム]\n  scrB[設定]\n  scrA --> scrB\n");
  const rows = [
    { no: "01", name: "ホーム", ref: "SCR-001", node_id: "scrB" },
    { no: "02", name: "設定", ref: "SCR-002", node_id: "scrA" },
  ];
  const m = matchScreens(p, rows);
  assert.equal(m.nodeToRow.get("scrB").ref, "SCR-001");
  assert.equal(m.nodeToRow.get("scrA").ref, "SCR-002");
});

// ── deriveNav (schema 準拠の出力形) ─────────────────────

test("deriveNav: schema 準拠 — screen ノードのみ、許可 field のみ、chrome/screen_ref 付与", () => {
  const p = parseTransitionMap(MMD_MINI);
  const { rows } = parseScreenList(LIST_CHROME);
  const { doc } = deriveNav(p, rows, { appName: "test-app", generatedAt: "2026-07-06T00:00:00Z" });

  assert.equal(doc.app_name, "test-app");
  assert.equal(doc.derived_from, "screens/00-transition-map.mmd");
  // modal/external/entry 疑似ノードはトップレベル key に現れない
  assert.deepEqual(Object.keys(doc.screens), ["scrLogin", "scrHome", "scrNotice"]);

  const ALLOWED = new Set(["screen_ref", "is_entry_point", "is_terminal", "chrome", "entries", "exits"]);
  for (const [id, rec] of Object.entries(doc.screens)) {
    for (const k of Object.keys(rec)) assert.ok(ALLOWED.has(k), `${id}.${k} は schema 外 field`);
    for (const en of rec.entries) assert.ok("from" in en && "kind" in en);
    for (const ex of rec.exits) assert.ok("to" in ex && "kind" in ex);
  }
  assert.equal(doc.screens.scrLogin.chrome, "なし");
  assert.equal(doc.screens.scrLogin.is_entry_point, true);
  assert.equal(doc.screens.scrHome.chrome, "A");
  // external 宛 exit
  assert.deepEqual(doc.screens.scrHome.exits.find((e) => e.to === "extWeb"), {
    to: "extWeb",
    via: "契約変更",
    kind: "external",
  });
  // is_terminal は決定論導出不能のため常に false
  for (const rec of Object.values(doc.screens)) assert.equal(rec.is_terminal, false);
});

// ── CLI: exit code 契約 (0/2) ───────────────────────────

function makeAppDir(mmd, list) {
  const dir = mkdtempSync(join(tmpdir(), "derive-nav-test-"));
  mkdirSync(join(dir, "screens"));
  writeFileSync(join(dir, "screens", "00-transition-map.mmd"), mmd);
  writeFileSync(join(dir, "screens", "00-screen-list.md"), list);
  return dir;
}

// script のパスは import.meta.url 基準で解決する (cwd = repo root 以外からの単体実行でも通す)
const runCli = (script, args) =>
  spawnSync(process.execPath, [fileURLToPath(new URL(`./${script}`, import.meta.url)), ...args], { encoding: "utf8" });

test("CLI: 正常導出は exit 0 + 00-screen-nav.json 生成 + summary JSON", () => {
  const dir = makeAppDir(MMD_MINI, LIST_CHROME);
  const r = runCli("derive-screen-nav.mjs", [dir]);
  assert.equal(r.status, 0, r.stderr);
  const outPath = join(dir, "screens", "00-screen-nav.json");
  assert.ok(existsSync(outPath));
  const doc = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(Object.keys(doc.screens).length, 3);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.matched, 3);
});

test("CLI: strict parse 失敗は exit 2 (LLM fallback 契約) で何も書かない", () => {
  const dir = makeAppDir("flowchart TD\n  scrA[画面A]:::screen\n", LIST_CHROME);
  const r = runCli("derive-screen-nav.mjs", [dir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /parse failed/);
  assert.ok(!existsSync(join(dir, "screens", "00-screen-nav.json")));
});

test("CLI: 入力ファイル不在は exit 2 / 引数なしは exit 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "derive-nav-empty-"));
  assert.equal(runCli("derive-screen-nav.mjs", [dir]).status, 2);
  assert.equal(runCli("derive-screen-nav.mjs", []).status, 1);
});
