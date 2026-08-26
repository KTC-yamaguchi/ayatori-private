# scr-01-welcome 画面仕様

## 目的
アプリの価値（毎日の小さな選択が CO2 削減という結果になること）を理解し、利用を始める判断をする。起動直後の初回画面。

## レイアウト構成
- ナビゲーション: なし（chrome なし。ヘッダー / ボトムメニューを持たない全画面表示）
- ヘッダー: なし
- メインコンテンツ: ブランド表示（マーク + アプリ名）／キャッチコピー「自分の一歩が地球を変える」／リード文／価値 3 ポイント（アイコン + 見出し + 説明）
- CTA: 「はじめる」（画面下部・主要ボタン、`btn-primary`）→ scr-06-action-list
- フッター: CTA 直下に補足テキスト 1 行

## コンポーネント一覧
| コンポーネント | 分類 | トークン参照 | WCAG要件 |
|---|---|---|---|
| プライマリCTA「はじめる」 | 主要ボタン | color.primary / color.on-primary / sp-touch(44px) / radius-pill | 2.5.8: 44px以上 ✅ |
| キャッチコピー (h1) | — | font-display / fs-2xl / color.on-surface | 1.4.3: 4.5:1以上 ✅ |
| リード文・ポイント説明 | デエンファシス | color.on-surface-secondary / fs-base, fs-sm | 1.4.3: 4.6:1 ✅（#6B6B6B on #FFFFFF） |
| 価値ポイントアイコン | 装飾 | color.primary / color.secondary-active-bg | 1.1.1: aria-hidden + テキストで意味伝達 ✅ |
| 補足テキスト | デエンファシス | color.on-surface-secondary / fs-xs(12px) | 最小フォントサイズ 12px ✅ |

## 状態パターン (仕様書に記述する — HTML 生成は Step 25b)
- default — ブランド + キャッチ + 3 ポイント + CTA の通常表示（本 step で HTML 化）
- loading — 本画面は API 呼び出しを持たないため loading なし
- error — 本画面は API 呼び出しを持たないためエラー状態なし
- empty — 静的コンテンツのみのため empty なし

> 本画面は表示のみで通信を伴わないため、sub-state は生成対象外。

## 画面遷移
- 「はじめる」→ scr-06-action-list（アクション一覧）

> 本試行では登録（SCR-02）／ログイン（SCR-03）がスコープ外のため、「はじめる」を直接アクション一覧へ接続している。製品の本来のフローでは SCR-02 / SCR-03 を経由する。

<!-- ayatori:graphics-used:start -->
## 使用グラフィック

| graphic_id | 配置 | alt | 由来 |
|---|---|---|---|
| welcome-bg | 画面全面の背景レイヤー (.screen の最背面に敷く)。文字可読性のため白のグラデーションスクリムを重ねる前提。透過なし | welcome-bg | AI 生成 (POCTEAMA-179) — 21g 承認 2026-08-19T13:07:03+09:00 |
<!-- ayatori:graphics-used:end -->
