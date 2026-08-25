---
name: 27b-screen-edit-detect
description: パイプライン外で手編集された画面 HTML ファイルを検出し、スコープを人間に確認した上で source が screen_edit の change-manifest.json を生成する。Phase 5 の /ayatori-delta が screen-edit モードに解決したときに Step 27 の代わりに実行され、編集された HTML を一時的なソースとして下流 Step 29b が画面仕様へ逆伝播する。
---

# 27b Screen-Edit Detection (screen-edit mode)

## Role
Detect screen HTML files that were hand-edited **outside the pipeline** (after completion), confirm the scope with the user, and produce a `change-manifest.json` with `source: "screen_edit"` that drives the downstream screen-edit delta. This is the **inverse** of Step 27: the change vector is an HTML edit, not a requirements document. Here the edited HTML is the temporary source of truth, and downstream Step 29b reverse-propagates it into the screen spec (`screens/{screen}.md`) and derived artifacts.

This skill is reached only when the `/ayatori-delta` preamble has resolved **screen-edit mode** (see `phases/delta/SKILL.md`). For requirement-change deltas, Step 27 runs instead.

## Preconditions
- `artifacts/{app_name}/pipeline-state.json` exists with `approvals.final_approved == true` OR `approvals.completed_at_states` set OR (`approvals.baseline_approved_at` set **AND** `requirements.json.status == "REVERSE_ENGINEERED"` — 由来検査) (completed or reverse-baseline project; SoT = CLAUDE.md § 完走後 Phase 共通 Entry Guard。基線プロジェクトでは下記の画面 HTML precondition が実質の入口制約になる)
- `artifacts/{app_name}/screens/{web,web-sm,mobile}/*.html` exist (main screens generated)

---

## Execution

### Step 1: Gather edit candidates (edit ledger + screen inventory)

Detection is **git-independent** by design — it relies on the edit ledger and the screen inventory, never on the project being a git repository. A user who downloaded the project without git, or who does not use git at all, is fully supported (Operating Principle 1: the pipeline must not assume any external CLI such as `git`).

**Step 1a — Edit ledger** (`artifacts/{app_name}/delta/edited-screens.json`, written by the `lint-screen-html.sh` PostToolUse hook):
Read it if it exists. Collect every `entries[]` item whose `consumed_by_run == null` **and whose `dismissed_at` is not set** (dismissed = ユーザーが「破棄」を選んだ終端状態 — 再提示しない。同じ画面への新たな編集は hook の dedup が dismissed entry を置き換えるため、再編集時は自然に候補へ戻る)。Each gives `{screen, platform, path, lint}`. The ledger captures edits made through Claude's Write/Edit tools on a completed project — this is the **primary, environment-independent signal** and covers the main scenario (editing a screen via Claude Code).

**Step 1b — Screen inventory**: enumerate all `artifacts/{app_name}/screens/{web,web-sm,mobile}/*.html` (via the Read/Glob tools or `ls`). This is the universe the user can choose from for any edit the ledger did **not** capture — e.g. an edit made in an external editor, where the PostToolUse hook never fired and so nothing was recorded. No git is involved; the manual selection in Step 2 is the universal safety net.

### Step 2: Confirm scope (human selection)

**If the ledger (Step 1a) detected one or more candidates** — present the detected screens as a **plain-chat numbered list** (AskUserQuestion は使わない — 検知画面が 4 件を超えると option 上限 4 に違反し、pre-checked 初期選択も AskUserQuestion では表現できないため。書式は `skills/01b-add-feature-question/SKILL.md` § Plain chat fallback に統一):
```
これらの画面を手編集しましたか？ delta で反映する画面を選択してください。

1. {screen} ({platform}) — 編集検知: {台帳の lint summary。例: 色トークン違反 1件}
2. ... (one per detected screen)

選択方法: 反映する画面の番号をカンマ区切りで返信してください (例: 「1, 3」)。複数選択可。
全件の場合は「all」と返信してください。
上記以外にも手編集した画面がある場合 (外部エディタ等で編集し検知に出ていない画面) は「other」を
含めて返信してください (例: 「1, other」)。
```

**If the ledger detected nothing, OR the user's reply includes "other"** — present a second **plain-chat numbered list** of **all** screens from the Step 1b inventory (same 書式: 番号カンマ区切り + 「all」で全件。**`other` は第 2 リストでは受け付けない** — 全画面インベントリを網羅提示しているため「上記以外」が存在しない) so any hand-edited screen can be picked manually. Merge these manual picks with the ledger selection (dedup by `path`).

正規入力は第 1 リスト = 番号 / `all` / `other`、第 2 リスト = 番号 / `all`。正規入力に解決できない返信、または **解決できない番号が含まれる返信** (例: リストに無い「9」を含む「1, 9」— 部分的に解決できても暗黙で捨てない、25a/27/31 と同じ規律) は同リストを再提示する。ただし「やめる」「後で決める」等の中止意図の返信は再提示ループに固定せず (25a Q2 と同じ規律)、**空選択として扱い下記 Empty-selection guard を提示する** — 「終了」で何も書かずに phase を抜けられる (guard が解決可能な返信の後にしか作動しない穴を塞ぐ)。

