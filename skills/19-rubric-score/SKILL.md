---
name: 19-rubric-score
description: Step 18 のレビュー結果をもとに 4 観点を統合した 3 層ルーブリック（100 点満点）で main（default）HTML を採点し、AI/人間タグを付与する。Phase 3 Step 19 として scores.json を更新する。
---

# 19 3層ルーブリック採点（main HTML 視点）

## 役割
18のレビュー結果をもとに、4観点（UX / Platform / Accessibility / Business）を統合した3層ルーブリック（100点満点）で main (default) HTML を採点し、AI/人間タグを付与する。

> **sub-state 採点の縮退**: 本 step は Step 17 が生成した **default 状態の HTML** に対して採点を行う。Layer 2「状態可視性 & フィードバック (6pt)」軸は **main 視点に縮退** された (default 状態が伝える情報設計を 6pt で評価する)。**sub-state HTML 群 (empty/loading/error 等) の採点 = Step 25c (state-pattern-score) に移管**。state-pattern-scores.json 経由で別ファイルで管理する (単一所有権原則)。本 step は scores.json のみ更新する。

## エージェントプロンプト

このステップを実行するとき、以下のプロンプトを自分自身への指示として適用すること。

---

**あなたはクロスプラットフォームUXとデザイン品質の監査人です。Android / iOS / Web 全てを考慮して厳格に採点してください。**

### 採点の原則

**①「AI改善可能」か「人間対応必要」かの判断を正確に行う。**

- AI改善可能 = トークン値の変更・数値調整（コントラスト、サイズ）・仕様と文言の追記・コンポーネント定義など
  → 20 ループで自動改善を試みる
- 人間対応必要 = UX戦略の良し悪し・KPIに対する妥当性・人間センスと関連（美的判断・ブランド）
  → 21 人間ゲート（全画面HTMLレビュー）でフィードバックを受ける

（曖昧な場合はAI改善可能に分類する。試みて失敗した方が情報が増える。）

**②減点は必ず具体化**

各減点に必ず具体的な理由を書く（例）：
- 「design_system: -2点 → ホーム画面のリストアイテムのhover状態でcolor.primaryの直接値（#3B82F6）を使っており、トークン参照（{color.primary}）になっていない」

**③ 点数インフレ禁止**

「だいたい書いてあるから満点」は禁止。
Layer 1（技術・アクセシビリティ軸）は数値・定義が揃っているかの客観チェック。満点は「完全に揃っている」場合のみ。

### Operating Principle 4 — Disambiguation（本 step = AI 採点 / flavor b）

採点は確定済の review 結果・wcag-mapping・coverage-check から導く **AI 判断 step**。`scores.json` を
Write する直前に `docs/principle4-disambiguation.md` §1 Step 3 の Flavor (b) を適用する:
「AI改善可能 / 人間対応必要」の分界や NFR の automated / deferred 分類が **根拠（rubric 定義・確定要件）に
裏付けられているか** を自問する。既定では「曖昧なら AI改善可能」に倒す（上記①）が、**分界自体が割れて
判断不能な NFR / tag** は (D) UNCERTAIN として `artifacts/{app_name}/pending-questions.json` に append
（必須 field: `target` / `question` / `raised_by_step="19-rubric-score"` / `raised_at` [ISO 8601] —
⚠️ 省くと hook R3 が exit 2 で Write を弾く）し、Step 21 人間ゲートで確認する。確定済の rubric / 要件は再質問しない。
この entry に **`reflect_to`（回答の反映先 artifact の `artifacts/{app_name}/` 相対パス）は書かない** — 本 step の
反映先は `scores.json` であり、どの phase の `target_artifacts` にも受け手が無いため。未設定 = 次の門で必ず
ask される従来挙動（`skills/_shared/preflight-gate.md` § append 経路）。

---

## 実行指示

18 の評価結果と以下の Read-only 入力を参照して採点する。本 step は wcag-mapping.json / wcag-history.json / 00-coverage-check.json / 00-screen-nav.json のいずれにも書き込まない (scores.json のみ更新)。

