---
name: 03-rubric-gen
description: ISO 29148 の 5 品質属性をベースに、このアプリ固有の評価ルーブリック (criteria ごとに checks 4 件) を生成する。Phase 1b の Step 03 で実行され、後続の Step 04 スコアリングのループ不変量 (rubric.json) を定義する。
---

# 3 ルーブリック生成

## 役割
ISO 29148の5品質属性をベースに、このアプリ固有の評価ルーブリックを生成する。

## エージェントプロンプト

このステップを実行するとき、以下のプロンプトを自分自身への指示として適用すること。

---

**あなたは ISO/IEC/IEEE 29148:2018 に精通した品質評価アーキテクトです。**

このアプリ固有の評価ルーブリックを設計してください。汎用的なテンプレートを埋めるのではなく、**このアプリの文脈でしか意味をなさない評価基準**を書くことが目標です。

### 良いルーブリックの条件

**NG（汎用的すぎる）:**
- 「要件が明確に定義されているか」
- 「技術スタックが整合しているか」

**OK（このアプリ固有）:**
- 「HeyGen APIのカスタムアバター生成フローが、テキスト原稿→アバター選択→動画出力の3ステップとして一義的に定義されているか」
- 「KMP/CMPのWeb+モバイル同時対応がPoC1ヶ月のスコープ内で実現可能かどうか、初期セットアップ工数を含めて評価されているか」

### checks（サブルーブリック）の必須要件

各 criteria には `checks` 配列を **必ず4件** 生成する（4 × 5点 = 軸 weight 20点）。

**良い check の条件:**
- **単一観点**: yes / partial / no で判定可能な、観点が1つの問い
- **検証可能**: 採点者がファイルの該当箇所を読めば判断できる（主観に頼らない）
- **このアプリ固有**: アプリ名・機能ID・API名・数値が question に登場している

**NG な check（複数観点を「かつ」で繋いでいる）:**
- 「全UCにアクターが記載され、かつ非機能要件に数値閾値があるか」← 2観点を1つにまとめている

**OK な check（観点1つ・検証可能・固有性あり）:**
- 「`04-use-cases.md` の UC-01〜UC-05 全てに『アクター』フィールドが記載されているか」
- 「`05-features.md` F-02 動画生成の出力フォーマット（解像度・fps・コーデック）が数値で明示されているか」

### ルーブリック生成の思考順序

ルーブリックを作る前に、まず `artifacts/{app_name}/requirements/05-features.md` の Must 機能を一覧し「このアプリで最も複雑な実装上のリスクはどこか」を特定する。そのリスクが高い箇所を `description` と `checks[].question` に反映することで、ルーブリックがこのアプリ固有の評価ツールになる。

各軸について次の順序で設計する：
1. `description` に高レベル評価観点を1〜2文で書く
2. その軸で確認すべき**最重要観点を4つ**抽出する（重複させない／このアプリ固有である）
3. 各観点を `checks[].question` として yes/partial/no で判定可能な形に書き下す
4. `doc_targets` に判定に必要なファイルだけを列挙する

生成した checks を読んで「このアプリを知らない開発者がこの check だけを見て採点できるか」と自問する。採点者が迷う記述は具体化が不十分。

### ルーブリック ロック規則（重要）

**ルーブリックは attempt 0 の初回生成で凍結する。それ以降のループでは再生成しない。**

理由: attempt ごとに `checks[].question` や `description` を書き換えると、
scoring-history.html の推移が「スペック改善」なのか「ルーブリックが緩んだ」ためか区別不能になり、スコア比較の一貫性が失われる。
同じ物差しで測り続けることが、ループの意義（改善の可視化）を成立させる。

そのため、ループ再実行時は「前回 deficiencies を反映して check を書き換える」ような操作を**行わない**。
前回指摘への対応は ②（iso-breakdown）が本文を直して解消するのが正道で、③ はルーブリックを固定したままそれを測り続ける役割。

---

## 実行指示

### Step 0: ロック判定（最初に実施）

`artifacts/{app_name}/rubric.json` を Read し、`criteria` を確認する。

```
if criteria is not empty:
    # ロック済み。このステップをスキップ。
    「ルーブリックは attempt 0 で確定済みのため、再生成をスキップします（スコア比較の一貫性維持）。」と表示
    → rubric.json は変更せず、このスキルを終了する
else:
    # 初回生成 or criteria が空 → 通常フローへ進む（以下の Step 1）
```

注: 旧版の attempt_count 判定 (`attempt_count >= 1`) は廃止。attempt_count は `scoring-history.json.attempts` の長さから導出される値であり、rubric.json には保持しない。ロック判定は criteria の有無のみで行う。

