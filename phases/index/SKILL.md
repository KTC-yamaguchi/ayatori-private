---
name: ayatori-index
description: "成果物インデックス (独立コマンド)。artifacts/{app_name}/ の全成果物を 1 つの index.html (左目次+右コンテンツ) に集約する。各人間ゲートでも自動再生成。いつでも実行可。"
---

# Phase Index: /ayatori-index

`artifacts/{app_name}/` 配下の成果物を 1 つの `index.html` に束ねる独立コマンド。
必須ステップではなく、成果物をまとめて確認したい時に呼び出して使う運用。

## Preamble

1. Read `pipeline.yaml` to confirm Phase configuration. If `skip_phases` includes `"index"`: display "⏭ index フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.

## 実行手順

1. `skills/36-artifact-index/SKILL.md` を Read する。
2. その手順に従って実行する。

## 配置

- このコマンドは `pipeline.yaml` の `command_policy.allowed_commands` に `ayatori-index` として登録される（`phase_order` には含めない独立コマンド）。
- `artifacts/{app_name}/` が存在すればいつでも実行可能（部分実行のプロジェクトでも動く）。
- 各人間ゲート（Step 07 / 10 / 13 / 16 / 21 / 23 / 26）では index が自動再生成される（`skills/_shared/human-gate-preview.md`）。本コマンドはゲート外・任意時点の手動生成用。

## 関連

- 単一ステップスキル: `skills/36-artifact-index/SKILL.md`
- 生成スクリプト: `scripts/build-artifact-index.mjs`
