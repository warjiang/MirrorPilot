# Design

## Visual Theme

Neutral, monochromatic product UI with restrained color strategy. Light mode default; dark mode supported. Clean, tool-like aesthetic inspired by Linear and Vercel — minimal chrome, generous whitespace, typographic hierarchy over decorative elements.

## Color Palette

Color model: OKLCH. Strategy: **Restrained** (tinted neutrals + semantic status accents).

### Light mode

| Role | Value | Usage |
|---|---|---|
| Background | `oklch(0.995 0.004 250)` | Page background |
| Foreground | `oklch(0.155 0.012 250)` | Primary text |
| Card | `oklch(0.995 0.004 250)` | Card surfaces |
| Muted | `oklch(0.965 0.006 250)` | Subtle backgrounds, secondary surfaces |
| Muted foreground | `oklch(0.52 0.01 250)` | Secondary text, labels |
| Border | `oklch(0.912 0.008 250)` | Borders, dividers |
| Primary | `oklch(0.37 0.08 260)` | Buttons, strong interactive elements |
| Ring | `oklch(0.52 0.06 260)` | Focus rings |
| Destructive | `oklch(0.577 0.245 27.325)` | Errors, delete actions |
| Success | `oklch(0.6 0.13 155)` | Synced, healthy states |
| Warning | `oklch(0.72 0.15 75)` | Pending, attention states |

### Dark mode

| Role | Value | Usage |
|---|---|---|
| Background | `oklch(0.155 0.012 250)` | Page background |
| Foreground | `oklch(0.985 0.004 250)` | Primary text |
| Card | `oklch(0.195 0.014 250)` | Card surfaces |
| Muted | `oklch(0.24 0.012 250)` | Subtle backgrounds |
| Muted foreground | `oklch(0.65 0.008 250)` | Secondary text |
| Border | `oklch(0.985 0.004 250 / 10%)` | Borders |
| Primary | `oklch(0.72 0.08 260)` | Buttons, interactive |
| Ring | `oklch(0.6 0.06 260)` | Focus rings |
| Destructive | `oklch(0.704 0.191 22.216)` | Errors |
| Success | `oklch(0.7 0.14 155)` | Synced states |
| Warning | `oklch(0.8 0.15 75)` | Pending states |

## Typography

- **Font stack**: System font (Tailwind default — `ui-sans-serif, system-ui, sans-serif`)
- **Body size**: `text-sm` (14px) for density; `text-base` for long-form
- **Heading scale**: `text-lg` (18px) page titles, `text-sm font-semibold` section heads
- **Weight contrast**: `font-medium` (500) for interactive labels, `font-semibold` (600) for headings
- **Line length**: Constrained by `max-w-5xl` container (~65–75ch at body size)

## Spacing & Layout

- **Container**: `max-w-5xl mx-auto px-4` (centered, 1024px max)
- **Page gap**: `gap-6` (24px) between major sections
- **Base radius**: `0.625rem` (10px), with `sm`/`md`/`lg`/`xl` variants
- **Elevation**: No box-shadows on layout; `shadow-xs` on interactive elements (buttons)

## Components

Built on **shadcn/ui** (Radix primitives + CVA + Tailwind):

- **Button**: 6 variants (default, destructive, outline, secondary, ghost, link); 4 sizes (default, sm, lg, icon)
- **Badge**: semantic variants (default, secondary, destructive, success, warning, outline) for status indicators
- **Table**: standard data table for mirror entries
- **Card**: surface container (used sparingly)
- **Dialog**: modal for add/edit flows
- **Command**: command palette / search
- **Select, Input, Label**: form primitives

## Iconography

- **Library**: Lucide React
- **Default size**: `size-4` (16px) inline, `size-6` (24px) for nav/branding
- **Style**: Stroke icons, 1.5px weight (Lucide defaults)

## Status System

States are communicated via Badge + Icon + Text (never color alone):

| State | Badge variant | Icon | Meaning |
|---|---|---|---|
| ok / exists | success | CheckCircle2 | Mirror is synced |
| missing | warning | HelpCircle | Source exists, mirror missing |
| failed / unreachable / error | destructive | XCircle | Sync or connectivity failure |
| skipped | secondary | CircleSlash | Intentionally not checked |
| checking | secondary | Loader2 (spinning) | Detection in progress |

## Motion

- **Transitions**: `transition-colors` on interactive elements (buttons, nav links)
- **Loading**: `animate-spin` on Loader2 icons during async operations
- **Easing**: Default Tailwind curves; no bounce or elastic
- **Reduced motion**: Respect `prefers-reduced-motion` (Tailwind handles via `tw-animate-css`)

## Responsive Behavior

- Single-column layout with `max-w-5xl` container
- Mobile: full-width with `px-4` padding
- No breakpoint-specific layouts currently (table scrolls horizontally on narrow viewports)
