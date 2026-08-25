---
name: ayatori-reverse-verify
description: "Phase 0c: リバース産の要件定義書・画面仕様のうち、改修対象として名指しされた機能・画面の関連範囲だけを 3 証拠ソース (実コード / 文書アーカイブ / Figma capture) と突合し、食い違いを人間確認のうえ記述へ反映する。全範囲の再突合はスコープ外。改修着手前に「図面が実物と合っている」状態を作る補正フェーズ。"
---

# /ayatori-reverse-verify — Phase 0c: 対象限定 3 ソース突合

## Purpose

リバース (Phase 0b) で起こした `requirements/*.md` と `screens/{slug}.md` は、**コードの読み違いによる誤りを含む**。
実測では誤りの多くが「コードが間違っていた」のではなく「**コードの読み方を間違えていた**」ものであり、
Figma や既存文書と突き合わせて初めて訂正できた。

本 phase は改修に入る前に、**対象として名指しされた機能・画面の関連範囲だけ**を証拠ソースと突合し、
記述を正確にする。範囲を絞るのは効率のためだけではない — 生成時の突合 (Step 02 B3 / Step 04) は全体を
広く 1 回読む構造であり、**その読みで生じた誤読は同じ広さで読み直しても捕まらない**。狭く深く読み直す
ことが本 phase の存在理由である。

**やらないこと** (意図的なスコープ外):
- **全範囲の突合** — 対象ポイント + 関連範囲のみ。全体品質の底上げは Phase 0b の役目。
- **コードの修正** — `input-sources/` はユーザー所有の読み取り専用素材。直すのは要件記述側だけ。
- **要件の変更・機能追加** — 「実装と記述の食い違いを正す」ことと「仕様を変える」ことは別。
  仕様変更は `/ayatori-req-delta` (UI 生成前) / `/ayatori-delta` (完成後)、機能追加は `/ayatori-add-feature`。
- **承認フラグの押印** — `approvals.*` には一切書かない (完走判定・入場判定の SoT を汚さない)。

**位置づけ**: 生成 (Phase 0b reverse) → **補正 (本 phase)** → 変更 (Phase 1c / 1d / 5)。
反復実行可能で、改修対象が変わるたびに新しい run として走らせる。

## Evidence Sources

突合先は 3 種。**すべて Phase 0b が残したオンディスクの実物**を読む (live な外部システムは読まない —
行アンカーが無い参照は再監査できず、突合の根拠にならない):

| 種別 | 実体 | 引用文法 | 効力 |
|---|---|---|---|
| code | `input-sources/{stack}/` | `input-sources/{stack}/path/to/file.ext:line` (範囲 `:line-line` 可) | 一次ソース。存在する限り **code 勝ち** |
| docs | `ground-truth/` 直下 `*.md` | `ground-truth/{file}.md:line` | 仕様書は挙動の根拠になる。`jira-{KEY}.md` は時点の変更要求記録のため裏取り止まり (仕様を覆す根拠にしない) |
| figma | `ground-truth/figma/` | `ground-truth/figma/{file_key}/{node}--{slug}.design-context.md:line` / トークン値は `ground-truth/figma/{file_key}/variables.json:line` / 純粋に視覚的な根拠のみ同 `.png` (行なし) | 視覚・構造・文言・トークン値のみ。**挙動の根拠にはならない** |

⚠️ **引用は必ず上表のフルパス形で書く** (`.../search.py:42` のような省略形にしない) — 引用検証
(`scripts/check-source-citations.mjs`) は `input-sources/` / `ground-truth/` の接頭辞で引用を抽出するため、
省略形は**抽出されず検証を素通りする**。「疑義なし」が「検証していない」を意味してしまう。

引用文法と例外規則 (in-repo 文書の主張を code 事実として扱わない等) の SoT は
`skills/reverse/02-source-analysis/SKILL.md` の「Source Evidence Rule」。本 phase はそれを再定義せず参照する。

**衝突規則**: code が存在する限り code 勝ち。code 不在の run では視覚・構造の主張は figma 勝ち、
挙動の主張は docs 勝ち。ただし **code と食い違ったときに即「code 勝ち」で決着させない** — まず自分の
誤読を疑って読み直す (Step V2 の再読プロトコル。優先順位規則だけでは間違った読みがそのまま勝ち残る)。

