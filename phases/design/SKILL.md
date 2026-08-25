---
name: ayatori-design
description: "Phase 2: Design system generation. Design brainstorm → palette OKLCH derivation → WCAG validation loop (08↔11) → sample HTML × 3 → human selection → 3-layer tokens + style-guide-view.html → human approval."
---

# /design — Phase 2 (Steps 08~13)

## Preamble

1. Read `pipeline.yaml` to confirm Phase configuration. If `skip_phases` includes `"design"`: display "⏭ design フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/` and determine `{app_name}`
4. Read `artifacts/{app_name}/requirements.json` to confirm project info (INPUT only).
4b. Determine REVERSE_ENGINEERED ファストパス mode (state source は `requirements.json.status` のみ。`session-handoff.md` は human-readable summary であり state SoT ではないため参照しない)。
    If `requirements.json.status == "REVERSE_ENGINEERED"`:
      - Read `pipeline.yaml` → `reverse_handoff.skip_rules.design` for active skip rules
      - (optional) `artifacts/{app_name}/session-handoff.md` が存在すれば `completed_at` / `artifacts_ready` を **表示用** に Read してよい (state 判定には使わない)
      - Display startup announcement:
        ```
        📋 {app_name} | REVERSE_ENGINEERED
           Resume: Step 08 — {reverse_handoff.skip_rules.design.use_instead}
        ```
      - Set `{reverse_handoff_active} = true` (used in Step 08 conditional)
    Otherwise (`requirements.json.status` is unset / not REVERSE_ENGINEERED):
      - Set `{reverse_handoff_active} = false`
      - Proceed with existing resume detection in step 5 unchanged.
5. Read `artifacts/{app_name}/pipeline-state.json` if it exists. Derive: `step13_approved_at = pipeline-state.approvals.step13_approved_at`, `selected_sample_id = pipeline-state.selections.selected_sample_id`.

