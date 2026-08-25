# 00-raw-input.md / requirements.json 変換規則

> Step 4 で打ち手の実装要求案を 2 ファイルへ変換する規則。
> `requirements.json` は `additionalProperties: false` の厳密スキーマのため 7 軸を直接書くと schema 違反になる。
> **7 軸データは `requirements/00-raw-input.md`（markdown）に書き、`requirements.json` には schema 準拠フィールドのみ書く。**
>
> 出力先 ①: `artifacts/charge_minder_{slug}/requirements/00-raw-input.md`
> 出力先 ②: `artifacts/charge_minder_{slug}/requirements.json`

## ① 00-raw-input.md に書く 7 軸

| フィールド | 埋め方 |
|---|---|
| app_name / display_name | charge_minder_{slug} + 打ち手の名称 |
| description | 打ち手の概要 |
| category | "behavior-change / EV charging" |
| target_user {description, scene} | ChargeMinder ペルソナ(EVオーナー・実証参加者) + 介入が効く場面 |
| problem {current_workaround, frustration} | 打ち手が解く行動変容上の課題(Step1ヒアリング由来) |
| features {must[], should[], could[]} | 介入機能を ChargeMinder レバーへマップ + §8.1 計装要求を含める |
| competitors {main, differentiation} | N/A もしくは ChargeMinder 現状ベースライン |
| constraints {tech_stack, reference_codebase, design_language, ...} | Swift/SwiftUI + FastAPI、ChargeMinder ソース参照、既存デザイン言語 |
| platform {primary, notes} | iOS モバイル |
| design_output_scope | 既定(mobile_only / native 等。ヒアリングで調整可) |
| recommendations_accepted | 任意(提案で採用した補助案) |

## ② requirements.json に書く schema 準拠フィールドのみ

| フィールド | 埋め方 |
|---|---|
| app_name | charge_minder_{slug} |
| created_at | 実行日 YYYY-MM-DD |
| design_output_scope | ① で決めた値を enum 準拠で記述 |
| recommendations_accepted | ① と同じ値を配列で記述 |
| confluence_parent_id | null (後続フェーズで設定) |

## 必須
- `requirements.json` に `status` / `readiness` / `category` / `features` / `target_user` / `problem` / `competitors` / `constraints` / `platform` 等の非 schema フィールドを書かない（schema 違反）
- `status` enum は "REVERSE_ENGINEERED" のみ有効。本コマンドは greenfield 相当のため付けない
- `readiness` は付けない(採点は /ayatori-requirements に委譲)
- 7 軸の詳細情報はすべて `requirements/00-raw-input.md` に記述する
