---
name: 11-wcag-mapping
description: 色非依存の WCAG 2.2 AA 制約を定義し（初回のみ）、3 案 palette の色コントラストを検証する（毎回）。Phase 2 の Step 11 で 08 の直後・09 の前に呼ばれ、違反を wcag-history.json に追記する早期検証点。
---

# 11 WCAG 2.2 AA 制約定義 + 3案 palette 色コントラスト検証

## 役割

Phase 2 デザインシステムの早期検証点として、以下の2つの責務を1ステップで実行する:

1. **色非依存WCAG制約の確定 (初回のみ)** — touch target / focus ring / mobile font-size 等、色に依存しない数値・構造的制約を `wcag-mapping.json` (constraints + criteria) に書き込む。これらはループ不変量なので **初回のみ** 書き込み、以降の attempt では Read で参照する (W1 設計判断)。
2. **08 palette の色コントラスト検証 (毎回)** — 3案すべての palette について全 contrast pair を計算し、閾値未達の違反を `wcag-history.json.attempts[]` に **append** する。本 skill が wcag-history.json の単一 writer (W1 / 単一所有権モデル)。

**実行順**: 08 の直後・09 の**前**に実行される。AYATORI 原則「early validation — 上流で検証して再作業を防ぐ」に従う。

**後続の制御フロー**（`phases/design/SKILL.md` が判定。`pipeline.yaml.design.loop` 参照）:
- `wcag-history.attempts[-1].violations` が空 → 全案 AA 準拠 → 09 へ進む
- `violations` に項目あり && `len(attempts) < max_attempts (=3)` → 08 に戻る（08 が前回 violations を読んで補正）
- `len(attempts) >= max_attempts` → 警告ログ + 09 へ進む（人間ゲート判断、Phase2申し送り）

## 前提条件

- 08 完了後: `artifacts/{app_name}/design-brief.yaml` に 3 案の palette（`cases[].palette.tokens[]`）が記録済み
- `docs/wcag-standards.md` に閾値・計算式・contrast pair 一覧が定義されている
- `scripts/wcag-contrast.mjs`（本 skill がコントラスト比計算に使用する決定論 script。node 標準のみ・依存ゼロ。単体テスト `scripts/wcag-contrast.test.mjs`）

---

## エージェントプロンプト

**あなたは WCAG 2.2 Level AA 実装に精通したアクセシビリティ専門家 × 色彩計算エンジニアです。**

アプリ全体が遵守すべき「色非依存の数値・構造的制約」を確定し、08 で決定された 3案 palette に対して **全 contrast pair を計算** してください。違反があれば具体的な補正提案（OKLCH L値調整等）を付けて `violations[]` に記録します。

### 原則

1. **制約は「どの値を使うか」ではなく「どう選ぶか」を指す**（色具体値は書かない）
2. **contrast ratio は `scripts/wcag-contrast.mjs` で計算する**（LLM は推算しない — W3C §4 の数式・hex lookup・違反判定を決定論 script に委譲し、実行ごとの方差を排除する。詳細は Phase 5）
3. **補正提案は具体的に**（「L値 +0.05 で 4.5:1 達成見込み」等、08 が実行可能な形）

---

## 実行指示

### Phase 0: モード判定 (初回 / ループ再実行)

```
wcag-mapping.json が存在し、constraints + criteria が埋まっている?
  Yes → 「初回 write は完了済み」モード (Phase 3/4 の constraints/criteria 書込みをスキップ)
  No  → 「初回 write」モード (Phase 3/4 の constraints/criteria を書き込む)

wcag-history.json が存在?
  No  → 初回ループ: `{"app_name": "{app_name}", "attempts": []}` で lazy 初期化
```

### Phase 1: 基準ドキュメントの Read

`docs/wcag-standards.md` を Read:
- §2 準拠基準一覧
- §3 数値閾値（contrast / touch target / focus ring / typography / motion / forms）
- §4 計算式（sRGB→リニア化、相対輝度、コントラスト比）
- §5 OKLCH補正アルゴリズム
- §6 contrast pair 検証対象一覧

