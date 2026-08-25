---
name: 21b-graphic-hearing
description: Phase 3 の Step 21b。Step 21a の推奨レポート (存在すれば) を参考情報として提示し、「グラフィックが必要か」「どこに必要か」を user にヒアリングする人間ゲート。必要なら graphics/graphic-plan.json (slot 計画) を生成して 21c へ、不要なら pipeline-state.json に skip を記録して 21c-21g を飛ばす。推奨レポートが無い場合もユーザー完全判断モードで動作する。
---

# 21b: グラフィック要否・箇所ヒアリング → graphic-plan.json 生成 OR skip

## 役割

Step 21 で承認された main HTML を起点に、**AI 生成グラフィック (イラスト / キャラクター / 写真) が必要か・必要ならどこに入れるか** を user に確認する人間ゲート。設計 SoT・用語整理・実装単位の対応表は `docs/graphic-generation-design.md`。

本書は **routing / 分岐判断のみ** を持つ。決定的処理は同梱 script、対話テンプレートは参照資料に分離している (progressive disclosure — 必要になるまで context に載せない):

| ファイル | 責務 |
|---|---|
| `SKILL.md` (本書) | routing / 分岐判断 |
| `scripts/gather-context.mjs` | 前提 assert + 入力収集 (LLM の Read 代替。HTML 全文は返さない = context 保護) |
| `scripts/commit-decision.mjs` | slot 検証 (制約は `schemas/graphic-plan.schema.json` から実行時導出) + `graphic-plan.json` / `pipeline-state.json` 書き込み (検証 NG なら一切書かない)。`--dry-run` で検証のみ (§6 確定確認前の draft 事前検証に使う) |
| `scripts/preflight.mjs` | 上記 2 script が共有する前提 assert + main 画面 stem 解決 (dual_theme / sub-state variant 対応)。両 script の E_* code を同一に保つ |
| `refs/hearing-guide.md` | 質問テンプレート・候補洗い出し観点・plain chat 書式 (Step 3 でのみ Read) |

## 前提条件

Step 21 承認済み / 21a 完了済み / 要否未確定 / 上流 scope が skip でない / Step 14 成果物が存在 — **すべて Step 1 の script が機械判定する** (手動で JSON を Read して確認しない)。

## 実行指示

### Step 1: preflight (決定的)

```bash
node skills/21b-graphic-hearing/scripts/gather-context.mjs {app_name}
```

stdout の JSON で routing する:

| 結果 | 行動 |
|---|---|
| `ok: true` | `mode` (report / plain)・`screens`・`placeholder_hits`・`platform_combo` を保持して Step 2 へ |
| `E_SCREENS_NOT_APPROVED` | 「Step 21 (画面 HTML 承認) が未完了です」を表示して中断 |
| `E_21A_NOT_DONE` | 21a へ差し戻して中断 |
| `E_DECISION_ALREADY_SET` | 確定済み ({decision}) を表示して中断 — **再質問しない** (P4-07)。routing は resume cascade に委ねる |
| `E_UPSTREAM_SKIP` | 上流 skip の記録は orchestrator の責務 (設計 §9-1)。本 step は何もせず中断 |
| `E_SCREEN_LIST_MISSING` | 「Step 14 が完了していないようです。`/ayatori-screens` を最初から実行してください」を表示して中断 |
| その他 `E_*` / exit 1 | message を表示して中断 |

### Step 2: 人間ゲート preview

`skills/_shared/human-gate-preview.md` の規約に従い、link 一覧 + `refresh_index` を行う。`step_id = "21b-graphic-hearing"`、`artifacts_to_review` = `graphics/graphic-recommend.html` (視覚レポート、**存在時のみ** — 候補 0 件 / render 失敗時は不在) + `graphics/graphic-recommend.md` (`mode == report` のみ) + `screens/00-screen-list.md`。Auto-open = `graphics/graphic-recommend.html` (`pipeline.yaml` `step_targets` 登録済み。不在なら helper が warn + skip し link 一覧のみ)。

### Step 3: ヒアリング (対話 — 判断はここに集中する)

`refs/hearing-guide.md` を Read してから進める:

1. `mode == report` → レポート要点を提示 (guide §1)。`mode == plain` → 「推奨レポートなし」を明示 (無言 fallback 禁止)。
2. **Q1 要否** (guide §2 の AskUserQuestion)。
3. Q1 = 「必要」のときのみ: 候補洗い出し (guide §3、AI 提案 = (E) PROPOSED) → plain chat 複数選択 + 自由記述追加 (guide §4) → slot draft 組み立て + **dry-run 検証** (guide §5 — `E_VALIDATION` なら直してから提示。user には検証済み draft だけを見せる) → 表の提示 → 確定確認 (guide §6)。修正指示が出たら draft を直して (dry-run 再検証の上) 再確認し、Pattern A を `feedback-log.md` に記録する。
4. 対話の結果を 3 分岐に確定する:
   - **確定** (Q1 = 必要 + slot 確定) → Step 4-A
   - **不要** (Q1 = 不要、または箇所選択で「なし」) → Step 4-B
   - **保留** (Q1 = 後で決める、確定確認で中止、ESC / user cancel、中止意図の返信) → Step 4-C

