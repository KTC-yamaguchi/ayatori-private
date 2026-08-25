---
name: 13-human-gate-design
description: 生成されたデザインシステム（トークン + スタイルガイド + パーツカタログ）を人間が確認・承認する。Phase 2 Step 13 の人間ゲートとして、要件トレース監査と成果物 preview を提示した上で承認を得る。
---

# 13 人間確認（スタイルガイド）

## 役割
生成されたデザインシステム（トークン + スタイルガイド + パーツカタログ）を人間が確認・承認する。

## 実行指示

### 要件トレース監査（Step 13 gate 前）

ゲート提示の前に、`design-brief.yaml` の **case / token / dial を列挙し、各要素を `requirements.json` に全件マップ** (§5.2 forced-enumeration、列挙総数を `coverage[]` `phase="design"` に記録)。マップできない要素（AI が想像で足したトーン / 色 / 機能前提等）を `artifacts/{app_name}/requirement-deviations.json`
に append（`phase="design"`, `raised_by_step="13-human-gate-design"`）し、`node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` を実行して `requirement-deviations-view.html` を決定論的に生成する（手焼き禁止）。手順詳細は `docs/principle4-disambiguation.md` §5。

### Step 0: 成果物 preview の提示

人間ゲート提示の前に、`skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。本 step は HTML パーツカタログが「主要 1 つ」のため、`pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets["13-human-gate-design"] = "screens/style-guide-view.html"` で auto-open。

組み立てる `artifacts_to_review`:

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}

artifacts_to_review = [
  { kind: "md",   abs_path: "{artifacts_root_abs}/style-guide.md",                label: "スタイルガイド (MD)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/style-guide-view.html", label: "パーツカタログ (HTML)" },
]
```

shared helper 経由で:
- `style-guide-view.html` がブラウザで自動起動
- `style-guide.md` は clickable link で提示 (VSCode 拡張で ⌘+click)

完了後に Step 1 へ進む。

### Step 1: スタイルガイド本文の提示 + 承認ゲート

`artifacts/{app_name}/style-guide.md` と `artifacts/{app_name}/screens/style-guide-view.html`（ブラウザで確認）を案内し、ユーザーの確認を待つ:

```
【スタイルガイド確認ゲート 13】

以下のデザインシステムが生成されました (上記 preview から開けます)。

--- artifacts/{app_name}/style-guide.md の内容をここに表示 ---

【人間による事前確認チェックリスト (dual-theme × domain)】

スタイルガイドを承認する前に、以下を必ず目視確認してください。Phase 3 (ayatori-screens) に進んでから漏れに気付くと、Phase 2 へ正規差し戻しの大きな手戻りになります。

- [ ] **両テーマカバレッジ**: `requirements.json.design_output_scope.dual_theme_mode == true` の場合、style-guide.md と style-guide-view.html に全 token の dark / light 両 hex が記載・表示されているか
- [ ] **Domain surfaces の網羅**: アプリ固有の持続的 UI 面 (盤面マス / カード面 / マップ地形 / グラフ系列 / スコアパネル等) が `palette.domain_surfaces[]` に列挙され、両テーマ分の hex が定義されているか。汎用 palette だけで足りる場合は `domain_surfaces_rationale` で明示されているか
- [ ] **NFR 由来 pair の解消**: requirements/06-non-functional.md で「視認性 / 識別 / contrast / 判別 / 読みやすさ」を要求する NFR について、wcag-history.json 最新 attempt の **loop 対象 violations** (`pair_kind ∈ {palette, domain_surface}`) が空になっているか。空でなく残存している場合は attempt 上限到達 (warning_passthrough) を意味し、AA 未達を承知で人間が本ゲートで承認/差し戻しを判断する (11 へは戻さない — skill 09 Phase 1 / interface-contracts.md:739 と同じ扱い)。warn-only の `state_colors` は残存可 (Step 21 Section 1-E で再判断)。**wcag-history.json 不在 / attempts 空 = 未検証** — 「違反なし」と誤読して承認せず、Step 11 実行を要求する (legacy / 手動 stub 経路で wcag-history 不在のまま本ゲートへ resume し得る。Step 12 ゲートと同じ扱い、レビュー対応)。NFR ↔ pair の照合は Phase 3 で skill 19 NFR Coverage が能動的に逆引きするため Step 13 では「loop 対象 violations: [] かどうか」だけ確認すれば十分
- [ ] **両テーマでの視認性目視**: パーツカタログ (style-guide-view.html) を OS 設定で light / dark を切替えてブラウザリロードし、両モードで全 swatch + 全 component サンプル + domain surface サンプルが意図通りに見えるか (特に駒 / カード等の domain 要素が surface 上で識別可能か)

- [ ] **要件外追加リスト**: `requirement-deviations-view.html` を開き、design-brief / tokens に *要件に無い想像補完* が無いか確認。未解決分は承認時に **1 件ずつ判断を受ける** (view の `#N` 番号で対話する — `docs/principle4-disambiguation.md` §5.5、下記「承認の場合」Step 0)

