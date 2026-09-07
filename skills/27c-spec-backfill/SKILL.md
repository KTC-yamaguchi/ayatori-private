---
name: 27c-spec-backfill
description: 完走済 / reverse 基線プロジェクトの画面仕様書のうち「振る舞い詳細」/「データ項目」のいずれかを持たない旧フォーマットのものへ、既存要件文書から導出した不足セクションだけを追記する (spec-only — HTML / Figma / design system には一切触れない)。/ayatori-delta の Mode Selection 前の追記提案で「今すぐ追記する」が選ばれたときに、提案したセクション (抑制済みを除く) を対象に実行され、導出できない項目は ※不明 として直後の一括確認ゲートで人間に確認する。
---

# 27c Spec Backfill — 不足セクションの追記 (spec-only)

## Role

画面仕様書テンプレートに現行セクションが導入される前に生成されたプロジェクトでは、`screens/{slug}.md` に挙動記述やデータ項目の記述が無い。本 skill はそれらの旧フォーマット仕様書へ、**既存の要件文書から導出できる範囲で** 不足セクションを追記し、導出できない項目は `※不明 (unknown)` として直後の一括確認ゲートで人間に確認する。

**対象セクションは 2 つ** — 仕様書ごとに「どちらが無いか」は独立に判定する (片方だけ持つ仕様書がありうる):

| セクション | 内容 | 主な導出元 |
|---|---|---|
| `## 振る舞い詳細` | 操作イベント / 入力チェック / 操作制御 / 実装ノート | `04-use-cases.md` / `05-features.md` / `03-user-flow.md` / `06-non-functional.md` |
| `## データ項目` | 画面が表示・更新するデータ項目とその出どころ・共有・整形計算 (固定 7 列) | `07-data-definition.md` / `05-features.md` / `00-screen-list.md` の機能 ID 列 (forward / reverse で列名が異なる — Phase 0 の材料表参照) |

**呼び出し元との契約値 `{target_sections}`**: `phases/delta/SKILL.md` の追記提案ブロックは、検知した不足セクションから「今後この提案を出さない」で抑制済みのもの (`delta.spec_backfill_declined_sections`) を除いた集合 `detected \ declined` を提案し、本 skill にそれを `{target_sections}` として渡す。**本 skill が追記するのは `{target_sections}` に含まれるセクションだけ** — 抑制済みセクションは、その仕様書に欠けていても書かない (人間が「もう提案しなくてよい」と決めた項目を、別セクションの提案に相乗りして書き込まないため)。呼び出し元が指定しない場合 (直接起動) は両セクションを対象とする。

**書くのは `screens/{slug}.md`（と Phase 1 の回答反映先 = 下記 Phase 1 表の「反映先」列: `requirements/06-non-functional.md` / `requirements/07-data-definition.md`）のみ。** 画面 HTML・Figma・design system・遷移図は一切変更しない — 仕様書への挙動記述の追加は画面の再生成ではないため、delta の「無関係な画面に触れない」原則とは衝突しない (Step 29 の additive / data-only 分類が MD のみ更新するのと同じ性格)。

本 skill は `/ayatori-delta` の Mode Selection 前にある追記提案 (`phases/delta/SKILL.md`) で「今すぐ追記する」が選ばれたときにのみ実行される。run ではないため `delta/change-manifest.json` / `delta.runs[]` は作らない。「追記済みかどうか」の状態も別途記録しない — 仕様書内の該当セクションの有無そのものが状態であり、grep で何度でも同じ結果が得られる (冪等)。

## Preconditions

- `/ayatori-delta` の Entry guard を通過済み (completed or reverse-baseline project; SoT = CLAUDE.md § 完走後 Phase 共通 Entry Guard)
- `artifacts/{app_name}/screens/*.md` (00-* / _* 以外) のうち `## 振る舞い詳細` / `## データ項目` のいずれかを含まないものが 1 件以上ある (呼び出し元の提案ブロックが検知済み)

---

## Execution

