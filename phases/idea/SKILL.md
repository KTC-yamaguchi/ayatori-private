---
name: ayatori-idea
description: "アイデアブラッシュアップ (独立コマンド・明示起動のみ)。発散→収束→具体化→CxO ミニ批評→固まり度スコアの育成ループ (最大 3 周) で idea-brief.md を生成し、同一会話でそのまま /ayatori-question の 7 軸へ合流する。"
---

# /ayatori-idea — アイデアブラッシュアップモード

アイデアが固まっていない状態で 7 軸ヒアリングに進むと要件定義の質が下がる、という課題への
前段フェーズ。ふわふわのアイデアを対話ループで構造化し、`idea-brief.md` を生成して
本流 (`/ayatori-question`) へ **同一会話でそのまま** 合流する。本流に自動で載らない独立コマンド。

## 実行手順

1. `pipeline.yaml` を Read し `skip_phases` を確認。`idea_brushup` が含まれれば
   「⏭ idea_brushup をスキップします」と表示して終了。
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に許容コマンド以外の
     外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または
     `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、
     `command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. 含まれなければ `skills/00-memory-load/SKILL.md` を Read して指示に従う (ユーザー memory ロード)。
3. `skills/01a-idea-brushup/SKILL.md` を Read し、その手順 (Step 0〜6 対話ループ) に従って実行する。
4. 01a の Step 6 で「7 軸へ進む」が選ばれた場合、同一会話でそのまま 7 軸ヒアリングへ合流する
   (合流手順は `skills/01a-idea-brushup/SKILL.md` § ハンドオフ処理 4)。「ここで終了」なら
   brief 保存済みのまま終了する (再開: 新しい会話で `/ayatori-question` が idea-brief.md を自動検出)。

## 配置

- `pipeline.yaml` `command_policy.allowed_commands` に `ayatori-idea` として登録済み (正規コマンド。
  lint-repo-refs の command-policy 整合のため本タスクで登録)。
- `pipeline.yaml` `phase_order` には載せない (cm_consult と同型の代替エントリー)。
- いつでも明示起動可能。既存メモ (idea-explorer の SpecifyOutput / 企画書等) があると
  収束フェーズから開始できる。

## 関連

- 実装本体: `skills/01a-idea-brushup/SKILL.md`
- 知識・ひな型: `skills/01a-idea-brushup/refs/`
  (scatter-questions / converge-specify / cxo-panel / maturity-check / idea-brief-template)
- ハンドオフ先: `/ayatori-question` (Phase 1a。同一会話で 7 軸へ合流 — ブリーフ先読みモードは
  `skills/01-question/SKILL.md` § Brief Pre-read Mode)
- 設計書: Confluence 4013883944 (AYATORI アイデアブラッシュアップモード スキル設計)
- 注記: 完走済プロジェクトへの機能追加は Phase 1d `/ayatori-add-feature` の担当。
  本コマンドは **新規プロジェクトの前段** 専用 (requirements.json を持つ既存プロジェクト名では
  app_name を確定できない — skill 本体 Step 3 のエントリーガード参照)。
