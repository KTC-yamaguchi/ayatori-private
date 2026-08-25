# DTCG Type Reference

**Spec version**: W3C DTCG 2025.10  
**Source**: https://www.designtokens.org/TR/2025.10/format

Common type reference for all skills in the AYATORI pipeline.
When the DTCG spec is updated, update this file and bump the version and date above.

---

## Token Structure

Every token supports the following properties:

| Property | Required | Description |
|---|---|---|
| `$value` | ✅ | The token's value (format depends on type) |
| `$type` | ✅ | Token type identifier (can be inherited from parent group) |
| `$description` | — | Human-readable description of purpose/usage |
| `$deprecated` | — | Boolean or string explaining deprecation reason |
| `$extensions` | — | Vendor-specific data (use reverse domain notation) |

Alias references use dot-notation in curly braces: `"{group.token-name}"`

---

## Simple Types (7)

### color

Structured object with explicit color space, or hex string.

```json
// Object format (recommended)
"$value": {
  "colorSpace": "srgb",
  "components": [0.22, 0.74, 0.97],
  "alpha": 1
}

// Hex string (shorthand)
"$value": "#38BDF8"
```

- `colorSpace`: Accepted values → `srgb` / `srgb-linear` / `hsl` / `hwb` / `lab` / `lch` / `oklab` / `oklch` / `display-p3` / `a98-rgb` / `prophoto-rgb` / `rec2020` / `xyz-d65` / `xyz-d50`
- `components`: Array of 3 channel values (range depends on colorSpace)
- `alpha`: Number 0–1. Defaults to 1 if omitted
- `hex`: Optional fallback hex string for legacy tools

---

### dimension

A number and unit as an object. CSS strings like `"16px"` are non-compliant.

```json
"$value": { "value": 16, "unit": "px" }
```

- `unit`: Only `px` (viewport pixels) or `rem` (relative to system default font size)
- Used for font-size, spacing, border-radius, touch-target, and any other value that requires a unit

---

### fontFamily

Array of font names in order of preference. A single string is also valid.

```json
// Array format (recommended)
"$value": ["Inter", "Noto Sans JP", "sans-serif"]

// Single font
"$value": "Inter"
```

- Unlike CSS `font-family`, individual font names do not need to be quoted
- Generic families (`sans-serif` / `serif` / `monospace` etc.) go at the end

---

### fontWeight

Number (1–1000) or a named alias string.

```json
// Number (recommended)
"$value": 400

// Named alias
"$value": "bold"
```

**Named alias reference**:

| Alias | Value |
|---|---|
| `thin` | 100 |
| `extra-light` | 200 |
| `light` | 300 |
| `normal` / `regular` / `book` | 400 |
| `medium` | 500 |
| `semi-bold` / `demi-bold` | 600 |
| `bold` | 700 |
| `extra-bold` / `ultra-bold` | 800 |
| `black` / `heavy` | 900 |
| `extra-black` / `ultra-black` | 950 |

String numbers like `"400"` are non-compliant — use the number `400`.

---

### duration

Animation time value.

```json
"$value": { "value": 200, "unit": "ms" }
```

- `unit`: Only `ms` (milliseconds) or `s` (seconds)

---

### cubicBezier

Easing function. Array of four numbers: P1x, P1y, P2x, P2y.

```json
"$value": [0.25, 0.1, 0.25, 1]
```

- X values (P1x, P2x) must be in range 0–1
- Y values (P1y, P2y) can be any number (allows bounce effects)

---

### number

Unitless number. Used for line-height ratios, z-index, etc.

```json
"$value": 1.5
```

---

## Composite Types (6)

### shadow

Drop shadow. Single object or array for layered shadows.

```json
// Single shadow
"$value": {
  "color": { "colorSpace": "srgb", "components": [0, 0, 0], "alpha": 0.4 },
  "offsetX": { "value": 0, "unit": "px" },
  "offsetY": { "value": 1, "unit": "px" },
  "blur":    { "value": 3, "unit": "px" },
  "spread":  { "value": 0, "unit": "px" },
  "inset":   false
}

// Layered shadow (multiple shadows)
"$value": [
  { "color": {...}, "offsetX": {...}, ... },
  { "color": {...}, "offsetX": {...}, ... }
]
```

- `color`: Same format as the color type (object or hex string)
- `offsetX` / `offsetY` / `blur` / `spread`: Same format as the dimension type (`{value, unit}`)
- `inset`: Boolean. Defaults to `false` (drop shadow). Set to `true` for inner shadow
- CSS string format (`"0 1px 3px rgba(0,0,0,0.4)"`) is non-compliant
- String offsets (`"0px"`) are non-compliant — use `{"value": 0, "unit": "px"}`

---

### border

Complete border definition.

```json
"$value": {
  "color": { "colorSpace": "srgb", "components": [0.8, 0.8, 0.8], "alpha": 1 },
  "width": { "value": 1, "unit": "px" },
  "style": "solid"
}
```

- `color`: Same format as the color type
- `width`: Same format as the dimension type
- `style`: Same format as the strokeStyle type (string or object)

---

### transition

Animation transition definition.

```json
"$value": {
  "duration":       { "value": 200, "unit": "ms" },
  "delay":          { "value": 0, "unit": "ms" },
  "timingFunction": [0.25, 0.1, 0.25, 1]
}
```

- `duration`: Same format as the duration type
- `delay`: Same format as the duration type
- `timingFunction`: Same format as the cubicBezier type

---

### strokeStyle

Line style. String preset or dash-array object.

```json
// String preset
"$value": "solid"

// Dash array
"$value": {
  "dashArray": [
    { "value": 4, "unit": "px" },
    { "value": 2, "unit": "px" }
  ],
  "lineCap": "round"
}
```

**String presets**: `solid` / `dashed` / `dotted` / `double` / `groove` / `ridge` / `outset` / `inset`  
**lineCap values**: `round` / `butt` / `square`

---

### gradient

Array of gradient stops.

```json
"$value": [
  {
    "color":    { "colorSpace": "srgb", "components": [0, 0.4, 1], "alpha": 1 },
    "position": 0
  },
  {
    "color":    { "colorSpace": "srgb", "components": [0, 0.6, 0.8], "alpha": 1 },
    "position": 1
  }
]
```

- `color`: Same format as the color type
- `position`: Number 0–1 (values outside range are clamped)

---

### typography

Composite typography definition.

```json
"$value": {
  "fontFamily":    ["Inter", "sans-serif"],
  "fontSize":      { "value": 16, "unit": "px" },
  "fontWeight":    400,
  "letterSpacing": { "value": 0, "unit": "px" },
  "lineHeight":    1.5
}
```

- `fontFamily`: Same format as the fontFamily type
- `fontSize`: Same format as the dimension type
- `fontWeight`: Same format as the fontWeight type
- `letterSpacing`: Same format as the dimension type
- `lineHeight`: Same format as the number type

---

## Prohibited

| Prohibited | Reason | Use instead |
|---|---|---|
| `$type: "string"` | This type does not exist in DTCG | Omit `$type`, or move to `$extensions` |
| Dimension as CSS string (`"16px"`) | `{value, unit}` object is the spec format | `{"value": 16, "unit": "px"}` |
| fontWeight as string number (`"400"`) | Number is the spec format | `400` |
| Shadow as CSS string (`"0 1px 3px rgba(...)"`) | Object format is required | Shadow object format |
| Shadow offset as string (`"0px"`) | `{value, unit}` object is the spec format | `{"value": 0, "unit": "px"}` |
