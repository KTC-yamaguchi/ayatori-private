---
name: 01-target-scope
description: 改修対象 (機能名 / 画面名) を受け取り、突合すべき関連範囲 — 要件文書セクション / 画面仕様 / 文書アーカイブ / Figma frame / コード module — を導出して人間に承認させる。承認された範囲だけが下流の突合対象になる。
---

# Step V1: Target & Scope — 対象確定と関連範囲の承認

## Purpose

「この機能を直したい」から出発して、**突合すべき範囲を人間と合意する**。

範囲を明示的に確定させるのは、対象限定突合の成立条件そのものである。範囲が曖昧なままだと
(a) 関係する記述を読み落としたのに「突合済み」と言えてしまう、(b) 逆に全体へ広がって
「対象を絞る」という本 phase の意味が消える、の両方が起きる。**何を見て何を見なかったか**を
承認時点で固定し、下流はこの集合だけを扱う。

## Inputs

- `artifacts/{app_name}/requirements/01-overview.md` 〜 `08-constraints.md` (訂正対象・範囲導出元)
- `artifacts/{app_name}/screens/00-screen-list.md` + `screens/{slug}.md` (画面仕様。存在するものだけ)
- `artifacts/{app_name}/ground-truth/index.md` (文書アーカイブの索引 + content status)
- `artifacts/{app_name}/ground-truth/figma/figma-manifest.json` (figma capture の索引。あれば)
- `artifacts/{app_name}/reverse-engineered/source-inventory.json` (roles / degraded_mode。**読み取り専用**)
- `artifacts/{app_name}/reverse-engineered/raw-analysis.md` (機能 → コード引用の対応を引くため。あれば)
- `artifacts/{app_name}/reverse-engineered/.code-inventory.json` (module 一覧を引くため。**読み取り専用**)
- `artifacts/{app_name}/input-sources/{stack}/` (識別子の grep 対象。present のとき)

⚠️ **`screens/00-transition-map.mmd` / `screens/00-coverage-check.json` / `scores.json` には依存しない** —
リバース完走だけのプロジェクトには存在しないため、これらを前提にすると range 導出が動かない。
不在を理由にした halt もしない (本 phase が生成することもない)。

## Process

### 1. 対象の受け取り (intake)

plain chat で 1 回だけ聞く (自由入力のため `AskUserQuestion` は使わない — `skills/00-memory-load/SKILL.md` の
standing rule):

> 「どの機能・画面を改修する予定ですか? 対象の名前をそのまま書いてください
>  (例: 「車両検索の絞り込み」「ログイン画面」)。関連する Jira 課題があればキーも併記してください
>  (例: ABC-123)。」

- **起動引数からの受け取り**: 起動メッセージに対象の記述が含まれている場合は上の依頼を出さずに進む
  (`/ayatori-reverse-verify 車両検索` の形)。
- **Jira キーの扱い**: `ground-truth/jira-{KEY}.md` が実在すれば **キーワード源として使う** (課題本文から
  対象の別表記・画面名を拾う)。実在しない場合は **live 取得しない** — キーは `target.jira_issue_key` に
  ラベルとして記録し、1 行で伝える: 「`ground-truth/jira-{KEY}.md` が未収集のため、課題本文は突合に
  使いません (必要なら `/ayatori-reverse` で差分収集してから再実行してください)」。
- `run_id` を採番する: `YYYY-MM-DD-NNN` (日付は Bash の `date` で取得。同日に既存 run があれば連番を進める)。

### 2. キーワード起こし

対象の記述から検索語を作る (`target.keywords` に記録 — 次回同じ対象を突合したときに何が変わったかを
説明できるようにするため):

- ユーザーの言葉そのまま / その分割語
- 要件文書・画面一覧に現れる同義の表記 (例: 「絞り込み」→「フィルタ」「filter」)
- 画面 slug (例: `03-search`) と機能 ID (例: `F-03`)
- コード上の識別子候補 (英語名。日本語対象名から機械的には作れないため、要件文書・画面仕様・
  raw-analysis.md に現れる英語識別子を拾う)

