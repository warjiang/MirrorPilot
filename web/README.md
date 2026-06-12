# MirrorPilot Web

Web console for MirrorPilot image mirror management, built on Cloudflare Pages + Functions + D1.

## What it does

- Manage image entries (`source -> target`) and registry profiles
- Run source/registry checks from the browser
- Trigger GitHub Actions sync jobs from UI
- Track sync job progress/status
- Authenticate via GitHub OAuth or email/password (verification code)

## Runtime architecture

- Frontend: React + Vite SPA
- Backend: Cloudflare Pages Functions (`functions/`, Hono)
- Database: Cloudflare D1
- Sync executor: GitHub Actions (`web-sync.yml`, `sync-images.yml`)

## Local development (quick start)

Detailed guide: `LOCAL_DEVELOPMENT.md`

1. Install dependencies:

```bash
cd web
pnpm install
```

2. Prepare local environment:

```bash
cp .dev.vars.example .dev.vars
pnpm wrangler d1 create mirrorpilot --local
pnpm wrangler d1 migrations apply mirrorpilot --local
```

3. Run dev servers in two terminals:

```bash
# terminal 1
pnpm dev

# terminal 2
pnpm dev:cf
```

4. Open `http://localhost:5173`

## Required production secrets

Set these in Cloudflare Pages (Production + Preview as needed):

| Variable | Required | Purpose |
|---|---|---|
| `GITHUB_CLIENT_ID` | yes | GitHub OAuth client id |
| `GITHUB_CLIENT_SECRET` | yes | GitHub OAuth client secret |
| `GITHUB_TOKEN` | yes (for web-triggered sync) | Trigger `repository_dispatch` |
| `GITHUB_REPO` | yes (for web-triggered sync) | Target repo in `owner/repo` format |
| `SYNC_SECRET` | yes (for web-triggered sync) | Shared auth secret between Pages and Actions |
| `RESEND_API_KEY` | optional | Send email verification codes |
| `EMAIL_FROM_ADDRESS` | optional | Email sender address |
| `EMAIL_FROM_NAME` | optional | Email sender name |
| `ADMIN_EMAIL` | optional | Bootstrap admin user |

## GitHub OAuth setup (minimal)

1. Create one OAuth App in GitHub Developer Settings.
2. Add callback URLs you actually use, for example:

```text
http://localhost:8788/api/auth/callback
http://localhost:5173/api/auth/callback
https://<your-pages-domain>/api/auth/callback
https://<your-custom-domain>/api/auth/callback
```

3. Configure `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Pages secrets.

For callback mismatch and local auth issues, see `OAUTH_TROUBLESHOOTING.md`.

## Deploy

### Option A: GitHub Actions (recommended)

`deploy-pages.yml` runs on push to `main` when `web/**` changes:
1. Install dependencies
2. Typecheck and build
3. Apply D1 migrations (`wrangler d1 migrations apply DB --env production --remote`)
4. Deploy to Cloudflare Pages

Required GitHub secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Option B: Manual Wrangler deploy

```bash
cd web
pnpm run build
pnpm wrangler d1 migrations apply DB --remote
pnpm run deploy
```

## Sync flow from Web UI

1. UI sends sync trigger request.
2. Pages Function creates/updates sync job and triggers `repository_dispatch`.
3. `web-sync.yml` executes `skopeo copy` per image and reports events back.
4. UI polls/reads job status and image-level results.

## Checks

```bash
pnpm run lint
pnpm run typecheck
pnpm run build
```

## Related docs

- `LOCAL_DEVELOPMENT.md`: full local setup and troubleshooting
- `OAUTH_TROUBLESHOOTING.md`: GitHub OAuth pitfalls and fixes
- `API_TESTING.md`: API-level testing examples
