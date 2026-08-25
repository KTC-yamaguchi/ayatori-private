#!/usr/bin/env node
// scripts/derive-screen-nav.mjs
//
// `screens/00-transition-map.mmd` (SSoT) → `screens/00-screen-nav.json` (派生ビュー)
// の決定論的導出。従来 Step 14 / 19 / 29 で LLM が毎 run 手作業で行っていた
// 「.mmd パース → per-screen 入口/出口の正規化」を script 化する
// (lint-screen-colors と同型の決定論化)。
//
// 仕様正典:
//   - 導出規則:       docs/screen-coverage-check.md §4-5-1
//   - .mmd 記法 (現行記法): skills/14-screen-list-transition/SKILL.md 「Mermaid 生成ガイド」
//   - 出力 schema:     schemas/screen-nav.schema.json (edge_kind の enum 規則は :103-107)
//
// パース方針: **現行記法限定の strict parse**。現行記法として解釈できない行 (classDef /
// `:::class` / 点線矢印 等) が 1 行でもあれば exit 2 で停止し、従来の LLM 手動判定へ
// fallback させる (誤読した派生ビューを黙って書くより、書かない方が安全)。
//
// exit code 契約 (lint-screen-colors.mjs と同型):
//   0 = 導出成功 (00-screen-nav.json を書き出し、summary JSON を stdout へ)
//   1 = 使い方エラー (引数不正)
//   2 = 運用エラー (入力ファイル不在 / strict parse 失敗 → LLM 手動判定へ fallback)
//
// 使い方:
//   node scripts/derive-screen-nav.mjs <artifacts/{app_name}> [--out <path>]
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// entry ノード (アプリ起動) の style 塗り。skills/14 ノード分類 table で固定されている値。
const ENTRY_FILL = "#d1fae5";

// ───────────────────────────── エラー型 ─────────────────────────────

/** 現行記法として解釈できない .mmd → exit 2 (LLM 手動判定へ fallback) */
export class MmdParseError extends Error {
  constructor(lineNo, line, reason) {
    super(`.mmd parse failed at line ${lineNo}: ${reason}: ${JSON.stringify(line)}`);
    this.name = "MmdParseError";
    this.lineNo = lineNo;
  }
}

/** 入力ファイル不在等の運用エラー → exit 2 */
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

// ───────────────────────────── .mmd parser (現行記法 strict) ─────────────────────────────

const RE_INIT_DIRECTIVE = /^%%\{.*\}%%$/;
const RE_FLOWCHART = /^flowchart\s+(TD|TB|LR|RL|BT)$/;
const RE_SUBGRAPH = /^subgraph\s+([A-Za-z_]\w*)\s*\[(.+)\]$/;
const RE_STYLE = /^style\s+([A-Za-z_]\w*)\s+(\S.*)$/;
const RE_NODE_STADIUM = /^([A-Za-z_]\w*)\(\[(.+)\]\)$/; // id([label]) = modal / entry
const RE_NODE_TRAPEZOID = /^([A-Za-z_]\w*)\[\\(.+)\\\]$/; // id[\label\] = external
const RE_NODE_RECT = /^([A-Za-z_]\w*)\[(.+)\]$/; // id[label] = screen
const RE_EDGE = /^([A-Za-z_]\w*)\s*(<-->|-->)\s*(?:\|([^|]+)\|\s*)?([A-Za-z_]\w*)$/;

const stripQuotes = (s) => {
  const t = s.trim();
  const m = t.match(/^"(.*)"$/);
  return m ? m[1] : t;
};

/**
 * 現行記法の .mmd を strict parse する。
 * @returns {{ nodes: Map<string, object>, edges: object[] }}
 *   node = { id, shape: 'rect'|'stadium'|'trapezoid'|'implicit', label, category: 'screen'|'modal'|'external'|'entry', implicit? }
 *   edge = { from, op: '-->'|'<-->', label?, to, lineNo } (raw。方向展開は buildDirectedEdges)
 * @throws {MmdParseError} 現行記法として解釈できない行があった場合
 */
