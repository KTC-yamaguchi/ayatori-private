---
name: 21e-graphic-generate
description: Phase 3 の Step 21e。21d 確定の graphic-prompts.json を入力に、slot ごとに生成 API を呼んでグラフィックを生成し (透過 slot は透過対応モデルへルーティング)、確定 size_px へサイズ自動調整して graphics/raw/ に出力する。人間ゲートは持たず、生成失敗時のみ AskUserQuestion の degrade 分岐 (リトライ / slot 除外 / ブロック中止) を回す。出力は 21f (postprocess) が消費する。
---

# 21e: グラフィック生成 + サイズ自動調整

## 役割

21d で人間が確定したプロンプト・生成寸法 (`graphics/graphic-prompts.json`) を、slot ごとに
生成 API へ渡してグラフィック実体を生成し、**確定 size_px ちょうどのピクセル数**に自動調整して
`graphics/raw/{graphic_id}.png` に置く。人間ゲートは無い — 生成する内容・寸法の確認は 21d で
完了済みのため、**本 step で再質問しない** (P4-07)。設計 SoT・用語整理・チケット対応表は
`docs/graphic-generation-design.md`。

本書は **routing / 分岐判断のみ** を持つ。生成・サイズ調整・リトライ・記録はすべて `scripts/`
の決定的処理 (gather-context / generate-graphics / commit-degrade)、サイズ早見表・モデル
ルーティング・degrade 対話テンプレートは `refs/generate-guide.md` (Step 3 の失敗時のみ Read) に
分離している。前提条件 (21d 確定済み / 21e 未完了等) は **すべて Step 1 の script が機械判定する**。

## 実行指示

### Step 1: preflight + 生成計画 (決定的・READ-ONLY)

```bash
node skills/21e-graphic-generate/scripts/gather-context.mjs {app_name}
```

stdout の JSON で routing する:

| 結果 | 行動 |
|---|---|
| `ok: true` | `pending` (生成計画: model / api_size / resize / warnings) を user に簡潔に報告して Step 2 へ。**AskUserQuestion は出さない** — 生成可否の確認は 21d の確定確認が既に含んでいる (P4-07)。`pending[].warnings` (アスペクト比 crop / 拡大の可能性) があれば報告に含める |
| `E_ALREADY_COMPLETED` | 21e 完了済み — Step 21f (postprocess) へ。`stale_pending` が付いている場合は state 不整合 (message 参照) — user に報告して中断 |
| `E_NO_API_KEY` | guide §4 の degrade 分岐へ (キー設定案内 → その場で設定 [setup-image-key.mjs — 再起動不要] / 設定したので続行 / ブロック中止 / 保留) |
| `E_PROMPTS_NOT_CONFIRMED` / `E_PROMPTS_MISSING` | 21d へ差し戻して中断 |
| `E_PROMPTS_INVALID` | graphic-prompts.json が不正 — message を表示して中断 (手動 repair は設計 §5 の運用) |
| `E_BLOCK_SKIPPED` | skip 確定済み ({decided_by}) を表示して中断 — グラフィックブロックは実行しない |
| `E_21B_NOT_DONE` | 21b へ差し戻して中断 |
| `E_ALL_SLOTS_EXCLUDED` | 全 slot 除外済みの state 不整合 — message の指示 (commit-degrade abort) を user に提示して確認の上で実行 |
| その他 `E_*` / exit 1 | message を表示して中断 |

### Step 2: 生成実行 (決定的)

```bash
node skills/21e-graphic-generate/scripts/generate-graphics.mjs {app_name}
```

生成は **低速・有料** (採用ツール比較の調査結果)。進捗は stderr に slot ごとに流れる。
pending 差集合 (設計 §9-2b) により、**digest 一致の生成済み slot は再生成されない** — 中断後の
再実行・失敗後のリトライは残り分だけが走る。

### Step 3: 結果 routing

| 結果 | 行動 |
|---|---|
| `ok: true` | 完了報告 (generated / reused / excluded の内訳 + resize 有無 + `step21e_completed_at`) → **Step 21f (graphic-postprocess) へ** |
| `E_GENERATION_FAILED` | `succeeded` は記録済み。`failures[]` (graphic_id / attempts / error) を user に提示し、guide §3 の AskUserQuestion (**リトライ / 当該 slot を除外 / ブロック中止 / 保留** — 設計 §8-4) を出す → Step 4 |
| その他 `E_*` / exit 1 | message を表示して中断 (書き込み済みの成功分は残る — 再実行で再利用される) |

### Step 4: degrade commit (Step 3 で失敗があった場合のみ)

user の選択に応じて:

- **リトライ** → Step 2 を再実行 (失敗分のみ再生成される)。エラー内容が一時的でない場合
  (コンテンツポリシー起因等、guide §3) はその旨を提示してから選ばせる。
