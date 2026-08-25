---
name: ayatori-cm-consult
description: "ChargeMinder 専属コンサル (独立コマンド・明示起動のみ)。行動変容ゴールからナッジ理論ベースの打ち手と KPI 検証設計 (測定可能性チェック込み) を提案し、requirements.json 種を生成して /ayatori-requirements へ合流する。"
---

# /ayatori-cm-consult — ChargeMinder Consultant

ChargeMinder で打てる行動変容の打ち手を、ナッジ理論を当てて提案する専属コンサル。
本流に自動で載らない独立コマンド。明示起動時のみ実行し、requirements.json 種を出して
本流へ合流する。

## 実行手順
1. `pipeline.yaml` を Read し `skip_phases` を確認。`cm_consult` が含まれればスキップして終了。
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. 含まれなければ `skills/cm-consult/SKILL.md` を Read。
3. その手順(5 ステップ対話)に従って実行する。

## 配置
- `pipeline.yaml` `command_policy.allowed_commands` に `ayatori-cm-consult` として登録(正規コマンド)。
- `pipeline.yaml` `phase_order` には載せない(reverse と同型の代替エントリー)。
- いつでも明示起動可能。ChargeMinder の reverse 成果物(raw-analysis.md)があると精度が上がる。

## 関連
- 実装本体: `skills/cm-consult/SKILL.md`
- 知識・ひな型: `skills/cm-consult/refs/`(levers / nudge-toolkit / proposal / validation / seed-mapping)
- ハンドオフ先: `/ayatori-requirements`(Phase 1b)
- 注記: 既存アプリ拡張としては Phase 1d `/ayatori-add-feature`(change-manifest.json)経路もあり得るが、
  本コマンドは requirements.json 種に一本化する。