export function parseTransitionMap(text) {
  const nodes = new Map();
  const edges = [];
  const styleFills = new Map(); // id → fill (小文字)
  const subgraphStack = [];
  let seenFlowchart = false;

  const addNode = (lineNo, line, id, shape, rawLabel) => {
    const label = stripQuotes(rawLabel);
    const existing = nodes.get(id);
    if (existing) {
      // `---` 区切りの複数 flowchart で同一概念ノードを再宣言するのは許容 (skills/14 詳細 table)。
      // ただし shape / label が食い違う再宣言は同一 ID の別物であり strict に弾く。
      if (existing.shape !== shape || existing.label !== label) {
        throw new MmdParseError(lineNo, line, `node '${id}' redeclared with different shape/label`);
      }
      return;
    }
    nodes.set(id, { id, shape, label });
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNo = i + 1;
    if (!line) continue;
    if (RE_INIT_DIRECTIVE.test(line)) continue; // %%{init: ...}%%
    if (line.startsWith("%%")) continue; // コメント (%% h2: 見出し suggestion 含む)
    if (line === "---") {
      // 複数 flowchart の separator (skills/14 「図分割」)
      if (subgraphStack.length > 0) throw new MmdParseError(lineNo, line, "unclosed subgraph before '---'");
      continue;
    }
    let m;
    if ((m = line.match(RE_FLOWCHART))) {
      seenFlowchart = true;
      continue;
    }
    if ((m = line.match(RE_SUBGRAPH))) {
      subgraphStack.push(m[1]);
      continue;
    }
    if (line === "end") {
      if (subgraphStack.length === 0) throw new MmdParseError(lineNo, line, "'end' without matching subgraph");
      subgraphStack.pop();
      continue;
    }
    if ((m = line.match(RE_STYLE))) {
      const fill = m[2].match(/fill:\s*(#[0-9A-Fa-f]{3,8})/);
      if (fill) styleFills.set(m[1], fill[1].toLowerCase());
      continue;
    }
    // ノード宣言 — 判定順序が重要: stadium `([...])` → trapezoid `[\...\]` → rect `[...]`
    if ((m = line.match(RE_NODE_STADIUM))) {
      addNode(lineNo, line, m[1], "stadium", m[2]);
      continue;
    }
    if ((m = line.match(RE_NODE_TRAPEZOID))) {
      addNode(lineNo, line, m[1], "trapezoid", m[2]);
      continue;
    }
    if ((m = line.match(RE_NODE_RECT))) {
      addNode(lineNo, line, m[1], "rect", m[2]);
      continue;
    }
    if ((m = line.match(RE_EDGE))) {
      edges.push({
        from: m[1],
        op: m[2],
        label: m[3] !== undefined ? stripQuotes(m[3]) : undefined,
        to: m[4],
        lineNo,
      });
      continue;
    }
    throw new MmdParseError(lineNo, line, "not X-style notation (skills/14 Mermaid 生成ガイド)");
  }
  if (subgraphStack.length > 0) {
    throw new MmdParseError(lines.length, "(EOF)", `unclosed subgraph '${subgraphStack.at(-1)}'`);
  }
  if (!seenFlowchart) {
    throw new MmdParseError(1, "(file)", "no 'flowchart TD|LR' header found");
  }

  // エッジだけが参照する未宣言ノード: Mermaid は既定 rect として描画するため implicit screen 扱い
  // (screen-list に一致しなければ validator が dangling_edge として起票する)
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      if (!nodes.has(id)) nodes.set(id, { id, shape: "implicit", label: id, implicit: true });
    }
  }

  // 4 分類 (skills/14 ノード分類 table): rect=screen / stadium=modal|entry / trapezoid=external。
  // entry の識別は style 塗り (#D1FAE5、skills/14 で固定) または id の start プレフィクス。
  for (const n of nodes.values()) {
    if (n.shape === "trapezoid") n.category = "external";
    else if (n.shape === "stadium") {
      n.category = styleFills.get(n.id) === ENTRY_FILL || /^start/i.test(n.id) ? "entry" : "modal";
    } else n.category = "screen"; // rect / implicit
  }
  return { nodes, edges };
}

// ───────────────────────────── 方向付きエッジ展開 + edge_kind 導出 ─────────────────────────────

/**
 * bidirectional label "行き / 戻り" を [順方向, 逆方向] に分割する (区切りは ` / ` 固定、skills/14 規約)。
 * 単一 label は両方向で共有。
 */
export function splitBidiLabel(label) {
  if (label === undefined) return [undefined, undefined];
  const parts = label.split(" / ");
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(" / ")];
  return [label, label];
}

/**
 * edge_kind 導出 (schemas/screen-nav.schema.json:103-107 の enum 規則そのまま):
 * ラベルが 戻る/キャンセル/閉じる 系 or bidirectional の逆方向 → back/close、
 * 外部遷移 (trapezoid) ノード宛 → external、その他 → forward。
 * ※ `terminal` は「意図された終端」でありテキストからは決定論的に導出できないため本 script は出さない。
 */
