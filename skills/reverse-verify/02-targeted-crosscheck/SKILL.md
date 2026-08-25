---
name: 02-targeted-crosscheck
description: 承認された範囲内の要件記述・画面仕様を主張単位に列挙し、実コード・文書アーカイブ・Figma capture と突合する。コードと食い違ったときはまず自分の誤読を疑って別角度で読み直し、再読の引用を残したものだけを食い違いとして確定する。
---

# Step V2: Targeted Cross-Check — 承認範囲だけの突合

## Purpose

承認範囲の記述が証拠ソースと合っているかを **主張 (claim) 単位** で検証する。

本 step の核心は **誤読を先に疑う規律** である。リバース産要件の誤りは「コードが間違っていた」のではなく
「コードの読み方を間違えていた」ことが多い。ここで優先順位規則 (code 勝ち) だけを適用すると、
**間違った読みがそのまま勝ち残り、正しい記述が「食い違い」として壊される**。そのため contradicted 候補は
必ず別角度で読み直し、初読と再読の両方の引用を残したものだけを食い違いとして確定する。

## Inputs

- `artifacts/{app_name}/reverse-verify/scope-manifest.json` (承認範囲。本 step の唯一の対象定義)
- `artifacts/{app_name}/requirements/*.md` (範囲内セクションのみ)
- `artifacts/{app_name}/screens/{slug}.md` (範囲内画面のみ)
- `artifacts/{app_name}/reverse-verify/.code-inventory.json` (verify 専用の読み取り計画。code 範囲があるとき)
- `artifacts/{app_name}/input-sources/{stack}/` (一次ソース実コード)
- `artifacts/{app_name}/ground-truth/` (文書アーカイブ + `figma/` capture)
- `artifacts/{app_name}/reverse-engineered/reverse-provenance.json` (生成時の provenance 申告。**読み取り専用**)

⚠️ **本 step が書かないもの**: `reverse-provenance.json` (Phase 0b Step 03 が生成時点のスナップショットとして
所有する台帳。ここで書き換えると「生成時に何を根拠と申告したか」の記録が失われ、監査の突合先が消える)。
`requirements.json` / `reverse-engineered/*` も書かない。記述の訂正は Step V3 が `requirements/*.md` と
`screens/{slug}.md` に対してのみ行う。

## Precondition

`pipeline-state.json.reverse_verify.runs[-1].scope_approved_at` が set であること。未 set なら Step V1 の
人間ゲートを通していない — 本 step を実行せず Step V1 に戻る。

## Process

### 1. 主張 (claim) の強制列挙

範囲内の記述から、**証拠と照合できる粒度の主張**を全件書き出す。「全件」を担保するため、範囲内の
セクション / 画面仕様を上から順に読み、検証可能な言明を漏らさず拾う (要約せず、原文を引用する)。

各 claim に付ける属性:

| 属性 | 内容 |
|---|---|
| `id` | `C-01` から連番 |
| `statement` | 記述の原文 (要約しない — 訂正の判断は原文に対して行う) |
| `doc_ref` | 記述の位置 (`requirements/05-features.md:120` / `screens/03-search.md:44`) |
| `kind` | `画面` (存在・構成・遷移) / `挙動` (条件分岐・処理順序・状態) / `API・データ` (endpoint・項目・enum) / `スコープ` (実装済み / 未実装 / PoC 限定) |
| `provenance_ref` | `reverse-provenance.json` に同一 specific があればその `ref` を転記 (生成時の申告と突合するため) |
| `marker` | 記述に `※ 推測` / `※ 不明` が付いている場合のみ `inferred` / `unknown` (マーカー解除の判断対象になる) |

**検証可能でない記述は claim にしない** (目的・背景の説明文など)。
ただし `※ 推測 (inferred)` / `※ 不明 (unknown)` 付きの記述は「根拠が付けられるか」を確認する価値が
あるため、**証拠ソースに当たれそうなものは claim に含める**。この場合 claim に
**`marker: "inferred" | "unknown"`** を付けておく — 根拠が見つかってマーカーを外すことは
「推測を確定事実へ昇格させる」行為であり、**人間の承認が要る** (下記 6 の解除候補一覧に載せる)。

