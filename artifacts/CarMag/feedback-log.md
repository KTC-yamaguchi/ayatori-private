# Feedback Log — CarMag

## 概要

このログは Phase 1a (Question) 以降に発生した修正指示・エラー・設計課題を記録します。

## ログ

- **[Phase 3] Pattern C — 運用判断によるステップ省略**: Step 15（Confluence 保存）・Step 18（3層デザインレビュー）・Step 19（ルーブリック採点）・Step 20（ループ制御）をユーザー指示によりスキップ → ユーザーが「Confluence 保存は不要」「Step 18/19/20 も飛ばす」と明示指示 → HTML はユーザー承認（Step 21）のみで確定。以後の Phase（Figma 出力・最終承認等）はスコア履歴 (`scores.json`) が存在しない前提で進行する点に注意。
- **[Step 22] Pattern B — subagent への Figma MCP ツール未付与**: `figma-capture-runner` subagent を起動したが `mcp__figma__generate_figma_design` / `use_figma` が渡されておらず 0/4 capture で failed → subagent 定義側のツール許可設定が本セッション環境と一致していなかったのが原因 → メインセッション側で直接 `generate_figma_design` を呼び出し、4 画面を手動並列キャプチャして復旧（`screens/web/*.html` + `screens/web-sm/*.html` を Figma ページ "AYATORI Pipeline" へキャプチャ成功、node id 1650:2〜1653:2）。
- **[Phase 3] Pattern C — Step 24/25 を明示的にスキップ**: ユーザーが Figma Variables 3コレクション作成・コンポーネントビルドを「スキップして Phase 3 をここで完了とする」と判断 → HTML 生成 + Figma キャプチャのみで Phase 3 完了扱いとし、Step 24/25 は未実行のまま Phase 4（retro）へ進める。

- **[21c] Pattern A — 人間ゲートで design-brief 方針と衝突する方向指示**: テイスト再選定で user が「洗練ではなくポップ、アニメ調」を指示 → design-brief.yaml の `anti_styles: "手作り感が強い、カラフルで過度に装飾的"` と正面衝突 → user 指示を (A) CONFIRMED として優先し、案 C のみ試作として アニメ調ポップ で再生成。特定キャラクター (初音ミク) の模倣は固定 tail `no real brand likeness` により不可のため、一般的なアニメ調画風として再解釈した。**パイプライン設計の欠落**: guide §1 は「avoid_styles と衝突する語を AI が提案しない」規定のみで、user 自身が衝突方向を指示した場合の扱い (矛盾の記録先・design-brief への差し戻し判断) が未定義。
