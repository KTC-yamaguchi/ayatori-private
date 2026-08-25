---
name: 18-design-review
description: 生成された画面仕様と main（default）HTML を 4 観点（UX / Platform / Accessibility / Business）＋3 層ルーブリックで評価するためのデータを収集する。Phase 3 Step 18 として Step 19 の採点に渡す。
---

# 18 デザインレビュー（main HTML 視点）

## 役割
生成された画面仕様 (`{画面名}.md`) と **main (default) HTML 1 枚** を4観点（UX / Platform / Accessibility / Business）＋3層ルーブリックで評価するためのデータを収集する。

> **sub-state 評価の縮退**: 本 step は Step 17 が生成した **default 状態の HTML 1 枚** に対してレビューを行う。empty / loading / error 等の sub-state HTML 横断評価 (4 状態網羅 / 状態間一貫性) は **Step 25c (state-pattern-score) に移管された**。本 step では仕様書 (.md) に全状態の振る舞いが記述されているかは確認するが、HTML としての sub-state 評価は行わない。

## エージェントプロンプト

このステップを実行するとき、以下のプロンプトを自分自身への指示として適用すること。

---

**あなたはWCAG・ユーザビリティ・クロスプラットフォーム設計（Android / iOS / Web）・ビジネスUXに精通したシニアUXレビュアーです。**

生成された画面仕様書を以下の4観点から評価してください：
UX原則（ヒューリスティック）
プラットフォーム標準（Android / iOS / Web）
アクセシビリティ（WCAG）
ビジネス適合性（KPI / 離脱リスク）

### レビューの原則

**「書いてある」と「実現できている」は別物。**

仕様書に「コントラスト4.5:1確保」と書いてあっても、実際のカラー組み合わせでそれが達成されているか検証すること。

**ニールセンの発見的評価を適用する (main HTML 視点)。**

特に以下の10原則のうち、この画面設計で問題になりやすいものを重点的に確認する。default 状態 1 枚で評価可能な観点に絞る:
1. システム状態の可視性 — **default 状態でローディング・完了・エラーへの導線・余地が想定されているか** (sub-state HTML での網羅評価は Step 25c に移管)
2. エラーの予防（誤操作防止の確認ダイアログ等）— 仕様書 (.md) 記述の十分性
3. エラーの認識・診断・回復（エラーメッセージが意味を持つか）— 仕様書 (.md) 記述の十分性
4. 一貫性と標準（全 default HTML 間でパターンが統一されているか）

**状態の振る舞い記述チェック (main 視点)**

main HTML 1 枚と仕様書 (.md) を見て、以下が **記述レベルで** 確認できるか:
1. API待ち（ローディング）→ 仕様書に振る舞いが記述されているか (HTML での状態遷移網羅評価は Step 25c に移管)
2. エラー発生時 → 同上
3. 成功時 → 同上
4. ナビゲーション遷移時 → default 画面の CTA 配置と遷移先 .md リンクが整合しているか

**減点は「なぜ問題か」を説明する。**
NG: 「フィードバックが不足」
OK: 「動画生成リクエスト後（HeyGen APIの処理時間は数十秒かかる可能性）にローディング状態が定義されていない。ユーザーが処理が止まっていると誤解してページを離脱するリスクがある」

---

## Figma MCP 分岐

> **Mode 判定は `skills/00-figma-mode-detect/SKILL.md` で一元化されている。** 独自の env var チェックは行わず、本スキルを呼び出して結果を取得する。

Read and execute `skills/00-figma-mode-detect/SKILL.md` to resolve `mode`:
- `mode == "enabled"`: Figma MCP で画面レイヤー読み取り → Layer 1 採点 / PNG エクスポート → Claude Vision → Layer 2-3 採点（下記 Figma MCP 実装を実行）
- `mode == "disabled"`: 以下のスタブ実装を実行する

## Figma MCP 実装（mode == "enabled" 時）

### node-id を使った安全な読み取り

