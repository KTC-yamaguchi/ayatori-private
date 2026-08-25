#!/usr/bin/env node
// scripts/check-req-crossrefs.mjs
//
// Phase 1c/1d (Step 33 sub-step 4.5) 相互参照整合性チェックの決定論 checker:
//   change-manifest.json + req-delta/snapshots/ + requirements/ を入力に、
//   3 観点 (削除済 ID 残存 / manifest 宣言と実出現の一致 / append-only 規則) を機械検証し、
//   cross-reference-integrity-report.md と JSON verdict を出力する。
// grep 抽出 → 集合演算 → 判定は入力から出力が一意に決まる処理であり、LLM の模擬実行を
// 挟まず本 script が単一の判定 SoT となる (同一入力 → byte 同一出力)。
//
// ID_PATTERN は skill 手順の grep と同一 (桁数 2 桁固定などの既知の制約も含めて意図的に
// 同値。パターンの SoT 化・桁数拡張は本 script の対象外)。
//
// 判定仕様 (skill 手順の擬似コードとの差分 = 決定論化のための確定事項):
//   - 観点別の主体 ID (added/modified/removed) は entry.section のみから抽出する。
//     summary / impact_hint は他 ID への言及 (参照) を含むため主体導出に使わない。
//     removed entry の section から ID を導出できない場合は warnings に記録して可視化する
//     (観点 1 がその削除を検証できないことを沈黙させない)。
//   - 観点 2 の期待 doc 集合は section + summary + impact_hint 全体から ID を抽出して
//     導出する (手順どおり)。実出現側はファイル名を basename に正規化して比較する。
//   - Entity は "Entity {N}" (スペース区切り) を正規の表示形とし、{kind, number} の
//     組で同一性判定する ("Entity 1" が "Entity 10" に誤マッチしない)。
//   - 観点 3 の母集合統一: baseline は snapshots 由来のため、snapshot が要件 doc 全件を
//     覆う場合のみ現状側も全件 grep (full)。部分 snapshot の場合、(b) 途中挿入検出は
//     現状側を snapshot 済み doc に限定して baseline と母集合を揃え (snapshot 外の doc に
//     元から存在する ID を「途中挿入」と誤検出しない)、未検査 doc を coverage として
//     明示する。(a) 既存 ID 消失検出は全 doc の現状を見る (安全側)。
//   - snapshots/ が存在しない場合、観点 3 は skipped として報告し (沈黙 PASS にしない)、
//     結論は観点 1 / 2 のみで判定する。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// 使い方: node scripts/check-req-crossrefs.mjs artifacts/{app_name} \
//           [--manifest <path>] [--snapshots <dir>] [--report <path>]
//         フラグは app ルートからの相対パス。省略時は req-delta/ 配下の既定パス (従来動作)。
//         delta 側の要件昇格 (Step 29c) は delta/req-promotion/ 配下を指定して同じ検証を使う。
// 入力:   {app}/req-delta/change-manifest.json (Phase 1c/1d 変形) / {app}/req-delta/snapshots/ /
//         {app}/requirements/
// 出力:   {app}/req-delta/cross-reference-integrity-report.md + stdout に JSON verdict
// exit:   0 = PASS / 1 = FAIL (いずれかの観点に違反) / 2 = 入力不能 (manifest 不在・解析不可・
//         Phase 5 変形・requirements/ 不在。stdout へは何も出力せず report も書かない)

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

// ── 定数 ─────────────────────────────────────────────

// skill 手順 (Step 4.5.1 grep / ID_PATTERN) と同一のパターン。
export const ID_PATTERN_SOURCE = "F-[0-9]{2}|UC-[0-9]{2}|NFR-[0-9]{2}|S-[0-9]{2}|AC-[0-9]{2}|E-[0-9]{2}|Entity [0-9]+";
export const KIND_ORDER = ["F", "UC", "NFR", "S", "AC", "E", "Entity"];

// ── ID モデル (unit test 対象) ────────────────────────

