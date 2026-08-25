// scripts/expand-substate-plan.test.mjs
//
// scripts/expand-substate-plan.mjs の単体 + CLI 統合テスト。Node 標準の node:test + node:assert のみ (依存ゼロ)。
//   実行: node --test scripts/expand-substate-plan.test.mjs
//
// テスト方針:
//   - skills/25b-state-pattern-gen/SKILL.md Phase 1 の疑似コード (4 次元 cartesian) を本ファイル内に
//     **逐語 port した oracle** (oracleExpand) と展開結果を deepEqual で突合する。prose 三重実装との
//     「同一結果」保証はこの oracle 突合が担う。
//   - parse は 25b Phase 1b の docstring に明記された 4 例をそのまま golden として断言する。
//   - 実プロジェクトの plan での突合: 25a を proceed で完走した実 PJ が repo に存在しない
//     (mgs-regression-0604 / kinto-unlimited-0615 とも state_pattern_skipped=true) ため、
//     kinto-unlimited-0615 の実画面名 10 面 (screens/mobile/*.html) から現実的 fixture を構築して代替する。
//   - CLI 統合は execFileSync で本物の node プロセスを起動し、exit code / stdout JSON を検証する。

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSubStatePath,
  parseAnySubStatePath,
  deriveMainHtmlPath,
  expandPlan,
  assertThemePairs,
  diffCompleted,
  resolveDualThemeMode,
  buildSummary,
  readCompletedFiles,
} from "./expand-substate-plan.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "expand-substate-plan.mjs");

// ── oracle: skills/25b Phase 1 疑似コードの逐語 port ─────────────────────
//   for entry / themes legacy fallback / for state / for platform / for theme /
//   default → suffix なし, それ以外 → --{theme} suffix。
function oracleExpand(plan) {
  const expected_files = [];
  for (const entry of plan.screens) {
    const themes = "themes" in entry ? entry.themes : ["default"]; // legacy fallback
    for (const state of entry.states) {
      for (const platform of entry.platforms) {
        for (const theme of themes) {
          if (theme === "default") {
            expected_files.push(`screens/${platform}/${entry.screen}--${state}.html`);
          } else {
            expected_files.push(`screens/${platform}/${entry.screen}--${state}--${theme}.html`);
          }
        }
      }
    }
  }
  return expected_files;
}

// ── fixtures ─────────────────────────────────────────────
// kinto-unlimited-0615 の実画面名 (artifacts/kinto-unlimited-0615/screens/mobile/*.html と一致)
const REAL_SCREENS = [
  "01-login",
  "02-home",
  "03-notice-detail",
  "04-contract",
  "05-drive",
  "07-ug-list",
  "13-settings",
  "14-parts",
  "15-dealer",
  "16-notice-list",
];

// single-theme (themes フィールド欠落 = legacy fallback 経路も同時に検証する)
const SINGLE_PLAN = {
  schema_version: "2026-05-22",
  app_name: "kinto-unlimited-0615",
  created_at: "2026-06-19T19:42:00+09:00",
  source_enum: "required_4_states",
  user_decision: "all_four",
  screens: REAL_SCREENS.map((screen) => ({
    screen,
    states: ["empty", "loading", "error"],
    platforms: ["mobile"],
  })),
};

// dual-theme (ハイフン入り state を含む — 25b レビュー C-2 の regress ケース)
const DUAL_PLAN = {
  schema_version: "2026-05-22",
  app_name: "dual-demo",
  created_at: "2026-07-07T11:00:00+09:00",
  source_enum: "nature_based_extra_states",
  user_decision: "nature_based",
  screens: [
    {
      screen: "01-login",
      states: ["empty", "loading", "error"],
      platforms: ["web", "mobile"],
      themes: ["light", "dark"],
    },
    {
      screen: "02-dashboard",
      states: ["modal-dialog", "validation-error"],
      platforms: ["web"],
      themes: ["light", "dark"],
    },
  ],
};

// web-sm platform dir を含む plan (platform 名自体がハイフンを含むケース)
const WEB_SM_PLAN = {
  schema_version: "2026-05-22",
  app_name: "web-sm-demo",
  created_at: "2026-07-17T10:00:00+09:00",
  screens: [
    { screen: "01-login", states: ["empty", "error"], platforms: ["web", "web-sm"] },
  ],
};

