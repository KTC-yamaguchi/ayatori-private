---
name: 24-design-system-update
description: Phase 3 の Step 24。承認済み style-guide-view.html を SoT として tokens.json を更新し、Figma に Variables と Component Library (Foundations + ComponentSet) を構築する。ComponentSet 化までを本 Step で完結させる。
---

# 24 デザインシステム更新

## 役割
21（全画面 HTML 承認）完了後、承認済 `style-guide-view.html` を SoT (Single Source of Truth) として、`tokens.json` を更新し、Figma に Variables + Component Library (Foundations + ComponentSet) を構築する。**ComponentSet 化までを本 step で完結させる** (25 は画面フレームの Variables バインドのみ)。

## 前提条件
- 全画面の HTML が人間承認済み（21 完了）
- `artifacts/{app_name}/screens/style-guide-view.html` が 13 で承認済
- `tokens.json` が 3 層構造で整備済み（12 で生成済み）
- `skills/00-figma-mode-detect/SKILL.md` の判定で `mode == "enabled"`（`disabled` の場合は下記「Step -1」のスタブ手順のみ実行）
- Figma 出力先が確定済み（enabled mode のみ）

## 用語集 (命名一貫性のため)

| 概念 | JavaScript ローカル変数 | figma-state.json のキー | Figma Frame 名 |
|---|---|---|---|
| Component Library Frame | `libraryFrame` | `nodes.component-library` | `{app_name} Component Library` |
| ComponentSet Variants Archive | `variantsArchive` | `nodes.variants-archive` | `ComponentSet Variants (Library Assets)` |
| 各 ComponentSet section ラッパー | `sectionFrame` | (登録不要、libraryFrame 内子要素) | `section-NN-{Name}` (例: `section-01-Button`) |
| Primitives Variable コレクション | (なし) | `nodes.variables.primitives-collection` | `{app_name}/Primitives` |
| Semantic Variable コレクション | (なし) | `nodes.variables.semantic-collection` | `{app_name}/Semantic` |
| Component Variable コレクション | (なし) | `nodes.variables.component-collection` | `{app_name}/Component` |

---

## エージェントプロンプト

このステップを実行するとき、以下のプロンプトを自分自身への指示として適用すること。

---

**あなたはデザインシステムエンジニアです。**

承認済 `style-guide-view.html` を SoT として、`tokens.json` を更新し、Figma に Variables と **Component Library セクション** (Foundations + ComponentSet) を構築します。

### Step -1: Figma mode 判定 (最初に必ず実行)

> **Mode 判定は `skills/00-figma-mode-detect/SKILL.md` で一元化されている。** 独自の env var チェックは行わず、本スキルを呼び出して結果を取得する。

Read and execute `skills/00-figma-mode-detect/SKILL.md` to resolve `mode`:
- `mode == "enabled"`: Step 0 へ進む (以降の MEO 全 Step を実行)
- `mode == "disabled"`: 下記スタブ手順のみ実行して Step 25 へ進む (**Step 0〜G は実行しない**)

#### スタブ手順 (`mode == "disabled"` の場合)

Step 22 の `skipped_stub_mode` / Step 25e のスタブ経路と同型。本 step の成果物 (Figma Variables 3 コレクション + Component Library) は Figma MCP 必須のため、disabled 環境では構築対象が存在しない。skip した旨の記録と完了タイムスタンプの書き込みだけを行う — **これを省略すると `step24_completed_at` が立たず、`phases/screens/SKILL.md` の resume 規則が Step 24 で恒久スタックして Phase 3 完了 (Step 25a 到達) が構造的に不能になる**。

1. `artifacts/{app_name}/pipeline-state.json` を Read (or init stub) し、以下を merge して Write back:
   - `screens.step24_figma_status = "skipped_stub_mode"` (skip した旨の記録、`schemas/pipeline-state.schema.json` 準拠)
   - `screens.step24_completed_at = {ISO 8601 現在時刻}`
2. `figma-state.json` は **作成・更新しない** (disabled 時はファイルが存在しないのが原則 — `schemas/figma-state.schema.json` 冒頭 description 参照。REVERSE_ENGINEERED bootstrap 等の別経路で既に存在する場合もあるが、その場合も本 step は触らない。`00-figma-mode-detect` Step 2 の audit trail は同 skill の規定どおり、ファイル不在時は skip してよい)
3. ユーザーへ表示: 「スタブモードのため Step 24 (Figma Variables + Component Library 構築) を skip しました。tokens.json / style-guide-view.html は Phase 2 の成果物のまま有効です。25 へ進みます。」
4. → `skills/25-component-build/SKILL.md` を Read して実行

> スタブ手順では下記 MEO / 完了条件 6 件 / Step G Self-Audit は **適用しない** (いずれも Figma MCP を前提とした enabled mode 専用の規律)。スタブモードでの Step 24 完了条件は「`step24_figma_status` + `step24_completed_at` の記録」のみ。

### Mandatory Execution Order (MEO) — 必ず厳守 (enabled mode 専用)

Step 24 は **Step 0 → A → B → C → D → E → F → G** を **順次・全件** 実行する。旧 skill 24 (108 行版、Step A/B/C/D のみ) の感覚で「Variables 登録 (Step B) が終わったら完了」と判断するのは禁止。Step C-D の Component Library 構築 + Step G の Self-Audit までやり切って初めて Step 24 完了。

#### 完了禁止アンチパターン (途中で「完了」と宣言してはいけない例)

- Step 0 を skip して Step A または B から始める
- Step B (Variables 登録) で「完了」と宣言する
- Step C (Foundations 構築) を実行せずに Step D へ進む
- Step D で ComponentSet をフラット構造 (旧仕様 `top.components`) に置き、`nodes.components.{atoms,molecules,organisms}` 階層に入れない
- Step E (figma-state.json 更新確認) を実行せずに Step F へ進む
- Step G (Self-Audit) を実行せずに「Step 24 完了」と宣言する
- audit.js Overall: FAIL の状態で「Step 24 完了」と宣言する

#### Step 24 完了の判定条件 (全 6 条件 true でないと完了禁止)

| # | 条件 | 担当 Step |
|---|---|---|
| 1 | `artifacts/{app_name}/build/component-spec.json` が存在 | Step 0 |
| 2 | `figma-state.json.nodes.variables.{primitives,semantic,component}-collection` 全 3 件埋まる | Step B |
| 3 | `figma-state.json.nodes.component-library.node_id` **および** `name` 両方が埋まる (schema strict: `{node_id, name}` の 2 field 必須) | Step C |
| 4 | `figma-state.json.nodes.components.atoms` に最低 1 件 (molecules/organisms は app 構成依存で 0 件可) | Step D |
| 5 | `auditResult.overall === 'PASS'` を最終取得 | Step G |
| 6 | `pipeline-state.json.screens.step24_completed_at` を ISO 8601 で記録 | Step E |

上記 6 条件のうち 1 つでも false なら **「Step 24 完了」と宣言してはならない**。

#### 途中停止時の継続ルール

セッション中断 / context 切れ / 部分失敗で途中停止した場合:

1. `artifacts/{app_name}/feedback-log.md` に **Pattern B** で「Step 24 中途停止 → 完了済 Step は N、未実行 Step は M〜G」を記録
2. 次セッションで本 skill 24 を再 Read し、未実行 Step だけを再開
3. 上記 6 条件をすべて満たすまで Step 24 を「完了」とマークしない

### 核心原則 1: Component Spec = Component Library

**HTML の `style-guide-view.html`（仕様書）と Figma の実コンポーネントを二重管理しない。**

Figma 上に「Component Library」セクションフレームを 1 つ作り、その中に：
- ドキュメント（ラベル・トークン仕様表）
- 実際のコンポーネント（ComponentSet / Component）

を**一体的に**配置する。Figma 上の Component Library が唯一の正（Single Source of Truth）になる。

### 核心原則 2: Verbatim Copy from HTML

**`style-guide-view.html` の literal な内容を、記憶や想像で再構成してはならない。**

Step 0 で `style-guide-view.html` → `build/component-spec.json` に dump し、Step D 以降はこの JSON を Read して使う。Button label / Card 内文言 / DO-DON'T 文 / Foundations sample_text 等はすべて HTML の literal を保持する。

抽出対象 (一例):
| フィールド | 出典 |
|---|---|
| `components[].variants[].label_text` | Button などの `<button>` テキストノード |
| `components[].variants[].icon_svg` | `pictogram`: `<svg>` inline 全文 / `illustration_character`: `"illust-placeholder"` sentinel（`<div class="illust-placeholder">` 検出時）/ `emoji_casual`: 絵文字文字（icon 位置の emoji 検出時。Step 24 D-2 では Text Node として Figma に反映する）/ アイコンスロット無しの variant は `null` |
| `components[].literal_content.*` | Card 内テキスト literal (title / chord_chips / bpm_text 等) |
| `expression_constraints.{do_cards,dont_cards}` | 06 表現制約セクションの DO / DON'T 文 |
| `foundations_samples.typography[].sample_text` | Typography Scale の各見出し文 |

実装機構: Step 0 dump → Step D-1 で `build/component-spec.json` を Read → Step D-2 以降は記憶を使わず JSON フィールドから直接 Figma 要素に書き込む。

---

### Step 0: `style-guide-view.html` 読込 & componentSpec dump

#### 0-1. Read 対象

```
artifacts/{app_name}/screens/style-guide-view.html
artifacts/{app_name}/tokens.json
```

#### 0-2. componentSpec[] 抽出ルール

