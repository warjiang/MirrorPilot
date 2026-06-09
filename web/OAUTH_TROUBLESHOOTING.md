# GitHub OAuth Troubleshooting

## Common OAuth Errors

### "The redirect_uri is not associated with this application"

**Cause**: The callback URL in your request doesn't match any of the authorized URLs in your GitHub OAuth App settings.

**Solution**:

1. **Check your current redirect URI**
   - If using local dev: `http://localhost:8788/api/auth/callback`
   - If using Vite dev: `http://localhost:5173/api/auth/callback`
   - If in production: `https://your-domain.com/api/auth/callback`

2. **Add it to GitHub OAuth App**
   - Go to https://github.com/settings/developers
   - Click your OAuth App
   - Click **Edit**
   - Scroll to **Authorization callback URLs**
   - Add your URL (if not already there)
   - Save

3. **Common callback URLs to add**
   ```
   http://localhost:8788/api/auth/callback
   http://localhost:5173/api/auth/callback
   https://your-domain.com/api/auth/callback
   https://www.your-domain.com/api/auth/callback
   https://your-preview.pages.dev/api/auth/callback
   ```

### "GitHub Client ID is undefined"

**Cause**: Environment variables not loaded in `.dev.vars`

**Solution**:

1. Check `.dev.vars` has `GITHUB_CLIENT_ID=your-id` (not just placeholder text)
2. Restart Wrangler: `pnpm dev:cf`
3. Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)
4. Check Wrangler console output for environment variable errors

### "Invalid Client ID"

**Cause**: The GITHUB_CLIENT_ID in your `.dev.vars` is wrong or from a different app

**Solution**:

1. Go to https://github.com/settings/developers
2. Click your OAuth App
3. Copy the correct **Client ID**
4. Update `.dev.vars`: `GITHUB_CLIENT_ID=paste-here`
5. Restart Wrangler and refresh browser

## GitHub OAuth App Management

### One App for All Environments

GitHub OAuth Apps support **multiple callback URLs**. You can use a **single app** for:
- ✅ Local development (localhost:8788)
- ✅ Local Vite dev (localhost:5173)
- ✅ Preview/staging deployments
- ✅ Production domains

Simply list all URLs in the **Authorization callback URLs** field (one per line).

### Multiple Apps (Advanced)

If you prefer separate apps for different environments:

1. **Local App**
   - Callback: `http://localhost:8788/api/auth/callback`
   - Callback: `http://localhost:5173/api/auth/callback`

2. **Staging App**
   - Callback: `https://staging.yourdomain.com/api/auth/callback`

3. **Production App**
   - Callback: `https://yourdomain.com/api/auth/callback`

> Then use environment-specific `.dev.vars` / `wrangler.toml` for each app.

## Testing the OAuth Flow

### Step-by-step verification

1. **Start dev servers**
   ```bash
   # Terminal 1
   cd web && pnpm dev
   
   # Terminal 2
   cd web && pnpm dev:cf
   ```

2. **Visit the app**
   - Go to http://localhost:8788
   - Click "Sign in with GitHub"
   - You should be redirected to: `https://github.com/login/oauth/authorize?...`

3. **Verify parameters**
   - Check the URL contains your `GITHUB_CLIENT_ID`
   - Check the `redirect_uri` parameter matches one of your authorized callbacks
   - Example: `redirect_uri=http%3A%2F%2Flocalhost%3A8788%2Fapi%2Fauth%2Fcallback`

4. **Authorize**
   - Click "Authorize" on GitHub
   - Should redirect back to your app
   - You should see user info if successful

### Debugging with Browser DevTools

1. Open DevTools (F12 or Cmd+Option+I)
2. Go to **Network** tab
3. Click "Sign in with GitHub"
4. Look for requests to:
   - `github.com/login/oauth/authorize` (should show redirect parameters)
   - `api/auth/callback` (should be POST to your app)
5. Check Network → click request → **Headers** to see actual parameters

## Still Having Issues?

1. **Check the exact error message** - GitHub usually tells you which URL it's expecting
2. **Verify .dev.vars** - Make sure `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set
3. **Restart everything** - Stop Wrangler and Vite, then restart
4. **Clear browser cache** - DevTools → Settings → Network tab → Check "Disable cache"
5. **Check Wrangler logs** - Look for errors in the terminal running `pnpm dev:cf`

## OAuth Security Notes

- Never commit `.dev.vars` to git (it's in `.gitignore`)
- Don't share your `GITHUB_CLIENT_SECRET` publicly
- Use HTTPS in production (not HTTP)
- Keep callback URLs specific - don't use overly permissive patterns
- Rotate secrets regularly