// 非均一 plan (画面ごとに states 数が異なる)
const NON_UNIFORM_PLAN = {
  schema_version: "2026-05-22",
  app_name: "non-uniform",
  created_at: "2026-07-07T11:00:00+09:00",
  screens: [
    { screen: "01-a", states: ["empty"], platforms: ["web"] },
    { screen: "02-b", states: ["empty", "error"], platforms: ["web", "mobile"] },
  ],
};

// ── parseSubStatePath: 25b docstring の 4 例 (golden) ─────────────────
test("parseSubStatePath: 25b docstring の 4 例", () => {
  assert.deepEqual(parseSubStatePath("screens/web/01-login--empty--light.html"), {
    platform: "web",
    screen: "01-login",
    state: "empty",
    theme: "light",
  });
  assert.deepEqual(parseSubStatePath("screens/web/01-dashboard--modal-dialog--dark.html"), {
    platform: "web",
    screen: "01-dashboard",
    state: "modal-dialog",
    theme: "dark",
  });
  assert.deepEqual(parseSubStatePath("screens/web/01-page-name--state-name--light.html"), {
    platform: "web",
    screen: "01-page-name",
    state: "state-name",
    theme: "light",
  });
  // default 命名は None (null) — silently skip
  assert.equal(parseSubStatePath("screens/web/01-login--empty.html"), null);
});

test("parseSubStatePath: 非対象 path は null", () => {
  assert.equal(parseSubStatePath("foo/web/a--b--c.html"), null); // prefix 不一致
  assert.equal(parseSubStatePath("screens/web/a--b--c.txt"), null); // suffix 不一致
  assert.equal(parseSubStatePath("screens/nofile.html"), null); // platform 区切りなし
  assert.equal(parseSubStatePath("screens/web/plain.html"), null); // "--" なし
  assert.equal(parseSubStatePath(null), null);
  assert.equal(parseSubStatePath(42), null);
});

test("parseSubStatePath: 空要素を含む不正 path は null (triple 集計への混入防止)", () => {
  assert.equal(parseSubStatePath("screens/web/--a--light.html"), null); // screen 空
  assert.equal(parseSubStatePath("screens/web/a----light.html"), null); // state 空
  assert.equal(parseSubStatePath("screens/web/a--b--.html"), null); // theme 空
  assert.equal(parseSubStatePath("screens//a--b--light.html"), null); // platform 空
});

test('parseSubStatePath: state への "--" 取り込み / theme enum 外は null (命名契約の機械強制)', () => {
  // 4 segment 以上: state="bad--state" として取り込まず null (境界が確定できない不正名)
  assert.equal(parseSubStatePath("screens/web/01-login--bad--state--light.html"), null);
  // 末尾 segment が light/dark 以外: theme と誤認しない
  assert.equal(parseSubStatePath("screens/web/01-a--modal--dialog.html"), null);
  assert.equal(parseSubStatePath("screens/web/a--b--c--empty.html"), null);
});

test("parseAnySubStatePath: 空要素を含む不正 path は null", () => {
  assert.equal(parseAnySubStatePath("screens//01-a--empty.html"), null); // platform 空
  assert.equal(parseAnySubStatePath("screens/web/--empty.html"), null); // screen 空
  assert.equal(parseAnySubStatePath("screens/web/01-a--.html"), null); // state 空
});

test("parseAnySubStatePath: dual-theme main HTML を sub-state と誤認しない (light/dark は state 名予約不可)", () => {
  // Step 17 dual_theme が生成する main HTML の命名 "{screen}--{theme}.html"
  assert.equal(parseAnySubStatePath("screens/web/01-login--light.html"), null);
  assert.equal(parseAnySubStatePath("screens/web/01-login--dark.html"), null);
  assert.equal(parseAnySubStatePath("screens/mobile/02-dashboard-overview--light.html"), null);
  // 3 segment 以上あるのに dual として parse できない不正名も single に落とさない
  assert.equal(parseAnySubStatePath("screens/web/01-a--modal--dialog.html"), null);
});

