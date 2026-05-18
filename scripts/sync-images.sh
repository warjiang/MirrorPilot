#!/usr/bin/env bash
set -euo pipefail

if [ ! -x "./bin/sync-images" ]; then
  go build -o ./bin/sync-images ./cmd/sync-images
fi

./bin/sync-images sync "$@"
