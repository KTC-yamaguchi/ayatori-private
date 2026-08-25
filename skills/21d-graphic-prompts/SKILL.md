---
name: 21d-graphic-prompts
description: Phase 3 の Step 21d。21b の graphic-plan.json と 21c 確定テイストを入力に、slot ごとの生成プロンプト案を AI が提示し、ユーザーフィードバックを反映して graphics/graphic-prompts.json に確定する人間ゲート。確定プロンプトは 21e (グラフィック生成) が消費する。21g 差し戻し (rework_pending) の再確定も本 step が担う。
---

# 21d: 箇所別プロンプト確定 (FB 反映) → graphic-prompts.json 生成 OR skip

## 役割

21b で確定した slot (どこに入れるか) と 21c で確定したテイストを合成し、**slot ごとに
「どんなグラフィックを生成するか」のプロンプトと生成ピクセル数 (size_px) を確定する** 人間ゲート。
AI がプロンプト案を提示 ((E) PROPOSED) → user の指示 (「キャラクターにしたい」「このポーズで」等) を
反映 → 全 slot 確定で `graphics/graphic-prompts.json` に書く。設計 SoT・用語整理・チケット対応表は
`docs/graphic-generation-design.md`。

本書は **routing / 分岐判断のみ** を持つ。決定的処理は `scripts/` (gather-context / commit-prompts)、
対話テンプレート・プロンプト合成規約・size_px の決め方は `refs/prompts-guide.md` (Step 2 以降で
のみ Read) に分離している。前提条件 (Step 21 承認済み / 21b decide 済み等) は **すべて Step 1 の
script が機械判定する** — 手動で JSON を Read して確認しない。

## 実行指示

### Step 1: preflight (決定的)

```bash
node skills/21d-graphic-prompts/scripts/gather-context.mjs {app_name}
```

stdout の JSON で routing する:

| 結果 | 行動 |
|---|---|
| `ok: true` | `mode`・`slots`・`taste`・`rework_pending`・`existing_prompts` を保持して Step 2 へ。`warnings` があれば user に明示してから進む (無言 fallback 禁止)。`mode == "rework"` なら Step 2 は guide §6 の差し戻しモードで進める |
| `E_SCREENS_NOT_APPROVED` | 「Step 21 (画面 HTML 承認) が未完了です」を表示して中断 |
| `E_21B_NOT_DONE` | 21b へ差し戻して中断 |
| `E_BLOCK_SKIPPED` | skip 確定済み ({decided_by}) を表示して中断 — グラフィックブロックは実行しない |
| `E_TASTE_NOT_SET` / `E_TASTE_MISSING` | 21c へ差し戻して中断 (テイスト未確定 / state↔plan 不整合) |
| `E_PROMPTS_ALREADY_SET` | 確定済み ({prompts_confirmed_at}) を表示して中断 — **再質問しない** (P4-07)。routing は resume cascade に委ねる (次は 21e)。やり直しは設計 §9-2b の差し戻し routing (orchestrator が prompts_confirmed_at をクリア) による |
| `E_PLAN_MISSING` / `E_PLAN_INVALID` | 21b へ差し戻して中断 (plan 生成が不完全) |
| `E_ALL_SLOTS_EXCLUDED` | 全 slot 除外済み — 21e がブロック中止を記録すべき state 不整合。message を表示して中断 |
| その他 `E_*` / exit 1 | message を表示して中断 |

### Step 2: プロンプト案の組み立て (対話準備)

`refs/prompts-guide.md` を Read してから進める:

1. 判断素材を読む: 各 slot の `spec_file` (`screens/{screen}.md`、non-null のもの) +
   `requirements/01-overview.md`。placement の理解に必要な場合のみ該当画面の main HTML の
   該当ブロックを部分参照する (全文 Read しない — context 保護)。
