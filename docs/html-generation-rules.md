# HTML 生成共通ルール

AYATORI パイプラインで HTML を生成する全スキル（09 サンプル / 17 全画面 / 12 スタイルガイド / 24 DS 更新 / 25 コンポーネント）が **必ず遵守** するルールを一元管理する。ルール変更時はこのファイルを更新し、参照元スキルは自動的に追従する。

**参照元スキル**:
- `skills/09-sample-html-gen/SKILL.md` — 3案サンプル HTML 生成
- `skills/17-screen-gen/SKILL.md` — 全画面 HTML + 4状態パターン
- `skills/12-design-system/SKILL.md` — style-guide-view.html 生成
- `skills/24-design-system-update/SKILL.md` — 差分反映時の HTML 参照
- `skills/25-component-build/SKILL.md` — コンポーネント HTML

---

## 1. CSS 変数命名規約（必須）

### カテゴリ接頭辞

```
カテゴリ       接頭辞        例
─────────────────────────────────────────────────
色            --color-      --color-primary, --color-on-surface, --color-bg
フォント       --font-       --font-base, --font-display, --font-numeric
文字サイズ     --fs-         --fs-base, --fs-sm, --fs-xs, --fs-xxl
フォントウェイト --fw-       --fw-regular, --fw-bold
間隔          --sp-         --sp-md, --sp-lg, --sp-touch
角丸          --radius-     --radius-sm, --radius-md, --radius-lg
影            --shadow-     --shadow-sm, --shadow-md, --shadow-lg
アニメ時間     --dur-        --dur-fast, --dur-base, --dur-slow
イージング     --ease-       --ease-out, --ease-in-out
```

### 禁止事項

- **旧長形式 (`--font-size-*` / `--space-*` 等) と短形式 (`--fs-*` / `--sp-*` 等) を併用してはならない**（命名は短形式に統一、二重定義禁止）
  - NG: `--font-size-xxl: 32px;` (旧形式、廃止) や、新旧両方の `--font-size-xxl` + `--fs-xxl` を併記する
  - OK: `--fs-xxl: 32px;` のみ (短形式に統一、上の対応表どおり)
- 新しい HTML を生成する際は **既存画面の `:root` と一致させる**
- 変数名のブレがあると、デザインシステムとの紐づけ（24）が壊れる

### トークン参照（必須）— zero-literal

`tokens.json` が存在する場合、HTML の content には**色リテラルを一切書かない**（zero-literal）。色は `var(--token)` / `currentColor`（+ `none` / `transparent` / `inherit`）のみ:

- NG: `background: #0D1117;` ／ `<path fill="#121820">` ／ `style="stroke: rgb(163,58,42)"` ／ `fill="white"`
- OK: `background: var(--color-bg);` ／ `<svg stroke="currentColor">` ／ `style="fill: var(--color-illustration-sun)"`

**範囲と例外**:
- 対象 = CSS プロパティ・inline `style=`・SVG presentation 属性（`fill=` / `stroke=` / `stop-color=`）・`var()` の fallback 値。**hex / rgb() / hsl() / CSS 色名すべて**。
- **定義済み token と同じ値の生書きも NG**（light では同じに見えるが、テーマ切替で破綻し、後から token を変えると取り残されて画面間ドリフトになる — これがドリフトの主形態）。
- SVG presentation 属性は `var()` を**解釈しない**ため、`fill="var(--x)"` も NG — `style="fill: var(--x)"` か `currentColor` 継承を使う（§2）。
- 例外（リテラル可）: `:root` 系の**定義ブロック**（token 定義そのもの）／raster `<img>`／プレビュー足場定数（`#E8E4DF`・`.screen` フレーム影 `rgba(0,0,0,0.15)` `rgba(0,0,0,0.05)` の完全一致値のみ。**値の正本は `scripts/lint-screen-colors.mjs` の `SCAFFOLD_ALLOW`** — 改訂は script 側で行い本文は値を増やさない）。なお `:root` への**台帳外の色変数追加**（リテラルを定義ブロックに持ち上げて var 化する迂回）は違反にはならないが、lint が `extra_root_vars` として report に載せ Step 21 で人間が判断する。
- 検証 = `scripts/lint-screen-colors.mjs`（完全一致のみ・近似マッチなし。Step 17 self-check で fail-closed / Step 18 が全画面 report）。

