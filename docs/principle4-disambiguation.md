# Operating Principle 4 — Disambiguation Check (運用手順 SoT)

> 本ファイルは CLAUDE.md「### 4. 未確定情報は補完せず質問する（UNCERTAIN → ASK）」と
> `pipeline.yaml` `constraints[id=P4-01〜P4-07]` の **運用手順 (how-to) の SoT**。
>
> - **policy** (5 分類タクソノミー A〜E / Rule 1-6) の SoT = `CLAUDE.md` Operating Principle 4
> - **machine-readable spec** (applies_to 等) の SoT = `pipeline.yaml constraints[P4-*]`
> - **運用手順** (skill 実行時にどう適用するか) の SoT = **本ファイル**
>
> 本ファイルは policy を再定義しない (SoT 1 箇所原則、memory `feedback_global_policy_in_claudemd_only`)。
> 各 skill は本ファイルを **参照** する (内容のコピペは禁止 = paper-over)。
>
> 設計経緯と確定理由: Confluence 3882844743 (§12)。

---

## 0. 前提 — 何を、なぜ検出するのか

- **対象**: CLAUDE.md 5 分類のうち **(D) UNCERTAIN** のみ。
  - (A) CONFIRMED / (C) DERIVED は ask しない (前者は確定値、後者は導出元を参照)。
  - (B) ILLUSTRATIVE / (E) PROPOSED は human gate に委ねる (gate 未通過のまま下流参照しないだけ)。
  - これは過剰質問の禁止 (Rule 6 / P4-07) と同じ線引き。
- **候補は LLM の推論で炙り出す (keyword リストには依存しない)。ただし判定トリガーは「書き出した解釈候補の数」という外形的事実に置く (AI の主観的な「迷い」ではない)。**
  - 「曖昧表現の固定 keyword (〜的な / できれば / 〜など 等) を grep する」方式は採らない。理由:
    (a) hardcode の管理コスト、(b) 列挙漏れで素通り、(c) 誤 hit。
  - 同時に、判定軸を **AI の内部感覚 (「迷ったか / 確信が持てるか」) に置く方式も採らない**。内部感覚は
    **検証不可能で同一入力でも実行ごとに揺れ**、本 Principle が抑止対象とする「AI の主観的補完」を
    トリガー自身が再生産してしまう (自己矛盾)。
  - よって本手順は **「解釈候補を文字で列挙し (推論で炙り出す) → その候補数で機械的に判定する」** という
    外部化された二段構えを採る。推論は候補を *生成* するために使い、判定は *書き出した数* で行う。これは
    §5.2 が既に採る「列挙は機械・判定は AI / 自由 self-reflection は黙ってスキップできる」原則を input 側にも
    適用したもの (設計経緯 K-5)。

---

## 1. Disambiguation Check — 4-step (出力 / Write 直前に実行)

対象 skill (§3) は、artifact を Write / 値を確定する **直前** に以下を実行する。

### Step 1 — 解釈候補の列挙 (文字で書き出す)

今から書こうとする値・解釈について自問し、**候補を文字で書き出す** (内省で 1 つに畳まず、出力として外部化する):
「**この入力 / この欄を、自分はどう解釈したか。他にも妥当な解釈はあるか。**」
数えるのは「**出力が変わる解釈**」(単なる言い換えの重複は 1 と数える)。書き出した候補が Step 2 の判定材料になる。

> **書き出し先は「読み手 (consumer) のいる所」だけに置く** (専用ファイル・一時ファイルは作らない):
> - **対話 step (flavor a)**: その turn の **可視の応答** に列挙する (thinking に畳まない)。N≥2 で発火したら Step 4 で
>   `pending-questions.json` の `options[]` に転記 ＝ 候補がそのまま質問になる (consumer = 人間)。
> - **生成 step (flavor b)**: 値ごとのチャット列挙はしない (consumer 不在のノイズ)。生成側の "public な数え上げ" は
>   §5 出力側監査が担う (別パスが全要素を独立列挙し、人間ゲートが読む)。
> - **N=1 で通過する列挙は consumer がいないので、どこにも転記しない** (読み手なき write-only は、かつて撤去された
>   `uncertainty.entries[]` ミラーの再発 = dead mirror)。front-line の count は機械検証されない **inspectable な
>   best-effort** であり、確実な担保は §5 (= 外部化は「行動強制」と「発火時に質問になる」ことに価値があり、archival ではない)。

### Step 2 — ambiguity 判定 (書き出した候補数で機械的に判定)

Step 1 で**書き出した**解釈候補の数だけで判定する (「悩んだか」という内部感覚は問わない):

- 書き出した候補が **N=1** → そのまま進む（Step 3 へ）。
- 書き出した候補が **N≥2** → **(D) UNCERTAIN**。

### Step 3 — flavor 判定と 3 分類

step の性質により 2 つの flavor がある (どちらを使うかは §3 の表で決まる)。

#### Flavor (a) input-interpretation — input 受領 step

新しいユーザー input を解釈する step。input の解釈が割れたら UNCERTAIN。
ラベルとして 3 分類を付ける (分類はトリガーではなく、**曖昧さの種類の説明**):

