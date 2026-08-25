---
name: 01a-idea-brushup
description: ふわふわのアイデアを発散 scatter → 収束 converge → 具体化 specify → CxO 視点ミニ批評 → 固まり度チェックの育成ループ (最大 3 ラウンド) で構造化し、idea-brief.md を生成して同一会話で 7 軸ヒアリング (/ayatori-question) へ合流する。/ayatori-idea (phases/idea) または /ayatori-question のモード選択から Read されて実行される実装本体。
---

# 01a-idea-brushup: アイデアブラッシュアップモード (実装本体)

## Role

ふわふわのアイデアを、発散 (scatter) → 収束 (converge) → 具体化 (specify) →
CxO 視点ミニ批評 → 固まり度チェック、の育成ループ (最大 3 ラウンド) で構造化し、
`artifacts/{app_name}/idea-brief.md` を生成し、同一会話でそのまま 7 軸ヒアリング
(`/ayatori-question`) へ合流する。idea-explorer の実運用検証済み方法論の翻案移植
(設計書: Confluence 4013883944)。

**Out of scope:** 要件定義そのもの (7 軸ヒアリング以降の責務)、設計判断、技術スタック選定、
web 検索による市場・競合の実データ補強 (移植対象外 — 言及には `※未検証 (web 検索なし)` を付す)。

## Preamble

1. `pipeline.yaml` を Read し `skip_phases` に `idea_brushup` が含まれれば
   「⏭ idea_brushup をスキップします」と表示して終了。
2. `skills/00-memory-load/SKILL.md` を Read して指示に従う。
   (inline 起動時の省略: `/ayatori-question` のモード選択から起動された場合、1 の
   skip_phases 確認は呼び出し元が Option 2 選択直後に `idea_brushup` を確認済み、
   2 の memory-load は呼び出し元 phase の Preamble で実施済みのため、いずれも省略してよい。)
3. refs を Read する (4 点 + テンプレート):
   - `skills/01a-idea-brushup/refs/scatter-questions.md`
   - `skills/01a-idea-brushup/refs/converge-specify.md`
   - `skills/01a-idea-brushup/refs/cxo-panel.md`
   - `skills/01a-idea-brushup/refs/maturity-check.md`
   - `skills/01a-idea-brushup/refs/idea-brief-template.md`
4. **stub ガード**: Read した refs のいずれかに `⚠️ STUB` マーカーが残っている場合、
   「⏸ /ayatori-idea は準備中です — refs が未実装のため中断します (実装状況は各 ref 冒頭の
   STUB 表記を参照)」と表示して終了する (stub のまま実行すると質問・ペルソナ・採点基準を
   AI がその場で創作することになり、maturity-check の「創作で埋めない」原則に違反するため)。
5. **stateless**: `pipeline-state.json` を読み書きしない。Pre-flight Gate も非搭載
   (cm-consult と同型)。

## Interaction Style

- 選択の提示は常に `AskUserQuestion` (2〜4 option + 自動 "Other")。番号付きリストの
  plain text 提示で代用しない。ただし **5 件以上の列挙判定が必要な場面は
  `skills/01b-add-feature-question/SKILL.md` § Plain chat fallback の書式**
  (番号カンマ区切り) に倒す。
- 1 回の `AskUserQuestion` 呼び出しは最大 4 質問。超える場合は分割する。
- 単一 free-form 入力を求めるときは AskUserQuestion を 1 option で代用せず plain chat で受ける。
- 進捗表示: 全質問の冒頭に `📍 Round {N}/3: {Step 名} — {簡潔な説明}` を付す
  (English-fixed。SoT は `skills/01-question/SKILL.md` § Progress Display)。
  例: `📍 Round 1/3: Scatter — Q2`、`📍 Round 2/3: CxO Panel — CTO reaction`。
  (Scatter は 5 軸充足で終わるため分母を付けない — 問い数は固定ではない。)
