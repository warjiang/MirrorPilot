# Expanded Prompt — MirrorPilot 小红书宣传片

## Title + Style Block

**Brand**: MirrorPilot — container image mirroring tool for developers behind network restrictions.
**Canvas**: Dark premium (`#0D1B2A`) — consistent across all 5 scenes.
**Text**: `#E0E1DD` primary, `#778DA9` secondary, `#2EC4B6` highlight.
**Font**: Space Grotesk 700-800 display / system-ui body / JetBrains Mono code.
**Energy**: Medium-High. Product demo meets social ad urgency.
**Format**: 1080×1920 (9:16 vertical), ~35 seconds.

## Rhythm Declaration

`hook-PUNCH-BUILD-breathe-CTA`

Scene 1 grabs with pain. Scene 2 slams the brand. Scene 3 builds confidence with features. Scene 4 lets the viewer breathe with proof numbers. Scene 5 resolves with a clear action.

## Global Rules

- **Parallax**: Every scene has 2+ depth layers with differential motion speed
- **Micro-motion**: All decoratives breathe (scale pulse) or drift (slow y translate)
- **Primary transition**: Blur crossfade (12px, 0.35s, power2.inOut) — 3 of 4 transitions
- **Accent transition**: Zoom through on scene 2 reveal (the "wow" moment)
- **Outro**: Color dip to `#0D1B2A` over 0.6s
- **No exit animations** except scene 5 (final fade)
- **Captions**: Bottom-aligned, word-by-word highlight sync to narration

---

## Scene 1: 痛点 Hook (0-7s)

### Concept
The viewer is trapped in a broken workflow. A terminal window shows `docker pull` commands failing — timeout errors cascade, red error messages pile up. The screen feels oppressive, frustrated, stuck. This is every developer's GFW nightmare made visceral.

### Mood direction
"Digital claustrophobia. The frustration of watching a progress bar that never moves. Error messages as environmental hazard."

### Depth layers
- **BG**: Dark navy fill + slow-pulsing red/orange radial glow (danger tint, 12% opacity) + faint grid pattern (hairline rules, 5% opacity)
- **MG**: Terminal window with cascading error messages — `Error: context deadline exceeded`, `timeout awaiting response`, `TLS handshake timeout`
- **FG**: Large bold text "拉取镜像总是超时？" — the hook question. Registration marks top-left corner. Monospace timestamp label bottom-right.
- **Decorative**: Subtle static/noise grain overlay. Broken progress bar animation (fills to 30% then resets).

### Animation choreography
| Element | Verb | Timing |
|---------|------|--------|
| Grid pattern | FADES IN from 0% to 5% | 0.1s |
| Terminal window | SLIDES in from bottom-right, slight rotation (-2°) | 0.3s, power3.out |
| Error line 1 | TYPES ON character by character | 0.8s start, 0.4s duration |
| Error line 2 | TYPES ON | 1.4s start |
| Error line 3 | TYPES ON | 2.0s start |
| Red glow | PULSES from 8% to 15% opacity | looping 1.5s |
| Hook text "拉取镜像总是超时？" | SLAMS in from left, slight overshoot | 3.5s, 0.5s duration, expo.out |
| Progress bar | FILLS to 30% then RESETS | looping 2s |
| Registration marks | FADES in subtly | 0.2s |

### Transition out
Blur crossfade — content blurs to 12px over 0.35s (power2.inOut) as scene 2 enters sharp.

---

## Scene 2: 品牌亮相 PUNCH (7-15s)

### Concept
After the frustration, relief arrives. The MirrorPilot logo and name SLAM into existence with confidence and authority. The background shifts from danger-red glow to clean cyan/teal — the brand's "sync success" color. A single line declares the value: "一站式容器镜像同步方案".

### Mood direction
"The hero entrance. Confident, precise, decisive. Like a surgeon entering the room — no fanfare, just competence. The visual equivalent of a deep breath out."

