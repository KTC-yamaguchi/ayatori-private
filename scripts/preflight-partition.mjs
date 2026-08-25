#!/usr/bin/env node
// scripts/preflight-partition.mjs
//
// Pre-flight Gate (`skills/_shared/preflight-gate.md` 手順 (b)) の振り分け器。
// `pending-questions.json` の未解決 entry を「本 phase で ask するもの (ask)」と
// 「反映先が本 phase の書き込み責務外なので次の門へ持ち越すもの (hold)」に分ける。
//
// script にする理由:
//   宣言 (どの artifact に反映するか) は疑問の誕生時に appender = LLM が 1 語で書く
//   (`reflect_to`) が、**振り分けは決定論** — 「entry の reflect_to が phase の
//   target_artifacts に解決できるか」の照合であり、run ごとに揺れてはいけない。
//   LLM が毎 gate で判断すると (a) 反映先の無い質問を人間に 5 往復させる
//   (b) 逆に反映できる質問を持ち越して迷子にする、のどちらも起こる (E2E 実測: Phase 0b の
//   Completion 直行 resume / Phase 3 で tokens 系 8 件)。照合を本 script に閉じることで
//   「聞く / 持ち越す」の判定が 1 か所の決定論になる。
//
// 振り分け規則 (`resolved_at` が set の entry は最初から対象外 = resolve 済):
//   R1 `reflect_to` 未設定 (legacy)                  → **ask** (従来挙動 = 後方互換)
//   R2 `reflect_to` が target_artifacts のいずれかに一致 → **ask**
//   R3 `reflect_to` があるが一致しない                 → **hold** (未解決のまま持ち越す)
//   `reflect_to` は前後空白を trim して照合する (照合リスト側 = parseTargets も trim 済みなので対称)。
//   trim 後が空白のみ (空文字) の値は **未設定扱い** = R1 (ask。従来挙動へ倒す)。
//
// 一致判定:
//   完全一致、または glob 風エントリ (`*` を 1 個含む形。例 `requirements/*.md`) の
//   prefix / suffix 一致。`*` は `/` も跨ぐ単純なワイルドカードとして扱う
//   (`*` を 2 個以上含むパターンは非対応 = 一致しないものとして扱う)。
//
// target pattern の形検証:
//   `--target-artifacts` の値は各 phase の preamble に prose で宣言された `target_artifacts` から
//   パス部分だけを抽出して渡す設計だが、宣言を逐語で渡すと (i) comma 区切りでない宣言は文字列全体が
//   1 pattern になり (ii) comma があってもバックティック・括弧・日本語の修飾が付いて、いずれも
//   「何にも一致しない pattern」になる。すると `reflect_to` を持つ entry が全件 hold へ黙って落ちる
//   (実測: 8 phase 全部の宣言を逐語で渡すと完全に無音)。そこで token ごとに path 形を検証する:
//     - 形が違う token は **drop して続行** (exit 0 維持) し、`summary.invalid_targets[]` に載せて
//       可視化する。即 exit 2 にはしない — exit 2 の fail-open は「全件 ask」であり、反映できない
//       phase で答えを消費する (= 本来の受け皿に確定値が届かない) 元バグへの回帰になるため。
//     - ただし **raw が非空なのに有効 token が 0 個** になった場合だけは exit 2。targets=[] で続行
//       すると `reflect_to` 持ちが全件 silent hold になり、「質問を黙って消さない」という本 script の
//       芯に反するため、こちらは全件 ask の fail-open に倒すのが正しい。
//     - raw が空文字 / 空白のみは従来どおり正常 (targets=[]、exit 0) — gate 手順書が「反映先を 1 つも
//       持たない位置では `""` を渡す」と規定している正常系。
//
// exit code 契約 (0 / 2 の 2 値。1 は使わない = 「検査 FAIL」を持たない振り分け script のため):
//   0 = 正常 (summary JSON を stdout へ。hold 0 件でも 0。**pending-questions.json 不在も 0** =
//       まだ 1 件も append されていない新規プロジェクトの正常系。空 summary を返す)
//   2 = 読めない / 壊れている / 呼び出しが不正 (引数不正 / app ルート不在 / --target-artifacts に
//       path 形の token が 1 つも無い / JSON parse 失敗 / entries 型不正 / 壊れた entry
//       [null 要素 / unresolved entry の target 欠落])。壊れた entry を黙って無視すると
//       ask/hold/open のどこにも出ず消え、counter・dedupe と不整合になるため fail-open に倒す。
//       理由を stderr へ。**呼び出し側 (gate) は exit 2 のとき従来挙動 (全件 ask) に
//       fall back する** (fail-open — 振り分けできないことを理由に人間の確定を止めない)。
//
// 本 script はファイルを一切書かない (READ 専用)。`resolved_at` の押印・counter 再計算は
// gate 手順 (d)(f) を実行する main session の責務 (AYATORI single writer 原則)。
//
// 使い方:
//   node scripts/preflight-partition.mjs <artifacts/{app_name}> --target-artifacts "<comma 区切り>"
//   例: node scripts/preflight-partition.mjs artifacts/myapp \
//         --target-artifacts "requirements.json,requirements/*.md"
//   空リスト (`--target-artifacts ""`) は「本 phase は反映先を 1 つも持たない」の意で、
//   `reflect_to` を持つ entry が全 hold になる (未設定の legacy entry は R1 で ask に残る)。
//
// summary JSON のフィールド定義:
//   ask[]  = 本 gate で ask する entry (`{index, target, reflect_to?}`。index = entries[] の添字)
//   hold[] = 次の門へ持ち越す entry (同形)
//   open   = 未解決 entry の総数 (= ask.length + hold.length。gate (f) の counter と同じ数)
//   invalid_targets[] = path 形でないため drop した `--target-artifacts` の token (**1 件以上の
//     ときだけ出る** — 0 件のときは従来の出力形をそのまま保つ)
//   entry の順序は入力の entries[] 順を保持する (決定論)。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PENDING_QUESTIONS = "pending-questions.json";