`style-guide-view.html` を走査し、以下の構造で `componentSpec[]` を組み立てる。

- **Foundations セクション** (Section 01-04): Colors / Typography / Spacing / Touch Target / Radius の sample データを literal 保持
- **Components セクション** (Section 05): Button / Input / Badge / Card / Focus Ring / その他の ComponentSet 候補を抽出
- **Expression Constraints セクション** (Section 06): DO カード / DON'T カードを literal 保持

各 component には:
- `name` (string)
- `variants[]` (各 variant の `state` / `label_text` / `icon_svg` / `literal_content`)
- `fixed_props` (min-height / border-radius / padding 等)
- `expression_constraints` (do_cards / dont_cards) — 06 用

**`icon_svg` フィールドの抽出ルール**: 各 variant の「アイコンスロット」位置を走査し、以下の優先順位で値を決定する:

| HTML に見つかる要素 | `icon_svg` に設定する値 |
|---|---|
| `<svg ...>` インライン要素（`pictogram`） | SVG 要素の outerHTML 全文（文字列） |
| `<div class="illust-placeholder" ...>` （`illustration_character`） | `"illust-placeholder"`（固定 sentinel 文字列） |
| Unicode 絵文字文字（`emoji_casual`） | 絵文字文字そのまま（例: `"🔔"`） |
| アイコンスロット無し | `null` |

この値は Step D-2 と `audit3Icons` がそのまま sentinel として使用する。SVG 文字列を省略・短縮しない。

#### 0-3. `component-spec.json` への dump

出力先: `artifacts/{app_name}/build/component-spec.json`

スキーマ詳細は `refs/component-spec.schema.json` を参照。Step D-1 でこの JSON を Read してから使うこと。**Step 0 を省略して記憶から ComponentSet を構築するのは禁止** (核心原則 2 違反、AP-2/3/4 の原因)。

#### 0-4. Step D での運用ルール

- Step D-1 冒頭で必ず `Read('artifacts/{app_name}/build/component-spec.json')`
- Step D-2 では variants[] 全件 loop / literal_content の全 key 配置 / icon_svg の createNodeFromSvg 取り込み。`illustration_character` 時は icon_svg を Rectangle placeholder に置換し、`emoji_casual` 時は Text Node（絵文字 32px）として配置する（詳細は D-2 の illustration_policy ブロック）
- 各 ComponentSet 構築後、`audit.js` で件数・literal を機械検証 (Step G)

---

### Step A: `tokens.json` の差分検出と更新

#### A-1. 全画面 HTML から CSS 変数を抽出

`artifacts/{app_name}/screens/` 配下の `**/*.html` (web/ + mobile/ + style-guide-view.html を含む) の `:root` 内 CSS 変数を抽出する。

#### A-2. tokens.json と差分検出

- HTML にあるが tokens.json にない変数（不足トークン）
- HTML でハードコード値で書かれている色 (`#FEF2F2` 等、tokens 参照すべき値)
- tokens.json にあるが HTML で使われていない変数（不使用トークン）
- **エイリアス参照集合 diff** (周回 7 SoT 改竄対策): `tokens.json` の `$value: "{...}"` 形式エイリアス参照を集合化し、新規追加 / 削除されたエイリアス参照を抽出する。エイリアス書換 (例: `processing: {global.color.primary}` → `processing: {global.color.danger}`) はここで検出する

#### A-2b. 装飾色 昇格キューの取り込み

`artifacts/{app_name}/screens/color-lint-report.json`（Step 18 が生成する derived report）が存在する場合、その `promotion_queue[]`（= Step 17 が必要としたが未承認の装飾色 `--color-illustration-{name}`）を読み、**A-3 の差分提示リストに統合**する:

- **dedupe（必須）**: 既に `tokens.json` の `global.color.illustration-{name}` に存在する name は提示しない（report は derived で、画面 :root が未更新の間は昇格済み色も queue に載り続けるため。下記ライフサイクル参照）
- 提示内容: `name` / 使用箇所（`instances`）/ 提案 hex。**登録判断と hex 確定の正本は本ゲート（A-3 AskUserQuestion）** — Step 21 Section 1-D は予告提示であり、feedback-log に user の所感・希望 hex があれば提示に併記する
- 承認時の書き込み先: `tokens.json` の **`global.color.illustration-{name}`**（`$description` に "decorative-only (Escape Hatch)" 必須。dual_theme 案件は light/dark 両方）。semantic / component への alias は作らない（`../12-design-system/refs/generate-tokens.md` Step 3f と同じ規約）
- **境界ルール**: report の `boundary_violations[]` に載っている var（SVG 外 = 文字 / 操作要素への転用疑い）は装飾グループへ昇格**しない** — 通常パレット（Phase 2 差し戻し or palette.tokens 相当の検証付き追加）として扱う
- 本サブステップが tokens.json の **第 2 の writer（増分・gate 付き）** であることは設計どおり（writer = 12 [初回] + 24 [増分]。承認なしの自動昇格は禁止）
- report 不在（Step 18 未実行 / legacy）の場合は skip

> **昇格のライフサイクル（本 step の終端はここまで）**: A-2b/A-3 が行うのは tokens.json への登録（→ Step B で Figma Variables にも同期）まで。**画面 `:root` への実体化は次回の生成系 run**（Step 17 ループ / `/ayatori-delta` Step 29 / Step 25b）が root-variables.css 同期（skill 17 P-15 の単方向フロー）経由で行う — 本 step は画面 HTML を書かない（責務外）。したがって昇格直後の run では当該 var は画面上未解決のままで正常。

> **A-2「不使用トークン」diff の除外**: `global.color.illustration-*` は昇格直後〜次回生成 run まで HTML 側に必ず未出現のため、A-2 の「tokens.json にあるが HTML で使われていない変数」検出から **illustration-* グループを除外**する（昇格した直後の token を次回の 24 が削除候補として提示する自家撞着の防止）。

> **既知の制限（A-3 増分一般と共通）**: 本ゲートで増分追加した token は design-brief.yaml に backfill されない。Phase 2 を**まるごと再走**して 12 が brief から tokens.json を再生成すると増分は消える（illustration-* も A-3 増分一般も同じ）。再走時は A-2 diff が消失分を再検出して本ゲートに再提示するため silent loss にはならないが、恒久化したい増分は design-brief への手動反映を案内すること。

#### A-3. 人間承認ゲート (AskUserQuestion 必須)

差分がある場合、**`tokens.json` を直接更新する前に** `AskUserQuestion` で以下を提示する:

- 「差分が N 件検出されました。tokens.json に追加して進めますか / Step 13 (style-guide-view.html) に差し戻しますか / 一旦 skip して Step B に進めますか」
- 差分内容を列挙 (key 名 / 既存値 / 新規値 / 影響範囲)
- **エイリアス参照集合 diff の追加・削除リストを必ず表示** (周回 7 対策)

人間が「追加」を承認した場合のみ tokens.json を更新する:
- 第 1 層 (Primitives): 不足する実値を追加
- 第 2 層 (Semantic): 不足する意味づけを追加
- 第 3 層 (Component): 不足する部品設定を追加

「skip」または「差し戻し」が選択された場合は本 step を中断する。

#### A-4. sha256 計算と figma-state.json 記録

更新後 (またはスキップ後) の `tokens.json` の SHA-256 を計算し、`figma-state.json` の audit trail として記録する。Step G の Audit 8 で再計算して整合性を確認する。

---

### Step B: Figma Variables の登録

`tokens.json` の 3 層を Figma の 3 コレクションに登録する。

**コレクション構成:**
- `{app_name}/Primitives` — 色・サイズの生値
- `{app_name}/Semantic` — Primitives へのエイリアス
- `{app_name}/Component` — Semantic へのエイリアス

**3 段エイリアスチェーン**: Primitives は実値 (`{ value: "#1E4D9A" }`)、Semantic は `{ type: "VARIABLE_ALIAS", id: primVar.id }` で Primitives 参照、Component は同形式で Semantic 参照。Variable bind API の詳細は **`figma:figma-use` スキルの `references/api-reference.md`** (`setBoundVariableForPaint` / `setBoundVariable` / immutable clone パターン) を参照すること。

**登録対象 Variable の型マッピング**:

| tokens.json セクション | Figma Variable Type | scope | 備考 |
|---|---|---|---|
| `global.color.*` | `COLOR` | `ALL_FILLS` / `FRAME_FILL` / `STROKE_COLOR` 等 | 必須登録 |
| `global.typography.font-family-*` | `STRING` | `FONT_FAMILY` | (typography も Variables 化済み) |
| `global.typography.font-variant-numeric` | `STRING` | `FONT_STYLE` | optional |
| `global.typography.font-size-*` | `FLOAT` | `FONT_SIZE` | px 値を数値で登録 |
| `global.typography.font-weight-*` | `FLOAT` | `FONT_WEIGHT` | 400/500/600/700/800 等 |
| `global.typography.line-height-*` | `FLOAT` | `LINE_HEIGHT` | 1.25/1.5/1.75 等 |
| `global.spacing.*` | `FLOAT` | `WIDTH_HEIGHT` / `GAP` 等 | px 値を数値で |
| `global.border-radius.*` | `FLOAT` | `CORNER_RADIUS` | px 値を数値で |
| `global.shadow.*` | **登録対象外** | — | Figma の composite shadow は Variable 不可 (Effect Style で別管理)。blur のみ FLOAT 登録する場合は別途 representative として `shadow/{key}/blur` 形式で個別登録可 |
| `semantic.**.{leaf}` | (Primitives の同型) | (alias 元と同じ) | alias 経由で型継承。`feedback/error-bg` 等 |
| `component.**.{leaf}` | (Semantic の同型) | (alias 元と同じ) | alias 経由で型継承。`button/bg` 等 |