`tokens.json` がまだない段階（09 サンプル HTML 生成時）は、`design-brief.yaml cases[X].palette.tokens[]` の HEX を `:root[data-variant="X"]` 内にのみ定義する。

---

## 2. SVG アイコンルール（必須）

> **`illustration_policy` による適用範囲**
>
> | ルール | `pictogram` | `illustration_character` | `emoji_casual` |
> |---|---|---|---|
> | フォントアイコン禁止 | ✅ 全ポリシー共通 | ✅ | ✅ |
> | インライン SVG 必須 | ✅ 適用 | ✗ 代わりに `<div class="illust-placeholder">` | ✗ 代わりに Unicode 絵文字 |
> | `stroke-linecap="round"` 必須 | ✅ 適用（SVG 使用時） | ✗ 非適用 | ✗ 非適用 |
>
> 以下のインライン SVG ルールは `illustration_policy == "pictogram"` の場合のみ適用する。

### illustration_policy 別の期待スタイル（SoT）

生成物は **選択された `illustration_policy` の期待スタイルに従う**こと（特定値特化ではなく「どの値でも選択 policy に沿う」のが本質）。各 policy の期待スタイルを以下に SoT として定義する。09（サンプル）/ 17（全画面）共通ルール。

| `illustration_policy` | アイコン（タブバー・アクション） | イラスト（空状態・オンボーディング・エラー） | UI 内の絵文字 |
|---|---|---|---|
| `pictogram` | **インライン SVG の線画**（Heroicons / Phosphor 風アウトライン）。`stroke="currentColor"` + `fill="none"` 基調（＝主要アイコンに塗り `fill` 色を持たせない）。線質は下記 stroke-width SoT + `stroke-linecap="round"` | アイコンセットの単一アイコンを拡大表示（〜64–96px・中央寄せ・線画・`stroke="currentColor"`・`aria-hidden="true"`）。人物・動物・乗り物・自然等の独自シーン描画は禁止。データ駆動グラフィック（チャート/盤面/地図/波形）は本欄の対象外で従来通りインライン SVG 可 | 使わない |
| `illustration_character` | `illust-placeholder` ブロック（具体マークアップは `.claude/agents/ayatori-sample-html-builder.md` Phase 4.5 / `skills/17-screen-gen/SKILL.md` Step 0 参照）。独自 SVG 線画もフォントアイコンも使わない | キャラクター挿絵を想定したプレースホルダー | 使わない（`emoji_allowed` が true でもアイコンに使わない） |
| `emoji_casual` | Unicode 絵文字を直接使用（`emoji_allowed: true` 前提） | 絵文字またはプレースホルダー | **解禁**（§12 SSB-04 と整合。無条件禁止にしない） |

> **絵文字可否の唯一の判定基準は `illustration_policy`**（§12 の禁止行は `pictogram` / `illustration_character` のみ対象。`emoji_casual` のみ解禁）。`emoji_allowed` は従属フラグであり、`illustration_policy != emoji_casual` のときは値に関わらず **false 扱い**（`pictogram` かつ `emoji_allowed:true` のような矛盾入力は policy 側に倒す）。
>
> **`emoji_casual` で絵文字をアイコンに使う場合の a11y（WCAG 1.1.1 / 4.1.2）**: クリック可能・意味伝達の絵文字には §9 の `aria-label` 必須が引き続き適用される（絵文字の SR 読み上げ名は UI 意図と一致しないため）。装飾目的の絵文字は `aria-hidden="true"` を付す。

### pictogram のイラスト表現

`pictogram` ポリシーでは **空状態・オンボーディング・エラー画面の中央ビジュアルもアイコンセットの単一アイコンを拡大表示**（〜64–96px・中央寄せ・`stroke="currentColor"`・`aria-hidden="true"`）で表現する。人物・動物・乗り物・自然・建物などの**独自シーンイラストを手描き（インライン SVG で作画）しない**。装飾モチーフ（太陽・木立等）の手描きも同様に不可。データで形が変わる**機能グラフィック（チャート・盤面・地図・波形等）は「イラスト」ではなく**、従来どおりインライン SVG で実装する（本規則の対象外・§11.7 参照）。

### stroke-width の SoT

線画アイコンの `stroke-width` の**唯一の正本は `design-brief.yaml.common.ui_constraints.icon_stroke_width`（現行 `"1.5"`）**。本ファイルの例・skill 17 の例はこの SoT を参照する説明用であり、**値を独自にハードコードしない**（過去にチケット例 `1.75` を即採用しかけたが、値変更は別途人間確認＝(D) UNCERTAIN）。以下の例の数値（`1.5`）は SoT 現行値を転記したもの。

