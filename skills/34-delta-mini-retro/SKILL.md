---
name: 34-delta-mini-retro
description: Phase 6 /ayatori-delta-mini の唯一の Step。delta phase (Step 27-30) と req_delta phase (Step 31-33) で発生した Pattern A/B/C エントリを対象に軽量な振り返りを行い、改善提案を artifacts/pipeline-improvements.md に append する。
---

# 34 Delta / Req-Delta Mini-Retro

## Role
Phase 6 `/ayatori-delta-mini` の唯一の step。delta phase (steps 27-30) と req_delta phase (steps 31-33) で発生した Pattern A/B/C エントリを対象に軽量振り返りを行い、改善提案を `artifacts/pipeline-improvements.md` に append する。

**設計の出発点 (scope B)**:
- Phase 4 retro (skill 26) は greenfield 完走後の 1 回前提でファイル全体を読む。
- Phase 6 は repeatable で、複数の `delta.runs[]` + `req_delta.runs[]` が pending な状態を一括処理する。
- scope 切り出しは **「retro-marker sentinel 以降」+「step 27-33 filter」** で行う (req_delta 由来の `[31-33]` と delta 由来の `[27-30]` の両方を拾う)。

## Preconditions
- `pipeline-state.json.approvals.final_approved == true` **OR** `pipeline-state.json.approvals.completed_at_states` is set **OR** (`pipeline-state.json.approvals.baseline_approved_at` is set **AND** `requirements.json.status == "REVERSE_ENGINEERED"` — 由来検査) (二段階完了モデル + reverse 基線例外 — CLAUDE.md 「完走後 Phase 共通 Entry Guard」が SoT)
- `delta.runs[]` または `req_delta.runs[]` に **`mini_retro_completed_at` 未 set** のエントリが少なくとも 1 件存在 (= pending run あり)
- `artifacts/{app_name}/feedback-log.md` が存在する

> 入口の存在判定は `phases/delta-mini/SKILL.md` の Preamble が行う。本 skill は呼び出された時点で前提が満たされている前提で実行する。

---

## Execution

### Phase A: Pending run 確定 + 対象エントリ抽出

#### A-1: pending run 一覧

`pipeline-state.json` を読み、以下を構築する:

```
pending_delta_runs    = [run for run in delta.runs if "mini_retro_completed_at" not in run]
pending_req_delta_runs = [run for run in req_delta.runs if "mini_retro_completed_at" not in run]
```

両方とも空なら呼び出し側 (`phases/delta-mini/SKILL.md`) で弾かれているはずだが、念のため再チェックし、空なら「✅ pending run なし」を表示して終了。

#### A-2: marker anchor 決定

`artifacts/{app_name}/feedback-log.md` を Read。末尾から逆順に grep し、最初に見つかった `<!-- mini-retro-marker: {run_id} / {ISO timestamp} -->` 行を anchor とする。

- marker が存在 → 当該行の **直後** から末尾までを scope window とする。
- marker が存在しない (このプロジェクト初の Phase 6) → `## ログ` セクション以降の全エントリを scope window とする。

#### A-3: エントリ抽出 (scope B = step 27-33)

scope window 内で、`- **[NN] PatternX ...**` 形式の行を抽出する。

正規表現 `\[([^\]]+)\]` で `[` と `]` の間のラベル文字列を全体抽出 (例: `"28"` / `"28/29"` / `"Phase 0 retro / 2026-05-22"`) → 抽出文字列を `/` で split → 各要素を strip 後 `int` パース (パース失敗要素は無視) → **得られた整数のうち 1 つでも `27 <= NN <= 33` を満たせば対象**。

> **複合 step 表記**: `[28/29]` のような複数 step を含むエントリは上記ロジックで `28` と `29` の両方を抽出し、いずれかが 27-33 範囲に入れば対象 (今回のケースでは両方が対象)。
> **schema 規約外ラベル**: `[Phase 0 retro / 2026-05-22]` のように全要素が `int` パース不能なラベルは silent skip (skill 26 が catch する範囲)。一部要素が int パース可能なラベル (例: `[28 / Phase 3 注記]`) は `28` のみで判定する。

抽出結果を `entries[]` とし、Pattern (A/B/C) 別に分類:
```
pattern_a_count, pattern_b_count, pattern_c_count = count by Pattern label
total_count = len(entries)
```

#### A-4: 0 件分岐 (skip 確認)

`total_count == 0` の場合:

AskUserQuestion で 1 度だけ確認:
```
質問: pending run ({len(pending_delta_runs)} delta + {len(pending_req_delta_runs)} req_delta) は存在しますが、対象エントリ (step 27-33 + marker 以降) は 0 件でした。mini-retro を skip しますか？
選択肢:
  1. Skip (Recommended) — 何も append せず Phase 6 を完了。marker のみ書き込み、pending run 全てに mini_retro_completed_at を set する。
  2. 念のため Phase 4 retro 同型のフル振り返りを実行 — scope window 内の全 Pattern A/B/C を対象に再抽出 (step filter なし)
```

