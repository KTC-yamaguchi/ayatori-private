# 21d プロンプト確定ガイド (合成規約・size_px・提示テンプレート・差し戻しモード)

`skills/21d-graphic-prompts/SKILL.md` の Step 2〜4 (対話) 実行時のみ Read する参照資料。
routing / 分岐判断は SKILL.md 側、決定的検証・書き込みは `scripts/` 側の責務であり、本書は
**slot ごとのプロンプトと size_px をどう組み立て、user にどう提示・確定させるか** だけを定義する。

## §1 プロンプト案の合成規約 (AI 提案 = (E) PROPOSED)

1 slot = 1 プロンプト。構造は **[slot 固有の主題・構図 1〜2 文] + [taste.style_directive 逐語]** の
2 部構成 (schema `prompts[].prompt` description の合成契約。palette ヒントは 21c が style_directive に
織り込み済み — slot 固有に別の色が要る場合のみ追記する):

- **slot 固有部の素材** (プロジェクト背景 × 箇所の用途):
  - `slots[].placement` / `size_role` / `rationale` — その箇所が担う役割 (ヒーロー訴求 / 空状態の
    和らげ / 報酬演出 等) を主題に翻訳する。
  - `spec_file` (`screens/{screen}.md`) — 画面の目的・表示要素・文言のトーン。
  - `requirements/01-overview.md` — アプリのドメイン・ターゲット層 (描く題材の妥当性)。
  - 21c サンプルの subject (`existing_prompts` 不在の初回でも `graphics/samples/samples-manifest.json`
    の subject が参考になる — テイスト選定時に user が見た絵柄との連続性)。
- **英語** で書く (パイプラインのプロンプトは常に英語 — 21e が英語のまま生成 API へ渡す。
  日本語混入は commit script が確定前に `E_NON_ENGLISH` で停止する。固有名詞の原語表記等の
  意図的なケースのみ `--allow-non-english` で明示続行。**文字入れ [embedded text] 指示の日本語は
  意図的でも不可** — 下記「含めない」の禁止事項に該当する)。
- **style_directive は逐語で含める** (言い換え・要約・分割は不可 — 全 slot 共通の文字列一致が
  テイスト一貫性の機械担保。commit script が `E_STYLE_DEVIATION` で検査する)。user が特定 slot
  だけ意図的に画風を変える指示を出した場合のみ逸脱を許し、`--allow-style-deviation` で確定する。
- **含めない**:
  - 実在ブランド名・実在人物・文字入れ (embedded text) の指示。題材が文字を連想させる場合
    (看板・ラベル等) は "blank signage" のように無文字を明示する。
  - no-text / no-brand 系の禁止句の tail — 21e 側の生成規約が機械付加する (21c generate-samples の
    固定 tail と同じ線引き。二重指定しない)。
  - サイズ・解像度の文言 — `size_px` field が 21e の生成パラメタになる (プロンプトに書かない)。
- **transparent_background の判断**: 背景色・写真の上に載る切り抜き想定 (キャラクター /
  スポットイラスト / 装飾オブジェクト) → `true`。領域全面を塗る想定 (ヒーロー背景 / カード内
  サムネイル) → `false` (省略可 — 省略時 false)。true の場合は主題が輪郭で完結する構図にする
  (見切れ・地面影の指定はしない — 透過処理 (21f) と相性が悪い)。

例 (駐車位置最適化アプリ・hero slot、style_directive が水彩系の場合):

```
A small friendly compact car parked under a tree's cool shadow on a sunny day, conveying
"found the coolest parking spot", centered composition with generous negative space.
Soft watercolor illustration style without outlines, subtle paper texture, gentle muted
colors harmonized with #0E7C90 (teal) and #EAF2F4 (light celadon), on a light background.
```

(1 文目 = slot 固有、2 文目以降 = style_directive 逐語。)

## §2 size_px の決め方 ((C) DERIVED — 導出根拠を提示に併記)

`size_px_hint` (size_role 起点の目安) を出発点に、埋め込み先
レイアウトへ具体化する:

| size_role | hint | 具体化の観点 |
|---|---|---|
| hero | 800×400 | 対象 platform の表示幅 (web ヘッダー直下なら横長 2:1 前後 / mobile 縦画面なら 4:3〜1:1 に寄せる)。platform が複数なら最大幅に合わせ、縮小表示で共有する |
| content | 320×200 | placement のカード / placeholder ブロックの実寸感。既存 `illust-placeholder` を置き換える場合はそのブロックのアスペクト比に合わせる |
| small | 64×64 | ワンポイント装飾。1:1 固定が扱いやすい |

