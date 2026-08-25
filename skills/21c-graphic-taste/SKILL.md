---
name: 21c-graphic-taste
description: Phase 3 の Step 21c。21b で確定した graphic-plan.json を前提に、グラフィックのテイストを 2 段階 (言葉選択 → gpt-image-2 サンプル A/B/C 比較) で確定する人間ゲート。確定値は graphic-plan.json の taste キーに append し 21d のプロンプト合成に渡す。
---

# 21c: グラフィックテイスト 2 段階選定 → graphic-plan.json `taste` append

## 役割

21b で「グラフィックを入れる」と確定したプロジェクトに対し、**どんなテイスト (絵柄の方向性) で
生成するか** を 2 段階で確定する人間ゲート。1 段階目は言葉 (「ポップ」「洗練」等) のざっくり選択、
2 段階目はその方向内の 3 分岐 (A/B/C) をサンプルグラフィックで見比べて選ぶ。設計 SoT・用語整理・
実装単位の対応表は `docs/graphic-generation-design.md` (§2 / §6 / §7 / §9)。

本書は **routing / 分岐判断のみ** を持つ。決定的処理は `scripts/` (gather-context / generate-samples
/ commit-taste)、対話テンプレート・分岐設計・degrade 分岐は `refs/taste-guide.md` (Step 2 以降で
のみ Read) に分離している。前提条件 (Step 21 承認済み / 21b decide 済み等) は **すべて Step 1 の
script が機械判定する** — 手動で JSON を Read して確認しない。

## 実行指示

### Step 1: preflight (決定的)

```bash
node skills/21c-graphic-taste/scripts/gather-context.mjs {app_name}
```

stdout の JSON で routing する:

| 結果 | 行動 |
|---|---|
| `ok: true` | `slots`・`representative_slot`・`palette_hints`・`api_available`・`samples` (cache) を保持して Step 2 へ。`warnings` があれば user に明示してから進む (無言 fallback 禁止) |
| `E_SCREENS_NOT_APPROVED` | 「Step 21 (画面 HTML 承認) が未完了です」を表示して中断 |
| `E_21B_NOT_DONE` | 21b へ差し戻して中断 |
| `E_BLOCK_SKIPPED` | skip 確定済み ({decided_by}) を表示して中断 — グラフィックブロックは実行しない |
| `E_TASTE_ALREADY_SET` | 確定済み ({taste_confirmed_at}) を表示して中断 — **再質問しない** (P4-07)。routing は resume cascade に委ねる (次は 21d)。やり直しは設計 §5 の手動リセット運用 |
| `E_PLAN_MISSING` / `E_PLAN_INVALID` | 21b へ差し戻して中断 (plan 生成が不完全) |
| その他 `E_*` / exit 1 | message を表示して中断 |

`api_available: false` の場合もここでは中断しない — 1 段階目 (言葉選択) は API 不要のため実行し、
Step 3 で degrade 分岐 (guide §7) に入ることを **Step 2 の前に user へ予告する**。

### Step 2: 1 段階目 — 言葉選択 (対話)

`refs/taste-guide.md` を Read してから進める:

1. 判断素材を読む: `requirements/01-overview.md` + (`design_brief` が non-null なら)
   `design-brief.yaml` の `common.hearing` / `hearing_interpreted` / `ui_constraints` 周辺。
   design-brief 不在時はその旨を明示する (guide §1)。
2. プロジェクト背景を踏まえた候補語 4 つを組み立て (guide §1、AI 提案 = (E) PROPOSED。
   `avoid_styles` と衝突する語は出さない)、AskUserQuestion (multiSelect、guide §2) で選択させる。
3. 選択結果 = `level1_words` ((A) CONFIRMED)。中止意図は Step 7 (保留) へ。

**再入時 (`samples.level1_words` が non-null)**: 前回の 1 段階目選択が manifest に残っている。
同じ言葉で続きから進めるか、選び直すかを先に確認する — 無言で再質問しない (P4-07)。続きから
進める場合、variants draft は **作文し直さず gather の `samples.subject` と
`cached_variants[].style_block` を逐語再利用**して Step 3 を再実行する — digest は prompt
文字列そのものに掛かるため、言い換え 1 文字で cache miss = 再課金になる。`source: "manifest"`
が 3 件あればそのまま Step 4 へ直行できる。3 件未満 (部分失敗で中断したケース) は欠損分のみ
再生成される (追加課金は欠損分だけであることを user に伝える)。

