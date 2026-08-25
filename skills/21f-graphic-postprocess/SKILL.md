---
name: 21f-graphic-postprocess
description: Phase 3 の Step 21f。21e が graphics/raw/ に置いた生成グラフィックを入力に、透過 slot の背景透明化を検証し (透過は 21e の生成段階で作られる — I-3 POCTEAMA-182 の結論により本 step は後処理でなく検証)、raw バイト無加工で正典 screens/_shared/graphics/ に置く (圧縮 ⑫ は非搭載)。人間ゲートは持たず、透過検証 fail / 後処理失敗時のみ AskUserQuestion の degrade 分岐 (そのまま採用 / リトライ / slot 除外 / 保留 / 中止) を回す。出力は 21g (embed-review) が消費する。
---

# 21f: 透過検証 → 正典化

## 役割

21e の生成物 `graphics/raw/{graphic_id}.png` を、埋め込み可能な**正典**
`screens/_shared/graphics/{graphic_id}.png` に仕上げる (ユーザーフロー ⑪透過)。
人間ゲートは無い — 何をどの寸法で生成するかは 21d、生成そのものは 21e で確定済みのため、
正常系では**本 step で再質問しない** (P4-07)。設計 SoT・用語整理・チケット対応表は
`docs/graphic-generation-design.md`。

- **透過 (⑪) は「検証」**: I-3 (POCTEAMA-182) の結論により、透過は 21e が透過対応モデルで
  生成段階に作る (Operating Principle 1 下で後処理の背景除去に経路が無い)。本 step は raw の
  alpha 統計で背景透明化を機械検証し、fail した slot を正典化せず degrade 分岐に載せる —
  チケットの fallback 方針「ラベルをつけて代わりの方法を提案」の実体。
- **圧縮 (⑫) は非搭載**: I-4 (POCTEAMA-183) Skip に加え、実装レビュー時のユーザー判断
  (2026-08-05) でスコープから除外した。正典は raw PNG のバイトを**無加工**で置く (再エンコード
  なし = 劣化ゼロ・決定的)。ファイルサイズは生成時の size_px 指定 (21d 確定 → 21e) で上流から
  統制する。圧縮が実運用で必要になった場合の再起票の受け皿は設計 §11。

本書は **routing / 分岐判断のみ** を持つ。検証・正典化・記録はすべて `scripts/` の決定的処理
(gather-context / postprocess-graphics / commit-degrade)、検証閾値・degrade 対話
テンプレートは `refs/postprocess-guide.md` (Step 3 の失敗時のみ Read) に分離している。
前提条件 (21e 完了済み / 21f 未完了等) は **すべて Step 1 の script が機械判定する**。

## 実行指示

### Step 1: preflight + 処理計画 (決定的・READ-ONLY)

```bash
node skills/21f-graphic-postprocess/scripts/gather-context.mjs {app_name}
```

stdout の JSON で routing する:

| 結果 | 行動 |
|---|---|
| `ok: true` | `pending` (処理計画: 透過検証対象 / raw サイズ) を user に簡潔に報告して Step 2 へ。**AskUserQuestion は出さない** — ローカル処理のみで課金なし (P4-07) |
| `E_ALREADY_COMPLETED` | 21f 完了済み — Step 21g (embed-review) へ。`stale_pending` が付いている場合は state 不整合 (message 参照) — user に報告して中断 |
| `E_21E_NOT_DONE` | 21e へ差し戻して中断 |
| `E_21E_STALE` | 21e 完了済みなのに fresh な生成記録の無い slot が残る state 不整合 — message を表示して中断 (設計 §5 の手動リセット運用) |
| `E_BLOCK_SKIPPED` | skip 確定済み ({decided_by}) を表示して中断 — グラフィックブロックは実行しない |
| `E_21B_NOT_DONE` | 21b へ差し戻して中断 |
| `E_NO_TARGETS` | 対象 0 件の state 不整合 — message の指示 (commit-degrade abort) を user に提示して確認の上で実行 |
| その他 `E_*` / exit 1 | message を表示して中断 |

