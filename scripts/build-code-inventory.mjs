#!/usr/bin/env node
// Build a deterministic file inventory + read plan for the reverse Step 02 code pass (B2)
// from the user-provided source tree under artifacts/{app}/input-sources/{stack}/.
//
// Why this exists: a production repo holds thousands of files, but only a fraction
// (entry points, navigation, screens, view models, models, data layer, config) carries
// requirements evidence. Letting the analysis pass "read everything" blows the context
// budget; letting it improvise a subset hides what was skipped. This script classifies
// every file up front — no LLM call, zero token cost, same result on every run — so the
// budget gate can ask "analyze these N files (~M tokens)?" with real numbers, and the
// shard plan can hand each analysis subagent a bounded slice.
//
// Input:  artifacts/{app}/input-sources/{stack}/ (every stack dir; the reserved docs/
//         dir is user-provided documents, not code, and is never scanned)
// Output: artifacts/{app}/reverse-engineered/.code-inventory.json
//         + a human-readable proposal table on stdout (for the budget gate)
//
// Tiers (every file lands in exactly one bucket; buckets are labels, not filters —
// nothing is silently dropped, excluded files keep their reason in the inventory):
//   entry       — app entry points, manifests, top-level README (tech-stack evidence)
//   navigation  — routes / nav graphs / routers (the screen list backbone)
//   screen      — screens / pages / views / activities / fragments / layout XML
//   state       — view models / stores / hooks / use cases / behavioral services
//   model       — domain models / entities / DTOs
//   api         — data layer: API clients, repositories, local storage
//   config      — app config / feature flags / DI wiring / environment
//   other_source — remaining readable source (opt-in at the budget gate)
//   excluded    — not analysis input, with reason: test / generated / asset /
//                 build_output / dependency / lockfile / binary / oversized / symlink
// Dependency/build directories are pruned without walking their contents (a
// node_modules can hold 100k files); the pruned dir itself is recorded in
// excluded_dirs so the skip stays visible.
//
// Shard plan: in-scope files grouped by module (deepest manifest-bearing dir, else
// first path segment; src|lib|app get one extra segment). A module larger than the
// budget is volume-split into shards of its own; SMALL modules are packed together
// into shared shards (shards[].modules lists every packed module) — each worker
// launch carries a large fixed cost regardless of content, so fewer, fuller shards
// dominate total cost. Analysis shards return findings only (no transcription echo),
// so the per-shard budget can sit higher than the doc-collection batch budget.
//
// Estimation formulas (deterministic, shown on the proposal table):
//   est_tokens  ≈ shards × EST_SHARD_OVERHEAD_TOKENS + in-scope chars ÷ 3.5 × 1.2
//               (per-worker fixed cost dominates: a 1-file shard was measured at
//                ~100k tokens — system prompt + tool schemas + auto-attached
//                project docs + tool-use echoes — vs ~2k tokens of content)
//   est_minutes ≈ shards × 2〜3 min ÷ min(8, shards)   (assumes 8 parallel workers)
//
// Usage: node scripts/build-code-inventory.mjs <app_name> [--tiers <csv>] [--modules <csv>] [--require-files <csv>] [--out <path>] [--stdout]
//   --tiers    comma-separated tier names treated as in-scope
//              (default: entry,navigation,screen,state,model,api,config)
//   --modules  comma-separated module keys treated as in-scope (default: all)
//   --require-files
//              comma-separated file paths the caller's scope derivation named (citations
//              / grep hits). Module selection and the tier filter are orthogonal: a
//              module-level plan can silently drop exactly the files the derivation
//              cited (e.g. a file classified other_source). Named files are PINNED into
//              the plan (in_scope) regardless of tier — tier is a machine guess and an
//              explicit citation outranks it. Module misses stay hard errors (exit 1
//              with the --modules extension to re-run with): the module set is the
//              human-approved scope boundary, and pinning across it would silently
//              override that decision. Unresolvable paths (typo / excluded / pruned
//              dir) also exit 1. Accepts citation forms as-is: a leading
//              artifacts/{app_name}/ prefix and a trailing :line / :line-line anchor
//              are stripped. Pinned files are recorded in selection.require_files and
//              flagged files[].pinned for audit.
//   --out      write the ledger to this path instead of the default
//              reverse-engineered/.code-inventory.json. Lets a caller that scopes its
//              own read plan (e.g. a targeted cross-check over one feature) keep its
//              plan in its own file, so the reverse ledger that reverse resume and its
//              shard workers read is never clobbered. Constrained twice: the path must
//              stay under artifacts/{app_name}/ AND its basename must be
//              .code-inventory.json. The second constraint matters because this write
//              goes through Bash — outside the PreToolUse Write|Edit matcher — so
//              overwriting requirements.json or pipeline-state.json here would bypass
//              both the backup and the schema-check hook and be unrecoverable.
//              Mutually exclusive with --stdout (preview writes nothing by design).
//   --stdout   PREVIEW MODE: JSON to stdout, proposal table to stderr, and the
//              .code-inventory.json ledger file is deliberately NOT written — this
//              lets the budget gate preview an alternative scope (e.g. all tiers)
//              without clobbering the confirmed ledger that resume and the shard
//              workers read. The confirming run must be executed without --stdout.
// Exit: 0 = inventory written (or previewed with --stdout) / 1 = usage, path, or
//       scope(plan) error (unknown tier/module, empty plan, require-files miss —
//       fixable by re-scoping) / 2 = internal error (I/O crash etc.)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep, basename } from 'node:path';