## Entry Condition

リバースを完走したプロジェクトを前提とする。**キーの推測ではなく `ls` の実測で判定する**:

```pseudo
requirements.json.status == "REVERSE_ENGINEERED"
  AND requirements/01-overview.md 〜 08-constraints.md が実在
  AND screens/00-screen-list.md が実在
```

不成立なら以下を表示して phase を終える (無言で続行しない):

> 「本コマンドはリバース (`/ayatori-reverse`) で要件を起こしたプロジェクトの記述を、改修対象に絞って
>  証拠ソースと突合し直すためのものです。{不足している材料} が見つかりません。
>  - まだリバースしていない → `/ayatori-reverse`
>  - リバースが途中で止まっている → `/ayatori-reverse` (中断位置から再開します)
>  - forward パイプラインで作ったプロジェクト → 本コマンドの対象外です (要件と実コードの対応関係が
>    リバース産とは異なります)」

`screens/{slug}.md` が 1 件も無い場合は **entry 自体は成立させる** (要件文書だけを突合対象にできる)。
ただし範囲提示のときに「画面仕様が無いため画面記述の突合は行わない」を明示する。**画面仕様を新規生成
してはならない** — 本 phase は既存記述の訂正のみを担う。

## Preamble

1. Read `pipeline.yaml` to confirm phase configuration. If `skip_phases` includes `"reverse_verify"`:
   display "⏭ reverse-verify フェーズをスキップします（pipeline.yaml → skip_phases 設定）" and end this phase.
   - **外部コマンド検知 (CLAUDE.md Operating Principle 5)**: 進行中に `/ayatori-*` 以外の外部コマンド
     (`/kairo-*` `/rev-*` `/tdd-*` `/direct-*` 等、または `command_policy.external_command_prefixes` に該当) を
     受信したら即実行せず、`command_policy.on_unrecognized_command` に従い停止してユーザーに確認する。
2. Use the Read tool on `skills/00-memory-load/SKILL.md` (pipeline file — not a registered skill) and follow
   the instructions it contains.
3. **Determine `{app_name}`** (受け取り書式は `phases/reverse/SKILL.md` Preamble step 3 と統一する):
   - **プロジェクト引数 bypass**: 起動メッセージが「プロジェクト: {app_name}」形式でプロジェクト名を含み
     `artifacts/{app_name}/` が存在する場合は、選択を出さずに採用し、採用したことを 1 行で表示する。
     **ただし採用前に Entry Condition を `ls` で実測して確認する** — 候補列挙の経路は「リバース完走済」で
     絞り込むのに bypass だけ無検査だと、forward パイプラインで作ったプロジェクト (対象外と明記した種類)
     に記述訂正を掛けてしまう。不成立なら採用せず Entry Condition の案内文を表示して終了する。
   - `ls artifacts/` で候補を列挙し、上記 Entry Condition を満たすもの (= リバース完走済) だけを候補にする。
     - **候補 0 件** → Entry Condition の案内文を表示して終了する (候補一覧を出さない)。
     - **候補 1 件** → それを採用し、1 行で表示する。
     - **候補 2 件以上** → `1 + 候補数` が 4 以下なら `AskUserQuestion`、5 以上なら plain chat の番号付き
       リストで選ばせる (`AskUserQuestion` の option 上限は 4)。各候補には進行中 run の有無を併記する
       (例: `my-app — 進行中の突合あり (次: Step V2)` / `my-app — 進行中の突合なし`)。**無言で採用しない**。
4. **Operating Principle 3 ディレクトリ走査 (必須)**:
   - `ls artifacts/{app_name}/` を実行し、`input-sources/` の有無と配下の `{stack}` を列挙する。
     `ground-truth/` と `ground-truth/figma/` の有無も確認する。
   - `reverse-engineered/source-inventory.json` を **読み取り専用で** 再利用する (`roles` / `degraded_mode`)。
     **本 phase は inventory を書き換えない** (writer は Phase 0b Preamble のみ)。
   - **inventory 上 code present なのに `input-sources/` が不在** → 無言で二次要約に fallback せず
     **ユーザーに確認する**: 「`artifacts/{app_name}/input-sources/{stack}/` が見つかりません。実コードを
     配置して再実行するか、文書・Figma のみで突合するか確認させてください」。
   - 実測結果は Step V1 が `reverse-verify/scope-manifest.json` の `sources` に記録する
     (inventory の申告ではなく**この実測値**が本 run の縮退判定の根拠)。
