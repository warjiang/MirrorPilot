# sync-images

A fork-friendly image mirror repo with:
- a Go CLI (`sync-images`) to manage mirror entries and sync state
- GitHub Actions to run real sync jobs in CI only
- optional migration from legacy `images.list` to YAML

## Quick start

1. Configure repository secrets:
   - `DEST_REGISTRY` (for example `registry.cn-shanghai.aliyuncs.com/<namespace>`)
   - `DEST_REGISTRY_USER`
   - `DEST_REGISTRY_PASSWORD`

2. Validate config:

```bash
go run ./cmd/sync-images validate
```

3. Manage entries with CLI:

```bash
go run ./cmd/sync-images add --source nginx:1.27 --target mirror/nginx:1.27
go run ./cmd/sync-images list --all
```

4. Push to `main` to trigger CI sync. CI calls CLI `sync` and commits status updates back to `sync-images.yaml`.

## Config

Primary config file: `sync-images.yaml`

```yaml
version: v1
profiles:
  default:
    registry: registry.cn-shanghai.aliyuncs.com/your-namespace
    username_env: DEST_REGISTRY_USER
    password_env: DEST_REGISTRY_PASSWORD
images:
  - source: nginx:1.27
    target: mirror/nginx:1.27
    profile: default
    enabled: true
    synced: false
```

### Legacy compatibility

If `sync-images.yaml` does not exist, CLI reads legacy `images.list`.
You can migrate with:

```bash
go run ./cmd/sync-images migrate --from images.list --to sync-images.yaml
```

## CLI commands

- `add`: add image mapping
- `remove`: remove mapping(s)
- `mark`: set `synced` state manually
- `list`: list entries (`--all`, `--pending`, `--synced`)
- `validate`: validate config
- `migrate`: convert `images.list` to YAML
- `sync`: execute actual mirror sync (CI only)

`sync` is restricted to CI (`CI=true`) so real sync work stays in remote workflow.

## CI behavior

- `push` to `main`: incremental sync (only `enabled=true && synced=false`)
- sync workflow downloads and runs released CLI binary from GitHub Releases (does not build from source)
- `workflow_dispatch` with `resync_all=true`: full re-sync (`--all`)
- `workflow_dispatch` supports `cli_version` to pin a specific released CLI tag; empty means latest release
- after successful sync, CI updates `synced/last_synced_at` and commits back with `[skip ci]`

## Release CLI

Tag a version to publish binaries with GoReleaser:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Artifacts are uploaded to GitHub Releases for Linux/macOS/Windows.
