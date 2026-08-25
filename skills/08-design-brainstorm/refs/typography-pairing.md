# フォントペアリング参考集

08 の 3案生成時に、案ごとに異なる書体を選ぶための参考書体集。
**各案で display / base / numeric を別々に選び、3案間で display は完全に異なるものを使う**（anti-slop ルール）。

**参照元**: `skills/08-design-brainstorm/SKILL.md` Phase 4（Typography設計）
**前提**: Google Fonts から読み込めること（ライセンス・可用性確認済み）。生成 HTML の font loader は `fonts.googleapis.com` のみ対応のため、Fontshare 等 Google Fonts 外の配信サービス専用書体（例: Clash Display / Cabinet Grotesk / Satoshi）は掲載不可 — 選定しても読み込めず fallback 書体に silent 劣化する

---

## 和文系（日本的格式・エグゼクティブ層）

### Shippori Mincho
- Source: Google Fonts
- 特徴: 伝統的な明朝、格式高い。見出し向き
- 推奨用途: display（H1-H3）
- NG 用途: 長文本文（VISUAL_DENSITY >= 7 のダッシュボードでは可読性低下）
- Weights: 400 / 500 / 600 / 700 / 800

### Noto Serif JP
- Source: Google Fonts
- 特徴: バランス型明朝、可読性高い
- 推奨用途: display + base（Serif 方向性時）
- Weights: 400 / 500 / 600 / 700 / 900

### Klee One
- Source: Google Fonts
- 特徴: 手書き風、親しみやすい和モダン
- 推奨用途: display（柔らかい案向き）
- Weights: 400 / 600

### Shippori Antique
- Source: Google Fonts
- 特徴: アンティーク調ゴシック
- 推奨用途: display（和モダン × モダンの中間）
- Weights: 400

---

## 実用系 Sans（base 向き・ダッシュボード / 高密度 UI）

### Outfit
- Source: Google Fonts
- 特徴: AP6（taste-skill）推奨、収束回避対象（Inter）の代替として標準
- 推奨用途: display + base（SaaS / ダッシュボード）
- Weights: 100-900

### Plus Jakarta Sans
- Source: Google Fonts
- 特徴: プレミアムな幾何学Sans、高級感
- 推奨用途: display + base（Awwwards 級 / プレミアム）
- Weights: 200-800

### Manrope
- Source: Google Fonts
- 特徴: モダンかつ柔らかい
- 推奨用途: base（Outfit の代替）
- Weights: 200-800

### IBM Plex Sans
- Source: Google Fonts
- 特徴: 中立・実用性重視、エンジニアリング文脈と相性が良い
- 推奨用途: base（計器機能美型・密度過飽和型案）
- Weights: 100-700

### Source Sans 3
- Source: Google Fonts
- 特徴: Adobe 由来の可読性重視 Sans、ニュートラル
- 推奨用途: base（長文・ダッシュボードどちらも可）
- Weights: 200-900

---

## 個性系 Display（display 専用・記憶に残す役割）

### Syne
- Source: Google Fonts
- 特徴: 幾何学 + 独特のカーブ、テクノロジー感
- 推奨用途: display（計器機能美型・希望技術合流型）
- Weights: 400-800

### Bricolage Grotesque
- Source: Google Fonts
- 特徴: 有機的な歪みを内包した可変フォント
- 推奨用途: display（筆致有機型・未加工生地型）
- Weights: 200-800

### Instrument Serif
- Source: Google Fonts
- 特徴: 細身のエレガント Serif、現代的エディトリアル
- 推奨用途: display（判型エディトリアル型・金箔静謐型）
- Weights: 400（Regular / Italic）

---

## 世界観系 Serif（display 専用・世界観を語らせる役割）

### Cormorant Garamond
- Source: Google Fonts
- 特徴: 繊細な Display Serif、高級感
- 推奨用途: display のみ（base 使用禁止 — anti-slop）
- Weights: 300-700

### Playfair Display
- Source: Google Fonts
- 特徴: ハイコントラスト Serif、判型エディトリアル型と相性
- 推奨用途: display のみ
- Weights: 400-900

### Fraunces
- Source: Google Fonts
- 特徴: Variable font で表情豊か
- 推奨用途: display + アクセント文字
- Weights: 100-900

### Crimson Pro
- Source: Google Fonts
- 特徴: 長文読み向き Serif、文芸的世界観
- 推奨用途: display（文化文脈型）+ 長文 base
- Weights: 200-900

---

## 数値・等幅系 Mono（numeric ロール）

### DM Mono
- Source: Google Fonts
- 特徴: 読みやすく、数値向き
- 推奨用途: numeric（統計値・データ表）
- Weights: 300 / 400 / 500

### JetBrains Mono
- Source: Google Fonts
- 特徴: エンジニアリング感、コード向き
- 推奨用途: numeric（テクノ系案で）
- Weights: 100-800

### Source Code Pro
- Source: Google Fonts
- 特徴: Adobe 由来、汎用
- 推奨用途: numeric（保守的選択）
- Weights: 200-900

### Courier Prime
- Source: Google Fonts
- 特徴: クラシックタイプライター調
- 推奨用途: numeric（和モダン × 活字感）
- Weights: 400 / 700

---

## 案コンセプト別推奨ペアリング例

### 影の間（墨黒 × 金、和モダン・エグゼクティブ）
- display: **Shippori Mincho** 700
- base: **Noto Sans JP** 400 / 500
- numeric: **DM Mono** 400

### 深藍回路（藍 × テクノ、精密機械感）
- display: **Syne** 700
- base: **Plus Jakarta Sans** 400 / 600
- numeric: **JetBrains Mono** 500

### 白刃（和紙 × 緋色、エディトリアル）
- display: **Noto Serif JP** 700
- base: **Noto Sans JP** 400 / 500
- numeric: **Courier Prime** 700

### モノクロ・ミニマル
- display: **Outfit** 700
- base: **Outfit** 400 / 500
- numeric: **DM Mono** 500

### Awwwards級プレミアム
- display: **Fraunces** 700
- base: **Plus Jakarta Sans** 400 / 600
- numeric: **DM Mono** 500

---

## ペアリング検証チェックリスト

### 3案間での差別化
- [ ] `family_display` が3案すべて異なる
- [ ] `family_base` は同じでも可（Noto Sans JP 等）だが、display で明確に差別化
- [ ] `family_numeric` は3案で異なる方が望ましい

### 可読性
- [ ] VISUAL_DENSITY >= 7 のダッシュボード UI では base に Serif を使わない
- [ ] モバイル最小 12px で display も判読可能
- [ ] 日本語字形が必要なプロジェクトで、Latin-only フォントを base に使わない

### パフォーマンス
- [ ] Google Fonts の preconnect を HTML に含める（docs/html-generation-rules.md §5）
- [ ] `&display=swap` で描画優先
- [ ] weight 指定は使うもののみ（例: `Outfit:wght@400;600;700`）

### 代替書体のフォールバック
```css
--font-display: 'Shippori Mincho', 'Noto Serif JP', serif;
--font-base: 'Outfit', 'Noto Sans JP', sans-serif;
--font-numeric: 'DM Mono', 'Source Code Pro', monospace;
```

---

## ライセンス

- 上記すべて **Google Fonts** から取得可能。Open Font License（OFL）でプロジェクトで自由に利用可能。
- プロジェクトが別ライセンスの書体を指定した場合は、この refs を無視して指定書体を使う（design-brief.yaml cases[X].typography[].source に記載）。
