---
name: 09-sample-html-gen
description: 08 で確定した 3 案の palette・typography・motion を HTML/CSS へ機械的に展開するオーケストレーター。Phase 2 の Step 09 で呼ばれ、platform 別に ayatori-sample-html-builder subagent へ生成を委譲し、構造差の機械検証と結果集計を担う。
---

# 09 サンプル画面 HTML 生成（3 案切替・プラットフォーム別オーケストレーター）

## 役割

08 で確定した 3 案 palette・typography・motion を HTML/CSS に **機械的展開** する Step 09 の **オーケストレーター**。実際の HTML 生成は platform 別に subagent (`ayatori-sample-html-builder`) に委譲し、本 skill は次の 4 つだけを担う:

1. **前提確認** (`wcag-history.json` のゲート判定)
2. **対象 platform の確定** (`design_output_scope.platform_combo` → web / mobile)
3. **subagent への dispatch** (platform 1 個 → 単一 invoke / 2 個以上 → 並列 invoke)
4. **構造記述子の再導出チェック** (生成 HTML から `scripts/lint-design-samples-structure.mjs` で 3 案構造差を機械検証 → 衝突なら bounded 再生成 → 上限で Step 10 fail-loud)
5. **結果集計と完了報告** (10 への引き渡し)

11 で既に AA 遵守検証済みなので、09 は創造的な色・フォント・モーションの決定をしない。生成後の安全網（contrast 再計算 + selector-DOM 整合）も subagent 内で完結する。

**出力形態**: P2 統一
- パス: `artifacts/{app_name}/design-samples/{platform}/index.html`
- 中身: 3 案切替 1 ファイル（CSS custom properties + JS 切替）
- 単独プラットフォーム時は 1 ディレクトリ 1 ファイル、複合時は複数ディレクトリ

**次ステップ**: `skills/10-sample-human-review/SKILL.md` を Read して 10 を実行。

## 前提条件

- 08 完了: `artifacts/{app_name}/design-brief.yaml` に 3 案確定情報（schema: `design-brief:draft:v1`、SSOT）
- 11 完了: `artifacts/{app_name}/wcag-history.json.attempts[-1].violations` の loop 対象（`pair_kind ∈ {palette, domain_surface}`）が空 **または** `len(attempts) >= pipeline.yaml.design.loop.max_attempts`（警告付きで続行）。warn-only の state_colors 違反は残存していてよい（Step 21 経路）
- subagent `.claude/agents/ayatori-sample-html-builder.md` が利用可能

---

## 実行指示

### Phase 1: 前提確認（違反があれば中断）

`artifacts/{app_name}/wcag-history.json` を Read。`pipeline.yaml.design.loop.max_attempts` を読む (既定 3)。

```
attempts        = wcag-history.json.attempts (file 不在なら空配列)
attempt_count   = len(attempts)
last_violations = attempts[-1].violations if attempts else []
loop_violations = [v for v in last_violations
                   if (v.get("pair_kind") or "palette") in ("palette", "domain_surface")]
                  # phases/design ⚙️ Loop Decision と同じ loop trigger 集合でゲート判定。
                  # warn-only の state_colors は判定に含めない (skills/21 Section 1-E で人間が再判断)
```

- **`attempt_count == 0`（wcag-history.json が不在 or attempts が空）→ 未検証。normal で進めず中断し、Step 11 を実行させる**（Step 11 が一度も走っていない = palette contrast が未検証。ここを「違反なし」と誤読して 09 を通すと未検証のまま先へ進む。`phases/design/SKILL.md` preamble の resume 分岐「`wcag_attempt_count == 0` → Step 11」と同じ扱い。前提条件「11 完了」の裏返し）
  - メッセージ: 「WCAG 検証（Step 11）が未実行です。phases/design/SKILL.md のループ制御で Step 11 を先に実行してください。」
