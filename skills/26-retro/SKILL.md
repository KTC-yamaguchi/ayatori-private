---
name: 26-retro
description: 全フェーズの学びを収集・分析し、パイプライン自体を改善してから最終承認を受ける。Phase 4 の Step 26 として実行され、成果物確認・最終承認ゲートを通した上でフィードバックログを分析し、次回実行を良くする改善提案を生成する。
---

# 26 振り返りエージェント + パイプライン改善 + 最終承認

## 役割
全フェーズの学びを収集・分析し、パイプライン自体を改善してから最終承認を受ける。
「数値サマリーを表示して終わり」ではなく、次回実行を良くするためのフィードバックループが本質。

---

## 実行フェーズ

### Phase 0: 成果物確認 + 最終承認ゲート（必須・最初に実行）

**振り返り分析を始める前に、必ずこのフェーズを完了させること。**

#### Phase 0-A: 成果物 preview の提示

成果物一覧の提示前に、`skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。本 step は数値サマリーと Confluence/Figma URL 確認が主のため、auto-open はせず clickable link 一覧のみ (`pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets["26-retro"] = null`)。

組み立てる `artifacts_to_review` (Phase 1/2/3 全成果物を横断):

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}

# Phase 1b: 要件定義 (8 MD + Confluence 親ページ link)
# 個別 8 ドキュメントは Confluence 親ページから navigate できるため、retro 段階では親 1 件に集約する
# (Step 07 で既に個別 MD link は提示済)。
req_md_files = ls artifacts/{app_name}/requirements/*.md

# Confluence URL 組み立て (skill 07 と同型):
#   pipeline-state.json.confluence.{requirements|design}.page_id は page ID 文字列のみ。
#   pipeline.yaml.confluence.url_template (schemas/pipeline-state.schema.json L198-242 で base URL/space は
#   保存されないため、本テンプレートが唯一の SoT) の `{page_id}` を置換して URL 化する。
url_template            = pipeline.yaml.confluence.url_template
confluence_req_page_id  = pipeline-state.json.confluence.requirements.page_id   (null / 未保存なら omit)
confluence_req_url      = url_template.replace("{page_id}", confluence_req_page_id) if confluence_req_page_id else null

# Phase 2: デザインシステム
# Phase 3: 画面デザイン (個別 HTML は Step 21 / 23 で既に提示済 + 数が多いため、retro では主要 docs と Figma URL のみ)
figma_url                  = ("https://www.figma.com/design/" + figma-state.json.file_key + "/?node-id=" + figma-state.json.page_id) if figma-state.json.file_key else null   # Step 23 と同形式 (canonical /design/{key}/?node-id={page_id})。schemas/figma-state.schema.json:23-30 で page_id は project Figma page の node_id、retro 段階でも特定 page を指す方が UX が良い
confluence_design_page_id  = pipeline-state.json.confluence.design.page_id      (null / 未保存なら omit)
confluence_design_url      = url_template.replace("{page_id}", confluence_design_page_id) if confluence_design_page_id else null

artifacts_to_review = [
  # Phase 1b 要件
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/{f}", label: "要件 · {f}" } for f in req_md_files,
  { kind: "external_url", abs_path: confluence_req_url, label: "Confluence (要件 親ページ)" } if confluence_req_url,
  # Phase 2 デザインシステム
  { kind: "md",   abs_path: "{artifacts_root_abs}/style-guide.md",               label: "スタイルガイド (MD)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/style-guide-view.html", label: "パーツカタログ (HTML)" },
  # Phase 3 画面
  { kind: "md",   abs_path: "{artifacts_root_abs}/screens/00-screen-list.md",    label: "画面一覧" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/00-transition-map.html", label: "遷移図 HTML" },
  { kind: "external_url", abs_path: figma_url, label: "Figma (画面 final)" } if figma_url,
  { kind: "external_url", abs_path: confluence_design_url, label: "Confluence (画面 親ページ)" } if confluence_design_url,
]
```

> 個別 8 要件ドキュメント / 各画面ドキュメントの Confluence ページ ID は `pipeline-state.json.confluence.{requirements|design}.doc_page_ids[name]` に格納されているが、親ページから子に navigate できるため retro 段階では親 1 件に集約する。必要なら同じ `url_template` の置換で個別 URL も生成可能。

shared helper Step 4 のフォーマットで link 一覧を表示。auto-open はなし (大量タブを避ける + Figma/Confluence は外部 URL のため `open` 対象外)。

