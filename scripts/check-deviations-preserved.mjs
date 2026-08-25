#!/usr/bin/env node
// scripts/check-deviations-preserved.mjs
//
// requirement-deviations.json を run 単位で reconcile する層 (Phase 0c) が、**消してはいけない entry を
// 消していないこと**を機械で保証する 2 モード checker。
//
// なぜ必要か:
//   本台帳は複数 phase の記録が同居する単一ファイルで、書き込みは Read → merge → Write back の
//   丸ごと上書きである。したがって「自分の担当外を落とす」事故は文法エラーにならず、静かに消えるだけで
//   誰も気付かない。特に消えると取り返せないのは次の 3 種:
//     (a) 他 phase の entry            — 例: Phase 0b の推測検出記録 (phase="reverse")
//     (b) resolved 済みの entry        — 人間が下した判断そのもの
//     (c) 他 run から引き継いだ未解決   — 人間が「保留」を選んだ項目 (first_run_id != 現 run)
//   (c) は特に事故りやすい: 引き継ぎで run_id が現 run に書き換わるため、「自 run の未解決」を
//   一括処理する操作 (prune / run 破棄時の掃除) の条件に素で合致してしまう。
//
// なぜ script にするか (prose の jq 2 回ではなく):
//   before / after を別コマンドで撮る手順は、両方を Write 後に実行すると diff が当然一致し、
//   **検査が自分自身を満たすだけ**になる。順序を人間 / LLM の注意力に委ねない — verify モードは
//   snapshot ファイルの実在を要求し、無ければ exit 2 で「先に snapshot を撮れ」と言う。
//   snapshot は台帳の**全文コピー**なので、違反検出後の復旧原本としても使える
//   (台帳は artifact_backup の対象外であり `_backup/` には存在しない)。
//
// 使い方:
//   snapshot (台帳を編集する前):
//     node scripts/check-deviations-preserved.mjs snapshot <ledger> --out <snapshot> [--run-id <id>]
//   verify (台帳の Write が終わった後):
//     node scripts/check-deviations-preserved.mjs verify <ledger> --snapshot <snapshot> --run-id <id>
//
// exit: 0 = 保全されている (または snapshot 作成成功) / 1 = 消えた entry がある
//       2 = 入力不能 (パス不正・snapshot 不在・JSON 壊れ)
//
// 台帳が存在しない状態での snapshot は「空の台帳」として正常に記録する (初回 run の正当な経路 —
// ここで落とすと、まだ守る対象が無い run が検査に入れない)。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** entry の同一性キー。ref があればそれ、無ければ artifact::element (台帳の他 writer と同じ規則)。 */
export function identityKey(entry) {
  if (entry?.ref) return String(entry.ref);
  return `${entry?.artifact ?? ""}::${entry?.element ?? ""}`;
}

/**
 * 保全照合キー = phase + identityKey。`ref` は provenance から転記されるため、phase="reverse" と
 * phase="reverse_verify" の entry が同じ ref を持つのは正常な状態 — phase 抜きの照合では
 * 「reverse 側の記録が消えても、同じ ref を持つ verify 側の entry が残っていれば PASS」になり
 * 保全が破れる。ref 系と artifact::element 系が偶然同じ文字列になる衝突を避けるため分岐タグも含める。
 */
export function preservationKey(entry) {
  return `${entry?.phase ?? ""}|${entry?.ref ? "ref" : "ae"}|${identityKey(entry)}`;
}

/**
 * 「消してはいけない」判定。run_id は現在の run (verify 時のみ意味を持つ)。
 * - 他 phase → 常に保全
 * - reverse_verify で resolved → 保全 (人間の判断)
 * - reverse_verify で未解決かつ first_run_id が現 run と異なる → 保全 (引き継いだ保留)
 * - reverse_verify で未解決かつ現 run が初出 → 保全対象外 (再列挙で消えるのが正常、破棄も可)
 */
export function mustPreserve(entry, runId) {
  if (entry?.phase !== "reverse_verify") return true;
  if (entry?.resolved_at != null) return true;
  const first = entry?.first_run_id;
  // first_run_id 欠落は「不明」— 安全側に倒して保全対象にする (誤って消すより残す)
  if (first == null || first === "") return true;
  return runId != null && first !== runId;
}

function readLedger(path) {
  if (!existsSync(path)) return { entries: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`台帳が object ではありません: ${path}`);
  }
  return parsed;
}

const entriesOf = (doc) => (Array.isArray(doc?.entries) ? doc.entries : []);