### Step 1: 要件把握

`artifacts/{app_name}/requirements/05-features.md` を読んで Must 機能一覧を把握し、最も複雑な実装リスクを特定する。
次に `artifacts/{app_name}/requirements/01-overview.md`、`02-scope.md`、`03-user-flow.md`、`04-use-cases.md`、`06-non-functional.md`、`07-data-definition.md`、`08-constraints.md` の7ファイルを続けて読んで全体像を把握する。

### 出力するルーブリックの要件
- 各軸20点満点（合計100点）
- `description` はこのアプリの文脈に合わせた高レベル評価観点を記載する
- `checks` 配列を**必ず4件**生成する。各 check の `max_points` は 5（合計 4×5=20）
- `description`・`checks[].question` には「{ファイル名} の {具体的な箇所}」という形式で評価観点を明示する
- `checks[].doc_targets` には判定に必要な要件ファイルのみを列挙する
- **初回生成時のみ書き込む**: `app_name` と `criteria` のみ。state field (`attempt_count` / `scores` / `total` / `check_results` / `deficiencies` / `ai_improvable_count` / `human_required_count` / `escalated`) は本ファイルに **持たない** (schemas/rubric.schema.json 参照)。これらは scoring-history.json の attempts[-1] から参照する。
- **scoring-history.json 初期化**: rubric.json と同じタイミングで `artifacts/{app_name}/scoring-history.json` を `{"app_name": "{app_name}", "attempts": []}` で初期化する (④ が後続で append する空箱)。既に存在する場合は触らない。


## 出力例

```json
{
  "criteria": [
    {
      "axis": "correctness",
      "weight": 20,
      "description": "05-features.md の各機能の技術スタック指定が実現可能か。07-data-definition.md の外部API定義が実在するサービスを指しているか",
      "checks": [
        {
          "id": "correctness-C1",
          "question": "05-features.md の各 Must 機能が 01-overview.md の課題ステートメントとトレーサブルに対応しているか（課題に紐付かない機能が含まれていないか）",
          "max_points": 5,
          "doc_targets": ["01-overview.md", "05-features.md"]
        },
        {
          "id": "correctness-C2",
          "question": "07-data-definition.md で参照される外部 API のエンドポイント名・命名が、公式ドキュメントの命名と一致しているか",
          "max_points": 5,
          "doc_targets": ["07-data-definition.md"]
        },
        {
          "id": "correctness-C3",
          "question": "08-constraints.md で指定された技術スタックが、想定機能群を実装するために必要十分かつ整合しているか",
          "max_points": 5,
          "doc_targets": ["08-constraints.md", "05-features.md"]
        },
        {
          "id": "correctness-C4",
          "question": "06-non-functional.md の性能・可用性指標が、05-features.md の機能要件と矛盾しない範囲で設定されているか",
          "max_points": 5,
          "doc_targets": ["05-features.md", "06-non-functional.md"]
        }
      ]
    },
    {
      "axis": "completeness",
      "weight": 20,
      "description": "04-use-cases.md の各UCにアクターと後条件が記述されているか。08-constraints.md に受け入れ条件がテスト可能な粒度で記述されているか",
      "checks": [
        {
          "id": "completeness-C1",
          "question": "04-use-cases.md の全 UC に『アクター』『事前条件』『主フロー』『後条件』の4項目が記載されているか",
          "max_points": 5,
          "doc_targets": ["04-use-cases.md"]
        },
        {
          "id": "completeness-C2",
          "question": "03-user-flow.md のエラーケース表に外部 API 障害時のリトライ方針・ネットワーク断時の下書き保持が網羅されているか",
          "max_points": 5,
          "doc_targets": ["03-user-flow.md"]
        },
        {
          "id": "completeness-C3",
          "question": "08-constraints.md の受け入れ条件が、各々テスト可能な数値・成功判定基準を持つか",
          "max_points": 5,
          "doc_targets": ["08-constraints.md"]
        },
        {
          "id": "completeness-C4",
          "question": "06-non-functional.md にセキュリティ方針（HTTPS・TLS・API キー保管方法）とデータ保持期間が記述されているか",
          "max_points": 5,
          "doc_targets": ["06-non-functional.md"]
        }
      ]
    }
  ]
}
```

`artifacts/{app_name}/rubric.json` の `app_name` と `criteria`（`checks` を含む）を保存する。
合わせて `artifacts/{app_name}/scoring-history.json` を `{"app_name": "{app_name}", "attempts": []}` で初期化する (既存ファイルがあれば触らない)。

## 完了後

「ルーブリックを生成しました。スコアリング履歴を初期化しました。」と表示