**Empty-selection guard** — if the final selection is empty, present:
```
question: "反映する画面が選択されていません。どうしますか？"
header: "選択なし"
options:
  - label: "やり直す"
    description: "画面を選び直す"
  - label: "要件変更 delta に切り替え"
    description: "Step 27（要件変更起点）で delta を進める"
  - label: "終了"
    description: "何もせず終了する"
```
"要件変更 delta" → exit this skill and run Step 27. "終了" → end phase.

The user's selection is authoritative — it both captures external-editor edits the ledger missed and filters out pipeline-generated writes / accidental edits. Only selected screens proceed.

**Dismissed handling** — 台帳検知 entry のうち選択されなかったものが残る場合、AskUserQuestion で確認する:
```
question: "選択しなかった検知済み編集が {N} 件あります。次回の run でどう扱いますか？"
header: "残存編集"
options:
  - label: "保留"
    description: "次回 run でも候補として表示する（既定）"
  - label: "破棄"
    description: "dismissed_at を記録して今後の run で再提示しない（同じ画面を再編集すれば再び候補に戻る）"
  - label: "個別に選ぶ"
    description: "破棄する編集を番号で指定する"
```
「破棄」→ 残存全件を破棄対象に。「個別に選ぶ」→ 残存 entry の plain-chat 番号付きリスト (Step 2 と同じ書式) で破棄分を受ける。破棄対象の `dismissed_at` stamp は Step 7 で行う。「保留」→ 何もしない (`consumed_by_run == null` のまま次回候補に残る)。

**Operating Principle 4 (P4-01)**: scope confirmation is user input, not AI inference. Do **not** silently expand or shrink the selection. If a screen's edit intent is ambiguous, ask here rather than guessing.

### Step 3: Capture the HTML diff per selected screen

For each selected screen, establish the **before** (pre-edit) and **after** (current) content:
- **after** = current on-disk `artifacts/{app_name}/{path}`.
- **before** = the most recent backup `artifacts/{app_name}/_backup/screens/{platform}/{screen}.{timestamp}.html` (written by `backup-on-edit.sh` before a Claude-tool edit). For an edit made via Claude this backup exists. **If no backup exists** — an external-editor edit the backup hook never saw (no git is used as a fallback) — there is no pre-edit HTML baseline: record `before = null` for this screen. Step 29b then diffs the current HTML against the current `screens/{screen}.md` spec instead (the spec represents the pre-edit intent).

Compute a short, factual diff summary. When a `before` backup exists, Read both versions and describe only the concrete differences (e.g. "検索ボタンの文字サイズ拡大 / 背景色をトークン参照に変更"). When `before` is null, summarize from the current HTML relative to the spec ("(編集前 HTML なし) 現状: …").

> **No-op guard**: If a `before` backup exists and is byte-identical to `after` (a stale ledger entry, or an edit that was reverted), drop the screen from scope and mark its ledger entry consumed in Step 7 — do not write a manifest entry for a screen with no real change. (When `before` is null this guard does not apply; keep the screen.)

**Operating Principle 4 (flavor a)**: the diff summary is a description of an observed change, not an interpretation of intent. Keep it to what the diff literally shows. The *meaning* (which spec sections it implies) is decided in Step 29b under a human gate — do not pre-judge it here.

### Step 4: Collect edit intent

Ask in **plain chat** to capture `change_description`（自由記述の単独質問に AskUserQuestion を 1 option で代用しない — `skills/01b-add-feature-question/SKILL.md` § 設計判断）:
- Q1: **編集の意図** — この編集で何を変えたかったですか？（一言。例: 「検索ボタンを押しやすく大きくした」）

Set `change_description` = Q1 answer. This becomes the run summary shown at downstream gates.

### Step 5: Write `change-manifest.json`

> **Overwrite behavior**: identical to Step 27 — a new run supersedes any existing manifest; per-run state in `pipeline-state.json` is keyed by `run_id`, and HTML snapshots in `delta/snapshots/` preserve prior inputs.

```json
{
  "app_name": "{app_name}",
  "run_id": "{YYYY-MM-DD-NNN}",
  "created_at": "{ISO8601}",
  "source": "screen_edit",
  "change_type": "spec_change",
  "change_description": "{Q1 answer}",
  "requirement_changes": [
    {
      "doc": "screens/{screen}.md",
      "section": "{編集した UI 領域 — 例: 検索ボタン}",
      "type": "modified",
      "summary": "{Step 3 の diff サマリ}",
      "impact_hint": "{screen}.md の該当セクション更新。遷移/内比が変わったなら 00-transition-map.mmd / 00-screen-nav.json も。色リテラル混入なら color-lint promotion へ。"
    }
  ],
  "changed_docs": ["screens/{screen}.md", "..."],
  "baseline": {
    "screens_last_generated_at": "{pipeline-state.json の step17 最終実行時刻}",
    "figma_last_exported_at": "{figma-state.json scope.last_updated_at}"
  }
}
```

