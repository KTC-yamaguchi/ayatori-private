---
name: ayatori-reverse
description: "Phase 0b: Reverse-engineer an existing app into ISO 29148 requirements by cross-checking its source code (primary), existing documents (Confluence / Jira issues / local md·txt·pdf), and Figma captures. Without code, a degraded mode promotes Figma to the primary source. Fidelity is guarded by per-item provenance + a reverse review gate. Supports KMP, React Native, Flutter, Next.js apps."
---

# /ayatori-reverse — Phase 0b: Reverse Engineering & Requirements Validation

## Purpose

Generate ISO 29148 requirements from an existing app's source code and/or Confluence specs, then convert them into valid input for the AYATORI forward pipeline (`/ayatori-design`, `/ayatori-screens`).

Enables the migration workflow: **existing app → reverse-engineer → rebuild with full AYATORI design system + screens**.

## Input Sources & Roles

Phase 0b reads up to 3 kinds of evidence sources. Which sources exist (the **inventory**) determines each source's **role**; the confirmed result is recorded in `artifacts/{app_name}/reverse-engineered/source-inventory.json` (single writer = this Preamble, schema: `schemas/source-inventory.schema.json`). **本節が役割規則の SoT** — 各 step skill は本表を再掲せず inventory の `roles` を読む。

| Inventory | Roles |
|---|---|
| code present | code = `primary` / docs = `base` (user confirms sufficiency) or `cross_check` / figma = `cross_check` |
| no code + figma present (+ Figma MCP enabled) | figma = `primary` (**縮退モード / degraded mode**) / docs = `cross_check` |
| no code + no figma + docs present | docs = `primary` (document-backed 止まり) |
| nothing | halt — 配置案内を表示してユーザーに確認 |

⚠️ **Jira 課題だけの docs は `base` / `primary` になれない (`cross_check` 固定)** — 課題は「ある時点の
変更要求」であって現状仕様の記述ではないため、それで骨格を起こすと変更要求の履歴を要件として
定着させてしまう。仕様書 (Confluence ページ / ローカル文書) が 0 件で Jira しか無いときは docs を
primary にせず halt & ask する (仕様書の追加提示、または「課題のみを裏取り素材として縮退モードで
進める」の確認)。

- **code** = `input-sources/{stack}/` に**配置済みのファイル**。repo URL を渡された場合は記録のみで、Preamble が取得コマンドを提示しユーザー自身が配置する (パイプラインは取得しない — 下記 4.f の「ソース種別ごとの受け取り方の違い」参照)
- **docs** = Confluence pages (**親ページ ID / URL を答えるだけでよい — 複数可**。Preamble が `source-inventory.json` の `sources.docs.confluence_parent_ids` に列挙し、Step 01 が親ごとに取得) and/or Jira issues (**課題キー / URL を答えるだけでよい** — Step 01 が `ground-truth/jira-{KEY}.md` へ正規化) and/or local documents in `input-sources/docs/` (md / txt / pdf)。⚠️ Jira 課題は「ある時点の変更要求・作業記録」であり現状仕様の記述ではない — docs の役割が base でも、課題のみを根拠にした current-state の主張は裏取り (cross_check) 扱いとし、仕様書・code と食い違えば Cross-Source Conflicts に記録する
- **figma** = ユーザー指定の Figma file/frame URL — **URL を答えるだけでよい** (Step 01 が capture して `ground-truth/figma/` にアーカイブ。`FIGMA_MCP_ENABLED=true` 必須)

**突合の衝突規則**: code が存在する限り code 勝ち。ソース間の不一致は Step 02 が raw-analysis.md の `## Cross-Source Conflicts` に記録する。縮退モードでは視覚・構造の主張は figma 勝ち、挙動の主張は docs 勝ち (figma は挙動の根拠にならない)。

## Preamble