### フォントアイコン使用禁止

Material Icons / Font Awesome などの **フォントアイコンは使わない**（全 `illustration_policy` 共通）。

**理由**: Figma キャプチャ時（22）にフォントが読み込まれず、アイコンが表示されない問題が発生する。

### インライン SVG を使う（`pictogram` のみ）

```html
<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2 L22 22 L2 22 Z"/>
</svg>
```

### 基本 CSS

```css
.icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  fill: currentColor;   /* 親要素の color を継承 */
}
```

### stroke-linecap="round" 必須（点の描画）

SVG で点を描画する場合（例: 「！」の下の点、「i」の上の点）、`stroke-linecap="round"` を指定しないと **点が描画されない**。

```html
<!-- NG: 点が消える（デフォルトの stroke-linecap: butt では極小線が描画されない） -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M12 9v4m0 4h.01"/>
</svg>

<!-- OK: stroke-linecap="round" で点が丸く表示される -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
  <path d="M12 9v4m0 4h.01"/>
</svg>
```

頻出箇所: アラートアイコン（三角形＋「！」）、情報アイコン（丸＋「i」）。

---

## 3. フォーム要素の初期状態ルール（必須）

- `<textarea>` / `<input type="text">` の初期内容は **空**
- サンプルテキストは `value` 属性ではなく **`placeholder` 属性** に入れる
- 文字カウンターなど JS カウントに依存する要素の初期表示値は **必ず「0」**

```html
<!-- NG -->
<textarea value="ここにテキストを入力">ここにテキストを入力</textarea>

<!-- OK -->
<textarea placeholder="ここにテキストを入力"></textarea>
<span class="counter">0 / 2000 文字</span>
```

---

## 4. HTML 固定サイズ規約（必須）

環境による見え方のブレを防ぐため、`<body>` に固定サイズを指定する:

| プラットフォーム | `<body>` サイズ | 備考 |
|---|---|---|
| Web（管理画面・ダッシュボード） | `width: 1440px; min-height: 900px;` | ブラウザ枠ダミーは任意 |
| Web スマホ幅（`web-sm/`） | body は全幅ラッパー。実体は `.screen { width: 390px; min-height: 844px; }` | ブラウザページ体裁（フォンフレーム装飾 / BottomTab なし、border-radius 8px）。構造は `skills/17-screen-gen/SKILL.md` § Web スマホ幅画面のプレビュー構造 |
| Mobile（iOS ベース） | `width: 390px; min-height: 844px;` | iPhone 15 標準。サンプル確認(Step 09)・画面(Step 17)とも mobile 1 種に集約し iOS ベースで描画。iOS/Android の差はフレーム装飾のみで別ファイルにしない |

```css
body {
  width: 1440px;    /* または Mobile の 390px */
  min-height: 900px;
  margin: 0 auto;
}
```

> **fluid / レスポンシブ禁止（機械強制あり）**: 固定幅指定を省いた fluid レイアウト（`width: 100%` のみ・固定幅ラッパー無し）や、`min-width` / `max-width` の media query による breakpoint 切替は**禁止**。Figma キャプチャはブラウザで開いて `figmaselector` で要素を切り出す方式で viewport 幅を制御できないため、固定幅要素を欠くとフレームがブラウザ窓幅依存の意図しない幅で出力される（`prefers-reduced-motion` 等の幅非依存クエリは許容）。幅ごとの表現が必要な場合は `web/`（1440px）と `web-sm/`（390px）の**別ファイル派生**で行う。本規約は `scripts/lint-screen-frame.mjs --check` が機械検証する（Step 17 self-check + Step 22 キャプチャ pre-flight の二層、hard・exit 1）。

### プラットフォーム別フレーム装飾

- **Mobile（iOS ベース）**: iPhone フレーム（Dynamic Island / notch 付き）の装飾を HTML 内に含める（`skills/09-sample-html-gen/refs/platform-frames.css` の `body[data-platform="mobile"]` 参照）。iOS/Android は装飾差のみで mobile 1 種に集約するため、Android 個別装飾は出力しない
- **Web**: フレーム装飾は任意（通常不要）
- **Web スマホ幅（web-sm）**: iPhone フレーム装飾（Dynamic Island / notch / 40px 角丸）を**入れない**。`.screen` はブラウザの表示領域を表す（控えめな 8px 角丸 + 影のみ）

