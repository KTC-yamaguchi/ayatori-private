---
name: 01-ground-truth
description: 証拠ソース (Confluence 文書 / Jira 課題 / ローカル文書 / Figma) を収集して ground-truth/ にアーカイブする evidence collection オーケストレーター。source-inventory.json の棚卸し結果に従い present なソースの sub-module のみ実行する (ソース別冪等)。Phase 0b で Step 02 の前に実行され、code-only inventory では skip される。
---

# Step 01: Ground-Truth Collection (証拠収集オーケストレーター)

## Purpose

Collect the cross-check evidence sources into `artifacts/{app_name}/ground-truth/` so that every
downstream step (Step 02 analysis, Step 03 provenance refs, Step 04 comparison, Step 05 audit) reads **stable,
line-anchorable on-disk archives** instead of live external systems:

- **Confluence spec pages** → root-level `ground-truth/{page}.md` (sub-module: `refs/confluence-docs.md`)
- **Jira issues** → root-level `ground-truth/jira-{KEY}.md` (sub-module: `refs/jira-docs.md`)
- **Local documents** (`input-sources/docs/` の md / txt / pdf) → root-level `ground-truth/local-{stem}.md` (sub-module: `refs/local-docs.md`)
- **Figma captures** → `ground-truth/figma/` (sub-module: `refs/figma-capture.md`)

収集 (転写) は解釈を要しない機械作業のため、各 sub-module は worker subagent (`model: haiku`) に
分離して実行し、main context には件数サマリだけを返す。収集量が閾値を超える場合は sub-module 内の
**予算ゲート**が数字 (件数 + 予想所要) を提示して範囲をユーザーに選ばせる — 黙って全量収集を始めない。

Run once before Step 02. **Idempotent per source** — a source whose archive already exists is
skipped individually; the step never re-collects everything just because one source is new.

## When to Run

Read `artifacts/{app_name}/reverse-engineered/source-inventory.json` (written by the phase Preamble):

