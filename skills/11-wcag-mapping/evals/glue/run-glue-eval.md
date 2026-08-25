# skill 整形ロジック eval (glue) の回し方 (on-demand)

script CLI 契約テスト (`../fixtures/`, `npm test`) が `wcag-contrast.mjs` の **数値** を固定するのに対し、
本層は skill 11 が script の周りで行う **整形ロジック (LLM)** を検証する。トークンコストがかかるため
**CI には載せず、skill 11 の整形ロジックを触ったとき (Phase 2.5 mode 検出 / result→violation 整形 /
first-write 分岐 / append ロジック等) に手動で回す**。

## 何を見るか (script CLI 契約テストでは捕まえられない回帰)

| 観点 | 説明 |
|---|---|
| mode 検出 | `themes_required` を読んで `modes_to_verify` を正しく決め、`--modes` を渡せたか |
| hex 無改変 | design-brief の hex を一字も書き換えずに script へ渡したか (`hex-not-mutated`) |
| result→violation 整形 | `pass==false` だけを violation 化し、必須 field を埋めたか |
| pair_kind / mode 充填 | 各 violation に正しい `pair_kind` / (dual 時) `mode` を入れたか |
| `null→1` 正規化 | `skipped` result の `actual_ratio:null` を schema 準拠で `1` にしたか |
| first-write vs loop-rerun | 初回は constraints/criteria を write、再実行では skip したか |
| suggested_correction | §5 に基づく具体的・実行可能な補正提案になっているか (judgment) |

## 手順

1. **fixture を runtime の `artifacts/` レイアウトに一時コピー** (skill が書き込むので原本を汚さない。
   コミット済 fixture は `app/` 配下 — repo の `.gitignore` が `artifacts/` を ignore するため
   fixture source をその名前で置けない。skill 11 が読むのは `artifacts/{app_name}/` なので
   コピー時に `artifacts/` へ rename する):
   ```bash
   CASE=dual-mode-first-write
   WS=$(mktemp -d)
   mkdir -p "$WS/artifacts"
   cp -r skills/11-wcag-mapping/evals/glue/fixtures/dual-mode-violation/app/glue-demo "$WS/artifacts/"
   ```

2. **skill 11 を実行させる** (subagent or 別 session 推奨。`cases.json` の該当 `prompt` を渡す)。
   実行コンテキストの `artifacts/` を手順 1 のコピー先 (`$WS/artifacts/`) に向ける。
   - `loop-rerun-invariants` (case 1) は前提として constraints/criteria 入りの
     `wcag-mapping.json` と attempt 1 件入りの `wcag-history.json` を先に置くこと
     (case 0 を実行した output をそのまま使ってもよい)。

3. **プログラム採点** (`checkable:"script"` の assertion を機械判定):
   ```bash
   node skills/11-wcag-mapping/evals/glue/grade-glue.mjs --case "$CASE" \
     --history "$WS/artifacts/glue-demo/wcag-history.json" \
     --mapping "$WS/artifacts/glue-demo/wcag-mapping.json" \
     --brief   skills/11-wcag-mapping/evals/glue/fixtures/dual-mode-violation/app/glue-demo/design-brief.yaml
   ```
   exit 0 = 機械チェック全 pass。grading.json 互換の JSON を stdout に出す。

4. **judgment 系を人間 / LLM が確認**: `cases.json` の `checkable:"judgment"` な assertion
   (`suggested-correction-actionable` / `mapping-unchanged`) を、生成された
   `wcag-history.json` / `wcag-mapping.json` を見て手で判定する。

5. **後片付け**: `rm -rf "$WS"`。

## 注意

- 本層は **数値の正しさは見ない** (それは script CLI 契約テストの責務)。fixture の数値は
  `../fixtures/dual-mode` と同じ palette なので、数値が疑わしいときは `../fixtures/` 側を見る。
- グレーダー `grade-glue.mjs` は再利用可能。新しい case を足すときは `cases.json` に
  expectations を追記し、機械判定可能なら grader に case 分岐を 1 つ足す。
- skill-creator plugin の本格採点ループ (benchmark viewer / with-vs-without 比較) は
  決定論パイプラインの step には不向きなため採用していない。本 doc はその思想 (evals +
  grader) を repo-native に最小実装したもの。
