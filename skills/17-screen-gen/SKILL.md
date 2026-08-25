---
name: 17-screen-gen
description: 要件定義とデザインシステム（トークン / スタイルガイド）を参照し、全画面の仕様書と main（default 状態）プレビュー HTML を生成する。Phase 3 Step 17 として Step 20 のループ制御から繰り返し呼ばれる。
---

# 17 画面デザイン生成（全画面 main HTML）

## 役割
要件定義（14 で作成した画面一覧・遷移図）とデザインシステム（12 で作成した tokens / style-guide）を参照し、全画面の仕様書 + main (default 状態) プレビュー HTML を生成する。

> **sub-state 切り離し**: 本 step では **default (main) HTML 1 枚のみ** を生成する。empty / loading / error 等の sub-state HTML 生成は **Step 25b (state-pattern-gen)** に移管された。これにより Phase 3 初回ループのトークン消費を抑え、人間承認 (Step 21) も main 1 枚に絞って行える。sub-state の必要性確認は Step 25a で user に AskUserQuestion する。

このステップは **ループ制御（20）から繰り返し呼ばれる**。`scores.json` の `attempt_count` を見て、前回指摘の解消→再生成を行う。

## 前提条件
- 16（デザイン用ドキュメント人間レビュー）承認済み
- `artifacts/{app_name}/screens/00-screen-list.md` と `00-transition-map.mmd` (SSoT) + `00-transition-map.html` (派生) が存在する
- `artifacts/{app_name}/tokens.json`・`style-guide.md` が最新

---

## エージェントプロンプト

このステップを実行するとき、以下のプロンプトを自分自身への指示として適用すること。

---

**あなたはプロダクトデザインのシニアUIデザイナーです。**

要件定義・デザインシステム・WCAGマッピングの全てを参照し、ユーザーが実際に使う画面の仕様を設計してください。

### 設計の原則

**「必要最小限の画面」を設計する。**
Must機能を実現するために本当に必要な画面だけを定義すること。画面数を増やすことが目的ではない。
ただし 01（質問エージェント）の 7 軸目「デザイン出力範囲」で「全 Phase の Must+Should まで作る」と決定している場合は、その範囲まで生成すること。

**各画面は「ユーザーが何を達成するための画面か」を起点に設計する。**
NG: 「アバター生成画面」（機能名が起点）
OK: 「ユーザーがテキスト原稿を入力し、アバターと音声を選択して動画生成をリクエストする画面」（ユーザー目的が起点）

### Operating Principle 4 — Disambiguation（本 step = AI 生成 / flavor b）

本 step は確定済の上流（requirements.json / design-brief.yaml / tokens.json）から HTML を生成する
**AI 生成 step**。HTML / 仕様書を Write する **直前** に、`docs/principle4-disambiguation.md`
§1 Step 3 の Flavor (b) gap-source-check を実行する:

- 書こうとする値（token 補完 / platform 判定 / dual-theme 処理 / 固定サイズ等）が **(A) CONFIRMED か
  (C) DERIVED に裏付けられているか** を自問する。
- 根拠の無い「勝手な新規の決め事」は (D) UNCERTAIN。**補完で埋めず、上流（Phase 2 / requirements）へ
  差し戻す or `artifacts/{app_name}/pending-questions.json` に append**（必須 field: `target` / `question` / `raised_by_step="17-screen-gen"` / `raised_at` [ISO 8601] — ⚠️ 省くと hook R3 が exit 2 で Write を弾く）。
- append する entry に **`reflect_to`（回答の反映先 artifact の `artifacts/{app_name}/` 相対パス）は書かない** —
  本 step の反映先は上流（Phase 2 の `tokens.json` / `design-brief.yaml`）であり、本 skill の下流 phase に
  受け手が無いため（宣言すると Phase 3 の進行では二度と ask されない）。未設定 = 次の門で必ず ask される
  従来挙動（`skills/_shared/preflight-gate.md` § append 経路の 2 択のうち (b)）。
  同じ `tokens.json` を反映先とする Step 25b が (a)（`reflect_to` を書く + Phase 2 経由の resume 指示を併記）
  を採るのは、**25b が中断して user を `/ayatori-design` へ戻せる step** だから — 本 step は中断しないので
  (b) が正しい。矛盾ではなく「復帰指示を出せるか」で分かれる。
- 確定済の上流は再質問しない（Rule 6）。

これは下記「State Colors の直書き禁止」＝「未定義 state color は補完せず Phase 2 へ差し戻し」を
**token に限らず platform / theme / サイズ判定へ一般化**したもの。詳細は
`docs/principle4-disambiguation.md`。

### ループ再実行時

前回 `scores.json` の `tags` に `type == "AI改善可能"` として記録された問題点を、この画面設計で解消すること。
解消した項目は仕様書の該当コンポーネントに「（前回指摘: 〇〇 → 対応済み）」と明記する。

### CTAとフィードバックは必ず定義する

全画面で以下を **仕様書 (`{画面名}.md`) に必ず記述**すること:
- 主要CTA（ユーザーが次に何をするか）
- ローディング状態（API呼び出し中など）— 仕様記述のみ。HTML 生成は Step 25b
- エラー状態（失敗時のメッセージ・リカバリー手段）— 同上
- 成功状態（完了の確認）— 同上

> **HTML 生成範囲**: 本 step では各画面の **default (main) HTML 1 枚のみ** を生成する。loading / error / 成功 等の sub-state HTML は Step 25b で生成される。仕様書 (.md) には全状態の振る舞いを記述するが、HTML は default のみで止める。

### 言語ルール

画面仕様書（.md）およびHTMLプレビューの全テキストは、プロジェクトの主要言語（`pipeline.yaml` の `output_language`）で記述すること。
対象: UIラベル、ボタンテキスト、エラーメッセージ、プレースホルダー、サンプルデータ（人名・住所等）。
デザイントークン名（`var(--color-primary)` 等）や技術的識別子（Screen ID 等）は英語のまま。

### タイポグラフィ・ボタンサイズの設計原則（step-19 採点対象）

WCAG 関連の判定ルールは `docs/wcag-standards.md` に集約されている。17 では各画面仕様書（コンポーネント一覧）に以下を**明記する義務**がある：

- **フォントサイズ階層**: 隣接 2px 以上のルールに従う（`docs/wcag-standards.md` §3 タイポグラフィ → フォントサイズ階層の隣接 2px ルール参照）
- **ボタンサイズ**: コンポーネント一覧に「主要/非主要」を必ず明記。分類基準と判定フローは `docs/wcag-standards.md` §3 タッチターゲット → ボタン主要/非主要のロールベース分類を参照
- **デエンファシステキスト**: 補足テキスト・非アクティブ状態・サブブランド等には `color.text-deemphasis` トークンを使用。3:1 緩和の判定条件は `docs/wcag-standards.md` §3 コントラスト比 → デエンファシステキストの 3:1 緩和ルールを参照

---

## Figma MCP 分岐

> **Mode 判定は `skills/00-figma-mode-detect/SKILL.md` で一元化されている。** 独自の env var チェックは行わず、本スキルを呼び出して結果を取得する。

Read and execute `skills/00-figma-mode-detect/SKILL.md` to resolve `mode`:
- `mode == "enabled"` の場合も、**このステップでは Figma 書き込みは行わない**。Figma への出力は 22（Figma 出力）が担当する。HTML 生成のみ実行。
- `mode == "disabled"` の場合もまずスタブ実装（HTML 生成）を行い、22 でそれを読み込んで Figma に書き込む。
- いずれの mode でも 17 の挙動は実質同一 (HTML 生成のみ)。判定結果は figma-state.json の audit trail として記録される。

---

## 実行指示（スタブ実装）

`artifacts/{app_name}/requirements.json`・`tokens.json`・`style-guide.md` を読み込む。
`artifacts/{app_name}/scores.json` の `attempt_count` を確認する。

**ループ再実行時（attempt_count > 0）の場合:**
`scores.json` の `current.tags` から `type == "AI改善可能"` のタグを抽出し、各タグの `detail` を参照して該当する tokens.json のトークン値 または 画面仕様の記述を修正してから再生成する。
例：「フォーカスリングの offset が未指定」→ tokens.json に `focus-ring-offset` トークンを追加し、全画面の該当コンポーネントに反映する。

> **`fix_location == "chrome_canon"` のタグ（共通部品 = ボトムメニュー / ヘッダー由来）は必ず正典で直す**: 修正は **`_shared/components.html` / `_shared/components.css` の正典**（値が token 由来なら `_shared/root-variables.css`）に対して Step 0b で行い、その後 Step 0b-2 で全画面へ再ペーストする。**個別画面の chrome マークアップ / CSS を直接書き換えてはならない**（`docs/html-generation-rules.md` §11.6）。個別画面を直すと Step 0b-3 の chrome self-check が正典との byte 不一致を検出して abort し、同じ指摘で毎回 abort する脱出不能ループに陥る。正典を直せば全画面が新正典で再一致するため self-check は通過する。なお `fix_location == "chrome_plan"`（chrome IA）のタグは Step 20 が `ai_improvable` に積まないため本再実行には渡ってこない（Step 21 人間ゲートで Step 14 プラン更新を判断する）。

### Pre-flight Token Completeness Check (P-15, 新規)

**Step 0a: HTML 生成前に tokens.json のトークン網羅性を確認・補完する。**
このチェックを省略すると Step 22 でキャプチャした Figma フレームに未定義変数が残り、デザインシステムと実装が乖離する。

**手順:**

