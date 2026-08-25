#!/usr/bin/env node
// Step 21d (graphic-prompts) のプロンプト確定 commit — 検証 + graphic-prompts.json / pipeline-state.json 書き込み。
// F-4 箇所別プロンプト確定
//
// usage:
//   node commit-prompts.mjs <app_name> confirm --stdin                 # stdin = prompts draft (人間ゲート確定済み)
//   node commit-prompts.mjs <app_name> confirm --stdin --dry-run       # 検証のみ・書き込みゼロ (確定確認前の事前検証)
//   node commit-prompts.mjs <app_name> confirm --stdin --allow-non-english    # prompt の日本語混入を意図的として明示続行
//   node commit-prompts.mjs <app_name> confirm --stdin --allow-style-deviation # style_directive 逐語合成の逸脱を意図的として明示続行
//   node commit-prompts.mjs <app_name> confirm --stdin --allow-rework-scope-change # rework 時の対象外 entry / tool 変更を意図的として明示続行
//   node commit-prompts.mjs <app_name> skip                            # 全 slot 生成中止 (設計 §8-4 gate_21d_all_cancel)
//
// stdin 契約 (confirmed_at は本 script が採番するため入れない):
//   { "tool": "gpt-image-2",                       // 省略可 — 省略時 pipeline.yaml の既定値 (env は見ない)
//     "prompts": [ { "graphic_id": "...", "prompt": "... (英語。taste.style_directive を逐語で含む)",
//                    "size_px": { "width": 800, "height": 400 },
//                    "transparent_background": true, "notes": "..." } ],
//     "omit": [ { "graphic_id": "...", "reason": "..." } ] }           // 取り下げ slot の明示記録 (省略可)
//
// 書き込み (設計 docs/graphic-generation-design.md §7 / §8-4 / §9-2 / §9-2b):
//   - graphics/graphic-prompts.json: 確定値のみを 1 Write で一括生成 (draft は書かない)。entry の制約
//     (required / additionalProperties / pattern / size_px 形) は schemas/graphic-prompts.schema.json
//     から実行時導出する (schema が SoT — 21b/21c と同パターン)。schema で表現できない制約は自前検証:
//       * prompts[] 内の graphic_id 重複禁止 (1 graphic_id = 1 確定プロンプト — schema description が SoT)
//       * plan.slots との 1:1 対応 (plan に無い graphic_id を書かない)
//       * 取りこぼし禁止: 対象 slot (plan − excluded_slots) は prompts か omit のどちらかに必ず載せる
//         (無言の省略は「未完了」と「取り下げ」が区別できなくなる — Operating Principle 4)
//       * rework (21g 差し戻し) 時は対象外 entry / tool を前回確定値で凍結 (E_REWORK_SCOPE —
//         guide §6 逐語コピーの機械担保。tool 省略時は前回確定値を継承し env 既定に落とさない)
//     残置ファイルがある場合 (21g 差し戻しの再確定 / 確定直後の中断再入) は _backup/graphics/ へ
//     退避してから上書き。
//   - pipeline-state.json: screens.graphics.prompts_confirmed_at を merge write (file 側 confirmed_at と
//     同値)。rework_pending のうち今回再確定した graphic_id の entry を除去 (§9-2b の消費契約)。
// skip 時は pipeline-state.json に decision="skip", decided_by="step21d" のみ (prompts ファイルは
// 書かない — 確定 prompt 0 件は schema minItems 1 を満たせない = 正しく書けない、§8-4)。
// 検証 NG (E_VALIDATION) は一切書き込まない。exit code は常に 0 (routing は JSON の code)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPreflight, atomicWriteFileSync, backupFile, containsNonEnglish, isoNow, pipelineDefaultTool, repoRoot } from "./preflight.mjs";

// schema は repo 本体の一部なので常に script 自身の位置から解決する (repoRoot は fixture 差し込み用)
const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../schemas/graphic-prompts.schema.json");

