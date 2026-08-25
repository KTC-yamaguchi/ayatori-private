---
name: 33-req-revision
description: Phase 1c の Step 33。doc-impact-analysis.md で特定された directly_changed / impacted 文書ごとに修正案を生成しユーザーレビューに提示する。承認後に更新文書を書き出し、任意で再採点と Confluence 更新を行う。
---

# 33 Requirements Revision + Apply

## Role
Generate revision proposals for each `directly_changed` and `impacted` document identified in `doc-impact-analysis.md`. Present proposals to the user for review. On approval, write updated documents, run an optional re-score, and optionally update Confluence.

## Preconditions
- `artifacts/{app_name}/req-delta/doc-impact-analysis.md` exists with human approval (Step 32 complete)
- `artifacts/{app_name}/requirements/` documents exist

---

## Execution

### Step 1: Load scope

Read:
- `artifacts/{app_name}/req-delta/change-manifest.json`
- `artifacts/{app_name}/pipeline-state.json` — use `req_delta.runs[-1].directly_changed_docs` and `req_delta.runs[-1].impacted_docs` as the **authoritative document lists**. (`doc-impact-analysis.md` is human-readable context only; do not parse it for lists.)
- `artifacts/{app_name}/req-delta/doc-impact-analysis.md` — for the per-document "Required Changes" descriptions
- All documents named in `directly_changed_docs` and `impacted_docs` from `requirements/`

**Hard constraint**: Do NOT read or write any document not in `directly_changed_docs` or `impacted_docs`.

### Step 2: Generate revision proposals

For each `directly_changed` document:
1. Read the current content
2. Identify which sections correspond to the `requirement_changes[]` entries in the manifest
3. Generate the updated section content, incorporating the described change
4. Preserve all other sections verbatim

For each `impacted` document:
1. Read the current content
2. Using the dependency reasoning from Step 32, determine exactly what must be added or modified
3. Generate proposed additions or edits — minimum necessary changes only
4. Preserve all other sections verbatim

> **Consistency rule**: All revised documents must be mutually consistent. Terminology (user type names, feature names, entity names) must be identical across all docs. Use the `change-manifest.json.change_description` as the authoritative terminology source.

> **ID 番号は append-only — 既存最大値 + 1 から追加 (renumber 禁止) (必須遵守)**:
>
> 全 ID 種別 (F-NN / UC-NN / NFR-NN / S-NN / AC-NN / Entity N / E-NN) は **append-only**。新規追加 ID は **既存最大値 + 1** から割り当てる。既存 ID 番号の shift (例: F-06 → F-07 ずらし) / renumber (番号付け替え) は **禁止**。意味的順序を変えたい場合は **section の配置順** で表現する (番号順とは独立)。
>
> **検出と拒否**: `change-manifest.json.requirement_changes[]` の entry に「F-06 → F-07」のような **番号 shift を含意する変更** があれば、skill 33 は Apply を **拒否** し、ユーザーに以下を促す:
> > 「manifest に番号 shift を含む変更が含まれています ({shift 一覧})。番号 shift は append-only 規則に違反します。`/ayatori-add-feature` を再実行し、新規 ID は既存最大値 + 1 から追加する形で再 decompose してください。」
>
> 同一 ID への複数 modification は許容 (内容のみ更新、番号は変えない)。
>
> **Rationale**: ID 番号と意味的順序の分離により、(a) 後述の sub-step 4.5 (相互参照機械検証) が grep ベースで成立し、(b) LLM 精度に依存しない検証経路を確保、(c) Phase 5 delta / Phase 1d / 将来の verify phase 等の後続フェーズで番号 tracking が安定する。番号 shift パターンは grep 単独で捕捉不能 (検討で判明、本 spec の根拠の中核)。

