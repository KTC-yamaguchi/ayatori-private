# Scoring Criteria

Evaluate each of the 7 axes on a 1–10 scale.
Core question: **Can a developer read this and cut a ticket immediately?**

Anchor examples below are intentionally shown in the output language
(Japanese) because they calibrate against real user answers, which arrive
in the output language.

## 1. Target User

| Score | Criteria |
|---|---|
| 1–3 | Generic demographics only, no concrete persona |
| 4–6 | Role or situation exists but the usage scene is unclear |
| 7–8 | Who / when / where is specific, with a concrete usage scene |
| 9–10 | Persona + usage scene + workaround + frustration all clearly linked |

Anchor examples (Japanese calibration):
```
1–3:  「20〜40代の会社員」
4–6:  「営業チームのリーダー」
7–8:  「昼休み、同僚に聞くが誰も決めず、結局同じ店に行くオフィスワーカー」
9–10: 「月曜の朝会で先週の進捗を聞かれる営業リード — Slackを遡って数字を集計、毎回10分消費」
```

Deep-dive triggers:
- Vague qualifiers → ask for specifics
- Age range only → ask at what moment in the day they would open the app

## 2. Problem

| Score | Criteria |
|---|---|
| 1–3 | Abstract "it's inconvenient" phrasing |
| 4–6 | Problem exists but current workaround is unclear |
| 7–8 | Current workaround + its limitations are explicit |
| 9–10 | Problem → workaround → limitation → impact-if-solved all connected |

Anchor examples:
```
1–3:  「ランチを決めるのが面倒」
4–6:  「いつも同じ店になってしまう」
7–8:  「同僚に聞く → 誰も決めない → 結局同じ3店のローテ」
9–10: 「同僚に聞く → 決まらない → 同じ店 → 昼休み15分浪費。アプリなら10秒で決定」
```

Deep-dive triggers:
- "Inconvenient" with no workaround → ask how they solve it today
- "Would be nice" → ask what changes if it is solved

## 3. Features (MoSCoW)

| Score | Criteria |
|---|---|
| 1–3 | Feature list only, no prioritization |
| 4–6 | MoSCoW classified but Must > 3 or Must items are vague |
| 7–8 | Must 1–3 clear; Should / Could separated |
| 9–10 | Must items have acceptance-criteria-level specificity |

Anchor examples:
```
1–3:  「検索、フィルター、レコメンド、通知、共有」
4–6:  「Must: 検索、フィルター、マップ、通知。Should: 共有」
7–8:  「Must: 現在地から徒歩圏の3店提案。Should: 気分フィルター、好みフィルター。Could: 履歴、グループ投票」
9–10: 「Must: GPS座標から500m圏内・マッチスコア順で3店返す。入力: 座標＋任意の気分タグ。出力: 店名、距離、ジャンル、価格帯」
```

Deep-dive triggers:
- Everything is Must → ask which single feature to ship first
- "Standard features" → ask which feature from which reference app
- "Preferably X" → confirm Must vs Could

## 4. Competitors

| Score | Criteria |
|---|---|
| 1–3 | No competitors identified, or "I don't know" |
| 4–6 | App names listed but reference points unclear |
| 7–8 | Reference apps + pros / cons are explicit |
| 9–10 | Specific features or UI from reference + differentiation point |

Anchor examples:
```
1–3:  「似たアプリは知らない」
4–6:  「Google Maps と食べログ」
7–8:  「Google Maps は近くの店が見えるが提案しない。食べログはレビュー充実だが能動的提案なし」
9–10: 「食べログのレビューフィルターは良いがUX重い。差別化: ランチ特化、開いて3秒で3店、スクロールなし」
```

Deep-dive triggers:
- "There is something similar" → ask for the specific name and what was good
- No competitors → ask for any app in an adjacent domain worth referencing

## 5. Constraints

**Scoring note:** at PoC / MVP stage, most constraints are undecided by
default. Score leniently — a rough timeline alone is enough to pass.

| Score | Criteria |
|---|---|
| 1–3 | Nothing decided, not even a rough timeline |
| 4–5 | Timeline exists (even rough); budget and tech undecided |
| 6–7 | Timeline + one of (budget, tech stack) |
| 8–9 | Timeline + tech stack + budget |
| 10 | All of the above + feasibility fully assessable (deps, CI/CD, team) |

