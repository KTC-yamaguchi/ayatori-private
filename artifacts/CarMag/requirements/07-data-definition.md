---
title: CarMag — 要件定義書 07-データ定義
version: 1.0
date: 2026-07-17
---

# 07. データ定義（Data Definition）

## エンティティ定義

### エンティティ 1: Article（記事）

```json
{
  "id": "article_20260717_001",
  "title": "2026年の新型プリウスハイブリッド冬対策ガイド",
  "author": "カーセンサー編集部",
  "published_date": "2026-07-15T09:00:00Z",
  "updated_date": "2026-07-16T14:30:00Z",
  "category_id": "cat_maintenance",
  "category_name": "メンテナンス",
  "content": "<p>冬の車のメンテナンスについて...</p><img src='...' alt='...'/>",
  "description": "冬に備えるべきメンテナンス項目の完全ガイド",
  "thumbnail_url": "https://api.example.com/images/article_001.jpg",
  "source_media": "car_sensor",
  "source_url": "https://carsensor.net/...",
  "tags": ["冬対策", "メンテナンス", "ハイブリッド"],
  "word_count": 2450
}
```

### エンティティ 2: Category（カテゴリ）

```json
{
  "id": "cat_maintenance",
  "name": "メンテナンス",
  "description": "タイヤ交換、オイル交換、バッテリー交換等の定期メンテナンス",
  "icon_url": "https://api.example.com/icons/maintenance.svg",
  "article_count": 145,
  "display_order": 1
}
```

### エンティティ 3: SearchIndex（検索インデックス）

```json
{
  "keyword": "プリウス",
  "matching_articles": ["article_20260717_001", "article_20260710_045", ...],
  "last_updated": "2026-07-17T00:00:00Z"
}
```

---

## 外部連携一覧

### 連携 1: 記事データ取得 API

| 項目 | 値 |
|---|---|
| **連携先** | 車情報 API（TBD）/ RSSフィード |
| **通信方式** | REST API / RSS（v1 では未決定、Step 5 で確定予定） |
| **認証** | API キー（環境変数に保管） |
| **更新頻度** | 1 日 1 回（UTC 00:00）/ リアルタイム（要件による） |
| **リトライ** | 最大 3 回、指数バックオフ（1 秒 → 2 秒 → 4 秒） |
| **タイムアウト** | 5 秒 |
| **キャッシング** | ローカル LocalStorage（24 時間保持） |

### 連携 2: 記事詳細エンドポイント

| 項目 | 値 |
|---|---|
| **エンドポイント例** | `GET /api/articles/{article_id}` |
| **リクエスト形式** | JSON / XML（API 側に依存） |
| **レスポンス** | 上記「エンティティ 1: Article」に準ずる |
| **レスポンスタイム** | 2 秒以内 |

---

## API I/O 定義（主要エンドポイント）

### Endpoint 1: ホーム画面用カテゴリリスト取得

**リクエスト**
```
GET /api/categories
```

**レスポンス（200 OK）**
```json
{
  "categories": [
    {
      "id": "cat_maintenance",
      "name": "メンテナンス",
      "description": "タイヤ、オイル交換等",
      "icon_url": "...",
      "article_count": 145
    },
    {
      "id": "cat_seasonal",
      "name": "季節対策",
      "description": "冬・夏の備え",
      "icon_url": "...",
      "article_count": 89
    }
  ],
  "total": 5
}
```

---

### Endpoint 2: カテゴリ別記事一覧取得

**リクエスト**
```
GET /api/categories/{category_id}/articles?limit=20&offset=0
```

**パラメータ**
- `category_id`: カテゴリ ID（例: cat_maintenance）
- `limit`: 1 ページあたりの記事数（デフォルト 20）
- `offset`: ページネーションオフセット（デフォルト 0）

**レスポンス（200 OK）**
```json
{
  "category_id": "cat_maintenance",
  "articles": [
    {
      "id": "article_20260717_001",
      "title": "2026年の新型プリウスハイブリッド冬対策ガイド",
      "author": "カーセンサー編集部",
      "published_date": "2026-07-15T09:00:00Z",
      "thumbnail_url": "...",
      "description": "..."
    }
  ],
  "total": 145,
  "offset": 0,
  "limit": 20
}
```

---

### Endpoint 3: キーワード検索

**リクエスト**
```
GET /api/search?q={keyword}&limit=20
```

**パラメータ**
- `q`: 検索キーワード（例: プリウス）
- `limit`: 結果の最大件数（デフォルト 20）

**レスポンス（200 OK）**
```json
{
  "query": "プリウス",
  "results": [
    {
      "id": "article_20260717_001",
      "title": "2026年の新型プリウスハイブリッド冬対策ガイド",
      "author": "カーセンサー編集部",
      "published_date": "2026-07-15T09:00:00Z",
      "description": "...",
      "relevance_score": 0.95
    }
  ],
  "total": 34
}
```

---

### Endpoint 4: 記事詳細取得

**リクエスト**
```
GET /api/articles/{article_id}
```

**レスポンス（200 OK）**
```json
{
  "id": "article_20260717_001",
  "title": "2026年の新型プリウスハイブリッド冬対策ガイド",
  "author": "カーセンサー編集部",
  "published_date": "2026-07-15T09:00:00Z",
  "updated_date": "2026-07-16T14:30:00Z",
  "category_id": "cat_maintenance",
  "category_name": "メンテナンス",
  "content": "<p>冬の車のメンテナンスについて...</p><img src='...' alt='...'/><p>...</p>",
  "source_media": "car_sensor",
  "source_url": "https://carsensor.net/...",
  "tags": ["冬対策", "メンテナンス", "ハイブリッド"]
}
```

**エラーレスポンス（404 Not Found）**
```json
{
  "error": "Article not found",
  "article_id": "article_invalid"
}
```

---

## エラーレスポンス定義

### Error Code 1: 404 Not Found

```json
{
  "error": "Resource not found",
  "message": "The requested article does not exist",
  "status": 404
}
```

### Error Code 2: 500 Internal Server Error

```json
{
  "error": "Internal server error",
  "message": "Please try again later",
  "status": 500
}
```

### Error Code 3: 503 Service Unavailable

```json
{
  "error": "Service temporarily unavailable",
  "message": "The external API is temporarily down. Please try again in a few minutes",
  "status": 503
}
```