export function edgeKind(via, toNode, isBidiReverse) {
  if (toNode?.category === "external") return "external";
  const v = via ?? "";
  if (/閉じる|close/i.test(v)) return "close";
  if (/戻る|キャンセル|back|cancel/i.test(v)) return "back";
  return isBidiReverse ? "back" : "forward";
}

/**
 * raw エッジを方向付きエッジに展開する。`<-->` は「順方向 + 暗黙の戻り」として 2 本に展開。
 * @returns {{from, to, via?, kind}[]}
 */
export function buildDirectedEdges(parsed) {
  const out = [];
  for (const e of parsed.edges) {
    const toNode = parsed.nodes.get(e.to);
    const fromNode = parsed.nodes.get(e.from);
    if (e.op === "-->") {
      out.push({ from: e.from, to: e.to, via: e.label, kind: edgeKind(e.label, toNode, false) });
    } else {
      const [fwd, rev] = splitBidiLabel(e.label);
      out.push({ from: e.from, to: e.to, via: fwd, kind: edgeKind(fwd, toNode, false) });
      out.push({ from: e.to, to: e.from, via: rev, kind: edgeKind(rev, fromNode, true) });
    }
  }
  return out;
}

/**
 * 全ノードの entries[] / exits[] / is_entry_point を計算する。
 * @returns {Map<string, {entries: object[], exits: object[], is_entry_point: boolean}>}
 */
export function computeNav(parsed) {
  const directed = buildDirectedEdges(parsed);
  const nav = new Map();
  for (const id of parsed.nodes.keys()) nav.set(id, { entries: [], exits: [], is_entry_point: false });
  for (const d of directed) {
    nav.get(d.from).exits.push({ to: d.to, ...(d.via !== undefined && { via: d.via }), kind: d.kind });
    nav.get(d.to).entries.push({ from: d.from, ...(d.via !== undefined && { via: d.via }), kind: d.kind });
  }
  for (const [id, rec] of nav) {
    rec.is_entry_point = rec.entries.some((en) => parsed.nodes.get(en.from)?.category === "entry");
    void id;
  }
  return nav;
}

// ───────────────────────────── 00-screen-list.md parser ─────────────────────────────

const cleanCell = (s) => s.trim().replace(/^\*\*(.*)\*\*$/, "$1").replace(/^`(.*)`$/, "$1").trim();

/**
 * `遷移図ノードID` 列のヘッダ名 (reverse Step 06 E3 が付ける任意列。forward Step 14 は付けない)。
 * 検出は norm() 正規化一致 (全角・空白のゆれを吸収)。
 */
const NODE_ID_HEADER = "遷移図ノードID";

/** Mermaid ノード ID の文法。これに合わない値 (空欄 / `—` / 説明文) は「ID 無し」と同じ扱いにする。 */
const NODE_ID_PATTERN = /^[A-Za-z_]\w*$/;

/**
 * 「ID なし」を意図した記法 (空欄、またはダッシュ類 1 文字)。文法外だが**宣言の書き損じではない**ので
 * `invalid_node_id` warning の対象外にする (これを warning にすると未宣言行の分だけ雑音が出る)。
 */
const NODE_ID_ABSENT = /^[-‐‑‒–—―−ー]?$/;

