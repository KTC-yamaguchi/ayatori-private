---
name: 07-human-gate-req
description: 生成・採点された要件仕様書を人間が確認・承認する。Phase 1b の Step 07 で呼ばれ、承認提示の前に要件トレース監査を実行して AI が user 確定 input に無いのに書いた発明を一覧化する。
---

# ⑦ 人間承認（要件）

## 役割
生成・採点された要件仕様書を人間が確認・承認する。承認提示の前に **要件トレース監査 (forced-enumeration)** を実行し、
AI が user 確定 input に無いのに requirements へ書いた発明 (例: コア機能のスコアリング式・閾値・外部 API 連携の前提) を一覧化する。

## 0. 要件トレース監査 (forced-enumeration) — gate 表示前に必ず実行

requirements 層は Step 02 生成と本 step が **同一 session・同一 model** のため、inline 監査では self-bias (生成時の正当化を監査でも踏襲して発明を見逃す) が漏れる。これを構造分離で断つため、監査は **`ayatori-requirements-auditor` subagent に委譲**する (F-3b)。本 step は subagent を起動し、return された deviation candidates を **main session が単一 writer として** `requirement-deviations.json` に append する。手順・突合先・列挙定義の SoT は `docs/principle4-disambiguation.md` §5.1/§5.2 (参照のみ、コピペ禁止)。本 step は requirements 層 = **突合先が requirements.json 自体ではなく「user 確定 input」**である点が design/screens と異なる (§5.1)。

1. **`ayatori-requirements-auditor` を 1 回起動** (Task tool、`layer="requirements"`)。requirements 層は 8 ファイル全体の列挙整合性が要るため per-file 並列にせず 1 起動。prompt に Input 契約の値を渡す:
   - `layer`: `"requirements"` (auditor は layer で突合先を切替。requirements 層 = user 確定 input 突合)
   - `app_name` / `repo_root` (絶対パス起点) / `requirements_dir` (`{repo_root}/artifacts/{app_name}/requirements/`) / `ledger_path` (`{repo_root}/artifacts/{app_name}/pending-questions.json`) / `requirements_json_path` (`{repo_root}/artifacts/{app_name}/requirements.json`) / `provenance_path` (`{repo_root}/artifacts/{app_name}/generation-provenance.json`)。
   - subagent は「生成 context を持たない第三者」として **独立 forced-enum** + user 確定 input への **literal トレース**で判定し、generation-provenance の provenance ラベルは鵜呑みにせず再判定する (contract REQ-AUD-01〜05、`.claude/agents/ayatori-requirements-auditor.md`)。⚠️ `recommendations_accepted` の扱い (機能の存在のみ confirm、中の specifics はトレース対象) も subagent 側で踏襲する。
   - ⚠️ **フォールバック (registry 未反映時)**: subagent 起動が `Agent type not found` 等で失敗した場合 (agent 追加と同一 session で本 step を走らせた等、registry セッション縛りに起因)、**silent skip せず** main session が §5.2 の forced-enum を **inline で直接実行**して gate を継続する (self-bias は残るが「監査しない」より良い)。併せて `feedback-log.md` に Pattern C を 1 行記録: `- **[07] Pattern C**: ayatori-requirements-auditor 起動失敗 (registry 未反映の可能性) → inline forced-enum に fallback`。通常の fresh session (各 Phase = 1 会話) では agent は session 開始時に scan され発見されるため、本 fallback は稀。
2. **return を parse**: `---DEVIATIONS---` セパレータで分割し、メタ (`enumerated_count` / `enumerated_refs` / `checked_at` / `warnings`) と deviation candidates を取り出す。(`generator_specifics_count` は auditor が返すが、self-bias の集計は下記 `self_bias_signal` field で構造的に行うため本 step では使わない。)
3. **main が `requirement-deviations.json` に append** (single writer = 本 step。subagent は Write しない):
   Read or init-stub `{ "app_name": "{app_name}", "entries": [], "coverage": [] }` → 各 candidate を `entries[]` に append → Write back。
   - `phase`: `"requirements"` / `raised_by_step`: `"07-human-gate-req"` / `artifact` / `element` / `ref` / `deviation_kind` / `severity` / `requirement_ref` / `description` / `self_bias_signal` (subagent return をマップ)。`detected_at`: ISO 8601 を **main が付与** (hook R6 が必須 field を検証するため漏れに注意)。
   - subagent return の `self_bias_signal` (true のとき) は requirement-deviations schema の **同 field に転記**する (retro が `phase=requirements && self_bias_signal=true` で構造集計し Sunset 判定に使うため)。補助情報 `claimed_provenance` は schema を汚さないため `description` 末尾に `（生成側申告: {claimed_provenance}）` と折り込む。
