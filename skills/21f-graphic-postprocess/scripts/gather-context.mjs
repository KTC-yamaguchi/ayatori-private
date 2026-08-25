#!/usr/bin/env node
// Step 21f (graphic-postprocess) の preflight + 処理計画の収集 — READ-ONLY。
// POCTEAMA-189 (F-6 透過検証 → 正典化。圧縮 ⑫ は非搭載 — ユーザー判断でスコープ除外)
//
// usage:
//   node gather-context.mjs <app_name>
//
// SKILL.md Step 1 が呼ぶ。前提 assert (21e 完了済み / 21f 未完了) と対象差集合 (設計 §9-2b) を
// 機械判定し、slot ごとの処理計画 (透過検証の要否 / waiver 有無 / raw サイズ) を返す。
// 何も書き込まない。LLM は返却 JSON だけで user への進行報告と routing を行う。
//
// stdout に JSON を 1 個出力する (exit 0 固定、routing は code。内部エラーのみ exit 1)。

import fs from "node:fs";
import path from "node:path";
import { assertPreflight, findWaiver, isTransparent, sha256Of } from "./preflight.mjs";

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
};

try {
  const appName = process.argv[2];
  if (!appName || process.argv.length > 3) {
    out({ ok: false, code: "E_USAGE", message: "usage: node gather-context.mjs <app_name>" });
  }

  const pre = assertPreflight(appName);
  if (pre.error) out(pre.error);
  const { appRoot, pendingSlots, doneSlots, excludedIds, digests } = pre;

  const planOf = ({ entry, generated }) => {
    const transparent = isTransparent(entry);
    let bytesRaw = null;
    let rawSha = null; // waiver はバイト束縛 (raw_sha256) — stat でなく実バイトを読んで指紋を取る
    try {
      const rawBytes = fs.readFileSync(path.join(appRoot, generated.file));
      bytesRaw = rawBytes.length;
      rawSha = sha256Of(rawBytes);
    } catch {
      // preflight が実在を確認済みだが、直後の消失は postprocess 側の失敗経路で拾う
    }
    return {
      graphic_id: entry.graphic_id,
      source: generated.file,
      transparent,
      verify_transparency: transparent,
      ...(transparent && findWaiver(pre.graphics, entry.graphic_id, digests.get(entry.graphic_id), rawSha)
        ? { transparency_waived: true }
        : {}),
      ...(bytesRaw !== null ? { bytes_raw: bytesRaw } : {}),
    };
  };

  out({
    ok: true,
    counts: { pending: pendingSlots.length, done: doneSlots.length, excluded: excludedIds.size },
    pending: pendingSlots.map(planOf),
    done: doneSlots.map((s) => s.entry.graphic_id),
    excluded: [...excludedIds],
    next:
      pendingSlots.length === 0
        ? "pending なし — Step 2 (postprocess-graphics.mjs) を実行すると完了記録だけが書かれ 21g へ進む"
        : "処理計画を user に簡潔に報告して Step 2 (postprocess-graphics.mjs) を実行する (ローカル処理のみ・課金なし — 再質問しない [P4-07])",
  });
} catch (e) {
  console.error(`gather-context.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