1. `artifacts/{app_name}/screens/00-screen-list.md` と既存の画面仕様書（`screens/*.md`）が存在する場合は Read して、使用予定のカラートークン名を洗い出す
2. 画面設計から必要になる `rgba()` 値（オーバーレイ・アルファティント・セミトランスペアレント要素）を全て列挙する
3. 列挙した各 `rgba()` 値について、`tokens.json` の `global.color` または `semantic.color` セクションに対応するトークンが存在するか確認する
4. **未定義トークンが見つかった場合**: Step 0 (アイコン取得) に進む前に `tokens.json` に追加する:
   - カテゴリ A（コンテナ背景・状態ハイライト）→ `global.color` に hex 値として追加
   - カテゴリ B（半透明 UI）→ `global.color` に rgba 値として追加、`$description` に用途を明記

```json
// 追加例（tokens.json の global.color セクション内）
"primary-tint-subtle":   { "$value": "rgba(0, 200, 180, 0.08)", "$type": "color", "$description": "選択・強調背景（8% opacity）" },
"overlay-bg":            { "$value": "rgba(10, 14, 26, 0.75)",  "$type": "color", "$description": "モーダルスクリム" }
```

5. 追加したトークンの CSS 変数名（`--color-primary-tint-subtle` 等）を確認し、HTML 生成時にその変数名で参照すること
   - **本経路で `illustration-*` を追加するのは禁止**: 装飾色の追加は必ず昇格ゲート経由（08 Phase 3-illust の床 or 未解決 var → report 昇格キュー → Step 24 A-2b）。P-15 は rgba オーバーレイ等の UI トークン補完専用であり、ゲート無しで装飾色を自己定義する bypass にしない
6. `tokens.json` を更新した場合は `_shared/root-variables.css` も同期更新すること。SoT の階層は単方向フロー:
   `tokens.json`（唯一の SoT）→ `_shared/root-variables.css`（staging）→ 各 HTML `<style>`（derived output）
   `_shared/root-variables.css` が残っている理由は 4 つ: (1) subagent 並列実行時に全 HTML の `:root` をビット単位で一致させる決定性確保、(2) ヒューマンレビュアー用 reference、(3) Step 23 の cross-check 基準、(4) Step 29 (delta) の READ-ONLY 参照。
   ただし HTML ファイルからこのファイルを `<link>` **しないこと** — 各 HTML の `<style>` ブロックに値を展開してインラインコピーすること（下記「CSS 自己完結ルール」参照）

#### State Colors の直書き禁止

> 本節は「カラー値のトークン参照ルール」の **zero-literal 大原則の部分集合**（state colors に特化した先行ルール）。検証も同じ lint（`scripts/lint-screen-colors.mjs`）が担う。

エラー・情報・警告などの **state colors** (error / warning / info / success の bg/text/border) は **tokens 参照のみで書く**こと。直書き hex (`#FEF2F2` / `#FCA5A5` / `#991B1B` / `#EFF6FF` / `#BFDBFE` 等) を画面 HTML / `_shared/common-styles.css` / `*--error.html` / `*--validation-error.html` に書くことを**禁止**する (Step 24 SoT 崩壊の主因)。

- NG: `background: #FEF2F2; border: 1.5px solid #FCA5A5; color: #991B1B;`
- OK: `background: var(--color-error-bg); border: 1.5px solid var(--color-error-border); color: var(--color-error-text);`

tokens.json に未定義の state colors が必要な場合は本 step で hex 補完してはならず、Phase 2 (design-brief.yaml / skill 08) に差し戻す。design-brief.yaml の palette schema に state colors が含まれることを前提とする (skill 08 / `schemas/design-brief.schema.json` 参照)。

全対象画面（14 で決めた `screens/00-screen-list.md`）の成果物を `artifacts/{app_name}/screens/` 配下に保存する（既存ファイルは上書きする）。

**ディレクトリ構造（platform 別サブフォルダ）:**

```
artifacts/{app_name}/screens/
├── 00-screen-list.md
├── 00-transition-map.mmd          # SSoT
├── 00-transition-map.html         # 派生 (template + .mmd で機械生成)
├── _shared/
│   ├── root-variables.css      ← :root 変数の正典 (Phase A)
│   ├── common-styles.css       ← 共通スタイル (Phase A)
│   ├── components.html         ← 共通部品 chrome マークアップ正典 (Step 0b)
│   └── components.css          ← 共通部品 chrome CSS 正典 (Step 0b)
├── {画面名}.md
├── web/
│   └── {画面名}.html       ← Step 17 はここまで (default のみ)
├── web-sm/                  ← web_viewports ∋ sm のときのみ
│   └── {画面名}.html       ← Step 17 はここまで (default のみ)
└── mobile/
    └── {画面名}.html       ← Step 17 はここまで (default のみ)
```

> `{画面名}--{state}.html` (empty / loading / error / 追加状態) は **Step 17 では生成しない**。Step 25b (state-pattern-gen) で同じ `screens/{platform}/` ディレクトリに追加生成される。Step 17 は default のみで完結する。

| Path | 説明 | 生成条件 |
|---|---|---|
| `00-screen-list.md` | 画面一覧 | Step 14（platform 共通） |
| `00-transition-map.mmd` | 画面遷移図 SSoT (純 Mermaid) | Step 14（platform 共通） |
| `00-transition-map.html` | 画面遷移図 派生 (template + .mmd で機械生成) | Step 14（platform 共通） |
| `_shared/` | 共有 CSS + 共通部品正典（参照・管理用。HTML から `<link>` しない — 値を各 HTML にインライン展開する）。`root-variables.css` / `common-styles.css` に加え、`components.html`（chrome マークアップ正典）と `components.css`（chrome CSS 正典）を生成。Step 25b も READ-ONLY で参照するため Step 17 で必ず生成する | Step 17 Phase A / Step 0b |
| `{画面名}.md` | 画面仕様書（画面ごとに 1 つ、root 配置）。全状態の振る舞いを記述する | platform 非依存 |
| `web/{画面名}.html` | Web デスクトップ デフォルト（1440×900） | `platform_combo ∋ web` **かつ** `web_viewports ∋ desktop`（欠落時は `["desktop"]` 扱い） |
| `web-sm/{画面名}.html` | Web スマホ幅 デフォルト（390×844 固定 `.screen` ラッパー、ブラウザページ体裁 — フォンフレーム装飾 / BottomTab なし） | `platform_combo ∋ web` **かつ** `web_viewports ∋ sm` |
| `mobile/{画面名}.html` | モバイル デフォルト（390×844、BottomTab + フォンフレーム） | `platform_combo ∋ mobile` |

`mobile-` 接頭辞によるファイル名分離は廃止し、フォルダ階層で platform を表現する。仕様書（`.md`）は platform に依存しないため `screens/` 直下に 1 つだけ置く。

> **sub-state HTML の生成は Step 25b に移管**: `{画面名}--empty.html` / `--loading.html` / `--error.html` 等は Step 17 では生成しない。Step 25b が `state-pattern-plan.json` (Step 25a が生成) に基づき同じ `screens/{platform}/` ディレクトリに append する。

### 生成する画面一覧の決め方

> **⚠️ パイロット（部分生成）は非推奨**
> 1〜2画面だけ先行生成する「パイロット運用」は、このスキルの設計前提（全画面いっせい生成 + subagent 並列）と噛み合わず、以下の問題を引き起こす:
> - `_shared/root-variables.css` が当該画面分しかカバーしない状態でインライン展開すると、残り画面の要素が未定義になる
> - アイコン一括取得（Step 0）が当該画面分だけで終了し、後続画面との整合性チェックができない
> - 視覚一貫性のレビューが単独画面では実施できない
>
> **推奨**: `00-screen-list.md` に載っている全画面を一度に生成すること。
> コンテキスト上限が懸念される場合は、画面グループ（カテゴリ）単位で分割し、グループごとに subagent を起動する形にすること（1〜2画面の単発生成ではなく）。

14 の `artifacts/{app_name}/screens/00-screen-list.md` を正として、そこに載っている全画面を生成する。
`requirements/02-scope.md` のスコープアウトと明記された機能の画面は対象外。
01 の「デザイン出力範囲」（`requirements.json.design_output_scope.platform_combo`）を尊重する。
**未設定の場合は `pipeline.yaml` の `default_design_output_scope.platform_combo` をフォールバックとして使用する。**

判定の優先順位:
1. `requirements.json.design_output_scope.platform_combo` が存在する → その値を使う
2. 存在しない → `pipeline.yaml` の `default_design_output_scope.platform_combo` を Read して使う

**platform dirs への展開**: platform_combo と `web_viewports`（`design_output_scope.web_viewports`、欠落時は `["desktop"]` = 後方互換）から、生成対象の platform ディレクトリ集合を次の決定的手順で導出する。固定順 = `["web", "web-sm", "mobile"]`:

```pseudo
platforms = []
if platform_combo ∋ web:
  if web_viewports ∋ desktop: platforms += ["web"]      # 1440×900 固定
  if web_viewports ∋ sm:      platforms += ["web-sm"]   # 390×844 固定 (Web スマホ幅)
if platform_combo ∋ mobile:   platforms += ["mobile"]   # 390×844 固定 (ネイティブアプリ)
```

platform_combo に応じた生成ルール (Step 17 は default のみ):
- `mobile_only` → `screens/mobile/{画面名}.html` のみ生成
- `web_only` → 上記展開に従い `screens/web/` / `screens/web-sm/` を生成（既定 = web のみ）
- `mobile_and_web` → 上記展開に従い **各フォルダに生成**（既定 = `screens/web/` + `screens/mobile/`）
- 「全 Phase の Must+Should」→ 詳細未確定の Phase 2/3 画面は仮内容 / Coming Soon で表現してよい

