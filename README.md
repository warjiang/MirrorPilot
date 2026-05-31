# MirrorPilot

A fork-friendly image mirror repo with:
- a Go CLI (`mirrorpilot`) to manage mirror entries and sync state
- GitHub Actions to run real sync jobs in CI only
- optional migration from legacy `images.list` to YAML

## Quick start

Local `make` targets pin `GOTOOLCHAIN=go1.24.0+auto` to avoid macOS dyld issues from older Go toolchains.

1. Configure repository secrets:
   - `DEST_REGISTRY_USER`
   - `DEST_REGISTRY_PASSWORD`

   Target registry is configured in `profiles.<name>.registry` inside config file.

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

Configuration resolution has only two modes:
1. explicitly set `--config /path/to/mirrorpilot.yaml`
2. otherwise default to `~/.mirrorpilot/mirrorpilot.yaml`

Default config file path: `~/.mirrorpilot/mirrorpilot.yaml`

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

### Multiple profiles and credentials

Each profile should point to its own credential env names. During `sync`, the CLI reads `username_env/password_env` from the image's selected `profile`.

```yaml
profiles:
  default:
    registry: registry-a.example.com/team-a
    username_env: REG_A_USER
    password_env: REG_A_PASS
  team_b:
    registry: registry-b.example.com/team-b
    username_env: REG_B_USER
    password_env: REG_B_PASS
images:
  - source: nginx:1.27
    target: mirror/nginx:1.27
    profile: default
  - source: redis:7
    target: mirror/redis:7
    profile: team_b
```

Environment variables in CI/local runtime:

```bash
export REG_A_USER=xxx
export REG_A_PASS=xxx
export REG_B_USER=yyy
export REG_B_PASS=yyy
```

### Legacy migration

Legacy files are no longer auto-loaded. If you still have `images.list`, migrate explicitly:

```bash
go run ./cmd/mirrorpilot migrate --from images.list --to mirrorpilot.yaml
```

## CLI commands

- `add`: add image mapping
- `remove`: remove mapping(s)
- `mark`: set `synced` state manually
- `list`: list entries (`--all`, `--pending`, `--synced`)
- `synced`: list synced image records from `synced_images`
- `search`: full-screen table TUI (`/` to enter vim-like search mode)
- `validate`: validate config
- `migrate`: convert `images.list` to YAML
- `sync`: execute actual mirror sync (CI only)
- `remote set`: set remote repo configuration (`repo_url/ref/config_path`)
- `remote fetch`: fetch remote image list and merge into local config
- `remote check`: verify remote repo read/write readiness
- `remote push-config`: commit and push local config to remote repo

`add` / `list` / `mark` / `remove` / `search` / `synced` require a configured remote repository. Configure it first with `remote set`.

`remote.ref` defaults to `main` and `remote.config_path` defaults to `mirrorpilot.yaml` when omitted.

Examples:

```bash
go run ./cmd/mirrorpilot remote set --repo-url https://github.com/warjiang/MirrorPilot.git --ref main --config-path mirrorpilot.yaml
go run ./cmd/mirrorpilot remote fetch --merge
go run ./cmd/mirrorpilot remote check
go run ./cmd/mirrorpilot remote push-config --branch main --message "chore: sync config"
go run ./cmd/mirrorpilot search
go run ./cmd/mirrorpilot synced --output table
```

`list` and `synced` hide `full_source` and `full_target` by default. Use `--full-paths` when you want to include them.
`synced --output table` renders a bordered table layout for easier scanning in terminal.

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
