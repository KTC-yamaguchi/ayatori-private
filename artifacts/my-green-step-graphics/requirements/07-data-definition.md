# 07 データ定義

本ドキュメントは ISO/IEC/IEEE 29148:2018 に準拠し、MyGreenStep アプリのデータ構造・API を定義する。

---

## 7.1 エンティティ定義

### User（ユーザー）

| フィールド名 | 型 | 必須/任意 | 説明 |
|-------------|-----|----------|------|
| id | UUID | 必須 | ユーザーの一意識別子（自動生成） |
| email | String(255) | 必須 | メールアドレス（一意制約） |
| password_hash | String(255) | 必須 | bcrypt でハッシュ化されたパスワード |
| display_name | String(50) | 任意 | 表示名 |
| email_verified | Boolean | 必須 | メール確認済みフラグ（初期値: false） |
| is_survey_completed | Boolean | 必須 | 初回アンケート完了フラグ（初期値: false） |
| created_at | Timestamp | 必須 | 登録日時 |
| updated_at | Timestamp | 必須 | 最終更新日時 |

### SurveyResponse（アンケート回答）

| フィールド名 | 型 | 必須/任意 | 説明 |
|-------------|-----|----------|------|
| id | UUID | 必須 | 回答の一意識別子 |
| user_id | UUID（FK: User.id） | 必須 | 回答したユーザー |
| question_key | String(50) | 必須 | 質問の識別キー（例: housing_type, transport_mode） |
| answer_value | String(255) | 必須 | 回答内容 |
| created_at | Timestamp | 必須 | 回答日時 |
| updated_at | Timestamp | 必須 | 更新日時（再回答時） |

**質問キーの例:**

| question_key | 説明 | 選択肢例 |
|-------------|------|---------|
| housing_type | 住居形態 | 一戸建て / マンション / アパート |
| household_size | 世帯人数 | 1人 / 2人 / 3人 / 4人以上 |
| transport_mode | 主な移動手段 | 自家用車 / 公共交通機関 / 自転車 / 徒歩 |
| diet_type | 食生活 | 肉中心 / バランス型 / 菜食中心 |
| energy_provider | 電力プラン | 通常プラン / 再エネプラン / わからない |
| showerhead_replaced | シャワーヘッド交換済みか | はい / いいえ |
| beef_frequency | 牛肉の消費頻度 | 0回/週 / 1回/週 / 2回以上/週 |
| ac_filter_cleaning | エアコンフィルター清掃頻度 | 月2回以上 / 月1回 / ほとんどしない |
| online_shopping | ネット通販の利用頻度 | よく利用する / たまに利用する / 利用しない |
| commute_distance | 通勤・通学距離 | 2km未満 / 2-10km / 10km以上 |

### ActionMaster（アクションマスター）

| フィールド名 | 型 | 必須/任意 | 説明 |
|-------------|-----|----------|------|
| id | UUID | 必須 | アクションの一意識別子 |
| title | String(100) | 必須 | アクション名（例: 「週1回ノーミートデー」） |
| description | Text | 必須 | アクションの詳細説明 |
| category | String(50) | 必須 | カテゴリ（食事 / 移動 / エネルギー / 買い物 / 住まい） |
| co2_reduction_kg | Decimal(8,3) | 必須 | 1 回あたりの CO2 削減量（kg）。MVP では一般的な平均値を使用 |
| difficulty | Integer | 必須 | 難易度（1: 簡単 〜 3: 難しい） |
| icon_url | String(500) | 任意 | アイコン画像の URL |
| target_survey_keys | JSON | 必須 | 対象とするアンケート回答条件（提案ロジック用）。スキーマは下記参照 |
| data_version | Integer | 必須 | CO2削減量データのバージョン番号（初期値: 1）。データ更新時にインクリメントする |
| is_active | Boolean | 必須 | 有効フラグ（初期値: true） |
| created_at | Timestamp | 必須 | 登録日時 |

**target_survey_keys のJSONスキーマ:**

```json
{
  "conditions": [
    {
      "question_key": "energy_provider",
      "operator": "not_equals",
      "value": "再エネプラン"
    }
  ],
  "logic": "AND"
}
```

| フィールド | 説明 |
|---|---|
| conditions | マッチング条件の配列。1つ以上の条件を含む |
| conditions[].question_key | SurveyResponse の question_key に対応する質問キー |
| conditions[].operator | 比較演算子: `equals`（一致）/ `not_equals`（不一致）/ `gte`（以上）/ `lte`（以下）/ `any`（条件なし） |
| conditions[].value | 比較対象の値。operator が `any` の場合は省略可 |
| logic | 複数条件の結合方法: `AND`（全条件を満たす）/ `OR`（いずれかを満たす） |

**適用例:**

