# AYATORI ステップ間インターフェース契約書

各ステップの入力ファイル・出力ファイル・JSON スキーマを定義する。
パイプラインを修正・拡張する際は、このドキュメントを唯一の契約仕様として扱うこと。

対象: **33 ステップ × 7 Phase**（Confluence 3767469072 準拠 / 2026-05 改定 — Phase 1c req_delta + Phase 5 delta 追加）

---

## ファイル一覧（全体）

```
artifacts/{app_name}/
├── requirements.json              # プロジェクト要件の純粋な記述 (INPUT)
├── pipeline-state.json            # cross-phase hot state (承認時刻 / 選択結果 / Confluence page_id)
├── rubric.json                    # 要件定義ルーブリック (Phase 1b 不変量)
├── scoring-history.json           # 要件定義スコアリング履歴 (Phase 1b)
├── scores.json                    # デザイン採点 (Phase 3)
├── feedback-log.md                # 実行中の修正・指摘記録
├── design-brief.yaml              # デザインブリーフ (Phase 2, SSOT、narrative + 構造化データ統合)
├── wcag-mapping.json              # WCAG ループ不変量 (constraints / criteria)
├── wcag-history.json              # WCAG 違反履歴 (attempts[])
├── tokens.json                    # W3C DTCG 3層デザイントークン
├── style-guide.md                 # スタイルガイド文書
├── figma-state.json               # Figma ノード ID 追跡 (FIGMA_MCP_ENABLED=true 時のみ生成、conditional file。詳細 L301〜)
├── pipeline-improvements.md       # 振り返りレポート
├── req-delta/                     # Phase 1c 成果物ディレクトリ
│   ├── change-manifest.json       # 31 変更マニフェスト（run ごとに上書き）
│   ├── doc-impact-analysis.md     # 32 影響分析レポート（run ごとに上書き）
│   ├── run-history.json           # 33 完了 run の累積履歴
│   └── snapshots/                 # 31 変更前ドキュメントのスナップショット
│       └── {doc}.snapshot.md      # 全要件ドキュメント分を保存（00-raw-input.md を除く）
├── requirements/
│   ├── 00-raw-input.md            # 01 生入力（採点対象外）
│   ├── 01-overview.md             # プロジェクト概要書
│   ├── 02-scope.md                # スコープ定義書
│   ├── 03-user-flow.md            # ユーザーフロー
│   ├── 04-use-cases.md            # ユースケース一覧
│   ├── 05-features.md             # 機能一覧
│   ├── 06-non-functional.md       # 非機能要件一覧
│   ├── 07-data-definition.md      # データ定義・外部連携
│   └── 08-constraints.md          # 制約・前提・受け入れ条件
├── design-samples/                   # 09 生成のサンプル HTML（P2統一構造）
│   ├── web/index.html                # platform_combo ∋ web 時（3案切替1ファイル: CSS変数 + JS）
│   └── mobile/index.html             # platform_combo ∋ mobile 時（iOS ベース1枚に集約）
└── screens/
    ├── style-guide-view.html      # 12 パーツカタログ
    ├── 00-screen-list.md          # 14 画面一覧
    ├── 00-transition-map.mmd      # 14 画面遷移図 SSoT（Pure Mermaid）
    ├── 00-transition-map.html     # 14 画面遷移図 派生（template + .mmd で機械生成）
    ├── {画面名}.md                # 17 画面仕様書（platform 共通、root に 1 つ）
    ├── _shared/                   # 17 共有 CSS（root-variables.css / common-styles.css）
    ├── web/                       # 17 Web 版（platform_combo ∋ web 時のみ）
    │   ├── {画面名}.html          # 1440×900
    │   └── {画面名}--{状態}.html  # 状態パターン（empty/loading/error + 画面性質別）
    └── mobile/                    # 17 モバイル版（platform_combo ∋ mobile 時のみ）
        ├── {画面名}.html          # 390×844, BottomTab + フォンフレーム付き
        └── {画面名}--{状態}.html  # 状態パターン（empty/loading/error + 画面性質別）
└── delta/                         # Phase 5: delta 実行ごとの成果物（repeatable）
    ├── change-manifest.json       # 27 変更記述 + 影響ドキュメント一覧
    ├── impact-analysis.md         # 28 画面分類 (affected/new/removed/preserved)
    ├── run-history.json           # 30 累積 delta 実行サマリー
    └── snapshots/                 # 27 変更ドキュメントの snapshot（run ごとに上書き）
        └── {doc}.snapshot.md
```

---

## JSON スキーマ定義

### requirements.json

プロジェクト要件の **純粋な記述 (INPUT)** のみを保持する。承認時刻 / 選択結果 / Confluence page_id 等のクロスフェーズ状態は `pipeline-state.json` に分離されている (`docs/artifact-file-responsibility.md` 参照)。

```json
{
  "app_name": "string",
  "created_at": "YYYY-MM-DD",
  "status": "REVERSE_ENGINEERED | undefined",
  "design_output_scope": { /* 01-question 7 軸ヒアリング結果 */ },
  "readiness": { /* 7 軸 readiness スコア (audit 専用) */ },
  "provisional_flags": ["string"],
  "recommendations_accepted": ["string"],
  "confluence_parent_id": "string | null"
}
```

> **初期値**: `app_name`・`created_at`・`confluence_parent_id` は 01 完了後に書き込む。
> `status` は Phase 0b (reverse) 経由のときのみ `"REVERSE_ENGINEERED"` が立ち、greenfield では省略する。
> `design_output_scope` / `readiness` / `provisional_flags` / `recommendations_accepted` は 01-question が一度だけ書き込み、以降は読み取り専用 (reverse 経路の writer は 06-format-convert で、`design_output_scope` のみ書き `readiness` / `provisional_flags` / `recommendations_accepted` は省略する)。
> **state 系 (承認時刻 / 選択結果 / Confluence page_id 等) は本ファイルでは保持しない** — `pipeline-state.json` (`schemas/pipeline-state.schema.json`) を参照。
> **注意**: Phase 1b の Confluence 追跡フィールド (`save_status`・`doc_page_ids`・`page_id`) は `pipeline-state.json` の `confluence.requirements` に格納する (06-confluence-save-req が writer)。

---

### rubric.json

ループ不変量の **criteria 定義のみ** を保持する (03-rubric-gen が初回のみ書込、以降 read-only)。attempt ごとのスコア / verdict / deficiencies は `scoring-history.json` に分離されている。

```json
{
  "app_name": "string",
  "criteria": [
    {
      "axis": "correctness | unambiguity | completeness | consistency | feasibility",
      "weight": 20,
      "description": "string — このアプリ固有の高レベル評価観点（人間が読む要約）",
      "checks": [
        {
          "id": "string — 例: correctness-C1（軸プレフィックス + 連番）",
          "question": "string — yes/no/partial で判定可能な単一観点の問い",
          "max_points": 5,
          "doc_targets": ["01-overview.md | 02-scope.md | ... | 08-constraints.md"]
        }
      ]
    }
  ]
}
```

> **初期値**: `app_name` は 03 が設定、`criteria` は 03 が生成 (以降不変)。本ファイルはこの 2 フィールドのみ保持し、ループ attempt / Confluence 状態は他ファイルに分離する。
> Phase 1b の Confluence 追跡 (`save_status` / `doc_page_ids` / `page_id`) は `pipeline-state.json.confluence.requirements` に分離されており、06-confluence-save-req が writer。
>
> **checks 設計ルール（03 の責務）**: 各軸の `checks` は **4 件** を基本、`max_points` 合計が `weight` と一致（4×5=20）。各 `question` は yes/partial/no 判定可能な **単一観点**。

---

### scoring-history.json

Phase 1b スコアリングの **attempt 履歴** を保持する (04-scoring が attempt ごとに 1 件 append)。

```json
{
  "app_name": "string",
  "attempts": [
    {
      "attempt_count": 0,
      "timestamp": "ISO-8601",
      "total": 0,
      "scores": {
        "correctness": 0,
        "unambiguity": 0,
        "completeness": 0,
        "consistency": 0,
        "feasibility": 0
      },
      "check_results": [
        {
          "check_id": "string — criteria[].checks[].id を参照",
          "axis": "string",
          "verdict": "yes | partial | no",
          "awarded_points": 0,
          "evidence": "string — 該当ファイル名・該当箇所・判定根拠を一文で"
        }
      ],
      "deficiencies": [
        {
          "axis": "string",
          "doc": "01-overview | 02-scope | ... | 08-constraints",
          "issue": "string — 具体的な問題点",
          "severity": "high | medium | low",
          "check_id": "string — criteria[].checks[].id を参照",
          "tag": "AI改善可能 | 人間対応必要",
          "tag_reason": "string | null"
        }
      ],
      "ai_improvable_count": 0,
      "human_required_count": 0
    }
  ]
}
```

> **初期値**: `attempts` は 03 が空配列で初期化。
> **採点ルール（04 の責務）**: 各 check の `verdict` を判定 → `awarded_points` を導出（`yes = max_points` / `partial = floor(max_points/2)` / `no = 0`）。`scores.{axis}` = その軸の全 `awarded_points` 合計。各 `partial`/`no` 判定の check には対応する `deficiency` を記録し `check_id` で紐付ける。本 attempt の全結果を 1 件として `attempts[]` に append。
> `attempt_count` は配列 index と一致 (`len(attempts) - 1` で最新 attempt 番号を導出)。`escalated` は `len(attempts) >= pipeline.yaml.requirements.loop.max_attempts AND attempts[-1] が pass 条件未達` で導出される (旧 rubric.json.escalated は消滅)。