`cached_variants` の `source: "disk"` entry (manifest に記録が無いが実在する `taste-{id}.png`) は
手動生成 degrade (guide §7) で user が配置したファイル — digest 記録が無く generate の cache
としては再利用されず、**同じ variant を generate で再生成すると上書きされる**。扱い (そのまま採用
して Step 5/6 で参照・記録するか、作り直すか) を user に確認してから進める。`level1_words` が
null で disk entry のみの場合は 1 段階目から進める。

### Step 3: 2 段階目 — サンプル A/B/C 生成 (決定的)

guide §3 (お題) / §4 (A/B/C 分岐 + palette ヒント織り込み) に従い variants draft を組み立て、
stdin で渡す:

```bash
node skills/21c-graphic-taste/scripts/generate-samples.mjs {app_name} --stdin <<'JSON'
{ "level1_words": ["洗練"],
  "subject": "... (英語、全案共通のお題 — guide §3)",
  "variants": [
    { "id": "A", "label": "洗練A (無描線ソフト水彩)", "style_block": "... (英語 — guide §4)" },
    { "id": "B", "label": "...", "style_block": "..." },
    { "id": "C", "label": "...", "style_block": "..." } ] }
JSON
```

| 結果 | 行動 |
|---|---|
| `ok: true` | `samples` / `compare_html` を保持して Step 4 へ (`cached: true` の案は再利用 — その旨を報告に含める) |
| `E_NO_API_KEY` | guide §7 の degrade AskUserQuestion (キーを設定して続行 [setup-image-key.mjs — 再起動不要] / テキスト比較 / 手動生成 / 中断) |
| `E_GENERATION_FAILED` | guide §7 (リトライ / テキスト比較 / 手動生成 / 中断)。成功分は cache 済みでリトライは失敗分のみ再生成される |
| `E_VALIDATION` / `E_BAD_INPUT` | `errors[]` / message に従い draft を直して再実行 (書き込み・API 呼び出しは発生していない) |
| `E_NON_ENGLISH` | subject / style_block の日本語混入を生成前 (課金前) に停止した状態。誤りなら英訳して再実行。固有名詞の原語表記等の意図的なケースのみ `--allow-non-english` を付けて再実行する (文字入れ [embedded text] 指示は意図的でも不可 — guide §3 の禁止事項) |

生成は低速・有料。同一入力の再実行は digest cache で再生成されないが、
style_block を変える再生成は都度コストがかかることを user への提示に含める。

### Step 4: 人間ゲート preview

`skills/_shared/human-gate-preview.md` の規約に従い、link 一覧 + `refresh_index` を行う。
`step_id = "21c-graphic-taste"`、`artifacts_to_review` = `graphics/samples/taste-compare.html`
(kind: html) + 各サンプル PNG (kind: image)。degrade 経路 (手動生成) で比較 HTML が無い場合は
サンプル PNG の link 提示のみ。

### Step 5: A/B/C 選択 (対話)

guide §5 の AskUserQuestion で選択させる:

- **案 A/B/C** → `level2_choice` 確定、Step 6 へ。
- **追加指示で作り直す** → 指示を復唱 → style_block (必要なら subject) を改訂して Step 3 を再実行
  (digest 不一致の variant のみ再生成)。**Pattern A を `feedback-log.md` に記録**。指示が方向性の
  変更なら Step 2 からやり直す (user 発意の再選択は P4-07 の対象外)。
- 中止意図 → Step 7 (保留) へ。

### Step 6: style_directive 合成 + 確定 commit (決定的)

1. guide §6 に従い `style_directive` (英語 1 段落) と taste draft を組み立てる。
2. **dry-run 検証を通してから** 確定確認 (guide §6) を出す:

   ```bash
   node skills/21c-graphic-taste/scripts/commit-taste.mjs {app_name} --stdin --dry-run <<'JSON'
   { "level1_words": [...], "level2_choice": "A", "style_directive": "...",
     "sample_files": ["graphics/samples/taste-a.png", "graphics/samples/taste-b.png", "graphics/samples/taste-c.png"],
     "palette_hints": ["#0E7C90 (global.color.primary)", "..."] }
   JSON
   ```

   (`palette_hints` は gather の導出値から実際にプロンプトへ織り込んだものだけを渡す。
   テキスト比較 degrade で確定した場合は `sample_files` を省略する。)
