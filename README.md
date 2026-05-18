# MirrorPilot

A fork-friendly image mirror repo with:
- a Go CLI (`mirrorpilot`) to manage mirror entries and sync state
- GitHub Actions to run real sync jobs in CI only
- optional migration from legacy `images.list` to YAML

## Quick start

1. Configure repository secrets:
   - `DEST_REGISTRY` (for example `registry.cn-shanghai.aliyuncs.com/<namespace>`)
   - `DEST_REGISTRY_USER`
   - `DEST_REGISTRY_PASSWORD`

2. Validate config:

```bash
go run ./cmd/mirrorpilot validate
```

3. Manage entries with CLI:

```bash
go run ./cmd/mirrorpilot add --source nginx:1.27 --target mirror/nginx:1.27
go run ./cmd/mirrorpilot list --all
```

4. Push to `main` to trigger CI sync. CI calls CLI `sync` and commits status updates back to config YAML.

## Config

Primary config file: `mirrorpilot.yaml`

```yaml
version: v1
profiles:
  default:
    registry: registry.cn-shanghai.aliyuncs.com/your-namespace
    username_env: DEST_REGISTRY_USER
    password_env: DEST_REGISTRY_PASSWORD
remote:
  repo_url: https://github.com/example-org/example-repo.git
  ref: main
  config_path: mirrorpilot.yaml
images:
  - source: nginx:1.27
    target: mirror/nginx:1.27
    profile: default
    enabled: true
    created_at: 2026-05-18T00:00:00Z
    synced: false
    synced_at: ""
synced_images: []
```

### Legacy compatibility

If `mirrorpilot.yaml` does not exist, CLI falls back to legacy `sync-images.yaml`, then `images.list`.
You can migrate with:

```bash
go run ./cmd/mirrorpilot migrate --from images.list --to mirrorpilot.yaml
```

## CLI commands

- `add`: add image mapping
- `remove`: remove mapping(s)
- `mark`: set `synced` state manually
- `list`: list entries (`--all`, `--pending`, `--synced`)
- `synced`: list synced image records from `synced_images`
- `validate`: validate config
- `migrate`: convert `images.list` to YAML
- `sync`: execute actual mirror sync (CI only)
- `remote set`: set remote repo configuration (`repo_url/ref/config_path`)
- `remote fetch`: fetch remote image list and merge into local config

Examples:

```bash
go run ./cmd/mirrorpilot remote set --repo-url https://github.com/warjiang/MirrorPilot.git --ref main --config-path mirrorpilot.yaml
go run ./cmd/mirrorpilot remote fetch --merge
go run ./cmd/mirrorpilot synced --output table
```

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