// ── parseAnySubStatePath / deriveMainHtmlPath (25c Step 1-1b) ─────────
test("parseAnySubStatePath: dual / single / main の 3 分岐", () => {
  assert.deepEqual(parseAnySubStatePath("screens/web/01-login--empty--light.html"), {
    platform: "web",
    screen: "01-login",
    state: "empty",
    theme: "light",
    naming: "dual",
  });
  assert.deepEqual(parseAnySubStatePath("screens/mobile/02-home--empty.html"), {
    platform: "mobile",
    screen: "02-home",
    state: "empty",
    theme: "default",
    naming: "single",
  });
  // single 命名でもハイフン入り state を保持 (rpartition 相当)
  assert.deepEqual(parseAnySubStatePath("screens/web/01-login--validation-error.html"), {
    platform: "web",
    screen: "01-login",
    state: "validation-error",
    theme: "default",
    naming: "single",
  });
  // main HTML (sub-state ではない) は null
  assert.equal(parseAnySubStatePath("screens/mobile/02-home.html"), null);
});

test("deriveMainHtmlPath: dual は theme 別 main / single は suffix なし main", () => {
  assert.equal(
    deriveMainHtmlPath(parseAnySubStatePath("screens/web/01-login--empty--light.html")),
    "screens/web/01-login--light.html",
  );
  assert.equal(
    deriveMainHtmlPath(parseAnySubStatePath("screens/web/01-dashboard--modal-dialog--dark.html")),
    "screens/web/01-dashboard--dark.html",
  );
  assert.equal(
    deriveMainHtmlPath(parseAnySubStatePath("screens/mobile/02-home--empty.html")),
    "screens/mobile/02-home.html",
  );
});

// ── expandPlan: oracle 突合 (prose 疑似コードとの同一結果保証) ─────────
test("expandPlan: single-theme (実 PJ 画面名 / legacy themes 欠落) が oracle と完全一致", () => {
  const { expected, errors, warnings } = expandPlan(SINGLE_PLAN);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(expected.length, 10 * 3 * 1); // 10 画面 × 3 state × 1 platform × 1 theme
  assert.deepEqual(
    expected.map((e) => e.html_path),
    oracleExpand(SINGLE_PLAN),
  );
  // ループ順: state → platform → theme (25b / 25e と同順)
  assert.equal(expected[0].html_path, "screens/mobile/01-login--empty.html");
  assert.equal(expected[1].html_path, "screens/mobile/01-login--loading.html");
  assert.equal(expected[2].html_path, "screens/mobile/01-login--error.html");
  // theme suffix が付かない (single-theme 互換)
  assert.ok(expected.every((e) => e.theme === "default" && !e.html_path.includes("--light")));
  // 25e の capture key 形式
  assert.equal(expected[0].key, "mobile/01-login--empty");
});

test("expandPlan: web-sm platform dir の展開 + parse roundtrip", () => {
  const { expected, errors, warnings } = expandPlan(WEB_SM_PLAN);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(expected.length, 1 * 2 * 2); // 1 画面 × 2 state × 2 platform × 1 theme
  assert.deepEqual(
    expected.map((e) => e.html_path),
    oracleExpand(WEB_SM_PLAN),
  );
  // platform 名自体のハイフン ("web-sm") が screen/state 境界 ("--") と混同されないこと
  const webSm = expected.filter((e) => e.platform === "web-sm");
  assert.equal(webSm.length, 2);
  assert.equal(webSm[0].html_path, "screens/web-sm/01-login--empty.html");
  assert.equal(webSm[0].key, "web-sm/01-login--empty"); // 25e capture key 形式
  // parse roundtrip (single-theme / dual-theme 両命名)
  assert.deepEqual(parseAnySubStatePath("screens/web-sm/01-login--empty.html"), {
    platform: "web-sm",
    screen: "01-login",
    state: "empty",
    theme: "default",
    naming: "single",
  });
  assert.deepEqual(parseSubStatePath("screens/web-sm/01-login--empty--dark.html"), {
    platform: "web-sm",
    screen: "01-login",
    state: "empty",
    theme: "dark",
  });
  assert.equal(
    deriveMainHtmlPath(parseAnySubStatePath("screens/web-sm/01-login--empty.html")),
    "screens/web-sm/01-login.html",
  );
});

