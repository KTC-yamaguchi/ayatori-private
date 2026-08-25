#!/usr/bin/env node
// scripts/validate-connectivity.mjs
//
// L5 connectivity (各画面の入口/出口 = 到達性・戻り先存在) の決定論 validator。
// 従来 Step 14 (最大 2 回転) / Step 19 再評価 / Step 29 delta で LLM が毎 run 手作業で
// 行っていた 5 ルール検査 (純粋なグラフ検査) を script 化する。
//
// 仕様正典:
//   - 検出 5 ルール:   docs/screen-coverage-check.md §4-5-4
//   - chrome 連携:     docs/screen-coverage-check.md §4-5-3 (誤検知回避)
//   - 出力 schema:     schemas/coverage-check.schema.json ($defs/connectivity_result)
//   - .mmd parse / 突合は scripts/derive-screen-nav.mjs と単一ソース共有
//
// 検査は SoT (.mmd) × 00-screen-list.md を直接突合する (00-screen-nav.json は経由しない —
// nav.json は同じ導出関数から出る派生ビューであり、validator 入力として二重管理しない)。
//
// chrome 列が無い legacy / ファストパス screen-list では §4-5-3 の chrome 連携を skip し、
// 明示エッジのみで検証する (過検出側に倒す。docs §4-5-3 注記どおり)。
//
// exit code 契約 (lint-screen-colors.mjs と同型):
//   0 = defect なし
//   1 = defect あり (stdout JSON に defects[] を列挙)
//   2 = 運用エラー (入力不在 / strict parse 失敗 / --write 先の coverage-check 不在・不正
//       → 呼び出し元 skill は従来の LLM 手動判定へ fallback)
//
// 使い方:
//   node scripts/validate-connectivity.mjs <artifacts/{app_name}>           # stdout JSON のみ
//   node scripts/validate-connectivity.mjs <artifacts/{app_name}> --write   # 00-coverage-check.json の
//       # layers.l5_connectivity.defects[] + summary.connectivity_defects を patch (他 key は保全)
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MmdParseError,
  InputError,
  matchScreens,
  computeNav,
  loadAppInputs,
} from "./derive-screen-nav.mjs";

// ───────────────────────────── 5 ルール検査 (docs §4-5-4) ─────────────────────────────

/**
 * @param {{nodes: Map, edges: object[]}} parsed  parseTransitionMap の結果
 * @param {object[]} rows                          parseScreenList の rows
 * @returns {{screen, defect_kind, detail, fix_hint}[]}  ルール番号順 (1→5)、各ルール内は宣言順
 */
export function validateConnectivity(parsed, rows) {
  const match = matchScreens(parsed, rows);
  const nav = computeNav(parsed);
  const defects = [];

  // §4-5-3 chrome 連携 (誤検知回避):
  //   tabParent  = chrome=A ∧ ボトムメニュー=有 → ボトムナビ経由で「到達できる」「戻れる」を共に充足
  //   implicitBack = chrome=B ∧ inbound forward ≥1 → 親への暗黙 back で「戻れる」を充足
  const rowOf = (id) => match.nodeToRow.get(id);
  const isTabParent = (row) => row?.chrome === "A" && row?.bottom_nav === true;
  const inboundForward = (id) => nav.get(id).entries.filter((en) => en.kind === "forward").length;

  // Rule 1: dangling_edge — エッジが screen-list に無いノードを指す (modal/external/entry 疑似ノードは除外)
  const danglingRefs = new Map(); // nodeId → 参照エッジ数
  for (const e of parsed.edges) {
    for (const id of [e.from, e.to]) {
      const n = parsed.nodes.get(id);
      if (n.category === "screen" && !match.nodeToRow.has(id)) {
        danglingRefs.set(id, (danglingRefs.get(id) ?? 0) + 1);
      }
    }
  }
  for (const [id, count] of danglingRefs) {
    const n = parsed.nodes.get(id);
    defects.push({
      screen: id,
      defect_kind: "dangling_edge",
      detail: `.mmd のエッジ ${count} 本がノード '${id}[${n.label}]' を参照しているが、00-screen-list.md に未記載または表記ゆれ・曖昧 (候補複数) で突合できない (リンク切れ)`,
      fix_hint: "mmd_edge",
    });
  }

  // Rule 2: orphan_in_list — screen-list の画面が .mmd にノードとして存在しない (未配線)
  for (const row of match.unmatchedRows) {
    defects.push({
      screen: row.ref,
      defect_kind: "orphan_in_list",
      detail: `00-screen-list.md の画面「${row.name}」に対応するノードが .mmd に無く、どの画面からも到達できない (未配線)`,
      fix_hint: "wire_new_screen",
    });
  }

  // Rule 3〜5 は screen-list と突合できた screen ノードに対して検査する
  for (const n of parsed.nodes.values()) {
    if (n.category !== "screen" || !match.nodeToRow.has(n.id)) continue;
    const row = rowOf(n.id);
    const rec = nav.get(n.id);

    // Rule 3: unreachable — inbound 0 ∧ タブ親でない ∧ is_entry_point でない
    if (rec.entries.length === 0 && !isTabParent(row) && !rec.is_entry_point) {
      defects.push({
        screen: row.ref,
        defect_kind: "unreachable",
        detail: `画面「${row.name}」('${n.id}') への inbound エッジが .mmd に無く、到達できない`,
        fix_hint: "mmd_edge",
      });
    }

    // Rule 4: dead_end — outbound/戻り 0 (chrome 暗黙戻り適用後) ∧ is_terminal でない
    // (is_terminal は決定論導出不能のため常に false 扱い = derive-screen-nav.mjs と同じ方針)
    if (rec.exits.length === 0 && !isTabParent(row) && !(row?.chrome === "B" && inboundForward(n.id) >= 1)) {
      defects.push({
        screen: row.ref,
        defect_kind: "dead_end",
        detail: `画面「${row.name}」('${n.id}') に outbound/戻りエッジが無く、chrome 暗黙戻りも適用できない (戻れない画面)`,
        fix_hint: "mmd_edge",
      });
    }

    // Rule 5: back_target_missing — chrome=B 子画面なのに親が特定できない (inbound forward edge 0)
    if (row?.chrome === "B" && inboundForward(n.id) === 0) {
      defects.push({
        screen: row.ref,
        defect_kind: "back_target_missing",
        detail: `画面「${row.name}」('${n.id}') は chrome=B 子画面だが inbound forward エッジが 0 本で、戻り先の親を特定できない`,
        fix_hint: "mmd_edge",
      });
    }
  }

  // ルール番号順に安定ソート (Rule 1→5。同 rule 内は挿入順 = 宣言順を保持)
  const order = { dangling_edge: 1, orphan_in_list: 2, unreachable: 3, dead_end: 4, back_target_missing: 5 };
  defects.sort((a, b) => order[a.defect_kind] - order[b.defect_kind]);
  return defects;
}

