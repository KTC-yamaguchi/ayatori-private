#!/usr/bin/env node
// Step 21g (graphic-embed-review) の一括タグ書き換え + src↔正典存在照合 (決定的 script)。
// POCTEAMA-190 (F-7 埋め込み + 承認)
//
// usage:
//   node embed-graphics.mjs <app_name> apply --stdin              # stdin = LLM の配置判断 (挿入位置のみ LLM)
//   node embed-graphics.mjs <app_name> apply --stdin --dry-run    # 検証のみ・書き込みゼロ
//   node embed-graphics.mjs <app_name> verify                     # 埋め込み済み状態の検査 (書き込みなし)
//   node embed-graphics.mjs <app_name> apply|verify --delta [--screens a,b]
//                                                                 # Step 29 (delta 再埋め込み) — 承認済み前提
//                                                                 # (apply の --screens は --delta 時のみ許可)
//
// 責務分界 (pipeline.yaml screens.graphic_generation.html_transform_policy = deterministic_script):
//   「どこに挿すか」の判断 (anchor 選定) は LLM (SKILL.md Step 2)。タグの組み立て・一括書き換え・
//   src↔正典の存在照合・C-26 属性検査は本 script。<img> タグは本 script だけが組み立てる —
//   LLM が書いた生タグは受け取らない (C-26 逸脱をコードで塞ぐ)。
//
// stdin 契約 (apply):
//   { "placements": [ { "graphic_id": "...",
//                       "file": "screens/web/01-login.html",        // gather の embed_targets の 1 つ
//                       "insert_after": "<一意な逐語 HTML スニペット>",  // insert_before と排他 (どちらか必須)
//                       "attrs": { "width": 800, "height": 400,      // 必須 (C-26: 明示必須)
//                                  "object_fit": "cover",            // 任意 (cover|contain のみ — C-26)
//                                  "class": "hero-img" } } ] }       // 任意
//
// 書き込み (設計 §7):
//   - screens/{platform}/*.html: 対象 graphic_id の既存埋め込みタグを除去してから挿入 (再実行冪等)。
//     置換前に _backup/ へ self-backup する (Bash 起動は backup-on-edit.sh を発火しないため —
//     preflight.backupFile が hook と同じ md5 dedup + cooldown で退避する)。
//   - 生成タグ: <img src="../_shared/graphics/{basename}" alt="{graphic_id}" width height
//     [class] [style="object-fit:..."]> — C-26 準拠 (Base64 不可 / SVG 不可 / alt = graphic_id)。
// 検証 NG (E_VALIDATION) は一切書き込まない。exit code は常に 0 (routing は JSON の code)。

import fs from "node:fs";
import path from "node:path";
import {
  assertPreflight,
  backupFile,
  computeEmbedTargets,
  findEmbeddedTags,
  findOrphanTags,
  repoRoot,
  resolveMainScreens,
  verifyEmbeds,
} from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** C-26 準拠の <img> タグを組み立てる (本 script が唯一の組み立て箇所)。 */
export function buildImgTag(basename, graphicId, attrs) {
  const parts = [
    `src="../_shared/graphics/${escAttr(basename)}"`,
    `alt="${escAttr(graphicId)}"`,
    `width="${attrs.width}"`,
    `height="${attrs.height}"`,
  ];
  if (attrs.class) parts.push(`class="${escAttr(attrs.class)}"`);
  if (attrs.object_fit) parts.push(`style="object-fit:${attrs.object_fit}"`);
  return `<img ${parts.join(" ")}>`;
}

/** 対象 graphic_id の既存埋め込みタグを除去する (再実行冪等の下ごしらえ)。タグ前後の空行は 1 つに畳む。 */
function removeEmbeddedTags(html, graphicId) {
  let removed = 0;
  for (const { tag } of findEmbeddedTags(html, graphicId)) {
    html = html.replace(tag + "\n", "").replace(tag, "");
    removed++;
  }
  return { html, removed };
}