> **フェーズ整合性検証 — 古い「Phase 2 / 将来検討」記述の残存検出 (必須)**:
> 新機能 / スコープ変更を反映する際は、**「フェーズ的位置づけ」を表現する全記述を確認** し、新機能の状態と矛盾しないよう削除 / 書き換えを行う。
>
> 検証対象パターン (`grep` 必須):
>
> ```bash
> grep -rEHn "Phase 2|Phase 3|将来検討|将来実装|v1 対象外|v1 対象範囲外|Won't|won't|^.*以降.*検討|将来の拡張|未来の|今後の検討" artifacts/{app_name}/requirements/
> ```
>
> ヒットした各行について以下を判定:
>
> 1. **その記述が今回の変更と矛盾するか** (例: 「Bluetooth 対戦は Phase 2」「BLE 対戦 v1 対象外」が新機能 BLE 対戦と矛盾)
> 2. **矛盾するなら** `requirement_changes[]` に `type: removed` または `type: modified` のエントリを追加する。`directly_changed_docs` に該当文書が無い場合は本検証で自動追加する (lazy expansion)
> 3. **矛盾しないなら** そのまま preserve (例: 「CPU 対戦は Phase 2」は BLE 機能とは独立)
>
> ヒットなしの場合はスキップ可。本検証を経ずに Step 4 Apply に進むのは禁止 (= 古い "Phase 2" 記述が残存する事故の構造的原因)。
>
> **検証出力**: `req-delta/phase-consistency-report.md` を作成し、grep ヒット行と各判定 (矛盾 / 維持) を一覧化。Step 3 の人間ゲートでユーザーに提示される (Step 3 表示ブロックに自然に統合される)。

### Step 3: Present proposals for review

For each document with proposed changes, display **only the changed sections** (the specific `##` heading and its content — not the full document). The full document is still written in Step 4; this display is for UX review only.

```
### {doc filename}
**変更前 (`## {section heading}`):**
{original section content — this heading only}
(新規セクションの場合: 「(新規)」と表示)

**変更後（提案）:**
{proposed section content — this heading only}

