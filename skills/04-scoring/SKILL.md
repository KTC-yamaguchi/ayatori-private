---
name: 04-scoring
description: 構造化要件をルーブリックで採点し、各軸のスコアと合計を算出する。Phase 1b の Step 04 で呼ばれ、scoring-history.json への attempt 追記と 2 種の HTML レポートを生成する。
---

# 4 AI採点

## 役割
構造化要件をルーブリックで採点し、各軸のスコアと合計を算出する。算出結果は **3 つの成果物**として artifact ディレクトリに書き出す。

## 成果物（必須 3 ファイル）

このステップは以下の **3 ファイル全てを生成して初めて完了**となる。JSON だけ書いて終わるのは未完了扱い。「出力 1」「出力 2」のどちらか欠けたら step 04 は失敗とみなし、**欠落した成果物に応じて該当する出力セクション (出力 1 または出力 2) を再実行**すること。

| # | ファイル | 由来セクション |
|---|---|---|
| 1 | `artifacts/{app_name}/scoring-history.json` (attempt を 1 件 append) | 「出力 1」 |
| 2 | `artifacts/{app_name}/scoring-dashboard.html` (単回レポート) | 「出力 2」 |
| 3 | `artifacts/{app_name}/scoring-history.html` (履歴レポート) | 「出力 2」 |

> **過去の不具合**: 「出力 1」 (旧名: 「出力」) の `scoring-history.json` への append を済ませた時点で task 完了と誤認し、続く HTML 2 種の生成が skip されるケースが発生していた。本 step を実行するときは「## 完了後」セクションの自己検証チェックリストで 3 ファイル全て存在することを必ず自己検証してから完了報告すること。

## エージェントプロンプト

このステップを実行するとき、以下のプロンプトを自分自身への指示として適用すること。

---

**あなたは厳格な要件品質監査人です。**

ルーブリックの基準に基づき、要件仕様書を公正・厳格に採点してください。

### 採点の思考順序（必ずこの順序で実行する）

採点は **check 単位** で行う。`criteria[].description` の高レベル評価観点ではなく、その下の `checks[]` 配列を1件ずつ判定し、その合計から軸スコアを導く。

Step 1: `rubric.json` の各 `criteria[].checks[]` をすべて列挙し、判定対象の `question` を確認する。各 check の `doc_targets` を読み、判定に必要な該当箇所を把握する。

Step 2: 各 check について、`doc_targets` の該当箇所を読んで以下の3値で判定する：
- `yes`: question の全要件が完全に満たされている → `awarded_points = max_points`（=5）
- `partial`: 一部のみ満たされている、または満たされているが軽微な不足あり → `awarded_points = floor(max_points / 2)`（=2）
- `no`: 満たされていない、または該当記述がない → `awarded_points = 0`

Step 3: 各 check の判定根拠を `evidence` フィールドに一文で記録する（「{ファイル名} {行・節} で {観察事実}。よって {verdict}」の形式）。

Step 4: 各軸の `scores.{axis}` を、その軸に属する check の `awarded_points` 合計として算出する。`total` を全軸の合計として算出する。

Step 5: `partial` または `no` と判定した各 check に対し、対応する `deficiency` を1件以上記録する。`deficiency.check_id` でどの check の不合格に対応するかを明示する。

**スコアを先に決めて根拠を後から書くこと、check の判定をスキップして直接スコアを書くことは禁止。** check は必ず1件ずつ評価し、`check_results` に判定を残すこと。

### 採点の原則

**甘く採点しない。** 要件仕様書の目的は「開発チームが迷わず実装できること」。
少しでも曖昧さや不足があれば `partial` 以下に判定する。中間に寄せる癖を抑制すること。

**`partial` の使用は厳格に。** check の question が複数の小要件を含むとき、その**過半数**が満たされていれば `partial`、過半数未満なら `no`。「だいたい書いてある」だけで `partial` をつけない。

**`evidence` に必ず一次根拠を書く。**
「`05-features.md` L42-58 で F-02 動画生成の出力フォーマットを記述しているが、解像度（720p/1080p）の選択肢のみで fps・コーデックが未指定。よって partial」のように、
ファイル・行（または節タイトル）・観察事実・判定の4要素を入れる。

**良い deficiency の書き方:**
- NG: 「フローの記述が薄い」→ 何のフローが？どれくらい薄い？どう書けば良い？
- OK: 「`05-features.md` F-02 動画生成の出力フォーマットで、解像度（720p/1080p）は記述されているが fps・コーデックが未指定。HeyGen デフォルト採用か明示するか指定するかが開発判断にゆだねられている」