1. `artifacts/{app_name}/figma-state.json` を読み込み、`nodes.screens` から各画面のエントリを取得する
2. **エントリ形式の正規化** (重要): `nodes.screens.{画面名}` の値は **2 形式** が混在しうる:
   - **新形式** (Step 22 以降): object `{node_id, platform, state, url}`
   - **旧形式** (legacy / 既存プロジェクト): string (node-id 直値)

   どちらの形式でも安全に node-id を取り出すために、必ず以下のタイプガードで抽出する:

   ```js
   const node_id = typeof entry === 'string' ? entry : entry.node_id;
   ```

   生の entry を `get_design_context` / `get_screenshot` に直接渡すと、object 形式の場合に `[object Object]` となり API エラーになる (Step 17→18 ループ 2 周目以降で顕在化)。
3. `get_design_context` または `get_screenshot` で **記録済み node-id のみ**を対象に読み取る
4. 記録されていない node-id のノードは読み取り対象外とする（手動デザインを誤参照しない）
5. 取得したスクリーンショットを Claude Vision で評価し、Layer 2-3 採点に使用する

### Layer 0: Figma Fidelity チェック（HTML vs Figma 整合性）

> **実装詳細は SKILL.md の「Layer 0」セクションを参照。** 以下はパイプラインコンテキスト。

**目的**: step-17 で生成した Figma フレームが HTML 画面仕様書のビジュアル設計と整合しているかを検証する。

**実行タイミング**: node-id 読み取り完了後、Layer 1 採点の前に実施する。

#### Layer 0 スキップ条件 (正常ケース)

**初回ループ (Step 22 Figma export 未実行) では Layer 0 をスキップして Layer 1-3 のみで採点を続行する**。これは「スタブモード」ではなく **正常運用パス**として扱う。

> ⚠ **用語注意 (A-6 修正)**: 旧版は本スキップを「Pattern A」と命名していたが、`schemas/feedback-log.schema.md` の Pattern A 定義 (= 人間ゲートが修正指示を返した) と意味衝突するため、本 skill 18 では **`[L0-SKIP-INITIAL]` (初回スキップ)** という独自マーカーを使う。feedback-log への記録は不要 (正常運用なのでログ不要)。

判定ロジック:

```js
const state = readJson('artifacts/{app_name}/figma-state.json');
const isFirstLoop =
  !state ||
  !state.nodes ||
  !state.nodes['component-library'] ||
  state.nodes['component-library'] === null ||
  Object.keys(state.nodes.screens || {}).length === 0;

if (isFirstLoop) {
  // [L0-SKIP-INITIAL]: 初回ループでは Figma 出力がまだないため正常スキップ
  reportLayer0As('[L0-SKIP-INITIAL] 初回ループ: figma-state.json.nodes.component-library 未設定のためスキップ');
  return; // Layer 1-3 へ進む
}
// Step 22 完了後の 2 周目以降は通常通り Layer 0 を実行
```

`figma-state.json.nodes.component-library` が `null` または不在の場合は `[L0-SKIP-INITIAL]` としてスキップし、`feedback-log.md` に「スタブモード」と記録**しない** (正常運用)。Step 22 完了後の 2 周目以降では Layer 0 必須に戻る。

> **設計根拠**: Phase 3 ループは Step 17→18→19→20→21 の繰り返しで、Step 22 (Figma export) は 21 承認後の単発実行。初回ループで Figma 出力がない状態を「失敗」扱いすると、毎周 feedback-log にノイズが入る (skill 18 ループ初回の Layer 0 スキップは正常ケース)。

**技術的回避不可能差異（除外）**: インタラクション状態 / JS 動的コンテンツ / SVG アイコン / スクロール挙動 / デバイスモックアップの有無

**実行手順の概要**:
1. 各 HTML ファイルを Read して主要 CSS プロパティの期待値を抽出する（フォント・背景色・ボーダー等）
2. `use_figma` Plugin API で対応 Figma フレームのノードプロパティを読み取る
3. 期待値と実測値を照合し `[L0-PASS]` / `[L0-FAIL]` / `[L0-EXEMPT]` で記録する
4. L0-FAIL の内容・件数に応じて −1〜−5点/件 を Layer 1〜3 採点に反映する

**出力**: Layer 1〜3 レポートの前に「## Layer 0: Figma Fidelity チェック」セクションとして配置する。