// ───────────────────────────── coverage-check patch ─────────────────────────────

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 00-coverage-check.json の所有 key (layers.l5_connectivity / summary.connectivity_defects) のみを
 * patch する。L1〜L4 / user_accepted_gaps 等の他 key は保全 (split ownership、docs/artifact-file-responsibility.md 設計原則 3 単一所有権)。
 * @throws {InputError} ファイル不在 / JSON 破損 / 必須構造 (coverage_check.layers / summary) 欠落・型不正
 */
export function patchCoverageCheck(ccPath, defects) {
  if (!existsSync(ccPath)) {
    throw new InputError(`not found: ${ccPath} (Step 14 の L1〜L4 チェックを先に実行して生成すること)`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(ccPath, "utf8"));
  } catch (e) {
    // JSON 破損も運用エラー (exit 2) に畳む — 素通しすると uncaught で exit 1 になり
    // 「defect あり」と誤読される (exit code 契約の維持)
    throw new InputError(`${ccPath}: JSON として parse できない (${e.message})`);
  }
  const cc = doc?.coverage_check;
  if (!isPlainObject(cc) || !isPlainObject(cc.layers) || !isPlainObject(cc.summary)) {
    throw new InputError(`${ccPath}: coverage_check.layers / summary が無いか型不正 (schemas/coverage-check.schema.json 不適合)`);
  }
  cc.layers.l5_connectivity = { defects };
  cc.summary.connectivity_defects = defects.length;
  writeFileSync(ccPath, JSON.stringify(doc, null, 2) + "\n");
}

// ───────────────────────────── CLI ─────────────────────────────

function usage() {
  console.error("usage: node scripts/validate-connectivity.mjs <artifacts/{app_name}> [--write]");
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  let appRoot;
  let write = false;
  for (const a of args) {
    if (a === "--write") write = true;
    else if (!appRoot) appRoot = a;
    else usage();
  }
  if (!appRoot) usage();

  try {
    const { parsed, rows, hasChrome, screenListWarnings } = loadAppInputs(appRoot);
    const defects = validateConnectivity(parsed, rows);
    const result = {
      mode: "validate",
      app_name: basename(resolve(appRoot)),
      chrome_aware: hasChrome, // false = legacy screen-list (chrome 連携 skip、過検出側)
      connectivity_defects: defects.length,
      defects,
      // 画面一覧側の警告 (遷移図ノードID の重複 / 除外した表 / 再掲行の dedupe)。derive-screen-nav が
      // exit 2 で先に落ちた run でも本 CLI の出力からは見えるようにする (無ければ key ごと省略)。
      ...(screenListWarnings.length > 0 && { screen_list_warnings: screenListWarnings }),
    };
    if (write) {
      const ccPath = join(appRoot, "screens", "00-coverage-check.json");
      patchCoverageCheck(ccPath, defects);
      result.written = ccPath;
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(defects.length > 0 ? 1 : 0);
  } catch (e) {
    if (e instanceof MmdParseError || e instanceof InputError) {
      console.error(`[validate-connectivity] ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
