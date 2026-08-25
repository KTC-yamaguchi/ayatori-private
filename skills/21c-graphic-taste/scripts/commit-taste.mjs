#!/usr/bin/env node
// Step 21c (graphic-taste) のテイスト確定 commit — taste 検証 + graphic-plan.json / pipeline-state.json 書き込み。
// F-3 テイスト選定
//
// usage:
//   node commit-taste.mjs <app_name> --stdin                        # stdin = taste draft (人間ゲート確定済み)
//   node commit-taste.mjs <app_name> --stdin --dry-run              # 検証のみ・書き込みゼロ (確定確認前の事前検証)
//   node commit-taste.mjs <app_name> --stdin --allow-non-english    # style_directive の日本語混入を意図的として明示続行
//
// stdin 契約 (confirmed_at は本 script が採番するため入れない):
//   { "level1_words": ["洗練"], "level2_choice": "A",
//     "style_directive": "... (英語 1 段落。21d が全 slot のプロンプトに共通合成する)",
//     "sample_files": ["graphics/samples/taste-a.png", ...],   // degrade (画像なし) 時は省略
//     "palette_hints": ["#0E7C90 (global.color.primary)", ...] // (C) DERIVED — 導出元 token 併記必須
//   }
//
// 書き込み (設計 docs/graphic-generation-design.md §7 / §9-2):
//   - graphics/graphic-plan.json: `taste` キーのみ append (key 分離 — slots には触らない。21b が init writer)。
//     taste の制約 (required / additionalProperties / enum / minItems) は schemas/graphic-plan.schema.json
//     から実行時導出する (schema が SoT — 21b commit-decision.mjs と同パターン)。残置 taste が
//     ある場合 (§5 手動リセット後の再選定) は _backup/graphics/ へ退避してから上書き。
//   - pipeline-state.json: screens.graphics.taste_confirmed_at を merge write (plan 側 confirmed_at と同値)。
// 検証 NG (E_VALIDATION) は一切書き込まない。exit code は常に 0 (routing は JSON の code)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPreflight, atomicWriteFileSync, backupFile, containsNonEnglish, isoNow, readJson, repoRoot } from "./preflight.mjs";

