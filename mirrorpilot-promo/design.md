# Design — MirrorPilot Promo

## Visual Theme

Dark premium tech aesthetic. Deep navy canvas with cool-toned accents. Clean, tool-like confidence inspired by Linear and Vercel — minimal chrome, deliberate color hits, typographic hierarchy. Cinematic density at video scale.

## Color Palette

| Role | Value | Usage |
|---|---|---|
| Background | `#0D1B2A` | All scene backgrounds (consistent) |
| Foreground | `#E0E1DD` | Primary text, headlines |
| Secondary text | `#778DA9` | Labels, captions, metadata |
| Primary accent | `#415A77` | Structural elements, dividers, borders |
| Brand highlight | `#2EC4B6` | Success states, sync indicators, key metrics |
| Warning | `#FF9F1C` | Error/timeout states, pain point moments |
| Danger | `#E71D36` | Critical failures, the "problem" in scene 1 |
| Glow tint | `#2EC4B6` at 15% | Background radial glows, ambient light |

## Typography

- **Display/Headlines**: Space Grotesk (weight 700-800) — geometric precision, slightly humanist
- **Body/Narration text**: system-ui, sans-serif (中文: system default)
- **Code/Terminal**: JetBrains Mono (weight 400)
- **Minimum sizes**: Headlines 72px+, body 32px+, labels 24px+

## Motion

- **Energy**: Medium-High (product demo / social ad hybrid)
- **Primary eases**: `power3.out` (entrances), `power2.in` (exits)
- **Ambient**: Slow breathing glows (scale 1.0 → 1.05, 3-4s cycles)
- **Stagger interval**: 80-150ms between elements
- **Scene build time**: 0.8-1.2s total entrance choreography

## Transitions

- **Primary** (60%): Blur crossfade — `filter: blur(12px)`, 0.35s, `power2.inOut`
- **Accent** (scene 2 reveal): Zoom through — `scale: 1→1.2` exit + `scale: 0.8→1` entry, 0.3s
- **Outro**: Color dip to dark — opacity fade to bg color, 0.6s

## Constraints

### Do
- Keep one consistent background color across all scenes
- Tint all neutrals toward blue (hue 210-220)
- Use structural hairline rules to guide the eye
- Anchor content to left/top edge in feature scenes
- Fill frames with 8-10 elements per scene (decoratives included)

### Don't
- No gradient text (background-clip: text)
- No pure black (#000) or pure white (#fff)
- No centered-and-floating layouts without edge anchoring
- No cyan-on-dark neon aesthetic (we're premium, not gaming)
- No identical repeated card grids
- No web-sized typography (nothing under 24px)
