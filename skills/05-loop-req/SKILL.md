---
name: 05-loop-req
description: 採点結果に基づき次のアクションを決定する。Phase 1b の Step 05 で呼ばれ、scoring-history.json から状態を導出して合格・再採点・エスカレーションを分岐制御する。
---

# 5 フィードバックループ制御（要件）

## 役割
採点結果に基づき次のアクションを決定する。

## 実行指示

`pipeline.yaml` の `requirements.loop.per_axis_min` と `max_attempts` を読む。
`artifacts/{app_name}/scoring-history.json` を読み込み、以下のロジックで分岐する。`rubric.json` には書き込まない (criteria 定義のみのファイル、read-only)。エスカレーション情報は `pipeline-state.json` 等には保持せず、`scoring-history.json` 自身から導出する (memory 設計判断)。

**前処理: 状態の導出**

```
attempts        = scoring-history.json.attempts
attempt_count   = len(attempts) - 1                    # 0 始まり (今 append された attempt の番号)
current         = attempts[-1]                          # 末尾 = 今回の結果
total           = current.total
scores          = current.scores
ai_improvable_count   = current.ai_improvable_count
human_required_count  = current.human_required_count
deficiencies          = current.deficiencies

axis_min        = pipeline.yaml.requirements.loop.per_axis_min   # 既定 12
under_min_axes  = [axis for axis in scores if scores[axis] < axis_min]
axis_min_ok     = (under_min_axes が空)
max_attempts    = pipeline.yaml.requirements.loop.max_attempts  # 既定 3
escalated       = (len(attempts) >= max_attempts AND (total < 80 OR not axis_min_ok))   # 導出のみ。ファイルに書かない
```

**分岐:**

```
if human_required_count >= 1:
    「人間対応必要な deficiency が {human_required_count}件 あります。人間エスカレーションします。」と表示
    人間対応必要な deficiency 一覧を表示
    → skills/07-human-gate-req/SKILL.md を Read して実行 (escalated 状態は導出のみ)

elif total >= 80 and axis_min_ok:
    「要件スコア {total}点・全軸 {axis_min}点以上で合格しました。Confluence保存へ進みます。」と表示
    → skills/06-confluence-save-req/SKILL.md を Read して実行

elif total >= 80 and not axis_min_ok:
    # 低次元平均での逃げ道を塞ぐ: 合計は達成したが特定軸が落第
    「合計 {total}点は閾値超えですが、以下の軸が最低点 {axis_min}未満です: {under_min_axes}」と表示
    if len(attempts) >= max_attempts:
        → skills/07-human-gate-req/SKILL.md を Read (軸別最低点未達 + escalated を伝える)
    else:
        該当軸の AI改善可能な deficiency のみ表示し「attempt {attempt_count + 1}/{max_attempts}: 軸別底上げのためループします」と表示
        → skills/02-iso-breakdown/SKILL.md を Read して②からやり直す
        (②→③(skip)→④ を実行すると 04-scoring が新しい attempt を append する)

elif len(attempts) >= max_attempts:
    「{len(attempts)}回のループでスコアが{total}点に留まりました。人間エスカレーションします。」と表示
    → skills/07-human-gate-req/SKILL.md を Read して実行 (escalated を伝える)

else:
    AI改善可能な deficiency のみ表示し「attempt {attempt_count + 1}/{max_attempts}: 以下の点が不足しています（AI修正対象）」と表示
    → skills/02-iso-breakdown/SKILL.md を Read して②からやり直す
    （②が deficiencies の tag=AI改善可能 のみを参照して修正する）
```

**分岐の優先順位:**
1. `human_required_count >= 1` → 即座に人間へ（AI が勝手に補完すると事実と異なる仮定が混入するリスク）
2. `total >= 80` かつ 全軸が `per_axis_min` 以上 → 合格
3. `total >= 80` だが軸別最低点未達 → 上限未達ならループ、上限ならエスカレーション
4. `len(attempts) >= max_attempts` → 上限エスカレーション
5. それ以外 → AI 改善可能な deficiency のみ ② に渡してループ

## ファイル更新

本 step は **どのファイルにも書き込まない**。
- ループバック時: 04-scoring が次回呼び出された際に attempts に新しい entry を append する。`attempt_count` の更新は導出値なので不要。
- エスカレーション時: 旧版の `escalated: true` の rubric.json への書込みは廃止 (`len(attempts) >= max_attempts AND attempts[-1] が pass 未達` で導出する)。

---

> **閾値の正規定義**: `pipeline.yaml` の `requirements:` → `loop:` セクション。
> **score_file**: `pipeline.yaml.requirements.loop.score_file` = `scoring-history.json`。
