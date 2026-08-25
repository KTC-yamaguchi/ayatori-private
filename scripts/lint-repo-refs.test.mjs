// scripts/lint-repo-refs.test.mjs
//
// scripts/lint-repo-refs.mjs の単体 + fixture 統合テスト。Node 標準の
// node:test + node:assert のみ (依存ゼロ)。
//   実行: node --test scripts/lint-repo-refs.test.mjs
//
// テスト方針:
//   - 統合テストは一時ディレクトリに「実 repo で観測された stale drift 6 種」を
//     verbatim に再現した fixture repo を組み立て、全種が検出されることを断言する。
//     実 repo 側の drift はいずれ修正されるため、live repo への断言は行わない
//     (fixture が受け入れ基準の恒久的な回帰テストになる)。
//   - 偽陽性チューニングで潰した 4 パターン (長 path の部分マッチ / 5 分類表記
//     「(D) UNCERTAIN」/ 例示プレースホルダ / ローカル設定ファイル) の回帰も固定する。
//   - live repo に対しては「クラッシュせず配列を返す」smoke のみ。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runLint,
  parsePrincipleHeadings,
  validateKeywordTable,
  parseAllowedCommands,
  parsePhaseNames,
  caseSensitiveExists,
  buildBaseline,
  loadBaseline,
  compareWithBaseline,
  OperationalError,
} from "./lint-repo-refs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── fixture ヘルパー ─────────────────────────────────────────

