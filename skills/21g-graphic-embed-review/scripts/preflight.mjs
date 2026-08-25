// Step 21g 共有ヘルパ — 前提 assert / 対象集合導出 / 汎用 IO。
// POCTEAMA-190 (F-7 埋め込み + 承認)
//
// gather-context.mjs / embed-graphics.mjs / render-embed-review.mjs / commit-approval.mjs /
// route-rework.mjs が import する named-export モジュール (21b/21c/21d の preflight.mjs と同じ
// 分離パターン)。前提条件を 1 実装に集約し、全 script の返す E_* code を機械的に同一に保つ。
// 21d の preflight とは assert 内容が異なる (21f 完了済み / 未承認 / 対象集合 = fresh generated −
// excluded) ため import 共有はせず、skill ディレクトリ単位で自己完結させる (skill の独立移動性を
// 優先)。**例外**: source_digest の導出は 21e (writer) との byte 一致が契約 (設計 §9-2b) のため、
// 唯一 `skills/21e-graphic-generate/scripts/preflight.mjs` の `sourceDigestOf` を import する
// (透過 slot は tool_transparent 側で digest を導出する等の規約ごと writer 実装を共有する —
// 21g は 21e の出力なしには成立しないため、この方向の依存は skill 独立移動性と矛盾しない)。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceDigestOf } from "../../21e-graphic-generate/scripts/preflight.mjs";

export const repoRoot =
  process.env.AYATORI_REPO_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * read-modify-write する JSON の原子的置換 — 同 dir の tmp に書いてから rename する。
 * 直接 writeFileSync だと書き込み途中の kill / ENOSPC で元ファイルが半端な JSON に truncate され、
 * pipeline-state.json の場合は前 Phase 含む全 state を失う (readJson が null → E_STATE_MISSING で
 * resume 不能)。rename(2) は同一 filesystem 内で原子的 — 旧内容か新内容のどちらかしか観測されない。
 * write / rename どちらの失敗でも tmp を掃除してから rethrow する (残骸を artifacts に残さない —
 * ENOSPC の部分書き込み tmp も対象。掃除自体の失敗は握りつぶして元エラーを優先する)。
 * 21a-21f と同一の逐字複製 (計 7 skill) — 21f の verbatim-sync eval が一致を固定する (変更は 7 skill 同時に)。
 */
export function atomicWriteFileSync(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 掃除失敗で元エラーを隠さない
    }
    throw e;
  }
}

/** ISO 8601 ローカル timezone offset 付き現在時刻 (例: 2026-08-04T15:00:00+09:00)。 */
export function isoNow() {
  const now = new Date();
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(now.getTime() + offMin * 60000);
  return local.toISOString().slice(0, 19) + `${sign}${pad(offMin / 60)}:${pad(offMin % 60)}`;
}

/** _backup/ ミラー規約 (pipeline.yaml § artifact_backup: {stem}.{YYYYMMDD_HHMMSS}.{ext}) への退避。
 *  21g の一括タグ書き換えは Bash 起動のため backup-on-edit.sh (PreToolUse Write|Edit) が発火しない —
 *  embed script 自身が置換前に退避する責務を持つ (設計 §7 / pipeline.yaml html_transform_policy)。
 *  hook と同挙動に合わせ、21d の backupFile に (1) md5 dedup (直前バックアップと同一内容なら複製
 *  しない) と (2) cooldown (直近 AYATORI_BACKUP_COOLDOWN_SECONDS 秒以内、既定 180、0 で無効) を追加。
 *  同一秒の衝突は `-{i}` 連番で回避する (silent 上書きによる退避消失を防ぐ)。
 *  @returns {string|null} 退避先 abs path (dedup/cooldown で skip した場合は null) */