| 分類 | 定義 | 例 / 扱い |
|---|---|---|
| **semantic** | 1 入力が複数の実装解釈に割れる | 「なんかかっこいい感じで」→ 高級感 / シンプル / スタイリッシュ … のどれか不定 |
| **softening** | 確信度が低いマーカー付き | 「できれば」= 生成可否を問うている (可能なら進む / 不可なら確認)。「たぶん」= 自信なく意見 → AI が具体案を提示して確認 |
| **enumeration** | 開いた列挙 | 「A など」= A でも競合 B でも可 → A/B どちらがイメージに近いか確認 |

#### Flavor (b) gap-source-check — AI 生成 step

その turn に新規ユーザー input は無く、上流 artifact (requirements.json / design-brief.yaml 等) は
確定済 (CONFIRMED)。ここでは input 解釈ではなく、**今書く値の根拠**を自問する:
「**この値は (A) CONFIRMED か (C) DERIVED に裏付けられているか。根拠なく自分で決めようとしていないか。**」
根拠が無い (= 勝手な新規の決め事) なら **(D) UNCERTAIN**。

- 確定済の上流を **再質問しない** (Rule 6)。拾うのは「根拠の無い新規の決め事」だけ。
- これは Rule 1 (要件外機能の追加禁止) / Rule 2 (視覚要素は CONFIRMED→DERIVED のみ) /
  Rule 5 (必須 field 欠落) と同じ領域を、Write 直前の self-check として実行するもの。

### Step 4 — artifact 形式 (pending-questions.json が唯一 SoT)

UNCERTAIN を検出したら `artifacts/{app_name}/pending-questions.json` に append する。

- **ask キューの唯一の SoT は `pending-questions.json`** (R-AMB-3)。必須化 (HIGH 曝露 step) の
  対象もここ。(E2E 検証で、かつて存在した `uncertainty.entries[]` ミラー [requirements/design-brief/coverage-check schema 内] は
  「誰も populate せず読む consumer も dead」と判明したため Chunk 2 で撤去 — 未確定/確定情報の SoT は本 file に一本化。)
- entry に埋める field: `target` (dot/bracket path) / `question` / `options[]` (Step 1 の解釈候補を 2-4 件に
  整形) / `ambiguity_kind` (semantic | softening | enumeration) / `raised_by_step` / `raised_at` /
  **`reflect_to`** (回答を反映する artifact の `artifacts/{app_name}/` 相対パス。例 `tokens.json`)。
- **`reflect_to` は append する側が誕生時に宣言する** — 疑問を検出した skill は反映先ファイルをその場で
  手に持っている (例: `tokens.json` に TBD を書いたその手)。反映先が定まらない決定事項は未設定でよい。
  ただし宣言できるのは **未解決 entry のみ** で、次の 2 条件を満たす値に限る (許容値リストと判断基準の
  SoT は `skills/_shared/preflight-gate.md` § append 経路。本文はその再掲):
  - **born-resolved entry (`resolved_at` + `resolved_answer` を同時に書く確定記録) には書かない** —
    振り分け script は resolved を読む前に抜けるため、値が使われる経路が無い (reader もゼロ)。
  - **いずれかの phase の `target_artifacts` が受け付ける pattern であり、かつ自分より後に通る門が
    受け手であること** — 受け手が上流 phase だけの値を書くと正順の進行では二度と ask されない。
    その形になる場合は (a) 反映先を持つ phase へ user を戻す resume 指示を併記する か
    (b) 反映先が定まらないものとして未設定にする (次の門で必ず ask される) の 2 択。
- **直接 `AskUserQuestion` を発火しない。** 次 Phase 入口の Pre-flight Gate が unresolved entries を
  batch propose する (propose-then-confirm)。subagent は append のみ、resolve は main session のみ
  (公式制約: AskUserQuestion is not available to subagents)。
- **ask されるのは「その phase で反映できる」entry だけ**: Gate は `reflect_to` を phase の
  `target_artifacts` と照合し (決定論 script `scripts/preflight-partition.mjs`)、解決できない entry は
  ask せず未解決のまま次の門へ持ち越す (件数と反映先を 1 行表示するのみ)。反映先の無い phase で答えを
  消費すると、確定値が本来の受け皿 (例 `tokens.json` を書ける `/ayatori-design` 入口) に届かないまま
  resolved になる (E2E 実測)。`reflect_to` 未設定の legacy entry は従来どおり全件 ask される。
- **確定した decision も同じ file に記録する (confirmed-decisions ledger、E2E 由来)**: UNCERTAIN を
  inline AskUserQuestion / gate Q&A / 3 案選択 等で **解決した瞬間に**、その entry を **必須 field 全件**
  (`target` / `question` / `raised_by_step` / `raised_at` — schema `required` + hook R3 が無条件要求) + `resolved_at` +
  `resolved_answer` 付きで append する (queue を経由せず born-resolved でも可。**`raised_at` / `question` 省略は hook R3 が exit 2 で弾く**)。これが §5 の **requirements 層監査の突合先「user 確定 input」**
  となり、retro Pattern D の集計源にもなる。E2E 検証では曖昧が inline 解決され pending-questions.json が一度も
  書かれなかった (queue は実運用で空) ため、本 ledger は **「解決＝記録」を明示する**ことで初めて map source として機能する。
  ledger が不完全でも §5 監査は `00-raw-input.md` + 7 軸も突合先に含むため、silent miss でなく **false-positive (gate で容認) に
  degrade** する (graceful degradation)。**記録する確定 decision の粒度**: gate / 補完質問で確定した specifics (例: データソース=
  ハードコード、永続化=SQLDelight、気分入力=スライダー) — これらが requirements に現れたとき「AI 発明」と誤検出されないため。

