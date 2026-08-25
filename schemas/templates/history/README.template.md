# artifacts/history/ — クロスプロジェクト履歴

⑰ 振り返りエージェント (`skills/26-retro` Phase I) が出力するクロスプロジェクト履歴の置き場所。

## ファイル構成

```
artifacts/history/
├── README.md              ← 本ファイル (規約入口・編集禁止)
├── index.md               ← 全プロジェクト一覧 (⑰ Phase I-3 が追記)
└── {app_name}-summary.md  ← プロジェクト 1 件分の確定事項 (⑰ Phase I-2 が作成)
```

## 仕様

詳細フォーマット・必須フィールドは [`/schemas/history-summary.schema.md`](../../schemas/history-summary.schema.md) を参照。

## 運用ルール

- `index.md` および `*-summary.md` は **⑰ 振り返りエージェントのみが書き込む**。手動編集禁止。
- 既存行を編集せず追記のみ (履歴の同一性を保つ)。
- `artifacts/` 全体は `.gitignore` 対象 (ローカル成果物)。本ディレクトリも同様。共有が必要な場合は `pipeline-improvements.md` 経由で別途共有。

## 参照

- `docs/data-architecture/retro-data-pipeline.md` — ⑰ データパイプライン全体仕様
- `skills/26-retro/SKILL.md` — ⑰ 振り返り skill
- `skills/00-memory-write/SKILL.md` — Phase I 出力処理
- `skills/00-memory-load/SKILL.md` — 次回プロジェクトでの読込処理