export function backupFile(appRoot, absPath) {
  const rel = path.relative(appRoot, absPath);
  const dir = path.join(appRoot, "_backup", path.dirname(rel));
  const ext = path.extname(absPath);
  const stem = path.basename(absPath, ext);

  // 直前バックアップ (同 stem・同 ext の最新 mtime) を探す — md5 dedup / cooldown 判定
  let latest = null;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(`${stem}.`) || (ext && !f.endsWith(ext))) continue;
      const p = path.join(dir, f);
      if (!latest || fs.statSync(p).mtimeMs > fs.statSync(latest).mtimeMs) latest = p;
    }
  }
  if (latest) {
    const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
    if (md5(absPath) === md5(latest)) return null; // (1) 内容同一 — no-op rewrite の増殖防止
    const cooldown = Number(process.env.AYATORI_BACKUP_COOLDOWN_SECONDS ?? 180);
    if (cooldown > 0 && Date.now() - fs.statSync(latest).mtimeMs < cooldown * 1000) return null; // (2)
  }

  const stamp = isoNow().slice(0, 19).replace(/-|:/g, "").replace("T", "_");
  fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, `${stem}.${stamp}${ext}`);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(dir, `${stem}.${stamp}-${i}${ext}`);
  fs.copyFileSync(absPath, dest);
  return dest;
}

const THEMES = new Set(["light", "dark"]);
export const SCREEN_PLATFORMS = ["web", "web-sm", "mobile"];

/**
 * main 画面の論理 stem → 実ファイル名を platform ごとに解決する (21b/21d preflight と同一実装 —
 * skill の独立移動性優先で import 共有はしない)。Step 17 の命名規約: 単一テーマ = {screen}.html /
 * dual_theme = {screen}--light.html + --dark.html。sub-state variant は除外する。
 * 21g では埋め込み先の実ファイル解決に使う — dual_theme では 1 slot × 1 platform が 2 ファイル
 * (--light/--dark 両方に埋め込む。state_scope: default_only は sub-state 除外の意味であり、
 * theme variant は両方とも main である)。
 * @returns {{ files: Object<string, Object<string,string[]>> }} platform → 論理 stem → 実ファイル名
 */
export function resolveMainScreens(appRoot) {
  const files = {};
  for (const platform of SCREEN_PLATFORMS) {
    const dir = path.join(appRoot, "screens", platform);
    if (!fs.existsSync(dir)) continue;
    const map = {};
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".html"))) {
      const parts = f.slice(0, -5).split("--");
      if (THEMES.has(parts[parts.length - 1])) parts.pop(); // theme 軸を剥がす
      if (parts.length > 1) continue; // 残った "--" 軸 = sub-state variant
      (map[parts[0]] ??= []).push(f);
    }
    files[platform] = map;
  }
  return { files };
}

/**
 * 正典グラフィックの実ファイルを解決する (READ-ONLY — 21g は screens/_shared/graphics/ を書かない)。
 * generated_files[].file は 21e 時点で `graphics/raw/{id}.png` を指し、21f (F-6) が正典パスへ
 * 更新する契約 (pipeline-state schema の graphics description)。**正典配下を指す場合のみ** file を
 * 採用し (raw/ 残置のまま basename を src に使うと src↔実体が乖離する)、それ以外は graphic_id
 * stem の {webp,png} を探す (C-26 の両拡張子を許容 — F-6 の圧縮 degrade で png のまま残るケース)。
 * @returns {{abs: string, rel: string}|null} rel は app ルート相対
 */