- **全ステップ共通 escape hatch**: どの質問でも Other に「もう 7 軸へ進みたい」系の回答が
  来たら、現在のステップを中断して Step 6 相当のラウンドゲートへ跳ぶ
  (app_name 未確定時に「7 軸へ進む」を選んだ場合の挙動は Step 6 ハンドオフ処理の
  degrade 注記を参照)。

## Execution (Step 0〜6 対話ループ)

```
Step 0: エントリーガード + 入口判定 (resume 検出含む)
Step 1: 発散 scatter
Step 2: 収束 converge          ←──────────┐
Step 3: 具体化 specify → 5 軸充足ゲート     │
        → アイデア像確認 + app_name 確定     │ もう一周
        (初回のみ)【開示 A】                 │
Step 4: CxO 視点ミニ批評 → リアクション【開示 B】
Step 5: 固まり度チェック → ★brief 上書き保存 │
Step 6: ラウンドゲート ────────────────────┘
        (もう一周 / 7 軸へ進む / ここで終了。上限は累計 3 ラウンド)
```

### Step 0 — エントリーガード + 入口判定

**(a) resume 検出**: `ls artifacts/*/idea-brief.md 2>/dev/null` で brief を持つプロジェクトを列挙し
(0 件時は glob 不一致のエラー出力を stderr ごと捨て、空リスト = resume 候補なしとして (b) へ進む)、
**同ディレクトリに `requirements.json` が不在** のものを resume 候補とする
(requirements.json が有る brief は消費済み — 消費済みマークは書かない設計)。
候補が 1 件以上あれば AskUserQuestion で提示:
- 「前回のブラッシュアップを再開する ({app_name} / ラウンド {N} まで完了)」
- 「新規で開始する」

再開選択時: brief を直接 Read し (ユーザーに貼り付けさせない — Inter-phase communication is
only through files の原則)、frontmatter からラウンド数・スコア履歴を引き継いで **Step 2 から続行**。
ただし **`rounds_completed >= 3` (累計上限到達済み) の場合は Step 2 に入らず Step 6 の
ラウンドゲートへ直行し、「7 軸へ進む / ここで終了」の 2 択のみ提示する** (「もう一周」は
提示しない — 上限は累計値のため resume しても 4 周目は始まらない)。

**(b) 入口 3 択** (AskUserQuestion、新規開始時):
| 選択肢 | 意味 | ルート |
|---|---|---|
| ① ゼロから壁打ちしたい | アイデアなし | → 自由記述を plain chat で受領 (「最近気になっていること・楽しかったこと・困っていること、何でも 1〜2 文でどうぞ」— 選択肢は出さない) → Step 1 (起点タイプ分類から) |
| ② ふわふわだがアイデアの種はある | 断片あり | → 1〜2 文で plain chat 受領 → Step 1 を短縮実行 |
| ③ 既存メモがある | idea-explorer の SpecifyOutput・企画書、社内メモ等 | → テキスト貼り付けを plain chat で受領 → InsightCard 棚 (内部整理、非提示) に整理 → 5 軸充足を判定 (`refs/scatter-questions.md` § 終了判定)。全軸充足なら **Step 2 から開始**、未充足軸があればその軸を狙った質問で埋めてから Step 2 へ |

**(c) fast-track**: ①②③ で内容 (① は自由記述、② は種テキスト、③ は既存メモ) が既に
十分具体的と判定した場合、AskUserQuestion で提示:
- 「短縮 1 周 (批評 skip) で確認だけする」— Step 4 を実施しない。brief ⑤ (CxO 批評サマリ) は
  `refs/idea-brief-template.md` § ⑤ の skip 時規定に従い「実施なし (fast-track・批評 skip)」と記す
- 「このまま丁寧に 1 周する」
- 「7 軸へ直行する」→ Step 6 の「7 軸へ進む」相当の処理へ (同一会話で合流)

