#!/usr/bin/env bash
# Source apps/core/.env.loadtest so k6 sees EDUAI_LOCAL_SEED_PASSWORD and
# EDUAI_API_KEY, then exec k6. npm scripts should call this instead of `k6`
# directly — otherwise login and the session-validate burst use empty secrets.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$CORE_DIR"

ENV_FILE=".env.loadtest"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

if [ -z "${EDUAI_LOCAL_SEED_PASSWORD:-}" ]; then
  echo "EDUAI_LOCAL_SEED_PASSWORD is not set. Run 'npm run loadtest:setup' first." >&2
  exit 1
fi

exec k6 run "$@"
