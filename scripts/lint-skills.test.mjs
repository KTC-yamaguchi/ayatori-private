// scripts/lint-skills.test.mjs
//
// scripts/lint-skills.mjs の単体 + CLI smoke テスト。Node 標準の node:test + node:assert のみ（依存ゼロ）。
//   実行: node --test scripts/lint-skills.test.mjs
//
// テスト方針:
//   - 対象ファイル集合の定義は (1) linter 側 isLintTarget（正規表現 + Set）、
//     (2) trackedSkillFiles() の git ls-files pathspec、(3) workflow 側の grep 正規表現
//     （.github/workflows/lint-skills.yml）の 3 箇所に存在する。1 箇所だけ更新が漏れると
//     --all / CI がそのファイルを黙って飛ばすため、代表パス集合に対する 3 者の同一判定を固定する。
//   - path 正規化（先頭 `./` / 絶対パス → repo ルート相対）の回帰を固定する
//     （完全一致判定の RULE6_EXTRA_FILES が `./pipeline.yaml` で素通りしない）。
//   - Rule 6 警告の行番号（フェンス除去後も行番号を保つ）と baseline (ratchet) の抑制 / 超過判定を固定する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isLintTarget,
  isRule6OnlyFile,
  LS_FILES_PATHSPEC,
  normalizeArg,
  metaInfoWarnings,
  buildBaseline,
  loadBaseline,
  applyBaseline,
} from './lint-skills.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(REPO_ROOT, '.github/workflows/lint-skills.yml');

// ── 対象ファイル集合の代表パス（true = lint 対象）──────────────────────────
const TARGET_CASES = [
  // SKILL.md（全 Rule）
  ['skills/12-design-system/SKILL.md', true],
  ['phases/screens/SKILL.md', true],
  ['skills/12-design-system/skill.md', true], // 小文字は Rule 1 違反として「検査対象」
  // 補助 md（Rule 6 のみ）
  ['skills/21g-graphic-embed-review/refs/embed-guide.md', true],
  ['phases/screens/refs/notes.md', true],
  // subagent 定義 md（Rule 6 のみ）
  ['.claude/agents/figma-capture-runner.md', true],
  // pipeline.yaml（Rule 6 のみ・完全一致）
  ['pipeline.yaml', true],
  // 対象外
  ['.claude/agents/nested/foo.md', false], // agents 直下 1 階層のみ
  ['.claude/settings.json', false],
  ['docs/skill-authoring-convention.md', false],
  ['scripts/lint-skills.mjs', false],
  ['pipeline.yml', false],
  ['sub/pipeline.yaml', false],
  ['skills/foo/bar.txt', false],
  ['CLAUDE.md', false],
];

test('isLintTarget / isRule6OnlyFile: 代表パスの対象判定', () => {
  for (const [p, expected] of TARGET_CASES) {
    assert.equal(isLintTarget(p), expected, `isLintTarget(${p})`);
  }
  // Rule 6 のみのファイルは isLintTarget にも含まれる（部分集合）
  for (const [p] of TARGET_CASES) {
    if (isRule6OnlyFile(p)) assert.equal(isLintTarget(p), true, `rule6-only ⊆ target: ${p}`);
  }
});

test('workflow の grep 正規表現と linter 側 isLintTarget が同一判定（更新漏れ検出）', () => {
  const yml = readFileSync(WORKFLOW, 'utf8');
  const m = yml.match(/grep -E '([^']+)'/);
  assert.ok(m, 'workflow から grep -E パターンを抽出できる');
  const ymlRe = new RegExp(m[1]);
  for (const [p, expected] of TARGET_CASES) {
    assert.equal(ymlRe.test(p), expected, `workflow grep (${p})`);
    assert.equal(ymlRe.test(p), isLintTarget(p), `workflow grep ≡ isLintTarget (${p})`);
  }
});

test('git ls-files の pathspec が isLintTarget の対象を全て被覆する（--all の取り逃し検出）', () => {
  for (const [p, expected] of TARGET_CASES) {
    if (!expected) continue;
    const covered = LS_FILES_PATHSPEC.some((root) => p === root || p.startsWith(`${root}/`));
    assert.ok(covered, `pathspec が ${p} を被覆する`);
  }
});

// ── path 正規化 ──────────────────────────────────────────────

test('normalizeArg: 先頭 ./ / 絶対パスを repo ルート相対へ正規化する', () => {
  assert.equal(normalizeArg('./pipeline.yaml', REPO_ROOT), 'pipeline.yaml');
  assert.equal(normalizeArg('pipeline.yaml', REPO_ROOT), 'pipeline.yaml');
  assert.equal(normalizeArg(join(REPO_ROOT, 'pipeline.yaml'), REPO_ROOT), 'pipeline.yaml');
  assert.equal(
    normalizeArg(join(REPO_ROOT, 'skills/12-design-system/SKILL.md'), REPO_ROOT),
    'skills/12-design-system/SKILL.md'
  );
  // repo 外は '..' 始まりの相対になり対象判定から外れる（＝スキップ表示の対象）
  assert.ok(normalizeArg('/tmp/pipeline.yaml', REPO_ROOT).startsWith('..'));
});