### Step 1 — 発散 (scatter)

`refs/scatter-questions.md` から質問を選んで AskUserQuestion で問う
(シナリオベースの 2〜4 択 + Other)。1 問 1 焦点。**終了判定は問い数ではなく 5 軸充足**
(`refs/scatter-questions.md` § 終了判定) — アイデア像 5 軸 (Why / What / Who / How /
WhyNot) すべてに対話由来の材料が揃うまで、未充足の軸を狙った質問を続ける。全軸が
揃ったら「収束に進む / もっと壁打ちを続ける」を確認してから Step 2 へ。何問で揃ったかは
問わない — 1 問で揃えばそれで終えてよい。
- **入口①**: Step 0 (b) で受領した自由記述を起点タイプ (Problem / Experience・Curiosity /
  Relationship・Emotion / Dream・Vision) に内部分類し、タイプ別スターターから始める
  (`refs/scatter-questions.md` § 群 A)。分類の確認質問はせず、1 行の前置きで開示するのみ。
  「何も浮かばない」ときのみ白紙 fallback (アーキタイプ均等の例示 4 option) を使う。
- **入口②**: 種テキストで既に埋まった軸・スロットは smart-skip で聞き直さず、未充足の
  軸だけを問う。「短縮」は smart-skip の結果であって問い数の固定ではない — 未充足軸が
  残っている間は問いを続ける。
- escape hatch: ユーザーが先へ進む意思を示せば、未充足軸が残っていても Step 2 へ
  進んでよい (進む旨と未充足軸を 1 行で明示 — 未充足分は Step 3 の 5 軸充足ゲートが
  受け止める)。入口①の自由記述が最初から十分具体的な場合は Step 0 (c) fast-track が
  担い、部分的に具体的な場合は smart-skip で埋まったスロットの質問を省く。

### Step 2 — 収束 (converge)

`refs/converge-specify.md` の手順に従い、発散結果 (+ resume 時は brief、
もう一周時は前ラウンドの「そうは思わない」懸念とユーザーコメント) から
**論点候補を 2〜3 提示** → AskUserQuestion でユーザーが「今回の核」を 1 つ選択。
- 捨てた論点は削除せず brief の「④ 先送りした論点」に記録する。

### Step 3 — 具体化 (specify) + アイデア像確認 + app_name 確定【開示ステージ A】

1. `refs/converge-specify.md` の合成規則に従い、対話ログから「現在のアイデア像」
   5 軸 (Why / What / Who / How / WhyNot) を合成して提示する。
   - AI 補完部分は `[proposal]` マーカー付き (P4 (E) PROPOSED)。
   - InsightCard 10 カテゴリは内部整理棚 — ユーザーには 5 軸のみ提示する。
2. **5 軸充足ゲート** (`refs/converge-specify.md` § 3-5): 未充足の軸
   (`※不明 (unknown)`、または記述全体が `[proposal]` のみ) があれば、確定質問の前に
   その軸を埋める補完質問 (軸ごと 1 問・同一ラウンド 1 回まで) を出して対話で埋める。
   それでも埋まらなければ「批評を skip して Step 5 へ (推奨) / 未充足のまま批評を
   受ける」の選択を取る。**ユーザーが強行を明示選択しない限り、未充足軸を残したまま
   Step 4 に進まない**。縮退パネル (席数の削減) は設けない — 強行時は創作しないことを
   優先し、懸念件数のみ規定に届かなくてよい (`refs/cxo-panel.md` § 未充足のまま強行する場合)。
3. AskUserQuestion で確認: 「そのまま確定 / 修正したい」。**確定するまで Step 4 に進まない**。
   修正希望は plain chat で受けて反映 → 再提示。