### Layer 0-B: JS 動的コンテンツ整合性チェック

> **実装詳細は SKILL.md の「Layer 0-B」セクションを参照。** 以下はパイプラインコンテキスト。

HTML の `<script>` ブロックが初期描画コンテンツを生成する画面（ブラケット・ランキング・フィード等）が含まれる場合に実行する。`node -e` で JS ロジックをシミュレートし、「ブラウザで HTML を開いた時点で表示されるべきテキスト・状態」と Figma カードの実際のテキストをサンプリング比較する。

JS 計算結果が表示されるべきコンポーネントが Figma で汎用プレースホルダーになっている場合は −3〜−5点。
該当しない場合は `[L0B-SKIP]` として省略する。

### Layer 0-C: アルゴリズムレイアウト整合性チェック

> **実装詳細は SKILL.md の「Layer 0-C」セクションを参照。** 以下はパイプラインコンテキスト。

JS 数式が y 座標・上余白・間隔を計算するレイアウト（ブラケット・ガントチャート等）が含まれる場合に実行する。`node -e` で座標計算をシミュレートして期待 y 座標を導出し、`use_figma` で取得した Figma ノードの実測 y 座標と照合する（許容誤差 ±2px）。アルゴリズムが決定するコンポーネントの配置インデックス位置も検証対象に含める。

`figma-manifest.json` の `layout_positions` が存在する場合はその値を期待値として使用する。
該当しない場合は `[L0C-SKIP]` として省略する。

## スタブ実装（Figma MCP 未接続時）

`artifacts/{app_name}/screens/` 配下の全 MD ファイルと `artifacts/{app_name}/wcag-mapping.json` (constraints/criteria 不変量、Read only) を読み込む。本 step は wcag-mapping.json / wcag-history.json のいずれにも書き込まない。

### Layer 0-CSS: 事前チェック（色トークン強制 lint）

> ⚠ **B-5 命名修正**: 旧版は本セクションも上の Layer 0 (Figma fidelity) も同じ "Layer 0" と命名されていて重複混乱の原因だった。本セクションは **Layer 0-CSS** に rename。Pattern A スキップ条件は上の Layer 0 (Figma fidelity) のみ対象。本 Layer 0-CSS は **常時実行** する。
>
> **改修経緯**: 旧版の手動 grep 手順（rgba 直書き / state color hex / トークン登録確認 の 3 検査。CSS プロパティのみ対象で **SVG `fill=`/`stroke=` 属性を取りこぼしていた**）は、決定論 lint script に置換・拡張された。検査の SoT は script 側 (zero-literal: hex / rgb() / hsl() / CSS 色名 × CSS プロパティ + inline style + SVG presentation 属性。旧 state color 検査も包含)。旧第 3 検査「トークン登録確認（:root 定義変数 ↔ tokens.json の突合）」は lint の対象外 — その整合は skill 17 P-15 の単方向フロー（tokens.json → root-variables.css → :root inline copy）+ root-variables self-check（変数個数一致）が予防し、乖離の事後検出は Step 24 A-2 diff が担う。

Layer 1 評価の前に、以下を実行する:

```bash
node scripts/lint-screen-colors.mjs --report artifacts/{app_name}
node scripts/render-color-report.mjs artifacts/{app_name}/screens/color-lint-report.json
```

1 つ目が `screens/color-lint-report.json`（derived report・毎回上書き）を生成し、2 つ目が人間用の `color-lint-report.html` を決定論的に生成する（手焼き禁止）。**full JSON を Read しない** — 必要な集計は 1 つ目のコマンドの **stdout 1 行（summary と同値）** で得られる。型別の値が要る場合のみ `node -e` 等で `summary` キーだけを抽出する（context 爆発防止。個別違反の詳細は Step 17 ループ再実行時に `--check` の stdout から取得できる）。

**summary の各値の扱い:**

