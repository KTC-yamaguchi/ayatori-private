---
name: 05-review-gate
description: リバース成果物 (reverse-engineered/01-08.md) のうち一次ソースにトレースできない推測 (inferred) を第三者監査で検出し、人間が重点確認してから下流へ流す gate。Phase 0b の Step 04 の後・Step 06 の前に実行され、forward path の Step 07 に相当する要件人間ゲートとして機能する。
---

# Step 05: Reverse Review Gate — 推測項目の人間確認

## Purpose

リバース成果物 (`reverse-engineered/01-08.md`) の中で **一次ソースにトレースできない推測 (inferred)** を
第三者監査で検出し、人間が **推測箇所を重点確認** してから下流 (Step 06 → design/screens) に流す gate。

これは forward path の Step 07 (human-gate-req) に相当する、Phase 0b の要件人間ゲート。Phase 0b には
従来このゲートが無く、推測が確定事実として Step 06 で requirements.json に焼き込まれていた (ChargeMinder
バッジ「介入群限定」誤読ケース)。

**実行位置**: Step 04 (comparison) の後、Step 06 (format conversion) の **前**。
**⚠️ Step 04 が skip された場合 (code-only inventory で ground-truth 不在) でも本 gate は必ず実行する** —
推測検出の主目的は証拠ソース実物 (実コード / 文書・Figma アーカイブ) との突合であり、文書比較 (Step 04) の有無とは独立。

## Inputs

- `artifacts/{app_name}/reverse-engineered/01-overview.md` 〜 `08-constraints.md` (被監査物)
- `artifacts/{app_name}/reverse-engineered/reverse-provenance.json` (Step 03 の自己申告台帳)
- `artifacts/{app_name}/reverse-engineered/source-inventory.json` (ソース棚卸し + 役割。突合先の分岐入力)
- `artifacts/{app_name}/input-sources/{stack}/` (code presence 時の突合先 = 一次ソース実コード)
- `artifacts/{app_name}/ground-truth/` (突合ソースのアーカイブ: root 直下 `*.md` = 文書 [Confluence ページ / `local-{stem}.md` / `jira-{KEY}.md`、doc_backed の突合先]、`figma/` = Figma capture [figma_backed の突合先。縮退モードでは主突合先])

## Process

### 1. Operating Principle 3 ディレクトリ走査 (必須)

`ls artifacts/{app_name}/` を実行し `input-sources/` の有無を確認した上で、`reverse-engineered/source-inventory.json`
の roles を読む (CLAUDE.md Operating Principle 3。inventory 不在の legacy run は従来どおり input-sources 有無で判断)。
- **inventory 上 code present** → `input-sources/{stack}/` を突合先 (一次ソース) として進む。
- **code present なのに input-sources 不在** (ディスクから消えた等) → 補完せず **ユーザーに確認**:
  「`artifacts/{app_name}/input-sources/{stack}/` が見つかりません。実コードを配置して再実行するか、
  二次要約のみで進めるか確認させてください」(無言で二次要約 fallback してはならない)。
- **code 不在** → `ground-truth/` アーカイブ (文書 + `figma/` capture) を突合先にする (コードが無いので
  source_backed は付かず doc_backed / figma_backed 止まり。縮退モード [degraded_mode=true] では figma capture が
  主突合先になり、根拠が視覚情報に偏る分 **本ゲートの重点確認がより重要になる**)。

### 1.5 引用スポットチェック (機械・監査前)

監査 subagent を起動する**前に** main が実行する:

```
node scripts/check-source-citations.mjs {app_name}
```

- `raw-analysis.md` / `reverse-provenance.json` の引用 (3 種文法) をファイル実在 + 行番号範囲 +
  大文字小文字一致で決定論検証する (**既定の 2 対象のまま実行するのは意図的** — Step 03 直後の
  本ゲートでは provenance は当該ループの最新であり、その `source_ref` 検証こそが本節の目的。
  `--file` で raw-analysis.md に限定するのは Step 02 側の運用)。**開けない参照を先に潰してから監査を始める** — 監査 (LLM) は
  参照先を実際に開いて主張との一致を見る高価な検査であり、機械的な誤参照にその費用を使わない
  (誤参照が混じったまま監査すると `self_bias_signal` の意味も薄まる)。
- **exit 1 (疑義あり)** → 該当 `source_ref` を Step 03 の台帳側で修正する (修正は 1 回まで。解消しない
  参照は該当 specific を `inferred` へ降格して台帳と本文マーカーを整合させる — Step 02 の
  ループブレーカーと同じ規律。**降格時は引用文字列から `:行番号` を外す** — 行番号つき文法のまま
  残すと再実行が同じ引用を再検出し続け、exit 0 に到達しない [Step 02 の降格書式と同じ])。
  修正後に再実行し exit 0 を確認してから §2 へ進む。