**web-sm の内容規約**: `web-sm/{画面名}.html` は **同一画面の web desktop 版と同じ機能・同じ情報**をスマホ幅にリフローしたものであり、mobile（ネイティブアプリ）版の複製ではない:
- ナビゲーションは web の慣習に従う（ヘッダー + ハンバーガー / ドロワー等）。**BottomTab は使わない**（BottomTab は mobile ネイティブ専用 chrome）。
- web desktop 版と同一の token 変数（`_shared/root-variables.css` の inline copy）・同一のコンテンツを使い、レイアウトのみ 390px 幅向けに再構成する（カラム落とし・テーブルのカード化等）。
- `web_viewports = ["sm"]`（desktop なし）の場合も同規約で生成する（web の慣習・ブラウザページ体裁は維持）。

sub-state HTML (`--empty` / `--loading` / `--error` 等) は **Step 17 では生成しない** — Step 25b に移管。

仕様書（`{画面名}.md`）は platform に関わらず `screens/` 直下に 1 つだけ生成する（重複させない）。

注: HTML 生成は `mobile_framework` の値に依存しない（Flutter / KMP / Native のいずれでもモバイル HTML プレビューは同一）。

#### dual_theme_mode に応じたテーマ軸の生成（必須）

`requirements.json.design_output_scope.dual_theme_mode` の値に応じて、画面 × プラットフォームの cartesian product に **テーマ軸** を加える (状態軸は default に縮退済):

| dual_theme_mode | テーマ軸 | 命名 |
|---|---|---|
| `false` or 未設定 | 単一テーマのみ | `{画面名}.html`（テーマ suffix なし、default 状態のみ） |
| `true` | **light + dark の両方を必ず別ファイル化（対称命名）** | `{画面名}--light.html` と `{画面名}--dark.html` の両方を必ず生成 |

`true` の場合の追加ルール（厳守）:
- **両 suffix 対称**: light と dark の両方が `--light` / `--dark` の theme suffix を持つ。どちらか一方を「suffix なしの primary」として扱わない（pipeline は両モードを対称に扱うため、ファイル命名でも primary 概念を持たない。design-brief.yaml の「主軸」narrative は hearing artifact であり、命名規約には反映しない）
- 各 dark HTML は `<html data-theme="dark" lang="ja">` を明示すること。`prefers-color-scheme` のメディアクエリのみに依存しない（Figma キャプチャと静的レビュー時に必ず dark で描画させるため）
- 各 light HTML は `<html data-theme="light" lang="ja">` を明示すること（OS preference 上書きを抑止）
- **Step 17 における生成枚数** = 画面数 × platform dirs 数（web / web-sm / mobile の展開結果）× **2 (light + dark)**。例: 2 画面 × 2 platform dirs × 2 theme = 8 HTML (default のみ)
- 仕様書 (`{画面名}.md`) は theme で分割しない（platform 同様、`screens/` 直下に 1 つ）。MD 内の画面間リンクは拡張子付きのファイル名ではなく **論理 screen 名で表現**（例: 「`result` 画面へ遷移」とし `result.html` のような実 path を書かない。consumer 側で theme に応じて resolve する）

> **sub-state × theme の組合せは Step 25b の責務**: `{画面名}--{state}--light.html` / `{画面名}--{state}--dark.html` の生成は Step 25b が同じ命名規約で行う。Step 17 では theme × default の 2 軸のみ。

過去事故 (Draughts): 全 HTML が light のみ生成され、Step 21 直前まで dark の検証が一切できなかった。本ルールは初回生成で両モード分が必ず揃うことを保証する (default に絞った今も同じ)。

### HTML 固定サイズルール（必須）

各 platform dir の HTML は、環境によるサイズのブレを防ぐため、以下の固定サイズを指定すること：
- Web デスクトップ（`web/`）: `body { width: 1440px; min-height: 900px; }`
- Web スマホ幅（`web-sm/`）: `.screen { width: 390px; min-height: 844px; }`（body はプレビュー用ラッパーとして全幅。構造は下記「Web スマホ幅画面のプレビュー構造」参照）
- モバイル（iOS / Android 共通、`mobile/`）: `.screen { width: 390px; min-height: 844px; }`（body はプレビュー用ラッパーとして全幅。プラットフォーム別の見た目調整はフレーム装飾のみで行う）

> **media query 禁止 (設計判断)**: web のレスポンシブ表現は「幅ごとの固定幅 HTML 派生」(`web/` + `web-sm/`) で行い、1 ファイル内の `@media` breakpoint では行わない。Figma キャプチャはブラウザで開いて `figmaselector` で要素を切り出す方式であり viewport 幅を制御できないため、media query のスマホ側レイアウトはキャプチャ不能になる（デスクトップ幅で解決された結果しか取れない）。

#### モバイル画面のプレビュー構造（必須）

モバイル画面は、デスクトップブラウザで確認・Figmaキャプチャする際に
**グレー背景の中央に390px幅でスマホ型表示**されるよう、以下の構造で実装すること。

```css
body {
  background: #E8E4DF;           /* 周囲グレー背景 */
  display: flex;
  flex-direction: column;
  align-items: center;           /* 中央揃え */
  min-height: 100vh;
  padding: 20px;
  gap: 16px;
}
.screen {
  width: 390px;
  min-height: 844px;
  background: var(--color-bg);
  border-radius: 40px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
}
```

```html
<body>
  <div class="screen">
    <!-- 実際の画面コンテンツをここに入れる -->
  </div>
</body>
```

- `body`: グレー背景 + flex中央揃え（ブラウザ全幅に対してスマホを中央に置く）
- `.screen`: 390×844px の実体（Figmaキャプチャ時は `figmaselector=.screen` でこの要素だけ取得）
- `border-radius: 40px` でiPhoneのような角丸フレームに見える

#### Web スマホ幅画面のプレビュー構造（必須）

`web-sm/` の HTML はモバイルと同じ「グレー背景 + 固定幅 `.screen` ラッパー + `figmaselector=.screen` キャプチャ」機構に乗せるが、**ブラウザページ体裁**で実装する（ネイティブアプリのフォンフレーム見た目にしない）:

```css
body {
  background: #E8E4DF;           /* 周囲グレー背景（mobile と共通） */
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: 20px;
  gap: 16px;
}
.screen {
  width: 390px;
  min-height: 844px;
  background: var(--color-bg);
  border-radius: 8px;            /* ブラウザウィンドウ程度の控えめな角丸（40px のフォンフレームにしない） */
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05);
}
```

mobile 構造との差分（厳守）:
- `border-radius: 40px` の iPhone 風フレーム・ノッチ / ステータスバー / ホームインジケータ等の**デバイス装飾を入れない**（`.screen` はブラウザの表示領域を表す）
- **BottomTab を使わない** — ナビゲーションは web の慣習に従い、Step 0b-1 で正典化する **web-sm 専用ヘッダー（`web-sm-header-home` / `web-sm-header-sub`）** を逐語ペーストで使う。`_shared/components.html` の mobile chrome（`.mobile-header` / `.mobile-bottom-nav`）も 1440px 用 `web-header-*` も web-sm には流用しない（chrome の画面ごと再発明禁止は web-sm にも適用 — byte-check 対象）
- コンテンツ・機能・token 変数は同一画面の `web/` 版と一致させる（レイアウトのみ 390px にリフロー）

### CSS 自己完結ルール（必須）

各 HTML ファイルは **それ単体で `file://` 開いても完全に表示される**よう、CSS をすべてファイル内にインライン化すること。

```html
<!-- NG: 外部 CSS をリンク — file:// では読み込まれずレイアウト崩れ -->
<head>
  <link rel="stylesheet" href="../_shared/root-variables.css">
  <link rel="stylesheet" href="../_shared/common-styles.css">
</head>

<!-- OK: 全 CSS を <style> ブロックにインライン記述 -->
<head>
  <style>
    :root {
      --color-primary: #00C8B4;
      /* _shared/root-variables.css の全 :root 変数をここにコピー */
    }
    body { margin: 0; font-family: var(--font-body); }
    /* 構造スタイル・コンポーネントスタイルもすべてここに記述 */
  </style>
</head>
```

**禁止:**
- HTML ファイル内に外部 CSS ファイルへの参照を書くこと（`_shared/` 配下を含む、すべての外部 `.css` が対象。パス形式を問わず禁止: 相対パス `../`、絶対パス `/`、`file://` 等）
- `<link rel="stylesheet" href="[任意のパス]/...css">` を個別 HTML ファイル内に書くこと
- `<style>` ブロック内の `@import url('...')` で外部 CSS を参照すること — `@import` も `<link>` と同様に `file://` では読み込まれない

**必須:**
- `:root` 変数（カラートークン・タイポグラフィ）、構造スタイル、コンポーネントスタイルをすべて各 HTML の `<style>` ブロックにインライン記述すること
- `_shared/root-variables.css` を Read して `:root { }` ブロックの **全変数を丸ごと** 各 HTML の `<style>` 冒頭にコピーすること（`<link>` タグによるリンクは禁止 — 上記参照）
- **`_shared/components.css`（共通部品 chrome CSS）も同様に各 HTML の `<style>` へ逐語インラインし、`_shared/components.html` のヘッダー / ボトムメニュー フラグメントを割り当てに従って `<body>` へ逐語ペーストすること**（可変部はスロットのみ差し込み）。詳細は上記「Step 0b」および `docs/html-generation-rules.md` §11 参照
- **「画面で実際に使う変数だけコピーする」最適化は禁止**。state color (`--color-error-bg` / `--color-warning-bg` / `--color-success-bg` / `--color-info-bg` 等) のように main (default 状態) では参照しなくても、sub-state HTML が main の `<style>` を継承するため、main 側で変数が欠落すると sub-state も欠落する