> ⚠ **A-2 対策**: 旧版は典型的に color のみ登録していたが、audit.js Audit 9 は `flattenKeys(tokensJson.global)` で typography も期待する。両者が乖離すると Audit 9 永久 FAIL → Pattern C 誤発火。本表で skill 24 §Step B の登録範囲を明示化 + audit.js Audit 9 もこの表に従って expectedKeys を計算 (typography 含む、shadow 除外)。

**Semantic Variable 命名規則**:
- `tokens.json` 側: `global.color.{error,info,warning,success}-{bg,text,border}` (state プレフィックス省略、例: `error-bg`)
- Figma Primitives Variable 側: `color/error-bg` 等 (`flattenKeys(tokensJson.global)` の出力と一致)
- Semantic Variable 側: `feedback/error-bg` 等 (collection が `{app_name}/Semantic` でスコープ済のため `semantic/` プレフィックスを **付けない**。`flattenKeys(tokensJson.semantic)` の出力と一致)
- Component Variable 側: `button/bg` 等 (同様に `component/` プレフィックスを付けない、`flattenKeys(tokensJson.component)` 出力と一致)
- Semantic は `semantic.feedback.error-bg` (tokens) を Primitives `color/error-bg` への alias として登録
- → tokens.json の Primitives レイヤーに state_colors を直接置き、Semantic は alias 経由 (重複定義禁止)

> ⚠ **注意**: Variable 名に layer prefix (`semantic/` `component/`) を **付けると audit.js Audit 9.Semantic / Audit 9.Component が永久 FAIL** する。`flattenKeys` 出力 (`feedback/error-bg`) と一致させる。

**登録ルール:**
- 全変数に適切な `scopes` を設定する（ALL_SCOPES 禁止）
- `figma.variables.getLocalVariableCollectionsAsync` で既存コレクションを確認し、存在する場合は create をスキップして更新 (Idempotency)
- 登録完了後、`figma-state.json.nodes.variables.{primitives,semantic,component}-collection` にコレクション ID を記録する

---

### Step C: Component Library フレーム + Foundations 構築

#### C-0. 再実行モード判定

Step 24 を 2 回目以降に実行する場合、`figma-state.json.nodes.component-library` を確認:

| モード | 判定条件 | 処理 |
|---|---|---|
| **(a) 初回構築** | `nodes.component-library` が未設定 | 通常通り C 以降を実行 |
| **(b) 差分同期** | Variables 値変更のみ、構造変更なし | `refs/sync-figma-tokens.md` の差分同期パスを実行 (Loop 実行時の 2 回目以降の高速パス、`structuralChange` false なら本 step で完了)。Component Library Frame は維持。詳細手順は `refs/sync-figma-tokens.md` 参照。<br>**D-5 圧縮**: 旧版は別途「Loop 実行時の差分同期」セクションがあったが C-0 (b) に統合した。 |
| **(c) 再構築** | `component-spec.json` のスキーマ変更 (新規 component / variant 追加 / icon_svg 追加 / expression_constraints 追加等) | 既存 Component Library Frame を rename して退避 (例: `[archived YYYY-MM-DD]`) → 新規構築 |

判断に迷う場合は **(c) 再構築** を選択 (安全側)。退避モード推奨 (失敗時に既存 Frame に戻せる)。

#### C-pre. 必須フォントの事前 load (テキスト崩れ防止)

Figma の `createText().characters = ...` は対応 font が load 済でないとサロゲートペアの脱落 / グリフ崩れを起こす。Step C 以降のすべての Text Node 生成より**前に**、`tokens.json.typography.font-family-*` で宣言された全フォントを `loadFontAsync` でまとめて load する。

```js
// tokens.json の global.typography から family を動的列挙
const families = Object.values(tokensJson.global.typography)
  .filter(v => v.$type === 'fontFamily')
  .flatMap(v => Array.isArray(v.$value) ? v.$value : [v.$value]);
const styles = ['Regular', 'Bold', 'SemiBold', 'Medium'];
// Japanese fallback は tokens.json に無くても UI / Card 内で必須
const required = [...families, 'Noto Sans JP'].flatMap(family =>
  styles.map(style => ({ family, style }))
);
await Promise.all(required.map(f => figma.loadFontAsync(f)));
```

**AP-9 (フォント未 load)**:
- NG: `createText().characters = '...'` を `loadFontAsync` なしで実行 → 「コAm7名を入力」のような文字混在 / グリフ欠落
- OK: 上記 mini template で全フォント preload してから Text Node 生成

詳細は `figma:figma-use` skill の `references/gotchas.md` 参照。

#### C-1. Foundations セクション (5 サブセクション必須)

`component-spec.json.foundations_samples` の literal を使って構築。**各 swatch / バー / 矩形には必ず tokenName と値ラベルの Text Node を併設すること** (audit.js Audit 11 で機械検証)。LLM が「ただ色を並べただけ」「ただバーを並べただけ」で済ませる Anti-Pattern を防ぐ。

**1. Color Swatches** — tokens.json.global.color の全 key を **3 段構成 cell** で配置:

```js
// ⚠ B3-4 対策: colorsFrame は HORIZONTAL+WRAP の代わりに **VERTICAL outer** にする (Radius と同じ workaround)。
//    HORIZONTAL+WRAP のまま title を最初の子に置くと、title が swatch と同じ列に並んでしまう。
colorsFrame.layoutMode = 'VERTICAL';
colorsFrame.itemSpacing = 12;

// ⭐ サブセクションタイトル (audit 13a 必須、Figma 上で「Colors」セクションが視認できるように)
const colorsTitle = figma.createText();
colorsTitle.name = 'foundations-colors-title';
colorsTitle.characters = '01 Colors';
colorsTitle.fontSize = 14;
colorsTitle.fontName = { family: 'IBM Plex Sans', style: 'SemiBold' };
colorsFrame.appendChild(colorsTitle); // ← VERTICAL outer の最初の子

// inner Frame: 実際の swatch 横並び (HORIZONTAL + WRAP)
const colorsItemsFrame = figma.createFrame();
colorsItemsFrame.name = 'color-items';
colorsItemsFrame.layoutMode = 'HORIZONTAL';
colorsItemsFrame.layoutWrap = 'WRAP';
colorsItemsFrame.itemSpacing = 16;
colorsItemsFrame.counterAxisSpacing = 16;
colorsItemsFrame.fills = [];
colorsFrame.appendChild(colorsItemsFrame);
colorsItemsFrame.layoutSizingHorizontal = 'FILL';
colorsItemsFrame.layoutSizingVertical = 'HUG';

// 各 swatch は Vertical Auto Layout で 3 段 (色矩形 / tokenName / hex 値) を必須配置
for (const [tokenName, def] of Object.entries(tokensJson.global.color)) {
  const cell = figma.createFrame();
  cell.name = `swatch-${tokenName}`;
  cell.layoutMode = 'VERTICAL';
  cell.primaryAxisSizingMode = 'AUTO';
  cell.counterAxisSizingMode = 'AUTO';
  cell.itemSpacing = 6;
  cell.fills = []; // 透明

  // 段 1: 色矩形 (88×88, cornerRadius 8)
  const rect = figma.createRectangle();
  rect.name = `swatch-rect-${tokenName}`;
  rect.resize(88, 88);
  rect.cornerRadius = 8;
  const varNode = primitivesVarsByName[`color/${tokenName}`];
  rect.fills = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: hexToRgb(def.$value) }, 'color', varNode
  )];
  // 明るい色 (#FFFFFF / 高 L) には 1px #D9D9D9 ボーダー
  if (isLightColor(def.$value)) {
    rect.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
    rect.strokeWeight = 1;
  }
  cell.appendChild(rect);

  // 段 2: tokenName ラベル (literal、例 'color.background')
  const nameLabel = figma.createText();
  nameLabel.name = `swatch-name-${tokenName}`;
  nameLabel.characters = `color.${tokenName}`;
  nameLabel.fontSize = 10;
  cell.appendChild(nameLabel);

  // 段 3: hex 値 (literal、例 '#12161D' または rgba alias)
  const hexLabel = figma.createText();
  hexLabel.name = `swatch-hex-${tokenName}`;
  hexLabel.characters = typeof def.$value === 'string' ? def.$value : JSON.stringify(def.$value);
  hexLabel.fontSize = 9;
  cell.appendChild(hexLabel);

  colorsItemsFrame.appendChild(cell); // ⭐ inner Frame に配置 (outer ではない)
}
```

Variables バインドで色変更が自動反映される。**`swatch-name-*` / `swatch-hex-*` Text Node が無いと audit.js Audit 11 で FAIL する**。

**2. Typography Scale** — tokens.json.global.typography.font-size-* の各サイズで `foundations_samples.typography[].sample_text` を literal で表示。**各行に `tokenName (例: font-size-xl) / sample_text` の 2 段 Text Node 配置を必須**:

```js
// ⭐ サブセクションタイトル (audit 13a 必須)
const typoTitle = figma.createText();
typoTitle.name = 'foundations-typography-title';
typoTitle.characters = '02 Typography Scale';
typoTitle.fontSize = 14;
typoTitle.fontName = { family: 'IBM Plex Sans', style: 'SemiBold' };
typoFrame.appendChild(typoTitle);

for (const sample of spec.foundations_samples.typography) {
  const row = figma.createFrame();
  row.layoutMode = 'VERTICAL';
  row.itemSpacing = 4;
  row.fills = [];

  // 段 1: メタ情報 (例 '24px / Syne Bold' or 'font-size-xl')
  const metaLabel = figma.createText();
  metaLabel.characters = `${sample.token_name} / ${sample.font_family} ${sample.font_weight}`;
  metaLabel.fontSize = 10;
  row.appendChild(metaLabel);

  // 段 2: literal sample_text (絶対に generic 化しない、AP-2)
  const sampleText = figma.createText();
  sampleText.characters = sample.sample_text;
  sampleText.fontSize = sample.font_size_px;
  sampleText.fontName = { family: sample.font_family, style: sample.font_weight >= 600 ? 'Bold' : 'Regular' };
  row.appendChild(sampleText);

  typoFrame.appendChild(row);
}
```

**3. Spacing Scale** — tokens.json.global.spacing の `xs / sm / md / lg / xl / 2xl` のみ (touch-target は別枠)。**各バーに `spacing.{key} - {value}px` ラベルを必須**:

```js
// ⭐ サブセクションタイトル (audit 13a 必須)
const spacingTitle = figma.createText();
spacingTitle.name = 'foundations-spacing-title';
spacingTitle.characters = '03 Spacing Scale';
spacingTitle.fontSize = 14;
spacingTitle.fontName = { family: 'IBM Plex Sans', style: 'SemiBold' };
spacingFrame.appendChild(spacingTitle);

const spacingKeys = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
for (const key of spacingKeys) {
  const def = tokensJson.global.spacing[key];
  if (!def) continue;
  const px = def.$value.value;

  const row = figma.createFrame();
  row.layoutMode = 'HORIZONTAL';
  row.itemSpacing = 12;
  row.counterAxisAlignItems = 'CENTER';
  row.fills = [];

  // ラベル: 'spacing.xs - 4px'
  const label = figma.createText();
  label.name = `scale-label-${key}`;
  label.characters = `spacing.${key} - ${px}px`;
  label.fontSize = 10;
  row.appendChild(label);

  // バー: 幅 = px 値、高さ = 8
  const bar = figma.createRectangle();
  bar.name = `bar-${key}`;
  bar.resize(px, 8);
  bar.fills = [{ type: 'SOLID', color: { r: 0.086, g: 0.451, b: 0.686 } }];
  row.appendChild(bar);

  spacingFrame.appendChild(row);
}
```

**4. Touch Target** (Spacing と別フレーム) — `tokens.json.global.spacing.touch-target` の 44×44 矩形 + キャプション「WCAG 2.5.8 / iOS HIG 準拠 — 44×44px minimum」を必須配置。**サブセクションタイトル必須**:

```js
// ⭐ サブセクションタイトル (audit 13a 必須)
const touchTitle = figma.createText();
touchTitle.name = 'foundations-touch-target-title';
touchTitle.characters = '03b Touch Target';
touchTitle.fontSize = 14;
touchTitle.fontName = { family: 'IBM Plex Sans', style: 'SemiBold' };
touchTargetFrame.appendChild(touchTitle);
// その後 44×44 矩形 + キャプション
```

**5. Radius Scale** — tokens.json.global.border-radius の全 key について **HORIZONTAL wrap Auto Layout で配置 (切れ防止)** + 各矩形に `radius.{key} - {value}px` ラベル:

```js
// ⭐ サブセクションタイトル (audit 13a 必須、HORIZONTAL+WRAP の前に VERTICAL 1 行で配置するため、wrapper Frame で包む)
const radiusTitle = figma.createText();
radiusTitle.name = 'foundations-radius-title';
radiusTitle.characters = '04 Border Radius';
radiusTitle.fontSize = 14;
radiusTitle.fontName = { family: 'IBM Plex Sans', style: 'SemiBold' };
// ⚠ radiusFrame 自体は HORIZONTAL+WRAP なのでタイトルが横に来てしまう。
// 対策: radiusFrame を VERTICAL に変えて、内側に title + 横並び子フレーム の 2 段構成にする
radiusFrame.layoutMode = 'VERTICAL';
radiusFrame.itemSpacing = 12;
radiusFrame.appendChild(radiusTitle);

const radiusItemsFrame = figma.createFrame();
radiusItemsFrame.name = 'radius-items';
radiusItemsFrame.layoutMode = 'HORIZONTAL';
radiusItemsFrame.layoutWrap = 'WRAP';
radiusItemsFrame.itemSpacing = 16;
radiusItemsFrame.counterAxisSpacing = 16;
radiusItemsFrame.fills = [];
radiusFrame.appendChild(radiusItemsFrame);
radiusItemsFrame.layoutSizingHorizontal = 'FILL';
radiusItemsFrame.layoutSizingVertical = 'HUG';

for (const [key, def] of Object.entries(tokensJson.global['border-radius'])) {
  const radius = def.$value.value;
  const cell = figma.createFrame();
  cell.layoutMode = 'VERTICAL';
  cell.itemSpacing = 6;
  cell.fills = [];

  // 矩形 (64×64, cornerRadius = key の値)
  const rect = figma.createRectangle();
  rect.name = `radius-rect-${key}`;
  rect.resize(64, 64);
  rect.cornerRadius = Math.min(radius, 32); // full=9999 はサンプルとして 32px で表示
  rect.fills = [{ type: 'SOLID', color: { r: 0.106, g: 0.129, b: 0.188 } }];
  rect.strokes = [{ type: 'SOLID', color: { r: 0.431, g: 0.502, b: 0.600 } }];
  rect.strokeWeight = 1;
  cell.appendChild(rect);

  // ラベル: 'radius.sm - 2px'
  const label = figma.createText();
  label.name = `radius-label-${key}`;
  label.characters = `radius.${key} - ${radius}px`;
  label.fontSize = 9;
  cell.appendChild(label);

  radiusItemsFrame.appendChild(cell); // ⭐ 内側の HORIZONTAL+WRAP フレームに配置
}
```

> ⚠ **必須**: 上記 1-5 のラベル Text Node (swatch-name-*, swatch-hex-*, scale-label-*, radius-label-*) を **省略すると audit.js Audit 11 で FAIL する**。「ただ色矩形 / バー / 矩形を並べただけで Step C 完了」とする Anti-Pattern を機械的に禁止する。

#### C-2. Component Library フレーム構造 + Auto Layout 規則

```
[Frame] {app_name} Component Library（背景: color.background、FIXED 1200px × HUG / VERTICAL）
├── [Text] タイトル "{app_name} Component Library"
│
├── [Text] "Foundations" 大タイトル
├── [Frame] Foundations / Colors     ← FILL × HUG / HORIZONTAL + WRAP
├── [Frame] Foundations / Typography ← FILL × HUG / VERTICAL
├── [Frame] Foundations / Spacing    ← FILL × HUG / VERTICAL
├── [Frame] Foundations / Touch Target ← FILL × HUG / HORIZONTAL
├── [Frame] Foundations / Radius     ← FILL × HUG / HORIZONTAL + WRAP
│
├── [Text] "Components" 大タイトル
├── [Frame] section-01-Button         ← FILL × HUG / VERTICAL (Step D-0)
│   ├── [Text] "01 Button" 番号付きサブタイトル
│   ├── [ComponentSet] Button         ← HUG × HUG (ComponentSet 自体)
│   └── [Frame] Button / Preview      ← FILL × HUG / HORIZONTAL
├── [Frame] section-02-Input          ← FILL × HUG / VERTICAL
├── [Frame] section-03-Badge          ← FILL × HUG / VERTICAL
├── [Frame] section-04-Card           ← FILL × HUG / VERTICAL
├── [Frame] section-05-Focus Ring     ← FILL × HUG / VERTICAL
├── [Frame] section-06-BottomNav      ← FILL × HUG / VERTICAL
└── [Frame] 06 Expression Constraints ← FILL × HUG / HORIZONTAL + WRAP
```

**Auto Layout 規則 (audit.js Audit 12 で機械検証)**:

| 階層 | layoutMode | layoutWrap | layoutSizingHorizontal | layoutSizingVertical |
|---|---|---|---|---|
| Library 最外 | `VERTICAL` | `NO_WRAP` | `FIXED` (1200px 推奨) | `HUG` |
| Foundations / Colors (outer) | `VERTICAL` | `NO_WRAP` | `FILL` | `HUG` |
| Foundations / Colors > color-items (inner) | `HORIZONTAL` | `WRAP` | `FILL` | `HUG` |
| Foundations / Typography | `VERTICAL` | `NO_WRAP` | `FILL` | `HUG` |
| Foundations / Spacing | `VERTICAL` | `NO_WRAP` | `FILL` | `HUG` |
| Foundations / Touch Target | `HORIZONTAL` | `NO_WRAP` | `FILL` | `HUG` |
| Foundations / Radius (outer) | `VERTICAL` | `NO_WRAP` | `FILL` | `HUG` |
| Foundations / Radius > radius-items (inner) | `HORIZONTAL` | `WRAP` | `FILL` | `HUG` |
| Components section ラッパー (`section-NN-{Name}`) | `VERTICAL` | `NO_WRAP` | `FILL` | `HUG` |
| ComponentSet 自体 (variantsArchive 内) | (Figma が決定) | — | `HUG` | `HUG` |
| ComponentSet / Preview Frame (sectionFrame 内) | `HORIZONTAL` | `NO_WRAP` | `FILL` | `HUG` |
| 個別 cell (swatch / spacing row / radius cell 等) | (C-1 参照) | — | `HUG` | `HUG` |

