# Feature Addition Interview

Shared ref — used by `skills/27-change-detect/SKILL.md` (Phase 5) and
`skills/31-req-change-detect/SKILL.md` (Phase 1c).

Canonical source: Confluence [機能追加ヒアリング項目案](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3882747258)

---

## When to invoke

Invoke this interview when:
- The user's stated change is a **feature addition** (新機能追加) to an existing project
- `change_type == "feature_addition"` has been determined by the calling skill

**Callers**: Step 27 (Phase 5 delta) and Step 31 (Phase 1c req-delta) only.
Phase 1d (`/ayatori-add-feature`, Step 01b) uses a separate 7-axis hearing and does **not**
invoke this interview — do not use this file for Phase 1d runs.

Do NOT invoke for spec changes, bug fixes, or removals — those use the free-form
change description path in the calling skill.

---

## Interview Mode Branching

Read `artifacts/{app_name}/requirements.json → interview_mode` (set by Step 01).
If absent, default to `"beginner"`.

| `interview_mode` | Path |
|---|---|
| `beginner` / `beginner_switched_from_intermediate` | § Beginner Path — 9 questions one at a time; free-text questions use plain chat (Q1/Q2-1/Q2-2/Q2-4/Q3-1/Q3-2), choice questions use AskUserQuestion (Q2-3/Q4/Q5) |
| `intermediate` | § Intermediate Path — open question + gap fill |

---

## Beginner Path

Ask questions **one at a time**. Free-text questions use a plain chat message; choice
questions use `AskUserQuestion`. Do NOT mix free-text and choices in a single call.

### Q1: 追加したい機能（簡潔に）

Plain chat — display:
「追加したい機能を一言で教えてください。
例: "外出先で最寄りの充電スポットを地図で確認できる機能"」

### Q2-1: ユーザー価値

Plain chat — display:
「この機能はユーザーにどんな具体的な価値を提供しますか？
抽象的な表現（例：「使いやすくなる」）ではなく、ユーザーが具体的に何を得られるかを教えてください。
例: "これまで3画面の遷移が必要だった操作が1タップで完了する（時間と手間の削減）"」

### Q2-2: シチュエーション

Plain chat — display:
「この機能が必要になるシチュエーションを具体的に教えてください。（ユーザーがどんな状況・場面で使うか）
例: "遠出の帰り道、バッテリーが30%を切ったタイミングで最寄り充電スポットを確認したいとき"」

### Q2-3: 利用頻度

```
AskUserQuestion:
  question: "この機能の想定利用頻度は？"
  options:
    - label: "毎日"
    - label: "週1回程度"
    - label: "月1回程度"
    - label: "年に数回"
```

Map selected label to `usage_frequency` enum value before writing to the manifest:
- "毎日" → `daily`
- "週1回程度" → `weekly`
- "月1回程度" → `monthly`
- "年に数回" → `occasional`
- "Other" (free text): send a plain chat asking the user to pick the closest of the four options above, then use that value.

### Q2-4: 需要根拠

Plain chat — display:
「この機能の需要を裏付けるデータや根拠はありますか？（ユーザーの声、利用ログ、アンケート、問い合わせ件数など）
なければ「なし」で構いません。
例: "CSに「外出先での充電スポット検索方法がわからない」という問い合わせが半年で20件"」

Normalization: "なし" / "ない" / "特になし" / empty reply → `demand_evidence = null`. Any concrete answer → `demand_evidence = "{answer text}"`.

### Q3-1: 使う場面

Plain chat — display:
「この機能はいつ・どこで使われますか？
例: "車に乗っているとき、外出先でアプリのホーム画面から起動する"」

### Q3-2: 操作フロー

Plain chat — display:
「ユーザーの操作の流れを教えてください。「〇〇をタップ → △△が表示される」という形式で箇条書きでOKです。
例:
1. ホーム画面の「充電スポットを探す」をタップ
2. 現在地周辺の地図にピン表示
3. ピンをタップ → 空き状況・料金が表示
4. 「ここに行く」でナビアプリが起動」

### Q4: 既存機能との重なり

```
AskUserQuestion:
  question: "このアプリの中に、関連性のありそうな既存機能はありますか？"
  options:
    - label: "なし — この機能と重なる既存機能はない"
    - label: "あり — 既存機能を具体的に"
```

Map selected label to `existing_overlap` before writing to the manifest:
- "なし — この機能と重なる既存機能はない" → `existing_overlap = "none"`
- "あり — 既存機能を具体的に": follow up with a plain chat message asking which feature(s) → `existing_overlap = "{feature_name}"`
- "Other" (free text): treat as "あり" and follow up with a plain chat message asking which feature(s) → `existing_overlap = "{feature_name}"`

### Q5: 位置づけ

```
AskUserQuestion:
  question: "この機能の位置づけはどれに当たりますか？"
  options:
    - label: "新規機能 — 関連する既存機能はなく、完全に新しく作る"
    - label: "新規機能(既存と別立て) — 関連機能はあるが、別の機能として作りたい"
    - label: "既存機能の改善・拡張 — 既存機能にこの機能を組み込む"
    - label: "まだ迷っている"
```

Map selected label to `positioning` enum value before writing to the manifest:
- "新規機能 — 関連する既存機能はなく、完全に新しく作る" → `new_feature`
- "新規機能(既存と別立て) — 関連機能はあるが、別の機能として作りたい" → `separate_new`
- "既存機能の改善・拡張 — 既存機能にこの機能を組み込む" → `improvement_extension`
- "まだ迷っている" → `undecided`
- "Other" (free text): set `positioning = "undecided"` and store the free-text answer in `positioning_supplement`.

