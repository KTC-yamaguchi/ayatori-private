---
name: ayatori-question
description: "Phase 1a: Idea structuring. Organize app requirements through 7-axis discovery interview (including design output scope)."
---

# /question — Phase 1a

## Preamble

1. Read `pipeline.yaml` to confirm Phase configuration. If `skip_phases` includes `"question"`: display "⏭ question フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. Check subdirectories under `artifacts/`:
   - **プロジェクト引数 bypass**: 起動メッセージが「プロジェクト: {app_name}」形式でプロジェクト名を含み、`artifacts/{app_name}/` が存在する場合は、下記の AskUserQuestion を出さずにそのプロジェクトを「既存プロジェクトの続行」として採用し、採用したことを 1 行で表示する (`phases/requirements/SKILL.md` Preamble step 3 と同じ受け取り方。`/ayatori-idea` 中断後の再開貼り付けもこの経路で入る)。
   - If one or more subdirectories exist: present via AskUserQuestion (2 options 固定 — プロジェクトごとに option を作らない):
     > "Existing projects found. What would you like to do?"
     > Option 1: "Start a new project"
     > Option 2: "Continue an existing project"
     Option 2 選択時: 候補が 1 件ならその名前を plain chat で提示して確認の上採用する (例: 「既存プロジェクトは {subdirectory} の 1 件です。これを続行しますか？」— 無言で採用しない)。2 件以上なら **plain chat の番号付きリスト** (`1. {subdirectory}` 形式) で提示し、「選択方法: 番号またはプロジェクト名 (完全一致) を 1 つ返信してください (例: 「2」または「my-app」)」と明示して単一選択で選んでもらう (返信書式は `skills/36-artifact-index/SKILL.md` § app_name の確定と統一) (プロジェクトが 5 件以上のとき AskUserQuestion の option 上限 4 を超えるため。書式は `skills/01b-add-feature-question/SKILL.md` § Plain chat fallback)
   - If no subdirectories exist: start as a new project
3b. **モード選択 (新規プロジェクト開始時のみ)**: step 3 の結果が「新規プロジェクト開始」(明示選択 or サブディレクトリ不在) で、かつ起動メッセージに description 引数 (アプリ概要の記述) が無い場合のみ、AskUserQuestion で提示する:
   > "アイデアはどの程度固まっていますか？"
   > Option 1 (Recommended): "要件定義開始モード" — アイデアは固まっている。従来どおり 7 軸ヒアリングへ
   > Option 2: "アイデアブラッシュアップモード" — まだふわふわ。壁打ちで固めてから 7 軸へ
   - Option 1 / auto-"Other" 受信時: 従来フローを続行する ("Other" は防御的に Option 1 扱い — `skills/01-question/SKILL.md` § Experience Level Selection の Auto-"Other" Handling と同じ方針)。
   - Option 2 選択時: まず `pipeline.yaml` の `skip_phases` に `idea_brushup` が含まれるか確認する。含まれる場合は「⏭ idea_brushup をスキップします（pipeline.yaml → skip_phases 設定）」と表示し、Option 1 相当の従来フローを続行する。含まれなければ `skills/01a-idea-brushup/SKILL.md` を Read し、**この会話のまま** その手順 (Step 0〜6 対話ループ) を inline 実行する (新しい会話へは誘導しない。01a Preamble のうち step 1 の skip_phases 確認は直前で実施済み・step 2 の memory-load は本 phase step 2 で実施済みのため省略し、refs Read + stub ガードから行う)。01a の Step 6 の結果で分岐する:
     - 「7 軸へ進む」(ハンドオフ処理 1〜3 実行後) → Preamble step 4 へ戻る。`{app_name}` は 01a Step 3 の確定値。step 5 が直前生成の idea-brief.md を検出して `brief_preread = true` (直前生成のため鮮度確認は不要) → step 6 Pre-flight Gate → Execution へ。
     - 「ここで終了」→ 本 phase も終了する (brief は 01a Step 5 で保存済み。再開は `/ayatori-question` のブリーフ先読み or `/ayatori-idea` の resume 検出)。
     - app_name 未確定 degrade (01a Step 3 未到達): brief なしの新規プロジェクトとして Preamble step 4 から続行する (`brief_preread = false`、通常 7 軸)。
     - **carry-over 制限**: ブラッシュアップから 7 軸へ持ち越してよいのは idea-brief.md + `pending-questions.json` の born-resolved entries のみ。会話中に現れたが brief に採用されなかったアイデアを 7 軸の既定値・提案に注入しない (下流へは 7 軸確認を経て `00-raw-input.md` に記録された値のみが流れる)。
   - **発火しない条件 (従来挙動維持)**: description 引数起動 / 既存プロジェクトの続行 (明示選択・プロジェクト引数 bypass とも) — これらでは本モード選択を出さない。