const USAGE =
  'usage: node scripts/preflight-partition.mjs <artifacts/{app_name}> --target-artifacts "<comma 区切りリスト>"';

/** 入力不能 (exit 2) を表すエラー。 */
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

// ───────────────────────────── 一致判定 ─────────────────────────────

/**
 * `--target-artifacts` の値を pattern 配列へ分解する (trim + 空要素除去)。
 * @returns {string[]}
 */
export function parseTargets(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * token が target pattern の形 (= `artifacts/{app_name}/` 相対パス + glob `*`) かどうか。
 * 許すのは「先頭 1 文字が英数、以降は英数と `.` `_` `-` `*` `/` のみ」 — 相対パスと glob だけを
 * 通す最小の文字集合で、prose 宣言の混入物 (バックティック / 丸括弧 / 全角文字 / 空白) と
 * 先頭 `/` の絶対パス・先頭 `..` の親参照はこれで弾かれる。加えて `*` は 1 個以下 (2 個以上は
 * matchesPattern が常に false = 書いても効かない宣言なので、無言で効かないより invalid として見せる)。
 */
export function isTargetPattern(token) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._*\/-]*$/.test(token)) return false;
  return token.indexOf("*") === token.lastIndexOf("*");
}

/**
 * `--target-artifacts` の raw 値を「有効な pattern」と「形が不正で drop した token」に分ける。
 * @returns {{targets: string[], invalidTargets: string[]}}
 * @throws {InputError} token が 1 つ以上あるのに有効な pattern が 0 個の場合 (targets=[] で続行すると
 *   `reflect_to` 持ちが全件 silent hold になるため、exit 2 = 全件 ask の fail-open へ倒す)。
 *   raw が空文字 / 空白のみ (token 0 個) は「反映先を持たない位置」の正常系なので throw しない。
 */
