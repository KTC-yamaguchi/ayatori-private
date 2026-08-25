# idea-brief.md 出力テンプレート

`artifacts/{app_name}/idea-brief.md` の**固定 Markdown 見出し構造** (schema なし —
`delta/feature-add-brief.md` の先例に準拠)。Step 5 が毎ラウンドこのテンプレートに従って
**丸ごと上書き**する (⑥ スコア履歴のみラウンド別追記)。

本ファイルは /ayatori-idea をはじめ、brief を読み書きする全ステップが参照する**契約**
である。見出し構造・frontmatter キーを変更する場合は参照側 (writer / reader) 全ステップ
への周知が必要。

## 配置と消費のルール

- 配置: `artifacts/{app_name}/` **ルート直下** (requirements/ 配下 NG — 3 系統誤検出防止、設計書 §4)。
- writer: `01a-idea-brushup` のみ (single writer)。
- reader: `01-question` (ブリーフ先読みモード)。
- **消費済みマークは書かない** — 消費判定は「同ディレクトリの requirements.json の存在」で行う
  (skill 01 が brief に書き込むと single writer 違反になるため)。

## テンプレート

```markdown
---
app_name: {app_name}
recorded_at: "{YYYY-MM-DDThh:mm:ss±hh:mm}"   # 最終上書き時刻。7 日以上経過で question 側が鮮度確認
rounds_completed: {N}                          # 完了ラウンド数 (resume 時の引き継ぎ元)
last_score_total: {NN}/30                      # 最終ラウンドの合計スコア
score_below_threshold: {true|false}            # 全軸 3 以上を満たさない軸が残っているか
proceeded_below_threshold: {true|false}        # スコア未達のまま「7 軸へ進む」を選んだ場合 true
---

# アイデアブリーフ: {app_name}

## ① 現在のアイデア像 (5 軸)

<!-- 毎ラウンド丸ごと上書き (蓄積型は発散する — idea-explorer #276/#277)。 -->
<!-- AI 補完で未確定のものは [proposal] マーカーを残す。 -->

- **Why (なぜ作るか / 解く課題)**: …
- **What (何を作るか / 提供価値)**: …
- **Who (誰のためか / 想定ユーザー)**: …
- **How (どう実現するか / 機能の言葉で)**: …
- **WhyNot (なぜ既存で足りないか / 差別化)**: …

## ② 確定事項 (ユーザー確認済み specifics)

<!-- Step 3 / Step 4 でユーザーが確定した load-bearing specifics。 -->
<!-- pending-questions.json の born-resolved entry と 1:1 対応させ、target を併記する。 -->

| target (born-resolved) | 確定内容 | 確定ラウンド |
|---|---|---|
| `idea_brief.who` | … | R1 |

## ③ 未解決の論点

<!-- ユーザーが「そうは思わない」で終わらせなかった/判断保留の懸念。補完せず ※不明 を付す。 -->

- ※不明 (unknown): … (次回 ask 対象: `idea_brief.{key}`)

## ④ 先送りした論点

<!-- Step 2 収束で「今回の核」に選ばれなかった論点。消さずに残す。 -->

- …

## ⑤ CxO 批評サマリ (リアクション結果付き)

<!-- 最終ラウンドの批評のみ (上書き)。ペルソナ選定理由も残す。 -->
<!-- 批評 skip (fast-track 短縮 1 周) で Step 4 を実施しなかった場合は、
     下記ペルソナ構造を書かず「実施なし (fast-track・批評 skip)」と 1 行だけ記す。 -->
<!-- 5 軸充足ゲートで批評を skip した場合は、同様に
     「実施なし (5 軸未充足・批評 skip)」と 1 行だけ記す。 -->
<!-- 5 軸未充足のまま強行実施した場合 (refs/cxo-panel.md § 未充足のまま強行する場合) は、
     冒頭に「未充足のまま実施 (未充足軸: {軸名, …})」を 1 行記した上で、通常どおり
     全席分の構造を書く。 -->

### {ペルソナ 1} (選定理由: …)
- 良い点: …
- 懸念: … → ユーザー: そう思う / そうは思わない
- 問い: … → 回答: … (または ※不明)

## ⑥ 固まり度スコア履歴 (ラウンド別・追記型)

<!-- このセクションのみ追記型。過去ラウンドの行を消さない。 -->

| ラウンド | 課題の鋭さ | 欲しさ | 差別化 | 実現イメージ | スコープ明瞭度 | 仮定と根拠の区別 | 合計 |
|---|---|---|---|---|---|---|---|
| R1 | n | n | n | n | n | n | nn/30 |

### 最終ラウンドの軸別「足りない点」

- 課題の鋭さ: …
- (6 軸すべて 1 文ずつ)

## ⑦ 7 軸への引き継ぎヒント (軸別マッピング)

<!-- question 側ブリーフ先読みモードが読む。対応がない軸は「対応なし (フル実施)」と書く。 -->

| 7 軸 | brief 対応箇所 | 引き継ぎ内容 |
|---|---|---|
| Axis 1 (Target User) | ① Who / ② `idea_brief.who` | … |
| Axis 2 (Problem) | ① Why | … |
| Axis 3 (Features/MoSCoW) | ① What・How | … (Must 候補として) |
| Axis 4 (Competitors) | ① WhyNot | … ※未検証 (web 検索なし) |
| Axis 5 (Constraints) | 制約への言及があれば | … / 対応なし (フル実施) |
| Axis 6 (Platform) | プラットフォーム言及があれば | … / 対応なし (フル実施) |
| Axis 7 (Design Output Scope) | **対応なし (常にフル実施)** | — |
```

## born-resolved target 命名規約

`pending-questions.json` に append する born-resolved entry の `target` は
**`idea_brief.{key}` namespace に統一**する。

- hook R5b の dot/bracket 文法に適合する**英数キーのみ** (日本語・自由文禁止)。
- 例: `idea_brief.who` / `idea_brief.core_problem` / `idea_brief.core_features[0]` /
  `idea_brief.differentiation`。
- skill 01 由来の entry とは prefix で名前空間分離し、Step 07 監査の map source として
  衝突しない。
- 必須 field セット (hook R3): `target` / `question` (聞いた内容) /
  `raised_by_step: "01a-idea-brushup"` / `raised_at` (ISO 8601) + born-resolved のため
  `resolved_at` / `resolved_answer` も同時に set する。