**self-check (HTML 出力後の自己検証、必須)**:
- `_shared/root-variables.css` の `:root { ... }` ブロック内の **変数宣言行 (`--xxx:` で始まる行) の数** を `grep -c '^[[:space:]]*--' _shared/root-variables.css` 同等で数える (`\s` は BRE/ERE では空白として解釈されないため必ず POSIX 文字クラス `[[:space:]]` を使うこと。Step 17 / 25b subagent / 25c で同じ表記に揃える)
- 出力した HTML の `<style>` 冒頭の `:root { ... }` ブロック内の変数宣言行数を同様に数える (`<style>` 抽出 → 行頭 `--xxx:` を grep)
- **両者の数が一致するまで** root-variables.css の `:root` ブロック全体を inline copy し直す
- リトライは最大 3 回まで。3 回連続で不一致なら `feedback-log.md` に Pattern B (`step17 root-variables inline copy mismatch`) を記録して abort し、ユーザーに「root-variables.css と main HTML の :root が一致していません」と明示する
- **abort の意味と ownership**: subagent (ayatori-sample-html-builder 等、Step 17 の HTML 生成 subagent) は HTML を Write せず、orchestrator (Step 17 main 側) に `status: "root_copy_failed"` + 直近の比較結果 (`expected_count` / `actual_count`) を構造化テキストで return する。orchestrator はこれを受けて (a) Step 17 全体を停止し、(b) feedback-log.md に Pattern B を記録した上で、(c) ユーザーに `/clear` + 再実行を案内する。subagent が独自に再生成ループを回したり、HTML を best-effort で Write することは禁止 (壊れた main HTML が下流の 25b 継承元として使われると整合性検証 (25c Step 1-1b) で検出されるが、上流で止める方が安全)
- 「宣言行数」ではなく **「変数個数」** で比較する理由: `--shadow-lg: 0 4px 6px rgba(...), 0 1px 2px ...;` のような多行宣言があると単純行数比較は false negative になるため、行頭 `--` で start する行のみ数えることで token 個数の不一致を robust に検出する
- **fail-closed の最終強制は lint が行う (E2E 追補)**: 本手動カウントは Write 前の早期検出。E2E (CleanSnap) で「使う変数だけに間引く」逸脱が 12/12 画面で発生し、手動 self-check だけでは止まらないことが実証されたため、下記「色トークン適合 self-check」の `--check` が `root_vars_incomplete`（hard・exit 1）として root-variables.css の**全変数名の存在**を機械検証する。画面固有の追加変数（`--nav-height` / `--shadow-nav-top` 等）は許容（superset OK・名前レベル subset 検査）

**色トークン適合 self-check（HTML 出力後・必須）**:

root-variables / chrome の self-check と**同型**の fail-closed 検証。各画面 HTML を Write した直後に orchestrator が実行する（lint はファイルを読む script のため、Write 後に走らせる）:

```bash
node scripts/lint-screen-colors.mjs --check artifacts/{app_name}/screens/{platform}/{画面名}.html
```

- 検出対象（L1 = `hard`）: 色リテラル（zero-literal 違反）／未解決 `var(--…)`（typo・外部依存）／SVG presentation 属性への `var()` 直書き／イラスト正典との不一致／外部 stylesheet（`<link>` / `@import`）／`:root` 完全性（`root_vars_incomplete` — root-variables.css の全変数名が定義済か。P-15 丸ごと copy の機械強制）。stdout JSON は (type, value) で dedup + 出現 cap 済（修正ヒント付き）。
- **exit code 契約**: `1` = hard 違反あり（修正対象）／`0` = pass（**未解決 `--color-illustration-*` は `soft_promotions` として返り exit 0** — 装飾パレットに無い色が必要になった昇格候補であり欠陥ではない。Step 18 の report → Step 21 ゲート → Step 24 昇格のフローに乗せる。hex を発明して埋めるのは禁止）／`2` = 運用エラー（パス間違い等。違反と誤認してリトライしない）。
- exit 1 なら該当画面を**修正して再生成**（リトライ最大 3 回）。3 回連続なら `feedback-log.md` に Pattern B（`step17 zero-literal violation`）を記録して **abort**。abort 時、当該違反 HTML はディスクに残る（root-variables/chrome self-check の「Write 前検出」と異なり本検査は Write 後）— abort メッセージで該当ファイルを明示し、解消まで下流（18/22/25b）に進まないこと。
- **ownership は root-variables / chrome self-check と同じ**: subagent 並列時は subagent が return した HTML を orchestrator が Write → `--check` → exit 1 なら status `color_lint_failed` + stdout の `hard` summary として扱い再指示（subagent 自身に再生成ループを回させない）。main 直接生成時は main が Write 直後に `--check` し、自分で修正 → 上限到達で abort。
- **プレビュー足場はテーマ問わず canonical 値**（allowlist の `#E8E4DF` ＋ `.screen` 影 2 値。**値の正本は lint script の `SCAFFOLD_ALLOW`** — 改訂は script 側で行う）を使う — 足場は製品 UI ではないため dark テーマ画面でも変えない（変えると zero-literal 違反になる）。
- **リテラル違反の修正で「:root に新しい色変数を足して var 化」しない** — 台帳（tokens.json）を迂回した洗浄であり、lint が `extra_root_vars` として report に載せ Step 21 で人間に提示される。正しい修正は既存 token への置換／装飾色なら昇格キュー（`--color-illustration-*` の名前だけ書く）／load-bearing 色なら Phase 2 差し戻し。
- `--check` は**画面 HTML 専用** — イラスト正典 SVG（`_shared/illustrations/*.svg`）に直接当てない（`:root` 完全性検査が誤発火する。正典の色検査は Step 18 `--report` の `illustration_source_violations`）。
- 全画面横断の report（`--report`）は本 step では実行しない（Step 18 の責務）。

**フレーム固定幅 self-check（HTML 出力後・必須）**:

色トークン適合 self-check と**同型**の fail-closed 検証。各画面 HTML を Write した直後に色 lint と併せて実行する:

```bash
node scripts/lint-screen-frame.mjs --check artifacts/{app_name}/screens/{platform}/{画面名}.html
```

- 検出対象（hard・exit 1）: `fixed_frame_missing`（web = `body { width: 1440px }` 欠落 / web-sm・mobile = `.screen { width: 390px }` ルール or `<body>` 配下の `class="screen"` 要素の欠落）／ `width_media_query`（`min-width` / `max-width` の media query — `prefers-*` 系は許容）。
- **なぜ機械強制が必要か**: Figma キャプチャはブラウザで開いて `figmaselector` で要素を切り出す方式で viewport 幅を制御できないため、固定幅要素の存在が capture の前提。生成 LLM は「スマホ向け WEB = レスポンシブ」の事前分布に引っ張られ、fluid レイアウト（`width: 100%` + 固定幅ラッパー無し）を出力することがあり（実事故: スマホ中心 WEB 案件で全画面 fluid → Figma フレームがブラウザ窓幅で出力）、prose 規約（上記「HTML 固定サイズルール」）だけでは止まらない。
- **exit code 契約・リトライ・ownership は色 lint と同一**: exit 1 なら該当画面を修正して再生成（最大 3 回）→ 3 回連続なら `feedback-log.md` に Pattern B（`step17 fixed frame violation`）を記録して abort。exit 2 は運用エラー（違反と誤認してリトライしない）。解消まで下流（18/22/25b）に進まない。

#### Web フォント（Google Fonts）ロードルール（必須）

`artifacts/{app_name}/tokens.json` の `font-family` 値が Google Fonts 系のフォント（例: `"Noto Sans JP"`, `"Inter"`, `"Roboto"` 等）を参照している場合、そのフォントを **全 HTML ファイルの `<head>` に `<link>` タグで明示的に読み込むこと**。

```html
<!-- tokens.json の font-family が複数ある場合は 1 つの <link> URL にまとめる（&family= で連結）-->
<!-- 例: "Noto Sans JP" + "Inter" を使用する場合 -->
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* すべての CSS をここにインライン記述 */
  </style>
</head>
```

**禁止:**
- `tokens.json` がウェブフォントを指定しているにもかかわらず `<link>` タグを省略すること（Figma キャプチャ時・`file://` 開封時にフォールバックフォントに置き換わる原因）
- Google Fonts のフォントファミリーを複数の独立した `<link>` タグで読み込むこと — 必ず `&family=` で連結した 1 つの URL にまとめること（HTTP リクエスト削減・ちらつき防止のため）

### アイコン実装ルール（必須）

**禁止（全ポリシー共通）:**
- フォントアイコン（Material Icons 等）を UI アイコンとして使用すること（Figmaキャプチャ時にフォントが読み込まれずアイコンが表示されない問題が発生するため）

以下の SVG 実装ルールは `illustration_policy == "pictogram"` の場合にのみ適用する。非 pictogram ポリシー（`illustration_character` / `emoji_casual`）では Step 0 ゲートで別のパスに分岐しているため、これらの SVG ルールは適用しない。

- 全アイコンはインライン SVG で実装すること。`fill: currentColor` で親要素の色を継承する。
- 画面内のアイコンはすべて **公式ライブラリから取得した SVG パスをそのままインライン実装** すること

**禁止（`pictogram` の場合のみ）:**
- Unicode 絵文字（🔔 🏠 ✅ など）を UI アイコンとして使用すること（`emoji_casual` ポリシーでは絵文字を直接使用すること — 禁止解除）
- `<img src="*.png">` などのラスター画像をアイコンに使用すること
- Claude がアイコンのSVGパスを自ら生成・近似すること（HTML仕様書・Figma・開発実装の三者不一致の原因になるため）