### Step 2: 後処理実行 (決定的)

```bash
node skills/21f-graphic-postprocess/scripts/postprocess-graphics.mjs {app_name}
```

処理はローカルのみ (生成 API は呼ばない — 課金なし)。対象差集合 (設計 §9-2b) により、
**正典化済みの slot は再処理されない** — 中断後の再実行・失敗後のリトライは残り分だけが走る。

### Step 3: 結果 routing

| 結果 | 行動 |
|---|---|
| `ok: true` | 完了報告 (processed の slot 別 file / bytes + 透過検証結果 + `step21f_completed_at`) → **Step 21g (graphic-embed-review) へ** |
| `E_POSTPROCESS_FAILED` | `processed` は記録済み。`transparency_failures[]` (alpha 統計付き) / `file_failures[]` を user に提示し、guide §4 の AskUserQuestion (**そのまま採用 / リトライ / 当該 slot を除外 / 保留** — 透過 fail の場合。read/decode 失敗は**リトライ / 除外 / 中止 / 保留**) を出す → Step 4 |
| その他 `E_*` / exit 1 | message を表示して中断 (書き込み済みの正典化分は残る — 再実行で再利用される) |

### Step 4: degrade commit (Step 3 で失敗があった場合のみ)

user の選択に応じて (透過 fail した raw のプレビュー確認は `open {app_root}/graphics/raw/{graphic_id}.png` — OS 同梱コマンド、失敗時は path 提示のみに degrade):

- **そのまま採用** (透過 fail をラベル付きで受諾) →
  ```bash
  node skills/21f-graphic-postprocess/scripts/commit-degrade.mjs {app_name} waive {graphic_id} --reason "{理由}"
  ```
  → Step 2 を再実行 (当該 slot は `transparency: "waived"` の台帳ラベル付きで正典化される。
  21g は重ね置き前提の配置を避ける判断材料にする)。**Pattern B を `feedback-log.md` に記録**。
- **リトライ** (同 prompt で 21e から再生成) →
  ```bash
  node skills/21f-graphic-postprocess/scripts/commit-degrade.mjs {app_name} retry {graphic_id} --reason "{理由}"
  ```
  → **Step 21e (generate-graphics.mjs) を再実行** (有料 — 当該 slot のみ再生成) → 完了後に
  本 skill を Step 1 から再実行。プロンプト内容の改訂が必要な場合はリトライではなく
  21g 差し戻しのプロンプト起因 routing (設計 §9-2b) を案内する (21f からは受けない)。
  **正典化済み slot の再生成** (waive を選んだ後にやはり透過が欲しくなった等の反悔) は、user に
  意図を確認した上で `--canonical` を付けて実行する — 正典ファイルも削除して 21e からやり直す
  (21g 差し戻し routing [F-7] 実装までの暫定経路。素の retry は誤指定防止のため
  `E_ALREADY_CANONICAL` で拒否される)。
- **当該 slot を除外** →
  ```bash
  node skills/21f-graphic-postprocess/scripts/commit-degrade.mjs {app_name} exclude {graphic_id} --reason "{理由}"
  ```
  slot ごとに実行。除外後 `next` に従う (pending 残 → Step 2 再実行 / 完了 → 21g へ /
  全 slot 除外 → ブロック中止と同義で Step 15 へ)。**Pattern B を `feedback-log.md` に記録**。
- **ブロック中止** →
  ```bash
  node skills/21f-graphic-postprocess/scripts/commit-degrade.mjs {app_name} abort --reason "{理由}"
  ```
  完了報告「グラフィック後処理を中止しました (decision=skip, decided_by=step21f)。21g を
  飛ばして Step 15 (2nd Confluence save) → Step 22 へ進みます」。
- **保留** → **何も書かない** (`step21f_completed_at` 未 set = 次回 resume cascade が 21f を
  再起動する signal — 設計 §9-1)。「後処理を保留しました。次回セッションで 21f が失敗分から
  再開します (正典化済み分は再利用)」を報告。