export function resolveCanonical(appRoot, entry) {
  const candidates = [];
  if (typeof entry?.file === "string" && entry.file.startsWith("screens/_shared/graphics/")) candidates.push(entry.file);
  for (const ext of ["webp", "png"]) candidates.push(`screens/_shared/graphics/${entry?.graphic_id}.${ext}`);
  for (const rel of candidates) {
    const abs = path.join(appRoot, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return { abs, rel };
  }
  return null;
}

/** 孤児タグ (正典参照だが対象集合に属さない <img>) の走査 — verifyEmbeds の検出と embed apply の
 *  除去が同一定義を共有する (検出だけあって script の除去経路が無いと deterministic_script 方針が
 *  手動 Edit に dead-end する)。判定は (alt, file) の 2 軸 — alt が対象外 (却下/excluded 化) だけで
 *  なく、**対象 slot でも埋め込み先集合に無いファイルへの残置** (plan 再確定で配置画面が移った等)
 *  を孤児とする (alt 単独判定だと移動元のタグが検査をすり抜けて承認まで通る)。 */
export function findOrphanTags(appRoot, targets, mainFiles, screensFilter = null) {
  const orphans = [];
  for (const platform of Object.keys(mainFiles)) {
    for (const [screen, names] of Object.entries(mainFiles[platform])) {
      if (screensFilter && !screensFilter.has(screen)) continue;
      for (const name of names) {
        const rel = `screens/${platform}/${name}`;
        const html = fs.readFileSync(path.join(appRoot, rel), "utf8");
        const re = /<img\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
          const src = (m[0].match(/\bsrc=["']([^"']*)["']/) ?? [])[1] ?? "";
          if (!src.includes("_shared/graphics/")) continue;
          const alt = (m[0].match(/\balt=["']([^"']*)["']/) ?? [])[1] ?? "";
          if (!targets.has(alt) || !targets.get(alt).files.has(rel)) orphans.push({ file: rel, alt, src, tag: m[0] });
        }
      }
    }
  }
  return orphans;
}

/** 対象 graphic_id の埋め込み済み <img> タグ検出 (alt = graphic_id AND src が正典参照)。
 *  文字列レベル走査 — DOM parser 不使用 (render-recommend-html.mjs と同方針)。
 *  CLI entry を持つ兄弟 script 間の import は top-level 実行を誘発するため、純関数は本モジュールに置く。 */
export function findEmbeddedTags(html, graphicId) {
  const tags = [];
  const re = /<img\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const alt = (tag.match(/\balt=["']([^"']*)["']/) ?? [])[1];
    const src = (tag.match(/\bsrc=["']([^"']*)["']/) ?? [])[1] ?? "";
    if (alt === graphicId && src.includes("_shared/graphics/")) tags.push({ start: m.index, tag });
  }
  return tags;
}

/**
 * 対象 slot ごとの正典 basename + 埋め込み先実ファイル集合を導出する (gather / embed / commit で
 * 同一ロジックを共有 — 対象集合の解釈が script 間で割れると「検証した集合」と「書いた集合」が
 * 食い違う)。screensFilter は Step 29 (delta) の対象画面絞り込み用。
 *
 * plan が期待する (screen, platform) 組に main HTML が 1 つも解決できない場合は fail-closed
 * (E_TARGET_FILES_MISSING) — 部分欠落 (2 platform 中 1 つだけリネーム等) を黙って落とすと、
 * verifyEmbeds は実在ファイルしか見ないため <img> 欠落 platform のまま承認が通る。
 * allowLost は reject (却下) 専用の逃し弁 — 却下はこの状態からの復旧経路のため、復旧コマンド自身が
 * 同 assert に弾かれる円環 (21e commit-degrade の先例) を作らない。
 * @returns {{error: object}} 正典欠落 / 埋め込み先欠落 / {{targets: Map<string,{basename:string, files:Set<string>}>}}
 */