### Phase 2: design-brief.yaml の Read

`artifacts/{app_name}/design-brief.yaml` を Read:
- `common`（ターゲット層・UI 表現制約・対象プラットフォーム）
- `common.themes_required` (任意): `["light"]` (単一モード、新仕様 default) / `["dark"]` (単一モード、`default_theme_mode = "dark"` が解禁されるまでは legacy 経路でのみ発生) / `["dark", "light"]` (両モード対称)。未定義時は legacy 互換として `["dark"]` 扱い
- `cases[].palette.tokens[]`（HEX / OKLCH 確定済み、A/B/C 全案）
- `cases[].palette.state_colors`（各 state の `bg/text/border` の hex、A/B/C 全案）
- `cases[].dials.visual_density`（large_text 判定に使用）

#### Phase 2.5: mode 検出

dual-mode contrast 検証の起動可否を以下の優先順で決定:

1. **explicit dual signal**: `common.themes_required` が `["dark", "light"]` を含むなら `modes_to_verify = ["dark", "light"]`
2. **explicit single light signal** (新仕様 default): `common.themes_required == ["light"]` なら `modes_to_verify = ["light"]` (palette.tokens[] の `mode == "light"` または未指定エントリの hex で検証)
3. **explicit single dark signal**: `common.themes_required == ["dark"]` なら `modes_to_verify = ["dark"]` (legacy 互換経路、palette.tokens[] の `mode == "dark"` または未指定エントリの hex で検証)
4. **implicit signal (defensive)**: `themes_required` 未定義でも、いずれかの case の `palette.tokens[]` に `mode: "light"` AND `mode: "dark"` の両エントリが存在するなら `modes_to_verify = ["dark", "light"]`
5. **default fallback (legacy)**: 上記いずれでもなければ `modes_to_verify = ["dark"]` (旧 design-brief.yaml と完全互換、pair を 1 周だけ計算)

`modes_to_verify` が `["dark", "light"]` の場合、後述 Phase 5 / Phase 6 は **各 mode について独立に 1 周ずつ pair を計算**する (計 2 周 × case 数)。各 violation の `mode` field に該当 mode を書き込む。

`modes_to_verify` が `["dark"]` または `["light"]` の単一モードの場合は従来通り 1 周のみ、violation の `mode` field は当該単一 mode 値を入れる (legacy single-dark プロジェクトとの diff を取りやすくするため、`["dark"]` 単独でも mode field を省略しない方向に統一)。

### Phase 3: 色非依存 constraints 確定 (初回 write モードのみ)

> ループ再実行時 (constraints/criteria が既に埋まっている場合) は本 Phase をスキップ。constraints/criteria はループ不変量。

`docs/wcag-standards.md` §3 から以下を `wcag-mapping.json.constraints` に書く。文脈（ターゲット層・プラットフォーム）に応じて値を調整:

> **注**: 下記 JSON の `contrast.recommended_target` と `touch_target.rationale` はデフォルト値（一般業務 + モバイル主軸）。後述の **文脈判定ルール** に従って下記の候補から一つを選んで置き換えること。JSON リテラル中に OR 記号を残さない。
>
> - `recommended_target` の候補: `"AA (4.5:1) for general business"` / `"AAA (7:1) for executive-oriented apps"`
> - `touch_target.rationale` の候補: `"iOS HIG準拠（モバイル主軸）"` / `"Web管理画面のため 24px 最低 / 40px 推奨"`