---

### scores.json

```json
{
  "app_name": "string",
  "attempt_count": 0,
  "escalated": false,
  "current": {
    "evaluated_at": "ISO 8601",
    "attempt_count": 1,
    "layer1": { "score": 0, "max": 40, "breakdown": {"design_system": 0, "contrast_1_4_3": 0, "typography": 0, "interaction": 0}, "notes": [] },
    "layer2": { "score": 0, "max": 30, "breakdown": {"navigation": 0, "consistency": 0, "feedback": 0}, "notes": [] },
    "layer3": { "score": 0, "max": 30, "breakdown": {"aesthetic": 0, "layout": 0, "brand": 0}, "notes": [] },
    "total": 0,
    "coverage_check": {
      "evaluated_at": "ISO 8601",
      "scope": "full_html",
      "missing": { "l1": 0, "l2": 0, "l3": 0, "l4": 0 },
      "deductions_applied": 0,
      "overflow_deduction": 0,
      "details": []
    },
    "ai_improvable_deductions": 0,
    "nfr_coverage": {
      "evaluated_at": "ISO 8601",
      "source": "requirements/06-non-functional.md",
      "summary": { "total_nfrs": 0, "automated_verified": 0, "human_attested": 0, "deferred": 0, "unaddressed": 0 },
      "deductions_applied": 0,
      "details": [
        { "nfr_id": "NFR-XX", "title": "string", "status": "automated_verified | human_attested | deferred | unaddressed", "evidence": "string", "phase_target": "Phase 4 etc." }
      ]
    },
    "human_required_deductions": 0,
    "tags": [
      { "item": "string", "type": "AI改善可能 | 人間対応必要", "detail": "string" }
    ]
  },
  "history": [
    { "attempt": 1, "evaluated_at": "ISO 8601", "total": 0, "ai_improvable_deductions": 0, "summary": "1 行サマリ" }
  ]
}
```

> **初期値**: 全スコアは 0、配列は空。
> `attempt_count` は 20 がインクリメントする。`current` は 17 の再実行時に上書きされ、過去 attempt は `history[]` に lightweight summary として残る (full attempt 構造は scoring-history / wcag-history と異なり保持しない)。`coverage_check` と `nfr_coverage` は ai_improvable_deductions の構成要素。

---

### wcag-mapping.json

```json
{
  "app_name": "string",
  "wcag_version": "2.2",
  "conformance_level": "AA",
  "constraints": {
    "contrast": {
      "text_minimum_ratio": "4.5:1",
      "large_text_minimum_ratio": "3:1",
      "non_text_minimum_ratio": "3:1",
      "recommended_target": "string"
    },
    "focus_ring": {
      "width": "2px",
      "offset": "2px",
      "style": "solid",
      "must_not_be_obscured": true,
      "scroll_margin_top_px": 80,
      "scroll_margin_bottom_px": 96
    },
    "touch_target": {
      "minimum_size_px": 44,
      "rationale": "string"
    },
    "typography": {
      "mobile_font_size_minimum_px": 12,
      "mobile_body_recommended_px": 14
    },
    "motion": {
      "prefers_reduced_motion_required": true,
      "non_essential_animation_allowed_under_250ms": true
    },
    "forms": {
      "error_identification_required": true,
      "redundant_entry_prevention_required": true,
      "accessible_auth_minimum": "string"
    }
  },
  "criteria": [
    {
      "id": "string (e.g., 1.4.3)",
      "name": "string",
      "constraint_definition": "string (color-agnostic rule)"
    }
  ]
}
```

> **ループ不変量のみを保持する**。`violations[]` / `wcag_loop` などの attempt 結果は `wcag-history.json` に分離されている（W1/W4 設計判断）。
> 08 が `app_name` を書き込む。**11 が `constraints`・`criteria` を初回のみ書き込む**:
> - `constraints`・`criteria`: 色非依存の制約（触れるのは 11 のみ、ループ中不変）
> - attempt ごとの違反検出結果は `wcag-history.json.attempts[].violations[]` に append される
> 12 は最新 attempt の `violations[]` が空であることを前提に、選択案の色の具体 contrast を `tokens.json.$description` に記録する。
> 計算式・閾値・補正アルゴリズムの詳細は `docs/wcag-standards.md` を参照。

---

### wcag-history.json

```json
{
  "app_name": "string",
  "attempts": [
    {
      "attempt_count": 0,
      "timestamp": "ISO-8601",
      "violations": [
        {
          "candidate_id": "a | b | c",
          "criterion_id": "1.4.3 | 1.4.11 | 2.4.7 | 2.5.8",
          "pair": {
            "fg_token": "string (e.g., color.on-surface)",
            "bg_token": "string (e.g., color.surface)"
          },
          "fg_hex": "#RRGGBB",
          "bg_hex": "#RRGGBB",
          "actual_ratio": 0.0,
          "required_ratio": 0.0,
          "suggested_correction": "string | null"
        }
      ]
    }
  ]
}
```

> **初期値**: `attempts` は空配列。
> 11 が attempt ごとに 1 件 append する（単一所有権モデル）。`attempt_count` は配列 index と一致し、`len(attempts) - 1` で最新 attempt 番号が導出される（専用 field は持たない）。
> `max_attempts` は `pipeline.yaml.design.loop.max_attempts` で定義される。
> 26-retro が読込んでループ収束過程を分析する。

---

### figma-state.json

```json
{
  "file_key": "string — FIGMA_FILE_KEY 環境変数の値",
  "page": "AYATORI Pipeline",
  "page_id": "string | null",
  "nodes": {
    "style-guide": "string | null",
    "component-library": { "node_id": "string", "name": "string" },
    "variants-archive": { "node_id": "string", "name": "string" },
    "screens": {
      "{画面名}": {
        "node_id": "string  // Figma node id, 例: '42:2'",
        "platform": "'web' | 'web-sm' | 'mobile'  // web-sm = Web スマホ幅",
        "state": "'default' | 'empty' | 'loading' | 'error' | string  // 画面性質に応じた追加状態を許容",
        "url": "string  // figma.com/design/{file_key}?node-id={node_id 形式変換済} の完全 URL"
      }
    },
    "screens-reference": {
      "html-capture-{画面名}": "string | null"
    },
    "variables": {
      "primitives-collection": "string | null",
      "semantic-collection": "string | null",
      "component-collection": "string | null"
    },
    "components": {
      "atoms": {},
      "molecules": {},
      "organisms": {}
    }
  },
  "audit": {
    "retry": { "{auditName}": "integer  // Step G の retry count" },
    "pattern_c": "string[] | null  // 3 回再実行しても PASS しない audit 名のリスト"
  }
}
```

> **`nodes.variants-archive`** は Step 24 が記録するキー。ComponentSet Variants Archive Frame の `{node_id, name}` を §Step D-0 で書く。
> **`audit.retry` / `audit.pattern_c`** は Step 24 の audit 用キー。Step G G-1d で `auditResult.state` を Write back する責任は main session (skill 24 呼び出し元) にある。

> **figma-state.json は Figma 操作を行う Step が更新する**。Step 12 はコード生成のみで Figma を触らないため、figma-state.json も書かない。
> 22 が初期化 + `nodes.screens.{画面名}` を更新（HTML キャプチャ後）。
> 24 が `nodes.variables.*` / `nodes.style-guide` / `nodes.component-library` を更新（Variables 3 コレクション登録 + Component Library フレーム構築後）。
> 25 が `nodes.components.*` を更新（ComponentSet バインド後）。
> 18 がこの ID を使って安全な読み取り対象を限定する。

> **Legacy 互換 (`nodes.screens` の値型)**: 上記スキーマ (object 形式) は Step 22 SKILL 改修以降の **新形式**。改修前の既存プロジェクト (artifacts/{old-app}/figma-state.json) は **旧形式 = string (node-id 直値)** で保存されている可能性がある。
>
> `nodes.screens` を読む全 consumer (15 / 18 / 25 等) は両形式を吸収するタイプガードを必ず通すこと:
>
> ```js
> const node_id = typeof entry === 'string' ? entry : entry.node_id;
> ```
>
> 新規プロジェクトでは常に object 形式で書き込まれるが、レガシーアーティファクトを再利用するシナリオ (例: 旧プロジェクトの figma-state.json を流用して 18 を再実行) で string が混入すると上記 guard なしでは破綻する。

---

## ステップ別 入力 / 出力 契約

### 01 質問エージェント

| | ファイル | 状態 |
|---|---|---|
| **IN** | なし（ユーザーとの対話） | — |
| **OUT** | `requirements/00-raw-input.md` | 新規作成 |
| **OUT** | `requirements.json` | `app_name`・`created_at`・`confluence_parent_id` のみ更新 |
| **OUT** | `feedback-log.md` | 新規作成（空のログ） |

**前提条件**: `artifacts/{app_name}/` ディレクトリが存在すること（なければ作成）。