export function computeEmbedTargets(appRoot, targetEntries, slotMeta, mainFiles, screensFilter = null, { allowLost = false } = {}) {
  const targets = new Map();
  const canonMissing = [];
  const lostCombos = [];
  for (const g of targetEntries) {
    const canonical = resolveCanonical(appRoot, g);
    if (!canonical) {
      canonMissing.push(g.graphic_id);
      continue;
    }
    const files = new Set();
    for (const s of slotMeta.get(g.graphic_id) ?? []) {
      if (screensFilter && !screensFilter.has(s.screen)) continue;
      for (const platform of s.platforms ?? []) {
        const names = mainFiles[platform]?.[s.screen] ?? [];
        if (names.length === 0) {
          // 同一 (id, screen, platform) の重複 push を防ぐ (同 screen に placement 違いの slot 複数は合法)
          if (!lostCombos.some((c) => c.graphic_id === g.graphic_id && c.screen === s.screen && c.platform === platform)) {
            lostCombos.push({ graphic_id: g.graphic_id, screen: s.screen, platform });
          }
          continue;
        }
        for (const name of names) files.add(`screens/${platform}/${name}`);
      }
    }
    targets.set(g.graphic_id, { basename: path.basename(canonical.rel), files });
  }
  if (canonMissing.length) {
    return {
      error: {
        ok: false,
        code: "E_CANON_MISSING",
        graphic_ids: canonMissing,
        message: `正典 screens/_shared/graphics/ に実ファイルが無い対象 slot: ${canonMissing.join(", ")} — 21f 完了記録と矛盾 (src↔正典の存在照合、設計 §7)。21e/21f の再実行を確認する`,
      },
    };
  }
  if (lostCombos.length && !allowLost) {
    return {
      error: {
        ok: false,
        code: "E_TARGET_FILES_MISSING",
        combos: lostCombos,
        message: `埋め込み先 main HTML が解決できない (screen, platform) 組: ${lostCombos.map((c) => `(${c.graphic_id}: ${c.screen}/${c.platform})`).join(", ")} — 21b 確定後に screens/ が変わった可能性 (画面リネームなら plan の再確定、対象から外すなら reject による却下)。書き込みゼロのまま中断`,
      },
    };
  }
  return { targets };
}

/**
 * 埋め込み済み状態の検査 (21g 承認 commit の前提検査 / embed verify / Step 29 再埋め込みの前後検査)。
 * C-26 の機械検査 (src 正典相対参照 / width・height 明示 / object-fit cover|contain のみ) +
 * 取りこぼし (missing) / 重複 / 孤児タグ (対象外 graphic_id の正典参照が残置 — 却下漏れ等) を返す。
 */