#### Step 0: アイコン一括取得（全画面 HTML 生成の前に 1 回だけ実行）

**事前: `illustration_policy` ゲート判定**

`artifacts/{app_name}/design-brief.yaml` の `common.ui_constraints.illustration_policy` を Read して分岐する:

| policy | Step 0 の挙動 |
|---|---|
| `pictogram` | 以下の通常手順を実行する（デフォルト）— `icons/*.svg` + `icons-manifest.json` を生成する |
| `illustration_character` | SVG フェッチをスキップ。`artifacts/{app_name}/icons-manifest.json` に `{"library": "illustration_character", "icons": []}` を書き込み Step 0 を終了（スキーマ準拠: `library` を policy sentinel として使用、`policy` キーは `additionalProperties: false` 違反のため不使用）。各画面 HTML では `<div class="illust-placeholder" data-scene="{scene_name}" style="width:100%;min-height:var(--sp-2xl,160px);display:flex;align-items:center;justify-content:center;border:1px dashed var(--color-on-surface-variant);border-radius:var(--radius-md,8px);color:var(--color-on-surface-variant);font-size:14px;"></div>` ブロックを使用する（閉じタグ必須・スタイル無しの空 div は高さ 0 で不可視になるため最小スタイルを inline で指定する。**色 var に fallback リテラルを付けない** — zero-literal の検査対象であり、`--color-on-surface-variant` は root-variables 全変数 inline copy により常に定義済。寸法系 fallback `var(--sp-2xl,160px)` 等は色でないため可） |
| `emoji_casual` | SVG フェッチをスキップ。`artifacts/{app_name}/icons-manifest.json` に `{"library": "emoji_casual", "icons": []}` を書き込み Step 0 を終了（スキーマ準拠: `library` を policy sentinel として使用）。各画面 HTML では Unicode 絵文字を直接使用する |

`illustration_character` / `emoji_casual` の場合は以下の手順を実行しない。`pictogram` の場合のみ続行:

**個別画面ごとの WebFetch は禁止。** 全画面で使うアイコンをまとめて取得し、以降は Read で再利用する。
これにより WebFetch 回数を N画面×M個 → M個 に削減し、コンテキスト消費を抑える。

**手順:**

1. `screens/00-screen-list.md` と各画面の仕様書 MD を読み、全画面で必要なアイコン名を重複なしで洗い出す。**`00-screen-list.md` の「## 共通部品定義（chrome）」節のタブバーモデルに記載された全タブのアイコン名（`home` / `map-pin` 等）も必ず洗い出しに含める**（chrome 部品の SVG をここで一括取得し、Step 0b の正典生成で使う）
2. 洗い出した全アイコンを **一括で** WebFetch する（並列実行可能なものは並列で呼ぶ）

使用するライブラリと取得URLパターン：

| ライブラリ | スタイル | URL パターン |
|---|---|---|
| Heroicons | outline (24px) | `https://raw.githubusercontent.com/tailwindlabs/heroicons/master/optimized/24/outline/{name}.svg` |
| Heroicons | solid (24px) | `https://raw.githubusercontent.com/tailwindlabs/heroicons/master/optimized/24/solid/{name}.svg` |
| Phosphor Icons | regular | `https://raw.githubusercontent.com/phosphor-icons/core/main/assets/regular/{name}.svg` |
| Phosphor Icons | bold | `https://raw.githubusercontent.com/phosphor-icons/core/main/assets/bold/{name-bold}.svg` |

3. 取得した SVG を `artifacts/{app_name}/icons/{name}.svg` に保存する

3b. **currentColor 正規化（必須）**: 保存直後に以下を 1 回実行し、取得 source に焼き付いた色（`stroke="#0F172A"` 等。ライブラリ配布物に含まれることがある）を機械的に `currentColor` へ置換する:

   ```bash
   node scripts/lint-screen-colors.mjs --normalize-icons artifacts/{app_name}
   ```

   冪等（再実行 safe）。`fill="none"` / `url(...)` / `var(...)` は保持される。**アイコンが自前の色を持たない（= 親要素の `color:` トークンを継承する）ことが、全画面でのアイコン色一貫性の土台**になる（過去事故: AIAvatarVideo で source 32 件に hex が焼き付き → 画面側で別 hex に再着色されドリフトの温床になった）。

4. `artifacts/{app_name}/icons-manifest.json` を生成する (schema: `schemas/icons-manifest.schema.json` 参照、required: `library` + `icons[]`、icon entry の required: `name` + `source_url`):

```json
{
  "library": "heroicons",
  "version_ref": "master",
  "style_default": "outline (24px)",
  "icons": [
    {
      "name": "arrow-left",
      "style": "outline",
      "used_in": ["02-screen-a", "03-screen-b"],
      "source_url": "https://raw.githubusercontent.com/tailwindlabs/heroicons/master/optimized/24/outline/arrow-left.svg"
    }
  ]
}
```

> `used_in` は theme suffix なしの論理画面識別子で記録する (dual_theme_mode プロジェクトでもアイコン形状は両モード共通の原則のため、`board--error` と書き `board--error--light` / `…--dark` 別エントリにしない)。

WebFetch が失敗した場合は「取得失敗: {URL}」と記録し、アイコンをプレースホルダー（空の `<svg>`）にして 23 最終ゲートでユーザーに差し替えを依頼すること。自らパスを補完してはいけない。

#### 各画面 HTML でのアイコン埋め込み（Step 0 完了後）

**WebFetch を呼ばない。** `artifacts/{app_name}/icons/{name}.svg` を Read して `<path d="...">` を取得し、HTML にインライン埋め込みする。

```html
<!-- NG: Claude が生成した近似パス -->
<svg viewBox="0 0 24 24" style="fill: currentColor;"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>

<!-- OK: icons/ から Read した公式パスをそのまま使用 -->
<svg xmlns="http://www.w3.org/2000/svg" style="fill: none;" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
  <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
</svg>
```

**色の与え方**: アイコン自体は `currentColor` のまま、色は親要素（または svg への `style=`）の `color: var(--…)` で与える。SVG presentation 属性への `fill="var(--…)"` 直書きは**ブラウザが解釈しないため無効** — 必ず `style="fill: var(--…)"` か `currentColor` 継承を使う（lint が `var_in_presentation_attr` として検出する）。

**識別は path 内容で行う**: lint (`scripts/lint-screen-colors.mjs`) は埋め込み SVG の path 署名を `icons/{name}.svg` と照合してアイコンを識別する。`data-icon` 等の識別属性は**付けない**（chrome 正典の byte 一致 self-check（Step 0b-3）と干渉するため、属性方式は廃止済）。path を改変・近似すると署名が一致せず「未照合 SVG」として color-lint-report に載る（= 既存の「パス自作禁止」ルールに機械チェックが付いた）。

### Step 0b: 共通部品（chrome）正典の生成 + 各画面への埋め込み（必須）

ボトムメニュー（タブバー）・ヘッダーは全画面で形が同じであるべき共通パーツ（chrome）。画面ごとに AI が組み立て直すと項目・アイコン・線の太さ・CSS 値（`padding-bottom` 等）が**ドリフトする**。これを防ぐため、`_shared/root-variables.css` の inline-copy idiom を「部品フラグメント」へ拡張し、**正典を一度だけ生成 → 各 HTML に逐語ペースト → self-check** する。完全なルールは `docs/html-generation-rules.md` §11 を参照（本 step はその適用箇所）。

> **入力**: `00-screen-list.md`（Step 14 / Step 2b が確定した「## 共通部品定義（chrome）」節 + 各画面の `ヘッダー` / `ボトムメニュー` / `現在タブ` 列）。`00-screen-list.md` に chrome 定義が無い場合は Step 14 に差し戻す（本 step で chrome モデルを発明しない）。

#### Step 0b-1: 正典ストアを生成（全画面 HTML 生成の前に 1 回だけ）

`00-screen-list.md` の chrome 定義と Step 0 で取得済みの `artifacts/{app_name}/icons/{name}.svg` を使い、次の 2 ファイルを生成する:

- `artifacts/{app_name}/screens/_shared/components.html` — 部品マークアップの正典。**先頭に `<meta charset="UTF-8">` を 1 行置く**こと（staging artifact で単体表示用ページではないが、charset 宣言が無いと人間がブラウザで開いた際に日本語が文字化けするため。`<!DOCTYPE>` / `<head>` は不要）。次のフラグメントを実 SVG（Step 0 と同じく `artifacts/{app_name}/icons/{name}.svg` を Read して `<path d="…">` を取得し埋め込む。新たに WebFetch しない・Claude がパスを自作しない）込みで保持する。可変部は**スロットマーカー**で明示:
  - `mobile-bottom-nav`（platform_combo ∋ mobile のとき）: 各タブを `<a data-tab="{id}" href="#"> {インライン SVG} {ラベル}</a>` で並べる。**正典は全タブとも `aria-current` を付けない（全タブ非アクティブの状態で保存）**。現在タブはコメントマーカーを使わず、各画面ペースト時に「割り当て id に一致する `<a data-tab="{id}">` へ `aria-current="page"` を付与する」属性付与のみで表現する（`docs/html-generation-rules.md` §11.3 と同一定義。`<!--SLOT:ACTIVE-TAB-->` 等のマーカーは置かない）
  - `mobile-header-home` / `web-header-home`（A）: 戻るボタンなし。タイトルは `<h1><!--SLOT:TITLE--></h1>`
  - `mobile-header-sub` / `web-header-sub`（B）: 戻るボタンあり（`artifacts/{app_name}/icons/arrow-left.svg` 等を Read して埋め込み）。`<h1><!--SLOT:TITLE--></h1>` + 戻り先 `<!--SLOT:BACK-->` + 末尾 `<!--SLOT:HEADER-ACTION-->`（既定は空）
  - `web-sm-header-home` / `web-sm-header-sub`（platform dirs ∋ web-sm のとき）: web-sm 専用ヘッダー正典。390px 幅前提（width 100% で `.screen` にフィット）、A = タイトル + 任意のハンバーガーメニューボタン（44px タッチターゲット、default 状態では開かない静的ボタン。`icons/menu.svg` 等を Read して埋め込み）、B = 戻るボタン + タイトル（mobile B と同じスロット構成）。**web-sm に `mobile-bottom-nav` は埋め込まない**（BottomTab は mobile ネイティブ専用 chrome。web-sm のナビは本ヘッダーで表現する）。1440px 用 `web-header-*` の verbatim 流用も禁止（390px で崩れるため専用フラグメントを正典化する）