---

## 2. 質問する基準 (When to ASK) — 6 原則

Pre-flight Gate で batch propose する際の指針 (memory `feedback_design_by_disambiguation`)。

1. **(A) CONFIRMED は ask しない。** 確定値・承認済・一次ソースは無条件参照。(D) と判定したものだけ ask。
2. **high impact から ask。** 下流依存の大きい論点を優先し、依存関係を整理してから出す。
3. **関連質問は batch 化** (1 回の `AskUserQuestion` は最大 4 問)。
4. **propose-then-confirm。** 3 案以上 + 推奨を第 1 候補に明示 + 各 option に description 必須。
   (halt-and-ask ではなく「方向を提案して選んでもらう」= Anthropic 公式 best practice)
5. **counter-proposal は深掘り。** user の Other 自由記述を解析し、新たな N≥2 があれば再 ask。
6. **専門用語・背景は直前の plain chat で事前説明。** 背景・根拠を ask 文に inline で詰め込まず、
   `AskUserQuestion` 呼び出しの直前に plain chat で「どの機能/項目に関する質問で、何を決めるのか」を
   提示してから、ask 文自体は短く保つ (非 ASCII テキストは文長・質問数に比例して壊れやすい —
   `skills/00-memory-load/SKILL.md` の presentation 規則参照)。

加えて **Rule 6 (dedupe)**: 同一 `target` を同一 session で 2 回以上 ask しない
(`pending-questions.json` の `target` literal で dedupe、`resolved_at` set 済は skip)。

---

## 3. 各 skill での適用箇所 (field index)

対象は二重防御である: input 受領 step を主眼にしつつ AI 生成 step も backup で含める。
各 skill は固有の適用 field を **例示** するのみ。手順 (§1) は本ファイルを参照する (コピペ禁止)。

| skill | flavor | 適用 field 例 (現場固有) |
|---|---|---|
| `01-question` | (a) | 7 軸回答: target user 像 / problem の vague qualifier / Must 機能の段階 / 制約の実現性 / platform 優先 / illustration_policy |
| `01a-idea-brushup` | (a) | 発散/収束/具体化の回答解釈: Who / 課題 / コア機能の具体値、CxO 批評リアクション (そう思う/そうは思わない) の意図 → born-resolved (`idea_brief.*`) への記録 |
| `02-iso-breakdown` | (a)+(b) | 7 軸回答 / 既存要件の解釈 (a) + must/should/could に機能を足す根拠 (b, P4-02「要件にない機能追加禁止」) |
| `03-requirements-gen` | (b) | リバース要件が source evidence に根拠を持つか (Principle 3 一次ソース優先と連動、未根拠の推測は UNCERTAIN) |
| `08-design-brainstorm` | (a) | ヒアリング再解釈: トーン / ブランド方向 / カラーイメージ → design-brief case への落とし込み |
| `31-req-change-detect` | (a) | 変更記述の `type` (added/modified/removed) / `dependency_category` 分類 / impact_hint |
| `27-change-detect` | (a) | 変更記述の解釈 / 影響画面の特定 |
| `00-feedback-protocol` | (a) | review 修正指示のスコープ (「色だけ」vs「全体」等) |
| `14-screen-list-transition` | (b) | 画面数の必要性 / 状態違いと別画面の分界 / Mermaid node 分類の根拠 |
| `17-screen-gen` | (b) | token 補完 / platform 判定 / theme 処理が CONFIRMED・DERIVED 由来か |
| `19-rubric-score` | (b) | AI改善可否の分界 / NFR の automated-vs-deferred 分類の根拠 |

> 注: skill id と適用 field は実装 (F7) で各 SKILL.md と突き合わせて確定する。本表は索引。

---

## 4. 参照規約

- 対象 skill (§3) は §1 の 4-step を **必ず実行**する。
- §2 は Pre-flight Gate で batch propose する際の **推奨参照**。§3 は適用箇所の **索引**。
- **policy** は `CLAUDE.md` Operating Principle 4、**machine spec** は `pipeline.yaml constraints[P4-01〜07]`
  が SoT。本ファイルは **運用手順** の SoT であり、policy / machine spec を再掲・再定義しない。