export function classifyTargets(raw) {
  const tokens = parseTargets(raw);
  const targets = tokens.filter((t) => isTargetPattern(t));
  const invalidTargets = tokens.filter((t) => !isTargetPattern(t));
  if (tokens.length > 0 && targets.length === 0) {
    throw new InputError(
      `--target-artifacts に path 形の token が 1 つもない (${tokens.length} 件すべて drop: ${invalidTargets
        .map((t) => JSON.stringify(t))
        .join(" / ")}) — phase 宣言の prose をそのまま渡していないか確認 (パス部分だけを comma 区切りで渡す)`,
    );
  }
  return { targets, invalidTargets };
}

/**
 * `reflect_to` が 1 つの pattern に一致するか。
 * pattern が `*` を含まなければ完全一致、`*` を 1 個含めば prefix / suffix 一致。
 * `*` を 2 個以上含む pattern は非対応 (常に false = 一致しない扱い)。
 */
export function matchesPattern(reflectTo, pattern) {
  const star = pattern.indexOf("*");
  if (star === -1) return reflectTo === pattern;
  if (pattern.indexOf("*", star + 1) !== -1) return false;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (reflectTo.length < prefix.length + suffix.length) return false;
  return reflectTo.startsWith(prefix) && reflectTo.endsWith(suffix);
}

/** `reflect_to` が target_artifacts のいずれかに一致するか。 */
export const matchesTargets = (reflectTo, patterns) => patterns.some((p) => matchesPattern(reflectTo, p));

// ───────────────────────────── 振り分け本体 ─────────────────────────────

/**
 * pending-questions.json の doc を ask / hold に振り分ける (I/O なし・純関数)。
 * @param {object} doc      pending-questions.json の parse 済 object
 * @param {string[]} targets  target_artifacts の pattern 配列
 * @returns {{ask: object[], hold: object[], open: number}}
 * @throws {InputError} entries が配列でない場合、または未解決 entry が壊れている場合
 *   (null / 非 object 要素、もしくは target 欠落)。resolved 済み entry の破損は許容する
 *   (台帳履歴を fatal にしない — 下記 forEach 内コメント参照)。
 */
export function partition(doc, targets) {
  const entries = doc?.entries;
  if (!Array.isArray(entries)) {
    throw new InputError(`${PENDING_QUESTIONS}: entries[] が無いか配列でない (schemas/pending-questions.schema.json 不適合)`);
  }
  const ask = [];
  const hold = [];
  entries.forEach((entry, index) => {
    // 壊れた要素 (null / 非 object) は resolved_at を持ち得ない = 常に未解決扱いなので無条件でエラー。
    // 黙って無視すると ask/hold/open のどこにも出ず「消えた」ように見え、gate 手順 (f) の counter
    // 再計算 (entries[] を数える) と不整合になる (fail-open に倒す = 呼び出し側 gate に exit 2 で
    // 全件 ask へ fall back させる)。
    if (entry === null || typeof entry !== "object") {
      throw new InputError(`${PENDING_QUESTIONS}: entries[${index}] が object でない (schemas/pending-questions.schema.json 不適合)`);
    }
    if (entry.resolved_at !== undefined && entry.resolved_at !== null && entry.resolved_at !== "") return; // resolved 済みはここで抜ける = 以降の検査を受けない (台帳履歴の破損を fatal にしない)
    if (typeof entry.target !== "string" || entry.target === "") {
      throw new InputError(
        `${PENDING_QUESTIONS}: entries[${index}].target が欠落 — unresolved entry の必須 field (振り分け・dedupe の literal key) のため振り分け不能`,
      );
    }
    // 照合リスト側 (parseTargets) は trim 済みなので、こちらも trim してから使う (非対称にすると
    // `"tokens.json "` のような些細な空白で hold に落ち、答えが永久に持ち越される)。
    // trim 後が空文字なら未設定扱い = R1 (ask = 従来挙動へ倒す)。
    const trimmed = typeof entry.reflect_to === "string" ? entry.reflect_to.trim() : "";
    const reflectTo = trimmed !== "" ? trimmed : undefined;
    const item = {
      index,
      target: entry.target,
      ...(reflectTo !== undefined && { reflect_to: reflectTo }),
    };
    // R1: reflect_to 未設定は従来どおり ask (後方互換)。R2 / R3: 宣言があれば照合で決める。
    if (reflectTo === undefined || matchesTargets(reflectTo, targets)) ask.push(item);
    else hold.push(item);
  });
  return { ask, hold, open: ask.length + hold.length };
}

