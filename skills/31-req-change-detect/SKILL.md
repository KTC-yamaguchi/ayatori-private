---
name: 31-req-change-detect
description: Phase 1c の Step 31。仕様変更内容を収集し、構造化した req-delta/change-manifest.json を生成する。以降の Step 32 / 33 はこのマニフェストのみを唯一の変更ソースとして駆動する。
---

# 31 Requirements Change Detection

## Role
Capture the specification change and produce a structured `req-delta/change-manifest.json`. This is the sole source of truth for what changed — every downstream step (32, 33) is driven exclusively by this manifest.

## Preconditions
- `artifacts/{app_name}/pipeline-state.json` exists with `approvals.step07_approved_at` set
- `artifacts/{app_name}/requirements/` contains the 8 ISO 29148 documents

---

## Execution

### Step 1: Collect change description

**Step 1a — Determine change type:**

Present AskUserQuestion:
```
question: "今回の変更はどのタイプですか？"
header: "変更タイプ"
options:
  - label: "機能追加"
    description: "新しい機能を既存プロジェクトに追加する（9項目のヒアリングを実施）"
  - label: "仕様変更"
    description: "既存機能の要件・動作・画面フローを変更する"
  - label: "バグ修正"
    description: "設計上の誤りや矛盾を修正する"
  - label: "削除・廃止"
    description: "既存機能・画面・要件を取り除く"
```

Map selection to `change_type`: "機能追加" → `feature_addition` / "仕様変更" → `spec_change` / "バグ修正" → `bug_fix` / "削除・廃止" → `removal` / "Other"（自由入力） → `other`.

**Step 1b — Collect change content:**

**`change_type == "feature_addition"` の場合:**
`skills/27-change-detect/refs/feature-add-interview.md` を Read して実行する（`{delta_dir}` = `req-delta`）。ヒアリング完了後、回答から `feature_add` JSON ブロックをメモリに構築する（`feature-add-interview.md` § Output: feature_add block の構造に従う）。`change_description` = `feature_add.feature_name`。Q2 はスキップする（`directly_changed_docs` は Step 2 で自動設定）。

**その他の変更タイプの場合:**
以下の質問を **plain chat** で提示する（自由記述の単独質問に AskUserQuestion を 1 option で代用しない — `skills/01b-add-feature-question/SKILL.md` § 設計判断）:
- Q1: **変更の説明** — 何が変わりましたか？（自由記述。例: 「ログインユーザーをアバター制作者とスクリプト入力者の2種類に分ける」）

Set `change_description` = Q1 answer.

**`change_type != "feature_addition"` の場合のみ — Q2 (plain chat 番号付きリスト、AskUserQuestion 不使用):**
8 doc は AskUserQuestion の option 上限 4 を超えるため、`skills/01b-add-feature-question/SKILL.md` § Plain chat fallback の書式で提示する:

```
すでに手動で編集済みのファイル、または変更の起点となるファイルを選択してください（直接変更したドキュメント）。

1. 01-overview.md — プロジェクト概要
2. 02-scope.md — スコープ定義
3. 03-user-flow.md — ユーザーフロー
4. 04-use-cases.md — ユースケース
5. 05-features.md — 機能一覧
6. 06-non-functional.md — 非機能要件
7. 07-data-definition.md — データ定義
8. 08-constraints.md — 制約・前提

選択方法: 該当する番号をカンマ区切りで返信してください (例: 「1, 3, 5」)。複数選択可。
全件の場合は「all」と返信してください。
```

返信された番号をファイル名に解決して選択結果とする (「all」は全 8 doc)。番号 / `all` のいずれにも解決できない返信、または解決できない番号が含まれる返信は同リストを再提示する。ただし「やめる」「後で決める」等の中止意図の返信は再提示ループに固定せず (25a Q2 と同じ規律)、`req-delta/change-manifest.json` を書かずに phase を終了する (次回 `/ayatori-req-delta` 起動時に最初からやり直せる)。