- `artifacts/{app_name}/screens/_shared/components.css` — 上記部品の CSS 正典（`.mobile-header` / `.mobile-bottom-nav` / nav `svg` の `stroke-width` / `body` の `padding-bottom` / web header / web-sm header〔platform dirs ∋ web-sm のとき〕等）。**色は `var(--color-*)` 参照のみ**（HEX 直書き禁止）。`root-variables.css` と同様、各 HTML へ逐語インラインする元になる。日本語コメントを含む場合は **ファイル先頭に `@charset "UTF-8";` を置く**こと（standalone でブラウザ表示した際の文字化け防止。CSS では `@charset` が先頭行でなければ無効）。**`<style>` へインラインする際は `@charset` 行は含めない**（`<style>` 内では無効で、HTML の `<meta charset>` が encoding を支配する）。

> フラグメント内のフォーマット（インデント・空白・属性順）は self-check の byte 比較基準になるため、生成後は触らない（正典が唯一の真実）。

#### Step 0b-2: 各画面へ verbatim ペースト + スロット差し込み

各画面 HTML を生成するとき、その画面の割り当て（`ヘッダー` / `ボトムメニュー` / `現在タブ`）に従って:

1. `components.css` の中身を各 HTML の `<style>` に**逐語インライン**（`root-variables.css` の `:root` インライン直後に置く。`<link>` / `@import` 禁止）
2. 割り当てヘッダー種別（A=`*-header-home` / B=`*-header-sub` / なし=挿入しない）のフラグメントを `components.html` から**逐語ペースト**し、`<!--SLOT:TITLE-->` をその画面のタイトル、`<!--SLOT:BACK-->` を戻り先、`<!--SLOT:HEADER-ACTION-->` を末尾アクション（既定なし）で差し込む
3. `ボトムメニュー`=有 かつ platform=mobile のとき `mobile-bottom-nav` フラグメントを**逐語ペースト**し、`現在タブ` の id に一致する `<a data-tab="{id}">` にのみ `aria-current="page"` を付与（`現在タブ`=`—` のときは全タブ非アクティブ）
   - **ナビ階層ルールの遵守**: ボトムメニューを埋め込むのは `ボトムメニュー`=有 の画面（= 各ボトムタブの親 / 着地画面）**だけ**。`ボトムメニュー`=無 の子画面（ヘッダー B・戻るで親に戻る画面）にはタブバーを**付けない**。割り当てを無視して全画面にボトムナビを足さないこと（Step 14 Step 2b-2 の大原則）。割り当てに違和感があれば Step 14 に差し戻す

**禁止**: 画面ごとに chrome のマークアップ・CSS を**再発明**すること、末尾要素やアイコン・stroke-width を画面ごとに変えること、ランタイム JS / `<iframe>` / `fetch` で chrome を動的注入すること。可変部はスロットのみ。

#### Step 0b-3: chrome 一貫性 self-check（HTML 出力後・必須）

`_shared/root-variables.css` の self-check（後述「CSS 自己完結ルール」）と**同型**で、chrome の逐語一致を検証する:

- 各画面 HTML から `<nav class="mobile-bottom-nav"> … </nav>` を抽出し、`aria-current="page"`（属性 1 個）を除去して正規化したうえで、`components.html` の `mobile-bottom-nav` フラグメント（同じく `aria-current` 除去）と **byte 一致**することを確認
- ヘッダーも割り当て種別（A/B）ごとに、`<!--SLOT:*-->` に対応する可変テキストを伏せて正規化し、正典フラグメントと byte 一致を確認
- chrome CSS（`.mobile-header` / `.mobile-bottom-nav` 等のルール）が `components.css` と一致することを確認（root-variables の行数 / md5 比較と同方式）
- 不一致はリトライ最大 3 回。3 回連続で不一致なら `feedback-log.md` に Pattern B（`step17 chrome verbatim-paste mismatch`）を記録して **abort**。ownership は root-variables.css の self-check と同じ（subagent は HTML を Write せず、orchestrator に `status: "chrome_copy_failed"` + 比較結果を return。orchestrator が Step 17 を停止し `/clear` + 再実行を案内する）
- **abort メッセージに修正先の案内を必ず含める**: chrome の byte 不一致は、多くの場合「採点ループ（Step 19/20）の chrome 指摘を**個別画面で直そうとした**」ことが原因。abort 時のユーザー向けメッセージに次を明示する — 「chrome（ボトムメニュー / ヘッダー）への修正は**正典で直してください**: 見た目/品質の調整は `_shared/components.html` / `_shared/components.css`（値が token 由来なら `_shared/root-variables.css`）を直して全画面へ再ペースト、タブ項目・アイコン・ラベル等の IA 変更は `00-screen-list.md`「## 共通部品定義（chrome）」（Step 14）を更新してください。**個別画面の chrome を直接編集すると毎回この abort になります**（`docs/html-generation-rules.md` §11.6）」。

### Step 0c: イラスト正典の生成（該当案件のみ）

> **`pictogram` ポリシーでは本 step を実行しない。** 空状態・オンボーディング・エラー等の中央ビジュアルは独自シーンイラストを手描きせず、`icons/` の単一アイコンを拡大表示で表現する（`docs/html-generation-rules.md` §2「pictogram のイラスト表現」+ 後述「イラスト・装飾グラフィック実装ルール」）。`_shared/illustrations/` 正典は生成されず休止状態となる。以下の記述は後方互換のための定義であり、データ駆動グラフィック（盤面・チャート等）は本 step と無関係に従来通り扱う（項 4）。

繰り返し登場しうるイラスト（太陽・空状態の挿絵・装飾モチーフ等）は、画面ごとに AI が描き直すと**形も色もドリフトする**（過去事故「同じ絵柄なのに画面間で色が違う」の主因）。chrome（Step 0b）と同じ機構で **正典を一度だけ描き → 各画面へ逐語ペースト → self-check** する。完全なルールは `docs/html-generation-rules.md` §11.7 を参照。

1. **列挙（命名はここで 1 回だけ）**: Step 0 と同じコンテキスト（`00-screen-list.md` + 全画面仕様書 .md を読んでいる状態）で、複数画面に登場しうる・または装飾的なイラストを名前付きで列挙する。仕様書の「状態パターン」節（empty 状態の挿絵等）も列挙対象に含める。**命名がこの単一コンテキストの 1 回に集約される**ため、「同じ絵に画面ごとの別名」が構造的に発生しない。
2. **1 回だけ描く**: 各イラストを `artifacts/{app_name}/screens/_shared/illustrations/{name}.svg` に保存する。**内部の色は `var(--…)`（通常 token / 装飾パレット `--color-illustration-*`）か `currentColor` のみ**（生 hex 禁止 — 正典ファイル自体も lint 対象）。装飾パレットに無い色が必要なら `var(--color-illustration-{新名})` で参照だけ書く（未解決 var として report の昇格キューに載り、Step 21 ゲート → Step 24 で tokens.json に昇格する。**hex を発明して埋めない**）。
3. **各画面へは逐語ペースト**: 中身（inner content）を一切変えずに貼る。可変は**外側 `<svg>` タグのサイズ系属性（width / height / class）のみ**。中身を画面ごとに調整したくなったら**正典を直して全画面へ再ペースト**する（chrome §11.6 と同方針）。
4. **対象外（正典化しない）**: データで形が変わるグラフィック（盤面・チャート・波形等のデータ駆動描画）。これらは zero-literal（色は token 参照のみ）だけ適用し、lint では「未照合 SVG」として report に載る（人間がデータ駆動と確認する）。

> `pictogram` は独自シーンイラストを手描きしないため本 step 全体をスキップする（`_shared/illustrations/` を作らない）。`illustration_character` / `emoji_casual` も同様にスキップ（プレースホルダー / 絵文字を使う）。

### イラスト・装飾グラフィック実装ルール（必須）

画面内のグラフィックを 2 種に分けて扱う:

- **表現的イラスト・装飾モチーフ**（空状態・オンボーディング・エラーの中央ビジュアル、太陽・木立・人物・動物・乗り物等のシーン）: `pictogram` では **手描き（インライン SVG で作画）しない。** `icons/` から Read した単一アイコンを拡大表示（`.empty-state__icon` 等）で表現する。CSS div でも表現しない。
- **データ駆動の機能グラフィック**（盤面・チャート・グラフ・地図・波形等、データで形が変わる描画）と後述のドメイン面オブジェクト: 従来どおり **インライン SVG で実装する**。下記の禁止事項（CSS div / ラスター / 色の生書き）はこの機能グラフィックに適用する。