test("expandPlan: dual-theme が oracle と完全一致 + roundtrip", () => {
  const { expected, errors } = expandPlan(DUAL_PLAN);
  assert.deepEqual(errors, []);
  assert.equal(expected.length, 3 * 2 * 2 + 2 * 1 * 2); // 12 + 4
  assert.deepEqual(
    expected.map((e) => e.html_path),
    oracleExpand(DUAL_PLAN),
  );
  // ループ順: state → platform → theme
  assert.deepEqual(
    expected.slice(0, 4).map((e) => e.html_path),
    [
      "screens/web/01-login--empty--light.html",
      "screens/web/01-login--empty--dark.html",
      "screens/mobile/01-login--empty--light.html",
      "screens/mobile/01-login--empty--dark.html",
    ],
  );
  // 25e の capture key 形式 (dual は --{theme} 付き)
  assert.equal(expected[0].key, "web/01-login--empty--light");
  // roundtrip: 展開した path を parse すると元の成分に戻る (ハイフン入り state 含む)
  for (const e of expected) {
    assert.deepEqual(parseSubStatePath(e.html_path), {
      platform: e.platform,
      screen: e.screen,
      state: e.state,
      theme: e.theme,
    });
  }
});

test("expandPlan: single-theme の roundtrip (parseAnySubStatePath)", () => {
  const { expected } = expandPlan(SINGLE_PLAN);
  for (const e of expected) {
    const parsed = parseAnySubStatePath(e.html_path);
    assert.deepEqual(
      { platform: parsed.platform, screen: parsed.screen, state: parsed.state, theme: parsed.theme },
      { platform: e.platform, screen: e.screen, state: e.state, theme: e.theme },
    );
    assert.equal(deriveMainHtmlPath(parsed), `screens/${e.platform}/${e.screen}.html`);
  }
});

// ── expandPlan: 命名契約違反の検出 ─────────────────────────
test("expandPlan: 契約違反は errors に載る", () => {
  const bad = (patch) => {
    const plan = {
      app_name: "x",
      screens: [{ screen: "01-a", states: ["empty"], platforms: ["web"], ...patch }],
    };
    return expandPlan(plan).errors;
  };
  assert.ok(bad({ screen: "01--a" }).length > 0, 'screen に "--"');
  assert.ok(bad({ screen: "01/a" }).length > 0, 'screen に "/"');
  assert.ok(bad({ states: ["modal--dialog"] }).length > 0, 'state に "--"');
  assert.ok(bad({ states: ["light"] }).length > 0, "state 名 light は予約不可 (theme suffix と衝突)");
  assert.ok(bad({ states: ["dark"] }).length > 0, "state 名 dark は予約不可 (theme suffix と衝突)");
  assert.ok(bad({ states: ["default"] }).length > 0, "state 名 default は予約不可 (main HTML と衝突)");
  assert.ok(bad({ states: [] }).length > 0, "states 空");
  assert.ok(bad({ platforms: ["desktop"] }).length > 0, "platform enum 外");
  assert.ok(bad({ themes: ["sepia"] }).length > 0, "theme enum 外");
  assert.ok(bad({ themes: ["default", "light"] }).length > 0, "default と light の混在");
  assert.ok(bad({ themes: [] }).length > 0, "themes 明示空配列");
  assert.deepEqual(expandPlan({ app_name: "x" }).errors.length, 1); // screens 欠落
  assert.deepEqual(expandPlan(null).errors.length, 1);
  // 空 plan (screens: []) は「expected 0 件 = resume 完了済」の誤認を招くため error
  const empty = expandPlan({ app_name: "x", screens: [] });
  assert.equal(empty.errors.length, 1);
  assert.match(empty.errors[0], /空配列/);
});

test("expandPlan: plan.screens の重複 entry は warning", () => {
  const entry = { screen: "01-a", states: ["empty"], platforms: ["web"] };
  const { errors, warnings } = expandPlan({ app_name: "x", screens: [entry, { ...entry }] });
  assert.deepEqual(errors, []);
  assert.ok(warnings.length > 0);
});

