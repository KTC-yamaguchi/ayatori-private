---
name: 25d-state-pattern-approval
description: 25b で生成・25c で採点した sub-state HTML 群について、人間に最終承認・修正指示・skip を判定してもらう sub-state 専用の人間ゲートである。Phase 3 の Step 25d として実行され、承認なら 25e へ、修正指示なら 25b へ戻し、skip なら Phase 4 retro へ移行する。
---

# 25d パターン人間ゲート (sub-state)

## 役割

25b で生成・25c で採点が完了した sub-state HTML 群について、人間に最終承認・修正指示・skip を判定してもらう。

3 つの結果:
- **承認** → 25e (Figma 追加出力) へ進む
- **修正指示** → 25b に戻り該当 sub-state を再生成
- **skip (Figma 追加なしで Phase 3 完了)** → 25e を skip して Phase 4 retro へ移行

Step 21 (main HTML 人間ゲート) と独立した sub-state 専用ゲート。

## 前提条件

- Step 25c 完了 (`pipeline-state.json.screens.step25c.completed_at` が立っている)
- `state-pattern-scores.json.attempts[]` が空でない (最新 attempt が存在)
- `pipeline-state.json.screens.step25b.completed_files[]` が空でない

---

## 実行指示

### Phase 0: Read inputs

以下を Read する:

1. `artifacts/{app_name}/screens/state-pattern-scores.json` — `attempts[-1]` (最新スコア + tags + details + coverage_check)
2. `artifacts/{app_name}/pipeline-state.json` — `screens.step25b.completed_files[]` (ファイルパス一覧、user 確認用)
3. `artifacts/{app_name}/figma-state.json` — `nodes.screens` から default 状態の Figma URL 抽出 (質問本文に埋め込み)
4. `artifacts/{app_name}/screens/state-pattern-plan.json` — pattern summary (画面数・state 種別)
5. `artifacts/{app_name}/requirement-deviations.json` — `phase: "substate"` の unresolved entry (25c が append した要件外追加。不在 / 0 件なら Step 0-2 を skip)

#### Step 0-1: 採点済み assert (採点スキップ防止の第 1 層)

AskUserQuestion を出す **前に**、25c が最新の 25b 出力を採点済みであることを hard assert する。「オーケストレータが 25c を飛ばして人間確認に出せてしまう」再発防止:

```
b = pipeline-state.screens.step25b.completed_at
c = pipeline-state.screens.step25c.completed_at
assert b is set                       # 25b で sub-state が生成済み
assert c is set and epoch(c) >= epoch(b)   # 25c が最新の 25b 出力を採点済み (timestamp 順序。
                                           # 比較は epoch 換算 — +09:00 / Z 等の TZ 表記が混在すると
                                           # 文字列比較では新旧が逆転するため)
assert state-pattern-scores.json.attempts[] is non-empty  # 採点履歴が存在
```

assert 失敗時は **AskUserQuestion を起動せず中断** し、以下を表示して 25c へ差し戻す:

```
⚠ Step 25c (sub-state 採点) が未実施、または最新の 25b 出力を採点していません。
25d 人間ゲートの前に必ず 25c を通してください (画面間一貫性チェックのため)。
→ skills/25c-state-pattern-score/SKILL.md を Read して Step 25c を実行してから 25d を再実行してください。
```

> **二層防御**: 本 assert は早期・明示の第 1 層。仮に本 assert を経ずに `pipeline-state.json` へ 25d 承認 (`approvals.patterns_human_approved` 等) を書こうとしても、PreToolUse hook `.claude/hooks/enforce-substate-scoring.sh` が同じ条件で exit 2 block する (機械強制の第 2 層)。

#### Step 0-2: 要件外追加リストの per-item 解決