**禁止:**
- CSS `div` + `border-radius` パーセント指定でイラストを表現すること（Figma キャプチャ時に四角に崩れる・端が切れる不具合の原因）
- `overflow: hidden` でイラストをトリミングすること（Figma の HTML レンダリングとブラウザで結果が異なる。`.screen` の角丸フレーム等 **UI コンテナ自体の clip 用途は対象外**）
- `<img src="*.png">` などのラスター画像をイラスト・装飾グラフィックに使用すること（写真・外部ロゴを除く — 下記「例外」参照）
- **色の生書き（zero-literal）**: `fill="#4CAF50"` のような hex / rgb() / CSS 色名の直書き。**定義済み token と同じ値でも禁止**（テーマ切替を壊し、画面間ドリフトの主形態のため）。色は `style="fill: var(--…)"` / `currentColor` のみ

**イラスト/画像全般の例外:** 写真・外部ロゴ（SVG 非公開）のみ `<img>` タグによるラスター形式を許容。イラスト・装飾グラフィック用途のラスター画像は引き続き禁止。

**空状態などの拡大アイコン（表現的イラストの置き換え）:** `icons/` から Read した単一アイコンを拡大表示する。目安 CSS:

```css
.empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--sp-md, 12px); }
.empty-state__icon { width: clamp(64px, 18vw, 96px); height: auto; color: var(--color-on-surface-variant); }
```

アイコンは `currentColor` 継承のため `color:` で色を与える（控えめな `--color-on-surface-variant` 等・色 var に fallback リテラルを付けない）。装飾目的なので `aria-hidden="true"` を付し、意味はテキストで伝える。

**データ駆動グラフィックの実装方法:** `<svg>` + `<path>` / `<rect>` / `<circle>` 等の SVG プリミティブで構成する。色は必ず token の `var(--…)` 参照（生 hex 禁止）。

```html
<!-- OK: 空状態の中央ビジュアル = icons/ の単一アイコンを拡大（手描きシーンにしない） -->
<div class="empty-state">
  <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="..."/> <!-- 例: icons/inbox.svg を Read -->
  </svg>
  <p>データがありません</p>
</div>

<!-- NG: 表現的シーンを手描き（人物・乗り物・自然モチーフ等）。pictogram では作らない -->
<svg width="80" height="100" viewBox="0 0 80 100"><ellipse cx="40" cy="45" rx="32" ry="38"/><rect x="34" y="78" width="12" height="20"/></svg>

<!-- NG: 色の生書き (zero-literal 違反)。データ駆動グラフィックでも hex 直書きは不可 -->
<svg viewBox="0 0 100 40"><rect x="0" y="10" width="30" height="20" fill="#4CAF50"/></svg>

<!-- OK: データ駆動グラフィックはインライン SVG + 色は token の var() 参照 (SVG 属性は var() 不可のため style= 経由) -->
<svg viewBox="0 0 100 40"><rect x="0" y="10" width="30" height="20" style="fill: var(--color-primary)"/></svg>
```

**UI 要素（ボタン・カード・入力欄など）は SVG 化しない** — CSS のまま実装すること（SVG 化すると逆に崩れる）。

#### ドメイン固有オブジェクトは必ず「ドメイン面」の上に置く（必須）

機能ロジック由来のオブジェクト（盤上の駒・グラフの系列マーカー・マップ上のピン等、tokens.json の `palette.domain_surfaces` で定義されたペアに登場する fg 要素）を装飾用途で UI に再登場させる際は、**必ずそのペアの bg にあたるドメイン面 token を背景に敷くこと**。body / surface 直上に裸で置いてはならない。

```css
/* NG: 駒オブジェクトを body bg 直上に配置（dark mode で piece-black が body-bg と
       1.05:1 になり消失する事故が発生） */
.draw-pair .piece-black { /* 親が .draw-pair (background なし) */ }

/* OK: ドメイン面 token を背景に敷いてから駒を載せる */
.draw-pair {
  background: var(--color-board-dark-square);  /* tokens.json の domain_surface */
  border-radius: var(--radius-md);
  padding: var(--sp-md);
}
.draw-pair .piece-black { /* これで piece vs board-dark-square で WCAG 検証済 contrast */ }
```

判定基準: tokens.json の `palette.domain_surfaces[]` に登場する fg token (例: `piece-black` / `piece-red`) を UI 中で描画する際は、同じ pair に書かれた bg token を**必ずスタイル上の祖先要素のいずれかに含める**。盤面グリッド (`.square`) は当然これを満たすが、勝敗表示・トロフィー近傍・凡例等の「装飾的な再登場」で抜けやすい。