### Phase 0: 対象の列挙と材料検査

1. **対象列挙 (セクション別)**: `00-*` / `_*` を除く仕様書を母集団とし、**セクションごとに** 不足している仕様書を列挙する (母集団の除外を命令に含める。行頭アンカーで判定 — `###` や文中引用を「記載あり」と誤認しないため):

```bash
# NOTE: 必須セクションの判定の JS 実装は scripts/pipeline-status.mjs の SPEC_REQUIRED_SECTIONS
# (build-artifact-index.mjs はそれを import)。本 bash 述語と phases/delta/SKILL.md の述語は
# その複製で、label の一致は契約テスト (pipeline-status.test.mjs) が突合する。
# 直す箇所の一覧は docs/interface-contracts.md § 破壊的変更ルール。
# -E '^##[[:space:]]*' は JS 側の /^##\s*…/ と等価 (UTF-8 ロケール前提 — 空白 0 個や全角空白の
# 揺れを拾う。LC_ALL=C では全角空白が [[:space:]] に入らず乖離しうる)
specs=$(ls artifacts/{app_name}/screens/*.md 2>/dev/null | grep -v -e '/00-[^/]*$' -e '/_[^/]*$')
# 空チェック必須 — 対象 0 件のとき printf は空行 1 つを流し、GNU xargs は引数なしで
# grep を 1 回実行してしまう (ファイル引数なしの grep は stdin を読み "(standard input)" を 1 件返す)
if [ -n "$specs" ]; then
  echo "== 振る舞い詳細 未記載 =="
  printf '%s\n' "$specs" | xargs grep -LE '^##[[:space:]]*振る舞い詳細'
  echo "== データ項目 未記載 =="
  printf '%s\n' "$specs" | xargs grep -LE '^##[[:space:]]*データ項目'
fi
```

   仕様書ごとに **不足セクション集合** (`{振る舞い詳細}` / `{データ項目}` / 両方) を持たせ、**`{target_sections}` に含まれないセクションはこの時点で集合から落とす** (抑制済みセクションは検知されても追記しない)。全仕様書の集合が空 (= 追記対象ゼロ) なら「追記対象はありません」と表示して呼び出し元 (Mode Selection) に戻る。
2. **材料検査 (不足セクション別)**: 導出元の実在を `ls` で確認する (パスは必ず `artifacts/{app_name}/` prefix つき)。**検査するのは実際に不足しているセクションの分だけ** — `データ項目` だけが不足しているプロジェクトに `04-use-cases.md` を要求しない:

   | 不足セクション | 必須材料 | 任意材料 |
   |---|---|---|
   | `振る舞い詳細` | `requirements/04-use-cases.md` / `05-features.md` / `03-user-flow.md` / `06-non-functional.md` / `screens/00-screen-list.md` | `screens/00-screen-nav.json` (画面をまたぐトリガーの via ラベル。不在なら `00-transition-map.mmd` か本文既存の「画面遷移」節で代替) |
   | `データ項目` | `requirements/07-data-definition.md` / `05-features.md` / `screens/00-screen-list.md` (機能 ID 列 = forward は `対応Must機能ID` / reverse は `対応機能ID`。実際のヘッダに合わせる) | — |

   - あるセクションの必須材料が 1 つでも欠けていれば、**そのセクションだけを対象から外し**「⚠️ {セクション名} の導出元 {不足パス} が見つからないため、このセクションは追記できません。」と表示する (材料なしで想像から書くのは禁止 — Operating Principle 4)。
   - **両方のセクションが材料不足で外された場合**は「要件文書が揃っているプロジェクトで実行してください。」を添えて **Mode Selection に戻る**。片方だけ残った場合は残った分で続行する。

### Phase 1: app 共通ポリシーの先確定 (※不明の量産防止)

全画面の行が共通参照するポリシーを先に確定させると、画面ごとの `※不明` が一括で減る。**Phase 0 で対象として残ったセクションに対応するセットのみ**を確認する (両方残ったなら 2 セット、片方なら 1 セット)。いずれのセットも「対応文書から読み取れるなら質問しない」が原則。