- `attempt_count >= 1` && `loop_violations` が空 → `wcag_gate_decision = "normal"` で **通常実行** へ進む（state_colors 違反が残っていても進む — phases/design の Loop Decision と同じ扱い）
- `loop_violations` に項目あり && `attempt_count < max_attempts` → **中断して 08 に差戻す**
  - メッセージ: 「WCAG 違反が残っています。phases/design/SKILL.md のループ制御で 08 に差戻してください。」
  - ※ 通常は `phases/design/SKILL.md` が 09 を呼ぶ前にループ判定するため、このパスに入ることは稀
- `loop_violations` に項目あり && `attempt_count >= max_attempts` → `wcag_gate_decision = "warning_passthrough"` で **警告付きで続行**
  - `feedback-log.md` に Pattern C で記録（「[09] WCAG 補正ループ上限到達: loop 対象 {N} 件の違反を残したまま subagent 起動」）

このゲート決定は Phase 3 の dispatch で各 subagent に prompt 経由で伝える。

### Phase 2: 対象プラットフォーム判定

**SoT は `requirements.json.design_output_scope.platform_combo`** ただ 1 個。これは唯一の出力スコープ定義で、Step 12 / 25a も同じフィールドを読む。この enum を読んで、決定的に対象プラットフォーム配列 `platforms` を導出する:

| `platform_combo` | `platforms` | 生成ファイル数 |
|---|---|---|
| `web_only` | `["web"]` | 1 |
| `mobile_only` | `["mobile"]` | 1 |
| `mobile_and_web` | `["web", "mobile"]` | 2 |

**mobile は 1 枚に集約する**（Token 節約）。iOS と Android は装飾差（Dynamic Island / punch-hole）が主で、サンプル確認用としてファイルを分けるほどの差がないため、**mobile は iOS ベースのフレーム（390×844）1 ファイルで代表**し、Android 個別の HTML は生成しない。この platform 軸の正規化は Step 25a（`mobile_only`→`["mobile"]` / `mobile_and_web`→`["web","mobile"]`）と一致する（25a は別途 theme 軸を持つが、09 は 3 案切替 1 ファイルのため platform 軸のみ）。

> **プレビュー ≠ コード生成**: 本 step（サンプル確認 HTML）は mobile を iOS 代表 1 枚に集約するが、Step 12 build-tokens は `platform_combo` が mobile を含むとき iOS(Swift) + Compose のネイティブトークンを併出力する（Android XML は `legacy_android_xml == true` のレガシー案件のみの opt-in）。「mobile プレビューに Android が無い＝Android 非対応」ではない。

**有効な platform 値は `web` / `mobile` の 2 値のみ**。旧 `ios` / `android` の三分木、および幽霊フィールド `requirements.json.design_platforms`（どの step も生成しないため常に空振りし、自然言語フォールバックで mobile が ios+android に分裂する原因だった）への依存は撤廃した。

> **web_viewports (Web スマホ幅) は本 step の対象外**: `design_output_scope.web_viewports ∋ sm` のプロジェクトでも、デザインサンプル 3 案はテイスト選定用途のため **web は desktop (1440px) 1 枚のみ** 生成する（`design-samples/web-sm/` は作らない）。スマホ幅 (`screens/web-sm/`) は Phase 3 の画面生成系 (Step 17 以降) でのみ出力される。

**フォールバック**: `design_output_scope.platform_combo` が欠落 / 不正値のときは `pipeline.yaml.default_design_output_scope.platform_combo`（既定 `mobile_and_web`）を使う。requirements.json 自体が無い等でそれも取れないときに限り AskUserQuestion で 3 択（`web_only` / `mobile_only` / `mobile_and_web`）を確認する。

### Phase 3: subagent dispatch（platform 別 invoke）

`platforms` の長さで分岐する。subagent 名は `ayatori-sample-html-builder`、ツールは Read / Write のみ。

