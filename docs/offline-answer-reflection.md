# pending-questions.json オフライン回答の反映手順

`pending-questions.json` に append された未確定質問を、その場で `AskUserQuestion` に答えられず
オフラインで人間の回答を集めてきた場合の反映手順。通常経路 (`skills/_shared/preflight-gate.md`
手順 (c)-(f)、session 内で即答) の**代替経路**であり、このファイルは repo の SoT を書き換えない
(逸脱の宣言は本ファイル内に�closeじる)。使う script は `scripts/pending-answers.mjs`
(`export` / `check` / `write` の 3 subcommand)。

## 前提

- `artifacts/{app_name}/pending-questions.json` に `resolved_at` 未設定の entry がある
  (通常は `/ayatori-reverse` 等が append したもの)。
- 人間の回答が手元にある、またはこれから集める。

## 順序制約 (元仕様からの意図的な逸脱)

**押印 (`resolved_at` の書き込み) は文書反映のあとに行う。** `check` → 文書反映 → `write` の順を守ること。

`preflight-gate.md` (d) は「call ごとに回答受領後すぐ merge → Write してよい (中断時の回答喪失を防ぐ)」
と早押しを推奨しているが、これは (d)(e) が同一 gate 実行内で連続する前提に立つ。オフライン経路は
文書反映が per-file 委譲の多段作業になり露出窓が伸びるため、先に押印すると「entry は resolved なのに
文書はまだ直っていない」状態が生まれても、それを再反映させる仕組みが無くなる (gate は resolved_at
set の entry を skip するため)。回答自体は `answers.tsv` に durable に残るので早押しの本来の目的
(回答喪失防止) は既に満たされている — だから後ろに回してよい。

## 実行手順 (3 セッション分割)

セッションを分けるのはトークン削減策 (探索文脈を次の作業に持ち越さない)。

### Session A — 回答の取り込み

1. 手書きの回答 (MD/メール/表など任意形式) を `target<TAB>answer` の TSV に正規化する。
   フォーマットが崩れていなければ Haiku 4.5 相当の軽いモデルの subagent 1 体に
   「この MD だけを読んで TSV を出せ」と投げ、**main の文脈に元の MD 本文を載せない**。
2. 検証:
   ```
   node scripts/pending-answers.mjs check artifacts/{app_name} --from answers.tsv --json
   ```
   これが唯一 main が受け取る入力になる (`pending-questions.json` 自体は読まない)。
   - `failures[]` が 1 件でもあれば `write` は必ず失敗するので、ここで解消する
     (`unknown_target` = target の typo、`duplicate_target` = 同じ target に 2 回回答、
     `conflicting_answer` = 既に別回答で resolved 済み)。
   - `warnings[]` の `unanswered` は答えを取り直す。`free_text` は値埋め質問なら正常
     (推測で埋めない — Operating Principle 4)。
   - `groups[]` は `reflect_to` ごとにまとまっている。これがそのまま Session B の
     委譲単位になる。

### Session B — Tier 1 (穴埋め) の反映 + 押印

3. Tier 分け (main が判断する。ここは script化しない — 誤ると推測が確定事実として
   下流に laundering される):
   - **T1 = 穴埋め**: `※ 不明 (unknown)` / TBD の値埋め、記述の言い換え。
     must/should の意味や画面構成を変えない。
   - **T2 = 仕様変更**: must/should の意味が変わる、機能・画面の増減を伴う。
     → Session C へ。
4. T1 を `reflect_to` 単位で subagent へ委譲 (1 ファイル 1 体、並列可)。各体への固定ルール:
   - `grep -n` で該当マーカー/記述をアンカーし、**Edit による局所置換のみ**。
     ファイル全文の再生成は禁止 (マーカー脱落・provenance laundering の主因)。
   - 自分の担当以外に残っている `※ 推測 (inferred)` / `※ 不明 (unknown)` は逐語保持し、
     絶対に消さない。
   - 回答由来の値は (A) CONFIRMED になったので該当箇所の `※` マーカーは外す。
     根拠は `pending-questions.json` の resolved entry (confirmed-decisions ledger)。
   - 戻り値は変更した行番号と 1-2 行要約のみ (文書本文を返さない — トークン削減の主眼)。
5. 検証は script で行う (LLM の目視レビューに頼らない):
   ```
   node scripts/check-marker-retention.mjs artifacts/{app_name} --docs "<触った文書 csv>"
   node scripts/check-req-crossrefs.mjs artifacts/{app_name}
   node scripts/check-source-citations.mjs artifacts/{app_name}
   git diff --stat   # 意図外ファイルへの波及がないか
   ```
   画面 HTML に触った場合は追加で `node scripts/lint-screen-colors.mjs --check`。
6. 反映が終わった T1 分だけを押印する:
   ```
   node scripts/pending-answers.mjs write artifacts/{app_name} --from answers.tsv \
     --only-targets "<T1 の target を comma 区切りで>"
   ```

### Session C — Tier 2 (仕様変更) の反映 + 押印 (T2 がある場合のみ)

7. T2 の回答をまとめて **`/ayatori-req-delta` を 1 回だけ**実行する (Steps 31-33)。
   項目ごとに何度も走らせない — Step 32 の 8 文書横断影響分析が最も高コストなので、
   1 回に束ねるのが最大の削減レバー。
   - 回答が「ユーザーの方針決定」ではなく「コード/Figma の実体との食い違い」だった場合は
     req-delta ではなく `/ayatori-reverse-verify` (Phase 0c) を使う。改修対象として
     名指しされた範囲だけに絞り、全範囲の再突合はしない。
8. 完了後に T2 分を押印する:
   ```
   node scripts/pending-answers.mjs write artifacts/{app_name} --from answers.tsv \
     --only-targets "<T2 の target を comma 区切りで>"
   ```

## モデル配分

main セッションのモデルはユーザー操作 (`/model`) でのみ変わる。subagent のモデルは
呼び出し側が呼び出しごとに指定できるので、下表の振り分けは自動でよい。

| 工程 | モデル | 理由 |
|---|---|---|
| 回答 MD → TSV 正規化 | Haiku 4.5 (崩れていれば Sonnet 5) | 抽出のみ |
| Tier 分け・反映方針の判断 | Opus 5 (main) | 誤ると推測が確定事実として下流に laundering される |
| T1 surgical 反映 | Sonnet 5 (1 ファイル 1 体) | grep アンカーで決まる局所編集 |
| T2 (req-delta) の伝播 | Opus 5 | 8 文書横断の影響分析 + マーカー保持規律 |
| 検証 | モデル不要 | 既存 checker script が決定論で判定する |

## 関連

- `scripts/pending-answers.mjs` — 本手順が使う唯一の script (`--help` で使い方を表示)。
- `schemas/pending-questions.schema.json` — entry のデータ形状 SoT。
- `skills/_shared/preflight-gate.md` — 通常経路 (session 内即答) の手順書。本手順はその代替経路。
- `scripts/preflight-partition.mjs` — 押印済み entry がどの Phase でも ask されなくなることの
  仕組み (振り分け器)。
