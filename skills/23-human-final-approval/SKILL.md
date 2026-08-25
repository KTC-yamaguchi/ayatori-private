---
name: 23-human-final-approval
description: Phase 3 の Step 23。Step 22 の Figma キャプチャ後、Figma 上の見た目とスコアシートを人間が最終確認する関門。ここを通れば Step 24 デザインシステム更新・Step 25 コンポーネント紐付けへ進む。
---

# 23 人間最終承認（人間採点含む）

## 役割
Figma キャプチャ（22完了）後、Figma 上の見た目とスコアシートを人間が最終確認する。ここが通れば Figma 上のデザインシステム更新（24）・コンポーネント紐付け（25）に進む最終関門。

## 実行指示

### Step 0: 成果物 preview の提示

人間ゲート提示の前に、`skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。本 step は Figma 上での確認が主のため、auto-open はせず Figma URL を clickable link として提示する (`pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets["23-human-final-approval"] = null`)。

組み立てる `artifacts_to_review`:

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}
figma_url = "https://www.figma.com/design/" + figma-state.json.file_key + "/?node-id=" + figma-state.json.page_id   # canonical 形式 (旧 /file/ は /design/ にリダイレクトされるが、Step 26 / schemas/figma-state.schema.json:21 と表記揃え)

artifacts_to_review = [
  { kind: "external_url", abs_path: figma_url, label: "Figma 最終確認 (全画面キャプチャ)" },
]
```

> 補足: 画面 HTML 個別 link は Step 21 で既に提示済みなので 23 では Figma URL のみに絞る (重複提示を避ける)。スコア詳細はチャットメッセージで提示する (下記 Step 1)。

### Step 1: 承認ゲート

`artifacts/{app_name}/scores.json` と `figma-state.json`、Figma ページ URL を確認した上で、以下を表示してユーザーの選択を待つ:

```
【最終承認ゲート 23】

Figma に全画面がキャプチャされました (上記 preview の Figma URL を ⌘+click)。

- 最終スコア: {total} / 100
- AI改善可能な指摘: {ai_improvable_deductions} 件（残っている場合は人間採点で可否を判断してください）

Figma 上で以下を確認してください：
1. 全画面が想定通りにキャプチャされている
2. 画面遷移・階層構成に問題がない
3. HTMLプレビューとの差分が許容範囲内

✅「承認」→ 24（デザインシステム更新）・25（コンポーネント紐付け）へ進みます
✏️「修正: {修正内容}」→ 17（画面HTML生成）に戻って修正します
❌「却下」→ パイプラインを中断します（feedback-log.md に記録）
```

AskUserQuestion で選択を受け取る。

## 承認後の処理

**承認の場合:**
- `artifacts/{app_name}/pipeline-state.json` の `approvals.final_approved = true` (canonical 承認フラグ) **および** `approvals.step23_approved_at = <現在 ISO 8601 時刻>` (auxiliary timestamp、step07/13/16 と命名整合) を記録 (Read or {} → merge → Write back)。`requirements.json` には書かない (INPUT 専用)。schema: `schemas/pipeline-state.schema.json` の `approvals` 参照。
- → `skills/24-design-system-update/SKILL.md` を Read して 24 を実行

**修正の場合:**
- 修正指示を `artifacts/{app_name}/feedback-log.md` に追記（パターンA: 人間ゲート）
- **`skills/00-feedback-protocol/SKILL.md` を Read** して 4 ステップ（影響範囲洗い出し → 1スクリプト一括修正 → grep/diff 検証 → 検証レポート）を遵守する。
  - **Step 1 必須**: `grep -rln "{対象クラス|hex|文言}" artifacts/{app_name}/screens/` で全 HTML variant を列挙、加えて `figma-state.json` で対応する Figma nodeId も列挙してユーザーへ提示
  - **Step 2 必須**: HTML 側は 1 スクリプトで CSS / HTML をセット更新。Figma 側は 22 再実行で同期
  - **Step 3 必須**: HTML の grep 検証 → 22 再キャプチャ後に Figma 側も目視確認
- → 検証通過後に `skills/17-screen-gen/SKILL.md` を Read して該当画面を修正 → 18 → 19 → 20 → 21 → 22 → 23 を再実行

**却下の場合:**
- 却下理由を `artifacts/{app_name}/feedback-log.md` に追記（パターンC: パイプライン設計の欠陥を含む場合も記録）
- パイプラインを中断し、26（振り返りエージェント）に「却下による中断」として記録
