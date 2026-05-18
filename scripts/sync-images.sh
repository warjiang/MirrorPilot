#!/usr/bin/env bash
set -euo pipefail

go run ./cmd/sync-images sync "$@"