### N分割グリッドの横ブローアウト防止（mobile / web-sm 必須）

**対象は「端末幅を等分／固定幅で横に割るレイアウト全般」**（下の generalization 注記の通り `repeat(N,1fr)` に限らない）。例として `repeat(N,1fr)` を使う曜日カレンダー・7日升目・KPI タイル等があるが、**これらの用途を allowlist と読まないこと**（例に挙がっていない横並びでも原理が当てはまれば対象）。代表例の `grid-template-columns: repeat(N, 1fr)` は、CSS Grid 既定の `min-width: auto` によりセル内容が縮まず、390px 端末幅を右に突き破る（横スクロール / 見切れが発生）。**mobile / web-sm（いずれも 390px）では以下を必須**とする:

- グリッド子要素に `min-width: 0` を付与する。または列定義を `repeat(N, minmax(0, 1fr))` にする（どちらも既定の `min-width:auto` を無効化する同等手段）
- `gap` ・`padding` ・`font-size` は端末幅（390px）内に収まる値に保つ
- 上記でも収まらない場合は **列数削減・折り返し・水平スクロール許可（`overflow-x: auto`）を優先**する（WCAG 1.4.10 リフローの趣旨。コンテンツを切り捨てない）。`overflow-x: hidden` は「はみ出しが視覚的余白程度」と確認できる場合のみの最終手段とし、**使用した箇所は agent 完了 report に明記**する（内容欠落をサイレントに通さない）

> 同じ「等分の横並びで端末幅を突破する」問題は `repeat(N,1fr)` に限らない。**固定 px 列（`repeat(N, 56px)` 等）・`1fr` の明示連記・`display:flex` の `flex-wrap:nowrap` 横並び**でも同様に発生する。原理（端末幅内に収める）は等分横並びレイアウト全般に適用する。

```css
/* NG: セルが縮まず横ブローアウト */
.calendar { display: grid; grid-template-columns: repeat(7, 1fr); }

/* OK: minmax(0,1fr) で min-width:auto を無効化 */
.calendar { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
/* または子要素に min-width:0 */
.calendar > * { min-width: 0; }
```

`box-sizing: border-box`（§10 リセットで全要素に適用済み）が前提。web（1440px デスクトップ）は横幅に余裕があるため必須ではないが、N 分割グリッドを使う場合は同じ防御を推奨する。web-sm は 390px のため mobile と同じく**必須**。

---

## 5. Google Fonts の preconnect（必須）

Google Fonts を読み込む HTML には **必ず `<link rel="preconnect">` を指定** する。

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
```

**理由**: 和文フォント（Shippori Mincho、Noto Serif JP 等）は読み込みが重い。preconnect で接続確立を先行させることで描画を早める。

### 代替書体の明記（推奨）

```css
--font-display: 'Shippori Mincho', 'Noto Serif JP', serif;
--font-base: 'Outfit', 'Noto Sans JP', sans-serif;
--font-numeric: 'DM Mono', 'Source Code Pro', monospace;
```

---

## 6. prefers-reduced-motion 対応（必須）

WCAG 2.3.3 遵守のため、アニメーション・トランジションを持つ全 HTML で以下を指定する:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 例外

- 250ms 以下の短時間アニメーション（hover 時の軽微な transform 等）は prefers-reduced-motion 外でも動作して OK
- パララックス・大規模モーションは prefers-reduced-motion 時は **完全停止**

---

## 7. フォーカスリング実装パターン（必須）

WCAG 2.4.7 / 2.4.11 遵守:

```css
:where(button, a, input, textarea, select, [tabindex]):focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);   /* 親要素に応じて調整 */
}
```

- **`:focus-visible` を使う**（`:focus` だとマウスクリックでもリングが出て煩い）
- **sticky header/footer で隠れないよう `scroll-margin` を設定**:

```css
:where(button, a, input, textarea, select):focus-visible {
  scroll-margin-top: 80px;
  scroll-margin-bottom: 96px;
}
```

---

## 8. タッチターゲット 44px 確保（モバイル必須）

WCAG 2.5.8 + iOS HIG 準拠:

```css
:where(button, a, .clickable) {
  min-height: 44px;
  min-width: 44px;
  padding: var(--sp-sm) var(--sp-md);
}
```

- 視覚サイズが小さい要素（例: アイコンのみボタン）は **透明なパディング** で 44px を確保
- Web 管理画面では 40px まで許容（24px は最低ライン）

---

## 9. セマンティックHTML（推奨）

### ランドマーク構造

```html
<body>
  <header role="banner">...</header>
  <nav role="navigation" aria-label="メインナビ">...</nav>
  <main role="main">...</main>
  <aside role="complementary">...</aside>
  <footer role="contentinfo">...</footer>