4. **coverage 記録 (0 件でも必須)**: `coverage[]` に `{ "phase": "requirements", "raised_by_step": "07-human-gate-req", "enumerated_count": <subagent の enumerated_count>, "enumerated_refs": <subagent の enumerated_refs>, "checked_at": <ISO8601> }` を append (`enumerated_refs` は列挙の非決定性を補う run 間 diff 用)。
5. **Pattern D 記録 (F-3 効果 metric)**: subagent return に `provenance_mismatch: true` または `skipped_by_generator` が ≥1 件あれば `artifacts/{app_name}/feedback-log.md` に 1 行追記: `- **[07] Pattern D (Operating Principle 4 違反)**: generation-provenance self-bias 検出 {N} 件 (生成側が derived/user_verbatim と誤申告 or 未列挙 → 監査 subagent が AI 発明と再判定)`。retro が Pattern D として集計する。
6. **view 生成**: `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` を実行 (手焼き禁止、renderer が単一 SoT)。

> **盲点の明示 (§5.2 と同じ)**: 本監査は load-bearing specifics のみ列挙。散文ニュアンス・列挙外の発明は自動チェック外
> → **一覧が空でも「発明ゼロ」ではない**。gate での目視は省略しない (一覧は floor であって ceiling ではない)。
> **graceful degradation**: ledger が不完全でも subagent は 00-raw-input + 7 軸も突合先にするため、silent miss でなく false-positive (gate で容認) に留まる。`generation-provenance.json` が不在でも独立監査は続行する (subagent が provenance cross-check のみ skip)。

## 実行指示

### Step 0: 成果物 preview の提示

人間ゲート提示の前に、`skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。本 step は MD のみ (auto-open なし、link 一覧のみ — `pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets["07-human-gate-req"] = null`)。

組み立てる `artifacts_to_review`:

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}

# Confluence URL 組み立て:
#   pipeline-state.json.confluence.requirements.page_id は page ID 文字列のみ保存されており、
#   URL ではない (schemas/pipeline-state.schema.json L198-216 参照)。
#   pipeline.yaml.confluence.url_template の `{page_id}` を置換して clickable URL に変換する。
confluence_page_id = pipeline-state.json.confluence.requirements.page_id (null / 未保存なら omit)
confluence_url     = pipeline.yaml.confluence.url_template.replace("{page_id}", confluence_page_id) if confluence_page_id else null

artifacts_to_review = [
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/01-overview.md",         label: "01 プロジェクト概要" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/02-scope.md",            label: "02 スコープ定義" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/03-user-flow.md",        label: "03 ユーザーフロー" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/04-use-cases.md",        label: "04 ユースケース一覧" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/05-features.md",         label: "05 機能一覧" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/06-non-functional.md",   label: "06 非機能要件" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/07-data-definition.md",  label: "07 データ定義・外部連携" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/08-constraints.md",      label: "08 制約・前提・受け入れ条件" },
  { kind: "external_url", abs_path: confluence_url,                                              label: "Confluence (要件定義 親ページ)" } if confluence_url,
]
```

ファイル名は `skills/06-confluence-save-req/SKILL.md` の処理順 (canonical SoT) に準拠する。**変更時はそちらも同期すること**。実体は以下の固定 8 ファイル:

```
01-overview.md / 02-scope.md / 03-user-flow.md / 04-use-cases.md /
05-features.md / 06-non-functional.md / 07-data-definition.md / 08-constraints.md
```

shared helper Step 4 の link 一覧フォーマットでメッセージを出力。完了後に Step 1 へ進む。

### Step 1: スコア導出

`artifacts/{app_name}/scoring-history.json` を Read し、以下を導出する:

```
attempts        = scoring-history.json.attempts
current         = attempts[-1]
total           = current.total
deficiencies    = current.deficiencies
max_attempts    = pipeline.yaml.requirements.loop.max_attempts   # 既定 3
escalated       = (len(attempts) >= max_attempts AND
                   (total < 80 OR scores の一部が per_axis_min 未満))
```

旧 `rubric.json.escalated` フィールドは廃止 (本値はファイルに保持されない)。

**Confluence 保存結果の導出** (表示用):

```
save_status  = pipeline-state.json.confluence.requirements.save_status
verification = pipeline-state.json.confluence.requirements.verification   # 無ければ null (legacy / 保存 skip)
confluence_save_line =
  verification is null   # legacy state や保存 skip — 先に判定し、以降の分岐で verification.status を参照しない
      → "Confluence 保存: {save_status}"
  save_status == "success" and verification.status == "passed"
      → "Confluence 保存: success（漏れチェック: 全 {len(verification.pages)} ページ通過）"
  save_status == "success" and verification.status == "unverified" and verification.reason == "disabled_by_config"
      → "Confluence 保存: success（漏れチェック: 設定で無効化 — verification.enabled: false）"
  save_status == "success" and verification.status == "unverified"   # reason == "read_back_unavailable" 等
      → "Confluence 保存: success（⚠️ 漏れチェック未実施 — read-back 不可。Confluence 側の内容一致を目視確認してください）"
  save_status == "failed" and verification.status == "failed"
      → "Confluence 保存: failed（⚠️ 漏れチェックで欠落検出: {failed ページの doc_key と verification.missing を列挙}）"
  それ以外
      → "Confluence 保存: {save_status}"
```

**通常承認（escalated: false）の場合:**
以下を表示してユーザーの確認を待つ（Step 0 の成果物 preview は提示済み）:

```
【要件定義 承認ゲート ⑦】

スコア: {total}点 / 100点
{confluence_save_line}

要件外追加リスト (要件トレース監査): {unresolved deviation 件数} 件
  artifacts/{app_name}/requirement-deviations-view.html
  {unresolved deviation を「- #{N} {element} ({severity}) — {deviation_kind}」で 1 行ずつ列挙 (#N = view と共通の entries[] 番号)}
  ※ 一覧が空でも発明ゼロとは限りません (load-bearing specifics のみ列挙)。要件仕様書本文もご確認ください。

要件仕様書の内容をご確認ください (8 ファイル + Confluence URL は上記 preview から開けます)。
以下のいずれかで返答してください：

✅「承認」または「OK」→ Phase 2 デザインへ進みます (要件外追加が未解決の場合、承認の前に 1 件ずつ判断を受けます)
✏️「修正: {修正内容}」→ 指定箇所を修正して再確認します (要件外項目の削除/修正もここで指示)
🆙「#{N} (または {element}) を要件に昇格」→ 該当を requirements に正式追加 (今後は要件内扱い)
❌「却下」→ ①質問エージェントからやり直します
```

**エスカレーション（escalated: true）の場合:**
```
【要件定義 エスカレーション ⑦】

{len(attempts)}回のループを経てもスコアが{total}点に留まりました。
不足している点:
{deficiencies の一覧}

人間の判断が必要です。以下のいずれかで返答してください：

✅「このまま進む」→ 現状の要件でPhase 2へ進みます
✏️「修正: {修正内容}」→ 指定箇所を修正してPhase 2へ進みます
🔄「最初からやり直す」→ ①からやり直します
```

## 承認後の処理

