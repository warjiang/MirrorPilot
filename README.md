# MirrorPilot

A fork-friendly image mirror repo with:
- a Go CLI (`mirrorpilot`) to manage staged mirror changes and remote config sync
- GitHub Actions to run sync in CI and write back sync status

## Quick start

Local `make` targets pin `GOTOOLCHAIN=go1.24.0+auto` to avoid macOS dyld issues from older Go toolchains.

1. Validate config:

```bash
go run ./cmd/mirrorpilot validate
```

2. Manage entries with CLI:

```bash
go run ./cmd/mirrorpilot add --source nginx:1.27
# or explicitly set target
go run ./cmd/mirrorpilot add --source nginx:1.27 --target mirror/nginx:1.27
go run ./cmd/mirrorpilot delete --source nginx:1.27
go run ./cmd/mirrorpilot status
go run ./cmd/mirrorpilot remote push-config --branch main --message "chore: sync config"
```

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
pending_changes: []
synced_images: []
```

### Multiple profiles and credentials

Each profile should point to its own credential env names for your downstream sync runtime.

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

## CLI commands

- `add`: stage image mapping into `pending_changes` with `action=add` (does not directly modify `images`); when `--target` is omitted, it is derived from `--source`; `--source/--target` are validated as container image references
- `delete` (`remove` alias): stage mapping deletion into `pending_changes` with `action=delete`
- `status`: show local staged status (`pending_changes` / stats)
- `search`: full-screen table TUI (`/` to enter vim-like search mode)
- `sync`: sync images to target registry (CI only)
- `validate`: validate config
- `version`: print the mirrorpilot version (injected at build time by GoReleaser)
- `remote set`: set remote repo configuration (`repo_url/ref/config_path`)
- `remote fetch`: fetch remote image list and merge into local config (`--forced` can force local to match remote)
- `remote check`: verify remote repo read/write readiness
- `remote push-config`: `--dry-run` shows staged `pending_changes`; real push applies staged deletes and adds to latest remote config, then pushes

`add` / `delete` (`remove`) / `search` require a configured remote repository. Configure it first with `remote set`.

Default target derivation for `add --source` (when `--target` is omitted):
- `ghcr.io/org/team/app:1.0.0` -> `team-app:1.0.0`
- `team/app:1.0.0` -> `team/app:1.0.0`
- `app:1.0.0` -> `app:1.0.0`

`remote.ref` defaults to `main` and `remote.config_path` defaults to `mirrorpilot.yaml` when omitted.

Examples:

```bash
go run ./cmd/mirrorpilot remote set --repo-url https://github.com/warjiang/MirrorPilot.git --ref main --config-path mirrorpilot.yaml
go run ./cmd/mirrorpilot remote fetch --merge
go run ./cmd/mirrorpilot remote fetch --merge --forced
go run ./cmd/mirrorpilot remote check
go run ./cmd/mirrorpilot remote push-config --branch main --message "chore: sync config"
go run ./cmd/mirrorpilot status --output table
go run ./cmd/mirrorpilot search
```

## CI behavior

- `pull_request` / `push` to `main`: `ci.yml` runs Go checks (`go vet`, `go test`, `go build`) and web checks (`pnpm run lint`, `pnpm run typecheck`, `pnpm run build`)
- `push` to `main` on `web/**`: `deploy-pages.yml` typechecks, builds, applies D1 migrations, and deploys to Cloudflare Pages (requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets)
- `push` to `main`: `sync-images.yml` validates config and runs `mirrorpilot sync`
- `mirrorpilot sync` is CI-only; local execution is blocked unless `CI=true`
- after successful sync, CI commits status updates back to config with `[skip ci]`

## Release CLI

### Automatic release on changes

`auto-release.yml` publishes a new CLI release automatically whenever source
code changes (`**/*.go`, `go.mod`, `go.sum`, `.goreleaser.yaml`) land on `main`.
The next version is derived from the latest `v*` tag and the commit messages
since that tag (Conventional Commits):

- `BREAKING CHANGE` / `type!:` → major bump
- `feat:` → minor bump
- anything else → patch bump

The workflow creates and pushes the new tag, then runs GoReleaser. Add
`[skip release]` to a commit message to opt out, or trigger it manually from the
Actions tab (`workflow_dispatch`) with an explicit `patch`/`minor`/`major` bump.

### Manual release by tag

You can still cut a release by pushing a tag explicitly; `release.yml` runs
GoReleaser for any pushed `v*` tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Artifacts are uploaded to GitHub Releases for Linux/macOS/Windows. Check the
built version with `mirrorpilot version`.
