# MirrorPilot Web

A web version of [MirrorPilot](https://github.com/warjiang/MirrorPilot) for
managing container image mirror entries and running **source detection** from
the browser.

Runs entirely on **Cloudflare's infrastructure**:

- **Cloudflare Pages** serves the static React app.
- **Cloudflare Pages Functions** (`functions/`) provide the detection and
  registry-check APIs on the Workers runtime.
- **Cloudflare D1** (managed SQLite) stores mirror configuration per user.
- **Cloudflare Access** handles SSO — no login screen to build.

## Architecture

```
Browser
  ├── React SPA (static, served by Cloudflare Pages)
  │     ├── /mirrors   — mirror entry CRUD + source detection
  │     ├── /profiles  — registry profile CRUD + availability check
  │     └── /settings  — account info
  │
  └── Cloudflare Pages Functions (serverless edge workers)
        ├── GET/PUT /api/config       — read/write MirrorConfig via D1
        ├── POST /api/detect          — probes source existence, mirror sync status, auth
        └── POST /api/check-registry  — pings registry reachability and validates credentials
```

### Data flow

```
Browser localStorage (cache)
        ↕  on mount / Pull / Push
Cloudflare D1  ←  authenticated via Cloudflare Access SSO
                   (Cf-Access-Authenticated-User-Email header)
```

On every page load the app seeds from `localStorage` for instant render, then
immediately fetches the canonical config from D1. **Pull** re-fetches from D1;
**Push** writes current state back to D1.

## Secret & credential storage

| Secret | Where stored | Lifetime |
|---|---|---|
| Mirror config (profiles, images) | Cloudflare D1 (per-user row) | Persistent |
| Config cache | `localStorage` (this device only) | Until cleared |
| Registry username / password | Memory only (`useState`) | Browser tab session |
| Theme preference | `localStorage` | Until cleared |

**Registry credentials** (username/password used for detection) are never
written to D1 or `localStorage`. They are forwarded only to the target
registry's auth endpoint via `/api/detect` and `/api/check-registry`, then
discarded immediately.

**`username_env` / `password_env`** stored in D1 are env-var *names*, not
actual credentials — matching the Go CLI convention where credentials are
injected via environment variables at sync time.

## Tech stack

- [Vite](https://vite.dev/) + React 19 + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) components (new-york style)
- [React Router v7](https://reactrouter.com/) (browser-history routing)
- Cloudflare Pages Functions + D1 + [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

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

### Cloud storage (`/settings`)
Configuration is stored in **Cloudflare D1** and tied to your identity via
**Cloudflare Access SSO**. No setup required — use the **Pull** and **Push**
buttons in the header to sync.

## Local development

### Prerequisites (one-time)

```bash
# 1. Create the D1 database (requires wrangler login)
cd web
pnpm wrangler d1 create mirrorpilot
# → copy the database_id into wrangler.toml

# 2. Apply the schema to local SQLite
pnpm wrangler d1 migrations apply mirrorpilot --local

# 3. Create .dev.vars (already gitignored)
echo 'DEV_USER_EMAIL=dev@localhost' > .dev.vars
```

### Daily development (HMR + Pages Functions)

Open **two terminals**:

```bash
# Terminal 1 — Vite dev server with hot module reload (port 5173)
cd web
pnpm dev

# Terminal 2 — wrangler proxies /api/* to D1, everything else to vite
cd web
pnpm dev:cf   # wrangler pages dev --proxy 5173
```

Browse to **`http://localhost:8788`** (wrangler port, not 5173).

| Request | Handler |
|---|---|
| `/api/*` | wrangler Pages Function + local D1 |
| Everything else | proxied to vite (HMR intact) |

### Full production-build preview

```bash
cd web
pnpm build
pnpm preview:cf   # wrangler pages dev serving dist/
```

## Checks

```bash
pnpm run lint        # eslint
pnpm run typecheck   # tsc for app + functions
pnpm run build       # type-check + production build to dist/
```

## Deploy to Cloudflare Pages

### Option A — GitHub Actions (recommended)

Push to `main`. The `deploy-pages.yml` workflow runs automatically whenever
`web/**` changes:

1. Typechecks and builds the SPA.
2. Applies any pending D1 migrations against the production database.
3. Deploys to Cloudflare Pages via `wrangler pages deploy`.

**Required GitHub secrets:**

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token (use the *Edit Cloudflare Workers* template, add *D1 Edit* permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → right sidebar |

### Option B — Wrangler CLI

```bash
cd web
pnpm run deploy   # pnpm build && wrangler pages deploy
```

### Cloudflare Access setup

After deploying, protect the Pages URL with Cloudflare Access:

1. Zero Trust dashboard → Access → Applications → Add Application → Self-hosted.
2. Enter the Pages URL (e.g. `mirrorpilot-web.pages.dev`).
3. Configure your identity provider (GitHub, Google, etc.) and allowed users.

Access automatically injects `Cf-Access-Authenticated-User-Email` into every
request, which the `/api/config` function uses to scope data per user.

## Project layout

```
web/
├── migrations/
│   └── 0001_init.sql       # D1 schema: users, profiles, images
├── functions/
│   └── api/
│       ├── _env.ts             # Shared Env interface (DB binding)
│       ├── config.ts           # GET/PUT /api/config  — D1 read/write
│       ├── detect.ts           # POST /api/detect
│       ├── check-registry.ts   # POST /api/check-registry
│       └── _registry.ts        # Docker Registry v2 client (token auth)
├── src/
│   ├── layouts/
│   │   └── AppLayout.tsx       # Shared nav shell with Pull/Push buttons
│   ├── pages/
│   │   ├── MirrorsPage.tsx     # Mirror CRUD + detection
│   │   ├── ProfilesPage.tsx    # Profile CRUD + registry check
│   │   └── SettingsPage.tsx    # Account info
│   ├── components/
│   │   ├── StatusBadge.tsx     # Detection result badges
│   │   └── ui/                 # shadcn/ui primitives
│   ├── hooks/
│   │   ├── useLocalStorage.ts      # Generic JSON-persisted state
│   │   └── useCloudflareStorage.ts # D1 load/save with localStorage cache
│   ├── lib/
│   │   ├── cloudflare.ts   # /api/config fetch wrappers
│   │   ├── types.ts        # Shared TypeScript types
│   │   ├── image.ts        # Image ref parsing/validation
│   │   └── api.ts          # /api/detect client
│   ├── router.tsx          # React Router setup
│   └── App.tsx
├── .dev.vars               # Local env (gitignored): DEV_USER_EMAIL=dev@localhost
├── wrangler.toml
└── components.json         # shadcn config
```