try {
  const args = process.argv.slice(2);
  const [appName, mode] = args;
  const KNOWN_FLAGS = ["--stdin", "--dry-run", "--screens", "--delta"];
  const flagArgs = args.slice(2);
  const unknownArgs = [];
  let screensFilter = null;
  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i];
    if (a === "--screens" && typeof flagArgs[i + 1] === "string" && !flagArgs[i + 1].startsWith("--")) {
      screensFilter = new Set(flagArgs[i + 1].split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (!KNOWN_FLAGS.includes(a) || a === "--screens") {
      unknownArgs.push(a);
    }
  }
  const dryRun = args.includes("--dry-run");
  const delta = args.includes("--delta");
  if (
    !appName ||
    !["apply", "verify"].includes(mode ?? "") ||
    unknownArgs.length > 0 ||
    (mode === "apply" && !args.includes("--stdin")) ||          // pipe なし起動の stdin 待ち hang 防止
    (screensFilter && !delta) ||                                // --screens は delta (Step 29) 専用 — 本流での誤絞り込み防止
    (mode === "verify" && (args.includes("--stdin") || dryRun)) // verify は書き込みが無い — flag 誤用も fail-closed
  ) {
    out({
      ok: false,
      code: "E_USAGE",
      ...(unknownArgs.length ? { unknown_args: unknownArgs } : {}),
      message: `usage: node embed-graphics.mjs <app_name> apply --stdin [--dry-run] | verify — [--delta [--screens a,b]] は Step 29 用${unknownArgs.length ? ` — 未知の引数 ${JSON.stringify(unknownArgs)} (typo なら直して再実行。何も書き込んでいない)` : ""}`,
    });
  }

  // ── 前提の再 assert (gather 後の対話中に state が変わっていないかの防御。gather と同一 code) ──
  const pre = assertPreflight(appName, { delta });
  if (pre.error) out(pre.error);
  const { appRoot, targetEntries, slotMeta } = pre;

  // 対象 slot ごとの正典 + 埋め込み先実ファイル集合を導出 (gather / commit と共有ロジック)
  const { files: mainFiles } = resolveMainScreens(appRoot);
  const computed = computeEmbedTargets(appRoot, targetEntries, slotMeta, mainFiles, screensFilter);
  if (computed.error) out(computed.error);
  const { targets } = computed;

  // ── verify: 埋め込み済み状態の検査 (21g 承認 commit / Step 29 再埋め込みの前後検査) ──
  if (mode === "verify") {
    out({ ok: true, target_count: targets.size, ...verifyEmbeds(appRoot, targets, mainFiles, screensFilter) });
  }

  // ── apply: stdin の配置判断を検証して一括書き換え ──
  const raw = fs.readFileSync(0, "utf8");
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin が JSON として parse できません" });
  }
  const placements = draft?.placements;
  if (typeof draft !== "object" || draft === null || Array.isArray(draft) || !Array.isArray(placements) || placements.length === 0) {
    out({ ok: false, code: "E_BAD_INPUT", message: "stdin は { placements: [...] } (1 件以上) の JSON object が必須" });
  }
  const extraTop = Object.keys(draft).filter((k) => k !== "placements");
  const errors = [];
  if (extraTop.length) errors.push(`stdin に想定外の top-level key ${JSON.stringify(extraTop)} (許容: placements)`);

  const PLACEMENT_KEYS = ["graphic_id", "file", "insert_before", "insert_after", "attrs"];
  const ATTR_KEYS = ["width", "height", "object_fit", "class"];
  const seen = new Set(); // "{graphic_id} {file}"

  placements.forEach((p, i) => {
    const at = `placements[${i}]`;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      errors.push(`${at}: entry は object が必須`);
      return;
    }
    const extra = Object.keys(p).filter((k) => !PLACEMENT_KEYS.includes(k));
    if (extra.length) errors.push(`${at}: 想定外の field ${JSON.stringify(extra)}`);
    const id = p.graphic_id;
    if (typeof id !== "string" || !targets.has(id)) {
      errors.push(`${at}: graphic_id '${id}' が埋め込み対象集合に無い (対象: ${[...targets.keys()].join(", ")})`);
      return;
    }
    if (typeof p.file !== "string" || !targets.get(id).files.has(p.file)) {
      errors.push(`${at}: file '${p.file}' が slot '${id}' の埋め込み先 (plan platforms × main HTML) に無い`);
      return;
    }
    const key = `${id} ${p.file}`;
    if (seen.has(key)) errors.push(`${at}: (${id}, ${p.file}) が重複`);
    seen.add(key);
    for (const k of ["insert_before", "insert_after"]) {
      if (p[k] !== undefined && (typeof p[k] !== "string" || p[k].length === 0)) {
        errors.push(`${at}: ${k} は非空 string が必須 (不要ならキー省略 — 非 string は anchor 判定を狂わせる)`);
      }
    }
    const hasBefore = typeof p.insert_before === "string" && p.insert_before.length > 0;
    const hasAfter = typeof p.insert_after === "string" && p.insert_after.length > 0;
    if (hasBefore === hasAfter) errors.push(`${at}: insert_before / insert_after はどちらか一方のみ必須`);
    const attrs = p.attrs;
    if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs)) {
      errors.push(`${at}: attrs は object が必須`);
      return;
    }
    const extraAttrs = Object.keys(attrs).filter((k) => !ATTR_KEYS.includes(k));
    if (extraAttrs.length) errors.push(`${at}: attrs に想定外の field ${JSON.stringify(extraAttrs)} (許容: ${ATTR_KEYS.join("/")} — style 直書きは object_fit 経由のみ)`);
    for (const k of ["width", "height"]) {
      if (!Number.isInteger(attrs[k]) || attrs[k] < 1) errors.push(`${at}: attrs.${k} は 1 以上の整数が必須 (C-26: 明示必須。基準は prompts の size_px)`);
    }
    if (attrs.object_fit !== undefined && !["cover", "contain"].includes(attrs.object_fit)) {
      errors.push(`${at}: attrs.object_fit は cover|contain のみ可 (C-26)`);
    }
    if (attrs.class !== undefined && (typeof attrs.class !== "string" || !attrs.class.trim())) {
      errors.push(`${at}: attrs.class は非空 string (不要ならキー省略)`);
    }
  });

  // 取りこぼし禁止: 対象 slot × 埋め込み先の全組合せを placements が被覆する (21d の omit 相当は
  // 21g では却下手順 [commit-approval reject] の領域 — 無言の省略は「未完了」と区別できない)
  const missing = [];
  for (const [id, t] of targets) {
    for (const rel of t.files) {
      if (!seen.has(`${id} ${rel}`)) missing.push(`(${id}, ${rel})`);
    }
  }
  if (missing.length) {
    errors.push(`対象 slot × 埋め込み先が placements に無い: ${missing.join(", ")} — 全対象を被覆する (外したい slot は却下手順 [SKILL Step 4-B] による)`);
  }

  if (errors.length) out({ ok: false, code: "E_VALIDATION", errors });

  // ── anchor 検証 + 書き換え内容の組み立て (ファイル単位。既存タグ除去後の内容で一意性を検査) ──
  const byFile = new Map();
  for (const p of placements) (byFile.get(p.file) ?? byFile.set(p.file, []).get(p.file)).push(p);
  const anchorErrors = [];
  const results = new Map(); // rel → { html, removed }
  for (const [rel, list] of byFile) {
    let html = fs.readFileSync(path.join(appRoot, rel), "utf8");
    let removed = 0;
    for (const p of list) {
      const r = removeEmbeddedTags(html, p.graphic_id);
      html = r.html;
      removed += r.removed;
    }
    for (const p of list) {
      const anchor = p.insert_before ?? p.insert_after;
      const first = html.indexOf(anchor);
      const count = first === -1 ? 0 : html.indexOf(anchor, first + 1) === -1 ? 1 : 2;
      if (count !== 1) {
        anchorErrors.push(`(${p.graphic_id}, ${rel}): anchor の出現が ${count === 0 ? 0 : "2 以上"} 件 — 一意 1 件の逐語スニペットを選び直す`);
        continue;
      }
      const tag = buildImgTag(targets.get(p.graphic_id).basename, p.graphic_id, p.attrs);
      // index splice で挿入する — (a) String.replace の replacement string は anchor 内の
      // $$ / $& 等が GetSubstitution 展開されて HTML を無言破壊する、(b) タグは前後の改行を
      // 見て独立行に正規化する (anchor が末尾改行を含む等の合法な選び方でも
      // `<img ...><section ...>` の同一行連結を作らない — 生成物の可読性 / diff レビュー性)
      const isBefore = p.insert_before !== undefined && p.insert_before !== null && p.insert_before !== "";
      const at = isBefore ? first : first + anchor.length;
      const nlBefore = at > 0 && html[at - 1] !== "\n" ? "\n" : "";
      const nlAfter = at < html.length && html[at] !== "\n" ? "\n" : "";
      html = html.slice(0, at) + nlBefore + tag + nlAfter + html.slice(at);
    }
    results.set(rel, { html, removed });
  }
  if (anchorErrors.length) out({ ok: false, code: "E_ANCHOR", errors: anchorErrors, message: "anchor を一意な逐語スニペットに直して再実行する (何も書き込んでいない)" });

  // 孤児タグ (対象外 graphic_id の正典参照 — 埋め込み後に 21e commit-degrade 等で excluded 化した
  // slot のタグ残置) も apply が除去する。verifyEmbeds の orphan 検出と同一定義 — 検出 (承認 block)
  // だけで script の除去経路が無いと deterministic_script 方針が手動 Edit に dead-end する
  const orphans = findOrphanTags(appRoot, targets, mainFiles, screensFilter);

  if (dryRun) {
    out({
      ok: true,
      dry_run: true,
      placement_count: placements.length,
      files: [...results.keys()],
      ...(orphans.length ? { orphan_tags_to_remove: orphans.map(({ file, alt }) => ({ file, alt })) } : {}),
      next: "検証 OK (何も書き込んでいない) — 提示・確認を経て --dry-run なしで再実行する",
    });
  }

  // ── 書き込み: self-backup → 一括置換 (placements) → 孤児タグ除去 → 書き込み後検証 ──
  const backedUp = [];
  for (const [rel, r] of results) {
    const abs = path.join(appRoot, rel);
    const dest = backupFile(appRoot, abs);
    if (dest) backedUp.push(path.relative(repoRoot, dest));
    fs.writeFileSync(abs, r.html);
  }
  for (const rel of new Set(orphans.map((o) => o.file))) {
    const abs = path.join(appRoot, rel);
    let html = fs.readFileSync(abs, "utf8"); // placements 書き込み後の内容から除去する (同一ファイル共存可)
    const dest = backupFile(appRoot, abs);
    if (dest) backedUp.push(path.relative(repoRoot, dest));
    for (const o of orphans.filter((x) => x.file === rel)) html = html.replace(o.tag + "\n", "").replace(o.tag, "");
    fs.writeFileSync(abs, html);
  }
  // 書き込み後の自己検証 (期待タグの存在 — 置換の取りこぼしを黙って通さない)
  const postMissing = [];
  for (const p of placements) {
    const html = fs.readFileSync(path.join(appRoot, p.file), "utf8");
    if (findEmbeddedTags(html, p.graphic_id).length !== 1) postMissing.push(`(${p.graphic_id}, ${p.file})`);
  }
  if (postMissing.length) {
    out({ ok: false, code: "E_POST_VERIFY", errors: postMissing, message: "書き込み後検証で期待タグが見つからない — _backup/ から復元して原因を確認する" });
  }

  out({
    ok: true,
    placement_count: placements.length,
    files: [...results.keys()],
    removed_stale_tags: [...results.values()].reduce((n, r) => n + r.removed, 0),
    ...(orphans.length ? { removed_orphan_tags: orphans.map(({ file, alt }) => ({ file, alt })) } : {}),
    ...(backedUp.length ? { backed_up: backedUp } : {}),
    next: "render-embed-review.mjs で視覚レポートを再生成し、人間ゲート (SKILL Step 3) へ",
  });
} catch (e) {
  console.error(`embed-graphics.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