> ⚠ Colors / Radius の outer は **VERTICAL** にし、サブセクションタイトル ('01 Colors' / '04 Border Radius') を最初の子として置く。HORIZONTAL+WRAP の swatch / radius cells は **inner Frame** (`color-items` / `radius-items`) でラップする。Radius 実装は C-1 §5 参照、Colors も同じ workaround を適用 (B3-4 / B5-4 対策)。

**実装擬似コード (Library 最外 + Foundations 5 サブフレーム)**:

```js
// Library 最外フレーム
const libraryFrame = figma.createFrame();
libraryFrame.name = `${app_name} Component Library`;
libraryFrame.layoutMode = 'VERTICAL';
libraryFrame.itemSpacing = 32;
libraryFrame.paddingTop = 48; libraryFrame.paddingBottom = 48;
libraryFrame.paddingLeft = 48; libraryFrame.paddingRight = 48;
libraryFrame.resize(1200, 100); // 高さは HUG で再計算される
libraryFrame.fills = [/* color.background 変数バインド */];
// ⚠ appendChild 後ではなく、サイズと layoutMode 設定後にここで:
libraryFrame.layoutSizingHorizontal = 'FIXED'; // 最外のみ FIXED
libraryFrame.layoutSizingVertical = 'HUG';

// Foundations / Colors: outer VERTICAL (title + inner) / inner HORIZONTAL+WRAP (swatch wrap)
// ⚠ B3-4 / B5-4: outer を HORIZONTAL にすると title と swatch が同列に並ぶため、outer は VERTICAL に統一
const colorsFrame = figma.createFrame();
colorsFrame.name = 'Foundations / Colors';
colorsFrame.layoutMode = 'VERTICAL'; // outer
colorsFrame.itemSpacing = 12;
colorsFrame.paddingTop = 24; colorsFrame.paddingBottom = 24;
colorsFrame.paddingLeft = 24; colorsFrame.paddingRight = 24;
colorsFrame.fills = [];
libraryFrame.appendChild(colorsFrame);
colorsFrame.layoutSizingHorizontal = 'FILL';
colorsFrame.layoutSizingVertical = 'HUG';
// (C-1 §1 で title + colorsItemsFrame (inner HORIZONTAL+WRAP) を appendChild する)

// Foundations / Typography: VERTICAL
const typoFrame = figma.createFrame();
typoFrame.name = 'Foundations / Typography';
typoFrame.layoutMode = 'VERTICAL';
typoFrame.itemSpacing = 16;
typoFrame.paddingTop = 24; typoFrame.paddingBottom = 24;
typoFrame.paddingLeft = 24; typoFrame.paddingRight = 24;
typoFrame.fills = [];
libraryFrame.appendChild(typoFrame);
typoFrame.layoutSizingHorizontal = 'FILL';
typoFrame.layoutSizingVertical = 'HUG';

// Spacing / Touch Target / Radius も同パターン (layoutMode と layoutWrap だけ表通り変更)
```

> ⚠ **layoutSizingHorizontal は必ず `appendChild` の後に設定する**。`FILL` は親が auto layout のときのみ有効 で、appendChild 前に呼ぶと「親が auto layout でない」エラーになる (Figma API 制約)。

**フレーム種別ルール**:
- Component Library のコンテナは Section ではなく **通常の Frame**。背景色は `color.background` トークンを使う
- Section の背景色は Figma ファイル設定に依存するため使わない

---

### Step D: ComponentSet 構築

**illustration_policy チェック（Step D 開始時に 1 回実行）:**
`artifacts/{app_name}/design-brief.yaml` を Read し、YAML parse した結果 (`designBrief`) から `common.ui_constraints.illustration_policy` を取得して変数に代入する:
```js
// designBrief = Read('artifacts/{app_name}/design-brief.yaml') の YAML parse 結果
const illustrationPolicy = designBrief?.common?.ui_constraints?.illustration_policy ?? 'pictogram';
```
`pictogram` の場合は通常通り。`illustration_character` の場合は Step D-2 の `icon_svg` を **Rectangle placeholder（fills: 透明 / strokes: #888 破線）に置換する**。`emoji_casual` の場合は **Figma Text Node（32px、characters = `variant.icon_svg` 絵文字）として配置する**。いずれも ComponentSet 自体は作成される（SVG が存在しない場合の Figma 登録エラーを防ぐための置換であり、Component の完全削除ではない）。詳細は D-2 内の illustration_policy ブロックを参照。

#### D-0. Components 大セクションタイトル + section wrapper + ComponentSet vs Preview Frame の責務分離 (必須)

Foundations 5 セクションの直後、Component セクション群の **冒頭に "Components" 大タイトル** を必ず配置する。

**重要な責務分離 (Figma 仕様への対応)**:

Figma の `combineAsVariants` は variants を **同一座標に積み重ねる** (deck of cards 仕様)。ComponentSet 自体は Library Asset 登録のための内部構造であり、**Library Frame 内に表示すると variants が重なって 1 つだけ見える状態になる**。本来の見た目を見せるのは **Preview Frame** (Instance を横並び展示する別 Frame)。

→ 設計:
- **ComponentSet 自体は別 Frame ("ComponentSet Variants Archive")** に配置 (libraryFrame の右隣のオフキャンバス領域、Asset として残す)
- **section wrapper には Preview Frame だけ** を appendChild (番号付きサブタイトル + Preview Frame の 2 要素)

```js
// Components 大タイトル (Foundations 5 サブセクションの直後に配置)
const componentsTitle = figma.createText();
componentsTitle.name = 'components-section-title';
componentsTitle.characters = 'Components';
componentsTitle.fontSize = 20;
componentsTitle.fontName = { family: 'IBM Plex Sans', style: 'SemiBold' };
libraryFrame.appendChild(componentsTitle);

// ⭐ ComponentSet Variants Archive Frame (libraryFrame の外、Asset 保管用)
const variantsArchive = figma.createFrame();
variantsArchive.name = 'ComponentSet Variants (Library Assets)';
variantsArchive.layoutMode = 'VERTICAL';
variantsArchive.itemSpacing = 80; // variants 重なり対策で余白多め
variantsArchive.paddingTop = 48; variantsArchive.paddingBottom = 48;
variantsArchive.paddingLeft = 48; variantsArchive.paddingRight = 48;
variantsArchive.fills = [];
variantsArchive.x = libraryFrame.x + libraryFrame.width + 200; // 右隣に配置
variantsArchive.y = libraryFrame.y;
figma.currentPage.appendChild(variantsArchive);
variantsArchive.layoutSizingHorizontal = 'HUG';
variantsArchive.layoutSizingVertical = 'HUG';
// figma-state.json.nodes.variants-archive に node_id を記録 (Step E)

// 各 ComponentSet を section wrapper で包む (FILL × HUG / VERTICAL)
let counter = 1;
for (const compSpec of componentSpec.components) {
  // ── section wrapper Frame (libraryFrame の中、Preview 表示用) ──
  const sectionFrame = figma.createFrame();
  sectionFrame.name = `section-${String(counter).padStart(2, '0')}-${compSpec.name}`;
  sectionFrame.layoutMode = 'VERTICAL';
  sectionFrame.itemSpacing = 16;
  sectionFrame.paddingTop = 24; sectionFrame.paddingBottom = 24;
  sectionFrame.paddingLeft = 24; sectionFrame.paddingRight = 24;
  sectionFrame.fills = [];
  libraryFrame.appendChild(sectionFrame);
  sectionFrame.layoutSizingHorizontal = 'FILL';
  sectionFrame.layoutSizingVertical = 'HUG';

  // ── 番号付きサブタイトル ──
  const numberedTitle = figma.createText();
  numberedTitle.name = `component-subtitle-${counter}-${compSpec.name}`;
  numberedTitle.characters = `${String(counter).padStart(2, '0')} ${compSpec.name}`;
  numberedTitle.fontSize = 14;
  numberedTitle.fontName = { family: 'IBM Plex Sans', style: 'SemiBold' };
  sectionFrame.appendChild(numberedTitle);

  // ── ComponentSet 本体は variantsArchive に配置 (Step D-2 で combineAsVariants の parent を変更) ──
  // ── Preview Frame は sectionFrame に appendChild (Step D-4) ──
  //    Preview Frame は layoutSizingHorizontal = 'FILL' に設定

  counter++;
}
```

> ⚠ **責務分離 (audit.js Audit 13b/13c で機械検証)**:
> - ComponentSet (`combineAsVariants` の戻り値) は **`variantsArchive` に置く** (`libraryFrame` 内に置くと variants 重なりが見えて表示崩れ)
> - Preview Frame (Instance 横並び) は **`sectionFrame` に置く** (`libraryFrame` 直下は禁止)
> - variants 1 件の Component (Card / Focus Ring 等) は Preview Frame 不要、`sectionFrame.appendChild(componentInstance)` で 1 つ Instance を配置

#### D-1. 事前準備

1. `Read('artifacts/{app_name}/build/component-spec.json')` (Step 0 の dump)
2. `figma.variables.getLocalVariableCollectionsAsync()` で Step B 登録済の Variables を取得
3. 既存 ComponentSet との重複チェック (idempotency)

#### D-2. 各 ComponentSet 作成 (variants[] 全件 loop)

`component-spec.json.components[]` を全件 loop:

```js
for (const spec of componentSpec.components) {
  if (spec.variants.length <= 1) {
    // variants 1 件 (Card / Focus Ring 等): ComponentSet ではなく単一 Component
    const comp = figma.createComponent();
    comp.name = spec.name;
    // ... 内部構築 ...
    variantsArchive.appendChild(comp); // ⭐ archive に保管

    // section wrapper には Instance を 1 つ配置 (Preview Frame 不要)
    const instance = comp.createInstance();
    sectionFrame.appendChild(instance);
    continue;
  }

  // variants 2 件以上: ComponentSet を構築
  const variantComponents = [];
  // spec.variants[] を全件 loop (途中省略禁止、AP-1)
  for (const variant of spec.variants) {
    const comp = figma.createComponent();
    comp.name = `state=${variant.state}`;
    // label_text を literal で配置
    // icon_svg の処理 — illustration_policy に応じて分岐:
    //   pictogram: createNodeFromSvg で取り込み (AP-5)
    //   emoji_casual: 絵文字文字を Text Node として配置 (Verbatim Copy — core principle 2)
    //   illustration_character: sentinel 非 null 時のみ placeholder 矩形を作成
    //   (icon_svg == null はアイコンスロット無しを意味する — Step 0 extraction で設定)
    if (illustrationPolicy === 'pictogram' && variant.icon_svg) {
      comp.appendChild(figma.createNodeFromSvg(variant.icon_svg));
    } else if (illustrationPolicy === 'emoji_casual' && variant.icon_svg != null) {
      const t = figma.createText();
      t.name = `emoji/${variant.state}`;
      t.fontName = { family: 'Noto Sans JP', style: 'Regular' }; // must be set before .characters; Noto Sans JP is guaranteed loaded by Step C-pre
      t.characters = variant.icon_svg;
      t.fontSize = 32;
      comp.appendChild(t);
    } else if (illustrationPolicy === 'illustration_character' && variant.icon_svg != null) {
      const rect = figma.createRectangle();
      rect.name = `illust-placeholder/${variant.state}`;
      rect.resize(48, 48);
      rect.fills = [];                                                           // 透明塗り (黒塗りデフォルト上書き)
      rect.strokes = [{ type: 'SOLID', color: { r: 0.53, g: 0.53, b: 0.53 } }]; // #888 グレー枠
      rect.strokeWeight = 1;
      rect.dashPattern = [4, 4];                                                 // CSS dashed border に対応
      comp.appendChild(rect);
    }
    // literal_content (Card 等) を全 key 配置 (AP-3)
    // 子フレーム fills は空配列 (Card 白塗り対策、AP-7)
    variantComponents.push(comp);
  }
  // ⭐ ComponentSet は variantsArchive に配置 (libraryFrame / sectionFrame に置くと variants 重なりが見える)
  const cs = figma.combineAsVariants(variantComponents, variantsArchive);
  cs.name = spec.name;
  // section wrapper には ComponentSet 自体を appendChild しない (Audit 13b/13c で機械検証)
  // → Preview Frame は Step D-4 で別途作成して sectionFrame.appendChild する
}
```

**フィールド→Figma 要素マッピング** (核心原則 2):

| spec フィールド | Figma 要素 | API |
|---|---|---|
| `variant.label_text` | Text Node | `createText() + characters = literal` |
| `variant.icon_svg` | Vector (`pictogram`) / Text Node (`emoji_casual`) / Rectangle placeholder (`illustration_character`) | `pictogram`: `createNodeFromSvg(svgString)` / `emoji_casual`: `createText()` + `t.characters = icon_svg` / `illustration_character`: `createRectangle()` + fills/strokes (D-2 の illustration_policy ブロック参照) |
| `variant.literal_content.{title,chord_chips,bpm_text,key_badge}` | 子 Text/Frame | createText / createFrame |
| `variant.state` | Variant property | `comp.name = 'state=primary'` |
| `spec.fixed_props.{minHeight,borderRadius,padding}` | Auto Layout | `layoutSizingHorizontal` 等 |

**Variable bind API** (3 行ポインタ):
- Paint (fills/strokes): `setBoundVariableForPaint` + 配列 immutable clone (`figma:figma-use` `references/gotchas.md:121`)
- Simple property: `node.setBoundVariable('cornerRadius', variable)` (`figma:figma-use` `references/api-reference.md:95-165`)

**sizingMode 階層 4 行表** (AP-10):
- 最外 ComponentSet: `FIXED` + `HUG`
- 列 Frame: `FILL` + `HUG`
- Instance/Component: `HUG` + `HUG`
- Rectangle (swatch): `FIXED` + `FIXED`

##### D-2-focus. Focus Ring 仕様キャプション (audit 14 必須)

