---
name: 32-req-impact-analysis
description: Phase 1c の Step 32。req-delta/change-manifest.json の変更を依存マップに沿って 8 種の ISO 29148 文書へ追跡し、各文書を directly_changed / impacted / preserved に分類する。人間レビュー用の影響レポートを生成し、修正着手前に人間確認ゲートを通す。
---

# 32 Cross-Document Impact Analysis

## Role
Trace the change in `req-delta/change-manifest.json` across all 8 ISO 29148 documents using a dependency map. Classify each document as `directly_changed`, `impacted`, or `preserved`. Produce a human-reviewable impact report and gate on human confirmation before any revisions begin.

## Preconditions
- `artifacts/{app_name}/req-delta/change-manifest.json` exists (Step 31 complete)
- All 8 `artifacts/{app_name}/requirements/` documents exist

---

## Execution

### Step 1: Load context

Read:
- `artifacts/{app_name}/req-delta/change-manifest.json`
- **Only the `directly_changed_docs`** from `requirements/` (from the manifest's `directly_changed_docs` field)

Do **not** read the remaining 6–7 documents yet — they are read lazily in Step 2 only if the dependency map flags them as potentially impacted.

### Step 2: Apply the document dependency map

Use the following dependency map to reason about which documents are impacted:

| Change type | Directly affects | Likely ripples to |
|---|---|---|
| New/changed user type or role | `05-features.md` | `01-overview.md`, `02-scope.md`, `03-user-flow.md`, `04-use-cases.md`, `07-data-definition.md` |
| New/changed feature or flow | `05-features.md` | `03-user-flow.md`, `04-use-cases.md` |
| New/changed data entity | `07-data-definition.md` | `04-use-cases.md`, `05-features.md` |
| Scope change | `02-scope.md` | `01-overview.md`, `05-features.md` |
| NFR change | `06-non-functional.md` | `08-constraints.md` |
| Constraint change | `08-constraints.md` | `06-non-functional.md`, `05-features.md` |
| **Hardware / platform feature** | `05-features.md` | `03-user-flow.md`, `04-use-cases.md`, **`06-non-functional.md`, `07-data-definition.md`, `08-constraints.md`** (3 文書同時 ripple) |

**`hardware_platform_feature` カテゴリの判定基準** (dependency_map のハードウェア機能未対応問題への対応):

以下のいずれかに該当する機能追加 / 変更は `hardware_platform_feature` カテゴリに分類する:

- **OS API / 権限**: Bluetooth (BLE / Classic) / WiFi / NFC / GPS / カメラ / マイク / push 通知 / ファイルシステム / 加速度センサー / バイオメトリクス / クリップボード等
- **外部通信**: ネットワーク I/O (HTTP / WebSocket / gRPC) を新たに開始する機能 (既存通信機能の追加変更は対象外)
- **データ永続化の新基盤**: 既存 DataStore / SQLDelight 以外の新ストレージ (OS Keychain / CloudKit / Firestore 等)
- **デバイス間通信**: 同一アプリの別端末との接続 (BLE peer / Nearby Share 等) — 同時複数 player の状態同期を伴う

これらの機能は構造的に「**NFR (接続性 / latency / セキュリティ) + データ定義 (peer / session / 状態同期) + 制約 (permission / OS バージョン / 対応ハードウェア)** が同時に発生する」 性質を持つため、dependency_map の pair (2 文書間 ripple) では捕捉できない。本カテゴリを使うと 06/07/08 への ripple が **同時に保証** される。

> **判定責務**: 本カテゴリは Step 31 で `requirement_changes[]` の各 entry に **明示的に** 設定される。判定の入力としては `change-manifest.json.change_description` に「BLE 対戦」「位置情報を使う」「写真を撮影する」等のキーワードが含まれるかを参照。skill 01b (`/ayatori-add-feature` 起動経由) は 7 軸ヒアリングで「追加機能は OS 機能 / ハードウェア / 外部通信を伴うか」を必ず問い、Yes なら本カテゴリを自動付与する。

For each `requirement_changes[]` entry in the manifest, use the entry's **`dependency_category`** field to look up the row in the dependency map above and get the **candidate impacted docs**. If `dependency_category` is `other` or absent, treat all non-directly-changed docs as candidates. Then:
1. Read only those candidate docs (lazy load — do not read docs not in the candidate list)
2. Read each candidate doc and verify whether it actually needs updating
3. Docs not in `directly_changed_docs` AND not in the candidate list are classified `preserved` **without reading** — the dependency map is the only gate. Candidate docs that turn out to be already consistent are also classified `preserved` (read + verified, but no write needed)

### Step 3: Classify each document

For every document in the requirements set, assign one of:

| status | meaning |
|---|---|
| `directly_changed` | User explicitly named this doc as changed (from Q2 in Step 31) |
| `impacted` | Dependency map indicates this doc needs updating for consistency |
| `preserved` | No changes needed — document is consistent with the change |

### Step 4: Write `req-delta/doc-impact-analysis.md`

```markdown
# Requirements Impact Analysis — {change_description}

Run ID: {run_id}  |  Date: {YYYY-MM-DD}

## Summary
{1-2 sentence summary of what changed and overall document scope}

## Directly Changed Documents ({N} of 8)

| Document | Changed Sections | Summary |
|---|---|---|
| 05-features.md | アカウント種別 | 制作者・入力者 2 種類への分割 |

## Impacted Documents ({M} of 8)

| Document | Impact Type | Required Changes |
|---|---|---|
| 03-user-flow.md | impacted | 制作者フロー・入力者フロー を別フローとして追加 |
| 04-use-cases.md | impacted | 種別別ユースケースを追加 |
| 07-data-definition.md | impacted | User エンティティに account_type フィールドを追加 |

## Preserved Documents ({K} of 8)

| Document | Reason |
|---|---|
| 06-non-functional.md | ユーザー種別に依存しない非機能要件 |
| 08-constraints.md | 制約は変更なし |
```

Write to `artifacts/{app_name}/req-delta/doc-impact-analysis.md`.

### Step 5: Human gate

Present AskUserQuestion:
- **要件インパクト分析の確認** — `artifacts/{app_name}/req-delta/doc-impact-analysis.md` を確認してください
  - Option A: 承認 — この範囲で Step 33（修正案生成）に進む
  - Option B: 範囲を修正 — 追加・除外するドキュメントを指定する
  - Option C: キャンセル — req-delta 実行を中止する

**On A (approved)** — run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。Step 31 が完了しているか確認してください。"); exit(1)
data = json.loads(open(path).read())
if not data.get("req_delta", {}).get("runs"):
    print("ERROR: req_delta.runs が空です。Step 31 が完了しているか確認してください。"); exit(1)
data["req_delta"]["runs"][-1].update({
    "directly_changed_docs": __DIRECTLY_CHANGED_DOCS__,
    "impacted_docs": __IMPACTED_DOCS__,
    "impact_approved_at": datetime.now(timezone.utc).isoformat()
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: impact_approved_at written")
PYEOF
```
→ proceed to Step 33.

**On B (modify)**: Ask the user: "追加・除外するドキュメントを指定してください。（例: '+03-user-flow.md を impacted に追加', '−01-overview.md を preserved に変更'）" Apply corrections directly to the classification tables in `doc-impact-analysis.md`. Do **not** re-run Steps 1–4. Do **not** update `pipeline-state.json` yet — `impact_approved_at` must only be set on an explicit Option A approval. Re-present the gate.

> **Note on crash during Option B**: If execution crashes after updating `doc-impact-analysis.md`, the resume path (Step 32 Step 5 only) re-presents the gate using the on-disk `doc-impact-analysis.md`. The user's corrections in the markdown are preserved. The user must select Option A to write the corrected lists and `impact_approved_at` to `pipeline-state.json`.

**On C (cancel)** — run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。"); exit(1)
data = json.loads(open(path).read())
if not data.get("req_delta", {}).get("runs"):
    print("ERROR: req_delta.runs が空です。"); exit(1)
data["req_delta"]["runs"][-1].update({
    "cancelled_at": datetime.now(timezone.utc).isoformat(),
    "cancel_reason": "user_abort"
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: cancelled_at / cancel_reason written")
PYEOF
```
Display "Req-Delta 実行を中止しました。変更はありません。" and exit.

---

## Output
- `artifacts/{app_name}/req-delta/doc-impact-analysis.md`
- `pipeline-state.json` — `req_delta.runs[-1].{impact_approved_at, directly_changed_docs, impacted_docs}` set