2. slot ごとにプロンプト案 (英語、guide §1 の合成規約: `taste.style_directive` **逐語** + slot 固有の
   主題・構図) と `size_px` (guide §2、`size_px_hint` 起点) / `transparent_background` を組み立てる。
3. **再入時 (`existing_prompts` が non-null)**: 残置 entry がある。`mode == "rework"` なら guide §6
   (差し戻し slot のみ改訂、他 slot は **逐語再利用**)。initial での残置 (確定直前の中断) は前回 draft
   を土台に再提示する — 未改訂 slot の言い換えは digest 不一致 = 21e 再課金になるため禁止 (guide §5)。

### Step 3: 人間ゲート preview + 一括提示 + FB 反映

1. `skills/_shared/human-gate-preview.md` の規約に従い、link 一覧 + `refresh_index` を行う。
   `step_id = "21d-graphic-prompts"`、`artifacts_to_review` = 各 slot の `preview_files`
   (gather が dual_theme の `--light/--dark` 命名まで解決済みの実ファイルパス。重複除去、
   kind: html) + 確定テイストのサンプル PNG (`taste.sample_files` が非空なら、kind: image)。
2. guide §3 のフォーマットで **全 slot を一括提示** する (プロンプト全文 + 日本語要約 + size_px)。
3. **dry-run 検証を通してから** guide §4 の確定確認 (AskUserQuestion) を出す:

   ```bash
   node skills/21d-graphic-prompts/scripts/commit-prompts.mjs {app_name} confirm --stdin --dry-run <<'JSON'
   { "prompts": [ { "graphic_id": "...", "prompt": "... (英語)", "size_px": { "width": 800, "height": 400 },
                    "transparent_background": false } ],
     "omit": [ { "graphic_id": "...", "reason": "..." } ] }
   JSON
   ```

4. 分岐:
   - **全 slot 確定** → Step 4-A。
   - **修正指示** → guide §5 (当該 slot のみ改訂・未改訂 slot は逐語保持) → 再提示 → 本 Step 3 を
     再実行。**Pattern A を `feedback-log.md` に記録**。
   - **slot 取り下げ** → 当該 slot を `omit` (reason 必須) に移して再提示。**Pattern A を記録**
     (guide §7)。全 slot 取り下げになったら Step 4-B (全中止) へ転換確認。
   - **全 slot 中止** → Step 4-B。
   - **保留** → Step 5。

### Step 4: commit (決定的)

- **A. 確定**: dry-run 済み draft を `--dry-run` なしで再実行。以下いずれの `E_*` でもファイルは
  一切書かれていない。
  - `ok: true` → 完了報告 (prompt 数 / graphic_id 一覧 / omitted / rework_consumed / 再課金への注意
    [改訂 slot のみ 21e が再生成]) → **Step 21e (グラフィック生成) へ**。
  - `E_VALIDATION` / `E_BAD_INPUT` → dry-run 済み draft では通常起きない (対話中に状態が変わった /
    heredoc の JSON が崩れたケース)。`errors[]` / message に従い draft を直し、**修正後の draft を
    guide §4 で再確認してから** 再実行する。
  - `E_NON_ENGLISH` → prompt に日本語混入 (21e が英語のまま生成 API へ渡す契約)。誤りなら英訳して
    guide §4 で再確認。固有名詞の原語表記等の意図的なケースのみ `--allow-non-english` を付けて
    再実行する (文字入れ [embedded text] 指示は意図的でも不可 — guide §1 の禁止事項)。
  - `E_STYLE_DEVIATION` → prompt に `style_directive` が逐語で含まれていない (テイスト一貫性の機械
    担保 — 言い換え・要約は不可)。合成し直して再実行。user が当該 slot だけ意図的に画風を変える
    指示を出した場合のみ `--allow-style-deviation` を付けて再実行する。
  - `E_REWORK_SCOPE` → rework (21g 差し戻し) の再確定で、差し戻し対象外の entry / tool が前回確定値
    から変わっている (guide §6 の逐語コピー契約の機械担保 — 対象外の変更は再利用すべき生成済み画像
    まで再課金になる)。`violations[]` に従い対象外 entry を `existing_prompts` の逐語コピーに戻して
    再実行。user が対象外 slot への変更も明示指示した場合のみ `--allow-rework-scope-change` を付けて
    再実行する。