/**
 * 00-screen-list.md から画面一覧テーブルを parse する。
 * **画面一覧テーブルと判定できる markdown table を文書順に全て**対象とし (判定条件は下記)、
 * 任意で `画面ID` / `遷移図ノードID` / `ヘッダー` / `ボトムメニュー` / 行番号 (`#` or `No`) 列を拾う
 * (kinto 系 = chrome 列あり / legacy = 画面ID のみ、の両形式に対応)。
 * 列構成はテーブルごとに独立に解決する。
 *
 * 全テーブルを読む理由: reverse 産 (Phase 0b) の screen-list は**機能カテゴリごとに
 * テーブルが分かれる** (「認証・アカウント」「アバター作成」…) ため、最初の 1 つで打ち切ると
 * 41 画面のうち 3 画面しか読めず、下流の突合 (matchScreens) が実質無効化される
 * (R3 形状正規化がほぼ全ノードをスタジアム化し、L5 の孤児検出が沈黙する)。
 * **正規化画面名 (or 画面ID) の重複行が無ければ挙動は不変** — 複数テーブル対応と下記 dedupe は
 * どちらも重複が無い入力では no-op になる (dedupe は単一テーブル内の重複でも発火するため、
 * 「1 テーブル構成だから不変」ではない)。この不変性は本 script のテストが固定する。
 *
 * **画面一覧テーブルの判定**: `画面名` 列 **かつ** 標識列 (行番号 `#` / `No` / `目的` で始まる列 /
 * `機能ID` で終わる列) のいずれか 1 つ以上を持つこと。標識 3 種は forward (`skills/14` の
 * 画面一覧テンプレート) と reverse (`skills/reverse/06` E3 テンプレート) の両方が規定する列で、
 * 画面一覧なら必ずいずれかを持つ。`画面名` 列だけを条件にすると「## 状態パターン」節のような
 * **別目的の表**まで画面一覧として読み、(a) 実在しない画面行を作って L5 に幽霊の孤児を出す
 * (b) `hasChrome` が全表 AND で崩れて chrome 連携が無効化される (どちらも本 script のテストで固定。
 * (b) の形の表は実プロジェクトの screen-list にも書かれていたのが動機)。
 * 判定に通らなかった `画面名` 表は `skipped_table` warning に積む (黙って捨てない)。
 * 通る表が 1 つも無ければ InputError = exit 2 で停止する (幽霊行を作って進むより手動判定に倒す)。
 *
 * **重複行 (再掲) の dedupe**: 同一性の鍵は `画面ID` と正規化画面名の **両方** — どちらか一方でも
 * 既出なら再掲とみなし初出優先で落とし、`duplicate_screen_row` warning を積む (黙って捨てない)。
 * 鍵を行ごとに切り替える (ID があれば ID / 無ければ名前) と、初出行だけが ID を持つ表構成で
 * 再掲行がすり抜け、同名 2 行が突合の両側一意を壊して実在画面をスタジアム降格させる。
 * 落とす行が `遷移図ノードID` を持ち初出行が持たない場合は **その宣言だけ初出行へ引き継ぐ**
 * (明示紐付けは他に運ぶ経路が無い。`画面ID` / `no` / chrome 列は初出行の値を保つ = 同一入力で
 *  `ref` が表の順序に依存して揺れないようにする。引き継げなかった宣言は warning に載せる)。
 * ただし **両方が異なる `画面ID` を明示している同名行は別画面として両方残し**
 * `screen_name_collision` warning を積む — norm() は括弧・空白を除去するため
 * 「入庫予約（カレンダー）」と「入庫予約カレンダー」のような意図的な区別名も同名になりうる。
 * ゆれ吸収は突合 (Pass 1) に必要なので正規化自体は変えず、人間に見せることで両立させる。
 * `hasChrome` は全テーブルが chrome 列を持つときのみ true (1 テーブル時は従来と同値)。
 *
 * `遷移図ノードID` 列は **`.mmd` ノードとの明示紐付け** (matchScreens の Pass 0)。ラベル語彙が
 * 揃わなくても突合できるようにする宣言的な紐付けで、推測を挟まない。文法に合わない値は無視し
 * (「ID 無し」= 従来のラベル一致に fallback)、**同じ node_id を複数行が持つ場合は初出優先**で
 * 2 件目以降を無視して `warnings` に `duplicate_node_id` を積む。文法外の**非空値**
 * (空欄・ダッシュ類 1 文字 = 「ID なし」記法を除く) も無視するが `invalid_node_id` を積む
 * (duplicate と対称 — 書き損じた宣言が無言で効かないのを防ぐ)。
 *
 * @returns {{ rows: object[], hasChrome: boolean, warnings: object[] }}
 *   row = { no, name, screen_id?, node_id?, chrome?, bottom_nav?, ref }
 * @throws {InputError} 画面一覧テーブル (`画面名` 列 + 標識列) が 1 つも見つからない場合
 */