5. **live 外部読みを行わない宣言**: 本 phase は Confluence / Jira / Figma の MCP を呼ばない。証拠は
   `ground-truth/` のアーカイブのみ。したがって `FIGMA_MCP_ENABLED` の状態は本 phase の実行条件に
   影響しない。**アーカイブが足りない場合の正しい対処は「収集し直す」= `/ayatori-reverse` の差分収集**であり、
   本 phase が live 取得で穴を埋めることはしない (引用先が行アンカーを持たなくなるため)。
5b. **Pre-flight Gate — Operating Principle 4** [main session 専用]:
   実行手順 (a)-(g) と append 経路は `skills/_shared/preflight-gate.md` を Read して従う (本 Gate の SoT)。
   本 phase の入力契約値:
   - `next_step` = 6 / `gate_before_step` = Step V1
   - `target_artifacts` = `"requirements/*.md,screens/*.md"` — (b) の `--target-artifacts` にはこのリテラルをそのまま渡す (prose や placeholder `{slug}` を渡すと path 形でない token として drop され、有効 token 0 件 = exit 2 → 全件 ask に fail-open して振り分けが無効化される)。訂正対象は承認範囲内の要件文書と画面仕様書
   - `append_sources` = Step V2 は `requirement-deviations.json` に append (phase=reverse_verify)
   - 固有注記: 本 phase は「対象の解釈」に (D) UNCERTAIN が出やすい (ユーザーの言う機能名が
     どの要件セクション・どの画面を指すかが割れる)。割れた場合は補完せず Step V1 の範囲ゲートで
     候補を提示して選ばせる (ゲートが既にあるので `pending-questions.json` への追い出しは不要)
6. **Determine resume position** — `pipeline-state.json.reverse_verify.runs[-1]` を読み、上から評価して
   最初に一致した位置から再開する (first match wins)。`runs` 不在 / 空なら新規 run:
   - `completed_at` or `cancelled_at` が set → 直前 run は決着済 → **新規 run** として Step V1 へ
   - `findings_resolved_at` が set (かつ `completed_at` 未 set) → **下記 Completion のみ実行する**
     (Step V3 へは戻さない — この印は反映と台帳書き戻しまで完了した合図であり [V3 の実行順は
     反映 → 台帳 → 押印]、戻すとスナップショットが訂正後の内容で上書きされて検査の基準線が壊れ、
     訂正 Edit も二重適用になる)
   - `crosscheck_completed_at` が set → Step V3 の人間ゲートから再開 (**スナップショットは
     既にあれば上書きしない** — V3 の冪等ガード)
   - `scope_approved_at` が set → Step V2 から再開
   - `scope_approved_at` が未 set (= V1 の範囲ゲートで中断した run stub) かつ
     `reverse-verify/scope-manifest.json` が実在し `run_id` が一致 → **Step V1 の範囲ゲートのみ再提示**
     (範囲の導出はやり直さない — 候補集合は manifest に確定済みで、残っているのは人間の判断だけ)
   - 上記いずれにも該当しない → Step V1 の冒頭から