- 判断素材は `spec_file` と、必要なら該当画面 main HTML の該当ブロックのみ (全文 Read しない)。
- `size_px` は `<img>` の `width/height` 属性 (C-26: 明示必須) の基準値になる。Retina 等の高密度
  表示を見込む場合は表示寸の 2 倍で生成し、その旨を notes に書く (生成 API 側のサイズ制約への
  丸めは 21e の責務 — ここでは意図した出力寸を確定する)。
- アスペクト比を placement と大きく変えない (object-fit は cover/contain のみ許容 — C-26)。
- **同一 graphic_id を複数 slot で共有している場合** (plan schema の画像再利用 — 1 graphic_id =
  1 画像アセット = 1 prompt entry): size_px は **最も大きい size_role の slot を基準に導出し**
  (hero > content > small)、他 slot は縮小表示で共有する。基準にした slot と縮小共有する slot を
  notes に記録する (どの size_role から size_px を決めたかを後から追跡できるようにする)。

## §3 一括提示フォーマット (plain chat)

**全 slot を 1 回で提示する** (1 箇所ずつの逐次確認にしない — テイストの一貫性は横並びでしか
確認できず、slot 数分の AskUserQuestion 往復は過剰質問 (P4-07) に近づくため。修正指示は slot 指定で
受け付ける)。提示は概要表 + slot 詳細の 2 段:

```
## グラフィック生成プロンプト案 ({slot_count} 箇所)

テイスト: {level1_words} / 案 {level2_choice} (21c 確定済み — 全 slot に共通適用)

| # | graphic_id | 画面 | 配置 | size_px | 透過 |
|---|---|---|---|---|---|
| 1 | {graphic_id} | {screen} ({platforms}) | {placement} | {width}×{height} ({size_role} 起点: {導出観点 1 語}) | {あり/なし} |

### 1. {graphic_id}
- **どんな絵か (日本語要約)**: {1〜2 文。user はここで内容を判断する}
- **プロンプト全文 (英語)**:
  > {prompt}
- {notes があれば}
```

- 日本語要約はプロンプトの直訳ではなく「何が・どんな構図で・どんな雰囲気で」を 1〜2 文で。
- 取り下げ済み slot (`omit` 予定) がある場合は表の下に「取り下げ: {graphic_id} — {reason}」を明示する。
- 複数 slot で共有する graphic_id は **1 行にまとめ**、画面 / 配置列に全 slot を併記する
  (prompt entry は 1 つなので行を分けると「別々に確定できる」誤解を生む。size_px 列には §2 の
  基準 slot を記す)。

## §4 確定確認 (AskUserQuestion)

提示の前に `commit-prompts.mjs confirm --stdin --dry-run` で draft を検証しておく (user には
検証済み draft だけを見せる)。`header` は 12 文字以内厳守:

```
header: "プロンプト確定"

question: |
  全 {slot_count} 箇所のプロンプト案を提示しました (上の一覧参照)。この内容で確定してよいですか?
  確定すると graphic-prompts.json に記録し、21e (グラフィック生成 — 有料・低速) に進みます。
  修正は「どの箇所をどうしたいか」で指示できます (例: 「hero-dashboard はキャラクターにしたい」
  「empty-cart のキャラクターは座っているポーズで」)。

options:
  - label: "この内容で確定"
    description: "全 slot のプロンプトを確定して 21e (生成) へ進む"
  - label: "修正指示あり"
    description: "slot 指定の修正指示をチャットで受け付け、当該 slot の案を更新して再提示する"
  - label: "slot を取り下げる"
    description: "生成しない箇所を指定して外す (理由を添えて記録される)。残りの slot で確定に進む"
  - label: "中止・保留"
    description: "全 slot の生成中止 (21e-21g を skip) か、確定を保留して次回再開かを選ぶ"
```

- 「中止・保留」が選ばれたら follow-up の AskUserQuestion で 2 択を確認する:
  **全 slot 生成中止** (decision=skip / SKILL.md Step 4-B — グラフィックブロック自体を終了) /
  **保留** (何も書かず終了、次回 21d 再起動 / SKILL.md Step 5)。