/** snapshot モード: 台帳の全文を退避する (復旧原本 + verify の比較元)。 */
export function runSnapshot({ ledger, out }) {
  const doc = readLedger(ledger);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  return { mode: "snapshot", entries: entriesOf(doc).length, out };
}

/** verify モード: snapshot の保全対象が現台帳に全て残っているかを照合する。 */
export function runVerify({ ledger, snapshot, runId }) {
  const before = readLedger(snapshot);
  const after = readLedger(ledger);
  // 出現数 (multiset) で照合する — 同じ key の entry は複数併存しうる (resolved 済みが run を跨いで
  // 積まれる等) ため、存在有無 (Set) では「1 件消えたが同 key の別 entry が残っている」を見逃す。
  const afterCounts = new Map();
  for (const e of entriesOf(after)) {
    const key = preservationKey(e);
    afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1);
  }
  const missing = [];
  let checked = 0;
  for (const e of entriesOf(before)) {
    if (!mustPreserve(e, runId)) continue;
    checked += 1;
    const key = preservationKey(e);
    const remaining = afterCounts.get(key) ?? 0;
    if (remaining > 0) {
      afterCounts.set(key, remaining - 1);
    } else {
      missing.push({
        key: identityKey(e),
        phase: e?.phase ?? null,
        run_id: e?.run_id ?? null,
        first_run_id: e?.first_run_id ?? null,
        resolved: e?.resolved_at != null,
        reason:
          e?.phase !== "reverse_verify"
            ? "他 phase の記録"
            : e?.resolved_at != null
              ? "resolved 済み (人間の判断)"
              : "他 run から引き継いだ未解決 (人間が保留した項目)",
      });
    }
  }
  return {
    mode: "verify",
    run_id: runId ?? null,
    preserved_checked: checked,
    missing,
    verdict: missing.length === 0 ? "PASS" : "MISSING",
  };
}

export function parseArgs(argv) {
  const args = { mode: null, ledger: null, out: null, snapshot: null, runId: null };
  const flags = new Map([
    ["--out", "out"],
    ["--snapshot", "snapshot"],
    ["--run-id", "runId"],
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const key = flags.get(argv[i]);
    if (key !== undefined) {
      const value = argv[i + 1];
      // 値が別フラグなら「値なし」— 黙って隣のフラグ名を値として飲み込まない
      if (value === undefined || value.startsWith("--")) return { ...args, error: `${argv[i]} に値を指定してください` };
      args[key] = value;
      i += 1;
    } else if (args.mode === null) {
      args.mode = argv[i];
    } else if (args.ledger === null) {
      args.ledger = argv[i];
    }
  }
  return args;
}

export function main(argv) {
  const args = parseArgs(argv);
  const fail = (msg) => {
    process.stderr.write(`${msg}\n`);
    return 2;
  };
  if (args.error) return fail(args.error);
  if (args.mode !== "snapshot" && args.mode !== "verify") {
    return fail(
      "使い方: node scripts/check-deviations-preserved.mjs snapshot <ledger> --out <snapshot> [--run-id <id>]\n" +
        "        node scripts/check-deviations-preserved.mjs verify <ledger> --snapshot <snapshot> --run-id <id>",
    );
  }
  if (args.ledger === null) return fail("台帳のパスを指定してください");

  try {
    if (args.mode === "snapshot") {
      if (args.out === null) return fail("snapshot モードは --out が必須です");
      const result = runSnapshot({ ledger: args.ledger, out: args.out });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (args.snapshot === null) return fail("verify モードは --snapshot が必須です");
    if (!existsSync(args.snapshot)) {
      // 順序ミスをここで止める: 先に snapshot を撮らずに verify しても「一致」で通さない
      return fail(
        `snapshot が見つかりません: ${args.snapshot}\n` +
          "台帳を編集する **前** に snapshot モードを実行してください (編集後に撮った snapshot は検査の意味を失います)",
      );
    }
    if (args.runId === null) return fail("verify モードは --run-id が必須です (引き継ぎ判別に使います)");
    const result = runVerify({ ledger: args.ledger, snapshot: args.snapshot, runId: args.runId });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.missing.length > 0) {
      process.stderr.write(
        `\n消えた entry が ${result.missing.length} 件あります。snapshot (${args.snapshot}) から該当 entry を復元してください。\n`,
      );
      return 1;
    }
    return 0;
  } catch (e) {
    return fail(`入力不能: ${e?.message ?? e}`);
  }
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMainModule()) {
  process.exitCode = main(process.argv.slice(2));
}
