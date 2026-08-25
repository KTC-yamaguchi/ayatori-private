---
name: 21-screen-human-review
description: Phase 3 の Step 21。Step 20 のデザインループを抜けた後、全画面 HTML と状態パターンを人間が確認・承認する関門。画面パターン網羅性の Tips と二択ゲートを提示し、承認されれば Step 22 Figma 出力へ進む。
---

# 21 人間レビュー（全画面HTML）

## 役割
20（デザイン フィードバックループ）が合格（または max_attempts 到達）で抜けた後、全画面 HTML + 4状態パターンを人間が確認・承認する。22（Figma 出力）に進む前の関門。

## 実行指示

`artifacts/{app_name}/screens/` の全HTMLと `scores.json` の最終スコアを確認した上で、**画面パターン網羅性の Tips** と **二択ゲート** を順に提示する。

> **用語注意**: 以下の Section 1 / Section 2 は本 Step 21 内部の処理段階を指す。AYATORI パイプライン全体の「Phase 1a / 1b / 2 / 3 / 4」とは別概念。

### Section 0: 成果物 preview の提示

Section 1 の Tips 提示の前に、`skills/_shared/human-gate-preview.md` を Read して artifact preview block を表示する。本 step は画面 HTML が大量 (N screens × 2 platforms × 状態数) かつ Figma 確認が主のため、auto-open はせず clickable link 一覧のみ (`pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets["21-screen-human-review"] = null`)。

組み立てる `artifacts_to_review`:

```
{repo_root} = pwd (Bash)
artifacts_root_abs = {repo_root}/artifacts/{app_name}

# screens/web/*.html / screens/web-sm/*.html / screens/mobile/*.html を全列挙 (state variant の --empty / --loading / --error / dialog も含む)
web_htmls    = ls artifacts/{app_name}/screens/web/*.html    (存在しなければ空配列)
web_sm_htmls = ls artifacts/{app_name}/screens/web-sm/*.html (存在しなければ空配列)
mobile_htmls = ls artifacts/{app_name}/screens/mobile/*.html (存在しなければ空配列)

artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/web/{f}",    label: "Web · {f}" } for f in web_htmls,
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/web-sm/{f}", label: "Web SM · {f}" } for f in web_sm_htmls,
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/mobile/{f}", label: "Mobile · {f}" } for f in mobile_htmls,
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/style-guide-view.html", label: "パーツカタログ (参考)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/color-lint-report.html", label: "色 lint レポート" },  # 存在する場合のみ
]
```

ファイル数が多い (例 20-50 件) ため、shared helper Step 4 のフォーマットで一覧表示する。auto-open は無効 (Figma 確認が主のため、複数タブ自動 open は spam になる)。

### Section 1: 画面パターン網羅性 Tips + 二択ゲート（安全網）

**参照スペック**: `docs/screen-coverage-check.md`（L1〜L4 判定基準・コンテンツ差し替え原則）

AI 機械チェック (Step 14 早期チェック + Step 19 採点) で拾えなかった抜けを人間の目で最終確認する関門。

#### Section 1-A: 二択質問

AskUserQuestion で以下を提示し、Yes/No を受領する。

```
【画面パターン網羅性 最終確認】

💡 Tips: ユーザーが順番に体験する流れを追って、テキスト差し替えだけでは成立しない画面が抜けていないか確認してください。

特にチェックすべきポイント:
- L1: 各画面の Nothing / Loading / Partial / Error / Ideal 状態（構造変化を伴うもの）
- L2: ボタン押下後のアクション結果画面（成功・失敗）
- L3: マルチステップフロー（オンボーディング・ウィザード等）の終端画面
- L4: コンテンツ差し替えだけでは成立しない画面（ボタンラベルが大きく変わる、構造が変わる 等）
- L5: 各画面の入口/出口 — どこから来て・閉じたらどこに戻るか。到達できない画面 / 戻れない画面 / リンク切れ / 未配線画面はないか

画面HTMLファイルは Section 0 で提示した preview link 一覧から開けます。
（Web 版 / モバイル版 / 状態違い --empty / --loading / --error が含まれます）

質問: 漏れている画面状態はありませんか?
- No（漏れなし）→ Section 2 の承認ゲートへ進む
- Yes（漏れあり）→ 次の質問で具体的に指摘してください
```

#### Section 1-A2: L5 connectivity（入口/出口）検出結果の提示

> **実行順序の注意**: 本節は文書上 Section 1-A の後に記載しているが、**実行時は Section 1-A の AskUserQuestion（二択）を出す『直前』に提示する**（質問の後ではない）。人間が二択に答える前に、AI 機械検出の入口/出口 defect を判断材料として見せるのが目的。

