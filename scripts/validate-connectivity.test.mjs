// scripts/validate-connectivity.test.mjs
//
// scripts/validate-connectivity.mjs の単体テスト。Node 標準の node:test + node:assert のみ (依存ゼロ)。
//   実行: node --test scripts/validate-connectivity.test.mjs
//
// テスト方針:
//   - docs/screen-coverage-check.md §4-5-4 の 5 ルールをそれぞれ最小 fixture で発火させる。
//   - §4-5-3 chrome 連携 (タブ親 / 暗黙 back) による誤検知回避と、chrome 列なし legacy での
//     「過検出側に倒す」挙動を対で断言する。
//   - --write の patch (所有 key のみ書き換え・他 key 保全) と exit code 契約 (0/1/2) は
//     spawnSync で実プロセスを起動して検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTransitionMap, parseScreenList } from "./derive-screen-nav.mjs";
import { validateConnectivity, patchCoverageCheck } from "./validate-connectivity.mjs";
import { InputError } from "./derive-screen-nav.mjs";

// ── helpers ─────────────────────────────────────────────

const validate = (mmd, list) => validateConnectivity(parseTransitionMap(mmd), parseScreenList(list).rows);
const kinds = (defects) => defects.map((d) => d.defect_kind);

const chromeList = (rowLines) => `| # | 画面名 | ヘッダー | ボトムメニュー |
|---|---|---|---|
${rowLines.join("\n")}
`;

// 健全な最小構成: entry → ログイン → ホーム(タブ親) ↔ 詳細(B 子)
const MMD_OK = `flowchart TD
  start([アプリ起動])
  scrLogin[ログイン]
  scrHome[ホーム]
  scrDetail[詳細]
  start --> scrLogin
  scrLogin -->|認証成功| scrHome
  scrHome <-->|"詳細 / 戻る"| scrDetail
  style start fill:#D1FAE5,stroke:#10B981
`;
const LIST_OK = chromeList(["| 01 | ログイン | なし | 無 |", "| 02 | ホーム | A | 有 |", "| 03 | 詳細 | B | 無 |"]);

// ── 健全系: defect 0 ────────────────────────────────────

test("健全な .mmd × screen-list は defect 0", () => {
  assert.deepEqual(validate(MMD_OK, LIST_OK), []);
});

// ── Rule 1: dangling_edge ───────────────────────────────

test("Rule 1: エッジが screen-list に無いノードを指すと dangling_edge (宣言済/未宣言とも)", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  scrExtra[別名画面]
  start --> scrHome
  scrHome --> scrExtra
  scrHome --> scrGhost
  style start fill:#D1FAE5
`;
  const defects = validate(mmd, chromeList(["| 01 | ホーム | A | 有 |"]));
  const dangling = defects.filter((d) => d.defect_kind === "dangling_edge");
  assert.deepEqual(dangling.map((d) => d.screen).sort(), ["scrExtra", "scrGhost"]);
  for (const d of dangling) assert.equal(d.fix_hint, "mmd_edge");
});

test("Rule 1 除外: modal/external/entry 疑似ノードは screen-list に無くても dangling にしない", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  mdlX([確認])
  extY[\\外部\\]
  start --> scrHome
  scrHome --> mdlX
  mdlX -->|閉じる| scrHome
  scrHome --> extY
  style start fill:#D1FAE5
  style mdlX fill:#FEF3C7
`;
  assert.deepEqual(validate(mmd, chromeList(["| 01 | ホーム | A | 有 |"])), []);
});

// ── Rule 2: orphan_in_list ──────────────────────────────

test("Rule 2: screen-list の画面が .mmd に無いと orphan_in_list (fix_hint=wire_new_screen)", () => {
  const defects = validate(
    MMD_OK,
    chromeList(["| 01 | ログイン | なし | 無 |", "| 02 | ホーム | A | 有 |", "| 03 | 詳細 | B | 無 |", "| 04 | 通知一覧 | B | 無 |"]),
  );
  assert.deepEqual(kinds(defects), ["orphan_in_list"]);
  assert.equal(defects[0].screen, "04-通知一覧");
  assert.equal(defects[0].fix_hint, "wire_new_screen");
});

// ── Rule 3: unreachable (+ タブ親除外) ──────────────────