⚠️ **キーワードを推測で膨らませない** — 根拠なく広げると範囲が膨張して「対象限定」の意味が薄れる。
出所 (どのファイルのどの記述から拾ったか) を言えない語は入れない。

### 3. 範囲の導出

各ソースについて、キーワードに当たるものを列挙する。**列挙結果には必ず出所を持たせる** (範囲修正の
判断材料になるため、ゲート提示で「なぜこれが範囲に入ったか」を 1 行で言えること)。

**実行順序** (節番号は参照用で、上から順ではない): `3.a`〜`3.e` で候補を集める → code module が
0 件だったら **先に `6` の zero-module サブフロー**で扱いを決める → `3.f` で見積を取る → `4` で
manifest を書く (`zero_module_fallback` は 6 の結果) → `5` の人間ゲート。

**a. 要件文書セクション** — `requirements/*.md` の見出し (`##` / `###`) と機能 ID を走査し、
キーワードに当たるセクションを列挙する。`### F-NN: ...` 形式の機能カテゴリ見出しは Phase 0b が
canonical identifier として使っているため、これを範囲の単位にする。

**b. 画面仕様** — `screens/00-screen-list.md` の機能カテゴリ対応と `screens/{slug}.md` の
目的 / コンポーネント一覧 / 仕様値 / 画面遷移セクションを走査する。
**画面遷移セクションから 1 ホップ先の画面も候補に含める** (対象画面から遷移する / 対象画面へ遷移する
画面は「この機能を直すなら、ここも関係します」に該当する)。ホップ数は 1 に留める — 2 ホップ以上は
実質全画面に広がるため、必要なら人間がゲートで追加する。

**c. 文書アーカイブ** — `ground-truth/index.md` を読み、キーワードに当たる文書を列挙する。
**content status が引用可なものだけを範囲に入れる** (本文 / 本文+図依存 / 薄い系 / 抽出本)。
殻 / 図のみ / テンプレート未記入は根拠として成立しないため範囲外にし、**その事実をゲートで 1 行報告する**
(「関連しそうだが引用できない文書 N 件」— 未収集と混同させないため)。
ADF 生 JSON は生 JSON ではなく並置の抽出本 (`{同名}.adf-extract.md`) を範囲に入れる。

**d. Figma frame** — `ground-truth/figma/figma-manifest.json` の frame 一覧から、範囲に入れた各画面
(**b で列挙した遷移 1 ホップ先を含む**) に対応する frame を列挙する (slug / frame 名の一致)。
1 ホップ先の frame も入れるのは、画面遷移の主張の figma 側裏取りに **遷移元 capture 内の遷移要素の引用**
と **遷移先画面の存在確認** の両方が要るため (対象画面の capture だけだと片側が欠けて `未確定` に落ちる。
証拠として何がどこまで言えるかの規則は Step V2 の docs / figma pass を参照)。manifest の
`enumerated_not_captured` に該当が居る場合は「関連しそうだが未 capture の frame N 件」として
ゲートで報告する (差分 capture は `/ayatori-reverse` の役目)。

**e. コード module** (code present のときのみ) — 2 経路の union を取る:
  1. `reverse-engineered/raw-analysis.md` の当該機能セクションに載っている `input-sources/...:line` 引用
     → そのファイルパスから module を引く (`.code-inventory.json` の `files[].module`)。
  2. step 2 で拾った識別子を `input-sources/` に grep して hit ファイルを得る → 同じく module を引く。
     ```bash
     grep -rl -F -e '{識別子1}' -e '{識別子2}' \
       --exclude-dir={node_modules,.git,build,dist,out,vendor,Pods,.venv,__pycache__} \
       artifacts/{app_name}/input-sources/{stack}/ | head -50
     ```
     `-F` (リテラル一致) と `-e` の併記にするのは、識別子に正規表現メタ文字 (`.` `(` `[`) が
     混ざると誤 hit / 取り落としが起きるため。`--exclude-dir` はユーザーが `git clone` で
     配置したツリーに依存ディレクトリが残っている場合に、hit が `head` で切られて
     肝心の呼び出し側が一覧から落ちるのを防ぐ。
     ⚠️ grep の hit は「範囲候補」であって根拠ではない。突合の根拠になるのは Step V2 で実際に読んだ
     file:line だけ。
  3. `.code-inventory.json` が不在の場合 (Phase 0b が code pass を通っていない run) は module を引けない —
     この場合は下記 6 の zero-module サブフローに合流する。