`kind` は突合先を決める: `挙動` / `API・データ` は figma を根拠にできない (視覚情報しか無い)。
`画面` の視覚・構成は figma が有効。この対応は下記 3 で使う。

### 2. code pass (code 範囲があるとき)

`reverse-verify/.code-inventory.json` の `shards[]` ごとに `ayatori-code-analysis-worker` subagent を起動する
(並列 8 目安)。Input 契約は `.claude/agents/ayatori-code-analysis-worker.md` を参照:

| キー | 値 |
|---|---|
| `app_name` / `repo_root` | 対象プロジェクト / 絶対パス起点 |
| `inventory_path` | `{repo_root}/artifacts/{app_name}/reverse-verify/.code-inventory.json` (**verify 専用の台帳**) |
| `shard_id` | 担当 shard の id |
| `skeleton` | **本 step の主眼** — 当該 shard の module に関わる claim の subset (id + statement + kind)。worker は各主張を `backed` / `contradicted` / `unverified` の 3 分類にし、`input-sources/{stack}/path:line` 引用を付けて返す |
| `checks` | `skeleton_only` — 構造の網羅抽出と挙動 7 チェック (Phase 0b の観点) は行わせない。本 step の対象は渡した主張だけで、無関係な観点に shard の読み取り予算を使うと「対象を絞って深く読む」という目的が薄まる |

- **ファイル一覧は worker が台帳から自力で読む** — main が prompt に貼らない (worker 契約)。
- worker は自 shard の `files[]` 以外を読み歩かない。したがって **worker の `unverified` は「この module では
  確認できなかった」までの意味** であり、アプリ全体の不在断定ではない (全体の判断は main が全 shard 統合後)。
- `zero_module_fallback == "docs_only"` の run では本 pass を実行しない。全 claim のコード側を
  `not detectable (code 未突合)` として扱い、下記 6 の Coverage に明記する。

### 3. docs / figma pass

範囲内の証拠アーカイブと claim を突合する (live 外部読みは行わない):

- **docs**: `scope.ground_truth_docs` の各ファイルを読み、claim を支持 / 反証する記述を `ground-truth/{file}.md:line`
  で引用する。`jira-{KEY}.md` は **時点の変更要求記録** — 仕様を覆す根拠にはせず、裏取り (cross_check) 止まりで扱う
  (課題に「〜に変更する」とあっても、それが実装されたかはコード・仕様書で確認する)。
- **figma**: `scope.figma_frames` の各 capture を読む。`kind == 画面` の視覚・構成・文言と、トークン値
  (色・フォントサイズ → `variables.json:line`) にのみ使う。**`挙動` / `API・データ` の根拠にはしない**。
  1 pass あたり design-context は 3 本まで (超える場合は分けて読む — Phase 0b B3 と同じ上限)。
- **画面遷移の主張**: 範囲内の画面仕様同士が同じ遷移を書いていても、それは **独立証拠にならない**
  (どちらも Phase 0b の同じ生成 pass の出力 — 相互一致は「生成が一貫していた」以上を意味しない)。
  遷移の根拠にできるものは種類ごとに要件が異なる:
  - **code**: navigation 定義の引用 1 件 (`input-sources/{stack}/path:line`) — 遷移元→遷移先の対応を
    1 箇所で裏取りできる。
  - **docs**: 文書アーカイブの遷移記述の引用 1 件 (`ground-truth/{file}.md:line`)。
  - **figma**: capture は prototype の遷移リンクを **含まない** — 根拠になるのは **遷移元 capture 内の
    遷移を起こす要素** (ボタン・リンク文言) を `…design-context.md:line` で引用できる場合のみで、
    遷移先の capture は「遷移先画面が存在する」ことまでしか担保しない。**2 画面の capture が揃っている
    こと自体は遷移の証拠ではない**。
  いずれも範囲内に無ければ `未確定` とし、不足した証拠 (未 capture の frame 等) を Coverage に明記する。