| アクション | target_survey_keys |
|---|---|
| 再エネ電力プランへの切替 | `{"conditions": [{"question_key": "energy_provider", "operator": "not_equals", "value": "再エネプラン"}], "logic": "AND"}` |
| 2km以内は徒歩/自転車に | `{"conditions": [{"question_key": "transport_mode", "operator": "equals", "value": "自家用車"}, {"question_key": "commute_distance", "operator": "equals", "value": "2km未満"}], "logic": "AND"}` |

### ActionLog（アクション実行記録）

| フィールド名 | 型 | 必須/任意 | 説明 |
|-------------|-----|----------|------|
| id | UUID | 必須 | 記録の一意識別子 |
| user_id | UUID（FK: User.id） | 必須 | 実行したユーザー |
| action_id | UUID（FK: ActionMaster.id） | 必須 | 実行したアクション |
| executed_at | Date | 必須 | 実行日 |
| memo | String(500) | 任意 | ユーザーのメモ |
| created_at | Timestamp | 必須 | 記録日時 |

### ImpactRecord（影響度レコード）

| フィールド名 | 型 | 必須/任意 | 説明 |
|-------------|-----|----------|------|
| id | UUID | 必須 | レコードの一意識別子 |
| user_id | UUID（FK: User.id） | 必須 | 対象ユーザー |
| period_type | String(10) | 必須 | 集計期間種別（daily / weekly / monthly） |
| period_start | Date | 必須 | 集計期間の開始日 |
| total_co2_kg | Decimal(10,3) | 必須 | 期間内の CO2 削減量合計（kg） |
| action_count | Integer | 必須 | 期間内のアクション実行回数 |
| calculated_at | Timestamp | 必須 | 集計日時 |

---

## 7.2 エンティティ関連図

```
User (1) ──── (N) SurveyResponse
  │
  │ (1)
  │
  ├──── (N) ActionLog (N) ──── (1) ActionMaster
  │
  └──── (N) ImpactRecord
```

**関連の説明:**

| 関連 | 多重度 | 説明 |
|------|-------|------|
| User → SurveyResponse | 1 対 多 | 1 ユーザーは複数の質問への回答を持つ |
| User → ActionLog | 1 対 多 | 1 ユーザーは複数のアクション記録を持つ |
| ActionMaster → ActionLog | 1 対 多 | 1 つのアクション定義に対し複数の記録が紐づく |
| User → ImpactRecord | 1 対 多 | 1 ユーザーは複数の期間別集計を持つ |

---

## 7.3 外部連携一覧

| ID | 連携先 | 用途 | 連携方式 | MVP 対応 |
|----|-------|------|---------|---------|
| EXT-01 | メール送信サービス | メール確認・パスワードリセット | REST API（SendGrid 等） | 対応 |
| EXT-02 | CO2 排出係数データベース | アクションごとの CO2 削減量の参考値 | 初期データとして静的に投入 | 対応（固定値） |
| EXT-03 | プッシュ通知サービス | アクションリマインダー | FCM / APNs | MVP 対象外 |
| EXT-04 | 分析基盤 | 利用状況の分析 | Firebase Analytics 等 | MVP 対象外 |

---

## 7.4 主要 API エンドポイント

### 認証

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| POST | /api/v1/auth/register | アカウント登録 | 不要 |
| POST | /api/v1/auth/login | ログイン | 不要 |
| POST | /api/v1/auth/logout | ログアウト | 必要 |
| POST | /api/v1/auth/password-reset | パスワードリセット要求 | 不要 |
| PUT | /api/v1/auth/password-reset/{token} | パスワード更新 | 不要 |

#### POST /api/v1/auth/register

**リクエスト:**
```json
{
  "email": "user@example.com",
  "password": "securePass1"
}
```