**f. 見積の取得** (code module が 1 件以上あるとき) — 読み取り量を人間に見せるため preview を取る:
   ```bash
   node scripts/build-code-inventory.mjs {app_name} --modules {module csv} \
     --require-files {3.e で拾ったファイルパス csv} --stdout
   ```
   stdout の JSON から `summary.in_scope` (files / chars / est_tokens / shards) を読み `scope.code_estimate` に
   記録する。**`--stdout` は台帳を書かない preview モード** — この時点では読み取り計画を確定させない
   (範囲が人間承認を通る前に確定させると、修正されたときに古い計画が残る)。

   ⚠️ **`--require-files` は 3.e でファイルを 1 件以上拾えた run では必須で付ける** (zero-module サブフロー
   経由で拾得 0 件の run では付けない — 渡す有効な値が無く、区切り文字だけの空値は script が exit 1 で弾く)。
   module 指定と tier フィルタは直交しており、3.e が引用・grep で見つけたファイルでも既定 tier に当たらない
   もの (`other_source` 等) は計画から**黙って落ちる** (worker は shard 外を読まない契約のため、落ちた
   ファイルに関わる主張は全部 `unverified` になる)。本フラグで名指しされたファイルは tier 判定に関わらず
   計画に **固定 (pin)** される — tier は機械の推測分類であり、導出の明示的な名指しが優先する。値は 3.e の
   2 経路で得たパスをそのまま渡せる (引用の `artifacts/{app_name}/` 接頭辞と `:line` アンカーは script 側が
   剥がす)。pin の事実は出力の `selection.require_files` と `files[].pinned` に残る。

   **exit 1 の分岐と処方** (tier 外は pin されるため exit 1 にならない):

   | stderr の内容 | 処方 |
   |---|---|
   | `module … が --modules 外` | 範囲に含めるなら stderr が提示する `--modules` で再実行。**人間が意図して除外した module** のファイルなら `--require-files` から外し、除外した事実を範囲ゲートで 1 行報告する (無言の脱落と人間の除外判断を区別する) |
   | `台帳に無い` | パスの綴りを確認する (`input-sources/{stack}/…` 形) |
   | `未走査 dir 配下` / `除外済み` | 解析対象外 (テスト・生成物・秘密情報等) で計画に入れられない — 根拠として必要なら、その旨を範囲ゲートで報告する |

### 4. scope-manifest の書き出し + run stub の登録

`artifacts/{app_name}/reverse-verify/scope-manifest.json` を Write する
(schema: `schemas/reverse-verify-scope-manifest.schema.json`、writer は本 step のみ)。

- `sources` には **phase Preamble step 4 の実測結果**を書く (inventory の申告ではなく `ls` の結果)。
- `zero_module_fallback` は下記 6 の分岐結果 (該当なしなら `none`)。
- `scope.code_read_plan` に 3.f で使った値を記録する: `require_files` (3.e で拾ったパス。0 件なら省略) と
  `tiers` (tier_fallback を選んだ run のみ)。**承認後の確定コマンド (下記 5 On A) はこの記録から値を読む** —
  会話記憶から再構成すると、範囲ゲート再提示からの resume で preview 時の条件を復元できず、人間が承認した
  見積と違う条件で計画が確定される。
- **すべてのリストが空になる場合は Write しない** — hook R11 が弾く。要件文書セクションが 0 件のときは
  対象の解釈に失敗している (訂正対象そのものが無い) ので、step 1 に戻って対象を聞き直す。

続けて `reverse_verify.runs[]` に **run stub を append** する (承認印はまだ付けない)。ゲートの提示中に
セッションが切れても、phase の resume ladder が「範囲ゲートのみ再提示」に入れるようにするため —
stub が無いと state 上は run が存在せず、grep や preview を含む導出全体をやり直すことになる:

⚠️ **ユーザーの自由入力 (対象の記述 / Jira キー) を python のソースへ直接埋め込まない** — 引用符 1 つで
構文エラーになり、任意コードの実行にもつながる。値は **環境変数で渡し、script 側で読む**
(`RV_*` の各値をシェル変数に入れてから実行する。リストは JSON 文字列で渡す):

```bash
RV_APP="{app_name}" RV_RUN_ID="{run_id}" RV_TARGET="{対象の記述}" \
RV_INITIATED="{scope-manifest.json.created_at}" RV_SOURCES='["code","docs"]' RV_JIRA="{Jira キー or 空}" \
python3 << 'PYEOF'
import json, os

app = os.environ["RV_APP"]
path = f"artifacts/{app}/pipeline-state.json"
data = json.loads(open(path).read()) if os.path.exists(path) else {"app_name": app}
if not data.get("app_name"):
    print("ERROR: pipeline-state.json に app_name がありません (schema required)"); exit(1)
runs = data.setdefault("reverse_verify", {}).setdefault("runs", [])
run_id = os.environ["RV_RUN_ID"]
if not any(r.get("run_id") == run_id for r in runs):
    entry = {
        "run_id": run_id,
        "target_description": os.environ["RV_TARGET"],
        "initiated_at": os.environ["RV_INITIATED"],       # scope-manifest.json.created_at と同値
        "sources_present": json.loads(os.environ["RV_SOURCES"]),   # 実測で present なもの
    }
    if os.environ.get("RV_JIRA"):
        entry["jira_issue_key"] = os.environ["RV_JIRA"]
    runs.append(entry)
    open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"OK: reverse_verify run {run_id} stub appended")
else:
    print(f"OK: run {run_id} は既に登録済 (再提示のため stub は作らない)")
PYEOF
```

### 5. 人間ゲート (AskUserQuestion)

範囲を表で提示する。**「この機能を直すなら、ここも関係します」を人間が判断できる形で出す**:

> 「対象: {target_description}{jira があれば「 (Jira: {KEY})」}
>
>  | ソース | 範囲 | 根拠 |
>  |---|---|---|
>  | 要件文書 | {doc}:{section} … | キーワード「{語}」が見出しに一致 |
>  | 画面仕様 | {slug} … | 機能カテゴリ対応 / {対象画面} から遷移 |
>  | 文書 | {file} … | index の見出しに一致 (引用可) |
>  | Figma | {slug} ({node}) … | frame 名が対象画面に一致 |
>  | コード | {module} … ({files} files / 約 {est_tokens} tokens / {shards} shard) | raw-analysis の引用 / 識別子 grep |
>
>  {縮退・欠落があれば続けて 1 行ずつ:}
>  ⚠️ ソースコードが配置されていないため、コードとの突合は行いません (文書・Figma のみ)。
>  ⚠️ 関連しそうだが引用できない文書 {N} 件 (index の content status が 殻 / 図のみ / テンプレート未記入)。
>  ⚠️ 関連しそうだが未 capture の Figma frame {N} 件 (差分 capture は `/ayatori-reverse`)。
>  ⚠️ 画面仕様が存在しないため、画面記述の突合は行いません。」

`AskUserQuestion` の選択肢:

- **A. この範囲で突合する** (推奨)
- **B. 範囲を修正する**
- **C. 中止する**

**On A (承認)** — 2 つを実行してから Step V2 へ進む:

1. **コード読み取り計画の確定** (code module が 1 件以上のときのみ)。`--out` で verify 専用の台帳へ書く —
   Phase 0b の `.code-inventory.json` / `.code-scope.json` は reverse の resume と shard worker が読むため、
   そこへ書くと reverse の確定範囲を壊す:
   ```bash
   node scripts/build-code-inventory.mjs {app_name} --modules {module csv} \
     [--require-files {scope-manifest の code_read_plan.require_files csv}] \
     [--tiers {code_read_plan.tiers があればその csv}] \
     --out artifacts/{app_name}/reverse-verify/.code-inventory.json
   ```
   `--require-files` / `--tiers` の値は **`scope-manifest.json` の `code_read_plan` から読む** (会話記憶から
   再構成しない) — 値の出所を 1 箇所にすることで、範囲ゲート再提示からの resume を含め preview と確定が
   同じ条件で実行されることを担保する (確定側だけ条件が欠けると、人間が承認した見積に入っていたファイルが
   計画から落ちても気付けない)。実行後、出力の `summary.in_scope` で `scope-manifest.json` の
   `code_estimate` を更新する (人間が見た見積と実際に読む計画を一致させる)。