// Internal failures (EISDIR/ENOTDIR/permission …) must not exit 1 — callers treat
// exit 1 as "plan/path problem to fix by re-scoping", which a crash is not.
const die = (err) => {
  console.error(`internal error: ${err?.message ?? err}`);
  process.exit(2);
};
process.on('uncaughtException', die);
process.on('unhandledRejection', die);

const DEFAULT_TIERS = ['entry', 'navigation', 'screen', 'state', 'model', 'api', 'config'];
// 読み取り計画の正式ファイル名。--out はこの名前に限る (下記の理由)。
const CODE_INVENTORY_BASENAME = '.code-inventory.json';
// Budget-gate thresholds (SoT — the Step 02 / phase prose references
// summary.budget_gate instead of repeating these numbers): a plan at or below BOTH
// limits auto-passes the gate without asking; above either limit the gate halts &
// asks with the proposal-table numbers.
const GATE_FILE_LIMIT = 120;
const GATE_CHAR_LIMIT = 400_000;
const SHARD_CHAR_BUDGET = 120_000; // per analysis shard (findings-only return; ~34k tokens of content fits comfortably)
const SHARD_FILE_CAP = 40; // tool-call overhead bound, independent of file size
const OVERSIZED_CHARS = 250_000; // single files above this are almost always generated/vendored
const BINARY_SNIFF_BYTES = 8_192; // NUL byte within this prefix → binary
// A trailing newline is a line terminator, not an extra line — split('\n') alone
// counts the empty tail element and inflates loc by 1, which lets EOF+1 citations pass.
const lineCountOf = (text) => {
  const parts = text.split('\n');
  return parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
};
const EST_CHARS_PER_TOKEN = 3.5;
const EST_FINDINGS_OVERHEAD = 1.2;
// Fixed cost per worker launch, measured on a real run (43 shards / 773-file KMP repo):
// a 1-file 7k-char shard consumed ~100k tokens — the launch itself (system prompt,
// tool schemas, auto-attached project docs, tool-use echoes) dwarfs the content.
// Measured with a general-purpose worker; recalibrate downward once the dedicated
// lean analysis worker (fewer tool schemas) is in use.
const EST_SHARD_OVERHEAD_TOKENS = 100_000;
const EST_WORKERS = 8;
const AUTO_ATTACH_WARN_CHARS = 20_000; // in-tree CLAUDE.md above this inflates every worker launch