- `artifacts/{app_name}/wcag-mapping.json` (constraints/criteria)
- `artifacts/{app_name}/screens/00-coverage-check.json` (Step 14 早期チェック結果。生成 HTML 段階で再評価する起点として参照。`layers.l5_connectivity` も含む)
- `artifacts/{app_name}/screens/00-screen-nav.json` (各画面の入口/出口 派生ビュー。L5 connectivity 再評価の参照。存在しない legacy では `.mmd` を直接参照)
- `artifacts/{app_name}/screens/color-lint-report.json` の **`summary` セクションのみ** (Step 18 Layer 0-CSS が生成。full JSON は読まない)。**鮮度ガード (必須)**: `generated_at` が当該ループで生成した HTML より古い場合は stale — Step 18 の `--report` 未実行として扱い、採点せずに `--report` の実行を要求する (stale summary を信じると減点が実態と乖離する。4ロールレビューで stale fixture による `other_violations: 0` 誤信の実例あり)

### Layer 1: 技術・アクセシビリティ軸（40点）

| 評価項目                    | 配点   | 採点基準                                |
|-------------------------|------|-------------------------------------|
| デザインシステム適用率             | 10pt | tokens.json のトークンが全コンポーネントで参照されているか。**機械サブ基準 (summary の数値だけで決定的に計算する)**: ① zero-literal 違反 = `−min(5, summary.literal_colors)` ② 未解決 var = `−min(3, summary.unresolved_vars_excl_promotion)`（昇格候補は除外済の専用 field を使う） ③ `summary.other_by_type` から型別固定値: `var_in_presentation_attr` 非ゼロ → −2 / `external_stylesheet` 非ゼロ → −2 / `illustration_canon_mismatch` 非ゼロ → −4 / `root_vars_incomplete` 非ゼロ → −2（本来は生成時 `--check`（17/29）が hard・exit 1 で止めるため発火しない。発火した＝**lint 起動規約が破られた証拠**であり、まさに backstop が必要な瞬間 — E2E で起動規約の破れが実例化したため非減点から減点に転換、4ロールレビュー MAJOR-1）。合計は本軸 10pt 内で 0 に clamp（他軸へカスケードしない）。**減点しないもの**: `icons_with_variance` / `unmatched_svgs` / `promotion_queue` / `boundary_violations` / `extra_root_vars`（人間判断項目 — Step 21 Section 1-D で color-lint-report.html を提示して判断、`type: "人間対応必要"` タグで記録）。AI改善可能タグの `detail` には summary の該当値と修正先（`var(--…)` 置換 / 正典修正 §11.6 準用）を明記する。本式が減点の **SoT**（Step 18 は本欄を参照） |
| コントラスト（1.4.3）           | 10pt | テキスト 4.5:1 達成: 10pt / 未達: 0pt       |
| タイポグラフィ一貫性              | 10pt | フォントサイズ・ファミリーがトークン経由か               |
| インタラクション要素（2.4.7/2.5.8） | 10pt | フォーカスリング + 44px 両方達成: 10pt          |

### Layer 2: ユーザビリティ・マルティプラットフォーム軸（30点）（main 視点）

| 評価項目            | 配点  | 採点基準(Nielsen原則)                                    |
|-----------------|-----|----------------------------------------------------|
| 状態可視性 & フィードバック (main 視点) | 6pt | **default HTML 1 枚** に対して評価: 状態遷移トリガー (CTA / 非同期処理起点) が default 上に明確に置かれているか・仕様書 (.md) に sub-state の振る舞いが記述されているか・default 状態の即時反応 UI (toast/banner/inline-feedback) のスロットが確保されているか。画面パターン網羅性 (L1〜L4) は **main 視点に限る** (下記参照)。**sub-state HTML 横断の状態網羅評価は Step 25c (state-pattern-score) で実施** |
| ナビゲーション & 操作性   | 6pt | CTAが明確か・戻る動作が自然か・画面のエントリーポイントと終了点が明確か        |
| 一貫性 & 標準        | 5pt | UIパターンが統一されているか・用語・ラベルが統一されているか・プラットフォーム標準と一致しているか |
| エラー設計（予防・回復）    | 5pt | エラーを事前に防げているか・エラー内容が理解できるか・復帰手段があるか (仕様書記述レベルで評価。実 HTML での error 状態評価は Step 25c) |
| 認知負荷 & 学習性      | 4pt | 情報量が適切か・ユーザーが覚える必要がない設計か・初見でも操作できるか                |
| Platform準拠      | 4pt | Android(Material)・iOS(HIG)・Web(Browser UX)         |

#### 画面パターン網羅性（L1〜L4）— Layer 2「状態可視性 & フィードバック」のサブ評価（main 視点）

**参照スペック**: `docs/screen-coverage-check.md`（4レイヤー判定基準・コンテンツ差し替え原則・出力分類の単一正典）