// schema は repo 本体の一部なので常に script 自身の位置から解決する (repoRoot は fixture 差し込み用)
const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../schemas/graphic-plan.schema.json");
// "HEX (導出元 token path)" — (C) DERIVED の導出元併記を機械強制。HEX は正規桁 (3/4/6/8) のみ
const PALETTE_HINT_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8}) \(.+\)$/;

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const args = process.argv.slice(2);
  const appName = args[0];
  const dryRun = args.includes("--dry-run");
  const allowNonEnglish = args.includes("--allow-non-english");
  if (!appName || !args.includes("--stdin")) {
    out({ ok: false, code: "E_USAGE", message: "usage: node commit-taste.mjs <app_name> --stdin [--dry-run] [--allow-non-english]" });
  }

  // ── 前提の再 assert (gather 後の対話中に state が変わっていないかの防御。gather と同一 code) ──
  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, plan } = pre;

  // ── taste 制約を schema (SoT) から導出 ──
  const tasteSchema = readJson(SCHEMA_PATH)?.properties?.taste;
  if (!tasteSchema?.required || !tasteSchema?.properties) {
    out({ ok: false, code: "E_SCHEMA_UNREADABLE", message: "schemas/graphic-plan.schema.json の taste 定義が読めない/形が想定外 — 検証不能のため書き込まない" });
  }
  const allowedKeys = Object.keys(tasteSchema.properties);

  // ── stdin の taste draft を検証 ──
  const raw = fs.readFileSync(0, "utf8");
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin が JSON として parse できません" });
  }
  if (typeof draft !== "object" || draft === null || Array.isArray(draft)) {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin は taste object (JSON object) が必須" });
  }

  const errors = [];
  if ("confirmed_at" in draft) {
    errors.push("confirmed_at は本 script が採番する — draft に入れない");
  }
  for (const field of tasteSchema.required.filter((f) => f !== "confirmed_at")) {
    const v = draft[field];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
      errors.push(`必須 field '${field}' が欠落 (schema taste.required)`);
    }
  }
  const extra = Object.keys(draft).filter((k) => !allowedKeys.includes(k));
  if (extra.length) errors.push(`schema に無い field ${JSON.stringify(extra)} (additionalProperties: false)`);

  // schema properties の type / enum / items / minItems を解釈して検証 (21b commit-decision と同じ interpreter)。
  // 空文字列は string field のみ「欠落扱い」(required 検査が担う) として skip する — array field で
  // "" を skip すると optional field ("palette_hints": "" 等) が schema type 違反のまま素通りして
  // disk に固定される (self-review 2nd round finding 1)
  for (const [key, def] of Object.entries(tasteSchema.properties)) {
    const v = draft[key];
    if (v === undefined || key === "confirmed_at") continue;
    if (v === null) {
      // required の null は required 検査が「欠落」として検出済み。optional の null は素通りさせない —
      // {...draft} の spread で schema type 違反のまま plan に固定され、以後の Write/Edit が
      // hook R9 に block される + 21d が array 前提で読めなくなる (external review 指摘 1)
      if (!tasteSchema.required.includes(key)) {
        errors.push(`${key} が null — 「値なし」はキー省略で表現する (null は schema type 違反として plan に固定される)`);
      }
      continue;
    }
    if (def.type === "string") {
      if (v === "") continue; // 欠落扱い (required 検査が担う)
      if (typeof v !== "string") {
        errors.push(`${key} は string 型が必須 (実際: ${Array.isArray(v) ? "array" : typeof v})`);
        continue;
      }
      if (def.enum && !def.enum.includes(v)) errors.push(`${key} '${v}' は enum (${def.enum.join("/")}) 外`);
    } else if (def.type === "array") {
      if (!Array.isArray(v)) {
        errors.push(`${key} は array 型が必須 (実際: ${typeof v})`);
        continue;
      }
      if (def.minItems && v.length < def.minItems) errors.push(`${key} は ${def.minItems} 件以上が必須`);
      for (const item of v) {
        if (typeof item !== "string" || !item.trim()) errors.push(`${key} の要素は非空 string が必須`);
      }
    }
  }

  // schema では表現できない実在/書式照合。非 array (数値・object 等) は上の interpreter が
  // 「array 型が必須」を積んでいる — ここで iterate すると TypeError → exit 1 になり
  // 「exit 0 + JSON code で routing」の契約が壊れるため Array.isArray で guard する
  for (const f of Array.isArray(draft.sample_files) ? draft.sample_files : []) {
    if (typeof f === "string" && f && !fs.existsSync(path.join(appRoot, f))) {
      errors.push(`sample_files '${f}' が artifacts/${appName}/ 配下に存在しません`);
    }
  }
  for (const h of Array.isArray(draft.palette_hints) ? draft.palette_hints : []) {
    if (typeof h === "string" && h && !PALETTE_HINT_RE.test(h)) {
      errors.push(`palette_hints '${h}' は "HEX (導出元 token path)" 形式が必須 ((C) DERIVED の導出元併記 — 例: "#0E7C90 (global.color.primary)")`);
    }
  }

  if (errors.length) out({ ok: false, code: "E_VALIDATION", errors });

  // style_directive の日本語混入は確定前に止める (generate-samples の E_NON_ENGLISH と同一契約 —
  // 実装は preflight.containsNonEnglish の単一共有で copy-paste drift を防ぐ)。日本語のまま確定すると
  // 21d の全 slot プロンプト合成 → 21e の有料生成まで伝播してから気づくことになる。level1_words は
  // 日本語が正 (「洗練」等の user 選択語)、palette_hints は HEX + token path のため対象は style_directive のみ
  if (!allowNonEnglish && containsNonEnglish(draft.style_directive)) {
    out({
      ok: false,
      code: "E_NON_ENGLISH",
      message:
        "style_directive に日本語が含まれる — 21d が全 slot のプロンプトへ英語のまま合成する前提 (schema 参照)。誤りなら英訳して再実行、意図的なら --allow-non-english を付けて再実行する (何も書き込んでいない)",
    });
  }

  if (dryRun) {
    out({
      ok: true,
      dry_run: true,
      level1_words: draft.level1_words,
      level2_choice: draft.level2_choice,
      next: "検証 OK (何も書き込んでいない) — 確定確認を経て --dry-run なしで再実行する",
    });
  }

  // ── 書き込み: plan へ taste append (key 分離) + state へ taste_confirmed_at ──
  const confirmedAt = isoNow();
  const planPath = path.join(appRoot, "graphics", "graphic-plan.json");
  let backedUp = null;
  if (plan.taste) {
    // §5 手動リセット後の再選定等で残置 taste がある場合のみ退避してから上書き
    backedUp = backupFile(appRoot, planPath);
  }
  plan.taste = { ...draft, confirmed_at: confirmedAt };
  atomicWriteFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");

  const statePath = path.join(appRoot, "pipeline-state.json");
  // preflight で読み込み済みの state をベースに merge する — disk 再読込 + `?? {stub}` fallback は
  // 読込失敗時に approvals 等の全 state を最小 stub で潰す破壊経路になる (self-review finding 3。
  // lazy-init stub は「file 不在」用の規約であり、preflight が実在・可読を assert 済みの本 step には
  // 該当しない)
  const state = pre.state;
  if (!state.app_name) state.app_name = appName; // 必須 field の保全 assert
  if (!state.schema_version) state.schema_version = "2026-05-22"; // 欠落 = legacy の書き込み時補完
  state.screens ??= {};
  state.screens.graphics = { ...(state.screens.graphics ?? {}), taste_confirmed_at: confirmedAt };
  atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

  out({
    ok: true,
    plan_path: path.relative(repoRoot, planPath),
    taste_confirmed_at: confirmedAt,
    level1_words: draft.level1_words,
    level2_choice: draft.level2_choice,
    sample_files: draft.sample_files ?? [],
    ...(backedUp ? { backed_up: path.relative(repoRoot, backedUp) } : {}),
    next: "Step 21d graphic-prompts (プロンプト確定) へ",
  });
} catch (e) {
  console.error(`commit-taste.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