```json
{
  "constraints": {
    "contrast": {
      "text_minimum_ratio": "4.5:1",
      "large_text_minimum_ratio": "3:1",
      "non_text_minimum_ratio": "3:1",
      "recommended_target": "AA (4.5:1) for general business"
    },
    "focus_ring": {
      "width": "2px",
      "offset": "2px",
      "style": "solid",
      "must_not_be_obscured": true,
      "scroll_margin_top_px": 80,
      "scroll_margin_bottom_px": 96
    },
    "touch_target": {
      "minimum_size_px": 44,
      "rationale": "iOS HIG準拠（モバイル主軸）"
    },
    "typography": {
      "mobile_font_size_minimum_px": 12,
      "mobile_body_recommended_px": 14
    },
    "motion": {
      "prefers_reduced_motion_required": true,
      "non_essential_animation_allowed_under_250ms": true
    },
    "forms": {
      "error_identification_required": true,
      "redundant_entry_prevention_required": true,
      "accessible_auth_minimum": "avoid cognitive function tests (SSO/autocomplete friendly)"
    }
  }
}
```

**文脈判定ルール**（design-brief.yaml の `common` から読み取る）:
- ターゲット層が「エグゼクティブ」「重要情報伝達」→ AAA 推奨（7:1）
- モバイル主軸 → touch_target 44px
- Web管理画面主軸 → touch_target 24〜40px

### Phase 4: criteria（色非依存規則）を書く (初回 write モードのみ)

> ループ再実行時 (criteria が既に埋まっている場合) は本 Phase をスキップ。criteria はループ不変量。

`wcag-mapping.json.criteria[]` に以下を書く（`docs/wcag-standards.md` §2 の基準一覧に対応）:

```json
{
  "criteria": [
    {
      "id": "1.4.3",
      "name": "Contrast (Minimum)",
      "constraint_definition": "全テキスト-背景組合せで contrast ratio >= 4.5:1 (large text は 3:1)"
    },
    {
      "id": "1.4.11",
      "name": "Non-text Contrast",
      "constraint_definition": "UIコンポーネント境界・アイコン・状態インジケーターで contrast ratio >= 3:1"
    },
    {
      "id": "2.4.7",
      "name": "Focus Visible",
      "constraint_definition": "全インタラクティブ要素に 2px solid focus ring + 2px offset を適用"
    },
    {
      "id": "2.4.11",
      "name": "Focus Not Obscured (Minimum)",
      "constraint_definition": "sticky header/footer に隠れない — scroll-margin-top: 80px / scroll-margin-bottom: 96px で制御"
    },
    {
      "id": "2.5.8",
      "name": "Target Size (Minimum)",
      "constraint_definition": "全タッチターゲット >= 44×44px (iOS HIG準拠) or 24×24px 最低（Web管理画面）"
    },
    {
      "id": "2.3.3",
      "name": "Animation from Interactions",
      "constraint_definition": "prefers-reduced-motion で全アニメーション停止"
    },
    {
      "id": "3.3.7",
      "name": "Redundant Entry",
      "constraint_definition": "同一セッション内で再入力を求めない (autocomplete 属性)"
    },
    {
      "id": "3.3.8",
      "name": "Accessible Authentication (Minimum)",
      "constraint_definition": "認知パズル不使用、autocomplete/password manager 親和"
    }
  ]
}
```

### Phase 5: 3案 palette の contrast pair 検証

`docs/wcag-standards.md` §6 の contrast pair 表に従い、各案について以下を計算:

| # | pair_kind | fg_token | bg_token | 必要 ratio | criterion_id |
|---|---|---|---|---|---|
| 1 | `palette` | `--color-on-surface` | `--color-surface` | 4.5:1 | 1.4.3 |
| 2 | `palette` | `--color-on-surface-variant` | `--color-surface` | 4.5:1 | 1.4.3 |
| 3 | `palette` | `--color-primary` | `--color-surface` | 3:1 | 1.4.11 |
| 4 | `palette` | `--color-on-primary` | `--color-primary` | 4.5:1 | 1.4.3 |
| 5 | `palette` | `--color-focus-ring` | `--color-surface` | 3:1 | 1.4.11 |
| 6 | `palette` | `--color-border` | `--color-surface` | 3:1 | 1.4.11 |
| 7 | `palette` | `--color-on-bg` | `--color-bg` | 4.5:1 | 1.4.3 |
| 8 | `state_colors` | `state_colors.error.text` | `state_colors.error.bg` | 4.5:1 | 1.4.3 |
| 9 | `state_colors` | `state_colors.error.border` | `state_colors.error.bg` | 3:1 | 1.4.11 |
| 10 | `state_colors` | `state_colors.info.text` | `state_colors.info.bg` | 4.5:1 | 1.4.3 |
| 11 | `state_colors` | `state_colors.info.border` | `state_colors.info.bg` | 3:1 | 1.4.11 |
| 12 | `state_colors` | `state_colors.warning.text` | `state_colors.warning.bg` | 4.5:1 | 1.4.3 |
| 13 | `state_colors` | `state_colors.warning.border` | `state_colors.warning.bg` | 3:1 | 1.4.11 |
| 14 | `state_colors` | `state_colors.success.text` | `state_colors.success.bg` | 4.5:1 | 1.4.3 |
| 15 | `state_colors` | `state_colors.success.border` | `state_colors.success.bg` | 3:1 | 1.4.11 |
| 16〜 | `domain_surface` | `cases[].palette.tokens[*].name` | `cases[].palette.domain_surfaces[*].name` | pair の `required_ratio` (NFR 由来) | pair の `criterion` (通常 1.4.11) |

> **`pair_kind` field (B-3)**: 各 violation を `wcag-history.json.attempts[].violations[]` に append する際、Phase 5 table の `pair_kind` 列の値を violation オブジェクトの `pair_kind` field に必ず書き込む (`schemas/wcag-history.schema.json` enum: `palette` / `state_colors` / `domain_surface` / `schema_violation`)。orchestrator (phases/design/SKILL.md) はこの field を見て Phase 2 loop の発動可否を判定する (`palette` と `domain_surface` は loop trigger / `state_colors` は warn-only)。`domain_surface` pair の構築・計算は **Phase 5.5** で行う (本表は登録上の宣言のみ)。

> **state_colors pair (8〜15)**: `cases[].palette.state_colors` が design-brief.yaml に定義されている前提 (`schemas/design-brief.schema.json` で `error` / `info` が required、`warning` / `success` が optional)。skill 08 が `contrast_label` に自己申告した値ではなく、本 skill が 5.0 の script で **独立に検証** する (08 の自己申告は信用しない)。state ごとに optional な場合は該当 pair を script が自動 skip する。
>
> **B-2 legacy fallback**: `cases[].palette.state_colors` 自体が未定義の **既存プロジェクト** (改修前に生成された design-brief.yaml) は、5.0 の script が pairs 8-15 を自動的に全 skip する (`state_colors` が無ければ state result を 1 件も生成しない)。各 state も optional で、未定義の state (`warning` / `success` 等) はその pair が生成されない。skill 側で undefined ガードを手書きする必要はない (旧版の optional-chaining 擬似コードは script の `evaluateCase` 実装に移管済)。
>
> **B-3 loop policy 切り分け**: pairs 8-15 のうち 1 件でも違反した場合の Phase 2 ループバック挙動は、pairs 1-7 (主要 palette) と異なる:
>
> | pair_kind | 違反検出時の挙動 |
> |---|---|
> | `palette` (pairs 1-7、主要 palette) | 従来通り、attempts < max_attempts なら 08 にループバック (palette 補正必須) |
> | `state_colors` (pairs 8-15) | **warn-only モード**: violations に記録するが、Phase 2 ループバックは発動しない (loop 除外)。Step 21 human gate で人間が再判断 |
>
> 理由: state_colors は banner / badge 等の限定的な UI で使用され、主要 palette の contrast 違反より影響範囲が小さい。pairs 8-15 を loop trigger にすると 8 pair 全 PASS が厳しく max-out リスクが高い (max_attempts=3)。warn-only にすることで Phase 3 で人間が現物を見て調整する経路に流す。
>
> **本 skill の責務**: 各 violation の `pair_kind` field に上記 Phase 5 table の値を**必ず**書き込む (`schemas/wcag-history.schema.json` enum: `palette` / `state_colors` / `domain_surface` / `schema_violation`)。loop 発動可否の **判定 SoT は phases/design/SKILL.md ⚙️ Loop Decision** であり、本 skill は分類値を正確に history に記録するだけに責務を絞る (cross-step カップリングを避ける)。