const args = process.argv.slice(2);
const valueFlagIdx = (name) => args.indexOf(name);
const valueOf = (name) => {
  const i = valueFlagIdx(name);
  return i >= 0 ? args[i + 1] : null;
};
// value flags take the next arg, so those values must not be mistaken for the positional app_name
const VALUE_FLAGS = ['--tiers', '--modules', '--out', '--require-files'];
// valueOf reads only the first occurrence — a repeated flag would silently drop its
// later values (the opposite of what a caller repeating a flag intends), so reject it.
for (const name of VALUE_FLAGS) {
  if (args.indexOf(name) !== args.lastIndexOf(name)) {
    console.error(`${name} は 1 回だけ指定してください (2 回目以降の値は読まれない — csv で 1 回にまとめる)`);
    process.exit(1);
  }
}
const valueIdxs = new Set(
  VALUE_FLAGS.map(valueFlagIdx).filter((i) => i >= 0).map((i) => i + 1),
);
const appName = args.find((a, i) => !a.startsWith('--') && !valueIdxs.has(i));
const toStdout = args.includes('--stdout');
if (!appName) {
  console.error(
    'Usage: node scripts/build-code-inventory.mjs <app_name> [--tiers <csv>] [--modules <csv>] [--require-files <csv>] [--out <path>] [--stdout]',
  );
  process.exit(1);
}
// app_name is a directory name under artifacts/, never a path — reject separators
// so `../x` cannot write outside the artifacts tree.
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(appName)) {
  console.error(`invalid app_name: ${appName} (英数字と . _ - のみ — パス区切りは使えません)`);
  process.exit(1);
}
// --out and --stdout state opposite intents (write the plan here / write no plan at
// all). Silently letting --stdout win would leave the caller believing a ledger exists
// and the workers failing later with "inventory not found" — reject the contradiction
// here instead, where the message can name it.
if (toStdout && valueOf('--out') !== null) {
  console.error('--out と --stdout は同時に指定できません (--stdout は台帳を書かない preview モード)');
  process.exit(1);
}
const outPath = (() => {
  const defaultPath = join('artifacts', appName, 'reverse-engineered', CODE_INVENTORY_BASENAME);
  const arg = valueOf('--out');
  if (arg === null) return defaultPath;
  if (!arg || arg.startsWith('--')) {
    console.error('--out にパスを指定してください');
    process.exit(1);
  }
  // Confine writes to the app's own artifacts dir (`..` segments resolve away first,
  // so a traversal cannot land outside). The dir itself is not an output target.
  const appRoot = resolve('artifacts', appName);
  const resolved = resolve(arg);
  if (!resolved.startsWith(appRoot + sep)) {
    console.error(`--out は artifacts/${appName}/ 配下のパスを指定してください: ${arg}`);
    process.exit(1);
  }
  // Narrow further to this script's own artifact name. Confining to the app dir alone
  // still allows clobbering requirements.json / pipeline-state.json / tokens.json, and
  // this write goes through Bash — outside the PreToolUse Write|Edit matcher — so the
  // backup and schema-check hooks never see it and the overwrite is unrecoverable.
  // A read plan is only ever consumed under its canonical basename, so pinning the
  // basename costs callers nothing.
  if (basename(resolved) !== CODE_INVENTORY_BASENAME) {
    console.error(
      `--out のファイル名は ${CODE_INVENTORY_BASENAME} にしてください (指定: ${basename(resolved)})\n` +
        'app 配下の任意 JSON を上書きできてしまうと、Bash 経由の書き込みは backup / schema hook を通らず復旧できません',
    );
    process.exit(1);
  }
  return arg;
})();
const scopeTiers = (valueOf('--tiers') ?? DEFAULT_TIERS.join(','))
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const scopeModules = valueOf('--modules')
  ? valueOf('--modules').split(',').map((m) => m.trim()).filter(Boolean)
  : null; // null = all modules
// --require-files: files the caller's scope derivation named (citations / grep hits).
// Normalized here so citation strings can be passed unchanged. A value that degenerates
// to zero paths (commas / whitespace only) is rejected — an empty pin list would make
// the whole check vacuously pass, which is exactly the silent drop the flag exists to
// prevent.
const requireFiles = (() => {
  const arg = valueOf('--require-files');
  if (arg === null) return null;
  if (!arg || arg.startsWith('--')) {
    console.error('--require-files にパス (csv) を指定してください');
    process.exit(1);
  }
  const prefix = `artifacts/${appName}/`;
  const list = arg
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p).replace(/:\d+(-\d+)?$/, ''));
  if (list.length === 0) {
    console.error('--require-files の値に有効なパスがありません (区切り文字・空白のみ) — パス (csv) を指定してください');
    process.exit(1);
  }
  return list;
})();

