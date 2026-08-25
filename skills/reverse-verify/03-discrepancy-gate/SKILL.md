---
name: 03-discrepancy-gate
description: 突合で確定した食い違いを人間に提示し、項目ごとの判断 (修正 / 容認 / 保留) を受けて、承認された修正だけを要件文書と画面仕様へ反映する。推測マーカーの保持を機械検査し、反映結果を run 履歴に記録する。
---

# Step V3: Discrepancy Gate — 食い違いの人間判断と記述への反映

## Purpose

Step V2 が確定した食い違いを **人間が判断して**、記述を直す。

AI の判断だけで要件記述を書き換えないのは、突合の判定自体が確率的だからである (再読プロトコルを
通しても、証拠の解釈が割れる余地は残る)。また「記述が古い」のではなく「実装が仕様から外れている」
ケースでは、直すべきは記述ではなくコードであり、その判断は人間にしかできない。

## Inputs

- `artifacts/{app_name}/reverse-verify/crosscheck-report.md` (Step V2 の突合結果)
- `artifacts/{app_name}/requirement-deviations.json` (`phase == "reverse_verify"` かつ本 run の entry)
- `artifacts/{app_name}/reverse-verify/scope-manifest.json` (縮退状況の提示に使う)
- `artifacts/{app_name}/requirements/*.md` / `screens/{slug}.md` (訂正対象)

## Precondition

`pipeline-state.json.reverse_verify.runs[-1].crosscheck_completed_at` が set であること。未 set なら
Step V2 が完了していない — 本 step を実行せず Step V2 に戻る。

## Process

### 1. view の再生成

```bash
node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json
```

決定論生成された `requirement-deviations-view.html` を提示に使う (手焼き禁止)。続けて成果物インデックスも
再生成する (人間ゲート共通の `refresh_index` 規約。fail-open — 失敗してもゲートを止めない):

```bash
node scripts/build-artifact-index.mjs artifacts/{app_name}
```

### 2. 人間ゲート提示

**banner を冒頭に出す** (人間が全体像を掴んでから個別判断に入れるように):

> 「対象「{target_description}」の突合結果:
>  突合した主張 **{N}** 件 — 根拠あり **{backed}** / **⚠️ 食い違い {contradicted} 件 ← 判断対象** /
>  誤読訂正 {corrected} (突合中に AI の読み違いと判明・記述は正しい) / 未確定 {unverified} (証拠不足)
>
>  📄 突合レポート: `artifacts/{app_name}/reverse-verify/crosscheck-report.md`
>  📋 食い違い一覧: `artifacts/{app_name}/requirement-deviations-view.html`」

続けて、該当する場合のみ 1 行ずつ追加する:

- 縮退: 「⚠️ 本 run はソースコード不在 (または `docs_only` fallback) のため、挙動の主張はコード裏取りが
  できていません。文書・Figma だけの判定は慎重に確認してください。」
- 引用検証: 「引用スポットチェック疑義 **N** 件 → 修正 **M** / `※ 未確認` 降格 **K** (機械検証済み)」
  — 数字は `crosscheck-report.md` の Coverage 節から読む (V2 がそこに残している。別セッションで
  再開した場合も同じ数字を出せる。推測で書かない — 読めなければ「記録なし」と明示する)
- carry-forward: 「過去 run で容認済みの同一項目 **N** 件は再提示していません (`requirement-deviations-view.html`
  で確認できます)。」
- 未確定: 「未確定 **{unverified}** 件は証拠が足りず判定できていません — 記述はそのまま残ります
  (`※ 未確認` を付与)。証拠を足すには `/ayatori-reverse` の差分収集が必要です。」

次に **食い違い 1 件ずつ** 判断を求める。受領導線 (per-item 質問の束ね方 / 番号 `#N` 指定 /
「全件容認 (N 件)」) と `resolution_mode` の値 (individual / bulk) は `docs/principle4-disambiguation.md` §5.5 に従う。
判断を受けたら **その項目の台帳書き戻しを先に行い、それから記述を直す** (下記 3 の順序規律)。

各項目の提示に含める情報 (人間が証拠を自分で確かめられる形にする):

