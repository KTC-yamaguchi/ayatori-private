---
name: 27-change-detect
description: この delta run を起こした仕様変更を捕捉し、構造化された change-manifest.json を生成する。Phase 5 の Step 27 として実行され、下流の Step 28・29・30 を駆動する唯一のソースとなる。
---

# 27 Change Detection

## Role
Capture the specification change that triggered this delta run and produce a structured `change-manifest.json`. This is the sole source of truth for what changed — every downstream step (28, 29, 30) is driven exclusively by this manifest.

## Preconditions
- `artifacts/{app_name}/pipeline-state.json` exists with `approvals.final_approved == true` OR `approvals.completed_at_states` set OR (`approvals.baseline_approved_at` set **AND** `requirements.json.status == "REVERSE_ENGINEERED"` — 由来検査) (completed or reverse-baseline project; SoT = CLAUDE.md § 完走後 Phase 共通 Entry Guard。基線プロジェクトは Mode Selection の材料検査を通過してから本 step に入る)
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
`skills/27-change-detect/refs/feature-add-interview.md` を Read して実行する（`{delta_dir}` = `delta`）。ヒアリング完了後、回答から `feature_add` JSON ブロックをメモリに構築する（`feature-add-interview.md` § Output: feature_add block の構造に従う）。`change_description` = `feature_add.feature_name`。Q2 はスキップする（`changed_docs` は Step 2 で自動設定）。

**その他の変更タイプの場合:**
以下の質問を **plain chat** で提示する（自由記述の単独質問に AskUserQuestion を 1 option で代用しない — `skills/01b-add-feature-question/SKILL.md` § 設計判断）:
- Q1: **変更の説明** — 何が変わりましたか？（自由記述。例: 「ログインユーザーをアバター制作者とスクリプト入力者の2種類に分ける」）

Set `change_description` = Q1 answer.

**`change_type != "feature_addition"` の場合のみ — Q2 (plain chat 番号付きリスト、AskUserQuestion 不使用):**
8 doc は AskUserQuestion の option 上限 4 を超えるため、`skills/01b-add-feature-question/SKILL.md` § Plain chat fallback の書式で提示する:

```
変更を加えた要件ファイルを選択してください（変更済みドキュメント）。

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

返信された番号をファイル名に解決して選択結果とする (「all」は全 8 doc)。番号 / `all` のいずれにも解決できない返信、または解決できない番号が含まれる返信は同リストを再提示する。ただし「やめる」「後で決める」等の中止意図の返信は再提示ループに固定せず (25a Q2 と同じ規律)、`change-manifest.json` を書かずに phase を終了する (次回 `/ayatori-delta` 起動時に最初からやり直せる)。

**`change_type == "feature_addition"` の場合は Q2 をスキップする。** `changed_docs` は Step 2 で `["05-features.md"]` に自動設定される。Step 28 は `requirement_changes[]` を primary input として読むため、追加のドキュメント選択は impact analysis に影響しない。

### Step 2: Read changed documents

**`change_type == "feature_addition"` の場合:** `requirement_changes` を `feature_add` ヒアリング結果から自動生成する — `05-features.md` に以下のエントリを作成し、Step 3 をスキップして Step 4 へ進む:
```json
{
  "doc": "05-features.md",
  "section": "{feature_add.feature_name}",
  "type": "added",
  "summary": "{feature_add.user_value} — シチュエーション: {feature_add.situation} / 操作フロー: {feature_add.user_flow (steps joined with \" → \")} / 位置づけ: {feature_add.positioning}",
  "impact_hint": "{feature_add.feature_name} の新規追加。使用場面: {feature_add.usage_scene}。既存機能との重なり: {feature_add.existing_overlap}。位置づけ: {feature_add.positioning}"
}
```

Set `changed_docs = ["05-features.md"]` — this is the only document changed by a feature_addition. Step 5 will snapshot it and **Step 5b will actually append the new feature section to it**. Do not include additional docs here; Step 28 reads `requirement_changes[]` for impact analysis, not `changed_docs`.

**その他の変更タイプの場合:**

> **Zero-doc guard**: If Q2 returned an empty selection, display: "⚠️ 少なくとも 1 つのドキュメントを選択してください。" and re-present Q2.

For each selected document, Read `artifacts/{app_name}/requirements/{doc}` and extract the sections that were modified. Compare against any prior snapshot if available (check `artifacts/{app_name}/delta/snapshots/` for `{doc}.snapshot.md`).

> **Section definition**: A section is the **nearest heading that encloses the change** — prefer `##`, and fall back to `###` when no `##` encloses it. If multiple sections changed, list each as a separate entry in `requirement_changes[]`. If an entire document was substantially rewritten, report the primary changed heading. If the document has no headings at all, use the document filename as the section name.
> Why the fallback: reverse-engineered requirement docs group feature categories under `###`, so a strict `##`-only rule points at the wrong section (typically the trailing hand-off note). Forward-generated docs (`##`-structured) resolve to the same heading as before, so this is backward compatible.