// 省略時の生成ツール既定値 — SoT の pipeline.yaml screens.graphic_generation.tool を実際に読む
// (宣言だけの hardcode は「SoT を直したのに旧値で確定し続ける」運用事故になる。読み取り実体は
// preflight の readGraphicGenerationKey — 21c/21e/21f と逐字同一で、同期は 21f eval が機械検証する)。
// AYATORI_IMAGE_MODEL (env) は**ここでは見ない** — env は 21e の実行時の呼び出し先を一時的に
// 差し替える knob であり、本 script が確定・永続化する tool (graphic-prompts.json → 21e の
// source_digest 材料) に混ぜると、shell に残った実験用 env が無言でプロジェクトの正式 tool として
// 焼き込まれる (digest の「環境非依存の決定値」不変量の破り。しかも rework 凍結で自然治癒しない)。
const DEFAULT_TOOL = pipelineDefaultTool();

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

/** 空白正規化して部分一致を見る (style_directive 逐語合成の機械検査 — 改行/連続空白の揺れは許容)。 */
const normWs = (s) => (s ?? "").replace(/\s+/g, " ").trim();

try {
  const args = process.argv.slice(2);
  const [appName, mode] = args;
  // 未知の第 3 引数以降は typo とみなし E_USAGE で止める — 例えば --dry-run の typo (--dry-rnu 等) を
  // 無視すると「検証のみのつもりが本書き込み」になり、以後 E_PROMPTS_ALREADY_SET で未承認内容が
  // 確定済み扱いになるため (安全側の fail-closed)
  const KNOWN_FLAGS = ["--stdin", "--dry-run", "--allow-non-english", "--allow-style-deviation", "--allow-rework-scope-change"];
  const unknownArgs = args.slice(2).filter((a) => !KNOWN_FLAGS.includes(a));
  const dryRun = args.includes("--dry-run");
  const allowNonEnglish = args.includes("--allow-non-english");
  const allowStyleDeviation = args.includes("--allow-style-deviation");
  const allowReworkScopeChange = args.includes("--allow-rework-scope-change");
  if (
    !appName ||
    !["confirm", "skip"].includes(mode ?? "") ||
    unknownArgs.length > 0 ||
    // flag は confirm 専用 (skip には検証対象の draft がない — skip --stdin / --dry-run 等の誤用も fail-closed)
    (mode === "skip" && args.length > 2) ||
    // confirm は --stdin 必須 (usage 契約と一致させる。pipe なし起動の stdin 待ち hang も防ぐ)
    (mode === "confirm" && !args.includes("--stdin"))
  ) {
    out({
      ok: false,
      code: "E_USAGE",
      ...(unknownArgs.length ? { unknown_args: unknownArgs } : {}),
      message: `usage: node commit-prompts.mjs <app_name> confirm --stdin [--dry-run] [--allow-non-english] [--allow-style-deviation] [--allow-rework-scope-change] | skip${unknownArgs.length ? ` — 未知の引数 ${JSON.stringify(unknownArgs)} (typo なら直して再実行。何も書き込んでいない)` : ""}`,
    });
  }

  // ── 前提の再 assert (gather 後の対話中に state が変わっていないかの防御。gather と同一 code) ──
  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, graphics, plan, excludedIds } = pre;
  const statePath = path.join(appRoot, "pipeline-state.json");

  // ── pipeline-state merge write の共通部 — preflight で読み込み済みの state をベースに merge する
  // (disk 再読込 + stub fallback は読込失敗時に全 state を潰す破壊経路 — 21c commit-taste と同判断) ──
  const state = pre.state;
  const writeState = (patchGraphics) => {
    if (!state.app_name) state.app_name = appName; // 必須 field の保全 assert
    if (!state.schema_version) state.schema_version = "2026-05-22"; // 欠落 = legacy の書き込み時補完
    state.screens ??= {};
    state.screens.graphics = patchGraphics;
    atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  };

  const reworkPending = Array.isArray(graphics.rework_pending) ? graphics.rework_pending : [];
  const promptsPath = path.join(appRoot, "graphics", "graphic-prompts.json");

  // ── skip: state のみ (§8-4 gate_21d_all_cancel — prompts ファイルは書かない) ──
  if (mode === "skip") {
    const warnings = [];
    if (reworkPending.length) {
      warnings.push(
        "rework_pending が残ったまま全 slot 中止 — 生成済み画像・21g 差し戻し指示は破棄扱いになる (decision=skip で 21e-21g は走らない)"
      );
    }
    if (fs.existsSync(promptsPath)) {
      warnings.push("残置 graphic-prompts.json はそのまま残る — 本ファイルの存在はブロック有効のシグナルではない (有効判定の SoT は pipeline-state、設計 §9-2b)");
    }
    const skipGraphics = { ...graphics, decision: "skip", decided_by: "step21d" };
    if (!reworkPending.length) delete skipGraphics.rework_pending; // 残置の空 [] は confirm 全消費時と同じ掃除 (空 queue と不在を区別しない)
    writeState(skipGraphics);
    out({
      ok: true,
      decision: "skip",
      decided_by: "step21d",
      ...(warnings.length ? { warnings } : {}),
      next: "21e-21g を skip し Step 15 (2nd Confluence save) へ素通し",
    });
  }

  // ── confirm: entry 制約を schema (SoT) から導出 ──
  let entrySchema = null;
  try {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    const items = schema?.properties?.prompts?.items;
    if (items?.required && items?.properties) entrySchema = items;
  } catch {
    // fall through — 下の E_SCHEMA_UNREADABLE で止める
  }
  if (!entrySchema) {
    out({ ok: false, code: "E_SCHEMA_UNREADABLE", message: "schemas/graphic-prompts.schema.json の prompts.items 定義が読めない/形が想定外 — 検証不能のため書き込まない" });
  }
  const allowedKeys = Object.keys(entrySchema.properties);

  // ── stdin の draft を検証 ──
  const raw = fs.readFileSync(0, "utf8");
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin が JSON として parse できません" });
  }
  if (typeof draft !== "object" || draft === null || Array.isArray(draft)) {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin は { prompts: [...] } の JSON object が必須" });
  }

  const errors = [];
  const DRAFT_KEYS = ["tool", "prompts", "omit"];
  const extraTop = Object.keys(draft).filter((k) => !DRAFT_KEYS.includes(k));
  if (extraTop.length) {
    const hint = extraTop.includes("confirmed_at") ? " (confirmed_at は本 script が採番する — draft に入れない)" : "";
    errors.push(`stdin に想定外の top-level key ${JSON.stringify(extraTop)} (許容: ${DRAFT_KEYS.join("/")})${hint}`);
  }
  if ("tool" in draft && (typeof draft.tool !== "string" || draft.tool === "")) {
    errors.push("tool は非空 string が必須 (省略時は既定値を採用)");
  }

  const prompts = draft.prompts;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    out({
      ok: false,
      code: "E_VALIDATION",
      errors: [...errors, "prompts は 1 件以上の配列が必須 (minItems 1 — 全 slot 生成中止なら confirm ではなく skip を使う、設計 §8-4)"],
    });
  }

  const targetIds = plan.slots.map((s) => s.graphic_id).filter((id) => !excludedIds.has(id));
  const targetSet = new Set(targetIds);

  // entry 単位: schema 導出の required / additionalProperties / 型 / pattern / size_px 形
  const seenIds = new Set();
  prompts.forEach((entry, i) => {
    const at = `prompts[${i}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(`${at}: entry は object が必須`);
      return;
    }
    for (const field of entrySchema.required) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === "") {
        errors.push(`${at}: 必須 field '${field}' が欠落`);
      }
    }
    const extra = Object.keys(entry).filter((k) => !allowedKeys.includes(k));
    if (extra.length) errors.push(`${at}: schema に無い field ${JSON.stringify(extra)} (additionalProperties: false)`);

    for (const [key, def] of Object.entries(entrySchema.properties)) {
      const v = entry[key];
      if (v === undefined) continue; // 欠落は required 検査が担う
      if (v === null) {
        // required の null は required 検査が「欠落」として検出済み。optional の null は素通りさせない —
        // schema type 違反のまま disk に固定され、以後の Write/Edit ツール経由の修正が hook R10 に
        // block される (21c commit-taste と同じ guard)
        if (!entrySchema.required.includes(key)) {
          errors.push(`${at}: ${key} が null — 「値なし」はキー省略で表現する (null は schema type 違反として disk に固定される)`);
        }
        continue;
      }
      if (def.type === "string") {
        if (v === "") continue; // 欠落扱い (required 検査が担う)
        if (typeof v !== "string") {
          errors.push(`${at}: ${key} は string 型が必須 (実際: ${Array.isArray(v) ? "array" : typeof v})`);
          continue;
        }
        if (def.pattern && !new RegExp(def.pattern).test(v)) errors.push(`${at}: ${key} '${v}' が pattern 違反 (${def.pattern})`);
      } else if (def.type === "boolean") {
        if (typeof v !== "boolean") errors.push(`${at}: ${key} は boolean 型が必須 (実際: ${typeof v})`);
      } else if (def.type === "object") {
        if (typeof v !== "object" || Array.isArray(v)) {
          errors.push(`${at}: ${key} は object 型が必須 (実際: ${Array.isArray(v) ? "array" : typeof v})`);
          continue;
        }
        for (const rf of def.required ?? []) {
          if (v[rf] === undefined || v[rf] === null) errors.push(`${at}: ${key}.${rf} が欠落`);
        }
        const extraSub = Object.keys(v).filter((k) => !Object.keys(def.properties ?? {}).includes(k));
        if (extraSub.length) errors.push(`${at}: ${key} に schema に無い field ${JSON.stringify(extraSub)}`);
        for (const [sk, sdef] of Object.entries(def.properties ?? {})) {
          const sv = v[sk];
          if (sv === undefined || sv === null) continue;
          if (sdef.type === "integer" && (typeof sv !== "number" || !Number.isInteger(sv) || (sdef.minimum !== undefined && sv < sdef.minimum))) {
            errors.push(`${at}: ${key}.${sk} は ${sdef.minimum ?? ""} 以上の整数が必須 (実際: ${JSON.stringify(sv)})`);
          }
        }
      }
    }

    // schema で表現できない制約 (schema description が SoT、本 script が書き込み前 enforce):
    const id = entry.graphic_id;
    if (typeof id === "string" && id) {
      if (seenIds.has(id)) {
        errors.push(`${at}: graphic_id '${id}' が重複 (1 graphic_id = 1 確定プロンプト — 重複すると 21e がどちらを使うか不定になる)`);
      }
      seenIds.add(id);
      if (excludedIds.has(id)) {
        errors.push(`${at}: graphic_id '${id}' は excluded_slots で除外済み — 21d で再確定できない (復活は設計 §5 の手動リセット運用)`);
      } else if (!targetSet.has(id)) {
        errors.push(`${at}: graphic_id '${id}' が graphic-plan.json の slots に存在しない (plan との 1:1 対応 — 存在する slot: ${targetIds.join(", ")})`);
      }
    }
  });

  // omit (取り下げの明示記録): plan 内・prompts と非重複・reason 必須。
  // null は「キー省略」に黙って縮退させない (tool: null と同じ非対称を作らない)
  const omit = draft.omit === undefined ? [] : draft.omit;
  const omitIds = new Set();
  if (!Array.isArray(omit)) {
    errors.push("omit は array が必須 (「取り下げなし」はキー省略で表現する)");
  } else {
    omit.forEach((o, i) => {
      const at = `omit[${i}]`;
      if (typeof o !== "object" || o === null || Array.isArray(o)) {
        errors.push(`${at}: entry は {graphic_id, reason} の object が必須`);
        return;
      }
      const id = o.graphic_id;
      if (typeof id !== "string" || !id) {
        errors.push(`${at}: graphic_id が欠落`);
        return;
      }
      if (typeof o.reason !== "string" || !o.reason.trim()) {
        errors.push(`${at}: reason (取り下げ理由) が欠落 — 無言の取り下げは禁止 (Operating Principle 4)`);
      }
      if (omitIds.has(id)) errors.push(`${at}: graphic_id '${id}' が omit 内で重複`);
      omitIds.add(id);
      if (seenIds.has(id)) errors.push(`${at}: graphic_id '${id}' が prompts と omit の両方に載っている (確定か取り下げか不定)`);
      if (!targetSet.has(id)) {
        errors.push(
          excludedIds.has(id)
            ? `${at}: graphic_id '${id}' は excluded_slots で除外済み — omit の対象外 (既に対象集合から外れている)`
            : `${at}: graphic_id '${id}' が graphic-plan.json の slots に存在しない`
        );
      }
    });
  }

  // 取りこぼし禁止: 対象 slot は prompts / omit のどちらかに必ず載せる
  const missing = targetIds.filter((id) => !seenIds.has(id) && !omitIds.has(id));
  if (missing.length) {
    errors.push(
      `対象 slot が prompts にも omit にも載っていない: ${missing.join(", ")} — 取り下げる場合は omit で明示する (無言の省略は「未完了」と区別できない)`
    );
  }

  // 21g 差し戻し slot は必ず再確定する (omit 不可 — 生成・埋め込み済み slot の取り下げは
  // 21g の per-slot 却下 [F-7、設計 §11 未定義] の領域であり、prompts entry を消すと
  // 旧画像が fresh のまま埋め込み対象に残る)
  const reworkIds = reworkPending.map((r) => r?.graphic_id).filter((id) => targetSet.has(id));
  const reworkMissing = reworkIds.filter((id) => !seenIds.has(id));
  if (reworkMissing.length) {
    errors.push(
      `21g 差し戻し (rework_pending) の slot が prompts に無い: ${reworkMissing.join(", ")} — 差し戻し slot は omit できない (再確定が必須。取り下げは 21g 側の却下手順による)`
    );
  }

  if (errors.length) out({ ok: false, code: "E_VALIDATION", errors });

  const warnings = [];

  // ── 21g 差し戻し (rework) の scope 凍結 (guide §6 逐語コピーの機械担保) ──
  // 21e の再生成判定は prompt + tool の digest (設計 §9-2b / schema tool description)。差し戻し
  // 対象外の entry 改変・取り下げ・tool 変更は、再利用すべき生成済み画像 (有料) まで stale 化して
  // 全量再課金になるため、prose 規約に頼らず commit が前回確定値との一致を検査する。
  // 意図的な scope 拡大のみ --allow-rework-scope-change で明示続行する。
  const isRework = reworkPending.length > 0;
  let existingFile = null;
  if (isRework) {
    try {
      existingFile = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
    } catch {
      existingFile = null;
    }
    if (!Array.isArray(existingFile?.prompts)) {
      existingFile = null;
      warnings.push(
        "rework だが残置 graphic-prompts.json が読めない — 対象外 entry の凍結検査を skip する (前回確定値を逐語再現できない slot は 21e が digest 不一致で再生成する)"
      );
    }
  }
  const prevTool = existingFile && typeof existingFile.tool === "string" && existingFile.tool ? existingFile.tool : null;
  // tool の決定: draft 明示 > (rework: 前回確定値の継承) > env / 既定値。rework で env 既定へ黙って
  // 落とすと tool 変更 = 全 slot digest 不一致 (schema の source_digest 契約) になるため継承を既定にする
  const tool = draft.tool || prevTool || DEFAULT_TOOL;
  const scopeViolations = [];
  if (existingFile) {
    if (prevTool && tool !== prevTool) {
      scopeViolations.push(`tool が前回確定値と異なる ('${prevTool}' → '${tool}') — tool は digest に含まれ全 slot が stale 化する (schema tool description)`);
    }
    // 比較は schema 導出 key の値のみ (undefined と欠落を同一視。null は上の検証で既に排除済み)。
    // 入れ子 object (size_px) は key 順を正規化する — {height, width} 順が違うだけの同値 entry を誤検出しない
    const canonVal = (v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonVal(v[k])]))
        : v;
    const normEntry = (e) => JSON.stringify(allowedKeys.map((k) => canonVal(e?.[k] ?? null)));
    const prevIds = new Set(existingFile.prompts.map((p) => p?.graphic_id).filter((id) => typeof id === "string"));
    for (const prev of existingFile.prompts) {
      const id = prev?.graphic_id;
      if (typeof id !== "string" || !targetSet.has(id) || reworkIds.includes(id)) continue;
      const cur = prompts.find((p) => p?.graphic_id === id);
      if (!cur) {
        scopeViolations.push(`${id}: 差し戻し対象外の確定済み entry が prompts に無い — 生成・埋め込み済み slot の取り下げは 21g 側の却下手順 (設計 §11) による`);
      } else if (normEntry(cur) !== normEntry(prev)) {
        scopeViolations.push(`${id}: 差し戻し対象外の entry が前回確定値から変更されている — 未改訂 slot は逐語コピーが契約 (guide §6。言い換えは digest 不一致 = 再課金)`);
      }
    }
    // 前回 omit された slot (前回 file に entry が無い対象 slot) の復活も scope 外 — 新規生成 = 再課金
    for (const cur of prompts) {
      const id = cur?.graphic_id;
      if (typeof id !== "string" || !targetSet.has(id) || reworkIds.includes(id) || prevIds.has(id)) continue;
      scopeViolations.push(`${id}: 前回確定 file に entry が無い対象 slot が prompts に追加されている (前回 omit の復活 or plan 追加) — 差し戻し scope 外の新規生成 (再課金)。前回 omit した slot は omit のまま維持する (guide §6)`);
    }
  }
  if (scopeViolations.length && !allowReworkScopeChange) {
    out({
      ok: false,
      code: "E_REWORK_SCOPE",
      violations: scopeViolations,
      message:
        "21g 差し戻しの再確定で対象外 entry / tool に変更がある — 差し戻し slot 以外は前回確定値の逐語保持が契約 (guide §6)。意図的な変更のみ --allow-rework-scope-change を付けて再実行する (何も書き込んでいない)",
    });
  }
  if (allowReworkScopeChange && scopeViolations.length) {
    warnings.push(`rework scope 外の変更を明示続行 (--allow-rework-scope-change): ${scopeViolations.join(" / ")}`);
  }

  // ── prompt 内容の契約検査 (検証 NG と別 code — routing 先が違う) ──
  // 日本語混入は確定前に止める (21e が英語のまま生成 API へ渡す前提 — 21c と同一契約)。
  const nonEnglishIds = prompts.filter((p) => containsNonEnglish(p.prompt)).map((p) => p.graphic_id);
  if (!allowNonEnglish && nonEnglishIds.length) {
    out({
      ok: false,
      code: "E_NON_ENGLISH",
      graphic_ids: nonEnglishIds,
      message:
        "prompt に日本語が含まれる — 21e が英語のまま生成 API へ渡す前提 (schema 参照)。誤りなら英訳して再実行、固有名詞の原語表記等の意図的なケースのみ --allow-non-english を付けて再実行する (文字入れ [embedded text] 指示は意図的でも不可 — schema の禁止事項。何も書き込んでいない)",
    });
  }
  // style_directive の逐語合成 (schema prompt description: 「taste.style_directive (共通テイスト) +
  // ... を 21d が合成」)。テイスト一貫性 (同プロジェクトのグラフィックが同テイストに揃うこと) の
  // 機械担保 — 逸脱は言い換えではなく意図的な例外としてのみ許す。
  const directive = normWs(plan.taste.style_directive);
  const deviatedIds = prompts.filter((p) => !normWs(p.prompt).includes(directive)).map((p) => p.graphic_id);
  if (!allowStyleDeviation && deviatedIds.length) {
    out({
      ok: false,
      code: "E_STYLE_DEVIATION",
      graphic_ids: deviatedIds,
      message:
        "prompt に taste.style_directive が逐語で含まれていない — 全 slot 共通合成がテイスト一貫性の担保 (言い換え・要約は不可)。当該 slot だけ意図的に画風を変える場合のみ --allow-style-deviation を付けて再実行する (何も書き込んでいない)",
    });
  }

  if (allowNonEnglish && nonEnglishIds.length) warnings.push(`日本語混入を明示続行 (--allow-non-english): ${nonEnglishIds.join(", ")}`);
  if (allowStyleDeviation && deviatedIds.length) warnings.push(`style_directive 逸脱を明示続行 (--allow-style-deviation): ${deviatedIds.join(", ")}`);

  if (dryRun) {
    out({
      ok: true,
      dry_run: true,
      prompt_count: prompts.length,
      graphic_ids: prompts.map((p) => p.graphic_id),
      omitted: [...omitIds],
      ...(warnings.length ? { warnings } : {}),
      next: "検証 OK (何も書き込んでいない) — 確定確認を経て --dry-run なしで再実行する",
    });
  }

  // ── 書き込み: graphic-prompts.json 一括生成 + state prompts_confirmed_at / rework 消費 ──
  const confirmedAt = isoNow();
  let backedUp = null;
  if (fs.existsSync(promptsPath)) {
    // 21g 差し戻しの再確定 / 中断再入で残置ファイルがある場合のみ退避してから上書き
    backedUp = backupFile(appRoot, promptsPath);
  }
  fs.mkdirSync(path.dirname(promptsPath), { recursive: true });
  // schema_version は書かない — schema で deprecated (「新規に書かない (21d の Write にも含めない)」)。
  // 既存 file に残存する値は読み側が受理して無視する (backup 復元等の carry-over も無害)
  atomicWriteFileSync(
    promptsPath,
    JSON.stringify(
      {
        app_name: appName,
        tool,
        confirmed_at: confirmedAt,
        prompts,
      },
      null,
      2
    ) + "\n"
  );

  const remainingRework = reworkPending.filter((r) => !seenIds.has(r?.graphic_id));
  const nextGraphics = { ...graphics, prompts_confirmed_at: confirmedAt };
  if (remainingRework.length) nextGraphics.rework_pending = remainingRework; // 対象外 slot の stale entry のみ残る (gather が warning 済み)
  else delete nextGraphics.rework_pending; // 全消費 = queue 除去 (§9-2b)。残置の空 [] もここで掃除する (空 queue と不在を区別しない)
  writeState(nextGraphics);

  out({
    ok: true,
    prompts_path: path.relative(repoRoot, promptsPath),
    prompts_confirmed_at: confirmedAt,
    tool,
    prompt_count: prompts.length,
    graphic_ids: prompts.map((p) => p.graphic_id),
    omitted: [...omitIds],
    ...(reworkIds.length ? { rework_consumed: reworkIds } : {}),
    ...(backedUp ? { backed_up: path.relative(repoRoot, backedUp) } : {}),
    ...(warnings.length ? { warnings } : {}),
    next: "Step 21e graphic-generate (グラフィック生成) へ",
  });
} catch (e) {
  console.error(`commit-prompts.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