- 全 slot が取り下げ対象になった場合は omit で確定せず、「全 slot 中止 (skip) に転換するか」を
  確認する (確定 prompt 0 件の graphic-prompts.json は書けない — schema minItems 1、設計 §8-4)。

## §5 修正指示の反映

- 指示を slot 単位に分解し、**当該 slot のプロンプトだけ** を改訂して §3 の形式で再提示する
  (改訂箇所を太字等で明示)。**Pattern A を `feedback-log.md` に記録**。
- **未改訂 slot は逐語保持する** (1 文字の言い換えも禁止)。21e の再生成判定は prompt 文字列の
  digest (設計 §9-2b) — 言い換えは「見た目同じで全 slot 再課金」になる。確定後の修正往復
  (E_VALIDATION → 直して再確定) でも同じ。
- 指示がテイスト自体の変更 (「全部もっとポップに」等、style_directive に及ぶもの) なら 21d では
  受けない — 21c 差し戻しは全 slot stale 化 = 全量再生成のコスト暴発経路のため v1 非対応
  (設計 §9-2b)。その旨と手動リセット運用 (設計 §5) を案内し、確定 / 中止 / 保留を再確認する。

## §6 差し戻しモード (`mode == "rework"` — 21g からのプロンプト起因差し戻し)

`rework_pending` の `{graphic_id, instruction}` が対象。orchestrator が `prompts_confirmed_at` を
クリア済みのため preflight は通る (設計 §9-2b):

1. 冒頭で差し戻し内容を提示する: 「21g から {n} 件のプロンプト差し戻しがあります —
   {graphic_id}: {instruction}」。
2. **差し戻し slot のみ** instruction を反映して再 draft する (§1 の合成規約は同じ)。
3. **それ以外の slot は `existing_prompts.entries` から逐語コピーする** (prompt / size_px /
   transparent_background / notes とも変更しない — digest 一致で 21e が cache 再利用し再課金しない)。
   `tool` も draft に書かない (commit が前回確定値を自動継承する)。本規約は commit が機械検査する —
   対象外 entry / tool の変更は `E_REWORK_SCOPE` で停止し、user の明示指示による意図的な変更のみ
   `--allow-rework-scope-change` で続行できる。
4. §3 で全 slot を再提示 (差し戻し slot に「差し戻し反映」マークを付ける) → §4 の確定確認。
5. 確定 commit が rework_pending の消費 (再確定 slot の entry 除去) と `prompts_confirmed_at` の
   再 set を原子的に行う — 手動で state を編集しない。
- 差し戻し slot の取り下げ (omit) は不可 — commit が `E_VALIDATION` で弾く。生成済み slot を
  外したい場合は 21g 側の却下手順 (設計 §11) による。
- **前回 omit した slot (前回確定 file に entry が無い対象 slot) は omit のまま維持する** —
  prompts への復活は差し戻し scope 外の新規生成 (再課金) として `E_REWORK_SCOPE` で停止する。
  reason は前回の取り下げ理由を再掲する (feedback-log の Pattern A 記録を参照)。user の明示指示で
  復活させる場合のみ `--allow-rework-scope-change` で続行。

## §7 取り下げ (omit) と全中止 (skip) の意味論

| 操作 | 記録 | 効果 |
|---|---|---|
| slot 取り下げ (`omit`) | graphic-prompts.json に当該 entry を**書かない** (= schema が定める正規の取り下げ記録) + commit 出力の `omitted` + Pattern A | 当該 slot は 21e で生成されず、21g でも埋め込まれない (埋め込み対象 = generated_files 起点、設計 §9-2b)。plan の slot は不変 (READ-ONLY) |
| 全 slot 中止 (`skip`) | `screens.graphics.decision = "skip"`, `decided_by = "step21d"` (graphic-prompts.json は書かない) | 21e〜21g を skip して Step 15/22 へ素通し。再入は設計 §5 の手動リセット運用のみ |

- omit の reason は commit の必須入力 (無言の取り下げ禁止 — 「未完了」と「取り下げ」を区別する
  ための記録。Operating Principle 4)。
- 取り下げは確定前 (21d) の操作。生成後 (21e 失敗) の除外は `excluded_slots` (21e の責務)、
  承認段階の却下は 21g の責務 — 3 者を混同しない (設計 §8-4 / §9-2 / §11)。