Anchor examples:
```
1–3:  「完全に未定」
4–5:  「1ヶ月、予算と技術は未定」
6–7:  「1ヶ月、React+Node、予算TBD」
8–9:  「1ヶ月、React+Node、50万円、2エンジニア」
10:   「1ヶ月、React+Node、50万、2エンジニア、CI/CD 完備、外部API依存なし」
```

Deep-dive triggers:
- "Everything in 1 month" → ask what is truly essential in that window
- "Undecided" → record in `provisional_flags` and move on
- All undecided → one deep-dive to pin down at least a timeline

## 6. Platform

| Score | Criteria |
|---|---|
| 1–3 | Ambiguous single-word answer |
| 4–6 | Platform chosen but reasoning unclear |
| 7–8 | Platform choice connected to target user's primary environment |
| 9–10 | Platform + responsive requirements + priority + reasoning |

Anchor examples:
```
1–3:  「モバイル」
4–6:  「Web もモバイルも両方」
7–8:  「Web 先行 — オフィスワーカーは昼休みにデスクで使う。モバイルは後」
9–10: 「Web 先行 (PWA)、モバイルレスポンシブ必須。平日はPC、週末はモバイル。iOS 優先」
```

Deep-dive triggers:
- "Both" → ask which launches first
- "Web" → ask whether mobile responsive is needed
  (回答は Axis 7-a2 で `design_output_scope.web_viewports` として機械可読化され、
  `screens/web-sm/` の生成有無に接続される。聞くだけで終わらせない)

## 7. Design Output Scope

Phase 3 screen-generation scope determination. All sub-dimensions
(`platform_combo`, `screen_coverage`, `state_pattern`, plus `mobile_framework`
and `legacy_android_xml` when mobile is included, plus
`web_viewports` when web is included)
must resolve for a high score.

| Score | Criteria |
|---|---|
| 1–3 | All sub-dimensions undecided |
| 4–5 | 1 sub-dimension resolved, others undecided |
| 6–7 | All resolved but weak rationale or no consistency check with constraints |
| 8–9 | All resolved + explicit link to target users / feature set |
| 10 | 8–9 + explicit consistency check against Axis 5 constraints |

Anchor examples:
```
1–3:  「後で決める」
4–5:  「モバイルのみ。カバー範囲と状態は未定」
6–7:  「モバイル+管理者Web、Must のみ、4状態のみ」 (rationale: 「その方が無難」)
8–9:  「モバイル+管理者Web（7割のユーザーはモバイル、2割の管理者はWeb）、Must+Should、管理画面だけ追加状態」
10:   「8–9 + 1ヶ月・2エンジニアの制約内に収めるため管理者Web画面数を圧縮」
```

Deep-dive triggers:
- All 3 undecided → one round asking whether minimum scope is acceptable
- "Mobile + Admin Web" without user-base rationale → ask why both are needed
- "All features" with tight / undecided constraints → flag scope-balloon risk

**Consistency check:** before finalizing the axis score, cross-check Axis 5
(Constraints). If obviously inconsistent (e.g. 1 month + 2 engineers + all
features + both platforms), cap the score at 7–8.

## Readiness Threshold

| Overall Avg | Status | Action |
|---|---|---|
| < 5 | `NOT READY` | Re-question weak axes |
| 5–6 | `ALMOST` | Review `provisional_flags`, may proceed |
| >= 7 | `SHIPPABLE` | Proceed to requirements definition |

Each axis must be >= 4 for overall `SHIPPABLE`.
Any axis <= 3 requires mandatory re-questioning.

Maximum total: 70 points (7 axes × 10).

## Re-Question Flow

When NOT READY, show which axes need improvement with their scores and
reasons, then ask whether the user wants to revisit them.

If the user declines, record all weak items in `provisional_flags` and
write output as-is.

**Exit condition:** re-question is allowed once. If axes are still below
threshold after one re-question round, record remaining weak items in
`provisional_flags` and write output as-is. Step 07 (Human Gate) provides
an additional review opportunity downstream.