export function parseScreenList(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  const keptById = new Map(); // 画面ID → 採用済み row
  const keptByName = new Map(); // 正規化画面名 → 採用済み row (初出のみ)
  const seenNodeIds = new Map(); // node_id → 初出行の ref (duplicate_node_id warning 用)
  const warnings = [];
  let tables = 0;
  let hasChrome = true;

  /**
   * node_id を初出優先で確保する。既に他の行が使っていれば warning を積んで false を返す
   * (呼び出し側はラベル一致 [Pass 1/2] に fallback させる)。
   */
  const claimNodeId = (candidate, ownerRef) => {
    const first = seenNodeIds.get(candidate);
    if (first !== undefined) {
      warnings.push({ type: "duplicate_node_id", node_id: candidate, kept: first, ignored: ownerRef });
      return false;
    }
    seenNodeIds.set(candidate, ownerRef);
    return true;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const header = line.split("|").slice(1, -1).map(cleanCell);
    const nameIdx = header.indexOf("画面名");
    if (nameIdx === -1) continue;
    // separator 行 (|---|---|) を確認
    const sep = (lines[i + 1] ?? "").trim();
    if (!/^\|[\s|:-]+\|$/.test(sep)) continue;

    const idIdx = header.indexOf("画面ID");
    const nodeIdIdx = header.findIndex((h) => norm(h) === norm(NODE_ID_HEADER));
    const chromeIdx = header.indexOf("ヘッダー");
    const bottomIdx = header.indexOf("ボトムメニュー");
    const noIdx = header.findIndex((h) => h === "#" || /^no\.?$/i.test(h));
    // 画面一覧テーブルの判定 (標識列。判定理由は本関数の doc comment)。`画面名` 列を持つだけの
    // 別目的の表 (「## 状態パターン」等) はここで除外し、除外したことを warning に残す。
    // 標識の照合は norm() 経由 (NFKC で全角 `＃` / `ＩＤ` や空白入り表記のゆれを吸収する。
    // 生比較にすると全角 `＃` 列だけを持つ正当な画面一覧が InputError で落ちる)
    const hasMarker = header.some((h) => {
      const n = norm(h);
      return n === "#" || /^no\.?$/.test(n) || /^目的/.test(n) || /機能id$/.test(n);
    });
    if (!hasMarker) {
      warnings.push({ type: "skipped_table", line: i + 1, headers: header.join(" | ") });
      continue;
    }
    tables += 1;
    if (!(chromeIdx !== -1 && bottomIdx !== -1)) hasChrome = false;

    let j = i + 2;
    for (; j < lines.length; j++) {
      const rowLine = lines[j].trim();
      if (!rowLine.startsWith("|")) break;
      const cells = rowLine.split("|").slice(1, -1).map(cleanCell);
      const name = cells[nameIdx] ?? "";
      if (!name) continue;
      const screenId = idIdx !== -1 && cells[idIdx] ? cells[idIdx] : undefined;
      // 行番号 fallback の連番はテーブルをまたいで連続させる
      const no = noIdx !== -1 && cells[noIdx] ? cells[noIdx] : String(rows.length + 1).padStart(2, "0");
      const chromeRaw = chromeIdx !== -1 ? cells[chromeIdx] : undefined;
      const chrome = ["A", "B", "なし"].includes(chromeRaw) ? chromeRaw : undefined;
      const bottomRaw = bottomIdx !== -1 ? cells[bottomIdx] : undefined;
      const bottomNav = bottomRaw === "有" ? true : bottomRaw === "無" ? false : undefined;
      // schemas/screen-nav.schema.json screen_ref: 論理 screen 名 (例 '02-detail')。
      // 画面ID 列があればそれ、無ければ `{行番号}-{画面名}` で決定論的に組み立てる。
      const ref = screenId ?? `${no}-${name}`;
      // 遷移図ノードID (任意列): 文法に合う値のみ採用する。**構文検査は dedupe より前に行う** —
      // 落とす行の書き損じも黙殺しないため (再掲行の宣言が無言で消えると Pass 0 が沈黙した理由が追えない)。
      const nodeIdRaw = nodeIdIdx !== -1 ? cells[nodeIdIdx] : undefined;
      let nodeId = nodeIdRaw !== undefined && NODE_ID_PATTERN.test(nodeIdRaw) ? nodeIdRaw : undefined;
      if (nodeId === undefined && nodeIdRaw !== undefined && !NODE_ID_ABSENT.test(nodeIdRaw)) {
        // 文法外の非空値 (例: `AV-LIST` / `HOME (タブ 1)` / `1VIDEO`) は無視するが黙殺しない —
        // 「宣言したのに効いていない」ことが人間に見えないと、Pass 0 が沈黙した理由が追えない
        // (duplicate_node_id と対称に warning を積む)。
        warnings.push({ type: "invalid_node_id", value: nodeIdRaw, ref });
      }

      // 初出優先 dedupe。鍵は「画面ID」と「正規化画面名」の両方 (どちらか一方でも既出なら再掲扱い)。
      const prev = (screenId !== undefined ? keptById.get(screenId) : undefined) ?? keptByName.get(norm(name));
      if (prev !== undefined) {
        // 両方が **異なる画面ID** を明示している同名行は別画面 — 落とさず両方残して人間に見せる
        const distinctIds =
          screenId !== undefined && prev.screen_id !== undefined && prev.screen_id !== screenId;
        if (!distinctIds) {
          // 再掲行: 落とすが、初出行が持たない `遷移図ノードID` の宣言だけは引き継ぐ
          const merged = nodeId !== undefined && prev.node_id === undefined && claimNodeId(nodeId, prev.ref);
          if (merged) prev.node_id = nodeId;
          warnings.push({
            type: "duplicate_screen_row",
            name,
            kept: prev.ref,
            dropped: ref,
            ...(merged && { merged_node_id: nodeId }),
            ...(nodeId !== undefined && !merged && { ignored_node_id: nodeId }),
          });
          continue;
        }
        warnings.push({ type: "screen_name_collision", name, kept: prev.ref, also: ref });
      }
      if (nodeId !== undefined && !claimNodeId(nodeId, ref)) {
        nodeId = undefined; // ラベル一致 (Pass 1/2) に fallback させる
      }
      const row = {
        no,
        name,
        ...(screenId && { screen_id: screenId }),
        ...(nodeId && { node_id: nodeId }),
        ...(chrome && { chrome }),
        ...(bottomNav !== undefined && { bottom_nav: bottomNav }),
        ref,
      };
      rows.push(row);
      if (screenId !== undefined) keptById.set(screenId, row);
      if (!keptByName.has(norm(name))) keptByName.set(norm(name), row);
    }
    i = j - 1; // 表の終端行から走査を続ける (次の表を取りこぼさない)
  }

  if (tables === 0) {
    const skipped = warnings.filter((w) => w.type === "skipped_table");
    throw new InputError(
      "00-screen-list.md: 画面一覧テーブル (`画面名` 列 + 標識列 [# / No / 目的… / …機能ID]) が見つからない" +
        (skipped.length > 0
          ? ` (標識列を持たない \`画面名\` 表 ${skipped.length} 件は除外済み: ${skipped.map((w) => w.headers).join(" / ")})`
          : ""),
    );
  }
  return { rows, hasChrome, warnings };
}