5b. **Pre-flight Gate — Operating Principle 4** [main session 専用、subagent は実行不可]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = 6 (`ask[]` 0 件なら preamble step 6 = wcag-history.json Read へ。`hold[]` の有無は問わない)
   - `gate_before_step` = 08 (Step 08 以降を走らせる前に gate)
   - `target_artifacts` = `"design-brief.yaml,tokens.json,requirements/*.md"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (prose を渡すと path 形でない token として drop される)。`tokens.json` を含むのは、Step 12 が writer であり **リバース基線で TBD のまま持ち越された token 系 entry の受け皿**が本 phase だから (Phase 3 の skill が `reflect_to: tokens.json` で上げた質問はここで ask される)
   - `append_sources` = subagent (`ayatori-sample-html-builder`) が `assertion_failed: pending_question` を orchestrator (09-sample-html-gen) に return、または本 phase 内 skill
6. Read `artifacts/{app_name}/wcag-history.json` if it exists. Derive:
   - `wcag_attempts = wcag-history.attempts`
   - `last_violations = wcag_attempts[-1].violations if wcag_attempts else []`
   - `last_loop_violations = [v for v in last_violations if (v.get("pair_kind") or "palette") in ("palette", "domain_surface")]` (loop trigger 集合は {palette, domain_surface} — skill 11 §5.5.3、後続対応で判定式に反映。legacy データは `pair_kind` 不在 → `"palette"` 扱いで loop 発動側に倒す、安全側)
   - `last_state_color_violations = [v for v in last_violations if v.get("pair_kind") == "state_colors"]` (warn-only、loop 非発動)
   - `wcag_attempt_count = len(wcag_attempts)`
   - Read `pipeline.yaml.design.loop.max_attempts` (既定 3)
7. Determine resume position (priority order):
   - `step13_approved_at` is set → Phase 2 complete → proceed directly to Completion
   - `design-brief.yaml` does not exist → start from Step 08
   - `design-brief.yaml` exists with `schema: design-brief:draft:v1` && `wcag_attempt_count == 0` → **resume from Step 11** (08 完了・11 未実行の中断ケース。wcag-history 不在は「違反なし」ではなく「未検証」— Step 11 を飛ばして 09 へ直行しない)
   - `design-brief.yaml` exists with `schema: design-brief:draft:v1` && `last_loop_violations` has items && `wcag_attempt_count < max_attempts` → **resume from Step 08 loop-back** (08 reads `last_loop_violations` and corrects palette / domain surfaces). `last_state_color_violations` は resume 判定に影響しない (warn-only、B-3)
   - `design-brief.yaml` exists with `schema: design-brief:draft:v1` && `last_loop_violations` is empty → resume from Step 09 (state_color violations が残っていても進む)
   - `design-brief.yaml` exists with `schema: design-brief:draft:v1` && `design-samples/` has content && `selected_sample_id` is null → resume from Step 10 (human gate)
   - `design-brief.yaml` exists with `schema: design-brief:final:v1` && `tokens.json` has no content → resume from Step 12
   - `tokens.json` has content && `style-guide-view.html` exists && `step13_approved_at` is NOT set → resume from Step 13 (human gate)

> **Artifact responsibility (本 Phase で書き込むファイル)**:
> - `design-brief.yaml` ← Step 08 (3 案版 → 1 案版 schema 更新は Step 10)
> - `wcag-mapping.json` ← Step 11 が **初回のみ** 書く (constraints/criteria 不変量、W1)
> - `wcag-history.json` ← Step 11 が attempt ごとに append (single owner)
> - `tokens.json` / `style-guide-view.html` / `style-guide.md` ← Step 12
> - `pipeline-state.json` ← Step 10 (`selections.*`) / Step 13 (`approvals.step13_approved_at`) / Step 15 (`confluence.design.*`、Phase 3 で実行されるが本 Phase の予約)
> - `requirements.json` には書かない (INPUT 専用)

## Figma MCP Flag

Phase 2 (design) のステップ 08〜13 は **Figma を一切操作しない**。Step 12 はコード成果物 (tokens.json / style-guide HTML / 各 platform 用 build/) を生成するのみで、Figma Variables 3 コレクション (Primitives / Semantic / Component) の登録は **Phase 3 の Step 24 (design-system-update)** が担当する。

したがって本フェーズでは `skills/00-figma-mode-detect/SKILL.md` の呼び出しは不要。`FIGMA_MCP_ENABLED` の判定は Phase 3 (`/ayatori-screens`) のオーケストレータが行う。

---

## Execution

Execute Steps in the following order. **Steps 08 and 11 form a WCAG validation loop** controlled by this orchestrator.

### Step 08: Design Brainstorm (hearing + 3 directions + palette OKLCH derivation)

Read and execute `skills/08-design-brainstorm/SKILL.md`.

- **初回実行**: 6軸ヒアリング → 3方向性決定 → palette OKLCH導出 → typography → motion → anti-slop → `design-brief.yaml`（3案版・schema:draft:v1）書込み
- **ループ再実行**: `wcag-history.json.attempts[-1].violations` の loop 対象 (palette / domain_surface) を読んで補正 (palette → 該当 token の OKLCH 補正 / domain_surface → 該当 surface の bg 側補正、skill 08 モード B) → `design-brief.yaml` 上書き

### Step 11: WCAG Constraints + Palette Contrast Validation

Read and execute `skills/11-wcag-mapping/SKILL.md`.

- **初回 write モード**: 色非依存 WCAG 制約 (constraints + criteria) を `wcag-mapping.json` に書く (ループ不変量、W1)
- **毎回**: 08 palette の全 contrast pair を計算し、本 attempt の violations を `wcag-history.json.attempts` に **append** する (本 skill が単一 writer)

### ⚙️ Loop Decision (08 ↔ 11)

After Step 11 completes, read `artifacts/{app_name}/wcag-history.json` and `pipeline.yaml.design.loop.max_attempts` (既定 3) to decide.

**B-3 切り分け**: violation を `pair_kind` で分類して扱う (本 orchestrator が判定 SoT、skill 11 は分類値を history に記録するだけ)。

- `pair_kind === "palette"` (pairs 1-7、主要 palette): loop trigger。発動対象
- `pair_kind === "domain_surface"` (pairs 16〜、NFR 由来 domain 面): **loop trigger (palette と同等扱い)** — NFR 由来の視認性要求は warn で緩めず Phase 2 で収束させる (skill 11 §5.5.3。宣言済みだが本判定式に未反映だった更新漏れを是正済)
- `pair_kind === "state_colors"` (pairs 8-15、state colors): warn-only、loop 非発動 (Step 21 human gate で再判断 — skills/21 Section 1-E)
- `pair_kind === "schema_violation"` (skill 11 §5.5.1 safety net): loop 非発動、記録のみ (Step 13 human gate のチェックリストで確認)
- `pair_kind` 不在 (改修前の legacy data): `"palette"` 扱い (loop 発動側に倒す、安全側)

```
attempts                 = wcag-history.json.attempts
last_violations          = attempts[-1].violations
loop_violations          = [v for v in last_violations
                            if (v.get("pair_kind") or "palette") in ("palette", "domain_surface")]