/** テキストから ID を {kind, number} の配列で抽出する (出現順、重複あり)。 */
export function extractIds(text) {
  const re = new RegExp(ID_PATTERN_SOURCE, "g");
  const out = [];
  for (const m of String(text ?? "").matchAll(re)) {
    const token = m[0];
    if (token.startsWith("Entity ")) {
      out.push({ kind: "Entity", number: Number(token.slice("Entity ".length)) });
    } else {
      const [kind, num] = token.split("-");
      out.push({ kind, number: Number(num) });
    }
  }
  return out;
}

/** {kind, number} → 正規の表示形 ("F-08" / "Entity 10")。集合演算のキーにも使う。 */
export function idKey(id) {
  if (id.kind === "Entity") return `Entity ${id.number}`;
  return `${id.kind}-${String(id.number).padStart(2, "0")}`;
}

/** idKey 文字列 → {kind, number}。 */
export function parseIdKey(key) {
  if (key.startsWith("Entity ")) return { kind: "Entity", number: Number(key.slice("Entity ".length)) };
  const [kind, num] = key.split("-");
  return { kind, number: Number(num) };
}

/** kind 順 → 番号順の決定論 sort (idKey 文字列の配列に対して)。 */
export function sortIdKeys(keys) {
  return [...keys].sort((a, b) => {
    const ia = parseIdKey(a);
    const ib = parseIdKey(b);
    const ka = KIND_ORDER.indexOf(ia.kind);
    const kb = KIND_ORDER.indexOf(ib.kind);
    if (ka !== kb) return ka - kb;
    return ia.number - ib.number;
  });
}

/**
 * manifest entry の主体 ID 集合 (idKey の Set)。**section のみ**から抽出する。
 * summary / impact_hint は使わない — それらは他 ID への言及 (参照) を含むため、主体導出に
 * 使うと「modified の summary が削除 ID に言及 → 削除扱いが解除され残存検査が素通り」
 * 「removed の summary が移行先 ID に言及 → 生存 ID を削除扱いにして誤検出」の両方向で
 * 観点 1 の判定を壊す。
 */
export function subjectIds(entry) {
  return new Set(extractIds(entry.section).map(idKey));
}

/**
 * requirement_changes から type 別の主体 ID 集合を導出する。
 * removed entry の section から主体 ID を導出できない場合、観点 1 がその削除を検証できない
 * (沈黙 PASS になる) ため、warnings に記録して可視化する。
 */
export function deriveSets(manifest) {
  const added = new Set();
  const modified = new Set();
  const removed = new Set();
  const warnings = [];
  const bucket = { added, modified, removed };
  (manifest.requirement_changes ?? []).forEach((entry, i) => {
    const target = bucket[entry.type];
    if (!target) return;
    const subjects = subjectIds(entry);
    for (const key of subjects) target.add(key);
    if (entry.type === "removed" && subjects.size === 0) {
      warnings.push(
        `requirement_changes[${i}] (type=removed, doc=${entry.doc}) の section「${entry.section}」から主体 ID を導出できないため、観点 1 の残存検査対象になりません — section に削除対象の ID を含めてください`,
      );
    }
  });
  return { added, modified, removed, warnings };
}

// ── 入力走査 ─────────────────────────────────────────

/** requirements/ を再帰走査し、全ファイルの ID 出現を行番号付きで抽出する。 */
export function scanOccurrences(reqDir) {
  const occurrences = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) {
        walk(abs, relPath);
        continue;
      }
      const lines = readFileSync(abs, "utf8").split("\n");
      lines.forEach((lineText, i) => {
        for (const id of extractIds(lineText)) {
          occurrences.push({ file: `requirements/${relPath}`, base: name, line: i + 1, ...id });
        }
      });
    }
  };
  walk(reqDir, "");
  return occurrences;
}

/** snapshot ファイル名 → 元 doc 名 ("05-features.md.snapshot.md" / "05-features.snapshot.md" 両対応)。 */
export function parseSnapshotDocName(filename) {
  if (!filename.endsWith(".snapshot.md")) return null;
  let doc = filename.slice(0, -".snapshot.md".length);
  if (!doc.endsWith(".md")) doc += ".md";
  return doc;
}