Step 14 で生成した `00-coverage-check.json` を起点に、Step 17 で生成された **main (default) HTML** に対して L1〜L4 を **main 視点で** 再評価する。Step 14 早期チェックは画面リスト時点での予防、本ステップは**main HTML 生成後の最終確認** (default 状態が伝える情報設計が L1〜L4 のニーズに応えているか)。

> **Step 25c への移管**: sub-state HTML (empty/loading/error 等) の観点で coverage_check を再走するのは **Step 25c (state-pattern-score) の責務**。Step 25c は `state-pattern-scores.json.attempts[].coverage_check` (`coverage-check.schema.json#/$defs/layer_result`) に sub-state 視点の評価を append する。本 step の `scores.json.current.coverage_check` は **main 視点に限定** され、両者は単一所有権原則のもと別ファイルで管理される。

| Layer | チェック内容 (main 視点) | 由来 |
|---|---|---|
| **L1** | 5 UI States のうち「default (Ideal)」状態が「DS吸収以外で必要な画面」に揃っているか。Loading/Empty/Partial/Error は **仕様書 (.md) 記述レベル** での網羅をチェックする (HTML 化網羅は Step 25c) | Scott Hurff |
| **L2** | アクション結果画面（ボタン押下後の状態変化）の default 表現が画面リストに存在するか | 独自 |
| **L3** | マルチステップフロー終端画面の有無 | 独自 |
| **L4** | コンテンツ差し替え原則で「差し替えだけでは成立しない画面」が抜けていないか | 独自 |

**減点判定** (main 視点):

- 各 Layer の `missing[]` に「個別画面化」または「テンプレート代表1枚」が必要な default 画面がある場合、それぞれ通常の減点ルール（Impact × Scope × Frequency）を適用
- 画面パターン抜けは典型的に **Impact: High（フローが完結しない）、Scope: Local〜Multiple、Frequency: Always** → 1件あたり -3〜-5点
- 全件の減点合計を Layer 2「状態可視性 & フィードバック」軸（6pt）から優先的に差し引く。**この軸の 6pt を使い切った場合の残余は Layer 2 の他軸へカスケードせず、`coverage_check.overflow_deduction` フィールドにマイナス値で記録する**（タグ `screen_coverage` を付与）
- DS吸収に分類されたものは減点対象外
- **sub-state HTML 視点での missing は Step 25c で評価** (本 step では加味しない)

**スコアへの集計（layer2.score / ai_improvable_deductions）** — 本 skill 内の単一 SoT:

- `layer2.score = max(0, raw_layer2_score - applied_deductions)`（負値は許容せず 0 で clamp）
- `ai_improvable_deductions = (40 - layer1.score) + (30 - layer2.score) + |coverage_check.overflow_deduction| + |nfr_coverage.deductions_applied| + |connectivity_check.deductions_applied|`
- すなわち overflow 分・NFR 未対応分・L5 connectivity の HTML 修正可能分 は ai_improvable_deductions に**加算**し、Step 20 のループ判定 `current.ai_improvable_deductions == 0` を正しく反映させる
- `connectivity_check.deductions_applied` は **`fix_hint == back_affordance`（HTML 修正可能）な L5 defect のみ**を計上する。`.mmd` 構造系 defect（`fix_hint == mmd_edge` / `wire_new_screen`）は Step 20 の HTML 再生成ループで直せないため計上せず、`tags[]` に `fix_location: "mmd_structure"` で記録し Step 14 へ route する（chrome_plan と同型、下記「画面の入口/出口」セクション参照）
- `nfr_coverage.deductions_applied` の詳細は本 skill の「NFR Coverage 評価」セクション (dual-theme × domain 拡張) 参照
- **重複定義禁止**: `ai_improvable_deductions` の公式は本セクションを唯一の SoT とする。下の「AI/人間タグ付け」セクション (公式再掲しない、本セクションを参照する形式に統一)

> ⚠️ 既知の注意: `refs/rubric.json` の Layer 2 では同等の評価軸が「フィードバック・状態表示 (max 10pt)」として定義されている。configuration と実行プロンプトの軸名・配点ズレは別 PR で整理予定。本 step では SKILL.md の 6pt 軸定義を採用して評価する。

**scores.json への記録**:

`current.coverage_check` フィールドを追加し、`tags[]` に `screen_coverage` タグの減点を明示する。

```json
{
  "current": {
    "coverage_check": {
      "evaluated_at": "<ISO8601>",
      "missing": {
        "l1": 0,
        "l2": 1,
        "l3": 0,
        "l4": 0
      },
      "deductions_applied": -4,
      "overflow_deduction": 0,
      "details": [
        {
          "layer": "l2",
          "screen": "パスワード再設定",
          "issue": "再設定完了画面が抜けている",
          "classification": "個別画面化",
          "deduction": -4
        }
      ]
    }
  }
}
```

