# Registry Secrets API Testing Guide

## Local Development Testing

When `DEV_USER_EMAIL=dev@localhost` is set in `.dev.vars`, the registry secrets API endpoints support automatic authentication. This makes local testing and development much easier.

### Quick Test

```bash
# List all registry secrets
curl http://localhost:8788/api/secrets/registry

# Create a new secret
curl -X POST http://localhost:8788/api/secrets/registry \
  -H 'Content-Type: application/json' \
  -d '{
    "registry": "registry.example.com",
    "destUser": "username",
    "destPass": "password"
  }'

# Delete a secret
curl -X DELETE 'http://localhost:8788/api/secrets/registry?registry=registry.example.com'
```

## Check Registry Connection

Test if a registry is reachable and credentials are valid:

```bash
# Check with auto-loaded credentials (if saved)
curl -X POST http://localhost:8788/api/check-registry \
  -H 'Content-Type: application/json' \
  -d '{
    "registry": "registry.example.com"
  }'

# Check with custom credentials (override saved ones)
curl -X POST http://localhost:8788/api/check-registry \
  -H 'Content-Type: application/json' \
  -d '{
    "registry": "registry.example.com",
    "username": "testuser",
    "password": "testpass"
  }'
```

## Complete Test Script

Run this script to test the full CRUD workflow plus registry validation:

```bash
#!/bin/bash

echo "Testing Registry Secrets API..."

# 1. List (should be empty initially)
echo "1️⃣  GET /api/secrets/registry"
curl -s http://localhost:8788/api/secrets/registry | jq .

echo ""

# 2. Create
echo "2️⃣  POST /api/secrets/registry"
curl -s -X POST http://localhost:8788/api/secrets/registry \
  -H 'Content-Type: application/json' \
  -d '{
    "registry": "registry.example.com",
    "destUser": "myuser",
    "destPass": "mypass123"
  }' | jq .

echo ""

# 3. Verify creation
echo "3️⃣  GET /api/secrets/registry (verify)"
curl -s http://localhost:8788/api/secrets/registry | jq .

echo ""

# 4. Check registry connection (with auto-loaded credentials)
echo "4️⃣  POST /api/check-registry (with auto-loaded credentials)"
curl -s -X POST http://localhost:8788/api/check-registry \
  -H 'Content-Type: application/json' \
  -d '{"registry":"registry.example.com"}' | jq .

echo ""

# 5. Delete
echo "5️⃣  DELETE /api/secrets/registry"
curl -s -X DELETE 'http://localhost:8788/api/secrets/registry?registry=registry.example.com' | jq .

echo ""

# 6. Verify deletion
echo "6️⃣  GET /api/secrets/registry (final)"
curl -s http://localhost:8788/api/secrets/registry | jq .
```

## Requirements for Testing

1. **DEV_USER_EMAIL must be set** in `.dev.vars`
   ```bash
   DEV_USER_EMAIL=dev@localhost
   ```

2. **Dev user must exist** in the local D1 database
   - First visit to the app (after login) creates the user if it doesn't exist
   - Or the user is auto-created on first API call

3. **Wrangler server must be running**
   ```bash
   pnpm dev:cf
   ```

## Expected Responses

### GET /api/secrets/registry (List)

**Success (200)**:
```json
{
  "secrets": [
    {
      "registry": "registry.example.com",
      "destUser": "myuser",
      "destPass": "***"
    }
  ]
}
```

Note: Passwords are never returned for security reasons (always "***").

### POST /api/secrets/registry (Create)

**Success (200)**:
```json
{
  "ok": true
}
```

**Validation Error (400)**:
```json
{
  "error": "registry, destUser, and destPass are required"
}
```

**Invalid Registry Format (400)**:
```json
{
  "error": "invalid registry format"
}
```

### POST /api/check-registry

**Registry unreachable (200)**:
```json
{
  "reachable": {
    "ok": false,
    "message": "connection refused"
  },
  "auth": {
    "ok": false,
    "message": "skipped (registry unreachable)"
  }
}
```

**No auth required (200)**:
```json
{
  "reachable": {
    "ok": true,
    "message": "HTTP 200"
  },
  "auth": {
    "ok": true,
    "message": "no auth required"
  }
}
```

**Auth accepted (200)**:
```json
{
  "reachable": {
    "ok": true,
    "message": "HTTP 401"
  },
  "auth": {
    "ok": true,
    "message": "credentials accepted"
  }
}
```

**Auth failed (200)**:
```json
{
  "reachable": {
    "ok": true,
    "message": "HTTP 401"
  },
  "auth": {
    "ok": false,
    "message": "auth failed (HTTP 401)"
  }
}
```

### DELETE /api/secrets/registry

**Success (200)**:
```json
{
  "ok": true
}
```

**Missing Parameter (400)**:
```json
{
  "error": "registry query parameter is required"
}
```

## Check Registry Credential Sources

When you call `/api/check-registry`, credentials are used in this priority order:

1. **Request body** - If `username` and `password` provided in the POST body, they are used first
2. **Database** - If no credentials in request, the endpoint tries to load saved credentials for that registry
3. **No credentials** - If neither are available and the registry requires auth, an error is returned

This design allows:
- **Quick testing**: Save credentials once via `/api/secrets/registry`, then just test with the registry URL
- **One-off tests**: Override saved credentials by providing custom ones in the request
- **CI/CD integration**: Use the same endpoint with explicit credentials in automation

## Troubleshooting

### "unauthenticated" Error

**Problem**: API returns `{"error": "unauthenticated"}` (401)

**Solution**:
1. Check `DEV_USER_EMAIL=dev@localhost` is in `.dev.vars`
2. Restart Wrangler: `pnpm dev:cf`
3. Make sure you're hitting `localhost:8788` (not 5173)

### "registry requires auth but no credentials provided" Error

**Problem**: Check-registry returns auth error when you expect credentials to be auto-loaded

**Causes**:
1. Credentials were never saved for that registry
2. Credentials were saved under a different registry name
3. Credentials were saved by a different user (different DEV_USER_EMAIL)

**Solutions**:
1. Verify credentials are saved: `curl http://localhost:8788/api/secrets/registry`
2. Check the exact registry name matches (case-sensitive)
3. Provide credentials explicitly in the request body

### No Secrets Showing Up

If you create a secret but don't see it in the list:

1. Make sure you're using the same `DEV_USER_EMAIL` value consistently
2. Check that D1 migrations are applied:
   ```bash
   pnpm wrangler d1 migrations apply mirrorpilot --local
   ```
3. Verify the user exists in the database:
   ```bash
   pnpm wrangler d1 execute mirrorpilot --local --command "SELECT * FROM users"
   ```

## Production vs. Local

- **Local Dev**: Uses `DEV_USER_EMAIL` for easy testing
- **Production**: Requires valid `mp_session` cookie from GitHub OAuth login
- **CI/CD**: Uses `/api/secrets/ci` endpoint with `SYNC_SECRET` authentication

Local development auth is **only active** when `DEV_USER_EMAIL` environment variable is set.
