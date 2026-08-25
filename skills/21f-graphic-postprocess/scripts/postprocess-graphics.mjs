#!/usr/bin/env node
// Step 21f (graphic-postprocess) の本体 — 透過検証 (⑪) → 正典化。
// POCTEAMA-189 (F-6)
//
// usage:
//   node postprocess-graphics.mjs <app_name>
//
// 圧縮 (ユーザーフロー ⑫) は**非搭載** — I-4 (POCTEAMA-183) Skip に加え、実装レビュー時の
// ユーザー判断 (2026-08-05) でスコープから除外した。正典は raw PNG のバイトを**無加工**で置く
// (再エンコードなし = 劣化ゼロ・決定的)。ファイルサイズの統制は生成時の size_px 指定 (21d 確定 →
// 21e) で上流から行う。圧縮が実運用で必要になった場合の再起票の受け皿は設計 §11。
//
// 決定的責務 (LLM に任せない部分):
//   - 対象差集合 (設計 §9-2b): fresh な generated_files entry を持ち excluded_slots に載らない
//     slot のうち、file が正典パスでないものだけを処理する (正典化済み slot は no-op — 冪等)。
//   - 透過検証 (ユーザーフロー ⑪、I-3 の結論): transparent_background=true の slot は raw PNG の
//     alpha 統計 (png-inspect.mjs) で背景透明化を検証する。fail した slot は正典化せず
//     transparency_failures として返す (SKILL.md の degrade 分岐へ — 正典に不良品を置かない)。
//     user が「そのまま採用」を選んだ slot は transparency_waived[] (source_digest + raw_sha256 の
//     複合単位 — 受諾した当のバイトにのみ有効) の記録でラベル付き通過させる (再 resume で
//     再質問しない — P4-07。再生成で別バイトになった画像の再 fail には自動適用せず質問に戻す)。
//   - 正典化: raw バイトをそのまま `screens/_shared/graphics/{graphic_id}.png` へ。旧 run の
//     別拡張子 (.webp) の正典が残っていれば削除する (両拡張子並存で src↔存在照合を曖昧にしない)。
//   - 増分記録: 成功のたびに pipeline-state.json の generated_files[].file を正典パスへ更新する
//     (途中 kill でも処理済み分は正典参照に切り替わっている — 21e と同じ契約)。併せて監査台帳
//     graphics/postprocess-manifest.json (透過検証 verdict / alpha 統計) を増分更新する。
//     台帳は補助記録であり、resume / 埋め込み対象の SoT は pipeline-state 側 (設計 §9-2b)。
//   - 完了判定: 失敗ゼロで pending が空になったら screens.graphics.step21f_completed_at を set。
//     一部失敗時は set しない (E_POSTPROCESS_FAILED — SKILL.md の degrade 分岐 [設計 §8-4 同型] へ)。
//
// stdout に JSON を 1 個出力する (exit 0 固定、routing は code。内部エラーのみ exit 1)。