state_color_violations   = [v for v in last_violations
                            if v.get("pair_kind") == "state_colors"]
attempt_count            = len(attempts)

if loop_violations is empty:
    → proceed to Step 09
    ※ loop 対象 pair (palette 1-7 + domain_surface 16〜) が全 3案 AA 準拠済み
    ※ state_color_violations が空でなくても Step 09 へ進む (warn-only)。
      この場合は feedback-log.md に Pattern C で 1 行記録:
        "[11] state_color violations {Ns}件 を残して Phase 3 へ前進 (warn-only)。Step 21 human gate で再判断。"

elif attempt_count < max_attempts:
    → go back to Step 08
    ※ 08 は loop_violations のみを読んで補正して再実行 (モード B:
      palette → 該当 token を fg 側補正 / domain_surface → 該当 surface の mode hex を bg 側補正。
      state_color_violations は 08 では補正しない、Step 17/21 経路で扱う)
    ※ 11 が次回呼び出し時に新しい attempt を append (pair_kind を必ず埋める)

else:  # attempt_count >= max_attempts (typically 3)
    append to feedback-log.md with Pattern C:
      "[11] WCAG補正ループ上限到達: loop対象 (palette+domain) {Nl}件 / state_colors {Ns}件 の違反を残したまま09へ進む。Step 10/21 の人間レビューで判断。"
    proceed to Step 09 with warning
    ※ 09 は loop_violations が残ったまま HTML を生成し、HTML 上部に警告バッジを表示
```

Loop thresholds are defined in `pipeline.yaml.design.loop` (`max_attempts: 3`, `score_file: wcag-history.json`).

> **単一所有権モデル**: `wcag-history.json.attempts` の append は **Step 11 のみ**が行う (08/12/13 等は触らない)。`attempt_count` は `len(attempts)` で導出される値であり、専用の field を持たない (旧 `wcag_loop.attempt_count` は廃止)。
>
> **Phase 3 への引き継ぎ (B-3)**: `state_color_violations` が空でないまま Phase 2 を完了する場合、Step 21 (skill 21) は human gate の前に「未解決の state_color violations: N 件 — `wcag-history.json.attempts[-1].violations` (`pair_kind == "state_colors"`) を参照」を必ず表示すること。warn-only を「沈黙の隠蔽」にしないため。(実装: `skills/21-screen-human-review/SKILL.md` Section 1-E — 宣言のみで skill 側に実装が無かった状態を後続対応で解消)

### Step 09: Sample Screen HTML Generation (3 variants, per platform)

Read and execute `skills/09-sample-html-gen/SKILL.md`.

- `design-brief.yaml`（3案版）と `wcag-history.json.attempts[-1].violations` を読み、プラットフォームごとに切替1ファイルHTMLを生成
- 出力: `design-samples/{platform}/index.html`
- 安全網として生成後に contrast 再検証、違反あれば feedback-log (Pattern B) + HTML 警告バナー + subagent report (`wcag_safetynet.violations[]`) で報知し、**中断せず** Step 10 の人間ゲートで判断する (wcag-mapping.json / wcag-history.json へは書かない — wcag 系の writer は Step 11 のみ)

### Step 10: Human Review (Sample Screen Selection — Gate)

Read and execute `skills/10-sample-human-review/SKILL.md`.

- 承認（A/B/C選択）→ `design-brief.yaml` を 1案版（schema:final:v1）に上書き → Step 12 へ
- 否認（やり直し）→ Phase 2 成果物クリーンアップ → Step 08 から再実行

### Step 12: Design System Generation (3-tier tokens + style-guide-view.html)

Read and execute `skills/12-design-system/SKILL.md`.

- `design-brief.yaml`（1案版）から選択された palette を読み、tokens.json 生成
- 色の具体値に対する contrast 実測を `tokens.json.$description` に記録
- **Figma 操作は行わない。** Variables 3 コレクション (Primitives / Semantic / Component) の登録は Step 24 (design-system-update) が担当する

### Step 13: Style Guide Review (Human Gate)

Read and execute `skills/13-human-gate-design/SKILL.md`.

## Completion

After approval:

0. **Safety-net write for `step13_approved_at`** — Read `artifacts/{app_name}/pipeline-state.json` (or `{ "app_name": "{app_name}" }` if absent). 以下 2 点を確認・補完して Write back。`app_name` field は **必ず保持** すること (schema required):
   - **(a) `approvals.step13_approved_at`**: empty / missing なら現在時刻 (ISO 8601, `Z` または offset 付き) を set。既存値があれば尊重して上書きしない。
   - **(b) `app_name`**: missing / empty なら現在のディレクトリ名 `{app_name}` を補完 (schema 上 required)。

   **(a) が発火した場合 (= Skill 13 の write が完全に skip された異常ケース)**: `artifacts/{app_name}/feedback-log.md` に Pattern B を 1 行追記する:
   ```
   - **[13→2-design Completion] Pattern B**: Skill 13 が step13_approved_at を書かずに Completion へ到達 → safety-net が現在時刻 ({ISO 8601}) で補完 → Skill 13 の Step 1/2 が機能していない可能性。要調査。
   ```
   実際の承認時刻と safety-net による補完時刻は若干ズレるため、audit 用途では feedback-log を参照すること。

   Skill 13 が Step 1 を確実に書き込んでいれば (a) は no-op となり feedback-log への記録も発生しない。本ステップは Skill 13 write 漏れに対する安全網であると同時に、欠落 field (`app_name`) の補完ポイントでもある。

1. Write `artifacts/{app_name}/session-handoff.md` (overwrite if exists). **Human-readable summary only — NOT execution state**。本ファイルは次セッション起動時にユーザーが目視で進捗を確認するためのメモであり、後続 Phase の resume / skip / state 判定には一切使用されない (state SoT は `pipeline-state.json` + `requirements.json`)。`project_origin` 等の frontmatter field は legacy 互換のためのみ残しており、空 / 古い値 / 欠落でも下流挙動には影響しない。

```
---
app_name: {app_name}
phase_completed: "2-design"
completed_at: "{YYYY-MM-DDThh:mm:ss±hh:mm}"
artifacts_ready:
  - design-brief.yaml
  - tokens.json
  - style-guide-view.html