- **「1. Skip」** → Phase F へ (skip path: `appended = false`, `pattern_count = 0`)
- **「2. フル振り返り」** → entries を scope window 内の全 Pattern A/B/C に再抽出し、Phase B 以降へ

#### A-5: 1 件以上 (自動 path)

そのまま Phase B へ進む。

---

### Phase B: パターン分析

skill 26 Phase B と同じ観点で各 entry を分類する:

1. **原因 step**: 27 / 28 / 29 / 30 (delta) または 31 / 32 / 33 (req_delta) のどれか
2. **欠陥の種類**: 出力定義の欠如 / プロンプトの欠如 / 制約の欠如 / ヒアリング軸の欠如
3. **防止可能性**: AI 単独で防げた / 人間判断が必要

「AI 単独で防げた」分類のみ Phase C で提案化する。

---

### Phase C: 改善提案生成

skill 26 Phase C と同じ **2 ビュー構造** で生成する:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
提案 #N
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【ユーザー向け要約】
問題:
  {非技術用語で 1-2 行}
次回からどう変わるか:
  {非技術用語で 1-2 行}
優先度: 高 / 中 / 低

【内部処理用】
対象ファイル: skills/NN-name/SKILL.md
追加箇所: {セクション名}
追加内容:
  ---追加ここから---
  {実際に追加するテキスト}
  ---追加ここまで---
根拠: {feedback-log.md のエントリ}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

提案の上限は **5 件** (skill 26 の半分、scope B でも上限維持)。

---

### Phase D: 数値サマリー表示

```
【Phase 6 mini-retro サマリー】

■ Pending run の概要
  Delta runs:     {len(pending_delta_runs)} 件
    - {run_id}: {change_description}
    ...
  Req-delta runs: {len(pending_req_delta_runs)} 件
    - {run_id}: {change_description}
    ...

■ feedback-log から拾った学び (marker 以降 + step 27-33 filter)
  Pattern A (人間ゲート修正指示): {pattern_a_count} 件
  Pattern B (Agent ミス/やり直し): {pattern_b_count} 件
  Pattern C (パイプライン設計欠陥): {pattern_c_count} 件
  合計: {total_count} 件 → 改善提案 {M} 件を生成
```

---

### Phase E: 人間承認ゲート (skill 26 Phase E パターン流用)

> **重要**: skill 26 Phase E と同型。テーブル禁止、AskUserQuestion は択一の大枠選択にだけ使う。

#### E-1: プレーンテキストで提案一覧を表示

```
【Phase 6 改善提案 — 承認フェーズ】

以下の {M} 件の改善提案が生成されました。

#1 [優先度: 高]
  問題: {要約}
  変化: {要約}

#2 [優先度: 中]
  問題: {要約}
  変化: {要約}

...
```

#### E-2: AskUserQuestion で大枠選択

```
質問: 上記の {M} 件の提案をどう扱いますか？
選択肢:
  1. 一括承認  — 全件そのまま pipeline-improvements.md に append
  2. 個別指示  — 一部を却下 / 修正したい (次ステップでチャット入力)
  3. 全件却下  — append せず Phase 6 完了 (marker のみ書き込み)
```

- **「1. 一括承認」** → 全件承認扱いとし、Phase F へ
- **「2. 個別指示」** → E-3 へ
- **「3. 全件却下」** → `appended = false` で Phase F へ

#### E-3: 個別指示をチャット入力で受け取る

```
以下のいずれかの形式でチャットに返信してください:

- 「#N を却下」
- 「#N を {新しい問題文 or 変化文} に修正」
- 複合指示例: 「#1 を {修正内容} に修正、#3 を却下、残り承認」

指示されなかった提案は承認扱いとする。
```

返信を受けたら、解釈をテキストで復唱して確認 (AskUserQuestion は使わない)。確認後 Phase F へ。

---

### Phase F: 適用 + 出力

#### F-1: `pipeline-improvements.md` への append (承認件数 > 0 の場合のみ)

`artifacts/pipeline-improvements.md` (artifacts/ 直下 — `{app_name}` 配下ではない、**全プロジェクト共有**) に section を append:

```markdown
---

## [Phase 6 mini-retro] {app_name} / {YYYY-MM-DD}

**対象 pending runs**:
- Delta: {pending_delta_runs[*].run_id をカンマ区切り}
- Req-delta: {pending_req_delta_runs[*].run_id をカンマ区切り}

**検出 Pattern 数**: A={N_A} / B={N_B} / C={N_C} (marker 以降 + step 27-33 filter)
**生成提案**: {M} 件 / 承認 {approved_count} 件 / 却下 {rejected_count} 件

### サマリー (ユーザー向け)

| # | 問題 | 次回からどう変わるか | 優先度 | 状態 |
|---|---|---|---|---|
| 1 | ... | ... | 高 | 適用済 |
...

### 詳細 (エンジニア向け・内部記録)

#### 改善 #1: {タイトル}
- **対象**: skills/NN-name/SKILL.md
- **追加箇所**: {セクション名}
- **適用内容**: {追加・変更したテキスト}
- **根拠**: {feedback-log のエントリ抜粋}

{#M まで繰り返し}

### 適用失敗・却下の内部記録

| # | 対象ファイル | 状態 | 詳細 |
|---|---|---|---|
| N | skills/NN-name/SKILL.md | 却下 / 適用失敗 | {Edit エラー or ユーザー却下理由} |
```

#### F-2: SKILL.md への適用 (承認件数 > 0 の場合のみ)

承認された提案を **Edit ツールで該当 `skills/NN-name/SKILL.md`** に書き込む。skill 26 Phase F と同じルール:
- 1 提案 = 1 Edit 操作
- Edit 失敗は「適用失敗: {理由}」として記録、F-1 の append 内容に反映
- 修正指示があった場合は修正内容を反映してから Edit

#### F-3: `feedback-log.md` 末尾に marker を append

run の outcome に関わらず **常に** 書き込む。run_id は「Phase 6 invocation 単位」の合成 ID (`phase6-{compact UTC timestamp, second granularity}`、例: `phase6-20260527T073252Z`) を使う (個別 run id ではなく、Phase 6 が処理した時点を表す)。秒粒度で同日複数 invocation の collision を回避する。

run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/feedback-log.md"
now = datetime.now(timezone.utc)
ts = now.isoformat()
marker_id = f"phase6-{now.strftime('%Y%m%dT%H%M%SZ')}"  # second granularity to avoid same-day collisions
marker = f"\n<!-- mini-retro-marker: {marker_id} / {ts} -->\n"
with open(path, "a") as f:
    f.write(marker)
print(f"OK: mini-retro-marker appended ({marker_id})")
PYEOF
```

#### F-4: `pipeline-state.json` 更新 (pending 全 run に mini_retro_* を書き込む)

run via Bash tool (substitute `__PLACEHOLDERS__` before running):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。"); exit(1)
data = json.loads(open(path).read())

now = datetime.now(timezone.utc).isoformat()
appended_bool = __APPENDED_BOOL__       # true / false
pattern_count = __PATTERN_COUNT__       # int (Phase A の total_count)

def mark_pending(runs_list):
    n = 0
    for run in runs_list:
        if "mini_retro_completed_at" not in run:
            run["mini_retro_completed_at"] = now
            run["mini_retro_appended"] = appended_bool
            run["mini_retro_pattern_count"] = pattern_count
            n += 1
    return n

n_delta = mark_pending(data.get("delta", {}).get("runs", []))
n_req = mark_pending(data.get("req_delta", {}).get("runs", []))

open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print(f"OK: mini_retro_* written to {n_delta} delta + {n_req} req_delta runs")
PYEOF
```

---

### Phase G: レビュー

```
【Phase 6 mini-retro 完了】

✅ 適用済み ({N}件):
  - 提案 #1: skills/28-impact-analysis/SKILL.md に additive/invasive 判別ロジック追加
  ...

❌ 却下 ({N}件):
  - 提案 #X: ...

⚠️ 適用失敗 ({N}件):
  - 提案 #Y: ...

📝 出力ファイル:
  - artifacts/pipeline-improvements.md (section append)
  - artifacts/{app_name}/feedback-log.md (marker append)
  - artifacts/{app_name}/pipeline-state.json
      → {n_delta} delta runs + {n_req} req_delta runs に mini_retro_* を書き込み
```

---

## Output

- `artifacts/pipeline-improvements.md` — `## [Phase 6 mini-retro] ...` section append (承認件数 > 0 のみ)
- `artifacts/{app_name}/feedback-log.md` — 末尾に mini-retro-marker append (常に)
- `artifacts/{app_name}/pipeline-state.json` — pending な delta.runs[] + req_delta.runs[] 全てに `mini_retro_completed_at` / `mini_retro_appended` / `mini_retro_pattern_count` を書き込み
- 承認された SKILL.md ファイル群 (Phase F-2 の Edit 結果)

## Resume

明示的 resume なし。中断時は同じプロジェクトで `/ayatori-delta-mini` を再起動すると、Phase 6 Preamble が再度 pending run を検出し、本 skill が再実行される。再実行時は marker がまだ書かれていないため、対象エントリ範囲は変わらない (idempotent)。
