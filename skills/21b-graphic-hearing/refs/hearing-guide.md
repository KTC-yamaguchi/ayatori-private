# 21b ヒアリングガイド (質問テンプレート・候補洗い出し観点・書式規約)

`skills/21b-graphic-hearing/SKILL.md` の Step 3 (対話) 実行時のみ Read する参照資料。
routing / 分岐判断は SKILL.md 側、決定的検証・書き込みは `scripts/` 側の責務であり、本書は
**ユーザーに何をどう提示するか** だけを定義する。

## §1 推奨レポート提示 (`mode == "report"` のみ)

`graphics/graphic-recommend.md` の要点をチャットに要約提示する (全文転記はしない):

- 総合推奨 (レポートの推奨 3 段階の結論) と主根拠
- 候補スロット数と代表例
- ガードレール節の内容 (「入れない方がよい箇所・注意点」— §3 の候補列挙でも遵守する)
- 視覚レポート `graphics/graphic-recommend.html` が存在する場合はその旨を 1 行添える
  (「候補の位置はブラウザで開いた視覚レポートのハイライトで確認できます」— Step 2 の preview で
  auto-open 済み。不在 [候補 0 件 / render 失敗] なら言及しない)

`mode == "plain"` では本節を skip し、代わりに次の一文を必ず明示する (無言 fallback 禁止):
「21a の推奨レポートは生成されていません。以降はレポートなしのユーザー判断でヒアリングします」

## §2 Q1 グラフィック要否 (AskUserQuestion, single select)

`header` は 12 文字以内厳守。option label は絵文字を避け、半角括弧 + スペースの表記に揃える:

```
header: "グラフィック要否"

question: |
  Step 21 で main 画面の HTML が承認されました。画面に AI 生成グラフィック
  (イラスト / キャラクター / 写真) を追加しますか?
  {mode == report のときのみ: 「推奨レポートの結論: {総合推奨の引用}」}
  {mode == plain のときのみ: 「(21a の推奨レポートはありません。ユーザー判断でお願いします)」}

  「必要」を選ぶと、どこに入れるかの箇所選択 → テイスト選定 (21c) →
  プロンプト確定 (21d) → 生成 (21e-21f) → 埋め込み承認 (21g) まで進みます。
  生成 (gpt-image-2) は低速・有料のため、必要な箇所に絞ることを推奨します。

options:
  - label: "必要 (箇所選択へ進む)"
    description: "グラフィックを入れる箇所を選択し、graphics/graphic-plan.json を生成する"
  - label: "不要 (グラフィックなしで進む)"
    description: "21c-21g を skip して Step 15 (2nd Confluence save) へ進む。pipeline-state.json に decision=skip を記録"
  - label: "後で決める"
    description: "要否を確定せず終了。次回セッションで 21b が再起動する"
```

> **推奨マーカーの付け方** (25a の Q1 と同方針): option label / 並び順は固定し、「(推奨)」を label に埋め込まない。推奨の表現は質問本文の `推奨レポートの結論:` 行で完結させる。`mode == plain` では推奨行を出さない (レポートなしで AI が要否の推奨を捏造しない — Operating Principle 4)。

## §3 候補箇所の洗い出し (AI 提案 = (E) PROPOSED)

プロジェクト固有の候補を 3〜10 件洗い出す。候補源はモードで切り替える:

- `mode == "report"`: レポートの **候補スロット節を第一候補** としてそのまま採用する (根拠に「推奨レポート由来」を記録)。ガードレール節に反する候補は列挙しない。不足があれば下の汎用観点で補完する。
- `mode == "plain"`: gather-context の `screens` / `placeholder_hits` + 必要画面の `screens/{画面名}.md` (画面仕様書) から洗い出す (**HTML 全文の Read はしない** — placeholder の当たりは script が数えて返している)。

**汎用観点** (プロジェクトに応じて具体化する。該当しない観点は出さない):

| 観点 | 例 |
|---|---|
| ヒーロー領域 | トップ / ランディング画面のヘッダー直下ビジュアル |
| オンボーディング / 空状態 | 初回説明・empty state のイラスト (`illustration_policy == illustration_character` の既存 `illust-placeholder` ブロックは自然な置換候補 — 設計 §5) |
| コンテンツ内イメージ | 記事・カード内のサンプルグラフィック |
| ゲーミフィケーション報酬 | トロフィー・バッジ・達成演出のイラスト |
| ナビゲーション演出 | ボトムメニュー代わりのキャラクター画像など |
| その他プロジェクト固有 | requirements.json の機能・カテゴリから導く |