#### Phase 0-B: 成果物一覧テキスト + 数値サマリー

Phase 0-A の link 一覧に続けて、以下のテキスト要約を表示する:

```
【{app_name} — 成果物一覧】

■ 要件定義（Phase 1）
  - requirements/01-overview.md 〜 08-constraints.md（8ファイル）
  - Confluence: {pipeline-state.confluence.requirements.doc_page_ids の各ページ URL}

■ デザインシステム（Phase 2）
  - design-brief.yaml / style-guide.md / tokens.json

■ 画面デザイン（Phase 3）
  - screens/00-screen-list.md / 00-transition-map.mmd (SSoT) + 00-transition-map.html (派生)
  - screens/01〜05（Web + Mobile 計10ファイル）
  - Figma: https://www.figma.com/design/{figma-state.file_key}/?node-id={figma-state.page_id}
  - Confluence: {pipeline-state.confluence.design.doc_page_ids の各ページ URL}

■ スコア
  要件定義: {scoring-history.attempts[-1].total}点 / 100点
  デザイン: {scores.current.total}点 / 100点
```

次に AskUserQuestion で最終承認を求める：

```
【最終承認ゲート 26】

全成果物が揃いました。内容を確認してください。

✅「承認」→ 振り返りフェーズ（Phase A〜H）へ進み、パイプライン改善を実施してから完了
✏️「修正: {内容}」→ 指定箇所を修正してから再度確認
🔄「デザインをやり直す」→ 08 デザインブレストからやり直す
```

- **承認** → Phase A へ進む
- **修正** → 該当箇所を修正後、Phase 0 の成果物一覧を再提示して再度承認を求める
- **やり直し** → skills/08-design-brainstorm/SKILL.md を Read して 08 から再実行

---

### Phase A: 学習収集

以下のファイルを全て読み込む：

1. `artifacts/{app_name}/feedback-log.md` — 会話中に記録された修正・指摘・設計変更（最重要）
2. `artifacts/{app_name}/scores.json` — デザイン採点結果・ループ履歴・AI/人間タグ
3. `artifacts/{app_name}/rubric.json` — 要件定義ルーブリック criteria 定義 (read only、ループ不変量)
4. `artifacts/{app_name}/scoring-history.json` — Phase 1b スコアリング attempt 履歴 (W4 設計判断、`pipeline.yaml.retro.input` 経由で正式入力)。`attempts[-1]` が最終結果、`attempts[]` 全体でスコア収束過程を分析。
5. `artifacts/{app_name}/wcag-history.json` — Phase 2 WCAG 違反 attempt 履歴 (W4 設計判断)。各 attempt の violations 推移をループ収束過程として参照。
6. `artifacts/{app_name}/pipeline-state.json` — cross-phase hot state (承認時刻 / 選択 / Confluence ID)。retro レポート出力用に各 phase のメタデータを参照する。
7. `artifacts/{app_name}/pending-questions.json` — Operating Principle 4 の未確定項目キュー。**Pattern D 集計用**: `entries[]` の全件 (resolved 含む) を読み、(a) `raised_by_step` ごとに件数集計、(b) `raised_by_role` (main / subagent) ごとに件数集計、(c) `resolved_at - raised_at` の経過時間中央値を算出 (long-lived UNCERTAIN = 設計欠陥のシグナル)。3 件以上が同じ raised_by_step に集中する場合は次回パイプライン改善対象として提案する (SKILL.md 内の Read 漏れ / pipeline.yaml constraints[P4-*] の applies_to 拡張 / agent.md の Contract 強化等)。ファイル不在の場合は Pattern D 集計をスキップし、その旨を retro レポートに記載。