**レスポンス（201 Created）:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "email_verified": false,
  "created_at": "2026-04-16T00:00:00Z"
}
```

#### POST /api/v1/auth/login

**リクエスト:**
```json
{
  "email": "user@example.com",
  "password": "securePass1"
}
```

**レスポンス（200 OK）:**
```json
{
  "access_token": "eyJhbG...",
  "refresh_token": "eyJhbG...",
  "expires_in": 3600
}
```

### アンケート

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/v1/survey/questions | アンケート質問一覧取得 | 必要 |
| POST | /api/v1/survey/responses | アンケート回答送信 | 必要 |
| PUT | /api/v1/survey/responses | アンケート再回答 | 必要 |

#### POST /api/v1/survey/responses

**リクエスト:**
```json
{
  "responses": [
    { "question_key": "housing_type", "answer_value": "マンション" },
    { "question_key": "transport_mode", "answer_value": "公共交通機関" },
    { "question_key": "diet_type", "answer_value": "バランス型" }
  ]
}
```

**レスポンス（201 Created）:**
```json
{
  "message": "回答を保存しました",
  "survey_completed": true
}
```

### アクション

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/v1/actions | おすすめアクション一覧取得 | 必要 |
| GET | /api/v1/actions/{id} | アクション詳細取得 | 必要 |
| POST | /api/v1/actions/{id}/log | アクション実行記録 | 必要 |
| GET | /api/v1/action-logs | アクション記録履歴取得 | 必要 |

#### POST /api/v1/actions/{id}/log

**リクエスト:**
```json
{
  "executed_at": "2026-04-16",
  "memo": "今日はお昼を野菜中心にした"
}
```

**レスポンス（201 Created）:**
```json
{
  "id": "uuid",
  "action_id": "uuid",
  "executed_at": "2026-04-16",
  "co2_reduced_kg": 1.5,
  "total_co2_reduced_kg": 45.2
}
```

### 影響度

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/v1/impact/summary | CO2 削減量サマリー取得 | 必要 |
| GET | /api/v1/impact/history?period={weekly\|monthly} | 期間別推移取得 | 必要 |

#### GET /api/v1/impact/summary

**レスポンス（200 OK）:**
```json
{
  "total_co2_kg": 45.2,
  "total_actions": 32,
  "this_week_co2_kg": 5.3,
  "this_month_co2_kg": 18.7,
  "by_category": [
    { "category": "食事", "co2_kg": 15.0 },
    { "category": "移動", "co2_kg": 12.5 },
    { "category": "エネルギー", "co2_kg": 10.2 },
    { "category": "買い物", "co2_kg": 4.5 },
    { "category": "住まい", "co2_kg": 3.0 }
  ]
}
```

### ユーザー

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/v1/users/me | プロフィール取得 | 必要 |
| PUT | /api/v1/users/me | プロフィール更新 | 必要 |
| DELETE | /api/v1/users/me | アカウント削除 | 必要 |

---

## 7.5 ベースライン算出ロジック

ユーザーの「アクション実行前の推定CO2排出量（週間）」を算出するロジック。F-006のビフォー・アフター比較に使用する。

### 基準値

日本の1世帯あたり平均CO2排出量: **約2,740kg/年**（環境省「家庭部門のCO2排出実態統計調査」参考値）

→ 週間換算: 2,740 ÷ 52 ≒ **52.7kg/週**

### 内訳と補正ロジック

| 排出カテゴリ | 年間排出量の構成比 | 週間ベースライン | アンケートによる補正条件 |
|---|---|---|---|
| 電力 | 約50%（1,370kg/年） | 26.3kg/週 | energy_provider = 再エネプラン → 0kg/週に補正 |
| ガス・給湯 | 約15%（410kg/年） | 7.9kg/週 | showerhead_replaced = はい → 7.9 × 0.8 = 6.3kg/週に補正 |
| 自動車 | 約20%（550kg/年） | 10.6kg/週 | transport_mode = 公共交通機関 or 自転車 or 徒歩 → 0kg/週に補正 |
| 食事 | 約10%（275kg/年） | 5.3kg/週 | diet_type = 菜食中心 → 5.3 × 0.6 = 3.2kg/週に補正 |
| その他（消費・廃棄物等） | 約5%（135kg/年） | 2.6kg/週 | 補正なし |

### 算出手順

1. 基準値 52.7kg/週 からスタート
2. アンケート回答に応じて各カテゴリの値を補正
3. 補正後の合計値がそのユーザーのベースライン（週間推定排出量）
4. アンケート再回答（F-008経由）時はベースラインを再算出し、以降の比較に使用する
5. 再算出前のベースライン値は履歴として保持し、過去の比較データに遡及適用しない

### 算出例

**ユーザーA**: 通常電力プラン、シャワーヘッド未交換、自家用車通勤、バランス型食事
→ 26.3 + 7.9 + 10.6 + 5.3 + 2.6 = **52.7kg/週**（平均的な排出量）

**ユーザーB**: 再エネプラン契約済み、節水シャワーヘッド済み、公共交通、バランス型食事
→ 0 + 6.3 + 0 + 5.3 + 2.6 = **14.2kg/週**（すでに削減済みのユーザー）

---

## 7.6 CO2削減量データ方針

### MVP（Phase 1）

- ActionMaster.co2_reduction_kg は**静的な固定値**としてアプリ内に保持する
- 数値の根拠は 05-features.md セクション5.2「アクションマスタデータ」に記載の算出根拠に基づく
- 「推計値」と記載のあるアクション（ACT-007〜009）はMVP時点では概算データを使用し、アプリ内で「参考値」と明示する
- データ更新時は data_version をインクリメントする

### Phase 2 以降の移行計画

| 移行項目 | 内容 |
|---|---|
| データソース | 環境省「温室効果ガス排出量算定・報告マニュアル」、IPCC排出係数データベース等の公的データに段階的に差替 |
| 後方互換性 | ActionLog には記録時点の co2_reduction_kg 値を保持する。データ更新後も過去の記録は遡及変更しない |
| バージョニング | ActionMaster.data_version で管理。ActionLog に action_data_version フィールドを追加し、どのバージョンのデータで記録されたかを追跡可能にする |
| 影響範囲 | ベースライン算出ロジック（7.5節）の構成比・補正係数もデータ更新に合わせて見直す |
