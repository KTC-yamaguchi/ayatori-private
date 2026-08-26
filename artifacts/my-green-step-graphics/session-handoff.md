---
app_name: my-green-step-graphics
phase_in_progress: "3-screens"
updated_at: "2026-08-19T09:40:00+09:00"
resume_step: "21e-graphic-generate"
resume_command: "/ayatori-screens"
---
# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.

## いまどこ

Step 23（最終承認ゲート）で「絵を写真素材風に作り直したい」との指示を受け、設計 §5 の手動リセット
（3 点セット）で Step 21c まで巻き戻した。テイストとプロンプトは再確定済みで、**次は 6 点の生成（Step 21e）から**。

## 確定済み（別セッションでそのまま使える）

- テイスト: 写実的（フォト）/ 案A 自然光ドキュメンタリー — `graphics/graphic-plan.json` の `taste`
  - 「オフホワイトに調和・背景は必ず明るく」はユーザー指示で削除。フリー写真素材のようなばらつきを許容
- プロンプト 6 点: `graphics/graphic-prompts.json`（confirmed_at 2026-08-19T09:19:07+09:00）
  - 全 slot に candid snapshot 句（綺麗になりすぎない・実在のシーン）を追記済み
  - 題材・構図・寸法は水彩版から逐語継承（21g 差し戻し 2 回で得た「被写体を手前に大きく・輪郭を明確に」を保持）
- 写真風サンプル 3 枚: `graphics/samples/` — 再課金なし
- 水彩版の退避: `_backup/taste-watercolour-20260818/`（canonical / raw / plan / prompts / samples）

## 次セッションでやること

1. `/ayatori-screens` を実行（resume cascade が Step 21e を自動検出する）
2. 6 点を生成（`graphics/raw/` の水彩版は digest 不一致のため再利用されず、**6 枚とも新規生成＝課金あり**）
3. 以降 21f（透過検証・正典化）→ 21g（埋め込み + 承認ゲート）→ Step 15（2nd Confluence save）→ Step 22 → Step 23

## 環境の前提（解決済み）

- 画像生成 API キー: 環境変数 `AYATORI_IMAGE_API_KEY` に設定済み・有効
- 社内プロキシの TLS 検査で Node の通信が落ちる問題は**恒久対応済み**
  （`~/.mac-ca-bundle.pem` + `~/.zshrc` の `NODE_EXTRA_CA_CERTS`）。新しいシェルで有効を確認済み

## 未処理の申し送り

- Step 15（2nd Confluence save）は Atlassian MCP 未認証のため前回 skip。認証すれば保存される
- Step 22（Figma 出力）はユーザー判断で skip 済みだったが、巻き戻しで記録をリセットしたため再度通る。
  Figma ファイル（file_key）が未記録なので、その場で出力先を聞かれる