3. 「この内容で確定」→ 同じ draft を `--dry-run` なしで再実行。
   - `ok: true` → 完了報告 (level1_words / level2_choice / style_directive / cache 再利用・degrade の別) → **Step 21d (プロンプト確定) へ**。
   - `E_VALIDATION` → dry-run 済み draft では通常起きない (対話中に状態が変わったケース)。`errors[]` に従い draft を直し、**修正後の draft を guide §6 で再確認してから** 再実行する。ファイルは一切書かれていない。
   - `E_NON_ENGLISH` → `style_directive` に日本語が混入 (英語 1 段落が契約 — 21d が全 slot に英語のまま合成する)。誤りなら英訳して guide §6 で再確認、固有名詞の原語表記等の意図的なケースのみ `--allow-non-english` を付けて再実行する (文字入れ [embedded text] 指示は意図的でも不可 — guide §3 の禁止事項)。ファイルは一切書かれていない。
4. 「修正する」→ guide §6 の注意 (文言調整か見た目変更かで戻し先が違う) に従い、Pattern A を記録して再確認。
5. 「中止」→ Step 7 へ。

### Step 7: 保留

**commit script を呼ばず、taste を書かない** (`taste_confirmed_at` 未 set = 次回 resume cascade が
21c を再起動する signal — 設計 §9-1)。生成済みサンプルと manifest はそのまま残す (次回 cache
再利用 — 破棄しない)。「テイスト選定を保留しました。次回セッションで 21c が再起動します
(samples-manifest.json があるサンプルは cache 再利用されます)」を報告。手動生成 degrade で
配置したファイルは manifest が無いため cache 再利用はされない (Step 2 の再入注記どおり存在提示のみ)。

## 失敗時の挙動

| 失敗 | 対応 |
|---|---|
| 前提 NG (`E_*`) | Step 1 の routing 表どおり中断 (generate / commit 側の再 assert も同じ code を返す) |
| 生成 API キー未設定 / 生成失敗 | guide §7 の degrade 分岐 — 無言で補完せず user に選ばせる (Operating Principle 4) |
| `tokens.json` / `design-brief.yaml` 不在・旧形式 | 失敗ではない — gather が warnings で返す (旧形式 [W3C `$type`/`$value` 以外] は「color token なし」と区別して「形式相違で導出不可」と報告される)。明示告知の上で palette ヒントなしで続行するか、user が HEX を手渡しした場合は `"#0E7C90 (user-provided)"` 形式で palette_hints に採用できる ((A) CONFIRMED 由来 — commit の書式検証も通る) |
| `E_VALIDATION` | 書き込みゼロのまま draft を修正して再実行。解消できない場合は feedback-log.md に Pattern B を記録して user に報告 |
| node が使えない環境 | 縮退運転 — 本書 + guide + `schemas/graphic-plan.schema.json` の契約に従い、同じ assert / 検証 / 書き込みを手動 (Read / Write) で行う。サンプル生成は guide §7 の手動生成経路を使う |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/graphics/graphic-plan.json` | `taste` キーのみ append (writer は `commit-taste.mjs`、schema: `schemas/graphic-plan.schema.json`)。**slots には触らない** (設計 §7)。残置 taste があれば `_backup/graphics/` へ退避してから上書き |
| `artifacts/{app_name}/graphics/samples/taste-{a,b,c}.png` | 2 段階目のサンプル ((B) ILLUSTRATIVE — 見本であり実データに昇格しない、設計 §7)。保留・確定後も残置し cache として再利用 |
| `artifacts/{app_name}/graphics/samples/samples-manifest.json` | サンプル cache 台帳 (prompt digest / 生成時刻)。`generate-samples.mjs` が毎回丸ごと上書きする世代管理なしの derived 台帳 (schema なし — cache 実装詳細) |
| `artifacts/{app_name}/graphics/samples/taste-compare.html` | A/B/C 比較 view (決定論生成 — 手焼き禁止)。derived view であり SoT ではない。画像は data URI 内包の自己完結 HTML — 閲覧環境の file:// 読取ブロックで破像しない + 単体ファイルで共有可 |
| `artifacts/{app_name}/pipeline-state.json` | `screens.graphics.taste_confirmed_at` (確定時のみ、plan 側 `taste.confirmed_at` と同値)。保留時は更新しない (設計 §9-2) |
| `artifacts/{app_name}/feedback-log.md` | 再生成指示・確定確認の修正指示が出た場合の Pattern A 記録 |

## 完了後

- 確定 → Step 21d graphic-prompts (箇所別プロンプト確定) へ。`taste.style_directive` と
  `taste.palette_hints` が 21d の全 slot プロンプト合成の入力になる。
- 保留 → 本セッションのグラフィックブロックはここで終了。次回 `/ayatori-screens` 再実行時に
  resume cascade (`decision == "generate"` AND `taste_confirmed_at` 未 set → Step 21c、設計 §9-1)
  が 21c を再起動する。