6b. **中断 run の扱い** — **Step V2 / Step V3 から再開する場合のみ** 実行し、それ以外の rung では
   飛ばす。理由は rung ごとに異なる:
   - `findings_resolved_at` rung (= Completion のみ) → **聞かない**。反映と台帳書き戻しは終わっており
     放棄できる作業が無い。ここで「破棄」を選ばせると、訂正をファイルに適用済みの run が
     `completed_at` 無しの `cancelled_at` として記録され、履歴が実態と食い違う。
   - V1 の範囲ゲート再提示 rung (stub のみ) → **聞かない**。範囲ゲート自身に「C. 中止」があるため、
     ここで聞くと中止の選択肢が 2 連続になり往復が 1 回無駄になる。
   - **Step V2 / Step V3 から再開する場合のみ** `AskUserQuestion` で 1 回聞く (この 2 つは範囲承認済で
     ゲートを持たないため、放置すると別の対象を突合できず、ダッシュボードの推奨も占有され続ける):
   > 「対象「{target_description}」の突合が {resume 位置} で中断しています。どうしますか?」
   - **続ける** (推奨) → 上記 resume 位置から実行する。
   - **破棄して別の対象を突合する** → 2 つを実行してから Step V1 の冒頭で新規 run を始める:
     1. `reverse_verify.runs[-1]` に `cancelled_at` (現在時刻) + `cancel_reason: "user_abort"` を merge
        して Write back する (訂正済みの記述は元に戻さない — 既に人間が承認した反映であり、破棄するのは
        run の続きだけ)。
     2. `requirement-deviations.json` から **本 run が初めて検出した unresolved entry だけを削除する**
        (`phase == "reverse_verify" && run_id == {破棄する run} && resolved_at 未 set`
        **かつ `first_run_id == run_id`**)。V3 の人間判断を受けていない検出結果であり、残すと
        「誰も保留していない項目」が未解決として台帳に残り続け、ダッシュボードの未解決件数を汚す。
        - ⚠️ **`first_run_id` の条件を必ず併せる** — 過去 run で人間が「保留」を選んだ項目は Step V2 が
          `run_id` を本 run へ書き換えて引き継ぐため (`skills/reverse-verify/02-targeted-crosscheck/SKILL.md`
          の reconcile 規則)、`run_id` だけで絞ると **人間の保留判断がここで消える**。
          `first_run_id` が本 run と異なる entry は削除せず、`run_id` を `first_run_id` の run へ戻して
          元の所有者に返す (欠落している entry は「不明」として削除しない — 安全側)。
        - **resolved 済み entry は残す** (人間の判断は破棄しない)。削除は自 phase・自 run に限る。
     3. 削除の前後で保全検査を通す (上記の取り違えを機械で止める):
        ```bash
        node scripts/check-deviations-preserved.mjs snapshot \
          artifacts/{app_name}/requirement-deviations.json \
          --out artifacts/{app_name}/reverse-verify/.deviations-before.json
        # … 2 の削除を実行 …
        node scripts/check-deviations-preserved.mjs verify \
          artifacts/{app_name}/requirement-deviations.json \
          --snapshot artifacts/{app_name}/reverse-verify/.deviations-before.json \
          --run-id {破棄する run_id}
        ```
        exit 1 なら消し過ぎている — snapshot から復元してから新規 run に進む。

## Execution

### Step V1: Target & Scope (対象確定 + 関連範囲の人間承認)

Use the Read tool on `skills/reverse-verify/01-target-scope/SKILL.md` (pipeline file — not a registered skill)
and follow the instructions it contains.

改修対象 (機能名 / 画面名、任意で Jira 課題キー) を受け取り、関連範囲 — 要件文書のセクション / 画面仕様 /
文書アーカイブ / Figma frame / コード module — を導出して `reverse-verify/scope-manifest.json` に記録し、
**人間ゲート (承認 / 範囲修正 / 中止)** を通す。承認時に `reverse_verify.runs[]` の初回エントリと
`scope_approved_at` を書き、コード読み取り計画を `reverse-verify/.code-inventory.json` に確定する。

### Step V2: Targeted Cross-Check (承認範囲だけの突合)

Use the Read tool on `skills/reverse-verify/02-targeted-crosscheck/SKILL.md` (pipeline file — not a registered skill)
and follow the instructions it contains.

承認範囲の記述を主張 (claim) 単位に列挙し、3 証拠ソースと突合する。コードは module 限定の shard worker で
読み直し、**contradicted 候補は必ず別角度で再読してから確定する** (再読プロトコル — 誤読を先に疑う)。
Output: `reverse-verify/crosscheck-report.md` + `requirement-deviations.json` (phase=reverse_verify, run_id 付き)。