8. `artifacts/{app_name}/requirement-deviations.json` — Operating Principle 4 **output 側監査リスト** (`pending-questions.json` = input 側 の対)。`entries[]` の全件 (resolved 含む) を読み、(a) `phase` (**requirements**/design/screens/delta/substate/reverse/reverse_verify) ごと、(b) `raised_by_step` ごと、(c) `deviation_kind` (要件外追加/根拠薄弱/想像デフォルト) ごと、(d) `resolution` (修正依頼/容認/要件に昇格/未resolved) ごと — `容認` はさらに `resolution_mode` (individual=個別判断 / bulk=一括容認 / 欠落=`resolution_mode` 導入前の記録なし) で内訳を出し、**bulk 率が高い = ゲートが一覧を 1 件ずつ裁きにくい形になっている疑い** として運用・導線の改善を提案する（⚠️ 個別 entry の `bulk` を「その 1 件を見ずに素通しした証拠」として読んではならない — 中身を確認したうえで一括で裁いた場合も `bulk` になる。読めるのは母数の大きい集計傾向までで、1 プロジェクト分の台帳は件数が少ないため断定でなく確認観点の提示にとどめる。読み取り射程の SoT = `docs/principle4-disambiguation.md` §5.5）、(e) **`self_bias_signal=true` の件数** (F-3b: requirements 層で生成側の誤申告/スキップを監査 subagent が catch した数。Sunset Condition の Pattern D 件数判定の主 metric) に件数集計する。**`容認`/`要件に昇格` が多い = 要件定義の粒度不足のシグナル / 同じ artifact・step に要件外追加が集中 = 生成 skill の補完癖**として、上流 (requirements) or 生成 skill の改善を提案する (input 側 item 7 と対称)。`raised_by_step` 3 件以上集中も pipeline 改善候補。ファイル不在なら集計スキップ + retro レポートに記載。

> **データ仕様参照（必読）**:
> 各入力ファイルのフィールド定義・必須項目・列挙値は以下の schema を参照する。本 skill のフィールド名解釈は schema を正とする。
>
> - `rubric.json` → [`/schemas/rubric.schema.json`](../../schemas/rubric.schema.json)
> - `scoring-history.json` → [`/schemas/scoring-history.schema.json`](../../schemas/scoring-history.schema.json)
> - `wcag-mapping.json` → [`/schemas/wcag-mapping.schema.json`](../../schemas/wcag-mapping.schema.json)
> - `wcag-history.json` → [`/schemas/wcag-history.schema.json`](../../schemas/wcag-history.schema.json)
> - `pipeline-state.json` → [`/schemas/pipeline-state.schema.json`](../../schemas/pipeline-state.schema.json)
> - `scores.json` → [`/schemas/scores.schema.json`](../../schemas/scores.schema.json)
> - `feedback-log.md` → [`/schemas/feedback-log.schema.md`](../../schemas/feedback-log.schema.md)
> - `pending-questions.json` → [`/schemas/pending-questions.schema.json`](../../schemas/pending-questions.schema.json)
> - `requirement-deviations.json` → [`/schemas/requirement-deviations.schema.json`](../../schemas/requirement-deviations.schema.json)
> - 全体データフロー → [`/docs/data-architecture/retro-data-pipeline.md`](../../docs/data-architecture/retro-data-pipeline.md)

`feedback-log.md` が空または存在しない場合：
> 「フィードバックログが記録されていません。CLAUDE.md 実行ルール6の記録が機能していませんでした。
> このセッションの振り返りは scores.json / scoring-history.json の数値のみになります（品質が低下します）。」
> と明示してから続ける。

---

### Phase B: パターン分析

収集した全学びを以下の観点で分類する：

```
各エントリについて:
1. 原因ステップ: どのパイプラインステップが根本原因か（step-NN）
2. 欠陥の種類:
   - 出力定義の欠如: 成果物として何を作るべきかが未定義
   - プロンプトの欠如: エージェントへの指示が不足
   - 制約の欠如: 禁止事項・必須事項が明示されていない
   - ヒアリング軸の欠如: 人間から引き出すべき情報を聞いていない
3. 防止可能性:
   - AI単独で防げた: プロンプトや出力定義の改善で次回から発生しない
   - 人間判断が必要: デザイン美学・ビジネス判断など、人間のレビューが本質的に必要
```

---

### Phase C: 改善提案生成

パターン分析の結果から、「AI単独で防げた」欠陥を中心に改善提案を生成する。

各提案は以下の **2ビュー構造** で作成する：

- **ユーザー向け要約**: Phase E でユーザーに表示する部分（非技術用語）
- **内部処理用**: Phase F で SKILL.md に自動適用するための diff レベル指示（ユーザーには表示しない）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
提案 #N
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【ユーザー向け要約】
問題:
  {何が起きたかを非技術用語で1-2行。内部ファイル名・スコア数値・実装用語は使わない}
次回からどう変わるか:
  {次回のパイプラインで何が改善されるかを非技術用語で1-2行}
優先度: 高 / 中 / 低

【内部処理用（ユーザー表示なし・Phase F 適用用）】
対象ファイル: skills/NN-name/SKILL.md
追加箇所: {ファイル内のどのセクションに追加するか}
追加内容:
  ---追加ここから---
  {実際に追加するテキスト}
  ---追加ここまで---