Section 1-A の AskUserQuestion（二択）を出す直前に、AI 機械検出による入口/出口 defect を提示する（人間が見落としを判断する材料）。`scores.json.current.connectivity_check.details[]`（無ければ `screens/00-coverage-check.json` の `coverage_check.layers.l5_connectivity.defects[]`）を Read し、未解消の defect があれば一覧表示する:

```
【各画面の入口/出口 検出結果（L5 connectivity）】

以下は AI が検出した「到達できない / 戻れない / リンク切れ / 未配線」の候補です:
- {screen} / {defect_kind}: {detail}  → 想定修正: {fix_hint}
  ...

- fix_hint=back_affordance の項目 → 画面 HTML に戻る導線を足せば解消（Step 17 ループ対象）
- fix_hint=mmd_edge / wire_new_screen の項目 → 遷移図 .mmd の配線が必要（Step 14 で対応）。
  承認時にこれらが残る場合、Step 14（画面一覧・遷移図）に戻って .mmd を補完するか確認します。
```

defect が 0 件なら本ブロックは「入口/出口の自動検出に問題は見つかりませんでした（目視確認は継続してください）」とだけ表示する。`mmd_edge` / `wire_new_screen`（`.mmd` 構造系）が未解消で user が修正を選んだ場合は、Section 2 の「やり直し（14）」または「修正」経路で `skills/14-screen-list-transition/SKILL.md` を Read して `.mmd` を補完してから再生成する。

#### Section 1-B: Yes 選択時のみ — 自由記述での詳細指摘

Section 1-A で **Yes** が選択された場合のみ、続けて AskUserQuestion で**自由記述（テキスト入力）**として「どの画面が漏れているか」を受領する（選択肢ではない）。

**Yes → 詳細受領後の処理**:
- 指摘された不足画面を `artifacts/{app_name}/feedback-log.md` に追記（パターンA: 人間ゲート、件名 `screen_coverage`）
- `artifacts/{app_name}/screens/00-coverage-check.json` の `coverage_check.user_indicated_gaps[]` に `{ indicated_at, description, related_layer }` を append（split ownership; schema: `schemas/coverage-check.schema.json`、本 step は `user_indicated_gaps[]` 以外には書かない）
- **`artifacts/{app_name}/screens/00-screen-list.md` の画面一覧テーブル末尾に user が指摘した不足画面を追記する**（Step 17 は `00-screen-list.md` を画面生成の SoT として読むため、ここを更新しないと追加画面が生成されない）。行フォーマットは Step 14 の出力フォーマットに準拠し、`# = 既存最大番号+1`、`備考` 列に `Step 21 user_indicated_gaps` と明記する
- `skills/17-screen-gen/SKILL.md` を Read して該当画面を追加生成 → 18 → 19 → 20 → 21 を再実行

**No の場合**: Section 2 へ進む。

#### Section 1-C: 要件外追加リストの確認

`artifacts/{app_name}/requirement-deviations.json` に未 resolved の entry がある場合、
`requirement-deviations-view.html` を案内し「**AI が合意済み要件に無いのに補完した一覧**」を提示する。
判断の受領は `docs/principle4-disambiguation.md` **§5.5 の per-item 判断プロトコル** に従う:
端末にも view と共通の `#N` 付き要約リストを提示し、N ≤ 4 は AskUserQuestion に per-item 質問
(容認 / 修正依頼 / 要件に昇格) を束ね、N ≥ 5 は「1 件ずつ」「番号指定」「全件容認 (N 件)」の受領方法を先に選ばせる。
main session が `resolved_at` / `resolution` + `resolution_mode` (§5.5.3: per-item・番号指定 = individual /
全件容認の明示選択のみ = bulk) を書き戻し、view を再生成する。**無言の全件容認への読み替えは禁止**。

> **⚠️ 一覧は floor であって ceiling ではない (バイアス対策)**: 本一覧は **spec-level component** の突合結果のみ。
> **component 内のサブ詳細（文言・軸ラベル・数値）と仕様書に無い要素は自動チェック対象外**なので、
> **一覧が空 / 少件でも本ゲートの目視確認は省略しない**（view 冒頭の盲点宣言を参照）。一覧は目視を *減らす* が *置き換えない*。
> (手順詳細は `docs/principle4-disambiguation.md` §5)

#### Section 1-D: 色 lint レポートの人間判断項目（C-25）