- **exit 3 (疑義なしだが warnings あり — raw-analysis.md の引用が 1 件も見つからない等)** →
  通過扱いにしない。引用ゼロは「機械検証済み」ではなく「検証対象なし」。原因を解消してから §2 へ
  進む。なお `reverse-provenance.json` 単独の引用ゼロは exit 3 の対象外 (全件 inferred の run では
  source_ref が無いのが正当 — スクリプトは参考情報として notes に出すだけ)。
- **exit 2 (実行エラー)** → 引用の問題ではない — 対象ファイルの存在と実行位置 (repo root) を確認して
  再実行する。疑義扱いで修正ループに入れない。
- 発火した事実は §5 の basis banner に 1 行残す (機械検査で捕捉済みであることを人間が確認できるように)。

### 2. 監査 subagent 起動 (layer=reverse)

`ayatori-requirements-auditor` subagent を `layer="reverse"` で起動する (生成 context 隔離。Step 03 生成と同一 session
での self-bias を断つ)。Input 契約は `.claude/agents/ayatori-requirements-auditor.md` の「layer=reverse」を参照:

- `layer`: `reverse`
- `app_name` / `repo_root`
- `reverse_dir`: `{repo_root}/artifacts/{app_name}/reverse-engineered/`
- `source_inventory_path`: `{repo_root}/artifacts/{app_name}/reverse-engineered/source-inventory.json`
- `input_sources_root`: `{repo_root}/artifacts/{app_name}/input-sources/`
- `ground_truth_dir`: (あれば) `{repo_root}/artifacts/{app_name}/ground-truth/`
- `reverse_provenance_path`: `{repo_root}/artifacts/{app_name}/reverse-engineered/reverse-provenance.json`

subagent は被監査物を独立に forced-enumerate し、各 specific を証拠ソース実物 (`input-sources/{stack}/` 実コード
file:line / root 直下 `ground-truth/*.md` 文書 :line / `ground-truth/figma/` capture) に literal トレース。
トレース不能なものを deviation candidates として return する。`reverse-provenance.json` の根拠あり申告
(source_backed / doc_backed / figma_backed) は鵜呑みにせず参照先を実際に開いて検証し、誤申告は
`self_bias_signal: true` で返す (種類の不整合 — doc/figma 根拠しか無いのに source_backed 申告 — も誤申告)。

### 3. requirement-deviations.json へ reconcile (main session が単一 writer)

subagent の return (メタ + `---DEVIATIONS---` + candidates) をパースし、`artifacts/{app_name}/requirement-deviations.json`
の `entries[]` に書き込む (lazy-init: `Read or {init-stub} → reconcile → Write back`、init stub =
`{ "app_name": "{app_name}", "entries": [] }`)。各 entry に main が付与:
- `phase`: `reverse`
- `raised_by_step`: `05-review-gate`
- `detected_at`: ISO 8601
- `self_bias_signal`: subagent の同名 field を転記 (`claimed_provenance` は `description` に折り込み)
- `ref`: subagent candidate の同名 field を転記 (provenance cross-check で突合した `reverse-provenance.json` の
  `specifics[].ref`。台帳に該当が無い candidate は null — schema の optional field。entry に保持することで
  下記 upsert / 3b 合流が再走時も同じ key で突合できる)

⚠️ **冪等な reconcile であって盲目的 append ではない** — 本 gate は『Step 04 が skip されても必ず実行』『部分完了後の resume
で再入する』経路があり (Purpose 参照)、再走のたびに append すると同一推測が二重・三重に積み上がる。そこで
**安定した identity key で upsert する**:

- **identity key** = `ref` (candidate / entry / `reverse-provenance.json` specifics が共有する台帳キー。あれば)、
  無ければ `artifact + "::" + element`。candidate の `ref` は entry の同名 field に保持されている (上記転記)
  ため、既存 entry との突合は entry の `ref` と比較する。3b の inferred 合流 (下記) も
  **同じ key 規則**で対応付ける (二検出器が同一項目を別エントリ化しないため — specifics は `ref` を必須で
  持つので、台帳由来の項目は常に `ref` 側の key で合流する)。
- 既存 `phase=reverse` entry に同 key があるとき:
  - その entry が **resolved** (`resolved_at` set) → **そのまま保持** (人間の判断を破棄しない)。重複追加しない・再 ask しない。
  - **unresolved** → 既存を残したまま `description` / `self_bias_signal` / `detected_at` を最新検出で **更新 (in-place)**。重複追加しない。