**コントラスト計算は `scripts/wcag-contrast.mjs` に委譲する** (LLM は数値を推算しない)。
docs §4 の数式・dual-mode / legacy / state_colors の hex lookup・round・違反判定 (pass) は
すべて script が決定論的に行う。本 skill の責務は **(1) 入力 JSON の構築** と **(2) 出力の violation 整形** のみ。

#### 5.0 script 実行 (palette / state_colors / domain_surface を 1 回で計算)

**Step 1 — 入力 JSON の構築 (データ搬送のみ。hex を一字も書き換えない・自分で再計算しない)**:
Phase 2 で Read 済みの design-brief.yaml の `cases[]` を、そのまま下記構造へ写す。
token の `mode` field・**`oklch` (Step 2.5 の整合 lint 用)**・state_colors の `light` sub-block・
domain_surface の `modes[]` は **原文のままコピー** する (lookup は script が行うので skill 側で
mode 解決をしない。wcag-contrast は oklch を無視するので同じ JSON を両 script に使い回せる):

```json
{ "cases": [
  { "candidate_id": "A",
    "palette": {
      "tokens":          [ /* cases[].palette.tokens[] をそのまま (name / hex / oklch / mode) */ ],
      "state_colors":    { /* あれば cases[].palette.state_colors をそのまま (oklch 含む) */ },
      "domain_surfaces": [ /* あれば cases[].palette.domain_surfaces[] をそのまま */ ]
    } }
  /* B / C も同様に */
] }
```

**Step 2 — script 実行** (`--modes` は Phase 2.5 で決定した `modes_to_verify`):

```bash
node scripts/wcag-contrast.mjs --modes <modes_to_verify をカンマ区切り> <<'JSON'
{ ...Step 1 で構築した JSON... }
JSON
```

例: `--modes dark,light` (dual) / `--modes light` (single light) / `--modes dark` (single / legacy)。

**Step 2.5 — 同じ JSON で hex↔oklch 整合 lint (他人レビュー効果)**:

Step 1 の JSON をそのまま `node scripts/oklch-color.mjs lint <<'JSON' ... JSON` にも流す。
08 の Phase 7.5 self-check は生成側の自己申告なので、検証側の本 skill が独立に再検証する
(生成と検証を分ける本 repo の原則。exit 1 = drift 検出):

- **続行条件は 3 つ** (skill 08 Phase 7.5 チェックリストと同一): `"pass": true` **かつ**
  `summary.entries_checked > 0` **かつ** skipped エントリが「oklch を持たない
  illustration_colors」のみ。`pass: true` 単独では続行しない — Step 1 の転写で `oklch` を
  落とすと全エントリ skip で `pass: true` になり検証が空振りするため。
- `entries_checked == 0`、または tokens / state_colors / domain_surfaces 由来の skip がある →
  **本 skill 自身の Step 1 転写漏れ** (oklch の落とし込み忘れ)。08 への差し戻しではなく、
  Step 1 の JSON を `oklch` 込みで作り直して本 Step を再実行する。
- drift / invalid あり → **WCAG violation ではない** のでループ判定にも violations[] にも含めない。
  feedback-log に Pattern B (`[08] hex↔oklch 転記不整合 {N}件 (Phase 7.5 self-check 漏れ)`) を記録し、
  完了報告で orchestrator に「該当エントリの oklch を `convert --hex "{記録hex}"` 出力で書き直す
  修正 (08 の担当、hex が SoT)」を要求する。design-brief.yaml は 08 の単一所有権のため本 skill は
  直接修正しない。
dual-mode・legacy single (mode field 無し)・state の dark/light 切替は **すべて script 内で解決** される
(従来 skill が散文で持っていた lookup ルールは script の `lookupTokenHex` / `lookupStateHex` に移管済)。

