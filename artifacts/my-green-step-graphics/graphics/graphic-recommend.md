# グラフィック必要性 推奨レポート — my-green-step-graphics

> **本レポート全体は (E) PROPOSED** — AYATORI の提案であり、「グラフィックが必要か」の
> 最終判断は Step 21b の人間ゲートでユーザーが行う。

## 1. 推奨（結論）

**グラフィック作成は「検討推奨」を推奨**（生活者向けの行動変容アプリで、初回接点の情緒的な訴求が体験価値に直結する帯のため）。

| 判定 | 値 |
|---|---|
| 推奨 | **検討推奨**（3 段階: 不要 / 検討推奨 / 強く推奨） |
| 確信度 | 高（カテゴリ判定の逐語引用が明確に取れ、`illustration_policy = pictogram` はアイコン様式の別軸であり本推奨と矛盾しない） |
| 任意オプション | ウェルカム画面のヒーロー領域は Step 19 採点でも「視覚的な主役がなく第一印象の訴求力が弱い」として審美的品質 −1 の指摘対象になっている（`scores.json` タグ `welcome_hero_visual`） |

## 2. 分析根拠

### 2-1. アプリ/コンテンツのカテゴリ判定 ※ 推測 (inferred)

**カテゴリ: B2C 生活系（健康・家計・旅行・EC）**

根拠（`requirements/00-raw-input.md` / `requirements/01-overview.md` からの逐語引用）:
- 「何気なく日常生活を送っている一般の人。家事、買い物、通院、散歩など普通の生活をしている。」（00-raw-input.md ターゲットユーザー — 業務利用者ではなく生活者が対象）
- 「その人の行動の影響を可視化し、「自分一人でも変化を起こせる」と実感してもらいたい」（00-raw-input.md 解決したい課題 — 情緒的な実感の提供が目的）
- 「ユーザーが日常生活で実践できるエコアクションを提案し、その効果をCO2削減量として可視化することで、「自分一人の行動でも環境に貢献できる」という実感を提供する。」（01-overview.md 1.1 — 家計簿・ヘルスケアと同型の生活記録 + 行動変容モデル）

### 2-2. カテゴリ → ユーザー期待レベル → 導出

| カテゴリ帯 | グラフィック期待度 | 既定の推奨 | 例 |
|---|---|---|---|
| ゲーム / 子供向け・教育 / エンタメ | 高 — キャラクター・イラストが期待される | 強く推奨 | ゲームアプリ、読み聞かせアプリ |
| **B2C 生活系（健康・家計・旅行・EC）** | **中 — オンボーディング・空状態等の要所で期待** | **検討推奨** | 家計簿アプリ、ヘルスケア ← **my-green-step-graphics はここ** |
| 実用ツール / 業務効率 / ダッシュボード | 低 — ピクトグラム中心で十分 | 不要 | 運転支援ツール、業務管理 |

生活者の日常行動を記録し情緒的な実感を返すモデルであり、家計簿・ヘルスケアと同じ帯に入る → 期待度「中」→ 既定の推奨「検討推奨」（→ 導出 (C) DERIVED、導出元は上表）。要所（初回接点・オンボーディング説明）に限って効果が見込める帯であり、全画面へのグラフィック展開は帯の想定外。

### 2-3. 既存のユーザー選択との整合（(A) CONFIRMED の prior）

- `requirements.json → design_output_scope.illustration_policy = "pictogram"`（Phase 1a Q7-f でユーザー自身が選択済み）
- 整合 — 本分析の結論はこの選択と整合する。`pictogram` は「アイコンをどう描くか」の様式選択であり、コンテンツグラフィック（イラスト・写真）の要否とは別軸のため、期待度「中」と矛盾しない。
- `design-brief.yaml → common`（Phase 2 ヒアリングで確定済み）: `tone_and_mood = "落ち着いたティール系、白背景ベース"` / `brand_direction = [清潔感, 信頼感, 使いやすさ]` / `avoid = [絵文字の多用, 子供っぽいデザイン]` と本推奨の方向性は整合（グラフィックを入れる場合も「静かで清潔なトーン」に寄せる制約として働く。避けるスタイルの指定はテイスト選定 = Step 21c への制約であり、要否そのものを否定しない）。

## 3. 画面インベントリ（→ 決定的抽出、(C) DERIVED）

抽出スクリプト (`skills/21a-graphic-recommend/scripts/extract-inventory.mjs`) の実行結果より:

| 画面 | アイコン（icons/ 正典と署名一致） | 意味を持つ視覚要素 | グラフィック候補スロット |
|---|---|---|---|
| scr-01-welcome | check-circle, chart-bar, calendar-days（3 個） | なし | ヒーロー領域 / 価値 3 ポイントのアイコン列 |
| scr-06-action-list | sun, truck, bolt, shopping-cart, map-pin, chevron-right×3, chart-bar, clipboard-document-check, cog-6-tooth（9 種） | なし | アクションカードのアイコン列 ×5 |
| scr-07-action-detail | arrow-left（1 個） | なし | 期待CO2削減量カード周辺 |

