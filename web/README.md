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
   - **Application name**: `MirrorPilot`
   - **Homepage URL**: `https://mirrotpilot.20220625.xyz` (your production domain)
   - **Authorization callback URL**: Leave empty for now (we'll set multiple URLs in the next step)
4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy the **Client Secret**

#### 1b. Configure Callback URLs

> ✅ One GitHub OAuth App can support **multiple callback URLs**. You don't need separate apps for local/staging/production.

1. Go back to your OAuth App settings
2. Scroll down to **Authorization callback URLs**
3. Enter all the URLs you need (one per line):
   ```
   http://localhost:8788/api/auth/callback
   http://localhost:5173/api/auth/callback
   https://your-preview.mirrorpilot.pages.dev/api/auth/callback
   https://mirrotpilot.20220625.xyz/api/auth/callback
   https://www.mirrotpilot.20220625.xyz/api/auth/callback
   ```
4. Save

> ⚠️ **Important**: Each URL must match **exactly** (no wildcards like `https://*.yourdomain.com`).
> Remove URLs you don't need; only leave the ones you're actually using.

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

#### 3. Configure Registry Credentials (for web-triggered sync)

If you want the "Sync" button in the Web UI to trigger GitHub Actions, you need to configure destination registry credentials in the Web UI:

1. Go to **Settings** in the Web UI
2. In the **Registry Credentials** section, click **Add Registry Credential**
3. Enter:
   - **Registry URL**: your destination registry (e.g., `registry.example.com`)
   - **Username**: registry username
   - **Password**: registry password
4. Click **Save Credential**

These credentials are stored securely in Cloudflare D1 and used by GitHub Actions sync.

Also ensure these environment variables are set in Cloudflare Pages:

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | A GitHub PAT with `repo` scope (for triggering `repository_dispatch`) |
| `GITHUB_REPO` | Your repo in `owner/repo` format (e.g. `warjiang/MirrorPilot`) |
| `SYNC_SECRET` | A random shared secret for API authentication between Actions and Pages |
| `ADMIN_EMAIL` | (Optional) GitHub email address of the user who should have admin privileges |

> Note: `GITHUB_REPO` is the GitHub repository identifier (for example `warjiang/MirrorPilot`), not the Cloudflare Pages project name.  
> Cloudflare Pages project name for deploy is `mirrorpilot`.

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

### Registry credentials management
Registry credentials for the sync operation are stored securely in **Cloudflare D1**:

1. Go to the **Settings** page
2. In **Registry Credentials**, add destination registry credentials
3. These are automatically used by GitHub Actions sync via `/api/secrets/ci`

Credentials are never exposed in logs or configuration files — they're fetched
directly by the sync Action via a secure API endpoint with `SYNC_SECRET` authentication.

## Local development

For a detailed local development guide with troubleshooting, see [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).

### Quick start

```bash
cd web

# 1. Initialize D1 database
pnpm wrangler d1 create mirrorpilot --local
pnpm wrangler d1 migrations apply mirrorpilot --local

# 2. Create GitHub OAuth App at https://github.com/settings/developers
# Add these callback URLs to your OAuth App settings:
#   - http://localhost:8788/api/auth/callback (local wrangler)
#   - http://localhost:5173/api/auth/callback (local vite)
#   - https://your-production-domain.com/api/auth/callback
# (See README.md for full setup instructions)

# 3. Configure .dev.vars with OAuth credentials
cat > .dev.vars << 'EOF'
DEV_USER_EMAIL=dev@localhost
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
GITHUB_TOKEN=your-github-pat
GITHUB_REPO=your-repo
SYNC_SECRET=your-sync-secret
ADMIN_EMAIL=dev@localhost
EOF

# 4. Start development servers in two terminals
# Terminal 1:
pnpm dev

# Terminal 2:
pnpm dev:cf
```

Visit **http://localhost:8788** (not 5173 — that's just the Vite server)

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
│   ├── 0003_sync_status.sql    # Sync status columns on images
│   ├── 0004_admin.sql          # Admin role support
│   └── 0005_registry_secrets.sql # Registry credentials storage
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
│       ├── secrets/
│       │   ├── registry.ts     # GET/POST/DELETE registry credentials (UI)
│       │   └── ci.ts           # GET registry credentials (for CI/CD)
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
│   │   └── SettingsPage.tsx    # Account info + registry credentials
│   ├── components/
│   │   ├── AuthGuard.tsx       # Route protection (redirects to landing)
│   │   ├── RegistrySecretsPanel.tsx # Registry credentials UI
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
