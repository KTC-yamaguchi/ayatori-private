# skill 08 (08-design-brainstorm) eval harness

skill 08 の色数値の決定論性を守る eval。背景: OKLCH→HEX 変換と WCAG 補正量の
算出は **LLM が暗算** していたため、13 プロジェクト中 5 つで design-brief.yaml の記録 oklch と
記録 hex が大幅不整合 (StudyLoop primary: hex `#3B5BDB` vs oklch 再変換 `#0063B7`、チャネル差 59)、
補正案の §5 予算超過 (OhiruMeshi: L +0.16 > 上限 ±0.15)、閾値ぎわの暗算ミスによるループ 1 周浪費
(ShinMemo: 2.99 vs 3.0) が発生していた。数値計算は `scripts/oklch-color.mjs` に決定論化済
(単体テスト `scripts/oklch-color.test.mjs`)。本 eval はその上に CLI 契約レベルの回帰検出を足す。

構造は `skills/11-wcag-mapping/evals/` (wcag-contrast 用) と同型。**姉妹 script の関係**:
`wcag-contrast.mjs` (コントラスト計算、evals は skill 11 側) が「検証」を、
`oklch-color.mjs` (変換 + 補正 solver + 整合 lint、evals は本ディレクトリ) が「生成と修正」を担う。
oklch-color は wcag-contrast から `contrastRatio` を import しており、丸め挙動は常に一致する。

## 何をどこで検証するか

| 検証対象 | 何を固定するか | 実行 | 場所 |
|---|---|---|---|
| script 内部関数 | `hexToOklch` (外部参考値突合 = 行列転記ミス検出) / 往復変換 / `solvePair` 各経路 / `collectPaletteEntries` / `lintBrief` を白箱検証 | `npm test` | `scripts/oklch-color.test.mjs` |
| **script の CLI 契約** | `oklch-color.mjs` を黒箱 CLI として固定 — subcommand dispatch / フラグ / stdin / **exit code 契約 (0=成功・PASS / 1=lint drift / 2=usage・parse エラー)** / stdout 全体の shape | `npm test` | `fixtures/` + `oklch-script-evals.test.mjs` |

skill (LLM) 側の整形ロジック (solve summary の逐語転写・lint 結果の 08 差し戻し) の glue eval は
現状未整備 — 必要になったら `skills/11-wcag-mapping/evals/glue/` の方式を踏襲して足す。

> **lint を hook にしない理由**: design-brief.yaml は YAML で、script は YAML を読まない設計
> (OP-1 上 parser を追加できない) ため、hook からは lint 入力 (JSON) を構築できない。既存 hook 群
> (lint-screen-html.sh 等) も in-pipeline write は対象外の思想。よって enforcement は
> 「生成側 self-check (skill 08 Phase 7.5) + 検証側の独立実行 (skill 11 Phase 5 Step 2.5)」の
> 二層 prose 配置とする。

## script CLI 契約テスト (`fixtures/`) — CI で回る

```bash
npm test    # 単体テスト + 本テストの両方 (node --test の規約 discovery)
# 本テストだけ回したい時:
node --test skills/08-design-brainstorm/evals/oklch-script-evals.test.mjs
```

### fixture を足す

1. `fixtures/<name>/input.json` を作る。
   - top-level `"argv"` (配列) がサブコマンド + フラグ (例 `["lint", "--tolerance", "10"]`)。
   - top-level `"expect_exit"` (数値、省略時 0) が期待 exit code。lint の drift 検出 fixture は 1。
   - `"_note"` に「この fixture が何を pin するか」を書く。`argv` / `expect_exit` / `_note` は
     script が無視する inert key (script は `items` / `pairs` / `cases` のみ読む)。
   - ⚠ solve のバッチ入力では top-level `"margin"` は **inert ではない** (デフォルト margin として
     script が読む)。inert key と衝突する名前を増やさないこと。
2. golden を生成:
   ```bash
   npm run evals:regen-goldens:oklch
   ```
3. `npm test` が green を確認。`expected.json` も commit する。

### golden の更新 (script を意図的に変えたとき)

`oklch-color.mjs` の出力を意図的に変えたら `npm run evals:regen-goldens:oklch` で全 golden を
再生成し、**diff を必ず目視レビュー** してから commit する (golden は script 自身が生成する =
手書きしない)。目視レビューの必須確認項目: solve 系 golden の `delta` が §5 予算
(|dl| ≤ 0.15、-0.05 ≤ dc ≤ 0) を守っていること。

### error fixture

`oklch-script-evals.test.mjs` 冒頭の `ERROR_FIXTURES` に登録した fixture は `expected.json` を
持たず、exit code / stderr / stdout 空 を検証する。invalid JSON の fixture は argv を input.json
から読めないため、argv も `ERROR_FIXTURES` 側で持つ。

### 現状の fixture が pin している挙動

| fixture | pin する挙動 |
|---|---|
| `convert-known-colors` | 白/黒/純赤 (CSS Color 4 参考値) + IdeaLoom primary の双方向変換・丸め桁 (l/c 3 桁・h 1 桁・無彩色 h:0) |
| `convert-gamut-clip` | 色域外 oklch → chroma reduction 写像 (L・H 固定) + `in_gamut:false` + `mapped_oklch`。StudyLoop primary の記録座標 (物理的に不可能) を含む |
| `solve-shinmemo-border-edge` | 閾値エッジ実例 (2.99 vs 3.0) → 最小補正 dl=-0.009 で target 3.1 着地 |
| `solve-ohirumeshi-budget` | LLM 案 (+0.16 予算超過) の実例 → 予算内 dl=+0.092 の解 |
| `solve-stage2-red` | gamut 頂点 (純赤) で Stage 1 不成立 → Stage 2 (C 削減) 到達、policy_step:2 |
| `solve-already-passing` | 冪等: 合格済み pair は色を触らない (policy_step:0、hex 無改変) |
| `solve-margin-not-met` | target 不達 → 予算端の best-effort + summary に未達明記 |
| `solve-unsolvable` | 予算内に解なし → solved:false + Step 4 誘導 (exit は 0 = 正常な回答) |
| `lint-studyloop-drift` | 実測 drift 3 件 (Δ25/59/66、うち 2 件は色域外) の検出、**exit 1** |
| `lint-idealoom-pass` | 整合プロジェクト (全 maxΔ=0) → pass、exit 0 |
| `lint-ramenlog-dual-mode` | dual theme の (name, mode) 複合キーで同名 token を独立検査、**exit 1** |
| `lint-missing-oklch-skip` | oklch 欠落は skip 計上 (drift 扱いしない) + state_colors light / domain / illustration の走査 |
| `error-invalid-json` | 不正 JSON → exit 2 + stderr に "JSON" |
| `error-unknown-subcommand` | 未知サブコマンド → exit 2 + stderr に "[oklch-color]" |

fixture の実データ出典: `artifacts/StudyLoop|IdeaLoom|RamenLog/design-brief.yaml` /
`artifacts/ShinMemo|OhiruMeshi/wcag-history.json` (YAML は読めないため JSON 化して埋め込み —
oklch-color.mjs は wcag-contrast.mjs と同じく YAML を読まない設計)。