export function verifyEmbeds(appRoot, targets, mainFiles, screensFilter = null) {
  const missing = [];
  const duplicates = [];
  const violations = [];
  const placeholderResidues = [];
  for (const [id, t] of targets) {
    for (const rel of t.files) {
      const html = fs.readFileSync(path.join(appRoot, rel), "utf8");
      const tags = findEmbeddedTags(html, id);
      if (tags.length === 0) missing.push({ graphic_id: id, file: rel });
      if (tags.length > 1) duplicates.push({ graphic_id: id, file: rel, count: tags.length });
      // 置き換え指定 placeholder の残置検出 (warning — complete には含めない): <img> 埋め込み済みの
      // 同一ファイルに Step 17 標準形 `<div class="illust-placeholder" data-scene={graphic_id}>` が
      // 残っている = SKILL Step 2-4 の Edit 除去漏れの疑い (img と placeholder の同時表示)。
      // data-scene ↔ graphic_id の一致は慣例であって不変量ではないため hard fail にしない
      if (tags.length > 0) {
        const divRe = /<div\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
        let dm;
        while ((dm = divRe.exec(html)) !== null) {
          const cls = (dm[0].match(/\bclass=["']([^"']*)["']/) ?? [])[1] ?? "";
          if (!cls.split(/\s+/).includes("illust-placeholder")) continue;
          if (((dm[0].match(/\bdata-scene=["']([^"']*)["']/) ?? [])[1]) === id) {
            placeholderResidues.push({ graphic_id: id, file: rel });
          }
        }
      }
      for (const { tag } of tags) {
        const src = (tag.match(/\bsrc=["']([^"']*)["']/) ?? [])[1] ?? "";
        if (src !== `../_shared/graphics/${t.basename}`) violations.push({ graphic_id: id, file: rel, violation: `src が正典相対参照と不一致: ${src}` });
        if (!/\bwidth=["']\d+["']/.test(tag) || !/\bheight=["']\d+["']/.test(tag)) violations.push({ graphic_id: id, file: rel, violation: "width/height 明示が欠落 (C-26)" });
        const style = (tag.match(/\bstyle=["']([^"']*)["']/) ?? [])[1];
        if (style && !/^object-fit:(cover|contain)$/.test(style)) violations.push({ graphic_id: id, file: rel, violation: `style は object-fit:cover|contain のみ可 (C-26): ${style}` });
      }
    }
  }
  const orphans = findOrphanTags(appRoot, targets, mainFiles, screensFilter).map(({ file, alt, src }) => ({ file, alt, src }));
  return {
    complete: missing.length === 0 && duplicates.length === 0 && violations.length === 0 && orphans.length === 0,
    missing,
    duplicates,
    violations,
    orphans,
    placeholder_residues: placeholderResidues,
  };
}

/**
 * 21g 実行前提の assert + 埋め込み対象集合の導出 (設計 §9-1 / §9-2b / §9-3)。
 * 起動条件: decision == "generate" AND step21f_completed_at set AND NOT graphics_human_approved
 * (resume cascade §9-1 分岐 3 の `else → Step 21g` と同値)。
 * delta mode (Step 29 再埋め込み — §9-2b の 21g/29 共通契約): 前提が反転し
 * **graphics_human_approved == true を要求** する (29 の前提ゲート。未承認プロジェクトの delta
 * 再埋め込みは存在しない — 21g 本流の再起動は resume cascade の責務)。
 *
 * 対象集合 (21g/29 共通契約、設計 §9-2b): generated_files[] のうち fresh (source_digest が現
 * prompts entry から再導出した digest と一致。digest 欠落 = not fresh) な entry − excluded_slots[]。
 * plan.slots[] は driver にしない (配置メタ参照のみ)。
 *
 * pending (prompts − excluded − fresh) が非空のまま 21f 完了 = state 不整合 → E_PENDING_SLOTS で
 * 停止する (黙って埋め込み対象から落とすと承認済みプロンプトの絵が無言で脱落する — 設計 §3 の
 * 「検出機構が存在しない」問題を 21g 入口で塞ぐ)。
 *
 * rework mode (route-rework 専用): 同一ゲート内で複数分類の差し戻しを**続けて**記録できるよう、
 * 1 回目の routing が書く state 変化 (step21e/21f_completed_at クリア / generated entry 削除) を
 * 前提 NG と誤判定しない — E_GEN_INCOMPLETE / E_PENDING_SLOTS / E_EMPTY_TARGET_SET を skip する
 * (2 件目の指示が「その他 E_* → 中断」に落ちて記録なしで消失するのを防ぐ — 設計 §9-2b)。
 * 承認済み / skip / excluded の防御はそのまま効く。
 *
 * @returns {{error: object}} 前提 NG /
 *   {{appRoot, state, graphics, plan, prompts, tool, targetEntries, excludedIds, slotMeta}} OK
 *   (targetEntries = 埋め込み対象の generated_files entry 配列 / slotMeta = graphic_id → plan slot)
 */
export function assertPreflight(appName, { delta = false, rework = false } = {}) {
  // app_name はパス部品 (artifacts/{app_name}/ 配下を read/write する) のため、`../` 等の
  // パス・トラバーサルを join 前に弾く (21e assertPreflight と同一 guard)
  if (typeof appName !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(appName)) {
    return {
      error: {
        ok: false,
        code: "E_INVALID_APP_NAME",
        message: `app_name が不正 (${JSON.stringify(appName ?? null)}) — artifacts/ 直下のディレクトリ名 (英数・-・_) のみ許容`,
      },
    };
  }
  const appRoot = path.join(repoRoot, "artifacts", appName);
  if (!fs.existsSync(appRoot)) {
    return { error: { ok: false, code: "E_APP_NOT_FOUND", message: `artifacts/${appName}/ が存在しません` } };
  }

  const state = readJson(path.join(appRoot, "pipeline-state.json"));
  if (!state) {
    return { error: { ok: false, code: "E_STATE_MISSING", message: "pipeline-state.json が読めません (Phase 3 未進行 or 破損)" } };
  }
  if (state?.approvals?.screens_human_approved !== true) {
    return { error: { ok: false, code: "E_SCREENS_NOT_APPROVED", message: "Step 21 (画面 HTML 承認) が未完了です" } };
  }

  const graphics = state?.screens?.graphics ?? {};
  if (graphics.decision === "skip") {
    return {
      error: {
        ok: false,
        code: "E_BLOCK_SKIPPED",
        decided_by: graphics.decided_by ?? null,
        message: `グラフィック生成ブロックは skip 確定済み (decided_by=${graphics.decided_by ?? "?"}) — 21g は起動しない`,
      },
    };
  }
  if (graphics.decision !== "generate") {
    return { error: { ok: false, code: "E_21B_NOT_DONE", message: "Step 21b (要否ヒアリング) が未確定です — 21b へ差し戻し" } };
  }
  if (!delta && state?.approvals?.graphics_human_approved === true) {
    return {
      error: {
        ok: false,
        code: "E_ALREADY_APPROVED",
        step21g_approved_at: state?.approvals?.step21g_approved_at ?? null,
        message: `グラフィック埋め込みは承認済み (${state?.approvals?.step21g_approved_at ?? "?"}) です — 再質問しない (P4-07)。routing は resume cascade に委ねる (次は Step 15 2nd save)。やり直しは設計 §5 の手動リセット運用による`,
      },
    };
  }
  if (delta && state?.approvals?.graphics_human_approved !== true) {
    return {
      error: {
        ok: false,
        code: "E_NOT_APPROVED",
        message: "delta 再埋め込み (Step 29) は 21g 承認済みプロジェクトのみ対象 (§9-2b の前提ゲート) — graphics_human_approved が未 set",
      },
    };
  }
  if (!rework && !graphics.step21f_completed_at) {
    return {
      error: {
        ok: false,
        code: "E_GEN_INCOMPLETE",
        message: "Step 21e/21f (生成・後処理) が未完了です (step21f_completed_at 未 set) — resume cascade の該当 step へ差し戻し",
      },
    };
  }

  const plan = readJson(path.join(appRoot, "graphics", "graphic-plan.json"));
  if (!plan) {
    return { error: { ok: false, code: "E_PLAN_MISSING", message: "graphics/graphic-plan.json が読めません (配置メタを参照できない)" } };
  }
  if (!Array.isArray(plan.slots) || plan.slots.length === 0) {
    return { error: { ok: false, code: "E_PLAN_INVALID", message: "graphic-plan.json の slots が空/不正 (schema minItems 1)" } };
  }

  const prompts = readJson(path.join(appRoot, "graphics", "graphic-prompts.json"));
  if (!prompts || !Array.isArray(prompts.prompts) || prompts.prompts.length === 0) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_MISSING",
        message: "graphics/graphic-prompts.json が読めません — 鮮度判定 (source_digest 再導出) ができないため 21g を起動しない (21d の確定が不完全?)",
      },
    };
  }
  // entry の構造検証 (21e assertPreflight と同一 guard) — 欠落 field のまま sourceDigestOf に渡すと
  // TypeError で exit 1 し「exit 0 + E_* routing」契約が破れる。graphic_id 重複は last-entry-wins で
  // 別 prompt の digest を鮮度判定に使う経路のため fail-closed (1 graphic_id = 1 確定プロンプトが契約)
  const ID_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  const validEntry = (e) =>
    e &&
    typeof e.graphic_id === "string" &&
    ID_PATTERN.test(e.graphic_id) &&
    typeof e.prompt === "string" &&
    e.prompt &&
    Number.isInteger(e?.size_px?.width) &&
    e.size_px.width >= 1 &&
    Number.isInteger(e?.size_px?.height) &&
    e.size_px.height >= 1;
  if (!prompts.prompts.every(validEntry)) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_INVALID",
        message: "graphic-prompts.json の prompts が不正 (graphic_id / prompt / size_px の欠落) — schema 検証と 21d の確定経緯を確認",
      },
    };
  }
  const dupIds = [...new Set(prompts.prompts.map((e) => e.graphic_id).filter((id, i, a) => a.indexOf(id) !== i))];
  if (dupIds.length) {
    return {
      error: {
        ok: false,
        code: "E_PROMPTS_INVALID",
        duplicates: dupIds,
        message: `graphic-prompts.json の prompts に graphic_id 重複 (${dupIds.join(", ")}) — 1 graphic_id = 1 確定プロンプトが契約 (21d commit は重複を書かない。手編集なら重複を解消して再実行)`,
      },
    };
  }
  const tool = typeof prompts.tool === "string" && prompts.tool ? prompts.tool : null;

  const excludedIds = new Set(
    (Array.isArray(graphics.excluded_slots) ? graphics.excluded_slots : []).map((e) => e?.graphic_id).filter(Boolean)
  );
  const generated = Array.isArray(graphics.generated_files) ? graphics.generated_files : [];
  const promptById = new Map(prompts.prompts.map((p) => [p?.graphic_id, p]));

  // fresh 判定 (digest 欠落 = not fresh — 破損 entry を fresh 誤判定しない安全側)。
  // digest は 21e (writer) の sourceDigestOf をそのまま使う — 透過 slot は tool_transparent 側で
  // 導出する等の規約ごと byte 一致させる。ファイル実在は 21e の computePending (raw/ 中間物) と
  // 対象が異なるためここでは見ず、正典実在を computeEmbedTargets の E_CANON_MISSING で別途 hard に
  // 検査する (21g 時点の実体 SoT は screens/_shared/graphics/ — 設計 §7)。
  const freshIds = new Set();
  for (const g of generated) {
    const entry = promptById.get(g?.graphic_id);
    if (!entry || typeof g?.source_digest !== "string" || !g.source_digest) continue;
    if (sourceDigestOf(entry, prompts.tool) === g.source_digest) freshIds.add(g.graphic_id);
  }
  const targetEntries = generated.filter((g) => freshIds.has(g?.graphic_id) && !excludedIds.has(g?.graphic_id));

  // pending = prompts − excluded − fresh (§9-2b)。21f 完了済みで pending 非空は state 不整合
  const pending = prompts.prompts
    .map((p) => p?.graphic_id)
    .filter((id) => typeof id === "string" && !excludedIds.has(id) && !freshIds.has(id));
  if (!rework && pending.length) {
    return {
      error: {
        ok: false,
        code: "E_PENDING_SLOTS",
        pending,
        message: `生成が完了していない slot が残っています: ${pending.join(", ")} — 21e/21f 完了記録と矛盾 (digest 不一致 or generated_files 欠落)。resume cascade の 21e 差し戻しを確認する (黙って埋め込み対象から落とさない)`,
      },
    };
  }

  if (!rework && targetEntries.length === 0) {
    return {
      error: {
        ok: false,
        code: "E_EMPTY_TARGET_SET",
        message: "埋め込み対象 slot が 0 件 (全 slot excluded / omit) — 21e の degrade 規則は全 slot excluded 時に decision='skip' を記録する契約 (pipeline.yaml § degrade)。state を確認",
      },
    };
  }

  // plan との配置メタ join 可能性 (対象 entry の graphic_id は plan slot に必ず居る — 居なければ不整合)
  const slotMeta = new Map();
  for (const s of plan.slots) {
    if (!slotMeta.has(s.graphic_id)) slotMeta.set(s.graphic_id, []);
    slotMeta.get(s.graphic_id).push(s);
  }
  const orphan = targetEntries.filter((g) => !slotMeta.has(g.graphic_id)).map((g) => g.graphic_id);
  if (orphan.length) {
    return {
      error: {
        ok: false,
        code: "E_PLAN_MISMATCH",
        orphan,
        message: `generated_files に plan slots へ join できない graphic_id: ${orphan.join(", ")} — plan↔state 不整合 (手動編集/破損のシグナル)`,
      },
    };
  }

  return { appRoot, state, graphics, plan, prompts, tool, targetEntries, excludedIds, slotMeta };
}