const inputRoot = join('artifacts', appName, 'input-sources');
if (!existsSync(inputRoot)) {
  console.error(`not found: ${inputRoot}`);
  process.exit(1);
}
const rootEntries = readdirSync(inputRoot, { withFileTypes: true });
const stacks = rootEntries
  .filter((e) => e.isDirectory() && e.name !== 'docs' && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort();
// Plain files directly under input-sources/ belong to no {stack} and would vanish
// from the ledger without a trace — surface them ("no file disappears silently").
const unassignedRootFiles = rootEntries.filter((e) => e.isFile()).map((e) => e.name).sort();
if (stacks.length === 0) {
  console.error(`no {stack} directory under ${inputRoot} (reserved docs/ is not code)`);
  process.exit(1);
}

// ── classification rules ─────────────────────────────────────────────────────
// Pruned without walking: their contents are third-party / regenerable, and walking
// a node_modules-scale tree costs more than the information is worth.
const PRUNE_DIRS = new Map([
  ['node_modules', 'dependency'],
  ['Pods', 'dependency'],
  ['Carthage', 'dependency'],
  ['vendor', 'dependency'],
  ['venv', 'dependency'],
  ['.venv', 'dependency'],
  ['site-packages', 'dependency'],
  ['.git', 'dependency'],
  ['.gradle', 'build_output'],
  ['build', 'build_output'],
  ['dist', 'build_output'],
  ['out', 'build_output'],
  ['.next', 'build_output'],
  ['.expo', 'build_output'],
  ['.turbo', 'build_output'],
  ['.dart_tool', 'build_output'],
  ['DerivedData', 'build_output'],
  ['__pycache__', 'build_output'],
  ['coverage', 'build_output'],
  ['.idea', 'build_output'],
  ['.vscode', 'build_output'],
]);
const TEST_DIRS = /^(test|tests|__tests__|androidTest|androidUnitTest|commonTest|iosTest|unitTest|jsTest|e2e|__mocks__|spec)$/i;
const TEST_FILE = /(\.test\.|\.spec\.|Tests?\.(kt|kts|java|swift|scala)$|_test\.(go|py|dart|ts|tsx|js|jsx)$)/;
const GENERATED_FILE = /(\.g\.dart$|\.freezed\.dart$|\.pb\.|_pb2\.py$|\.generated\.|\.min\.(js|css)$|\.bundle\.js$|\.map$)/;
const ASSET_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|icns|pdf|ttf|otf|woff2?|eot|mp3|mp4|wav|mov|avi|zip|gz|tar|jar|aar|keystore|jks|p12|mobileprovision|xcassets)$/i;
const BINARY_EXT = /\.(class|o|so|dylib|a|bin|exe|dll|wasm|realm|db|sqlite3?)$/i;
const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Podfile.lock',
  'gradle.lockfile', 'Gemfile.lock', 'pubspec.lock', 'poetry.lock', 'Cargo.lock',
]);
const MANIFEST_FILES = new Set([
  'package.json', 'pubspec.yaml', 'build.gradle', 'build.gradle.kts',
  'settings.gradle', 'settings.gradle.kts', 'Package.swift', 'Podfile', 'go.mod',
  'pyproject.toml', 'requirements.txt', 'Cargo.toml',
]);

// First match wins, top to bottom. Directory segments and file names both carry
// signal; the name-suffix rules absorb repos that do not follow the segment
// conventions (this table subsumes the per-stack read-order lists that the Step 02
// skill used to hardcode for KMP / React Native only).
const tierOf = (segs, name) => {
  const inSeg = (re) => segs.some((s) => re.test(s));
  if (MANIFEST_FILES.has(name) || /^(AndroidManifest\.xml|Info\.plist|app\.json|app\.config\.(js|ts)|next\.config\.(js|mjs|ts)|libs\.versions\.toml)$/.test(name)) return 'entry';
  if (segs.length <= 1 && /^README\.md$/i.test(name)) return 'entry';
  if (/^(main|index)\.(kt|swift|ts|tsx|js|jsx|dart|py|go)$/i.test(name) && segs.length <= 3) return 'entry';
  if (/^(App|Application|MainActivity|MainApplication|AppDelegate|SceneDelegate|.*App)\.(kt|java|swift|tsx|jsx|ts|js|dart)$/.test(name)) return 'entry';
  // Next.js App Router: routing is filename-conventioned (app/**/page.tsx …), not
  // directory-conventioned — without these rules an App Router repo classifies as
  // almost entirely other_source and the default plan reads nothing but package.json.
  if (segs.length <= 1 && /^middleware\.(ts|js)$/.test(name)) return 'navigation';
  if (/^route\.(ts|js)$/.test(name)) return 'api';
  if (/^(page|layout|template|loading|error|not-found|default)\.(tsx|jsx|ts|js)$/.test(name)) return 'screen';
  // Flutter snake_case conventions (home_page.dart など screens/ ディレクトリなし配置)
  if (/_(page|screen|view)\.dart$/.test(name)) return 'screen';
  if (/_(bloc|cubit|view_model)\.dart$/.test(name)) return 'state';
  if (inSeg(/^(navigation|navigations|router|routers|routes|routing)$/i) || /(Route|Routes|Router|NavGraph|NavHost|Navigator|NavConfig|Navigation)\.[a-z]+$/i.test(name)) return 'navigation';
  if (inSeg(/^(screens?|pages?|views?|layout)$/i) || /(Screen|Page|Activity|Fragment|ViewController|View)\.(kt|java|swift|tsx|jsx|ts|js|dart|vue|xml)$/.test(name)) return 'screen';
  if (inSeg(/^(viewmodels?|stores?|state|contexts?|hooks|blocs?|usecases?|interactors?)$/i) || /(ViewModel|Presenter|Store|Reducer|Bloc|Cubit|UseCase|Interactor)\.[a-z]+$/i.test(name) || /^use[A-Z][A-Za-z]*\.(ts|tsx|js|jsx)$/.test(name) || /(Audio|Video|Media|Sound)(Player|Manager|Service)|Upload/i.test(name)) return 'state';
  if (inSeg(/^(models?|entit(y|ies)|dtos?|domain)$/i) || /(Model|Entity|Dto|DTO)\.[a-z]+$/i.test(name)) return 'model';
  if (inSeg(/^(api|apis|remote|network|services?|repositor(y|ies)|clients?|data|local|storage|persistence|datastore)$/i) || /(Api|Service|Repository|Client|Storage|Prefs|Preferences|DataStore)\.[a-z]+$/i.test(name)) return 'api';
  if (inSeg(/^(config|configs|di|injection|env)$/i) || /(Config|Configuration|FeatureFlags?|Constants|Environment)\.[a-z]+$/i.test(name)) return 'config';
  return 'other_source';
};