**`change_type == "feature_addition"` の場合は Q2 をスキップする。** `directly_changed_docs` は Step 2 で `["05-features.md"]` に自動設定される。Step 32 は `dependency_category: "other"` によりすべての非直接変更ドキュメントを候補として読むため、追加のドキュメント選択は不要。

### Step 2: Read changed documents

**`change_type == "feature_addition"` の場合:** `requirement_changes` を `feature_add` ヒアリング結果から自動生成する — `05-features.md` に以下のエントリを作成し、Step 3 をスキップして Step 4 へ進む:
```json
{
  "doc": "05-features.md",
  "section": "{feature_add.feature_name}",
  "type": "added",
  "dependency_category": "other",
  "summary": "{feature_add.user_value} — シチュエーション: {feature_add.situation} / 操作フロー: {feature_add.user_flow (steps joined with \" → \")} / 位置づけ: {feature_add.positioning}",
  "impact_hint": "{feature_add.feature_name} の新規追加。使用場面: {feature_add.usage_scene}。既存機能との重なり: {feature_add.existing_overlap}。位置づけ: {feature_add.positioning}"
}
```

Set `directly_changed_docs = ["05-features.md"]` — this is the only directly changed document for a feature_addition. No other doc should be added here; Step 32 treats every `directly_changed_docs` entry as already changed. Q2 is skipped for this path (see Step 1b).

**その他の変更タイプの場合:**

**Zero-doc guard**: If Q2 returned an empty selection, display: "⚠️ 少なくとも 1 つのドキュメントを選択してください。" and re-present Q2.

For each selected document, Read `artifacts/{app_name}/requirements/{doc}` and extract the sections that were modified. Compare against any prior snapshot if available (check `artifacts/{app_name}/req-delta/snapshots/` for `{doc}.snapshot.md`).

> **Section definition**: A section is the **nearest heading that encloses the change** — prefer `##`, and fall back to `###` when no `##` encloses it (same rule as `skills/27-change-detect/SKILL.md`; keep the two in sync). If multiple sections changed, list each as a separate entry in `requirement_changes[]`. If the document has no headings at all, use the document filename as the section name.
> Why the fallback: reverse-engineered requirement docs group feature categories under `###`, so a strict `##`-only rule points at the wrong section (typically the trailing hand-off note). Forward-generated docs (`##`-structured) resolve to the same heading as before, so this is backward compatible.

### Step 3: Classify each change

For each changed section, classify both fields:

**`type`** — structural change kind:

| type | description |
|---|---|
| `added` | New requirement, screen, user type, or flow that did not exist before |
| `modified` | Existing requirement changed in scope, behaviour, or naming |
| `removed` | Requirement, feature, or flow explicitly removed |

**`dependency_category`** — semantic category used by Step 32's dependency map to determine candidate impacted docs:

| dependency_category | meaning |
|---|---|
| `user_type_role` | New/changed user type or role |
| `feature_flow` | New/changed feature or flow |
| `data_entity` | New/changed data entity |
| `scope` | Scope change |
| `nfr` | NFR change |
| `constraint` | Constraint change |
| `hardware_platform_feature` | OS API / 権限 / 外部通信 / デバイス間通信を伴う機能。`06-non-functional`, `07-data-definition`, `08-constraints` への 3 文書同時 ripple をモデル化。判定基準は skill 32 Step 2 参照 |
| `other` | Does not match any map entry — Step 32 will read all non-directly-changed docs as candidates |

**`impact_hint`** — free-text description of which documents or flows this change may affect downstream. Used by Steps 32/33 for impact analysis. Required for every entry.

**Operating Principle 4 — Disambiguation (flavor a):** classifying `type` / `dependency_category` is an
interpretation of the user's change description. Apply `docs/principle4-disambiguation.md` §1:
enumerate candidate classifications; if a change admits N≥2 readings (e.g. "add an attribute to a Must
feature" → `added` vs `modified`) or its impact is unclear, do **not** guess — append to
`artifacts/{app_name}/pending-questions.json` (ambiguity_kind + required fields `target` / `question` /
`raised_by_step="31-req-change-detect"` / `raised_at` [ISO 8601] — ⚠️ hook R3 rejects the Write with
exit 2 if any required field is missing) for the Pre-flight Gate, or confirm with the user inline.
append 時は **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス。本 step の要件変更なら
`requirements.json` / `requirements/*.md`) を併記必須** — `skills/_shared/preflight-gate.md` § append 経路。
Mandatory self-check before writing the manifest.