### Step V3: Discrepancy Gate (食い違いの人間判断 + 記述への反映)

Use the Read tool on `skills/reverse-verify/03-discrepancy-gate/SKILL.md` (pipeline file — not a registered skill)
and follow the instructions it contains.

食い違いを view で提示し、項目ごとに **修正 / 容認 / 保留** を人間が判断する。承認された修正のみを
`requirements/*.md` と `screens/{slug}.md` に反映し、マーカー保持を機械検査する。

## Completion

Step V3 完了後:

1. **run 完了の記録**: `pipeline-state.json` を Read (不在なら init stub `{ "app_name": "{app_name}" }`) →
   `reverse_verify.runs[-1].completed_at` に現在時刻 (ISO 8601。Bash の `date` で取得 — 推測で組み立てない)
   を merge して Write back。**他キーは変更せず保持する** (特に `approvals.*` には一切触れない)。
2. **成果物インデックスの再生成** (fail-open — 失敗しても Completion を止めない):

   ```bash
   node scripts/build-artifact-index.mjs artifacts/{app_name}
   ```

3. Display — **表の数字は出典から読む**: `{corrections_applied}` / `{markers_cleared}` /
   `{findings_deferred}` / `{findings_total}` は `pipeline-state.json.reverse_verify.runs[-1]` から、
   `{claims_total}` / `{backed}` / `{contradicted}` / `{unverified}` と参照した証拠の件数は
   `reverse-verify/crosscheck-report.md` の Coverage 節から読む。**推測で埋めない** — 読めない項目は
   「記録なし」と書く (別セッションで Completion だけを再開した場合に起きやすい)。

> 「Phase 0c (対象限定突合) 完了 — 対象: {target_description}
>
>  | 項目 | 結果 |
>  |---|---|
>  | 突合した主張 | {claims_total} 件 (根拠あり {backed} / 食い違い {contradicted} / 未検証 {unverified}) |
>  | 参照した証拠 | code {code_modules} module / 文書 {docs} 件 / Figma {frames} frame{縮退時は「(code 不在のためコード裏取りなし)」等を併記} |
>  | 人間判断 | 修正 {corrections_applied} / 容認 {findings_total - corrections_applied - findings_deferred} / 保留 {findings_deferred} |
>  | 推測マーカー解除 | {markers_cleared} 件 (人間承認済 — 根拠が付いて確定記述へ昇格) |
>  | 訂正した文書 | {corrections_docs をカンマ区切り。0 件なら「なし (記述は証拠と一致)」} |
>
>  📄 突合レポート: `artifacts/{app_name}/reverse-verify/crosscheck-report.md`
>  📋 食い違い一覧: `artifacts/{app_name}/requirement-deviations-view.html`
>  📦 全成果物インデックス: `artifacts/{app_name}/index.html`
>
>  {findings_deferred > 0 なら「⚠️ 保留 {findings_deferred} 件は台帳に未解決で残っています。同じ対象を
>   再度突合すると再提示されます。」}
>
>  次のステップ:
>  - 別の対象を突合する → 本コマンドを再実行 (新しい run になります)
>  - 改修に進む → `/ayatori-add-feature` (機能追加ヒアリング) / `/ayatori-delta` (完成後変更) /
>    `/ayatori-req-delta` (UI 生成前の要件変更)
>  - UI をまだ作っていない → `/ayatori-design`」

4. 続けて別対象を突合するかを `AskUserQuestion` で 1 回だけ聞く (`終了` / `別の対象で続ける`)。
   `別の対象で続ける` を選んだ場合は Step V1 の冒頭から新しい run を開始する (`run_id` を新規採番)。

## Feedback Log

人間ゲートが修正指示を返した場合 (Pattern A)、エージェントの誤りで手戻りした場合 (Pattern B)、
パイプライン設計上の欠陥を見つけた場合 (Pattern C) は `artifacts/{app_name}/feedback-log.md` に append する
(書式は CLAUDE.md「Feedback Log」)。

特に **再読プロトコルで「誤読だった」と判明したケースは Pattern B として必ず記録する** — 生成時の
どの読み方が誤りを生んだかの記録が、リバース側 (Phase 0b) の改善材料になる。