</body>
```

### ARIA ラベル

- ボタン内がアイコンのみ → `aria-label` 必須
- フォーム要素 → `<label for>` で結合、または `aria-label`
- 状態変化要素（例: アコーディオン）→ `aria-expanded` / `aria-controls`

---

## 10. HTML ドキュメント構造テンプレート

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{画面名} - {アプリ名}</title>

  <!-- Google Fonts preconnect（フォント使用時必須） -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="..." rel="stylesheet">

  <style>
    /* :root で CSS 変数定義 */
    :root {
      --color-bg: #...;
      --color-on-bg: #...;
      /* ... */
    }

    /* リセット */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* 固定サイズ */
    body { width: 1440px; min-height: 900px; margin: 0 auto; }

    /* prefers-reduced-motion */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* フォーカスリング */
    :where(button, a, input, textarea, select, [tabindex]):focus-visible {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: 2px;
    }

    /* 各要素のスタイル ... */
  </style>
</head>
<body>
  <!-- コンテンツ -->
</body>
</html>
```

> **適用範囲の明確化**: 本節・§11 の自己完結規約（CSS の `<link>` / `@import` 禁止・正典 CSS / SVG の逐語インライン）は **LLM が生成し linter が検証するテキスト正典**（CSS 変数 / chrome 部品 / イラスト SVG）に固有の規約であり、AI 生成グラフィックの**ラスター `<img>` 相対参照**（`<img src="../_shared/graphics/{graphic_id}.(png|webp)" alt width height>`、pipeline.yaml C-26）には適用しない（敷衍しない）。ラスターは単一のバイナリ正典 1 ファイルであり、インライン複製（Base64 data URI）より参照の方が一貫性が高く LLM context も保護される（`docs/graphic-generation-design.md` §7）。なお**人間閲覧専用の派生レビュービュー**（21a `graphics/graphic-recommend.html` / 21c `graphics/samples/taste-compare.html` / 21g `graphics/graphic-embed-review.html` — いずれも LLM Read 経路外・本節の対象である画面 HTML ではない）のみ例外で、render 時に画像ファイルの byte をそのまま data URI として内包し自己完結させる。SoT は常にファイル側で、data URI は byte 一致の表示用複製（`docs/graphic-generation-design.md` §7「派生レビュービューの自己完結」）。

---

## 11. 共通部品（chrome）の verbatim-paste ルール（必須）

ボトムメニュー（タブバー）・ヘッダーのような **全画面で形が同じであるべき共通パーツ（chrome）** は、画面ごとに AI が組み立て直すと項目・アイコン・線の太さ・CSS 値（例: `padding-bottom`）がドリフトする。これを防ぐため、chrome は **「一度だけ正典を生成 → 各 HTML に逐語ペースト → self-check で一致検証」** する。`_shared/root-variables.css` の inline-copy idiom（§1 / §10）を「CSS 変数辞書」から「**部品フラグメント**」へ拡張したもの。

> **適用範囲**: 全画面 HTML を生成する Step 17。Step 25b は main HTML の chrome を byte-level 継承するため対象外（main で固めれば自動で揃う）。Step 09 サンプル HTML は 3 案比較が目的のため対象外。

### 11.1 共通部品の種類（まず基礎の 2 系統のみ）

| 部品 | platform | 種類 |
|---|---|---|
| ボトムメニュー（タブバー） | mobile | **1 種**（`mobile-bottom-nav`）。**web-sm には埋め込まない**（BottomTab は mobile ネイティブ専用） |
| ヘッダー | web / web-sm / mobile | **2 種**: (A) HOME 系（トップ階層・戻るなし `*-header-home`） / (B) 下層（戻る付き `*-header-sub`）。web-sm は 390px 幅前提の専用フラグメント `web-sm-header-home`（タイトル + 任意の静的ハンバーガーボタン）/ `web-sm-header-sub` を正典化する（1440px 用 `web-header-*` の流用禁止） |

