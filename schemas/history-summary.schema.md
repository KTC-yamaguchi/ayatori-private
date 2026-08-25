# history/{app_name}-summary.md & history/index.md — フォーマット規約

> ⑰ 振り返りエージェント (`skills/26-retro` Phase I → `skills/00-memory-write`) が出力するクロスプロジェクト履歴。
> 次回類似アプリのパイプライン実行で `00-memory-load` が参照する。

---

## ディレクトリ構造

```
artifacts/                                  # .gitignore 対象 (ローカル成果物)
└── history/                                # ⑰ Phase I が初回作成
    ├── README.md                           # schemas/templates/history/README.template.md からコピー
    ├── index.md                            # schemas/templates/history/index.template.md からコピーして以後追記
    └── {app_name}-summary.md               # ⑰ Phase I-2 が作成 (テンプレートは本ファイル後段)

schemas/                                    # git 管理 (テンプレート群)
└── templates/
    └── history/
        ├── README.template.md              # 編集禁止 / 規約入口
        └── index.template.md               # 編集禁止 / 初期ヘッダ
```

`artifacts/history/` 配下は `.gitignore` 対象でローカル成果物。⑰ Phase I が初回実行時に `schemas/templates/history/*.template.md` を `artifacts/history/` にコピー (テンプレート名から `.template` を除去) し、以後はそこに追記する。

---

## 1. `{app_name}-summary.md` 仕様

### ファイルパス

```
artifacts/history/{app_name}-summary.md
```

`{app_name}` は ハイフン・小文字・数字のみ (例: `ai-avatar-video`)。

### テンプレート

```markdown
# {app_name} — パイプライン実行サマリー

**完了日**: {YYYY-MM-DD}
**カテゴリ**: {dashboard / mobile-app / web-app / tool / ...}
**ターゲット**: {01-overview.md から抽出した1行サマリー}

## 確定事項

### 要件
- スコア: {scoring-history.attempts[-1].total}点 / 100点 ({len(scoring-history.attempts) - 1}ループ)
- 主要機能 (Must): {05-features.md から最大 3 件}

### デザイン
- 方向性: {design-brief.yaml.cases[selected_sample_id].concept または narrative.visual_theme}
- カラー: primary={tokens.color.primary.$value}, surface={tokens.color.surface.$value}
- フォント: display={tokens.font-family-display.$value}, base={tokens.font-family-base.$value}

## 次回類似アプリへの推奨事項

{今回特に効果的だった設計判断、または feedback-log.md の「人間判断が必要」エントリから 3 件以内}
```

### 必須フィールド

| フィールド | データソース |
|---|---|
| `完了日` | ⑰ 実行日 (今日)。 |
| `カテゴリ` | `requirements.json.design_output_scope` から推論 (mobile_only → mobile-app, web_only → web-app, mobile_and_web → mobile-app など)。`mobile_framework` も追記対象（native / flutter / kmp）。⑰ 判断。|
| `ターゲット` | `requirements/01-overview.md` の対象ユーザー記述。 |
| `要件スコア` | `scoring-history.json.attempts[-1].total` および `attempt_count = len(attempts) - 1`。 |
| `主要機能` | `requirements/05-features.md` から「Must」優先度のもの。 |
| `デザイン方向性 / カラー / フォント` | `design-brief.yaml`, `tokens.json`。 |
| `次回推奨事項` | `feedback-log.md` の `人間対応必要` タグ付きエントリ、または ⑰ Phase B のパターン分析結果。|

### NG

- 内部実装ファイルパスの羅列 (例: `skills/12-design-system/SKILL.md` を本文に書かない)
- スコア未達理由の詳細 (それは `pipeline-improvements.md` に書く)
- 個人名・組織名

---

## 2. `index.md` 仕様

### ファイルパス

```
artifacts/history/index.md
```

### 初期ヘッダ (初回作成時のみ書き込む)

```markdown
# AYATORI 実行履歴インデックス

> 全プロジェクトの完了サマリー一覧。1 行 = 1 プロジェクト。最新が末尾。
> 詳細は `{app_name}-summary.md` を参照。

| アプリ名 | カテゴリ | 完了日 | 要件スコア | デザインスコア |
|---|---|---|---|---|
```

### 行追記ルール

⑰ Phase I は **既存行を編集せず、テーブル末尾に 1 行追記する**。

```
| {app_name} | {カテゴリ} | {YYYY-MM-DD} | {scoring-history.attempts[-1].total}点 | {scores.current.total}点 |
```

| 列 | データソース | 備考 |
|---|---|---|
| `アプリ名` | `{app_name}-summary.md` のファイル名と一致 | リンク化推奨: `[ai-avatar-video](./ai-avatar-video-summary.md)` |
| `カテゴリ` | summary と同じ判定ロジック | |
| `完了日` | summary の完了日と一致 | |
| `要件スコア` | `scoring-history.json.attempts[-1].total` | 整数 + 「点」 |
| `デザインスコア` | `scores.json.current.total` | 整数 + 「点」。Phase 3 未到達時は `—` |

### 検索性

- 1 行 80 字以内 (long-form は summary 側へ)
- カテゴリは固定セットを揺らさない (新カテゴリ追加時は本仕様も更新)

---

## 3. ⑰ が読む際の前提

`skills/00-memory-load` は次回プロジェクトの ① 質問段階で：

1. `artifacts/history/index.md` を Read
2. 同カテゴリの過去プロジェクト行を抽出
3. その `{app_name}-summary.md` を Read
4. 「次回類似アプリへの推奨事項」をヒアリングの初期前提に組み込む

→ つまり **summary の「次回推奨事項」が次回品質の起点**。⑰ Phase I はここを最も丁寧に書く。

---

## 検証

```
artifacts/history/
├── README.md       ← 規約入口 (template からコピー)
├── index.md        ← 1 ヘッダ + N 行のテーブル
└── *-summary.md    ← N ファイル (index の行と件数一致)
```

整合性チェック (`scripts/verify-history.sh` などで自動化可能、本 PR では未実装):

- `index.md` のテーブル行数 == `*-summary.md` ファイル数
- 各行の `アプリ名` が対応する summary ファイル名と一致
- 各 summary が必須セクション (要件 / デザイン / 次回推奨事項) を含む