- docs or figma is present → run this step (only the present sources' sub-modules)
- code-only inventory (docs も figma も absent) → skip this step entirely, proceed to Step 02

## Inputs

- `artifacts/{app_name}/reverse-engineered/source-inventory.json` → sources / roles
- `artifacts/{app_name}/requirements.json` → `confluence_parent_id`
- `artifacts/{app_name}/input-sources/docs/` → ユーザー配置のローカル文書 (md / txt / pdf。writer は user のみ — 本 step は読むだけ)

## Process

### A0: Sub-module dispatch (ソース別冪等判定)

Evaluate each row; run the sub-modules whose 実行条件 is met and 済み判定 is not:

| Source | 実行条件 (inventory) | 済み判定 (skip if true) | Sub-module |
|---|---|---|---|
| Confluence 文書 | `sources.docs.confluence_parent_ids` 非空 (互換: 旧 `confluence_parent_id` 単数 set も 1 要素として扱う) | **確定範囲の page-ID 集合 ⊆ 収集済み page-ID 集合** かつ `index.md` が存在 | A1 → Read `skills/reverse/01-ground-truth/refs/confluence-docs.md` and follow it |
| ローカル文書 | `sources.docs.local_files` 非空 | 全 local file に対応する `ground-truth/local-{stem}.md` が存在 (ファイル別冪等) | Read `skills/reverse/01-ground-truth/refs/local-docs.md` and follow it |
| Jira 課題 | `sources.docs.jira_issue_keys` 非空 or `sources.docs.jira_jql` set | **確定範囲の key 集合 (`.jira-scope.json`。不在時は明示列挙 + JQL 列挙の全 key) に対応する `ground-truth/jira-{KEY}.md` が存在** (課題別冪等)。scope 確定済みなら JQL 再列挙も予算ゲート再発火もしない | Read `skills/reverse/01-ground-truth/refs/jira-docs.md` and follow it |
| Figma | `sources.figma.present && sources.figma.mcp_enabled` | inventory の全 `file_keys` について、`figma-manifest.json` の `frames[].node_id` が **確定 capture セット (`.capture-scope-{file_key}.json`) を全て含む** (確定セット不在時は frames が 1 件以上) | Read `skills/reverse/01-ground-truth/refs/figma-capture.md` and follow it |

⚠️ 済み判定はソース単位 — Confluence 済みでも Figma 未収集なら Figma sub-module だけ実行する
(`figma/` サブディレクトリの存在を「文書収集済み」と誤読しない・逆も然り)。

⚠️ **済み判定は「ファイルが 1 つでもあるか」ではなく「確定範囲を満たしたか」で行う** — 予算ゲート
/ 範囲確定ゲートで範囲を絞って 1 次収集を終えた状態は「その範囲については完了」だが、後から範囲を
広げる差分収集 (各 sub-module が page-ID / node_id 冪等で対応) は本 dispatch を再度通る必要がある。
存在ベースで判定すると、同じ sub-module が二度と起動できず差分収集の経路が塞がる。
確定範囲は Confluence が `.collection-scope.json`、Jira が `.jira-scope.json`、Figma が
`.capture-scope-{file_key}.json` に残す。

> **Confluence の parent ID をここでは聞かない** — inventory の
> `sources.docs.confluence_parent_ids` は Preamble が単一 writer として確定させる (資料 URL の
> 貼り付け判別、または requirements.json からの転記。複数親は要素として並ぶ — 上書きしない)。
> ID が無ければ本 row は発火せず、追加は Preamble へ差し戻す (同一 target を二度聞かない —
> Operating Principle 4 Rule 6)。

### A1: Confluence — document collection sub-module

Use the Read tool on `skills/reverse/01-ground-truth/refs/confluence-docs.md` and follow the instructions
it contains. The sub-module runs: D1 列挙 (本文なし) → D2 予算ゲート (50 ページ超は件数 + 予想所要を
提示して範囲を選ばせる。差分収集の再入では index の content status を推奨案に使う) →
D3.0 受信本文長の probe (独立測定 — 忠実度照合の正 + 本文量ベースの batch 分割材料) →
D3 worker fanout (`ayatori-doc-ground-truth-collector` subagent、streaming write、page-ID 冪等) +
batch ごとの受入検査 (fragment 実在・件数整合・ヘッダー形式 — agent の完了報告を受入の根拠にしない) →
D4 取得失敗の記録 → D4.5 転写忠実度の機械検査 (`scripts/check-ground-truth-fidelity.mjs`) →
D5 index 決定論生成。

### A2: Index regeneration (決定論 — 手書き禁止)

`ground-truth/index.md` は常に `node scripts/build-ground-truth-index.mjs {app_name}` の出力で、
手で書かない。Confluence sub-module は D5 で自ら実行するが、**ローカル文書・Jira 課題のみ追加・更新した場合も
ここで再実行**して index を最新化する (content status 判定込みの全量上書き)。
未収集 / 収集失敗の台帳 `ground-truth/.collection-failed.json` は script が既定パスとして自動で
読むため `--failed` の指定は不要 (別パスに置いた場合のみ渡す)。

(Figma captures are indexed by `ground-truth/figma/figma-manifest.json`, not by this file.)

### A3: Figma capture sub-module

When the A0 Figma row applies, use the Read tool on `skills/reverse/01-ground-truth/refs/figma-capture.md`
and follow the instructions it contains. The sub-module launches the
`ayatori-figma-ground-truth-collector` subagent so verbose Figma MCP responses stay out of the main
context, and archives per-frame evidence under `ground-truth/figma/`.

## Output

- `artifacts/{app_name}/ground-truth/*.md` — one file per Confluence page + `jira-{KEY}.md` per Jira issue + `local-{stem}.md` per local document (root level)
- `artifacts/{app_name}/ground-truth/index.md` — `scripts/build-ground-truth-index.mjs` の決定論生成。
  content status (本文 / 薄い / 殻 / 図のみ / テンプレート未記入 / ADF生JSON / 抽出本)・収集失敗・範囲外 (未収集)・
  参照されているが未収集 (リンク検出) を記録し、下流 (Step 02 / Step 03 / Step 05) の引用可否判断の入力になる
- `artifacts/{app_name}/ground-truth/{stem}.adf-extract.md` — ADF生JSON アーカイブごとの決定論テキスト抽出本
  (`scripts/extract-adf-text.mjs`)。下流は生 JSON ではなくこちらを読む・引用する
- `artifacts/{app_name}/ground-truth/figma/` — Figma capture archive (manifest + per-frame PNG / design-context / variables)

Display per collected source, e.g.:
"Ground-truth collected: {N} Confluence pages / {J} Jira issues / {M} local docs / Figma {F} frames archived to `artifacts/{app_name}/ground-truth/`"

さらに index の集計から、ユーザーが判断できる 2 行を続けて表示する (該当 0 件の行は省略):

1. **図のみ / 殻 の補完案内**: 「{K} 件は本文が図・画像のみでアーカイブに本文化されていません
   (例: {代表タイトル 2〜3 件})。図の内容が要件に必要な場合は、元ページから画像をエクスポートして
   `input-sources/docs/` に配置してください — 次回実行時に自動で取り込みます」。
   核心資料 (画面遷移図・設計図等のタイトル) が該当するときに黙って進むと、下流は「情報が無い」と
   誤読したまま要件を生成する — 補完手段が既にあるのだから、ここで能動的に提示する。
2. **参照未収集の差分収集案内**: 「アーカイブ本文から、収集範囲外のページ {R} 件への参照を検出しました
   (index の『参照されているが未収集』参照)。タイトルから重要そうなものがあれば page ID を指定して
   ください — 差分収集で追加します」。