**変更理由:** {one sentence}
```

- If the section is **new** (does not exist in the current doc): show `変更前: (新規セクション)` and the full proposed content in `変更後`.
- If a section is **deleted**: show the original content in `変更前` and `変更後: (このセクションを削除)`.
- If a section is **renamed or merged**: explicitly note the structural change: `変更後: (セクション名変更: {旧名} → {新名})` or `(セクション統合)`.
- If multiple sections in the same document changed, display each as a separate block. Do **not** display unchanged sections.

Then present AskUserQuestion:
- **要件修正案の確認**
  - Option A: すべて承認 — すべての修正案をそのまま適用する
  - Option B: 部分承認 — 特定のドキュメントのみ適用する（次の質問で指定）
  - Option C: 修正指示 — 修正案を調整してから適用する（指示を入力してください）
  - Option D: キャンセル — 変更を中止する

**On B (partial)**: Ask "どのドキュメントを適用しますか？（例: 05-features.md, 03-user-flow.md）" and apply only the selected documents. Unselected documents remain unchanged.

Record the user-selected list as `applied_docs` and compute:
- `n_applied_directly_changed` / `n_applied_impacted` — counts of selected docs in each category (used in Steps 7 and 8)
- `n_unapplied` = `(len(directly_changed_docs) - n_applied_directly_changed) + (len(impacted_docs) - n_applied_impacted)` — unapplied scope docs that remain unchanged (used in Step 8 `docs_preserved`)

Do NOT use the full scope counts for history. Unapplied documents require a separate new delta run.

**On C (revise)**: Accept user's correction instructions. Regenerate only the affected sections. Re-present Step 3 proposals. Track attempt count in a local counter (not persisted — resets to 0 on session resume). Maximum 3 revision attempts per session — after the 3rd attempt, replace Option C with "キャンセル（3回試行済み）" which executes Option D behavior.

**On D (cancel)** — run via Bash tool (substitute `__PLACEHOLDERS__` before running):

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
Display "Req-Delta 実行を中止しました。要件定義書は変更されていません。" and exit.

### Step 4: Apply approved revisions

For each approved document, write the **full document** content using the Write tool — not a section-level patch. Reconstruct the complete file by taking the original content and replacing only the changed sections with the approved proposals. Writing the full document avoids partial-update consistency risks.

After writing, spot-check cross-document consistency:
- Verify user type names are identical across all updated docs
- Verify feature names referenced in `04-use-cases.md` exist in `05-features.md`
- **manifest cross-doc 参照の双方向保証 (Phase 6 retro #1)**: `type: added` または `type: modified` の各 `requirement_changes[]` entry について、その `section` / `summary` / `impact_hint` 3 field (sub-step 4.5 観点 2 の `searchable_text` 構築式と対称) を走査し、**sub-step 4.5 の checker と同じ正規表現** `F-[0-9]{2}|UC-[0-9]{2}|NFR-[0-9]{2}|S-[0-9]{2}|AC-[0-9]{2}|E-[0-9]{2}|Entity [0-9]+` (= `scripts/check-req-crossrefs.mjs` の `ID_PATTERN_SOURCE`。プロジェクト命名規約が対象とする ID 集合) でマッチする他文書の ID literal を抽出する。マッチした ID が当該 entry の `doc` (本体) 側に **逆参照セクション** (例: F-10 本体 section に「**関連 AC**: AC-NN」、UC-NN 本体に「**関連 NFR**: NFR-NN」等) として書き込まれていることを確認する。書かれていなければインラインで追記する。これを Apply 中に行うことで、Step 4.5 観点 2 (manifest 宣言と実装の一致) が事後検証で同種違反を拾う再修正ラウンドトリップを構造的に削減する。Step 4.5 は最終セーフティネットとして残置 (本ルールは sub-step 2 の事前確認、4.5 の事後検証は両立)。`type: removed` の entry は本ルール対象外 — 削除済 ID 参照の残存チェックは sub-step 4.5 観点 1 が事後検証で扱う。
- If inconsistency found: fix inline and log to `feedback-log.md` as Pattern B

### Step 4.5: 相互参照の機械的検証 — Apply 後の grep ベース整合性チェック (必須)

Step 4 (Apply) 直後に、**grep を使って全 ID 出現の整合性を機械的に検証** する。Step 4 sub-step 2 の Consistency rule は LLM 判断による用語整合性チェックのみで、(a) 削除された ID への参照が文書内に残っていないか、(b) 新規追加 ID への双方向参照が漏れていないか、(c) ID 番号の append-only 規則が守られているか、を機械的には保証しない。本 sub-step 4.5 で grep ベースの 3 観点チェックで補完する。

決定論 checker を実行する:

```bash
node scripts/check-req-crossrefs.mjs artifacts/{app_name}
```

script が grep 抽出 → 集合演算 → 3 観点判定を一括で行い、以下を出力する (LLM は判定手順を模擬実行しない。判定ロジックの正本は script):

- **stdout**: JSON verdict — `verdict: "PASS" | "FAIL"`、観点別詳細 (`kanten1.violations` / `kanten2.results` / `kanten3.violations`)、snapshot coverage (`coverage.mode: full | partial | skipped` と未検査 doc 一覧)
- **`artifacts/{app_name}/req-delta/cross-reference-integrity-report.md`**: 人間ゲート提示用 report。script が全量生成する (手編集しない)
- **exit code**: `0` = PASS / `1` = FAIL (いずれかの観点に違反) / `2` = 入力不能 (manifest 不在・Phase 5 変形 manifest・`requirements/` 不在)

**3 観点の要旨** (判定アルゴリズムの確定仕様と既知の制約は `scripts/check-req-crossrefs.mjs` ヘッダのコメントを参照):

- **観点 1: 削除済 ID 参照残存** — manifest で `removed` 宣言された ID が `requirements/` のどこかに残っていれば違反 (file:line 一覧付き)
- **観点 2: manifest 宣言と実装の一致 (ID 種別非依存)** — `added` / `modified` の各 ID について、その ID に言及する entry の doc 集合 (expected) が実出現 doc 集合 (actual) に包含されていれば PASS (actual ⊇ expected。manifest が宣言していない doc への派生的な参照は許容)
- **観点 3: append-only 規則遵守** — (a) baseline (snapshot) ID の消失 = renumber/shift の徴候、(b) baseline 最大番号以下への追加 = 途中挿入の徴候、の 2 段でのみ判定する (欠番は違反にしない — `removed` を伴う run では欠番が正常)。snapshot が要件 doc の一部しか無い場合は (b) の母集合を snapshot 済み doc に揃えて誤検出を防ぎ、未検査 doc を coverage として明示する。`snapshots/` 自体が無い場合は観点 3 を skipped と明示し (沈黙 PASS にしない)、観点 1 / 2 のみで結論を出す

ID prefix 集合 (F / UC / NFR / S / AC / E / Entity) と桁数の正規表現は script の `ID_PATTERN_SOURCE` が単一の定義箇所 (Step 4 sub-step 2 の双方向保証ルールが使う正規表現と同一)。

#### Step 4.5.4: 違反 / 警告ハンドリング (exit code = 1 のとき)

stdout JSON の観点別 field を読み、該当する対応を行う:

- **観点 1 違反 (`kanten1.violations`)**: 致命的。skill 33 は処理を停止し、ユーザーに違反箇所 (`occurrences` の file:line) を表示 + 手動修正要求 or 自動再 Apply を提案
- **観点 2 違反 (`kanten2.results` の FAIL)**: 致命的。skill 33 は処理を停止し、`feedback-log.md` Pattern B として記録 + ユーザーに `missing_docs` を表示。「manifest が宣言した参照箇所に当該 ID が出現していないため、Apply の Write が manifest 通りに進まなかった可能性が高い」と提示、skill 33 LLM に該当 doc の再生成を依頼するか手動修正を促す
- **観点 3 違反 (`kanten3.violations`)**: 致命的。skill 33 は処理を停止し、(a) `missing_existing` なら「baseline ID {numbers} が消えています — renumber/shift の可能性」、(b) `below_max_addition` なら「{numbers} は max_baseline 以下の番号 — append-only ではありません」と検出種別を明示。いずれも `/ayatori-add-feature` (skill 01b の G12-a / G12-b ルール) で append-only 規則を満たす形で再 decompose することを促す

修正後は script を再実行し、PASS (exit 0) になるまで先へ進まない。exit code = `2` (入力不能) は検証以前の問題 — stderr の理由を解消してから再実行する。

Apply 後の `cancellation_at` / `revisions_approved_at` 設定 (Step 7) より前に本 check (観点 1 / 2 / 3。該当プロジェクトではさらに Step 4.5.5 のマーカー検査) を完走させる。FAIL (いずれか 1 つでも違反) なら revisions_approved_at は set しない (= run は incomplete のまま)。

#### Step 4.5.5: 推測マーカー保持検査 (reverse 産要件のみ・決定論 script)

`requirements.json.status == "REVERSE_ENGINEERED"` のプロジェクトでは、改訂対象文書に reverse 由来の `※ 推測 (inferred)` / `※ 不明 (unknown)` マーカーが含まれる (本文マーカーが provenance 誤認防止の**主防御線** — `skills/reverse/06-format-convert/SKILL.md` の伝播規約)。Apply がこれらを無言で落とすと、推測が確定事実として下流 (design / screens) に laundering される。Apply 後に検査する:

```bash
node scripts/check-marker-retention.mjs artifacts/{app_name}
```

**判定仕様・表記ゆれの吸収・母集団の扱いの確定仕様は `scripts/check-marker-retention.mjs` ヘッダのコメントを参照** (sub-step 4.5 の `check-req-crossrefs.mjs` と同じ扱い — 本 skill は判定を模擬実行せず script の verdict に従う)。要旨のみ:

- 対象は reverse 産要件のみ。非 reverse / `snapshots/` 不在は `verdict: "SKIPPED"` + `reason` を明示して exit 0 (沈黙 PASS にしない)
- 「触った文書」= `pipeline-state.json.req_delta.runs[-1]` の `directly_changed_docs` ∪ `impacted_docs`。特定できない場合は全文書を未変更扱いにする (安全側)
- `docs[]` は**全文書を出す** (出現数 0 に落ちた文書も含む — 集計から消えると「マーカー全量消失」が「出力なし」と区別できなくなる)

**verdict ごとの処理**:

| verdict | exit | 処理 |
|---|---|---|
| `PASS` | 0 | そのまま次へ |
| `REVIEW` | 0 | `review_required[]` の各文書 (= 改訂対象文書での減少) を **1 件ずつ確認**する。(a) 改訂で根拠が付いた (人間回答・実コード等の出典を本文に併記した) か、(b) 当該記述ごと削除された、のどちらかなら正当。どちらでもない (文言だけ書き換えられてマーカーが脱落) 場合は下記 FAIL と同じ処理を行う |
| `FAIL` | 1 | `violations[]` = **触っていない文書のマーカーが落ちた** = Apply の書き過ぎ。(i) `feedback-log.md` に Pattern B として記録 → (ii) 落ちたマーカーを復元 → (iii) script を再実行して `PASS` / `REVIEW` になることを確認 |
| — | 2 | 入力不能 (app ルート / `requirements/` 不在)。stderr の理由を解消してから再実行する |

**(iii) が通るまで `revisions_approved_at` を set しない** — 復元は上記「FAIL なら set しない」を解消する手段であり、FAIL のまま先へ進む例外ではない。

マーカーが根拠付きで解消された場合は `reverse-engineered/reverse-provenance.json` の該当 specific との乖離に注意 (台帳は Step 03 の生成時点スナップショット — 本 skill は台帳を書き換えない。乖離の解消は reverse 側の責務)。

### Step 5: Optional re-score

Present AskUserQuestion:
- **ルーブリック再採点**
  - Option A: 再採点する — 更新後の要件定義書でルーブリックスコアを再計算し、`req-delta/score-after.json` に保存する
  - Option B: スキップ — 採点は後で行う

On Option A:

> **Read-only exception to Step 1**: The re-score must read all 8 `requirements/` documents to produce a valid total rubric score, including `preserved` documents. This is the only read-only exception — no writes to preserved documents. Output goes exclusively to `req-delta/score-after.json`.

1. Read `artifacts/{app_name}/rubric.json` and all 8 `requirements/0{1-8}-*.md` documents (read-only for preserved docs)
2. Apply the rubric criteria and calculate scores for each criterion
3. Write results to `artifacts/{app_name}/req-delta/score-after.json` — **do NOT call `skills/04-scoring/SKILL.md`** and do NOT write to `scoring-history.json`

Reason: `04-scoring` is Phase 1b-specific — it appends to `scoring-history.json` and runs a drift check against `00-raw-input.md`. Calling it from Phase 1c would contaminate Phase 1b history and trigger false-positive drift alerts on intentional delta changes.

`req-delta/score-after.json` format:
```json
{
  "app_name": "{app_name}",
  "scored_at": "{ISO timestamp}",
  "context": "req-delta re-score after run {run_id}",
  "total_score": 0,
  "max_score": 0,
  "criteria": [
    {
      "id": "{criterion id from rubric.json}",
      "label": "{criterion label}",
      "score": 0,
      "max": 0,
      "notes": ""
    }
  ]
}
```

### Step 6: Optional Confluence update

Present AskUserQuestion:
- **Confluence 更新**
  - Option A: Confluence を更新する — 更新後のドキュメントを Confluence に再保存する（`skills/06-confluence-save-req/SKILL.md` を実行）
  - Option B: スキップ — Confluence は後で更新する

On Option A: Read and execute `skills/06-confluence-save-req/SKILL.md`.

### Step 7: Update `pipeline-state.json`

Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

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
data["req_delta"]["runs"][-1]["revisions_approved_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: revisions_approved_at written")
PYEOF
```

### Step 8: Update `req-delta/run-history.json`

Run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/req-delta/run-history.json"
os.makedirs(os.path.dirname(path), exist_ok=True)
data = json.loads(open(path).read()) if os.path.exists(path) else {"runs": []}
data["runs"].append({
    "run_id": "__RUN_ID__",
    "date": "__DATE__",
    "change_description": "__CHANGE_DESCRIPTION__",
    "docs_directly_changed": __N_APPLIED_DIRECTLY_CHANGED__,  # applied count (Option A: full scope; Option B: selected subset)
    "docs_impacted": __N_APPLIED_IMPACTED__,                  # applied count (Option A: full scope; Option B: selected subset)
    "docs_preserved": __N_PRESERVED__ + __N_UNAPPLIED__       # preserved = originally preserved + unapplied scope docs (Option A: N_UNAPPLIED=0)
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: run-history.json entry appended")
PYEOF
```

---

## Output
- Updated `artifacts/{app_name}/requirements/0{N}-*.md` (directly_changed + impacted docs only)
- `artifacts/{app_name}/req-delta/run-history.json` (appended)
- `pipeline-state.json` — `req_delta.runs[-1].revisions_approved_at` set
