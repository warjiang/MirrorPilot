#!/usr/bin/env bash
set -euo pipefail

if [ ! -x "./bin/mirrorpilot" ]; then
  go build -o ./bin/mirrorpilot ./cmd/mirrorpilot
fi

./bin/mirrorpilot sync "$@"