根拠: {どのフィードバックログのエントリ or スコアの減点から来ているか}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

提案の上限は **10件まで**。重要度順に並べ、それ以上は「次回セッションへ繰り越し」とする。

**ユーザー向け要約の書き方ガイド**:
- NG: 「`tokens.json` のalpha変数未定義でrgba直書き発生（Layer 0 -4pt）」 ← 内部ファイル名・スコア数値を露出
- OK: 「色の透明度指定が統一されておらず、デザイントークンとズレていた」 ← 現象のみ非技術用語で
- NG: 「WCAG font-size/min-height違反がHTML生成後に発覚」 ← 専門用語を前提
- OK: 「アクセシビリティ基準（文字サイズ・タップ領域）を満たさないUIが生成された」 ← 結果のみ

---

### Phase D: 数値サマリー表示

改善提案の前に、今セッションの数値結果を表示する：

```
【{app_name} — パイプライン実行結果サマリー】

■ 要件定義フェーズ
  最終スコア: {scoring-history.attempts[-1].total}点 / 100点
  ループ回数: {len(scoring-history.attempts)}回
  {len(attempts) >= max_attempts AND attempts[-1] が pass 未達 なら「⚠️ エスカレーション: スコア未達で人間判断」}

■ WCAG 検証ループ（Phase 2）
  ループ回数: {len(wcag-history.attempts)}回
  最終 violations: {len(wcag-history.attempts[-1].violations)}件
  {0件なら「✅ AA 準拠」、>0件なら「⚠️ 残違反あり (10 で人間判断)」}

■ デザインフェーズ
  最終スコア: {scores.current.total}点 / 100点
  ループ回数: {scores.attempt_count}回
  Layer 1（技術）: {layer1.score}点 / 40点
  Layer 2（UX）: {layer2.score}点 / 30点
  Layer 3（デザイン）: {layer3.score}点 / 30点
  {escalated なら「⚠️ エスカレーション: AI改善限界」}

■ フィードバックログから拾った学び: {feedback-log.md のエントリ数}件
  AI単独で防げた: {件数}件 → パイプライン改善提案 {N}件を生成
  人間判断が必要だった: {件数}件 → 次回人間ゲートで確認
```

---

### Phase E: 人間承認ゲート（2段階）

**全提案の「ユーザー向け要約」のみ** を**箇条書き形式**でまず一括表示する。内部処理用（対象ファイル・追加箇所・diff）は**表示しない**。

> **重要（表示形式）**:
> - markdown テーブルは CLI 出力で長文セルが崩れる。**テーブル形式は使用禁止**。
> - 必ず以下の箇条書き形式で表示すること。

#### ステップ E-1: 提案一覧をテキスト表示

まずプレーンテキストで提案一覧を表示する（AskUserQuestion は使わない）:

```
【パイプライン改善提案 — 承認フェーズ】

以下の {N} 件の改善提案が生成されました。

#1 [優先度: 高]
  問題: {ユーザー向け要約: 問題}
  変化: {ユーザー向け要約: 次回からどう変わるか}

#2 [優先度: 中]
  問題: {ユーザー向け要約: 問題}
  変化: {ユーザー向け要約: 次回からどう変わるか}

...
```

#### ステップ E-2: 扱い方を AskUserQuestion で問う（択一）

上記の表示直後に、AskUserQuestion で**択一の大枠の選択**を求める:

```
質問: 上記の {N} 件の提案をどう扱いますか？
選択肢:
  1. 一括承認  — 全件そのまま適用
  2. 個別指示  — 一部の提案を却下 or 修正したい（次ステップでチャット入力）
```

- **「1. 一括承認」が選ばれた** → 全提案を承認扱いとし、Phase F へ進む
- **「2. 個別指示」が選ばれた** → ステップ E-3 へ進む

#### ステップ E-3: 個別指示をチャット入力で受け取る（E-2 で「個別指示」選択時のみ）

AskUserQuestion は使わず、以下のテキストを表示してチャット返信を待つ:

```
以下のいずれかの形式でチャットに返信してください（`#N` は提案番号のプレースホルダ。実際の番号に置き換えて入力）:

- 「#N を却下」
- 「#N を {新しい問題文 or 変化文} に修正」
- 複合指示例: 「#N を {修正内容} に修正、#M を却下、残り承認」