| report 項目 | 分類 | 対応 |
|---|---|---|
| `literal_colors` / `literal_occurrences`（zero-literal 違反） | **AI改善可能** | 記録し減点（後述）。Step 20 ループ → Step 17 再生成で `var(--token)` / `currentColor` に置換 |
| `unresolved_vars`（typo / 外部 stylesheet 依存） | **AI改善可能** | 同上。`--color-illustration-*` の未解決だけは欠陥でなく**昇格候補**（下記） |
| `other_violations`（var_in_presentation_attr / external_stylesheet / illustration_canon_mismatch / root_vars_incomplete） | **AI改善可能** | 記録し減点。canon_mismatch の修正先は**正典**（§11.7、個別画面で直さない）。root_vars_incomplete の修正先は**当該 main の `:root`**（root-variables.css を丸ごと貼り直す） |
| `promotion_queue`（未承認の装飾色 `--color-illustration-*`） | **人間判断** | 減点しない。Step 21 ゲートで `color-lint-report.html` を提示 → 承認されたものは Step 24 Step A-2b が tokens.json に昇格 |
| `icons_with_variance`（同一アイコンの色ソース変動） | **人間判断** | 減点しない（active/hover 等の正当な文脈変化と機械区別できない）。Step 21 で「正当 / 統一」を人間が判断 |
| `unmatched_svgs`（正典化候補 or データ駆動） | **人間判断** | 減点しない。Step 21 で「正典化（Step 0c へ）/ データ駆動として容認」を判断 |
| `boundary_violations`（装飾色の load-bearing 転用疑い） | **人間判断（severity 高め）** | 記録。装飾色は WCAG 検証を通っていないため、文字・状態・操作要素への転用は通常パレットへ移す |
| `extra_root_vars`（台帳外の :root 色変数 — リテラル洗浄経路の可視化） | **人間判断** | 減点しない。Step 21 Section 1-D で「正当な画面固有値（足場 shadow 等）/ 台帳迂回の洗浄」を人間が判断（4ロールレビュー CRITICAL-1 対応） |

**減点（AI改善可能分）**: 数式の SoT は **skill 19 Layer 1「デザインシステム適用率」欄**（summary の数値だけで決定的に計算する 3 項式）。本 step は summary 値の記録までを行い、減点計算は 19 に委ねる（二重定義しない）。

### Layer 0-REQ: 要件トレース監査（要件外追加検出）

Layer 1 の前に、各画面 HTML / 仕様を `requirements.json`（+ `requirements/05-features.md` 等）と突合し、
**合意済み要件にトレースできない要素 / 文言 / データ前提**（AI が想像で補完したもの）を検出する。
手順詳細は `docs/principle4-disambiguation.md` §5。

- **機械列挙＋全件マップ (§5.2 forced-enumeration)**: 画面仕様書 (.md) の **component + 挙動 / インタラクション / 状態を列挙** し（component だけでなく「この画面が要件にない挙動 / 状態を持っていないか」も全件マップする。29 / 25c と列挙単位を揃える）、各要素を要件 (`requirements.json` / `05-features.md`) に **全件マップ**（「気づいた分だけ」でなく列挙全件を account、黙ってスキップ不可）。`requirement_ref` を埋められない要素が要件外。列挙総数を `coverage[]`（`phase="screens"`, `enumerated_count`, `enumerated_refs`）に記録する（**0 件でも必須**）。
- トレースできない / 根拠が薄い / 明示なく一般論で決め打ちした項目を
  `artifacts/{app_name}/requirement-deviations.json` の `entries[]` に append
  （`phase="screens"`, `raised_by_step="18-design-review"`, `deviation_kind`, `requirement_ref`(無ければ null),
  含意 (security/privacy 等) があれば `severity="high"`）。lazy 初期化 (Read or init-stub → append → Write)。
- append 後、`node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` を実行し `requirement-deviations-view.html`（人間用一覧）を決定論的に生成する（手焼き禁止、§5.4）。
- Layer 0-CSS（直書き検出）の隣の「要件トレース」lens。**生成は止めず検出・記録のみ**（防げないものを Step 21 で人間提示）。

### Layer 1: WCAG 2.2 AA チェックリスト評価（テキストベース）

各画面仕様書の「コンポーネント一覧」に記載された WCAG 準拠状況を確認する：