過去事故 (Draughts result--empty--dark): `.draw-pair` 内の piece-black が body-bg (#1B1F1A) 上に直置きされ 1.05:1 で視認不能。両テーマで再修正 (board-dark-square 適用後 10.59:1 / 12.66:1)。

### カラー値のトークン参照ルール（必須）

#### 大原則: zero-literal

画面 content には**色リテラルを一切書かない**。hex / `rgb()` / `hsl()` / CSS 色名（`white` 等）のすべてが対象で、出現場所も **CSS プロパティ・inline `style=`・SVG presentation 属性（`fill=` / `stroke=` / `stop-color=`）・`var()` の fallback 値** の全部を含む。色は `var(--token)` / `currentColor`（+ `none` / `transparent` / `inherit`）のみで表現する。

- **定義済み token と同じ値の生書きも NG**。`fill="#121820"`（= `--color-on-surface` の値）は light では同じに見えるが、(a) テーマ切替で追従できず dark で破綻する、(b) 後から token を変えても取り残され**画面間ドリフトの主形態**になる（実測: 観測された直書きの大半がこの型だった）。
- **除外（リテラルを書いてよい場所）**: `:root` 系の定義ブロック（`:root` / `:root[data-theme=…]` / `@media(prefers-color-scheme){ :root… }`）＝ token 定義そのもの／raster `<img>`／プレビュー足場定数（`#E8E4DF` と `.screen` フレーム影 `rgba(0,0,0,0.15)` `rgba(0,0,0,0.05)` の完全一致値のみ）。
- **検証**: `scripts/lint-screen-colors.mjs` が機械判定する（完全一致のみ・近似マッチなし）。生成後の self-check（後述「色トークン適合 self-check」）で fail-closed。

以下の rgba 分類は、この大原則の運用詳細（「token 化してから参照する」の token 化先の決め方）。`rgba()` の使い方は **用途によって2つに分類**して扱うこと。

#### A. コンテナ背景・状態ハイライト → トークン化必須（rgba 直書き禁止）

セマンティックカラー（primary・success・error 等）を薄く引いた背景色（状態行・選択要素・アイコンコンテナ等）は、
**alpha は固有の flat color を得るための手段**に過ぎない。hex トークンに変換して CSS 変数で参照すること。

```css
/* NG: セマンティックカラーの RGB を alpha で直書き */
.winner-row    { background: rgba(46, 125, 50, 0.06); }
.radio:checked { background: rgba(139, 0, 0, 0.06); }

/* OK: tokens.json の -container トークンを CSS 変数で参照 */
.winner-row    { background: var(--color-success-container); }
.radio:checked { background: var(--color-primary-container); }
```

`tokens.json` に `-container` トークンが未定義の場合は、⑩のコンテナカラートークンルールに従って追加してから参照すること。

#### B. 本質的な半透明 UI → rgba 許容（ただし tokens.json に定義）

透過そのものが視覚効果であるケース（オーバーレイ・フロストガラス・ボックスシャドウ等）は `rgba()` のまま使ってよい。
ただし CSS に直書きせず、**tokens.json のトークン値として定義して CSS 変数で参照**すること。

/** tokens.json に定義 **/
```json
{
  "elevation": {
    "card": {
      "$value": "0 1px 3px rgba(0,0,0,0.12)",
      "$type": "shadow"
    }
  },
  "color": {
    "overlay": {
      "$value": "rgba(0,0,0,0.5)",
      "$type": "color",
      "$description": "モーダル背景スクリム"
    },
    "overlay-dark": {
      "$value": "rgba(0,0,0,0.7)",
      "$type": "color"
    }
  }
}
```

```css
/* OK: tokens.json 経由で参照 */
.modal-backdrop { background: var(--overlay); }
.card           { box-shadow: var(--elevation-card); }
```

**判断基準:** alpha を除いて hex に置き換えても意図した見た目になるなら A（コンテナ）、透過が必要不可欠なら B（半透明 UI）。

### コンポーネント構造統一ルール（必須）

同一画面内で同じコンポーネントが複数登場する場合（バッジ・カード・リスト行等）、サンプルデータの内容に関わらず全インスタンスを同じ HTML 構造で実装すること。

- **NG**: 1件目のバッジにだけアイコンを入れ、2件目以降はテキストのみにする
- **OK**: 全バッジでアイコンあり、または全バッジでアイコンなし、に統一する

生成後の自己チェック: 同じクラス名を持つ要素（`.badge`・`.card`・`.list-item` 等）がHTMLに複数存在する場合、その内部構造（子要素の種類・順序）が全インスタンスで一致していることを確認すること。

### SVG stroke-linecap ルール（必須）

SVGで点を描画する場合（例: 「！」の下の点、「i」の上の点）、`stroke-linecap="round"` を必ず指定すること。

**問題**: SVGパスの `h.01`（極小の水平線）は、デフォルトの `stroke-linecap: butt` では描画されず、点が消える。

```html
<!-- NG: 点が表示されない -->
<svg viewBox="0 0 24 24" style="fill: none;" stroke="currentColor" stroke-width="1.5">
  <path d="M12 9v4m0 4h.01"/>
</svg>

<!-- OK: stroke-linecap="round" で点が丸く表示される -->
<svg viewBox="0 0 24 24" style="fill: none;" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
  <path d="M12 9v4m0 4h.01"/>
</svg>
```

> **stroke-width の値は `design-brief.yaml.common.ui_constraints.icon_stroke_width`（現行 `1.5`）を SoT とする**（上の例の `1.5` は SoT 現行値の転記。値を独自にハードコードしない）。policy 別の期待スタイルは `docs/html-generation-rules.md` §2 を参照。

この問題はアラートアイコン（三角形＋「！」）、情報アイコン（丸＋「i」）で頻出する。
style-guide-view.html（12 で生成）のアイコンも同じルールで生成されているはず。

### 画面パターン生成ルール（Step 17 では default のみ）

`docs/screen-coverage-check.md` の §2 判定 3 分類・§3 コンテンツ差し替え原則・§4-1〜4-4 (L1〜L4 判定基準) を読み込み、各画面に該当するパターンを **仕様書 (`{画面名}.md`) に列挙**する (§4-5 L5 connectivity と §6 出力フォーマットは本 step の責務外のため使わない — 担当 step は同文書 §7 統合表を参照)。Step 17 で HTML として生成するのは **default 状態 1 枚のみ**。empty / loading / error / 追加状態の HTML 生成は **Step 25b (state-pattern-gen) に移管された**。

> **移管詳細**: 旧版では本 step で 1 画面につき default + empty + loading + error + 追加状態の HTML を一気に生成していたが、(1) トークン消費過大、(2) 人間承認体験悪化、(3) main 修正が sub-state に伝搬しない、の 3 問題があった。新フローでは Step 17 は default 1 枚に絞り、Step 25 後の Step 25a で user に sub-state 要否を確認、proceed 時のみ Step 25b で追加生成する。命名規約 (`{画面名}--{state}.html` / dual_theme 時 `--{state}--{theme}.html`) は Step 25b でそのまま引き継がれる。

**Step 17 が生成する HTML (1 画面あたり)**:

| platform_combo (+ web_viewports 展開後の platform dirs) | dual_theme_mode=false | dual_theme_mode=true |
|---|---|---|
| `web_only` (既定 = web のみ) | `web/{画面名}.html` (1 枚) | `web/{画面名}--light.html` + `web/{画面名}--dark.html` (2 枚) |
| `mobile_only` | `mobile/{画面名}.html` (1 枚) | `mobile/{画面名}--light.html` + `mobile/{画面名}--dark.html` (2 枚) |
| `mobile_and_web` (既定 = web + mobile) | 2 枚 (web/ + mobile/) | 4 枚 (web/light + web/dark + mobile/light + mobile/dark) |

> **web_viewports ∋ sm の場合**: 上表の platform dirs に `web-sm/` が加わる (同じ theme 規則を適用)。例: `web_only` + `web_viewports=["desktop","sm"]` + dual_theme=false → `web/` + `web-sm/` の 2 枚。`web_viewports=["sm"]` なら `web-sm/` のみ。枚数式は常に「画面数 × platform dirs 数 × theme 数」。

**仕様書 (`{画面名}.md`) には全状態の振る舞いを記述する** (default / empty / loading / error / 追加状態 すべて)。Step 25a が本 .md と `requirements.json.design_output_scope.state_pattern` を読んで生成計画を立てる。

> **インタラクション状態の扱い**: hover / active 等は default HTML 内で必要な箇所のみ CSS で対応する。状態違いとして独立した HTML ファイルにはしない (それは Step 25b の責務)。Figma キャプチャ時 (Step 22) も default 状態のみキャプチャされる (sub-state Figma は Step 25e で追加 capture)。

### 仕様値バインドルール（必須）

HTMLおよびMDの技術仕様値（ファイルサイズ上限・対応フォーマット・時間制限・文字数制限・数値しきい値）は必ず `requirements/05-features.md` から引用すること。
モデルが「それらしい値」で補完することを禁止する。
引用できる値が見つからない場合は「{要件未定義}」と記載して値を空欄にすること。

### フォーム要素の初期状態ルール（必須）

HTMLのフォーム要素（textarea・input[type=text]等）には value 属性や initial content にサンプルテキストを入れないこと。
代わりに placeholder 属性を使うこと。
文字カウンターなど JS カウントに依存する要素の初期表示値は必ず「0」にすること。

### CSS変数の命名規約（必須）

全HTMLファイルの `:root` で宣言するCSS変数は、以下の命名規約に従うこと。
**同じ値に対して複数の変数名を定義してはならない**（二重定義禁止）。

```
カテゴリ       接頭辞        例
─────────────────────────────────────
色           --color-      --color-primary, --color-on-surface
フォント      --font-       --font-base, --font-display, --font-numeric
文字サイズ    --fs-         --fs-base, --fs-sm, --fs-xs
間隔         --sp-         --sp-md, --sp-lg, --sp-touch
角丸         --radius-     --radius-md, --radius-lg
影           --shadow-     --shadow-sm, --shadow-md
```

NG: `--font-size-xxl: 32px` (旧長形式、廃止) を使う、または旧長形式と `--fs-xxl: 32px` を併記する
OK: `--fs-xxl: 32px` のみ定義する（短い接頭辞に統一、上の対応表どおり）

新しいHTMLを生成する際は既存画面の `:root` と一致させること。変数名のブレが発生すると、デザインシステムとの紐づけ（24）が壊れる。

### 各画面の成果物 (default のみ)

画面ごとに以下のファイルを生成すること。MDのみは不完全とみなす。
（`platform_combo` + `web_viewports` の展開結果に応じて web/ / web-sm/ / mobile/ を生成）

> **前提（全画面生成前に 1 回）**: `_shared/components.html` / `_shared/components.css`（共通部品 chrome 正典、Step 0b）と `_shared/root-variables.css`、および該当案件では `_shared/illustrations/{name}.svg`（イラスト正典、Step 0c）を先に生成しておくこと。各画面はこれらを逐語インライン / ペーストして自己完結 HTML にする。

1. `artifacts/{app_name}/screens/{画面名}.md` — 画面仕様書（下記フォーマット、root に 1 つだけ、全状態の振る舞いを記述）
2. `artifacts/{app_name}/screens/web/{画面名}.html` — Web デスクトップ版 default プレビュー（1440×900）※ `platform_combo ∋ web` かつ `web_viewports ∋ desktop`（欠落時 desktop 扱い）の場合
3. `artifacts/{app_name}/screens/web-sm/{画面名}.html` — Web スマホ幅版 default プレビュー（390×844、ブラウザページ体裁）※ `platform_combo ∋ web` かつ `web_viewports ∋ sm` の場合
4. `artifacts/{app_name}/screens/mobile/{画面名}.html` — モバイル版 default プレビュー（390×844、BottomTab ナビ、フォンフレーム付き）※ `platform_combo ∋ mobile` の場合
5. dual_theme_mode=true の場合、上記 2 / 3 / 4 に `--light` / `--dark` suffix を付けた 2 枚ずつ

> **sub-state HTML は生成しない**: `{画面名}--empty.html` / `--loading.html` / `--error.html` / 画面性質追加 (`--modal.html` / `--validation-error.html` / `--delete.html` 等) は **Step 25b で生成される**。Step 17 では仕様書 (.md) に振る舞いを記述するに留める。

HTMLは tokens.json の CSS 変数を使って実装すること。
tokens.json の変数を直接値（例: `#0D1117`）で上書きしてはいけない。

### 仕様書（MD）のフォーマット

`artifacts/{app_name}/screens/{画面名}.md` として保存：

```markdown
# {画面名} 画面仕様

## 目的
{この画面が担う機能・ユーザーの目的}

## レイアウト構成
- ナビゲーション: {BottomTab / TopBar / なし}
- ヘッダー: {内容}
- メインコンテンツ: {要素一覧}
- CTA: {ボタン名・位置}
- フッター: {内容またはなし}

## コンポーネント一覧
| コンポーネント | 分類 | トークン参照 | WCAG要件 |
|---|---|---|---|
| プライマリCTA | 主要ボタン | color.primary, touch-target(44px) | 2.5.8: 44px以上 ✅ |
| {ビュー切替等の非主要ボタン} | 非主要ボタン | color.primary, 32px | 2.5.8: 32px以上 ✅（非主要） |
| テキスト（本文） | — | color.on-surface, font-size-base | 1.4.3: 4.5:1以上 ✅ |
| 補足テキスト・ラベル | デエンファシス | color.text-deemphasis, font-size-sm | 1.4.3: 3:1以上 ✅（デエンファシス例外） |
| フォーカス要素 | — | color.focus-ring | 2.4.7: フォーカスリング ✅ |

## 状態パターン (仕様書に記述する — HTML 生成は Step 25b)
- default — 通常データありの主要 UI (本 step で HTML 化)
- empty — データなしの場合の UI 振る舞い (HTML は Step 25b)
- loading — 読み込み中スケルトン / プログレス表示 (HTML は Step 25b)
- error — エラーメッセージ + リカバリー手段 (HTML は Step 25b)
- {画面性質に応じた追加状態 (modal / validation-error / delete dialog 等)} — HTML は Step 25b

## 画面遷移
- {アクション} → {遷移先画面}
```

---

## 完了後
「画面仕様書 + 全画面 default HTML（{N}画面 × {platform 数}）を生成しました。18 デザインレビューへ進みます。」（sub-state HTML は Step 25b で追加生成）
→ `skills/18-design-review/SKILL.md` を Read して 18 を実行