- One `requirement_changes[]` entry per selected screen. `doc` points at the screen **spec** (`screens/{screen}.md`) — deliberately inverted from Step 27 (which points at `requirements/*.md`); the schema's `doc` is a free string.
- **Sub-state mapping**: sub-state 画面 `{screen}--{state}` (例: `ホーム--empty`) は専用の仕様書を持たない — `doc` は `--{state}` suffix を除いた **base の `screens/{screen}.md`** を指す。`screens/{screen}--{state}.md` を指してはならない (存在しない doc への逆伝播になる)。Step 29b の逆伝播も同じ base `.md` へ向かう。
- `changed_docs` lists the `screens/{screen}.md` files that Step 29b will reverse-propagate into.
- `source: "screen_edit"` routes downstream behaviour; `change_type: "spec_change"` keeps the manifest in the standard Phase 5 branch (`changed_docs` + `baseline`, no `feature_add`).

> **run_id format**: `YYYY-MM-DD-NNN`, NNN zero-padded from `001`. Count existing `delta.runs[]` entries whose `initiated_at` starts with today's date, add 1.

> **baseline nullable**: both timestamps may be `null` (Phase 3 / Figma export skipped). Acceptable.

Write to `artifacts/{app_name}/delta/change-manifest.json`.

### Step 6: Snapshot the before-HTML

Ensure the snapshot directory exists, then copy each selected screen's **before** version (from Step 3) so the next run does not lose it.

Run via Bash tool (substitute `__PLACEHOLDERS__`):
```bash
mkdir -p artifacts/__APP_NAME__/delta/snapshots/screens/__PLATFORM__
```
For each selected screen that has a non-null `before`, write the before-content to `artifacts/{app_name}/delta/snapshots/screens/{platform}/{screen}.snapshot.html` using the Read + Write pattern (or `cp` from the `_backup/` source). Screens whose `before` is null (external-editor edit, no backup) have no pre-edit HTML to snapshot — skip them.

### Step 7: Register run + stamp the ledger

Append the run stub to `delta.runs[]` (with `mode` and `edited_screens`) and mark the consumed ledger entries, using the `Read → merge → Write back` pattern (do **not** replace top-level keys).

Run via Bash tool (substitute `__PLACEHOLDERS__`; `__EDITED_SCREENS_JSON__` = JSON array of `{screen, platform, path}` for the selected screens, `__CONSUMED_PATHS_JSON__` = JSON array of their `path` strings, `__DISMISSED_PATHS_JSON__` = JSON array of the paths the user chose to 破棄 in Step 2 — `[]` if none):
```bash
python3 << 'PYEOF'
import json, os

app = "__APP_NAME__"
run_id = "__RUN_ID__"
edited = json.loads('__EDITED_SCREENS_JSON__')
consumed = set(json.loads('__CONSUMED_PATHS_JSON__'))
dismissed = set(json.loads('__DISMISSED_PATHS_JSON__'))

# 1) pipeline-state.json: append run stub (mode=screen_edit)
ps_path = f"artifacts/{app}/pipeline-state.json"
ps = json.loads(open(ps_path).read()) if os.path.exists(ps_path) else {}
ps.setdefault("delta", {}).setdefault("runs", []).append({
    "run_id": run_id,
    "change_description": "__CHANGE_DESCRIPTION__",
    "initiated_at": "__INITIATED_AT__",
    "mode": "screen_edit",
    "edited_screens": edited,
})
open(ps_path, "w").write(json.dumps(ps, indent=2, ensure_ascii=False))

# 2) edited-screens.json: stamp consumed_by_run / dismissed_at
led_path = f"artifacts/{app}/delta/edited-screens.json"
if os.path.exists(led_path):
    led = json.loads(open(led_path).read())
    for e in led.get("entries", []):
        if e.get("consumed_by_run") is not None:
            continue
        if e.get("path") in consumed:
            e["consumed_by_run"] = run_id
        elif e.get("path") in dismissed and not e.get("dismissed_at"):
            e["dismissed_at"] = "__INITIATED_AT__"
    open(led_path, "w").write(json.dumps(led, indent=2, ensure_ascii=False))

print("OK: delta.runs stub (screen_edit) appended; ledger stamped")
PYEOF
```

This makes `delta.runs[-1]` (with `mode == "screen_edit"` and `edited_screens[]`) available for Step 29b (scoring + reverse-propagation). The screen-edit flow **skips Step 28** — scope is already confirmed here — and goes straight to Step 29b, then Step 30 (partial Figma update on the edited frames only, when Figma exists; otherwise the run completes at Step 29b approval).

---

## Output
- `artifacts/{app_name}/delta/change-manifest.json` — `source: "screen_edit"`
- `artifacts/{app_name}/delta/snapshots/screens/{platform}/{screen}.snapshot.html` (one per selected screen)
- `artifacts/{app_name}/pipeline-state.json` — `delta.runs[]` stub with `mode: "screen_edit"` + `edited_screens[]`
- `artifacts/{app_name}/delta/edited-screens.json` — selected entries stamped with `consumed_by_run`; 破棄が選ばれた entries は `dismissed_at` で終端