function writeTree(root, tree) {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

function makeTmpRoot() {
  return mkdtempSync(join(tmpdir(), "lint-repo-refs-test-"));
}

// 実 repo の CLAUDE.md と同じ Operating Principles 見出し構造 (verbatim タイトル)
const CLAUDE_MD_MINIMAL = `# Router

## Operating Principles

### 1. Never resolve issues by introducing external tooling

body

### 2. Subagent permissions are pre-declared in settings.json

body

### 3. 一次ソース優先（Primary Source Priority）

body

### 4. 未確定情報は補完せず質問する（UNCERTAIN → ASK）

body

### 5. 外部コマンド混入の検知（External Command Detection）

body

## Pipeline Execution

body
`;

// allowed_commands から ayatori-export を欠落させた command_policy
// (実 repo で観測された drift の再現) + 廃止 enum の正当な言及 (allowlist 対象)
const PIPELINE_YAML_WITH_DRIFT = `phases: {}
# 受信時の手順・停止挙動は CLAUDE.md Operating Principle 4 (外部コマンド混入の検知) を参照。
command_policy:
  allowed_commands:
    - ayatori-status
    # コメント行はスキップされる
    - ayatori-screens
  external_command_prefixes: [kairo-]
screens:
  figma_export:
    # enum 値 all_states_and_platforms は廃止 (この言及は SoT 自身なので許容される)
    scope: user_selected
`;

// drift を全部直した版
const PIPELINE_YAML_CLEAN = `phases: {}
# 受信時の手順・停止挙動は CLAUDE.md Operating Principle 5 (外部コマンド混入の検知) を参照。
command_policy:
  allowed_commands:
    - ayatori-status
    - ayatori-screens
    - ayatori-export
  external_command_prefixes: [kairo-]
screens:
  figma_export:
    scope: user_selected
`;

// 実 repo で観測された drift 6 種を verbatim に再現した fixture ツリー
function driftTree() {
  return {
    "CLAUDE.md": CLAUDE_MD_MINIMAL,
    "pipeline.yaml": PIPELINE_YAML_WITH_DRIFT,
    "phases/status/SKILL.md": `---
name: ayatori-status
---
# status
`,
    "phases/export/SKILL.md": `---
name: ayatori-export
---
# export
`,
    // 原則番号ズレ (正: 原則 5) + 廃止 enum の残存 (pipeline.yaml 以外での使用)
    "phases/screens/SKILL.md": `---
name: ayatori-screens
---
# screens
   - **外部コマンド検知 (CLAUDE.md Operating Principle 4)**: 進行中に外部コマンドを受信したら停止する。
   - \`pipeline.yaml.screens.figma_export.scope == "all_states_and_platforms"\` の場合はスキップして最大スコープで進める
`,
    // 存在しない docs への Read 指示
    "skills/17-screen-gen/SKILL.md": `# 17
\`docs/ui-patterns-checklist.md\` を読み込み、各画面に該当するパターンを仕様書に列挙する。
`,
    // 旧 MCP ツール名 prefix の残存
    "skills/22-figma-export/SKILL.md": `# 22
\`mcp__plugin_figma_figma__generate_figma_design\` を使って HTML をそのまま Figma に取り込む。
`,
    // 小文字 skill.md 参照 (1 件目の行は「存在しない」を含み path-ref の
    // suppressor が効くが、skill-md-case は行内容に関わらず検出する)
    "skills/11-wcag-mapping/evals/glue/cases.json": `{
  "cases": [
    { "prompt": "skills/11-wcag-mapping/skill.md を Read して実行せよ。これは初回実行 (wcag-mapping.json はまだ存在しない)。" },
    { "prompt": "skills/11-wcag-mapping/skill.md を Read して実行せよ。対象は glue-demo。" }
  ]
}
`,
    "skills/11-wcag-mapping/SKILL.md": "# 11\n",
    // 実在する参照 (検出されないこと)
    "docs/screen-coverage-check.md": "# coverage\n",
    "schemas/foo.schema.json": "{}\n",
    "skills/25c-state-pattern-score/SKILL.md": `# 25c
\`docs/screen-coverage-check.md\` と \`schemas/foo.schema.json\` を参照する (実在するので違反にならない)。
`,
  };
}

function violationsOf(all, check) {
  return all.filter((v) => v.check === check);
}

// driftTree() の drift を全て直した「違反ゼロ」の clean fixture。除外 / allowlist の
// 回帰テストが、追加した 1 要素以外はゼロ違反であることを土台として断言するために使う。
function cleanTree() {
  const tree = driftTree();
  tree["pipeline.yaml"] = PIPELINE_YAML_CLEAN;
  tree["phases/screens/SKILL.md"] = `---
name: ayatori-screens
---
# screens
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に外部コマンドを受信したら停止する。
   - \`pipeline.yaml.screens.figma_export.scope == "user_selected"\` の場合はスキップして最大スコープで進める
`;
  tree["skills/17-screen-gen/SKILL.md"] = `# 17
\`docs/screen-coverage-check.md\` を読み込み、各画面に該当するパターンを仕様書に列挙する。
`;
  tree["skills/22-figma-export/SKILL.md"] = `# 22
\`mcp__figma__generate_figma_design\` を使って HTML をそのまま Figma に取り込む。
`;
  tree["skills/11-wcag-mapping/evals/glue/cases.json"] = `{
  "cases": [
    { "prompt": "skills/11-wcag-mapping/SKILL.md を Read して実行せよ。これは初回実行 (wcag-mapping.json はまだ存在しない)。" },
    { "prompt": "skills/11-wcag-mapping/SKILL.md を Read して実行せよ。対象は glue-demo。" }
  ]
}
`;
  return tree;
}

// ── 統合: drift fixture で 6 種全検出 ────────────────────────

test("統合: 実 repo で観測された stale drift 6 種を全件検出する", () => {
  const root = makeTmpRoot();
  try {
    writeTree(root, driftTree());
    const violations = runLint(root);

    // 1. allowed_commands ↔ phases frontmatter の突合 (export 欠落)
    const cmd = violationsOf(violations, "command-policy");
    assert.equal(cmd.length, 1);
    assert.match(cmd[0].message, /ayatori-export/);
    assert.equal(cmd[0].file, "pipeline.yaml");

    // 2. 原則番号ズレ (pipeline.yaml コメント + phases/screens の 2 箇所)
    const prin = violationsOf(violations, "principle-ref");
    assert.equal(prin.length, 2);
    for (const v of prin) {
      assert.match(v.message, /「4」と引用されているが/);
      assert.match(v.message, /原則 5/);
    }
    assert.deepEqual(
      prin.map((v) => v.file).sort(),
      ["phases/screens/SKILL.md", "pipeline.yaml"]
    );

    // 3. 小文字 skill.md (cases.json の 2 行とも。suppressor 語を含む行でも検出)
    const caseV = violationsOf(violations, "skill-md-case");
    assert.equal(caseV.length, 2);
    assert.ok(caseV.every((v) => v.file === "skills/11-wcag-mapping/evals/glue/cases.json"));

    // 4. 廃止 enum (pipeline.yaml 以外での使用のみ。SoT 自身の言及は許容)
    const dep = violationsOf(violations, "deprecated-token");
    const enumV = dep.filter((v) => v.message.includes("all_states_and_platforms"));
    assert.equal(enumV.length, 1);
    assert.equal(enumV[0].file, "phases/screens/SKILL.md");

    // 5. 旧 MCP ツール名 prefix
    const mcpV = dep.filter((v) => v.message.includes("mcp__plugin_figma_figma__"));
    assert.equal(mcpV.length, 1);
    assert.equal(mcpV[0].file, "skills/22-figma-export/SKILL.md");

    // 6. 参照先不在 (docs/ui-patterns-checklist.md + 小文字 skill.md の実在照合)
    const pathV = violationsOf(violations, "path-ref");
    assert.ok(pathV.some((v) => v.message.includes("docs/ui-patterns-checklist.md")));
    // cases.json 2 行目 (suppressor 語なし) は case-sensitive 照合でも検出される
    assert.ok(
      pathV.some(
        (v) =>
          v.file === "skills/11-wcag-mapping/evals/glue/cases.json" &&
          v.message.includes("skills/11-wcag-mapping/skill.md")
      )
    );
    // 実在する参照は検出されない
    assert.ok(!pathV.some((v) => v.message.includes("docs/screen-coverage-check.md")));
    assert.ok(!pathV.some((v) => v.message.includes("schemas/foo.schema.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 統合: clean fixture で違反ゼロ (偽陽性ゼロの断言) ────────

test("統合: drift を全部直した fixture では違反ゼロ", () => {
  const root = makeTmpRoot();
  try {
    const tree = driftTree();
    tree["pipeline.yaml"] = PIPELINE_YAML_CLEAN;
    tree["phases/screens/SKILL.md"] = `---
name: ayatori-screens
---
# screens
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に外部コマンドを受信したら停止する。
   - \`pipeline.yaml.screens.figma_export.scope == "user_selected"\` の場合はスキップして最大スコープで進める
`;
    tree["skills/17-screen-gen/SKILL.md"] = `# 17
\`docs/screen-coverage-check.md\` を読み込み、各画面に該当するパターンを仕様書に列挙する。
`;
    tree["skills/22-figma-export/SKILL.md"] = `# 22
\`mcp__figma__generate_figma_design\` を使って HTML をそのまま Figma に取り込む。
`;
    tree["skills/11-wcag-mapping/evals/glue/cases.json"] = `{
  "cases": [
    { "prompt": "skills/11-wcag-mapping/SKILL.md を Read して実行せよ。これは初回実行 (wcag-mapping.json はまだ存在しない)。" },
    { "prompt": "skills/11-wcag-mapping/SKILL.md を Read して実行せよ。対象は glue-demo。" }
  ]
}
`;
    writeTree(root, tree);
    const violations = runLint(root);
    assert.deepEqual(violations, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 偽陽性の回帰テスト (チューニングで潰したパターン) ────────

test("偽陽性回帰: 長 path の部分マッチ / 5分類表記 / 例示プレースホルダ / ローカル設定を検出しない", () => {
  const root = makeTmpRoot();
  try {
    const tree = driftTree();
    tree["pipeline.yaml"] = PIPELINE_YAML_CLEAN;
    // drift 側ファイルを clean 化して偽陽性検査に集中する
    tree["phases/screens/SKILL.md"] = `---
name: ayatori-screens
---
# screens
`;
    tree["skills/17-screen-gen/SKILL.md"] = "# 17\n";
    tree["skills/22-figma-export/SKILL.md"] = "# 22\n";
    tree["skills/11-wcag-mapping/evals/glue/cases.json"] = "{}\n";

    // (1) `.claude/skills/...` の途中を skills/... として部分マッチしない
    tree["skills/01b-add-feature-question/SKILL.md"] = `# 01b
具体的な分岐ロジックの追加は \`.claude/skills/ayatori-req-delta/SKILL.md\` 側で行う。
`;
    // (2) 5 分類表記「(D) UNCERTAIN」は原則名の引用ではない (原則 3 の引用は正しい)
    tree["phases/reverse/SKILL.md"] = `---
name: ayatori-reverse
---
# reverse
   - 固有注記: reverse 経路は (D) UNCERTAIN を多数生む可能性が高い (Operating Principle 3 と密接)。
`;
    tree["pipeline.yaml"] = PIPELINE_YAML_CLEAN.replace(
      "    - ayatori-export\n",
      "    - ayatori-export\n    - ayatori-reverse\n"
    );
    // (3) 例示プレースホルダ
    tree["skills/26-retro/SKILL.md"] = `# 26
各 step は \`skills/NN-name/SKILL.md\` の一般形に従う。
`;
    // (4) gitignored なローカル設定ファイルは走査対象外
    tree[".claude/settings.local.json"] = `{ "note": "skills/22-figma-export/skill.md への言及" }
`;
    writeTree(root, tree);
    const violations = runLint(root);
    assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 除外 / allowlist の回帰テスト ────────────────────────────

test("EXCLUDE_DIRS: .claude/worktrees 配下は走査しない (ローカル worktree が lint 結果に影響しない)", () => {
  const root = makeTmpRoot();
  try {
    const tree = cleanTree();
    // 別ブランチの作業コピー内に skill-md-case 違反を置いても、走査除外により検出されないこと
    tree[".claude/worktrees/POCTEAMA-999_wt/skills/x/SKILL.md"] =
      "旧記法の skills/x/skill.md を参照する記述。\n";
    writeTree(root, tree);
    const violations = runLint(root);
    assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("skill-md-case: allowlist 対象ファイル内の小文字 skill.md は違反にしない (規約文書は反例として含む)", () => {
  const root = makeTmpRoot();
  try {
    const tree = cleanTree();
    tree["docs/skill-authoring-convention.md"] =
      "ファイル名は `SKILL.md` に統一する。`skill.md` (小文字) は反例として使わない。\n";
    writeTree(root, tree);
    const violations = runLint(root);
    assert.equal(
      violationsOf(violations, "skill-md-case").length,
      0,
      JSON.stringify(violations, null, 2)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 単体: caseSensitiveExists ────────────────────────────────

test("caseSensitiveExists: macOS の case-insensitive FS でも大文字小文字違いを検出する", () => {
  const root = makeTmpRoot();
  try {
    writeTree(root, { "skills/foo/SKILL.md": "# foo\n" });
    assert.equal(caseSensitiveExists(root, "skills/foo/SKILL.md"), true);
    assert.equal(caseSensitiveExists(root, "skills/foo/skill.md"), false);
    assert.equal(caseSensitiveExists(root, "skills/bar/SKILL.md"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("caseSensitiveExists: 参照名と同名のディレクトリは実在扱いしない (ファイル想定)", () => {
  const root = makeTmpRoot();
  try {
    // docs/foo.md という「ディレクトリ」を作る (ファイル参照としては不在が正)
    mkdirSync(join(root, "docs", "foo.md"), { recursive: true });
    assert.equal(caseSensitiveExists(root, "docs/foo.md"), false);
    assert.equal(caseSensitiveExists(root, "docs"), false); // ディレクトリ自体も false
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CRLF ファイルでも全チェックが機能する (行末 \\r の残留による検出漏れなし)", () => {
  const root = makeTmpRoot();
  try {
    const tree = driftTree();
    // 全ファイルを CRLF 改行に変換して書き込む (Windows 編集環境を模擬)
    const crlfTree = Object.fromEntries(
      Object.entries(tree).map(([k, v]) => [k, v.replace(/\n/g, "\r\n")])
    );
    writeTree(root, crlfTree);
    const violations = runLint(root);

    // LF fixture と同じ検出が得られること (frontmatter / 見出し / indent 判定が \r で壊れない)
    assert.equal(violationsOf(violations, "command-policy").length, 1);
    assert.equal(violationsOf(violations, "principle-ref").length, 2);
    assert.equal(violationsOf(violations, "skill-md-case").length, 2);
    assert.ok(
      violationsOf(violations, "path-ref").some((v) => v.message.includes("docs/ui-patterns-checklist.md"))
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 単体: parseAllowedCommands / parsePhaseNames ─────────────

test("parseAllowedCommands: コメント・空行を飛ばし dedent でブロック終端", () => {
  const root = makeTmpRoot();
  try {
    writeTree(root, {
      "pipeline.yaml": `command_policy:
  allowed_commands:
    - ayatori-status
    # コメント
    - ayatori-screens

    - ayatori-export
  external_command_prefixes: [kairo-]
`,
    });
    const { commands } = parseAllowedCommands(root);
    assert.deepEqual(commands, ["ayatori-status", "ayatori-screens", "ayatori-export"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parsePhaseNames: frontmatter name: を phase ごとに収集する", () => {
  const root = makeTmpRoot();
  try {
    writeTree(root, {
      "phases/screens/SKILL.md": `---
name: ayatori-screens
description: "x"
---
# body
`,
      "phases/broken/SKILL.md": "# frontmatter なし\n",
    });
    const names = parsePhaseNames(root);
    assert.deepEqual([...names.keys()], ["ayatori-screens"]);
    assert.equal(names.get("ayatori-screens"), "phases/screens/SKILL.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 単体: keyword 表の自己検証 (原則改番への追随強制) ────────

test("validateKeywordTable: 原則が改番されると運用エラーで停止する (silent 陳腐化の防止)", () => {
  const root = makeTmpRoot();
  try {
    // 原則 5 の見出しを別タイトルに変えた CLAUDE.md (改番・改名を模擬)
    writeTree(root, {
      "CLAUDE.md": CLAUDE_MD_MINIMAL.replace(
        "### 5. 外部コマンド混入の検知（External Command Detection）",
        "### 5. まったく別の原則"
      ),
    });
    const headings = parsePrincipleHeadings(root);
    assert.throws(() => validateKeywordTable(headings), OperationalError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parsePrincipleHeadings: Operating Principles セクション外の ### 見出しは拾わない", () => {
  const root = makeTmpRoot();
  try {
    writeTree(root, {
      "CLAUDE.md":
        CLAUDE_MD_MINIMAL + "\n## 別セクション\n\n### 9. これは原則ではない\n",
    });
    const headings = parsePrincipleHeadings(root);
    assert.equal(headings.size, 5);
    assert.equal(headings.has(9), false);
    assert.match(headings.get(5), /外部コマンド混入の検知/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 回帰: runLint 複数回呼び出しで dir cache が持ち越されない ─

test("runLint: 同一プロセスで複数回呼んでも呼び出し間の FS 変更が反映される (cache 持ち越しなし)", () => {
  const root = makeTmpRoot();
  try {
    const tree = driftTree();
    tree["pipeline.yaml"] = PIPELINE_YAML_CLEAN;
    tree["phases/screens/SKILL.md"] = `---
name: ayatori-screens
---
# screens
`;
    tree["skills/22-figma-export/SKILL.md"] = "# 22\n";
    tree["skills/11-wcag-mapping/evals/glue/cases.json"] = "{}\n";
    writeTree(root, tree);

    // 1 回目: docs/ui-patterns-checklist.md 不在 → path-ref 違反
    const first = runLint(root);
    assert.ok(first.some((v) => v.message.includes("docs/ui-patterns-checklist.md")));

    // 呼び出しの間に参照先ファイルを作成 → 2 回目は違反が消えること
    // (cache が前回実行から持ち越されると stale 判定のまま違反が残る)
    writeTree(root, { "docs/ui-patterns-checklist.md": "# checklist\n" });
    const second = runLint(root);
    assert.ok(!second.some((v) => v.message.includes("docs/ui-patterns-checklist.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── baseline (ratchet): 既知違反の許容と新規違反のブロック ───

test("baseline: round-trip で既知違反は許容され、新規違反だけが検出される", () => {
  const root = makeTmpRoot();
  // 実 repo と同じく走査除外の scripts/ 配下に置く (baseline 自身は廃止トークン等の
  // 文字列を含むため、走査対象に置くと lint が baseline を検出してしまう)
  const baselinePath = join(root, "scripts", "baseline.json");
  try {
    writeTree(root, driftTree());
    mkdirSync(dirname(baselinePath), { recursive: true });

    // 既知違反 (drift 6 種) を baseline 化 → 同じ状態では新規違反ゼロ
    const initial = runLint(root);
    assert.ok(initial.length > 0);
    writeFileSync(baselinePath, JSON.stringify(buildBaseline(initial), null, 2), "utf8");
    const counts = loadBaseline(baselinePath);
    const same = compareWithBaseline(runLint(root), counts);
    assert.deepEqual(same.newViolations, []);
    assert.equal(same.baselinedCount, initial.length);
    assert.deepEqual(same.resolvedKeys, []);

    // 新しい drift (存在しない docs 参照) を追加 → その分だけ新規違反として検出
    writeTree(root, {
      "skills/99-new/SKILL.md": "# 99\n`docs/never-exists.md` を Read して実行する。\n",
    });
    const after = compareWithBaseline(runLint(root), counts);
    assert.equal(after.newViolations.length, 1);
    assert.match(after.newViolations[0].message, /docs\/never-exists\.md/);
    assert.equal(after.newViolations[0].baseline_note, "baseline 未登録の新規違反");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("baseline: 同一 (check, file, message) の件数超過を新規違反として検出する (count-aware)", () => {
  const root = makeTmpRoot();
  try {
    writeTree(root, driftTree());
    const initial = runLint(root);
    const counts = new Map(
      [...buildBaseline(initial).entries].map((e) => [
        [e.check, e.file, e.message].join(String.fromCharCode(0)),
        e.count,
      ])
    );

    // 既知 1 件の旧ツール名参照ファイルに、同一 message になる 2 行目を追加
    writeTree(root, {
      "skills/22-figma-export/SKILL.md": `# 22
\`mcp__plugin_figma_figma__generate_figma_design\` を使って HTML をそのまま Figma に取り込む。
再掲: \`mcp__plugin_figma_figma__generate_figma_design\` を呼ぶ。
`,
    });
    const after = compareWithBaseline(runLint(root), counts);
    const excess = after.newViolations.filter((v) => v.message.includes("mcp__plugin_figma_figma__"));
    assert.equal(excess.length, 1); // 許容 1 件を超えた 1 件だけが新規扱い
    assert.match(excess[0].baseline_note, /baseline 許容 1 件を超過/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("baseline: 修正が進んで件数が減ると resolvedKeys で報告される (fail はしない)", () => {
  const root = makeTmpRoot();
  try {
    writeTree(root, driftTree());
    const initial = runLint(root);
    const baselinePath = join(root, "scripts", "baseline.json"); // 走査除外の scripts/ 配下
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(buildBaseline(initial), null, 2), "utf8");
    const counts = loadBaseline(baselinePath);

    // 旧ツール名の違反を修正
    writeTree(root, { "skills/22-figma-export/SKILL.md": "# 22\n" });
    const after = compareWithBaseline(runLint(root), counts);
    assert.deepEqual(after.newViolations, []);
    assert.equal(after.resolvedKeys.length, 1);
    assert.match(after.resolvedKeys[0].message, /mcp__plugin_figma_figma__/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("baseline: 実 repo の baseline は現状と一致する (新規違反ゼロ・解消済みエントリゼロ)", () => {
  const baselinePath = join(REPO_ROOT, "scripts", "lint-repo-refs.baseline.json");
  const counts = loadBaseline(baselinePath);
  const { newViolations, resolvedKeys } = compareWithBaseline(runLint(REPO_ROOT), counts);
  assert.deepEqual(
    newViolations,
    [],
    "baseline に無い新規 drift がある。意図的なら --write-baseline でなくその drift の修正を先に検討"
  );
  assert.deepEqual(
    resolvedKeys,
    [],
    "修正済みの違反が baseline に残っている。--write-baseline で縮めること"
  );
});

// ── live smoke: 実 repo でクラッシュしない ───────────────────

test("live smoke: 実 repo に対して例外なく完走し violation 配列を返す", () => {
  const violations = runLint(REPO_ROOT);
  assert.ok(Array.isArray(violations));
  for (const v of violations) {
    assert.equal(typeof v.check, "string");
    assert.equal(typeof v.file, "string");
    assert.equal(typeof v.line, "number");
    assert.equal(typeof v.message, "string");
  }
});
