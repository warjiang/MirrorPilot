# MirrorPilot Web

A web version of [MirrorPilot](https://github.com/warjiang/MirrorPilot) for
managing container image mirror entries and running **source detection** from
the browser.

Runs entirely on **Cloudflare's infrastructure**:

- **Cloudflare Pages** serves the static React app.
- **Cloudflare Pages Functions** (`functions/`) provide the detection,
  registry-check, and auth APIs on the Workers runtime.
- **Cloudflare D1** (managed SQLite) stores mirror configuration, user
  accounts, and sessions.
- **GitHub OAuth** handles authentication — users sign in with their GitHub
  account.

## Architecture

```
Browser
  ├── React SPA (static, served by Cloudflare Pages)
  │     ├── /           — landing page (public)
  │     ├── /mirrors    — mirror entry CRUD + source detection + sync trigger
  │     ├── /profiles   — registry profile CRUD + availability check
  │     └── /settings   — account info
  │
  └── Cloudflare Pages Functions (serverless edge workers)
        ├── GET/PUT /api/config         — read/write MirrorConfig via D1
        ├── POST /api/detect            — probes source existence, mirror sync status, auth
        ├── POST /api/check-registry    — pings registry reachability and validates credentials
        ├── GET  /api/auth/github       — redirects to GitHub OAuth
        ├── GET  /api/auth/callback     — handles OAuth callback, creates session
        ├── GET  /api/auth/me           — returns current user info
        ├── POST /api/auth/logout       — destroys session
        ├── POST /api/sync/trigger      — triggers GitHub Actions sync via repository_dispatch
        ├── GET  /api/sync/pending      — returns pending images (for GitHub Actions)
        └── POST /api/sync/complete     — receives sync results (from GitHub Actions)
```

### Data flow

```
Browser
  ↕ authenticated via GitHub OAuth (mp_session cookie)
Cloudflare D1 (users, sessions, profiles, images)
  ↕ repository_dispatch + API callback
GitHub Actions (skopeo sync)
```

On every page load the app seeds from `localStorage` for instant render, then
immediately fetches the canonical config from D1. **Pull** re-fetches from D1;
**Push** writes current state back to D1.

## Authentication

MirrorPilot uses **GitHub OAuth** for authentication:

1. User clicks "Sign in with GitHub" on the landing page
2. Redirected to GitHub for authorization
3. On callback, a D1-backed session is created (7-day expiry, sliding window)
4. Session ID stored in `mp_session` HttpOnly cookie

### Setting up GitHub OAuth

#### 1. Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name**: `MirrorPilot` (or any name)
   - **Homepage URL**: `https://mirrotpilot.20220625.xyz`
   - **Authorization callback URL**: `https://mirrotpilot.20220625.xyz/api/auth/callback`
4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy the **Client Secret**

> ⚠️ For preview deployments (e.g. `feat-auth.mirrorpilot.pages.dev`), create a
> separate OAuth App or update the callback URL accordingly.

#### 2. Configure Cloudflare Pages secrets

Using Wrangler CLI:

```bash
cd web

# Production environment
npx wrangler pages secret put GITHUB_CLIENT_ID
# paste your Client ID

npx wrangler pages secret put GITHUB_CLIENT_SECRET
# paste your Client Secret

# Preview environment (for branch deploys)
npx wrangler pages secret put GITHUB_CLIENT_ID --env preview
npx wrangler pages secret put GITHUB_CLIENT_SECRET --env preview
```

Or via Cloudflare Dashboard:
1. Go to **Pages** → your project → **Settings** → **Environment variables**
2. Add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for both Production and Preview

#### 3. Configure GitHub Actions secrets (for web-triggered sync)

If you want the "Sync" button in the Web UI to trigger GitHub Actions:

| Secret | Description |
|--------|-------------|
| `WEB_API_BASE_URL` | Your production URL (set to `https://mirrotpilot.20220625.xyz`) |
| `SYNC_SECRET` | A random shared secret for API authentication between Actions and Pages |
| `DEST_REGISTRY_USER` | Destination registry username |
| `DEST_REGISTRY_PASSWORD` | Destination registry password |

Also add to Cloudflare Pages environment variables:

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | A GitHub PAT with `repo` scope (for triggering `repository_dispatch`) |
| `GITHUB_REPO` | Your repo in `owner/repo` format (e.g. `warjiang/MirrorPilot`) |
| `SYNC_SECRET` | Same shared secret as configured in GitHub Actions |

#### Rotate `SYNC_SECRET` (recommended periodically)

Generate a new random secret and update both GitHub Actions and Cloudflare Pages:

```bash
# 1) Generate a strong random secret (macOS/Linux)
NEW_SYNC_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
echo "$NEW_SYNC_SECRET"

# 2) Update GitHub Actions secret (repo-level)
gh secret set SYNC_SECRET --repo warjiang/MirrorPilot --body "$NEW_SYNC_SECRET"

# 3) Update Cloudflare Pages secret (production + preview)
cd web
echo "$NEW_SYNC_SECRET" | npx wrangler pages secret put SYNC_SECRET
echo "$NEW_SYNC_SECRET" | npx wrangler pages secret put SYNC_SECRET --env preview
```

## Secret & credential storage

| Secret | Where stored | Lifetime |
|---|---|---|
| Mirror config (profiles, images) | Cloudflare D1 (per-user row) | Persistent |
| User accounts & sessions | Cloudflare D1 | Session: 7 days (sliding) |
| Config cache | `localStorage` (this device only) | Until cleared |
| Registry username / password | Memory only (`useState`) | Browser tab session |
| Theme preference | `localStorage` | Until cleared |
| GitHub OAuth credentials | Cloudflare Pages secrets | Persistent |
| Sync secret | Cloudflare Pages secrets + GitHub Actions secrets | Persistent |

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

### Landing page (`/`)
- Public product introduction page with feature highlights
- "Sign in with GitHub" CTA button

### Profile management (`/profiles`)
- Create, edit, and delete named registry profiles.
- Each profile stores a target registry URL and env-var names for credentials
  (matching the Go CLI config format).
- **Registry check**: enter runtime credentials and ping the registry to verify
  reachability and credential validity via `/api/check-registry`.

### Mirror management (`/mirrors`)
- Add, edit, delete, enable/disable source → target image mappings.
- Target path is auto-derived from the source image reference.
- **Sync button**: triggers GitHub Actions to sync pending images via `repository_dispatch`.
- **Sync status**: per-image status badges (pending/syncing/synced/failed).
- **Source detection**: probes four things per entry via `/api/detect`:

| Check | Meaning |
|---|---|
| **Source** | Source image manifest exists |
| **Reachable** | Mirror registry endpoint is reachable |
| **Mirror** | Mirror image is already synced/present |
| **Auth** | Supplied credentials are accepted |

### Cloud storage (`/settings`)
Configuration is stored in **Cloudflare D1** and tied to your GitHub identity.
No setup required — use the **Pull** and **Push** buttons in the header to sync.

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
cat > .dev.vars << 'EOF'
DEV_USER_EMAIL=dev@localhost
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
GITHUB_TOKEN=your-github-pat
GITHUB_REPO=warjiang/MirrorPilot
SYNC_SECRET=your-random-secret
EOF
```

> With `DEV_USER_EMAIL` set, authentication is bypassed in local development.

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

### Post-deployment setup

1. **Apply D1 migrations** to the remote database:
   ```bash
   cd web
   npx wrangler d1 migrations apply mirrorpilot --remote
   ```

2. **Configure secrets** as described in the [Authentication](#authentication) section above.

3. **Create GitHub OAuth App** with the correct callback URL for your deployment.

4. **Bind custom domain** `mirrotpilot.20220625.xyz` in Cloudflare Pages:
   - Pages project → **Custom domains** → **Set up a custom domain**
   - Add `mirrotpilot.20220625.xyz`
   - Ensure DNS record is proxied by Cloudflare and status becomes **Active**

## Project layout

```
web/
├── migrations/
│   ├── 0001_init.sql           # D1 schema: users, profiles, images
│   ├── 0002_sessions.sql       # Sessions table + user OAuth fields
│   └── 0003_sync_status.sql    # Sync status columns on images
├── functions/
│   ├── _env.ts                 # Shared Env interface (DB + secrets)
│   ├── _middleware.ts          # Auth middleware (session validation)
│   └── api/
│       ├── config.ts           # GET/PUT /api/config — D1 read/write
│       ├── detect.ts           # POST /api/detect
│       ├── check-registry.ts   # POST /api/check-registry
│       ├── _registry.ts        # Docker Registry v2 client (token auth)
│       ├── auth/
│       │   ├── github.ts       # OAuth redirect
│       │   ├── callback.ts     # OAuth callback + session creation
│       │   ├── me.ts           # Current user info
│       │   └── logout.ts       # Session destruction
│       └── sync/
│           ├── trigger.ts      # Trigger GitHub Actions sync
│           ├── pending.ts      # Return pending images (for Actions)
│           └── complete.ts     # Receive sync results (from Actions)
├── src/
│   ├── layouts/
│   │   └── AppLayout.tsx       # Shared nav shell with Pull/Push buttons
│   ├── pages/
│   │   ├── LandingPage.tsx     # Public landing page
│   │   ├── MirrorsPage.tsx     # Mirror CRUD + detection + sync
│   │   ├── ProfilesPage.tsx    # Profile CRUD + registry check
│   │   └── SettingsPage.tsx    # Account info
│   ├── components/
│   │   ├── AuthGuard.tsx       # Route protection (redirects to landing)
│   │   ├── StatusBadge.tsx     # Detection result badges
│   │   └── ui/                 # shadcn/ui primitives
│   ├── hooks/
│   │   ├── useAuth.ts              # Auth state + login/logout helpers
│   │   ├── useLocalStorage.ts      # Generic JSON-persisted state
│   │   └── useCloudflareStorage.ts # D1 load/save with localStorage cache
│   ├── lib/
│   │   ├── cloudflare.ts   # /api/config fetch wrappers
│   │   ├── types.ts        # Shared TypeScript types
│   │   ├── image.ts        # Image ref parsing/validation
│   │   └── api.ts          # /api/detect + /api/sync clients
│   ├── router.tsx          # React Router setup
│   └── App.tsx
├── .dev.vars               # Local env (gitignored)
├── wrangler.toml
└── components.json         # shadcn config
```