// ───────────────────────────── screen-list ↔ .mmd ノード突合 ─────────────────────────────

// 表記ゆれ正規化: NFKC (全角英数/括弧の統一) + 空白・括弧の除去 + 小文字化。
// 実 PJ で観測されたゆれ: 「UG 商品詳細」↔「UG商品詳細」(空白) / 「入庫予約（カレンダー）」↔
// 「入庫予約カレンダー」(括弧) をここで吸収する。
// (export = derive-transition-map.mjs の R5 同名マージが同じ正規化を共有するため。
//  突合の判定器を 1 本に保つのが目的で、本 script 内の挙動は変わらない)
export const norm = (s) => s.normalize("NFKC").replace(/[\s()（）]/g, "").toLowerCase();

/**
 * 「両側で一意なペアのみ採用」の bipartite マッチングを固定点まで回す。
 * 曖昧 (一方が複数候補を持つ) なペアは採用しない = 過検出側に倒す (docs §4-5-3 の方針)。
 */
function acceptUniquePairs(nodesLeft, rowsLeft, predicate, assign) {
  let progressed = true;
  while (progressed) {
    progressed = false;
    const pairs = [];
    for (const n of nodesLeft) for (const r of rowsLeft) if (predicate(n, r)) pairs.push([n, r]);
    const nodeCount = new Map();
    const rowCount = new Map();
    for (const [n, r] of pairs) {
      nodeCount.set(n, (nodeCount.get(n) ?? 0) + 1);
      rowCount.set(r, (rowCount.get(r) ?? 0) + 1);
    }
    for (const [n, r] of pairs) {
      if (nodeCount.get(n) === 1 && rowCount.get(r) === 1) {
        assign(n, r);
        nodesLeft.delete(n);
        rowsLeft.delete(r);
        progressed = true;
      }
    }
  }
}