### Step 3: Classify each change

For each changed section, classify both fields:

**`type`** — structural change kind:

| type | description |
|---|---|
| `added` | New requirement, screen, user type, or flow that did not exist before |
| `modified` | Existing requirement changed in scope, behaviour, or naming |
| `removed` | Requirement, feature, or flow explicitly removed |

**`impact_hint`** — free-text description of which screens or downstream documents this change may affect. Used by Step 28 for impact analysis. Required for every entry.

**Operating Principle 4 — Disambiguation (flavor a):** classifying a change is an interpretation of the
user's change description. Apply `docs/principle4-disambiguation.md` §1: enumerate candidate
classifications; if a change admits N≥2 readings or its impacted-screen scope is unclear, do **not**
guess — append to `artifacts/{app_name}/pending-questions.json` (ambiguity_kind + required fields
`target` / `question` / `raised_by_step="27-change-detect"` / `raised_at` [ISO 8601] — ⚠️ hook R3
rejects the Write with exit 2 if any required field is missing) for the Pre-flight Gate, or confirm
with the user inline. append 時は **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス。
本 step の要件変更なら `requirements/*.md` / `requirements.json`) を併記必須** — `skills/_shared/preflight-gate.md`
§ append 経路。
Mandatory self-check before writing the manifest.

### Step 4: Write `change-manifest.json`

> **Overwrite behavior**: If `change-manifest.json` already exists from a previous run, overwrite it. This is intentional — the new run supersedes the old one. The pipeline-state.json entry for the previous run is keyed by its own `run_id`, so no state is lost. Requirement doc snapshots in `delta/snapshots/` are the only persistent record of previous run inputs.

```json
{
  "app_name": "{app_name}",
  "run_id": "{YYYY-MM-DD-NNN}",
  "created_at": "{ISO8601}",
  "change_type": "{change_type}",
  "change_description": "{change_description}",
  "requirement_changes": [
    {
      "doc": "05-features.md",
      "section": "アカウント種別",
      "type": "modified",
      "summary": "単一ユーザー種別 → アバター制作者 / スクリプト入力者 の 2 種類に分割",
      "impact_hint": "login / register / onboarding / home 画面に影響の可能性"
    }
  ],
  "changed_docs": ["{Q2 selections — or [\"05-features.md\"] for feature_addition}"],
  "baseline": {
    "screens_last_generated_at": "{pipeline-state.json timestamp of step17 last run}",
    "figma_last_exported_at": "{figma-state.json scope.last_updated_at}"
  }
}
```

> **`feature_addition` の場合のみ:** 上記 JSON に `"feature_add": { ... }` フィールドを追加する（`change-manifest.schema.json` の `feature_add` 定義に従う）。その他の変更タイプでは `feature_add` キーを**省略**する（`null` は不可）。

> **Stale brief cleanup**: If `change_type != "feature_addition"`, check whether `artifacts/{app_name}/delta/feature-add-brief.md` exists and delete it before writing the manifest, to keep delta artifacts consistent with the current run.