これにより Step 20 のループ判定で `ai_improvable_deductions > 0` となり、Step 17 への自動再生成（追加画面の補完）がトリガーされる。

#### 画面の入口/出口（L5 connectivity）— Layer 2「ナビゲーション & 操作性」のサブ評価

**参照スペック**: `docs/screen-coverage-check.md` §4-5（L5 connectivity 判定基準・検出 5 ルール・chrome 連携・fix_hint routing の単一正典）。

Layer 2「ナビゲーション & 操作性」軸は「画面のエントリーポイントと終了点が明確か」を含む。Step 14 が `00-coverage-check.json` の `layers.l5_connectivity.defects[]` に書いた検出結果を起点に、生成済み HTML + `00-screen-nav.json`（派生ビュー）/ `.mmd` に対して **各画面の入口（遷移元）/出口（戻り先・前方遷移）が成立しているか**を再評価する。到達できない／戻れない／リンク切れ／未配線の画面はアプリとして成立しないため減点する。

**減点判定**:

- 入口/出口 defect は典型的に **Impact: High（到達不能・戻れない＝フローが完結しない）、Scope: Local〜Multiple、Frequency: Always** → 1 件あたり -3〜-5 点。
- 減点合計は Layer 2「ナビゲーション & 操作性」軸（6pt）から差し引く。
- **fix_hint による routing（最重要）**:

| `fix_hint` | 分類 | 計上先 | type / fix_location |
|---|---|---|---|
| `back_affordance`（戻り先は親で確定するが HTML に戻る導線が無い） | **AI改善可能** | `connectivity_check.deductions_applied` に計上 → `ai_improvable_deductions` に加算（Step 20 が Step 17 HTML 再生成で対処） | `type: "AI改善可能"`（`fix_location` 無し） |
| `mmd_edge` / `wire_new_screen`（`.mmd` 構造の不足エッジ・未配線） | **人間対応必要扱い（.mmd 構造修正）** | `connectivity_check.deductions_applied` に**含めない**（Step 20 の HTML ループでは直らない） | `type: "人間対応必要"` + `fix_location: "mmd_structure"`（Step 21 で提示 → Step 14 で `.mmd` 補完）|

> **chrome_plan と同型の設計**: `.mmd` 構造系 defect は Step 17 HTML 再生成では直せず、`.mmd`（Step 14 所有）の修正が必要。そのため `fix_location: "mmd_structure"` を付けて `ai_improvable_deductions` に積まず、Step 21 人間ゲートで提示して承認者が Step 14 再実行を判断する（chrome_plan routing と完全に対称）。

**scores.json への記録**: `current.connectivity_check` フィールドを追加（schema: `schemas/scores.schema.json`）し、`tags[]` に該当タグを追加する。

```json
{
  "current": {
    "connectivity_check": {
      "evaluated_at": "<ISO8601>",
      "defects": { "dangling_edge": 0, "orphan_in_list": 1, "unreachable": 0, "dead_end": 1, "back_target_missing": 0 },
      "deductions_applied": -4,
      "details": [
        { "screen": "再設定完了", "defect_kind": "dead_end", "detail": "完了後の戻り先 HTML 導線が無い", "fix_hint": "back_affordance", "deduction": -4 },
        { "screen": "08-notification-detail", "defect_kind": "orphan_in_list", "detail": ".mmd に未配線でどの画面からも開けない", "fix_hint": "wire_new_screen", "deduction": 0 }
      ]
    },
    "tags": [
      { "item": "connectivity_back_affordance", "type": "AI改善可能", "detail": "再設定完了画面に戻る導線が無い (-4)" },
      { "item": "connectivity_orphan", "type": "人間対応必要", "fix_location": "mmd_structure", "detail": "08-notification-detail が .mmd 未配線 → Step 14 で配線が必要" }
    ]
  }
}
```

> `deductions_applied` には `back_affordance` 分（上記 -4）のみが入り、`wire_new_screen` 分（route のみ、deduction: 0）は含まれない。これにより Step 20 ループは HTML で直せる分のみ自動修正を試み、`.mmd` 構造系は人間ゲート経由で Step 14 に送られる。

### NFR Coverage 評価 (dual-theme × domain 拡張)