指示されなかった提案は承認扱いとする。
```

**チャット返信を受けた後の処理**:

1. 各提案のステータスを解釈する（承認 / 修正 / 却下）
2. 解釈結果を**テキストで復唱してユーザーに確認**する（提案番号は実際の番号で表示。例: 3件の提案がある場合「以下の解釈で適用します: #1 承認、#2 却下、#3 承認。よろしいですか？」）
3. 曖昧な場合や複数の解釈が可能な場合は、再度テキストで確認を求める（**AskUserQuestion は使わない**）
4. ユーザー確認後、Phase F へ進む

**内部処理用の情報は Phase F で初めて参照する**（ユーザーに見せず、Edit 実行時に使用）。

---

### Phase F: 承認済み提案の適用（修正）

承認された提案を **Edit ツールで直接 skills/NN-name/SKILL.md に書き込む**。

適用ルール：
- 1提案 = 1回の Edit 操作（複数箇所への変更は複数 Edit）
- Edit 失敗（old_string が見つからない等）は「適用失敗: {理由}」と記録してスキップ
- 修正指示があった場合は修正内容を反映してから Edit する

---

### Phase G: レビュー

適用が完了したら、変更内容をレビュー表示する：

```
【適用結果レビュー】

✅ 適用済み ({N}件):
  - 提案 #1: skills/08-design-brainstorm/SKILL.md にUI表現制約ヒアリング軸を追加
  - 提案 #2: skills/12-design-system/SKILL.md に数値フォントトークン定義を追加
  ...

❌ 却下 ({N}件):
  - 提案 #X: {タイトル}（理由: ユーザー却下）

⚠️ 適用失敗 ({N}件):
  - 提案 #Y: {タイトル}（理由: {技術的エラー}）
```

変更したファイルを実際に Read して、変更が正しく反映されているか確認する。
反映が正しくない場合は再度 Edit で修正する。

---

### Phase H: レポート生成

`artifacts/pipeline-improvements.md` を作成（または追記）する。
**「ユーザー向けサマリー」と「エンジニア向け詳細」の二部構成**にすること。

```markdown
# パイプライン改善レポート

**セッション日時**: {today}
**対象アプリ**: {app_name}
**要件定義スコア**: {scoring-history.attempts[-1].total}点 / **デザインスコア**: {scores.current.total}点

---

## サマリー（ユーザー向け）

Confluence や共有ドキュメントへ貼り付けるための要約。非技術用語のみ使用。

| # | 問題 | 次回からどう変わるか | 優先度 | 状態 |
|---|---|---|---|---|
| 1 | {ユーザー向け要約: 問題} | {ユーザー向け要約: 次回からどう変わるか} | 高 | 適用済 |
| 2 | ... | ... | 中 | 却下 |
...

### 見送り・繰り越し

| # | 問題 | 理由 |
|---|---|---|
| N | {ユーザー向け要約: 問題} | 却下 / 適用失敗 / 優先度低で繰り越し |

### 次回パイプラインへの引き継ぎ事項

{人間判断が必要だった学びのうち、次回ヒアリングや承認ゲートで確認すべき事項 — 非技術用語}

---

## 詳細（エンジニア向け・内部記録）

実際にどのスキルファイルにどの内容を追記したかの diff レベル記録。Confluence には貼らない。

### 改善 #1: {タイトル}
- **対象**: skills/NN-name/SKILL.md
- **追加箇所**: {セクション名}
- **適用内容**: {実際に追加・変更したテキストの要約 or 全文}
- **根拠**: {feedback-log のエントリ or スコア減点}

{以降 #N まで繰り返し}

### 適用失敗・却下の内部記録

| # | 対象ファイル | 状態 | 詳細 |
|---|---|---|---|
| N | skills/NN-name/SKILL.md | 却下 / 適用失敗 | {Edit エラー内容 or ユーザー却下理由} |
```

**Confluence 等の外部共有ドキュメントへの貼り付けは「サマリー」セクションのみとし、「詳細」セクションは公開しない**（ユーザー環境外に内部ファイルパスや実装指示を露出させないため）。

---

---

### Phase I: メモリ・ヒストリ更新

Phase H 完了直後に必ず実行すること。次回セッションの品質はここで書かれた内容に依存する。

Read and execute `skills/00-memory-write/SKILL.md`.

---

## 承認後（Phase I 完了後）

「AYATORIパイプラインが完了しました。
成果物は artifacts/ に、パイプライン改善レポートは artifacts/pipeline-improvements.md に保存されています。
適用された改善は次回パイプライン実行から有効です。」

と表示してパイプラインを終了する。