2. **承認印の記録** — 上記 4 で登録した stub に `scope_approved_at` を足す。Bash tool で実行する
   (`__PLACEHOLDERS__` を置換してから):

```bash
RV_APP="{app_name}" RV_RUN_ID="{run_id}" python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

app, run_id = os.environ["RV_APP"], os.environ["RV_RUN_ID"]
path = f"artifacts/{app}/pipeline-state.json"
data = json.loads(open(path).read())
runs = data.get("reverse_verify", {}).get("runs", [])
run = next((r for r in runs if r.get("run_id") == run_id), None)
if run is None:
    print(f"ERROR: run {run_id} の stub がありません (Step 4 の登録が実行されていない)"); exit(1)
# 範囲修正後の再承認でも同じ run を更新する (二重 append しない)
run["scope_approved_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: scope_approved_at written")
PYEOF
```

**On B (範囲修正)**: ユーザーに聞く — 「修正を自由記述で入力してください。変更できるのは
`要件文書セクション` / `画面仕様` / `文書` / `Figma frame` / `コード module` の各リストへの
**追加・除外**です (例: 「予約確認画面も入れて」「be-python/batch は外して」)」。

修正を `scope-manifest.json` の該当リストへ直接反映する。**step 1〜3 の導出はやり直さない**
(既に候補集合まで進んでいる段階を巻き戻すと往復が無駄に増える)。`code_modules` が変わった場合のみ
上記 3.f の `--stdout` preview を再実行して `code_estimate` を更新する。**module を除外する修正を受けた
場合は `code_read_plan.require_files` からも当該 module のファイルを外し、再提示で 1 行報告する**
(残したまま preview を再実行すると module 外 miss の exit 1 で詰まる — 人間の除外判断は require-files より
優先する)。更新後、**本ゲートを即再提示する** (ループ)。

- 除外の結果すべてのリストが空になる指示を受けた場合は反映せず、1 行で伝えて再提示する:
  「すべての範囲を除外すると突合する対象が無くなります。少なくとも要件文書セクションを 1 件残してください」。
- 「全部見て」に相当する指示 (範囲を全文書・全画面へ広げる要求) を受けた場合は、そのまま反映せず
  1 回だけ確認する: 「全範囲の突合は本コマンドのスコープ外です (対象を絞ることが前提の設計)。
  全体の品質を上げ直す場合は `/ayatori-reverse` の再実行が適切です。範囲を対象周辺に限定して続けますか?」

**On C (中止)** — Bash tool で実行する:

```bash
RV_APP="{app_name}" RV_RUN_ID="{run_id}" RV_TARGET="{対象の記述}" RV_INITIATED="{created_at}" \
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

app = os.environ["RV_APP"]
path = f"artifacts/{app}/pipeline-state.json"
data = json.loads(open(path).read()) if os.path.exists(path) else {"app_name": app}
if not data.get("app_name"):
    print("ERROR: pipeline-state.json に app_name がありません (schema required)"); exit(1)
runs = data.setdefault("reverse_verify", {}).setdefault("runs", [])
now = datetime.now(timezone.utc).isoformat()
run_id = os.environ["RV_RUN_ID"]
run = next((r for r in runs if r.get("run_id") == run_id), None)
if run is None:   # stub 登録前に中止した場合 (範囲導出の途中で抜けた等)
    run = {"run_id": run_id, "target_description": os.environ["RV_TARGET"],
           "initiated_at": os.environ["RV_INITIATED"]}
    runs.append(run)
run.update({"cancelled_at": now, "cancel_reason": "user_abort"})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: cancelled_at / cancel_reason written")
PYEOF
```