`requirements/06-non-functional.md` の全 NFR を 1 件ずつ評価し、`scores.json.current.nfr_coverage` に書き出す。汎用 WCAG criteria (Layer 1 contrast / interaction) では拾えない **ドメイン固有 NFR / 測定系 NFR / 実装段階 NFR** の見落としを防ぐための独立した評価軸。

> **設計判断 (1)**: Layer 1〜3 の 100 pt 配分は破壊せず、`nfr_coverage.deductions_applied` を ai_improvable_deductions に **加算** する形 (既存の `coverage_check.overflow_deduction` と同型) で実装する。これにより skill 20 のループ判定 (`ai_improvable_deductions == 0`) が NFR 漏れを自然に検出する。

> **設計判断 (2): NFR ↔ artifact 対応の単一窓口モデル**: 各 artifact (design-brief.yaml.cases[].palette.domain_surfaces[].contrast_pairs[] / wcag-history.json.violations[] 等) には **NFR 識別子の back-link フィールドを持たせない**。NFR との対応関係は本 NFR Coverage 評価が `requirements/06-non-functional.md` を起点として artifacts を能動的に scan して導出する。これによりフィールド hyperlink の量産を防ぎ、NFR 対応の網羅性チェックを 1 箇所 (本 skill 19) に集約する。逆引き失敗時は `unaddressed` として記録され ai_improvable_deductions に積まれるため、対応漏れは loop で検出される。

#### 評価手順

1. `requirements/06-non-functional.md` を Read し、表セルから NFR-XX 形式の全 NFR を抽出する (id + 1 文要約)
2. 各 NFR を以下 4 状態のいずれかに分類:

| status | 判定基準 | 検証 evidence |
|---|---|---|
| **automated_verified** | pipeline 中の機械検証 step (skill 11 / skill 14 / skill 19 自身) で pass している | `wcag-history.json attempts[-1].violations` 該当 0 件 / `coverage-check.json layers.lN.missing` 該当 0 件 / `tokens.json` のキー存在等 |
| **human_attested** | 生成 HTML から目視で確認可能だが pipeline 機械検証は無い。Step 21 human gate で人間がチェック | "skill 21 で 32 HTML を目視確認" + 確認項目 |
| **deferred** | Phase 3 では検証不能。実装段階 (Phase 4+) or 別パイプライン (perf 計測 / SR テスト等) で評価 | 想定検証 phase + 理由 |
| **unaddressed** | 検証メカニズムが一切なく、Phase 3 で対処もできない (理論上 retro で skill 02 改修して対応) | 不在の説明 |

3. 判定の半経験則 (skill 19 内部で適用):

| NFR テキストの特徴 | 推定 status |
|---|---|
| "WCAG" + criterion 番号 / "contrast" + ratio | automated_verified (wcag-history.json で照合) |
| "44" or "タッチ領域" + 数値 | automated_verified (wcag-mapping.json constraints.touch_target_size) |
| 状態 (default) 網羅 (main 視点) | automated_verified (coverage-check.json — main HTML 観点での画面パターン網羅) |
| 状態 (loading/empty/error) 網羅 (sub-state 視点) | **deferred to Step 25c** — 本 step では automated_verified に含めない。Step 25c が `state-pattern-scores.json` に書く coverage_check を NFR 検証として参照する (将来統合候補) |
| 両モード / dual_theme / prefers-color-scheme | automated_verified (tokens.json で全 color token が `modes.dark` + `modes.light` の対称 nested 構造を持ち、両 mode のキー集合が完全一致することを確認 — symmetric D1-a) |
| 形状 / 識別 / shape / 区別 + 図形要素 | human_attested (Step 21 で目視) |
| アニメ duration / モーション / カテゴリ統一 | human_attested (生成 HTML の transition / animation 直接確認) |
| 起動 / レスポンス + ms / 秒 (perf) | deferred (Phase 4 lighthouse / Profile) |
| スクリーンリーダー / aria / accessible name | human_attested で限定的に評価 (aria-label の存在は機械検出可)、本質的には deferred |
| バンドル / ファイルサイズ / KB / MB | deferred (build 後計測) |
| 技術スタック (Kotlin / Compose / React 等) | deferred (実装段階で確認) |
| 国際化 / i18n / リソース化 | deferred (実装段階) |
| 効果音 / ハプティック / OS API | deferred (実装段階) |
| 上記いずれにも該当しない | unaddressed として記録 + retro で人間判断要請 |

4. スコア算出:

```
unaddressed_count = len(filter(status == "unaddressed"))
deductions_applied = -3 × unaddressed_count   // 1 件あたり -3 (重大要件取り零し)
                                              // ただし下限 -30 で clamp

ai_improvable_deductions += abs(deductions_applied)
```