test("Rule 3: inbound 0 は unreachable。ただしタブ親 (A∧有) と is_entry_point は除外", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  scrTab[サブスク]
  scrIsolated[孤立画面]
  start --> scrHome
  scrIsolated -->|遷移| scrHome
  style start fill:#D1FAE5
`;
  // scrTab: inbound 0 だが A∧有 → 除外 / scrIsolated: inbound 0 で chrome=B → unreachable
  // (scrIsolated は outbound を持つので dead_end にはならない; B∧inbound forward 0 で Rule 5 も発火)
  const defects = validate(
    mmd,
    chromeList(["| 01 | ホーム | A | 有 |", "| 02 | サブスク | A | 有 |", "| 03 | 孤立画面 | B | 無 |"]),
  );
  assert.deepEqual(kinds(defects), ["unreachable", "back_target_missing"]);
  assert.equal(defects[0].screen, "03-孤立画面");
});

// ── Rule 4: dead_end (+ 暗黙 back / タブ親除外) ─────────

test("Rule 4: outbound 0 ∧ 暗黙戻りなしは dead_end。B∧inbound forward は暗黙 back で除外", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  scrChild[完了画面]
  scrModalOnly[案内画面]
  mdlX([確認])
  start --> scrHome
  scrHome -->|完了へ| scrChild
  scrHome --> mdlX
  mdlX -->|閉じる| scrModalOnly
  style start fill:#D1FAE5
  style mdlX fill:#FEF3C7
`;
  // scrChild: outbound 0 だが B∧inbound forward 1 → 暗黙 back で除外
  // scrModalOnly: outbound 0、inbound は close のみ (forward 0) → dead_end (+ Rule 5)
  const defects = validate(
    mmd,
    chromeList(["| 01 | ホーム | A | 有 |", "| 02 | 完了画面 | B | 無 |", "| 03 | 案内画面 | B | 無 |"]),
  );
  assert.deepEqual(kinds(defects), ["dead_end", "back_target_missing"]);
  assert.equal(defects[0].screen, "03-案内画面");
  assert.equal(defects[0].fix_hint, "mmd_edge");
});

test("Rule 4: 明示の戻りエッジ or external 宛 outbound があれば dead_end ではない", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  scrModal[全画面モーダル]
  extX[\\外部サイト\\]
  start --> scrHome
  scrHome -->|開く| scrModal
  scrModal -->|閉じる| scrHome
  scrHome --> extX
  style start fill:#D1FAE5
`;
  // scrModal は chrome=なし (暗黙戻りなし) だが明示 close エッジで充足
  assert.deepEqual(validate(mmd, chromeList(["| 01 | ホーム | A | 有 |", "| 02 | 全画面モーダル | なし | 無 |"])), []);
});

// ── Rule 5: back_target_missing ─────────────────────────

test("Rule 5: chrome=B なのに inbound forward 0 なら back_target_missing", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  scrChild[詳細]
  start --> scrHome
  scrChild -->|戻る| scrHome
  style start fill:#D1FAE5
`;
  // scrChild: inbound 0 (unreachable) かつ B∧forward 0 (back_target_missing) — 両方起票 (過検出側)
  const defects = validate(mmd, chromeList(["| 01 | ホーム | A | 有 |", "| 02 | 詳細 | B | 無 |"]));
  assert.deepEqual(kinds(defects), ["unreachable", "back_target_missing"]);
});

// ── legacy (chrome 列なし): 連携 skip = 過検出側 ────────

test("legacy screen-list: chrome 連携を skip し明示エッジのみで検証 (過検出側)、Rule 5 は発火しない", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  scrTab[マイページ]
  start --> scrHome
  scrHome -->|開く| scrTab
  style start fill:#D1FAE5
`;
  const legacy = `| No | 画面ID | 画面名 |
|---|---|---|
| 1 | \`01-home\` | ホーム |
| 2 | \`02-mypage\` | マイページ |
`;
  // chrome 不明 → scrTab はタブ親除外も暗黙 back もなし → dead_end に倒れる (BottomNav 相互到達を
  // .mmd に明示するか chrome 列を持つ screen-list に移行するのが修正先)
  const defects = validate(mmd, legacy);
  assert.deepEqual(kinds(defects), ["dead_end"]);
  assert.equal(defects[0].screen, "02-mypage");
});

// ── defect の並び (Rule 1→5) ────────────────────────────

test("defects はルール番号順 (dangling → orphan → unreachable → dead_end → back_target_missing)", () => {
  const mmd = `flowchart TD
  start([起動])
  scrHome[ホーム]
  scrChild[詳細]
  start --> scrHome
  scrHome --> scrGhost
  scrChild -->|戻る| scrHome
  style start fill:#D1FAE5
`;
  const defects = validate(
    mmd,
    chromeList(["| 01 | ホーム | A | 有 |", "| 02 | 詳細 | B | 無 |", "| 03 | 未配線 | B | 無 |"]),
  );
  assert.deepEqual(kinds(defects), ["dangling_edge", "orphan_in_list", "unreachable", "back_target_missing"]);
});

// ── patchCoverageCheck: 所有 key のみ patch ─────────────

const CC_BASE = {
  coverage_check: {
    checked_at: "2026-07-06T00:00:00Z",
    scope: "screen_list",
    layers: {
      l1_ui_states: { missing: [{ screen: "ホーム", state: "Empty", classification: "個別画面化", reason: "構造変化" }] },
      l2_action_result: { missing: [] },
      l3_flow_end: { missing: [] },
      l4_content_replace: { missing: [] },
    },
    summary: { total_missing: 1, by_classification: { 個別画面化: 1, テンプレート代表1枚: 0, DS吸収: 0 } },
    user_accepted_gaps: true,
  },
};