// ── assertThemePairs (25b Phase 1b expected 側) ─────────────────────
test("assertThemePairs: 対称ペアは pass / 片 theme は violation", () => {
  const { expected } = expandPlan(DUAL_PLAN);
  assert.deepEqual(assertThemePairs(expected.map((e) => e.html_path)), []);

  const violations = assertThemePairs(["screens/web/01-login--empty--light.html"]);
  assert.deepEqual(violations, [
    { screen: "01-login", state: "empty", platform: "web", themes: ["light"] },
  ]);
});

test("assertThemePairs: default 命名 path は対象外 (silently skip)", () => {
  const { expected } = expandPlan(SINGLE_PLAN);
  assert.deepEqual(assertThemePairs(expected.map((e) => e.html_path)), []);
});

// ── diffCompleted (25b Phase 1 差集合 + Phase 1b 完了側対称性回復) ────────
test("diffCompleted: pending は expected 順を保持した差集合", () => {
  const expectedFiles = oracleExpand(SINGLE_PLAN);
  const completed = [expectedFiles[0], expectedFiles[1], "screens/mobile/99-stale--empty.html"];
  const { pending, asymmetricCompleted } = diffCompleted(expectedFiles, completed, false);
  assert.equal(pending.length, expectedFiles.length - 2); // 台帳の余剰 path は無視
  assert.equal(pending[0], expectedFiles[2]);
  assert.deepEqual(pending, expectedFiles.slice(2));
  assert.deepEqual(asymmetricCompleted, []); // single-mode では対称性検査しない
});

test("diffCompleted: dual-theme 完了側の片 theme は不足側を pending に強制追加 (重複なし)", () => {
  const expectedFiles = oracleExpand(DUAL_PLAN);
  // web/01-login/empty の light だけ完了して落ちた resume 状況
  const completed = ["screens/web/01-login--empty--light.html"];
  const { pending, asymmetricCompleted } = diffCompleted(expectedFiles, completed, true);
  const darkPath = "screens/web/01-login--empty--dark.html";
  // dark は expected に居るので pending に既に含まれ、強制追加で重複しない
  assert.equal(pending.filter((p) => p === darkPath).length, 1);
  assert.ok(!pending.includes("screens/web/01-login--empty--light.html"));
  assert.deepEqual(asymmetricCompleted, [
    {
      screen: "01-login",
      state: "empty",
      platform: "web",
      present_themes: ["light"],
      recovered_paths: [darkPath],
      stale_paths: [],
    },
  ]);
});

test("diffCompleted: 現行 plan 外の stale triple は stale_paths で報告のみ (生成を誘発しない)", () => {
  const expectedFiles = oracleExpand(DUAL_PLAN);
  const completed = ["screens/web/99-legacy--empty--light.html"]; // expected に存在しない stale triple
  const { pending, asymmetricCompleted } = diffCompleted(expectedFiles, completed, true);
  const stalePath = "screens/web/99-legacy--empty--dark.html";
  // plan から rename / 削除された画面の残骸を enqueue すると main HTML の無い画面の
  // sub-state 生成を誘発するため、pending には積まない (prose 疑似コードからの意図的な安全側逸脱)
  assert.ok(!pending.includes(stalePath));
  assert.deepEqual(pending, expectedFiles); // completed は全て plan 外なので差集合は expected 全件のまま
  assert.equal(asymmetricCompleted.length, 1);
  assert.deepEqual(asymmetricCompleted[0].recovered_paths, []);
  assert.deepEqual(asymmetricCompleted[0].stale_paths, [stalePath]);
});

test("diffCompleted: dual-theme で両 theme 完了済 triple は回復対象外", () => {
  const expectedFiles = oracleExpand(DUAL_PLAN);
  const completed = [
    "screens/web/01-login--empty--light.html",
    "screens/web/01-login--empty--dark.html",
  ];
  const { pending, asymmetricCompleted } = diffCompleted(expectedFiles, completed, true);
  assert.equal(pending.length, expectedFiles.length - 2);
  assert.deepEqual(asymmetricCompleted, []);
});