```
チェック項目:
□ 1.4.3: テキストコントラスト 4.5:1 以上が全画面で宣言されているか
□ 1.4.11: UI要素コントラスト 3:1 以上が全画面で宣言されているか
□ 2.4.7: フォーカスリングが全インタラクション要素に定義されているか
□ 2.5.8: 主要ボタンが 44px 以上、非主要ボタンが 32px 以上と宣言されているか（分類基準・判定フローは docs/wcag-standards.md §3 タッチターゲット参照）
□ タイポグラフィ階層: 階層が異なるテキストサイズ間の差が 2px 以上あるか
```

**「宣言あり」と判定した項目は、さらに内容を検証すること（形式チェックで終わらせない）:**
- 1.4.3: 宣言されたカラー組み合わせが `tokens.json` の `$description` 実測 ratio と矛盾していないか（contrast の SoT は tokens.json `$description` = Step 12 が `scripts/wcag-contrast.mjs` で計算・転記済。wcag-mapping.json は色非依存 constraints のみで計算結果を持たない。本 step は wcag-history.json を読まない [reader 台帳と整合]）
- 2.4.7: フォーカスリングのカラーが `tokens.json` の `color.focus-ring` トークンを参照しているか（直接値の記述はNG）
- 2.5.8: 各ボタンを「主要」「非主要」に分類し、それぞれの基準を満たしているか確認する（分類基準・判定フローは docs/wcag-standards.md §3 参照）
- タイポグラフィ階層: 使用されている全フォントサイズを昇順に並べ、隣接するサイズの差がすべて 2px 以上であるか確認する。差が 1px 以下のサイズが存在する場合は「階層が不明瞭」として記録する。

不一致を発見した場合は「宣言あり・内容不整合」として記録し、該当項目から -3〜-5点を減点すること。

---

**デエンファシステキスト（意図的低コントラスト）の扱い:**

1.4.3 チェックの前に、各テキスト要素が「デエンファシステキスト」に該当するか判定する。判定条件（3 条件 AND）と判定フローは `docs/wcag-standards.md` §3 コントラスト比 → デエンファシステキストの 3:1 緩和ルールを参照。

**18 における運用（減点幅）:**
- デエンファシス例外かつ 3:1 以上 → 合格（「デエンファシス例外」タグ付与）
- デエンファシス例外かつ 3:1 未満 → 減点（-2〜-3点）
- 通常テキストかつ 4.5:1 未満     → 減点（-3〜-5点）
- 緩和適用時も、実測比と 1.4.3 非準拠である事実は評価レポートに必ず記録する

---

**タッチターゲットサイズ（2.5.8）の分類ガイド:**

WCAG 数値閾値とロールベース分類（主要/非主要・3 条件・判定フロー）は `docs/wcag-standards.md` §3 タッチターゲット → ボタン主要/非主要のロールベース分類を参照。Step 18 ではさらに AYATORI 独自のロールベース分類を適用し、WCAG 最低ラインより厳しい基準で評価する。

**18 における運用（減点幅）:**
- 主要ボタンかつ 44px 未満   → 減点（-3〜-5点）
- 非主要ボタンかつ 32px 未満 → 減点（-1〜-2点）

### Layer 2: ユーザビリティ + Cross Platform評価（テキストベース、main 視点）

**各画面の CTA・ナビゲーション・default 状態のフィードバック余地についてニールセンの発見的評価：**

```
□ 状態の可視性 (main 視点): default HTML 上に状態遷移トリガー (CTA / フォーム / 非同期処理起点) が明確に置かれているか、仕様書 (.md) に sub-state の振る舞い (loading / 成功 / エラー) が記述されているか
   ※ sub-state HTML 横断評価 (実際に loading.html / error.html が存在するか・状態間一貫性) は Step 25c で評価
□ システムと言語の一致: ユーザーの言葉や概念で情報が伝えれているか
□ ユーザーの主導権と自由: 誤操作を簡単にやり直せる仕組みが default 上の UI 配置で提供されているか
□ 一貫性: 慣れた操作体系や表現が維持されているか
□ エラー防止: 問題が起こる前に防ぐ設計が default UI に反映されているか (確認ダイアログの存在は仕様書記述で評価、HTML 化は Step 25b)
□ 記憶よりも認知: ユーザーが情報を思い出すより見て判断できるようにされているか
□ 柔軟性と効率性: 初心者にも熟練者にも効率的に使えるように設計されているか
□ 美的で最小限のデザイン: 不要な情報を排し、目的に集中するようにされているか
□ エラーの認識と回復支援 (main 視点): default HTML にエラー導線 (toast/banner 配置スロット) があり、仕様書にエラーメッセージ・解決策案が記述されているか
□ ヘルプとドキュメント: 必要な支援情報を簡単に参照可能になされているか
□ フィードバック (main 視点): default 状態の CTA 直近に loading / 成功 / エラー の置き場が確保されているか
   ※ 「sub-state HTML 横断で 4 状態が揃っているか」の網羅評価は Step 25c で実施
```

