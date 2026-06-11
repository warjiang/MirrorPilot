# Local Development Guide

## Prerequisites Setup

### 1. Create GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **New OAuth App**
3. Fill in the form:
   - **Application name**: `MirrorPilot`
   - **Homepage URL**: `http://localhost:8788` (or your production URL)
   - **Authorization callback URL**: (see below)
4. Click **Register application**
5. You'll see your **Client ID** and can generate a **Client Secret**

#### Authorization Callback URLs

**Good news**: GitHub OAuth Apps support **multiple callback URLs**. You can configure both local development and production in a **single OAuth App**.

1. Go to your OAuth App settings at https://github.com/settings/developers
2. Find your app and click **Edit**
3. In **Authorization callback URLs**, enter all URLs you need:
   ```
   http://localhost:8788/api/auth/callback
   http://localhost:5173/api/auth/callback
   https://your-production-domain.com/api/auth/callback
   https://www.your-production-domain.com/api/auth/callback
   ```

4. Save changes

> ✅ **Each URL must be listed exactly** (no wildcards like `https://*.yourdomain.com`)

### 2. Initialize D1 Database

```bash
cd web

# Create local D1 database
pnpm wrangler d1 create mirrorpilot --local

# Apply migrations
pnpm wrangler d1 migrations apply mirrorpilot --local
```

### 3. Configure .dev.vars

Start from template:

```bash
cp .dev.vars.example .dev.vars
```

Update `.dev.vars` with your local credentials:

```bash
DEV_USER_EMAIL=dev@localhost
GITHUB_CLIENT_ID=YOUR_CLIENT_ID_FROM_STEP_1
GITHUB_CLIENT_SECRET=YOUR_CLIENT_SECRET_FROM_STEP_1
GITHUB_TOKEN=YOUR_PERSONAL_ACCESS_TOKEN
GITHUB_REPO=YOUR_GITHUB_USERNAME/MirrorPilot
SYNC_SECRET=your-dev-secret-here
ADMIN_EMAIL=dev@localhost
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM_ADDRESS=noreply@your-verified-domain.com
EMAIL_FROM_NAME=MirrorPilot
```

> 💡 **Tip**: If you set `DEV_USER_EMAIL=dev@localhost`, authentication will be **bypassed**
> and you'll auto-login as the dev user. Remove/comment it if you want to test GitHub OAuth flow.
> If you want to test email registration locally, keep `EMAIL_FROM_ADDRESS` on a domain verified in Resend and set `RESEND_API_KEY`.

### 4. Get GitHub Personal Access Token (PAT)

If you need `GITHUB_TOKEN` for sync operations:

1. Go to https://github.com/settings/tokens
2. Click **Generate new token** → **Generate new token (classic)**
3. Give it a name: `MirrorPilot Dev`
4. Select scope: `repo` (full control of private repositories)
5. Copy the token and paste into `.dev.vars`

## Running Local Development

### Terminal 1 - Vite Dev Server (with HMR)

```bash
cd web
pnpm dev
```

This runs Vite on http://localhost:5173 with hot module reload.

### Terminal 2 - Wrangler Pages Dev (API Functions + D1)

```bash
cd web
pnpm dev:cf
```

This runs Wrangler on http://localhost:8788:
- Serves Pages Functions (`/api/*`) + local D1
- Frontend assets and HMR are served by Vite directly on `5173`

Then visit: **http://localhost:5173**

Vite is configured to proxy `/api/*` to Wrangler (`8788`), so API calls still work while HMR stays reliable.

## Troubleshooting

For detailed OAuth troubleshooting (e.g., redirect_uri mismatch), see [OAUTH_TROUBLESHOOTING.md](./OAUTH_TROUBLESHOOTING.md).

### GitHub Client ID undefined

**Problem**: You see "undefined" for GITHUB_CLIENT_ID in the URL

**Solution**:
1. Check `.dev.vars` has `GITHUB_CLIENT_ID=...` (not just placeholder text)
2. Restart Wrangler: `pnpm dev:cf`
3. Wait 2-3 seconds for environment variables to reload
4. Hard refresh browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

### D1 Migration Errors

**Problem**: "table users has no column named is_admin" or similar migration-related errors

**Solution**:

Apply pending migrations:

```bash
cd web
pnpm wrangler d1 migrations apply mirrorpilot --local
```

This will apply any unapplied migrations to your local database.

If the above doesn't work, you may need to reset your local database:

```bash
# Delete the local D1 database
rm -rf .wrangler/state/v3/d1/mirrorpilot.sqlite3

# Recreate and apply all migrations
pnpm wrangler d1 create mirrorpilot --local
pnpm wrangler d1 migrations apply mirrorpilot --local
```

> ⚠️ **Warning**: This will delete all local data. Use only for development.

After resetting, restart Wrangler:

```bash
pnpm dev:cf
```

### CORS Issues in Local Dev

Local development uses two ports:
- Browser requests → http://localhost:5173 (Vite with HMR)
- `/api/*` from Vite → proxied to http://localhost:8788 (Wrangler Functions + D1)

If you see CORS errors:
1. Hard refresh browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
2. Clear browser cache
3. Restart both terminals

## Environment Variables Reference

| Variable | Dev Mode | Purpose |
|---|---|---|
| `DEV_USER_EMAIL` | Optional | Bypass OAuth (auto-login as dev user) |
| `GITHUB_CLIENT_ID` | Required* | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Required* | GitHub OAuth app client secret |
| `GITHUB_TOKEN` | Optional | GitHub PAT for sync operations |
| `GITHUB_REPO` | Optional | Repo identifier (owner/repo) |
| `SYNC_SECRET` | Optional | Shared secret for API auth |
| `ADMIN_EMAIL` | Optional | Make a user an admin |
| `RESEND_API_KEY` | Optional | Resend API key for registration code emails |
| `EMAIL_FROM_ADDRESS` | Optional | Verified sender used for registration codes |
| `EMAIL_FROM_NAME` | Optional | Display name for registration code emails |

*Only required if not using `DEV_USER_EMAIL`

## Quick Start Checklist

- [ ] Created GitHub OAuth App for localhost
- [ ] Updated `.dev.vars` with GITHUB_CLIENT_ID and SECRET
- [ ] Ran `pnpm wrangler d1 migrations apply mirrorpilot --local`
- [ ] Started Terminal 1: `pnpm dev`
- [ ] Started Terminal 2: `pnpm dev:cf`
- [ ] Visited http://localhost:5173
- [ ] Logged in (either via DEV_USER_EMAIL or GitHub OAuth)

## Next Steps

- Start dev servers (see "Running Local Development" above)
- Visit http://localhost:5173
- Sign in with GitHub OAuth or as dev user
- Make changes and watch HMR work!