承認（または「このまま進む」）の場合:
- **先に: 要件トレース監査の解決 (requirement-deviations.json 書き戻し、main session のみ)**: `phase: "requirements"` の unresolved
  entries に対し、**承認時刻の記録より前に** user 判断を反映する (Step 13 の Step 0 と同型。ゲート文面の「承認の前に
  1 件ずつ判断を受けます」と整合させる — 先に `step07_approved_at` を書いてしまうと、per-item 判断で「修正依頼」が
  出た時点で中断した場合に次セッションが Phase 1b 完了と誤判定する):
  - 「承認」で unresolved entry が残っている場合 → **一括容認せず**、`docs/principle4-disambiguation.md` **§5.5 の per-item
    判断プロトコル** を実行して 1 件ずつ判断を受ける (N ≤ 4 は AskUserQuestion に per-item 質問を束ねる / N ≥ 5 は
    「1 件ずつ」「番号指定」「全件容認 (N 件)」の受領方法を先に選ばせる)。書き戻しは §5.5.3 の表に従う —
    per-item / 番号指定 = `resolution` + `resolved_at` + `resolution_mode: "individual"`、
    「全件容認 (N 件)」を明示選択した場合のみ = `resolution: "容認"` + `resolved_at` + `resolution_mode: "bulk"`。
    ⚠️ 個別指定なしの「承認」を無言で全件容認に読み替えるのは禁止 (旧運用 — 「見ずに素通し」と「意図的に残す」が
    記録上区別できなくなるため廃止)。
  - 「#{N} (または {element}) を要件に昇格」→ 該当 entry に `resolution: "要件に昇格"` (+ `resolution_mode: "individual"`)。さらに **confirmed-decisions ledger
    (`pending-questions.json`) に resolved entry を append** して以後 re-flag されないようにする。entry は schema+hook R3 の
    **必須 field 全件**を埋める: `target` (該当 specific) / `question` (昇格判断の文) / `raised_by_step="07-human-gate-req"` /
    `raised_at` + `resolved_at` (ISO 8601) / `resolved_answer` ("要件に昇格")。⚠️ `raised_at`/`question` 省略は hook R3 で block。
    born-resolved entry には **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス) を書かない** —
    振り分け script は `resolved_at` が set の entry を読む前に抜けるため値が使われる経路が無い
    (`skills/_shared/preflight-gate.md` § append 経路)。
    必要なら `requirements/NN-*.md` の表現を「正式要件」として整える (この修正は下記「修正の場合」の 4 ステップに従う)。
  - 解決後 `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` を再実行して view を更新。
- 全 unresolved entry の解決後 (per-item 判断に「修正依頼」が含まれる場合はその修正が反映されてから)、
  `artifacts/{app_name}/pipeline-state.json` の `approvals.step07_approved_at` に ISO 8601 datetime を記録する
  (Read or {} → merge → Write back パターン)。
- `requirements.json` には書き込まない (INPUT 専用)。
- `rubric.json` / `scoring-history.json` にも書き込まない (本 step は state を pipeline-state.json にのみ書く)。
→ Phase SKILL.md の Completion セクションへ進む。

修正の場合:
→ 修正指示を `artifacts/{app_name}/feedback-log.md` に追記（パターンA: 人間ゲート）
→ **`skills/00-feedback-protocol/SKILL.md` を Read** して 4 ステップ（影響範囲洗い出し → 1スクリプト一括修正 → grep/diff 検証 → 検証レポート）を遵守する。
→ ユーザーの修正指示を artifacts/{app_name}/requirements/ 配下の該当ドキュメントに反映してから⑦を再表示する。
→ 要件外項目の **削除** 指示の場合: 該当を `requirements/NN-*.md` から除去し、`requirement-deviations.json` の該当 entry に
  `resolution: "修正依頼"` + `resolved_at` を記録 → view 再生成。

却下・やり直しの場合 (W2-α: ループ系ファイル削除パス):
→ 以下のファイルを **削除** または初期状態にリセットしてから skills/01-question/SKILL.md からやり直す:
  - `artifacts/{app_name}/requirements.json` (再生成のため削除)
  - `artifacts/{app_name}/rubric.json` (削除 — criteria 自体を再生成する)
  - `artifacts/{app_name}/scoring-history.json` (削除 — 履歴を完全リセット)
  - `artifacts/{app_name}/wcag-mapping.json` (削除 — Phase 2 不変量を再生成)
  - `artifacts/{app_name}/wcag-history.json` (削除 — Phase 2 違反履歴を完全リセット)
  - `artifacts/{app_name}/pipeline-state.json` (削除 — 全 cross-phase state をリセット)
  - Phase 2/3 のファイルも削除: `design-brief.yaml`, `tokens.json`, `style-guide-view.html`, `style-guide.md`, `scores.json`, `screens/`, `figma-state.json`

> 履歴のアーカイブ案 (rework-{ts}/) は採用しない (W2-α 確定: 履歴メカニズム 1 種に統一、retro は feedback-log.md で audit)。
