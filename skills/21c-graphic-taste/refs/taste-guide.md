# 21c テイスト選定ガイド (2 段階ヒアリングのテンプレート・分岐設計・プロンプト規約)

`skills/21c-graphic-taste/SKILL.md` の Step 2〜6 (対話) 実行時のみ Read する参照資料。
routing / 分岐判断は SKILL.md 側、決定的検証・生成・書き込みは `scripts/` 側の責務であり、本書は
**ユーザーに何をどう提示し、A/B/C の分岐とプロンプトをどう組み立てるか** だけを定義する。

## §1 1 段階目 候補語の作り方 (AI 提案 = (E) PROPOSED)

「ポップ」「シンプル」「可愛い」「洗練」のようなざっくりした方向性の言葉を **プロジェクト背景を
踏まえて 4 つ** 提案する。汎用リストの丸写しはしない — 候補源は以下の 3 つ:

1. **`requirements/01-overview.md`** — アプリのドメイン・ターゲット層 (例: 屋外で使う実用ツール →
   「視認性重視のフラット」が候補に乗る / 子ども向け学習アプリ → 「可愛い」「手描き風」が乗る)。
2. **`design-brief.yaml`** (`gather` の `design_brief` が non-null のとき Read) —
   `common.hearing` の raw 回答と `hearing_interpreted` が最重要の判断素材:
   - `avoid_styles` に挙がったスタイル (例: 「子どもっぽい・ポップ過ぎ」) と衝突する候補語は
     **提示しない** (Step 10 で一度否認された方向を再提案しない)。
   - `brand_direction` / `tone_mood` / `color_image` に整合する候補を優先する。
   - `ui_constraints.illustration_policy` (pictogram / illustration_character / emoji_casual) は
     アイコン描画規約であってグラフィックの直接制約ではない (設計 §5 — 別軸) が、
     `illustration_character` なら既存 placeholder の画風と馴染む候補を優先するなどの参考にする。
3. **`graphic-plan.json` の slots** (`gather` の `slots`) — 用途 (hero / empty state / 報酬演出) に
   よって適する語彙が変わる。

語彙の例 (提示はプロジェクトに合う 4 つに絞る): ポップ / シンプル / 可愛い / 洗練 (おしゃれ) /
手描き風 / あたたかい / フラット / 写実的 (フォト) / 未来的 / レトロ / 和風 / ミニマル / シネマティック。

`design_brief` が null (`gather` の warnings に含まれる) 場合は、その旨を明示してから
requirements のみで候補を出す (無言 fallback 禁止)。

## §2 1 段階目 AskUserQuestion (multiSelect)

`header` は 12 文字以内厳守。選択は複数可 (`level1_words` は 1 件以上の配列 — 例: 「洗練」+
「あたたかい」の組合せも 2 段階目で 1 方向として扱う):

```
header: "テイスト方向"
multiSelect: true

question: |
  グラフィックのテイストを 2 段階で決めます。まず大まかな方向性を言葉で選んでください
  (複数選択可 — 組み合わせた方向で次のサンプル比較に進みます)。
  選択後、その方向の中で 3 案 (A/B/C) のサンプルグラフィックを生成して比較します。
  候補はプロジェクト背景 ({候補の根拠を 1 行: 例「屋外利用・視認性重視」}) を踏まえた提案です。

options:
  - label: "{候補語 1}"
    description: "{その語が本プロジェクトに合う理由を 1 行 (根拠: 01-overview / design-brief のどこか)}"
  - label: "{候補語 2}"
    description: "..."
  - label: "{候補語 3}"
    description: "..."
  - label: "{候補語 4}"
    description: "..."
```

- 候補外の言葉は「Other」の自由記述で受け付ける (user 指示由来 = (A) CONFIRMED)。
- 中止意図の返信 (「やめる」「後で決める」等) は SKILL.md Step 7 の保留分岐へ。

## §3 お題 (subject) の決め方 — 全 variant 共通・機械固定

2 段階目のサンプルは **「同一のお題を 3 つのテイストで描き分けたもの」** を見せる
(お題まで変えるとテイスト以外の差が混ざり比較にならない — 生成ツール比較のペア比較方法論と同じ
変数統制)。共通化自体は `generate-samples.mjs` が prompt 組み立てで機械保証するので、
ここでは **1 つの良い subject を書く** ことに集中する:

- **素材**: `gather` の `representative_slot` (hero > content > small の優先) の `placement` +
  アプリのドメイン。実際に入れる場所の絵柄でテイストを判断できるようにする。
- **英語** で書く (パイプラインのプロンプトは常に英語 — 生成ツール比較の前提条件。
  日本語混入は script が生成前 (課金前) に `E_NON_ENGLISH` で停止する。固有名詞の原語表記等の
  意図的なケースのみ `--allow-non-english` で明示続行 — 文字入れ [embedded text] 指示は
  意図的でも不可、下記の禁止事項参照)。
- **構図まで含めて 1〜2 文**: 主題 + 状況 + 構図目安 (例: centered composition, generous
  negative space)。