「突合を中止しました。要件文書・画面仕様は変更していません。」と表示して phase を終える。

### 6. zero-module サブフロー (code present なのに module が 0 件)

code が present なのに 3.e で module を 1 件も引けなかった場合、**無言で「コードなし」に倒さない**
(対象がコードに存在しないのか、探し方が悪かったのかを区別できないため)。ゲート内で 3 択にする:

> 「ソースコードはありますが、対象「{target}」に対応する module を機械的に特定できませんでした
>  (raw-analysis.md の引用にも、識別子 {語} の grep にも当たりません)。どうしますか?」

- **module を直接選ぶ** (`manual_selection`) — `.code-inventory.json` の module 一覧を提示して選ばせる
  (5 件以上なら plain chat の番号付きリスト)。
- **tier で絞る** (`tier_fallback`) — `--tiers navigation,screen` 等で対象画面名を含むファイルに絞る:
  ```bash
  node scripts/build-code-inventory.mjs {app_name} --tiers navigation,screen --stdout
  ```
  preview の `files[]` から対象画面名を含むものの module を取り、それを `code_modules` にする。
  ⚠️ **この分岐を選んだ場合、承認後の確定コマンド (下記 5 On A) にも同じ `--tiers` を渡す** —
  省略すると既定 7 tier に戻り、人間が承認した見積より実際に読む量が増える。
  `code_estimate` は確定コマンドの出力 (`summary.in_scope`) で更新する。
- **文書・Figma だけで進める** (`docs_only`) — コード側の突合を諦める。この場合 **Step V2 の報告書に
  「code 側 未検証」を明示させる** ため、`zero_module_fallback: "docs_only"` を manifest に記録する
  (突合しなかったことが後から読める状態にする)。

選んだ値を `scope_manifest.zero_module_fallback` に記録する (該当なしのときは `none`)。

⚠️ `--modules` に存在しない module 名を渡すと `build-code-inventory.mjs` が exit 1 で有効な module 一覧を
出す (typo で空の「確定済み」計画を作らない安全弁)。エラーが出たら一覧から選び直す。

## Outputs

- `artifacts/{app_name}/reverse-verify/scope-manifest.json` (本 step が単一 writer)
- `artifacts/{app_name}/reverse-verify/.code-inventory.json` (承認時のみ。`build-code-inventory.mjs --out` の決定論生成)
- `pipeline-state.json.reverse_verify.runs[]` の run stub (manifest 書き出し時) + `scope_approved_at` (承認時)

## Completion Check

- [ ] 対象の記述をユーザーから受け取った (推測で決めていない)
- [ ] 範囲の各要素に **出所** がある (なぜ範囲に入ったかを 1 行で言える)
- [ ] 引用できない文書 / 未 capture frame / 画面仕様不在 / code 不在を **ゲートで報告した** (黙って落としていない)
- [ ] `scope-manifest.json` のリストが少なくとも 1 件埋まっている (空 scope は hook R11 が弾く)
- [ ] manifest 書き出し時に run stub を登録した (ゲート提示中に中断しても範囲ゲートから再開できる)
- [ ] code present で module 0 件だった場合、3 択のいずれかを選び `zero_module_fallback` に記録した
- [ ] (code module ≥1 かつ 3.e で拾ったファイルが 1 件以上の run) `--require-files` で計画に固定した —
      preview / 確定の両方で、値は `code_read_plan` から (tier フィルタで引用済みファイルが黙って落ちるのを
      機械で止める)
- [ ] 承認時に `--out` で **verify 専用の** 読み取り計画を作った (Phase 0b の `.code-inventory.json` を上書きしていない)
- [ ] `source-inventory.json` を書き換えていない (読み取り専用)
- [ ] 範囲修正ループで step 1〜3 の導出をやり直していない

## Feedback Log

範囲修正 (Option B) が入った場合は Pattern A として `artifacts/{app_name}/feedback-log.md` に append する。
**どの導出経路が対象を取り落としたか** (見出し一致 / 遷移 1 ホップ / grep) を併記する — 導出規則の改善材料になる。