> web のサイドバー / タブ等価物は本ルールのスコープ外（必要なら別チケット）。web-sm のハンバーガーは default 状態では開かない静的ボタンとし、ドロワー展開状態は sub-state（Step 25b）の領域とする。

### 11.2 正典ストア（Step 17 Phase A が一度だけ生成）

- `screens/_shared/components.html` — 部品マークアップの正典。`mobile-bottom-nav` / `*-header-home` / `*-header-sub` のフラグメントを、実 SVG（Step 0 で取得済みの `artifacts/{app_name}/icons/{name}.svg` を Read して `<path>` をインライン埋め込み。`icons-manifest.json` はどの icon を使うかのメタデータ参照に留め、SVG 本体は含まない）込みで保持。可変部は **スロットマーカー** で表現する。**ファイル先頭に `<meta charset="UTF-8">` を 1 行置くこと**（本ファイルは Step 17 が読んで各画面へ逐語ペーストするための staging artifact であり単体表示用ページではないが、charset 宣言が無いと人間がブラウザで開いた際に日本語が文字化けするため。`<!DOCTYPE>` / `<head>` は不要）。
- `screens/_shared/components.css` — 上記部品の CSS 正典（`.mobile-header` / `.mobile-bottom-nav` / nav `svg` の `stroke-width` / `body` の `padding-bottom` / web header / web-sm header〔platform dirs ∋ web-sm のとき〕等）。**`root-variables.css` と同様に各 HTML の `<style>` へ逐語インライン**する（`<link>` / `@import` 禁止、§10）。日本語コメントを含む場合は **ファイル先頭（最初のバイト）に `@charset "UTF-8";` を置く**こと（charset 宣言が無いと人間がブラウザで `.css` を単体で開いた際に日本語コメントが文字化けするため。CSS では `@charset` がコメントより前の先頭行でなければ無効）。**`<style>` へ逐語インラインする際はこの `@charset` 行は含めない**（`<style>` 内の `@charset` は無効で、HTML の `<meta charset="UTF-8">` が encoding を支配する。インライン対象は各セレクタのルール本体であり、`@charset` / ファイルヘッダコメントは対象外）。

部品の項目集合（タブのラベル・遷移先・アイコン名）と各画面への割り当て（ヘッダー種別 A/B/なし・ボトムメニュー有無・現在タブ）は **Step 14 の chrome プラン**（`00-screen-list.md`）で決まる。Step 17 Phase A はそれを materialize するだけで、新たに項目を発明しない。

### 11.3 可変スロット（固定部分は逐語、可変部分のみ差し込み）

| 部品 | 固定（全画面共通・逐語） | 可変スロット |
|---|---|---|
| `mobile-bottom-nav` | タブ項目集合 / ラベル / アイコン / 順序 / stroke-width / CSS | `aria-current="page"` を付与する 1 タブ（その画面の「現在タブ」割り当て。該当タブが無い画面では全タブ非アクティブ） |
| `*-header-home`(A) | 構造・高さ・配置（戻るボタンなし） | タイトル文字 |
| `*-header-sub`(B) | 戻るボタン構造・配置・CSS | タイトル文字 / 戻り先（informational）/ 任意の末尾アクション（既定: なし） |

スロットマーカー規約（`components.html` 内に明示）:
- タイトル: `<!--SLOT:TITLE-->` を囲む要素のテキストノードを置換
- 現在タブ: 各タブ `<a data-tab="{id}">` のうち、割り当て id に一致するものへ `aria-current="page"` を付与（他は付けない）
- それ以外（戻り先 href / 末尾アクション）も同様にマーカーで明示し、**マーカー以外の構造・属性・空白は一切変えない**

### 11.4 禁止 / 必須

**禁止:**
- 各画面で chrome のマークアップ・CSS を **再発明** すること（項目・アイコン・stroke-width・padding 等を画面ごとに書き起こす）
- ランタイム JS テンプレートエンジン / `fetch` / `<iframe>` 等で chrome を動的注入すること（CSS 自己完結ルールと同じ理由 + Step 22 Figma キャプチャは静的 DOM 前提のため）
- スロット以外の差分を入れること（末尾要素を pill にしたり icon にしたり画面ごとに変える等）

**必須:**
- 割り当てに応じて `components.html` の該当フラグメント + `components.css` を **verbatim ペースト**し、スロットのみ差し込む
- chrome 内の色も `var(--color-*)` 参照のみ（HEX 直書き禁止、§1）

### 11.5 self-check（生成後・必須。root-variables の self-check と同型）