1. Read `pipeline.yaml` to confirm phase configuration. If `skip_phases` includes `"reverse"`: display "⏭ reverse フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.
3. **Determine `{app_name}` — 進行中のリバースがあれば選ばせる** (受け取り書式は `phases/question/SKILL.md` Preamble step 3 と統一する):
   - **プロジェクト引数 bypass**: 起動メッセージが「プロジェクト: {app_name}」形式でプロジェクト名を含み `artifacts/{app_name}/` が存在する場合は、下記の選択を出さずにそれを「進行中のリバースの続行」として採用し、採用したことを 1 行で表示する。**ただし採用前に 1 検査**: そのプロジェクトが下記分類で「リバース系」でなく、かつ `pipeline-state.json.approvals` に完走系の印 (`final_approved` / `screens_human_approved` / `step13_approved_at` のいずれか) が立っている場合は、**forward 経路の完成プロジェクトに reverse を誤適用しようとしている可能性が高い** — 無言で採用せず halt & confirm する (Step 06 が `requirements.json` / `requirements/*.md` を reverse 成果で上書きするため。ユーザーが明示的に「このプロジェクトをリバースし直す」と確認した場合のみ続行)。
   - `ls artifacts/` で候補を列挙し、各候補を分類する:
     - **リバース系**: `reverse-engineered/` が存在する、または `requirements.json.status == "REVERSE_ENGINEERED"`
     - **それ以外** (greenfield 等。リバースを新たに掛ける対象にはなり得るが、既定の続行候補には出さない)
   - **リバース系候補が 1 件以上あるとき**: 「新規か続行か」と「どれを続けるか」を **1 回で同時に聞く** (2 択を挟んでから改めて一覧を出すと往復が 1 回無駄になるため)。聞き方は候補数で切り替える — **`1 (新規) + 候補数` が 4 以下なら `AskUserQuestion`** (クリックで選べる方が速い。`AskUserQuestion` の option 上限は 4)、**5 以上になるなら plain chat の番号付きリスト** (上限を超えるため。書式は `phases/question/SKILL.md` Preamble step 3 の fallback と同じ):
     - `AskUserQuestion` 形式 (候補 3 件以下):
       > 「どのリバースを進めますか?」
       > Option: `新しく始める` / `{app_name} ({到達済みステップ} → 次: {再開位置})` / … (候補ごとに 1 option)
     - plain chat 一覧形式 (候補 4 件以上):
       ```
       0. 新しくリバースを始める
       1. {app_name} — {到達済みステップ} / 次: {再開位置}
       2. {app_name} — ...
       ```
       選択方法を明示する: 「**番号またはプロジェクト名 (完全一致) を 1 つ返信してください** (例: 「1」または「my-app」。新規なら「0」)」。
     - どちらの形式でも各候補の進捗は下記 step 5 の resume ladder を適用して求める (例: `Step 03 完了 / 次: Step 04`。既に Phase 0b 完了なら `完了 (再確認のみ)` と明記して選ばせない誤解を防ぐ)。**無言で採用しない**。
     - 新規が選ばれたら下記「新規」の流れ、候補が選ばれたらそれを続行対象として採用する。
   - **リバース系候補が 0 件のとき**: 一覧を出さず「進行中のリバースはありません」と 1 行伝えて、そのまま「新規」の流れへ進む (無駄な確認を挟まない)。
   - **新規の流れ** (「新しく始める」が選ばれた / 候補 0 件 / `artifacts/` が空): 資料は **1 回の自由貼り付けで受け取り、種類は URL から自動判別する** (ソース種別を選ばせる質問・ラベル付きフォームのいずれも出さない — 往復と入力手間を増やさないため):
     a. plain chat で 1 回だけ依頼する (自由入力のため `AskUserQuestion` は使わない — `skills/00-memory-load/SKILL.md` の standing rule): 「**持っている資料の URL / ID を順不同でそのまま貼り付けてください** (無いものは省略可)。プロジェクト名の希望があれば併記してください」。
     b. 受け取った文字列から **URL の形で種類を判別**する (ラベル不要):

       | 判別パターン | 種類 |
       |---|---|
       | `github.com` / `gitlab` / `bitbucket` を含む、または `.git` で終わる | code (repo URL → `sources.code.source_repo_url`) |
       | `/` or `~` 始まりの実在するローカルパスで、`.md` / `.txt` / `.pdf` で終わる | docs (ローカル文書 → `input-sources/docs/` への配置を案内し `sources.docs.local_files` に記録) |
       | `/` or `~` 始まりの実在するローカルパス (上記以外 = ディレクトリ等) | code (既に配置済み or コピー元) |
       | `*.atlassian.net/wiki/...`、または裸の数値 ID (Confluence page ID) | docs (Confluence → page ID を抽出して `sources.docs.confluence_parent_ids` に **append** (複数可・重複 dedup。**既存要素を上書きしない** — 後から親を追加提示されたら要素が増える)。**この field が Step 01 の Confluence 収集の実行条件なので、記録しないと収集そのものが発火しない**) |
       | `*.atlassian.net/browse/{KEY}`、または課題キー単体 (`ABC-123` 形式 = 英大文字プレフィックス + ハイフン + 数字。裸の数値のみは Confluence page ID と判別) | docs (Jira → `sources.docs.jira_issue_keys`。URL からは key を抽出して記録) |
       | `figma.com/design/...` or `figma.com/file/...` | figma (URL を `sources.figma.urls` に、URL 中の file key を抽出して `sources.figma.file_keys` に記録 — **file_keys は Step 01 の収集済み判定の単位**なので、記録しないと URL を追加しても差分 capture が発火しない) |
       | 上記いずれにも当てはまらない | **勝手に決めず 1 回だけ確認する** (どのソースか / 無視するか) |

       - 同種が複数あってもよい (repo 複数 = `{stack}` を分ける / Figma 複数 file / Confluence 複数 親ページ)。
       - ローカル文書 (md/txt/pdf) は URL を持たないため、貼り付けに現れない。**`input-sources/docs/` に置けば自動で拾われる**ことを 1 行案内するに留める (置くかどうかはユーザーの自由)。
       - `mode == "disabled"` のときに figma URL が来たら、収集できない旨と `FIGMA_MCP_ENABLED=true` の設定方法を伝える (4.g へ合流)。
     c. **プロジェクト名**: 明示があればそれを使う。無ければ repo 名 / Figma file 名から候補を 1 つ提示して 1 行で確認する (**無言で採用しない**)。既存ディレクトリと衝突するときは別名を求める。
     d. 何も貼り付けられなかった (資料なし) → 4.f の配置案内へ合流して halt する。
     e. **起動引数からの受け取り**: 起動メッセージに URL / ID が含まれている場合は b の判別をそのまま適用し、**a の依頼を出さずに**進む (毎回貼り付け直す手間を省く。`/ayatori-reverse https://github.com/... https://figma.com/design/...` の形)。
     f. ここで判別した内容は **step 4 の棚卸しの申告値**として扱い、4.d で「どのソースがあるか」を **再質問しない** (同一 target の二重質問禁止、Operating Principle 4 Rule 6)。4.d では docs の役割 (base / cross_check) と最終確認のみ聞く。
   - `artifacts/` 自体が空のとき: 一覧も確認も出さず「新規の流れ」をそのまま実行する。