`artifacts/{app_name}/screens/color-lint-report.json` の `summary` を Read し（full JSON は読まない）、人間判断項目（`icons_with_variance` / `unmatched_svgs` / `promotion_queue` / `boundary_violations` / `extra_root_vars`）が 1 つでも非ゼロなら `color-lint-report.html` を案内して以下を提示する（全てゼロなら本 Section をスキップ）:

```
【色の一貫性 — 機械では正誤を決められない項目】

🎨 color-lint-report.html に以下が記録されています:
- 色が割れたアイコン {icons_with_variance} 件 — 同じアイコンが画面間で別のトークン色になっています。
  「文脈による正当な変化 (アクティブタブ・状態色)」か「親色トークンの選び間違い」かをレポートの画面リストで確認してください。
- 未照合 SVG {unmatched_svgs} 件 — アイコンにもイラスト正典にも一致しない絵。
  繰り返し使う絵なら正典化 (_shared/illustrations/)、データで形が変わるグラフィックなら容認、を判断してください。
- 装飾色の昇格候補 {promotion_queue} 件 / 境界逸脱 {boundary_violations} 件
- 台帳外の :root 色変数 {extra_root_vars} 件 — デザインシステム (root-variables.css) に無い色値つき変数が画面の :root に定義されています。
  「正当な画面固有値 (プレビュー足場の影など)」か「台帳を迂回した色の持ち込み (リテラル洗浄)」かを確認してください。
  台帳に載せるべき色なら tokens.json への登録 (Phase 2 差し戻し or Step 24) を指示してください。

質問: 統一・正典化・修正が必要な項目はありますか?
- No（全て正当 / 容認）→ Section 2 へ
- Yes → 次の質問で対象と指示を具体的に記述してください
```

**Yes → 詳細受領後の処理**: 指摘を `feedback-log.md` に追記（パターンA、件名 `color_consistency`）→ Section 1-B と同じく Step 17 ループへ（色の統一指示は「正典 / 親色トークンの修正 → 再生成」で反映。イラスト正典の修正は §11.6 準用 = 正典を直して全画面再ペースト）。

> **昇格候補（promotion_queue）の扱い**: 本 Section は**予告提示**であり、tokens.json への登録判断の正本は **Step 24 Step A-2b の AskUserQuestion ゲート**（そこで hex も確定する）。ここでは「この色は装飾として妥当か / load-bearing では？」の所感と希望 hex があれば feedback-log に残す。未解決の装飾色 var は当該 run の描画では無色（fill が効かない）のまま 22 の Figma にも乗る — 当該 run 内で色を見せたい場合は「既存 illustration palette への振替」を指示する（ループで反映可能）。新色としての実体化は 24 昇格後、**次回の生成系 run**（17 ループ / delta / 25b）が root-variables.css 同期で取り込む。

#### Section 1-E: Phase 2 warn-only state_colors violations の表示

`artifacts/{app_name}/wcag-history.json` を Read し、`attempts[-1].violations` のうち **`pair_kind == "state_colors"` かつ `candidate_id == design-brief.yaml の selected_sample_id`** の violation を数える（skill 11 は 3 案 A/B/C を毎 attempt 評価するため `violations[]` に非選択案の違反も混在する。Phase 3 は選択案のみ構築済みで非選択案の色は実画面に存在しないため、選択案の違反に絞る。file 不在 or 0 件なら本 Section をスキップ）。1 件以上あれば以下を提示する:

```
【Phase 2 から引き継いだ未解決 state_colors violations: {N} 件】

以下の state color pair は Phase 2 の WCAG 検証で AA 未達でしたが、warn-only 方針
（pairs 8-15 は banner / badge 等の限定 UI のため自動補正ループに乗せず人間判断に
委ねる — phases/design/SKILL.md ⚙️ Loop Decision）により先送りされています:

- 案{candidate_id}: {criterion_id} - {pair.fg_token} on {pair.bg_token} = {actual_ratio}（必要: {required_ratio}）
  {suggested_correction があれば 1 行で併記}

実画面 HTML で該当の banner / badge / 状態表示を確認してください。
- 視認性に問題なし（容認）→ Section 2 へ
- 修正が必要 → 次の質問で対象と指示を具体的に記述してください
```

**修正が必要 → 詳細受領後の処理**: 指摘を `feedback-log.md` に追記（パターンA、件名 `state_colors_contrast`）。state color の hex は `design-brief.yaml` → `tokens.json` 由来のため、画面側だけの修正では再発する — Section 1-D 昇格候補と同様に「tokens.json への反映（Phase 2 差し戻し or Step 24）+ Step 17 ループでの画面反映」を指示する。