next_phase: screens
next_command: /ayatori-screens
---
# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.
Phase 2 (Design) complete. Run `/ayatori-screens` in a new conversation.
```

2. Use AskUserQuestion to present the next step:
   > "Phase 2 (Design System) complete. Would you like to proceed to the next step?"
   > Option 1: "Proceed to `/ayatori-screens`"
   > Option 2: "End here for now"

When Option 1 is selected: run `pwd` via Bash to get `{repo_root}`, then display:
```
✅ Phase 2 complete。次のセッションを開始するには、以下をコピーして新しい会話に貼り付けてください:

/ayatori-screens をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```

When Option 2 is selected: display:
```
Artifacts saved in `artifacts/{app_name}/`. 再開するには新しい会話で次を貼り付けてください:

/ayatori-screens をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```

## Feedback Log

When modifications, issues, or design changes occur during execution, immediately append to `artifacts/{app_name}/feedback-log.md`.
Record format:
```
- **[Step number] Category**: {what happened} → {cause} → {immediate fix}
```

Common patterns for Phase 2:
- **Pattern A** — Human gate returned modification instructions (Step 10, 13)
- **Pattern B** — Agent made a mistake and had to redo (Step 09 safety-net contrast violation, Step 08 correction loop)
- **Pattern C** — Discovered a pipeline design flaw (WCAG loop max_attempts reached, resume logic ambiguity)

---

## Phase 2 TODO (inherit notes)

The following are reserved for future Phase 2 enhancements. Phase 1 does not implement them:

1. **`revision_mode` branching** in `design-brief.yaml.frontmatter`:
   - `"full"` — current behavior (full 08 re-run)
   - `"partial"` — delta re-run (hearing kept, only target axis regenerated)
   - `null` — default

2. **Step 10 refinement UI**: allow "A案の色だけ変える" style partial corrections instead of only A/B/C or full restart.

3. **WCAG loop escape paths**: when max_attempts is reached, offer human intervention options (change concept / relax AA→A / manually override violations).

4. **Plural-design platform DRY**: share header/footer templates when multiple platforms are generated.
