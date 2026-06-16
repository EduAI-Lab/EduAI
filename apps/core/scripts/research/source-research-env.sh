#!/usr/bin/env bash
# Source .env + .env.research, stripping UTF-8 BOM from research env if present.
set -euo pipefail

CORE_DIR="${1:-.}"
cd "$CORE_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -f .env.research ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
  set +a
fi