> 本 Section は `phases/design/SKILL.md`「Phase 3 への引き継ぎ (B-3)」が Step 21 に義務付けていた表示の実装（従来は宣言のみで skill 側に実装が無く、warn-only が「沈黙の隠蔽」になっていた）。

### Section 2: 全画面HTML 承認ゲート

```
【全画面HTML 承認ゲート 21】

全画面のHTMLと状態パターンが生成され、画面パターン網羅性チェックも完了しました。

最終スコア: {total} / 100（attempt_count: {n}）
AI改善可能な指摘: {ai_improvable_deductions} 件
エスカレーション: {escalated}

【NFR Coverage (dual-theme × domain 拡張)】

`scores.json.current.nfr_coverage` の summary を表示し、
human_attested と unaddressed (もしあれば) のリストを必ず提示する:

- automated_verified: {n} 件 (pipeline 検証 pass)
- human_attested: {n} 件 ← **以下を目視確認してください**
  {details で status == "human_attested" の nfr_id + title + note を一覧表示}
- deferred: {n} 件 (Phase 4 以降で検証、本ゲートではスキップ)
- unaddressed: {n} 件 ({0 でなければ escalation → Phase 4 retro 対象})

画面HTMLファイルは Section 0 で提示した preview link 一覧から開けます。
（Web / Mobile × default / --empty / --loading / --error + パーツカタログを網羅）

✅「承認」または「OK」→ Steps 14-21 完了。次のセッションで Figma エクスポート（22-25）を続行します
✏️「修正: {修正内容}」→ 17 に戻って画面HTMLを修正します（feedback-log.md に記録）
❌「最初からやり直す（14）」→ 画面一覧の再設計からやり直します
```

> **トレーニング時の ✅ 行の読み替え（表示のみ）**: `{app_name}` が `_train-` で始まる場合、上記 ✅ 行は
> 「→ 完了。トレーニングの振り返りへ `/ayatori-train` で戻ります」と読み替えて表示する（Steps 22-25 はトレーニングでは行わないため）。
> 選択ロジック・AskUserQuestion の構成は変えない。詳細は「## 承認後の処理」の分岐を参照。

AskUserQuestion で選択を受け取る。

## 承認後の処理

**承認の場合:**
- `artifacts/{app_name}/pipeline-state.json` の `approvals.screens_human_approved = true` (canonical 承認フラグ) **および** `approvals.step21_approved_at = <現在 ISO 8601 時刻>` (auxiliary timestamp、step07/13/16 と命名整合) を記録 (Read or {} → merge → Write back)。`requirements.json` には書かない (INPUT 専用)。schema: `schemas/pipeline-state.schema.json` の `approvals` 参照。
- `pwd` コマンドを実行して `{repo_root}` を取得する
- **`{app_name}` が `_train-` で始まるか判定し、下記のとおり終了メッセージを分岐する**:

  <!-- 分岐の根拠: gate21 はトレーニングモードの生成パートの終了点。
       通常プロジェクトはこの先 Steps 22-25 (Figma/最終承認/デザインシステム/コンポーネント) へ続くが、
       トレーニングでは続けず「トレーニングの振り返り」へ /ayatori-train で戻るのが正。よって `_train-` のときだけ戻り導線を表示する。
       これは **表示メッセージ限定** の分岐であり、処理経路・state・生成物は一切変えない (本体無改造は維持)。
       判定基準: 表示導線は許容・処理分岐は不可 (Figma mode-detect への _train- 判定は引き続き不採用)。
       repo 内で唯一の _train- 結合のため、本コメントで self-document する。 -->

  **(a) 通常プロジェクト（`_train-` で始まらない）** — 以下のメッセージを表示してセッションを終了する（Steps 22-25 は次のセッションで自動再開される）：

  ```
  ✅ Steps 14-21 完了。画面仕様書が承認されました。

  次のセッションを開始するには、以下をコピーして新しい会話に貼り付けてください:

  /ayatori-screens をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}

  （次セッション起動時、Confluence 保存（画面仕様書）→ Figma エクスポート → 最終承認 → デザインシステム更新 → コンポーネントビルド を自動で再開します）
  ```

  **(b) トレーニング（`{app_name}` が `_train-` で始まる）** — 以下のメッセージを**逐語で（このまま）表示**してセッションを終了する：

  ```
  ✅ 画面デザインのレビューが承認されました〈承認ゲート 21〉。トレーニングの作成パートはここまでです。

  最後に「トレーニングの振り返り」に進みましょう。新しい会話を開いて、次を貼り付けてください:

  /ayatori-train
  ```

  **(b) の禁止事項（逐語表示・即興禁止）**:
  - **選択肢を提示しない**（「1: 22-25 を続ける / 2: ここで区切る」「A/B/C」等の分岐提示・おすすめ比較は一切しない）。トレーニングでは次の一手は `/ayatori-train` の **1つだけ**。「22-25 も続けられます」という可能性の言及もしない（できるが、基本やらない前提のため案内しない）。
  - **`/ayatori-screens` 続行コマンドや Figma 認証案内を出さない**（Steps 22-25 はトレーニング対象外）。
  - **`/ayatori-retro` 等の別コマンドへ誘導しない**（トレーニングの振り返りの入口は `/ayatori-train` のみ。起動すれば承認済み状態を検知して自動的に振り返りへ入る）。
  - **内部符丁を出さない**（ステップ/Step 番号・Phase 番号・セッション名・「育成モード」等。トレーニング向け文面は上記の逐語テキストだけで完結している）。

