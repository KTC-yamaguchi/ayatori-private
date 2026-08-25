---
name: 10-sample-human-review
description: 09 で生成された 3 案サンプル HTML を人間が見比べて A/B/C のいずれかを選択する。Phase 2 の Step 10 で呼ばれ、選択後に design-brief.yaml へ selected 情報を記録する。
---

# 10 サンプル選択（人間ゲート）＋ design-brief.yaml に selected 情報記録

## 役割

09 で生成された 3案サンプル HTML を人間が見比べて A/B/C のいずれかを選択する。選択後、`design-brief.yaml` のトップレベル frontmatter に `schema: design-brief:final:v1` と `selected_sample_id` / `selected_label` / `approved_at` を追加する。**`cases[]` 配列は 3 案分そのまま保持**（retro で棄却案データを参照できるよう履歴保存、`docs/interface-contracts.md` §10 OUT 規定）。12 以降は `yaml.cases[selected_sample_id]` を filter して読む。

**次ステップ**:
- 承認（A/B/C 選択）→ `skills/12-design-system/SKILL.md` を Read して 12 を実行
- 否認（やり直し）→ `skills/08-design-brainstorm/SKILL.md` を Read して Phase 2 を 08 からやり直す

## 前提条件

- 09 完了: `artifacts/{app_name}/design-samples/{platform}/index.html` が存在
- 08 完了: `artifacts/{app_name}/design-brief.yaml`（3案版・schema:draft:v1、SSOT）

**人間 UX**: 人間は `design-samples/*/index.html` を見て判断する。yaml を直接読む必要はない。

---

## 実行指示

### Phase 1: サンプルファイルの存在確認

`artifacts/{app_name}/design-samples/` 配下を確認:
- 各プラットフォームディレクトリ（web / mobile）に `index.html` が1つずつ存在
- 存在しない場合は 09 に戻すようエラー報告

### Phase 1.5: 成果物 preview の提示

人間ゲート提示の前に、`skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。本 step は HTML が複数 platform 分あるため、`pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets["10-sample-human-review"] = "design-samples/{first_platform}/index.html"` で最初の platform の index.html を 1 つだけ auto-open する。残りは clickable link 一覧のみで提示。

組み立てる `artifacts_to_review`:

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}
platforms = ["web", "mobile"] のうち artifacts/{app_name}/design-samples/{p}/index.html が存在する {p} だけを **この固定順** で残す
first_platform = platforms[0]                          # 固定順なので ls の並び (OS/環境差) に依存せず決定的 (web 優先、無ければ mobile)

artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/design-samples/{p}/index.html", label: "{p} サンプル (3案切替式)" }
  for p in platforms
]
```

shared helper 経由で:
- `first_platform`/index.html がブラウザで自動起動
- 残りの platform は clickable link で一覧表示

完了後に Phase 1.6 へ進む。

### Phase 1.6: Step 09 構造差 fail-loud フラグの確認

`artifacts/{app_name}/pipeline-state.json` を Read し、`selections.step09_structure_warning` が存在するか確認する。存在する場合のみ、Phase 2 の選択肢提示メッセージの**冒頭に**次の警告を差し込む（存在しなければ何もしない）:

```
⚠️ 構造差チェックの注意（自動検出）
Step 09 の構造記述子チェックで、{platform} の案 {collisions[].pair} が「色だけ違い、主コンテンツ一覧の構造（列数 / 並べ方 / アイテム構成）が同一」と判定されました。bounded 再生成でも解消しませんでした。
各サンプル HTML 上部にも同じ警告バナーが出ています。3 案が本当に構造的に違うかを目視で確認し、不足なら「やり直し」を選んでください（構造的に十分違う＝誤検出と判断するなら、そのまま案を選んで続行して構いません）。
```

このフラグは fail-loud（サイレント通過防止）の受け皿であり、選択肢を縛らない。判断は完全にユーザーに委ねる。フラグの解消（クリア）は Phase 3 で行う。

### Phase 2: 選択肢の提示（AskUserQuestion）

以下のメッセージを表示して選択を促す (HTML link / auto-open は Phase 1.5 で提示済み):

```
【サンプル画面レビュー ゲート 10】

3案のサンプル画面が生成されました。上記 preview の link / 自動起動したブラウザで見比べて選んでください。
各 HTML 上部の「A案 / B案 / C案」ボタンで切替ながら比較してください。

3案の方向性:
- A案: {案A の方向性名} — {concept 1文}
- B案: {案B の方向性名} — {concept 1文}
- C案: {案C の方向性名} — {concept 1文}
```