### 4. 再読プロトコル (contradicted 候補の確定手続き)

**本 step の中核規律。code pass / docs pass が `contradicted` を返した claim は、この手続きを通すまで
食い違いとして確定してはならない。**

理由: 「記述が誤り」と「読みが誤り」は同じ症状 (証拠と記述が合わない) を示す。優先順位規則だけで
決着させると、後者のときに正しい記述を壊す。実測では誤りの多くが後者だった。

contradicted 候補ごとに、main が **少なくとも a と b を実行する**:

- **a. 呼び出し側を見る** — 当該識別子の使用箇所を列挙し、1 箇所以上を実際に読む:
  ```bash
  grep -rn -F -e '{識別子}' \
    --exclude-dir={node_modules,.git,build,dist,out,vendor,Pods,.venv,__pycache__} \
    artifacts/{app_name}/input-sources/{stack}/ | head -20
  ```
  `-F` はリテラル一致 (識別子の正規表現メタ文字による誤 hit を避ける)、`--exclude-dir` は依存
  ディレクトリの hit で `head` が埋まり **肝心の呼び出し側が一覧から落ちる**のを防ぐ。
  20 件で切れた場合は「呼び出し側を全部見た」とは言えないので、範囲を絞って再実行する。
  定義だけを読んで「こう動く」と判断したのが誤読の典型 (既定値・呼び出し側の分岐・上書きが見えない)。
- **b. 初読引用の前後文脈を読む** — 引用行の前後 30 行程度を読む。条件分岐の外側・early return・
  フラグ判定が視野の外にあったケースを拾う。
- **c. (該当時) 範囲内の関連ファイルを確認する** — 同 module 内の設定値・定数・schema 定義など、
  当該主張の値を決めている別ファイルがあれば読む。

再読の結果を 3 分類し、**初読引用と再読引用の両方を記録する**:

| 判定 | 意味 | 扱い |
|---|---|---|
| `不一致確定` | 再読しても記述と証拠が合わない | 食い違いとして下流へ (deviations に append) |
| `誤読訂正` | 再読で記述が正しいと分かった (初読が誤り) | **食い違いにしない**。報告書に「誤読訂正」として残す |
| `未確定` | 再読しても判断できない (証拠が不足) | `※ 未確認` として扱い、食い違いにしない。報告書に残す |

⚠️ **再読なしの `不一致確定` は禁止** (Completion Check の項目)。再読引用を書けないなら `未確定` にする。

⚠️ **`誤読訂正` は必ず記録する** — 「AI が一度は食い違いだと思ったが自分の誤読だった」件数は、
リバース側の読み方の改善材料になる (Feedback Log の Pattern B にも記録する)。

### 5. 衝突規則の適用

`不一致確定` の各件について、どのソースを採るかを決める:

- code が present なら **code 勝ち** (再読を通した後の code 判断)。
- code 不在の run では **視覚・構造は figma 勝ち / 挙動は docs 勝ち**。
- figma を挙動の根拠にしてはならない (どちらの run でも)。

規則の SoT は `phases/reverse/SKILL.md`「Input Sources & Roles」の突合の衝突規則。本 step は再定義しない。

### 6. 突合レポートの書き出し

`artifacts/{app_name}/reverse-verify/crosscheck-report.md` を Write する (main が単一 writer。run ごとに上書き —
履歴は `requirement-deviations.json` の run_id 付き entry と `reverse_verify.runs[]` が保持する):