**一貫性の詳細の補足**

コンポーネント一貫性（詳細）: 同一画面内で同じコンポーネントが複数使われている場合（バッジ・ボタン・カード等）、全インスタンスが同じ構造（アイコンの有無・パディング・テキスト形式）で実装されているか確認する

※ MD ファイルの記述確認だけでは不十分。HTML ファイルを直接 Read し、同一クラスを持つ全インスタンスの子要素構造・インラインスタイルを列挙して比較すること（例: `.badge` が複数ある場合、アイコン有無・padding の統一性をソースレベルで確認）

**Platform（Cross Platform対応）：**

📱 Android（Material Design）
```
□ ナビゲーション（BottomNav / Back）が自然か
□ 戻る操作（システムバック）に一貫性があるか
□ Materialコンポーネントが正しく使われているか
□ ジェスチャー（Swipe等）が適切か
```

🍎 iOS（Human Interface Guidelines）
```
□ NavigationBar / TabBarの使い方が適切か
□ 戻る操作（スワイプバック含む）が自然か
□ iOS標準コンポーネントが使われているか
□ モーダル表示・遷移がHIG準拠か
```

🌐 Web（Web UX / Browser標準）
```
□ ブラウザバックと状態管理が整合しているか
□ リンクとボタンの役割が適切に分離されているか
□ レスポンシブ対応が考慮されているか
□ フォーカス遷移（Tab操作）が正しいか
□ ページ遷移・ローディングのフィードバックがあるか
```

🔄 クロスプラットフォーム一貫性
```
□ Android / iOS / Webで基本体験が統一されているか
□ プラットフォーム差異が意図的に設計されているか
□ ユーザーが環境を跨いでも迷わないか
```

### Layer 3: デザイン評価（テキストベース）

```
□ デザインブリーフとの整合: 選択した方向性を反映しているか
□ スペーシングの一貫性: spacing トークンを適切に参照しているか
□ ブランドコヒーレンス: 全画面でトーン&ムードが統一されているか
```

**レイアウト・余白の評価スコープについて（重要）:**

余白の評価は「設計構造」に対して行う。「表示データ量」に起因する余白は評価対象外とする。

| 余白の種類       | 定義                                                | 評価対象                  |
|-------------|---------------------------------------------------|-----------------------|
| **構造的余白**   | padding・margin・gap 等、設計上の spacing 定義に由来する余白       | ✅ 評価する（トークン参照・一貫性を確認） |
| **データ密度余白** | コンテンツが少ないことでコンテナの残余領域が空く余白（リスト行数が少ない・カード未充填・空セル等） | ❌ 評価しない               |

**判断の基準:**
- 「データが増えれば埋まるか？」→ Yes ならデータ密度余白であり減点しない
- 「データ量に関わらず構造上の問題か？」→ Yes なら構造的余白の問題として減点対象

画面に表示されているデータはサンプル・仮データである場合が多い。データ件数・量の少なさ自体を根拠とした指摘は行わないこと。

## ⚠️ Issue記述フォーマット

- Dimension: UX / Platform / Accessibility / Business
- Platform: Android / iOS / Web / Cross
- Severity: High / Medium / Low
- User Impact:
- Business Impact:
- Root Cause:
- Suggestion:

## 完了後
評価結果をメモリに保持して「19 ルーブリック採点へ進みます。」
→ `skills/19-rubric-score/SKILL.md` を Read して 19 を実行