test("patchCoverageCheck: l5_connectivity と connectivity_defects のみ書き、他 key は保全", () => {
  const dir = mkdtempSync(join(tmpdir(), "validate-conn-cc-"));
  const ccPath = join(dir, "00-coverage-check.json");
  writeFileSync(ccPath, JSON.stringify(CC_BASE, null, 2));
  const defects = [{ screen: "02-詳細", defect_kind: "unreachable", detail: "x", fix_hint: "mmd_edge" }];
  patchCoverageCheck(ccPath, defects);
  const doc = JSON.parse(readFileSync(ccPath, "utf8"));
  assert.deepEqual(doc.coverage_check.layers.l5_connectivity.defects, defects);
  assert.equal(doc.coverage_check.summary.connectivity_defects, 1);
  // 保全確認 (split ownership)
  assert.equal(doc.coverage_check.layers.l1_ui_states.missing.length, 1);
  assert.equal(doc.coverage_check.summary.total_missing, 1);
  assert.equal(doc.coverage_check.user_accepted_gaps, true);
  assert.equal(doc.coverage_check.checked_at, "2026-07-06T00:00:00Z");
});

test("patchCoverageCheck: ファイル不在 / JSON 破損 / 必須構造の欠落・型不正は InputError (exit 2 契約)", () => {
  const dir = mkdtempSync(join(tmpdir(), "validate-conn-cc2-"));
  assert.throws(() => patchCoverageCheck(join(dir, "nope.json"), []), InputError);

  const writeCase = (name, content) => {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  };
  // JSON 破損: SyntaxError を素通しすると uncaught exit 1 = 「defect あり」と誤読されるため InputError に畳む
  assert.throws(() => patchCoverageCheck(writeCase("broken.json", "{ not json"), []), InputError);
  // 必須構造の欠落・型不正 (Array / null は typeof === "object" でも不適合として弾く)
  for (const [name, doc] of [
    ["no-summary.json", { coverage_check: { layers: {} } }],
    ["top-string.json", '"hi"'],
    ["layers-array.json", { coverage_check: { layers: [], summary: {} } }],
    ["summary-null.json", { coverage_check: { layers: {}, summary: null } }],
    ["cc-array.json", { coverage_check: [] }],
  ]) {
    const content = typeof doc === "string" ? doc : JSON.stringify(doc);
    assert.throws(() => patchCoverageCheck(writeCase(name, content), []), InputError, name);
  }
});

// ── CLI: exit code 契約 (0/1/2) + --write ───────────────

function makeAppDir(mmd, list, cc) {
  const dir = mkdtempSync(join(tmpdir(), "validate-conn-app-"));
  mkdirSync(join(dir, "screens"));
  writeFileSync(join(dir, "screens", "00-transition-map.mmd"), mmd);
  writeFileSync(join(dir, "screens", "00-screen-list.md"), list);
  if (cc) writeFileSync(join(dir, "screens", "00-coverage-check.json"), JSON.stringify(cc, null, 2));
  return dir;
}

const runCli = (args) => spawnSync(process.execPath, [join("scripts", "validate-connectivity.mjs"), ...args], { encoding: "utf8" });

test("CLI: defect 0 は exit 0、defect あり + --write は exit 1 で coverage-check を patch", () => {
  const clean = makeAppDir(MMD_OK, LIST_OK, CC_BASE);
  const r0 = runCli([clean]);
  assert.equal(r0.status, 0, r0.stderr);
  assert.equal(JSON.parse(r0.stdout).connectivity_defects, 0);

  const listWithOrphan = chromeList([
    "| 01 | ログイン | なし | 無 |",
    "| 02 | ホーム | A | 有 |",
    "| 03 | 詳細 | B | 無 |",
    "| 04 | 未配線 | B | 無 |",
  ]);
  const dirty = makeAppDir(MMD_OK, listWithOrphan, CC_BASE);
  const r1 = runCli([dirty, "--write"]);
  assert.equal(r1.status, 1, r1.stderr);
  const out = JSON.parse(r1.stdout);
  assert.equal(out.connectivity_defects, 1);
  const cc = JSON.parse(readFileSync(join(dirty, "screens", "00-coverage-check.json"), "utf8"));
  assert.equal(cc.coverage_check.summary.connectivity_defects, 1);
  assert.equal(cc.coverage_check.layers.l5_connectivity.defects[0].defect_kind, "orphan_in_list");
});

test("CLI: parse 失敗 / --write 先の coverage-check 不在は exit 2、引数なしは exit 1", () => {
  const broken = makeAppDir("flowchart TD\n  scrA[画面A]:::x\n", LIST_OK);
  assert.equal(runCli([broken]).status, 2);

  const noCc = makeAppDir(MMD_OK, LIST_OK); // coverage-check なし
  const r = runCli([noCc, "--write"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not found/);

  assert.equal(runCli([]).status, 1);
});