- **B. 全中止**: `node skills/21d-graphic-prompts/scripts/commit-prompts.mjs {app_name} skip`
  → 完了報告「グラフィック生成を中止しました (decision=skip, decided_by=step21d)。21e-21g を飛ばして
  Step 15 (2nd Confluence save) → Step 22 へ進みます」。

### Step 5: 保留

**commit script を呼ばず、何も書かない** (`prompts_confirmed_at` 未 set = 次回 resume cascade が
21d を再起動する signal — 設計 §9-1)。「プロンプト確定を保留しました。次回セッションで 21d が
再起動します」を報告。組み立て済み draft はディスクに残らないため、次回は Step 2 から再作成する。

## 失敗時の挙動

前提 NG (`E_*`) / `E_VALIDATION` の対応は Step 1 / 4 に集約済み (再掲しない)。

| 失敗 | 対応 |
|---|---|
| `screens/{screen}.md` 不在 | 失敗ではない — gather が warnings で返す。明示告知の上で plan の placement 記述 + main HTML 部分参照で続行 |
| `E_VALIDATION` が解消できない | feedback-log.md に Pattern B を記録して user に報告 (書き込みはゼロのまま) |
| node が使えない環境 | 縮退運転 — 本書 + guide + `schemas/graphic-prompts.schema.json` の契約に従い、同じ assert / 検証 / 書き込みを手動 (Read / Write) で行う |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/graphics/graphic-prompts.json` | Step 4-A のみ生成 (**本 skill が single writer**、writer 実体は `commit-prompts.mjs`、schema: `schemas/graphic-prompts.schema.json`)。確定値のみを書く (draft は書かない)。graphic_id 重複禁止・plan slots との 1:1 対応は書き込み前チェックで enforce。残置ファイルは `_backup/graphics/` へ退避してから上書き |
| `artifacts/{app_name}/pipeline-state.json` | `screens.graphics.prompts_confirmed_at` (4-A、file 側 `confirmed_at` と同値) + `rework_pending` の消費 (再確定した slot の entry 除去 — 設計 §9-2b) / `decision = "skip"` + `decided_by = "step21d"` (4-B、設計 §8-4)。保留時は更新しない |
| `artifacts/{app_name}/feedback-log.md` | 修正指示・取り下げ指示が出た場合の Pattern A 記録 |

## 完了後

- 4-A (確定) → Step 21e graphic-generate (グラフィック生成 + サイズ) へ。21e は
  `graphic-prompts.json` を READ-ONLY で消費し、prompt + size_px から `graphics/raw/` を生成する。
- 4-B (skip) → 21e〜21g を skip し、Step 15 (2nd Confluence save) → Step 22 へ (orchestrator の
  resume cascade / 進行判定に委ねる)。
- 保留 → 本セッションのグラフィックブロックはここで終了。次回 `/ayatori-screens` 再実行時に
  resume cascade (`decision == "generate"` AND `prompts_confirmed_at` 未 set → Step 21d、設計 §9-1)
  が 21d を再起動する。

## 参照

- `docs/graphic-generation-design.md` — 挿入位置設計の SoT (§2 step 体系 / §6 palette 調和 / §7 artifact 責務 / §8-4 skip 動線 / §9-2b slot 単位の再利用・差し戻し契約)
- `schemas/graphic-prompts.schema.json` — 出力 schema (機械検証は `commit-prompts.mjs` + hook R10 の二層)
- `schemas/graphic-plan.schema.json` — 入力 schema (slots + taste、READ-ONLY)
- `skills/_shared/human-gate-preview.md` — 人間ゲート preview 規約