/**
 * screen 形状ノード (rect / implicit) を screen-list の行に突合する。
 * Pass 0: `遷移図ノードID` 列による明示紐付け (`.mmd` ノード ID の完全一致。候補は diamond 以外の全ノード)。
 * Pass 1: 正規化完全一致 (画面名 or 画面ID)。Pass 2: 未マッチ同士の一意な包含関係
 * (例: node「スコア推移」⊂ list「運転診断スコア推移」)。いずれも両側一意のペアのみ採用。
 *
 * **Pass 0 をラベル一致より先に置く理由**: リバース産の `.mmd` はノードラベルがフロー文書の語彙
 * (「撮影ガイド」) で、画面一覧の画面名 (「アバター映像の作成 (撮影ガイド)」) と literal 一致しない。
 * 生成時に宣言された ID があればラベルに依らず突合できる (fuzzy 化して誤マッチを持ち込まない)。
 * ID 列が無い screen-list では Pass 0 が空振りし、従来どおり Pass 1/2 だけで判定する。
 *
 * **Pass 0 で束縛した非 screen ノードは screen へ昇格する** (`node_id_bound_to_non_screen` warning)。
 * 昇格しないと、その行は消費済みなので `unmatchedRows` にも現れず、当該画面が nav 出力と
 * L5 Rule 3〜5 の**両方から無言で外れる** = 「欠陥 0 件」ではなく「検査を受けていない」状態になる。
 * 例外は `entry` (アプリ起動 疑似ノード) — 昇格させると `is_entry_point` の判定元が消え、
 * 起点から伸びる画面が「到達不能」と誤検出されるため warning のみに留める。
 * 文法は合法だが `.mmd` に存在しない node_id は `unknown_node_id` warning
 * (宣言が無言でラベル一致に fallback するのを防ぐ = invalid / duplicate と対称)。
 * 昇格は `parsed.nodes` の `category` を**破壊的に書き換える** — 下流 (deriveNav / computeNav /
 * validate-connectivity の Rule 3〜5) が同じ `parsed` を見るので、書き換えないと昇格が伝わらない。
 * そのため**同じ `parsed` を 2 回通すと 2 回目は昇格済みで warning が出ない**。実運用では nav 派生と
 * L5 検査が別プロセスで 1 回ずつ通すだけなので問題にならないが、同一プロセスで両方呼ぶ場合は
 * 1 回目の `warnings` を保持すること。
 * @returns {{ nodeToRow: Map<string, object>, warnings: object[], unmatchedNodes: object[], unmatchedRows: object[] }}
 */
export function matchScreens(parsed, rows) {
  const nodeToRow = new Map();
  const warnings = [];
  const allNodes = [...parsed.nodes.values()];
  const rowsLeft = new Set(rows);
  const assign = (n, r) => nodeToRow.set(n.id, r);

  // Pass 0: 遷移図ノードID の完全一致 (宣言的紐付け。列が無ければ候補ゼロで no-op)。
  // 候補は **diamond 以外の全ノード** (stadium 含む) — 明示 ID 宣言は glyph より強い
  // (「画面かどうかの権限は screen-list にある」= R3 の原則。旧 `.mmd` で既にスタジアム化された
  // ノードにも ID で届く)。diamond は分岐 glyph であり画面ではないので候補外。
  const boundNonScreens = [];
  acceptUniquePairs(
    new Set(allNodes.filter((n) => n.shape !== "diamond")),
    rowsLeft,
    (n, r) => r.node_id !== undefined && n.id === r.node_id,
    (n, r) => {
      assign(n, r);
      if (n.category !== "screen") boundNonScreens.push([n, r]);
    },
  );
  for (const [n, r] of boundNonScreens) {
    const promoted = n.category !== "entry";
    warnings.push({
      type: "node_id_bound_to_non_screen",
      node_id: n.id,
      category: n.category,
      ref: r.ref,
      promoted,
    });
    if (promoted) n.category = "screen";
  }
  for (const r of rows) {
    if (r.node_id !== undefined && !parsed.nodes.has(r.node_id)) {
      warnings.push({ type: "unknown_node_id", node_id: r.node_id, ref: r.ref });
    }
  }
  // screen ノード集合は **昇格後に**確定させる (昇格分を nav / L5 の検査対象に含める)
  const screenNodes = allNodes.filter((n) => n.category === "screen");
  // Pass 1 / Pass 2 は従来どおり screen 形状ノードのみ (Pass 0 で確定した分を除く)
  const nodesLeft = new Set(screenNodes.filter((n) => !nodeToRow.has(n.id)));
  // Pass 1: 完全一致
  acceptUniquePairs(
    nodesLeft,
    rowsLeft,
    (n, r) => norm(n.label) === norm(r.name) || (r.screen_id !== undefined && norm(n.label) === norm(r.screen_id)),
    assign,
  );
  // Pass 2: 包含 (最短 2 文字以上、両側一意のみ)
  acceptUniquePairs(
    nodesLeft,
    rowsLeft,
    (n, r) => {
      const a = norm(n.label);
      const b = norm(r.name);
      return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
    },
    assign,
  );
  return {
    nodeToRow,
    warnings,
    unmatchedNodes: screenNodes.filter((n) => !nodeToRow.has(n.id)),
    unmatchedRows: rows.filter((r) => ![...nodeToRow.values()].includes(r)),
  };
}