```markdown
# 対象限定突合レポート — {target_description}

- run_id: {run_id}
- 対象: {target_description}{Jira があれば ` (Jira: {KEY})`}
- 証拠ソース: code {present/absent} / docs {present/absent} / figma {present/absent}
- 実行: {ISO 8601}

## 突合範囲

{scope-manifest の内容を表で再掲 — 要件セクション / 画面 / 文書 / frame / module}

## 主張一覧

| ID | 種別 | 主張 (原文) | 記述位置 | 判定 | 根拠 |
|---|---|---|---|---|---|
| C-01 | 挙動 | 検索は部分一致で行う | requirements/05-features.md:120 | 不一致確定 | input-sources/be-python/app/search.py:42 |

## 食い違い (Findings)

| ID | 比較軸 | 内容 | Severity | 修正提案先 | 初読 Evidence | 再読 Evidence |
|---|---|---|---|---|---|---|
| V-01 | 挙動詳細 | 記述は部分一致だがコードは前方一致 | medium | doc | input-sources/be-python/app/search.py:42 | input-sources/be-python/app/search.py:30-60 + input-sources/be-python/app/api.py:88 (呼び出し側) |

## マーカー解除候補 (人間承認が必要)

| ID | 記述 (原文) | 記述位置 | 現在のマーカー | 見つかった根拠 |
|---|---|---|---|---|
| C-04 | 検索履歴は 30 日保持 | requirements/05-features.md:88 | ※ 推測 (inferred) | input-sources/be-python/app/config.py:12 |

## 誤読訂正 (食い違いではなかったもの)

| ID | 主張 | 初読での誤読内容 | 再読で判明した実際 | 再読 Evidence |
|---|---|---|---|---|

## Coverage

- 突合した主張: {N} 件 (根拠あり {backed} / 不一致確定 {contradicted} / 誤読訂正 {corrected} / 未確定 {unverified})
- マーカー解除候補: {marker_candidates} 件 (根拠が見つかった `※ 推測` / `※ 不明` 記述 — V3 で人間承認)
- 引用の機械検査: 再読列検査 {PASS または 疑義 N → 修正 M} / 引用実在検査 疑義 {N} → 修正 {M} / `※ 未確認` 降格 {K}
  (次のセッションで V3 を再開しても banner に出せるよう、数字は口頭でなくここに残す)
- 突合しなかったもの (明示):
  - code: {module 数} module を読んだ / {未突合の理由: code 不在・docs_only fallback 等}
  - docs: {件数} 件を読んだ / 引用不可で範囲外にした {件数} 件 (content status)
  - figma: {件数} frame を読んだ / 未 capture で範囲外にした {件数} 件
- **範囲外は「問題なし」ではない** — 本 run が見たのは上記の範囲のみ。
```