- **禁止事項は書かない** (no embedded text / no brand likeness / サイズは script の固定 tail が
  付加する — 二重指定しない)。
- 例 (駐車位置最適化アプリ・hero slot の場合):
  `A small friendly compact car parked under a tree's cool shadow on a sunny day, conveying "found the coolest parking spot". Centered composition, subject fills about 60% of the frame.`

## §4 A/B/C 分岐の作り方 (style_block)

選ばれた方向性の **中で** 3 案に分岐させる。方向性そのものを変えた 3 案 (洗練 vs ポップ vs 可愛い)
にしない — それは 1 段階目のやり直しになる。分岐は次の 3 軸から 2 軸以上を変えて作る:

| 分岐軸 | 例 (「洗練」を選んだ場合) |
|---|---|
| 技法・線質 | A: 無描線のソフト水彩 / B: 細線のミニマル line art / C: フラットベクター + ソフトグラデ |
| 密度・ディテール | spot illustration の余白多め ↔ 描き込みのある構成 |
| 配色処理 | palette_hints の寒色を淡く敷く ↔ 高コントラストのアクセント使い |

`style_block` は英語 1〜2 文で、生成ツール比較の S1/S2 ブロックの文体に倣う
(style 名詞句の列挙 + palette ヒント)。**palette_hints から 2〜3 色をヒントとして織り込む**
((C) DERIVED — デザインシステム側に寄せて調和を担保、設計 §6。厳密一致の強制ではなく
"harmonized with" のヒント扱いにする):

```
A: soft watercolor illustration style without outlines, subtle paper texture,
   generous negative space, gentle muted colors harmonized with #0E7C90 (teal) and
   #EAF2F4 (light celadon) on a light background
```

gpt-image-2 の運用注意 (総合判定より、必要な案にだけ入れる):

- 淡色背景が必要な案は `on a light background` を明示する (dark 大面積化の癖への対策)。
- 写実 (photo) 系の案は CG 感が残ることがある — 写実を主軸にする場合はその旨を user に一言添える。

`label` は日本語で「{方向性}{A/B/C} ({分岐の要約})」(例: `洗練A (無描線ソフト水彩)`)。

## §5 A/B/C 選択 (AskUserQuestion)

比較 HTML (`taste-compare.html`) の preview 提示後に聞く。サンプルは (B) ILLUSTRATIVE の見本で
あり、選択結果 (方向) だけが下流に渡る:

```
header: "テイスト選択"

question: |
  {level1_words の組合せ} の方向で 3 案のサンプルを生成しました (taste-compare.html 参照)。
  どのテイストで進めますか?
  ここで選んだテイストが 21d 以降の全グラフィック生成プロンプトに共通適用されます。
  サンプル自体は見本であり、本番グラフィックは 21e で slot ごとに生成し直します。

options:
  - label: "案 A ({A の分岐要約})"
    description: "{A の style_block の日本語要約 1 行}"
  - label: "案 B ({B の分岐要約})"
    description: "{B の style_block の日本語要約 1 行}"
  - label: "案 C ({C の分岐要約})"
    description: "{C の style_block の日本語要約 1 行}"
  - label: "追加指示で作り直す"
    description: "自由記述の指示 (例: 「A をもっと淡く」「線を細く」) を反映して再生成する。方向性から選び直すこともここで指示できる"
```

- 「追加指示で作り直す」→ 指示を反映して style_block (必要なら 3 案とも) を改訂し、SKILL.md
  Step 3 を再実行する (digest 不一致の variant のみ再生成される)。**修正指示は Pattern A として
  `feedback-log.md` に記録する**。再生成は有料・低速のため、指示内容を復唱してから実行する。
- 指示が「方向性から変えたい」なら §2 (1 段階目) からやり直す (user 発意の再選択は P4-07 の
  対象外)。1 段階目の選択語も変わるため、再生成前にその旨を復唱する。
- 中止意図 → SKILL.md Step 7 の保留分岐へ。

## §6 style_directive の合成と確定確認

選ばれた案の `style_block` を土台に、採用されなかった案との差分を明示する 1 段落の英語
directive に整える (21d が全 slot のプロンプトへ共通合成する — 同テイスト連続生成の安定性担保。
日本語混入は commit script が `E_NON_ENGLISH` で確定前に止める — 意図的な場合のみ
`--allow-non-english`):

- 含める: 技法・線質 / 密度 / 配色処理 (palette_hints の色をそのまま列挙) / 背景の明暗 /
  §5 で出た追加指示 (あれば)。
- 含めない: お題固有の内容 (subject は slot ごとに 21d が書く) / サイズ / no-text 系の禁止句
  (21e 側の生成規約が持つ)。

確定確認 (AskUserQuestion)。**提示の前に `commit-taste.mjs --dry-run` で draft を検証しておく**
(user には検証済み draft だけを見せる):