const excludeReasonOf = (segs, name, dirent) => {
  if (dirent.isSymbolicLink()) return 'symlink';
  // Credential-bearing files must never enter worker context: a cited API-key line
  // would flow into raw-analysis.md and onward to the Confluence save. Excluded
  // with a recorded reason (visible in the ledger), not silently dropped.
  if (/^\.env(\..+)?$/.test(name) || /\.(pem|key|p8)$/i.test(name) || /^(local\.properties|\.npmrc|\.netrc)$/.test(name) || /^id_rsa/.test(name)) return 'secret';
  if (LOCKFILES.has(name)) return 'lockfile';
  if (segs.some((s) => TEST_DIRS.test(s)) || TEST_FILE.test(name)) return 'test';
  if (GENERATED_FILE.test(name) || segs.some((s) => /^generated$/i.test(s))) return 'generated';
  if (ASSET_EXT.test(name) || segs.some((s) => /\.xcassets$/i.test(s))) return 'asset';
  if (BINARY_EXT.test(name)) return 'binary';
  return null;
};

// ── walk ─────────────────────────────────────────────────────────────────────
const files = []; // { path, stack, module, tier, loc, chars } or { path, excluded: reason }
const excludedDirs = []; // { path, reason } — pruned, contents not walked
const manifestDirs = new Set(); // stack-relative dir keys that contain a build manifest

const walk = (stack, relDir) => {
  const abs = join(inputRoot, stack, relDir);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    const relPath = `input-sources/${stack}/${rel}`;
    if (e.isDirectory()) {
      // withFileTypes dirents use lstat semantics: a symlink pointing at a directory
      // reports isDirectory()=false, so it never reaches this branch — it falls to
      // the file path below and is recorded in files[] as excluded: 'symlink'.
      const prune = PRUNE_DIRS.get(e.name);
      if (prune) {
        excludedDirs.push({ path: relPath, reason: prune });
        continue;
      }
      walk(stack, rel);
      continue;
    }
    if (!e.isFile() && !e.isSymbolicLink()) continue;
    const segs = rel.split('/').slice(0, -1);
    if (MANIFEST_FILES.has(e.name)) manifestDirs.add(`${stack}\x00${segs.join('/')}`);
    const reason = excludeReasonOf(segs, e.name, e);
    if (reason) {
      files.push({ path: relPath, stack, excluded: reason });
      continue;
    }
    let buf;
    try {
      buf = readFileSync(join(abs, e.name));
    } catch {
      files.push({ path: relPath, stack, excluded: 'unreadable' });
      continue;
    }
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      files.push({ path: relPath, stack, excluded: 'binary' });
      continue;
    }
    const content = buf.toString('utf8');
    if (content.length > OVERSIZED_CHARS) {
      files.push({ path: relPath, stack, excluded: 'oversized', chars: content.length });
      continue;
    }
    files.push({
      path: relPath,
      stack,
      rel,
      tier: tierOf(segs, e.name),
      loc: lineCountOf(content),
      chars: content.length,
    });
  }
};
if (unassignedRootFiles.length) {
  const hasManifest = unassignedRootFiles.some((n) => MANIFEST_FILES.has(n));
  console.error(
    `[build-code-inventory] WARNING: input-sources/ 直下にファイルが ${unassignedRootFiles.length} 件あります` +
      ` (${unassignedRootFiles.slice(0, 5).join(', ')}${unassignedRootFiles.length > 5 ? ' …' : ''})` +
      ` — {stack}/ 配下ではないため解析対象に入りません` +
      (hasManifest
        ? '。build manifest が直下にある = {stack} ディレクトリ無しでリポジトリを直置きした可能性が高い — input-sources/{stack}/ へ移動してください'
        : ''),
  );
}
for (const stack of stacks) walk(stack, '');

// ── module assignment: deepest manifest-bearing ancestor dir (monorepo modules),
//    else first path segment; src|lib|app roots get one extra segment so a flat
//    single-manifest repo still splits into meaningful slices.
const SRC_LIKE = /^(src|lib|app)$/;
const moduleOf = (f) => {
  const segs = f.rel.split('/').slice(0, -1);
  for (let d = segs.length; d > 0; d--) {
    const key = `${f.stack}\x00${segs.slice(0, d).join('/')}`;
    if (manifestDirs.has(key)) return `${f.stack}/${segs.slice(0, d).join('/')}`;
  }
  if (segs.length === 0) return `${f.stack}/(root)`;
  if (SRC_LIKE.test(segs[0]) && segs.length >= 2) return `${f.stack}/${segs[0]}/${segs[1]}`;
  return `${f.stack}/${segs[0]}`;
};
for (const f of files) {
  if (!f.excluded) f.module = moduleOf(f);
}

