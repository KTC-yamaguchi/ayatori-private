---
name: 00-memory-write
description: retro フェーズ（Phase I）の終わりにユーザーメモリとプロジェクト履歴を書き出す共通スキル。skills/26-retro の Phase H 完了後に呼ばれ、次セッションの品質を左右する記録を残す。
---

# 00: Memory & History Write

## Role
Write user memory and project history at the end of the retro phase (Phase I).
Called from `skills/26-retro/SKILL.md` after Phase H completes.
Next session's quality depends entirely on what gets written here.

> **データ仕様参照（必読）**:
> 出力する `artifacts/history/{app_name}-summary.md` および `artifacts/history/index.md` のフィールド定義・必須項目は [`/schemas/history-summary.schema.md`](../../schemas/history-summary.schema.md) を正とする。本 skill の文面と乖離した場合は schema 側を優先。

## Execution

> **トレーニングデータの除外ガード（必須・最初に判定）**: `app_name` が `_train-` で始まる場合、本 skill は
> **何も書かずに即終了**する（history / user memory 両方）。トレーニングモードの成果物は
> 練習用であり、クロスプロジェクト履歴に混入すると以後の実案件が参照してしまうため。

### Step I-0: `artifacts/history/` の初期化（初回のみ）

`artifacts/history/` ディレクトリが存在しない、または `README.md` / `index.md` のいずれかが欠けている場合、以下を実施：

1. `artifacts/history/` ディレクトリを作成
2. `schemas/templates/history/README.template.md` を Read し、`artifacts/history/README.md` として Write
3. `schemas/templates/history/index.template.md` を Read し、`artifacts/history/index.md` として Write

これにより、Step I-2 / I-3 が安定した規約のもとで追記できる状態になる。

### Step I-1: Update `user/AYATORI_MEMORY.md`

Append cross-project learnings from this session to `user/AYATORI_MEMORY.md`.

**Write:**
- User preferences confirmed this session (font style, color tendencies, UI style, emoji policy, etc.)
- Environment settings (Confluence connected or not, Figma MCP state, available plugins)
- Recurring patterns (same correction came up multiple times, etc.)

**Do not write:**
- Project-specific requirements, scores, or feature lists → those belong in `session-context.md`
- Detailed technical constraints → those belong in `pipeline-improvements.md`

If `user/AYATORI_MEMORY.md` does not exist: create it.
If no new cross-project learnings emerged this session: write "（変更なし）" and skip.

### Step I-2: Create `artifacts/history/{app_name}-summary.md`

Step I-0 で `artifacts/history/` が初期化済みであることを前提とする。
以下の構造で `{app_name}-summary.md` を Write する（必須フィールドの詳細は [`/schemas/history-summary.schema.md`](../../schemas/history-summary.schema.md) §1 を参照）：

```markdown
# {app_name} — パイプライン実行サマリー

**完了日**: {today}
**カテゴリ**: {dashboard / mobile-app / web-app / tool など}
**ターゲット**: {01-overview.md から抽出したターゲットユーザー1行}

## 確定事項

### 要件
- スコア: {scoring-history.attempts[-1].total}点 / 100点（{len(scoring-history.attempts)}ループ）
- 主要機能（Must）: {05-features.md から3件以内で抽出}

### デザイン
- 方向性: {design-brief.yaml の selected_label + cases[selected_sample_id].concept 1行}
- カラー: primary={color.primary.$value}, surface={color.surface.$value}
- フォント: display={font-family-display.$value}, base={font-family-base.$value}

## 次回類似アプリへの推奨事項

{今回特に効果的だった設計判断・feedback-log.md の「人間判断が必要だった」エントリを3件以内で記録}
```

### Step I-3: Update `artifacts/history/index.md`

Step I-0 で `artifacts/history/index.md` が初期化済みであることを前提とする。
既存行は **編集せず**、テーブル末尾に **1 行のみ追記** する：

```
| {app_name} | {カテゴリ} | {today} | {scoring-history.attempts[-1].total}点 | {scores.current.total}点 |
```

`scores.json` が存在しない（Phase 3 未到達）場合、デザインスコアは `—` を入れる。詳細列定義は [`/schemas/history-summary.schema.md`](../../schemas/history-summary.schema.md) §2 を参照。