// ───────────────────────────── 00-screen-nav.json 導出 ─────────────────────────────

/**
 * schemas/screen-nav.schema.json 準拠の派生ビューを組み立てる。
 * - トップレベル key は screen 形状ノードのみ (modal/external/entry 疑似ノードは端点にのみ現れる)
 * - `is_terminal` は「出口を持たないことが意図された画面」だが意図はテキストから導出できないため
 *   常に false (過検出側)。真の終端は chrome 暗黙戻りで defect 化しないか、user_accepted_gaps で握る。
 */
export function deriveNav(parsed, rows, { appName, generatedAt }) {
  const match = matchScreens(parsed, rows);
  const nav = computeNav(parsed);
  const screens = {};
  for (const n of parsed.nodes.values()) {
    if (n.category !== "screen") continue;
    const row = match.nodeToRow.get(n.id);
    const rec = nav.get(n.id);
    screens[n.id] = {
      ...(row && { screen_ref: row.ref }),
      is_entry_point: rec.is_entry_point,
      is_terminal: false,
      ...(row?.chrome && { chrome: row.chrome }),
      entries: rec.entries,
      exits: rec.exits,
    };
  }
  return {
    doc: {
      app_name: appName,
      derived_from: "screens/00-transition-map.mmd",
      generated_at: generatedAt,
      screens,
    },
    match,
  };
}

// ───────────────────────────── 入力ロード (validate-connectivity と共用) ─────────────────────────────

export function loadAppInputs(appRoot) {
  const mmdPath = join(appRoot, "screens", "00-transition-map.mmd");
  const listPath = join(appRoot, "screens", "00-screen-list.md");
  if (!existsSync(mmdPath)) throw new InputError(`not found: ${mmdPath}`);
  if (!existsSync(listPath)) throw new InputError(`not found: ${listPath}`);
  const parsed = parseTransitionMap(readFileSync(mmdPath, "utf8"));
  const { rows, hasChrome, warnings } = parseScreenList(readFileSync(listPath, "utf8"));
  return { parsed, rows, hasChrome, screenListWarnings: warnings, mmdPath, listPath };
}

// ───────────────────────────── CLI ─────────────────────────────

function usage() {
  console.error("usage: node scripts/derive-screen-nav.mjs <artifacts/{app_name}> [--out <path>]");
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  let appRoot;
  let outOverride;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outOverride = args[++i];
    else if (!appRoot) appRoot = args[i];
    else usage();
  }
  if (!appRoot) usage();
  if (args.includes("--out") && outOverride === undefined) usage();

  try {
    const { parsed, rows, screenListWarnings } = loadAppInputs(appRoot);
    const appName = basename(resolve(appRoot));
    const { doc, match } = deriveNav(parsed, rows, {
      appName,
      generatedAt: new Date().toISOString(),
    });
    const outPath = outOverride ?? join(appRoot, "screens", "00-screen-nav.json");
    writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
    process.stdout.write(
      JSON.stringify(
        {
          mode: "derive",
          out: outPath,
          screen_nodes: Object.keys(doc.screens).length,
          matched: match.nodeToRow.size,
          unmatched_nodes: match.unmatchedNodes.map((n) => `${n.id}[${n.label}]`),
          unmatched_list_rows: match.unmatchedRows.map((r) => r.ref),
          // 画面一覧側の警告 (遷移図ノードID の重複 / 除外した表 / 再掲行の dedupe 等)。
          // 突合側の警告 (非 screen ノードへの束縛 / .mmd に無い node_id) も同じ扱いで見せる。
          // いずれも無ければ key ごと省略する (出力形を変えない)
          ...(screenListWarnings.length > 0 && { screen_list_warnings: screenListWarnings }),
          ...(match.warnings.length > 0 && { match_warnings: match.warnings }),
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(0);
  } catch (e) {
    if (e instanceof MmdParseError || e instanceof InputError) {
      // strict parse 失敗 / 入力不在 → exit 2 (呼び出し元 skill は LLM 手動判定へ fallback)
      console.error(`[derive-screen-nav] ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}

// テストから import されたときは main() を走らせない (wcag-contrast.mjs と同じ guard)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
