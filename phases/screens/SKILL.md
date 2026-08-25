---
name: ayatori-screens
description: "Phase 3: Screen docs → main (default) HTML → 3-layer review loop → human approval → optional graphic generation block (21a-21g) → Figma export → final approval → design system update → component build → optional sub-state patterns (25a-25e)."
---

# /screens — Phase 3 (Steps 14~25 + optional 21a-21g graphic block + optional 25a-25e for sub-state patterns)

> **二段階完了モデル**: Phase 3 は **2 段階で完了** する。
> 1. **main HTML 完了** (Step 17→25): `final_approved=true` で Phase 4 retro 起動可能
> 2. **sub-state パターン完了** (Step 25a→25e): `completed_at_states` が立つと Phase 5 delta 起動時に preserved-screen として保護される
> Step 25 後に Step 25a で user に sub-state 要否を AskUserQuestion で確認。「不要」選択時は `state_pattern_skipped=true` を記録し 25b-25e を skip。「proceed」選択時は state-pattern-plan.json を生成して 25b で sub-state HTML 追加生成、25c 採点、25d 承認、25e Figma 追加出力へ進む。

## Preamble

1. Read `pipeline.yaml` to confirm Phase configuration and loop thresholds. If `skip_phases` includes `"screens"`: display "⏭ screens フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

