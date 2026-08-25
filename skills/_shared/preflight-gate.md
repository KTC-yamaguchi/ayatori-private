# Pre-flight Gate (Shared Helper, Operating Principle 4 由来)

本 Gate を搭載する 9 phase (question / requirements / req-delta / design / screens / retro / delta / reverse / reverse-verify) の preamble が Execution に入る手前で実行する「未確定質問 (`pending-questions.json`) の batch 処理機構」の**唯一の標準手順**。本ファイルは実行手順 (a)-(g) と append 経路の Single Source of Truth (SoT) であり、各 phase の preamble は本ヘルパを Read して機械的に従う (旧 SoT `phases/design/SKILL.md` 5b から抽出)。phase 固有の逸脱は呼び出し側 preamble の**固有注記**として宣言され、その宣言範囲に限り本手順より優先する (逸脱の SoT は各 phase preamble 側 — 本ファイルには列挙しない)。新しい phase に本 Gate を追加する場合は、その phase の preamble に入力契約 4 値 (+ 必要なら固有注記) を定義した上で本ファイルを Read させる。

**境界宣言** (本ファイルが扱う範囲):
- **データ形状** の SoT は `schemas/pending-questions.schema.json` (entry の必須 field / lazy init 契約)。
- **概念・(D) UNCERTAIN 検出規律** の SoT は CLAUDE.md Operating Principle 4 ＋ `docs/principle4-disambiguation.md` (何を UNCERTAIN と判定するかの 4-step self-reflection)。
- **「ask する / 次の門へ持ち越す」の振り分け** は決定論なので script (`scripts/preflight-partition.mjs`) が行う。宣言 (どの artifact に反映するか = entry の `reflect_to`) は疑問の誕生時に appender が 1 語で書き、質問そのものは本 gate (session) が出す。
- 本ファイルは「**検出済み entry を preamble でどう捌くか**」のみを規定する。検出規律そのものは扱わない。

## 目的

- **main session 専用** (subagent は実行不可 — AskUserQuestion is not available to subagents、公式制約)。
- resolved 前の entry のうち **本 phase で反映先を持つもの**を Execution 開始前に **batch propose** し、user の確定を artifact に反映してから本編に進む (反映先が本 phase の責務外の entry は ask せず次の門へ持ち越す)。
- `propose-then-confirm` パターン (Anthropic 公式、Constitution "checks in more than necessary" 過剰質問アンチパターン対策、CLAUDE.md Rule 6 / pipeline.yaml P4-07)。

## 入力契約 (呼び出し側の phase preamble が提供する)

各 phase の preamble は本ヘルパを Read する際、以下 4 パラメータの**値**を自身の preamble 内に持つ (値は phase 固有のため本ファイルには集約しない = 単一所有権 / 二重管理回避):

| パラメータ | 意味 |
|---|---|
| `next_step` | (b) で **`ask[]` が 0 件**のとき進む、**preamble 内の次サブステップ番号** (`hold[]` の有無は問わない — 持ち越しは本 phase を止める理由にならない。(b) の規定と一致)。Execution の Step 番号ではない点に注意 (gate が preamble 最終サブステップの phase では例外的に Execution 先頭 step を指す) |
| `gate_before_step` | (c) で「この **Execution 先頭 step** 以降を走らせる前に gate する」の step 番号 |
| `target_artifacts` | (e) で user 回答を反映する update 対象 artifact (`artifacts/{app_name}/` 相対パス。glob 風 `requirements/*.md` 可)。**(b) の振り分け照合にも使う** — entry の `reflect_to` と突き合わせ、本 phase で反映できない質問を ask しない |
| `append_sources` | 新規 (D) UNCERTAIN を検出しうる本 phase 内の skill / subagent (append 経路の主体) |

## 実行手順 (a)-(g)

**(a) Read or lazy init** (docs/artifact-file-responsibility.md § 設計原則 4「lazy 初期化」):
- `artifacts/{app_name}/pending-questions.json` を Read。
- 存在しない場合は init stub `{ "app_name": "{app_name}", "entries": [] }` をメモリ上で初期化 (Write はまだしない、append 時にまとめて Write back)。

**(b) Filter & gate** (振り分けは script が決定論で行う):

```
node scripts/preflight-partition.mjs artifacts/{app_name} --target-artifacts "{target_artifacts}"
```