## 失敗時の挙動

前提 NG (`E_*`) の対応は Step 1 / 3 / 4 に集約済み (再掲しない)。

| 失敗 | 対応 |
|---|---|
| 透過検証 fail | guide §4 の 4 択 (そのまま採用 / リトライ / 除外 / 保留)。fail した raw のプレビュー (path) と alpha 統計を提示してから選ばせる |
| raw が読めない / decode 不能 | 失敗扱い (`file_failures[]`)。リトライ (21e 再生成) / 除外 / 中止へ |
| node が使えない環境 | 縮退運転 — 本書 + guide の契約 (対象差集合 / 透過検証) を満たす代替実行は事実上不可のため、**保留**として報告し環境復旧後に再実行する (バイナリの手動操作へは誘導しない) |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/screens/_shared/graphics/{graphic_id}.png` | **本 skill が single writer** (writer 実体は `postprocess-graphics.mjs`。29 は additive のみ・既存改変禁止 — 設計 §7)。グラフィック正典 (第 4 の正典系統)。raw バイト無加工 (圧縮 ⑫ 非搭載)。21g が `<img src>` 相対参照で埋め込む |
| `artifacts/{app_name}/graphics/postprocess-manifest.json` | 後処理の監査台帳 (透過検証 verdict / alpha 統計 / degrade ラベル)。**補助記録** — resume・埋め込み対象の SoT は pipeline-state 側 (設計 §9-2b)。21g は `transparency: "waived"` ラベルを配置判断に使う |
| `artifacts/{app_name}/pipeline-state.json` | `screens.graphics.generated_files[].file` を正典パスへ更新 (成功のたびに増分) + `step21f_completed_at` (pending が空になったときのみ) / `transparency_waived[]` append (waive 時) / `excluded_slots[]` append (exclude 時) / `generated_files` entry 削除 + `step21e_completed_at` クリア (retry 時) / `decision = "skip"` + `decided_by = "step21f"` (abort・全 slot 除外時)。保留時は更新しない |
| `artifacts/{app_name}/feedback-log.md` | 透過検証 fail で waive・除外・中止に至った場合の Pattern B 記録 |

`graphics/raw/` は中間物としてそのまま残す (READ-ONLY — 監査と retry 差分の基準。設計 §7)。

## 完了後

- 成功 (pending 空 + 失敗ゼロ) → **Step 21g (graphic-embed-review)** へ。21g は正典を
  `<img src="../_shared/graphics/{graphic_id}.png">` 相対参照 (C-26) で HTML に埋め込む。
- ブロック中止 / 全 slot 除外 → 21g を skip し Step 15 (2nd Confluence save) → Step 22 へ
  (orchestrator の resume cascade / 進行判定に委ねる)。
- 保留 → 本セッションのグラフィックブロックはここで終了。次回 `/ayatori-screens` 再実行時に
  resume cascade (`decision == "generate"` AND `step21e_completed_at` set AND
  `step21f_completed_at` 未 set → Step 21f、設計 §9-1) が 21f を再起動する。
- 21g 差し戻し (生成品質起因) の再入は、orchestrator が当該 `generated_files[]` entry を削除して
  `step21e_completed_at` / `step21f_completed_at` をクリアする契約 (設計 §9-2b) — 21e の再生成後、
  本 skill は同じ Step 1 から再実行される。

## 参照

- `docs/graphic-generation-design.md` — 挿入位置設計の SoT (§0 I-3 透過の確定事項 / §7 artifact 責務 / §9-2b slot 単位の再利用・鮮度判定契約 / §11 圧縮の再起票受け皿)
- `refs/postprocess-guide.md` — 透過検証の閾値 / 正典化契約 / degrade 対話テンプレート
- `schemas/graphic-prompts.schema.json` — 入力 schema (READ-ONLY、transparent_background の定義)
- `schemas/pipeline-state.schema.json` — `screens.graphics.*` の state キー定義 (transparency_waived / step21f_completed_at)