| セット | 対象セクション | 読み取り先 | 3 点 | 反映先 | target 文法 |
|---|---|---|---|---|---|
| 動作ポリシー | `振る舞い詳細` | `requirements/06-non-functional.md`「エラーハンドリング方針」 | 入力チェックの既定タイミング (入力中 / フォーカス離脱時 / 送信時) / 送信中の操作制御の既定 (disabled / 多重タップ防止) / エラー時の復帰方針 | `06-non-functional.md`「エラーハンドリング方針」節 | `requirements[06-non-functional].{policy-key}` |
| データの出どころ | `データ項目` | `requirements/07-data-definition.md` (エンティティ定義 / 外部連携一覧 / API I/O 定義) | 主要エンティティの保管先 (自前 DB / 外部サービス / 端末ローカル) / 既存システム・外部 API 連携の有無と方向 (読み取りのみ / 書き込みも行う) / マスタ・列挙値の出典 (コード内固定 / 管理画面で編集 / 外部マスタ参照) | `07-data-definition.md` の対応節 (無ければ文書末尾に `## データの出どころ` を新設) | `requirements[07-data-definition].{policy-key}` |

いずれも Step 02 の gap-check と同じ 3 点であり、新フォーマットで要件定義したプロジェクトには記載がある。

- **読み取れる** → そのまま Phase 2 の導出元として使う。質問しない。
- **読み取れない (旧プロジェクトの典型)** → AskUserQuestion で確認する (**最大 4 問ずつ束ねる** — 2 セットとも必要なら 2 call。選択式 + 自由記述は Other で受ける)。回答の反映:
  1. 上表の**反映先**の節に追記する (節が無い場合は当該文書の末尾に新設。既存内容は一字も変えない)。
     - **要件文書編集の規律境界**: 本 skill が要件文書に書けるのは **上表の反映先 (文書 1 つにつき 1 節) への append のみ** (既存 ID・他文書への言及の追加・削除は禁止 — ID 網に触れないため 29c の snapshot / cross-ref 検証体制は要さない。編集前退避は Write/Edit hook `backup-on-edit.sh` が自動で担う)。ポリシーを超える要件変更が必要になったらここでは書かず、`/ayatori-req-delta` (29c 経路 — snapshot + `check-req-crossrefs.mjs` 付き) へ案内する。
     - **機械 self-check (Phase 2 手順 4 と同型)**: 追記した文書ごとに追記前後の `grep "^## " {対象文書}` を突合し、見出しの減少ゼロ・増加は当該の新設節のみであることを確認する。
  2. `pending-questions.json` に born-resolved entry (`resolved_at` + `resolved_answer` 同時記載、`reflect_to` なし — `skills/_shared/preflight-gate.md` の規約) として記録する。`target` は上表の target 文法 (P4-07 の dedupe 単位)。
- **「後で決める」が選ばれたポリシー** → 要件文書には書かず、`pending-questions.json` に未解決 entry (`reflect_to: "requirements/*.md"`、`context` 併記) を **ポリシー 1 点につき 1 件だけ** append する (画面ごとに複製しない — 次回の requirement モード Pre-flight Gate が拾う)。Phase 2 では当該ポリシーに依存する行の根拠列を `※不明 (unknown) → ask: {上表の target 文法}` とする (共通 target を共有し、画面別 entry は作らない — 同じ質問が画面数ぶん増殖するのを防ぐ)。後日この entry が Pre-flight Gate で解消されたとき、仕様書側の参照行は preflight-gate (e) の「仕様書がその target を参照している場合は同時に置換する」手順が書き換える (requirements への反映だけでマーカーが残置しない)。

### Phase 2: 画面ごとの導出と追記

対象仕様書を 1 画面ずつ処理する (**main context で実行。subagent 化しない** — `pending-questions.json` への append を伴うため single writer 原則。`phases/screens/SKILL.md` Step B-0 と同じ根拠):

