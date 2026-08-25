---
name: ayatori-export
description: "配布物生成 (独立コマンド・任意)。screens/*.md (+requirements/*.md) を画像 base64 埋め込みの自己完結 HTML に結合する。PDF 生成はスコープ外 (ブラウザの印刷→PDF 保存を使う)。最終承認後いつでも実行可。"
---

# Phase Export: /ayatori-export

`/ayatori-screens` の Phase 3 最終承認（Step 23）後に、配布用 HTML を生成する独立コマンド。
必須ステップではなく、必要な時に呼び出して使う運用。

## Preamble

1. Read `pipeline.yaml` to confirm Phase configuration. If `skip_phases` includes `"export"`: display "⏭ export フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.

## 実行手順

1. `skills/35-md-to-html-export/SKILL.md` を Read する。
2. その手順に従って実行する。

## 配置

- このコマンドは `pipeline.yaml` の `phase_order` の最後に `export` として登録される。
- Phase 5 (`/ayatori-delta`) との実行順序関係は無い（独立）。
- いつでも実行可能。`final_approved == true` の前後どちらでも動く（ただし `screens/*.md` の存在は前提）。

## 関連

- 単一ステップスキル: `skills/35-md-to-html-export/SKILL.md`
- 生成スクリプト: `skills/35-md-to-html-export/refs/build-md-export.py`
- マーカー仕様: `docs/markdown-screenshot-marker.md`