**NG（忖度採点）:**
- 「大体書いてあるので yes」
- 「PoC なので多少曖昧でも partial」→ PoC だからこそ判断基準を明確にする必要がある

---

## 実行指示

`artifacts/{app_name}/requirements/01-overview.md` 〜 `08-constraints.md` の全8ファイルを読み込む。
`artifacts/{app_name}/rubric.json` を読み込み、`criteria[].checks[]` を取得する (read-only)。
`artifacts/{app_name}/scoring-history.json` を読み込み、`attempts` 配列の長さから現在の `attempt_count` を導出する (`attempt_count = len(attempts)`、初回は 0)。
`attempt_count >= 1` の場合は `artifacts/{app_name}/requirements/00-raw-input.md` も読み込む（下記「追加スイープ」で使用）。

各 check に対して以下を実行する：
1. `doc_targets` に列挙されたファイルの該当箇所を読む
2. `question` に対し `yes` / `partial` / `no` を判定
3. `evidence` に判定根拠を一文で記録
4. `awarded_points` を verdict から導出（yes → max_points / partial → floor(max_points/2) / no → 0）
5. `partial` または `no` の場合は対応する `deficiency` を追加し、`check_id` で紐付け
6. 各 deficiency に **AI/人間タグ** を付与する（下記ルール参照）

全 check 評価後、軸別スコアと合計を集計する：
- `scores.{axis}` = その軸の全 check の `awarded_points` 合計
- `total` = `scores` 全軸の合計

その後、**追加スイープ（原意ドリフト）を実行**（`attempt_count >= 1` の場合のみ、下記セクション）。

最後に deficiency カウントを集計する：
- `ai_improvable_count` = `tag` が `AI改善可能` の deficiency 件数（ドリフト分を含む）
- `human_required_count` = `tag` が `人間対応必要` の deficiency 件数（ドリフト分を含む）

---

### 追加スイープ: 原意ドリフトチェック（attempt_count >= 1 のみ）

ループで ② が本文を再生成するうち、ユーザーの最初の意図（`00-raw-input.md`）から乖離していないかを確認する安全網。
ルーブリックは locked のためスコアには影響させないが、deficiency として記録してループ制御に反映する。

**手順:**

1. `00-raw-input.md` からユーザーが明示した Must / Should 機能、および明示的な「対象外」宣言を抽出する。
2. `05-features.md` の現在の Must / Should 機能一覧と照合する。
3. 以下のいずれかを検出した場合、`deficiency` を追加する:

| ドリフトの種類 | 記録する deficiency の issue 形式 | severity |
|---|---|---|
| 原意の Must 機能が 05-features.md から欠落 | 「原意ドリフト: 00-raw-input.md の Must『{機能名}』が 05-features.md に存在しない」 | high |
| 原意の Must 機能が Should 以下に格下げ | 「原意ドリフト: 00-raw-input.md で Must とされた『{機能名}』が {現在の優先度} に格下げされている」 | high |
| 原意の Must 機能の範囲が明確に縮小 | 「原意ドリフト: 00-raw-input.md の『{機能名}』の範囲が {旧定義} から {新定義} に縮小されている」 | medium |
| 原意で「対象外」とした機能が features に追加 | 「原意ドリフト: 00-raw-input.md で対象外宣言された『{機能名}』が 05-features.md に追加されている」 | medium |

**共通フィールド:**
- `axis`: `"correctness"`（原意とのトレーサビリティは correctness の範疇）
- `doc`: `"05-features.md"`（修正対象ファイル）
- `check_id`: `"drift"`（ルーブリックの check ではないことを明示する固定値）

**タグルール（ドリフト専用）:**

| 条件 | tag | tag_reason |
|---|---|---|
| high severity のドリフト件数 >= 1 | `人間対応必要` | スコープ縮小が意図的か否かステークホルダー確認が必要 |
| medium のみ、かつ 2件以下 | `AI改善可能` | ②が次ループで 05-features.md を原意に戻せる |
| medium のみ、かつ 3件以上 | `人間対応必要` | 広範なドリフトは意図的な再スコープの可能性が高い |

**スコアへの影響:**
- `scores` / `total` / `check_results` / `awarded_points` には一切反映しない（ルーブリックは locked）
- `deficiencies` 配列にのみ追加する → ⑤ の分岐で `human_required_count` として拾われる
- Projection（`PROJECTED_AI_ONLY` / `PROJECTED_FULL`）にも反映しない。ドリフトはスコアではなく「loop 制御」で扱う意思決定情報

