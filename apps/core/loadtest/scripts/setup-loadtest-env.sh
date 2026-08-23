#!/usr/bin/env bash
# Provisions the isolated DB + demo dataset for the #919 stress harness.
# Safe to re-run — migrate/seed are idempotent (seed.ts uses upsert).
set -euo pipefail
# This file lives at apps/core/loadtest/scripts/. npm invokes it with a relative
# BASH_SOURCE, so resolve to an absolute path before cd'ing.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$CORE_DIR"

ENV_FILE=".env.loadtest"
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating apps/core/$ENV_FILE from example (fill in secrets)..."
  cp loadtest/.env.loadtest.example "$ENV_FILE"
  sed -i.bak "s|BETTER_AUTH_SECRET=\"\"|BETTER_AUTH_SECRET=\"$(openssl rand -base64 32)\"|" "$ENV_FILE"
  sed -i.bak "s|ENCRYPTION_KEY=\"\"|ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
fi

ensure_local_seed_password() {
  if grep -qE '^EDUAI_LOCAL_SEED_PASSWORD="[^"]+"' "$ENV_FILE"; then
    return
  fi
  local pw
  pw="$(openssl rand -base64 24)"
  if grep -qE '^EDUAI_LOCAL_SEED_PASSWORD=' "$ENV_FILE"; then
    sed -i.bak "s|^EDUAI_LOCAL_SEED_PASSWORD=.*|EDUAI_LOCAL_SEED_PASSWORD=\"${pw}\"|" "$ENV_FILE"
  else
    printf '\nEDUAI_LOCAL_SEED_PASSWORD="%s"\n' "$pw" >> "$ENV_FILE"
  fi
  rm -f "$ENV_FILE.bak"
}

ensure_local_seed_password

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${EDUAI_LOCAL_SEED_PASSWORD:-}" ]; then
  echo "EDUAI_LOCAL_SEED_PASSWORD is empty after setup." >&2
  exit 1
fi

# prisma/seed.ts and the VU seeder refuse NODE_ENV=production. The app runtime
# stays production (this file); fixture writes get an explicit local-demo
# contract for this process only.
run_loadtest_fixture() {
  NODE_ENV=development \
    EDUAI_DEPLOYMENT_MODE=local \
    EDUAI_ENABLE_LOCAL_DEMO=true \
    BETTER_AUTH_URL="${BETTER_AUTH_URL:?BETTER_AUTH_URL is required}" \
    EDUAI_LOCAL_SEED_PASSWORD="${EDUAI_LOCAL_SEED_PASSWORD:?EDUAI_LOCAL_SEED_PASSWORD is required}" \
    "$@"
}

DB_NAME=$(echo "$DATABASE_URL" | sed -E 's#.*/([a-zA-Z0-9_]+)\?.*#\1#')
DB_CONTAINER="${LOADTEST_DB_CONTAINER:-eduai-db}"

echo "==> Ensuring database '$DB_NAME' exists in container '$DB_CONTAINER'..."
if ! docker exec "$DB_CONTAINER" psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  docker exec "$DB_CONTAINER" psql -U postgres -c "CREATE DATABASE $DB_NAME"
fi

echo "==> Generating Prisma client..."
npx prisma generate

echo "==> Applying migrations..."
npx prisma migrate deploy

echo "==> Seeding demo dataset (fixture-only local-demo contract; app runtime stays production)..."
run_loadtest_fixture npx tsx prisma/seed.ts

echo "==> Seeding one password-backed student per VU (default 500)..."
LOADTEST_VUS="${LOADTEST_VUS:-500}" run_loadtest_fixture npx tsx loadtest/scripts/seed-loadtest-users.ts

echo "==> Done. Demo + VU logins use EDUAI_LOCAL_SEED_PASSWORD from apps/core/.env.loadtest"
echo "==> Unique VU logins: loadtest.vu-001@eduai.local … loadtest.vu-${LOADTEST_VUS:-500}@eduai.local"
echo "==> See loadtest/README.md"
