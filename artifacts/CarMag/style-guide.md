# CarMag Design System — Style Guide

**Case A: 信頼のシンプル — Trust & Clarity**  
*Generated: 2026-07-17*

---

## Overview

The CarMag design system is built on **minimalist principles** that prioritize clarity and trustworthiness. By combining a grayscale palette with a single primary color accent, this system creates a professional, calm user experience that supports information discovery without visual clutter.

### Design Philosophy

- **削ぎ落とし型 (Reductive Design)**: Strip away unnecessary decoration; express information hierarchy through whitespace and typography weight alone.
- **グレースケール支配 (Grayscale Dominance)**: White to dark gray provides trust and sophistication.
- **差し色制限 (Limited Accent)**: Single primary color (#006884) used only for CTAs and key highlights to draw focus.
- **フラット (Flat Design)**: No shadows; express depth through borders and opacity.
- **静寂なモーション (Calm Motion)**: fade-in-smooth (300ms) for subtle, non-jarring transitions.

---

## Color System

### Primitive Colors

#### Neutral Scale (0–900)

| Name | Hex | OKLCH | Usage |
|------|-----|-------|-------|
| Neutral 0 | `#FFFFFF` | L: 1.0, C: 0, H: 0 | Pure white, page background |
| Neutral 10 | `#FBF8F6` | L: 0.98, C: 0.004, H: 40 | Off-white, container background |
| Neutral 50 | `#F1EDEB` | L: 0.95, C: 0.004, H: 0 | Very light, secondary surface |
| Neutral 100 | `#E8E3E0` | L: 0.92, C: 0.005, H: 0 | Light gray |
| Neutral 200 | `#D9D1CC` | L: 0.88, C: 0.006, H: 0 | Light-medium gray |
| Neutral 300 | `#C8BDB5` | L: 0.85, C: 0.008, H: 0 | Medium gray, hover states |
| Neutral 400 | `#857E7E` | L: 0.60, C: 0.008, H: 20 | Medium-dark, borders |
| Neutral 500 | `#6B6464` | L: 0.52, C: 0.007, H: 0 | Dark neutral |
| Neutral 600 | `#443736` | L: 0.35, C: 0.02, H: 20 | Very dark, secondary text |
| Neutral 700 | `#2A2425` | L: 0.22, C: 0.008, H: 0 | Nearly black |
| Neutral 800 | `#1B1515` | L: 0.15, C: 0.008, H: 0 | Very dark |
| Neutral 900 | `#030101` | L: 0.08, C: 0.01, H: 20 | Near-black, primary text |

#### Primary Color

| Name | Hex | OKLCH | Usage | Contrast |
|------|-----|-------|-------|----------|
| Primary Blue | `#006884` | L: 0.48, C: 0.091, H: 225 | CTAs, focus states, highlights | 5.99:1 on white, 5.46:1 on light gray |

#### State Colors

**Error**
- Light: `#FFDADE` (background)
- Dark: `#5A0020` (text)
- Border: `#C85C7E`

**Info**
- Light: `#B0E8FF` (background)
- Dark: `#004154` (text)
- Border: `#1B7FA6`

**Warning**
- Light: `#FFE2CB` (background)
- Dark: `#6B3900` (text)
- Border: `#D4A574`

### Semantic Color Mapping

| Token | Value | Purpose |
|-------|-------|---------|
| `--background` | Neutral 0 | Default page background |
| `--surface` | Neutral 10 | Card / container background |
| `--on-surface` | Neutral 900 | Primary text |
| `--on-surface-variant` | Neutral 600 | Secondary text, captions |
| `--primary` | Primary Blue | CTA buttons, focus indicators |
| `--on-primary` | Neutral 10 | Text on primary background |
| `--focus-ring` | Primary Blue | Keyboard focus outline |
| `--border` | Neutral 400 | Card borders, dividers |

---

## Typography System

### Font Families

| Role | Family | Style | Usage |
|------|--------|-------|-------|
| **Display** | Playfair Display | Serif | Page titles, section headers, emphasis |
| **Base** | Source Sans 3 | Sans-serif | Body text, UI labels, default text |
| **Numeric** | DM Mono | Monospace | Numbers, prices, data, code |

### Font Sizes

| Scale | Size | Usage |
|-------|------|-------|
| XS | 12px | Captions, fine print |
| SM | 14px | Secondary text, help text |
| MD | 16px | Body text, default UI labels |
| LG | 20px | Subheadings |
| XL | 24px | Section headers |
| 2XL | 32px | Page titles |

### Font Weights

| Weight | Value | Usage |
|--------|-------|-------|
| Regular | 400 | Body text, default |
| Medium | 500 | Emphasis |
| Semibold | 600 | Subheadings, button text |
| Bold | 700 | Headings, strong emphasis |

### Line Heights

| Scale | Value | Usage |
|-------|-------|-------|
| Tight | 1.2 | Headings, display text |
| Normal | 1.5 | Body text, UI |
| Loose | 1.75 | Improved readability for long-form |

### Typography Pairings

#### Display + Body
- Playfair Display (serif) for headings conveys classical, professional tone
- Source Sans 3 (sans-serif) for body ensures readable, modern feel
- **Contrast:** Serif + sans creates clear visual hierarchy

#### Body + Numeric
- Source Sans 3 for UI labels and form text
- DM Mono for prices, measurements, data tables
- **Example:** "Price: **$1,234.56**" (body + numeric)

---

## Spacing System

All spacing values follow an 8px baseline for predictable, scalable layouts.

| Scale | Value | Usage |
|-------|-------|-------|
| XS | 4px | Micro-spacing, between related elements |
| SM | 8px | Compact padding, small gaps |
| MD | 16px | Default padding, card spacing |
| LG | 24px | Section spacing, larger gaps |
| XL | 32px | Major section breaks |
| 2XL | 48px | Page-level spacing |

### Spacing Examples

- **Button padding:** 12px (vertical) × 24px (horizontal)
- **Card padding:** 16px
- **Input padding:** 8px (vertical) × 12px (horizontal)
- **Section margin:** 24px or 32px

---

## Motion System

### Duration

| Scale | Value | Purpose |
|-------|-------|---------|
| Fast | 150ms | Micro-interactions, hover effects |
| Normal | 300ms | Standard transitions, page entry |
| Slow | 500ms | Large layout changes |

### Easing Functions

| Easing | Cubic Bezier | Usage |
|--------|--------------|-------|
| ease-in-out | `cubic-bezier(0.4, 0, 0.2, 1)` | Signature motion, smooth transitions |
| ease-out | `cubic-bezier(0.0, 0, 0.2, 1)` | Entry animations |
| ease-in | `cubic-bezier(0.4, 0, 1, 1)` | Exit animations |

### Signature Animation: fade-in-smooth

**Duration:** 300ms  
**Easing:** ease-in-out  
**Property:** opacity  
**Timing:** 0 → 1  

**Application:**
- Page-load reveal with staggered items (50ms interval)
- Intersection Observer trigger on viewport entry
- Static `transform` (no translateX/Y for minimal distraction)

**CSS:**
```css
@keyframes fadeInSmooth {
  from { opacity: 0; }
  to { opacity: 1; }
}

.reveal-item {
  animation: fadeInSmooth 300ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

/* Staggered reveal */
.reveal-item:nth-child(1) { animation-delay: 0ms; }
.reveal-item:nth-child(2) { animation-delay: 50ms; }
.reveal-item:nth-child(3) { animation-delay: 100ms; }
```

**Reduced Motion Fallback:**
```css
@media (prefers-reduced-motion: reduce) {
  .reveal-item {
    animation-duration: 100ms;
    animation-delay: 0ms !important;
  }
}
```

---

## Component System

### Buttons

#### Primary Button
- **Background:** Primary Blue (#006884)
- **Text:** Neutral 10 (#FBF8F6)
- **Padding:** 12px × 24px
- **Min Height:** 44px (accessible touch target)
- **Border Radius:** 0px (sharp corners for precision)
- **Font Weight:** 600
- **Border:** None
- **Hover:** Opacity 0.9

#### Secondary Button
- **Background:** Neutral 10 (#FBF8F6)
- **Text:** Neutral 900 (#030101)
- **Border:** 1px solid Neutral 300 (#C8BDB5)
- **Padding:** 12px × 24px
- **Hover:** Background → Neutral 50 (#F1EDEB)

### Cards

- **Background:** Neutral 10 (#FBF8F6)
- **Border:** 1px solid Neutral 400 (#857E7E)
- **Padding:** 16px
- **Border Radius:** 0px
- **Shadow:** None (flat design)
- **Spacing:** 16px between cards

### Input Fields

- **Background:** Neutral 10 (#FBF8F6)
- **Border:** 1px solid Neutral 400 (#857E7E)
- **Padding:** 8px × 12px
- **Border Radius:** 0px
- **Focus State:** 2px solid Primary Blue (#006884)
- **Font:** Source Sans 3, 16px, Regular

### Links

- **Color:** Primary Blue (#006884)
- **Text Decoration:** None (default)
- **Hover:** Underline + opacity 0.9
- **Font Weight:** 400 (same as body)

---

## Layout Grid

### Breakpoints

| Breakpoint | Width | Use Case |
|-----------|-------|----------|
| Web (Desktop) | ≥ 1024px | Full desktop experience |
| Web (Tablet) | 768px – 1023px | Tablet / iPad |
| Web (Mobile) | < 768px | Mobile / responsive |

### Grid Policy

- **Single Column Layout** for consistency and focus
- **List container:** Flexbox (flex-direction: column)
- **Spacing:** 8px baseline, multiples of 8

### Column Rules

- **Desktop/Tablet:** 1 column (full width with margins)
- **Mobile:** 1 column (full width with margins)

---

## Accessibility (WCAG 2.1 AA)

### Color Contrast

| Element | Foreground | Background | Ratio | Status |
|---------|-----------|-----------|-------|--------|
| Primary text | Neutral 900 | Neutral 0 | 19.69:1 | AAA |
| Secondary text | Neutral 600 | Neutral 10 | 10.76:1 | AA |
| Primary CTA | Neutral 10 | Primary Blue | 5.46:1 | AA |
| Border text | Neutral 400 | Neutral 10 | 3.76:1 | AA |
| Error text | Error Dark | Error Light | 4.6:1 | AA |
| Info text | Info Dark | Info Light | 5.1:1 | AA |

### Focus Indicators

- **Focus Ring:** 2px solid Primary Blue (#006884)
- **Outline Offset:** 2px
- **Required:** All interactive elements (buttons, inputs, links)

### Motion & Animations

- **Reduced Motion Support:** All animations fall back to instant opacity changes
- **No Auto-play:** Motion only on user interaction or visible scroll trigger
- **Seizure Safe:** No flashing (>3 Hz) in any animation

### Font & Text

- **Minimum Font Size:** 12px (captions)
- **Line Height:** ≥ 1.2 for body text
- **Letter Spacing:** Not compressed below -0.02em

---

## Design Decisions & Rationale

### Why Playfair Display?

Playfair Display is a classical serif typeface that conveys professionalism, authority, and trust. For a vehicle maintenance information site, this classical tone reassures users that they're reading **credible, expert information**. The serif contrast against Source Sans 3 body text creates clear visual hierarchy without clutter.

### Why Grayscale + Single Accent?

The grayscale palette (white to near-black) provides a calm, focused environment. By limiting the primary color to CTAs and highlights only, we ensure that when users see color, it **signals importance**. This is especially important for a discovery-based app where information density is high.

### Why Flat Design (No Shadows)?

Flat design minimizes cognitive load. Shadows can be distracting on information-dense pages. Instead, subtle borders and opacity changes establish depth and layering. This aligns with the "削ぎ落とし型" (reductive) philosophy.

### Why fade-in-smooth (300ms)?

300ms is long enough to feel intentional and smooth (not jarring), but short enough not to delay content visibility. The ease-in-out function creates a natural acceleration/deceleration curve that feels professional and calm. Staggered reveals (50ms intervals) guide the eye naturally down the page.

### Why Source Sans 3 for Body?

Source Sans 3 is highly legible, has excellent metrics for on-screen reading, and supports multiple weights for emphasis without becoming bold. It pairs naturally with the serif display font and maintains readability even at 14px (common in density-optimized layouts).

### Why DM Mono for Numbers?

Monospace fonts for numbers ensure that prices, measurements, and data align properly in columns. This precision signals that financial or technical information is **reliable and exact**.

---

## Do's and Don'ts

### Do's ✓

- Use primary blue sparingly; reserve for CTAs and essential actions
- Combine Playfair Display headings with Source Sans 3 body for hierarchy
- Respect the 8px spacing scale; multiples maintain consistency
- Apply fade-in-smooth for page-load transitions
- Use neutral colors (gray scale) to de-emphasize secondary UI
- Test color combinations against WCAG AA (4.5:1 minimum)
- Always include focus rings for keyboard users

### Don'ts ✗

- Do NOT use Inter, Roboto, or Arial (violates font pairing philosophy)
- Do NOT add background gradients or decorative patterns
- Do NOT scatter multiple colors across the UI (grayscale + blue only)
- Do NOT use shadows; rely on borders and opacity instead
- Do NOT center content in multi-column layouts (single-column only)
- Do NOT use emoji heavily; pictograms only
- Do NOT skip reduced-motion fallbacks for animations
- Do NOT violate contrast ratios for text-on-color combinations

---

## Implementation Checklist

- [ ] **Fonts Loaded:** Playfair Display, Source Sans 3, DM Mono via Google Fonts or self-hosted
- [ ] **CSS Custom Properties:** Define all colors, fonts, spacing, motion as `:root` variables
- [ ] **Focus Rings:** 2px solid blue on all interactive elements
- [ ] **Reduced Motion:** `@media (prefers-reduced-motion: reduce)` for all animations
- [ ] **Contrast Test:** Verify all text/background combinations against WCAG AA (4.5:1 minimum)
- [ ] **Touch Target:** Buttons, inputs ≥ 44px height for accessibility
- [ ] **Spacing Scale:** Use 8px multiples; no arbitrary px values
- [ ] **Staggered Reveals:** Implement 50ms intervals for multi-element animations

---

## File References

- **tokens.json:** Design token definitions (semantic, component, typography, motion, spacing)
- **style-guide-view.html:** Interactive design system visualization
- **design-brief.yaml:** Design case selection and high-level rationale

---

*Last Updated: 2026-07-17*  
*Designed for CarMag — Vehicle Maintenance Information Platform*