### 02 ISO 29148 要件昇華

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements/00-raw-input.md` | 読み取り（初回） |
| **IN** | `requirements/01〜08-*.md` | 読み取り（ループ時） |
| **IN** | `scoring-history.json` | `attempts[-1].deficiencies` を参照 (`attempt_count = len(attempts) - 1`) |
| **OUT** | `requirements/01-overview.md` 〜 `08-constraints.md` | 新規作成 または 上書き |

### 03 ルーブリック生成

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements/01〜08-*.md` | 読み取り |
| **IN** | `rubric.json` | `criteria` の有無で lock 判定（criteria 既存ならスキップして終了。スコア比較の一貫性維持のため再生成しない） |
| **OUT** | `rubric.json` | `app_name` + `criteria` を書込（初回のみ、以降不変） |
| **OUT** | `scoring-history.json` | `{"app_name": "...", "attempts": []}` で初期化（既存ファイルがあれば触らない） |

### 04 ルーブリック採点

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements/01〜08-*.md` | 読み取り |
| **IN** | `rubric.json` | `criteria` を参照 |
| **OUT** | `scoring-history.json` | 本 attempt の `{attempt_count, timestamp, total, scores, check_results, deficiencies, ai_improvable_count, human_required_count}` を `attempts[]` に 1 件 append |

### 05 フィードバックループ（要件）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `scoring-history.json` | `attempts[-1].total` / `len(attempts)` から pass / loop / escalate を判定 |
| **OUT（合格）** | → 06 へ | — |
| **OUT（ループ）** | → 02 へ（次回 04 が新 attempt を append、`attempt_count` は配列 index から導出） | — |
| **OUT（エスカレーション）** | → 07 へ（`escalated` は `len(attempts) >= max_attempts AND total < 80` で導出） | — |

**ループ閾値**: `pipeline.yaml` の `requirements.loop`。合格: `attempts[-1].total >= 80` / エスカレーション: `len(attempts) >= 3`

### 06 Confluence 保存（要件）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements/01〜08-*.md` | 読み取り |
| **IN** | `requirements.json` | `confluence_parent_id` |
| **IN** | `pipeline-state.json` | `confluence.requirements.page_id`（既存チェック） |
| **OUT** | `pipeline-state.json` | `confluence.requirements.{page_id, doc_page_ids, save_status}` |

### 07 人間承認ゲート（要件）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `scoring-history.json` | `attempts[-1]` と `len(attempts)` から `escalated` 状態を導出 |
| **IN（承認）** | → 08 へ | — |
| **IN（修正指示）** | `requirements.json` | 修正内容を反映 |
| **OUT（承認）** | `pipeline-state.json` | `approvals.step07_approved_at` に ISO 8601 を記録。**reverse 経路 (Phase 0b) では本 step を通らず、Phase 0b Completion が同キーを書く** (`step07_approved_via: "reverse-review-gate"` で判別。二重 writer の例外は `docs/artifact-file-responsibility.md` 参照) |
| **OUT（全リセット）** | `requirements.json`・`rubric.json`・`scoring-history.json`・`wcag-mapping.json`・`wcag-history.json`・`pipeline-state.json`・Phase 2-3 ファイル群（`design-brief.yaml` / `tokens.json` / `style-guide.md` / `style-guide-view.html` / `scores.json` / `screens/` / `figma-state.json`） | 全削除 → 01 へ |

---

## Phase 1c ステップ別 入力 / 出力 契約

### 31 要件変更検出（Requirements Change Detection）

| | ファイル | 状態 |
|---|---|---|
| **IN** | ユーザー入力（変更タイプ選択 → `feature_addition` の場合: 9項目ヒアリング / その他: 変更説明 Q1 + 直接変更ドキュメント Q2） | 対話 |
| **IN** | `requirements/01〜08-*.md` | 読み取り（変更対象ドキュメント） |
| **IN** | `req-delta/snapshots/{doc}.snapshot.md` | 読み取り（前回スナップショットとの比較、存在する場合） |
| **IN** | `pipeline-state.json` | `req_delta.runs[]` で run_id カウンタ計算 |
| **IN** | `requirements.json` | `interview_mode` 読み取り（`change_type == "feature_addition"` の場合のみ） |
| **IN** | `skills/27-change-detect/refs/feature-add-interview.md` | 参照（`change_type == "feature_addition"` の場合のみ） |
| **OUT** | `req-delta/change-manifest.json` | 新規作成 または 上書き |
| **OUT** | `req-delta/snapshots/{doc}.snapshot.md` | 全要件ドキュメント分を作成・上書き（00-raw-input.md を除く） |
| **OUT** | `pipeline-state.json` | `req_delta.runs[]` に stub エントリ append（`run_id`, `change_description`, `initiated_at`） |
| **OUT** | `req-delta/feature-add-brief.md` | 新規作成（`change_type == "feature_addition"` の場合のみ） |

**前提条件**: `pipeline-state.json.approvals.step07_approved_at` が設定済みであること (Phase 1b skill 07 の承認、または Phase 0b reverse Completion の自動押印のどちらでも満たされる)。

### 32 クロスドキュメント影響分析（Cross-Document Impact Analysis）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `req-delta/change-manifest.json` | 読み取り（Step 31 完了必須） |
| **IN** | `requirements/{directly_changed_docs}` | 読み取り（Step 1: manifest の `directly_changed_docs` のみ先行読み込み） |
| **IN** | `requirements/{candidate impacted docs}` | 遅延読み取り（Step 2: 依存マップで候補となったドキュメントのみ。`preserved` 候補は読まずに分類） |
| **OUT** | `req-delta/doc-impact-analysis.md` | 新規作成 |
| **OUT（承認）** | `pipeline-state.json` | `req_delta.runs[-1].{directly_changed_docs, impacted_docs, impact_approved_at}` を更新 |
| **OUT（キャンセル）** | `pipeline-state.json` | `req_delta.runs[-1].{cancelled_at, cancel_reason}` を更新 |

**ゲート**: 人間が `doc-impact-analysis.md` の影響範囲を確認し承認（Option A）・修正（Option B）・キャンセル（Option C）を選択する。

### 33 要件修正・適用（Requirements Revision + Apply）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `req-delta/change-manifest.json` | 読み取り |
| **IN** | `req-delta/doc-impact-analysis.md` | 読み取り（Step 32 承認済み必須） |
| **IN** | `requirements/{directly_changed + impacted docs}` | 読み取り・書き込み対象（`preserved` ドキュメントは通常読み書きしない） |
| **IN（任意・再採点時のみ）** | `requirements/01〜08-*.md` | 全 8 ドキュメント読み取り専用。Step 5 Option A（再採点）時のみ。`preserved` ドキュメントはスコア計算のためのみ読み取り — 書き込みは行わない |
| **OUT** | `requirements/0{N}-*.md` | 上書き（directly_changed + impacted ドキュメントのみ） |
| **OUT** | `req-delta/run-history.json` | エントリ append |
| **OUT（承認）** | `pipeline-state.json` | `req_delta.runs[-1].revisions_approved_at` を更新 |
| **OUT（キャンセル）** | `pipeline-state.json` | `req_delta.runs[-1].{cancelled_at, cancel_reason}` を更新 |
| **OUT（任意）** | `req-delta/score-after.json` | 再採点時に inline で計算して保存（Phase 1b の `scoring-history.json` / `04-scoring` は使わない — Phase 1b 履歴汚染防止） |
| **OUT（任意）** | `pipeline-state.json` | Confluence 再保存時に `confluence.requirements.*` を更新（06-confluence-save-req 経由） |

**ゲート**: 人間が修正案を確認し全承認（Option A）・部分承認（Option B）・修正指示（Option C、最大 3 回）・キャンセル（Option D）を選択する。

**ステップ間依存関係 (Phase 1c)**:
```
31 → req-delta/change-manifest.json,
     req-delta/snapshots/{doc}.snapshot.md（全要件ドキュメント分、00-raw-input.md を除く）,
     pipeline-state.json(req_delta.runs[] stub エントリ)
32 → req-delta/doc-impact-analysis.md,
     pipeline-state.json(req_delta.runs[-1].{directly_changed_docs, impacted_docs, impact_approved_at})
33 → requirements/0{N}-*.md（directly_changed + impacted のみ）,
     req-delta/run-history.json,
     pipeline-state.json(req_delta.runs[-1].revisions_approved_at)
```

---

### 08 デザインブレスト（ヒアリング+3方向性+palette OKLCH導出）