1. 対象の `screens/{slug}.md` と導出元 (Phase 0 の材料) を Read する。
2. その仕様書の**不足セクションだけ**を、`skills/17-screen-gen/SKILL.md` のテンプレート + 記入規則に従って導出する (書式・導出元対応・根拠リンク文法・※不明 の書き方・語彙・セクション責務境界の SoT はすべて 17 側 — 本 skill に規則を複製しない)。**足りているセクションには触れない**:
   - `振る舞い詳細` が不足 → 「振る舞い詳細の記入規則」に従い 4 サブセクション (操作イベント / 入力チェック / 操作制御 / 実装ノート) を導出する。
   - `データ項目` が不足 → 「データ項目の記入規則」に従い固定 7 列の表を導出する。既にその仕様書に `## 振る舞い詳細` がある (または本 Phase で同時に追記する) 場合、更新行の `EV-NN` はその操作イベント表に実在する行だけを参照する。**`振る舞い詳細` が材料不足で対象外になった場合 / 既存の操作イベント表が空の場合は EV 番号を発明せず**、記入規則の代替表記 (`更新 (EV 未記載, {タイミング})` + 根拠列 `※不明 (unknown) → EV 未解決`) を使う — 実在しない EV 番号は Step 19 が確定減点として扱うため。この行は `ask:` ではないので pending-questions へは append しない (件数のみ Phase 4 で報告)。
   - **reverse 産プロジェクト** (`requirements.json.status == "REVERSE_ENGINEERED"`) では `skills/reverse/06-format-convert/SKILL.md` E4 の「振る舞い詳細の記入 (reverse)」「データ項目の記入 (reverse)」の出典規律が優先する: 要件文書に根拠がある分のみ断定で書き、導出元の記述が `※ 推測 (inferred)` を持つ場合はマーカーを逐語で持ち越す。**Figma は挙動・データいずれの根拠にもしない**。`## 仕様値` を持つ仕様書では E4 の責務境界どおり「値は 仕様値 / 出どころは データ項目」に書き分ける。
   - 導出できない項目は `※不明 (unknown) → ask: screens[{slug}].{key}` を記載し、`pending-questions.json` へ append する (`context` 必須 / `reflect_to: "screens/{slug}.md"` or `"screens/*.md"` / `raised_by_step: "27c-spec-backfill"` / `raised_at`。可能なら `options[]` と `header` も — 記入規則の append 規約と同一。target 文法は記入規則の SoT どおり `screens[{slug}].{key}` — `/` 区切り・日本語画面名は hook R5b が exit 2 で block する)。
   - 操作イベントの遷移先が `00-screen-list.md` に無い画面を指す場合は記入規則どおり `※不明 (unknown) → 遷移先未解決: {宛先}` とマークする。**画面の自動追加はしない** — 件数を Phase 4 の完了報告に含め、不足画面は feature-add / requirement delta の材料として人間に委ねる。
3. **挿入位置 (セクション別のアンカー)** — 結果が常にテンプレートの節順 `状態パターン → 振る舞い詳細 → データ項目 → 画面遷移` になるように決める:

   | 追記するセクション | 挿入位置 (優先順に最初に成立するもの) |
   |---|---|
   | `## 振る舞い詳細` | ① 既存 `## データ項目` があれば **その直前** (データ項目だけ先に追記済みの仕様書 — Phase 0 で片方だけ残った run の再実行で起こる正規経路) → ② 無ければ `## 画面遷移` の直前 → ③ それも無ければ文書末尾 |
   | `## データ項目` | ① `## 振る舞い詳細` (既存 / 本 run で同時追記) の直後 → ② 無ければ `## 画面遷移` の直前 → ③ それも無ければ文書末尾 |

   両方を同時に追記する場合は `## 振る舞い詳細` → `## データ項目` の順でまとめて挿入する。

   **既存セクションは一字も変えない** (verbatim 保存 — Step 29 と同じ規律。自動バックアップは backup-on-edit.sh が担うため本 skill 側の退避は不要)。

   > **verbatim 規律の唯一の例外**: 同じ仕様書に `## 振る舞い詳細` を**新規に追記した** run では、既存 `## データ項目` の `更新 (EV 未記載, …)` 行を新しい `EV-NN` へ置換し、その行の根拠列 `※不明 … → EV 未解決` を解消してよい (他のセルは触らない)。これを許さないと、その保留を解消できる主体がどこにも無くなる。