### Depth layers
- **BG**: Same `#0D1B2A` + large radial glow in `#2EC4B6` at 15% opacity, centered, breathing. Ghost text "MIRROR" at 4% opacity, oversized (400px), slow rightward drift.
- **MG**: MirrorPilot wordmark (Space Grotesk, 96px, weight 800). Below: tagline "一站式容器镜像同步方案" (42px, `#778DA9`). Minimal icon/logo above wordmark.
- **FG**: Horizontal hairline rule (2px, `#415A77`) separating brand from tagline. Small "v1.0" version badge top-right corner. Accent dot indicators.

### Animation choreography
| Element | Verb | Timing |
|---------|------|--------|
| Cyan glow | BLOOMS from center (scale 0.5→1.0) | 0s, 0.8s, power2.out |
| Ghost text "MIRROR" | DRIFTS in from right at constant speed | 0s continuous |
| Wordmark "MirrorPilot" | STAMPS in (scale 1.1→1.0, opacity 0→1) with slight spring | 0.3s, 0.5s, back.out(1.4) |
| Hairline rule | DRAWS from center outward (scaleX 0→1) | 0.6s, 0.4s, power3.out |
| Tagline | FLOATS up (y:20→0, opacity 0→1) | 0.9s, 0.5s, power2.out |
| Version badge | FADES in | 1.2s, 0.3s |
| Accent dots | STAGGER in (3 dots, 100ms interval) | 1.4s |

### Transition out
Blur crossfade — 0.35s, power2.inOut.

---

## Scene 3: 功能展示 BUILD (15-25s)

### Concept
Three feature panels cascade in, each showing a core capability. The layout splits the vertical frame into three zones. Each zone activates sequentially with its own micro-animation, building confidence through accumulated evidence. The features: 声明式配置 / 自动同步 / 实时监控.

### Mood direction
"Product documentation made cinematic. Each feature is a fact stated with visual authority — not a sales pitch but a demonstration of capability."

### Depth layers
- **BG**: `#0D1B2A` + subtle vertical gradient lines (3% opacity, slow upward drift). Small accent glow behind each panel on activation.
- **MG**: Three feature cards stacked vertically, each with: icon (left), title (bold), 1-line description. Card 1: config icon + "声明式配置" + "YAML 声明，自动执行". Card 2: sync icon + "自动同步" + "GitHub Actions 持续同步". Card 3: monitor icon + "实时监控" + "Web 界面，状态一目了然".
- **FG**: Connecting line between cards (vertical rule, draws downward). Step numbers "01" "02" "03" in monospace, top-right of each card. Accent highlight bar on active card.

### Animation choreography
| Element | Verb | Timing |
|---------|------|--------|
| Vertical gradient lines | DRIFT upward continuously | 0s, ambient |
| Card 1 | SLIDES in from left (x:-60→0, opacity 0→1) | 0.3s, 0.6s, power3.out |
| Card 1 accent bar | DRAWS left-to-right (scaleX 0→1) | 0.6s, 0.3s, power2.out |
| Step "01" | FADES in | 0.5s, 0.3s |
| Connecting line segment 1 | DRAWS downward (scaleY 0→1) | 1.2s, 0.4s, power2.out |
| Card 2 | SLIDES in from left | 1.5s, 0.6s, power3.out |
| Card 2 accent bar | DRAWS | 1.8s, 0.3s |
| Step "02" | FADES in | 1.7s |
| Connecting line segment 2 | DRAWS downward | 2.4s, 0.4s |
| Card 3 | SLIDES in from left | 2.7s, 0.6s, power3.out |
| Card 3 accent bar | DRAWS | 3.0s, 0.3s |
| Step "03" | FADES in | 2.9s |

### Transition out
Blur crossfade — 0.35s, power2.inOut.

---

## Scene 4: 社会证明 breathe (25-30s)

### Concept
Numbers that prove trust. Two or three key metrics COUNT UP from zero — sync success rate, images supported, active users. The layout is spacious, letting the data breathe. This is the exhale after the build.