**前提条件**: AYATORI 内部完結。Phase 2 の aesthetic direction 言語化は 08 自身が生成する（外部プラグイン invoke なし）。

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements.json` | 読み取り（Must機能・対象プラットフォーム） |
| **IN** | `requirements/01〜08-*.md` | 読み取り（ターゲット層・文脈） |
| **IN** | `docs/wcag-standards.md` | 読み取り（AA閾値・OKLCH補正アルゴリズム） |
| **IN（ループ時）** | `wcag-history.json` | 最新 attempt の `violations[]` を読んで該当 token の L 値補正 |
| **OUT** | `design-brief.yaml` | **3案版**（schema: `design-brief:draft:v1`）機械処理用の構造化データ + 下流 LLM priming 用の narrative フィールドを同一ファイルに格納。**必須**: 各 case の `palette.state_colors` に `error / info / (warning / success)` の `bg/text/border` 全 9-12 hex を含めること。`schemas/design-brief.schema.json` 参照 |
| **OUT** | — | wcag-mapping.json / wcag-history.json には書き込まない（旧版の「`app_name` のみ書込」は廃止 — 11 が初回 write で丸ごと生成する単一所有権モデル。`skills/08-design-brainstorm/SKILL.md` Phase 7 の廃止注記参照） |

**設計原則**: `design-brief.yaml` が **single source of truth**（SSOT）。人間向けの自然言語（concept・archetype narrative・OKLCH 導出根拠・§9 Agent Prompt Guide 全文）は yaml の multi-line 文字列フィールドに格納する。人間の UX は HTML 成果物（09 `design-samples/*/index.html`・12 `style-guide-view.html`・17 の全画面 HTML）で完結させ、brief 自体を人間が読む設計にはしない。

**なぜ md を持たないか**:
- 10 の人間ゲートは HTML サンプルで判断、13 は style-guide-view で判断、26 retro も実成果物 + feedback-log が主
- md を残すと yaml と重複データを保持し divergence リスクが発生、かつ人間は実際には読まない
- narrative priming に必要な prose は yaml の `narrative` サブブロックで保持すれば LLM は十分読める

**design-brief.yaml スキーマ（v1）**:

```yaml
schema: "design-brief:draft:v1"      # 10 承認後は "design-brief:final:v1" に
app_name: string
generated_at: string                  # YYYY-MM-DD
attempt_count: int                    # WCAG ループ回数（0/1/2）
revision_mode: null | "full" | "partial"

# 10 承認後に追加される（draft:v1 時点では存在しない）
selected_sample_id: null | "A" | "B" | "C"
selected_label: null | string
approved_at: null | string           # YYYY-MM-DD

common:
  hearing:
    brand_direction: string
    tone_mood: string
    color_image: string
    reference_apps: string
    avoid_styles: string
  hearing_interpreted:                 # raw 回答 × 要件文脈 の昇華結果（表形式）
    - axis: string
      raw: string
      context: string
      sublimated: string
  ui_constraints:
    emoji_allowed: bool
    icon_style: string                 # "svg-line-round" 等
    illustration_policy: string        # "pictogram" | "illustration_character" | "emoji_casual"
    numeric_font: string
    language_policy: string
  platforms: [string]                  # ["web", "mobile"] のサブセット

cases:                                 # 3 案を全て保持（10 承認後も棄却案データを残す）
  - id: "A"
    label: string                      # 方向性名（例: "計器盤の正確な静謐"）
    archetype: string                  # enum: 削ぎ落とし型 / 密度過飽和型 / 希望技術合流型 / 判型エディトリアル型 / 未加工生地型 / 金箔静謐型 / 筆致有機型 / 幾何対称型 / 計器機能美型 / 文化文脈型 / その他（独自命名）
    concept: string                    # 1 文 ("名詞 + 状態 + 情動")
    differentiation: string            # unforgettable な一点（1 文）

    # === narrative（LLM priming 用の prose）===
    narrative:
      visual_theme: |                  # §1 Visual Theme に相当する 2〜4 文の prose
        ここに archetype の世界観を物語る prose。
        concept の背景・狙い・情動を自然言語で表現する。
      target_fit: |                    # ターゲット層との適合理由（2〜3 文）
      component_stylings: |            # §4 の質感語彙（ボタン・フォーム・カードの手触り描写）
      depth: |                         # §6 の質感（「和紙的拡散光」「金箔の硬い影」等）
      agent_prompt_guide: |            # §9 narrative 全文（適用先・event binding・composition 指示の自然言語）
        17 全画面 HTML では {animation_name} を {適用先} に適用。
        prefers-reduced-motion 時は {fallback}。
        ...

    # === 構造化契約（machine 用の hard constraint）===
    palette:
      tokens:
        - name: "--color-bg"
          hex: "#0B1220"
          oklch: { l: 0.16, c: 0.04, h: 255 }
          usage: "全体背景"
          contrast_label: null          # contrast pair の記述（該当する場合）
        - name: "--color-primary"
          hex: "#0B76B5"
          oklch: { l: 0.52, c: 0.12, h: 232 }
          usage: "CTA・選択状態"
          contrast_label: "on-surface: 約3.54:1 ✅"
        # ... 以下全 token
      oklch_derivation_note: |          # OKLCH 導出根拠 narrative（prose）
        墨黒 bg（L=0.16）に対して氷白の on-surface を L=0.92 に設定、
        primary は azure calibration（H=232, L=0.52）で深海ターコイズ領域、
        surface との contrast 3.54:1 （1.4.11 クリア）を両立する L を選定。
      loop_correction_history: []       # WCAG ループで補正した場合の履歴
        # - attempt: 1
        #   token: "--color-primary"
        #   before: { hex: "#0369A1", oklch_l: 0.48 }
        #   after:  { hex: "#0B76B5", oklch_l: 0.52 }
        #   reason: "contrast 2.92:1 < 3.0:1 (1.4.11)"

    typography:
      - role: "display"
        family: "Plus Jakarta Sans"
        weights: [600, 700]
        source: "Google Fonts"
        usage: "見出し・KPI 値（幾何学プレミアム）"
      - role: "base"
        family: "IBM Plex Sans"
        weights: [400, 500, 700]
        source: "Google Fonts"
        usage: "本文・UI ラベル"
      - role: "numeric"
        family: "JetBrains Mono"
        weights: [500, 700]
        source: "Google Fonts"
        usage: "速度・距離・時刻・利用率"
      # 和文併用がある場合
      - role: "display_jp"
        family: "Noto Sans JP"
        weights: [500, 700]
        source: "Google Fonts"
        usage: "日本語見出し併用"

    dials:                              # §5 Layout ダイヤル（整数）
      design_variance: 6                # 1-10
      motion_intensity: 4
      visual_density: 8

    signature_animation:                # §5 / §9 の構造化仕様
      name: "gauge-tick-sweep"
      applied_to: [".kpi-tile .mini-gauge .needle"]
      duration_ms: 1000
      timing: "cubic-bezier(0.22, 1, 0.36, 1)"
      iteration: "infinite"             # int | "infinite"
      keyframes_hint: "rotate 0→8°→0"
      event_binding: null               # "tap" / "scroll" / "hover" があれば詳細
      reduced_motion_fallback: "disable"  # disable / static / simplified

    depth:
      shadow_sm: "0 1px 2px rgba(3,10,30,0.35)"
      shadow_md: "0 4px 16px rgba(3,10,30,0.55)"
      shadow_lg: "0 16px 40px rgba(3,10,30,0.65)"
      shadow_primary: "0 10px 24px rgba(11,118,181,0.28)"   # optional、hover 時等

    layout:
      grid_policy: "非対称 1fr 2fr 1fr / 3-col equal 禁止"
      spacing_scale: [4, 8, 12, 16, 24, 32, 48]              # px、archetype に応じた刻み
      breakpoints: [375, 768, 1024, 1440]
      descriptor:                                            # 主コンテンツ一覧の構造記述子 (3案 distinct 判定の SoT)
        content_anchor: [string]                             # 主コンテンツ一覧クラス名 (HTML と同名)
        list_container: string                               # grid | flex-column | flex-row | stack
        columns: integer                                     # 列数 (単列=1)
        item_layout: string                                  # vertical | photo-left | fullbleed 等

    donts: [string]                     # §7 禁止事項の箇条書き

    agent_prompt_guide:                 # §9 を構造化（narrative 版は narrative.agent_prompt_guide に）
      tokens_json_hint: string          # 10/12 への申し送り
      style_guide_hint: string          # 12 への申し送り
      screen_gen_hint: string           # 17 への申し送り
      icon_rule: string
      additional_rules: [string]

  - id: "B"
    # ... 同構造
  - id: "C"
    # ... 同構造

differentiation_summary:
  primary_h_diffs: { "A-B": 49, "A-C": 33, "B-C": 82 }
  family_display: { A: "Plus Jakarta Sans", B: "Syne", C: "Instrument Serif" }
  signature_animation: { A: "gauge-tick-sweep", B: "hex-ripple-outward", C: "whisper-fade-stack" }
  theme_mode: { A: "dark", B: "dark", C: "light" }
  notes: |
    機械的ルール:
    - primary OKLCH H の 3 案間差が 30° 以上
    - family_display が 3 案すべて異なる
    - signature_animation が 3 案すべて異なる

anti_slop_check:
  all_passed: bool
  results:
    - { item: "Inter 不使用", A: true, B: true, C: true }
    - { item: "#000000 不使用", A: true, B: true, C: true }
    # ... 全項目
```

**不変量（invariant）**:
- 08 が唯一の author（新規生成・ループ再実行時の上書き）
- 10 承認時は yaml の schema + `selected_sample_id` / `selected_label` / `approved_at` のみ追加、`cases[]` は 3 案保持（retro での棄却案参照のため）
- 10 否認時は yaml 削除
- WCAG ループ時（11 が violations[] 検出 → 08 再実行）は該当 case の `palette.tokens[]` と `loop_correction_history[]` を更新

**参照（内部完結）**: `skills/08-design-brainstorm/refs/typography-pairing.md` / `refs/anti-slop-rules.md` / `refs/design-brief-template.md`

**責務**: ヒアリング・3方向性決定・各案 palette（OKLCH導出）・typography・motion・anti-slopチェックまで完結。**色の具体値（Hex）を確定させる**のが08。HTMLは生成しない。

### 11 WCAG 2.2 AA 制約定義 + 3案palette検証

**実行順の注意**: 08 の直後・09 の**前**に実行される。AYATORI 原則「early validation」に従い、サンプル HTML が作られる前に WCAG 制約を確定 + 08 palette の色コントラストを検証する。

| | ファイル | 状態 |
|---|---|---|
| **IN** | `design-brief.yaml`（3案版） | 3案の `cases[].palette` と `common` を読み取り（contrast 計算対象） |
| **IN** | `docs/wcag-standards.md` | 閾値・contrast pair 一覧・計算式を参照 |
| **IN** | `wcag-mapping.json` | `app_name`・`constraints`・`criteria`（ループ中不変） |
| **IN** | `wcag-history.json` | 過去 attempt 履歴を参照（`len(attempts)` で現 attempt 番号を導出） |
| **OUT** | `wcag-mapping.json` | **初回のみ** `constraints`（色非依存閾値）・`criteria`（色非依存規則）を書き込み（以降不変） |
| **OUT** | `wcag-history.json` | 本 attempt の `{attempt_count, timestamp, violations[]}` を `attempts[]` に 1 件 append |

**責務拡張**:
- 色非依存制約の確定（touch target / focus ring / mobile font-size 等）
- **08 palette の全 contrast pair を計算** → 閾値未達なら `wcag-history.json` の最新 attempt の `violations[]` に記録
- `phases/design/SKILL.md` が最新 attempt の `violations[]` を見てループ制御

**計算対象**: `docs/wcag-standards.md` §6 の contrast pair 表（body-on-surface / primary-on-bg / focus-on-surface 等）

### 09 サンプル画面HTML生成（3案切替1ファイル・プラットフォーム別）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `design-brief.yaml`（3案版） | 単一ソース。hard constraint（palette HEX / typography family / dials 数値 / signature_animation 構造化仕様）と creative context（各 case の `narrative.{visual_theme, target_fit, component_stylings, depth, agent_prompt_guide}` / `concept` / `differentiation` / `archetype`）の両方をこの 1 ファイルから取得 |
| **IN** | `wcag-history.json` | 最新 attempt の loop 対象 violation（`pair_kind ∈ {palette, domain_surface}`）が **空** であることを確認（空でなければ中断→08差戻。attempt 上限到達時は warning_passthrough として続行し、loop 対象 violation を HTML 警告バナーに展開。warn-only の state_colors はゲート判定・バナーとも対象外 — Step 21 Section 1-E で表示。**file 不在 / attempts 空 = 未検証 → 中断し Step 11 実行を要求**（「違反なし」と読まない。subagent 側も同状態を検出したら `assertion_failed: wcag_unverified` を return し、orchestrator が skills/09 Phase 3.5.b で Step 11 差戻し）） |
| **IN** | `requirements.json` + `requirements/*.md` | `design_output_scope.platform_combo`（`web_only`/`mobile_only`/`mobile_and_web`）から対象 platform（web / mobile）を導出 + Must機能を判定。mobile は iOS ベース 1 枚に集約 |
| **IN** | `docs/html-generation-rules.md` | CSS変数命名・SVG・フォーム・サイズ規約を参照 |
| **OUT** | `design-samples/{platform}/index.html` | platform（web / mobile）ごとに1ファイル（`web_only`→1枚 / `mobile_only`→1枚 / `mobile_and_web`→2枚）。中身は3案切替1ファイル（CSS変数 + JS切替） |

**構造**: `<html data-variant="A">` でテーマ切替、`:root[data-variant="X"]` で palette/typography/motion を差替。

**プラットフォーム別 body サイズ**:
- web: `1440×900`
- mobile: `390×844`（iOS ベースで描画。iOS/Android は装飾差が主でファイルを分けるほどの差がないため mobile 1 枚に集約）

**責務**: 08 が決定した完璧な palette を機械的に HTML/CSS へ展開。生成後に安全網として contrast 再計算を行い、違反があれば `feedback-log.md` に Pattern B 記録 + HTML 警告バナー + subagent report (`wcag_safetynet.violations[]`) で報知する（処理は中断せず Step 10 人間ゲートで判断。wcag 系 artifact へは書かない — writer は Step 11 のみ）。

### 10 サンプル選択（人間ゲート）＋ design-brief.yaml に selected 情報記録

| | ファイル | 状態 |
|---|---|---|
| **IN** | `design-samples/**/index.html` | 人間が見比べて A/B/C 選択 or やり直し |
| **IN** | `design-brief.yaml`（3案版） | 選択案の情報を参照 |
| **OUT（選択）** | `design-brief.yaml` | **schema を `design-brief:final:v1` に更新、`selected_sample_id` / `selected_label` / `approved_at` を追加**。`cases[]` は 3 案保持（retro で棄却案を参照できるよう履歴保存） |
| **OUT（選択）** | `pipeline-state.json` | `selections.selected_sample_id`・`selections.selected_sample_direction` を記録 |
| **OUT（選択）** | `artifacts/.archive/design-samples-{timestamp}/` | 旧 `design-samples/` をアーカイブ（将来参照用） |
| **IN（カスタマイズ）** | — | Phase2申し送り（`revision_mode` を使った一部変更は未実装） |
| **OUT（やり直し）** | Phase 2 リセット → 08 へ | `design-brief.yaml` を削除 |

**責務**: 人間選択を受けて yaml のメタ情報（schema / selected_*）を更新するのみ。`cases[]` 配列は触らず 3 案保持のまま。12 以降は `yaml.cases[selected_sample_id]` を filter して読む。

**人間 UX**: 人間は `design-samples/*/index.html` を見て判断する。yaml/brief を直接読む必要はない。

### 12 デザインシステム生成（3層トークン + パーツカタログ + 色固有 WCAG 検証）

**追加責務**: 11 で定義した色非依存 WCAG 制約 (`constraints.contrast.*`) に照らして、確定色パレットの具体的 contrast ratio を実計算し違反がないことを検証する。違反があればトークン値を調整する。

**Figma 操作なし**: Step 12 はコード成果物のみを生成する。Figma Variables 3 コレクション (Primitives / Semantic / Component) の登録 + `figma-state.json` 更新は Step 24 (design-system-update) が担当する。

| | ファイル | 状態 |
|---|---|---|
| **IN** | `design-brief.yaml`（final:v1）| 単一ソース。`selected_sample_id` から `cases[]` をフィルタし、palette / typography / dials / signature_animation / narrative（OKLCH 導出根拠・Don'ts 含む）を機械処理に使用 |
| **IN** | `wcag-mapping.json` | `constraints`（色非依存の閾値）を参照 |
| **IN** | `wcag-history.json` | 検証ゲート: 最新 attempt の loop 対象 violations（`pair_kind ∈ {palette, domain_surface}`）が空であることを確認（warning_passthrough 時は続行し Step 13 人間ゲートで判断。warn-only の state_colors は残存可 — Step 21 経路。**file 不在 / attempts 空 = 未検証 → 中断し Step 11 実行を要求**、「違反なし」と読まない） |
| **OUT** | `tokens.json` | 新規作成 または 上書き（第1層: Primitives / 第2層: Semantic / 第3層: Component）+ 各色トークンの `$description` に実測 contrast 比を記録 |
| **OUT** | `style-guide.md` | 新規作成 または 上書き |
| **OUT** | `screens/style-guide-view.html` | 新規作成 または 上書き（6セクション必須） |
| **OUT** | `build/` 配下のマルチプラットフォームコード | `platform_combo` + `mobile_framework` + `legacy_android_xml` の組合せで決定（CSS / SCSS / TS / Swift / Compose / Flutter / KMP。Android XML は `legacy_android_xml == true` のみの legacy opt-in） |

### 13 スタイルガイド承認（人間ゲート）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `style-guide.md`・`screens/style-guide-view.html` | 表示 |
| **IN（承認）** | → 14 へ | — |
| **IN（修正指示）** | `tokens.json`・`style-guide.md`・`style-guide-view.html` | 修正後 13 を再表示 |
| **OUT（承認）** | `pipeline-state.json` | `approvals.step13_approved_at` に ISO 8601 を記録 |
| **OUT（Phase 2 リセット）** | `design-brief.yaml`・`wcag-mapping.json`・`wcag-history.json`・`tokens.json`・`style-guide.md`・`style-guide-view.html`・`screens/`・`scores.json` を削除 + `pipeline-state.json` の `selections.*` / `approvals.step13_approved_at` を unset | リセット → 08 へ |

### 14 画面一覧・遷移図生成

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements.json`・`02-scope.md`・`05-features.md` | 読み取り |
| **OUT** | `screens/00-screen-list.md` | 新規作成 |
| **OUT** | `screens/00-transition-map.mmd` | 新規作成（純 Mermaid テキスト SSoT） |
| **OUT** | `screens/00-transition-map.html` | 新規作成（`docs/templates/transition-map.template.html` + `.mmd` で機械生成された派生） |

### screens-lite（Route A: reverse 基線確立）— 14-lite ＋ ベースライン承認ゲート

**適用条件**: `requirements.json.status == "REVERSE_ENGINEERED"` かつ `approvals.final_approved` が未 set のとき、Phase 3 入口の route 選択で「基線確立」が選ばれた場合のみ。**画面 HTML は生成せず** 17〜25 を実行しない（工程の正本は `phases/screens/SKILL.md` § Execution — screens-lite）。

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements.json`（status）・`tokens.json`（`"$value": "TBD"` 残存 0 件を機械検査）・`screens/00-screen-list.md`（リバース産）・`requirements/03-user-flow.md`（`.mmd` 不在時の salvage 源） | 読み取り |
| **OUT** | `screens/00-transition-map.mmd` + `screens/00-transition-map.derive-summary.json` | **不在時のみ** `scripts/derive-transition-map.mjs` で salvage 生成（既存は再生成しない = 人間の手修正を保護）。sidecar は `.mmd` を書いた run が併記する生成時 summary（`warnings[]` + `mmd_md5`）で、既存 `.mmd` を保持した run では Step 16 ゲートの警告提示材料がここからしか取れない |
| **OUT** | `screens/00-transition-map.html`・`screens/00-screen-nav.json` | 機械派生（テンプレート展開 / `scripts/derive-screen-nav.mjs`） |
| **OUT** | `screens/00-coverage-check.json` | 不在時のみ空 stub（L1〜L4 未実施 + `user_accepted_gaps: true`）→ `scripts/validate-connectivity.mjs --write` で L5 のみ patch |
| **OUT** | `screens/00-screen-list.md` | chrome 定義・割り当て列が無い場合のみ追記（画面一覧は再生成しない） |
| **OUT** | `screens/_shared/root-variables.css`・`common-styles.css`・`components.html`・`components.css`・`icons-manifest.json`（+ pictogram 時 `icons/*.svg`） | 新規作成（正典のみ。各画面 HTML への展開は行わない） |
| **OUT（Step 16 承認）** | `pipeline-state.json` | `approvals.step16_approved_at`（既存 skill 16 が writer。承認後は 15 / 17 へ進まずベースライン承認ゲートへ） |
| **OUT（ベースライン承認）** | `pipeline-state.json` | `approvals.baseline_approved_at` + `approvals.baseline_approved_via = "screens-lite-gate"` を**両方同時に**記録（未 set 時のみ = 冪等。押印直前に `requirements.json.status == "REVERSE_ENGINEERED"` を assert）。`approvals.final_approved` は**書かない**（画面レビュー未実施） |
| **OUT** | `index.html` | 2 回再生成（いずれも fail-open）: ゲート提示前 = preview helper の `refresh_index`（材料確認用、`step_id = "screens-lite-baseline-gate"` で auto-open）／押印後 = `scripts/build-artifact-index.mjs`（承認印をタイムラインに載せる） |

**前提条件**: `approvals.step13_approved_at`（Phase 2 承認済み — Phase 3 共通の入口条件）。
**効力**: 押印により Phase 1d / 5 / 6 の Entry Guard が開く（判定式の SoT は CLAUDE.md § 完走後 Phase 共通 Entry Guard）。Phase 4 retro は対象外。

### 16 デザイン用ドキュメント承認（人間ゲート）

**実行順の注意**: 14（画面一覧・遷移図生成）の直後・15（Confluence 保存）の**前**に実行される。AYATORI 原則「人間承認前の成果物は外部へ push しない」に従い、承認後に初めて 15 で Confluence 保存する。

| | ファイル | 状態 |
|---|---|---|
| **IN** | `screens/00-screen-list.md`・`screens/00-transition-map.mmd` (SSoT)・`screens/00-transition-map.html` (派生、ブラウザ表示用) | 表示（ローカル artifacts のみ、Confluence はまだ未保存） |
| **IN（承認）** | → 15（1回目 Confluence 保存）→ 17 へ | — |
| **IN（修正指示）** | `feedback-log.md` に追記 → 14 へ戻る | — |
| **OUT（承認）** | `pipeline-state.json` | `approvals.step16_approved_at` に ISO 8601 を記録 |
| **OUT（やり直し）** | `screens/00-*` 削除 → 13 へ戻る | — |

### 15 Confluence 保存（デザイン・画面）

**このステップは 2 回実行される**（`pipeline-state.confluence.design.save_count` で識別、いずれも人間承認後）。

- **1回目**: 16 承認の直後。`design-brief.yaml`（selected 案の narrative を rendered view として） + `style-guide.md` + `screens/00-*` を Confluence へ初回保存。`screens/*.md` 個別仕様書はまだ存在しないため glob で空。
- **2回目**: 21 承認の直後（`post_loop_reexecute`）。`screens/*.md` の全画面仕様書を追加保存。

| | ファイル | 状態 |
|---|---|---|
| **IN** | `design-brief.yaml`（1案版 selected）・`style-guide.md`・`screens/00-*` | 読み取り。yaml は selected 案を Confluence 向けに rendered markdown で書き出す |
| **IN（2回目）** | `screens/*.md`（画面仕様書） | 読み取り（glob、1回目はゼロ件） |
| **IN** | `pipeline-state.json` | `confluence.requirements.page_id`・`confluence.design.page_id` |
| **OUT** | `pipeline-state.json` | `confluence.design.page_id`・`confluence.design.doc_page_ids`・`confluence.design.save_status`・`confluence.design.save_count`（+1） |

**前提条件**: `pipeline-state.confluence.requirements.page_id`（06 で作成）が存在すること。直前の人間承認（16 または 21）が通過していること。

### 17 全画面HTML + 4状態パターン生成

| | ファイル | 状態 |
|---|---|---|
| **IN** | `requirements.json`・`tokens.json`・`style-guide.md`・`screens/00-*` | 読み取り |
| **IN（ループ時）** | `scores.json` | `current.tags` から AI 改善可能タグを抽出 |
| **OUT** | `screens/{画面名}.md` | 新規作成 または 上書き（platform 共通、root に 1 つ） |
| **OUT** | `screens/web/{画面名}.html` | Web デスクトップ版 1440×900（`platform_combo ∋ web` かつ `web_viewports ∋ desktop`〔欠落時 desktop 扱い〕時） |
| **OUT** | `screens/web-sm/{画面名}.html` | Web スマホ幅版 390×844・ブラウザページ体裁（`platform_combo ∋ web` かつ `web_viewports ∋ sm` 時） |
| **OUT** | `screens/mobile/{画面名}.html` | モバイル 390×844（`platform_combo ∋ mobile` 時） |
| **OUT** | `screens/{web,web-sm,mobile}/{画面名}--empty.html` / `--loading.html` / `--error.html` | 必須 4 状態（+ 画面性質別、各 platform フォルダ内） |

**制約**: HTML 固定サイズ、SVG アイコン必須（`stroke-linecap="round"`）、フォントアイコン禁止、全 Phase の画面を生成（01 の「デザイン出力範囲」決定に従う）。**必須**: state colors (`error/info/warning/success` の bg/text/border) は **tokens 参照のみ書く** (`var(--color-error-bg)` 等)。直書き hex (`#FEF2F2` 等) は禁止。tokens.json 未定義の state colors が必要な場合は Phase 2 (skill 08 / design-brief.yaml) に差し戻し、本 step で hex 補完しない。

### 18 3層デザインレビュー

| | ファイル | 状態 |
|---|---|---|
| **IN** | `screens/*.md`（全画面仕様書） | 読み取り |
| **IN** | `wcag-mapping.json`・`tokens.json` | 整合性チェック |
| **IN（Figma）** | `figma-state.json` | `nodes.screens` の ID で安全読み取り |
| **OUT** | メモリ内評価結果 | → 19 へ引き渡す |

### 19 ルーブリック採点（デザイン）

| | ファイル | 状態 |
|---|---|---|
| **IN** | 18 の評価結果（メモリ内）・`wcag-mapping.json` | — |
| **OUT** | `scores.json` | `current`（layer1-3・total・tags）を更新 |

### 20 フィードバックループ（デザイン）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `scores.json` | `current.ai_improvable_deductions`・`attempt_count` |
| **OUT（合格）** | → 21 へ | — |
| **OUT（ループ）** | `scores.json` | `attempt_count` を +1 → 17 へ |
| **OUT（エスカレーション）** | `scores.json` | `escalated: true` → 21 へ |

**ループ閾値**: `pipeline.yaml` の `screens.loop`。合格: `current.ai_improvable_deductions == 0` / エスカレーション: `attempt_count >= 3`

### 21 全画面HTML承認（人間ゲート）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `screens/**/*.html`（全画面 + 状態パターン、web/ + mobile/ サブフォルダ含む）・`scores.json` | 表示 |
| **IN** | `wcag-history.json` | `attempts[-1].violations` の `pair_kind == "state_colors"` を Section 1-E で表示（Phase 2 で warn-only 扱いにした state_colors の後追い確認） |
| **IN（承認）** | `pipeline-state.json` に `approvals.screens_human_approved = true` | → 15（2回目・名目は post_loop_reexecute）→ 22 へ |
| **IN（修正指示）** | `feedback-log.md` に追記 → 17 へ戻る | — |

### 22 Figma 出力（HTMLキャプチャ）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `screens/**/*.html`（Web + モバイル + 状態パターン、web/ + mobile/ サブフォルダ含む） | キャプチャ対象 |
| **IN** | `figma-state.json` | `file_key`・`page_id` 参照 |
| **OUT** | Figma ページ `AYATORI Pipeline` | HTML キャプチャ |
| **OUT** | `figma-state.json` | `nodes.screens.{画面名}` 更新（キャプチャ失敗時は `use_figma` 補助） |

**前提条件**: `FIGMA_MCP_ENABLED=true`（未設定時はスキップして 23 へ）。

### 23 人間最終承認（ゲート）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `scores.json`・`figma-state.json`・Figma URL | 表示 |
| **IN（承認）** | `pipeline-state.json` に `approvals.final_approved = true` | → 24 へ |
| **IN（修正指示）** | `feedback-log.md` に追記 → 17 へ戻る | — |
| **IN（却下）** | `feedback-log.md`・パイプライン中断 | → 26 へ（中断記録） |

### 24 デザインシステム更新（Variables 3 コレクション + Component Library + ComponentSet）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `screens/style-guide-view.html` (SoT、Step 0 抽出元)・`screens/**/*.html`（CSS 変数抽出元、web/ + mobile/ サブフォルダ含む）・`tokens.json` | 差分検出 + componentSpec 抽出 |
| **OUT** | `tokens.json` | 差分を反映して更新 (Step A、AskUserQuestion 人間承認後) |
| **OUT** | `artifacts/{app_name}/build/component-spec.json` | Step 0 dump、Step D で Read される SoT |
| **OUT** | Figma `Primitives` / `Semantic` / `Component` コレクション | 登録（エイリアス参照チェーン） |
| **OUT** | Figma Component Library フレーム + Foundations (Colors/Typography/Spacing/Touch Target/Radius) + ComponentSet (atoms/molecules/organisms) | Step C / D で構築 |
| **OUT** | `figma-state.json` | `nodes.variables.*`・`nodes.component-library`・`nodes.components.{atoms,molecules,organisms}` 更新 |

### 25 Variables バインド・動作確認

| | ファイル | 状態 |
|---|---|---|
| **IN** | `tokens.json`・`figma-state.json` (Step 24 で `nodes.components.*` 埋まっている前提) | 読み取り |
| **OUT** | Figma 画面フレーム (Step 22 でキャプチャ済) の fills/strokes | Primitives 色のみバインド (ComponentSet 配下は Step 24 でバインド済、本 step は触らない) |
| **OUT** | `figma-state.json` | `nodes.variables.bind_status` 更新 |

### 26 振り返りエージェント + パイプライン改善（人間ゲート）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `feedback-log.md`・`scores.json`・`rubric.json`・`scoring-history.json`・`wcag-history.json`・`pipeline-state.json` | 読み取り |
| **OUT** | `pipeline-improvements.md` | 新規作成（振り返り結果 + 改善提案適用記録） |
| **OUT（適用）** | `skills/NN-*/SKILL.md` | 承認された改善提案を Edit で直接反映 |

---

## Phase 5: Delta Update（Steps 27~30）

**前提条件**: `pipeline-state.json.approvals.final_approved == true` **OR** `pipeline-state.json.approvals.completed_at_states` is set **OR** (`pipeline-state.json.approvals.baseline_approved_at` is set **AND** `requirements.json.status == "REVERSE_ENGINEERED"` — 由来検査) (二段階完了モデル + reverse 基線例外 — CLAUDE.md 「完走後 Phase 共通 Entry Guard」が SoT)

**設計原則**: `tokens.json` / `design-brief.yaml` / `screens/_shared/` は **READ-ONLY**。デザインシステム変更が必要な場合は `/ayatori-design` 再実行（別フロー）。

### 27 変更検出（Change Detection）

| | ファイル | 状態 |
|---|---|---|
| **IN** | ユーザー入力（変更タイプ選択 → `feature_addition` の場合: 9項目ヒアリング / その他: 変更説明 Q1 + 変更ドキュメント選択 Q2） | 対話 |
| **IN** | `requirements/{selected_docs}` | 読み取り |
| **IN** | `delta/snapshots/{doc}.snapshot.md` | 差分比較（存在する場合） |
| **IN** | `requirements.json` | `interview_mode` 読み取り（`change_type == "feature_addition"` の場合のみ） |
| **IN** | `skills/27-change-detect/refs/feature-add-interview.md` | 参照（`change_type == "feature_addition"` の場合のみ） |
| **OUT** | `delta/change-manifest.json` | 新規作成 (run_id / change_description / requirement_changes[]) |
| **OUT** | `delta/snapshots/{doc}.snapshot.md` | 変更ドキュメントの現状 snapshot を保存 |
| **OUT** | `pipeline-state.json` | `delta.runs[]` に初回 stub エントリを append (run_id / change_description / initiated_at) |
| **OUT** | `delta/feature-add-brief.md` | 新規作成（`change_type == "feature_addition"` の場合のみ） |

### 28 インパクト分析（人間ゲート）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `delta/change-manifest.json` | 読み取り |
| **IN** | `screens/00-screen-list.md`・`screens/00-transition-map.mmd` (SSoT — `.html` は派生のため Read しない) | 読み取り |
| **IN** | `screens/{screen}.md`（全画面仕様書） | 読み取り |
| **OUT** | `delta/impact-analysis.md` | 新規作成 — 各画面を affected/new/removed/preserved/state_added に分類 (state_added: default HTML preserve + 追加 sub-state file のみ新規生成) |
| **OUT（承認）** | `pipeline-state.json` | `delta.runs[-1].{impact_approved_at, affected_screens, new_screens, removed_screens, state_added_screens, sub_state_aware}` を記録 |

### 29 部分画面再生成（人間ゲート）

**制約**: affected/new 画面のみ対象。preserved 画面は読みも書きも禁止。`tokens.json` / `_shared/` は READ-ONLY。

| | ファイル | 状態 |
|---|---|---|
| **IN** | `delta/impact-analysis.md` | 対象画面一覧を取得 |
| **IN** | `delta/change-manifest.json` | 変更内容を取得 |
| **IN** | `screens/_shared/root-variables.css`・`screens/_shared/common-styles.css` | 読み取り（READ-ONLY） |
| **IN** | `tokens.json` | 読み取り（READ-ONLY） |
| **OUT** | `screens/00-screen-list.md` | affected 画面変更時のみ更新 |
| **OUT** | `screens/00-transition-map.mmd` (SSoT) | 遷移変更時のみ更新 |
| **OUT** | `screens/00-transition-map.html` (派生) | 遷移変更時のみ、template + 更新済み `.mmd` で再生成 |
| **OUT** | `screens/{affected_screen}.md` | 更新（affected のみ） |
| **OUT** | `screens/{platform}/{affected_screen}*.html` | 更新または新規（affected/new のみ） |
| **OUT（削除）** | `screens/{platform}/{removed_screen}*.html`・`screens/{removed_screen}.md` | 削除（Figma フレーム削除は Step 30） |
| **OUT（承認）** | `pipeline-state.json` | `delta.runs[-1].screens_approved_at` に ISO 8601 を記録 |

### 30 部分 Figma 更新（人間ゲート）

| | ファイル | 状態 |
|---|---|---|
| **IN** | `delta/impact-analysis.md` | recapture / new_capture / delete_only リスト取得 |
| **IN** | `figma-state.json` | preserved フレームの node_id 参照（READ-ONLY） |
| **OUT** | Figma ページ（対象フレームのみ） | recapture/new 画面を再キャプチャ、removed フレームを削除 |
| **OUT** | `figma-state.json` | affected/new 画面の node_id 更新。preserved は変更なし |
| **OUT** | `delta/run-history.json` | run サマリーを append |
| **OUT（承認）** | `pipeline-state.json` | `delta.runs[-1].figma_approved_at` に ISO 8601 を記録（run 完了の合図） |

---

## ステップ間依存関係サマリー

```
01 → requirements/00-raw-input.md, requirements.json(app_name)
02 → requirements/01〜08-*.md
03 → rubric.json(criteria — 初回のみ書込で以降不変), scoring-history.json(空配列で初期化)
04 → scoring-history.json(attempts[] に 1 件 append。total/scores/check_results/deficiencies/ai_improvable_count)
05 → ルーティング (attempts[-1].total / len(attempts) で pass/loop/escalate 判定。attempt_count / escalated は導出)
06 → pipeline-state.json(confluence.requirements.{page_id, doc_page_ids, save_status})
07 → ルーティング
08 → design-brief.yaml(3案版・schema:draft:v1、narrative + 構造化データ)
  [ループ時: wcag-history.json の最新 attempt の violations[] を読んで該当 palette token を補正、yaml cases[X].palette.loop_correction_history[] に追記]