- `--target-artifacts` には `{target_artifacts}` の **パス部分だけ** を comma 区切りで並べて渡す (prose の修飾語「主に」「該当 token」等は落とす。例: `requirements.json / requirements/*.md` → `"requirements.json,requirements/*.md"`)。反映先を 1 つも持たない位置では `""` を渡す。各 phase の preamble は**この形で渡せるリテラル**を宣言しているので、宣言をそのまま貼れば足りる (宣言文を丸ごと渡すと path 形でない token として drop される)。
- 出力 summary JSON は `{ "ask": [...], "hold": [...], "open": N }` (`ask` / `hold` の要素 = `{index, target, reflect_to?}`、`index` は `entries[]` の添字)。振り分け規則は「`reflect_to` 未設定 → ask (従来挙動) / `reflect_to` が `{target_artifacts}` に一致 → ask / 一致しない → hold」。
- **`invalid_targets[]` が出た場合** (path 形でない token を渡した = 抽出ミス) は、その token を捨てて残りで振り分けた結果である。表示して抽出を直す:
  ```
  ⚠️ 振り分け条件に使えない値 {N} 件を無視しました: {invalid_targets を列挙} (phase 宣言のパス部分だけを渡すこと)
  ```
- `hold[]` が 1 件以上 → まず次の 1 行を表示する (`ask[]` の件数に関わらず)。**ask しない・`resolved_at` を押さない・未解決のまま残す**:
  ```
  ⏭ 持ち越し {N} 件 (反映先: {hold[].reflect_to を列挙} — 本 phase の書き込み責務外。該当 phase の入口で提案されます)
  ```
- `ask[]` が 1 件以上 → 以下 (c)-(g) を **`ask[]` の entry だけで**実行する (`index` で `entries[]` を引く)。
- `ask[]` が 0 件 → (c)-(e) は実行せず、**(f) の counter 再計算だけ行って**通常通り `{next_step}` に進む。`hold[]` が 1 件以上でも halt しない — 持ち越しは上記 1 行の表示のみで、本 phase を止める理由にならない (hold-only は「本 phase に聞くべき質問が 1 件も無い」と同じ扱い)。
- script が **exit 2** (JSON 破損 / 壊れた entry / `entries` の型不正 / 引数不正 / app ルート不在 / `--target-artifacts` に path 形の token が 1 つも無い) の場合は **従来どおり `resolved_at` unset の全 entry を ask する** (fail-open — 振り分けできないことを理由に人間の確定を止めない)。振り分けが効かない状態なので、この phase で反映できない質問まで ask される可能性がある = 黙って hold に沈めるより人間に見せる側に倒す設計。
  - **exit 2 のときは stderr の理由をそのまま 1 行表示する** (無音で全件 ask に落ちると、振り分けが死んでいることに誰も気づけない):
    ```
    ⚠️ 未確定質問の振り分けができませんでした ({stderr の理由}) — 全件を確認します
    ```
  - 理由が **`--target-artifacts` の token 不正**だった場合は、`ask` した回答を (e) で反映する先が不明ということなので、**ask する前に呼び出し側 preamble の `target_artifacts` 宣言をリテラルとして渡し直して再実行する** (宣言が壊れたまま ask すると、答えを台帳に記録しただけで artifact に反映されないまま resolved になる)。
- **キュー不在は exit 0 + 空結果** (新規プロジェクトの正常系)。「まだ無い」と「読めない」を同じ signal に潰さないため、exit 2 は上記の異常だけに限定されている。

**(c) Halt + Batch ask** (Step `{gate_before_step}` 以降の処理を走らせる前):
- `AskUserQuestion` を **ONCE** で (b) の `ask[]` entries を **batched separate questions** として ask (Anthropic 公式の `propose-then-confirm` パターン、Constitution "checks in more than necessary" 対策、CLAUDE.md Rule 6 / pipeline.yaml P4-07)。
- `ask[]` が 5 件以上の場合は、`AskUserQuestion` の 1 call 上限 (最大 4 問、`docs/principle4-disambiguation.md` §2 原則 3) に合わせて 4 問ずつ複数 call に分割し、本 gate 内で `ask[]` 全件を消化する (**ONCE** は「本 gate でまとめて聞き切る」の意で、call 数の上限ではない)。
- 各 entry の `question` / `header` / `options[]` を file literal からそのまま渡す (LLM が再生成しない、`feedback_askuserquestion_unicode_escape.md` の文字 diff 規律)。

**(d) Write back to pending-questions.json**:
- user 回答受領後、該当 entry に `resolved_at` (ISO 8601) / `resolved_answer` (user の選択 label) を merge。(c) で複数 call に分割した場合は **call ごとに回答受領後すぐ merge → Write してよい** (全 call 完了までメモリ保持のみにすると、途中でセッションが中断したとき回答済 entry が失われ同じ質問を再 ask することになる)。
- entry を削除しない (retro Pattern D 集計用に保持)。
- merge 後の object を Write (single writer = main session orchestrator)。