ドリフトが 1 件も検出されなかった場合はこのスイープを黙ってスキップする（deficiency を追加しない）。

### AI/人間タグ付与ルール

各 deficiency に `tag` フィールドを付与する。詳細は `refs/ai-human-tag-rules-v0.1.md` 参照。

**軸別デフォルトタグ:**

| 軸 | デフォルト | 理由 |
|---|---|---|
| correctness | AI改善可能 | 課題と要件のトレースは ② が再生成で解消可能 |
| unambiguity | AI改善可能 | 曖昧語の定量化・閾値追加は ② が対応可能 |
| completeness | AI改善可能 | UC・データ項目の漏れは ② が穴埋め可能 |
| consistency | AI改善可能 | 用語揺れ・ファイル間矛盾は ② が機械的に解消可能 |
| feasibility | **人間対応必要** | スケジュール・予算・体制はステークホルダー確認が前提 |

**デフォルトを上書きするケース（どの軸でも適用）:**

| 条件 | タグ | 理由 |
|---|---|---|
| 同一 deficiency が **3回ループしても未解消** | 人間対応必要 | AI が解決できないことが実証済み |

> これが唯一の上書きルール。`attempt_count >= 3` かつ前回と同一の deficiency が残っている場合に適用。⑤ の最大試行回数（3回）と一致させている。

**タグ付け手順:**
1. deficiency の `axis` から上記デフォルトタグを引く
2. 上書きケースに該当しないか確認、該当すれば差し替え
3. `deficiency.tag` に `AI改善可能` または `人間対応必要` を記録
4. 上書き時は `deficiency.tag_reason` に理由を記録

### Verdict → awarded_points 変換表（max_points = 5 の場合）

| verdict | 意味 | awarded_points |
|---|---|---|
| `yes` | question の全要件が完全に満たされている | 5 |
| `partial` | 過半数の要件が満たされているが軽微な不足あり | 2 |
| `no` | 過半数未満、または該当記述がない | 0 |

## 出力 1: scoring-history.json への append

> このセクションは **成果物 3 ファイル中の 1 件目**。これを書いただけでは step 04 は未完了。続けて「出力 2」 の HTML 2 種を必ず生成すること。

`artifacts/{app_name}/scoring-history.json` の `attempts` 配列に **今回の attempt を 1 件 append** する。

> **重要:** `rubric.json` には書き込まない (criteria 定義のみのファイル、read-only)。本 step が書く JSON は `scoring-history.json` のみ (HTML 出力は 「出力 2」 で別途生成する)。Edit で `attempts` 配列の末尾に新規 attempt オブジェクトを差し込むこと (Write による全面再作成は禁止)。

append する attempt オブジェクトの形:

```json
{
  "attempt_count": 0,
  "timestamp": "2026-05-08T12:34:56Z",
  "total": 80,
  "scores": {
    "correctness": 17,
    "unambiguity": 12,
    "completeness": 15,
    "consistency": 20,
    "feasibility": 16
  },
  "check_results": [
    {
      "check_id": "correctness-C1",
      "axis": "correctness",
      "verdict": "yes",
      "awarded_points": 5,
      "evidence": "07-data-definition.md L23-30 で外部 API エンドポイントを参照、公式 API ドキュメントの命名と一致"
    },
    {
      "check_id": "correctness-C2",
      "axis": "correctness",
      "verdict": "partial",
      "awarded_points": 2,
      "evidence": "07-data-definition.md L40-55 で API 一覧を提示、必須リクエストパラメータは記述されているが、レスポンス構造が一部未記載。よって partial"
    },
    {
      "check_id": "unambiguity-C1",
      "axis": "unambiguity",
      "verdict": "no",
      "awarded_points": 0,
      "evidence": "06-non-functional.md および 05-features.md F-02 で動画出力フォーマットの解像度・fps・コーデックがいずれも未指定"
    }
  ],
  "ai_improvable_count": 2,
  "human_required_count": 0,
  "deficiencies": [
    {
      "axis": "correctness",
      "doc": "07-data-definition.md",
      "issue": "外部 API 一覧で必須リクエストパラメータは記述されているが、レスポンス構造の半数が TBD のまま",
      "severity": "medium",
      "check_id": "correctness-C2",
      "tag": "AI改善可能"
    },
    {
      "axis": "unambiguity",
      "doc": "05-features.md",
      "issue": "F-02 動画生成の出力フォーマット（解像度・fps・コーデック）が未指定",
      "severity": "high",
      "check_id": "unambiguity-C1",
      "tag": "AI改善可能"
    }
  ]
}
```

