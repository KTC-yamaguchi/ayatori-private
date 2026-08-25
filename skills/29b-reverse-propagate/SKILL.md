---
name: 29b-reverse-propagate
description: Phase 5 screen-edit モードで Step 29 の逆方向を担う。手編集済みの画面 HTML を READ-ONLY の正本として扱い、color-lint 再実行・Step 19 ルーブリック採点・各 HTML 差分の screens/{screen}.md への逆伝播・編集 diff の要件突合監査 (要件外追加・要件矛盾・要件削除) を人間ゲート越しに実行する。ゲートで「要件に昇格」を選んだ逸脱は Step 29c へ引き渡し requirements/*.md に反映させる。
---

# 29b Reverse-Propagate + Scoped Scoring (screen-edit mode)

## Role
The screen-edit replacement for Step 29 — the **inverse direction**. The screen HTML was already hand-edited (it is the temporary source of truth). This step does **not** generate or modify any screen HTML; it (1) re-runs the color-lint report, (2) scores the edited screens with the Step 19 rubric, (3) reverse-propagates each HTML diff into its `screens/{screen}.md` spec (+ transition/nav/coverage when navigation changed), and (4) audits the edit diff against the requirement docs (additions / contradictions / deletions) into `requirement-deviations.json` — all behind a human gate. Deviations the user promotes at the gate (「要件に昇格」) are handed to **Step 29c**, which revises `requirements/*.md`.

The edited HTML is **READ-ONLY** here (it is the user's authored truth). The design system (`tokens.json`, `design-brief.yaml`, `_shared/`) is also READ-ONLY — a delta adapts docs to the edit, it does not redesign. Screens not in scope are never read or written.

## Preconditions
- `pipeline-state.json.delta.runs[-1].mode == "screen_edit"` with `edited_screens[]` set (Step 27b complete)
- `artifacts/{app_name}/delta/change-manifest.json` exists with `source == "screen_edit"`
- `artifacts/{app_name}/screens/_shared/root-variables.css` and `tokens.json` exist (READ-ONLY here)

---

## Execution

### Step 0: Scope

Read `pipeline-state.json.delta.runs[-1].edited_screens[]` → the in-scope screens `{screen, platform, path}`. Also read `artifacts/{app_name}/delta/change-manifest.json.requirement_changes[]` (one entry per edited screen, `doc = screens/{screen}.md`, with the Step 27b diff summary) and, if Step 28 ran, `artifacts/{app_name}/delta/impact-analysis.md` for any cascade (e.g. a chrome edit flagged as touching more screens).

For each edited screen, recover the diff established in Step 27b:
- **after** = current on-disk `artifacts/{app_name}/{path}` (READ-ONLY).
- **before** = `artifacts/{app_name}/delta/snapshots/screens/{platform}/{screen}.snapshot.html` if it exists, else `null` (external-editor edit with no backup — Step 27b recorded this).

**Hard constraint**: do NOT read or write any screen HTML outside `edited_screens[]`. Do NOT modify any screen HTML at all (the edit is the user's truth). Deterministic scripts (`lint-screen-colors.mjs`) may scan all screens read-only (same exclusion as Step 29 Step 0).

**Zero-scope guard**: if `edited_screens[]` is empty, write `screens_approved_at` (Step 6 python block) and exit — nothing to propagate.

### Step 1: Regenerate the color-lint report (full project, read-only scan)

Run (mechanical, no AI HTML editing — the script scans all screens read-only):
```bash
node scripts/lint-screen-colors.mjs --report artifacts/{app_name}
node scripts/render-color-report.mjs artifacts/{app_name}/screens/color-lint-report.json
```
This refreshes `screens/color-lint-report.json` so its `generated_at` is newer than the edited HTML — satisfying the Step 19 freshness guard used in Step 2. Read only its `summary`.

> **Design-system freeze on literal colors**: if a hand-edit introduced a literal color (a `--check`-style hard violation), do **NOT** rewrite the user's HTML and do **NOT** silently add a token. It surfaces two ways: (a) as a Layer-1 deduction in Step 2 scoring, and (b) in `color-lint-report.html` (promotion_queue / literals) shown at the Step 6 gate, where the user decides to fix the HTML themselves or promote a token via a later Step 24. The edited HTML stays as authored.

### Step 2: Scoped scoring (Step 19 rubric on the edited screens)

Read `skills/19-rubric-score/SKILL.md` and apply its 3-layer rubric **scoped to `edited_screens[]` only** (the same pattern Step 29 Step 6 uses to invoke an abbreviated Step 18). Inputs are Step 19's usual read-only set (`wcag-mapping.json`, `screens/00-coverage-check.json`, `screens/00-screen-nav.json`, and `color-lint-report.json.summary` from Step 1). Coverage (L1–L4) / connectivity (L5) only re-enter scoring if the edit changed screen structure or navigation (otherwise carry the existing values — the screen set did not change).

Compute the scoped score with the Step 19 rubric, but **do NOT write it to `scores.json`**. `scores.json.current` is the **project-wide** design score (consumed by `/ayatori-status` and `/ayatori-retro` as the whole-project 100-point metric, and it has no per-screen breakdown to merge into); overwriting it with a per-screen scoped value would silently corrupt that metric and is **irreversible** (`scores.json` is not covered by `backup-on-edit.sh`). Record the scoped score **only in the run state** (`delta.runs[-1].score_total`) and stamp `score_at` (Bash; substitute `__PLACEHOLDERS__`):
```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone
path = "artifacts/__APP_NAME__/pipeline-state.json"
data = json.loads(open(path).read())
run = data["delta"]["runs"][-1]
run["score_total"] = __SCORE_TOTAL__          # 編集画面のみの scoped 採点 (scores.json には書かない)
run["score_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: score_total / score_at written")
PYEOF
```

> The scoped score lives **only** in `delta.runs[-1].score_total` and is shown at the Step 6 gate. **`scores.json` (the Phase 3 project-wide score) is left untouched** — requirement-mode Step 29 likewise does not write `scores.json`, so the two modes stay symmetric and `/ayatori-status` / `/ayatori-retro` keep reading the whole-project score.

### Step 3: Reverse-propagate each HTML diff into its `screens/{screen}.md` spec

This is the inverse of Step 29 Step 3 (which applied manifest changes to the spec). Here the **HTML is the source** and the spec is brought into line with it.

**Sub-state mapping**: an edited sub-state HTML `{screen}--{state}.html` (e.g. `ホーム--empty.html`) has no spec doc of its own — reverse-propagate it into the **base** `screens/{screen}.md`, recording the state-specific behavior under the section it implies with the state labeled (e.g. 「empty 状態: …」). Never create `screens/{screen}--{state}.md`. (Same rule as the Step 27b manifest `doc` mapping.)

For each edited screen:

1. Read the current `artifacts/{app_name}/screens/{screen}.md`. **before が null の画面のみ**: 更新前の spec を `artifacts/{app_name}/delta/snapshots/specs/{screen}.snapshot.md` へ複製してから進む (Step 5 の監査は本 Step が spec を編集後 HTML に追随させた**後**に走るため、更新後 spec を fallback の diff 源に使うと「spec に無いのに HTML に在る要素」がほぼ空集合に縮退する — propagation 前 spec を退避して Step 5 に渡す)。
2. Identify what the edit changed:
   - If `before` is non-null → compare the **before vs after HTML diff** (the concrete hunks from Step 27b).
   - If `before` is null (external edit, no snapshot) → compare the **current HTML against the current `.md` spec** (the spec represents the pre-edit intent).
3. For each concrete change, update only the spec section it implies — `## 基本情報` / `## UI要素一覧` / `## 画面フロー` / `## バリデーション` / `## デザインノート`. **Preserve every section the diff did not touch verbatim** (same discipline as Step 29 Step 3, inverted).
4. Write the updated `.md` back.

**Operating Principle 4 — diff-bounded (mandatory)**:
- Work from the concrete diff hunks, not a fresh re-interpretation of the whole HTML. Touch nothing the diff did not touch.
- The proposed spec changes were surfaced and approved at the Step 6 gate **before** they are treated as final (the human ratifies the HTML→spec mapping). Backups of each `.md` are taken automatically by `backup-on-edit.sh` before the Write.
- **Ambiguity (flavor a)**: if a hunk admits N≥2 spec readings (e.g. a color change could mean a token swap *or* a one-off), do **not** guess — append to `artifacts/{app_name}/pending-questions.json` (ambiguity_kind + required fields `target` / `question` / `raised_by_step="29b-reverse-propagate"` / `raised_at` [ISO 8601] — ⚠️ hook R3 rejects the Write with exit 2 if any required field is missing) for the Pre-flight Gate, or confirm inline. append 時は **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス。本 step の逆伝播なら `screens/*.md`、要件側に効く読みなら `requirements/*.md`) を併記必須** — `skills/_shared/preflight-gate.md` § append 経路。 Mandatory self-check before each `.md` Write.

### Step 4: Transition / nav / coverage (only if navigation changed)

If a hand-edit changed navigation (added/changed a link, removed a CTA target, new entry/exit), bring the navigation artifacts into line — reuse Step 29's mechanical procedures verbatim:
- **Step 2-A** equivalent: edit only the affected lines of `screens/00-transition-map.mmd` (SSoT), preserving the rest.
- **Step 2-B** equivalent: regenerate `00-transition-map.html` from `docs/templates/transition-map.template.html` + the `.mmd`.
- **Step 2-C** equivalent: regenerate `00-screen-nav.json` (derived) from the `.mmd`.
- **Step 6b** equivalent: run the L5 connectivity validator (`docs/screen-coverage-check.md` §4-5-4) **scoped to the edited screens**; record results in `screens/00-coverage-check.json` `layers.l5_connectivity`. If a `back_affordance` defect appears, note it for the gate — do **not** auto-edit the user's HTML; surface it for the user to fix.

If navigation did not change, skip this step entirely (the `.mmd` / nav / coverage stay as-is).

### Step 5: Requirement-deviations audit (reverse direction, diff-bounded)

A hand-edit can add UI the requirements never specified, **contradict** an existing requirement (e.g. a literal color where the docs forbid hardcoded colors), or **remove** an element a requirement mandates. Delegate the audit to the **`ayatori-requirements-auditor` subagent** (`layer="delta"`, `audit_direction="reverse"`) so the generation context is isolated (same anti-self-bias structure as Step 29 Step 6 Layer-REQ):

- Launch (Task tool) per edited screen with: `layer="delta"` / `audit_direction="reverse"` / `app_name` / `repo_root` / `diff_before_path` = Step 0 の **before** (snapshot、無ければ `null`) / `diff_after_path` = 現行 HTML / `edit_intent` = `change-manifest.json` の該当 summary (1 行) / `requirements_dir` = `artifacts/{app_name}/requirements/` (**突合先 = 要件文書**。昇格済み要件は md に在るため以後再検出されない) / `screen_spec_path` = `screens/{screen}.md` (sub-state は base の `.md`)。⚠️ **before が null の画面**は `screen_spec_path` に Step 3 で退避した **propagation 前 spec** (`delta/snapshots/specs/{screen}.snapshot.md`) を渡す — Step 3 更新後の spec は編集後 HTML に追随済みで、fallback 列挙 (「spec に無いのに HTML に在る要素」) の diff 源にならないため。
- The subagent audits **only the elements the edit diff touched** — pre-existing screen↔requirements gaps never enter the gate (auditor REQ-AUD-06) — and classifies each untraceable change as `要件外追加` / `要件矛盾` / `要件削除`, each carrying a `promotion_target` (`requirements/NN-*.md` + section).
- **Main session is the single writer**: append candidates to `requirement-deviations.json` (`phase="delta"`, `raised_by_step="29b-reverse-propagate"`, `detected_at`, `promotion_target` を転記) + a `coverage[]` entry (required even at 0 findings)。**Dedup before append**: 既存 entry が同一の (artifact, element) 指示対象を既にカバーし (LLM の表現ゆれがあるため literal 一致でなく意味で照合)、それが未解決 or `容認` 済みなら append しない。その後 `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` で view を再生成。
- ⚠️ Fallback (auditor unavailable): run the diff-bounded audit inline and log Pattern C to `feedback-log.md`（数値ステップ番号 `[29]` を使う — `[29b]` ではなく — Phase 6 `/ayatori-delta-mini` の `int()` パーサが拾えるように）.

### Step 6: Human approval gate

Present together:
- **Score**: this run's scoped score (`delta.runs[-1].score_total`, computed via the Step 19 rubric on the edited screens) — total + per-layer + AI-improvable deductions. (Not persisted to `scores.json`.)
- **Updated specs**: the changed `screens/{screen}.md` sections (so the user confirms the HTML→spec mapping is right).
- **`color-lint-report.html`** if it has human-judgment items (literals introduced by the edit / promotion_queue / icon variance).
- **`requirement-deviations-view.html`** if `requirement-deviations.json` に**未解決の screen-edit 逸脱** (`phase == "delta"` かつ `raised_by_step == "29b-reverse-propagate"` かつ `resolved_at` 未設定) がある場合 (要件外追加 / 要件矛盾 / 要件削除)。⚠️ **今回 append 分に限定しない** — 前回 run がキャンセルされ resolution 未記入のまま残った逸脱は Step 5 の dedup により今回 append されないが、未解決である限りここで必ず再提示する (append 有無と未解決の有無は独立)。逸脱ごとの判断 (容認 / 要件に昇格) は下記 **On A** の昇格選択で行う。
- Updated `00-transition-map.html` + nav, if Step 4 ran.

Then AskUserQuestion:
- **screen-edit 反映の確認**
  - Option A: 承認 — 画面仕様書・派生アーティファクトの更新を確定する（逸脱があれば続けて昇格選択へ。昇格ありなら Step 29c で requirements/*.md へ反映してから Step 30、なしなら直接 Step 30 へ。Figma 実在時は該当フレームを部分更新、不在 / zero-scope 時は Step 30 Fallback が追加ゲートなしで figma_status を記録して完了）
  - Option B: 修正指示 — 反映する spec 変更を調整して再実行（Step 3 に戻る）
  - Option C: キャンセル — delta 実行を中止する（手編集 HTML はそのまま残る。逸脱 entry には resolution を一切書かない — 未解決のまま残り、次回 run のゲートで再提示される）

**On A (approved)** — run via Bash tool (substitute `__PLACEHOLDERS__`):
```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone
path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。Step 27b が完了しているか確認してください。"); exit(1)
data = json.loads(open(path).read())
if not data.get("delta", {}).get("runs"):
    print("ERROR: delta.runs が空です。Step 27b が完了しているか確認してください。"); exit(1)
data["delta"]["runs"][-1]["screens_approved_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: screens_approved_at written (screen-edit)")
PYEOF
```

**On A — 昇格選択と書き戻し** (上記の**未解決逸脱が 1 件以上ある場合のみ**。0 件なら直接 Step 30 へ)。未解決逸脱は 2 群に分けて扱う:

- **選択対象** = `resolution` **未記入**の entry (今回 append 分 + 前回 run のキャンセル残)。
- **反映待ち** = `resolution == "要件に昇格"` かつ `resolved_at` 未設定の entry (前回 run の 29c で保留された既承認の昇格)。**A-1 の選択には出さず、そのまま Step 29c へ引き継ぐ** — 再選択に混ぜると、未選択時に A-2 の容認で既承認の昇格判断を上書きしてしまう。ゲートでは「反映待ち {N} 件は Step 29c で処理されます」と表示のみ行う。

- **A-1 昇格選択** (対象 = **選択対象** [resolution 未記入] のみ): 対象が **2〜4 件**のとき AskUserQuestion (multiSelect) 「要件に昇格する逸脱を選択してください（選択しない逸脱は容認 = 要件文書は変更しない）」— 選択肢は逸脱ごとに 1 つ (label = element 要約、description = deviation_kind + promotion_target)。⚠️ 対象が **1 件または 5 件以上**のときは AskUserQuestion を使わず (options は最小 2・最大 4 の API 制約 — 1 件だと `options too_small` で InputValidationError になる)、plain chat の番号付きリストで選択を受ける (Step 27b Step 2 と同じ運用。「なし」= 全件容認)。
- **A-2 resolution 書き戻し** (main session が単一 writer。python で該当 entry に merge。⚠️ **既に `resolution` が入っている entry には一切書かない** — 反映待ちの昇格判断を容認で上書きしない):
  - A-1 で昇格に選ばれた entry → `resolution = "要件に昇格"` + `resolution_mode = "individual"` を書く。⚠️ **`resolved_at` はここでは書かない** — Step 29c が `requirements/*.md` へ反映を完了した時点で stamp する。「`resolution == "要件に昇格"` かつ `resolved_at` 未設定」= 反映待ち (run 中断時は phases/delta の Resume logic が Step 29c を再開する判定キー、run 完走後に残った場合は次回 screen-edit run の本ゲート + 29c Step 0 が引き継ぐ)。
  - A-1 の対象のうち選ばれなかった entry → `resolution = "容認"` + `resolved_at` (ISO 8601) を書き即時終端 (次回 run で再提示されない)。`resolution_mode` (docs/principle4-disambiguation.md §5.5.3): multiSelect 経路 (2〜4 件、各 entry が選択肢として明示提示され意図的に外された) と plain chat で番号を名指しされた entry = `"individual"` / plain chat の「なし」(= 全件容認の明示応答) = `"bulk"`。⚠️ plain chat で一部の番号のみ名指しされた場合、**未言及の残りを無言で容認に読み替えない** (§5.5.2 手順 3) — 「残り {M} 件をまとめて容認しますか? (個別に判断する場合は番号で指定)」を明示確認し、まとめて容認が選ばれたときのみ `"bulk"` で resolve、個別指定が返れば `"individual"`。確認が取れるまで当該 entry は未解決のまま残す。
  - 書き戻し後 `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` で view を再生成。
- **A-3 ルーティング**: `resolution == "要件に昇格"` かつ `resolved_at` 未設定の entry (今回の昇格分 + 反映待ちの引き継ぎ分) が 1 件以上 → **Step 29c (`skills/29c-req-propagate/SKILL.md`) へ進む** (29c Step 0 の収集条件と同一。Step 30 は 29c 完了後)。0 件 → 直接 Step 30 へ。

**On C (cancel)** — run via Bash tool (substitute `__PLACEHOLDERS__`):
```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone
path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。"); exit(1)
data = json.loads(open(path).read())
if not data.get("delta", {}).get("runs"):
    print("ERROR: delta.runs が空です。中止対象の run がありません。"); exit(1)
data["delta"]["runs"][-1].update({
    "cancelled_at": datetime.now(timezone.utc).isoformat(),
    "cancel_reason": "user_abort"
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: cancelled_at / cancel_reason written")
PYEOF
```
Display "Delta 実行を中止しました。手編集した HTML はそのまま残ります。" and exit.

---

## Output
- `artifacts/{app_name}/screens/color-lint-report.json` (+ `.html`) — regenerated (derived)
- `scores.json` は変更しない（scoped 採点は `delta.runs[-1].score_total` にのみ記録。プロジェクト全体スコアを保全）
- Updated `artifacts/{app_name}/screens/{screen}.md` (edited screens only — reverse-propagated from HTML)
- Updated `00-transition-map.mmd` / `.html` / `00-screen-nav.json` / `00-coverage-check.json` (only if navigation changed)
- `artifacts/{app_name}/requirement-deviations.json` (+ view) — appended (`phase="delta"`、要件外追加 / 要件矛盾 / 要件削除 + `promotion_target`) + ゲート判断の resolution (容認 = `resolved_at` 即時 / 要件に昇格 = `resolved_at` 未設定のまま Step 29c へ)
- `pipeline-state.json` — `delta.runs[-1].score_total` / `score_at` / `screens_approved_at` set
- **No screen HTML is created or modified** (the hand-edit is the source of truth)
- **Next step**: 昇格 1 件以上 → Step 29c (requirements/*.md へ反映) → Step 30 / 昇格 0 件 → Step 30
