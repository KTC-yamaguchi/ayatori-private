# Color chip mapping (hex → swatch emoji)

Shared rule for prefixing a color value with a Unicode color-square emoji ("chip"), so its hue is readable at a glance in Markdown / Confluence contexts that cannot render CSS color swatches. Referenced by the style-guide generation (`skills/12-design-system/refs/generate-style-guide.md`) and the design-brief Confluence save (`skills/15-confluence-save-design/SKILL.md`).

## Rule

Prefix a color's `#RRGGBB` with `{chip} ` — e.g. `🟦 #1D3557`. Derive `{chip}` **deterministically** from the hex (same hex → same chip).

Let `R`, `G`, `B` be the 0–255 channels; `max` / `min` their extremes; `delta = max − min`; and `L = (max + min) / 510 × 100` (lightness, %).

Compute hue `H` in degrees from the same channels (ratio-based, so 0–255 or 0–1 give the same result):

- `delta == 0` → `H = 0`
- `max == R` → `H = 60 × ((G − B) / delta)`
- `max == G` → `H = 60 × ((B − R) / delta) + 120`
- `max == B` → `H = 60 × ((R − G) / delta) + 240`
- if `H < 0` → `H = H + 360`

Then pick the first matching rule, top to bottom:

| Condition | chip |
|---|---|
| `L ≥ 90` | ⬜ |
| `L ≤ 12` | ⬛ |
| `delta ≤ 24` (near-neutral) | ⬜ if `L ≥ 50`, else ⬛ |
| `15 ≤ H < 50` and `L ≤ 42` | 🟫 |
| `H < 15` or `H ≥ 345` | 🟥 |
| `15 ≤ H < 45` | 🟧 |
| `45 ≤ H < 70` | 🟨 |
| `70 ≤ H < 165` | 🟩 |
| `165 ≤ H < 260` | 🟦 |
| `260 ≤ H < 345` | 🟪 |

> Use `delta` (absolute chroma on 0–255), not HSL saturation — HSL `S` spikes for tiny color differences near white/black and would mis-hue near-neutral tints.

## Application notes

- Add a chip only to cells that hold a real `#RRGGBB`. Cells with no color (`—`, `N/A`, or alias-only rows) get no chip.
- The chip is **derived from the hex**. Any edit that changes a hex outside generation — e.g. a Step 13 human-gate feedback bulk-replace (`skills/00-feedback-protocol`) that rewrites hex values in `style-guide.md` — must re-derive the adjacent chip with this mapping; otherwise a hue-changing edit leaves a stale, wrong chip.
- The chip is a documentation aid, like the existing `✅` / `⚠` contrast badges; it is independent of the app UI `emoji_allowed` design constraint (which governs the sample UI and screens, not these documents).
- Near-white pastel tints resolve to ⬜; that is expected — the hex text and description remain for precision.
