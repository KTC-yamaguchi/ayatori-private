# scr-06-action-list 画面仕様

## 目的
実施中のアクションと、自分に合ったおすすめアクションを一覧で確認し、次に挑戦するアクションを選ぶ。アクションタブの着地画面（F-004 / F-005）。

## レイアウト構成
- ナビゲーション: BottomTab（3 タブ。現在タブ = actions）
- ヘッダー: A（HOME 系・戻るなし）、タイトル「アクション」
- メインコンテンツ: 「実施中のアクション」セクション（件数付き）／「あなたにおすすめ」セクション（件数付き）。各カードは左端に 120px のグラフィック列を持つ
- CTA: 実施中カードの「やった」ボタン（記録 = F-005）／おすすめカードのタップで詳細へ
- フッター: BottomTab

## コンポーネント一覧
| コンポーネント | 分類 | トークン参照 | WCAG要件 |
|---|---|---|---|
| 「やった」ボタン (`card-cta`) | 主要ボタン | color.primary / color.on-primary / sp-touch(44px) / radius-pill | 2.5.8: 44px以上 ✅ |
| おすすめカード (`suggest-card`) | 主要ボタン相当（行タップ） | color.surface / color.border-default / shadow-xs | 2.5.8: 高さ 44px 以上（カード最小高 104px） ✅ |
| アクション名 | — | fs-base / fw-semibold / color.on-surface | 1.4.3: 4.5:1以上 ✅ |
| CO2 削減量 | — | font-numeric / tabular-nums / color.success / fs-sm | 1.4.3: 4.5:1 ✅（#2E7D32 on #FFFFFF） |
| カテゴリバッジ | — | color.secondary-active-bg / color.primary / fs-sm | 1.4.3: 4.5:1以上 ✅ |
| 難易度バッジ（簡単 / 普通） | — | color.success-bg + color.success-text / color.warning-bg + color.warning-text | 1.4.1: 色のみに依存せずラベル文字を併記 ✅ |
| セクション件数 | デエンファシス | color.on-surface-secondary / fs-xs(12px) | 最小フォントサイズ 12px ✅ |
| BottomTab（共通部品） | — | color.primary（現在タブ）/ color.on-surface-secondary | 2.5.8: 44px以上 ✅ / 4.1.2: aria-current="page" ✅ |

> 構造統一: 実施中カード（`doing-card`）とおすすめカード（`suggest-card`）はクラスを分離し、各クラス内では全インスタンスが同一構造（グラフィック列 → 本文 → 末尾要素）。
> グラフィック列: カード左端の幅 120px・カード上下端まで届く列（`.card-icon`）。AI 生成グラフィック（600×400）を `object-fit: cover` で表示する。被写体が左寄りの 2 枚（`action-energy` / `action-walk`）は `object-position: 0% 50%` で crop 基準を左端に寄せ、枠内で中央に見えるよう調整している（実測重心 38.8% / 34.0%）。

## 掲載データの出典
`requirements/05-features.md` §5.2 アクションマスタデータ（MVP初期データ）から引用。値の自前補完はしていない。

| 表示位置 | アクションID | アクション名 | カテゴリ | CO2削減量 | 難易度 |
|---|---|---|---|---|---|
| 実施中 | ACT-004 | エアコンフィルター月2回清掃 | 住まい | 0.6 kg/週 | 1（簡単） |
| 実施中 | ACT-005 | 宅配便の置き配指定 | 買い物 | 0.2 kg/週 | 1（簡単） |
| おすすめ | ACT-001 | 再エネ電力プランへの切替 | エネルギー | 36.5 kg/週 | 1（簡単） |
| おすすめ | ACT-003 | 週1回の牛肉→鶏肉/豚肉 | 食事 | 2.0 kg/週 | 1（簡単） |
| おすすめ | ACT-006 | 2km以内の移動を徒歩/自転車に | 移動 | 1.8 kg/週 | 2（普通） |

## 状態パターン (仕様書に記述する — HTML 生成は Step 25b)
- default — 実施中 2 件 + おすすめ 3 件の通常表示（本 step で HTML 化）
- empty — 実施中が 0 件の場合。実施中セクションを出さず、おすすめセクションのみ表示する（`00-coverage-check.json` に記録済み。HTML は Step 25b）
- loading — 提案リスト取得中。カード形状のスケルトンを 3 件表示する（HTML は Step 25b）
- error — 提案リスト取得失敗。まず NFR-E-02 に従い最大 3 回（5 秒間隔）自動リトライし、それでも失敗した場合にエラーバナー（`color.error-bg` / `error-text` / `error-border`）+「再試行」ボタンを表示する。文面は技術用語を使わず次の操作を案内する（NFR-E-01）（HTML は Step 25b）
- 記録成功 — 「やった」押下後、当該カードに記録済みの表示 + 即時フィードバック（「-○○g CO2」）を出す（F-006 (C)。HTML は Step 25b）

## 画面遷移
- おすすめカードタップ → scr-07-action-detail（アクション詳細）
- 実施中カードタップ → scr-07-action-detail（アクション詳細・実施中状態）
- 「やった」→ 同画面内で記録完了を表示（画面遷移なし。F-005）
- BottomTab: ダッシュボード / 設定 → 本試行ではスコープ外（非活性表示）

<!-- ayatori:graphics-used:start -->
## 使用グラフィック

| graphic_id | 配置 | alt | 由来 |
|---|---|---|---|
| action-energy | おすすめカード ACT-001「再エネ電力プランへの切替」の 44px アイコン枠 (.card-icon)。淡いティール面に載るため透過が必要 | action-energy | AI 生成 (POCTEAMA-179) — 21g 承認 2026-08-19T13:07:03+09:00 |
| action-meat-free | おすすめカード ACT-003「週1回の牛肉→鶏肉/豚肉」の 44px アイコン枠 (.card-icon)。淡いティール面に載るため透過が必要 | action-meat-free | AI 生成 (POCTEAMA-179) — 21g 承認 2026-08-19T13:07:03+09:00 |
| action-walk | おすすめカード ACT-006「2km以内の移動を徒歩/自転車に」の 44px アイコン枠 (.card-icon)。淡いティール面に載るため透過が必要 | action-walk | AI 生成 (POCTEAMA-179) — 21g 承認 2026-08-19T13:07:03+09:00 |
| action-aircon-filter | 実施中カード ACT-004「エアコンフィルター月2回清掃」の 44px アイコン枠 (.card-icon)。淡いティール面に載るため透過が必要 | action-aircon-filter | AI 生成 (POCTEAMA-179) — 21g 承認 2026-08-19T13:07:03+09:00 |
| action-delivery | 実施中カード ACT-005「宅配便の置き配指定」の 44px アイコン枠 (.card-icon)。淡いティール面に載るため透過が必要 | action-delivery | AI 生成 (POCTEAMA-179) — 21g 承認 2026-08-19T13:07:03+09:00 |
<!-- ayatori:graphics-used:end -->
