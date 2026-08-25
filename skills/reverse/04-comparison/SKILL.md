---
name: 04-comparison
description: AYATORI が生成したリバース要件を ground-truth 文書アーカイブと突き合わせ、画面網羅性・機能忠実度・振る舞い詳細・ソース間衝突などの観点でスコア付きギャップ分析レポートを生成する。Phase 0b の Step 04 で Step 03 の後・Step 05 の前に実行される (文書アーカイブ不在時は skip)。
---

# Step 04: Ground-Truth Comparison & Gap Analysis

## Purpose

Compare AYATORI-generated requirements against the archived ground-truth documents and generate a scored gap analysis report.

`roles.docs == "base"` の run (文書ベース化) では、本 step は「**ベース文書への忠実度チェック**」として機能する —
骨格を文書から起こした以上、乖離は「取りこぼし」か「code 裏取りによる意図的修正 (Cross-Source Conflicts に記録済みのはず)」の
どちらかであり、どちらでもない乖離は Step 03 の逸脱として Gap Table に載せる。

## Skip Condition

**Skip only when there are no root-level `ground-truth/*.md` documents** (index.md 以外に 1 件も無い)。
⚠️ `ground-truth/figma/` サブディレクトリの存在だけでは実行しない — 本 step は**文書**比較であり、
figma capture との突合は Step 02 の B3 pass (Cross-Source Conflicts) が担う。skip しても Step 05 は必ず実行される。

## Process

1. **最初に `ground-truth/index.md` を Read** し、content status で扱いを分ける (Step 02 B1.1 と同じ規則 —
   引用可否の判定は index が SoT):
   - **殻 / 図のみ / テンプレート未記入** — 比較の分母にも gap の根拠にもしない。「証拠なし (未収集)」として
     別集計する。⚠️ これを分母に入れると、空の文書を基準に「網羅できている」という誤った安心や、
     逆に実在しない gap を作り出し、その集計が Step 05 人間ゲートの要約入力になる。
   - **範囲外 (未収集) / 収集失敗** — 同様に分母外。「存在しない」と混同しない。
   - **本文 / 本文+図依存 / 薄い系** — 通常の比較対象。ADF生JSON はノード構造として読む。
2. Read the root-level document archives in `artifacts/{app_name}/ground-truth/*.md`
   (Confluence / local / Jira 由来が混在する。`jira-{KEY}.md` は時点の変更要求記録のため、
   Dimension 1/2 の網羅基準 [あるべき画面・機能の分母] には使わず、個別主張の裏取り・衝突検出の補助として扱う)
3. Read all files in `artifacts/{app_name}/reverse-engineered/` (or `requirements/` if reverse-engineered is not yet populated)
4. For each comparison dimension, produce a table:

## Comparison Dimensions

### Dimension 1: Screen Coverage
- Did AYATORI identify all ground-truth screens?
- Did AYATORI hallucinate screens not in ground truth?
- Score: `detected / total` and `false positives`

### Dimension 2: Feature Fidelity
For each Must feature in ground truth:
- Captured: ✓ (with accuracy note)
- Missed: ✗
- Hallucinated extras: △

### Dimension 3: Behavioral Detail Accuracy
Check for each screen:
- UI element completeness (were all elements captured?)
- Business rule accuracy (were behaviors correctly described?)
- Edge case coverage (error states, empty states, dialogs)

### Dimension 4: API / Data Accuracy
- Were external APIs correctly identified?
- Were endpoints/schemas correctly described (vs. inferred)?
- Were data entities complete?

### Dimension 5: Scope Accuracy (PoC vs. Product)
- Were PoC-only vs. product-only items correctly distinguished?

### Dimension 6: Cross-Source Conflict Ledger
`raw-analysis.md` の `## Cross-Source Conflicts` を表面化する (Step 02 が検出済み — 本 step で再検出はしない):
- 各衝突の採用値が衝突規則 (code 勝ち / 縮退時は視覚・構造=figma, 挙動=docs) どおりか
- 採用値が Step 03 の生成物 (`01-08.md`) に正しく反映されているか (非採用値が紛れ込んでいないか)
- 未解決のままスコープに影響する衝突が `pending-questions.json` に上がっているか
- 件数と要注意項目を Summary に載せ、人間が Step 05 ゲートで衝突を見落とさないようにする

## Output

Write `artifacts/{app_name}/reverse-engineered/comparison-report.md`:

```markdown
# Requirements Fidelity Report — {app_name}

## Summary
- Overall score: XX/100
- Screens detected: X/X
- Features captured: X/X
- Key gaps: N items

## Dimension Scores
...

## Gap Table
| ID | Category | Gap Description | Severity |
|---|---|---|---|

## Root Cause Analysis
...

## Recommendations for AYATORI Pipeline
...
```