11 → wcag-mapping.json(constraints, criteria — 初回のみ書込で以降不変),
     wcag-history.json(attempts[] に 1 件 append。violations[] + attempt_count + timestamp)
  [色非依存制約の確定 + 08 palette の色 contrast 検証]
  [08↔11 ループ判定: 最新 attempt の violations[] 空 → 09 / 違反あり && len(attempts)<3 → 08 / len(attempts)>=3 → 警告後09]
09 → design-samples/{platform}/index.html（P2統一・3案切替1ファイル・安全網再検証）
10 → design-brief.yaml(schema:final:v1 + selected_sample_id/selected_label/approved_at 追加。cases[] は 3 案保持),
     pipeline-state.json(selections.selected_sample_id, selections.selected_sample_direction),
     artifacts/.archive/design-samples-{timestamp}/（旧 design-samples/ 退避）
12 → tokens.json(色固有WCAG検証済), style-guide.md, screens/style-guide-view.html, build/(マルチプラットフォームコード)
    [Figma 操作なし。figma-state.json は 22/24/25 が更新する]
13 → ルーティング
14 → screens/00-screen-list.md, screens/00-transition-map.mmd (SSoT), screens/00-transition-map.html (派生)
16 → ルーティング（承認時のみ 15 1回目へ進む）
15 (1回目) → pipeline-state.json(confluence.design.* 事前分), confluence.design.save_count = 1
17 → screens/{画面名}.md, screens/{web,web-sm,mobile}/{画面名}{,--*}.html, scores.json(current)
18 → メモリ内評価
19 → scores.json(current)
20 → ルーティング / scores.json(attempt_count, escalated)
21 → pipeline-state.json(approvals.screens_human_approved), ルーティング（post_loop_reexecute: 15 再実行）
15 (2回目) → pipeline-state.json(confluence.design.doc_page_ids に screens/*.md ページを追加), confluence.design.save_count = 2
22 → figma-state.json(nodes.screens)
23 → pipeline-state.json(approvals.final_approved)   # final_approval_date は orphan 削除済
24 → tokens.json 差分反映, Figma Variables 3 コレクション, figma-state.json(variables)
25 → Figma Component Library, figma-state.json(components)
26 → pipeline-improvements.md, skills/NN-*/SKILL.md（承認された改善を適用）

# Phase 3 screens-lite (Route A: reverse 基線確立。requirements.json.status == "REVERSE_ENGINEERED" AND approvals.final_approved 未 set のとき入口の route 選択で選べる。画面 HTML は作らない)
14-lite       → screens/00-transition-map.mmd(不在時のみ salvage) + 00-transition-map.derive-summary.json(salvage した run のみ。script が併記する sidecar), 00-transition-map.html, 00-screen-nav.json, 00-coverage-check.json(不在時のみ空 stub + L5 のみ patch), 00-screen-list.md(chrome 定義・割り当てのみ追記)
16            → pipeline-state.json(approvals.step16_approved_at)   # 既存 skill をそのまま使い、承認後は 15/17 でなく _shared 正典生成へ
lite-3        → screens/_shared/{root-variables.css, common-styles.css, components.html, components.css}, icons-manifest.json(+ pictogram 時 icons/*.svg)
              # skills/17 側に lite 専用の節は無い。lite-3 (phases/screens/SKILL.md) が skills/17-screen-gen の
              # Step 0 (アイコン一括取得) と Step 0b-1 (chrome 正典) + phases/screens § Step 17 の Phase A 手順 3・4
              # (共有 CSS) だけを再利用する。画面 HTML / 画面仕様書は生成しない
baseline gate → pipeline-state.json(approvals.baseline_approved_at + approvals.baseline_approved_via="screens-lite-gate" — 未 set 時のみ両キー同時。approvals.final_approved は書かない), index.html 再生成(fail-open)

# Phase 0b (reverse) — Completion が押印する cross-phase write (Phase 1b を通らない経路)
Completion → pipeline-state.json(approvals.step07_approved_at + approvals.step07_approved_via="reverse-review-gate" — 未 set 時のみ両キー同時。二重 writer の例外は docs/artifact-file-responsibility.md)

# Phase 0c (reverse_verify) — 任意・反復。entry requires requirements.json.status == "REVERSE_ENGINEERED" + requirements/01-08.md + screens/00-screen-list.md 実在 (ls 実測)。approvals.* は書かない
V1 → reverse-verify/scope-manifest.json, reverse-verify/.code-inventory.json(承認時), pipeline-state.json(reverse_verify.runs[] stub append → 承認時に scope_approved_at) | on cancel: pipeline-state.json(cancelled_at, cancel_reason)
V2 → reverse-verify/crosscheck-report.md, reverse-verify/.deviations-before.json, requirement-deviations.json(phase="reverse_verify" entry + coverage、run_id/first_run_id 必須), pipeline-state.json(reverse_verify.runs[-1].{crosscheck_completed_at, findings_total})
V3 → requirements/0{N}-*.md（承認された訂正・マーカー解除のみ）, screens/{slug}.md, reverse-verify/snapshots/{run_id}/, requirement-deviations.json(resolved_at/resolution/resolution_mode), pipeline-state.json(reverse_verify.runs[-1].{findings_resolved_at, corrections_applied, corrections_docs, markers_cleared, findings_deferred})
Completion → pipeline-state.json(reverse_verify.runs[-1].completed_at)

# Phase 1c (req_delta) — entry requires approvals.step07_approved_at is set (Phase 1b skill 07 または Phase 0b Completion のどちらの押印でも可)
31 → req-delta/change-manifest.json, req-delta/snapshots/{doc}.snapshot.md, pipeline-state.json(req_delta.runs[] stub)
32 → req-delta/doc-impact-analysis.md, pipeline-state.json(req_delta.runs[-1].{directly_changed_docs, impacted_docs, impact_approved_at})
33 → requirements/0{N}-*.md（directly_changed + impacted のみ）, req-delta/run-history.json, pipeline-state.json(req_delta.runs[-1].revisions_approved_at)

# Phase 1d (add_feature) — entry requires approvals.final_approved == true OR approvals.completed_at_states is set OR (approvals.baseline_approved_at is set AND requirements.json.status == "REVERSE_ENGINEERED") (二段階完了モデル + reverse 基線例外 — 由来検査つき)
01b → req-delta/change-manifest.json (source: "skill-01b" 付き), req-delta/snapshots/{doc}.snapshot.md, pipeline-state.json(req_delta.runs[] stub append with initiated_at)
     [handoff → Phase 1c。change-manifest.json.source == "skill-01b" の場合 Phase 1c は Step 31 を bypass し Step 32 から開始]

# Phase 5 (delta) — entry requires approvals.final_approved == true OR approvals.completed_at_states is set OR (approvals.baseline_approved_at is set AND requirements.json.status == "REVERSE_ENGINEERED") (二段階完了モデル + reverse 基線例外 — 由来検査つき)
27 → delta/change-manifest.json, delta/snapshots/{doc}.snapshot.md, pipeline-state.json(delta.runs[] stub append)
28 → delta/impact-analysis.md, pipeline-state.json(delta.runs[-1].{impact_approved_at, affected_screens, new_screens, removed_screens, state_added_screens, sub_state_aware}) | on cancel: pipeline-state.json(cancelled_at, cancel_reason)
29 → screens/{affected}*.html, screens/{affected}.md, pipeline-state.json(delta.runs[-1].screens_approved_at) | on cancel: pipeline-state.json(cancelled_at, cancel_reason)
30 → figma-state.json(affected frames only), delta/run-history.json, pipeline-state.json(delta.runs[-1].figma_approved_at)

# Phase 6 (delta_mini) — entry requires (approvals.final_approved == true OR approvals.completed_at_states is set OR (approvals.baseline_approved_at is set AND requirements.json.status == "REVERSE_ENGINEERED")) AND pending run (any delta.runs[] / req_delta.runs[] without mini_retro_completed_at)
34 → pipeline-improvements.md (承認件数 > 0 のみ section append), feedback-log.md (末尾に mini-retro-marker append; marker_id は phase6-{compact UTC timestamp}), pipeline-state.json(pending な delta.runs[] / req_delta.runs[] 全 entry に {mini_retro_completed_at, mini_retro_appended, mini_retro_pattern_count})
     [skill 26 Phase E パターンの inline 承認ゲート。承認件数 > 0 のときのみ SKILL.md Edit を伴う]
```

---

## 破壊的変更ルール

以下の変更はパイプラインの整合性を壊す可能性があるため、必ず全ステップへの影響を確認すること：

| 変更の種類 | 確認対象 |
|---|---|
| `rubric.json` のキー名変更 | 03（writer、criteria 不変量のみ）/ 04（reader）/ 26（reader） |
| `scoring-history.json` のキー名変更 | 03（init）/ 04（writer、append）/ 05 / 07 / 26（reader） |
| `scores.json` のキー名変更 | 19 / 20 / 17（ループ時） |
| `requirements.json` のキー名変更 | 01 / reverse Step 06（writer）+ 全 phase（reader） |
| `pipeline-state.json` のキー名変更 | 06 / 07 / 10 / 13 / 15 / 16 / 21 / 23（cross-phase hot state、writer 多数） |
| `wcag-mapping.json` のキー名変更 | 08 / 11 / 12 / 18 / 19（不変量のみ。`violations[]` は wcag-history.json へ分離済。09 は wcag-history のみ参照） |
| `wcag-history.json` のキー名変更 | 11（writer、attempt ごとに append） / 08（ループ時補正）・09（ゲート判定 + warning_passthrough バナー展開）・12・13・19・21（state_colors 表示）・26（reader） |
| `design-brief.yaml` のスキーマ変更（フィールド追加・改名・削除、draft:v1 / final:v1 tag 変更） | 08 / 09 / 10 / 11 / 12 / 15 / 17 / 22 / 24 / 25 |
| `docs/wcag-standards.md` の閾値変更 | 08 / 11（+ 17 の WCAG 遵守要件） |
| `docs/html-generation-rules.md` の命名規約変更 | 09 / 12 / 17 / 24 / 25 |
| `tokens.json` のトークン名変更 | 12 / 13 / 17 / 18 / 24 |
| `figma-state.json` の構造変更 | 18 / 22 / 24 / 25 (Step 12 は Figma を触らないため対象外) |
| ループ閾値の変更 | `pipeline.yaml` の `loop` セクションが唯一の定義場所。05 と 20 が参照する |
| `post_loop_reexecute` 対象の変更 | `pipeline.yaml` の `screens.post_loop_reexecute` と `phases/screens/SKILL.md` を必ず同期 |
| `delta/change-manifest.json` の構造変更 | 27（writer）/ 28 / 29 / 30（reader）|
| `delta/impact-analysis.md` の構造変更 | 28（writer）/ 29 / 30（reader）|
| `pipeline-state.json.delta.runs[]` のキー名変更 | 28 / 29 / 30（writer）/ phases/delta/SKILL.md（resume logic） |