// ── resolveDualThemeMode ─────────────────────────────────
test("resolveDualThemeMode: flag > requirements > 推定 の優先順", () => {
  const { expected } = expandPlan(DUAL_PLAN);
  assert.deepEqual(resolveDualThemeMode({ flag: false, expected }), {
    value: false,
    source: "flag",
    warnings: [],
  });
  assert.deepEqual(resolveDualThemeMode({ expected }), {
    value: true,
    source: "inferred",
    warnings: [],
  });
  const single = expandPlan(SINGLE_PLAN).expected;
  assert.equal(resolveDualThemeMode({ expected: single }).value, false);
});

test("resolveDualThemeMode: requirements の 3 段 fallback (25b Phase 0 の移植)", () => {
  const dir = mkdtempSync(join(tmpdir(), "expand-substate-req-"));
  try {
    // 1. ファイル不在 → false
    assert.deepEqual(
      resolveDualThemeMode({ requirementsPath: join(dir, "nope.json"), expected: [] }),
      { value: false, source: "requirements", warnings: [] },
    );
    // 2. design_output_scope 欠落 → false
    const p2 = join(dir, "r2.json");
    writeFileSync(p2, JSON.stringify({ app_name: "x" }));
    assert.equal(resolveDualThemeMode({ requirementsPath: p2, expected: [] }).value, false);
    // 3. dual_theme_mode 欠落 → false
    const p3 = join(dir, "r3.json");
    writeFileSync(p3, JSON.stringify({ design_output_scope: {} }));
    assert.equal(resolveDualThemeMode({ requirementsPath: p3, expected: [] }).value, false);
    // true 明示 → true
    const p4 = join(dir, "r4.json");
    writeFileSync(p4, JSON.stringify({ design_output_scope: { dual_theme_mode: true } }));
    assert.equal(resolveDualThemeMode({ requirementsPath: p4, expected: [] }).value, true);
    // 非 boolean → false + warning (`is True` 判定と同値)
    const p5 = join(dir, "r5.json");
    writeFileSync(p5, JSON.stringify({ design_output_scope: { dual_theme_mode: "yes" } }));
    const r5 = resolveDualThemeMode({ requirementsPath: p5, expected: [] });
    assert.equal(r5.value, false);
    assert.equal(r5.warnings.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── readCompletedFiles ───────────────────────────────────
test("readCompletedFiles: 配列 / pipeline-state.json 形式の両対応", () => {
  assert.deepEqual(readCompletedFiles(["a.html"]), { files: ["a.html"], warnings: [] });
  assert.deepEqual(
    readCompletedFiles({ screens: { step25b: { completed_files: ["b.html"] } } }),
    { files: ["b.html"], warnings: [] },
  );
  // screens はあるが step25b 未記録 = 正常な初回 run → warning なしで 0 件
  assert.deepEqual(readCompletedFiles({ screens: {} }), { files: [], warnings: [] });
  assert.throws(() => readCompletedFiles({ screens: { step25b: { completed_files: "x" } } }));
  assert.throws(() => readCompletedFiles([1, 2]));
  assert.throws(() => readCompletedFiles("nope"));
});

test("readCompletedFiles: screens key の無い object は warning 付きで 0 件扱い (誤ファイル検知)", () => {
  const { files, warnings } = readCompletedFiles({ app_name: "x", foo: 1 });
  assert.deepEqual(files, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /screens key がありません/);
});

// ── buildSummary ─────────────────────────────────────────
test("buildSummary: 均一 plan は定型 pattern_summary / 非均一は合計のみ", () => {
  const single = expandPlan(SINGLE_PLAN).expected;
  const s1 = buildSummary(SINGLE_PLAN, single);
  assert.equal(s1.total, 30);
  assert.equal(s1.pattern_summary, "10 画面 × 3 state × 1 platform × 1 theme = 30 件");

  const nu = expandPlan(NON_UNIFORM_PLAN).expected;
  const s2 = buildSummary(NON_UNIFORM_PLAN, nu);
  assert.equal(s2.total, 1 + 4);
  assert.equal(s2.pattern_summary, "非均一 plan: 合計 5 件");
});

// ── CLI 統合 ─────────────────────────────────────────────
const cliDir = mkdtempSync(join(tmpdir(), "expand-substate-cli-"));
after(() => rmSync(cliDir, { recursive: true, force: true }));

function writeFixture(name, obj) {
  const p = join(cliDir, name);
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

// execFileSync wrapper: 非 0 exit でも {status, stdout} を返す
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("CLI: single-theme plan の展開 (exit 0)", () => {
  const planPath = writeFixture("single-plan.json", SINGLE_PLAN);
  const { status, stdout } = runCli([planPath]);
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, true);
  assert.equal(out.app_name, "kinto-unlimited-0615");
  assert.equal(out.dual_theme_mode, false);
  assert.equal(out.dual_theme_mode_source, "inferred");
  assert.deepEqual(out.expected_files, oracleExpand(SINGLE_PLAN));
  assert.equal(out.summary.total, 30);
  assert.equal(out.expected[0].key, "mobile/01-login--empty");
});

test("CLI: dual-theme plan + --requirements (exit 0, source=requirements)", () => {
  const planPath = writeFixture("dual-plan.json", DUAL_PLAN);
  const reqPath = writeFixture("req-dual.json", {
    design_output_scope: { dual_theme_mode: true },
  });
  const { status, stdout } = runCli([planPath, "--requirements", reqPath]);
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, true);
  assert.equal(out.dual_theme_mode, true);
  assert.equal(out.dual_theme_mode_source, "requirements");
  assert.deepEqual(out.expected_files, oracleExpand(DUAL_PLAN));
});

test("CLI: 非対称 themes の plan は pair assertion で exit 1", () => {
  const planPath = writeFixture("asym-plan.json", {
    app_name: "asym",
    screens: [{ screen: "01-a", states: ["empty"], platforms: ["web"], themes: ["light"] }],
  });
  const { status, stdout } = runCli([planPath, "--dual-theme-mode", "true"]);
  assert.equal(status, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, false);
  assert.deepEqual(out.violations, [
    { screen: "01-a", state: "empty", platform: "web", themes: ["light"] },
  ]);
});

test("CLI: --dual-theme-mode false なら pair assertion は skip (25b と同挙動)", () => {
  const planPath = writeFixture("asym-plan2.json", {
    app_name: "asym",
    screens: [{ screen: "01-a", states: ["empty"], platforms: ["web"], themes: ["light"] }],
  });
  const { status } = runCli([planPath, "--dual-theme-mode", "false"]);
  assert.equal(status, 0);
});

test("CLI: 命名契約違反の plan は exit 1", () => {
  const planPath = writeFixture("bad-plan.json", {
    app_name: "bad",
    screens: [{ screen: "01--a", states: ["empty"], platforms: ["web"] }],
  });
  const { status, stdout } = runCli([planPath]);
  assert.equal(status, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
});

test("CLI: --diff (JSON 配列) で pending 差集合", () => {
  const planPath = writeFixture("single-plan-diff.json", SINGLE_PLAN);
  const all = oracleExpand(SINGLE_PLAN);
  const diffPath = writeFixture("completed-array.json", all.slice(0, 5));
  const { status, stdout } = runCli([planPath, "--diff", diffPath]);
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.completed_count, 5);
  assert.equal(out.pending_count, 25);
  assert.deepEqual(out.pending, all.slice(5));
  assert.deepEqual(out.asymmetric_completed, []);
});

test("CLI: --diff (pipeline-state.json 形式) + dual 非対称回復", () => {
  const planPath = writeFixture("dual-plan-diff.json", DUAL_PLAN);
  const statePath = writeFixture("pipeline-state.json", {
    schema_version: "2026-05-22",
    app_name: "dual-demo",
    screens: {
      step25b: { completed_files: ["screens/web/01-login--empty--light.html"] },
    },
  });
  const { status, stdout } = runCli([planPath, "--diff", statePath]);
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.dual_theme_mode, true); // plan から推定
  assert.equal(out.completed_count, 1);
  assert.equal(out.asymmetric_completed.length, 1);
  assert.deepEqual(out.asymmetric_completed[0].recovered_paths, [
    "screens/web/01-login--empty--dark.html",
  ]);
  assert.equal(
    out.pending.filter((p) => p === "screens/web/01-login--empty--dark.html").length,
    1,
  );
});

test("CLI: --parse dual / single / 非 sub-state", () => {
  const dual = runCli(["--parse", "screens/web/01-dashboard--modal-dialog--dark.html"]);
  assert.equal(dual.status, 0);
  const d = JSON.parse(dual.stdout);
  assert.equal(d.ok, true);
  assert.equal(d.screen, "01-dashboard");
  assert.equal(d.state, "modal-dialog");
  assert.equal(d.theme, "dark");
  assert.equal(d.main_html_path, "screens/web/01-dashboard--dark.html");

  const single = runCli(["--parse", "screens/mobile/02-home--empty.html"]);
  assert.equal(single.status, 0);
  const s = JSON.parse(single.stdout);
  assert.equal(s.theme, "default");
  assert.equal(s.main_html_path, "screens/mobile/02-home.html");

  // main HTML (sub-state ではない) は exit 1
  const main = runCli(["--parse", "screens/mobile/02-home.html"]);
  assert.equal(main.status, 1);
  assert.equal(JSON.parse(main.stdout).ok, false);

  // dual-theme main HTML ("{screen}--{theme}.html") も sub-state と誤認せず exit 1
  const dualMainLight = runCli(["--parse", "screens/web/01-login--light.html"]);
  assert.equal(dualMainLight.status, 1);
  assert.equal(JSON.parse(dualMainLight.stdout).ok, false);
  const dualMainDark = runCli(["--parse", "screens/web/01-login--dark.html"]);
  assert.equal(dualMainDark.status, 1);

  // theme enum 外の末尾 segment (screen/state への "--" 混入疑い) → exit 1
  const weird = runCli(["--parse", "screens/web/a--b--c--empty.html"]);
  assert.equal(weird.status, 1);
});

test("CLI: 空 plan (screens: []) は exit 1", () => {
  const planPath = writeFixture("empty-plan.json", { app_name: "empty", screens: [] });
  const { status, stdout } = runCli([planPath]);
  assert.equal(status, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /空配列/);
});

test("CLI: dual_theme_mode と plan themes の食い違いは warning で可視化", () => {
  // requirements=false 相当 (明示 false) なのに plan は light/dark → assertion skip が無警告にならない
  const planPath = writeFixture("drift-plan.json", DUAL_PLAN);
  const r1 = runCli([planPath, "--dual-theme-mode", "false"]);
  assert.equal(r1.status, 0);
  const out1 = JSON.parse(r1.stdout);
  assert.ok(out1.warnings.some((w) => w.includes("食い違っています")));

  // 逆方向: mode=true なのに plan は default のみ
  const planPath2 = writeFixture("drift-plan2.json", SINGLE_PLAN);
  const r2 = runCli([planPath2, "--dual-theme-mode", "true"]);
  assert.equal(r2.status, 0);
  const out2 = JSON.parse(r2.stdout);
  assert.ok(out2.warnings.some((w) => w.includes("食い違っています")));

  // 一致していれば warning なし
  const r3 = runCli([planPath, "--dual-theme-mode", "true"]);
  assert.ok(!JSON.parse(r3.stdout).warnings.some((w) => w.includes("食い違っています")));
});

test("CLI: --diff に screens key の無い JSON を渡すと warning 付き 0 件扱い", () => {
  const planPath = writeFixture("single-plan-warn.json", SINGLE_PLAN);
  const diffPath = writeFixture("not-pipeline-state.json", { app_name: "x", entries: [] });
  const { status, stdout } = runCli([planPath, "--diff", diffPath]);
  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.completed_count, 0);
  assert.equal(out.pending_count, 30); // 0 件扱い自体は維持 (全件 pending)
  assert.ok(out.warnings.some((w) => w.includes("screens key がありません")));
});

test("CLI: 運用エラーは exit 2", () => {
  assert.equal(runCli([join(cliDir, "not-exist.json")]).status, 2); // plan 不在
  assert.equal(runCli([]).status, 2); // 引数なし
  assert.equal(runCli(["--unknown-flag", "x"]).status, 2); // 不明オプション
  const planPath = writeFixture("ok-plan.json", SINGLE_PLAN);
  assert.equal(runCli([planPath, "--dual-theme-mode", "maybe"]).status, 2); // true|false 以外
  const notJson = join(cliDir, "broken.json");
  writeFileSync(notJson, "{ broken");
  assert.equal(runCli([notJson]).status, 2); // JSON parse 失敗
});