// ── scope + aggregation ──────────────────────────────────────────────────────
const unknownTiers = scopeTiers.filter((t) => !DEFAULT_TIERS.includes(t) && t !== 'other_source');
if (unknownTiers.length) {
  console.error(`unknown tier(s): ${unknownTiers.join(', ')} (valid: ${[...DEFAULT_TIERS, 'other_source'].join(', ')})`);
  process.exit(1);
}
const inScope = (f) =>
  !f.excluded && scopeTiers.includes(f.tier) && (scopeModules === null || scopeModules.includes(f.module));
for (const f of files) {
  if (!f.excluded) f.in_scope = inScope(f);
}

// --require-files: pin derivation-named files into the plan before any aggregation
// (shards are assembled from in_scope files — pinning later would assert but not read).
// Tier misses are pinned in: tier is a machine heuristic and an explicit citation
// outranks it. Module misses stay hard errors: the module set is the human-approved
// scope boundary, and pinning across it would silently override that decision.
const pinnedFiles = [];
if (requireFiles) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const problems = [];
  const missingModules = new Set();
  for (const p of requireFiles) {
    const f = byPath.get(p);
    if (!f) {
      const dir = excludedDirs.find((d) => p.startsWith(d.path + '/'));
      problems.push(
        dir
          ? `  ${p} — 未走査 dir 配下 (${dir.path}: ${dir.reason}) のため計画に入れられません`
          : `  ${p} — 台帳に無い (パス誤り? 有効な形: input-sources/{stack}/…)`,
      );
      continue;
    }
    if (f.excluded) {
      problems.push(`  ${p} — 除外済み (${f.excluded}) のため計画に入れられません`);
      continue;
    }
    if (scopeModules && !scopeModules.includes(f.module)) {
      problems.push(`  ${p} — module ${f.module} が --modules 外`);
      missingModules.add(f.module);
      continue;
    }
    if (!f.in_scope) {
      f.in_scope = true;
      f.pinned = true;
      pinnedFiles.push(p);
    }
  }
  if (problems.length) {
    console.error(
      `--require-files のうち計画に入れられないファイルがあります (${problems.length} 件):\n${problems.join('\n')}` +
        (missingModules.size
          ? `\n対応: 範囲に含めるなら --modules ${[...(scopeModules ?? []), ...missingModules].join(',')} で再実行 / ` +
            '意図的に除外した module なら --require-files から当該ファイルを外す (除外した事実は範囲ゲートで報告する)'
          : ''),
    );
    process.exit(1);
  }
}

const sum = (list, key) => list.reduce((a, f) => a + (f[key] ?? 0), 0);
const sourceFiles = files.filter((f) => !f.excluded);
const scopedFiles = sourceFiles.filter((f) => f.in_scope);

const excludedCounts = {};
for (const f of files) {
  if (f.excluded) excludedCounts[f.excluded] = (excludedCounts[f.excluded] ?? 0) + 1;
}
const tierStats = {};
for (const t of [...DEFAULT_TIERS, 'other_source']) {
  const list = sourceFiles.filter((f) => f.tier === t);
  tierStats[t] = { files: list.length, loc: sum(list, 'loc'), chars: sum(list, 'chars') };
}
const moduleMap = new Map();
for (const f of sourceFiles) {
  if (!moduleMap.has(f.module)) moduleMap.set(f.module, []);
  moduleMap.get(f.module).push(f);
}
// --modules is hand-typed at the budget gate — a typo must not silently produce an
// empty "confirmed" plan (the code pass would then read nothing and still proceed).
if (scopeModules) {
  const unknownModules = scopeModules.filter((m) => !moduleMap.has(m));
  if (unknownModules.length) {
    console.error(
      `unknown module(s): ${unknownModules.join(', ')}\n` +
        `valid modules: ${[...moduleMap.keys()].sort().join(', ')}`,
    );
    process.exit(1);
  }
}
if (scopedFiles.length === 0) {
  console.error(
    `in-scope が 0 件です (tiers: ${scopeTiers.join(',') || '(空)'}${scopeModules ? ` / modules: ${scopeModules.join(',')}` : ''}) — 空の読み取り計画は書き出しません。範囲指定を見直してください`,
  );
  process.exit(1);
}
const modules = [...moduleMap.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([mod, list]) => {
    const scoped = list.filter((f) => f.in_scope);
    const tiers = {};
    for (const f of list) tiers[f.tier] = (tiers[f.tier] ?? 0) + 1;
    return {
      module: mod,
      files: list.length,
      in_scope_files: scoped.length,
      loc: sum(list, 'loc'),
      chars: sum(list, 'chars'),
      in_scope_chars: sum(scoped, 'chars'),
      tiers,
    };
  });