// ── Rule 6 警告（行番号 + フェンス / インラインコード除外）─────────────────

test('metaInfoWarnings: 行番号付き・フェンス / インラインコード内は除外・同一トークンは行を集約', () => {
  const content = [
    '# title', // L1
    'POCTEAMA-123 と 2026-01-02 を含む行', // L2
    '```', // L3
    'POCTEAMA-999 2026-12-31 （フェンス内 — 除外）', // L4
    '```', // L5
    'inline `POCTEAMA-888` は除外', // L6
    'POCTEAMA-123 が再出現する行', // L7
  ].join('\n');
  const warnings = metaInfoWarnings(content);
  const byToken = new Map(warnings.map((w) => [w.token, w]));

  assert.deepEqual(byToken.get('POCTEAMA-123')?.lines, [2, 7], 'フェンス除去後も行番号が保たれる');
  assert.deepEqual(byToken.get('2026-01-02')?.lines, [2]);
  assert.equal(byToken.has('POCTEAMA-999'), false, 'コードフェンス内は対象外');
  assert.equal(byToken.has('2026-12-31'), false, 'コードフェンス内は対象外');
  assert.equal(byToken.has('POCTEAMA-888'), false, 'インラインコード内は対象外');
  assert.equal(byToken.get('POCTEAMA-123')?.kind, 'ticket');
  assert.equal(byToken.get('2026-01-02')?.kind, 'date');
});

// ── baseline (ratchet) ──────────────────────────────────────

test('baseline: 既知分は抑制し、超過 / 新規だけ表示する', () => {
  const results = [
    { file: 'pipeline.yaml', errors: [], warnings: [{ kind: 'ticket', token: 'POCTEAMA-1', lines: [10, 20] }] },
  ];
  const baseline = buildBaseline(results);
  assert.deepEqual(baseline.entries, [{ file: 'pipeline.yaml', kind: 'ticket', token: 'POCTEAMA-1', count: 2 }]);

  // 同定キーは実装内部の区切りに依存するため、baseline JSON → loadBaseline の実経路で counts を得る
  const tmp = mkdtempSync(join(tmpdir(), 'lint-skills-test-'));
  writeFileSync(join(tmp, 'baseline.json'), JSON.stringify(baseline, null, 2));
  const counts = loadBaseline('baseline.json', tmp);
  rmSync(tmp, { recursive: true, force: true });

  // 同数以下 → 抑制
  const same = applyBaseline('pipeline.yaml', [{ kind: 'ticket', token: 'POCTEAMA-1', lines: [10, 20] }], counts);
  assert.equal(same.shown.length, 0);
  assert.equal(same.suppressed, 1);

  // 掃除が進んで減った場合も抑制（表示ノイズなし。縮小は --write-baseline で行う）
  const fewer = applyBaseline('pipeline.yaml', [{ kind: 'ticket', token: 'POCTEAMA-1', lines: [10] }], counts);
  assert.equal(fewer.shown.length, 0);

  // 超過 → 表示 + 超過注記
  const more = applyBaseline(
    'pipeline.yaml',
    [{ kind: 'ticket', token: 'POCTEAMA-1', lines: [10, 20, 30] }],
    counts
  );
  assert.equal(more.shown.length, 1);
  assert.match(more.shown[0].note, /baseline 許容 2 行を超過/);

  // baseline 未登録（新規トークン / 別ファイル）→ 表示
  const fresh = applyBaseline('pipeline.yaml', [{ kind: 'ticket', token: 'POCTEAMA-2', lines: [5] }], counts);
  assert.equal(fresh.shown.length, 1);
  assert.equal(fresh.shown[0].note, '');
  const otherFile = applyBaseline('skills/x/SKILL.md', [{ kind: 'ticket', token: 'POCTEAMA-1', lines: [5] }], counts);
  assert.equal(otherFile.shown.length, 1);
});

// ── CLI smoke（レビュー指摘の再現ケース: `./` 付き path が 0 件検査で成功表示にならない）──

const runCli = (...args) =>
  execFileSync('node', [join(REPO_ROOT, 'scripts/lint-skills.mjs'), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

test('CLI: ./pipeline.yaml でも正規化されて 1 件検査される', () => {
  const out = runCli('./pipeline.yaml', '--baseline', 'scripts/lint-skills.baseline.json');
  assert.match(out, /pipeline\.yaml/);
  assert.match(out, /1 件検査/);
  assert.doesNotMatch(out, /0 件検査/);
});

test('CLI: 対象外 path は黙って落とさず「対象外パス（スキップ）」を表示する', () => {
  const out = runCli('docs/skill-authoring-convention.md');
  assert.match(out, /対象外パス（スキップ）: docs\/skill-authoring-convention\.md/);
  assert.match(out, /0 件検査/);
});