各画面 HTML 出力後に検証する:
- `<nav class="mobile-bottom-nav"> … </nav>` を抽出し、`aria-current="page"` の有無を正規化した上で `components.html` の `mobile-bottom-nav` フラグメントと **byte 一致** することを確認
- ヘッダーも割り当て種別（A/B）ごとに、タイトル / 戻り先 / 末尾アクションのスロットを正規化して正典と byte 一致を確認
- chrome CSS（`.mobile-header` / `.mobile-bottom-nav` 等のルール）が `components.css` と一致することを確認（root-variables の行数 / md5 比較と同方式）
- 不一致はリトライ最大 3 回。解消しなければ `feedback-log.md` に Pattern B を記録して **abort**（subagent は Write せず orchestrator が停止する ownership は §17 の root-variables ルールと同じ）

### 11.6 chrome の修正ポリシー（正典で直す。個別画面で直さない）— 必須

生成後に chrome（ボトムメニュー / ヘッダー）への修正指摘が出た場合（採点ループ Step 19/20、または人間ゲート Step 16/21）、**修正は必ず「正典」に対して行い、再ペーストで全画面へ伝播させる**。個別画面の chrome マークアップ / CSS を直接書き換えてはならない。個別画面で直すと §11.5 の self-check が正典との byte 不一致を検出して **abort** し、同じ指摘で毎回 abort する脱出不能ループに陥る（これが「個別画面 chrome 直し」を禁止する具体的理由）。

修正指摘は次の 2 種に分類し、修正先を分ける:

| 種別 | 例 | 分類 | 修正先（正典） | 誰が直すか |
|---|---|---|---|---|
| **chrome の見た目 / 品質** | アイコンの線が細い・ヘッダータイトルが小さい・padding-bottom が不適切・コントラスト不足 | **AI改善可能** | `_shared/components.css` / `components.html`（数値・stroke-width 等）、または値が token 由来なら `_shared/root-variables.css`（§1） | Step 17 ループ再実行が正典を直し → 全画面へ再ペースト → self-check 通過 |
| **chrome の IA（情報設計）** | タブ項目の入れ替え（「動画」→「マップ」）・どのアイコンを使うか（地図マーク→ピンマーク）・ラベル名・各画面のヘッダー種別 A/B 割り当て | **人間対応必要** | `00-screen-list.md` の「## 共通部品定義（chrome）」節（＝ Step 14 chrome プラン） | 人間ゲート（Step 16 / Step 21）で Step 14 へ差し戻して chrome プランを更新 → Step 17 が Step 0 から再取得（新アイコン）→ Step 0b で正典再生成 → 全画面再ペースト |

**要点**:
- chrome の見た目修正は **正典 1 箇所を直せば全画面に伝播** するため、self-check は新正典で再一致し abort しない。「個別画面を直す → abort」のループは、正典で直す限り発生しない。
- chrome の IA 変更は AI の自動判断対象ではない（IA レベルの決定）。採点ループ（Step 20）は IA 指摘を `ai_improvable_deductions` に積まず、人間ゲート（Step 21）へ送る。
- どちらの種別でも、**全画面の再生成トリガーは正典の更新**である。正典（Step 0b or Step 14 プラン）を更新したら Step 17 は全画面を新正典で再ペーストする（個別画面だけ直す経路を作らない）。

### 11.7 イラスト正典（`_shared/illustrations/`）— 第 3 の正典系統

> **注記**: `pictogram` ポリシーでは空状態・オンボーディング・エラーの中央ビジュアルを単一アイコンの拡大表示で表現し（§2「pictogram のイラスト表現」）、独自シーンイラストを手描きしない。このため本イラスト正典系統（`_shared/illustrations/`）は `pictogram` では**生成されず休止状態**となる（後方互換のため定義は残す）。データ駆動グラフィックは引き続き下記「対象外」として扱う。

繰り返し登場するイラスト（太陽・empty 状態の挿絵・装飾モチーフ等）は、画面ごとに AI が描き直すと**形も色もドリフトする**（症状「同じ絵柄なのに画面間で色が違う」）。chrome（§11.1〜11.6）と同じ「正典 1 回生成 → 逐語ペースト → 機械照合」をイラストに適用する:

- **正典ストア**: `screens/_shared/illustrations/{name}.svg`。生成は Step 17 Step 0c（アイコン一括取得と同一コンテキストで列挙 → 1 回だけ描く。**命名がこの 1 回に集約される**ため「同じ絵に画面ごとの別名」が構造的に発生しない）。
- **正典内部の色**: `var(--…)`（通常 token / 装飾パレット `--color-illustration-*`）か `currentColor` のみ。生 hex 禁止（§1 zero-literal は正典ファイル自体にも掛かる）。
- **各画面へは逐語ペースト**: inner content を一切変えない。可変は外側 `<svg>` タグのサイズ系属性（width / height / class）のみ。→ **正典内部が `var(--…)` のみなら、同じ絵 ＝ 同じファイル ＝ 色も同一**（by-construction）。**`currentColor` を使う正典は親要素の `color:` で描画色が変わる**ため verbatim 一致でも画面間で色が割れうる — この親色ドリフトは lint の色変動マップ（`icon_color_variance` の illustration entry）が検出し、Step 21 で人間が判断する。
- **照合**: `scripts/lint-screen-colors.mjs` が path 署名で正典と照合し、inner の byte 不一致を `illustration_canon_mismatch` として検出（§11.5 と同型）。識別属性（`data-motif` 等）は**使わない**（chrome byte-check と干渉するため。同一性はラベルでなく実物の path データで決める）。**正典ファイル自体の色検査は `--report` の `illustration_source_violations` で行う** — `--check` を正典 SVG に直接当てない（画面 HTML 専用のため `:root` 完全性検査が誤発火する）。
- **gradient（`<stop>`）の色**: `stop-color="#hex"` のリテラルは画面ペースト時に L1 hard 検出される。gradient を使う正典 / アイコンは `<stop style="stop-color: var(--…)">` 形式で書く（`--normalize-icons` は gradient 破壊防止のため stop-color を自動変換しない — 手で var 化する）。
- **修正ポリシー**: §11.6 準用 — 正典を直して全画面へ再ペースト。個別画面のイラストを直接編集しない。
- **対象外**: データで形が変わるグラフィック（盤面・チャート・波形等）。色の token 参照（§1）のみ適用し、lint では「未照合 SVG」として report に載る（人間ゲートで「データ駆動」と確認する）。

---

## 12. 禁止事項まとめ（anti-slop 連携）

AP6 検証由来の anti-slop ルール。HTML 生成時に違反があれば **生成時点でエラー** とする:

| 項目 | 禁止 | 理由 |
|---|---|---|
| フォント | Inter を `--font-base` に使う | ジェネリック AI aesthetic 回避 |
| 背景色 | `#000000` 純黒 | OLED ギラつき・視覚疲労 |
| レイアウト | `grid-template-columns: 1fr 1fr 1fr` 等分3列 | 画一的で記憶に残らない |
| アイコン | フォントアイコン（Material Icons 等） | Figmaキャプチャ時に消失（§2） |
| フォーム | value 属性にサンプル文字 | 初期値混入リスク（§3） |
| 色指定 | 色リテラル全般の直書き — hex / rgb() / hsl() / CSS 色名。**定義済み token と同じ値でも禁止**（zero-literal） | テーマ切替破壊・画面間ドリフト（§1。lint = `scripts/lint-screen-colors.mjs` が機械検出） |
| SVG 色 | `fill=` / `stroke=` / `stop-color=` 属性への色リテラル直書き、および同属性への `var()` 直書き（ブラウザで無効） | アイコン / イラストの色ドリフトの主経路（§1 / §2。`style="fill: var(--…)"` か `currentColor` を使う） |
| 絵文字 | UI 要素内の絵文字（🔥 📱 等）— **`emoji_casual` ポリシーでは禁止解除** (SSB-04) | ブランド毀損、Figma 非互換（`pictogram` / `illustration_character` のみ禁止） |
| :root 間引き | `_shared/root-variables.css` の変数を「画面で使う分だけ」に間引いた inline copy | main↔sub-state（25b inherit_main）一貫性の前提崩壊（skill 17「CSS 自己完結ルール」。lint が `root_vars_incomplete` として機械検出 — 画面固有の**追加**変数は許容） |

---

## 13. Phase 2 申し送り

| 予約フィールド | 目的 | Phase 1 での扱い |
|---|---|---|
| プラットフォーム別 body サイズのプロジェクト単位上書き | iPhone サイズを mini や Pro Max に切替 | 390×844 固定 |
| 代替書体マッピングの拡張 | カスタムフォント導入 | Google Fonts 限定 |