- ラスター画像: 0 / イラストプレースホルダ: 0 / 絵文字: なし（illustration_policy=pictogram と整合）

### 3-b. アイコン用途の分類（① 機能アイコン / ② グラフィック代替候補）

`icon_contexts` (px / parent_class / siblings / nav / control) に基づく §8 の判定結果。

| 画面 | 箇所 | 特徴量 | 判定 | 根拠 |
|---|---|---|---|---|
| scr-01-welcome | `welcome__point-icon` の check-circle / chart-bar / calendar-days | 40px / ×3 | ② 代替候補 | px ≥ 40 かつ nav でない（拡大表示 = コンテンツの代役）。同時に siblings ≥ 3 のグループ条件も満たす |
| scr-06-action-list | `card-icon` の sun / truck / bolt / shopping-cart / map-pin | 44px / ×5 / control | ② 代替候補（グループで 1 slot） | siblings ≥ 5 かつ nav でなく px ≥ 24 のサムネイル列。`in_control` はカード全体が `<a>` のため付くもので否決材料にしない |
| scr-06-action-list | `card-chevron` の chevron-right | 20px / ×3 / control | ① 機能 | px ≤ 32 の操作グリフ |
| scr-06-action-list | `mobile-bottom-nav__item` の chart-bar / clipboard-document-check / cog-6-tooth | 24px / nav / control | ① 機能 | in_nav（ナビゲーション UI 部品） |
| scr-07-action-detail | `mobile-header__back` の arrow-left | 24px / control | ① 機能 | px ≤ 32 の単独操作グリフ |

## 4. グラフィック候補スロット一覧（Step 21b 質問④への引き継ぎ材料）

| # | 箇所 | スロット種別 | 個別推奨 |
|---|---|---|---|
| 1 | `scr-01-welcome` キャッチコピー上部のヒーロー領域（現状は文字のみで視覚の主役がない） | hero_brand | **推奨** — アプリの初回接点であり、「自分の一歩が地球を変える」という情緒的なメッセージを言葉だけで支えている箇所 |
| 2 | `scr-01-welcome` 価値 3 ポイントのアイコン列（40px の拡大アイコン ×3） | onboarding_explainer | **推奨** — 3 つの価値説明が汎用ピクトグラムのため、内容（かんたん / 見える / つづく）と絵の結びつきが弱い |
| 3 | `scr-06-action-list` アクションカードのアイコン列（44px ×5） | content_media | **任意** — アクションごとの内容（再エネ電力・食事・移動等）を示すサムネイルで、絵にすると識別性が上がる。ただし 5 枚必要で生成コストが最も大きい |
| 4 | `scr-07-action-detail` 期待CO2削減量カード周辺 | content_media | **任意** — 当該アクションの内容を表す 1 枚。詳細画面の情報密度は既に高く、効果は限定的 |

<!-- ayatori:slot-anchors
{ "slot_anchors": [
  { "n": 1, "screen": "scr-01-welcome", "platform": "mobile", "anchor": "text:自分の一歩が" },
  { "n": 2, "screen": "scr-01-welcome", "platform": "mobile", "anchor": "class:welcome__point-icon" },
  { "n": 3, "screen": "scr-06-action-list", "platform": "mobile", "anchor": "class:card-icon" },
  { "n": 4, "screen": "scr-07-action-detail", "platform": "mobile", "anchor": "text:期待CO2削減量" }
] }
-->

※ 空状態・エラー状態はグラフィックの定番スロットだが、v1 は main (default) HTML のみ対象のため
対象画面が存在しない（sub-state を後日生成する場合の専用グラフィックは将来拡張 — 設計 §4）。

## 5. 分析対象外（ガードレール）

以下は**データ駆動の可視化 = コア UI** であり、グラフィック（イラスト・写真）への置き換え候補では**ない**:

- 本プロジェクトに該当要素なし（`role="img"` の意味視覚は 0 件。週間ビフォーアフターグラフ等のデータ駆動描画はダッシュボード画面にあり、本試行のスコープ外）

以下は**入力タスク画面**（フォーム / 決済 / 認証）であり、大型グラフィックがタスク完遂を阻害するため
候補にしていない（§4 の負の規則）:

- 本プロジェクトに該当画面なし（登録・ログイン・アンケートは本試行のスコープ外で生成していない）

「オーナーの意向」は AYATORI では取得できないため本分析の判断軸に含めていない
（判断軸は「アプリ/コンテンツのカテゴリから推定されるユーザーの期待」のみ）。
