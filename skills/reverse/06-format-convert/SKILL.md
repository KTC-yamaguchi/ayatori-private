---
name: 06-format-convert
description: リバース成果物を AYATORI forward パイプラインが期待するファイル形式 (requirements.json / requirements/*.md / screens/*.md / tokens.json) へ変換する。Phase 0b の Step 06 で Step 03 (または Step 04) の後に実行され、既存アプリ → リバース → KMP/Flutter 再構築の移行ワークフローを繋ぐ。
---

# Step 06: AYATORI Format Conversion (Migration Bridge)

## Purpose

Convert reverse-engineered outputs into the file formats the AYATORI forward pipeline expects.
This step turns `/ayatori-reverse` output into valid input for `/ayatori-design` and `/ayatori-screens`,
enabling the migration workflow: **existing app → reverse → rebuild in KMP/Flutter**.

## When to Run

Always run after Step 03 (requirements generation).
Step 04 (comparison) は文書アーカイブが無ければ skip されるが、**Step 05 (reverse review gate) は必ず通す** — 順序は Step 03 → (Step 04) → Step 05 → Step 06。Step 05 を経ずに本 step を実行すると、推測が確定事実として requirements.json に焼き込まれる。

## Inputs

- `artifacts/{app_name}/reverse-engineered/raw-analysis.md`
- `artifacts/{app_name}/reverse-engineered/01-overview.md` through `08-constraints.md`

## Outputs

| File | Used by | Notes |
|------|---------|-------|
| `artifacts/{app_name}/requirements.json` | All phases | 純粋な要件記述 (INPUT)。state は pipeline-state.json 側 |
| `artifacts/{app_name}/requirements/01-08.md` | Phase 1b display | Copy from reverse-engineered/ |
| `artifacts/{app_name}/screens/00-screen-list.md` | Phase 3 | 機能カテゴリ別グルーピング table |
| `artifacts/{app_name}/screens/{slug}.md` | Phase 3 | One file per screen |
| `artifacts/{app_name}/tokens.json` | Phase 2 | Color/typography base or stub |
| `artifacts/{app_name}/screens/00-transition-map.mmd` | Phase 3 / Phase 5 | 画面遷移図 SSoT。`requirements/03-user-flow.md` から決定論変換 (E6) |
| `artifacts/{app_name}/screens/00-screen-nav.json` | Phase 3 | 各画面の入口/出口 派生ビュー (`.mmd` から導出) |
| `artifacts/{app_name}/screens/00-coverage-check.json` | Phase 3 | L5 connectivity の defects を記録 (L1〜L4 は Phase 3 が埋める) |

---

## Process

### E1: Generate requirements.json

`artifacts/{app_name}/requirements.json` を以下の schema (`schemas/requirements.schema.json` 準拠) で生成する。**state 系 field (page_id / approvals / selections 等) は本ファイルに含めない** — 下流 skill (Step 06/07/10/13/15/16/21/23) が必要に応じて `pipeline-state.json` に lazy 初期化する。

```json
{
  "app_name": "{app_name}",
  "created_at": "{today}",
  "status": "REVERSE_ENGINEERED",
  "confluence_parent_id": null,
  "design_output_scope": {
    "platform_combo": "{derived from raw-analysis.md platform detection, or pipeline.yaml default_design_output_scope.platform_combo}",
    "screen_coverage": "all_features",
    "state_pattern": "required_4_states",
    "mobile_framework": "{derived: native | flutter | kmp; OMIT this key when platform_combo == web_only}",
    "legacy_android_xml": false,
    "illustration_policy": "{derived from raw-analysis.md B-06 section; see note below}"
  },
  "reverse_provenance": {
    "ledger": "reverse-engineered/reverse-provenance.json",
    "gate_resolved": true,
    "inferred_accepted_count": "{count of specs the Step 05 gate marked 容認 (still inferred), from requirement-deviations.json phase=reverse resolution=容認}",
    "primary_source": "{source-inventory.json の roles.primary: code | figma | docs}",
    "sources_used": ["{実際に読んだソース種類: code / docs / figma}"],
    "note": "残存 inferred は requirements/*.md の ※推測 マーク参照"
  }
}
```

**Notes on field values:**
- `status`: `"REVERSE_ENGINEERED"` — Phase 1b はこのセンチネルを見て scoring loop をスキップする
- `confluence_parent_id`: reverse 時は通常 `null`。後続 06-confluence-save-req 実行時にユーザーに確認する (生成系 page_id は `pipeline-state.json.confluence.requirements.page_id` に書かれる)
- `design_output_scope.platform_combo`: `raw-analysis.md` で検出されたプラットフォームから導出 (例: "KMP/Android+iOS" → `mobile_only`、"Next.js" / 汎用 web → `web_only`、"KMP + web" → `mobile_and_web`)。不明なら `pipeline.yaml.default_design_output_scope.platform_combo` にフォールバック
- `design_output_scope.mobile_framework`: `platform_combo` が mobile を含むときのみ必須。"KMP" / "Kotlin Multiplatform" / "Compose Multiplatform" → `kmp`、"Flutter" / `.dart` → `flutter`、"Swift + Kotlin/Compose native" または別レポ二本立て → `native`。`web_only` のときはキー自体を省略する (null は書かない)
- `design_output_scope.legacy_android_xml`: `platform_combo` が mobile を含むときのみ書く。**JSON boolean リテラル** (`true` / `false`) で書くこと — schema は `"type": "boolean"` のため引用符付き文字列 `"false"` は型違反。値は Read `reverse-engineered/raw-analysis.md` の `### B-07 Android UI Framework` セクションの機械可読キー `android_ui_framework_detected:` **のみ** から導出する (B-06 → `illustration_policy` と同じ「キーだけ読む」構造。View システムの強シグナル定義・判定はソースを一次参照する Step 02 Check B-07 の責務であり、本 step で `input-sources/` を再解析・自由推論しない): `view_system` → `true`、`compose` / `not_applicable` (Android ソース無し) → `false`、`not_detected` (Android ソースはあるが判別不能) / キー不在 / B-07 セクション不在 → **無言で false を書かない** — `false` を仮置きした上で `pending-questions.json` に entry を append し (target: `design_output_scope.legacy_android_xml` / **`reflect_to: "requirements.json"`** — 反映先 artifact の併記は必須。`skills/_shared/preflight-gate.md` § append 経路)、Phase 入口の Pre-flight Gate で batch propose する (Operating Principle 4)。リバース案件は「既存アプリが XML ベース」という opt-in 該当ケースの代表なので、欠落 (= false 扱い) に頼らず明示的に導出して書く。`web_only` のときはキー自体を省略する (null は書かない)
- `design_output_scope.illustration_policy`: Read `reverse-engineered/raw-analysis.md` の `### B-06 Illustration Style` セクションを確認する。セクション内の `illustration_policy_detected:` キーの値を使う (例: `illustration_policy_detected: emoji_casual` → `"emoji_casual"`)。キーが `not_detected` / 不在 / B-06 セクション自体が `"not detected"` の場合は `"pictogram"` を safe default として書く。このキーは **必ず書く** — 省略禁止。
- `reverse_provenance.primary_source` / `sources_used`: `reverse-engineered/source-inventory.json` の roles / sources から転記する。`primary_source == "figma"` = 縮退モード run (コード裏取りなし) — 下流が根拠の強さを一目で判断するためのサマリ。
- **縮退モード (primary_source == "figma") の design_output_scope**: `platform_combo` / `mobile_framework` はコード検出不能。figma frame サイズ・docs 記述から確定できない場合は既存の不明時規則どおり default fallback + `pending-questions.json` append (`reflect_to: "requirements.json"` 併記) で処理する (無言で確定値を書かない)。`legacy_android_xml` は B-07 が `not_applicable` (Android ソース無し) を返すため `false` になる。
- `reverse_provenance`: **必ず書く** (laundering 封じ)。per-item の provenance 本体は `reverse-engineered/reverse-provenance.json` (Step 03 が writer) に保持されるが、その台帳は下流の forward pipeline (design/screens) が通常読まないため、requirements.json に **pointer + ゲート結果サマリ** を残して「この要件は推測由来の仕様を含む」ことを伝搬する。`gate_resolved` は Step 05 で flag 推測がすべて resolve 済なら `true`。`inferred_accepted_count` は `requirement-deviations.json` の `phase=reverse` かつ `resolution=容認` の件数。**`gate_resolved` が false (= Step 05 未完了 / 推測未解決) のまま E1 を実行してはならない** — Step 05 ゲートに戻ること。
- **書かない field**: `source` / `source_type` / `source_documents` (per-item provenance は `reverse-engineered/reverse-provenance.json` に保持し、requirements.json には上記 `reverse_provenance` pointer で繋ぐ)、`confluence_project_page_id` / `selected_sample_*` / `design_confluence_*` / `screens_human_approved` / `final_approved` (state は `pipeline-state.json` 側に lazy 初期化される)、`readiness` / `provisional_flags` / `recommendations_accepted` (reverse 経路では未収集のため省略)

### E2: Copy requirements docs

Copy `reverse-engineered/01-08.md` → `requirements/01-08.md` so Phase 1b's Confluence save step can find them:

```
artifacts/{app_name}/reverse-engineered/01-overview.md  →  artifacts/{app_name}/requirements/01-overview.md
...
artifacts/{app_name}/reverse-engineered/08-constraints.md  →  artifacts/{app_name}/requirements/08-constraints.md
```

⚠️ **`※ 推測 (inferred)` / `※ 不明 (unknown)` マーカーを除去しない** (laundering 封じ)。
Step 05 ゲートで『容認 (推測のまま)』とされた仕様には `※ 推測` が残っている。コピーは **逐語** で行い、
マーカーを sanitize / 言い換え / 削除してはならない。これが下流 (design/screens) が推測を確定事実と
誤認しないための主防御線 (requirements.json の `reverse_provenance` pointer は補助、本文マーカーが正)。

**縮退モード (primary_source == "figma") のヘッダー注記**: コピーした各 `requirements/NN-*.md` の
frontmatter 直後に 1 行の provenance 注記を付ける:

> ※ 本書は Figma デザインを一次根拠にしたリバース生成 (ソースコード不在)。挙動・条件分岐の仕様は
> コード裏取りがされていない。

(通常 run では付けない。文言は機能的事実のみ — 下流の読者が根拠の弱さを本文レベルで認識するための注記。)

**E2-2: 未解決 entry の `reflect_to` を移行する** (コピー完了後に 1 度だけ):

`pending-questions.json` を Read し、**`resolved_at` が未 set の entry のうち `reflect_to` が
`reverse-engineered/` 配下を指しているもの**を、対応するコピー先へ書き換えて Write back する
(例: `reverse-engineered/05-features.md` → `requirements/05-features.md`。ファイル単位の対応が付かない
場合は `requirements/*.md`)。resolved 済み entry は台帳の履歴なので**触らない**。

理由: Step 02 / 03 / 05 が append した entry の反映先は当時の正本 (`reverse-engineered/*.md`) だが、本 step 以降の
正本は `requirements/*.md` に移る。移行しないと、その entry を受け付ける門が **本 phase だけ**になり
(下流の screens-lite / req-delta / delta は `reverse-engineered/*.md` を受け付けない)、Phase 0b を出た後は
どの門でも ask されず永久に持ち越される。受け付け可能な値の一覧と「自分より後に通る門が受け手であること」の
規約は `skills/_shared/preflight-gate.md` § append 経路 を参照。

**移行漏れの検知** (E6 完了後・Step 06 の完了報告に含める): `pending-questions.json` を再度 Read し、
**`resolved_at` 未 set かつ `reflect_to` が `reverse-engineered/` を指す entry が残っていないか**を確認する。
残っていれば E2-2 が実行されなかった (= 中断からの resume で本 step の前半を飛ばした) ことになるので、
その場で移行してから件数を報告する。本 phase の `target_artifacts` は 3 つの和集合を常に渡す宣言なので
本 phase 内では ask 可能だが、**Phase 0b を出ると受け手を失う**ため Step 06 の出口で閉じる。

### E3: Generate screens/00-screen-list.md

Read `reverse-engineered/raw-analysis.md` (Screen List — `実装状態` column is the authoritative filter), `reverse-engineered/03-user-flow.md`, and `reverse-engineered/05-features.md`.
Include only screens where `実装状態 == 実装済み`. Screens with `実装状態 == Coming Soon` are excluded from this file — they remain in `raw-analysis.md` only.
Extract all identified implemented screens and format as the Phase 3 screen list:

```markdown
# 画面一覧

**生成日**: {today} | **対象アプリ**: {app_name}
**生成元**: ソースコード解析（リバースエンジニアリング）

---

## {機能カテゴリ名 — アプリのドメインから導出。例: 認証・初期設定}

| # | 画面ID | 画面名 | 遷移図ノードID | 目的 | 対応機能ID | 備考 |
|---|---|---|---|---|---|---|
| Step 01 | SCR-001 | ... | HOME | ... | F-XXX | ... |

## {機能カテゴリ名 — 例: 充電スポット管理}
...

## 状態パターン

| 画面 | 状態フレーム |
|---|---|
| SCR-XXX | default / error / loading / empty |
```

**Category assignment rules:**
- 機能カテゴリ名は `05-features.md` の `###` 見出し（Step 03 で導出済み）を正とする
- 画面→カテゴリのマッピング手順: `raw-analysis.md` の Feature List の `Feature` 列（機能名）を `05-features.md` の `機能名` 列と照合し、その機能が属する `###` セクション名をカテゴリとして使用する（機能ID は Step 03 が初めて付番するため `raw-analysis.md` には存在しない）
- `raw-analysis.md` の `実装状態 == 実装済み` の画面のみをいずれかのカテゴリに配置する（Must/Should/Could の優先度は付けない）
- `実装状態 == Coming Soon` の画面は **このファイルに含めない** — `raw-analysis.md` に記録済みのため重複不要。`00-screen-list.md` は Phase 3 の HTML 生成ソースであり、記載した全画面が Step 17 で生成対象になる
- カテゴリ数・名称はアプリのドメインに応じて可変（固定ではない）

**画面名の語彙**: 画面名は `reverse-engineered/03-user-flow.md` のフロー図ノード名と **語彙を揃える**
（同一画面を指すのに別の言い回しを発明しない）。E6 の遷移図変換がこの画面名とノードラベルを機械突合するため、
語彙が離れると実在する画面が非画面ノードに落ちる。Step 03 側の対応規約は
`skills/reverse/03-requirements-gen/SKILL.md`「`03-user-flow.md` の mermaid ノードラベル規約」を参照。

**`遷移図ノードID` 列**: 語彙揃えに **加えて** ID で機械紐付けする — 語彙が揃わなくても ID があれば突合できる
（突合器は ID の完全一致を第一候補、ラベル正規化一致を fallback にする: `scripts/derive-screen-nav.mjs`
`matchScreens` Pass 0）。値は当該画面が `reverse-engineered/03-user-flow.md` の mermaid ノードに対応する場合
その **ノード ID**（例 `HOME` / `GUIDE`）。**対応するノードが無い画面は空欄にする — ID を発明しない**。
本 step は user-flow と同一コンテキストで画面一覧を書くため、対応関係は生成時に自明であり推測を挟まない
（後から突合器が名前の近さで推測すると誤マッチを持ち込むため、宣言をここで済ませる）。
同じ ID を複数行に書くと初出行のみが採用され、2 行目以降は警告 (`duplicate_node_id`) 付きでラベル一致に委ねられる。
**本列は reverse E3 専用の任意列** — forward の Step 14 が生成する画面一覧には付けない
（列が無ければ突合は従来どおりラベル一致のみで動く）。

### E4: Generate screens/{slug}.md for each screen

For each screen listed in `artifacts/{app_name}/screens/00-screen-list.md` (all screens in that file are implemented — unimplemented screens are excluded by E3), generate a spec file at `artifacts/{app_name}/screens/{screen-slug}.md`:

```markdown
# {Screen Name} 画面仕様

**画面ID**: SCR-XXX | **機能**: F-XXX {feature_name} | **カテゴリ**: {機能カテゴリ名}

## 目的
{derived from user flow / use case analysis}

## レイアウト構成
- ナビゲーション: {tab bar | drawer | none}
- ヘッダー: {description}
- メインコンテンツ: {description}
- CTA: {primary action button}
- フッター: {description or none}

## コンポーネント一覧

| コンポーネント | トークン参照 | WCAG要件 |
|---|---|---|
| {component} | color.primary | 2.5.8 ✅ |

## 仕様値（requirements/05-features.md より）

{key business rules, validation rules, constraints for this screen}

## 状態パターン

- `{slug}.html` — デフォルト
- `{slug}--error.html` — エラー状態
- `{slug}--loading.html` — ローディング状態
- `{slug}--empty.html` — 空状態（該当する場合）

## 画面遷移

- {action} → SCR-XXX {target screen name}
```

**Token references**: use placeholder names (`color.primary`, `color.surface`, etc.) — actual values come from tokens.json in Phase 2.

**Provenance markers**: if a 仕様値 copied into a screen spec carries `※ 推測 (inferred)` in `requirements/05-features.md`, keep the marker on that value here too. Do not present an inferred spec as confirmed at the screen level.

### E5: Generate tokens.json base

Inspect raw-analysis.md for extracted color/typography data (from source code theme files, CSS variables, AppColors.kt, etc.).

**縮退モード (コード不在) の追加ソース**: `ground-truth/figma/{file_key}/variables.json` (Step 01 の capture
アーカイブ) が存在すれば、そこから color / typography 値を抽出して下記「color data was found」の形式で書く
(`$description` の出典は `Extracted from Figma variables: ground-truth/figma/{file_key}/variables.json:{line}` —
当該トークンキーの行を併記する。この参照形式は `figma_backed` の正当な source_ref 文法と同一)。
**live Figma MCP を本 step から呼ばない** — アーカイブに variables が無ければ通常どおり stub に degrade する。

**If color data was found:**
Generate a `tokens.json` using the W3C DTCG format with extracted values, marking each as requiring WCAG verification:

```json
{
  "global": {
    "color": {
      "primary": {
        "$value": "{extracted hex}",
        "$type": "color",
        "$description": "Extracted from source: {file path}. ※ WCAG verification required at Step 12."
      }
    }
  }
}
```

Required token keys to populate (use best-guess from source if found, otherwise inherit from AYATORI defaults):
`primary`, `on-primary`, `background`, `surface`, `surface-variant`, `on-surface`, `on-surface-variant`, `on-surface-subtle`, `border`, `focus-ring`, `error`, `on-error`

**根拠が無いキーを `pending-questions.json` に回す場合の反映先宣言**: 根拠が無いまま慣例値で埋めるのは
Operating Principle 4 Rule 2 違反なので、`"$value": "TBD"` + `※ 不明 (unknown)` で残して
`pending-questions.json` に append することがある (縮退モードでは `focus-ring` のように Figma に
静止状態しか写らず原理的に埋まらないキーが出る)。その entry には **`reflect_to: "tokens.json"` を必ず併記する**
— 反映先を書かないと `tokens.json` を書けない phase の入口 Gate が答えを消費してしまい、確定値が
`tokens.json` に届かないまま resolved になる (E2E 実測。`skills/_shared/preflight-gate.md` § append 経路)。

Typography tokens: `font-size-xs` through `font-size-4xl`, `font-weight-regular/medium/semibold/bold`, `line-height-tight/normal/relaxed`

**If no color data was found:**
Write a stub `tokens.json` with `"$value": "TBD"` for all keys and `"$description": "Awaiting Phase 2 design direction."`.

This stub still satisfies the schema check in Phase 2 — `/ayatori-design` will replace it.

### E6: Generate screens/00-transition-map.mmd (画面遷移図 SSoT)

E2 でコピーした `requirements/03-user-flow.md` の Mermaid ブロックと、E3 で生成した
`screens/00-screen-list.md` を入力に、画面遷移図 SSoT (`screens/00-transition-map.mmd`) と
その派生 (`00-screen-nav.json` / L5 検査結果) を生成する。**E3 / E4 の後に実行する**
(screen-list がノード形状の突合先、`requirements/03-user-flow.md` が変換ソースのため)。

リバース産プロジェクトが遷移図を持たないと、Phase 5 delta の影響分析 (Step 28) が遷移グラフを
読めず動けない。本 substep は基線としてその材料を用意する。

**設計注記 (2 点)**:

- 変換は決定論 script (`scripts/derive-transition-map.mjs`) が行い、**LLM が user-flow を読み直して
  遷移図を書き起こすことはしない** (実体は「菱形を畳む / 点線を実線化する / 同名ノードを寄せる /
  複数ブロックを 1 図に統合する」の機械変換)。`※ 推測 (inferred)` / `※ 不明 (unknown)` マーカーは
  エッジラベルへ **逐語移設** される — E2 と同じ laundering 封じの伝播規約であり、点線 (不確実な遷移) は
  マーカー付きエッジとして下流に残る。
- L5 defects (孤児画面・到達不能・戻り先欠落 等) は **異常ではなく Step 16 (人間レビュー) の作業リスト**。
  リバース元の user-flow は画面遷移として完全でないことが普通なので、件数を人間に渡すところまでが
  本 substep の責務 — ここで `.mmd` を推測で補完しない。

#### E6-1: 既存 `.mmd` があれば skip

`artifacts/{app_name}/screens/00-transition-map.mmd` が **既に存在する場合は E6 全体を skip** し、
「遷移図: 既存 `.mmd` を保持 (再生成しない)」と 1 行記録して E6 を終える。Step 16 で人間が手修正した
`.mmd` を再走で潰さないため (script も既存出力を上書きしないので二重の保護。**`--force` は渡さない**)。

skip する場合も、**`screens/00-transition-map.derive-summary.json` (派生 summary sidecar) があれば Read し、
`summary.warnings[]` の件数を控えて完了報告に含める** — 生成 run の警告 (特に `unparsed_line` = 元図から
欠けた遷移) は sidecar にしか残らないため。sidecar の `mmd_md5` が現行 `.mmd` の md5 と一致しない場合は
「警告情報は生成時点のもの (`.mmd` はその後手修正済み)」と添える。sidecar 不在 (旧 run 由来) の場合は
「警告情報なし (sidecar 未生成の run)」と 1 行記録する (推測で補わない)。

#### E6-2: `.mmd` を生成

```
node scripts/derive-transition-map.mjs artifacts/{app_name}
```

- **exit 0** = 生成成功。stdout の summary JSON (`nodes` / `edges` / `folded_diamonds` / `warnings[]`) を控える
  (完了報告に使う)。**`warnings[]` のうち `type == "unparsed_line"` の件数は必ず控える** — 未対応の
  Mermaid 記法で statement が落ちた件数 = 元図から欠けた遷移の件数であり、0 件でない限り完了報告に出す
  (script は exit 0 のまま進むので、ここで数えないと欠落が誰にも見えない)
- 同じ summary は script が **`screens/00-transition-map.derive-summary.json` (sidecar)** にも書く。
  後続 phase (Phase 3 の Step 16 ゲート / 14-lite / ファストパス) はこちらを読んで警告を提示するので、
  **stdout の summary と sidecar のどちらか一方を人間に見せれば足りる** (二重に数え直さない)。
  `summary.sidecar_warning` が出ていたら sidecar の書き出しに失敗しているので、その旨も報告に含める
  (fail-open で `.mmd` 自体は生成済み)
- **`unparsed_line` 以外の warning も同じ扱いにする** (「元図にあった遷移 / 画面一覧の行が出力から消えた」信号は
  すべて人間に渡す)。`warnings[]` から次を拾い、**件数と中身 (対象 / 値) を完了報告と Step 16 の提示に含める**
  (0 件なら省略):
  - **エッジが消えた系**: `folded_self_loop` (菱形を畳んだ結果の自己ループを drop) / `merged_self_loop`
    (同名マージで自己ループ化して drop) — 件数と `screen` / `dropped_label` を出す
  - **画面一覧側** (parseScreenList 由来): `duplicate_node_id` / `invalid_node_id` (E3 で付けた
    `遷移図ノードID` 列の重複・文法外の非空値 = 宣言が効かずラベル一致に落ちた行) / `skipped_table`
    (画面一覧として読まなかった `画面名` 表) / `duplicate_screen_row` (落とした再掲行) /
    `screen_name_collision` (正規化名の衝突)
  - **形状を書き換えた系**: `node_id_promoted_to_screen` (ID 宣言により非矩形を矩形へ昇格した)
- **exit 2** = 入力不能 (`requirements/03-user-flow.md` 不在 / mermaid ブロック 0 件 / **エッジ 0 本** /
  screen-list 不在 等)。
  **fail-open**: stderr の理由を添えて「⚠️ 遷移図は生成できませんでした ({理由})。Phase 3 の Step 14 で生成されます」と
  記録し、**E6 の残り (E6-3 / E6-4) を skip して Step 06 は続行する** — code-only リバースでは user-flow に
  Mermaid が無い run がありうるため、ここで Step 06 全体を止めない
- **exit 1** = 使い方エラー (不明フラグ / 値なしフラグ / 引数過多 / `--out` が app ルート外) = **呼び出し側のバグ**。
  fail-open **させない** — stderr の文言をそのまま表示して停止し、コマンドを直して再実行する
  (材料不足の exit 2 と混ぜると、パス typo で遷移図が無いまま静かに Step 06 が完走してしまう)

#### E6-3: `00-screen-nav.json` を派生生成

```
node scripts/derive-screen-nav.mjs artifacts/{app_name}
```

- **exit 0** = 生成成功。stdout の summary JSON にある **2 つの warning 配列を両方**控えて、
  **件数と中身 (対象行 / 値) を完了報告と Step 16 の提示に含める** (`unparsed_line` と同じ扱い。
  0 件なら key ごと出ないので省略):
  - `screen_list_warnings` = 画面一覧側 (`duplicate_node_id` / `invalid_node_id` = `遷移図ノードID` 列の
    重複・文法外の非空値 / `skipped_table` = 画面一覧として読まなかった `画面名` 表 / `duplicate_screen_row`
    = 落とした再掲行 / `screen_name_collision` = 正規化名の衝突)。**後 3 者は「画面一覧の行が欠けたまま
    突合が走った」信号**なので件数だけでなく対象を出す
  - `match_warnings` = 突合側 (`node_id_bound_to_non_screen` = ID 宣言が画面以外のノードを指した /
    `unknown_node_id` = 宣言した ID が `.mmd` に存在しない)。**どちらも E3 で付けた `遷移図ノードID` が
    効いていない信号**であり、放置すると当該画面が nav / L5 の検査を受けないまま基線に入る
- **exit 2** = 運用エラー (`.mmd` の strict parse 失敗 等) → 警告を 1 行記録して続行 (nav.json は派生ビューであり、
  Phase 3 の Step 14 / 19 が再生成できる)
- exit 1 = 引数不正 (呼び出し側の誤り — 引数を見直して再実行)

#### E6-4: L5 connectivity を検査して記録

`artifacts/{app_name}/screens/00-coverage-check.json` が無ければ先に空 stub を書く。**stub の JSON 形は
`skills/14-screen-list-transition/SKILL.md` の「事前チェック: REVERSE_ENGINEERED ファストパス」節にある
「空 stub」と同一のものを使う** (schema: `schemas/coverage-check.schema.json`。stub 形の SoT は skills/14 側なので
本ファイルに逐語コピーしない)。`--write` は既存ファイルの `layers.l5_connectivity` /
`summary.connectivity_defects` を patch する形式のため、stub が無いと exit 2 になる。

```
node scripts/validate-connectivity.mjs artifacts/{app_name} --write
```

- **exit 0** = defect なし
- **exit 1 = defect あり (正常系)** — Step 16 の人間レビュー材料が `00-coverage-check.json` に記録されたという意味。
  ⚠️ ただし本 script は **`--write` の書き込み失敗や引数不正でも exit 1** になる (exit 1 が「defect あり」と
  「使い方 / 運用エラー」の 2 義を持つ既存契約)。**exit 1 を「記録された」と断定する前に、stdout の
  `connectivity_defects` の値と `00-coverage-check.json` の `summary.connectivity_defects` が一致することを
  確認する** — 一致しなければ書き込みが失敗しており、stub の 0 件が「検査済み」として下流に渡る。
  件数を控えて完了報告に載せ、**ここで `.mmd` を補完しない** (補完は Step 16 の FB を受けてから)
- **exit 2** = 運用エラー (coverage-check の不在・不正 / strict parse 失敗) → 警告を 1 行記録して続行

---

## Completion Check

After this step, verify the following exist:

- [ ] `artifacts/{app_name}/requirements.json` — status: `REVERSE_ENGINEERED`
- [ ] `artifacts/{app_name}/requirements/01-overview.md` through `08-constraints.md`
- [ ] `artifacts/{app_name}/screens/00-screen-list.md`
- [ ] `artifacts/{app_name}/screens/{slug}.md` for each implemented screen
- [ ] `artifacts/{app_name}/tokens.json` (populated or stub)
- [ ] `artifacts/{app_name}/screens/00-transition-map.mmd` + `00-screen-nav.json` + `00-coverage-check.json`
      (E6。E6-2 が exit 2 で fail-open した場合のみ不在でよい — その旨を完了報告に記録していること)

Display to user:
> "✅ AYATORI format conversion complete.
> Pipeline entry point: `/ayatori-design` (Phase 2)
> Screens ready: {N} implemented screens in `screens/`
> Tokens: {populated from source | stub — awaiting Phase 2}
> 遷移図: nodes {nodes} / edges {edges} (畳んだ菱形 {folded_diamonds}) — `screens/00-transition-map.mmd`
> {unparsed_line が 1 件以上のときだけ: ⚠️ 解釈できなかった行 (unparsed_line): {N} 件 — 未対応の Mermaid 記法で元図の遷移が欠けている可能性があります (該当行: {block}:{line})}
> L5 connectivity: defects {connectivity_defects} 件 (Step 16 人間レビューの確認リスト。0 件でも異常ではない)
>
> Next step: run `/ayatori-design` in a new conversation to generate the design system for the {platform} rebuild."

遷移図の 2 行は E6 の結果で差し替える: 既存 `.mmd` を保持した場合 (E6-1) は
「遷移図: 既存 `.mmd` を保持 (再生成せず)」、E6-2 が fail-open した場合は
「遷移図: 未生成 ({理由}) — Phase 3 の Step 14 で生成」と書き、L5 行と unparsed_line 行は省略する。
`unparsed_line` 行は **0 件なら省略する** (0 件を毎回表示すると信号が薄れる)。