/** snapshots/ から baseline (ID 集合 + snapshot 済み doc 集合) を読む。dir 不在なら null。 */
export function loadBaseline(snapshotsDir) {
  if (!existsSync(snapshotsDir)) return null;
  const ids = [];
  const docs = new Set();
  for (const name of readdirSync(snapshotsDir).sort()) {
    const doc = parseSnapshotDocName(name);
    if (!doc) continue;
    docs.add(doc);
    ids.push(...extractIds(readFileSync(join(snapshotsDir, name), "utf8")));
  }
  return { ids, docs };
}

/**
 * snapshot の doc 被覆判定。要件 doc 全件 (basename が NN-*.md。00-* は raw input のため除外)
 * を snapshot が覆っていれば full、欠けがあれば partial。
 */
export function coverageMode(snapshotDocs, reqDir) {
  const allDocs = readdirSync(reqDir)
    .filter((name) => /^\d{2}-.*\.md$/.test(name) && !name.startsWith("00-"))
    .sort();
  const unchecked = allDocs.filter((doc) => !snapshotDocs.has(doc));
  return { mode: unchecked.length === 0 ? "full" : "partial", allDocs, uncheckedDocs: unchecked };
}

// ── 3 観点 ───────────────────────────────────────────

/** 観点 1: 削除済 ID の参照残存。 */
export function checkKanten1(removedKeys, occurrences) {
  const violations = [];
  for (const key of sortIdKeys(removedKeys)) {
    const hits = occurrences.filter((o) => idKey(o) === key);
    if (hits.length > 0) {
      violations.push({ id: key, occurrences: hits.map((o) => ({ file: o.file, line: o.line })) });
    }
  }
  return { violations };
}

/** 観点 2: manifest 宣言 doc 集合 ⊆ 実出現 doc 集合 (ID 種別非依存)。 */
export function checkKanten2(idKeys, manifest, occurrences) {
  const results = [];
  for (const key of sortIdKeys(idKeys)) {
    const expected = new Set();
    for (const entry of manifest.requirement_changes ?? []) {
      const searchable = `${entry.section} ${entry.summary} ${entry.impact_hint ?? ""}`;
      const idsInEntry = new Set(extractIds(searchable).map(idKey));
      if (idsInEntry.has(key)) expected.add(basename(entry.doc));
    }
    const actual = new Set(occurrences.filter((o) => idKey(o) === key).map((o) => o.base));
    const missing = [...expected].filter((doc) => !actual.has(doc)).sort();
    results.push({
      id: key,
      status: missing.length === 0 ? "PASS" : "FAIL",
      expected_docs: [...expected].sort(),
      actual_docs: [...actual].sort(),
      missing_docs: missing,
    });
  }
  return { results };
}

/**
 * 観点 3: append-only 規則。
 * (a) baseline ID の消失 (renumber/shift の徴候) — 現状側は全 doc を見る。
 * (b) baseline 範囲内 (max 以下) への追加 (途中挿入の徴候) — 現状側は coverage に応じて
 *     snapshot 済み doc に限定し、baseline と母集合を揃える。
 */
export function checkKanten3(baseline, removedKeys, occurrences, coverage) {
  if (baseline === null) return { status: "skipped", violations: [] };

  const numbersByKind = (ids) => {
    const map = new Map(KIND_ORDER.map((k) => [k, new Set()]));
    for (const id of ids) map.get(id.kind)?.add(id.number);
    return map;
  };
  const baselineByKind = numbersByKind(baseline.ids);
  const removedByKind = numbersByKind([...removedKeys].map(parseIdKey));
  const currentGlobal = numbersByKind(occurrences);
  const currentScoped = numbersByKind(occurrences.filter((o) => baseline.docs.has(o.base)));
  const currentForAdditions = coverage.mode === "full" ? currentGlobal : currentScoped;

  const violations = [];
  for (const kind of KIND_ORDER) {
    const base = baselineByKind.get(kind);
    const allowedRemoved = removedByKind.get(kind);

    const missingExisting = [...base].filter((n) => !allowedRemoved.has(n) && !currentGlobal.get(kind).has(n)).sort((a, b) => a - b);
    if (missingExisting.length > 0) {
      violations.push({ kind, type: "missing_existing", numbers: missingExisting });
    }

    if (base.size > 0) {
      const maxBaseline = Math.max(...base);
      const belowMaxAdditions = [...currentForAdditions.get(kind)]
        .filter((n) => !base.has(n) && n <= maxBaseline)
        .sort((a, b) => a - b);
      if (belowMaxAdditions.length > 0) {
        violations.push({ kind, type: "below_max_addition", numbers: belowMaxAdditions, max_baseline: maxBaseline });
      }
    }
  }
  return { status: coverage.mode, violations };
}

