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

## Complete Test Script

Run this script to test the full CRUD workflow:

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

# 4. Delete
echo "4️⃣  DELETE /api/secrets/registry"
curl -s -X DELETE 'http://localhost:8788/api/secrets/registry?registry=registry.example.com' | jq .

echo ""

# 5. Verify deletion
echo "5️⃣  GET /api/secrets/registry (final)"
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

## Troubleshooting

### "unauthenticated" Error

**Problem**: API returns `{"error": "unauthenticated"}` (401)

**Solution**:
1. Check `DEV_USER_EMAIL=dev@localhost` is in `.dev.vars`
2. Restart Wrangler: `pnpm dev:cf`
3. Make sure you're hitting `localhost:8788` (not 5173)

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