> **フィードバックログ記録ルール（P-04）**: このフェーズ中にエラー修正・手戻り・設計変更（Pattern A/B/C）が発生した場合は、**その発生時点で即座に** `artifacts/{app_name}/feedback-log.md` へ追記すること。フェーズ終了後のまとめ記録は禁止。
3. Check subdirectories under `artifacts/` and determine `{app_name}`
4. Read `artifacts/{app_name}/requirements.json` (INPUT only — `design_output_scope` 等). Read `artifacts/{app_name}/pipeline-state.json` if it exists. Derive: `step13_approved_at = pipeline-state.approvals.step13_approved_at`. If NOT set: display "⚠️ Phase 2 (Design System) が未完了です。先に `/ayatori-design` を実行・承認してから /ayatori-screens を起動してください。" and exit.
4a. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = 4b (`ask[]` 0 件なら preamble step 4b = REVERSE_ENGINEERED ファストパス判定へ。`hold[]` の有無は問わない)
   - `gate_before_step` = 14 (Step 14 以降を走らせる前に gate)
   - `target_artifacts` = `"requirements.json,screens/00-coverage-check.json"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (prose を渡すと path 形でない token として drop される)
   - `append_sources` = subagent (`ayatori-screen-state-builder`) が `assertion_failed: pending_question` を orchestrator (25b-state-pattern-gen) に return、または本 phase 内 skill
4b. Determine REVERSE_ENGINEERED ファストパス mode (state source は `requirements.json.status` のみ。`session-handoff.md` は human-readable summary であり state SoT ではないため参照しない)。
    If `requirements.json.status == "REVERSE_ENGINEERED"`:
      - Read `pipeline.yaml` → `reverse_handoff.skip_rules.screens` for active skip rules
      - (optional) `artifacts/{app_name}/session-handoff.md` が存在すれば `completed_at` / `artifacts_ready` を **表示用** に Read してよい (state 判定には使わない)
      - **4b-1. Route 選択 (reverse 経路限定)**: `approvals.final_approved != true` のときだけ AskUserQuestion で Phase 3 のルートを選ばせる。`final_approved == true` (= main HTML 承認済み) のときは **質問せず Route B (従来経路) として続行** する (sub-state 後続生成などの再入判定をブロックしないため)。
        - **質問の前に画面 HTML の枚数を実測する** (`ls artifacts/{app_name}/screens/{web,web-sm,mobile}/*.html` — **3 platform ディレクトリ直下のみ**を数える。`screens/00-transition-map.html` / `screens/_shared/components.html` は Route A が正当に作る成果物なので数に入れない)。**1 枚以上なら Route A を提示せず**、次の 1 行を表示して Route B として続行する (提示 → 選択 → lite resume 判定で差し戻しの往復を避ける。判定の実体は下記「lite resume 判定」最終 rung と同じ):
          ```
          📋 {app_name} | 画面 HTML {N} 枚あり — Route B (フル実行) が進行中のため、そのまま従来経路で続行します
          ```
        - `approvals.baseline_approved_at` が既 set の場合は、質問の前に 1 行 announce する — `📋 {app_name} | 基線確立済み (baseline_approved_at: {値}) — ここから画面 HTML を作るなら「フル実行」を選んでください` — そして **選択肢は Route B を先頭 (= 既定)** に並べる。未 set なら Route A を先頭に並べる (reverse 直後の推奨)。
        - AskUserQuestion (`header: "Phase 3 ルート"`、単一選択):
          - **Route A: 基線確立 (screens-lite)** — 画面 HTML を作らず、変更コマンド (`/ayatori-add-feature` / `/ayatori-delta`) が必要とする最小材料 (遷移図 SSoT + 派生ビュー + 共通部品の正典) を整えてベースライン承認印を押す。reverse 直後の推奨
          - **Route B: フル実行 (従来)** — 全画面 HTML 生成 → レビューループ → Figma → 最終承認まで進む従来の Phase 3
        - Route A → `{screens_lite_active} = true` / `{reverse_handoff_active} = true` → 下記 4b-2 へ
        - Route B / ESC → `{screens_lite_active} = false` / `{reverse_handoff_active} = true` → 4b-3 (以降の従来手順) へ。ESC は**従来挙動である Route B に倒す** (無言で新ルートへ流さない)
      - **4b-2. Route A (screens-lite) の場合**: 次を表示し、**4b-3 以降 (startup announcement / figma-state.json bootstrap) は実行せず**、手順 5〜7 を実行したうえで **手順 8 の resume cascade ではなく `## Execution — screens-lite` 節の「lite resume 判定」** に従う。`figma-state.json` の bootstrap を行わないのは、lite ルートが Figma に一切出力しないため (後からフル実行する場合は次回起動時の Route B が bootstrap する):
        ```
        📋 {app_name} | REVERSE_ENGINEERED · screens-lite (基線確立ルート)
           画面 HTML は生成しません — 材料確認 → Step 16 (人間) → 共通部品の正典 → ベースライン承認
        ```
      - **4b-3. Route B (フル実行) の場合**: 以下は従来の REVERSE_ENGINEERED ファストパスと同一。
      - Display startup announcement:
        ```
        📋 {app_name} | REVERSE_ENGINEERED
           Resume: Step 16 — Step 14 skipped ({reverse_handoff.skip_rules.screens.use_instead})
        ```
      - **figma-state.json bootstrap (P-18, 新規)**: Check if `artifacts/{app_name}/figma-state.json` exists.
        If it does NOT exist (REVERSE_ENGINEERED path skipped Step 12 which normally creates it):
        - Read `user/AYATORI_MEMORY.md` and look for `figma_file_key` and `figma_ayatori_page_id`
        - Create `artifacts/{app_name}/figma-state.json` with the following stub (schema: `schemas/figma-state.schema.json`、root strict なので `app_name` と `file_key` を必須で書き、他は schema 定義済プロパティのみで埋める):
          ```json
          {
            "app_name": "{app_name}",
            "file_key": "{figma_file_key from AYATORI_MEMORY.md}",
            "page_name": "AYATORI Pipeline",
            "page_id": "{figma_ayatori_page_id from AYATORI_MEMORY.md}",
            "nodes": { "style-guide": null, "screens": {} }
          }
          ```
          注: `scope` は root.required に含まれない (任意)。**stub には scope を含めない**。Step 22 が初回実行時に Step 2.0 (AskUserQuestion Q1/Q2) → Step 2.1.5 (caffeinate) → Step 2.3 (capture loop) を経て、scope.status を含む 10 field 完全形 (schema の scope.required) を populate する設計。stub に scope を partial で書くと、Commit 6 で導入した「scope は object 形式のとき 10 field 全件 required」と矛盾するため空欄が正解。
        - Display: `📄 figma-state.json stub created (REVERSE_ENGINEERED path — Step 22 will populate scope + nodes.screens)`
      - Set `{reverse_handoff_active} = true` (used in Step 14 conditional)
    Otherwise (`requirements.json.status` is unset / not REVERSE_ENGINEERED):
      - Set `{reverse_handoff_active} = false` / `{screens_lite_active} = false`
      - **route 選択 (4b-1) は出さない** — forward プロジェクトの挙動は従来と完全に同一に保つ (screens-lite は reverse 基線専用ルート)
      - Proceed with existing resume detection in step 7 unchanged.
5. Read `artifacts/{app_name}/tokens.json`, `design-brief.yaml`, `style-guide-view.html`
   - **`{screens_lite_active} == true` の場合は `tokens.json` のみ Read する** — `design-brief.yaml` / `style-guide-view.html` は Phase 2 の生成物。**正規経路では Phase 2 完走済みなので存在するはず** (reverse も既存パイプラインに合流するため design → screens の順に流れ、上記手順 4 が `step13_approved_at` を要求する)。**手動 stub の Standalone 運用** (`CLAUDE.md` § Standalone Phase 実行 で `step13_approved_at` を stub で立てた場合) **のときだけ不在があり得る**ため、不在ファイルの Read でエラー停止させない
6. If `artifacts/{app_name}/scores.json` exists, Read it to check current score, attempt_count, and escalated flag
7. Derive cross-phase state from `pipeline-state.json`:
   ```
   step16_approved_at        = pipeline-state.approvals.step16_approved_at
   screens_human_approved    = pipeline-state.approvals.screens_human_approved == true
   final_approved            = pipeline-state.approvals.final_approved == true
   design_save_count         = pipeline-state.confluence.design.save_count or 0
   step22_figma_status       = pipeline-state.screens.step22_figma_status (disabled fallback の skip 記録、未 set 可)
   graphics                  = pipeline-state.screens.graphics or {}
   graphics_human_approved   = pipeline-state.approvals.graphics_human_approved == true
   graphic_generation_scope  = requirements.design_output_scope.graphic_generation or "ask" (欠落 = ask — 後方互換は「聞く」側に倒す)
   ```
8. Determine resume position:
   - **`{screens_lite_active} == true` のときは以下の cascade を使わない** — `## Execution — screens-lite` 節の「lite resume 判定」に従う (lite は工程が 5 段で、判定に使う artifact も forward cascade とは別)。Route B / forward はこれまでと同じく以下を使う
   - `screens/00-screen-list.md` does not exist → start from Step 14
   - `screens/00-screen-list.md` exists AND `step16_approved_at` NOT set → resume from Step 16 (human gate — not yet approved)
   - `screens/00-screen-list.md` exists AND `step16_approved_at` IS set AND `design_save_count` == 0 → Step 16 was approved but Step 15 (1st Confluence save) was interrupted → resume from Step 15
   - `design_save_count == 1` and `screens/*.md` files do not exist → resume from Step 17
   - `scores.json` exists, `ai_improvable_deductions > 0`, `attempt_count < 3` → re-execute loop from Step 17
   - `scores.json.escalated == true` and not `screens_human_approved` → resume from Step 21 (escalation — max attempts reached)
   - `ai_improvable_deductions == 0` and not `screens_human_approved` → resume from Step 21 (human gate)

   **グラフィック生成ブロック (21a-21g) resume 判定** (設計 `docs/graphic-generation-design.md` §9-1。**全分岐に `design_save_count < 2` ガード** — 2nd save 通過済み / 完走済みプロジェクトは graphics 分岐にマッチせず従来判定へ抜ける。これが「`final_approved` 後は delta 領域」(設計 §5) を機械的に保証する):
   - `screens_human_approved` AND `design_save_count < 2` AND `graphic_generation_scope == "skip"` AND `graphics.decision` NOT set
     → **orchestrator が単一 writer として** `screens.graphics.decision = "skip"` + `decided_by = "upstream_scope"` を一度だけ記録する (21a-21g は 1 つも走らない経路のため writer は 21x step ではない — 設計 §5/§9-1。**連続 1 セッションの進行でブロック入口 [Step 21 承認直後] に到達した場合も同じ記録を書く** — cascade 到達時に限定すると連続セッションで decision 未記録のまま Step 15 入口 assert に掛かる) → 次行以降の判定を続行 (Step 15 行へ抜ける)
   - `screens_human_approved` AND `design_save_count < 2` AND `graphic_generation_scope != "skip"` AND `graphics.decision` NOT set:
     - `graphics.step21a_completed_at` NOT set → resume from Step 21a
     - set → resume from Step 21b (分析済み・要否未回答)
   - `design_save_count < 2` AND `graphics.decision == "generate"` AND NOT `graphics_human_approved`:
     - `graphics.taste_confirmed_at` NOT set → Step 21c / `graphics.prompts_confirmed_at` NOT set → Step 21d / `graphics.step21e_completed_at` NOT set → Step 21e (再生成は設計 §9-2b の pending slot のみ) / `graphics.step21f_completed_at` NOT set → Step 21f / else → Step 21g

   - `screens_human_approved` and `design_save_count < 2` → resume from Step 15 (2nd Confluence save — adds screens/*.md)。※ graphics 判定が上流に入るため、この行に到達する = graphics 解決済み (decision == "skip"、または decision == "generate" かつ `graphics_human_approved`)
   - `design_save_count >= 2` and `figma-state.json.nodes.screens` is empty AND `step22_figma_status != "skipped_stub_mode"` → resume from Step 22
   - (`figma-state.json.nodes.screens` populated OR `step22_figma_status == "skipped_stub_mode"`) and not `final_approved` → resume from Step 23
   - `final_approved` and `step24_completed_at` NOT set → resume from Step 24
   - `step24_completed_at` set and `step25_completed_at` NOT set → resume from Step 25

   > **disabled (スタブモード) 経路の resume**: `step22_figma_status = pipeline-state.screens.step22_figma_status` (Step 22 の disabled fallback が書く skip 記録)。disabled では Step 22 が `nodes.screens` を populate しないため、この条件が無いと Step 22 判定行が disabled 環境で永久にマッチし続け、後段の Step 23/24/25 判定に到達できない。disabled の初回 resume は Step 22 に入り fallback が skip 記録を書いて Step 23 へ進む — 以降の resume は記録により Step 23 判定へ抜ける (env `mode` を resume 判定に持ち込まず、artifact だけで決定的に判定できる)。Step 24 / 25 は各 skill 冒頭のスタブ手順 (skill 24 §Step -1 / skill 25 §Step 0) が `step24_completed_at` / `step25_completed_at` を書くため、disabled 経路でも本 resume 規則で Step 25a まで到達できる。

   > **25c 採点スキップ防止 (二層防御)**。25b→25c→25d の順序は本 resume ロジック (prose) だけでなく機械的に強制される: (1) 25d/25e skill の Phase 0 に「25c が最新 25b 出力を採点済み」の hard assert、(2) PreToolUse hook `.claude/hooks/enforce-substate-scoring.sh` が `pipeline-state.json` への 25d 承認 / `completed_at_states` 書き込みを 25c 未採点時に exit 2 block。連続 1 セッションで 25b から人間確認へ直行しても 25c を飛ばせない。

   > **skip 後の後続生成 再入経路**。`state_pattern_skipped == true` で一度「不要」を選んだ後でも、`/ayatori-screens` を再実行したら sub-state を後追い生成できる再入経路を用意する (従来は無言で Phase 4 retro に dead-end していた)。下記 `state_pattern_skipped == true` 分岐で **再入判定 AskUserQuestion** を出す。
   >
   > **再入後の中途離脱** (skip 解除 → 25a proceed → 25b 生成まででセッション中断) は、次回 `/ayatori-screens` 再実行時に下記 resume 判定 (`step25b set AND NOT step25c` → 25c から継続) で正常フローへ戻る。この状態で `/ayatori-delta` が先に実行された場合は、`completed_at_states` 未 set のため Step 28 が `sub_state_aware: false` に downgrade して未承認 sub-state を扱わない (完了ゲート条件、`skills/28-impact-analysis/SKILL.md` Step 1b 参照)。

   **sub-state パターン (25a-25e) resume 判定**:
   - `step25_completed_at` set AND NOT (`step25a_completed_at` OR `state_pattern_skipped == true`) → resume from Step 25a (user に sub-state 要否を確認)
   - `state_pattern_skipped == true` → **再入判定**: `/ayatori-screens` 再実行時、AskUserQuestion で「sub-state を今から生成する / このまま Phase 4 retro へ進む」を確認する。`header: "Sub-state 後続生成"`、options: (A) `"sub-state を生成する (Step 25a へ)"` — Step 25a を再起動 (25a proceed 時に `state_pattern_skipped` を解除)、(B) `"Phase 4 retro へ進む"` — 従来通り Phase 3 完了扱いで retro へ遷移。ESC / (B) 選択時は従来動作 (retro)。既に sub-state を作った後 (`completed_at_states` set) の**追加生成は本分岐の対象外** (delta 領域、`/ayatori-delta` で扱う)
   - `step25a_completed_at` set AND `screens/state-pattern-plan.json` exists AND NOT `step25b.completed_at` → resume from Step 25b
   - `step25b.completed_at` set AND NOT `step25c.completed_at` → resume from Step 25c
   - `step25c.completed_at` set AND NOT `step25d.completed_at` → resume from Step 25d
   - `step25d.completed_at` set AND `step25d.approved == true` AND NOT `step25e.completed_at` → resume from Step 25e
   - `step25d.decision == "skip_without_figma"` → Phase 3 完了扱い (Figma 追加せず Phase 4 retro へ)
   - `step25e.completed_at` set → Phase 3 完全完了 (`completed_at_states` 記録済、Phase 4 retro へ)

> **Artifact responsibility (本 Phase で書き込むファイル)**:
> - `screens/` (各種 .md / .html) ← Step 14 / 17 (default main HTML) / 25b (sub-state HTML) が生成。**21g は既存 main HTML への `<img>` 正典相対参照の挿入と `screens/{screen}.md` への「使用グラフィック」節追記のみ** (対象 graphic_id のタグ / マーカー節に閉じた scope 分離 — 生成 writer とは衝突しない)
> - `screens/00-coverage-check.json` ← Step 14 が主 writer (全体 + `user_accepted_gaps`)、Step 21 は `user_indicated_gaps` キーのみ append (split ownership; キー競合なし)。screens-lite (Route A) では 14-lite が同じ writer 責務を担い、L5 のみ `validate-connectivity.mjs --write` で patch する
> - `screens/00-transition-map.mmd` (SSoT) / `00-transition-map.html` (派生) / `00-screen-nav.json` (派生) ← Step 14 が主 writer。screens-lite (Route A) では 14-lite が **不在分だけ**補う (`.mmd` は決定論 script の salvage、他 2 つはテンプレート / script 派生。既存 `.mmd` は再生成しない)
> - `screens/_shared/root-variables.css` / `common-styles.css` ← 本 phase § Step 17 の **Phase A 手順 3 / 4** が writer (skills/17 側は「Read して各 HTML へ inline copy」する消費側)。`components.html` / `components.css` ← `skills/17-screen-gen/SKILL.md` § **Step 0b-1** が writer。`icons-manifest.json` / `icons/*.svg` ← 同 § **Step 0**。screens-lite (Route A) は lite-3 で **この 3 つ (Phase A 手順 3/4 + Step 0b-1 + Step 0) のみ**を実行する (画面 HTML は生成しない)
> - `screens/state-pattern-plan.json` ← Step 25a が初回のみ生成 (loop 不変量)
> - `screens/state-pattern-scores.json` ← Step 25c が attempt ごとに append (loop history)
> - `graphics/graphic-recommend.md` (+ 派生 `graphic-recommend.html` — 候補位置の視覚レポート、候補 0 件 / render 失敗時は不在) ← Step 21a が単一 writer (degrade skip 時は不在)
> - `graphics/graphic-plan.json` ← Step 21b が init + `slots[]` (taste キーは 21c のみ append する key 分離)
> - `graphics/graphic-prompts.json` ← Step 21d が単一 writer (writer 実体は `commit-prompts.mjs`)
> - `graphics/raw/` (`{graphic_id}.png` + 監査台帳 `generation-manifest.json`) ← Step 21e が単一 writer (writer 実体は `generate-graphics.mjs`)
> - `screens/_shared/graphics/` (`{graphic_id}.png` グラフィック正典 — raw 無加工コピー、圧縮 ⑫ 非搭載) ← Step 21f が単一 writer (writer 実体は `postprocess-graphics.mjs`。29 は additive のみ)
> - `graphics/postprocess-manifest.json` (後処理の監査台帳 — 透過検証 verdict / degrade ラベル) ← Step 21f が単一 writer
> - `scores.json` ← Step 19 (採点、main 視点。`current.coverage_check` フィールドに L1〜L4 再評価結果を含む。sub-state 採点は state-pattern-scores.json に分離)
> - `figma-state.json` ← Step 17 / 22 (default only) / 24 / 25 / 25e (sub-state append) (FIGMA_MCP_ENABLED=true 時のみ)
> - `pipeline-state.json` ← Step 16 / 21 / 22 (disabled fallback: `screens.step22_figma_status` のみ) / 23 / 24 / 25 (`screens.step24_completed_at` / `step25_completed_at` + disabled 時 `step24_figma_status` / `step25_figma_status`) / 25a / 25b / 25c / 25d / 25e (`approvals.*` + `screens.*` + `approvals.completed_at_states`) + Step 15 (`confluence.design.*`) + **21a / 21b / 21c / 21d / 21e / 21f / 21g (`screens.graphics.*` — 各 skill の key 分離に従う。21e は `generated_files[]` / `excluded_slots[]` / `step21e_completed_at` / 中止時 `decision`。21f は `generated_files[].file` の正典パス更新 / `step21f_completed_at` / `transparency_waived[]` / degrade 時の `excluded_slots[]` append・retry 時の entry 削除 + `step21e_completed_at` クリア / 中止時 `decision`。21g はさらに `approvals.graphics_human_approved` + `step21g_approved_at`、却下時の `generated_files`/`excluded_slots`/`decision=skip decided_by=step21g`) + orchestrator (上流 skip 時の `screens.graphics.decision`/`decided_by`、21g 差し戻し routing の `rework_pending` + timestamp クリア — 実体は 21g の `route-rework.mjs` を § Step 21g の指示で起動)** + **ベースライン承認ゲート (screens-lite Route A の lite-4c — `approvals.baseline_approved_at` + `baseline_approved_via` のみ。reverse 経路限定。冪等: `baseline_approved_at` が既 set なら両キーとも触らない)**
> - `requirements.json` には書かない (INPUT 専用)

## Execution — screens-lite (Route A: 基線確立)

> **本節は `{screens_lite_active} == true` のときだけ実行する** (= reverse 経路 かつ main HTML 未承認 かつ 4b-1 で Route A を選択)。Route A は**本節で完結**し、以降の `## Figma MCP Flag` / `## Execution` / `## Completion` 節 (Route B / forward 用) は実行しない。
>
> **扱わないもの**: 画面 HTML の生成 (Step 17) / 採点ループ (18〜20) / 画面 HTML の人間ゲート (21) / グラフィックブロック (21a〜21g) / Confluence 保存 (15) / Figma 出力 (22 / 24 / 25) / sub-state (25a〜25e) / `approvals.final_approved`。本ルートの目的は、**変更コマンド (`/ayatori-add-feature` / `/ayatori-delta` / `/ayatori-req-delta`) が必要とする材料を揃え、人間がベースライン承認印を押すところまで**。
>
> Figma mode 判定 (`skills/00-figma-mode-detect/SKILL.md`) は実行しない — lite ルートは Figma を一切触らないため。
>
> **番号の読み分け**: 本節の `lite-0`〜`lite-5` は **Phase 3 側の工程番号**。`skills/14-screen-list-transition/SKILL.md` の `## 14-lite` 節の内部工程は接頭辞を分けた `14L-0`〜`14L-5` で、**本節 lite-1 = 14L-0〜14L-5 の全体** に対応する (別体系なので番号で相互参照しないこと)。

### lite resume 判定 (Preamble 手順 8 の cascade の代わり)

上から順に評価し、最初にマッチした工程から再開する。**lite ルートは新しい state キーを増やさない** — 進み具合は既存キー (`approvals.step16_approved_at` / `approvals.baseline_approved_at`) と成果物の実在だけで決定的に判定できる:

- `approvals.baseline_approved_at` is set → **lite-4 の押印は冪等に skip**。lite-5 の完了表示のみ行って終了する (材料の再生成はしない)
- `approvals.step16_approved_at` NOT set → **lite-0 から** (前提検査 → 14-lite → Step 16 ゲート)
- `approvals.step16_approved_at` set AND **lite-3 の産出物 (下記) のいずれかが不在** → **lite-3 から** (Step 16 承認済み・正典生成が中断していた)
- `approvals.step16_approved_at` set AND lite-3 の産出物すべて実在 AND `screens/{web,web-sm,mobile}/*.html` が **0 枚** → **lite-4 から** (ベースライン承認ゲート)
- `approvals.step16_approved_at` set AND lite-3 の産出物すべて実在 AND `screens/{web,web-sm,mobile}/*.html` が **1 枚以上** → 次を表示して **本 phase を終了する** (lite-4 に進ませない):

  ```
  ⚠️ このプロジェクトには画面 HTML が {N} 枚あります — Route B (フル実行) が進行中です。
     Route A は画面 HTML を持たないプロジェクトの基線確立ルートのため、
     `/ayatori-screens` を再実行して Route B (フル実行) を選んでください。
  ```

  > **なぜ止めるか**: Route B 途中 (画面 HTML 生成済み・Step 21 の人間レビュー未通過) のプロジェクトで基線印を押すと、`/ayatori-delta` の Step 29 が**未レビューの画面を preserved (不変の正) として固定**してしまう。基線印の意味は「画面 HTML を持たない基線が揃った」であり、レビュー前の画面を承認済み扱いに昇格させる印ではない。実在検査 (`ls`) で判定し、state キーからは推測しない。
  >
  > **rung 順の迂回を塞ぐ**: 上位 rung (`step16_approved_at` 未 set → lite-0 / lite-3 の産出物不在 → lite-3) は HTML 枚数を条件に持たないため、それらが先にマッチすると本 rung は評価されない。その経路でも押印させないため、**lite-4a の機械検査にも同じ停止条件を置く**。
  >
  > なお lite ルートへの入場は必ず 4b-1 (Route 選択) を通り、そこで既に HTML ≥ 1 なら Route A を提示しないので、**本 rung と lite-4a のストップは通常は到達しない** — 4b-1 の判定を将来変えたときに押印を止める保険 (同じ実測値を 3 段で見る defense-in-depth) として置いている。

**lite-3 の産出物 (実在検査の対象・完全形)** — 責務の正本は `docs/interface-contracts.md` § screens-lite の lite-3 出力:

- `screens/_shared/root-variables.css` / `common-styles.css` / `components.html` / **`components.css`**
- **`icons-manifest.json`** (app ルート直下。非 pictogram でも stub を書くので**常に**対象)
- `icons/*.svg` — **`illustration_policy == "pictogram"` のときのみ**対象 (policy の解決順は lite-3 の手順 1 を参照)

### lite-0: 前提検査 — tokens.json の TBD 残存

基線の材料に未確定値を残さない (基線印は「機能追加に進める土台が揃った」印であり、下流の delta が読む token が TBD では成立しない)。

> **本検査の位置づけ**: 正規経路では reverse → Phase 2 (`/ayatori-design`) → Phase 3 の順に流れ (preamble 手順 4 が `step13_approved_at` を要求する)、Phase 2 の Step 13 承認までに TBD は解消済みのはず。本検査はそれを前提に置いた上での **手動 stub 運用 (Standalone Phase 実行 — `CLAUDE.md` § Standalone Phase 実行) の安全網**。挙動 (検査 → 停止 → 誘導) は stub 運用でも正規経路でも同一。

`artifacts/{app_name}/tokens.json` を機械検査する:

```bash
grep -c '"\$value"[[:space:]]*:[[:space:]]*"TBD"' artifacts/{app_name}/tokens.json
```

- **0 件** (grep は非マッチ時 exit 1 + `0` を返す — これはエラーではない) → lite-1 へ
- **1 件以上** → 次を表示して**本 phase を終了する** (材料不足のまま先へ進めない):

  ```
  ⚠️ tokens.json に未確定値 (TBD) が {N} 件残っています。
     基線には確定した token が必要です。先に `/ayatori-design` を実行・承認してから
     `/ayatori-screens` を再実行し、Route A (基線確立) を選び直してください。
  ```

### lite-1: 材料の確認と補完 (14-lite)

`skills/14-screen-list-transition/SKILL.md` を Read し、**`## 14-lite (screens-lite 基線確立ルート)` 節のみ**を実行する (通常手順 Step 1〜5 は実行しない — 画面一覧・遷移図はリバース産のものが正)。14-lite の内訳は `.mmd` の検証 / 不在なら決定論 script による salvage → `00-transition-map.html` 派生 → `00-screen-nav.json` + `00-coverage-check.json` + L5 connectivity → 共通部品 (chrome) プラン → 完了サマリ。

- 14-lite が**中断**した場合 (`.mmd` も `requirements/03-user-flow.md` も無い = 基線として引き渡す遷移図が作れない) は、その警告行をそのまま表示して**本 phase を終了する**。14-lite 節の明示規約どおり fail-open にせず止め、要件側に user flow を用意する経路 (`/ayatori-req-delta`) を案内する
- 14-lite が返した summary (遷移図の nodes / edges、**解釈できなかった行 `unparsed_line` の件数**、L5 defects 件数、補った派生物の一覧) を控えて lite-2 の提示に使う。`unparsed_line` が 1 件以上なら **件数と当該行を lite-2 のゲート提示に必ず含める** — 未対応の Mermaid 記法で元図の遷移が欠けても script は exit 0 で進むため、人間が欠落に気づける最後の機会が Step 16 ゲートになる
- **警告の取得元は `screens/00-transition-map.derive-summary.json` (sidecar)** — 正規経路 (reverse Step 06 の E6 が `.mmd` を生成済み) では 14-lite は「既存 `.mmd` をそのまま使う」分岐に入り、**その run では script を起動しないので stdout の summary が存在しない**。sidecar は `.mmd` を生成した run が書き残したものなので、salvage の有無に関係なく読める。読み方:
  - sidecar あり かつ `mmd_md5` が現行 `.mmd` の md5 と一致 → `summary.warnings[]` をそのまま提示に使う
  - sidecar あり かつ md5 不一致 → 同じく提示に使うが「(生成時点の情報 — `.mmd` はその後手修正済み)」を添える
  - sidecar 不在 (旧 run 由来 / 手作りの `.mmd`) → 「遷移図の生成時 warnings: 不明 (sidecar 未生成)」と提示する。**推測で「0 件」と書かない**

### lite-2: Step 16 人間ゲート (画面一覧・遷移図の承認)

`skills/16-design-doc-human-review/SKILL.md` を **既存のまま** Read して実行する (lite 専用の分岐を skill 側に作らない — レビュー対象は forward と同じ「画面一覧 + 遷移図 + chrome 割り当て」)。

> **承認肢の説明文は orchestrator が差し替える**: skill 16 の表示文は「承認 → 15 で Confluence 保存 → 17 で全画面 HTML 生成」と予告するが、Route A はどちらも行わない。**そのまま出すと人間に嘘の予告をする**ため、承認肢の説明は次に差し替えて提示する (skill 側の本文は書き換えない = 既存のまま Read する方針を保つ):
> - ✅ 承認 → 共通部品の正典を生成し、ベースライン承認ゲートへ進みます (Confluence 保存・画面 HTML 生成は行いません)
> - ✏️ 修正 → 画面一覧 / 遷移図を直して lite-1 からやり直します
> - ↩️ やり直し (13 へ戻る) → Phase 2 (`/ayatori-design`) に差し戻します

**提示にブロックを追加する (screens-lite 固有。L5 は常に / 取りこぼしは該当時のみ = 最大 2 ブロック)**:

まず `artifacts/{app_name}/screens/00-coverage-check.json` の `coverage_check.layers.l5_connectivity.defects[]` を **件数だけでなく defect の中身まで**列挙して添える:

```
【L5 connectivity defects: {connectivity_defects} 件】— 未配線画面の「修正 or 容認」はここで判断してください
- {defect の種別}: {対象ノード / エッジ}   ← 全件列挙する (多い場合は種別ごとにまとめる)

> リバース産の遷移図はノードラベルの語彙が画面一覧と揃わないため孤児が多め (実測で 20 件超) になります。
> これは異常ではなく本ゲートの作業リストです。直すなら `screens/00-transition-map.mmd` (SSoT) を修正し、
> 容認するならそのまま承認してください。L1〜L4 の早期チェックは本経路では未実施
> (`user_accepted_gaps: true` の意味) で、Step 19 / 21 の安全網に委ねます。
```

**さらに「元図にあった遷移が出力から消えた」系の warning が 1 件以上あれば、次のブロックも提示に含める** (lite-1 が sidecar から控えた件数。対象は `unparsed_line` [記法を解釈できず statement ごと落ちた] / `folded_self_loop` [菱形の畳み込みが作った自己ループを drop] / `merged_self_loop` [同名マージが作った自己ループを drop] の 3 型。0 件なら省略する):

```
【遷移図の取りこぼし: unparsed_line {N} 件 / folded_self_loop {N} 件 / merged_self_loop {N} 件】
— 遷移図が元図より欠けている可能性があります
- unparsed_line: {block}:{line}  {原文をそのまま}   ← 全件列挙する
- folded_self_loop / merged_self_loop: {screen}  {dropped_label}   ← 全件列挙する

> `unparsed_line` は `requirements/03-user-flow.md` の当該行を決定論 script
> (`scripts/derive-transition-map.mjs`) が解釈できず、遷移図に**取り込まれていない**もの (未対応の
> Mermaid 記法など)。`folded_self_loop` / `merged_self_loop` は、菱形の畳み込み / 同名マージが
> **同一画面へ戻るエッジに畳んだ結果 drop した**もの (「削除 → 確認 → いいえ → 元の画面」のような往復)。
> いずれも承認するとこの欠けたまま基線になります。直すならソース側
> (`requirements/03-user-flow.md`) を書き換えてから `screens/00-transition-map.mmd` を削除して
> lite-1 からやり直してください (**`.mmd` を直接手修正した場合、これらの件数は生成時点のまま残ります** —
> 派生 summary は `.mmd` を再生成したときにしか更新されないため、解消できたかは人間の確認によります)。
```

- **承認** → skill 16 が `approvals.step16_approved_at` を記録する。その後 **Step 15 / Step 17 へは進まず lite-3 へ進む** (skill 16 の「承認後の処理」に書かれた 15 → 17 の遷移は Route B / forward 用。Route A では orchestrator が遷移先を上書きする)
- **修正** → skill 16 の修正フロー (`feedback-log.md` に Pattern A 追記 + `skills/00-feedback-protocol/SKILL.md` の 4 ステップ) に従って `.mmd` / `00-screen-list.md` を直したあと、**lite-1 からやり直す**。派生 `00-transition-map.html` は 14-lite が「不在なら生成」する契約のため、**再生成させたい場合は先に削除する** (`.mmd` 自体は既存優先で再生成されない = 人間の手修正が保護される)
- **やり直し (13 へ戻る)** → skill 16 の記述どおり Phase 2 (`/ayatori-design`) に差し戻す (Route A を抜ける)

### lite-3: 共通部品の正典生成 (`_shared` のみ)

`skills/17-screen-gen/SKILL.md` を Read し、**「全画面生成前に 1 回だけ」の共有リソース生成のみ**を実行する。画面 HTML (`screens/{platform}/*.html`) と画面仕様書の新規生成は**行わない**。実行するのは次の 3 つ:

1. **アイコン一括取得** — `skills/17-screen-gen/SKILL.md` § `Step 0: アイコン一括取得（全画面 HTML 生成の前に 1 回だけ実行）` (`icons-manifest.json` を生成。`pictogram` ポリシーのみ `icons/*.svg` も生成)。chrome フラグメントが実 SVG を埋め込むため **下記 3. の前提**
   - **override (Route A のみ) — illustration_policy の解決順**: Step 0 冒頭のゲート判定は次の順で値を取り、同じ 3 分岐に入る:
     1. `artifacts/{app_name}/design-brief.yaml` が **実在すれば** その `common.ui_constraints.illustration_policy` が正 — Step 08 で人間が confirm した (A) CONFIRMED 値であり、`requirements.json` で**上書きしない** (正規経路では Phase 2 完走済みなのでこちらに入る)
     2. `design-brief.yaml` が **不在のときのみ** (= 手動 stub の Standalone 運用) `artifacts/{app_name}/requirements.json` の `design_output_scope.illustration_policy` へ fallback する (Phase 0b の Step 06 が必ず書くキー)
     3. 両方欠落時のみ safe default `pictogram`
   - **override (Route A のみ)**: Step 0 手順 1 の洗い出しは **`00-screen-list.md` の「## 共通部品定義（chrome）」節が要求するアイコンのみ**に限定し、**全画面仕様書からの洗い出しは行わない** — リバース産の画面仕様書はアイコンを散文で記述しライブラリ名を持たないため、全洗い出しをするとライブラリ名・アイコン名を AI が発明することになる (Operating Principle 4 違反)。画面 HTML 用アイコンは Route B / delta の生成時にその step が取得する
2. **共有 CSS** — 本 phase § `Step 17` の **Phase A 手順 3 / 4** と同一: `tokens.json` から `:root` CSS 変数ブロックを生成して `screens/_shared/root-variables.css` に保存し、共通の状態切替 / フォーカスリング / `prefers-reduced-motion` CSS を `screens/_shared/common-styles.css` に保存する
3. **共通部品 (chrome) 正典** — `skills/17-screen-gen/SKILL.md` § `Step 0b-1: 正典ストアを生成（全画面 HTML 生成の前に 1 回だけ）` (`_shared/components.html` + `_shared/components.css`)。入力は lite-1 が確定した `00-screen-list.md` の「## 共通部品定義（chrome）」節 + chrome 割り当て列

> **実行しないもの**: Step 0b-2 (各画面への逐語ペースト) / Step 0b-3 (chrome 一貫性 self-check) / root-variables inline copy self-check / 色 lint (`lint-screen-colors.mjs`) / フレーム lint (`lint-screen-frame.mjs`) — いずれも**画面 HTML を対象とする検査**であり、lite ルートには対象ファイルが無い。Step 0c (イラスト正典) も画面 HTML 内で使うものなので実行しない。
> **正典を基線に含める理由**: `/ayatori-delta` の部分再生成 (Step 29) と Route B のフル実行はいずれも `_shared/root-variables.css` を入力として画面 HTML を展開する。基線側で 1 度だけ確定させておくことで、後続がどの経路から入っても同じ正典から展開される。

### lite-4: ベースライン承認ゲート (人間) — `baseline_approved_at` の正規 writer

本工程が `approvals.baseline_approved_at` + `baseline_approved_via` の **正規 writer** であり、**reverse 経路 (Route A) にしか存在しない**。押印すると `/ayatori-add-feature` (Phase 1d) / `/ayatori-delta` (Phase 5) / `/ayatori-delta-mini` (Phase 6) の Entry Guard が開く (判定式の SoT = `CLAUDE.md` § 完走後 Phase 共通 Entry Guard。Phase 4 retro は対象外)。

#### lite-4a: 材料の機械検査 (実在検査 → 表で提示)

`ls` で **実在** を確認する (state キーの有無や生成ログから推測しない)。repo root から実行するため、パスは必ず `artifacts/{app_name}/` prefix を付ける。**`ls` はディレクトリ / ファイル不在で非ゼロ終了 + stderr を出すが、それは「0 件」を意味するだけでエラーではない** (lite-0 の `grep -c` と同じ扱い):

```bash
ls artifacts/{app_name}/requirements/*.md
ls artifacts/{app_name}/screens/00-screen-list.md artifacts/{app_name}/tokens.json
ls artifacts/{app_name}/screens/*.md
ls artifacts/{app_name}/screens/00-transition-map.mmd artifacts/{app_name}/screens/00-transition-map.html
ls artifacts/{app_name}/screens/00-screen-nav.json artifacts/{app_name}/screens/00-coverage-check.json
ls artifacts/{app_name}/screens/_shared/root-variables.css artifacts/{app_name}/screens/_shared/common-styles.css artifacts/{app_name}/screens/_shared/components.html artifacts/{app_name}/screens/_shared/components.css
ls artifacts/{app_name}/icons-manifest.json
ls artifacts/{app_name}/icons/*.svg   # illustration_policy == "pictogram" のときのみ検査対象
ls artifacts/{app_name}/screens/web/*.html artifacts/{app_name}/screens/web-sm/*.html artifacts/{app_name}/screens/mobile/*.html
ls artifacts/{app_name}/screens/00-transition-map.derive-summary.json
grep -c '"\$value"[[:space:]]*:[[:space:]]*"TBD"' artifacts/{app_name}/tokens.json
```

画面仕様書の件数は `screens/*.md` から `00-` 始まりのファイル (画面一覧等) を除いて数える。結果を表で提示する (欠けている行も **❌ で必ず残す** — 隠さない):

| 材料 | 期待 | 実測 | 判定 |
|---|---|---|---|
| 要件ドキュメント | `requirements/01〜08.md` 8 本 | {N} 本 | ✅ / ❌ |
| 画面一覧 | `screens/00-screen-list.md` | 有 / 無 | ✅ / ❌ |
| 画面仕様書 | `screens/*.md` (`00-` 系を除く) | {N} 件 | ✅ / ❌ (0 件は ❌) |
| 遷移図 SSoT + 派生 HTML | `screens/00-transition-map.mmd` + `.html` | {2 件中 N 件} | ✅ / ❌ |
| 遷移の派生ビュー | `screens/00-screen-nav.json` | 有 / 無 | ✅ / ❌ |
| 網羅性チェック | `screens/00-coverage-check.json` | 有 / 無 | ✅ / ❌ |
| 共通部品の正典 | `screens/_shared/` の 4 件 (`root-variables.css` / `common-styles.css` / `components.html` / `components.css`) | {4 件中 N 件} | ✅ / ❌ |
| アイコン正典 | `icons-manifest.json` (常に) + `icons/*.svg` (`illustration_policy == "pictogram"` のときのみ) | 有 / 無 (+ SVG {N} 件) | ✅ / ❌ |
| 画面 HTML | `screens/{web,web-sm,mobile}/*.html` 0 枚 (Route A は生成しない) | {N} 枚 (実測) | ✅ (0 枚) / ❌ |
| デザイントークン | `tokens.json` (TBD 0 件) | TBD {N} 件 (押印直前に再検査) | ✅ (0 件) / ❌ |

- **画面 HTML と TBD は「lite-0 / resume で見たから」ではなく押印直前に実測する** (上記 `ls` / `grep` の結果をそのまま書く)。lite-0 の検査からゲート到達までに `/ayatori-design` や手編集が挟まる余地があるため、押印の根拠は押印時点の実測に置く
- **TBD が 1 件以上なら押印に進まず**、lite-0 の誘導文 (「⚠️ tokens.json に未確定値 (TBD) が {N} 件残っています。…`/ayatori-design` を実行・承認してから…Route A を選び直してください」) をそのまま表示して**本 phase を終了する**
- **画面 HTML が 1 枚以上なら押印に進まず**、「lite resume 判定」最終 rung の誘導文 (「⚠️ このプロジェクトには画面 HTML が {N} 枚あります — Route B (フル実行) が進行中です。…」) をそのまま表示して**本 phase を終了する** — 上位 rung (lite-0 / lite-3 から再開する経路) は HTML 枚数を見ないため、ここが最後の防波堤になる (実測値は表にもそのまま残す)
- **`00-screen-nav.json` が不在なら押印に進まず**、次を表示して**本 phase を終了する** — nav の派生は `.mmd` の strict parse に成功したときだけファイルを書くので、**不在 = 「`.mmd` が下流パーサの受け付ける形になっていない」または「派生工程が走っていない」**のどちらかであり、いずれも基線材料が欠けている。Step 28 (delta の影響分析) は `.mmd` を必須入力として直接読むため、壊れた SSoT で基線を通すと変更時に初めて破綻する。
  > **判定材料を nav の実在 1 本に絞る理由**: 「L5 検査が走ったか」は artifact から判定できない — `00-coverage-check.json` は reverse Step 06 / 14-lite が **validator 実行前に無条件で stub (`l5_connectivity: {defects: []}`) を書く**設計で、schema にも実行痕跡を表す field が無い。したがって「coverage-check の L5 結果が不在」という条件は正規経路では成立せず、それを AND に入れると本ハードストップ自体が発火しない (セルフレビューで検出)。nav と L5 は同じ `parseTransitionMap` を通るため、**nav が書けていない run では L5 も書けていない**と判定して差し支えない:
  ```
  ⚠️ 遷移図 (`screens/00-transition-map.mmd`) から派生ビューを 1 つも生成できていません
     (`.mmd` の記法が下流パーサの受け付ける形になっていない可能性)。
     `.mmd` を手修正するか削除して `/ayatori-screens` を再実行し、lite-1 で作り直してください。
  ```

表の下に 3 行添える:

- `L5 connectivity defects: {connectivity_defects} 件` (`00-coverage-check.json` の `coverage_check.summary.connectivity_defects` より。0 件でなくても異常ではない — lite-2 で人間が確認済みの作業リスト)。**L5 検査自体が走っていない場合 (validator が exit 2 だった run) は `0 件` と書かず `不明 (L5 検査未実行)` と書く** — reverse 経路の `00-coverage-check.json` は Step 06 が stub を書くので、ファイルの存在だけでは検査の実施を証明できない
- `L1〜L4 の早期チェックは本経路では未実施 (user_accepted_gaps: true)。Step 19 / 21 の安全網に委ねる`
- `遷移図の生成時 warnings: {sidecar の summary.warnings 件数と type 別内訳}` (`screens/00-transition-map.derive-summary.json` より。**特に `unparsed_line` が 1 件以上なら件数を明示する** = 元図から欠けた遷移がある信号)。sidecar の `mmd_md5` が現行 `.mmd` の md5 と一致しない場合は「(生成時点の情報 — `.mmd` はその後手修正済み)」を添える。sidecar 不在なら `不明 (sidecar 未生成の run)` と書く (推測で補わない)

❌ が 1 つ以上あっても**ゲート自体は出す** (承認するかは人間が決める)。ただし承認肢の説明に「未整備の材料あり」を明示し、差し戻し先 (遷移図系 → lite-1 / `_shared` / アイコン正典 → lite-3) を併記する。**上記 3 つのハードストップ (TBD 残存 / 画面 HTML 1 枚以上 / 派生 2 種の全滅) はこの「❌ でもゲートを出す」の例外** — 人間の判断に委ねず終了する (いずれも押印すると下流が壊れた前提を「承認済み」として読むため)。

#### lite-4b: 成果物 preview の提示 → 人間ゲート (AskUserQuestion)

**preview (他の人間ゲートと同じ様式)**: AskUserQuestion の前に `skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。`step_id = "screens-lite-baseline-gate"` (`pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets` のキー。値は `index.html` = 基線材料を 1 画面で確認できる index が auto-open される)。

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}

artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/index.html",                     label: "成果物インデックス (基線材料をこの 1 画面で確認)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/00-transition-map.html", label: "遷移図 HTML (派生、L5 defects の確認用)" },
]
```

> **index 再生成が 2 回走るのは意図どおり**: helper の Step 2.5 (`refresh_index`) がこの preview 時点で `index.html` を再生成する (= 押印**前**の材料確認用)。lite-4c 手順 6 でもう一度再生成するのは、**index のタイムラインに承認印を載せる**ため (押印後でなければ拾えない)。
> **重複の統合**: helper の Step 2.5 は `artifacts_to_review` の先頭に index を自動追加するため、上記 1 行目と同じ path が 2 行になる場合は **1 行に統合して提示する** (同じファイルを二重に並べない)。
> auto-open / link 一覧の失敗は helper の既定どおり fail-open (link-only へ degrade) で、ゲート自体は止めない。

続けて人間ゲートを提示する。`header: "ベースライン承認"`、単一選択:

- **承認する** — 上記材料でベースライン (完走相当) として確定し、`/ayatori-add-feature` / `/ayatori-delta` / `/ayatori-delta-mini` を開く
- **差し戻す** — 何も記録せず、指摘に応じた工程に戻る

**差し戻しの場合は `pipeline-state.json` を一切書かない**。指摘内容を `artifacts/{app_name}/feedback-log.md` に Pattern A として追記し、戻り先を案内して phase を終える:

- 遷移図 / 画面一覧 / L5 の指摘 → `.mmd` / `00-screen-list.md` を修正して **lite-1 から** (派生 `00-transition-map.html` を再生成させたい場合は先に削除する)
- `_shared` 正典 (chrome / CSS 変数) の指摘 → **lite-3 から**
- token の指摘 → `/ayatori-design` (Phase 2) へ
- 要件そのものの指摘 → `/ayatori-req-delta` (Phase 1c) へ

#### lite-4c: 承認時の押印 (由来 assert → 冪等 → 2 キー同時)

1. **由来 assert (defense-in-depth)**: `artifacts/{app_name}/requirements.json` の `status == "REVERSE_ENGINEERED"` を確認する。不一致なら**押印せず**「⚠️ 本ゲートは reverse 経路専用です (`requirements.json.status != "REVERSE_ENGINEERED"`)。ベースライン印は押しません」と表示して終了する。本ゲートは Route A (reverse 限定) にしか存在しないため通常は到達しないが、**印の意味 (reverse 基線) を writer 側でも守る**
2. Read `artifacts/{app_name}/pipeline-state.json` (不在なら init stub `{ "app_name": "{app_name}" }`)。`approvals.baseline_approved_at` が**既 set なら両キーとも触らず** lite-5 へ (冪等 — 過去の押印を上書きしない)
3. 未 set なら次の **2 キーを両方同時に**書く (片方だけの書き込みは禁止):
   - `approvals.baseline_approved_at` = 現在時刻 (ISO 8601。Bash で `date` を実行して取得する — 推測で組み立てない)
   - `approvals.baseline_approved_via` = `"screens-lite-gate"`
4. Write back は **既存キーを保全する merge** で行う (`app_name` / `confluence.*` / `approvals` の他キー / `screens.*` 等を落とさない)。Write 直前に `app_name` の存在・非空を assert する
5. **`approvals.final_approved` は立てない** — 画面レビューを実施していないため。基線印は別キーとして Phase 1d / 5 / 6 の扉だけを開ける (`final_approved` の「画面レビュー承認済み」の意味を壊さない = 二段階完了モデル)
6. **成果物インデックスの再生成** (fail-open — 失敗しても完了を止めない。押印より**後**に実行して index のタイムラインが押印を拾えるようにする):

   ```bash
   node scripts/build-artifact-index.mjs artifacts/{app_name}
   ```

### lite-5: 完了表示 (Route A の終端)

`session-handoff.md` は**書かない** — Route A は Phase 3 の完了ではないため、`phase_completed: "3-screens"` を書くと表示上「画面レビュー済み」と誤読される (state SoT は `pipeline-state.json` のみ。表示は index.html が担う)。

`pwd` (Bash) で `{repo_root}` を取得し、次を表示して phase を終える:

```
✅ ベースラインを確立しました — {app_name}

  {新規押印: 「ベースライン承認印を記録しました (approvals.baseline_approved_at / 由来: screens-lite-gate)」}
  {既 set:   「押印済みのベースライン承認印を確認しました (既存値を維持)」}
  画面 HTML は未生成です (approvals.final_approved は立てていません — 画面レビュー未実施)。
  遷移図: nodes {nodes} / edges {edges} · L5 connectivity defects {connectivity_defects} 件
  {unparsed_line が 1 件以上のときだけ: ⚠️ 遷移図の取りこぼし (unparsed_line): {N} 件 — 元図の遷移が欠けたまま基線になりました (該当行は lite-2 で提示済み)}
  📦 全成果物インデックス: artifacts/{app_name}/index.html

  次のステップ (新しい会話で):
  - 機能追加をヒアリングする → /ayatori-add-feature をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
  - 変更を反映する (機能追加 / 要件変更を起点) → /ayatori-delta をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
  - 要件ドキュメントを手直しする → /ayatori-req-delta をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
  - 画面 HTML まで作る → /ayatori-screens を再実行して「フル実行」を選ぶ
```

> 遷移図の 2 行 (nodes / edges / L5 defects と `unparsed_line`) は **lite-1 を本セッションで通った場合のみ**出す (14-lite が返した summary が手元にあるとき)。`baseline_approved_at` 既 set で lite-5 へ直行した resume では 14-lite を走らせていないため、値を再導出せず両行とも省略する (`unparsed_line` は 0 件のときも行ごと省略する)。

---

## Figma MCP Flag

> **Mode 判定は `skills/00-figma-mode-detect/SKILL.md` で一元化されている。** ここでは結果のみを参照し、独自の env var チェックは行わない。

Read and execute `skills/00-figma-mode-detect/SKILL.md` to resolve `mode` ("enabled" or "disabled"). The skill checks the OS env var `FIGMA_MCP_ENABLED` via Bash (推測禁止). Any value other than `true` resolves to `disabled`; the unset case emits an explicit warn message guiding the user to set the env var.

- `mode == "enabled"`: Steps 17 (Figma capture preparation), 18 (Vision-based review), 22 (Figma export), 24 (design system update), 25 (component build) use Figma MCP.
- `mode == "disabled"`: They operate as MD/HTML stubs or skip. 具体的には:
  - Step 17 / 18: MD/HTML スタブ実装を実行 (各 skill 参照)
  - Step 22: Figma 出力を skip、`pipeline-state.json` に `screens.step22_figma_status = "skipped_stub_mode"` を記録して Step 23 へ (`figma-state.json` は作成・更新しない)
  - Step 24 / 25: 各 skill 冒頭の mode 判定スタブ手順が `pipeline-state.json` に `screens.step24_figma_status` / `screens.step25_figma_status = "skipped_stub_mode"` + `step24_completed_at` / `step25_completed_at` を記録して次 step へ進む (Figma 構築 / バインドは実行しない)
  - Step 25e: 完全 skip、`screens.step25e.figma_status = "skipped_stub_mode"` を記録

  disabled 経路でも `step24_completed_at` / `step25_completed_at` が上記スタブ手順で立つため、上記 resume 規則 (手順 8) はスタックせず Step 25a に到達できる。

## Execution

> 本節は **Route B (フル実行) / forward プロジェクト用**。Route A (screens-lite) は `## Execution — screens-lite (Route A: 基線確立)` 節で完結し、本節には入らない。

Execute Steps in the following order:

### Step 14: Screen List + Transition Map
Read and execute `skills/14-screen-list-transition/SKILL.md`.

### Step 16: Human Review — Design Docs (Gate)
Read and execute `skills/16-design-doc-human-review/SKILL.md`.
At this point the human reviews local `screens/00-screen-list.md` / `00-transition-map.html` (no Confluence pages yet — we publish only what's approved).
On approval → Step 15 (1st Confluence save) → Step 17. On modification → back to Step 14.

### Step 15: Confluence Save — Design Docs (1st run)
Read and execute `skills/15-confluence-save-design/SKILL.md`.
Runs **after** the design-doc human gate (Step 16) so only approved documents are published externally.
At this point only pre-screen documents exist (design-brief, style-guide, screen-list, transition-map). Individual `screens/*.md` specs do not yet exist and are skipped by glob.

### Step 17: Full-Screen HTML Generation (main / default のみ)

> **実行戦略**: 推定 HTML 総ファイル数に応じて直接実行またはサブエージェント並列実行を選択する。
> 本 step は **main (default) HTML のみ** を生成する。empty / loading / error / 追加状態の HTML は Step 25b (state-pattern-gen) で追加生成される。

**閾値の計算方法:**

閾値判定は **プラットフォーム込みの総 HTML ファイル数** で行う (状態軸は default 固定のため掛けない)。

```
total_html_files = 画面数 × platform dirs 数 [ × 2 if dual_theme_mode=true ]

例1: 3画面 × Web のみ                  = 3 files  → 直接実行
例2: 5画面 × Web+Mobile                = 10 files → 直接実行
例3: 11画面 × Web+Mobile               = 22 files → 並列実行 (>20)
例4: 11画面 × Web+Mobile × dual        = 44 files → 並列実行
例5: 11画面 × Web+WebSM+Mobile         = 33 files → 並列実行
```

- **状態数**: 1 固定 (default のみ)。empty / loading / error 等は Step 25b に移管
- **platform dirs 数**: `platform_combo` + `web_viewports`（欠落時 `["desktop"]`）を `skills/17-screen-gen/SKILL.md` の展開規則（固定順 `["web", "web-sm", "mobile"]`）で platform dirs に展開した個数（1〜3）。旧「`mobile_and_web` なら 2、それ以外は 1」は `web_viewports ∋ sm` のとき成り立たない
- **テーマ数**: `dual_theme_mode` が `true` なら 2 (light + dark)、それ以外は 1

#### 総 HTML ファイル数が 20 以下の場合 — 直接実行

Read and execute `skills/17-screen-gen/SKILL.md` をそのまま実行する（バッチ不要）。

#### 総 HTML ファイル数が 21 以上の場合 — サブエージェント並列実行

コンテキスト枯渇を防ぐため、画面ごとにサブエージェントを起動して並列生成する。

**Phase A: 共有リソース準備（メインコンテキストで 1 回だけ実行）**

1. `skills/17-screen-gen/SKILL.md` を Read してルールを把握する
2. Step 0（アイコン一括取得）を実行する — `icons-manifest.json` を生成（`pictogram` ポリシーのみ `icons/*.svg` も生成。非 pictogram はマニフェスト stub のみ）
3. `tokens.json` から `:root` CSS 変数ブロックを生成し `artifacts/{app_name}/screens/_shared/root-variables.css` に保存する
4. 共通の状態切替 CSS / フォーカスリング CSS / prefers-reduced-motion CSS を `_shared/common-styles.css` に保存する
5. ループ再実行時（`scores.json` の `attempt_count > 0`）は `scores.json` の AI改善可能タグも抽出し `_shared/fix-instructions.md` に保存する

**Phase B: サブエージェントで HTML 生成 → メインコンテキストで Write**

> **設計原則: Write 権限はメインコンテキストに集中する**
> サブエージェントは HTML 文字列を生成して return するだけ。ファイル書き込み（Write）はメインコンテキストが行う。
> これによりサブエージェントの Write 権限問題を回避する。

`screens/00-screen-list.md` の各画面について、以下の 2 ステップを繰り返す:

**Step B-1: サブエージェントに HTML を生成させる（並列可）**

独立した画面同士は並列（同一メッセージ内で複数 Agent 呼び出し）で実行してよい。
ただしサブエージェントの return サイズ上限を考慮し、**1 Agent あたり 1 画面の 1 ファイル** を生成させる。

> ⚠ **アイコン指示の差し替え（Phase B 開始前に 1 回確認）**: Phase A Step 0 で生成した `artifacts/{app_name}/icons-manifest.json` の `library` フィールドを Read し、以下の表に従い各サブエージェントプロンプトのアイコン関連 2 行を差し替える:
>
> | `library` 値 | Read 行の差し替え | 厳守ルール行の差し替え |
> |---|---|---|
> | `heroicons` 等（`pictogram`） | `artifacts/{app_name}/icons/*.svg`（必要なアイコンのみ Read） | アイコンは `icons/` から Read した SVG パスを使う。WebFetch 禁止。空状態/オンボーディング/エラー等の中央ビジュアルは `icons/` の単一アイコンを拡大表示（中央寄せ）。独自シーンイラストは手描きしない。データ駆動グラフィック（チャート/盤面等）のみインライン SVG |
> | `illustration_character` | （この行を削除 — `icons/` は存在しない） | アイコン位置は `<div class="illust-placeholder" data-scene="{scene_name}" style="width:100%;min-height:var(--sp-2xl,160px);display:flex;align-items:center;justify-content:center;border:1px dashed var(--color-on-surface-variant);border-radius:var(--radius-md,8px);color:var(--color-on-surface-variant);font-size:14px;"></div>` で実装（色は var 参照のみ・fallback リテラル禁止 = zero-literal）。`icons/` は存在しないため Read しない |
> | `emoji_casual` | （この行を削除 — `icons/` は存在しない） | アイコン位置は Unicode 絵文字を直接使用。`icons/` は存在しないため Read しない |

```
Agent({
  description: "Generate {画面名} default HTML",
  prompt: "あなたはプロダクトデザインのシニアUIデザイナーです。
画面「{画面名}」の Web版デフォルト状態 HTML を生成してください。

**最初に以下を Read してルールを把握:**
- skills/17-screen-gen/SKILL.md
- artifacts/{app_name}/screens/_shared/root-variables.css
- artifacts/{app_name}/screens/_shared/common-styles.css
- artifacts/{app_name}/screens/{画面名}.md（存在する場合）
- artifacts/{app_name}/icons/*.svg（必要なアイコンのみ Read）  ← pictogram のみ。非 pictogram は上記差し替え表に従い削除
- artifacts/{app_name}/tokens.json

**出力:**
HTML 全文を 1 つのコードブロック（```html ... ```）で返すこと。
ファイルには書き込まない（Write / Edit は使わない）。

**厳守ルール:**
- :root 変数は _shared/root-variables.css からそのままコピー。変数名を変更しない
- アイコンは icons/ から Read した SVG パスを使う。WebFetch 禁止  ← pictogram のみ。非 pictogram は上記差し替え表に従い置換
- 空状態/オンボーディング/エラー/装飾の中央ビジュアルは `icons/` の単一アイコンを拡大表示（中央寄せ・`aria-hidden="true"`）。人物・動物・乗り物・自然等の独自シーンイラストは手描きしない（CSS div でも表現しない）。データ駆動グラフィック（チャート/盤面/地図/波形）のみインライン SVG（`<svg>` + `<path>` 等）で実装する  ← pictogram のみ。非 pictogram は上記差し替え表に従い置換
- UI 要素（ボタン・カード・入力欄）は SVG 化しない
- 全テキストは日本語
- body サイズ: width: 1440px; min-height: 900px;"
})
```

同じ画面の各 platform dir / テーマについてもそれぞれ Agent を起動する（出力は platform 別フォルダに分離、default 状態のみ。対象 dirs は上記「platform dirs 数」の展開結果に従う）:
- `screens/web/{画面名}.html` — Web デスクトップ デフォルト（Figma キャプチャスクリプト付き、1440×900）※ `web_viewports ∋ desktop`（欠落時 desktop 扱い）
- `screens/web-sm/{画面名}.html` — Web スマホ幅 デフォルト（390×844 固定 `.screen` ラッパー、ブラウザページ体裁 = フォンフレーム装飾 / BottomTab なし）※ `web_viewports ∋ sm`。Agent プロンプトの「body サイズ」行を「`.screen` サイズ: width: 390px; min-height: 844px;（body は全幅グレー背景ラッパー。詳細は skills/17-screen-gen/SKILL.md § Web スマホ幅画面のプレビュー構造）」に差し替える
- `screens/mobile/{画面名}.html` — モバイル（390×844、BottomTab + フォンフレーム）※ 同様に「body サイズ」行を mobile プレビュー構造（`.screen` 390×844 + border-radius 40px）に差し替える
- dual_theme_mode=true の場合: 上記に `--light` / `--dark` suffix を付けた 2 枚ずつ
- **sub-state HTML (`--empty` / `--loading` / `--error` / 追加状態) は本 step では生成しない** — Step 25b で追加生成される

> **並列度の目安**: 1 回のメッセージで同時に起動する Agent は **最大 4〜5** に抑える。
> これを超えるとメインコンテキストの return 受信でメモリが逼迫する。
> 例: 11 画面 × 2 platform × 2 theme = 44 ファイル → 5 Agent ずつ 9 バッチに分けて実行。

**Step B-2: メインコンテキストが Write する**

各 Agent の return（HTML コードブロック）を受け取ったら、メインコンテキストが即座に Write ツールで保存する:

```
Write({
  file_path: "artifacts/{app_name}/screens/{platform}/{画面名}.html",
  content: {Agent が return した HTML 文字列}
})
```

`{platform}` は `web` / `web-sm` / `mobile` のいずれか（Agent に渡したプロンプトと一致させる）。仕様書 `.md` のみ `screens/{画面名}.md`（root）に保存する。

Agent の return が HTML コードブロックを含まない場合（エラー・空応答）は feedback-log.md に Pattern B として記録し、当該ファイルをスキップして次へ進む。

**Phase C: 検証（メインコンテキストで実行、default のみ）**

全ファイル Write 完了後:
1. 期待するファイル一覧（画面数 × platform dirs 数 [× 2 if dual_theme_mode]。platform dirs は skills/17-screen-gen の展開規則）と実際のファイルを照合し、欠損があればログ出力する。状態軸は default 固定のため掛けない (sub-state 生成は Step 25b の責務)
2. 先頭 HTML と最終 HTML の `:root` CSS 変数を Read して比較し、変数名の不一致がないか spot-check する
3. 不一致があれば `_shared/root-variables.css` の内容で該当ファイルを修正する
4. **フレーム固定幅検証（必須）**: `node scripts/lint-screen-frame.mjs --check {全生成 HTML}` を実行する。exit 1（fluid / レスポンシブ = 固定幅ラッパー欠落 or 幅 media query）の画面は skills/17-screen-gen の「HTML 固定サイズルール」に従い修正・再生成する（Figma キャプチャは viewport 幅を制御できないため、固定幅要素を欠くと Step 22 でフレーム幅がブラウザ窓幅依存になる）。解消まで Step 18 に進まない

> **WCAG Pre-flight Check (P-03)**: HTML 生成完了後、Step 18 に進む前に以下を必ず検証・修正すること:
> 1. `min-height` が 44px 未満のインタラクティブ要素（button, .segment-option 等）→ 44px に修正
> 2. `font-size` が 12px 未満のテキスト要素 → 12px に修正
> 3. 修正が必要だった場合は Pattern B として `feedback-log.md` に即記録

> **Figma Capture Script Injection (P-08)**: キャプチャスクリプト `<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>` は **Step 22 で Figma にキャプチャする全 default HTML ファイル** に注入すること (sub-state HTML へのスクリプト注入は Step 25b の責務に移管)。注入漏れがあると Step 22 の `generate_figma_design` がキャプチャできず Figma 出力が欠損する。

### Step 18: 3-Layer Design Review
Read and execute `skills/18-design-review/SKILL.md`.

### Step 19: Rubric Scoring
Read and execute `skills/19-rubric-score/SKILL.md`.

### Step 20: Loop Control
Read and execute `skills/20-loop-design/SKILL.md`.
Loop logic (thresholds from `pipeline.yaml` → `screens.loop`):
- `ai_improvable_deductions` == 0 → proceed to Step 21
- `attempt_count` >= 3 → escalation → proceed to Step 21
- Otherwise → go back to Step 17

### Step 21: Human Review — Main (default) HTML (Gate)
Read and execute `skills/21-screen-human-review/SKILL.md`.
**On approval**: mark `pipeline-state.approvals.screens_human_approved = true`, then display the handoff message (**per skill 21's branch**) and end the current session. The graphic block (21a-21g) + Steps 22-25 continue in the next session — the resume logic auto-detects `screens_human_approved = true` + `pipeline-state.confluence.design.save_count < 2` and resumes from the graphic block (Step 21a — or Step 15 (2nd Confluence save) once graphics are resolved / upstream-skipped).
> **`_train-` 例外（表示のみ・無改造維持）**: `{app_name}` が `_train-` で始まる場合、skill 21 の (b) 文面を**逐語表示**して終了する（gate21 がトレーニングの生成終了点）。**選択肢の自作・「22-25 も続けられます」等の可能性言及・`/ayatori-retro` 等への誘導は禁止** — 次の一手は `/ayatori-train` の 1 つだけ。処理・state・resume ロジックは通常と同一で変えない。
On modification → back to Step 17.

> 本ゲートでは **main (default) HTML のみ** をレビューする。sub-state (empty / loading / error 等) HTML のレビューは Step 25d (state-pattern-approval) で別ゲートとして実施される。これによりレビュー対象を絞り、人間承認体験を改善する。

> **📍 Session Split Point (S-01)**: Step 21 は Phase 3 の自然なセッション分割点。Steps 14-21 はHTML生成・レビューループで文脈を大量に消費するため、承認後は必ず新セッションを開始し、グラフィック生成ブロック 21a-21g（任意）→ Steps 22-25（Figma エクスポート → 最終承認 → デザインシステム更新 → コンポーネントビルド）を続行すること。新セッション起動後の再開位置は resume cascade（手順 8）で自動判定される。

### Step 21a: グラフィック必要性分析 (新規)
Read and execute `skills/21a-graphic-recommend/SKILL.md`.

- 入口条件は上記 resume cascade の graphics 分岐と同一: `screens_human_approved == true` AND `design_save_count < 2` AND `graphic_generation_scope != "skip"` AND `graphics.decision` NOT set AND `graphics.step21a_completed_at` NOT set。
- `graphic_generation_scope == "skip"` の場合は **本 step を含むブロック全体を実行しない** — orchestrator が skip 記録 (resume cascade の 1 行目) を書いて Step 15 (2nd) へ素通しする。
- 分析失敗・材料欠損は skill 内で fail-open degrade する (エラー停止しない)。いずれの経路でも完了後は Step 21b へ。

### Step 21b: グラフィック要否・箇所ヒアリング (Gate)
Read and execute `skills/21b-graphic-hearing/SKILL.md`.

- 21a の推奨レポート (存在すれば) を参考情報として提示し、要否 (Q1) → 箇所選択を人間ゲートで確定する。
- **「必要」確定** → `graphics/graphic-plan.json` 生成 + `screens.graphics.decision = "generate"` → Step 21c へ。
- **「不要」** → `decision = "skip"` (decided_by=step21b) → 21c-21g を skip して Step 15 (2nd Confluence save) へ。
- **「保留」** → 何も書かない (次回 `/ayatori-screens` 再実行時に resume cascade が 21b を再起動)。

### Step 21c: グラフィックテイスト 2 段階選定 (Gate)
Read and execute `skills/21c-graphic-taste/SKILL.md`.

- 21b で `decision == "generate"` が確定したプロジェクトに対し、テイストを 2 段階 (言葉選択 → サンプル A/B/C 比較) で確定する人間ゲート。確定値は `graphic-plan.json` の `taste` キー (21c のみが append — key 分離) + `screens.graphics.taste_confirmed_at`。
- **確定** → Step 21d へ。**保留** → 何も書かない (`taste_confirmed_at` 未 set = 次回 resume cascade が 21c を再起動する signal)。

### Step 21d: 箇所別プロンプト確定 (Gate)
Read and execute `skills/21d-graphic-prompts/SKILL.md`.

- 21b の slot + 21c の確定テイストを合成し、slot ごとの生成プロンプトと size_px を人間ゲートで確定する。確定値は `graphics/graphic-prompts.json` (21d が single writer) + `screens.graphics.prompts_confirmed_at`。
- **確定** → Step 21e へ。**全 slot 中止** → `decision = "skip"` (decided_by=step21d) → 21e-21g を skip して Step 15 (2nd Confluence save) へ。**保留** → 何も書かない (`prompts_confirmed_at` 未 set = 次回 resume cascade が 21d を再起動する signal)。
- 21g 差し戻し (`rework_pending`) の再確定も本 step が担う (設計 §9-2b — orchestrator が `prompts_confirmed_at` をクリアして積んだ差し戻しを、再確定 commit が原子的に消費する)。

### Step 21e: グラフィック生成 + サイズ自動調整
Read and execute `skills/21e-graphic-generate/SKILL.md`.

- 21d 確定の `graphic-prompts.json` を slot ごとに生成 API へ渡し (透過 slot は透過対応モデルへルーティング — pipeline.yaml `graphic_generation.tool_transparent`)、確定 size_px ちょうどのピクセル数に自動調整して `graphics/raw/{graphic_id}.png` に置く。人間ゲートなし — 生成内容・寸法の確認は 21d の確定確認が既に含むため再質問しない (P4-07)。
- 記録: 成功のたびに `screens.graphics.generated_files[]` を増分更新 (source_digest 付き — 設計 §9-2b の slot 単位再利用契約。digest 一致の生成済み slot は再生成しない)。pending が空になったら `screens.graphics.step21e_completed_at` を set → **Step 21f へ**。
- **生成失敗** → degrade 分岐 (設計 §8-4): **リトライ** (失敗分のみ再生成) / **slot 除外** (`excluded_slots[]` に理由付き記録) / **ブロック中止** → `decision = "skip"` (decided_by=step21e) で 21f-21g を skip し Step 15 (2nd Confluence save) へ / **保留** → 何も書かない (`step21e_completed_at` 未 set = 次回 resume cascade が 21e を再起動する signal)。全 slot 除外はブロック中止と同義に扱う。

### Step 21f: 透過検証 → 正典化 (POCTEAMA-189)
Read and execute `skills/21f-graphic-postprocess/SKILL.md`.

- 21e の生成物 `graphics/raw/{graphic_id}.png` を透過検証 (透過 slot のみ — 透過は 21e の生成段階で作られるため本 step は検証。I-3 の結論) して、raw バイト無加工で正典 `screens/_shared/graphics/{graphic_id}.png` に置く (圧縮 ⑫ は非搭載 — I-4 Skip + ユーザー判断でスコープ除外。再起票の受け皿は設計 §11)。人間ゲートなし — ローカル処理のみ (課金なし) で正常系は再質問しない (P4-07)。
- 記録: 成功のたびに `screens.graphics.generated_files[].file` を正典パスへ更新 (21g/29 の埋め込みはこの正典参照を使う)。pending が空になったら `screens.graphics.step21f_completed_at` を set → **Step 21g へ**。監査台帳は `graphics/postprocess-manifest.json` (透過検証 verdict / degrade ラベル — 21g の配置判断材料)。
- **透過検証 fail / 後処理失敗** → degrade 分岐 (設計 §8-4 と同型): **そのまま採用** (`transparency_waived[]` にラベル記録して不透明のまま正典化) / **リトライ** (当該 `generated_files[]` entry 削除 + `step21e_completed_at` クリア → 21e から再生成) / **slot 除外** (`excluded_slots[]` に理由付き記録) / **ブロック中止** → `decision = "skip"` (decided_by=step21f) で 21g を skip し Step 15 (2nd Confluence save) へ / **保留** → 何も書かない (`step21f_completed_at` 未 set = 次回 resume cascade が 21f を再起動する signal)。全 slot 除外はブロック中止と同義に扱う。

### Step 21g: グラフィック埋め込み + 承認 (Gate、POCTEAMA-190)
Read and execute `skills/21g-graphic-embed-review/SKILL.md`.

- 21f まで完了 (`step21f_completed_at` set) のプロジェクトに対し、正典グラフィック (`screens/_shared/graphics/`) を screens HTML へ `<img>` 正典相対参照 (C-26) で埋め込み、視覚レポート (`graphics/graphic-embed-review.html`) で承認を取る人間ゲート。埋め込み対象は `generated_files[]` の fresh entry − `excluded_slots[]` (設計 §9-2b の 21g/29 共通契約 — 一括タグ書き換え・src↔正典照合は skill の決定的 script、挿入位置の判断のみ LLM)。
- **承認** → `approvals.graphics_human_approved = true` + `step21g_approved_at` (skill の commit script が「使用グラフィック」節の `screens/{screen}.md` 追記と原子的に行う) → Step 15 (2nd Confluence save) へ。21g に completed_at は無い (人間ゲート step は完了 = 承認)。
- **修正指示 (差し戻し routing — orchestrator の責務、設計 §9-2b)**: 分類判別・routing 手順・state 書き込み内容の正本は skill の `refs/embed-guide.md` §5 (実体 = `scripts/route-rework.mjs`)。orchestrator 視点の契約は 2 点のみ: (a) **routing の意図を必ずディスク状態に落としてから**セッションを終了する (記録なしの「口頭 routing」は中断後に cascade が 21d を飛ばし修正指示が消失する。複数分類に跨る指示も全件記録してから終了)、(b) 差し戻し後の再開先は resume cascade が検知する — プロンプト起因 → 21d (差し戻しモード) / 生成品質起因 → 21e (当該 slot のみ再生成) / 配置起因 → 21g 内で完結 (state 書き込みなし)。差し戻しは `decision` を変更しない (`generate` のまま)。
- **per-slot 却下** (設計 §11 — F-7 で採用) → skill の reject 手順が `generated_files[]` entry 削除 + `excluded_slots[]` append (正典ファイルは孤児として保持)。**全 slot 却下** → `decision = "skip"` (decided_by=step21g) → Step 15 (2nd) へ素通し。
- **保留** → 何も書かない (`graphics_human_approved` 未 set = 次回 resume cascade が 21g を再起動する signal)。

### Step 22: Figma Export (HTML Capture — main / default のみ)

> **🔒 Mandatory subagent isolation (P-14, NEW)**: Step 22 は **常に** `figma-capture-runner` サブエージェントに委譲する。件数判定なし — 11 件でも 200 件でも同じ。理由: `mcp__figma__generate_figma_design` の verbose response (~3KB × N×2 calls) を main context から完全に切り離すため。
>
> 本 step では **`states: ["default"]` 固定** で Figma capture を行う (Q2「状態粒度」質問は廃止)。sub-state (empty / loading / error 等) の Figma 追加 capture は **Step 25e (figma-pattern-export)** で `mode: substate` 経由で追加実行される。
>
> **⏱️ Session timeout 対策 (P-15)**: 離席時の macOS スリープ → ブラウザ–`mcp.figma.com` セッション切断 → captureId TTL 超過で手動コピー必要、を防ぐ仕組みを Step 22 に組み込んでいる:
> - Pre-flight で `caffeinate -dimsu` を自動起動（macOS, `system_sleep_prevention=auto`）
> - capture retry 時に captureId 発行から `captureid_ttl_sec` (default 300s) 経過していれば自動的に再発行
> - 中断発生時は次セッションの Step 22 再実行で **Resume mode** が自動検出し、Q1 をスキップして `deferred_remaining` のみ再キャプチャ
>
> サブエージェント定義: `.claude/agents/figma-capture-runner.md`
> 詳細仕様: `skills/22-figma-export/SKILL.md` (内訳の Step 2.0a Resume / Step 2.1.5 Pre-flight / Step 2.3 stale 判定 + Subagent Isolation Mode セクション)

#### 実行手順

1. **Resume mode 判定 (P-15)** — main context で `figma-state.json.scope.status` を Read:
   - `"partial_success"` / `"in_progress"` / `"blocked"` → Resume mode。Q1 と対象ファイル列挙をスキップし、`scope.user_selected` と `scope.deferred_remaining` を採用 (Q2 は廃止のため Resume でも質問なし)。サブエージェント呼び出しの prompt に `resume: true` を含める
   - 未設定 or `"success"` → 通常フロー (下の手順 2 へ)

   **Resume 確定後、Layout 選択 Q を追加で 1 問 (P-15)**: 「完了後の grid layout で既存 {M} 件のフレーム位置を上書きする可能性があります」を AskUserQuestion で告知し、`full` / `new_only` / `skip` から選ばせる。結果を `resume_layout_mode` として agent prompt に渡し、同時に `figma-state.json.scope.resume_layout_mode` にも記録。詳細は `skills/22-figma-export/SKILL.md` Step 2.0a 手順 3 を参照。

2. **Pre-flight scope confirmation (P-10、Q1 のみ)** — main context で AskUserQuestion を提示:
   - Q1: 出力プラットフォーム (Web のみ / Mobile のみ / Mobile + Web)
   - **Q2 (状態粒度) は廃止** — `states: ["default"]` 固定。sub-state Figma 出力は Step 25e で追加実行
   - `pipeline.yaml.screens.figma_export.scope == "all_states_and_platforms"` の場合はスキップして最大スコープ (Q1=mobile_and_web、states=default) で進める

3. **対象ファイル列挙** — main context で `screens/00-screen-list.md` から画面名配列を取得し、`scope_q1 × ["default"] × screens` で `target_files` 配列を組み立てる (state suffix なし)。物理ファイルの存在を `ls` で assert。

4. **サブエージェント呼び出し** (1 回だけ):

```
Agent({
  subagent_type: "figma-capture-runner",
  description: "Step 22 Figma capture for {N} default files",
  prompt: """
mode: orchestrator
resume: {true|false}
resume_layout_mode: {"full" | "new_only" | "skip" | null}
app_name: {app_name}
file_key: {figma-state.json.file_key}
page_id: {figma-state.json.page_id}
scope_q1: {Q1 answer JSON}
scope_q2: ["default"]
target_files: {target_files JSON}   # default のみ
"""
})
```

5. **Return 受信** — サブエージェントは `< 500 char` の summary (`stale_regenerated=N` 含む) を返す。main は内容をそのままユーザーに表示し、`figma-state.json` (サブエージェントが直接 Write 済み) を Read して結果を確認後、Step 23 へ進む。`stale_regenerated` が高い場合 (>10%) は離席かスリープ抑止失敗の兆候としてユーザーに通知。

#### サブエージェントが内部で扱う詳細 (main context は知らなくて良い)

- Sleep prevention (P-15): `caffeinate -dimsu -t {estimated_sec + buffer}` を Pre-flight で起動、Step 2.4 で停止
- HTTP server lifecycle (P-06): port 9342 起動 → 検証 → 完了後停止
- Batch + stagger (P-11): `parallel_batch_size=4`, `stagger_open_sec=4`
- captureId TTL 管理 (P-15): in-memory timestamp で stale 判定、自動再発行
- Grid layout (P-12 + P-15): post-capture で `mcp__figma__use_figma` 1 回実行。Resume mode では `resume_layout_mode` に応じて `full` (全件再整列) / `new_only` (新規分のみ) / `skip` (呼ばない) で挙動が変わる。ユーザーが Figma 上で手動位置調整した既存フレームを誤って上書きしないため
- Mobile width fix (P-13 v2): URL に `&figmaselector=body` 必須
- 件数による分岐: `pipeline.yaml.screens.figma_export.subagent_isolation.recursive_split_threshold` (default 150) を超えたら orchestrator が自身を worker mode で再帰的に sequentially spawn し、chunk_size (default 100) ずつ処理 → 全 chunk 完了後に grid layout 1 回

これらの詳細は **すべてサブエージェント側で完結** する。main context は Resume 判定 → scope 確認 → 1 回の Agent 呼び出し → summary 表示 のみ。

### Step 23: Human Final Approval (Gate)
Read and execute `skills/23-human-final-approval/SKILL.md`.
On approval → Step 24. On modification → back to Step 17. On rejection → abort pipeline.

### Step 24: Design System Update (Variables 3 collections)
Read and execute `skills/24-design-system-update/SKILL.md`.

> **Idempotency Check (P-05 / C-23)**: `use_figma` 実行前に `figma.variables.getLocalVariableCollections()` で既存コレクションを確認すること。'Primitives' / 'Semantic' / 'Component' が既に存在する場合は **create をスキップし、既存コレクションを更新**すること。
>
> **スタブモード (`mode == "disabled"`)**: skill 24 冒頭の Step -1 スタブ手順が `screens.step24_figma_status = "skipped_stub_mode"` + `step24_completed_at` を記録して Step 25 へ進む (Figma 構築なし)。

### Step 25: Component Build (Atom/Molecule/Organism)
Read and execute `skills/25-component-build/SKILL.md`.

> **Component Naming Convention (P-09)**: 全コンポーネントは `{Tier}/{ComponentName}` 形式で命名すること。
> - Atom: `Badge/Processing`, `Button/Primary`, `Input/Default`
> - Molecule: `ActionCard/WireframeGenerate`, `VersionItem`, `ProjectCard`
> - Organism: `Organism/AppHeader`, `Organism/BottomNav`, `Organism/CTAFooter`
>
> **Figma Plugin API Enum制約 (C-21 / C-22)**: `counterAxisAlignItems` は `'MIN'|'MAX'|'CENTER'|'BASELINE'` のみ有効（'STRETCH' は無効）。`primaryAxisAlignItems` は `'MIN'|'MAX'|'CENTER'|'SPACE_BETWEEN'` のみ有効（'STRETCH' は無効）。

> Step 25 完了後は `step25_completed_at` を記録し、自然遷移で **Step 25a (sub-state パターン要否ヒアリング)** に進む (AskUserQuestion を main から起動するロジックは Step 25a 内で完結)。Step 25a で「不要」選択時は `state_pattern_skipped=true` を記録し Phase 4 retro へ遷移。
>
> **スタブモード (`mode == "disabled"`)**: skill 25 冒頭の Step 0 スタブ手順が `screens.step25_figma_status = "skipped_stub_mode"` + `step25_completed_at` を記録して Step 25a へ進む (Variables バインドなし)。

### Step 25a: Sub-state パターン要否ヒアリング (新規)
Read and execute `skills/25a-state-pattern-plan/SKILL.md`.

- AskUserQuestion を直接提示し、user に sub-state (empty / loading / error / 追加状態) の生成要否を確認する
- **「不要」選択時**: `pipeline-state.json.screens.state_pattern_skipped = true` + `step25a_completed_at` を記録し、25b-25e を skip して Phase 3 完了 (Phase 4 retro 起動条件: `final_approved=true` を満たす)
- **「proceed」選択時**: `screens/state-pattern-plan.json` (loop 不変量、`schemas/state-pattern-plan.schema.json` 準拠) を生成し、Step 25b へ進む
- Resume: ESC で中断時は中間 state を持たない (idempotent 再質問)

### Step 25b: Sub-state パターン HTML 追加生成 (新規)
Read and execute `skills/25b-state-pattern-gen/SKILL.md`.

- `state-pattern-plan.json` (Step 25a 生成) を loop 不変量として参照し、各画面 × 各 sub-state × 各 platform の HTML を `screens/{platform}/{画面名}--{state}.html` に追加生成する
- subagent `ayatori-screen-state-builder` を 4-5 並列で起動 (1 subagent = 1 ファイル単位)。詳細は別 PR で実装中の subagent 定義参照
- `_shared/root-variables.css` / `_shared/common-styles.css` を **READ-ONLY** で参照 (Step 17 で生成済)
- 既存の `{画面名}.html` (default、Step 17 生成) を **絶対に上書きしない** assert
- Resume: `pipeline-state.json.screens.step25b.completed_files[]` の差集合のみ再生成 (ファイル単位 idempotent)
- Figma capture script (`<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async>`) を全 sub-state HTML に注入 (Step 25e で使用)

### Step 25c: Sub-state パターン採点 (新規)
Read and execute `skills/25c-state-pattern-score/SKILL.md`.

- `step25b.completed_files[]` + `screens/00-coverage-check.json` (L1 ui_states scope 拡張) を Read
- Layer 2「状態可視性 & フィードバック (6pt)」を sub-state 視点で再評価 (Step 19 は main 視点で評価済、本 step は別ファイル `state-pattern-scores.json` に書く)
- **画面間横断一貫性軸 (Step 1-2b)**: 同 state の複数画面を横に並べ CTA クラス/フォント・アイコン・レイアウト位置・ラベル規約・ナビ慣習のばらつきを検出 (独立並列生成による大域不整合の捕捉)
- `state-pattern-scores.json.attempts[]` に append (`schemas/state-pattern-scores.schema.json` 準拠)
- **Mini-loop**: `ai_improvable_deductions > 0` AND `attempts.length < 2` (max_attempts = `pipeline.yaml.screens.state_pattern_loop.max_attempts` default 2) → Step 25b に back
- max_attempts 到達 OR `ai_improvable_deductions == 0` → Step 25d へ
- **scores.json は触らない** (単一所有権原則、Step 19 と分離)

### Step 25d: Sub-state パターン人間ゲート (新規)
Read and execute `skills/25d-state-pattern-approval/SKILL.md`.

- `state-pattern-scores.json.attempts[-1]` (最新スコア + missing 件数) + `step25b.completed_files[]` (ファイルパス一覧) を user に提示
- AskUserQuestion を直接提示し 3 択 (承認 / 修正指示 / skip-without-figma)
- **承認** → `approvals.patterns_human_approved = true` + `approvals.step25d_approved_at` + `step25d.decision = "approve"` を記録 → Step 25e へ
- **修正指示** → 次の新メッセージで自由記述を受領 → `feedback-log.md` に Pattern A 記録 → Step 25b に back (`step25d.decision = "revise"`)
- **skip-without-figma** → `step25d.decision = "skip_without_figma"` を記録 → 25e を skip して Phase 3 完了 (Figma 追加なし、Phase 4 retro へ)

### Step 25e: Sub-state パターン Figma 追加出力 (新規)
Read and execute `skills/25e-figma-pattern-export/SKILL.md`.

- `approvals.patterns_human_approved == true` を assert
- 既存 `figma-capture-runner` を **`mode: substate`** で起動 (sub-state 用の mode)
- `target_files = state-pattern-plan.json` に基づく sub-state HTML パス一覧 − `figma-state.json.nodes.screens` 既存 capture 済 keys の差集合
- Q1/Q2 の AskUserQuestion は **不要** (Step 25a で確定済の plan を採用)
- `resume_layout_mode` は agent が layout 所有権で解決: `figma-state.json.scope.layout_status == auto_grid*` (パイプラインが整列を所有) → **`full` で default 含む全 frame を最終形に再タイル化** (sub-state 追加時の重なりを構造的に防ぐ) / manual・不明 → `new_only` (手動配置を保護)
- 完了時に `figma-state.json.nodes.screens.{画面名}.{state}` キーを append、`scope.user_selected.states` に新 state を追加、`approvals.completed_at_states` を記録
- **FIGMA_MCP_ENABLED=false 環境**: 25e は完全 skip、`pipeline-state.json.screens.step25e.figma_status = "skipped_stub_mode"` を記録
- Resume: `figma-state.json.scope.deferred_remaining[]` の P-15 既存機構をそのまま流用

> **Note**: Step 26 (Retrospective + pipeline improvement) is in Phase 4 and runs via `/ayatori-retro` — see `phases/retro/SKILL.md`.

## Completion

> 本節は **Route B (フル実行) / forward プロジェクト用**。Route A (screens-lite) の完了表示は § screens-lite の lite-5 が持つ (Route A は Phase 3 完了ではなく基線確立のため、`final_approved` も `session-handoff.md` も書かない)。

Phase 3 は **二段階完了モデル**:
- **完了条件 A (sub-state skip)**: `state_pattern_skipped == true` AND `final_approved == true` — Step 25a で user が「不要」を選んだケース
- **完了条件 B (sub-state 完了)**: `approvals.completed_at_states` set AND `approvals.final_approved == true` — Step 25e まで実行したケース、または `step25d.decision == "skip_without_figma"` (25d 承認後 Figma 追加せず終わったケース)

どちらの完了条件でも Phase 4 retro 起動可能。

After completion:
1. Write `artifacts/{app_name}/session-handoff.md` (overwrite if exists). **Human-readable summary only — NOT execution state**。本ファイルは次セッション起動時にユーザーが目視で進捗を確認するためのメモであり、後続 Phase の resume / skip / state 判定には一切使用されない (state SoT は `pipeline-state.json` + `requirements.json`)。

完了状態に応じて `artifacts_ready` の内容と説明文を切り替える:

**完了条件 A (sub-state skip)**:
```
---
app_name: {app_name}
phase_completed: "3-screens"
completed_at: "{YYYY-MM-DDThh:mm:ss±hh:mm}"
artifacts_ready:
  - screens/ (main only)
  - figma-state.json (default states only)
state_pattern_skipped: true
next_phase: retro
next_command: /ayatori-retro
---
# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.
Phase 3 (Screens) complete — main HTML only (sub-state patterns skipped at Step 25a). Run `/ayatori-retro` in a new conversation.
```

**完了条件 B (sub-state 完了)**:
```
---
app_name: {app_name}
phase_completed: "3-screens"
completed_at: "{YYYY-MM-DDThh:mm:ss±hh:mm}"
artifacts_ready:
  - screens/ (main + sub-state patterns)
  - figma-state.json (default + sub-state captures)
  - state-pattern-plan.json
  - state-pattern-scores.json
completed_at_states: "{YYYY-MM-DDThh:mm:ss±hh:mm}"
next_phase: retro
next_command: /ayatori-retro
---
# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.
Phase 3 (Screens) complete — main + sub-state patterns. Run `/ayatori-retro` in a new conversation.
```

2. Use AskUserQuestion to present the next step:
   > "Phase 3 (Screens) complete. Would you like to proceed to the next step?"
   > Option 1: "Proceed to `/ayatori-retro`"
   > Option 2: "End here for now"

When Option 1 is selected: run `pwd` via Bash to get `{repo_root}`, then display:
```
✅ Phase 3 complete。次のセッションを開始するには、以下をコピーして新しい会話に貼り付けてください:

/ayatori-retro をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```

When Option 2 is selected: display:
```
Artifacts saved in `artifacts/{app_name}/`. 再開するには新しい会話で次を貼り付けてください:

/ayatori-retro をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```