// ── shard plan: a large module (over budget/cap) is volume-split into shards of its
//    own; small modules are PACKED together into shared shards (a module is never
//    split across a packed shard). Tier order inside each module keeps the priority
//    reading order (entry → navigation → …) that the skill used to prescribe.
const tierRank = new Map([...DEFAULT_TIERS, 'other_source'].map((t, i) => [t, i]));
const shards = [];
const newShard = () => {
  const s = { id: shards.length + 1, modules: [], files: [], loc: 0, chars: 0 };
  shards.push(s);
  return s;
};
const addFiles = (shard, mod, fileList) => {
  if (!shard.modules.includes(mod)) shard.modules.push(mod);
  for (const f of fileList) {
    shard.files.push(f.path);
    shard.loc += f.loc;
    shard.chars += f.chars;
  }
};
let packShard = null; // open shared shard that small modules keep joining
for (const [mod, list] of [...moduleMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const scoped = list
    .filter((f) => f.in_scope)
    .sort((a, b) => tierRank.get(a.tier) - tierRank.get(b.tier) || a.path.localeCompare(b.path));
  if (scoped.length === 0) continue;
  const modChars = sum(scoped, 'chars');
  const isSmall = modChars <= SHARD_CHAR_BUDGET && scoped.length <= SHARD_FILE_CAP;
  if (isSmall) {
    const fits =
      packShard &&
      packShard.chars + modChars <= SHARD_CHAR_BUDGET &&
      packShard.files.length + scoped.length <= SHARD_FILE_CAP;
    if (!fits) packShard = newShard();
    addFiles(packShard, mod, scoped);
  } else {
    let cur = null;
    for (const f of scoped) {
      const fits = cur && cur.chars + f.chars <= SHARD_CHAR_BUDGET && cur.files.length < SHARD_FILE_CAP;
      if (!fits) cur = newShard();
      addFiles(cur, mod, [f]);
      // A single file between SHARD_CHAR_BUDGET and OVERSIZED_CHARS lands alone in
      // its own shard but still exceeds the per-shard budget — flag it so the gate
      // (and the worker) see the documented invariant is intentionally waived here.
      if (cur.chars > SHARD_CHAR_BUDGET) cur.over_budget = true;
    }
  }
}
const overBudgetShards = shards.filter((sh) => sh.over_budget);
if (overBudgetShards.length) {
  console.error(
    `[build-code-inventory] WARNING: shard 予算 (${SHARD_CHAR_BUDGET.toLocaleString('en-US')} 字) を超える単一ファイル shard が ${overBudgetShards.length} 件 (id: ${overBudgetShards.map((sh) => sh.id).join(', ')}) — 1 ファイル単独で隔離済み。context 逼迫が心配なら該当ファイルを分割して再配置`,
  );
}

const totalChars = sum(scopedFiles, 'chars');
const estContentTokens = Math.round((totalChars / EST_CHARS_PER_TOKEN) * EST_FINDINGS_OVERHEAD);
const estOverheadTokens = shards.length * EST_SHARD_OVERHEAD_TOKENS;
const estTokens = estOverheadTokens + estContentTokens;
const parallel = Math.max(1, Math.min(EST_WORKERS, shards.length));
const estMinutes = shards.length
  ? `${Math.ceil((shards.length * 2) / parallel)}〜${Math.ceil((shards.length * 3) / parallel)}`
  : '0';

const output = {
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  input_root: inputRoot,
  stacks,
  selection: { tiers: scopeTiers, modules: scopeModules ?? 'all', require_files: requireFiles ?? 'none' },
  constants: {
    gate_file_limit: GATE_FILE_LIMIT,
    gate_char_limit: GATE_CHAR_LIMIT,
    shard_char_budget: SHARD_CHAR_BUDGET,
    shard_file_cap: SHARD_FILE_CAP,
    oversized_chars: OVERSIZED_CHARS,
    est_shard_overhead_tokens: EST_SHARD_OVERHEAD_TOKENS,
  },
  summary: {
    budget_gate: {
      exceeded: scopedFiles.length > GATE_FILE_LIMIT || totalChars > GATE_CHAR_LIMIT,
      threshold_files: GATE_FILE_LIMIT,
      threshold_chars: GATE_CHAR_LIMIT,
    },
    total_files: files.length,
    source_files: sourceFiles.length,
    excluded: excludedCounts,
    excluded_dirs: excludedDirs.length,
    unassigned_root_files: unassignedRootFiles,
    tiers: tierStats,
    in_scope: {
      files: scopedFiles.length,
      loc: sum(scopedFiles, 'loc'),
      chars: totalChars,
      est_tokens: estTokens,
      est_tokens_overhead: estOverheadTokens,
      est_tokens_content: estContentTokens,
      est_minutes: estMinutes,
      shards: shards.length,
    },
  },
  modules,
  shards,
  files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
  excluded_dirs: excludedDirs.sort((a, b) => a.path.localeCompare(b.path)),
};

const json = JSON.stringify(output, null, 2) + '\n';
if (toStdout) {
  process.stdout.write(json);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
}

// ── proposal table (what the budget gate shows). With --stdout the JSON owns
// stdout, so the table goes to stderr — otherwise the two interleave.
const say = toStdout ? (...a) => console.error(...a) : (...a) => console.log(...a);
const s = output.summary;
say(`\n[build-code-inventory] ${appName} — stacks: ${stacks.join(', ')}`);
say(
  `  全 ${s.total_files} files / 解析対象候補 ${s.source_files} / 除外 ${s.total_files - s.source_files}` +
    ` (${Object.entries(excludedCounts).map(([r, n]) => `${r} ${n}`).join(', ') || 'なし'})` +
    (excludedDirs.length ? ` + 未走査 dir ${excludedDirs.length}` : ''),
);
say(
  `  in-scope (tiers: ${scopeTiers.join(',')}${scopeModules ? ` / modules: ${scopeModules.length}` : ''}): ` +
    `${s.in_scope.files} files / ${s.in_scope.loc} LOC / ${s.in_scope.chars} 字`,
);
if (pinnedFiles.length) {
  say(`  require-files 固定: ${pinnedFiles.length} 件 (tier 対象外だが導出で名指しされたため計画に含めた)`);
}
say(
  `  予想: ~${estTokens.toLocaleString('en-US')} tokens (worker 固定費 ~${estOverheadTokens.toLocaleString('en-US')} + 内容 ~${estContentTokens.toLocaleString('en-US')}) / ≈ ${estMinutes} 分 (${parallel} 並列, ${shards.length} shards)`,
);
const gate = output.summary.budget_gate;
say(
  `  予算ゲート: ${gate.exceeded ? '超過 (halt & ask — 範囲を選ばせる)' : '以内 (自動通過可)'} (閾値 ${gate.threshold_files} files / ${gate.threshold_chars.toLocaleString('en-US')} 字)`,
);
// A big CLAUDE.md inside the analyzed tree is auto-attached to every worker that
// reads files near it — surfacing it explains an inflated per-shard fixed cost.
const bigClaudeMds = sourceFiles.filter(
  (f) => /(^|\/)CLAUDE\.md$/.test(f.path) && f.chars > AUTO_ATTACH_WARN_CHARS,
);
for (const f of bigClaudeMds) {
  console.error(
    `[build-code-inventory] WARNING: 大型 CLAUDE.md がツリー内にあります (${f.path}, ${f.chars.toLocaleString('en-US')} 字) — worker 起動ごとに自動添付され固定費を押し上げる可能性`,
  );
}
say(`\n  tier 別 (候補全体):`);
for (const t of [...DEFAULT_TIERS, 'other_source']) {
  const st = tierStats[t];
  if (st.files) say(`    ${t.padEnd(12)} ${String(st.files).padStart(5)} files ${String(st.loc).padStart(8)} LOC${scopeTiers.includes(t) ? '' : '  (対象外)'}`);
}
say(`\n  module 別 (in-scope):`);
for (const m of modules) {
  if (!m.in_scope_files) continue;
  say(`    ${m.module}  ${m.in_scope_files}/${m.files} files  ${m.in_scope_chars} 字`);
}
const outOfScope = modules.filter((m) => m.in_scope_files === 0);
if (outOfScope.length) {
  say(`\n  in-scope 0 の module (${outOfScope.length}): ${outOfScope.map((m) => m.module).join(', ')}`);
}
if (excludedDirs.length) {
  say(`\n  未走査 dir (${excludedDirs.length}): ${excludedDirs.slice(0, 10).map((d) => `${d.path} (${d.reason})`).join(', ')}${excludedDirs.length > 10 ? ' …' : ''}`);
}
const oversized = files.filter((f) => f.excluded === 'oversized');
if (oversized.length) {
  say(`\n  oversized (${oversized.length}, opt-in 不可 — 必要なら分割して再配置): ${oversized.slice(0, 5).map((f) => f.path).join(', ')}${oversized.length > 5 ? ' …' : ''}`);
}
if (!toStdout) say(`\n  wrote ${outPath}`);