`human_attested` / `deferred` は ai_improvable_deductions に積まない (前者は Step 21 ゲートで人間判断、後者は Phase 4 retro 対象、いずれも自動修正対象外)。

#### scores.json への記録

```json
{
  "current": {
    "nfr_coverage": {
      "evaluated_at": "<ISO8601>",
      "source": "requirements/06-non-functional.md",
      "summary": {
        "total_nfrs": 41,
        "automated_verified": 6,
        "human_attested": 8,
        "deferred": 25,
        "unaddressed": 2
      },
      "deductions_applied": -6,
      "details": [
        {
          "nfr_id": "NFR-16",
          "title": "WCAG 2.2 AA 準拠 (両モードで 4.5:1 / 3:1)",
          "status": "automated_verified",
          "evidence": "wcag-history.json attempts[2] violations: [] (palette + state_colors + domain_surface 全 pair pass)"
        },
        {
          "nfr_id": "NFR-17",
          "title": "黒駒/赤駒は形状でも区別 (色弱配慮)",
          "status": "human_attested",
          "evidence": "Step 21 human gate で 32 HTML の SVG 駒形状を目視確認",
          "note": "現状 piece-black/red は SVG circle 単一形状。色弱者にとって区別不能のリスク"
        },
        {
          "nfr_id": "NFR-01",
          "title": "着手の合法性判定 ≤50ms",
          "status": "deferred",
          "evidence": "Phase 3 では Profile 不能",
          "phase_target": "Phase 4 / implementation"
        }
      ]
    },
    "tags": [
      { "item": "nfr_coverage_NFR-17", "type": "人間対応必要", "detail": "..." },
      { "item": "nfr_coverage_unaddressed", "type": "AI改善可能", "detail": "..." }
    ]
  }
}
```

human_attested の NFR は `tags[]` に `type: "人間対応必要"` で追加 (Step 21 ゲートで提示)。unaddressed は `type: "AI改善可能"` (Step 17 ループで対処を試みる、ただし skill 17 が NFR-specific 対応できる範囲は限られる — 多くは結局 retro 改修対象)。

### Layer 3: デザイン性・ビジネス軸（30点）

| 評価項目       | 配点  | 採点基準                    |
|------------|-----|-------------------------|
| 審美的品質      | 7pt | デザインブリーフの方向性と整合しているか    |
| レイアウト・余白   | 7pt | spacing トークンが適切に使われているか |
| ブランドコヒーレンス | 7pt | 全画面でトーン&ムードが統一されているか    |
| KPI適合性     | 6pt | CTA最適化されているか            |
| 離脱リスク      | 3pt | UX摩擦がないか                |

**デザイン性の採点の具体的基準（`design-brief.yaml.cases[selected_sample_id]` を参照して判定）:**
1. `concept` / `narrative.visual_theme` で定義されたキーワード（例：「高級感」「ミニマル」「計器機能美」）が全画面の仕様書に反映されているか
2. `common.hearing.avoid_styles` に該当する要素が含まれていないか
3. `common.hearing.reference_apps` として挙げたアプリのUIパターンが意識されているか

**ビジネスの採点はstep-18-design-review.mdの収集データを参照**

### 減点ルール

**基本原則**

減点は以下3軸で決定する：
- 影響度（Impact）
- 影響範囲（Scope）
- 頻度・再現性（Frequency）

**減点スコア算出式**

Deduction = Impact × Scope × Frequency

**①影響度（Impact）**

| レベル    | 定義        | 減点係数 |
|--------|-----------|------|
| High   | 離脱・主要機能停止 | 3    |
| Medium | UX悪化・操作ミス | 2    |
| Low    | 軽微な視覚ズレ・局所的な違和感（タスク遂行に支障なし） | 1    |

**②影響範囲（Scope）**

| レベル      | 定義        | 減点係数 |
|----------|-----------|------|
| Global   | 全画面＆コアフロー | 3    |
| Multiple | 複数画面      | 2    |
| Local    | 個別画面      | 1    |

**③頻度・再現性（Frequency）**

| レベル    | 定義      | 減点係数 |
|--------|---------|------|
| Always | 常に発生    | 3    |
| Often  | 条件付きで頻発 | 2    |
| Rare   | 稀・偶然的   | 1    |

**減点値の解釈**

| 計算結果  | 減点      |
|-------|---------|
| 1〜2   | -1点     |
| 3〜5   | -2点     |
| 6〜8   | -3〜-4点  |
| 9〜12  | -5〜-6点  |
| 13〜17 | -6〜-7点  |
| 18以上  | -8〜-10点 |