4. **Source inventory determination** (役割規則は上記「Input Sources & Roles」表が SoT):
   - `reverse-engineered/source-inventory.json` が既に存在 → 再利用する (記録済みソースがディスク上に現存するかの再検証のみ。**再質問しない**。構成を変えたい場合はユーザーが本ファイルを削除して再実行)。
   - 不在なら棚卸しを実行:
     a. `ls artifacts/{app_name}/input-sources/` — `{stack}` サブディレクトリ (= code) と予約名 `docs/` (= ローカル文書) を列挙。`ls artifacts/{app_name}/` で `ground-truth/` 残存も確認。
     b. Confluence 側の収集起点を確定する: step 3 の貼り付け判別で得た親ページ ID (複数可) + `requirements.json.confluence_parent_id` (set なら収集起点候補の 1 つとして合流 — この field 自体は要件文書の**保存先**用の単数 field であり収集起点とは役割が別) を dedup して `sources.docs.confluence_parent_ids` に列挙する。既存 inventory に旧 `confluence_parent_id` (単数) が残っている場合は 1 要素として読む (reader 互換)。Jira 課題キーは step 3 の貼り付け判別 (または既存 inventory の `sources.docs.jira_issue_keys`) から引き継ぐ — requirements.json に対応 field は持たない。
     c. `skills/00-figma-mode-detect/SKILL.md` を Read して実行し `mode` (enabled/disabled) を得る。
     d. **AskUserQuestion 1 回 (batch)** で確定する: 検出した棚卸し表を提示し、(i) Figma URL の提供 (任意、mode=enabled 時のみ)、(ii) docs が存在する場合の役割 (base = 骨格として読む / cross_check = 裏取りのみ)、(iii) 棚卸し内容の確認、をまとめて聞く。**同一 target を複数回聞かない** (Operating Principle 4 Rule 6) — step 3 の「新規の流れ」を通ってきた場合は (i) と (iii) の「どのソースがあるか」が貼り付けから判別済みなので再質問せず、**(ii) docs の役割と最終確認のみ**にする。**収集範囲 (どのサブツリー / どの frame まで) と code の解析範囲はここでは聞かない** — Step 01 の各 sub-module の予算ゲート、および Step 02 B2.0 の code 予算ゲートが、列挙後に件数 + 予想所要の数字を提示して確定する (数字なしで範囲を答えさせない)。
     e. 確定した回答は `pending-questions.json` に born-resolved entry として記録し (Operating Principle 4 の確定 decision 記録)、役割を割り当てて `reverse-engineered/source-inventory.json` を Write する (init stub `{"app_name","sources":{},"roles":{}}` → merge → Write back、`degraded_mode` は roles.primary == "figma" のとき true)。
     f. 全ソース不在 (code も docs も figma も無し) → 配置案内を表示して halt: 「`input-sources/{stack}/` にソースコード、`input-sources/docs/` に既存文書 (md/txt/pdf) を配置するか、Confluence ページ / Jira 課題 / Figma の URL を提示してください」。
     - **ソース種別ごとの受け取り方の違い** (ユーザーが URL / ID を渡すだけで済むか、ローカル配置が必要か):
       - **docs (Confluence)**: 親ページ ID / URL を答えるだけでよい — Step 01 が MCP で取得しアーカイブする。
       - **docs (Jira)**: 課題キー / 課題 URL を答えるだけでよい — Step 01 の jira sub-module が MCP で取得し `ground-truth/jira-{KEY}.md` へ正規化する。
       - **figma**: file / frame URL を答えるだけでよい — Step 01 の capture sub-module が取得しアーカイブする。
       - **code**: **リポジトリ URL を渡しても本パイプラインは取得しない** (トリー全体が必要で、`git` 等の外部 CLI に依存しない設計 — Operating Principle 1)。ユーザーが repo URL を提示した場合は `sources.code.source_repo_url` に記録した上で、**取得コマンドを組み立てて提示し、ユーザー自身に実行してもらう** (プロンプトで `! <command>` として実行できる):
         ```
         git clone --depth 1 <repo-url> artifacts/{app_name}/input-sources/{stack}/
         ```
         `{stack}` はソースの正体を表す自由名 (kmp / ios-swift / be-python 等) をユーザーと合意して決める。zip ダウンロード等の別手段で配置してもよい。
         **配置が完了してファイルが実在するまで code は `present: false` のまま扱う** (URL の存在を code の存在と混同しない — 混同すると Step 02 が読む対象が無いまま source_backed を主張しうる)。配置後に本 Preamble から再開する。
     g. **縮退モードの MCP 前提確認**: code 不在 + figma present なのに `mode == "disabled"` (FIGMA_MCP_ENABLED が有効でない) → figma を収集できず primary が立たないため halt & ask: 「ソースコードが無いため Figma 中心の縮退モードになりますが、Figma MCP が無効です。`FIGMA_MCP_ENABLED=true` を設定して再実行するか、docs のみ (document-backed 止まり) で進めるか選んでください」。docs も無ければ f と同じ配置案内に合流する。
