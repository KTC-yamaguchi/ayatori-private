# anti-slop ルール一覧

AP6（taste-skill / design-taste-frontend）検証で確立された、AI が「ジェネリック AI aesthetic」を生成する傾向を抑制するためのルール集。
08 の 3案生成時に **全 3案で必ず遵守** し、違反があれば Phase 6 の anti-slop チェックで指摘する。

**参照元**: `skills/08-design-brainstorm/SKILL.md` Phase 6
**連携**: `skills/09-sample-html-gen/SKILL.md` の生成時違反検知（HTML 生成後の正規表現 / パーサチェック）

---

## 禁止ルール（Don'ts）

### 1. NO Inter Font
- **禁止**: `--font-base` に Inter を使用
- **理由**: ジェネリック AI / SaaS ダッシュボードの定番で、記憶に残らない
- **代替**: Outfit / Plus Jakarta Sans / Noto Sans JP / プロジェクト専用書体

### 2. NO Pure Black
- **禁止**: `#000000` の使用（bg / text いずれも）
- **理由**: OLED ディスプレイでギラつき・視覚疲労
- **代替**: `#0C0C0D`（Zinc-950相当）、`#1A1A1A`、OKLCH L=0.10〜0.15 の範囲

### 3. NO 3-col Equal Cards
- **禁止**: `grid-template-columns: 1fr 1fr 1fr`（等分3列グリッド）
- **理由**: 画一的で記憶に残らない、情報密度の差別化が失われる
- **代替**: `1fr 1fr 2fr` や `2fr 1fr` など非対称、または masonry

### 4. NO AI Purple / Neon Gradient
- **禁止**: 紫〜ピンクのグラデーション（`linear-gradient(135deg, #8B5CF6, #EC4899)` 系）
- **理由**: 典型的な AI / LLM プロダクトの見た目、ブランド差別化不可
- **代替**: プロジェクトコンセプトに合わせた単色 + 微妙なトーン変化

### 5. NO Generic Serif on Dashboard
- **禁止**: VISUAL_DENSITY >= 7 のダッシュボード UI で Serif を `--font-base` に使用
- **理由**: 高密度 UI で Serif は可読性が落ちる
- **代替**: display 役割には Serif 許容、base は Sans-serif
- **例外**: プロジェクトコンセプトが「和の格式」など Serif を要求する場合は、display 限定で許可

### 6. NO Centered H1 / Hero (DESIGN_VARIANCE > 4)
- **禁止**: DESIGN_VARIANCE が 5 以上で、ヒーロー見出しを中央揃えにする
- **理由**: AI ぽい「中央揃え hero + CTA 2個」は見飽きた構図
- **代替**: Split Screen（左右分割）/ Left-Aligned / Asymmetric whitespace

### 7. NO Font Icons
- **禁止**: Material Icons / Font Awesome 等のフォントアイコン
- **理由**: Figma キャプチャ時（22）にフォント未ロードでアイコン消失
- **代替**: インライン SVG（`stroke-linecap="round"` 必須）

---

## 必須ルール（Do's）

### A. Tactile Feedback
全 clickable 要素に物理的な反応を:
```css
:where(button, a, .clickable):active {
  transform: translateY(-1px);     /* または scale(0.97) */
  transition: transform 100ms ease-out;
}
```

### B. Staggered Reveals
リスト・カードのスタガー表示:
```css
.list-item {
  animation: fadeInUp 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 80ms);
}
```

HTML 側:
```html
<div class="list-item" style="--i: 0;">...</div>
<div class="list-item" style="--i: 1;">...</div>
<div class="list-item" style="--i: 2;">...</div>
```

### C. Liquid Glass
半透明 + 内側ボーダーの質感:
```css
.glass-card {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
```

### D. Tinted Shadows
影の色をアクセント色相で tint:
```css
.elevated {
  box-shadow: 0 12px 32px rgba(var(--color-primary-rgb), 0.28);
}
```

### E. Skeleton Shimmer
ローディング行に shimmer:
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--color-surface), var(--color-surface-variant), var(--color-surface));
  background-size: 400% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
```

### F. Signature Animation（案固有）
各案に **独自の signature animation** を1つ定義し、primary CTA 周辺に適用:

| 案（例） | signature animation |
|---|---|
| 影の間 | `gold-line-draw`（金箔ライン描画） |
| 深藍回路 | `scanlines`（CRT 走査線オーバーレイ） |
| 白刃 | `brush-stroke`（筆の軌跡） |

---

## 3案生成時のチェック項目

08 Phase 6 で、生成した3案について以下を自己検証:

- [ ] 全案で Inter 不使用
- [ ] 全案で `#000000` 不使用（bg も text も）
- [ ] 全案で 3-col equal レイアウト不使用
- [ ] 全案で AI Purple/Neon gradient 不使用
- [ ] VISUAL_DENSITY >= 7 の案で Serif を `--font-base` に使用していない
- [ ] DESIGN_VARIANCE >= 5 の案でヒーロー中央揃えを採用していない
- [ ] 全案で Tactile Feedback / Staggered Reveals を Component Stylings に記載
- [ ] 全案で signature animation を 1つ以上指定
- [ ] `family_display` が3案ですべて異なる
- [ ] `primary` OKLCH H の3案間差が 30°以上
- [ ] `motion_profile.signature_animation` が3案ですべて異なる

違反があれば該当案を修正してから design-brief.yaml に書き出す。
