# skill 11 (11-wcag-mapping) eval harness

skill 11 の決定論性を守る eval。背景: 旧 skill 11 は contrast 比を **LLM が推算**
していたため実行ごとに揺れ、閾値 (4.5 / 3.0) 近傍で偽 violation → 不要な Phase 2 loop を
誘発していた。数値計算は `scripts/wcag-contrast.mjs` に決定論化済 (単体テスト
`scripts/wcag-contrast.test.mjs`)。本 eval はその上に、契約レベルと整形レベルの回帰検出を足す。

## 何をどこで検証するか

skill 11 は 2 段構えで動く — `wcag-contrast.mjs` が数値を出し、skill (LLM) がその出力を
violation JSON に整形して `wcag-history.json` に書く。検証もこの境界で分ける:

| 検証対象 | 何を固定するか | 実行 | コスト | 場所 |
|---|---|---|---|---|
| script 内部関数 (既存の単体テスト) | `contrastRatio` / `lookupTokenHex` / `evaluateCase` 分類… を白箱検証 | `npm test` | 0 | `scripts/wcag-contrast.test.mjs` |
| **script の CLI 契約** | `wcag-contrast.mjs` を黒箱 CLI として固定 — argv/stdin/`--modes` parsing → 各 mode×case 反復 → 組み上がった stdout 全体の shape。閾値近傍の pass/fail もここで golden 化 | `npm test` | 0 | `fixtures/` + `wcag-script-evals.test.mjs` |
| **skill の整形ロジック** | skill が script の周りで行う LLM 処理 — mode 検出 / hex 無改変 / result→violation 整形 / pair_kind・mode 充填 / null→1 正規化 / first-write vs loop-rerun / append | 手動 on-demand | トークン | `glue/` |

判定の指針: 数値が疑わしい → 単体テスト / `fixtures/` を見る。整形・分岐が疑わしい → `glue/` を見る。

> 姉妹 script `scripts/oklch-color.mjs` (OKLCH↔HEX 変換 + 補正 solver + hex↔oklch lint、
> skill 11 Phase 6 の suggested_correction がその solve 出力を逐語転写する) の
> evals は `skills/08-design-brainstorm/evals/` にある (所有権 = 主消費者の skill 08)。

## script CLI 契約テスト (`fixtures/`) — CI で回る

```bash
npm test                      # 単体テスト + 本テストの両方 (node --test の規約 discovery)
# 本テストだけ回したい時 (反復中):
node --test skills/11-wcag-mapping/evals/wcag-script-evals.test.mjs
```

> `package.json` の `test` は `node --test` 一本。テストファイルは `*.test.mjs` 命名規約で
> 自動 discovery されるので、新しい eval を足しても path を手で列挙し直す必要はない。

### fixture を足す

1. `fixtures/<name>/input.json` を作る。
   - `cases` は `wcag-contrast.mjs` への入力 (`{ cases:[{ candidate_id, palette:{ tokens, state_colors?, domain_surfaces? } }] }`)。
   - top-level `"modes"` key が `--modes` 引数 (`"dark,light"` / `"light"` / `null`=省略でデフォルト dark)。
   - top-level `"_note"` に「この fixture が何を pin するか」を書く。`modes`/`_note` は script が無視する inert key。
   - **token 名は skill 08 が実際に書き出す CSS 変数形 `--color-surface` に揃える** (実 brief `artifacts/*/design-brief.yaml` / `refs/design-brief-template.md` と同形)。`PALETTE_PAIRS` の `fg`/`bg` と exact 一致しないと palette 1-7 が全 skip → 全件偽 violation になるため、fixture は必ず実入力を代表する `--color-*` 形で書く。
2. golden を生成:
   ```bash
   npm run evals:regen-goldens
   ```
3. `npm test` が green を確認。`expected.json` も commit する。

### golden の更新 (script を意図的に変えたとき)

`wcag-contrast.mjs` の出力を意図的に変えたら `npm run evals:regen-goldens` で
全 golden を再生成し、**diff を必ず目視レビュー** してから commit する
(golden は script 自身が生成する = 手書きしない。これにより golden が常に authoritative)。
`evals:regen-goldens` は golden を **書き換える** ので `test` とは別 script にしてある
(reflex で `npm test` の延長として叩いて goldens を黙って上書きする事故を防ぐ)。

### error fixture

`wcag-script-evals.test.mjs` 冒頭の `ERROR_FIXTURES` に登録した fixture は `expected.json` を持たず、
exit code / stderr / stdout 空 を検証する (例: `error-invalid-json` → exit 1, stderr に "JSON")。

### 現状の fixture が pin している挙動

| fixture | pin する挙動 |
|---|---|
| `single-light` | `--modes light`、mode 無し token を light で legacy fallback、全 pair 合格 |
| `legacy-dark` | `--modes` 省略 → default dark、legacy 経路 |
| `dual-mode` | `--modes dark,light` → 1 case 2 entry、(name,mode) 複合 lookup、dark に違反 1 件 |
| `state-colors-skip` | state_colors の optional/skip (error=full / info=dark のみ / warning・success 未定義) |
| `domain-surface` | NFR 由来 domain pair、surface.modes に当該 mode 無し → skipped |
| `threshold-edge` | **4.54 pass / 4.48 fail / 3.03 pass / 2.81 fail / 3.00 ちょうど pass** — 閾値境界 |
| `error-invalid-json` | 不正 JSON → exit 1 + stderr |

## skill 整形ロジックテスト (`glue/`) — on-demand

`glue/run-glue-eval.md` 参照。要約: fixture artifacts を一時コピー → skill 11 を実行 →
`glue/grade-glue.mjs` で機械判定 → 主観項目を人間確認。CI には載せない (トークンコストがかかる)。
現状は実行手順 + cases + グレーダーまで用意してある (未実行)。

## なぜ skill-creator plugin を「そのまま」採用しなかったか

plugin の trigger-eval (description 最適化) と with-vs-without-skill benchmark は、
**description でトリガーされ単独実行される skill** を前提とする。AYATORI の skill は
`phases/*/SKILL.md` から決定論的に呼ばれる pipeline step なので、その前提が成立しない。
採用したのは plugin の **思想** (evals + 検証可能な expectations + 再利用グレーダー) だけで、
machinery は repo-native に最小実装している。