Phase 0 の Read 5 で `phase: "substate"` の unresolved entry が 1 件以上ある場合、Phase 1 の承認ゲートの前に
`requirement-deviations-view.html` を案内し、`docs/principle4-disambiguation.md` **§5.5 の per-item 判断プロトコル**
を実行して 1 件ずつ判断を受ける。main session が `resolution` + `resolved_at` + `resolution_mode` (§5.5.3:
per-item・番号指定 = individual / 全件容認の明示選択のみ = bulk) を書き戻し、
`node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` で view を再生成する。
判断に「修正依頼」が含まれる場合は Phase 2 Branch B (修正指示) と同じ経路で 25b へ差し戻す
(その場合 Phase 1 の承認ゲートは修正反映後の再実行で提示する)。

> 従来 25c が append した substate 逸脱を提示・解決する導線が本 skill に無く、unresolved のまま retro まで
> 残置されていた (宣言 [pipeline.yaml readers / docs/artifact-file-responsibility.md 責務マップ「21・25d human gate」] と実装の乖離)。本 step が導線を実装する。

### Phase 1: AskUserQuestion (3 択)

#### Section 1: 承認ゲート (single select)

AskUserQuestion で以下を提示する。`header` は 12 文字以内厳守:

```
header: "Sub-state 承認"

question: |
  Sub-state HTML の生成と採点が完了しました。
  Figma に追加出力するか確認してください。

  ## 採点結果 (25c attempt {n}/{max})
  - スコア: {score}/100
  - AI 改善可能な指摘: {ai_improvable_deductions} 件
  - 主要タグ: {tags[:5] を comma 連結}

  ## 指摘の主要なもの
  {details[:5] を「ファイル名: issue (severity)」形式で列挙}
    (全 details は state-pattern-scores.json.attempts[-1].details を参照)

  ## 対象ファイル ({completed_files.length} 件)
  - artifacts/{app_name}/screens/web/{画面名}--empty.html
  - artifacts/{app_name}/screens/web/{画面名}--loading.html
  - artifacts/{app_name}/screens/web/{画面名}--error.html
  - artifacts/{app_name}/screens/mobile/{画面名}--empty.html
  - ... (全件は pipeline-state.json.screens.step25b.completed_files[] を参照)

  ## Figma default 状態 (確認用)
  {figma-state.json.nodes.screens の default URL を 1 件抜粋}

options:
  - label: "承認 (25e Figma 追加出力へ)"
    description: "patterns_human_approved=true を記録、25e で Figma に sub-state node を追加 capture"
  - label: "修正指示 (25b に戻る)"
    description: "次の質問で修正内容を自由記述。feedback-log.md に Pattern A を記録、該当 sub-state を再生成"
  - label: "skip (Figma 追加なしで完了)"
    description: "sub-state HTML は残すが Figma には追加せず、Phase 4 retro へ移行"
```

AskUserQuestion のテキスト規律 (リテラル UTF-8 / 質問・option は短く / 背景は直前の plain chat に先出し) は `skills/00-memory-load/SKILL.md` の Standing Rules (text encoding + presentation) に従う。動的展開する `figma-state.json.nodes.screens` の URL や details[] の long text は質問本文・option description に入れず、直前の plain chat / 別表示に逃がす。

### Phase 2: 結果反映

#### Branch A: "承認"

`pipeline-state.json` を Read or {init stub} → merge:

- `approvals.patterns_human_approved = true`
- `approvals.step25d_approved_at = <現在 ISO 8601>`
- `screens.step25d.completed_at = <現在 ISO 8601>`
- `screens.step25d.approved = true`
- `screens.step25d.decision = "approve"`
- `app_name` assert
- Write back

完了報告:

```
Sub-state パターンを承認しました (patterns_human_approved=true)。
→ 25e で Figma に sub-state node を追加 capture します
→ skills/25e-figma-pattern-export/SKILL.md を Read して 25e を実行
```

#### Branch B: "修正指示"

##### Step B-1: 修正内容を user に求める (新メッセージで受領)

Claude Code の AskUserQuestion は **option-select 専用** であり text input は仕様上保証されていない。そのため自由記述は AskUserQuestion ではなく **次の新メッセージで user に直接記述してもらう** 方式を採用する (Step 21 の人間レビューと同型):