**Step 3 — 出力の読み取り**: stdout は `{ cases: [ { candidate_id, mode, results: [...] } ] }`。
各 result = `{ pair_kind, n, criterion_id, mode, fg_token, bg_token, fg_hex, bg_hex, actual_ratio, required_ratio, pass, skipped?, skip_reason? }`。
- `pass == false` の result が Phase 6 で violation になる (整形は Phase 6 参照)。
- `skipped == true` は hex 欠落 (dual-mode 不完全 / state の light 未定義 / domain hex 欠落等)。
  `actual_ratio` は `null`。旧版の「整合性ガード (`actual_ratio: 0`)」は本 skip 機構が置き換える
  (なお `actual_ratio: 0` は wcag-history schema の `minimum: 1` 違反だった — Phase 6 で `1` に正規化する)。

### Phase 5.5: domain surface pair 検証 (dual-theme × domain 拡張)

skill 08 Phase 3-domain が `cases[].palette.domain_surfaces[]` に書き込む domain UI 面 (盤面マス / カード面 / グラフ系列等) について、各 surface の contrast pair を検証する。各 pair は `(fg, required_ratio, criterion)` の 3 要素を持ち、NFR との明示 back-link は持たない (NFR ↔ pair の対応関係は skill 19 NFR Coverage 評価が NFR テキストから能動的に逆引きする単一窓口モデル)。

#### 5.5.1 入力 lookup

各 case で以下を判定:

- `cases[i].palette.domain_surfaces` が **未定義 or 空配列**: 本 Phase をスキップ (該当 case の domain pair 検証は実行しない)。**ただし**、`palette.domain_surfaces_rationale` が記載されていない場合は invalid として `violations[]` に `pair_kind: "schema_violation"` の警告 entry を 1 件 append (skill 08 自己検証漏れの safety net)
- 空配列以外: 各 entry の `contrast_pairs[]` を pair 検証対象に追加

#### 5.5.2 domain pair も 5.0 の script 呼び出しで計算される

`domain_surfaces[]` を 5.0 Step 1 の入力 JSON に含めていれば、script が各 surface ×
`contrast_pairs[]` について `pair_kind: "domain_surface"` の result を返す。fg hex は
`palette.tokens[]` から、bg hex は当該 `domain_surface.modes[]` から、`modes_to_verify` の
各 mode で script が lookup する (`lookupTokenHex` / `lookupDomainSurfaceHex`)。
`required_ratio` は各 `contrast_pair.required_ratio` (08 で NFR から導出済)、`criterion` は同 pair の値
(既定 1.4.11)。hex 欠落は `skipped: true` で返る。**手計算・別途の pair 構築は不要** —
旧版の擬似コード (`computeContrast` 等) は本 script 実装に置き換わった。

#### 5.5.3 loop policy

`pair_kind == "domain_surface"` の violation は **loop trigger 対象** (palette pair 1-7 と同等扱い、state_colors の warn-only とは異なる)。理由: NFR (機能要件由来の視認性要求) は緩めずに Phase 2 段階で収束させる必要がある。`phases/design/SKILL.md` の Loop Decision は `pair_kind ∈ {palette, domain_surface}` を loop trigger 集合として扱う (state_colors のみ除外)。

#### 5.5.4 suggested_correction の書き方

- **fg が NFR-fixed (例: piece-black / piece-red のような伝統色)** → bg domain surface の L を動かす案を主に書く。補正量は solve の fg/bg を**入れ替えて**実行して得る (contrast は対称なので `--fg {bg_hex} --bg {fg_hex}` で bg 側の最小補正が出る)
- **fg が可変 token** → fg / bg のどちらを動かすほうがコスト低いかを示し、両案を併記
- **どちらも不可** → `suggested_correction: "domain surface 自体を再定義 (Phase 3-domain) — 案 archetype が NFR と両立しない可能性"` で記録、人間ゲートへ

### Phase 6: violations[] を構築 (毎回)