> 「#{N} {比較軸} / {severity}
>  記述: 「{element}」 (`{artifact}:{line}`)
>  証拠: {初読 Evidence}
>  再読: {再読 Evidence} ← 誤読でないことを確認した経路
>  修正提案先: {doc | code | both}」

選択肢:

- **修正** — 記述を証拠に合わせて直す (下記 3 で反映)。
- **容認** — 記述をそのままにする (証拠の読みに納得できない / 記述が意図的にそうなっている等)。
- **保留** — 今は決めない。台帳に **未解決のまま残す**。

⚠️ **`修正提案先 == "code"` の項目**: 「実装が仕様から外れている」判定のもの。1 行明示する:
「これは実装側の問題です — 本コマンドはコード (`input-sources/`) を変更しません (ユーザー所有の読み取り
専用素材)。記述は現状の仕様として維持し、実装修正は本パイプラインの外で扱ってください。」
この項目の選択肢は **容認 / 保留 のみ** にする (記述を実装に合わせて直すと、仕様の意図が失われる)。

⚠️ **全件 account 必須**: 食い違いの **すべて** に判断 (修正 / 容認 / 保留) を付けるまで本 step を終えない。
`contradicted == 0` のときは「記述と証拠は一致していました」と表示して下記 5 へ進む (この場合も run は
完了として記録する — 「突合して差が無かった」は成果である)。

⚠️ **過剰質問の禁止**: 止めて聞くのは食い違いと下記のマーカー解除候補のみ (`pipeline.yaml` P4-07)。
`誤読訂正` / `未確定` / 根拠が既にあった項目については聞かない (前者 2 つは報告書で見せるだけ)。

### 2b. マーカー解除の承認 (解除候補がある場合)

`crosscheck-report.md` の「マーカー解除候補」に載っている項目を **1 件ずつ提示して承認を得る**:

> 「#{N} `※ 推測 (inferred)` を外して確定記述にしますか?
>  記述: 「{原文}」 (`{doc}:{line}`)
>  見つかった根拠: {引用}」

- **承認** → マーカーを外す (下記 3 で反映)。
- **却下** → マーカーを維持する (根拠の解釈に納得できない / 記述自体を見直したい等)。

⚠️ **AI 単独で外してはならない** — マーカーを外すことは推測を確定事実へ昇格させる行為で、
外れた記述は下流 (design / screens) が確定仕様として扱う。本 phase の目的が
「推測が確定事実として laundering されるのを防ぐ」ことなので、ここを自動化すると目的が反転する。
候補が 0 件なら本 step は何も聞かずに次へ進む。

### 3. 判断の記録と記述の反映

**順序規律 — 項目ごとに「台帳へ記録 → 記述を直す」の順で行う。** 全項目を直してから台帳を
まとめて書く形にすると、その間にセッションが切れた場合に人間の判断が全て失われ、再開時には
**既にファイルへ反映済みの項目が未解決として再提示**される (そこで再び「修正」を選ぶと同じ編集が
二重に適用される)。判断を先に永続化すれば、再開時は「resolved だが未反映」を見分けられる。
`docs/principle4-disambiguation.md` §5.5.3 のゲート契約 (判断はゲートで stamp する) と同じ形。

- 各項目の台帳書き戻しは下記 4 の field を使う (項目単位で 1 回ずつ)。
- 再開時に `resolution == "修正依頼"` かつ記述が既に直っている項目は **再適用しない**
  (記述を読んで反映済みか確かめる。判断は台帳にあるので聞き直さない)。

**反映すべき変更が 0 件のとき** (食い違いが全て `容認` / `保留`、かつマーカー解除の承認も 0 件) は
**a〜c を実行しない** — 退避する対象も検査する対象も無い。Completion Check の該当 3 項目は N/A とし、
下記 4 (台帳の書き戻し) と 5 (run 状態) だけを実行する。
⚠️ この分岐を飛ばして c を実行すると、`--docs` に渡す文書が無いまま必須の検査を回すことになり、
検査は入力不能 (exit 2) で止まる。

**a. 反映前のスナップショット** — 検査の基準線を作る。**要件文書は全量、画面仕様は別ディレクトリ**に退避する:

**退避先は run ごとに分ける** (`snapshots/{run_id}/`) — 判定は「今ディスクにあるスナップショット」を
基準線にするため、run を跨いで共有すると 2 回目の run が 1 回目の訂正前の内容と比較してしまい、
1 回目で人間が承認した正当な訂正が violation として上がる (しかも FAIL の処方は「スナップショットから
戻す」なので、従うと承認済みの訂正が巻き戻る)。ディレクトリ名に run_id を入れれば「再開なら既存を
使う / 新しい run なら新しい基準線」が **パスだけで機械的に決まる**:

```bash
SNAP=artifacts/{app_name}/reverse-verify/snapshots/{run_id}
mkdir -p "$SNAP/screens"
# 冪等ガードは **ファイル単位** で判定する: 既にある退避物は上書きせず (再開時に訂正後の内容で
# 上書きすると baseline == current になり以降の検査は必ず PASS = 無意味化する)、無いものだけ補う
# (ディレクトリの有無で判定すると、複製が途中で切れた状態を「揃っている」と誤認し、欠けた文書の
#  マーカー消失を検出できなくなる)
for f in artifacts/{app_name}/requirements/[0-9][0-9]-*.md; do
  s="$SNAP/$(basename "${f%.md}").snapshot.md"; [ -e "$s" ] || cp "$f" "$s"
done
# 画面仕様: {run_id}/screens/ (要件文書と同階層に置かないこと — 下記 ⚠️)
for f in artifacts/{app_name}/screens/*.md; do
  [ -e "$f" ] || continue
  s="$SNAP/screens/$(basename "${f%.md}").snapshot.md"; [ -e "$s" ] || cp "$f" "$s"
done
```

**要件文書を全量退避する理由**: 検査の主目的は「**訂正していない**文書のマーカーが落ちていないか」であり、
判定は退避した文書の集合を母集団に回る。訂正対象だけを退避すると、それ以外の文書は比較対象に入らず
**検査が検出すると宣言している違反を構造的に検出できない** (warning 止まりで exit 0 になる)。
同じ検査を使う `skills/31-req-change-detect/SKILL.md` も同じ理由で全量退避を指示している。

⚠️ **画面仕様を要件文書と同じディレクトリに置いてはならない** — `check-marker-retention.mjs` の
要件文書判定はパスではなく **ファイル名パターン (`NN-*.md`)** で、画面 slug (`03-search.md` 等) はこれに
一致する。同階層に置くと画面仕様が要件文書として母集団に入り、`requirements/` 側に同名が無いため
**触ってもいない画面仕様が violation (FAIL) として上がる**。サブディレクトリの中身は走査されないため、
`{run_id}/screens/` に置けばこの誤判定は起きない。

なお `requirements/*.md` / `screens/*.md` への Write / Edit は PreToolUse hook が
`_backup/` へ自動退避するため、**本スナップショットは検査用の基準線として別に取る** (役割が異なる)。

**b. 記述の訂正** — `requirements/{NN}-*.md` と `screens/{slug}.md` のみを Edit する。

- 訂正は **証拠の引用を伴う形** で書く (どのコード / 文書に基づいて直したかが後から読めるように)。
  記述本文に引用を書く既存の書式に合わせる (リバース産文書は挙動注記に引用を持つ)。
- **`※ 推測 (inferred)` / `※ 不明 (unknown)` マーカーの扱い**:
  - **上記 2b で人間が承認した項目のマーカーだけを外す**。承認を得ていないマーカーは、根拠が
    見つかっていても外さない (AI 単独の昇格を禁じる)。
  - それ以外のマーカーは **逐語で保持する** (触っていない箇所のマーカーを消してはならない — 推測が
    確定事実として下流へ laundering される)。
  - 外した箇所には **根拠の引用を併記する** (後から「何を根拠に確定させたか」を追えるようにする)。
- **本 step が書かないもの** (明示): `requirements.json` (Phase 0b Step 06 が所有) /
  `reverse-provenance.json` (生成時点のスナップショット) / `reverse-engineered/*` /
  `tokens.json` / `scores.json` / `screens/00-transition-map.mmd` / `screens/00-coverage-check.json` /
  `pipeline-state.json.approvals.*`。