**illustration_policy**: `ayatori-sample-html-builder` は `design-brief.yaml.common.ui_constraints.illustration_policy` を自ら Read してアイコン描画を切り替える（`pictogram` → inline SVG、`illustration_character` → `<div class="illust-placeholder">`、`emoji_casual` → Unicode 絵文字）。オーケストレーター側での追加処理は不要。

#### 3.a 単一 platform（`platforms.length == 1`）

Agent ツールを **1 回** 起動する。

```
subagent_type: ayatori-sample-html-builder
description: "Step 09 — {platform} サンプル HTML 生成"
prompt: |
  Step 09 のオーケストレーターからの依頼です。1 platform 分のサンプル HTML を生成してください。

  ## 入力
  - app_name: {app_name}
  - platform: {platform}
  - wcag_gate_decision: {wcag_gate_decision}   # "normal" or "warning_passthrough"

  ## 指示
  1. agent 定義 (`.claude/agents/ayatori-sample-html-builder.md`) の Phase 1 〜 Phase 6 をその順で実行する。
  2. 出力は `artifacts/{app_name}/design-samples/{platform}/index.html` に書き込む。
  3. 完了 report は agent 定義の Phase 6 に従い、構造化テキスト形式で返す。
  4. **HTML 本文は返却に含めない**（orchestrator のコンテキストを保護するため）。
```

#### 3.b 複合 platform（`platforms.length >= 2`）

**1 メッセージに複数の Agent ツール呼び出しを束ねて並列起動** する。各 prompt は 3.a と同じ形式で、`platform` だけを変えて self-contained に作る。`wcag_gate_decision` はすべての agent に同じ値を渡す。

> 重要: 直列ループで 1 個ずつ呼ばないこと。`platforms` 全件を **同一メッセージ内の複数 tool call** にまとめて発火する。これが本 step の効率（時間 / 主要コンテキスト保護 / コスト）の中核。

### Phase 3.5: subagent assertion_failed ハンドリング

subagent の return に `{ "status": "assertion_failed", ... }` 形式が含まれる場合、`reason` で分岐する (ayatori-sample-html-builder の Subagent Contract / SSB-style 規約に従う):

#### 3.5.a `reason == "pending_question"`（`target` 必須）

`design-brief.yaml` の palette placeholder hex 等の未確定値検出時の return (旧 uncertainty.entries[] 経路は E2E で dead と判明し撤去):

1. **対象 entry の収集**: 全 platform 並列 subagent の return から `target` を集める。
2. **pending-questions.json への append** (main session が単一 writer、AYATORI single writer 原則 / pipeline.yaml P4-05):
   - `artifacts/{app_name}/pending-questions.json` を Read。不在なら init stub `{ "app_name": "{app_name}", "entries": [] }` をメモリ初期化。
   - 各 target について新 entry を作成:
     ```
     {
       "target": "<subagent return の target>",
       "question": "<該当 token / field を user に問う具体的質問文>",
       "header": "<max 12 chars>",
       "options": [<2-4 件、design-brief の文脈に応じた妥当な選択肢>],
       "raised_by_step": "09-sample-html-gen",
       "raised_by_role": "subagent",
       "raised_at": "<ISO 8601 now>",
       "reflect_to": "design-brief.yaml"
     }
     ```
   - **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス) は併記必須** — 本 step の未確定値は palette / typography の placeholder なので反映先は `design-brief.yaml` (`skills/_shared/preflight-gate.md` § append 経路)。
   - `entries[]` に append (target literal で dedupe、既存 unresolved と同 target なら skip)。
   - 全体を Write back (single writer = main session orchestrator)。
3. **counter 更新**: `pipeline-state.json.pending_questions_open` = `entries[] where resolved_at unset` の length で再計算。
4. **Step 09 中断**: 残り platform の subagent invoke はスキップし、ユーザーへ報告して次セッションで `/ayatori-design` を resume する形にする (resume 時の Phase preamble Pre-flight Gate で batch propose される)。
5. **feedback-log.md** に Pattern D で 1 行記録: `[09] Pattern D (Operating Principle 4 違反): subagent が status:uncertain entry {N} 件 / placeholder hex {M} 件 を検出 → pending-questions.json に append → 次セッション resume`。