import fs from "node:fs";
import path from "node:path";
import {
  assertPreflight,
  atomicWriteFileSync,
  canonicalPath,
  findWaiver,
  isoNow,
  isTransparent,
  readJson,
  sha256Of,
} from "./preflight.mjs";
import { decodePng, verifyTransparency } from "./png-inspect.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const args = process.argv.slice(2);
  const appName = args[0];
  if (!appName || args.length > 1) {
    out({ ok: false, code: "E_USAGE", message: "usage: node postprocess-graphics.mjs <app_name>" });
  }

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, state, graphics, pendingSlots, doneSlots, excludedIds, digests } = pre;

  // ── pipeline-state merge write の共通部 (21e generate-graphics と同パターン) ──
  const statePath = path.join(appRoot, "pipeline-state.json");
  const graphicsState = { ...graphics };
  const writeState = () => {
    if (!state.app_name) state.app_name = appName; // 必須 field の保全 assert
    state.screens ??= {};
    state.screens.graphics = graphicsState;
    atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  };
  const updateGeneratedFile = (graphicId, canonicalFile) => {
    const list = (Array.isArray(graphicsState.generated_files) ? graphicsState.generated_files : []).map((g) =>
      g?.graphic_id === graphicId ? { ...g, file: canonicalFile } : g
    );
    graphicsState.generated_files = list;
    writeState();
  };

  // pending ゼロ (全対象が正典化済み) — 完了記録だけ立てて 21g へ (resume の収束点)
  if (pendingSlots.length === 0) {
    graphicsState.step21f_completed_at = isoNow();
    writeState();
    out({
      ok: true,
      processed: [],
      reused: doneSlots.map((s) => s.entry.graphic_id),
      excluded: [...excludedIds],
      step21f_completed_at: graphicsState.step21f_completed_at,
      message: "pending slot なし (全対象が正典化済み) — 処理は未実行",
      next: "Step 21g (graphic-embed-review) へ",
    });
  }

  // ── 監査台帳 (補助記録) — 旧 entry で seed し、処理のたびに増分 Write する ──
  const manifestPath = path.join(appRoot, "graphics", "postprocess-manifest.json");
  const prevManifest = readJson(manifestPath);
  const manifestById = new Map(
    (Array.isArray(prevManifest?.entries) ? prevManifest.entries : []).filter((e) => e?.graphic_id).map((e) => [e.graphic_id, e])
  );
  const writeManifest = () => {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    atomicWriteFileSync(
      manifestPath,
      JSON.stringify({ app_name: appName, updated_at: isoNow(), entries: [...manifestById.values()] }, null, 2) + "\n"
    );
  };

  const canonicalDirAbs = path.join(appRoot, "screens", "_shared", "graphics");
  fs.mkdirSync(canonicalDirAbs, { recursive: true });

  const processed = [];
  const transparencyFailures = [];
  const fileFailures = [];

  for (const { entry, generated } of pendingSlots) {
    const id = entry.graphic_id;
    const transparent = isTransparent(entry);
    const warnings = [];
    // slot 全処理 (decode / 検証 / 正典書き込み / 記録) を 1 つの try で覆う —
    // decode だけを守ると write の失敗 (ENOSPC / EACCES 等) が外側の内部エラー catch
    // (exit 1・構造化 JSON なし) へ抜け、当該 slot が file_failures に載らないまま
    // 残り slot ごと全滅する (21e の生成 loop が decode〜write を per-slot で包むのと同じ判断)
    let stage = "raw の読み込み/decode";
    try {
      const rawBytes = fs.readFileSync(path.join(appRoot, generated.file));
      const decoded = decodePng(rawBytes, entry.size_px); // 寸法は size_px 完全一致を enforce (21e 契約)

      // ── 透過検証 (⑪) — 透過 slot のみ。fail は正典化せず degrade 分岐へ ──
      let transparency = "n/a";
      let alpha = null;
      if (transparent) {
        const verdict = verifyTransparency(decoded);
        alpha = verdict.stats;
        const waiver = findWaiver(graphicsState, id, digests.get(id), sha256Of(rawBytes));
        if (!verdict.pass && !waiver) {
          transparencyFailures.push({
            graphic_id: id,
            warnings: verdict.warnings,
            alpha: {
              transparent_ratio: Math.round(verdict.stats.transparent_ratio * 1000) / 1000,
              border_transparent_ratio: Math.round(verdict.stats.border_transparent_ratio * 1000) / 1000,
            },
          });
          continue;
        }
        if (!verdict.pass && waiver) {
          transparency = "waived";
          warnings.push(`透過検証 fail を user が受諾済み (waived: ${waiver.reason}) — 不透明のまま正典化 (21g は重ね置き前提の配置を避けること)`);
        } else {
          transparency = "verified";
          warnings.push(...verdict.warnings);
        }
      }

      // ── 正典化: 書き込み → 台帳 → state (この順序が契約)。raw バイト無加工 (圧縮 ⑫ は非搭載) ──
      // state (generated_files[].file の正典化) は**最後**に書く — state が先だと、直後の manifest
      // 書き込み失敗で slot が doneSlots 扱いのまま台帳 entry が永久欠落する (waived ラベルの
      // 消失 = 21g の配置判断材料が消える)。逆順なら台帳の先行 entry は無害 (slot は pending の
      // ままなので再実行時に上書きされる)。完了判定の SoT は state 側 (設計 §9-2b)
      stage = "正典への書き込み/記録";
      const file = canonicalPath(id, "png");
      // 画像も atomic write — 正典は screen HTML から <img> 相対参照で直接読まれるため、
      // 途中 kill の半端なファイルを (state pending のまま) 露出させない
      atomicWriteFileSync(path.join(appRoot, file), rawBytes);
      // 旧仕様 (WebP 化) run の残骸掃除 — 両拡張子並存で src↔存在照合を曖昧にしない
      const sibling = canonicalPath(id, "webp");
      if (fs.existsSync(path.join(appRoot, sibling))) fs.rmSync(path.join(appRoot, sibling));
      const processedAt = isoNow();
      manifestById.set(id, {
        graphic_id: id,
        file,
        source: generated.file,
        bytes: rawBytes.length,
        transparent,
        transparency,
        ...(alpha
          ? {
              alpha: {
                transparent_ratio: Math.round(alpha.transparent_ratio * 1000) / 1000,
                border_transparent_ratio: Math.round(alpha.border_transparent_ratio * 1000) / 1000,
              },
            }
          : {}),
        ...(warnings.length ? { warnings } : {}),
        processed_at: processedAt,
        source_digest: generated.source_digest,
      });
      writeManifest();
      updateGeneratedFile(id, file);
      processed.push({
        graphic_id: id,
        file,
        bytes: rawBytes.length,
        transparency,
      });
      console.error(`[21f] ${id}: 正典化 (${file}, ${rawBytes.length}B, transparency=${transparency})`);
    } catch (e) {
      fileFailures.push({ graphic_id: id, error: `${stage}に失敗: ${String(e?.message ?? e).slice(0, 200)}` });
    }
  }

  if (transparencyFailures.length || fileFailures.length) {
    out({
      ok: false,
      code: "E_POSTPROCESS_FAILED",
      transparency_failures: transparencyFailures,
      file_failures: fileFailures,
      processed,
      reused: doneSlots.map((s) => s.entry.graphic_id),
      message:
        "一部/全部の slot の後処理に失敗 — 正典化済み分は generated_files 更新済み。透過検証 fail は SKILL.md の degrade 分岐へ (そのまま採用 / リトライ / slot 除外 / 保留)、read/decode 失敗はリトライ (21e 再生成) / 除外 / 中止へ",
    });
  }

  graphicsState.step21f_completed_at = isoNow();
  writeState();
  out({
    ok: true,
    processed,
    reused: doneSlots.map((s) => s.entry.graphic_id),
    excluded: [...excludedIds],
    step21f_completed_at: graphicsState.step21f_completed_at,
    manifest: "graphics/postprocess-manifest.json",
    next: "Step 21g (graphic-embed-review) へ",
  });
} catch (e) {
  console.error(`postprocess-graphics.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
