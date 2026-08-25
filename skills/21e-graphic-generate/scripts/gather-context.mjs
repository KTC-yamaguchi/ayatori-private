#!/usr/bin/env node
// Step 21e (graphic-generate) の preflight + 生成計画の収集 — READ-ONLY。
// F-5 グラフィック生成 + サイズ自動調整
//
// usage:
//   node gather-context.mjs <app_name>
//
// SKILL.md Step 1 が呼ぶ。前提 assert (prompts 確定済み / 21e 未完了 / API キー) と
// pending 差集合 (設計 §9-2b) を機械判定し、slot ごとの生成計画 (モデルルーティング /
// API サイズ / resize 有無 — preflight.planGeneration) を返す。何も書き込まない。
// LLM は返却 JSON だけで user への進行報告と routing を行う (手動で state を Read しない)。
//
// stdout に JSON を 1 個出力する (exit 0 固定、routing は code。内部エラーのみ exit 1)。

import {
  assertPreflight,
  isTransparent,
  planGeneration,
  resolveApiBase,
  resolveApiKey,
  resolveModels,
} from "./preflight.mjs";

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
  const { promptsFile, pending, fresh, excludedIds } = pre;

  // API キーは生成 (Step 2) の前提 — 無ければここで止めて SKILL.md の degrade 分岐へ。
  // ただし pending ゼロ (完了記録を書くだけで API を呼ばない) の run は塞がない — キー失効環境でも
  // 生成済み・支払い済みの成果を 21f へ進められる必要がある (generate-graphics 側と同じ判断)
  if (pending.length > 0 && !resolveApiKey()) {
    out({
      ok: false,
      code: "E_NO_API_KEY",
      message:
        "生成 API キーが未設定 (env AYATORI_IMAGE_API_KEY / ~/.ayatori/image-api-key / env OPENAI_API_KEY のいずれにも有効な値が無し — 引用符・`KEY=` 前置・コメント行は自動除去するが、空白/制御文字が混じる値は無効扱い。`node scripts/setup-image-key.mjs --doctor` で確認できる) — `node scripts/setup-image-key.mjs` で設定できる (再起動不要・docs/setup.md「グラフィック生成 API キー」参照)。SKILL.md の degrade 分岐へ",
    });
  }

  const models = resolveModels(promptsFile.tool);
  const planOf = (entry) => {
    const transparent = isTransparent(entry);
    const plan = planGeneration(entry.size_px, transparent);
    return {
      graphic_id: entry.graphic_id,
      transparent,
      model: transparent ? models.transparent : models.opaque,
      size_px: `${entry.size_px.width}x${entry.size_px.height}`,
      api_size: `${plan.api_size.width}x${plan.api_size.height}`,
      resize: plan.resize,
      ...(plan.warnings.length ? { warnings: plan.warnings } : {}),
    };
  };

  out({
    ok: true,
    tool: promptsFile.tool ?? null,
    models,
    api_base: resolveApiBase(),
    counts: { pending: pending.length, reused: fresh.length, excluded: excludedIds.size },
    pending: pending.map(planOf),
    reused: fresh.map((e) => e.graphic_id),
    excluded: [...excludedIds],
    next:
      pending.length === 0
        ? "pending なし — Step 2 (generate-graphics.mjs) を実行すると完了記録だけが書かれ 21f へ進む"
        : "生成計画を user に報告して Step 2 (generate-graphics.mjs) を実行する (有料・低速 — 確認は 21d で済んでいるため再質問しない [P4-07])",
  });
} catch (e) {
  console.error(`gather-context.mjs internal error: ${e?.message ?? e}`);
  process.exit(1);
}