4. Determine `{app_name}`
5. **ブリーフ先読み判定**: `{app_name}` が確定し `artifacts/{app_name}/` が存在する場合に評価する — 既存プロジェクトの続行と、step 3b Option 2 / `/ayatori-idea` からの inline 合流復帰 (step 3 の分類が「新規」でも 01a が直前にディレクトリを生成済み) の両方を含む。次の 2 経路は評価せず `brief_preread = false` に固定する: (a) 対象ディレクトリが未生成の新規プロジェクト開始経路、(b) **description 引数 (アプリ概要の記述) 起動** — § Opening の Idea Gathering 直行を維持する (skill 側 § Brief Pre-read Mode「Description-argument launches never enter this mode」との契約。なお「プロジェクト: {app_name}」形式のプロジェクト引数 bypass は description 引数ではなく既存プロジェクトの続行として評価対象):
   - `artifacts/{app_name}/requirements.json` が **存在する** → `brief_preread = false` (7 軸完了済みプロジェクトの resume。モード選択もブリーフ先読みも発火しない)
   - requirements.json が不在で `artifacts/{app_name}/idea-brief.md` が **存在する** → `brief_preread = true`。さらに brief frontmatter の `recorded_at` が現在時刻から **7 日以上前** なら、鮮度確認を AskUserQuestion で 1 問だけ挟む:
     > "{N} 日前のブリーフ (idea-brief.md) が見つかりました。どうしますか？"
     > Option 1 (Recommended): "このまま使う"
     > Option 2: "内容を見直してから進む" — brief 本文 (①〜⑦) を chat に表示して目視確認後に続行する (各項目は Execution の軸別確認で個別に確定・修正できるため、ここでは表示のみ)
   - いずれも不在 → `brief_preread = false` (従来フロー)
6. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = Execution (Step 01) / `gate_before_step` = 01
   - `target_artifacts` = `"requirements.json"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (prose を渡すと path 形でない token として drop される)
   - `append_sources` = 01-question skill (初回 append 時)
   - 固有注記 (例外): 本 phase の preamble では手順 (a) のうち **lazy init のみ行わない** ((a) は「存在すれば Read」に縮退、(b)-(g) の手順自体は標準どおり)。新規プロジェクト時は pending-questions.json 不在 → filter 対象なしとして skip し Execution へ (init stub は 01-question skill 内で初回 append 発生時に start)。既存 project を resume した場合は (b) を実行し、`ask[]` が 1 件以上あれば (c)-(g) を実行する

## Execution

Read and execute `skills/01-question/SKILL.md`. `brief_preread = true` のときは同 SKILL.md の § Brief Pre-read Mode (ブリーフ先読みモード) に従って実行する。

## Completion

After completion:
- Verify that `artifacts/{app_name}/requirements.json` has been generated
- Use AskUserQuestion to present the next step:
  > "Phase 1a (Question) complete. Would you like to proceed to the next step?"
  > Option 1: "Proceed to `/ayatori-requirements`"
  > Option 2: "End here for now"

When Option 1 is selected: run `pwd` via Bash to get `{repo_root}`, then display:
```
✅ Phase 1a complete。次のセッションを開始するには、以下をコピーして新しい会話に貼り付けてください:

/ayatori-requirements をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```

When Option 2 is selected: display:
```
Artifacts saved in `artifacts/{app_name}/`. 再開するには新しい会話で次を貼り付けてください:

/ayatori-requirements をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```
