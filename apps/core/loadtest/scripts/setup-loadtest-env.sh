#!/usr/bin/env bash
# Provisions the isolated DB + demo dataset for the #919 stress harness.
# Safe to re-run — migrate/seed are idempotent (seed.ts uses upsert).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

ENV_FILE="apps/core/.env.loadtest"
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating $ENV_FILE from example (fill in secrets)..."
  cp apps/core/loadtest/.env.loadtest.example "$ENV_FILE"
  sed -i.bak "s|BETTER_AUTH_SECRET=\"\"|BETTER_AUTH_SECRET=\"$(openssl rand -base64 32)\"|" "$ENV_FILE"
  sed -i.bak "s|ENCRYPTION_KEY=\"\"|ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DB_NAME=$(echo "$DATABASE_URL" | sed -E 's#.*/([a-zA-Z0-9_]+)\?.*#\1#')
DB_CONTAINER="${LOADTEST_DB_CONTAINER:-eduai-db}"

echo "==> Ensuring database '$DB_NAME' exists in container '$DB_CONTAINER'..."
if ! docker exec "$DB_CONTAINER" psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  docker exec "$DB_CONTAINER" psql -U postgres -c "CREATE DATABASE $DB_NAME"
fi

cd apps/core

echo "==> Generating Prisma client..."
npx prisma generate

echo "==> Applying migrations..."
npx prisma migrate deploy

echo "==> Seeding demo dataset (students 1-5, DATA 310, etc.)..."
npx tsx prisma/seed.ts

echo "==> Done. Demo login: student1@eduai.local / EduAI2026! (see loadtest/README.md)"