**具体例**

```
例①：ローディング未定義（致命的）
Impact: High（離脱）
Scope: Global（全画面）
Frequency: Always
→ 3 × 3 × 3 = 27
→ -10点

例②：戻る挙動不一致（Platform問題）
Impact: Medium
Scope: Multi
Frequency: Often
→ 2 × 2 × 2 = 8
→ -4点
```

### 3Layer別適用ルール ###

**Layer 1（技術・アクセシビリティ）**

- 数値基準違反は最低 -5点
- WCAG違反は自動High扱い

**Layer 2（UX・MultiPlatform）**

- ナビゲーション / 状態欠如はHigh
- Platform違反は最低Medium以上

**Layer 3（デザイン + ビジネス）**

- KPI影響はHigh
- 審美問題はLow〜Medium

**重複減点防止ルール**

同一Root Causeの問題は統合する：

❌ NG
- ローディング未定義 ×3画面 → -15点

✅ OK
- ローディング未定義（Global） → -10点

**強制ルール**

- 各減点は必ず Impact / Scope / Frequency を明示
- 感覚的減点は禁止
- 例外的減点は理由必須

### AI/人間タグ付け

- **AI改善可能**: Layer 1（技術・アクセシビリティ軸）・Layer 2（UX・MultiPlatform軸）の減点（トークン差し替え・仕様変更で修正可能）
- **人間対応必要**: Layer 3（デザイン性・ビジネス軸）の減点（デザイン判断・美的センスが必要）

減点ごとにタグを付与する。

- `ai_improvable_deductions` の公式は上記「スコアへの集計（layer2.score / ai_improvable_deductions）」セクションを単一 SoT とする (重複定義を避けるため本セクションでは公式を再掲しない、5 項式: layer1 + layer2 + |overflow_deduction| + |nfr_coverage.deductions_applied| + |connectivity_check.deductions_applied|)。
- `human_required_deductions` は本タグ付け文脈で固有のため本セクションで定義:

```
human_required_deductions = (30 - layer3.score)
```

> **重要**: `coverage_check.overflow_deduction` は Layer 2「状態可視性 & フィードバック」軸 (6pt) を使い切ってもなお残る画面カバレッジ減点の累積分。`layer2.score` は 0 で clamp されるため、その超過分は **ai_improvable_deductions に加算** することで Step 20 のループ判定が `screen_coverage` 改善余地を正しく拾う。詳細は上記「画面パターン網羅性 — Layer 2 サブ評価」セクション参照。

### chrome（共通部品）指摘の分類

減点が **共通部品（chrome = ボトムメニュー / ヘッダー）** を対象とする場合、その chrome は `_shared/components.html` / `components.css` の **正典** から全画面へ逐語ペーストされている（`docs/html-generation-rules.md` §11）。**修正先は常に正典であり、個別画面ではない**。Step 20 ループ / Step 17 再生成がこれを誤って個別画面で直すと §11.5 の self-check が abort する（脱出不能ループの原因）。これを防ぐため、chrome 減点には **`fix_location` フィールドを付与して修正先を明示** する。

chrome 減点は §11.6 の 2 分類に従って判定する:

| 種別 | 例 | type | `fix_location` | Scope（減点式） |
|---|---|---|---|---|
| **chrome の見た目 / 品質** | ボトムタブのアイコン線が細い・ヘッダータイトルが小さい・nav の padding-bottom が不適切・chrome 内コントラスト不足 | **AI改善可能** | `"chrome_canon"` | 本質的に **Global**（正典は全 chrome 画面に伝播するため。重複減点防止ルールにより画面数分は積まず Global 1 件で計上） |
| **chrome の IA（情報設計）** | タブ項目の入れ替え（「動画」↔「マップ」）・アイコンの意味的変更（地図→ピン）・ラベル名・ヘッダー A/B 割り当ての妥当性 | **人間対応必要** | `"chrome_plan"` | （IA 判断のため減点式の対象外。人間ゲート行き） |

- `fix_location: "chrome_canon"` は **AI改善可能** に分類し `ai_improvable_deductions` に積む。ただし **修正先は正典（Step 0b の `components.html`/`components.css`、値が token 由来なら `root-variables.css`）** であることを `detail` に明記する（例: "ボトムナビのアイコン stroke-width が細い → components.css の nav svg stroke-width を正典で +0.5 して全画面再ペースト"）。
- `fix_location: "chrome_plan"` は **人間対応必要** に分類し、`ai_improvable_deductions` に **積まない**（Step 20 ループの自動修正対象にしない）。Step 21 人間ゲートで提示し、承認者が chrome プラン（Step 14）更新を判断する。
- chrome 以外の通常減点には `fix_location` を付与しない（省略 = 通常の個別画面修正）。