**(e) Update target artifact**:
- 各 entry の `target` (dot/bracket パス) を解析し、対応 artifact (`{target_artifacts}`) の値を user 回答で update。resolved entry 自体が confirmed-decisions ledger として `pending-questions.json` に残る (旧 `requirements.json.uncertainty.entries` ミラーは撤去済)。

**(f) Recompute counter**:
- `pipeline-state.json.pending_questions_open` = `entries[] where resolved_at unset` の length で再計算 (single writer = main session preamble)。
- **hold した entry も未解決として数える** (= (b) の summary `open` と同じ数)。持ち越しは「まだ答えを受け取っていない」状態であり、counter から落とすと次の門が発火しない。

**(g) Dedupe rule**:
- **同一 session 内で同じ target を 2 回以上 ask しない** (target literal で dedupe、pipeline.yaml P4-07)。

## append 経路 (新規 (D) UNCERTAIN 検出時、execution 中の skill から)

- main session 内 skill が (D) UNCERTAIN を検出した場合: pending-questions.json を Read or init-stub → entries に新 entry を append → Write back。
- **未解決 entry の append は `reflect_to` (user 回答を反映する artifact の `artifacts/{app_name}/` 相対パス) を併記必須** — appender は疑問を検出した時点で反映先ファイルを手に持っている (例: `tokens.json` に TBD を書いたその手)。これが (b) の振り分けの唯一の材料であり、書かないと反映できない phase の門で消費されて答えが迷子になる (E2E 実測)。反映先が定まらない決定事項は未設定でよい (従来どおり次の門で ask される)。
- **born-resolved entry (`resolved_at` + `resolved_answer` を同時に書く確定記録) には `reflect_to` を書かない** — 振り分け script は `resolved_at` が set の entry を読む前に抜けるため値が使われる経路が無く (reader もゼロ)、書いても台帳を太らせるだけ。必須は**未解決 append に限る**。
- **書ける値は次の 7 pattern のいずれかに一致するものに限る** (= いずれかの phase の `target_artifacts` が受け付けるパスの和集合。どの門が受けるかの正本は各 phase preamble の `target_artifacts` 宣言であり、本リストはその和集合の再掲):
  `requirements.json` / `requirements/*.md` / `design-brief.yaml` / `tokens.json` / `screens/00-coverage-check.json` / `screens/*.md` / `reverse-engineered/*.md`
  - **glob を含む pattern には具体パスも一致する** (照合は前方 / 後方一致なので `requirements/05-features.md` は `requirements/*.md` に当たる)。glob と具体パスのどちらで書いてもよいが、**リストのどの pattern にも一致しない値は書かない**。
- **加えて「自分より後に通る門」が受け手であること** — リストにある値でも、受け手が上流 phase しか無ければ正順の進行では二度と ask されない (例: Phase 3 の skill が `tokens.json` を宣言すると、受け手は Phase 2 design だけ)。この形になる場合は (a) その反映先を持つ phase へ user を戻す resume 指示を併記する か (b) 反映先が定まらないものとして `reflect_to` を書かない (次の門で ask される) の 2 択で、**上流だけを指したまま放置しない**。
- リストに無い値 / typo を書くと、その entry はどの門でも ask されず永久に持ち越される。機械検出の仕組みは現状無く、各 gate が出す持ち越し 1 行の表示だけが手がかりになる。
- subagent が検出した場合: `assertion_failed: pending_question` を orchestrator skill に return し、orchestrator skill が main session 経由で append (subagent は直接 append しない、AYATORI single writer 原則)。
- appended entry は同一 session 内では ask せず、次回 phase 起動時の本 Gate が batch propose する (CLAUDE.md Rule 6 / pipeline.yaml P4-05・P4-07)。
- 本 phase における具体的な skill / subagent / orchestrator 名は、呼び出し側 preamble の `append_sources` を参照。

## 関連

- `schemas/pending-questions.schema.json` — データ形状 SoT (entry 必須 field / `reflect_to` / lazy init 契約)
- `scripts/preflight-partition.mjs` — (b) の振り分け器 (ask / hold の決定論判定。READ 専用・exit 2 は全件 ask に fail-open)
- CLAUDE.md § Operating Principle 4 — 概念と (A)-(E) 5 分類、append 3 経路の説明
- `docs/principle4-disambiguation.md` — (D) UNCERTAIN 検出の 4-step self-reflection ＋ 適用 skill 索引
- `pipeline.yaml` constraints `P4-05` (append → 次 Phase 入口で batch propose、subagent は append のみ) / `P4-06` (schema 欠落 = UNCERTAIN) / `P4-07` (dedupe / batch propose)
- `pipeline.yaml` artifacts (`pending-questions.json` の readers 定義)
- 各 phase の SKILL.md preamble (本ヘルパを Read する呼び出し側)