If "既存機能の改善・拡張": follow up with a plain chat message asking which feature to extend. Store the answer in `positioning_supplement`.
If "まだ迷っている": follow up asking what the deciding factor is; store the answer in `positioning_supplement`.

---

## Intermediate Path

Ask a single open question:

```
これから追加したい機能について自由に話してください。
追加したい機能の概要・ユーザーへの価値・使う場面・操作の流れ・
既存機能との関係性を含めていただけると助かります。
長さに制限はありません。
```

After receiving the response, silently check against the 9 interview items as a checklist:

| # | Item | Covered? |
|---|---|---|
| 1 | 機能の一言説明 | — |
| 2-1 | ユーザーへの具体的価値 | — |
| 2-2 | 使われるシチュエーション | — |
| 2-3 | 利用頻度 | — |
| 2-4 | 需要根拠 | — |
| 3-1 | 使う場面（いつ・どこで） | — |
| 3-2 | 操作フロー | — |
| 4 | 既存機能との重なり | — |
| 5 | 位置づけ（新規/改善・拡張） | — |

**Q2-3 and Q5 are only considered "covered" if the answer can be unambiguously normalized to a valid schema enum value** using the label→enum tables in § Beginner Path. A vague answer such as "頻繁に" (Q2-3) or "新しい機能として" without a clear positioning (Q5) does NOT count as covered — treat the item as missing and ask the corresponding AskUserQuestion in Pass 2.

**Q5 supplement rule** (intermediate path): Even when Q5 maps to `improvement_extension` or `undecided`, Q5 is only "covered" if the answer also supplies the supplement content (which feature to extend, or the deciding factor). If supplement content is absent, treat Q5 as missing and collect via Pass 2 AskUserQuestion followed by the plain-chat follow-up from § Beginner Path Q5. For `new_feature` and `separate_new`, no supplement is needed — the enum value alone counts as covered.

**Q4 normalization rule** (intermediate path): Q4 is "covered" if the answer unambiguously indicates either no overlap or a named existing feature. Normalize as follows:
- Answer clearly states no overlap (e.g. "ない", "なし", "重なりはない") → `existing_overlap = "none"`
- Answer names a specific existing feature → `existing_overlap = "{feature_name}"`
- Answer is vague (e.g. "似たものがあるかも") → treat Q4 as missing and ask the AskUserQuestion from § Beginner Path Q4 in Pass 2.

If all 9 items are covered (with the above strictness for choice items), skip follow-up entirely and proceed to output.

For items not covered, collect missing answers in two passes — **text items first, then
choice items** — to ensure actual values (not just labels) are captured:

**Pass 1 — text-answer items** (機能の一言説明 / ユーザーへの具体的価値 / 使われるシチュエーション /
需要根拠 / 使う場面 / 操作フロー):
If any of these are missing, send a **single plain chat message** with each missing question
**labeled** (e.g. `【機能の一言説明】`, `【需要根拠】`), and ask the user to answer each labeled
item. Map each labeled answer block to the corresponding item. Do NOT send unlabeled questions —
mapping ambiguity risks the wrong value being written to the wrong field.

**Pass 2 — choice-answer items** (利用頻度 / 既存機能との重なり / 位置づけ):
For each missing choice item, use the corresponding `AskUserQuestion` from the Beginner Path
(Q2-3 / Q4 / Q5) — one call per item, in that order. Do NOT re-ask items covered by Pass 1.
After collecting Q5 via AskUserQuestion, apply the same follow-up rule as § Beginner Path Q5: if the result is `improvement_extension` or `undecided`, send a plain-chat follow-up to collect `positioning_supplement`.

---

## Output: feature-add-brief.md

After interview completes (either path), write the following file.
Path: `artifacts/{app_name}/{delta_dir}/feature-add-brief.md`
where `{delta_dir}` is `delta` (Phase 5) or `req-delta` (Phase 1c).

```markdown
# 機能追加ヒアリング結果

**アプリ名:** {app_name}
**記録日時:** {today}
**ヒアリングモード:** {beginner | intermediate | beginner_switched_from_intermediate}

---

## 追加したい機能
{Q1 answer}

## 目的・ユーザー価値
- **ユーザーへの価値:** {Q2-1}
- **シチュエーション:** {Q2-2}
- **利用頻度:** {Q2-3}
- **需要根拠:** {Q2-4}

## 機能概要
- **使う場面:** {Q3-1}
- **操作フロー:**
{Q3-2 as bullet list}

## 既存機能との関係
- **重なり:** {Q4: なし / {feature_name}}
- **位置づけ:** {Q5: new_feature | separate_new | improvement_extension | undecided}
  {Q5 supplement if applicable}
```

---

## Output: feature_add block in change-manifest.json

The calling skill merges these fields into `change-manifest.json`:

```json
{
  "feature_name": "{Q1 one-liner}",
  "user_value": "{Q2-1}",
  "situation": "{Q2-2}",
  "usage_frequency": "daily",
  "demand_evidence": null,
  "usage_scene": "{Q3-1}",
  "user_flow": ["{step 1}", "{step 2}"],
  "existing_overlap": "none",
  "positioning": "new_feature",
  "positioning_supplement": null
}
```

> **Field values:**
> - `usage_frequency`: `daily | weekly | monthly | occasional`
> - `existing_overlap`: `"none"` if no overlap; `"{feature_name}"` if overlap exists
> - `positioning`: `new_feature | separate_new | improvement_extension | undecided`
> - `demand_evidence`: string value if provided; JSON `null` if user replied "なし" — do NOT write string `"null"`
> - `positioning_supplement`: string value if Q5 required a follow-up; JSON `null` otherwise