- 本ファイル自体が、この disambiguation 手法による設計プロセスの成果物
  (詳細経緯: PR #79 / Confluence 3882844743)。

---

## 5. Output 側監査 — 要件外追加リスト

§1-§4 は **input / 生成時** の disambiguation (生成前に曖昧さを質問)。本 §5 は **生成後** の安全網:
**合意済み `requirements.json` に記載が無いのに AI が想像で補完した仕様 / UI を、生成後の review/gate が
突合検出して `requirement-deviations.json` に記録する**。self-reflection は確率的で 100% 防げないため、
「防げないなら *勝手に足したもの一覧* を出して人間が目視全確認せず済むようにする」という user 要望に応える。

### 5.1 原則
- **原則は「生成は触らない」**: 生成 step にチェックを足して重くしない。既に成果物を読む **review/gate pass に lens を
  相乗り**させる (他人レビュー効果 + ゼロ生成オーバーヘッド)。**screens / design / sub-state 層はこの原則を維持**
  (生成 [17 / 08 / 25b] と監査 [18 / 13 / 25c] が別 step で他人レビュー効果が成立する)。
- **例外1: requirements 層は二段構成 (F-3)**: requirements 層は Step02 生成と Step07 監査が同一 session・
  同一 model で「他人レビュー効果」が成立せず self-bias が漏れる (ablation 実証「生成 context を持つと検証の起点となる疑問が生成されない」)。これを (1) 生成側 Step02 が
  `generation-provenance.json` に load-bearing specifics を全件 forced-enum 自己申告 (**F-3a**、スキップの自由を奪う) +
  (2) 監査側を `ayatori-requirements-auditor` subagent (`layer="requirements"`) に分離して生成 context を物理隔離し provenance を再判定 (**F-3b**、
  self-bias catch) の二段で補う。生成側 self-report (`generation-provenance.json`) は監査の正本ではなく
  「**監査が誤申告を catch する検証対象**」(provenance ラベルは判定に使わず mismatch 記録のみに参照、REQ-AUD-03)。
- **例外2: delta 層も監査 subagent 分離 (F-3b 拡張)**: delta (Step 29) は部分再生成 (生成) と
  Layer-REQ 監査を **同一 step・同一 session** で実行するため、requirements 層と同型の self-bias を持つ (「最も要件外を足しやすい」と
  自認する層が無防備だった)。Step 29 の Layer-REQ を `ayatori-requirements-auditor` subagent (`layer="delta"`、突合先 = 変更後
  `requirements.json`) に委譲して生成 context を隔離する。delta は生成側 provenance 台帳を持たないため **F-3a (provenance 申告) は無く、
  F-3b (監査 subagent 分離) のみ**適用 (`self_bias_signal` は付かない)。
  **screen-edit の逆方向 (Step 29b) も同 subagent を使う** (`layer="delta"` + `audit_direction="reverse"`、突合先 = `requirements/*.md`、
  監査範囲 = 手編集 diff が触れた要素のみ — 編集が導入していない既存の画面↔要件ギャップは対象外)。検出 3 種は
  要件外追加 / 要件矛盾 / 要件削除 で、ゲートで「要件に昇格」に選ばれた逸脱は Step 29c が `requirements/*.md` へ反映して
  `resolved_at` を stamp する (`requirements.json` は不変)。
- **input 側 (pending-questions.json) の対**。input=生成前の曖昧さ / output=生成後の要件外逸脱。
- **対象 = (再)生成パス全般**: **requirements (Phase 1b)** / design / screens / **delta 部分再生成 / sub-state 生成 / reverse (Phase 0b)**。
  requirements が対象に加わった経緯: E2E 検証で「AI が発明した値 (例: スコアリング式 ×2.0/×-1.0/×0.1)
  を requirements に確定事実として記述 → downstream の design/screens 監査は requirements を正とするため laundering で検出不可」が
  実証され、「input 側 (01/02) でカバー済」の旧前提が falsify された。reverse Phase 0b (03-requirements-gen) も同じ『requirements 生成 path』で同パターンの laundering 脆弱性を持ち、**reverse review gate (Step 05) で配線済** (下記 例外3)。req-delta(1c) / add-feature(1d) は同パターンの follow-up 対象 (現状未配線)。
- **例外3: reverse 層 (Phase 0b) も監査 subagent 分離**: リバース生成 (Step 03) は「実コードに無いのに一般論で埋めた推測」を
  source 事実として定着させやすく (ChargeMinder バッジ「介入群限定」誤読)、Step 03 生成と監査が同一 model で self-bias が漏れる。
  Step 04↔Step 06 間の **reverse review gate** (`05-review-gate`) が `ayatori-requirements-auditor` subagent
  (`layer="reverse"`、突合先 = `input-sources/{stack}/` 実コード file:line) を起動して生成 context を隔離する。
  reverse は生成側 provenance 台帳 `reverse-provenance.json` を持つため **F-3a (provenance 申告) + F-3b (監査 subagent 分離) の両方**適用
  (requirements 層と同型。`source_backed` 申告を input-sources へ literal トレースで再判定し誤申告を `self_bias_signal` で catch)。
- **層によって突合先が異なる**: design / screens / delta / sub-state は「生成物 ⇄ `requirements.json`」
  (例外: delta の screen-edit 逆方向 [29b] のみ突合先は `requirements/*.md` — 昇格済み要件が md に反映されるため、json 突合だと昇格分を毎回再検出してしまう)。
  **requirements 層は requirements.json 自体が被監査物**なので、突合先は「**user 確定 input**」=
  confirmed-decisions ledger (`pending-questions.json` の resolved entries) + `00-raw-input.md` + `requirements.json` の 7 軸 hearing fields。
  **reverse 層は `reverse-engineered/01-08.md` が被監査物**なので、突合先は「**証拠ソース実物**」=
  `input-sources/{stack}/` 実コード file:line (code presence 時の一次。CLAUDE.md Operating Principle 3) +
  `ground-truth/` アーカイブ (root 直下 `*.md` 文書 [Confluence / local / Jira 課題正規化本] / `figma/` capture。code 不在の縮退モードでは figma capture が主突合先)。

### 5.2 監査手順 (review/gate pass が実行) — forced-enumeration
**「列挙は機械・判定は AI」のハイブリッド**。自由 self-reflection だと AI が要素を黙ってスキップでき、
確信を持った沈黙補完を取りこぼす (純 self-check 最大の穴)。列挙を機械化し「**全件を要件に突合させる**」ことで
スキップの自由を奪う。

> **監査主体と layer (F-3b 拡張、reverse 追加)**: requirements 層 (Step07) ・ delta 層 (Step29 forward /
> Step29b の screen-edit 逆方向) ・ reverse 層 (Phase0b の 05-review-gate) の監査は> `ayatori-requirements-auditor` subagent が実行する (生成 context を物理隔離して self-bias を断つ。`layer` で突合先を切替:
> requirements=user 確定 input / delta forward=変更後 requirements.json / delta reverse=requirements/*.md / reverse=input-sources/{stack}/ 実コード file:line)。subagent は生成物 (generation-provenance / reverse-provenance / 生成済 HTML) を
> **列挙の起点にせず独立に再列挙**し (REQ-AUD-04)、requirements 層では provenance ラベルを判定に使わず不一致 (`self_bias_signal`)
> 記録のみに参照する (REQ-AUD-03)。delta reverse のみ列挙対象を手編集 diff が触れた要素に限定する (REQ-AUD-06 — 既存ギャップで
> ゲートを埋めない)。`07` / `29` / `29b` の main が return を `requirement-deviations.json` に append する単一 writer。
> design/screens/sub-state 層は従来どおり gate step が inline で実行する (生成↔監査が別 step で他人レビュー効果が成立)。
>
> ⚠️ **正当化逆張り (REQ-AUD-05、ablation 検証由来)**: 被監査物の本文に手厚い正当化 (「○○理論に基づく必然」「研究が
> 支持」等) が書かれているほど、それは AI が発明を正当化込みで成果物に定着させ downstream 監査を回避する **laundering** の典型。
> **説得力は安心材料でなく危険信号**として扱い、突合先への literal 根拠の有無だけで判定する (ablation で「正当化散文は判定を
> DERIVED 側に priming する」と実証されたため、正当化の量を疑いの量に変換する向きで効かせる)。

1. **列挙 (機械)**: 成果物が既に持つ **構造化リスト** を列挙源にする (生 HTML の fuzzy parse はしない):
   **requirements = `requirements/*.md` の load-bearing specifics (定量値・式・閾値・外部依存 API/lib・データ enum/field) + 機能 capability / use-case の挙動ステップ / 新規 content・data 前提** (例:「回答後に解説を表示」= 解説コンテンツという content/data を要する /「前回の続きから再開」= resume state+挙動を要する) /
   **screens = 画面仕様書 (.md) の component 一覧 + 挙動 / インタラクション / 状態** (UI 生成フェーズで AI が要件外に足した
   element/behavior を拾う = 元課題「UI生成フェーズでの要件にない要素の追加」。component だけでなく
   「この画面が要件にない挙動/状態を持っていないか」も全件マップする) / design = design-brief の case・token・dial /
   delta = 再生成画面の component **+ 挙動** / sub-state = 各 state の主要要素 **+ 挙動**。
   > requirements の粒度は **F-ID / NFR-ID 単位で止めず「中の具体値」まで降りる**: E2E 検証の I-2 は確定機能 F-01 の
   > "中" に発明されたスコアリング式であり、機能カテゴリ粒度の gap-check (02 の flavor-b) では素通りした。よって specifics 粒度が必須。
   > **全件列挙が原則** (本ステップの目的 = スキップの自由を奪う。over-flag は gate で却下できるが silent skip は検出不能なので、一覧は長い方が安全)。
   > 判定は 1 つの問いに集約する:「この文は、システムが **何を持つ・何をするか** を具体的に 1 つでも特定しているか?」
   > 値・式・閾値・データ項目・外部依存・機能・挙動・状態・content 等のいずれかを特定できる → **列挙** (これが **load-bearing**)。
   > 除外してよいのは「**特定できる対象が 1 つも無い文**」のみ。例:「〜を目的とする」「〜を向上させるため」「なぜなら〜」=
   > 理由・効果・意義のみを述べ、システムが何を持つ・何をするかを特定しない文。
   > **特定できるか判断がつかなければ列挙する** (除外するには「何も特定していない」と断定できる必要があり、誤った除外は
   > 「ここで ○○ を特定している」と反証できる ＝「修辞か」のような判定と違い抜け道が検出可能。§5 冒頭「スキップの自由を奪う」/ §0 graceful degradation と整合)。
   > **StudyLoop での検証で「回答後の解説表示」「セッション中断復帰」等の機能/挙動発明が、定量値限定の
   > 旧定義 (定量値・外部依存・データ schema に絞る) をすり抜けた件への対応** — 数値 hallucination だけでなく機能/挙動 hallucination も拾う。
2. **全件マップ (AI、強制)**: 列挙した **各要素を 1 つずつ** 上流に突合し「何に基づくか (`requirement_ref`)」を埋める。
   突合先は層による (§5.1): design / screens / delta / sub-state は `requirements.json` (+ design-brief)、
   **requirements 層は user 確定 input (ledger + 00-raw-input + 7 軸)**。**埋められない = 要件外 (requirements 層では = AI 発明)**。
   > **screens の visual/motion/animation 挙動は design-brief にも突合する** (Step18 検証で判明):
   > tape-counter / staggered fade 等の motion は **選択済み design-brief case (Step10 gate 通過)** が出所なので、requirements に
   > 無くても design-brief にあれば **(C) DERIVED で非flag**。motion 挙動を requirements のみ突合して 要件外 扱いするのは false-positive。
   > (requirements にも design-brief にも無い新規 motion は依然 (E) 要件外。)
   「気づいたものだけ」ではなく **列挙した全件を必ず account** する (黙ってスキップ不可)。
   > **capability / 挙動の DERIVED↔(E) 判定 — 2-step 決定木** (FB#3 r3360529164 で「機械的必然」を operationalize): 「機械的必然か」という主観述語をやめ、次の 2 問で判定する:
   > **① 確定機能の動詞をそのまま言い換えただけか?** (例:「学習」→「回答を受け付ける」「次の問題へ進む」) → **Yes: (C) DERIVED** (確定機能がそのまま動いているだけ) / No → ②
   > **② 確定 input に *無い* 新しい名詞 (content名 / data名 / 機能名 / 外部サービス名) を新たに要求するか?** → **Yes: (E) 要件外追加** / **No: (C) DERIVED**
   > 「新しい名詞」に **内部実装語は含めない**: シリアライズ形式 (JSON 配列等) / テーブルキー方式 (singleton 等) / 内部 field 型 (ISO 8601 等) など、新しい user-facing 機能・content・data REQUIREMENT を導入しない開発実装決定は (C) DERIVED (旧「pure 実装 HOW 除外」を②の語彙に統合)。
   >
   > **判定は「確定 input に対して相対的」** — 同じ挙動でもアプリ/確定 input が違えば判定は変わる。例は前提を併記する:
   > 例 (前提: **クイズ学習アプリ**。確定 input に「クイズ形式で学習する」「弱点カテゴリを出題」はあるが、**解説コンテンツ・中断復帰・進捗保存は user 未確定**):
   > | 生成物の挙動 | 突合先 (確定機能/input) | 判定 | 理由 |
   > |---|---|---|---|
   > | 回答を受け付ける | クイズ学習 (確定) | (C) DERIVED | クイズ学習に内在＝動詞の言い換え・新名詞なし (①) |
   > | 次の問題へ進む | クイズ学習 (確定) | (C) DERIVED | 同上 (①) |
   > | 解説を表示する | 該当なし | (E) 要件外 | 確定 input に無い「解説コンテンツ」を新たに要求 (②) |
   > | 前回の続きから再開 | 該当なし | (E) 要件外 | 確定 input に無い「進捗データ (resume state)」を新たに要求 (②) |
   >
   > 境界が曖昧なら (E) 側に倒す (flag して gate で容認させる方が silent miss より安全。§0 graceful degradation / REQ-AUD-05: 手厚い正当化散文は priming でなく laundering を疑う)。
3. **要件外 → append**: `requirement_ref` を埋められなかった要素を `requirement-deviations.json` の `entries[]` に
   append (`deviation_kind` = 要件外追加 / 根拠薄弱 / 想像デフォルト)。`severity` は新設要素の該当有無で機械判定する (「含意」の主観でなく):
   **high** = 個人情報・認証・権限 / 課金・決済 / 法的表示・コンプライアンス / データ削除・送信等の不可逆操作 のいずれかを新たに扱う、
   **medium** (high 以外) = Must 機能に直接紐づく数値・式・閾値の新設 or Must 機能が依存する外部 API・ライブラリの新設、**low** = 上記以外 (表示のみ・慣例的デフォルト)。
4. **coverage 記録 (必須・0 件でも)**: 列挙総数を top-level `coverage[]` に記録 (`{ phase, raised_by_step, enumerated_count, checked_at }`)。
   **deviations が 0 件でも必ず記録する** (Step13/18 検証で取りこぼし判明)。理由: coverage が無いと
   **「N 件 enumerate して 0 件 flag = 健全な clean pass」と「そもそも監査していない」が artifact 上で区別できず**、clean
   (0-deviation) 結果の信頼性が失われる。view が「何件突合したか」を出す前提でもある。
5. **view 生成**: `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` を実行し
   `requirement-deviations-view.html` を **決定論生成** (手焼きしない。renderer が単一 SoT)。

> **盲点の明示 (バイアス対策、user 壁打ち)**: 本監査は **spec-level の構造化リスト** しか列挙しない。
> ① component 内のサブ詳細 (文言・軸ラベル・数値) ② 仕様書に無い要素 は **自動チェック対象外**。
> よって **一覧が空でも「要件外ゼロ」ではない**。view 冒頭でこの盲点を明示し、人間ゲートの目視で拾わせる。
> 一覧は目視を *減らす floor* であって *置き換える ceiling ではない* (§5 冒頭・§0 の限界)。

### 5.3 writer / reader / gate
| phase | writer (review pass) | gate (人間提示) |
|---|---|---|
| requirements (Phase 1b) | `07-human-gate-req` が **`ayatori-requirements-auditor` subagent を起動** (生成 context 隔離、F-3b) → return された deviation candidates を append (single writer)。subagent は `requirements/*.md` の load-bearing specifics を独立 forced-enum し **user 確定 input** (ledger + 00-raw-input + 7軸) と突合、生成側 `generation-provenance.json` (writer=02-iso-breakdown) を検証対象に provenance 再判定 | Step 07 |
| design (Phase 2) | `13-human-gate-design` が design-brief / tokens を requirements と突合 | Step 13 |
| screens (Phase 3) | `18-design-review` が全画面を requirements と突合 (既存 Layer 0-CSS の隣に lens 追加) | Step 21 |
| delta (Phase 5) | `29-partial-screen-regen` が **`ayatori-requirements-auditor` subagent (`layer="delta"`) を起動** (生成 context 隔離、F-3b 拡張) → 再生成画面の component + 挙動を変更後 requirements.json と突合、return を append (single writer)。delta は再生成↔監査が同一 session のため隔離必須 (Step 18 を通らない独自パス) | Step 29 gate |
| sub-state (Phase 3) | `25c-state-pattern-score` が sub-state HTML を requirements と突合 | Step 25d gate |
| reverse (Phase 0b) | `05-review-gate` が **`ayatori-requirements-auditor` subagent (`layer="reverse"`) を起動** (生成 context 隔離) → `reverse-engineered/01-08.md` の specifics を独立 forced-enum し **input-sources/{stack}/ 実コード file:line** と突合、生成側 `reverse-provenance.json` (writer=Step 03) を検証対象に provenance 再判定、return を append (single writer)。Step 04↔Step 06 間に位置し Step 04 skip 時も必ず実行 | Step 05 gate |

> delta は「変更への適応」で過剰適応しやすく要件外リスクが高い。Step 18 を経由しないため独立に lens が必須。
> reverse は「実コードに無いのに一般論で埋めた推測」を source 事実として定着させやすい。Phase 0b に従来要件人間ゲートが無かったため Step 05 で新設。

### 5.4 HTML view (`requirement-deviations-view.html`) の生成
view は **単一の決定論的 renderer `scripts/render-deviations-view.mjs` (Node.js のみ、npm 依存ゼロ)** が JSON から
生成する。各 writer は `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` を
呼ぶだけ (**手焼き禁止** — 旧設計の「各 writer がフリーハンド再生成」は書式 drift の温床だった。tokens.json→
style-guide-view.html と同じ「machine SoT → 決定的 derived view」パターンに統一)。
renderer の出力: 未resolved 件数の集計 / phase 別セクション / `severity=high` の強調 / 冒頭に
**「これは AI が気づいた分のみ・漏れはありうる (空でも要件外ゼロとは限らない)」** の disclaimer (§5 限界の明示)。
目的は「人間が成果物を目視全確認せず、**本一覧だけ見て修正依頼を出せる**」こと (user 要望)。

> **run-local 注意**: `requirement-deviations.json` / view.html は `artifacts/` 配下 = git 管理外 (run-local)。
> AYATORI は「各 Phase = 1 会話」モデルで、**その場の human が view を見て判断する前提**なので通常は問題ない。
> 別人物 / 別 run でレビュー共有したい場合は別途 export が要る (本機構はチーム共有ストアではない)。

- 人間ゲートで `requirement-deviations-view.html` を提示 → user が **修正依頼 / 容認 / 要件に昇格** を判断 (判断の受け方は §5.5)。
- main session が `resolved_at` / `resolution` (+ `resolution_mode`、§5.5) を書き戻す。Phase 4 retro が件数を集計。
- 完全網羅は保証しない (best-effort 安全網)。検出漏れは人間ゲートの最終確認で拾う。

### 5.5 ゲートでの per-item 判断プロトコル

**背景**: 旧運用は「承認」で未 resolved entry を **全件まとめて** `resolution: "容認"` に一括更新していたため、
『1 件ずつ見て意図的に残した』と『見ずに全部素通しした』がデータ上区別できなかった (どちらも `容認`)。
**個別の判断そのものが記録に残らない**ため、下流 (retro / トレーニングモード) が「使い手が各 deviation を
どう裁いたか」を一切参照できなかった。本節が **未 resolved deviation の判断受領・書き戻しの唯一の運用 SoT** であり、
resolution を書き戻す全ゲート (§5.3 の gate 列 = Step 07 / 13 / 21 / 25d / Step 05 / 29 / 29b / verify V3 [Phase 0c]) はここを参照する。

⚠️ **`保留` を持つ層の例外 (reverse_verify / Phase 0c)**: 対象限定突合の食い違いゲートは `修正 / 容認 / 保留` の 3 択で、`保留` は **resolution を書かず unresolved のまま残す** ことで表す (同じ対象を再度突合した run が引き継いで再提示する)。したがって当該層に限り「全件 account されるまで ゲートを閉じない」は「全件に判断を付ける」の意味であり、**unresolved の残存は正常終了と両立する**。台帳の unresolved を数える consumer は、この層では「人間が保留したもの」と「まだ判断を受けていない もの」が混在しうる点に注意する (`run_id` / `first_run_id` で run 帰属は判別できる)。

**技術前提**: HTML view は読み取り専用の派生表示で、クリックをパイプラインへ書き戻す経路が無い
(ローカル HTML の CSP 制約)。したがって「承認ボタン」の実体は **view で一覧を見る → 端末のゲート質問で
1 件ずつ / 番号指定で判断を返す** 形になる。

#### 5.5.1 番号 (#N) の付与

- `#N` = `requirement-deviations.json` の **`entries[]` 配列の 1-based index**。entries は append-only のため
  run をまたいでも安定し、view と端末の対話で同じ番号を指す。
- renderer (`render-deviations-view.mjs`) が各カードに `#N` を表示する。ゲートが端末に出す要約リストも同じ `#N` を使う。

#### 5.5.2 判断の受領 (ゲート実行手順)

対象 = 当該ゲートの担当 phase の **未 resolved entry** (他 layer 固有の絞り込みがある場合は各 skill の規定に従う)。

1. view を再生成して案内し、端末にも `#N` 付きの要約リスト (element / artifact / deviation_kind / severity) を提示する。
   さらに **AskUserQuestion を呼ぶ直前の plain chat で、各 entry が「どの機能/画面のどの記述に関する
   質問で、何を決めるのか」を 1〜2 行ずつ説明する** — ask 文・option は短く保つ規則
   (`skills/00-memory-load/SKILL.md` の presentation 規則) のため、判断材料はこの直前チャットが担う。
   `#N` 要約リストは metadata の列挙であり、この説明の代わりにはならない。
2. 件数 N に応じて受領導線を選ぶ:
   - **N ≤ 4**: mode 質問を挟まず、**AskUserQuestion 1 回に entry ごとの質問を束ねて** per-item で聞く
     (1 call 最大 4 問。各問 header = `#N`、options = `容認` / `修正依頼` / `要件に昇格` の 3 択)。
   - **N ≥ 5**: まず AskUserQuestion で受領方法を選ばせる:
     - 「1 件ずつ判断する」→ 上記 per-item 質問を 4 件ずつ複数回に分けて全件聞く。
     - 「番号指定でまとめて返す」→ **次の新メッセージ** で自由記述を受領する
       (AskUserQuestion は option-select 専用 — Step 25d B-1 と同型。例: `#1,#3 容認 / #2 修正: ラベルを直す / #4 昇格`)。
     - 「**全件容認 (N 件を確認のうえ一括)**」→ option label に件数 N を明記し、意識的な一括操作として受ける。
3. **全件 account されるまでゲートを閉じない**: 番号指定で言及されなかった entry は未 resolved のまま残るため、
   残件を再提示して判断を求める (「残り M 件をまとめて容認」を明示的に選んだ場合は bulk として記録してよい)。

#### 5.5.3 書き戻し (main session が単一 writer)

| 導線 | 書き込む値 |
|---|---|
| per-item 質問 / 番号指定で名指し | `resolution` (選択値) + `resolved_at` + **`resolution_mode: "individual"`** |
| 「全件容認 (N 件)」/「残り M 件をまとめて容認」 | `resolution: "容認"` + `resolved_at` + **`resolution_mode: "bulk"`** |

- `修正依頼` は従来どおり feedback-log.md へ Pattern A 追記 + 当該 layer の修正ループへ (resolved_at はゲートで stamp)。
- `要件に昇格` は各 layer の既存契約に従う (Step 07 = confirmed-decisions ledger append / 29b = 2 段階 stamp [resolution のみ先行、29c 反映後に resolved_at]。schema の resolution 説明を参照)。29b の 2 段階でも `resolution_mode` は resolution と同時に書く。
- 書き戻し後に view を再生成する (`node scripts/render-deviations-view.mjs ...`)。
- `resolution_mode` の欠落 = 本プロトコル導入前の resolved entry (記録なし)。**bulk と同義に扱わない**。

> **なぜ「全件容認」を残すか**: 抜け道を完全に塞ぐと少件数でも儀式化して形骸化する。残す代わりに
> (a) option label に件数を明記した**意識的な操作**にする、(b) `resolution_mode: "bulk"` として導線を記録する、
> の 2 点で「どの導線で決まったか」をデータに残す設計とする (判断の記録を残す案を採用)。
>
> **`bulk` の読み取りの射程 (本節が SoT)**: 「全件容認 (N 件)」は件数を明記した **意識的な明示選択** (§5.5.2-2) であり、
> 中身を確認したうえで一括で裁いた場合も `bulk` になる。したがって **個別 entry の `bulk` を「その 1 件を見ずに
> 素通しした証拠」として読んではならない**。読めるのは母数の大きい **集計傾向** まで — bulk 率の高さは
> 「ゲートが一覧を 1 件ずつ裁きにくい形になっている疑い」＝ 運用・導線の改善シグナルであり、
> 個々の判断の良し悪しの証拠ではない。consumer 別の使い分けは下記:
>
> | consumer | `resolution_mode` の使い方 |
> |---|---|
> | 本体 retro (Step 26) | **集計傾向**として bulk 率を見て、ゲート運用・導線の改善提案の材料にする (個別判断の良し悪しの証拠にはしない) |
> | トレーニングモード (train-07 振り返り) | **評価材料にしない**。使うのは `resolution` の内容 (判断の正誤) のみで、`resolution_mode` は声のかけ方を変える文脈にとどめる (判定条件の SoT = `skills/train-07-retro/SKILL.md`) |