#### 3.5.b `reason == "wcag_unverified"`（`target` なし）

subagent 側が wcag-history.json の不在 or attempts 空（= Step 11 未実行・未検証）を検出した時の return（agent 定義 Phase 1 前提条件 5 参照）。通常は本 skill の Phase 1 ゲート（`attempt_count == 0` → Step 11 差戻し）が先に catch するため、本分岐への到達は orchestrator がゲートを素通りした事故に対する防御的 fallback:

1. **残り platform の subagent 起動を中止** する（並列起動済みの他 platform の return は破棄してよい — 全 platform とも未検証 palette で生成されるため）。
2. **pending-questions.json には append しない**（未確定値 (D) UNCERTAIN ではなく「未検証 state」であり、user に問う対象も `target` も無い。Step 11 の実行で解消する）。
3. **feedback-log.md** に Pattern B で 1 行記録: `[09] Pattern B: Phase 1 ゲート素通りで wcag 未検証のまま subagent dispatch → subagent が wcag_unverified return → Step 11 差戻し`。
4. **Step 09 中断**: Phase 1 ゲートと同じメッセージ（「WCAG 検証（Step 11）が未実行です。phases/design/SKILL.md のループ制御で Step 11 を先に実行してください。」）でユーザーへ報告し、Step 11 差戻しとする。

上記いずれの assertion_failed も無い場合は Phase 3.6 へ進む。

### Phase 3.6: 構造記述子の再導出チェック（3 案構造差の enforcement 正本）

subagent が生成した HTML に対し、**orchestrator（main session・`Bash(node:*)` 許可済）が `scripts/lint-design-samples-structure.mjs` を実行**して、3 案 (A/B/C) の主コンテンツ一覧が「色だけ違う・構造同じ」に潰れていないかを機械検証する。subagent は Bash 不可のため self-check は予防に留まり、enforcement の正本は本 orchestrator が握る。

> **二層の関係（正確な表現）**: Step 08 は (a) brief レベルで記述子タプルの distinct を自己判定し、(b) `content_anchor`（どのクラスに錨を打つか）を本 linter に渡す。本 linter は **08 の宣言値とは突合せず**、生成 HTML の A/B/C の構造署名を**相互比較**する（判定の SoT は HTML 相互比較。08 宣言↔09 再導出の cross-check ではない）。08（brief レベル）と 09（realized HTML レベル）が**別レイヤーで独立に distinctness を検査する二段防御**であり、宣言↔実体の照合機構ではない。

> **検出原理**: linter は `content_anchor` クラスを起点に各 variant の構造プロパティ署名（検証集合の SoT は `scripts/lint-design-samples-structure.mjs` の `STRUCTURAL_PROPS` 定数 + grid の columns。display / flex-direction / flex-wrap / grid-auto-flow 等）を HTML の `<style>` から再導出し、3 案の記述子マップを全ペア exact 比較する。装飾（border / shadow / background / ::before/::after / gap / padding）は署名に含めないため、キーワード除外リスト無しで装飾ノイズが自動除外される（実データで RamenLog×2=PASS / StudyLoop=FAIL の分離を再現確認・n 小の proof-of-concept）。

#### 手順（platform ごとに実行）

