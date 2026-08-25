# 21f 後処理ガイド (透過検証の閾値・正典化契約・degrade テンプレート)

`skills/21f-graphic-postprocess/SKILL.md` の Step 3〜4 (失敗時) と、後処理契約の背景説明のための
参照資料。routing / 分岐判断は SKILL.md 側、決定的処理は `scripts/` 側の責務であり、本書は
**契約の中身 (何がどう決まるか) と degrade 対話の文面** だけを定義する。数値・アルゴリズムの
実装 SoT は `scripts/png-inspect.mjs` (閾値定数) — 本書と食い違ったら script 側が正。

## §1 なぜ 21f の透過は「検証」なのか (ユーザーフロー ⑪)

一次調査 I-3 ([POCTEAMA-182](https://kinto-dev.atlassian.net/browse/POCTEAMA-182)) の結論:

- Operating Principle 1 (外部 CLI 禁止) 下では、後処理での背景除去 (rembg / OpenCV 等) に
  実行経路が無い — **「生成段階で透明背景生成」が実質唯一の透過経路**。
- そのため透過は 21e が担う: `transparent_background: true` の slot は透過対応モデル
  (pipeline.yaml `graphic_generation.tool_transparent`) + `background: transparent` で生成される。
- 21f の透過責務は**検証に縮小**: 生成モデルが実際に背景を透明化したかを alpha 統計で機械確認し、
  fail した不良品を正典 (= 21g が無条件に埋め込む集合) に混ぜない。

透過の**要否判断そのもの** (「ボトムメニュー代わりは透過必須 / 背景がデザインの一部のヒーローは
透過しない」— チケットの設計観点) は 21b の箇所選択 + 21d のプロンプト確定という**上流の人間
ゲートで slot 属性として確定済み** — 21f は判断せず、属性に従って検証を適用するだけ。

## §2 透過検証の閾値 (実装 SoT: `png-inspect.mjs`)

| 定数 | 値 | 意味 |
|---|---|---|
| `ALPHA_TRANSPARENT_MAX` | 8 | 「透明画素」= alpha ≤ 8 (完全透明 0 に、モデル出力・面積平均 resize の縁の揺らぎ分だけ余裕) |
| `BORDER_FAIL_RATIO` | 0.05 | **fail**: 外周 1px 帯の透明率 < 5% — 背景が画像の縁まで残っている (重ね置きで背景が見える) |
| `BORDER_WARN_RATIO` | 0.3 | **warn** (pass だが台帳に警告): 外周透明率 < 30% — full-bleed 気味の構図。21g の埋め込みプレビューで要確認 |

- 判定順: ① alpha < 255 の画素が 1 つも無い (全画素不透明) → fail / ② 外周透明率 < 5% → fail /
  ③ 外周透明率 < 30% → pass + warn / ④ それ以外 → pass。
- 外周を見る理由: 被写体を中央に置く透過グラフィック (ワンポイント・キャラクター等) は外周が
  ほぼ透明になる。全体透明率だけでは「中央に大きな不透明被写体 + 正しく透明な背景」と
  「全面不透明」を区別しにくい。
- 閾値は 21e の resize (alpha 前乗算の面積平均 — 透過縁の halo 防止) 通過後の raw を前提に
  較正している。非透過 slot には検証を適用しない (背景がデザインの一部 — 検証対象外)。

## §3 正典化契約 (圧縮 ⑫ は非搭載)

圧縮 (ユーザーフロー ⑫「ファイル容量軽量化」) は**本 skill に搭載しない**:

- 一次調査 I-4 (POCTEAMA-183) は Skip 判断で、専用の圧縮方式は確定していない。
- 実装レビュー時のユーザー判断 (2026-08-05) で、WebP 化を含む圧縮をスコープから除外した。

したがって正典化は **raw PNG のバイトを無加工でコピーする** だけ (再エンコードなし = 劣化ゼロ・
決定的・byte 照合可能)。ファイルサイズの統制は生成時の size_px 指定 (21d 確定 → 21e の生成
パラメタ) で上流から行う。アセット肥大が実運用で問題化した場合の再起票の受け皿は設計 §11 —
その際も外部 CLI (cwebp / imagemagick / sips) に手を伸ばさないこと (Operating Principle 1)。

旧仕様 (WebP 化) の run が残した `{graphic_id}.webp` は、正典書き込み時に掃除される
(両拡張子並存で src↔存在照合を曖昧にしない)。

## §4 degrade 対話テンプレート

### 透過検証 fail 時 (`E_POSTPROCESS_FAILED` の `transparency_failures[]`)

fail 一覧 (graphic_id / alpha 統計 / 警告要旨) と raw のプレビュー path
(`artifacts/{app_name}/graphics/raw/{graphic_id}.png`) をチャットで提示してから、slot ごとに
AskUserQuestion を出す。`header` は 12 文字以内厳守:

```
header: "透過検証失敗"

question: |
  {graphic_id} の背景透明化が確認できませんでした
  (透明画素率 {transparent_ratio}% / 外周透明率 {border_transparent_ratio}%)。
  透過は生成段階でしか作れないため (I-3)、選択肢は以下です。どう進めますか?

options:
  - label: "そのまま採用"
    description: "不透明のまま正典化する (台帳にラベル記録 — 重ね置きしない配置を 21g で選ぶ前提)"
  - label: "リトライ"
    description: "同じプロンプトで 21e から再生成する (有料・当該 slot のみ)"
  - label: "この slot を除外"
    description: "グラフィックなしで確定し、残りで先へ進む (除外理由が記録される)"
  - label: "保留"
    description: "何も記録せず終了する。次回セッションで失敗分から自動再開する"
```

- 「そのまま採用」= チケットの fallback 方針「ラベルをつけて代わりの方法を提案」の実体 —
  waive 記録 (`transparency_waived[]`、prompt digest 単位) + 台帳ラベル `transparency: "waived"`。
  21g への申し送り: 重ね置き前提の配置 (背景に他要素が透ける想定) を避ける。
- 「リトライ」は同 prompt の再抽選。**プロンプト自体の改訂は 21d 確定済みのため本 step では
  受けられない** (21g 差し戻しのプロンプト起因 routing [設計 §9-2b] は 21g 到達後の経路。
  生成前に改訂したい場合は設計 §5 の手動リセット運用による) — 21e guide §3 と同じ制約。
- 2 回リトライしても fail が続く場合は、透過対応モデルの限界の可能性を提示して
  「そのまま採用 / 除外」を推奨する (リトライ課金の際限ない繰り返しを避ける)。

### raw 読み込み / decode 失敗時 (`file_failures[]`)

```
header: "後処理失敗"

question: |
  {failed_count} 件の slot の raw 画像が読めません ({processed_count} 件は正典化済み)。
  エラー内容: {失敗一覧の要旨}。どう進めますか?

options:
  - label: "リトライ (再生成)"
    description: "当該 slot を 21e から再生成する (有料 — raw の破損・欠落を作り直す)"
  - label: "失敗 slot を除外"
    description: "失敗した slot をグラフィックなしで確定し、残りで先へ進む"
  - label: "ブロック中止"
    description: "グラフィック生成ブロック全体を中止する (decision=skip — 正典化済み分も埋め込まれない)"
  - label: "保留"
    description: "何も記録せず終了する。次回セッションで失敗分から自動再開する"
```

## §5 再利用・冪等性の注意 (user への提示に含める)

- 本 step はローカル処理のみ (生成 API は呼ばない — 課金なし・高速)。
- 正典化済み slot (generated_files[].file が正典パス + 実在 + digest fresh) は再実行しても
  **再処理されない** (対象差集合 — 設計 §9-2b)。
- waive 記録は prompt digest + **raw バイト (sha256)** の複合単位 — プロンプト改訂 (digest 変化)
  で失効するのに加え、digest 不変の再抽選 (21g 品質差し戻し [F-7] は entry 削除 + completed_at
  クリアのみで waiver に触れない、設計 §9-2b) でも**バイトが変われば自動失効**する。user が
  受諾したのは「あのバイトの不透明画像」であり、未見の新画像が再 fail した場合は自動適用せず
  degrade 質問に戻る (PR #185 レビュー指摘)。**21f 自身の「リトライ」(commit-degrade retry /
  retry --canonical) は当該 slot の記録を明示的に除去する** (死んだ台帳を残さない — schema
  `transparency_waived` の契約。新バイトへの waive は旧記録を置換する — 1 slot 1 記録)。
- 正典 `screens/_shared/graphics/` を手で消さない — state 上は正典化済みのままになり、
  21f 入口の整合 assert (`E_21E_STALE`) で止まる。復旧は設計 §5 の手動リセット運用。
