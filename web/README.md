# MirrorPilot Web

A web version of [MirrorPilot](https://github.com/warjiang/MirrorPilot) for
managing container image mirror entries and running **source detection** from
the browser.

It runs entirely on **Cloudflare's free tier**:

- **Cloudflare Pages** serves the static React app.
- **Cloudflare Pages Functions** (`functions/`) provide the detection and
  registry-check APIs, running on the Workers runtime (free tier: 100k req/day).

No database or paid add-on is required.

## Architecture

```
Browser
  ├── React SPA (static, served by Cloudflare Pages)
  │     ├── /mirrors   — mirror entry CRUD + source detection
  │     ├── /profiles  — registry profile CRUD + availability check
  │     └── /settings  — GitHub storage connection
  │
  └── Cloudflare Pages Functions (serverless edge workers)
        ├── POST /api/detect          — probes source existence, mirror sync status, auth
        └── POST /api/check-registry  — pings registry reachability and validates credentials
```

### Data flow

```
Browser localStorage  ←→  in-memory React state  ←→  GitHub repo (mirrorpilot.yaml)
                                                         via GitHub Contents API
                                                         (PUT/GET with PAT auth)
```

On every page load the app reads from `localStorage`. If GitHub storage is
configured, clicking **Pull** fetches the latest `mirrorpilot.yaml` from GitHub
and overwrites in-memory state. **Push** serializes current state back to YAML
and commits it to the repo.

## Secret & credential storage

| Secret | Where stored | Lifetime |
|---|---|---|
| GitHub PAT | `localStorage` (browser, this device only) | Until disconnected |
| Mirror config (profiles, images) | `localStorage` | Until cleared |
| Registry username / password | Memory only (`useState`) | Browser tab session |

**Registry credentials** (username/password used for detection) are never
written to `localStorage`, never committed to GitHub, and never sent to
Cloudflare — they are only forwarded to the target registry's auth endpoint
via the `/api/detect` and `/api/check-registry` Pages Functions, and discarded
immediately after each request.

**GitHub PAT** is stored in `localStorage` for convenience. It is sent only
to `api.github.com` — never to Cloudflare or any other third party. Use a
fine-grained token with `contents:write` scope limited to the target repository.

**`mirrorpilot.yaml`** stores `username_env` / `password_env` field names (not
actual credentials), matching the Go CLI convention where credentials are
injected via environment variables at sync time.

## Tech stack

- [Vite](https://vite.dev/) + React 19 + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) components (new-york style)
- [React Router v7](https://reactrouter.com/) (browser-history routing)
- [js-yaml](https://github.com/nodeca/js-yaml) (YAML parse/serialize, Go CLI compatible)
- Cloudflare Pages Functions + [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

## Features

### Profile management (`/profiles`)
- Create, edit, and delete named registry profiles.
- Each profile stores a target registry URL and env-var names for credentials
  (matching the Go CLI config format).
- **Registry check**: enter runtime credentials and ping the registry to verify
  reachability and credential validity via `/api/check-registry`.

### Mirror management (`/mirrors`)
- Add, edit, delete, enable/disable source → target image mappings.
- Target path is auto-derived from the source image reference.
- **Source detection**: probes four things per entry via `/api/detect`:

| Check | Meaning |
|---|---|
| **Source** | Source image manifest exists |
| **Reachable** | Mirror registry endpoint is reachable |
| **Mirror** | Mirror image is already synced/present |
| **Auth** | Supplied credentials are accepted |

### GitHub storage (`/settings`)
- Connect to a GitHub repository using a Personal Access Token.
- Config is stored as `mirrorpilot.yaml` (Go CLI compatible format).
- **Pull**: fetch latest config from GitHub into the browser.
- **Push**: commit current config back to GitHub.
- Without GitHub configured, config persists only in `localStorage`.

## mirrorpilot.yaml format

The web app reads and writes the same YAML format as the Go CLI:

```yaml
version: v1
profiles:
  default:
    registry: registry.cn-shanghai.aliyuncs.com/your-namespace
    username_env: DEST_REGISTRY_USER    # env var name, not the actual value
    password_env: DEST_REGISTRY_PASSWORD
images:
  - source: nginx:1.27
    target: nginx:1.27
    profile: default
    enabled: true
    created_at: "2026-06-08T00:00:00Z"
```

## Local development

```bash
cd web
pnpm install

# Front-end only (the /api/* endpoints are NOT available here)
pnpm run dev

# Full stack with Pages Functions (build first, then serve dist + functions)
pnpm run build
pnpm run preview:cf   # wrangler pages dev
```

> The `/api/detect` and `/api/check-registry` endpoints are Pages Functions,
> so use `pnpm run preview:cf` (Wrangler) to exercise them locally. Plain
> `pnpm run dev` only serves the React app.

## Checks

```bash
pnpm run lint        # eslint
pnpm run typecheck   # tsc for app + functions
pnpm run build       # type-check + production build to dist/
```

## Deploy to Cloudflare Pages (free tier)

### Option A — Git integration (recommended)
1. Push this repository to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Select the repo and set:
   - **Root directory**: `web`
   - **Build command**: `pnpm run build`
   - **Build output directory**: `dist`
4. Deploy. Functions under `web/functions/` are picked up automatically.

### Option B — Wrangler CLI
```bash
cd web
pnpm run deploy   # runs build, then `wrangler pages deploy`
```

Configuration lives in [`wrangler.toml`](./wrangler.toml)
(`pages_build_output_dir = "dist"`).

## Project layout

```
web/
├── functions/
│   └── api/
│       ├── detect.ts           # POST /api/detect
│       ├── check-registry.ts   # POST /api/check-registry
│       └── _registry.ts        # Docker Registry v2 client (token auth)
├── src/
│   ├── layouts/
│   │   └── AppLayout.tsx       # Shared nav shell with Pull/Push buttons
│   ├── pages/
│   │   ├── MirrorsPage.tsx     # Mirror CRUD + detection
│   │   ├── ProfilesPage.tsx    # Profile CRUD + registry check
│   │   └── SettingsPage.tsx    # GitHub connection settings
│   ├── components/
│   │   ├── StatusBadge.tsx     # Detection result badges
│   │   └── ui/                 # shadcn/ui primitives
│   ├── hooks/
│   │   ├── useLocalStorage.ts  # Generic JSON-persisted state
│   │   └── useGitHubStorage.ts # Async GitHub load/save with localStorage fallback
│   ├── lib/
│   │   ├── github.ts           # GitHub Contents API client
│   │   ├── yaml.ts             # MirrorConfig ↔ YAML serialization
│   │   ├── types.ts            # Shared TypeScript types
│   │   ├── image.ts            # Image ref parsing/validation
│   │   └── api.ts              # /api/detect client
│   ├── router.tsx              # React Router setup
│   └── App.tsx
├── wrangler.toml
└── components.json             # shadcn config
```