- `attempt_count` は append 前の `len(attempts)` (0 始まり、配列 index と一致)
- `timestamp` は ISO 8601 (実行時の現在時刻)
- 旧 rubric.json に書いていた `escalated` フラグは保持しない (`len(attempts) >= max_attempts AND attempts[-1] が pass 未達` で導出する)

**deficiency フィールド説明:**
- `axis`: ISO 29148 の5品質属性（correctness / unambiguity / completeness / consistency / feasibility）
- `doc`: 問題が存在するファイル名（例: `04-use-cases.md`）— ② がループ時に重点修正するために使用
- `issue`: 何が、どのファイルのどの箇所で、どのように不足しているかを一文で記述
- `severity`: `high`（軸スコアを `no` 判定相当に下げる）/ `medium`（`partial` 判定相当）/ `low`（スコアに影響しない・次回ループ参考情報）
- `check_id`: 対応する `criteria[].checks[].id`。または `"drift"`（原意ドリフトスイープ由来の deficiency。ルーブリックの check には含まれない）
- `tag`: `AI改善可能` — ② が自動修正可能 / `人間対応必要` — ステークホルダー確認が必要
- `tag_reason`: デフォルトタグを上書きした場合のみ記録（上書き理由）

**check_results フィールド説明:**
- `check_id`: `criteria[].checks[].id` を参照
- `verdict`: `yes` / `partial` / `no`
- `awarded_points`: verdict から導出される点数（変換表参照）
- `evidence`: 判定根拠（ファイル名・該当箇所・観察事実・判定理由）

## 出力 2: HTML レポート 2 種の生成 (必須)

> このセクションは **成果物 3 ファイル中の 2・3 件目**。「出力 1」の JSON append を終えた直後に、**続けて** 必ず実行する。「採点が終わったから完了」と判断して JSON だけ書いて止まることは禁止。`attempt_count` が 0 (初回) の場合も必ず実行する。

採点結果を `scoring-history.json.attempts[]` に append した後 (「出力 1」と同一処理。ここで再度 append しない)、決定論 renderer を実行する:

```bash
node scripts/render-scoring-report.mjs artifacts/{app_name}/scoring-history.json
```

script が以下 3 ファイルを **全量再生成** する。LLM は HTML を手で書かない・既存 HTML を Edit しない (派生 HTML の正本は script — `render-deviations-view.mjs` / `render-color-report.mjs` と同じ「派生物は決定論生成 (手焼き禁止)」方針。2 回目以降の attempt もマーカー間 Edit 挿入ではなく全量再生成される):

- `artifacts/{app_name}/scoring-dashboard.html` — 最新 attempt (`attempts[-1]`) の単回レポート
- `artifacts/{app_name}/scoring-history.html` — 全 attempt の推移 (attempt が 4 件以上でも列数を自動調整)
- `artifacts/{app_name}/scoring.css` — `skills/04-scoring/templates/scoring.css` の複写 (毎回上書き)

HTML 骨格・デザインの SoT は `skills/04-scoring/templates/` の `.template` 2 種 + `scoring.css` (script は実行時に Read してプレースホルダーを埋めるだけ。テンプレートファイル自体は改変しない)。

**stderr の検算警告**: script は `scores` / `total` / `ai_improvable_count` / `human_required_count` を `check_results` / `deficiencies` から再計算し、保存値と食い違うと `検算警告` を stderr に出す (描画は保存値のまま = JSON が SoT)。警告が出た場合は「出力 1」で書いた採点データ側の集計ミスなので、`scoring-history.json` の当該 attempt を修正してから script を再実行する。警告を放置して次 step へ進まない。

**exit code**: `0` = 成功 (検算警告のみでも 0) / `1` = 入力不正 (JSON 解析失敗・`attempts` が空)。exit 1 は「出力 1」が正しく完了していない兆候なので、JSON append からやり直す。

## 完了後

### 自己検証 (必須)

完了報告の前に、以下の **3 ファイルが全て存在することを確認** する。1 つでも欠けていれば step 04 は未完了。該当セクションに戻って生成し直すこと。

- [ ] `artifacts/{app_name}/scoring-history.json` (今回 attempt が append されている)
- [ ] `artifacts/{app_name}/scoring-dashboard.html` (今回の script 実行で再生成されている)
- [ ] `artifacts/{app_name}/scoring-history.html` (今回の script 実行で再生成されている)

3 ファイル全てを確認できたら、以下を表示する：

```
採点完了。合計 {total} 点。
レポート: artifacts/{app_name}/scoring-dashboard.html
履歴:     artifacts/{app_name}/scoring-history.html
```