**表の書き方 (本 skill の指示。報告書本文には書かない — テンプレートの ``` の外に置いているのは、
指示文が生成物へそのままコピーされないようにするため)**:

- **主張一覧の判定**: 根拠あり / 不一致確定 / 誤読訂正 / 未確定 のいずれか
- **比較軸**: 画面網羅 / 機能忠実 / 挙動詳細 / API・データ / スコープ / 文書内コード言及 のいずれか
  (軸の定義は `skills/reverse/04-comparison/SKILL.md` の Dimension 1-6 が SoT — 対象限定版として同じ軸を使う)
- **修正提案先**: `doc` (記述を直す) / `code` (実装側の問題 — 本 phase では直せない) / `both`
- **Severity**: high / medium / low (`schemas/requirement-deviations.schema.json` の severity 定義に従う。
  同 schema の定義は「要件外の要素を新設した」前提の文言なので、本層では「記述と実装の食い違いが
  与える影響」として読む — 個人情報・認証・課金・不可逆操作に関わる食い違いは high)
- **Evidence 2 列はフルパス引用**で書く (`input-sources/{stack}/…:line` 等)。省略形 (`.../search.py:42`) や
  経路を backtick で囲んだ形 (`` `input-sources/x.py`:1 ``) は引用検証の抽出対象から外れ、検証を素通りする
- **再読 Evidence は初読と別の位置**を指す (呼び出し側 / 前後の行範囲 / 関連ファイル)。初読と同じ引用の
  再掲・注記の追加・行アンカーを持たない `.png` は再読の証跡にならない
- **再読 Evidence が空の行は存在してはならない** (再読プロトコル未通過 = 食い違いとして確定できない)
- **マーカー解除候補**: マーカーを外すことは推測を確定事実へ昇格させる行為なので AI 単独で行わない。
  ここに列挙し、Step V3 の人間ゲートで 1 件ずつ承認を得る。**0 件でも見出しは残す**
  (未記入と 0 件を区別するため)
- 上記の欠落・違反は下記の機械検査が弾く

Write 直後に **2 つの機械検査**を実行する。

**(i) 再読プロトコルの検査** — Findings 表の各行について、初読・再読の Evidence が両方あり、どちらも
引用文法を満たし、**再読に「初読に無い行アンカー付き引用」が 1 件以上ある**ことを固定する。
併せて **主張一覧の `不一致確定` 件数と Findings 行数の突き合わせ**も行う (表を空にする通過経路を塞ぐ)。
本 step の中核規律を散文の指示だけに委ねないための機械ゲート:

```bash
node scripts/check-crosscheck-findings.mjs artifacts/{app_name}/reverse-verify/crosscheck-report.md
```

- **exit 1** → 指摘された行を直す。再読 Evidence を書けない行は **食い違いとして確定できない** ので、
  当該 claim を `未確定` に落として Findings 表から外す (再読していない判定を残さない)。
- **exit 2** → 報告書のパスを確認して再実行する (引用の問題ではない)。

**(ii) 引用先の実在検証** — 引用が実際に開けるか (ファイル実在 + 行番号範囲) を検証する:

```bash
node scripts/check-source-citations.mjs {app_name} --file artifacts/{app_name}/reverse-verify/crosscheck-report.md
```

- **exit 1 (疑義あり)** → 該当引用を修正する (**1 回まで**)。解消しない引用は当該 claim を `未確定` に降格し
  `※ 未確認` を付ける。**降格時は引用文字列から `:行番号` を外す** (行番号つき文法のまま残すと再実行が
  同じ引用を再検出し続け exit 0 に到達しない)。
- **exit 3 (引用が 1 件も無い)** → 通過扱いにしない。引用ゼロは「検証済み」ではなく「検証対象なし」。
  突合が実質行われていないので、原因 (claim 列挙の失敗 / 範囲の誤り) を解消してから書き直す。
- **exit 2 (実行エラー)** → 引用の問題ではない。対象ファイルの存在と実行位置 (repo root) を確認して再実行する。

### 7. 台帳への反映 (main が単一 writer)

`不一致確定` の各件を `artifacts/{app_name}/requirement-deviations.json` の `entries[]` に upsert する
(lazy-init: `Read or {init-stub} → reconcile → Write back`、init stub = `{ "app_name": "{app_name}", "entries": [] }`)。

main が付与する field:

- `phase`: `reverse_verify`
- `run_id`: 本 run の `run_id` (**reconcile の絞り込みキー**)
- `raised_by_step`: `02-targeted-crosscheck`
- `artifact`: 記述側のパス (例: `requirements/05-features.md`)
- `element`: 対象の記述 (原文の要点)
- `deviation_kind`: 既存 enum から選ぶ (**新 kind は追加しない**)
  - `要件矛盾` — 記述と証拠が衝突する (本 phase の主たる検出)
  - `根拠薄弱` — どの証拠ソースにも根拠が見つからない
  - `要件外追加` — 画面仕様にあるが要件文書にトレースできない
- `description`: 何がどう食い違うか + **初読と再読の両引用**
- `first_run_id`: 初回 append 時は `run_id` と同値 (引き継ぎでは変更しない — prune 判別のキー)
- `severity` / `detected_at` / `ref` (provenance に対応があれば転記)

⚠️ **reconcile は `phase == "reverse_verify" && run_id == {本 run}` の範囲だけを対象にする**:

- 同一 identity key (`ref`、無ければ `artifact + "::" + element`) の既存 entry が **本 run 内** にあれば
  in-place 更新 (再実行で二重に積み上げない)。
- 本 run 内で前回検出したが今回検出されなかった unresolved entry は prune する。
  **ただし引き継ぎ entry は prune しない** — claim の列挙は LLM の意味判断で run 間に揺れがあり、
  引き継いだ瞬間に「本 run 内」になるため、再開時の再列挙で取り落とすと過去 run で人間が保留した
  項目が黙って消える。判別は **`first_run_id != run_id`** で行う (異なれば引き継ぎ = prune 対象外)。
  `first_run_id` 欠落は「不明」として安全側 (prune しない) に倒す。
  ⚠️ **時刻の前後比較で代用してはならない** — `detected_at` は LLM 記載でローカルオフセット、run の
  stamp は UTC と、実 artifact でオフセット規約が混在しており比較が反転する
  (反転すると、この例外が守ろうとしている「人間が保留した項目」がまさに消える)。
- **他 phase の entry / 他 run の entry には一切触れない** — 特に `phase == "reverse"` の entry は
  Phase 0b の reverse review gate が所有する。ここで prune すると過去の推測検出記録が消える。
- **過去 run で `容認` として resolved 済みの同一 key** は新規 entry を作らず、
  「既容認 (run {過去 run_id})」として報告書と Step V3 の banner に **carry-forward 表示するだけ** にする
  (同じ判断を繰り返し聞かない — Operating Principle 4 Rule 6)。
- **過去 run で `保留` (unresolved) のままの同一 key** は、**新規 entry を作らず既存 entry の `run_id` を
  本 run へ書き換えて引き継ぐ** (`description` は最新検出で更新するが、**`first_run_id` と `detected_at` は
  変更しない** — 前者は下記 prune の引き継ぎ判別キー、後者は「いつから未解決なのか」の記録)。新しい entry を足すと
  同じ食い違いが run の数だけ台帳に積み上がり、どの run も resolve しないため永久に残る (派生 view でも
  重複カードとして並ぶ)。引き継いだ entry は本 run の未解決分として V3 で再提示される。
  — これは `phase == "reverse_verify"` の entry に対する操作なので「自 phase のみ」の原則は保たれる。

`coverage[]` にも `{ phase: "reverse_verify", raised_by_step: "02-targeted-crosscheck", run_id, enumerated_count,
enumerated_refs, checked_at }` を upsert する (**0 件でも記録** — 「突合して差が無かった」と「突合していない」を
区別するため)。`enumerated_count` は列挙した claim の総数。

**消してはいけない entry を消していないことを機械で確かめる** — 本台帳は複数 phase の記録が同居する
単一ファイルで、書き込みは丸ごと上書きである。担当外を落としても文法エラーにはならず静かに消えるだけで、
誰も気付かない。取り返せないのは 3 種: **他 phase の entry** (Phase 0b の推測検出記録など) /
**resolved 済み** (人間が下した判断) / **他 run から引き継いだ未解決** (人間が「保留」を選んだ項目)。

**(1) 台帳を編集する前** に全文を退避する (この退避物は違反検出時の復旧原本にもなる — 台帳は
`artifact_backup` の対象外で `_backup/` には存在しない):

```bash
node scripts/check-deviations-preserved.mjs snapshot \
  artifacts/{app_name}/requirement-deviations.json \
  --out artifacts/{app_name}/reverse-verify/.deviations-before.json
```

**(2) 台帳の Write が終わった後** に照合する:

```bash
node scripts/check-deviations-preserved.mjs verify \
  artifacts/{app_name}/requirement-deviations.json \
  --snapshot artifacts/{app_name}/reverse-verify/.deviations-before.json \
  --run-id {run_id}
```

- **exit 0** → 保全されている。次へ進む。
- **exit 1** → 消えた entry がある。出力の `missing[]` に key と理由が出るので、
  **snapshot から該当 entry を復元してから**先へ進む (落としたまま進んではならない)。
- **exit 2** → snapshot が無い / 台帳が壊れている。snapshot 不在は「(1) を実行していない」ことを
  意味するので、**編集前に戻って (1) から**やり直す (編集後に撮った snapshot は検査の意味を失う)。

順序ミスは script が構造的に止める — verify は snapshot ファイルの実在を要求し、無ければ exit 2 になる
(prose の 2 コマンドを人手で並べる形だと、両方を Write 後に実行して「検査が自分自身を満たすだけ」の
状態を作れてしまう)。台帳が未作成の run では (1) が空台帳として成功し、(2) も PASS になる (守る対象が無い)。

### 8. run 状態の更新

Bash tool で実行する (`__PLACEHOLDERS__` を置換してから):

```bash
python3 << 'PYEOF'
import json
from datetime import datetime, timezone

path = "artifacts/__APP_NAME__/pipeline-state.json"
data = json.loads(open(path).read())
runs = data.get("reverse_verify", {}).get("runs", [])
run = next((r for r in runs if r.get("run_id") == "__RUN_ID__"), None)
if run is None:
    print("ERROR: run __RUN_ID__ が見つかりません。Step V1 の範囲承認が完了しているか確認してください"); exit(1)
run.update({
    "crosscheck_completed_at": datetime.now(timezone.utc).isoformat(),
    "findings_total": __FINDINGS_TOTAL__,   # int: 不一致確定の件数 (誤読訂正・未確定は含めない)
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: crosscheck_completed_at / findings_total written")
PYEOF
```

## Outputs

- `artifacts/{app_name}/reverse-verify/crosscheck-report.md` (main が単一 writer)
- `artifacts/{app_name}/requirement-deviations.json` の `phase=reverse_verify` entry + coverage (append / upsert)
- `pipeline-state.json.reverse_verify.runs[-1].crosscheck_completed_at` + `findings_total`

## Completion Check

- [ ] 範囲内の記述を claim 単位で **全件** 列挙した (要約せず原文 + `doc_ref` 付き)
- [ ] code 範囲がある run で **verify 専用の台帳** (`reverse-verify/.code-inventory.json`) を worker に渡した
- [ ] `contradicted` 候補の **すべて** に再読プロトコル (a 呼び出し側 + b 前後文脈) を通し、両方の引用を記録した
- [ ] `不一致確定` の全行に再読 Evidence がある — `check-crosscheck-findings.mjs` が exit 0
      (空欄 / 省略形 / backtick 込み経路 / 初読と同位置のみ / 行アンカーなしはいずれも弾かれる)
- [ ] 主張一覧の `不一致確定` 件数と Findings 表の行数が整合している (降格した行は両表で判定を揃えた)
- [ ] 台帳 Write 前後で `phase == "reverse"` の識別キー集合が不変であることを diff で確認した
- [ ] `誤読訂正` を報告書に残した (「食い違いだと思ったが誤読だった」を消していない)
- [ ] figma を `挙動` / `API・データ` の根拠に使っていない
- [ ] 根拠が見つかった `※ 推測` / `※ 不明` 記述を「マーカー解除候補」に列挙した (AI 単独で外さない)
- [ ] Evidence 2 列がフルパス引用で書かれている (省略形は引用実在検証の抽出対象から外れる)
- [ ] `check-source-citations.mjs` が exit 0 (exit 1 は修正 1 回 → 解消しなければ `※ 未確認` 降格まで反映済み / exit 3 は通過扱いにしていない)
- [ ] deviations の reconcile が `phase=reverse_verify` かつ **本 run** の範囲に限定されている (他 phase / 他 run を prune していない)
- [ ] 過去 run で容認済みの同一項目を再提示していない (carry-forward 表示のみ)
- [ ] 過去 run の保留項目は **既存 entry の run_id 付け替え** で引き継いだ (新規 entry を足していない — 足すと run ごとに重複が積み上がる)
- [ ] 引き継ぎ entry の `first_run_id` / `detected_at` を変更していない (prune 判別キーと未解決起点の記録)
- [ ] `coverage[]` に本 run の記録が 1 件ある (0 件検出でも記録)
- [ ] Coverage に「突合しなかったもの」を明示した (範囲外を「問題なし」と読ませない)
- [ ] `reverse-provenance.json` / `requirements.json` / `reverse-engineered/*` を書き換えていない

## Feedback Log

- 再読プロトコルで `誤読訂正` が出た場合は **Pattern B** として append する
  (どの読み方が誤りを生んだか — 定義のみ読んだ / 分岐を見落とした 等を併記)。
- 範囲内に証拠が足りず `未確定` が多発した場合は **Pattern C** として append する
  (範囲導出規則、または Phase 0b の収集範囲の設計課題)。