4b. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。本 phase の入力契約値:
   - `next_step` = 5 / `gate_before_step` = Step 01 (code-only inventory は Step 02)
   - `target_artifacts` = `"reverse-engineered/*.md,requirements.json,requirements/*.md"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (prose や条件文を渡すと path 形でない token として drop される)
     - **進行位置で切り替えず 3 つの和集合を常に渡す**: 本 phase の正本は Step 06 の前後で `reverse-engineered/*.md` → `requirements/*.md` に移るが、進行位置で宣言を切り替えると「Step 06 の E1 (`requirements.json` 生成) は済んだが E2-2 (`reflect_to` の移行) が済んでいない」中断状態で、旧正本を指す未解決 entry が**本 phase の門でも受け付けられなくなる** (resume ladder は Step 06 に戻らず Step 07 へ飛ぶため E2-2 が再実行されない)。和集合なら移行の有無に関わらず ask できる
   - `append_sources` = Step 03 は `pending-questions.json` に append (本 Gate の対象) / Step 05 は `requirement-deviations.json` に append (review-gate 経路)
   - 固有注記: 新規 reverse 開始時は pending-questions.json 不在で skip。reverse 経路は input-sources/ 不在・二次要約のみ等で (D) UNCERTAIN を多数生む可能性が高い (Operating Principle 3 と密接)。実質的な発火は resume 時
   - 固有注記: **step 5 の ladder 先頭 rung (`requirements.json` が `status == "REVERSE_ENGINEERED"` かつ `confluence_save_status` set) が成立し、かつ step 5 冒頭の差分収集先行判定でも追加収集が発生しない場合 (= Step 01〜07 を 1 つも走らせず Completion の押印のみで終わる場合) は本 Gate を skip し、(f) の counter 再計算のみ実施する** — この resume は何も生成・更新せず押印のみで終わる運用位置であり、質問は次に実行される phase の入口で振り分けて ask する方が一貫するため (unresolved はそのまま持ち越される。E2E 実測: 未解決 17 件を 5 往復 ask したが、この位置では答えを使う step が 1 つも走らなかった)。**先頭 rung が成立していても差分収集 (step 5 冒頭の判定で追加ソースあり) が発生する場合は Step 01 が走るので、本 Gate は通常どおり実行する**。本 Gate は step 5 より手前にあるので、先頭 rung の条件と差分収集先行判定の 2 つをここで先に評価して判定する
5. Determine resume position (evaluate top-to-bottom, first match wins). `confluence_save_status` is read from `pipeline-state.json.confluence.requirements.save_status`:
   - **Ladder 評価の前に差分収集を先行させる**: inventory 上 present なソースのうち Step 01 A0 の
     済み判定 (ソース別・確定範囲別) を満たさないものが 1 つでもあれば、resume 位置がどこであっても
     **先に Step 01 の差分収集を実行**し、完了後に下記 ladder で決まる位置から再開する。ladder は
     first-match で途中 rung から Step 03+ へ直行するため、これを挟まないと resume 時に追加された
     ソースが差分収集経路 (A0 / 差分 capture) を通らず、無言で未収集のまま下流へ進む。
   - `requirements.json` exists AND `status == "REVERSE_ENGINEERED"` AND `confluence_save_status` is set (`"success"` / `"partial"` / `"failed"`) → Phase 0b complete → proceed to Completion
   - `requirements.json` exists AND `status == "REVERSE_ENGINEERED"` AND `confluence_save_status` is null/missing → resume from Step 07 (Step 07 writes this field on completion or skip)
   - `artifacts/{app_name}/requirement-deviations.json` に `phase == "reverse"` の coverage 記録があり、かつ `phase == "reverse"` の flag entry がすべて resolved (resolved_at set) → reverse review gate 通過済 → resume from Step 06
   - `artifacts/{app_name}/reverse-engineered/comparison-report.md` exists (Step 04 完了、reverse gate 未通過) → resume from Step 05
   - `artifacts/{app_name}/reverse-engineered/08-constraints.md` exists → resume from Step 04 (ground-truth 不在のときは Step 04 が self-skip し Step 05 へ流れる)
   - `artifacts/{app_name}/reverse-engineered/raw-analysis.md` exists → resume from Step 03
   - Otherwise → start from Step 01 (code-only inventory のときは Step 01 が self-skip し実質 Step 02 開始)。**Step 01 は常に通す** — 収集済みかどうかは Step 01 の A0 dispatch がソース別・確定範囲別に判定して済みのものだけ skip する。ここで「`ground-truth/*.md` が 1 つでもあれば収集済み」と判定してはならない: docs は Confluence / Jira / ローカルの 3 サブソースがあり、ローカルだけ正規化された状態でセッションが切れると Confluence / Jira が永久に未収集のまま Step 02 へ飛び、index にも「未収集」の記録が残らないため下流が「存在しない」と誤読する (figma も manifest の存在だけでは確定 capture セットを満たしたか分からない)

## Execution

Execute steps in order:

### Step 01: Ground-Truth Collection (docs / figma が present のときのみ)

Use the Read tool on `skills/reverse/01-ground-truth/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

Collects the present evidence sources into `artifacts/{app_name}/ground-truth/` (ソース別冪等):
Confluence spec pages → root-level `*.md` (sub-module `refs/confluence-docs.md` — 列挙 → 予算ゲート →
本文量 probe → worker 収集 → batch 受入検査 → 転写忠実度検査 → index 決定論生成)、Jira issues → root-level `jira-{KEY}.md` (sub-module
`refs/jira-docs.md` — 同じく列挙 → 予算ゲート → 本文量 probe → worker 収集 → batch 受入検査 → 転写忠実度検査 → index 再生成)、Figma captures → `figma/` (sub-module `refs/figma-capture.md`
が `ayatori-figma-ground-truth-collector` subagent を batch 分割で起動し、manifest + frame 単位の
PNG / design-context / variables をアーカイブ。live MCP 読みはここだけ — 下流はアーカイブのみ読む)。
- 収集開始前に、列挙結果に基づく予想所要を 1 行でユーザーに伝える
  (文書 ≈ ページ数 ÷ (3 ページ/分 × worker 数)、figma ≈ 2〜3 分/frame — 並列で短縮)。
  文書は 50 ページ超、Jira は 30 課題超で予算ゲートが範囲を確定する。figma の file 全体 URL は列挙後に
  クラスタリング (`scripts/cluster-figma-candidates.mjs` — 同名 dedup + 状態/連番変形のファミリ化 +
  代表選定) が capture 提案を作り、範囲確定ゲートが代表セット (件数 + 予想所要) を既定案として
  確定する。畳んだ変形・未 capture ノードは manifest に記録され、後から差分 capture で追加できる。
- **code が present なら、Step 02 の code pass (B2 module shard) を本 step と並行起動してよい** —
  code pass はアーカイブを読まないため依存が無い (`skills/reverse/02-source-analysis/SKILL.md` の「実行形態」参照)。
  並行起動でも B2.0 の読み取り計画 + 予算ゲート (超過判定は inventory の `summary.budget_gate` —
  閾値の SoT は `scripts/build-code-inventory.mjs` の定数) を先に通してから shard を起動する。**例外: `roles.docs == "base"` の run は並行起動しない** —
  B1 の骨格完成後に B2 を順次起動する (skill「実行形態」の ⚠️ 参照)。
**Skip this step when the inventory is code-only** (docs も figma も absent).

### Step 02: Source / Document Analysis

Use the Read tool on `skills/reverse/02-source-analysis/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

Multi-pass analysis (実プロダクト規模では pass 単位の subagent 分割が既定 — skill の「実行形態」):
1. **Code pass (B2)** — 読み取り計画 + 予算ゲート (B2.0: `scripts/build-code-inventory.mjs` が決定論分類し、
   超過時は件数 + 予想所要の数字で範囲確定 → `.code-scope.json` に永続化) → module 単位 shard が
   構造抽出と挙動 7 チェック (B-01~B-07: audio exclusion, persistent preferences, scope flags,
   file upload processing, navigation state preservation, illustration style, Android UI framework) を
   **同じ読みで 1 回だけ**実行し findings を返す
2. **Document / Figma passes** — アーカイブ読み (index content status に従う) + Cross-Source Conflicts 突合

Output: `artifacts/{app_name}/reverse-engineered/raw-analysis.md` (writer は main のみ。Write 直後に
`scripts/check-source-citations.mjs` が引用の file:line 実在を機械検証し、疑義は再確認 1 回 → `※ 未確認` 降格で収束させる)

### Step 03: Requirements Generation

Use the Read tool on `skills/reverse/03-requirements-gen/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

Generates 8 ISO 29148 documents from raw-analysis.md, with behavioral annotations preserved.
Output: `artifacts/{app_name}/reverse-engineered/01-overview.md` ~ `08-constraints.md`

### Step 04: Comparison & Gap Analysis

Use the Read tool on `skills/reverse/04-comparison/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

Compares reverse-engineered output against ground-truth documents.
Output: `artifacts/{app_name}/reverse-engineered/comparison-report.md`

### Step 05: Reverse Review Gate (推測項目の人間確認)

Use the Read tool on `skills/reverse/05-review-gate/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

Runs `ayatori-requirements-auditor` (layer=reverse) to detect specifics in `reverse-engineered/01-08.md` that cannot be
traced to `input-sources/{stack}/` source code (= 推測 / inferred), records them to `requirement-deviations.json`
(phase=reverse), presents the deviations view to the human, and gates on resolution of every flagged inference.
Output: `artifacts/{app_name}/requirement-deviations.json` (phase=reverse) + `requirement-deviations-view.html`.
**Always run — even if Step 04 was skipped** (code-only inventory). This is Phase 0b's requirements human gate
(forward Step 07 equivalent); without it, inferred specs are laundered into requirements.json at Step 06.

### Step 06: AYATORI Format Conversion

Use the Read tool on `skills/reverse/06-format-convert/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

Converts reverse-engineered outputs into the file formats the AYATORI forward pipeline expects.
Generates `requirements.json` (status: REVERSE_ENGINEERED), copies requirements docs, generates screen list + screen spec files, and a tokens.json base.
**Always run — even if Step 04 was skipped.**

### Step 07: Confluence Save (reuses Phase 1b skill)

Use the Read tool on `skills/06-confluence-save-req/SKILL.md` (pipeline file — not a registered skill) and follow the instructions it contains.

Saves the 8 ISO 29148 documents to Confluence under the project page.
The `06-confluence-save-req` skill is reused directly — input (`requirements/01-08.md`), page hierarchy, and field names are identical between Phase 0b and 1b.
**Phase 0b notes:**
- The skill's "scoring-history.json gate for re-run" applies only to Phase 1b. In Phase 0b, the only re-run gate is `pipeline-state.confluence.requirements.save_status` (re-run if null).
- If `requirements.json.confluence_parent_id` is null and user declines to provide one, the skill skips gracefully and writes `pipeline-state.confluence.requirements.save_status = "failed"`.

## Completion

After Step 07 completes (or is skipped):

0. **要件承認印の押印 (reverse 経路の鍵)**: Read `artifacts/{app_name}/pipeline-state.json` (不在なら init stub `{ "app_name": "{app_name}" }`) → **`approvals` 配下にのみ**以下を merge して Write back。**`confluence.*` 等の他キーは変更せず保持する** (直前の Step 07 が書いた `confluence.requirements.save_status` を落とすと、下記 step 3 の表示が壊れる):
   - `approvals.step07_approved_at` が**既に set なら両キーとも触らず本 step を終える** (冪等 — forward 由来の承認や過去の押印を上書きしない)。以下は**未 set の場合のみ**実行する。
   - **押印の前に Step 05 ゲートの通過を検査する** (「未 set」だけを条件に押さない — 印の根拠そのものを確認する): `artifacts/{app_name}/requirement-deviations.json` に `phase == "reverse"` の coverage 記録があり、かつ `phase == "reverse"` の flag entry が**すべて resolved** (`resolved_at` set) であること。Preamble step 5 の resume ladder が Step 06 への resume 判定に使う述語と**同一のものを再利用する**。
     - **不成立なら押印せず、Step 05 を実行してから Step 06 → Step 07 → 本 Completion を続けて通す** (halt しない — halt すると resume ladder 先頭 rung が再び本 Completion へ直行するため、Step 05 に到達する経路が無く行き止まりになる)。2 周目は述語が成立するのでそのまま押印される。
     - ゲート記録が無い成果物は「人間が推測項目を確認した」実績を持たない。それに `"reverse-review-gate"` を由来として書くと、**stub が人間承認を騙る**ことになる (鍵② `baseline_approved_via` が `"manual-stub"` で由来を機械判別できるのと同じ規律を鍵①にも課す)。
     - 本検査を「押印済みなら何もしない」の**内側**に置くのが要点 — `step07_approved_at` が未 set である = `/ayatori-req-delta` が一度も開いていないため、Step 06 の再生成で失われる人間改訂は構造的に存在しない。押印済みプロジェクトは本検査に入らないので `requirements/*.md` の上書きは起こらない。
   - 検査が成立したら次の 2 キーを**両方**書く (片方だけの書き込みは禁止):
     - `approvals.step07_approved_at` = 現在時刻 (ISO 8601。Bash で `date` を実行して取得する — 推測で組み立てない)
     - `approvals.step07_approved_via` = `"reverse-review-gate"`

   根拠: Step 05 reverse review gate (人間) の通過が要件承認に相当し、この印で Phase 1c (`/ayatori-req-delta`) が開く。押印を Step 05 でなく本 Completion に置くのは、Step 06 が requirements.json を生成し終えるまで印を立てないため。index 再生成 (step 1) より**前**に実行すること (index のタイムラインが押印を拾うため)。二重 writer の例外は `docs/artifact-file-responsibility.md` 参照。

1. **成果物インデックスの再生成** (fail-open — 失敗しても Completion を止めない):

   ```bash
   node scripts/build-artifact-index.mjs artifacts/{app_name}
   ```

   Phase 0b は成果物が多い (requirements 8 文書 + screens 仕様書 + ground-truth + 監査 view) ため、
   完了時点の全成果物を `index.html` 1 画面から確認できる状態にして引き渡す
   (人間ゲート共通の `refresh_index` 規約と同じ思想。生成失敗時は index 行を出さず続行)。
   Completion の表示メッセージに index のパスを 1 行追加する。

2. Write `artifacts/{app_name}/session-handoff.md` with the following content
   (substitute `{app_name}` and today's date in YYYY-MM-DD format).
   **Human-readable summary only — NOT execution state**。本ファイルは次セッション起動時にユーザーが目視で進捗を確認するためのメモであり、後続 Phase の resume / skip / state 判定には一切使用されない。REVERSE_ENGINEERED ファストパスの判定は `requirements.json.status == "REVERSE_ENGINEERED"` のみが SoT (本 Step 03 で書き込み済み)。`project_origin: REVERSE_ENGINEERED` は legacy 互換のため frontmatter に残すが、削除されても下流挙動には影響しない。

```
---
app_name: {app_name}
project_origin: REVERSE_ENGINEERED
phase_completed: "0b-reverse"
completed_at: "{YYYY-MM-DDThh:mm:ss±hh:mm}"
artifacts_ready:
  - tokens.json
  - screens/00-screen-list.md
  - requirements/01-08.md
next_phase: design
next_command: /ayatori-design
---
# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.
Phase 0b complete. Run `/ayatori-design` in a new conversation.
Skip rules active: Step 08 hearing skipped, Step 14 screen list derivation skipped.
```

3. Display:
> "Phase 0b (Reverse Engineering) complete.
>  `artifacts/{app_name}/requirements.json` is ready (status: REVERSE_ENGINEERED).
>  {step 0 で新規に押印した場合「要件承認印を記録しました (approvals.step07_approved_at — Step 05 review gate 通過が根拠)。」/ 既に set で維持した場合「押印済みの要件承認印を確認しました (既存値を維持)。」}
>  Confluence save status: {confluence_save_status}.
>  📦 全成果物インデックス: `artifacts/{app_name}/index.html` (1 画面から全成果物を確認できます)
>  `session-handoff.md` に引き継ぎ情報を記録しました。
>
>  次のステップ (新しい会話で):
>  - UI 生成へ進む → `/ayatori-design`
>  - 改修対象が決まっているなら、その周辺の記述が実物と合っているか確かめる → `/ayatori-reverse-verify` (対象を絞って code + 文書 + Figma と突合し、記述を正す)
>  - 先にリバース産要件を手直しする → `/ayatori-req-delta`
>  {approvals.baseline_approved_at が未 set なら「(機能追加 `/ayatori-add-feature` / `/ayatori-delta` はベースライン承認印 `approvals.baseline_approved_at` が立ってから使えます — `/ayatori-design` の後に `/ayatori-screens` を実行し、入口で「基線確立 (screens-lite)」を選ぶと画面 HTML を作らずに押印まで進めます)」/ set 済みなら「- 機能追加へ進む → `/ayatori-add-feature` / `/ayatori-delta` (ベースライン承認済み)」}"

If Step 04 was skipped (no ground-truth), still proceed to Step 06/Step 07 — comparison is optional.