```
以下の情報を新しいメッセージで記述してください:

1. 修正対象 ({completed_files} のうち、修正したい sub-state ファイルパス。複数可)
2. どう修正したいか (自由記述、例: "loading skeleton を form 入力欄の形に揃えて")

例:
- screens/web/01-login--loading.html: loading skeleton を form 入力欄の形に揃えて
- screens/mobile/02-dashboard--error.html: error banner を画面上部固定にして
- 全 mobile の empty: illustration を中央配置に

この内容は feedback-log.md に Pattern A として記録され、25b 再生成時の指針になります。
```

user の回答 (次の新メッセージ) を受領したら次の Step B-2 に進む。

##### Step B-2: feedback-log.md に Pattern A 記録

`artifacts/{app_name}/feedback-log.md` を Read or 新規作成 → append:

```markdown
- **[25d] 人間ゲート/修正指示**: {user 回答全文} → 該当 sub-state を 25b で再生成
  - 採点スコア: {score}/100 (attempt {n}/{max})
  - 指摘されたタグ: {tags}
  - 修正対象 (user 推定): {details[].file から抽出 or user 回答から抽出}
```

##### Step B-3: pipeline-state.json 更新 + 25b の completed_files から該当 file を remove

`pipeline-state.json` を Read or {init stub} → merge:

- `screens.step25d.completed_at = <現在 ISO 8601>`
- `screens.step25d.approved = false`
- `screens.step25d.decision = "revise"`
- `approvals.patterns_human_approved` には書かない (false を明示しなくて良い、未確定 = 未承認)
- (25c と同様、再生成対象を pending に戻す): `screens.step25b.completed_files[]` から user 修正対象を remove + `completed_at` を unset
- `app_name` assert + Write back

完了報告:

```
修正指示を feedback-log.md に記録しました。
→ skills/25b-state-pattern-gen/SKILL.md を Read して該当 sub-state を再生成します
→ 再生成後は 25c → 25d を再度実行します
```

#### Branch C: "skip (Figma 追加なしで完了)"

`pipeline-state.json` を Read or {init stub} → merge:

- `screens.step25d.completed_at = <現在 ISO 8601>`
- `screens.step25d.approved = false`
- `screens.step25d.decision = "skip_without_figma"`
- `approvals.patterns_human_approved` には書かない (sub-state HTML はあるが Figma 同期は user が見送った状態)
- `app_name` assert + Write back

完了報告:

```
Sub-state を Figma に追加せず Phase 3 完了に進みます。
sub-state HTML ({completed_files.length} 件) は残しますが figma-state.json には追加しません。

→ Phase 4 retro へ進みます (Phase 5 delta は final_approved=true で起動可能)
→ skills/26-retro/SKILL.md を Read して 26 を実行
```

---

## 失敗時の挙動

| 失敗 | 対応 |
|---|---|
| AskUserQuestion で ESC | `screens.step25d.completed_at` を **書かない** → 次回 25d 再起動 (state 未確定) |
| Branch B で user が空回答 | feedback-log.md に「修正内容未記入」として Pattern A 記録、25b に戻るが pending は空のまま → 25b 即時完了 → 25c 即時 → 25d 再質問 (実質ループ) |
| feedback-log.md write 失敗 (permission denied) | warning を出力、pipeline-state.json の `decision` 更新は継続 |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/pipeline-state.json` | `approvals.{patterns_human_approved, step25d_approved_at}` (Branch A), `screens.step25d.{completed_at, approved, decision}` (全 Branch) |
| `artifacts/{app_name}/feedback-log.md` | Branch B で Pattern A を append |

## 参照

- `schemas/pipeline-state.schema.json` — `approvals.patterns_human_approved`, `approvals.step25d_approved_at`, `screens.step25d` block
- `schemas/state-pattern-scores.schema.json` — 入力 schema
- `skills/21-screen-human-review/SKILL.md` — main HTML 人間ゲートの構造参考
- `skills/25b-state-pattern-gen/SKILL.md` — Branch B の戻り先
- `skills/25e-figma-pattern-export/SKILL.md` — Branch A の次ステップ
- `skills/26-retro/SKILL.md` — Branch C の次ステップ