✅「承認」または「OK」→ Phase 2 完了（新しい会話で /ayatori-screens を実行してください）
✏️「修正: {修正内容}」→ デザインシステムを修正します
🎨「ブレストからやり直す」→ 08 デザインブレストからやり直します
```

## 承認後の処理

### 承認の場合

> **重要**: 以下の Step 1 を **必ず物理的に Write** すること。narrative としての読み流しは禁止。Skill 10 の Phase 3 と同型の構造で書いてあるのはこのため。Write back を怠ると次セッションの `/ayatori-screens` 入口で「Phase 2 未完了」と誤判定される。

**Step 0: 要件外追加リストの per-item 解決**

`requirement-deviations.json` に `phase: "design"` の unresolved entry が残っている場合、Step 1 の前に
`docs/principle4-disambiguation.md` **§5.5 の per-item 判断プロトコル** を実行して 1 件ずつ判断を受け、
`resolution` + `resolved_at` + `resolution_mode` (individual / bulk は §5.5.3 の表どおり) を書き戻す
(main session が単一 writer)。**個別指定なしの「承認」を無言で全件容認に読み替えるのは禁止**。
書き戻し後 `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` で view を更新する。
判断の中に「修正依頼」が含まれる場合は下記「修正の場合」の手順に合流する (Step 1 の承認記録はその修正が解消してから)。

**Step 1: pipeline-state.json に承認時刻を記録 (本 skill の単一責務)**

1. `artifacts/{app_name}/pipeline-state.json` を Read。存在しなければ `{ "app_name": "{app_name}" }` で lazy 初期化。
2. `approvals.step13_approved_at` に **現在時刻の ISO 8601 datetime (`Z` または offset 付き、例: `2026-05-21T15:30:00+09:00` / `2026-05-21T06:30:00Z`) を merge**。他キー (`approvals.step07_approved_at` 等、`selections.*`、`confluence.*`) は既存値を保持。
3. Write back。

書き込み形 (例):

```json
{
  "app_name": "{app_name}",
  "approvals": {
    "step13_approved_at": "2026-05-20T15:30:00+09:00"
  }
}
```

> `requirements.json` には書かない (INPUT 専用)。

**Step 2: Write 後の検証 (必須)**

書き込んだ直後に同ファイルを Read し、`approvals.step13_approved_at` が実際に設定されていることを確認する。

- ✅ 設定されている → Step 3 へ進む。
- ❌ 設定されていない / 空 → **最大 1 回だけ Step 1 を retry**。それでも設定されなければ `feedback-log.md` に Pattern B (`[13] step13_approved_at write 失敗: Skill 13 retry 後も pipeline-state.json に書き込まれず`) を記録した上で **ユーザーに明示報告して停止** する (Completion の safety-net に委ねず明示的に停止することで、原因調査の機会を残す)。サイレントに Completion へ進むのは禁止。

**Step 3: 完了報告**

```
✅ Step 13 承認時刻を pipeline-state.json.approvals.step13_approved_at に記録しました ({ISO 8601 datetime})。
```

→ Phase SKILL.md の Completion セクションへ戻る (Phase 2 完了メッセージを表示して終了。Step 14 以降は /ayatori-screens の新しいセッションで実行する)。

### 修正の場合（軽微）:
→ 修正指示を `artifacts/{app_name}/feedback-log.md` に追記（パターンA: 人間ゲート）
→ **`skills/00-feedback-protocol/SKILL.md` を Read** して 4 ステップ（影響範囲洗い出し → 1スクリプト一括修正 → grep/diff 検証 → 検証レポート）を遵守する。
→ tokens.json の値を変えた場合、`style-guide.md` / `style-guide-view.html` / 既存 `screens/{web,web-sm,mobile}/*.html`（あれば、platform フォルダ配下を再帰）まで**全件 grep して対象を列挙**してから一括置換すること。CSS と HTML は同一スクリプトでセット修正。
→ 検証完了後に 13 を再表示する。

### ブレストからやり直しの場合 (W2-α: ファイル削除パス)

→ 以下を **削除** してから skills/08-design-brainstorm/SKILL.md からやり直す:
  - `artifacts/{app_name}/design-brief.yaml`
  - `artifacts/{app_name}/wcag-mapping.json` (11 が次回 init で再生成 — 旧版の `design_decision` field 参照は廃止、本フィールドは schema に存在しない broken reference だった)
  - `artifacts/{app_name}/wcag-history.json` (履歴完全リセット)
  - `artifacts/{app_name}/tokens.json`
  - `artifacts/{app_name}/style-guide.md`
  - `artifacts/{app_name}/style-guide-view.html`
  - `artifacts/{app_name}/screens/` 配下全ファイル
  - `artifacts/{app_name}/scores.json` (Phase 3 履歴のリセット)
  - `artifacts/{app_name}/session-handoff.md` (本ファイルは disposable summary であり state SoT ではないため、無条件で削除してよい。Phase 3 進捗の有無は `pipeline-state.json` 側 (`approvals.screens_human_approved` / `approvals.final_approved` 等) で表現されており、session-handoff.md 削除では失われない)
  - `artifacts/{app_name}/pipeline-state.json` の **以下キーを unset** (Read or `{}` → key 削除 → Write back):
    - `selections.*` (全フィールド)
    - `approvals.step13_approved_at`
    - **Phase 3 由来の state も無効化**: デザインを最初からやり直す = 旧 design に基づく Phase 3 成果物が invalid になるため、以下も unset:
      - `approvals.step16_approved_at`
      - `approvals.screens_human_approved`
      - `approvals.final_approved`
      - `confluence.design.save_count` (再度 Confluence 保存が必要)
      - `confluence.design.doc_page_ids` (旧 page ID は廃棄)
      - `screens.*` (step17~25 の完了タイムスタンプ群)
    - **保持するキー**: `approvals.step07_approved_at` (Phase 1b 完了は無効化しない)、`confluence.requirements.*` (要件 Confluence 保存は無効化しない)、`app_name`。本リストは exhaustive ではない — 列挙外の既存 key (残存 `schema_version` 等) も merge でそのまま保持する
    - `delta.runs[]` / `req_delta.runs[]` は実行履歴 (append-only) として保持
