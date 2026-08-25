---
name: 35-md-to-html-export
description: 画面定義書 / 要件定義書の MD ファイル群を結合して、画像を base64 インライン埋め込みした自己完結 HTML を出力する。Confluence や外部サーバに依存しない配布物（社外パートナー共有・ドキュメント納品向け）を作る。
---

# 35: MD → HTML 配布物生成

## 目的

`artifacts/{app_name}/screens/*.md` および `artifacts/{app_name}/requirements/*.md` を、それぞれ 1 つの自己完結 HTML（`screens.html` / `requirements.html`）に結合する。画像はすべて base64 で HTML 内にインライン埋め込みされるため、`file://` で開いても画像が見える状態が保たれる。

## 入力

| 項目 | 内容 |
|---|---|
| `app_name` | 対象プロジェクト名（`artifacts/{app_name}/` ディレクトリ） |
| `target` | `screens` または `requirements` の二択 |
| `title`（任意） | カバーページのタイトル（未指定なら `{app_name} 画面定義書` 等を自動生成） |

## 出力

| ファイル | 内容 |
|---|---|
| `artifacts/{app_name}/screens.html` | 画面定義書 結合 HTML |
| `artifacts/{app_name}/requirements.html` | 要件定義書 結合 HTML |

## 手順

### 1. 入力の確認

1. `app_name` がユーザーから渡されていなければ、`artifacts/` 配下のプロジェクト一覧を提示して選択させる。
2. `target` がユーザーから渡されていなければ、`screens` / `requirements` / 両方 から選択させる（AskUserQuestion）。
3. `artifacts/{app_name}/{target}/` ディレクトリが存在するか確認。

### 2. スクリプト実行

```bash
cd <repo-root>
python skills/35-md-to-html-export/refs/build-md-export.py --app-name {app_name} --target {target}
```

`target=both` の場合は `screens` と `requirements` を順次実行する。

### 3. 結果の報告

ユーザーに以下を提示:

```
HTML を出力しました:
  - artifacts/{app_name}/screens.html  (XXX KB, 全 N 章)
  - artifacts/{app_name}/requirements.html  (XXX KB, 全 N 章)

確認方法:
  Chrome 等のブラウザで上記 HTML ファイルを開いてください。
  PDF が必要な場合は、ブラウザの「印刷」→「PDFとして保存」をお使いください。
```

### 4. ユーザー承認（gate）

「内容問題なければ完了とします。何か修正が必要であれば指示してください。」と確認を取る。

修正指示があれば対応する。**このスキルはステートレス設計**であり、`pipeline-state.json` 等の状態ファイルへの書き込みは行わない（責務最小化方針に従う）。生成物 (`screens.html` / `requirements.html`) の存在自体が完了の証跡となる。

## エラー処理

| 状況 | 対応 |
|---|---|
| `artifacts/{app_name}/` が存在しない | プロジェクト名を再入力させる |
| `{target}/` 配下に `.md` ファイルが無い | 「該当ディレクトリに Markdown ファイルが見つかりません」と報告して終了 |
| スクリプト実行が exit code != 0 | エラー内容をそのままユーザーに表示 |

## 制約

- **PDF 化はスコープ外**。Operating Principle 1（外部CLI依存禁止）に従い、Chrome headless 等の依存を一切持たない。ユーザーは出力された HTML を手元のブラウザで印刷 → PDF 保存する運用とする。
- スクリプトは Python 標準ライブラリのみで動作する（外部 pip 依存ゼロ）。

## 関連

- スクリプト: `skills/35-md-to-html-export/refs/build-md-export.py`
- マーカー仕様: `docs/markdown-screenshot-marker.md`
- Phase オーケストレーター: `phases/export/SKILL.md`（コマンド `/ayatori-export`）