- 同 key が無い (新規検出) → append する。
- 前回走で立てた **unresolved な `phase=reverse` entry のうち、今回の検出セット (B 監査 flag ∪ A inferred) に key が現れないもの**
  は **prune** する (01-08.md 修正で消えた推測の orphan 化を防ぐ)。resolved entry は履歴として残す
  (`pending-questions.json` の「resolved 後も残置」と同方針)。
- **他 phase (requirements/design/screens/delta/sub-state) の entry には一切触れない** — reconcile 対象は `phase=reverse` のみ。

これにより Step 05 を二度走らせても `phase=reverse` の集合は同一に収束する (idempotent)。

`coverage[]` の `phase=reverse` record も同様に **upsert** する (append しない): 既存に
`{ phase: "reverse", raised_by_step: "05-review-gate" }` の record があれば
`enumerated_count` / `enumerated_refs` / `checked_at` を上書き、無ければ 1 件追加する
(**0 件 flag でも記録** — 「監査して clean」と「未監査」を区別するため)。
旧 step ID `00d2-reverse-review-gate` の record も同一 record とみなして upsert する
(step ID 改称前に開始したプロジェクトの artifact との互換)。
schema-light-check.sh R6 が必須 field + resolved 整合を検証する。

#### 3b. 二重検出 — 推測項目の完全リスト化 (UNION)

監査 subagent も同一 model family のため推測を 100% は検出できない (取りこぼしうる)。これを補うため、
**生成側の正直な自己申告 (`reverse-provenance.json` の `provenance == "inferred"`) を第2の独立シグナル**として
合流させ、人間に見せる「根拠なし項目」を漏らさない。具体的には:

1. `reverse-provenance.json` を読み、`provenance == "inferred"` の specifics を全件抽出する (= 生成側が自認した「根拠なし」)。
2. それぞれが **既に requirement-deviations.json (phase=reverse) の entry に表れているか**を、Step 3 と **同じ identity key**
   (`ref`、無ければ `artifact + "::" + element`) で対応付ける。同 key があれば Step 3 の upsert 規則に従う
   (resolved は保持・重複追加しない / unresolved は in-place 更新)。key が割れて判断がつかない場合のみ重複とみなさず両方残す
   (over-surfacing は安全側、silent miss は不可逆)。
3. **auditor が拾い損ねた `inferred` 項目** (同 key が未登場のもの) を `requirement-deviations.json` に追加する:
   - `deviation_kind`: `想像デフォルト` (一般論で埋めた) または `根拠薄弱`
   - `description`: 「Step 03 が inferred と自己申告。auditor は未 flag (二重検出の安全網で合流)。実ソース根拠なし」
   - `self_bias_signal`: `false` (正直申告。誤申告ではない)
   - `ref`: specific の `ref` を転記 (再走・監査再検出時に同一項目を合流させる identity key)
   - 他の必須 field (phase=reverse / raised_by_step / artifact / element / detected_at) は通常どおり main が付与
     (`element` は specific の `value` から構成する)。

再走時はこの合流も Step 3 の reconcile 内で行うため、A∪B が二重計上されることはない。

これで `requirement-deviations.json` (phase=reverse) は **(A) 生成側 inferred ∪ (B) 監査 flag の和集合 = 根拠なし項目の完全リスト**になる。
片方の検出器が見逃しても、もう片方が拾えば人間に届く。

### 4. view 生成

`node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` を実行し
`requirement-deviations-view.html` を決定論生成する (手焼き禁止)。

続けて成果物インデックスも再生成する (人間ゲート共通の `refresh_index` 規約 — 承認者がゲート時点の
全成果物を 1 画面から確認できるようにする。fail-open — 失敗してもゲートを止めない):

```bash
node scripts/build-artifact-index.mjs artifacts/{app_name}
```

Step 5 のゲート提示で view HTML と並べて `index.html` のパスも案内する。

### 5. 人間ゲート提示 (AskUserQuestion)

**basis サマリ banner を冒頭に提示する** (人間が「全体のどれだけが推測か・根拠の種類の内訳」を一目で把握できるように)。
`reverse-provenance.json` の provenance を種類別に集計して表示:

> 「全 **N** 仕様中: コード根拠 source_backed **M** / 文書根拠 doc_backed **D₁** / Figma 根拠 figma_backed **F** / 導出 derived **D₂** / **⚠️ 根拠なし inferred K 件 ← 重点レビュー対象**。
>  以下の K 件はどの証拠ソースにも根拠が無い AI の推測です。重点的に確認してください。」

