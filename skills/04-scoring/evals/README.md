# Step 04 採点レポート renderer — CLI 契約 eval

`scripts/render-scoring-report.mjs` (scoring-history.json → scoring-dashboard.html / scoring-history.html / scoring.css) を黒箱 CLI として golden fixture で固定する。純関数の白箱検証は `scripts/render-scoring-report.test.mjs` 側。

## 実行

```bash
npm test                                                              # node --test の規約 discovery で自動実行
node --test skills/04-scoring/evals/render-scoring-report-evals.test.mjs   # 本 eval のみ
```

fixture は tmpdir へ複写してから実行するため、`npm test` が fixture / 作業ツリーを汚すことはない。

## golden の再生成 (renderer の出力仕様を意図的に変えたとき)

```bash
node skills/04-scoring/evals/render-scoring-report-evals.test.mjs --update
```

`npm run evals:regen-goldens` は WCAG eval 専用のため本 eval には効かない (誤って全 golden を上書きしない設計)。再生成後は diff を目視し、ブラウザで開いて視覚確認すること。

## fixture 一覧 (fixtures/<name>/{input.json, expected-dashboard.html, expected-history.html})

| fixture | 固定している挙動 |
|---|---|
| single-attempt-pass | 合格ケースの全 placeholder 置換・deficiency 重要度順・issue 80 字切り詰め・Projection (重複なし 4+2 件) |
| multi-attempt-3 | attempt カードの delta 表示 (上昇/下降)・improved セル・drift 行・不備件数推移 |
| four-attempts-overflow | attempts > 3 のときの列数上書き `<style>` 注入と第 4 スロット描画 |
| boundary-scores | 総合 80 かつ 1 軸 < 12 → 要改善バッジ (scale-fill は yes のまま) |
| missing-optional-fields | check_results / deficiencies / counts 欠落時に空グリッドで描画 (クラッシュしない) |
| mismatch-warning | 保存値と再計算の食い違い → stderr 検算警告 + 描画は保存値のまま |

scoring.css は golden を持たず「テンプレートと byte 一致」を検証する (テンプレートが唯一の視覚 SoT)。
