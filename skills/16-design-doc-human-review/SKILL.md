---
name: 16-design-doc-human-review
description: Step 14 で生成した画面一覧・遷移図を人間が確認・承認する。Phase 3 Step 16 の人間ゲートで、承認後に Step 15（Confluence 1 回目保存）→ Step 17（全画面 HTML 生成）へ進む。
---

# 16 人間レビュー（デザイン用ドキュメント）

## 役割
14 で生成した画面一覧・遷移図を人間が確認・承認する。承認後に 15（Confluence 1回目保存）→ 17（全画面HTML生成）へ進む。
**承認前に Confluence には何も保存されない**（AYATORI 原則「人間承認前の成果物は外部へ push しない」）。

## 実行指示

### Step 0: 成果物 preview の提示

人間ゲート提示の前に、`skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。本 step は遷移図 HTML が「主要 1 つ」のため、`pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets["16-design-doc-human-review"] = "screens/00-transition-map.html"` で auto-open。

組み立てる `artifacts_to_review`:

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}

# FIGMA_MCP_ENABLED=true 時のみ figjam_url を追加
figjam_url = figma-state.json.nodes.transition_map.url (存在しなければ omit)

artifacts_to_review = [
  { kind: "md",   abs_path: "{artifacts_root_abs}/screens/00-screen-list.md",       label: "画面一覧" },
  { kind: "md",   abs_path: "{artifacts_root_abs}/screens/00-transition-map.mmd",   label: "遷移図 SSoT (純 Mermaid)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/00-transition-map.html",  label: "遷移図 HTML (派生、ブラウザ表示用)" },
  { kind: "external_url", abs_path: figjam_url, label: "遷移図 FigJam (編集可)" } if figjam_url,
]
```

shared helper 経由で:
- `screens/00-transition-map.html` がブラウザで自動起動
- 画面一覧 MD / 遷移図 SSoT MD / FigJam URL は clickable link で提示

完了後に Step 1 へ進む。

### Step 1: 承認ゲート

以下を表示してユーザーの選択を待つ (遷移図 SSoT は `.mmd`。`.html` / FigJam は派生のため `.mmd` を読めば内容は同一):

```
【デザイン用ドキュメント 承認ゲート 16】

画面一覧と遷移図が生成されました（ローカル artifacts のみ。Confluence 保存は承認後）。
ファイル群は上記 preview から確認できます (遷移図 HTML は自動でブラウザを開きました)。

> SSoT は `.mmd` に切り出し済。`.html` と FigJam は両方 `.mmd` から派生する read-only な配信物です。FigJam 上での編集は議論用で、確定したら `00-transition-map.mmd` を修正してから 14 を再実行してください（FigJam → `.mmd` 回写は提供していません）。

構成（画面数・遷移）をご確認ください：

【共通部品（chrome）の割り当て】
- ボトムメニュー（タブバー・1 種）の定義: 「## 共通部品定義（chrome）」節のタブ項目（ラベル / アイコン / 順序 / 遷移先）
- 各画面の割り当て: `ヘッダー`（なし / A=HOME系 / B=下層・戻る付き）/ `ボトムメニュー`（有 / 無）/ `現在タブ`
  → タブ構成・ヘッダー種別・ボトムメニュー有無に違和感があれば「修正」で Step 14 に差し戻して調整できます（ログイン・全画面モーダル等は「なし」を選べます）

✅「承認」または「OK」→ 15 で Confluence に保存してから 17 で全画面 HTML 生成へ進みます
✏️「修正: {修正内容}」→ 14 に戻って一覧/遷移/共通部品割り当てを修正します
❌「デザインシステムからやり直す」→ 13（スタイルガイド承認）に戻ります
```

> ⚠️ **Route A (screens-lite) から呼ばれた場合、呼び出し元 orchestrator が本表示文の遷移先を差し替える**: 15 / 17 へは進まず、`_shared` 正典生成 → ベースライン承認ゲートへ回る（差し替えの内容は下記「承認後の処理」の注記を参照）。呼び出し元の指示に従い、**承認肢の説明に 15 / 17 を書かないこと** — そのまま表示すると人間に実行されない遷移を予告することになる。

AskUserQuestion で選択を受け取る。

## 承認後の処理

**承認の場合:**
- `artifacts/{app_name}/pipeline-state.json` の `approvals.step16_approved_at` に ISO 8601 datetime を記録する (Read or {} → merge → Write back)。`requirements.json` には書かない (INPUT 専用)。
→ `skills/15-confluence-save-design/SKILL.md` を Read して 15（1回目 Confluence 保存）を実行
→ その後 `skills/17-screen-gen/SKILL.md` を Read して 17 を実行

> **screens-lite (Route A) では本遷移が上書きされる**: 呼び出し元 orchestrator (`phases/screens/SKILL.md` § Execution — screens-lite の lite-2) が 15 / 17 へは進ませず、`_shared` 正典生成 (lite-3) → ベースライン承認ゲート (lite-4) へ回す。**Step 1 のゲート表示文にある承認肢の遷移先も同じく差し替え対象**（15 / 17 をそのまま表示すると人間への虚偽予告になる）。本 skill を単独 Read で実行する場合は**呼び出し元の route を確認すること**（確認せずに 15 を実行すると Confluence へ意図せず push される）。

**修正の場合:**
- 修正指示を `artifacts/{app_name}/feedback-log.md` に追記（パターンA: 人間ゲート）
- **`skills/00-feedback-protocol/SKILL.md` を Read** して 4 ステップ（影響範囲洗い出し → 1スクリプト一括修正 → grep/diff 検証 → 検証レポート）を遵守する。
  - 画面一覧（00-screen-list.md）と遷移図 SSoT（00-transition-map.mmd）は内容が連動するため、両方の整合性を grep で確認すること（画面名・遷移先 ID の一致）。`.html` は `.mmd` + テンプレートからの機械生成派生物なので grep 対象は `.mmd` 側で OK。
  - **共通部品（chrome）への修正の場合**: タブ項目・アイコン・ラベル・各画面のヘッダー A/B 割り当て等の指摘は、`00-screen-list.md`「## 共通部品定義（chrome）」節（Step 14 / Step 2b が確定する chrome プラン）を更新する。本ゲートは初回 HTML 生成の**前**なので、プランを直せば Step 17 が Step 0b でその定義から正典を生成する（生成後の chrome 修正フローは Step 21 / `docs/html-generation-rules.md` §11.6 を参照）。
- → `skills/14-screen-list-transition/SKILL.md` を Read して再生成し、16 → 15 → 17 の流れに戻る

**やり直しの場合（13 へ戻る）:**
- `artifacts/{app_name}/screens/00-*` を削除
- → `skills/13-human-gate-design/SKILL.md` を Read して 13 から再開