// ───────────────────────────── CLI ─────────────────────────────

export function parseArgs(argv) {
  const args = { appRoot: null, targetArtifacts: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target-artifacts") {
      const value = argv[i + 1];
      if (value === undefined) return { error: `${arg} に値がありません` };
      args.targetArtifacts = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) return { error: `不明なフラグ: ${arg}` };
    if (args.appRoot !== null) return { error: `引数が多すぎます: ${arg}` };
    args.appRoot = arg;
  }
  if (args.appRoot === null) return { error: "app ルート (artifacts/{app_name}) を指定してください" };
  if (args.targetArtifacts === null) return { error: "--target-artifacts を指定してください (空リストなら \"\")" };
  return args;
}

/** invalid_targets は 1 件以上のときだけ載せる (0 件なら既存の出力形をそのまま保つ)。 */
const withInvalid = (summary, invalidTargets) =>
  invalidTargets.length > 0 ? { ...summary, invalid_targets: invalidTargets } : summary;

/**
 * CLI 1 回分を実行する (stdout / stderr へは書かない — 呼び出し側 main が担当)。
 * @returns {{exitCode: number, error?: string, summary?: object}}
 */
export function run(argv) {
  const args = parseArgs(argv);
  if (args.error !== undefined) return { exitCode: 2, error: `${args.error}\n${USAGE}` };

  const { appRoot } = args;
  // app ルート不在 / 非ディレクトリは exit 2 のまま維持する (キュー不在との非対称は意図的 —
  // キューは「まだ 1 件も append されていない」正常系がある一方、ルート自体が無いのは呼び出し側の
  // app 名 typo であり、空 summary で無音化すると気付けない)。
  if (!existsSync(appRoot) || !statSync(appRoot).isDirectory()) {
    return { exitCode: 2, error: `app ルートが見つからない: ${appRoot}` };
  }

  try {
    const { targets, invalidTargets } = classifyTargets(args.targetArtifacts);

    // キュー不在 = 新規プロジェクトの最頻の正常系 (gate 手順 (a) の init stub と同じ「未解決 0 件」)。
    // 「本当に読めない (JSON 破損)」と区別するため exit 0 + 空 summary を返す。
    const queuePath = join(appRoot, PENDING_QUESTIONS);
    if (!existsSync(queuePath)) return { exitCode: 0, summary: withInvalid({ ask: [], hold: [], open: 0 }, invalidTargets) };

    let doc;
    try {
      doc = JSON.parse(readFileSync(queuePath, "utf8"));
    } catch (e) {
      return { exitCode: 2, error: `${queuePath}: JSON として parse できない (${e.message})` };
    }

    return { exitCode: 0, summary: withInvalid(partition(doc, targets), invalidTargets) };
  } catch (e) {
    if (e instanceof InputError) return { exitCode: 2, error: e.message };
    throw e;
  }
}

export function main(argv) {
  const { exitCode, error, summary } = run(argv);
  if (error !== undefined) {
    process.stderr.write(`[preflight-partition] ${error}\n`);
    return exitCode;
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return exitCode;
}

// テストから import されたときは main() を走らせない (derive-transition-map.mjs と同じ guard)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