4. **初回ラウンドのみ、ここで app_name を確定する**:
   - 命名規約: 英小文字 + 数字 + アンダースコア / ハイフン、最大 20 字
     (cm-consult の slug 規約 — `skills/cm-consult/SKILL.md` § Step 2 の slug 生成規則 —
     を先例に自前定義)。
   - AI が案を 1〜2 提示し、AskUserQuestion で確定 (Other で自由入力可)。
   - **衝突チェック** (app_name 確定時に必ず実行): `ls artifacts/` で同名ディレクトリを確認。
     - 同名 + `requirements.json` **有り** → 「既存プロジェクトには使えません。別名にするか、
       機能追加なら `/ayatori-add-feature` へ」と案内して別名を求める。
     - 同名 + brief のみ (自分の中断分) → resume 扱いへの切替を提案する。

### Step 4 — CxO 視点ミニ批評【開示ステージ B】

**進行条件**: Step 3 の 5 軸充足ゲートを通過していること。全軸充足なら通常パネルで
実施。未充足のままユーザーが実施を明示選択した場合も縮退せず通常どおり全パネルで
実施する (`refs/cxo-panel.md` § 未充足のまま強行する場合)。批評 skip 選択時は
本ステップを実施せず Step 5 へ進む (brief ⑤ は `refs/idea-brief-template.md` § ⑤ の
skip 時規定に従う)。

`refs/cxo-panel.md` に従う:
1. アイデア像に関連する **3 ペルソナ** を選定し、選定理由を 1 行ずつユーザーに明示。
2. 各ペルソナが「良い点 1 + 懸念点 1〜2 + 問い 1」を提示。**相互討論はしない**
   (1 回ずつの静的批評)。市場・競合への言及には `※未検証 (web 検索なし)` を付す。