縮退モード (source-inventory.json の degraded_mode=true) では続けて 1 行注意を出す:
> 「⚠️ 本 run はソースコード不在の縮退モード (Figma 中心) です。挙動・条件分岐の主張はコード裏取りができておらず、doc_backed / inferred の項目は特に慎重に確認してください。」

§1.5 のスポットチェックが発火した run では続けて 1 行報告する:
> 「引用スポットチェック疑義 **N** 件 → 修正 **M** / inferred 降格 **K** (機械検証済み)」

続けて、3b で完全リスト化した **(A) 生成側 inferred ∪ (B) 監査 flag** の各項目について判断を求める
(特に `self_bias_signal: true` = Step 03 が source_backed と誤申告して catch したものは最優先で提示)。
view HTML (`requirement-deviations-view.html`、reverse セクションに重点レビュー banner あり) のパスも案内する。
各項目の選択肢:

- **修正依頼** — 該当記述を証拠ソースに合わせて直す → `01-08.md` + `reverse-provenance.json` を修正
  (根拠ありに訂正できるなら種類に応じた ref [source_backed=file:line / doc_backed / figma_backed] を付け、依然推測なら inferred のまま値を訂正)。
- **容認 (推測のまま)** — 推測と明示した上でこのまま下流に流す → 本文 `※ 推測 (inferred)` を維持。
- **要件に昇格** — 推測だが要件として正式採用する → 確定情報として扱う。

main session が user 判断を `entries[].resolved_at` / `resolution` + `resolution_mode` に書き戻す (resolve は main のみ)。
判断の受領導線 (per-item 質問の束ね方 / 番号指定 / 「全件容認 (N 件)」) と `resolution_mode` の値
(individual / bulk) は `docs/principle4-disambiguation.md` §5.5 に従う (本ゲートは元々
全件 account 必須のため、変わるのは受領方法の標準化と mode の記録のみ)。

⚠️ **全件 account 必須**: 完全リスト (A∪B) の **すべての項目**が resolve されるまでゲートを通さない
(flag されたものだけでなく、生成側 inferred も含めて漏れなく人間に判断させる = 本ゲートの主目的)。
K=0 (推測ゼロ) かつ auditor flag 0 件のときのみ、その旨を表示して通過扱いとし Step 06 へ進む。

⚠️ **過剰質問の禁止**: 止めて聞くのは推測 / flag 項目のみ。同一 session で同じ target を 2 回 ask しない
(pipeline.yaml P4-07)。scope を変える未確定は `pending-questions.json` 経由 (Preamble Pre-flight Gate)。append する場合の必須 field は 4 件 (`target` / `question` / `raised_by_step` / `raised_at`) + **未解決 entry には `reflect_to` (本 step の文脈なら `reverse-engineered/*.md`。Step 06 の E2-2 が `requirements/*.md` 系へ移行する) を併記必須** (`skills/_shared/preflight-gate.md` § append 経路)。

### 6. 通過判定

flag された推測項目がすべて resolved (修正依頼の反映完了 / 容認 / 昇格) になったら Step 06 へ進む。
修正依頼で `01-08.md` を直した場合、Step 03 の `reverse-provenance.json` も整合させてから Step 06 に渡す。

## Completion Check

- [ ] 引用スポットチェック (`scripts/check-source-citations.mjs`) が exit 0 で通過した (疑義があった場合は修正 / inferred 降格まで反映済み)
- [ ] `requirement-deviations.json` に phase=reverse の coverage 記録が **1 件** ある (0 件 flag でも記録 / 再走でも重複しない)
- [ ] 完全リスト **(A) 生成側 inferred ∪ (B) 監査 flag** が requirement-deviations.json に揃っている (3b、二重検出)
- [ ] phase=reverse entry に **同一 identity key (ref / artifact::element) の重複が無い** (再走・Step 04 skip→Step 05 でも upsert で収束。resolved は保持)
- [ ] basis サマリ (source_backed / doc_backed / figma_backed / derived / inferred の種類別件数) を人間に提示した (縮退モードなら追加の注意 1 行も)
- [ ] 完全リストの **すべての項目**が resolved (`resolved_at` + `resolution` set) — flag 分だけでなく生成側 inferred も含む
- [ ] `requirement-deviations-view.html` が再生成済 (reverse セクションに重点レビュー banner)
- [ ] 修正依頼があった場合、`reverse-engineered/01-08.md` と `reverse-provenance.json` が整合

## Feedback Log

人間ゲートが修正指示を返した場合は Pattern A として `artifacts/{app_name}/feedback-log.md` に append する。