### Mood direction
"Data visualization as quiet confidence. The numbers speak. Big, calm, authoritative. No decoration competing with the stats."

### Depth layers
- **BG**: `#0D1B2A` + single large radial glow (`#2EC4B6` at 10% opacity), very slow breathe. Faint horizontal hairline rules at 3% for subtle texture.
- **MG**: Two large metrics centered: "99.9%" (sync success) and "200+" (supported images). Each with a label below in `#778DA9`.
- **FG**: Thin accent underline beneath each metric (draws in). Small decorative "+" symbols floating near the numbers.

### Animation choreography
| Element | Verb | Timing |
|---------|------|--------|
| Radial glow | BREATHES (scale pulse 1.0→1.03) | 0s, ambient 3s cycle |
| Metric 1 "99.9%" | COUNTS UP from 0 | 0.3s start, 1.5s duration |
| Label 1 "同步成功率" | FLOATS up (y:15→0, opacity 0→1) | 0.8s, 0.4s, power2.out |
| Underline 1 | DRAWS from left (scaleX 0→1) | 1.0s, 0.3s |
| Metric 2 "200+" | COUNTS UP from 0 | 1.2s start, 1.2s duration |
| Label 2 "支持镜像" | FLOATS up | 1.6s, 0.4s |
| Underline 2 | DRAWS from left | 1.8s, 0.3s |
| Floating "+" symbols | DRIFT slowly upward | 0.5s start, ambient |

### Transition out
Color dip — opacity fades toward `#0D1B2A` over 0.5s as scene 5 enters.

---

## Scene 5: CTA (30-35s)

### Concept
Clean, decisive close. The website URL is the hero. A simple "立即体验" call-to-action. The brand name anchors the bottom. Everything fades to the deep background at the end — a confident close, not a whimper.

### Mood direction
"The handshake. Confident, clear, no-pressure. The visual equivalent of 'you know where to find us.'"

### Depth layers
- **BG**: `#0D1B2A` + very subtle radial glow (brand teal, 8% opacity, centered, still).
- **MG**: "立即体验" (48px, `#E0E1DD`) above URL. URL "mirrorpilot.20220625.xyz" (36px, `#2EC4B6`, JetBrains Mono). MirrorPilot wordmark below (smaller, 32px, `#778DA9`).
- **FG**: Minimal — just a thin horizontal rule separating CTA from brand.

### Animation choreography
| Element | Verb | Timing |
|---------|------|--------|
| Subtle glow | present from start, still | — |
| "立即体验" | FLOATS in (y:30→0, opacity 0→1) | 0.3s, 0.5s, power3.out |
| URL | TYPES ON character by character | 0.8s start, 1.0s duration |
| Horizontal rule | DRAWS from center (scaleX 0→1) | 1.5s, 0.3s |
| Wordmark | FADES in | 1.8s, 0.4s, power2.out |
| ALL elements | FADE OUT to bg color | 4.0s, 0.8s (final scene exit allowed) |

### Transition out
Final fade to `#0D1B2A` — all elements opacity → 0 over 0.8s. Video ends.

---

## Recurring Motifs

- **Teal glow** (`#2EC4B6` at 10-15%): appears in every scene as radial background element — the thread of "sync/success"
- **Hairline rules** (`#415A77`, 1-2px): structural dividers in every scene, always animate via scaleX draw
- **JetBrains Mono code text**: appears in scenes 1, 3, 5 — the developer's voice
- **Registration marks / metadata labels**: monospace details anchored to corners

## Negative Prompt

- No gradient text effects
- No neon/cyberpunk aesthetic
- No card grid layouts (features are stacked panels, not cards)
- No stock imagery or screenshots (pure motion graphics)
- No emojis or casual icons
- No bounce/elastic easing (we're precise, not playful)
- No web-sized elements (everything scaled for video)
- No pure black or pure white