1. **content_anchor の抽出**: `artifacts/{app_name}/design-brief.yaml` の各 `cases[X].layout.descriptor.content_anchor` を読み、3 案の **和集合** を comma 区切り文字列にする（例 `record-grid,record-list,record-card`）。`layout.descriptor` が無い legacy brief の場合は本チェックを **skip**（`feedback-log.md` に Pattern C で「[09] layout.descriptor 不在のため構造差チェック skip（descriptor 導入前に生成された brief）」を 1 行記録）して Phase 4 へ。
2. **linter 実行**: 各 platform の生成 HTML に対して:
   ```bash
   node scripts/lint-design-samples-structure.mjs --anchors "<和集合>" artifacts/{app_name}/design-samples/{platform}/index.html
   ```
   stdout の JSON（トップレベルに `{ all_passed, has_structure_fail, has_tooling_issue, results[] }`、各 `results[i]` に `{ verdict, pairs, collisions, descriptors }`）と exit code を読む。**分岐の正本は exit code**:
   - **exit 0（全 PASS）** → 手順3へ
   - **exit 1（`verdict: "FAIL"` = 構造退化の疑い）** → 手順4へ
   - **exit 3（`verdict: "ERROR"`（ファイル不在）or `"UNRESOLVED"`（anchor がどの variant にも無い = brief↔HTML クラス名不一致 / typo / agent のクラス改名））** → **fail-open で扱う**。構造退化ではないので bounded 再生成の「構造差不足」プロンプトには進まない。代わりに: (a) `UNRESOLVED` なら content_anchor のクラス名が HTML と一致しているか確認し、不一致なら agent に「`content_anchor` と同名のクラスで一覧を実装し直す」よう 1 回だけ再 dispatch（転記不全の是正）。(b) `ERROR` なら tooling 問題として `feedback-log.md` に Pattern C を 1 行記録して Phase 4 へ（チェックを skip）。いずれも「構造差不足の可能性」フラグ（手順5）は立てない（原因が違うため誤誘導しない）。
   - **exit 2（usage error）** → orchestrator 側の引数組み立てミス。修正して再実行。
3. **PASS のとき**: 何もせず次 platform へ。全 platform PASS なら Phase 4 へ。
4. **構造 FAIL（exit 1・衝突あり）のとき — 衝突ペアを名指しで bounded 再生成**:
   - `collisions[].pair`（例 `A-C`）を抽出し、衝突している case を特定する。
   - 該当 platform の `ayatori-sample-html-builder` を **再 dispatch** する。prompt に衝突情報を明示する: 「案 {X} と案 {Y} の主コンテンツ一覧（content_anchor: {classes}）が構造的に同一（{再導出された署名}）です。design-brief.yaml の `cases[{Y}].layout.descriptor`（`list_container` / `columns` / `item_layout`）に従って案 {Y} の一覧 DOM/CSS を**実際に別構造**へ作り直してください（border/shadow など装飾だけ変えても再 FAIL します）」。
   - 再生成後に **同じ linter を再実行**。**bounded（最大 2 回）**。
5. **上限到達（2 回再生成しても FAIL）— fail-loud**:
   - **サイレント通過させない**（fail-open 禁止）。`pipeline-state.json` に Step 10 へのフラグを立てる: `selections.step09_structure_warning = { platform, collisions, derived_descriptors, raised_at }`（init stub から merge、`app_name` 保全）。
   - subagent に「HTML 上部へ構造差不足の警告バナーを出す」よう指示する（WCAG 警告バナーと同型の `role="alert"`）。
   - `feedback-log.md` に Pattern C で記録: `[09] Pattern C: {platform} の案 {pair} が構造記述子で衝突（色だけ違う退化の疑い）→ bounded 再生成 2 回でも未解消 → Step 10 に fail-loud フラグ`。
   - **中断せず Phase 4 へ進む**（hard-block にしない）。Step 10 の人間ゲートで「構造差が不足している可能性。再生成 or このまま続行」を選ばせる。これは「粗すぎ risk」（B/C を gap/grid-areas/カード深部でのみ分ける正当なアプリが誤 FAIL）を無限ループ化させないための設計判断。