Focus Ring Component (variants 1 件、単一 Component) は **「サンプルボタン + 仕様キャプション」の 2 段構成** で作る。仕様キャプションは旧 ChordSketch (Image #9) と同じく `outline 2px solid {focus-ring-hex} — offset 2px — contrast {ratio}:1 on surface` の literal を Text Node として配置する。これが無いと WCAG 2.4.7 の仕様 (2px solid / 2px offset) が Figma 上で読み取れない。

```js
// spec.name が "Focus Ring" / "FocusRing" / "focus-ring" のいずれかなら以下を実行
if (/focus.?ring/i.test(spec.name)) {
  const fr = figma.createComponent();
  fr.name = spec.name;
  fr.layoutMode = 'VERTICAL';
  fr.itemSpacing = 8;
  fr.paddingTop = 16; fr.paddingBottom = 16;
  fr.paddingLeft = 16; fr.paddingRight = 16;
  fr.fills = [];

  // 段 1: サンプルボタン (外枠に focus-ring outline)
  const exampleBtn = figma.createFrame();
  exampleBtn.name = 'focus-example-button';
  exampleBtn.layoutMode = 'HORIZONTAL';
  exampleBtn.primaryAxisAlignItems = 'CENTER';
  exampleBtn.counterAxisAlignItems = 'CENTER';
  exampleBtn.paddingTop = 12; exampleBtn.paddingBottom = 12;
  exampleBtn.paddingLeft = 24; exampleBtn.paddingRight = 24;
  exampleBtn.cornerRadius = tokensJson.global['border-radius'].md.$value.value;
  exampleBtn.fills = []; // 透過、surface 色を継承
  // ⭐ focus-ring outline (strokes + strokeAlign 'OUTSIDE' で枠が外側に出る = offset 表現)
  const frVar = primitivesVarsByName['color/focus-ring'];
  exampleBtn.strokes = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: hexToRgb(tokensJson.global.color['focus-ring'].$value) }, 'color', frVar
  )];
  exampleBtn.strokeWeight = 2;
  exampleBtn.strokeAlign = 'OUTSIDE';
  const btnText = figma.createText();
  // hard-coded を避けて spec から参照。`cta_label` 未定義時は generic placeholder。
  btnText.characters = spec.foundations_samples?.cta_label || 'CTA Label';
  btnText.fontSize = 14;
  exampleBtn.appendChild(btnText);
  fr.appendChild(exampleBtn);

  // 段 2: 仕様キャプション (audit 14 必須)
  const caption = figma.createText();
  caption.name = 'focus-ring-spec-caption';
  const focusHex = tokensJson.global.color['focus-ring'].$value;
  // tokens.json の $description (Step 12 が実測転記済) か wcag-history.json から contrast ratio を取得 (wcag-mapping.json は ratio を持たない)
  const ratio = 'see wcag-history.json'; // 7.20:1 等、検証時に動的取得
  caption.characters = `outline 2px solid ${focusHex} — offset 2px — contrast ${ratio} on surface`;
  caption.fontSize = 10;
  fr.appendChild(caption);

  variantsArchive.appendChild(fr);
  const instance = fr.createInstance();
  sectionFrame.appendChild(instance);
  continue; // 通常の variants ループには進まない
}
```

#### D-3. Variant 抽出ルール

| Component | variant axis | 値例 |
|---|---|---|
| Button | `state` | primary / outline / ghost / danger / disabled |
| Input | `state` | default / focus / error / disabled |
| Badge | `tone` | info / success / warning / error (component-spec.json から動的決定) |
| Card | (variant なし) | 単一 Component |
| **Focus Ring** | (variant なし) | **独立 Component** (Button の variant ではない、Slack 指摘 1) |

#### D-4. ComponentSet Preview Frame

`combineAsVariants` は variants を同一座標に重ねる仕様。**Preview Frame を別途作成して Instance を横並び配置し、`sectionFrame` に appendChild する** (AP-8)。

```js
const preview = figma.createFrame();
preview.name = `${spec.name} / Preview`;
preview.layoutMode = 'HORIZONTAL';
preview.itemSpacing = 16;
preview.paddingTop = 16; preview.paddingBottom = 16;
preview.paddingLeft = 16; preview.paddingRight = 16;
preview.fills = [];

for (const variant of spec.variants) {
  const inst = cs.defaultVariant.createInstance();
  inst.setProperties({ state: variant.state });
  preview.appendChild(inst);
}

// ⭐ B3-2 対策: Preview Frame は section wrapper (sectionFrame) に appendChild する。
//    libraryFrame 直下に置くと番号付きサブタイトルとの関係が断ち切れて Audit 4 が見つけられない。
sectionFrame.appendChild(preview);
preview.layoutSizingHorizontal = 'FILL'; // sectionFrame の幅で広く配置 (FILL は appendChild の後)
preview.layoutSizingVertical = 'HUG';
```

Preview Frame の Instance 数 === variants 数 であることを Step G Audit 4 で検証する。

#### D-5. Naming Convention

| 階層 | プレフィックス | 例 |
|---|---|---|
| atoms | (なし) | `Button`, `Input`, `Badge`, `Focus Ring` |
| molecules | (なし) | `Card`, `Chord Chip` |
| organisms | (なし) | `Header`, `Bottom Tab Bar` |

`figma-state.json.nodes.components.{atoms,molecules,organisms}` に各 ComponentSet の node_id を記録する。

#### D-6. 06 表現制約 (Expression Constraints) セクション

`component-spec.json.expression_constraints.{do_cards,dont_cards}` の literal を Text Node として配置 (AP-4)。

**マッピング**:
| spec フィールド | Figma 要素 |
|---|---|
| `do_cards[i].heading` | Heading Text Node |
| `do_cards[i].items[]` | 各 item を 1 Text Node |
| `dont_cards[i].heading` | Heading Text Node |
| `dont_cards[i].items[]` | 各 item を 1 Text Node |

**案 B (推奨): `createText` 直接構築** — 日本語フォント load 済み (C-pre) なら確実に成功する。
**案 A (フォールバック): 画像 upload** — 案 B が失敗した場合のみ。フォント未対応文字がある場合。

**Text Node 数突合式**:
```
expected = 1 (title)
        + 4 (DO/DON'T 各 2 heading)
        + sum(do_cards[i].items.length)
        + sum(dont_cards[i].items.length)
```

Step G Audit 6 で検証する。

---

### Step E: `figma-state.json` + `pipeline-state.json` 更新確認

Step C-D 完了後、以下フィールドが埋まっていることを確認 (audit.js Audit 13b / 13c / MEO 完了条件 6 件と整合):

#### E-1. `figma-state.json` 必須フィールド

| フィールド | 内容 | MEO 完了条件 # |
|---|---|---|
| `nodes.variables.primitives-collection` | Primitives コレクション ID | 2 |
| `nodes.variables.semantic-collection` | Semantic コレクション ID | 2 |
| `nodes.variables.component-collection` | Component コレクション ID | 2 |
| `nodes.component-library` | Component Library Frame の `{node_id, name}` | 3 |
| `nodes.variants-archive` | ComponentSet Variants Archive Frame の `{node_id, name}` (Step D-0 で `figma.currentPage` 直下に作成) | (新規) |
| `nodes.components.atoms.*` | 各 atom Component の `{node_id, type: "COMPONENT" or "COMPONENT_SET"}` | 4 |
| `nodes.components.molecules.*` | 各 molecule | 4 |
| `nodes.components.organisms.*` | 各 organism (該当があれば) | 4 |

#### E-1b. `figma-state.json` への write back (必須、Commit 7 schema strict 化に整合)

Step C / D-0 で生成した Figma Frame の node_id + name を `figma-state.json` に明示的に書き戻す。schema (`schemas/figma-state.schema.json` の `nodes.component-library` / `nodes.variants-archive`) は object 形式のとき `{node_id, name}` 両 field 必須 (Commit 7 / PR #73 で追加された制約)。**node_id のみ書くと validation 違反**。

```js
// Step C 完了直後 (Library Frame 構築後) に main session で:
const state = JSON.parse(Read('artifacts/{app_name}/figma-state.json') || '{}');
state.nodes = state.nodes || {};
state.nodes['component-library'] = {
  node_id: libraryFrame.id,    // Figma Plugin API node id (Step C で生成)
  name:    libraryFrame.name,  // = `${app_name} Component Library`
};
// Step D-0 完了直後 (VariantsArchive Frame 構築後) に同様に:
state.nodes['variants-archive'] = {
  node_id: variantsArchive.id,
  name:    variantsArchive.name,  // = 'ComponentSet Variants (Library Assets)'
};
Write('artifacts/{app_name}/figma-state.json', JSON.stringify(state, null, 2));
```

> ⚠ variants ≤ 1 で variantsArchive を作らなかった場合は `state.nodes['variants-archive'] = null` を明示的に書く (schema は `type: ["object", "null"]` を許容するが key 不在は許容しない場合がある)。

#### E-2. `pipeline-state.json` 必須更新 (B1-5、MEO 完了条件 #6)

```js
// Step E 末尾で必ず実行する
const pipelineState = Read('artifacts/{app_name}/pipeline-state.json') || {};
pipelineState.screens = pipelineState.screens || {};
pipelineState.screens.step24_completed_at = new Date().toISOString(); // ISO 8601
Write('artifacts/{app_name}/pipeline-state.json', JSON.stringify(pipelineState, null, 2));
```

> ⚠ **MEO 完了条件 #6** を満たすには **本 step で `step24_completed_at` を必ず Write すること**。これを省略すると MEO 完了判定で false になり、Step 24 完了と宣言できない。スキーマ定義は `schemas/pipeline-state.schema.json` 参照。

#### E-3. 不在フィールドの再実行ルート

- `nodes.variables.*-collection` 不在 → Step B 再実行
- `nodes.component-library` 不在 → Step C 再実行
- `nodes.variants-archive` 不在 → Step D-0 再実行
- `nodes.components.*` 不在 → Step D-2 再実行
- `pipeline-state.json.screens.step24_completed_at` 不在 → Step E-2 のみ再実行 (本 step 末尾)

#### E-4. MEO 完了条件 6 件チェック (Step G 直前の最終確認)

> ⚠ **実行コンテキスト (A-3 修正)**: 本 E-4 は **main session で実行する**。`use_figma` sandbox 内では `Read` ツール / Node.js `fs` モジュールが利用不可なので、必ず main session で `Read` ツール経由でファイル存在チェックする。

Step G に進む前に、MEO ブロック (本 skill 冒頭) の完了判定条件 6 件を全部チェック:

```js
// 1. main session で Read を試行 (Read は不存在で null/error を返す)
const specContent       = Read('artifacts/{app_name}/build/component-spec.json'); // Step 0 出力
const figmaStateContent = Read('artifacts/{app_name}/figma-state.json');         // Step E-1
const pipelineContent   = Read('artifacts/{app_name}/pipeline-state.json');     // Step E-2

const state         = figmaStateContent ? JSON.parse(figmaStateContent) : {};
const pipelineState = pipelineContent   ? JSON.parse(pipelineContent)   : {};

// 2. 6 条件チェック
const meoCheck = {
  '1.component-spec.json':  specContent !== null && specContent.length > 0,
  '2.variables-3-collections':
    !!state.nodes?.variables?.['primitives-collection'] &&
    !!state.nodes?.variables?.['semantic-collection'] &&
    !!state.nodes?.variables?.['component-collection'],
  // schema は {node_id, name} 両 field 必須なので audit も両方を verify
  '3.component-library':
    !!state.nodes?.['component-library']?.node_id &&
    !!state.nodes?.['component-library']?.name,
  '4.components-atoms':    Object.keys(state.nodes?.components?.atoms || {}).length >= 1,
  // 5 は Step G の auditResult.overall === 'PASS' で確認
  '6.step24_completed_at': !!pipelineState.screens?.step24_completed_at,
};
// すべて true なら Step G に進む。1 件でも false なら該当 Step を再実行。
// ※ A-6 修正: 旧 '4.components-3-layers' は molecules/organisms を `>= 0` で常に true 化していたバグを修正、
//   atoms に最低 1 件あれば良い (molecules/organisms は app 構成依存で 0 件もあり得る) に統一。
```

---

### Step F: Variables 動作確認

Primitives コレクションの `color/primary` を仮の色 (例: `#FF0000`) に変更し、Semantic → Component → Component Library 内の全コンポーネントまで連鎖的に変わることを `get_screenshot` で確認する。確認後、元の値に戻す。

---

### Step G: Self-Audit (必須)

#### G-1. 実行

`skills/24-design-system-update/refs/audit.js` は `tokensJson` / `spec` / `libraryFrame` / `state` を外部スコープから参照する。`use_figma` 経由で実行する際は以下の手順で準備すること:

**Step G-1a. 入力ファイルを Read して文字列として保持**

`Read` ツールで以下 3 ファイルを取得 (`use_figma` 呼び出しの**前**):
- `artifacts/{app_name}/tokens.json`
- `artifacts/{app_name}/build/component-spec.json` (Step 0 で dump 済)
- `artifacts/{app_name}/figma-state.json`

**Step G-1b. `use_figma` の `code` 冒頭で `JSON.parse(template literal)` 形式で復元 + `variantsArchive` 取得**

```js
// ⚠ インライン JS オブジェクトリテラルでハイフン含みキー (例: "focus-ring") を
// 未クォートで書くと SyntaxError になる。必ず JSON.parse(JSON 文字列) 形式で復元する。
const tokensJson = JSON.parse(`{ /* tokens.json 全文をここに埋め込む */ }`);
const spec       = JSON.parse(`{ /* build/component-spec.json 全文 */ }`);
const state      = JSON.parse(`{ /* figma-state.json 全文 */ }`);

// JSON 文字列内の backtick (`) と backslash (\) は template literal 用に escape:
//   ` → \`        \ → \\
// 通常 tokens.json / component-spec.json には backtick は含まれず、backslash は icon_svg (SVG path) 等で出現する。

// libraryFrame は state から取得 (legacy 形式 type guard 付き、B3-5)
await figma.setCurrentPageAsync(
  figma.root.children.find(p => p.id === state.page_id) || figma.root.children[0]
);
const clRaw = state.nodes['component-library'];
const clNodeId = typeof clRaw === 'string' ? clRaw : clRaw?.node_id;
const libraryFrame = clNodeId ? await figma.getNodeByIdAsync(clNodeId) : null;
if (!libraryFrame) return { error: 'libraryFrame not found' };

// ⭐ variantsArchive は libraryFrame の外、currentPage 直下 (Step D-0 で作成済)
// audit.js Audit 2/3/4/5 が両 scope を走査するために必要 (B1-1)
const vaRaw = state.nodes['variants-archive'];
const vaNodeId = typeof vaRaw === 'string' ? vaRaw : vaRaw?.node_id;
const variantsArchive = vaNodeId ? await figma.getNodeByIdAsync(vaNodeId) : null;
// variantsArchive は null 許容 (variants 1 件以下の app では未作成のこともある)
```

**Step G-1c. `refs/audit.js` の中身を続けてコピペ + `runAudit()` 呼び出し**

> ⚠ **コピペ順序 (A-4 対策)**: audit.js の関数群は `libraryFrame` / `variantsArchive` / `tokensJson` / `spec` / `state` を **外部スコープから closure 参照** する。**必ず以下の順序で 1 つの `use_figma` `code` ブロック内に並べる**:
>
> 1. **先に** G-1b の全 const 宣言 (`tokensJson`, `spec`, `state`, `libraryFrame`, `variantsArchive`) を完了
> 2. **次に** `refs/audit.js` の `function auditEq(...)` から最終行 (`async function runAudit() { ... }`) までを丸ごとコピペ (関数定義時点では const は参照されないが、closure に bind される)
> 3. **最後に** `const auditResult = await runAudit(); return auditResult;` を呼ぶ
>
> この順序を守らないと `audit.js` が `ReferenceError: libraryFrame is not defined` で落ちる。

```js
// G-1b で宣言した const がすでに scope にある前提

// refs/audit.js 全文をここに貼る (auditEq から runAudit() まで)
function auditEq(name, expected, actual, note) { /* ... */ }
function auditSubset(name, expectedKeys, actualKeys, note) { /* ... */ }
// ... (中略、refs/audit.js の全関数定義) ...
async function runAudit() { /* ... */ }

// 最後に呼び出し
const auditResult = await runAudit();
return auditResult; // { overall, audits, failed, pattern_c, state } を返す
```

**Step G-1d. 結果確認 + state 永続化 (必須、指摘 🔴3 対策)**

```js
// 1. auditResult を受け取る
const auditResult = await useFigma(...); // ↑ G-1c の return

// 2. state 永続化: audit.js は state.audit.retry / state.audit.pattern_c を in-memory 更新するが、
//    呼び出し元 (main session) で figma-state.json に Write back する責務がある (指摘 🔴3)。
//    省略すると次回失敗時に retry カウントが 0 から始まり Pattern C 判定が永久に発火しない。
Write('artifacts/{app_name}/figma-state.json', JSON.stringify(auditResult.state, null, 2));

// 3. 分岐
if (auditResult.overall === 'PASS') {
  // Step G 完了、Step 25 へ進む
} else if (auditResult.pattern_c !== null && auditResult.pattern_c.length > 0) {
  // Pattern C エスカレート (3 回再実行しても PASS しない、設計問題)
  // G-3 に従い feedback-log.md に Pattern C 記録 + Step G 中断
} else {
  // 通常 FAIL: G-2 (retry 表) に従い該当 Step を再実行 → Step G を再実行
}
```

#### G-2. FAIL 時 retry 表

> ⚠ **注**: 表のキーは `audit.name` と完全一致させてある (例: `'1.sections'`, `'11a.color-labels'`)。`state.audit.retry[auditName]` の値と grep 可能になり、feedback-log.md に Pattern C 記録するときの紐付けが容易になる。

| audit.name | 失敗時に再実行する Step |
|---|---|
| `1.sections` / `1a.colors` / `1b.typography` / `1c.spacing` / `1d.radius` | Step C の該当サブセクションのみ |
| `2.{name}` | Step D-2 の該当 spec のみ |
| `3.icons` | `pictogram`: Step D-2 (SVG 再取り込み、createNodeFromSvg) / `illustration_character`: Step D-2 (placeholder 矩形 再配置) / `emoji_casual`: Step D-2 (emoji Text Node 再配置) |
| `4.{name}.preview` | Step D-4 の該当 ComponentSet |
| `5.card.literal` | Step D-2 の Card spec (literal_content 再配置) |
| `6.expression` | Step D-6 案 B 再実行 (失敗時のみ案 A) |
| `7.white-fill` | Step D-2 の Card 子フレーム fills=[] 再設定 |
| `8.alias` | Step A 再実行 (AskUserQuestion で revert 判断) |
| `9.{Primitives,Semantic,Component}` | Step B 再実行 (差分のみ create/update) |
| `10.sizingMode` | Step D の該当 Frame (sizingMode 階層 4 行表参照) |
| `11a.color-labels` | Step C-1 §1 Color Swatches 再実行 (`swatch-name-*` / `swatch-hex-*` Text Node) |
| `11b.spacing-labels` | Step C-1 §3 Spacing Scale 再実行 (`scale-label-*` Text Node) |
| `11c.radius-labels` | Step C-1 §5 Radius Scale 再実行 (`radius-label-*` Text Node) |
| `11d.components-title` | Step D-0 "Components" 大タイトル Text Node 追加 |
| `11e.numbered-subtitles` | Step D-0 番号付きサブタイトル `component-subtitle-*` Text Node 追加 |
| `12a.foundations-fill` | Step C-2 各 Foundations サブフレームの `layoutSizingHorizontal='FILL', Vertical='HUG'` 設定 |
| `12b.section-fill` | Step D-0 section wrapper の同設定 |
| `12c.library-fixed` | Step C-2 Library 最外を `FIXED 1200px + HUG` 設定 |
| `12d.library-width` | Step C-2 Library width を 800px 以上 (推奨 1200px) |
| `13a.foundations-titles` | Step C-1 各 Foundations サブフレーム先頭に `foundations-{section}-title` Text Node |
| `13b.no-cs-in-library` | Step D-2 で `combineAsVariants(variantComponents, variantsArchive)` に変更 |
| `13c.no-cs-in-section` | Step D-2 で ComponentSet を sectionFrame に置かず variantsArchive へ |
| `14.focus-ring-caption` | Step D-2-focus で `focus-ring-spec-caption` Text Node を Focus Ring に追加 |

#### G-3. 再実行上限と Pattern C エスカレート

- 同一 Audit を **3 回再実行しても PASS しない場合** は Pattern C として `artifacts/{app_name}/feedback-log.md` に記録し、Step G を中断
- audit.js は `state.audit.retry[auditName]` を更新し、3 回到達時に `state.audit.pattern_c` を set + `runAudit()` の戻り値 `auditResult.pattern_c` で報告する (指摘 🔴2 対策)
- main session は `auditResult.pattern_c !== null` を確認したら `figma-state.json` に state を Write back (上記 G-1d) + `feedback-log.md` に Pattern C 記録 + Step G 中断

#### G-4. アンチパターン ↔ Audit カバレッジマップ (B4-2)

MEO ブロック (本 skill 冒頭) の「完了禁止アンチパターン 7 件」と audit.js 14 audit のカバレッジ:

| AP | Audit | 検出方式 |
|---|---|---|
| Step 0 を skip して Step A/B から始める | (pre-check) | audit.js 起動前に `build/component-spec.json` 存在チェック (MEO 完了条件 #1)。Audit では検出不可、Step A/B 実行前のゲートで人間が確認 |
| Step B (Variables 登録) で「完了」と宣言 | Audit 9 (Variables key 集合) / 12c (Library FIXED) | Variables 数だけ揃って Library Frame が無い場合に 12c で FAIL |
| Step C を実行せずに Step D へ進む | Audit 1 / 11a-c / 12a / 13a (Foundations) | Foundations セクション 5 件 + ラベル + sizingMode + タイトル を多角検証 |
| Step D で ComponentSet をフラット構造に置く | Audit 2 / 11e / 13b / 13c | variants 数 + 番号付きサブタイトル + libraryFrame 内 CS 不在 + section wrapper 内 CS 不在 |
| Step E を実行せずに Step F へ進む | (pre-check) | Step E-4 の MEO 完了条件チェックで `step24_completed_at` 不在を検出 |
| Step G を実行せずに「完了」宣言 | (人間ゲート) | MEO 完了条件 #5 (`auditResult.overall === 'PASS'`) を満たさないと完了不可。skill 24 自身が宣言ロジックで判定 |
| audit FAIL のまま「完了」宣言 | (人間ゲート) | 同上。`auditResult.pattern_c !== null` の場合は G-3 で Pattern C エスカレート |

**カバレッジ評価**:
- ✅ AP 4 件 (Step B/C/D/G スキップ) は audit.js で機械検出可能
- ⚠ AP 3 件 (Step 0/E スキップ、audit FAIL 完了宣言) は人間ゲート / pre-check に依存。skill 24 のフロー制御で守る

#### G-5. skill 25 へ渡す contract

Step G PASS 後、skill 25 に渡される figma-state.json の保証:
- `nodes.variables.*-collection` が全 3 種埋まっている
- `nodes.component-library` が埋まっている
- `nodes.variants-archive` が埋まっている (variants 2 件以上の component がある場合)
- `nodes.components.{atoms,molecules,organisms}` が埋まっている (ComponentSet / Component を figma-state に記録済)

これらが揃っていない場合 skill 25 は実行できない (前提条件違反)。

---

## 完了後

「デザインシステムを更新し、Variables + Component Library (Foundations + ComponentSet) を構築しました。Step G Self-Audit Overall: PASS を確認済み。25 (Variables バインド・動作確認) へ進みます。」
→ `skills/25-component-build/SKILL.md` を Read して実行

(スタブモード時は Step -1 のスタブ手順内で skip 記録・完了メッセージ・Step 25 への遷移まで完結するため、本セクションは enabled mode 専用。)