- **当該 slot を除外** →
  ```bash
  node skills/21e-graphic-generate/scripts/commit-degrade.mjs {app_name} exclude {graphic_id} --reason "{理由}"
  ```
  slot ごとに実行。除外後 `next` に従う (pending 残 → Step 2 再実行 / 完了 → 21f へ /
  全 slot 除外 → ブロック中止と同義で Step 15 へ)。**Pattern B を `feedback-log.md` に記録**。
- **ブロック中止** →
  ```bash
  node skills/21e-graphic-generate/scripts/commit-degrade.mjs {app_name} abort --reason "{理由}"
  ```
  完了報告「グラフィック生成を中止しました (decision=skip, decided_by=step21e)。21f-21g を
  飛ばして Step 15 (2nd Confluence save) → Step 22 へ進みます」。
- **保留** → **何も書かない** (`step21e_completed_at` 未 set = 次回 resume cascade が 21e を
  再起動する signal — 設計 §9-1)。「生成を保留しました。次回セッションで 21e が失敗分から
  再開します (成功分は再利用)」を報告。

## 失敗時の挙動

前提 NG (`E_*`) の対応は Step 1 / 3 / 4 に集約済み (再掲しない)。

| 失敗 | 対応 |
|---|---|
| API キー未設定 (`E_NO_API_KEY`) | guide §4 — キーの入手先と設定方法 (推奨: `setup-image-key.mjs` によるキーファイル作成 — 再起動不要) を案内し、設定後に Step 1 から再実行 / ブロック中止 / 保留 を確認する。**無言でブロックを skip しない** (Operating Principle 4) |
| 認証エラー (`API 401` / `API 403`) | キーが古い / 遮蔽されている症状。リトライ前に `node scripts/setup-image-key.mjs --doctor` で実効ソースを確認する (guide §4 — env に残った旧キーがキーファイルを遮蔽しているのが典型) |
| レート制限が続く (429 連発) | リトライ間隔を置く「保留」を推奨提示 (次回 resume で残り分から再開) |
| 出力 PNG が decode/resize 不能 | 失敗扱い (課金は発生済み)。リトライで直らない場合は除外 or 中止へ |
| node が使えない環境 | 縮退運転 — 本書 + guide の契約 (pending 差集合 / モデルルーティング / サイズ調整) を満たす代替実行は事実上不可のため、**保留** として報告し環境復旧後に再実行する (画像バイナリの手動生成・手動リサイズへは誘導しない) |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/graphics/raw/{graphic_id}.png` | **本 skill が single writer** (writer 実体は `generate-graphics.mjs`)。確定 size_px ちょうどの寸法で置かれる中間物 (透過/後処理前 — 設計 §7)。21f が READ-ONLY で消費する |
| `artifacts/{app_name}/graphics/raw/generation-manifest.json` | 生成の監査台帳 (実使用モデル / API サイズ / resize 有無 / 試行回数 / warnings)。**補助記録** — resume・埋め込み対象の SoT は pipeline-state 側 (設計 §9-2b) |
| `artifacts/{app_name}/pipeline-state.json` | `screens.graphics.generated_files[]` (成功のたびに増分 — graphic_id / file / generated_at / source_digest) + `step21e_completed_at` (pending が空になったときのみ) / `excluded_slots[]` append (exclude 時) / `decision = "skip"` + `decided_by = "step21e"` (abort・全 slot 除外時、設計 §8-4)。保留時は更新しない |
| `artifacts/{app_name}/feedback-log.md` | 生成失敗で除外・中止に至った場合の Pattern B 記録 |

## 完了後

- 成功 (pending 空 + 失敗ゼロ) → **Step 21f (graphic-postprocess)** へ。21f は raw/ を透過検証
  して raw バイト無加工で正典 `screens/_shared/graphics/` に置く (圧縮 ⑫ は非搭載 — POCTEAMA-189)。
- ブロック中止 / 全 slot 除外 → 21f-21g を skip し Step 15 (2nd Confluence save) → Step 22 へ
  (orchestrator の resume cascade / 進行判定に委ねる)。
- 保留 → 本セッションのグラフィックブロックはここで終了。次回 `/ayatori-screens` 再実行時に
  resume cascade (`decision == "generate"` AND `step21e_completed_at` 未 set → Step 21e、設計 §9-1)
  が 21e を再起動する。
- 21g 差し戻し (生成品質起因) の再入は、orchestrator が当該 `generated_files[]` entry を削除して
  `step21e_completed_at` をクリアする契約 (設計 §9-2b) — 本 skill は同じ Step 1 から再実行される。

## 参照

- `docs/graphic-generation-design.md` — 挿入位置設計の SoT (§7 artifact 責務 / §8-4 skip・degrade 動線 / §9-2b slot 単位の再利用・鮮度判定契約)
- `refs/generate-guide.md` — サイズ早見表 / モデルルーティング / リトライ規約 / degrade 対話テンプレート
- `docs/setup.md` — 生成 API キーの取得・設定 (環境変数契約)
- `schemas/graphic-prompts.schema.json` — 入力 schema (READ-ONLY)
- `schemas/pipeline-state.schema.json` — `screens.graphics.*` の state キー定義