AskUserQuestion で以下の選択肢を提示:

```
Q. どの案を選びますか？
- A案: {方向性名}
- B案: {方向性名}
- C案: {方向性名}
- やり直し（08 デザインブレストから再実行）
```

選択は完全にユーザー判断。エージェント側で優先度付けや推奨表示は行わない。

### Phase 3: 選択結果の処理

#### 3.1 A / B / C 選択の場合

**Step 1: design-brief.yaml の schema / selected 情報更新**

既存 `artifacts/{app_name}/design-brief.yaml` を Read し、**トップレベルのメタ情報のみ**更新する。**`cases[]` 配列は 3 案分そのまま保持**（棄却案データを retro で参照できるよう履歴保存、`docs/interface-contracts.md` §10 OUT 規定）。

変更点は以下 4 箇所のみ:

```yaml
schema: "design-brief:final:v1"       # ← draft:v1 から更新
# 以下 3 行を追加（元は存在しない）
selected_sample_id: "A"               # A / B / C
selected_label: "{選択案の方向性名}"
approved_at: "{YYYY-MM-DD}"

# common, cases[A], cases[B], cases[C], differentiation_summary, anti_slop_check は
# 既存値をそのまま保持（削除・改変しない）
```

**yaml 更新の不変量**:
- `cases[]` 配列は削らない（A/B/C の 3 エントリを維持）
- 他のフィールド（common / differentiation_summary / anti_slop_check / attempt_count 等）は既存値を保持
- schema タグの更新と selected 系 3 フィールドの追加のみに留める（SSOT 原則）

**Step 2: pipeline-state.json.selections に selected 情報を記録**

`artifacts/{app_name}/pipeline-state.json` を Read or `{}` で lazy 初期化し、`selections` セクションに merge:

```json
{
  "selections": {
    "selected_sample_id": "a",            // or "b" / "c"（小文字）
    "selected_sample_direction": "影の間"
  }
}
```

> `selections.step09_structure_warning` が存在する場合は、選択確定をもって役目を終えるため **削除（unset）してから Write back** する（人間が構造差を確認の上で選択した = 解消済み）。

> 旧版では requirements.json に書いていた。本 PR で cross-phase hot state は pipeline-state.json に集約 (memory 設計判断)。requirements.json には書かない (INPUT 専用)。

**Step 3: design-samples/ を .archive/ へ退避**

将来参照・監査のため、現時点の `design-samples/` をアーカイブディレクトリへ移動:

```
artifacts/{app_name}/design-samples/  →  artifacts/{app_name}/.archive/design-samples-{YYYY-MM-DD-HHMMSS}/
```

これで `design-samples/` は空になる。12 以降は `design-brief.yaml.cases[selected_sample_id]` を参照するので、サンプル HTML は不要。

**Step 4: 完了報告**

```
案{A/B/C}: {方向性名} で確定しました。
- design-brief.yaml の schema を final:v1 に更新、selected_sample_id / selected_label / approved_at を追加（cases[] は 3 案保持）
- pipeline-state.json.selections に selected_sample_id = "{a/b/c}" / selected_sample_direction を記録
- 旧 design-samples/ を .archive/design-samples-{timestamp}/ へ退避

次に 12 でデザインシステム（tokens.json / style-guide.md）を生成します。
```

→ `skills/12-design-system/SKILL.md` を Read して 12 を実行。

#### 3.1.5 修正フィードバック（部分変更）の場合

ユーザーが「A案ベースで色だけ変えて」「B案の書体を C案のものに」のような**部分修正**を指示した場合、または将来の `revision_mode: "partial"` 系フィードバックを受け取った場合は、編集前に必ず **`skills/00-feedback-protocol/SKILL.md` を Read** して 4 ステップ（影響範囲洗い出し → 1スクリプト一括修正 → grep/diff 検証 → 検証レポート）を遵守する。

特に design-samples/ は **3 案 × N platform** で同一クラス／hex が散在するため、Step 1 の洗い出し（`grep -rn "{old_value}" artifacts/{app_name}/design-samples/`）を**必ず**先に実行する。

#### 3.2 「やり直し」選択の場合（08 に戻る）