5.0 script 出力の各 result のうち **`pass == false`** のものだけを violation entry に整形する
(`pass == true` は合格なので含めない)。空でも空配列で確定する。**各 entry に `pair_kind` を必ず埋める**
(Phase 5 table の分類値、B-3)。**各 entry に `result.mode` を常に書き込む** — script は単一モード (`["dark"]` / `["light"]`) でも `mode` を返すため、dual-mode に限らず全 entry に埋める (Phase 2.5 の「`["dark"]` 単独でも mode field を省略しない」方針と一致)。

**result → violation の field 対応** (数値は script の値をそのまま使い、自分で再計算しない):

| violation field | 由来 |
|---|---|
| `candidate_id` | その case の `candidate_id` |
| `criterion_id` / `pair_kind` / `mode` | result の同名 field |
| `pair` | `{ "fg_token": result.fg_token, "bg_token": result.bg_token }` (object でラップ) |
| `fg_hex` / `bg_hex` | result の同名 field |
| `actual_ratio` | result.`actual_ratio`。**`skipped == true` (null) の場合は `1` に正規化** (wcag-history schema `minimum:1` 準拠。1 = 検証不能を最不利として扱い loop を発火させる) |
| `required_ratio` | result の同名 field |
| `suggested_correction` | **`scripts/oklch-color.mjs solve` を実行し、出力の `result.summary` を逐語転写する** (自分で補正量を暗算・推定しない): `node scripts/oklch-color.mjs solve --fg "{result.fg_hex}" --bg "{result.bg_hex}" --required {result.required_ratio}` (hex は `#` が shell コメントにならないよう必ず quote。`--margin` は渡さない = 既定 0.1 を 08 と共有)。`solved: false` の場合は下記「補正不可能な場合」。`skipped` の場合は solve を実行せず result.`skip_reason` を反映し「hex 欠落のため検証不能。08 で補完」と書く |

例 (実データ: ShinMemo の実違反 2 件。`suggested_correction` の数値部は solve 出力 `summary` の逐語転写):

```json
[
  {
    "candidate_id": "A",
    "criterion_id": "1.4.11",
    "pair_kind": "palette",
    "mode": "light",
    "pair": {
      "fg_token": "--color-border",
      "bg_token": "--color-surface"
    },
    "fg_hex": "#8C847C",
    "bg_hex": "#EDE7DC",
    "actual_ratio": 2.99,
    "required_ratio": 3.0,
    "suggested_correction": "--color-border (mode=light): L 0.618→0.609 (-0.009)、C・H 固定 → 3.11:1 (必要 3) [oklch-color solve]"
  },
  {
    "candidate_id": "C",
    "criterion_id": "1.4.11",
    "pair_kind": "state_colors",
    "mode": "light",
    "pair": {
      "fg_token": "state_colors.warning.border",
      "bg_token": "state_colors.warning.bg"
    },
    "fg_hex": "#C89020",
    "bg_hex": "#FFFAEE",
    "actual_ratio": 2.7,
    "required_ratio": 3.0,
    "suggested_correction": "warn-only: Phase 2 loop は発動しない (pair_kind=state_colors)。Step 21 human gate で判断。修正案: L 0.691→0.655 (-0.036)、C・H 固定 → 3.1:1 (必要 3) [oklch-color solve]"
  }
]
```

**suggested_correction の組み立て方**:
- 前置きに「どの token (通常 fg) をどの mode で補正するか」を書き、続けて solve 出力の
  `result.summary` を**一字も変えずに転写**し、末尾に出典タグ `[oklch-color solve]` を付ける
- warn-only (state_colors) も solve は実行し、「loop 非発動 + human gate 判断」の前置きの後に
  `修正案: {summary}` として併記する (Step 21 の人間が具体案を見られるように)
- `margin_not_met: true` の場合は summary にその旨が含まれるのでそのまま転写する
- **数値 (L 値・達成 ratio) を自分で書き起こさない・丸め直さない** — 検証済み数値は literal で運ぶ