### Step 4: Write `req-delta/change-manifest.json`

> **Overwrite behavior**: If `change-manifest.json` already exists from a previous run, overwrite it. The pipeline-state.json entry for the previous run is keyed by its own `run_id`, so no state is lost.

> **run_id format**: Use `YYYY-MM-DD-NNN` where NNN is a zero-padded 3-digit counter starting at `001`. Compute by counting existing `req_delta.runs[]` entries in `pipeline-state.json` whose `initiated_at` starts with today's date, then add 1.

```json
{
  "app_name": "{app_name}",
  "run_id": "{YYYY-MM-DD-NNN}",
  "created_at": "{ISO8601}",
  "change_type": "{change_type}",
  "change_description": "{change_description}",
  "directly_changed_docs": ["{Q2 selections — or [\"05-features.md\"] for feature_addition}"],
  "requirement_changes": [
    {
      "doc": "05-features.md",
      "section": "アカウント種別",
      "type": "modified",
      "dependency_category": "user_type_role",
      "summary": "単一ユーザー種別 → アバター制作者 / スクリプト入力者 の 2 種類に分割",
      "impact_hint": "user-flow / use-cases / data-definition に影響の可能性"
    }
  ]
}
```

> **`directly_changed_docs` の値**: `feature_addition` の場合は常に `["05-features.md"]`。その他の変更タイプは Q2 で選択したドキュメント一覧。

> **`feature_addition` の場合のみ:** 上記 JSON に `"feature_add": { ... }` フィールドを追加する（`change-manifest.schema.json` の `feature_add` 定義に従う）。その他の変更タイプでは `feature_add` キーを**省略**する（`null` は不可）。

> **Stale brief cleanup**: If `change_type != "feature_addition"`, check whether `artifacts/{app_name}/req-delta/feature-add-brief.md` exists and delete it before writing the manifest, to keep req-delta artifacts consistent with the current run.

Write to `artifacts/{app_name}/req-delta/change-manifest.json`.

### Step 5: Snapshot current requirement docs

First, ensure the snapshots directory exists. Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
mkdir -p artifacts/__APP_NAME__/req-delta/snapshots
```

Copy **every requirement document** under `artifacts/{app_name}/requirements/` (all `NN-*.md`; exclude `00-raw-input.md`) — not only the directly changed ones — to `artifacts/{app_name}/req-delta/snapshots/{doc}.snapshot.md` using the Read + Write pattern, overwriting any snapshot left by a previous run. This preserves the pre-revision state of the whole doc set, so the skill 33 cross-reference check (sub-step 4.5) compares baseline and current over the same population — snapshotting only the changed docs would make pre-existing IDs in untouched docs look like mid-insertions.

### Step 6: Register run in `pipeline-state.json`

Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
data = json.loads(open(path).read()) if os.path.exists(path) else {}
stub = {
    "run_id": "__RUN_ID__",
    "change_description": "__CHANGE_DESCRIPTION__",
    "initiated_at": "__INITIATED_AT__"
}
data.setdefault("req_delta", {}).setdefault("runs", []).append(stub)
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: req_delta.runs stub appended")
PYEOF
```

---

## Output
- `artifacts/{app_name}/req-delta/change-manifest.json`
- `artifacts/{app_name}/req-delta/snapshots/{doc}.snapshot.md` (one per requirement doc, excluding `00-raw-input.md`)
- `artifacts/{app_name}/req-delta/feature-add-brief.md` — `change_type == "feature_addition"` の場合のみ
- `artifacts/{app_name}/pipeline-state.json` — `req_delta.runs[]` stub entry appended