> **run_id format**: Use `YYYY-MM-DD-NNN` where NNN is a zero-padded 3-digit counter starting at `001`. Compute by counting existing `delta.runs[]` entries in `pipeline-state.json` whose `initiated_at` starts with today's date, then add 1. Example: if today is 2026-05-13 and one run already exists for today → `2026-05-13-002`.

> **baseline nullable**: Both `screens_last_generated_at` and `figma_last_exported_at` may be `null` if Phase 3 or Figma export was skipped. Null values are acceptable — downstream steps do not depend on baseline timestamps.

Write to `artifacts/{app_name}/delta/change-manifest.json`.

### Step 5: Snapshot current requirement docs

First, ensure the snapshots directory exists. Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
mkdir -p artifacts/__APP_NAME__/delta/snapshots
```

For each changed document, copy the **current** version to `artifacts/{app_name}/delta/snapshots/{doc}.snapshot.md` using the Read + Write pattern. This preserves the state before the next delta run overwrites it.

### Step 5b: feature_addition — 新機能セクションを `05-features.md` へ追記

`change_type == "feature_addition"` の場合のみ実行する。ヒアリング結果を manifest / brief に記録するだけでは要件文書が無変更のまま画面だけ再生成され、run 完了後に文書と UI が食い違う — 本 step が要件文書側を追随させる (Step 5 の snapshot が追記前 baseline として先に確保されている)。その他の変更タイプではスキップして Step 6 へ。

1. **ID 採番 (append-only、必須)**: `requirements/` **全 doc** を `F-[0-9]{2}` で grep し、**全 doc 横断の最大値 + 1** を新機能の F-NN とする (単一 doc の max は罠 — `05-features.md` の max より大きい番号が `02-scope.md` 等に居ることがある)。既存 ID の renumber / shift / 最大値未満への挿入は禁止。
2. **セクション案の作成**: `05-features.md` の既存書式に合わせる (`## F-NN: {feature_add.feature_name}（{MoSCoW}）` 見出し + `| 項目 | 内容 |` テーブル: 機能ID / 機能名 / MoSCoW / 入力 / 処理 / 出力 / エラーケース / 関連UC)。値は `feature_add` ヒアリング結果から導出する — 入力/処理/出力は `user_flow` / `usage_scene` から、関連UC は `existing_overlap` から。**導出できない field は発明せず** `※不明 (unknown)` + 次回 ask 対象 field 名を併記する (Operating Principle 4)。
3. **確認ゲート**: MoSCoW 区分はヒアリング項目に無いためここで AskUserQuestion で質問し (Must / Should / Could)、追記案 (セクション全文) を提示して確認する:
   - Option A: 承認 — `05-features.md` へ追記する (Write。`backup-on-edit.sh` が自動退避)
   - Option B: 修正指示 — 指示を反映して案を作り直す
   - Option C: 記載しない — 要件文書は変更しない (⚠️ run 完了後に要件文書と画面が食い違う状態になることを明示した上で確定する)
4. 追記した場合、`change-manifest.json` の該当 `requirement_changes[]` entry の `section` を実際の見出し (`## F-NN: {名称}`) に更新する (Step 2 では `section = feature_name` の仮置きだったため)。

### Step 6: Register run in `pipeline-state.json`

Read `artifacts/{app_name}/pipeline-state.json` (or `{}` if absent). Merge the new entry using the `Read or {} → merge → Write back` pattern — do **not** replace top-level keys:

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
data.setdefault("delta", {}).setdefault("runs", []).append(stub)
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: delta.runs stub appended")
PYEOF
```

This makes `delta.runs[-1]` available for Steps 28–30 to append `impact_approved_at`, `screens_approved_at`, and `figma_approved_at`.

---

## Output
- `artifacts/{app_name}/delta/change-manifest.json`
- `artifacts/{app_name}/delta/snapshots/{doc}.snapshot.md` (one per changed doc)
- `artifacts/{app_name}/delta/feature-add-brief.md` — `change_type == "feature_addition"` の場合のみ
- `artifacts/{app_name}/requirements/05-features.md` — `change_type == "feature_addition"` で Step 5b 承認時のみ、新機能セクション追記
- `artifacts/{app_name}/pipeline-state.json` — `delta.runs[]` stub entry appended