> **位置付け**: このやり直しは WCAG 自動ループ（11↔08）とは**別軸**の「人間レビュー差戻しループ」（AYATORI 仕様書 v1.4 §⑪ に準拠、ループ上限なし・人間判断優先）。WCAG ループ履歴 (wcag-history.json) はこの差戻しで**ファイルごと削除**されるため (W2-α: ファイル削除パス)、08→11 再実行後に古い attempt_count が残って即座に上限到達扱いになるバグを避けられる。

**Step 1: Phase 2 成果物のクリーンアップ (W2-α: ファイル削除パス)**

```
- artifacts/{app_name}/design-samples/ を削除
- artifacts/{app_name}/design-brief.yaml を削除
- artifacts/{app_name}/wcag-mapping.json を削除 (ループ不変量も再生成、11 が初回 write モードに戻る)
- artifacts/{app_name}/wcag-history.json を削除 (履歴を完全リセット)
- artifacts/{app_name}/pipeline-state.json の selections.selected_* および selections.step09_structure_warning を削除 (Read or {} → unset → Write back。再生成するので構造差フラグも破棄)
```

> 旧版の「wcag-mapping.json を初期状態に上書き (constraints/criteria/violations/wcag_loop を完全削除)」は廃止。W2-α の確定により、履歴メカニズムは 1 種に統一 (ファイル削除のみ)、retro は feedback-log.md で audit する。

このあと 08→11 再実行されると、11 が初回 write モードで wcag-mapping.json (constraints/criteria) を再生成し、wcag-history.json を空配列で lazy 初期化する。

**Step 2: feedback-log.md に Pattern A で記録**

```markdown
- **[10] 人間レビュー/やり直し**: 人間が3案すべてを否認しブレスト再実行 → 08 から再開
```

**Step 3: 完了報告**

```
やり直しが選択されました。08 デザインブレストから再実行します。
ヒアリング回答は保持されず、再度6軸ヒアリングを行います。
```

→ `skills/08-design-brainstorm/SKILL.md` を Read して 08 を実行。

---

## 出力サマリー

### 承認（A/B/C 選択）時

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/design-brief.yaml` | **schema を final:v1 に更新 + `selected_sample_id` / `selected_label` / `approved_at` を追加**。`cases[]` は 3 案保持 |
| `artifacts/{app_name}/pipeline-state.json` | `selections.selected_sample_id` / `selected_sample_direction` を記録 |
| `artifacts/{app_name}/.archive/design-samples-{timestamp}/` | 旧 design-samples/ を退避 |
| `artifacts/{app_name}/design-samples/` | 空になる |

### 否認（やり直し）時 (W2-α: ファイル削除パス)

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/design-brief.yaml` | 削除 |
| `artifacts/{app_name}/design-samples/` | 削除 |
| `artifacts/{app_name}/wcag-mapping.json` | 削除 (11 が次回 init で再生成) |
| `artifacts/{app_name}/wcag-history.json` | 削除 (履歴完全リセット) |
| `artifacts/{app_name}/pipeline-state.json` | `selections.selected_*` および `selections.step09_structure_warning` を unset (他セクションは保持) |
| `artifacts/{app_name}/feedback-log.md` | Pattern A 記録を追記 |

---

## 参照

- `docs/interface-contracts.md` §10 — 契約仕様
- `skills/08-design-brainstorm/refs/design-brief-template.md` — 3案版と1案版の違い
- `skills/08-design-brainstorm/SKILL.md` — 否認時の戻り先

---

## Phase 2 TODO（申し送り）

Phase 1（現在）では **再生成のみ**（A/B/C 選択 or 完全やり直し）を実装している。Phase 2 では以下を実装:

1. **`revision_mode` の2値分岐**
   - `"full"`: 今の「やり直し」相当（6軸ヒアリング含む全再生成）
   - `"partial"`: 軸別の部分変更（色だけ / 書体だけ / モーションだけ）
2. **部分変更UI**
   - 「A案の方向性は OK、色だけ違う」→ `revision_target: "color"` + feedback-log に具体要望を記録
   - 「A案の書体を B案のものに変更」→ 08 が差分ヒアリング起点に使う
3. **微修正指示の構造化**
   - 修正指示テキストを yaml の専用フィールドに構造化格納（現状未実装）
4. **否認時のヒアリング保持**
   - `"full"` でもヒアリング回答は保持できるオプション
