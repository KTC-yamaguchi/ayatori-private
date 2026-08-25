---
name: 36-artifact-index
description: artifacts/{app_name}/ 配下の全成果物を 1 つの index.html（左カテゴリ目次 + 右コンテンツ）に集約する。要件 / 画面 / デザイン / 遷移図 / 採点 / 監査 を、ファイルを 1 つずつ探さずクリックで確認できるようにする。
---

# 36: 成果物インデックス生成

## 目的

`artifacts/{app_name}/` に散在する成果物（要件定義書・画面定義書・デザインサンプル・スタイルガイド・画面遷移図・採点ダッシュボード・監査ビュー等）を 1 つの `index.html` に束ねる。二重クリックで開くだけで、左の目次から各成果物をクリック確認できる。サーバ不要・外部ライブラリ不要。

## 入力

| 項目 | 内容 |
|---|---|
| `app_name` | 対象プロジェクト名（`artifacts/{app_name}/` ディレクトリ） |

## 出力

| ファイル | 内容 |
|---|---|
| `artifacts/{app_name}/index.html` | 全成果物を集約したインデックス（毎回フル上書き） |

## 手順

### 1. app_name の確定

1. `app_name` がユーザーから渡されていなければ、`artifacts/` 配下のプロジェクト一覧を **plain chat の番号付きリスト**（`1. {project}` 形式）で提示し、「選択方法: 番号またはプロジェクト名（完全一致）を 1 つ返信してください（例:「2」または「my-app」）」と明示して単一選択で 1 件選んでもらう（`AskUserQuestion` は使わない — プロジェクトが 5 件以上のとき選択肢上限 4 を超えるため）。自動推定はしない。
2. `artifacts/{app_name}/` ディレクトリが存在するか確認。

### 2. スクリプト実行

```bash
node scripts/build-artifact-index.mjs artifacts/{app_name}
```

- HTML 成果物は live sibling への iframe `src` で表示する（相対 CSS / CDN 挙動をそのまま保持）。
- Markdown はスクリプト内 renderer で整形して表示する。
- 成果物が部分的にしか無くても生成される（存在しないカテゴリは目次から除外。全て無ければ「成果物なし」の stub を出力）。
- 「実行履歴」カテゴリには、`pipeline-state.json` / `scores.json` / `delta/run-history.json` から合成した**実行サマリー**（承認タイムライン・選択デザイン・採点・デルタ変更履歴）と `feedback-log.md` を表示する（状態ファイルは読み取りのみ・書き込みなし）。`session-handoff.md` は実行状態 SoT でない disposable メモのため表示しない。

### 3. ブラウザで開く（auto-open + link-only fallback）

`skills/_shared/human-gate-preview.md` の opener 実装（`open` / `xdg-open` / `cmd.exe /c start` の順で試行、全滅なら link 一覧に degrade）を再利用し、生成した `artifacts/{app_name}/index.html` を 1 件だけブラウザで開く。open 系コマンド不在 / 失敗でもエラー停止しない。

### 4. 結果の報告

出力パスとサマリ（カテゴリ数・項目数）を提示する。

```
成果物インデックスを生成しました:
  - artifacts/{app_name}/index.html  (N カテゴリ / M 件)

確認方法:
  ブラウザで上記 index.html を開き、左の目次から各成果物をクリックしてください。
  右が空白の場合は各項目の ↗ で直接開けます。
```

### 5. ユーザー承認（gate）

「内容問題なければ完了とします。何か修正が必要であれば指示してください。」と確認を取る。

本スキルは状態ファイルへの**書き込みを行わない**（実行サマリー合成のため `pipeline-state.json` / `scores.json` / `delta/run-history.json` を**読み取りのみ**）。生成物 (`index.html`) の存在自体が完了の証跡となる。

## エラー処理

| 状況 | 対応 |
|---|---|
| `artifacts/{app_name}/` が存在しない（script exit 2） | プロジェクト名を再入力させる |
| 成果物ゼロ（0 categories） | 「まだ成果物が見つかりません（部分実行 / 生成前）」の stub index が生成される旨を伝える |
| script 実行が exit code != 0（上記以外） | エラー内容をそのままユーザーに表示 |

## 制約

- Node 標準ライブラリのみで動作する（外部 pip / npm 依存ゼロ、Operating Principle 1 適合）。
- **PDF 化はスコープ外**。ユーザーは出力 HTML をブラウザで印刷 → PDF 保存する運用とする。
- `index.html` は派生ビュー。手編集しない（再実行で丸ごと上書きされる）。

## 関連

- 生成スクリプト: `scripts/build-artifact-index.mjs`
- Phase オーケストレーター: `phases/index/SKILL.md`（コマンド `/ayatori-index`）
- ゲート自動更新: `skills/_shared/human-gate-preview.md`（各人間ゲートで index を自動再生成する）