> **なぜ hard-block でなく fail-loud か**: 記述子は `{display, flex-direction, columns}` 粒度なので、構造的に十分異なるのに記述子では衝突するケース（誤 FAIL）が将来あり得る。hard-block にすると誤 FAIL が無限ループ化する。fail-loud（警告 + 人間ゲートに委ねる）なら、退化を見逃さず（サイレント通過しない）かつ誤 FAIL でも人間が続行できる。

### Phase 4: 結果集計と完了報告

各 subagent の short report を受け取った後、以下を実行する:

1. **集計表の作成**（platform × variants × used_hex × anti_slop_checklist × selector_dom_check × wcag_safetynet）。HTML 本文は集計に含めない（既に各 `index.html` に書き込まれている）。
2. **`feedback-log.md` 重複回避**: agent が既に Pattern B / C を記録しているので、orchestrator 側からは追記しない。集計のみを次の完了報告に出す。
3. **`wcag_safetynet.detected_violations` の有無確認**: いずれかの platform の subagent が安全網で violations を検出した場合、詳細は subagent report の `wcag_safetynet.violations[]`・`feedback-log.md` (Pattern B)・HTML 上の警告バナーに記録済み。**wcag-mapping.json / wcag-history.json には書かない** (wcag 系 artifact の writer は Step 11 のみ — 単一所有権)。10 の人間レビューに引き渡すために完了報告で violations を列挙して目立たせる。
4. **完了報告**:

```
{N} 案のサンプル HTML（プラットフォーム: {platforms}）を生成しました。

- {platform1}: artifacts/{app_name}/design-samples/{platform1}/index.html
  anti_slop: all OK / selector_dom: fails=0 warns=0 infos=0 / wcag_safetynet: detected=0
- {platform2}: artifacts/{app_name}/design-samples/{platform2}/index.html
  anti_slop: ... / selector_dom: ... / wcag_safetynet: ...
- ...

⚠ 安全網で違反検出: なし / {platform}{案}{criterion} 等   # 検出時のみ表示
⚠ 構造差チェック: 全 platform PASS / {platform} の案 {pair} が衝突（bounded 再生成 N 回でも未解消・Step 10 で要判断）   # FAIL fail-loud 時のみ表示

ブラウザで各 HTML を開き、A/B/C 切替ボタンで 3 案を見比べてください。
次に 10 で選択を行います。
```

→ `skills/10-sample-human-review/SKILL.md` を Read して 10 を実行。

---

## 出力サマリー

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/design-samples/{platform}/index.html` | subagent が新規作成 or 上書き（対象 platform ごとに） |
| `artifacts/{app_name}/pipeline-state.json` | Phase 3.6 で構造差チェックが上限到達した時のみ `selections.step09_structure_warning` を書く（fail-loud フラグ、owner: orchestrator） |
| `artifacts/{app_name}/feedback-log.md` | subagent が必要に応じて追記（owner: subagent）。orchestrator は Phase 3.6 で構造差 skip / fail-loud 時に Pattern C を追記 |

---

## 参照

- `.claude/agents/ayatori-sample-html-builder.md` — 1 platform 分の作業本体（Phase 1〜6 全部）
- `scripts/lint-design-samples-structure.mjs` — Phase 3.6 の構造記述子再導出チェッカ
- `docs/interface-contracts.md` §09 — 契約仕様
- `phases/design/SKILL.md` — 親 phase orchestrator（Step 08 ↔ 11 ↔ 09 ↔ 10 のループ制御）

---

## Phase 2 TODO（申し送り）

1. 複合プラットフォーム時の共通レイアウト要素の DRY 化（Header/Footer のテンプレート共有）
2. HTML 生成後の anti-slop 違反の自動修正（今は手動 08 差戻）
3. 代表画面選定ロジックの改善（Must 機能が多い場合の複数画面プレビュー）
4. subagent failure 時の retry 戦略（現在は orchestrator が単純に再 dispatch する想定 / 失敗 platform のみ部分 retry できる仕組みは未実装）