3. **リアクションゲート**: ペルソナごとに 1 AskUserQuestion で、そのペルソナの懸念
   1〜2 件への「そう思う / そうは思わない」2 択スタンスを取らせる (**中立なし** —
   idea-explorer #265 の翻案)。4 option 以内厳守。
   - **懸念が計 5 件以上になる場合**は `skills/01b-add-feature-question/SKILL.md`
     § Plain chat fallback の書式 (番号カンマ区切り) に倒す。
4. **未回答の懸念を残したまま Step 5 に進まない**。

### Step 5 — 固まり度チェック + brief 保存

`refs/maturity-check.md` に従う:
1. 6 軸 × 1〜5 点で採点し、軸ごとに「足りない点」を 1 文添える。
   - **言及が乏しい軸は低く採点する (創作で埋めない)** 原則を厳守。
   - スコアは (E) PROPOSED — 根拠 (どの発言に基づくか) を軸ごとに 1 行示す。
2. **このステップの最後に brief を必ず上書き保存する (毎ラウンド)**:
   - `refs/idea-brief-template.md` の構造に従い `artifacts/{app_name}/idea-brief.md` へ
     **丸ごと上書き** (蓄積型は発散する — idea-explorer #276/#277 の実測知見)。
   - スコア履歴 (⑥) のみラウンド別に追記型。それ以外のセクションは最新ラウンドの内容で全置換。
   - セッションが切れてもラウンド完了分は失われない。

### Step 6 — ラウンドゲート

AskUserQuestion 3 択 (`📍 Round {N}/3: Gate — 次の一手`)。ただし **Round 3 完了時
(累計上限到達) は「もう一周」を除いた 2 択で提示する**:

| 選択肢 | 処理 |
|---|---|
| **もう一周** (Round 1〜2 完了時のみ提示) | コメントを plain chat で受領 → 「そうは思わない」を付けた懸念 + コメントを次ラウンドの種にして Step 2 へ。**上限は累計 3 ラウンド** — `rounds_completed` を brief frontmatter 経由でセッションを跨いで引き継ぐ累計値であり、新しい会話で resume しても 4 周目は始まらない (Step 0 (a) の resume ガード参照) |
| **7 軸へ進む** | 下記「ハンドオフ処理」を実行 |
| **ここで終了** | brief は Step 5 で保存済みのため追加作業なし。app_name 未確定のまま Step 3 前に離脱する場合のみ「保存なしで終了します。よろしいですか?」を確認 |

**ハンドオフ処理** (「7 軸へ進む」選択時):

> **app_name 未確定時の degrade** (Step 3 未到達で escape hatch から到達した場合):
> 書き込み先 `artifacts/{app_name}/` が存在しないため下記 1〜3 を skip し、
> 「brief なしで通常の 7 軸ヒアリングを開始します」と 1 行表示した上で 4 の合流を行う
> (brief 不在のため `brief_preread = false` — 7 軸側は通常の Opening から開始する)。

1. 固まり度スコアが推奨閾値 (全軸 3 以上) 未満の軸があれば、その旨を表示した上で進行は許可
   (ゲートは人間が決定)。brief の frontmatter を **`proceeded_below_threshold: true` に更新**する
   (`score_below_threshold` は Step 5 の採点時に set 済み。キー定義は
   `refs/idea-brief-template.md` frontmatter)。全軸 3 以上なら両キーとも `false` のまま。
2. born-resolved entries を `artifacts/{app_name}/pending-questions.json` に append
   (下記 § P4 準拠、lazy init: `{ "app_name": "{app_name}", "entries": [] }`)。
3. `artifacts/{app_name}/session-handoff.md` を書く:
   ```
   ---
   app_name: {app_name}
   project_origin: IDEA_BRUSHUP
   phase_completed: "idea-brushup"
   completed_at: "{YYYY-MM-DDThh:mm:ss±hh:mm}"
   rounds_completed: {N}
   artifacts_ready:
     - idea-brief.md
   next_phase: question
   next_command: /ayatori-question
   ---
   # DO NOT USE AS EXECUTION STATE — brief の消費判定は requirements.json の存在で行う。
   アイデアブラッシュアップ完了。同一会話で 7 軸ヒアリングへ合流。
   中断した場合は新しい会話で /ayatori-question を実行 (idea-brief.md を自動検出)。
   ```
4. **同一会話でそのまま 7 軸へ合流する** (新しい会話への貼り付けは求めない)。
   「✅ アイデアブラッシュアップ完了。このまま 7 軸ヒアリングへ進みます」と 1 行表示した上で:
   - `/ayatori-question` (phases/question) のモード選択からの inline 起動時: 呼び出し元の
     Preamble step 4 へ制御を戻す (以降の brief 検出 → `brief_preread = true` →
     Pre-flight Gate → Execution は `phases/question/SKILL.md` step 3b Option 2 の規定に従う)。
   - `/ayatori-idea` 単独起動時: まず `pipeline.yaml` の `skip_phases` に `question` が
     含まれるか確認する。含まれる場合は「⏭ question フェーズをスキップします（pipeline.yaml →
     skip_phases 設定）— brief は保存済みのため、skip 解除後に新しい会話で `/ayatori-question` を
     実行すれば再開できます」と表示して終了する。含まれなければ `phases/question/SKILL.md` を
     Read し、Preamble step 4 から実行する (step 1 の skip_phases 確認は直前で実施済み・
     step 2 の memory-load は本コマンドの Preamble で実施済み、step 3 / 3b は skip —
     プロジェクトは直前に確定した `{app_name}`)。step 5 が idea-brief.md を検出し
     `brief_preread = true` で 7 軸を開始する。
   - **carry-over 制限**: 7 軸へ持ち越してよいのは idea-brief.md + born-resolved entries
     のみ。ブラッシュアップ会話中に現れたが brief に採用されなかったアイデアを 7 軸の
     既定値・提案に注入しない。
   - セッションが中断された場合の再開: 新しい会話で `/ayatori-question` を実行すれば
     idea-brief.md が自動検出される (ブリーフ先読みモード)。

## Operating Principle 4 準拠 (P4)

- AI 生成の批評・スコア・アイデア像草案はすべて **(E) PROPOSED / (C) DERIVED** として提示し、
  ユーザー確認 (Step 3 / Step 4 リアクション) で (A) CONFIRMED へ昇格させる。
- **確定した load-bearing specifics** (Step 3 で確定した 5 軸の具体値、Step 4 で
  「そう思う」が付いた懸念への対応方針等) は `pending-questions.json` に
  **born-resolved entry** として記録する:
  - 必須 field (hook R3): `target` / `question` / `raised_by_step: "01a-idea-brushup"` /
    `raised_at` (ISO 8601) + resolved 2 field: `resolved_at` / `resolved_answer`。
  - **target 命名規約** (hook R5b の dot/bracket 文法): `idea_brief.{key}` namespace に統一。
    英数キーのみ (日本語・自由文禁止)。例: `idea_brief.who` / `idea_brief.core_problem` /
    `idea_brief.core_features[0]`。詳細は `refs/idea-brief-template.md` § born-resolved 命名規約。
  - born-resolved entry には **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス)
    を書かない** — 振り分け script は `resolved_at` が set の entry を読む前に抜けるため値が使われる経路が
    無い (`skills/_shared/preflight-gate.md` § append 経路)。
- **未解決のまま残った懸念**は brief の「③ 未解決の論点」に `※不明 (unknown)` として記録する。
  勝手に補完しない。直接 AskUserQuestion を乱発せず、7 軸側 (Phase 入口 Pre-flight Gate) に委ねる。

## feedback-log 方針

- app_name 確定前 (Step 3 より前) の Pattern B/C 相当は記録しない
  (記録先ディレクトリが存在しないため)。
- 確定後は通常どおり `artifacts/{app_name}/feedback-log.md` に append (初回 append 時に lazy init)。

## Standing Rules

- **stateless**: `pipeline-state.json` を読み書きしない。
- **single writer 厳守**: `requirements.json` を書かない (writer は 01-question のみ。
  本モードは必ず 7 軸ヒアリングを通す)。brief への「消費済み」マークも書かない
  (消費判定は requirements.json の存在で行う)。
- 出力は `artifacts/{app_name}/` **ルート直下** に統一: `idea-brief.md` /
  `pending-questions.json` / `session-handoff.md`。**requirements/ 配下には置かない**
  (01b の Axis 7 grep・/ayatori-export 結合・Step 31 doc 選択の 3 系統への誤検出を防ぐ —
  設計書 §4)。
- AskUserQuestion は最低 2 択・最大 4 option。5 件以上の列挙は plain chat fallback。

## Output

| ファイル | 形式 | タイミング |
|---|---|---|
| `artifacts/{app_name}/idea-brief.md` | `refs/idea-brief-template.md` 準拠 (固定 Markdown 見出し構造・schema なし) | Step 5 で毎ラウンド上書き |
| `artifacts/{app_name}/pending-questions.json` | `schemas/pending-questions.schema.json` 準拠 (born-resolved entries) | Step 6「7 軸へ進む」時 |
| `artifacts/{app_name}/session-handoff.md` | cm-consult 同型 (表示専用、state SoT ではない) | Step 6「7 軸へ進む」時 |

## 参照

- 設計書: Confluence 4013883944 (Part 2 §2 ステップ仕様 / §3 スコア 6 軸 / §4 出力 artifact)
- 設計テンプレート: `phases/cm-consult/SKILL.md` / `skills/cm-consult/SKILL.md`
- ヒアリング規約: `skills/01-question/SKILL.md` (AskUserQuestion 規約 / born-resolved / 進捗表示 📍)
- fallback 書式: `skills/01b-add-feature-question/SKILL.md` § Plain chat fallback
- ハンドオフ先: `skills/01-question/SKILL.md` § Brief Pre-read Mode (ブリーフ先読みモード)