候補が 1 件も洗い出せない場合は空リストを提示せず、その旨を伝えて自由記述のみで受け付ける。user も箇所を出せなければ「不要に転換するか」を確認して Step 4-B へ。

### Step 4: commit (決定的)

- **A. 確定**: 確定済み draft を stdin で渡す:

  ```bash
  node skills/21b-graphic-hearing/scripts/commit-decision.mjs {app_name} generate --stdin <<'JSON'
  { "slots": [ { "graphic_id": "...", "screen": "...", "platforms": ["web"], "placement": "...", "size_role": "hero", "state": "default", "rationale": "..." } ] }
  JSON
  ```

  - `E_VALIDATION` → dry-run 済み draft では通常起きない (対話中に画面ファイル等が変わったケース)。`errors[]` に従い draft を直し、**修正後の draft を guide §6 で再確認してから** 再実行する (user が確定した内容と書き込む内容を乖離させない)。ファイルは一切書かれていない。
  - `ok: true` → 完了報告 (slot 数 / graphic_id 一覧 / 対象画面) → **Step 21c (テイスト選定) へ**。

- **B. 不要**: `node skills/21b-graphic-hearing/scripts/commit-decision.mjs {app_name} skip`
  → 完了報告「グラフィック生成を skip しました (decision=skip, decided_by=step21b)。21c-21g を飛ばして Step 15 (2nd Confluence save) → Step 22 へ進みます」。

- **C. 保留**: **script を呼ばず、何も書かない** (`decision` 未 set = 次回 resume cascade が 21b を再起動する signal — 設計 §9-1)。「グラフィック要否の決定を保留しました。次回セッションで 21b が再起動します」を報告。

### Step 5: shadow-run 記録 (推奨精度の答え合わせ)

`mode == "report"` かつ Step 4 で **A (generate) または B (skip) を commit した場合のみ** (plain / 保留では記録しない)、レポートの総合推奨とユーザー実選択を突合し、**一致・不一致を問わず** `feedback-log.md` に 1 行 append する:

- **一致の定義**: 推奨「不要」→ decision=skip / 推奨「検討推奨」「強く推奨」→ decision=generate。
- **記録形式** (Pattern A 相当、schema のエントリ形式に合わせる): `- **[21b] Pattern A (shadow-run)**: レポート推奨「{3 段階の値}」 vs ユーザー選択「{必要|不要}」 → {一致|不一致} → retro で集計 (§8-1)`
- レポート推奨が `※ 不明 (unknown)` (21a の inventory-only degrade) の場合は突合不能のため記録しない。
- 集計と判定は retro (Phase 4 / 6) の責務 (判定基準は実現可能性検証の調査 §8-1)。本 step の行動は上記 1 行 append のみ。

## 失敗時の挙動

前提 NG (`E_*`) / `graphic-recommend.md` 不在 (mode=plain degrade) / `E_VALIDATION` の対応は Step 1 / 3 / 4 に集約済み (再掲しない)。

| 失敗 | 対応 |
|---|---|
| `E_VALIDATION` が解消できない | feedback-log.md に Pattern B を記録して user に報告 (書き込みはゼロのまま) |
| node が使えない環境 | 縮退運転 — 本書 + guide + `schemas/graphic-plan.schema.json` の契約に従い、同じ assert / 検証 / 書き込みを手動 (Read / Write) で行う |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/graphics/graphic-plan.json` | Step 4-A のみ生成 (writer は `commit-decision.mjs`、schema: `schemas/graphic-plan.schema.json`)。**本 skill は init + `slots[]` の単一 writer** (`taste` キーは 21c のみが append する key 分離 — 設計 §7)。残置 plan があれば `_backup/graphics/` へ退避してから上書き |
| `artifacts/{app_name}/pipeline-state.json` | `screens.graphics.decision = "generate"` (4-A) / `decision = "skip"` + `decided_by = "step21b"` (4-B、設計 §8-4)。4-C は更新しない。21b は人間ゲートのため `step21b_completed_at` は置かない (完了 = decision set、設計 §9-2) |
| `artifacts/{app_name}/feedback-log.md` | 確定確認で修正指示が出た場合の Pattern A 記録 + shadow-run 記録 (Step 5、mode==report の確定時のみ) |

## 完了後

- 4-A (generate) → Step 21c graphic-taste へ / 4-B (skip) → Step 15 → 22 へ (orchestrator の resume cascade に委ねる) / 4-C (保留) → 本セッションはここで終了 (次回 resume cascade が 21b を再起動)。

## 参照

- `docs/graphic-generation-design.md` — 挿入位置設計の SoT (§2 step 体系 / §3 前後依存 / §5 上流方針 / §7 artifact 責務 / §8-4 skip 動線 / §9 resume cascade)
- `schemas/graphic-plan.schema.json` — 出力 schema (機械検証は `commit-decision.mjs` + hook R9 の二層)
- `skills/_shared/human-gate-preview.md` — 人間ゲート preview 規約
