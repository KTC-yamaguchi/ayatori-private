---
name: 00-figma-mode-detect
description: 環境変数 FIGMA_MCP_ENABLED の判定を唯一のソースとして一元化する共通スキル。Bash 経由で確実に env var を読み、Figma MCP モードかスタブモードかの判定結果を audit trail として記録する。Steps 17 / 18 / 22 / 24 / 25 の冒頭から呼ばれる。
---

# 00: Figma MCP Mode Detect

## Role

`FIGMA_MCP_ENABLED` の判定を **唯一のソース** として一元化する。

Steps 17 / 18 / 22 / 24 / 25 は Figma MCP モードかスタブモードかで挙動が分岐する (Step 12 はコード生成のみで Figma を触らないため対象外)。これまで各スキルが個別に「環境変数 `FIGMA_MCP_ENABLED` を確認する」と書いていたが、**HOW (どう確認するか) が未定義** だったため、エージェントが Bash で env var を検査せず「unset と仮定 → false 判定」してしまうケースが発生した (実セッションで確認済)。

このスキルは **Bash 経由で確実に env var を読む + 判定結果を audit trail として記録** する明確な手順を提供する。env var 未設定時は明示的 warn メッセージを出してユーザーに設定方法を案内する (probe による auto-rescue は意図的に採用していない — 詳細は「なぜこの設計か」参照)。

## 呼び出し方

各 phase / step スキルの冒頭で以下を実行:

```
Read skills/00-figma-mode-detect/SKILL.md
→ 本スキルの「実行手順」を実行する
→ 返却された mode を使って Figma MCP 分岐を行う
```

## 実行手順

### Step 1: OS 環境変数を Bash で実機確認 (唯一の判定ソース)

Bash tool で env var を確認 — **必ず Bash を呼び出すこと** (絶対に「未設定だろう」と推測で判定しない):

```bash
echo "FIGMA_MCP_ENABLED=[$FIGMA_MCP_ENABLED]"
```

| 出力 | 結果 |
|---|---|
| `[true]` | `mode = "enabled"`、detection_method = `"env_var:true"` → Step 2 へ |
| `[false]` | `mode = "disabled"`、detection_method = `"env_var:false"` → Step 2 へ |
| `[]` (空) | `mode = "disabled"`、detection_method = `"env_var:unset"` + **下記の warn メッセージを必ず表示** → Step 2 へ |
| その他 (例: `[1]`, `[yes]`) | `mode = "disabled"`、detection_method = `"env_var:invalid_value"`、警告メッセージを表示 → Step 2 へ |

> **重要**: `[$FIGMA_MCP_ENABLED]` の `[]` ブラケットは空文字列と未定義を視覚的に区別するための慣用表記。出力内容そのものを評価する。エージェントの記憶や推測で判定してはならない。

#### env_var が未設定 (`[]`) の場合に必ず出す warn メッセージ

```
⚠ FIGMA_MCP_ENABLED が未設定のためスタブモードで継続します。
  Figma MCP モードで実行したい場合は以下のどちらかを実施してください:
    1. ~/.zshrc (または ~/.bashrc) に `export FIGMA_MCP_ENABLED=true` を追記
       → 新しい terminal で Claude Code を起動
    2. .claude/settings.local.json の env ブロックに
       "FIGMA_MCP_ENABLED": "true" を追加 → Claude Code を再起動
  詳細は docs/setup.md を参照してください。
```

(絵文字 `⚠` は user/AYATORI_MEMORY.md の絵文字ポリシーに従って文字のみ表示も可)

### Step 2: 判定結果の記録 (audit trail)

`artifacts/{app_name}/figma-state.json` を Read し、以下を merge:

```json
{
  "figma_mode_detect": {
    "mode": "enabled" | "disabled",
    "detection_method": "...",
    "detected_at": "ISO8601 timestamp",
    "session_note": "省略可。例: 'env var was unset → user warned'"
  }
}
```

`figma-state.json` がまだ存在しない場合 (Phase 3 で初めて Figma 操作を行うステップに到達する前) は記録をスキップしてよい。

### Step 3: 呼び出し元へ返却

呼び出し元スキルに以下を伝える (主にエージェント自身の記憶として):

```
mode: "enabled" | "disabled"
detection_method: "..."
```

呼び出し元はこの `mode` で Figma MCP 分岐 / スタブ分岐を選択する。

## 失敗モードと対応

| 失敗 | 対応 |
|---|---|
| Bash tool が permission denied | エラー出力 → `mode = "disabled"`、detection_method = `"bash_unavailable"`、ユーザーに permission 設定確認を依頼 |
| 既に Figma MCP 操作中に env var が set/unset されたケース | session 内では一貫性を優先し、最初の判定結果を使い続ける |

## ユーザー向けメッセージ例

判定結果に応じて以下を表示する (任意、デバッグしやすさのため推奨):

| 状況 | メッセージ |
|---|---|
| env_var:true | `Figma MCP モード ON (FIGMA_MCP_ENABLED=true)` |
| env_var:false | `スタブモード (FIGMA_MCP_ENABLED=false に明示設定)` |
| env_var:unset | `スタブモード (FIGMA_MCP_ENABLED 未設定 — 上記 warn 参照)` |
| env_var:invalid_value | `スタブモード (FIGMA_MCP_ENABLED の値が無効。'true' or 'false' を設定してください)` |

> 絵文字使用はユーザー設定に従う (`user/AYATORI_MEMORY.md` で抑制指示がある場合は上記の通り文字のみ。許可されている場合のみ絵文字を付加)。

## なぜこの設計か

| 設計判断 | 理由 |
|---|---|
| env var 単独判定 (probe なし) | (1) probe 用 `mcp__figma__whoami` は本プロジェクト未使用 = 新規依存導入のコスト・permission リスク。(2) 「env 未設定 + MCP 接続済み」というレアケースは `export FIGMA_MCP_ENABLED=true` 1 行で解決可能。(3) 単純で safe な判定が PR の本質的価値 (= Bash 実機確認の明文化) を引き立てる |
| Bash で必ず実機確認する (推測禁止) | 真の根本原因 = エージェントが env を読まずに「unset 仮定」で false 判定していたこと。本ルールでこれを撲滅 |
| 未設定時に明示的 warn を出す | probe による auto-rescue を諦めた代わりに、ユーザーが「設定すれば直る」ことに即気づける UX を確保 |
| audit trail を残す | 「なぜスタブモードに落ちたか」を後追いできる。Pattern B / C のフィードバックログに記録する代わりに figma-state.json で構造化保持 |
| 全 5 ステップ (17 / 18 / 22 / 24 / 25) で本スキルを共通呼び出し | DRY: 判定ロジックの分散を防ぎ、将来挙動を変える際も 1 箇所修正で済む |