**c. マーカー保持の機械検査** — 訂正した文書名を `--docs` で渡す:

```bash
node scripts/check-marker-retention.mjs artifacts/{app_name} \
  --snapshots reverse-verify/snapshots/{run_id} \
  --docs {訂正した文書名の csv}
```

- `--docs` には **この run で実際に触った文書を全て**渡す (食い違いの訂正分 + マーカーを外した分)。
  渡すのは必須 — 省略すると `req_delta.runs[-1]` から「触った文書」を導出しようとし、
  本 phase の run はそこに存在しないため **正当な訂正まで違反と誤判定される**。
  逆に **触っていない文書を混ぜてはならない** — 渡した文書の減少は REVIEW (exit 0) に落ちるため、
  広めに申告すると本来 FAIL であるべきマーカー消失が警告に格下げされる (検査の自己無効化)。
- **verdict `FAIL`** (訂正していない文書のマーカーが減った) → 反映が範囲外へ及んでいる。
  スナップショットから **当該 violation の文書だけ** を戻し (訂正対象の文書は戻さない)、
  訂正を対象文書だけに絞って再実行する。
- **verdict `REVIEW`** (訂正した文書のマーカーが減った) → 1 件ずつ確認する: (i) 証拠が付いてマーカーを
  外した (正当) / (ii) 記述ごと削除した (正当か確認) / (iii) 意図せず落ちた (戻す)。
- **verdict `SKIPPED`** (`no_snapshots`) → `--snapshots` に渡したディレクトリに `NN-*.snapshot.md` が
  1 件も無い。a の全量退避が実行できていないので、a をやり直してから再実行する
  (detail 文には渡したディレクトリが出る)。
- 画面仕様 (`screens/{slug}.md`) は本 script の**検査対象に含めない** — 要件文書と混ぜると上記 a の
  ⚠️ の誤判定を招くため、`{run_id}/screens/` に退避するだけにして検査は要件文書に限る。
  画面仕様のマーカー保持は目視で確認する (Completion Check の項目)。必要なら退避物と
  `diff` を取って確認できる。

### 4. 台帳への判断の書き戻し (main が単一 writer)

`requirement-deviations.json` の各 entry に main が書く:

- **修正 / 容認** → `resolved_at` (ISO 8601) + `resolution` (`修正依頼` / `容認`) + `resolution_mode`
  (`individual` / `bulk`)。**上記 3 の順序規律どおり、記述を直す前にこれを書く**。
- **保留** → **何も書かない** (unresolved のまま残す)。enum の拡張はしない — 未解決であること自体が
  「保留」の表現であり、同じ対象を再度突合した run で再提示される。

⚠️ 本 phase では `resolution` に `要件に昇格` を使わない — 本 phase の「修正」は既存記述の訂正であり、
新しい要件の追加ではない (要件の追加は `/ayatori-req-delta` / `/ayatori-add-feature` の役目)。

書き戻し後に view を再生成する (step 1 のコマンド)。

### 5. run 状態の更新

Bash tool で実行する (`__PLACEHOLDERS__` を置換してから):

文書名などの自由入力は **環境変数で渡す** (python ソースへ直接埋め込まない — 引用符 1 つで
構文エラーになり、任意コード実行の余地も生まれる)。数値も同じ経路で揃えておく:

```bash
RV_APP="{app_name}" RV_RUN_ID="{run_id}" RV_DOCS='["05-features.md","screens/03-search.md"]' \
RV_APPLIED=2 RV_MARKERS=1 RV_DEFERRED=1 python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone

app, run_id = os.environ["RV_APP"], os.environ["RV_RUN_ID"]
path = f"artifacts/{app}/pipeline-state.json"
data = json.loads(open(path).read())
runs = data.get("reverse_verify", {}).get("runs", [])
run = next((r for r in runs if r.get("run_id") == run_id), None)
if run is None:
    print(f"ERROR: run {run_id} が見つかりません"); exit(1)
run.update({
    "findings_resolved_at": datetime.now(timezone.utc).isoformat(),
    "corrections_applied": int(os.environ["RV_APPLIED"]),   # 食い違いの訂正件数 (マーカー解除は含めない)
    "corrections_docs": json.loads(os.environ["RV_DOCS"]),  # 触った文書名 (--docs に渡した集合と一致させる)
    "markers_cleared": int(os.environ["RV_MARKERS"]),       # 人間承認を得てマーカーを外した件数
    "findings_deferred": int(os.environ["RV_DEFERRED"]),    # 保留の件数
})
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: findings_resolved_at / corrections_* / markers_cleared / findings_deferred written")
PYEOF
```

