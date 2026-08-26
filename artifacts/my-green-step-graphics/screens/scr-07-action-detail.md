# scr-07-action-detail 画面仕様

## 目的
個別アクションの内容・効果の根拠・期待削減量・実施手順を理解し、「挑戦する」または「やった」を記録する（F-005 / F-007）。

## レイアウト構成
- ナビゲーション: なし（BottomTab は付けない。アクション一覧の子画面）
- ヘッダー: B（下層・戻るあり）、タイトル = アクション名、戻り先 = scr-06-action-list
- メインコンテンツ: 上部グラフィック帯（画面左右端まで届く高さ 260px の帯。一覧の ACT-003 と同一画像を `object-fit: cover` で表示）／カテゴリ・難易度バッジ／期待CO2削減量ヒーローカード／「なぜ効果的か」＋算出根拠／「やり方」ステップ
- CTA: 画面下部固定の「挑戦する」（主要ボタン）
- フッター: CTA + 補足テキスト 1 行（画面下部に sticky）

## コンポーネント一覧
| コンポーネント | 分類 | トークン参照 | WCAG要件 |
|---|---|---|---|
| プライマリCTA「挑戦する」 | 主要ボタン | color.primary / color.on-primary / sp-touch(44px) / radius-pill | 2.5.8: 44px以上 ✅ |
| 戻るボタン（共通部品ヘッダーB） | 主要ボタン | color.on-surface / 44×44px | 2.5.8: 44px以上 ✅ / 4.1.2: aria-label="戻る" ✅ |
| CO2 ヒーローカード | — | color.primary（背景）/ color.on-primary（文字）/ font-display / fs-3xl / tabular-nums | 1.4.3: 白文字 on #117F87 = 4.6:1 ✅ |
| カテゴリバッジ | — | color.secondary-active-bg / color.primary / fs-sm | 1.4.3: 4.5:1以上 ✅ |
| 難易度バッジ（簡単） | — | color.success-bg / color.success-text / fs-sm | 1.4.1: 色のみに依存せずラベル文字を併記 ✅ |
| 本文（なぜ効果的か / 手順） | — | fs-base / lh-relaxed / color.on-surface | 1.4.3: 4.5:1以上 ✅ |
| 算出根拠テキスト | デエンファシス | color.on-surface-secondary / fs-xs(12px) | 最小フォントサイズ 12px ✅ |
| 手順ステップ番号 | — | color.secondary-active-bg / color.primary / font-numeric | 1.3.1: ol による順序の構造化 ✅ |

## 掲載データの出典
`requirements/05-features.md` §5.2 アクションマスタデータの ACT-003（週1回の牛肉→鶏肉/豚肉 / 食事 / 2.0 kg/週 ≒ 104 kg/年 / 難易度 1 簡単 / 算出根拠「牛肉100gの生産CO2は鶏肉の約10倍。週1回の置換で年間104kg削減」）から引用。実施手順の文面は完成済プロジェクト `my-green-step` で人間承認済みの内容を引き継いでいる。

## 状態パターン (仕様書に記述する — HTML 生成は Step 25b)
- default（未挑戦） — バッジ・削減量・根拠・手順 + 「挑戦する」CTA（本 step で HTML 化）
- 実施中 — CTA が「やった」+ 実施日選択（既定は当日）に変わる（HTML は Step 25b）
- 記録成功 — 「やった」押下後、同画面内に CO2 フィードバックをインライン表示（「このアクションで ○○g CO2 を削減しました」＋本日の合計）。F-006 (C)（HTML は Step 25b）
- loading — 詳細データ取得中のスケルトン表示（HTML は Step 25b）
- error — 記録保存時の通信エラー。まず NFR-E-02 に従い最大 3 回（5 秒間隔）自動リトライし、それでも失敗した場合にエラーバナー（`color.error-bg` / `error-text` / `error-border`）+「再試行」を表示する。文面は技術用語を使わず次の操作を案内する（NFR-E-01）。オフライン時は NFR-A-05 に従いローカルに一時保存し、接続復旧後に自動同期する（HTML は Step 25b）

> メモ入力欄は設けない（完成済プロジェクトの人間ゲートで「表示する場所がないため不要」と決定済み）。

## 画面遷移
- ヘッダー「戻る」→ scr-06-action-list（アクション一覧）
- 「挑戦する」→ 実施中に追加し、アクション一覧へ戻る
- 「やった」（実施中状態）→ 同画面内で記録完了を表示（画面遷移なし）

<!-- ayatori:graphics-used:start -->
## 使用グラフィック

| graphic_id | 配置 | alt | 由来 |
|---|---|---|---|
| action-meat-free | 画面上部エリア (カテゴリ/難易度バッジの上) に、一覧で使う ACT-003 と同一画像を大きめに再掲する。一覧→詳細の親和性を出す目的 | action-meat-free | AI 生成 (POCTEAMA-179) — 21g 承認 2026-08-19T13:07:03+09:00 |
<!-- ayatori:graphics-used:end -->