```
header: "テイスト確定"

question: |
  テイストを以下で確定してよいですか?
  - 1 段階目: {level1_words}
  - 2 段階目: 案 {level2_choice} ({label})
  - style directive: {style_directive}
  - palette hints: {palette_hints}
  確定すると graphic-plan.json に taste を記録し、21d (プロンプト確定) に進みます。

options:
  - label: "この内容で確定"
    description: "graphic-plan.json に taste を記録して 21d へ進む"
  - label: "修正する"
    description: "修正指示をチャットで受け付け、draft を更新して再確認する"
  - label: "中止 (後で決める)"
    description: "テイストを確定せず終了。次回セッションで 21c が再起動する (サンプルは cache 再利用)"
```

「修正する」の指示が style 内容に及ぶ場合はサンプルとの乖離に注意 — 文言調整の範囲なら draft
だけ直して再確認、見た目の変更なら §5 の再生成に戻す。修正指示は Pattern A を記録する。

## §7 degrade 分岐 (`E_NO_API_KEY` / `E_GENERATION_FAILED`)

生成 API が使えない・失敗した場合も **無言で補完しない** — 状況を明示して user に選ばせる
(AskUserQuestion):

```
header: "サンプル生成"

question: |
  サンプルグラフィックの生成ができませんでした ({E_NO_API_KEY: 生成 API キー未設定 /
  E_GENERATION_FAILED: 失敗した variant と error の要約})。どう進めますか?

options:
  - label: "リトライ"                       # E_GENERATION_FAILED のみ提示
    description: "失敗した variant のみ再生成する (成功分は cache 再利用)"
  - label: "キーを設定して続行 (推奨)"        # E_NO_API_KEY のみ提示
    description: "node scripts/setup-image-key.mjs でキーファイル (~/.ayatori/image-api-key) を作成して開くので、キーを貼り付けて保存後に「設定した」と返信する。再起動不要でサンプル生成を再実行できる"
  - label: "テキスト説明で選ぶ"
    description: "サンプル画像なしで、A/B/C の style 説明文 (日本語要約 + 英語 style_block) を読み比べて選ぶ。taste の sample_files は記録されない"
  - label: "手動生成して配置する"
    description: "3 案のプロンプト全文を提示するので、社内ポータル等で手動生成して graphics/samples/taste-{a,b,c}.png に保存後、「配置した」と返信する"
  - label: "中断 (後で決める)"
    description: "API キー設定後に再実行する。次回セッションで 21c が再起動する"
```

- **キーを設定して続行** (`E_NO_API_KEY` のみ提示): `node scripts/setup-image-key.mjs` を実行する
  (キーファイルを権限 600 で作成しエディタで開く)。**キーの値をチャットに貼らせない** —
  transcript にキーが残るのを避けるため、user 自身がエディタで貼り付ける。「設定した」返信後に
  サンプル生成を再実行する (キーファイルは実行時直読のため再起動不要 — POCTEAMA-408)。
  再発時は `node scripts/setup-image-key.mjs --doctor` で実効ソースを診断する。
- **リトライ** (`E_GENERATION_FAILED` のみ提示): ただし `failures[].error` が `API 401` / `API 403`
  (認証失敗) の場合はキー側の問題なので、リトライの前に `node scripts/setup-image-key.mjs --doctor`
  で実効ソースを確認する (キーをローテーションしたのに env 側の旧キーが優先されているのが典型 —
  POCTEAMA-408)。
- **テキスト説明で選ぶ**: §5 と同じ選択肢を、画像なしの説明文比較で提示する。`sample_files` は
  commit に含めない (省略 = 画像なしで確定した記録)。
- **手動生成して配置する**: `generate-samples.mjs` が組み立てるのと同じ形の完全プロンプト
  (style_block + subject + `No embedded text, no readable letters, no real brand likeness. Square 1:1, resolution 1024x1024 pixels.`)
  を 3 案分チャットに提示する。user の配置報告後、3 ファイルの存在を確認して §5 へ進む
  (`sample_files` には配置されたパスを記録する。比較 HTML は生成しないので画像は直接 link 提示)。
  この経路で配置したファイルは samples-manifest.json に digest entry を持たない (`E_NO_API_KEY`
  経由では manifest 自体が無く、`E_GENERATION_FAILED` 経由では失敗 run が書いた manifest に
  生成成功分の entry しか無い)。gather は manifest に entry の無い実在 `taste-{id}.png` を
  `source: "disk"` として列挙するため再入時に存在は失われないが、digest cache 再利用はされず、
  同じ variant を generate で再生成すると上書きされる (SKILL.md Step 2 の再入注記参照)。
- **旧世代 PNG の注意**: `E_GENERATION_FAILED` の `failures[].prior_cache_kept: true` は「当該
  variant に**改訂前世代**の PNG がディスクに残っている」印 (style を旧に戻せば cache hit する
  ための保持)。リトライ以外を選ぶ場合、この PNG は改訂後の style_block とは別物なので比較材料
  として提示しない。
- いずれの経路でも、何に degrade したかを完了報告に明記する。