`tags[]` への記録例:

```json
{
  "tags": [
    { "item": "chrome_nav_stroke", "type": "AI改善可能", "fix_location": "chrome_canon",
      "detail": "ボトムナビのアイコン stroke-width が 1.5 で細く見える → components.css の `.mobile-bottom-nav svg { stroke-width }` を正典で調整し全画面へ再ペースト（個別画面では直さない）" },
    { "item": "chrome_tab_item", "type": "人間対応必要", "fix_location": "chrome_plan",
      "detail": "2 番目のタブ「動画」がコア IA と合わない可能性 → Step 14 chrome プランの見直しを Step 21 で人間判断" }
  ]
}
```

## 出力

`artifacts/{app_name}/scores.json` を更新する：

```json
{
  "current": {
    "layer1": {
      "score": 32,
      "max": 40,
      "breakdown": {
        "design_system": 8,
        "contrast_1_4_3": 10,
        "typography": 8,
        "interaction": 6
      }
    },
    "layer2": {
      "score": 24,
      "max": 30,
      "breakdown": {
        "visibility & feedback": 5,
        "navigation & usability": 5,
        "consistency & standard": 5,
        "error_design": 3,
        "cognitive & learning": 3,
        "platform_compliant": 3
      }
    },
    "layer3": {
      "score": 22,
      "max": 30,
      "breakdown": {
        "aesthetic": 5,
        "layout": 5,
        "brand": 5,
        "KPI": 4,
        "exit": 3
      }
    },
    "total": 78,
    "ai_improvable_deductions": 8,
    "human_required_deductions": 14,
    "coverage_check": {
      "evaluated_at": "2026-05-13T12:00:00Z",
      "missing": { "l1": 0, "l2": 1, "l3": 0, "l4": 0 },
      "deductions_applied": -4,
      "overflow_deduction": 0,
      "details": [
        {
          "layer": "l2",
          "screen": "パスワード再設定",
          "issue": "再設定完了画面が抜けている",
          "classification": "個別画面化",
          "deduction": -4
        }
      ]
    },
    "connectivity_check": {
      "evaluated_at": "2026-05-13T12:00:00Z",
      "defects": { "dangling_edge": 0, "orphan_in_list": 0, "unreachable": 0, "dead_end": 1, "back_target_missing": 0 },
      "deductions_applied": -4,
      "details": [
        { "screen": "再設定完了", "defect_kind": "dead_end", "detail": "完了後の戻る導線が HTML に無い", "fix_hint": "back_affordance", "deduction": -4 }
      ]
    },
    "tags": [
      { "item": "interaction_focus_ring", "type": "AI改善可能", "detail": "フォーカスリングの offset が未指定" },
      { "item": "screen_coverage", "type": "AI改善可能", "detail": "L2: パスワード再設定の完了画面が抜けている (-4)" },
      { "item": "connectivity_back_affordance", "type": "AI改善可能", "detail": "L5: 再設定完了画面に戻る導線が無い (-4)" },
      { "item": "brand_coherence", "type": "人間対応必要", "detail": "トーンの統一感が弱い" }
    ]
  }
}
```

また、現在のスコアを **lightweight summary 形式** で `history[]` 配列に push する (full attempt 構造ではなく、retrospective view 用の 1 行サマリ。schema: `schemas/scores.schema.json` の root `history` 参照):

```json
{
  "attempt": <attempt_count>,
  "evaluated_at": "<ISO 8601>",
  "total": <0-100>,
  "ai_improvable_deductions": <整数>,
  "summary": "Layer 1 N/40, Layer 2 N/30, Layer 3 N/30 (主減点要因 1 行)"
}
```

> Phase 1b (`scoring-history.json.attempts[]` で full check_results を持つ) や Phase 2 (`wcag-history.json.attempts[]` で full violations を持つ) と異なり、Phase 3 は full attempt history を持たない (本ファイル `current` で最新 attempt の full snapshot のみ保持)。`history[]` はあくまで lightweight な retrospective trace。

## 完了後
「19 ルーブリック採点が完了しました。20 フィードバックループ制御へ進みます。」
→ `skills/20-loop-design/SKILL.md` を Read して 20 を実行