**修正の場合:**
- 修正指示を `artifacts/{app_name}/feedback-log.md` に追記（パターンA: 人間ゲート）
- **まず修正指摘が「共通部品（chrome = ボトムメニュー / ヘッダー）」に対するものか判定する（`docs/html-generation-rules.md` §11.6）**。chrome は `_shared/components.html` / `components.css` の正典から全画面へ逐語ペーストされているため、個別画面を一括置換すると正典と byte 不一致になり Step 0b-3 self-check が abort する。chrome 指摘は下記のいずれかの経路へ振り分ける:

  **(a) chrome の見た目 / 品質**（アイコンの線の太さ・ヘッダータイトルサイズ・nav の padding 等の数値調整）:
  - `00-screen-list.md`「## 共通部品定義（chrome）」の更新は不要（IA は変わらない）。
  - → `skills/17-screen-gen/SKILL.md` を Read し、**Step 0b で正典（`components.html` / `components.css`、値が token 由来なら `root-variables.css`）を直してから全画面へ再ペースト**する（個別画面は直さない）。→ 18 → 19 → 20 → 21 を再実行。

  **(b) chrome の IA**（タブ項目の入れ替え「動画」→「マップ」・アイコンの意味的変更「地図」→「ピン」・ラベル名・ヘッダー A/B 割り当ての変更）:
  - これは IA レベルの決定なので **`skills/14-screen-list-transition/SKILL.md` を Read して `00-screen-list.md`「## 共通部品定義（chrome）」を更新**する（タブモデルのアイコン名・ラベル・順序、各画面の chrome 割り当て）。
  - → `skills/17-screen-gen/SKILL.md` を Read し、**Step 0（新アイコン `map-pin` 等を一括取得）→ Step 0b（正典を再生成）→ 全画面を新正典で再ペースト**。全画面が新正典に揃うので self-check は通過する。→ 18 → 19 → 20 → 21 を再実行。
  - 備考: タブモデル変更は全 chrome 画面に影響するため「一部画面のみ」ではなく全画面再ペーストになる。これが Scenario A の「全画面再生成トリガー」＝**正典の更新**である（個別画面ループではない）。

- **chrome 以外（コンテンツ・個別コンポーネント）の修正の場合**は従来どおり: **`skills/00-feedback-protocol/SKILL.md` を Read** して 4 ステップ（影響範囲洗い出し → 1スクリプト一括修正 → grep/diff 検証 → 検証レポート）を遵守する。**このゲートが横断ドリフトの主要な発生源**：同じコンポーネントが Web/Mobile × default/empty/loading/error/dialog の複数 variant で再利用されているため、1ファイル修正で済ませてはならない。
  - **Step 1 必須**: `grep -rln "{対象クラス|hex|文言}" artifacts/{app_name}/screens/` で全対象 HTML を列挙してユーザーへ提示
  - **Step 2 必須**: 1スクリプトで CSS / HTML を**同時**に一括置換
  - **Step 3 必須**: 新値が全対象ファイルにヒット & 旧値 0 件を grep で確認
  - → 検証通過後に `skills/17-screen-gen/SKILL.md` を Read して再生成 → 18 → 19 → 20 → 21 を再実行

**やり直しの場合（14 へ戻る）:**
- `artifacts/{app_name}/screens/web/` / `screens/web-sm/` / `screens/mobile/` 配下の `*.html` を全て削除（platform 別フォルダを再帰）
- `scores.json` の attempt_count を 0 にリセット
- → `skills/14-screen-list-transition/SKILL.md` を Read して再開
