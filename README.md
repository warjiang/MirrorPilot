# MirrorPilot

MirrorPilot is a fork-friendly container image mirror toolkit with:
- a Go CLI (`mirrorpilot`) for staged mirror config management
- a Web app (`web/`) on Cloudflare Pages for mirror operations and sync triggering
- GitHub Actions workflows for CI checks, sync jobs, and CLI releases

## At a glance

| Use case | Use this |
|---|---|
| Manage image mappings in repo config | CLI (`mirrorpilot`) |
| Operate mirrors from browser UI | Web app (`web/`) |
| Run actual image sync in automation | GitHub Actions (`sync-images.yml`, `web-sync.yml`) |

## 5-minute CLI quick start

> Local `make` targets pin `GOTOOLCHAIN=go1.24.0+auto` to avoid macOS dyld issues.

1. Validate config:

```bash
go run ./cmd/mirrorpilot validate
```

2. Configure remote repo once (required before `add`, `delete`, `search`):

```bash
go run ./cmd/mirrorpilot remote set \
  --repo-url https://github.com/<owner>/<repo>.git \
  --ref main \
  --config-path mirrorpilot.yaml
```

3. Stage changes and inspect status:

```bash
go run ./cmd/mirrorpilot add --source nginx:1.27
go run ./cmd/mirrorpilot status
go run ./cmd/mirrorpilot search
```

4. Push staged config changes to remote:

```bash
go run ./cmd/mirrorpilot remote push-config --branch main --message "chore: sync config"
```

## Config model

Config resolution mode:
1. `--config /path/to/mirrorpilot.yaml`
2. default `~/.mirrorpilot/mirrorpilot.yaml`

Minimal config example:

```yaml
version: v1
profiles:
  default:
    registry: registry.example.com/your-namespace
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
pending_changes: []
synced_images: []
```

Notes:
- `add`/`delete` stage into `pending_changes`; they do not directly mutate `images`.
- `remote push-config` applies staged changes onto latest remote config and pushes.
- `sync` is CI-only and is blocked locally unless `CI=true`.

## Day-to-day CLI commands

```bash
go run ./cmd/mirrorpilot validate
go run ./cmd/mirrorpilot add --source redis:7 --profile default
go run ./cmd/mirrorpilot delete --source redis:7 --profile default
go run ./cmd/mirrorpilot status --output table
go run ./cmd/mirrorpilot remote fetch --merge
go run ./cmd/mirrorpilot remote check
go run ./cmd/mirrorpilot remote push-config --dry-run
go run ./cmd/mirrorpilot version
```

## Web app

For web setup, local development, and deployment, see:
- `web/README.md`
- `web/LOCAL_DEVELOPMENT.md`
- `web/OAUTH_TROUBLESHOOTING.md`
- `web/API_TESTING.md`

## CI and release workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | PRs + push to `main` | Go vet/test/build + web lint/typecheck/build |
| `sync-images.yml` | push to `main`, manual | Validate config and run CLI sync; commit sync status with `[skip ci]` |
| `web-sync.yml` | `repository_dispatch` (`web-sync`) | Sync images triggered by web UI job events |
| `deploy-pages.yml` | push to `main` on `web/**` | Build web app, apply D1 migrations, deploy Pages |
| `auto-release.yml` | push to `main` on Go/release files, manual | Compute semantic bump and publish CLI via GoReleaser |
| `release.yml` | pushed `v*` tag | Manual tag-based CLI release via GoReleaser |

## Build and test locally

```bash
make tidy
make lint
make test
make build
```

## Repo docs

- `DESIGN.md`: web UI visual system and design rules
- `PRODUCT.md`: product positioning and UX principles