`completed_at` は書かない — phase の Completion が押す (run 完了の合図を 1 箇所に保つ)。

## Outputs

- `artifacts/{app_name}/requirements/{NN}-*.md` / `screens/{slug}.md` (承認された訂正のみ)
- `artifacts/{app_name}/reverse-verify/snapshots/{run_id}/NN-*.snapshot.md` (要件文書 **全量** の基準線)
  + `{run_id}/screens/*.snapshot.md` (画面仕様。要件文書の検査母集団に混ぜない)
- `artifacts/{app_name}/requirement-deviations.json` の `resolved_at` / `resolution` / `resolution_mode`
- `artifacts/{app_name}/requirement-deviations-view.html` (再生成)
- `pipeline-state.json.reverse_verify.runs[-1]` の `findings_resolved_at` / `corrections_*` / `markers_cleared` / `findings_deferred`

## Completion Check

- [ ] banner で全体像 (根拠あり / 食い違い / 誤読訂正 / 未確定) を提示した
- [ ] 縮退・carry-forward・未確定の注記を該当する run で出した
- [ ] 食い違いの **すべて** に判断が付いた (修正 / 容認 / 保留)
- [ ] `修正提案先 == "code"` の項目に「コードは変更しない」を明示し、修正の選択肢を出していない
- [ ] 項目ごとに「台帳へ記録 → 記述を直す」の順で行った (まとめ書きだと中断時に判断が失われ、再開で二重適用になる)
- [ ] マーカーを外したのは 2b で人間が承認した項目だけ (根拠が見つかっただけでは外していない)
- [ ] (反映 0 件の run) a〜c を実行せず 4・5 のみ行い、本 Check の退避・検査 3 項目を N/A とした
- [ ] 訂正前に **要件文書を全量** `reverse-verify/snapshots/{run_id}/` へ退避した (訂正対象だけでは、検査が
      検出すると宣言している「触っていない文書のマーカー消失」を構造的に検出できない)
- [ ] 画面仕様は `{run_id}/screens/` に退避した (要件文書と同階層に置くと `NN-*.md` パターンに
      一致して誤判定 FAIL を招く)
- [ ] 退避先が run ごとに分かれている (`snapshots/{run_id}/`) — run を跨いで共有すると 2 回目の run が
      前 run の訂正前内容と比較し、承認済みの訂正を violation として上げる
- [ ] 再開 run で既存スナップショットを上書きしていない (上書きすると基準線が訂正後になり検査が無意味化する)
- [ ] 冪等ガードをファイル単位で行った (ディレクトリの有無で判定すると、複製が途中で切れた状態を
      「揃っている」と誤認して欠けた文書のマーカー消失を見逃す)
- [ ] 訂正は `requirements/*.md` と `screens/{slug}.md` のみ (requirements.json / reverse-provenance.json /
      reverse-engineered/* / approvals.* に触っていない)
- [ ] 証拠が付いた箇所以外の `※ 推測` / `※ 不明` マーカーを逐語保持した (画面仕様側は目視確認)
- [ ] `check-marker-retention.mjs` を **`--docs` 付きで** 実行し、FAIL でない状態にした
- [ ] 保留の entry を unresolved のまま残した (resolution を書いていない)
- [ ] view を再生成した (判断の書き戻し後)

## Feedback Log

- 人間が「修正」を選んだ = 記述が誤っていた → **Pattern A** として append する
  (どの比較軸で・どの種類の誤りだったかを併記 — リバース生成側の改善材料になる)。
- 人間が「容認」を選んだ = AI の突合判定が誤りだった可能性 → **Pattern B** として append する
  (再読プロトコルを通してもなお誤判定だったケースは、再読手順の改善材料になる)。