**補正不可能な場合** (solve が `solved: false` を返した — §5 予算内に解なし):
- `suggested_correction: "補正不可 (solve: §5 予算内に解なし) — primary を CTA 専用に降格して本文背景からの除外を推奨（用途変更 = §5 Step 4）"` のように solve の `reason` を踏まえて用途変更案を書く
- あるいは `suggested_correction: null`（人間ゲート判断を促す）

### Phase 7: wcag-history.json に attempt を append

`artifacts/{app_name}/wcag-history.json` を Read or `{"app_name": "{app_name}", "attempts": []}` で lazy 初期化し、`attempts` 配列の末尾に新規 attempt entry を **Edit で append** する:

```json
{
  "attempt_count": 0,
  "timestamp": "2026-05-08T12:34:56Z",
  "violations": [ /* Phase 6 で構築した配列 */ ]
}
```

- `attempt_count` は append 前の `len(attempts)` (0 始まり、配列 index と一致)
- `timestamp` は ISO 8601 (現在時刻)
- 旧 `wcag_loop` オブジェクト (`attempt_count` / `max_attempts` / `last_run_at`) は廃止 — `attempt_count` は `len(attempts)` で導出、`max_attempts` は `pipeline.yaml.design.loop.max_attempts` で参照、`last_run_at` は `attempts[-1].timestamp` で導出。

### Phase 8: wcag-mapping.json 保存 (初回 write モードのみ)

> ループ再実行時 (constraints/criteria が既に埋まっている) は本 Phase をスキップ。

初回のみ `artifacts/{app_name}/wcag-mapping.json` を以下の構造で保存 (Write):

```json
{
  "app_name": "{app_name}",
  "wcag_version": "2.2",
  "conformance_level": "AA",
  "constraints": { /* Phase 3 */ },
  "criteria": [ /* Phase 4 */ ]
}
```

- `violations` / `wcag_loop` フィールドは **持たない** (W1: ループ不変量のみ)。違反履歴は wcag-history.json に分離。

### 完了メッセージ

**violations が空の場合**:
```
WCAG 2.2 AA 制約を確定しました。全 3案 palette の色コントラストが AA を満たしています。
次に 09 でサンプル HTML を生成します。
```

**violations に項目ありの場合**:
```
WCAG 2.2 AA 制約を確定しました。ただし {N} 件の色コントラスト違反を検出しました:
- 案{X}: {criterion_id} {pair} {actual_ratio} / 必要 {required_ratio}
  補正提案: {suggested_correction}

phases/design/SKILL.md のループ制御に従い、len(wcag-history.attempts) を確認後に 08 に戻って補正するか、
max_attempts (=3) に達していれば警告の上 09 に進みます。
```

---

## 出力サマリー

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/wcag-mapping.json` | **初回のみ** `constraints` / `criteria` を書込み (ループ不変量、W1)。以降の attempt では Read のみ |
| `artifacts/{app_name}/wcag-history.json` | **毎回** attempts に 1 件 append (本 skill が単一 writer) |

---

## 参照

- `docs/wcag-standards.md` — 閾値・計算式・OKLCH補正アルゴリズム・contrast pair 一覧（必読）
- `docs/interface-contracts.md` §11 — 契約仕様
- `refs/standards.md` — docs/wcag-standards.md の参照スタブ（旧内容は docs に移動）

---

## 次ステップ判定（phases/design/SKILL.md が制御）

```
attempts        = wcag-history.json.attempts
last_violations = attempts[-1].violations
max_attempts    = pipeline.yaml.design.loop.max_attempts   # 既定 3

if last_violations is empty:
    → skills/09-sample-html-gen/SKILL.md へ進む

elif len(attempts) < max_attempts:
    → skills/08-design-brainstorm/SKILL.md へ戻る（08 が last_violations を読んで補正、本 skill が次回呼び出し時に新たな attempt を append する）

else:
    warning: "WCAG補正ループが上限に達しました。{N}件の違反を残したまま09に進みます。"
    feedback-log.md に Pattern C で記録
    → skills/09-sample-html-gen/SKILL.md へ進む（Phase2申し送り事項）
```