各候補は `screen` (gather-context の `screens` に実在する stem) / `placement` (画面内の配置) / `size_role` 目安 (hero≈800×400 / content≈320×200 / small≈64×64) / 根拠 の 4 点で構成する。

## §4 複数選択 (plain chat 番号付きリスト — AskUserQuestion 不使用)

候補が AskUserQuestion の option 上限 4 を超え得るため、`skills/01b-add-feature-question/SKILL.md` § Plain chat fallback の書式に統一する:

```
グラフィックを入れる箇所の候補です (AI 提案です。生成は低速・有料のため、
必要な箇所に絞ることを推奨します)。

1. [{screen} / {platforms}] {placement} — {size_role}
   根拠: {推奨レポート 候補スロット由来 / 画面仕様書の記述 等}
2. ...

選択方法: 該当する番号をカンマ区切りで返信してください (例: 「1, 3」)。複数選択可。
全件の場合は「all」と返信してください。
候補にない箇所は「追加: {画面名} {箇所の説明}」の形式で自由記述できます (番号との併記可)。
1 件も入れない場合は「なし」と返信してください (グラフィック不要として記録します)。
```

返信の解決規則:

| 返信 | 扱い |
|---|---|
| 番号 / `all` | 該当候補を選択。解決できない番号を含む返信は同リストを再提示する |
| `追加: ...` | user 指示由来の箇所として追加 ((A) CONFIRMED)。`screen` が実在 stem に解決できない場合はどの画面かを聞き返す |
| `なし` | 「不要」に転換 (SKILL.md Step 4 の skip 分岐へ) |
| 「やめる」「後で決める」等の中止意図 | 再提示ループに固定せず「保留」扱い (SKILL.md Step 4 の保留分岐へ) |

## §5 slot draft の組み立て

選択された各箇所を slot に整形し、チャットに表で提示する。機械検証 (pattern / enum / 実在照合 / platform_combo 範囲) は `commit-decision.mjs` が行うため、ここでは **判断が要る値決め** に集中する:

| フィールド | 決め方 |
|---|---|
| `graphic_id` | kebab-case で内容が分かる命名 (例: `hero-dashboard` / `empty-cart-illust`)。正典ファイル名 stem・`<img>` alt (= Figma レイヤ名)・graphic-prompts.json キーの 3 箇所で同一値になる |
| `screen` | 画面ファイル名 (拡張子なし、例: `01-login`) |
| `platforms` | 同一画面・同一配置に両 platform で入れるなら 1 slot に両方を列挙。**別画面・別配置で同じ画像を再利用する場合は slot を分けて `graphic_id` を共有する** (schema 規約) |
| `placement` | 画面内配置の自由記述。既存 `illust-placeholder` ブロックの置換ならその旨を明記 |
| `size_role` | `hero` / `content` / `small` の 3 区分 (最終ピクセル数は 21d が確定する) |
| `state` | `"default"` 固定 (v1 は main HTML のみ対象 — 設計 §4) |
| `rationale` | 推奨レポート候補由来 / user 指示由来 の別を記録 (audit 用) |

組み立てた draft は、**表を user に提示する前に dry-run で機械検証を通す** (user には検証済みの draft だけを見せる — §6 確定後に E_VALIDATION → 無言修正、で確定内容と書き込み内容が乖離するのを防ぐ):

```bash
node skills/21b-graphic-hearing/scripts/commit-decision.mjs {app_name} generate --stdin --dry-run <<'JSON'
{ "slots": [ ... ] }
JSON
```

`E_VALIDATION` なら `errors[]` に従い draft を直して dry-run を再実行し、`ok: true` になってから表を提示する。

## §6 確定確認 (AskUserQuestion)

```
header: "スロット確定"

question: |
  上記 {N} 件の slot 計画で確定してよいですか?
  確定すると graphics/graphic-plan.json を生成し、21c (テイスト選定) に進みます。

options:
  - label: "この内容で確定"
    description: "graphic-plan.json を生成して 21c へ進む"
  - label: "修正する"
    description: "修正指示をチャットで受け付け、slot 表を更新して再確認する"
  - label: "中止 (後で決める)"
    description: "要否を確定せず終了。次回セッションで 21b が再起動する"
```

- 「修正する」→ 修正指示をチャットで受けて draft を更新し、本節を再実行する。**修正指示は Pattern A として `feedback-log.md` に記録する** (CLAUDE.md § Feedback Log)。
- 「中止 (後で決める)」→ SKILL.md Step 4 の保留分岐へ。