4. 挿入前後の見出し一覧 (`grep "^## "`) を突合し、増えた見出しがその仕様書の**不足セクションの分のみ**であること (減少はゼロであること) を確認する (機械的 self-check)。
5. **`ask:` マーカーと ledger の対応 (全画面の追記が終わった直後・Phase 3 へ入る前に必ず)**: 追記した各仕様書の `→ ask: ` マーカーの target 集合を抽出し、`pending-questions.json` の `entries[].target` に全件含まれていることを確認する。**欠けていたら append を完了させるまで Phase 3 へ進まない** — ledger に無いマーカーは Phase 3 (Section 1-F 相当) の抽出にも Step 23 の残件カウンタにも載らず、Step 18 / 19 の免除だけが効いて全ゲートを無言で通過する (規約の SoT は `skills/17-screen-gen/SKILL.md` 記入規則の同 self-check)。`→ EV 未解決` と `→ 遷移先未解決:` は `ask:` ではないので対象外 (件数のみ Phase 4 の報告に出す)。

### Phase 3: 画面仕様の未確定の一括確認 (人間ゲート)

`skills/_shared/behavior-pending-confirm.md` を Read し、以下の契約値で実行する。**不足セクションが 2 つあっても提示・確認は 1 回にまとめる** (人間の往復を増やさない — 追記は Phase 2 で全画面・全セクション分を終えてから本ゲートに入る):

- `{section_label}` = 本 run で実際に追記したセクション名 (両方なら `振る舞い詳細 / データ項目`、片方ならその 1 つ)
- `{gate_label}` = `確認済 (delta 追記ゲート)`
- `{html_reflection}` = HTML は再生成しない。確定内容が既存 HTML の見た目・挙動と食い違う可能性がある項目 (例: 送信中 disabled の追加) は Phase 4 の完了報告に列挙し、「HTML へ反映する場合は screen-edit / requirement delta で」と案内する

### Phase 4: 完了報告と復帰

1. self-check — **セクション存在**: 対象全件に、追記対象としたセクションが存在することを grep で確認する (Phase 0 の述語を再実行し、`{target_sections}` のうち材料不足で外したものを除いて 0 件になること。`{target_sections}` 外の抑制済みセクションは欠けていてよい)。`ask:` マーカーと ledger の突合は Phase 2 手順 5 で Phase 3 の前に済ませている (ここで初めて行うと、欠落を見つけてもゲートは既に終わっている)。
2. `node scripts/build-artifact-index.mjs artifacts/{app_name}` で index を再生成する (人間ゲート通過地点の慣例)。
3. 完了報告を表示して **Mode Selection に戻る** (そのまま「終了」を選んで抜けてもよい):

```
✅ 不足セクションの追記完了
   追記画面: {N} 件 (振る舞い詳細 {Nb} 件 / データ項目 {Nd} 件) / 確定 (ゲート確認済): {resolved} 件 / ※不明 残: {open} 件
   {材料不足で外したセクションがあるとき} 未追記: {セクション名} ({不足材料}) — 要件文書を揃えてから再実行してください
   {遷移先未解決 > 0 のとき} 遷移先未解決: {M} 件 ({宛先一覧}) — 不足画面の候補です (追加は feature-add / requirement delta で)
   {HTML と食い違う可能性のある確定項目があるとき} HTML 未反映の確定項目: {K} 件 ({一覧}) — 反映する場合は screen-edit / requirement delta で
   ※不明 が残った項目は次回 /ayatori-delta (screen-edit モード) の Pre-flight Gate で再確認できます。
```