// ── 結果組み立て ─────────────────────────────────────

export function buildResult(manifest, kanten1, kanten2, kanten3, coverage, warnings = []) {
  const failed =
    kanten1.violations.length > 0 ||
    kanten2.results.some((r) => r.status === "FAIL") ||
    kanten3.violations.length > 0;
  return {
    run_id: manifest.run_id,
    app_name: manifest.app_name,
    verdict: failed ? "FAIL" : "PASS",
    warnings,
    coverage: {
      mode: kanten3.status, // full | partial | skipped
      snapshotted_docs: coverage ? [...coverage.snapshotDocs].sort() : [],
      unchecked_docs: coverage ? coverage.uncheckedDocs : [],
    },
    kanten1,
    kanten2,
    kanten3: { status: kanten3.status, violations: kanten3.violations },
  };
}

const idDisplay = (key) => key; // idKey は既に表示形

/** report md (人間ゲート提示用。skill 手順の見出し構成に従う)。 */
export function buildReport(result, manifest) {
  const lines = [];
  lines.push(`# Cross-reference Integrity Report — Run ${result.run_id}`);
  lines.push("");
  lines.push(`Run ID: ${result.run_id}  |  Date: ${String(manifest.created_at ?? "").slice(0, 10)}`);
  lines.push("");

  lines.push("## 観点 1: 削除済 ID 参照残存");
  lines.push("");
  if (result.kanten1.violations.length === 0) {
    lines.push("違反 0 件");
  } else {
    for (const v of result.kanten1.violations) {
      lines.push(`- **違反**: 削除済 ID ${idDisplay(v.id)} が ${v.occurrences.length} 箇所に残存`);
      for (const o of v.occurrences) lines.push(`  - ${o.file}:${o.line}`);
    }
  }
  lines.push("");

  lines.push("## 観点 2: manifest 宣言と実装の一致 (ID 種別非依存)");
  lines.push("");
  if (result.kanten2.results.length === 0) {
    lines.push("対象 ID なし (added / modified の主体 ID が manifest から導出されなかった)");
  } else {
    for (const r of result.kanten2.results) {
      if (r.status === "PASS") {
        lines.push(`- ${idDisplay(r.id)}: PASS — expected [${r.expected_docs.join(", ")}] ⊆ actual [${r.actual_docs.join(", ")}]`);
      } else {
        lines.push(`- ${idDisplay(r.id)}: FAIL — manifest で宣言された [${r.missing_docs.join(", ")}] に出現していない (actual [${r.actual_docs.join(", ")}])`);
      }
    }
  }
  lines.push("");

  lines.push("## 観点 3: Append-only 規則遵守 (renumber/shift + 途中挿入の 2 段検出。欠番=即違反にはしない)");
  lines.push("");
  if (result.kanten3.status === "skipped") {
    lines.push("skipped — req-delta/snapshots/ が存在しないため baseline を構成できない (観点 1 / 2 のみで判定)");
  } else {
    if (result.kanten3.status === "partial") {
      lines.push(`> 注意: snapshot が部分的なため、途中挿入検出 (b) は snapshot 済み doc [${result.coverage.snapshotted_docs.join(", ")}] に限定。未検査: [${result.coverage.unchecked_docs.join(", ")}]`);
      lines.push("");
    }
    if (result.kanten3.violations.length === 0) {
      lines.push("違反 0 件");
    } else {
      for (const v of result.kanten3.violations) {
        if (v.type === "missing_existing") {
          lines.push(`- **違反 (a)**: ${v.kind} の既存 ID が消えています [${v.numbers.join(", ")}] (renumber / shift の可能性)`);
        } else {
          lines.push(`- **違反 (b)**: ${v.kind} に append-only でない追加があります [${v.numbers.join(", ")}] (max_baseline=${v.max_baseline} 以下の番号への挿入)`);
        }
      }
    }
  }
  lines.push("");
  if (result.warnings.length > 0) {
    lines.push("## 注記");
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  lines.push(`## 結論: ${result.verdict}`);
  lines.push("");
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────

const USAGE =
  "usage: node scripts/check-req-crossrefs.mjs artifacts/{app_name} [--manifest <path>] [--snapshots <dir>] [--report <path>]";

/**
 * argv → 入力/出力パスの解決。フラグは app ルートからの相対パス、省略時は req-delta/ 配下の
 * 既定パス (従来動作と同一)。エラー時は { error } を返す (exit 2 相当)。
 */
export function parseArgs(argv) {
  const positional = [];
  const opts = { manifest: null, snapshots: null, report: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" || arg === "--snapshots" || arg === "--report") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) return { error: `${arg} に値がありません` };
      opts[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) {
      return { error: `不明なフラグです: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  const appRoot = positional[0];
  if (!appRoot) return { error: USAGE };
  return {
    appRoot,
    manifestPath: join(appRoot, opts.manifest ?? join("req-delta", "change-manifest.json")),
    snapshotsDir: join(appRoot, opts.snapshots ?? join("req-delta", "snapshots")),
    reportPath: join(appRoot, opts.report ?? join("req-delta", "cross-reference-integrity-report.md")),
  };
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error === USAGE ? USAGE : `[check-req-crossrefs] ${args.error}`);
    return 2;
  }
  const { appRoot, manifestPath, snapshotsDir, reportPath } = args;
  if (!existsSync(manifestPath)) {
    console.error(`[check-req-crossrefs] change-manifest.json が見つかりません: ${manifestPath}`);
    return 2;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    console.error(`[check-req-crossrefs] cannot read/parse ${manifestPath}: ${e.message}`);
    return 2;
  }
  if (!Array.isArray(manifest.directly_changed_docs) || manifest.changed_docs || manifest.baseline) {
    console.error(
      "[check-req-crossrefs] req-delta (Phase 1c/1d) の manifest ではありません (directly_changed_docs が必要。changed_docs / baseline を持つ Phase 5 manifest は対象外)",
    );
    return 2;
  }

  const entries = manifest.requirement_changes ?? [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (typeof entry?.doc !== "string" || entry.doc === "") {
      console.error(`[check-req-crossrefs] requirement_changes[${i}] に doc (対象ドキュメント名) がありません`);
      return 2;
    }
    if (!["added", "modified", "removed"].includes(entry.type)) {
      console.error(`[check-req-crossrefs] requirement_changes[${i}] の type が不正です (added / modified / removed のいずれかが必要): ${entry.type}`);
      return 2;
    }
  }

  const reqDir = join(appRoot, "requirements");
  if (!existsSync(reqDir)) {
    console.error(`[check-req-crossrefs] requirements/ が見つかりません: ${reqDir}`);
    return 2;
  }

  const occurrences = scanOccurrences(reqDir);
  const { added, modified, removed, warnings } = deriveSets(manifest);
  const baseline = loadBaseline(snapshotsDir);
  const coverage = baseline ? coverageMode(baseline.docs, reqDir) : null;

  const kanten1 = checkKanten1(removed, occurrences);
  const kanten2 = checkKanten2(new Set([...added, ...modified]), manifest, occurrences);
  const kanten3 = checkKanten3(baseline, removed, occurrences, coverage ?? { mode: "skipped" });

  const result = buildResult(manifest, kanten1, kanten2, kanten3, coverage ? { snapshotDocs: baseline.docs, uncheckedDocs: coverage.uncheckedDocs } : null, warnings);

  writeFileSync(reportPath, buildReport(result, manifest), "utf8");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.verdict === "PASS" ? 0 : 1;
}

function isMain() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    // 想定外エラーは「入力不能」扱い (exit 1 は FAIL verdict 専用の契約を守る)
    console.error(`[check-req-crossrefs] unexpected error: ${e.message}`);
    process.exitCode = 2;
  }
}
