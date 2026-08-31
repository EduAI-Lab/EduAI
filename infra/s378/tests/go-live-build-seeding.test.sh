#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
deploy_script="$repo_root/infra/s378/go-live-build.sh"

# Match the exact fixture-seeding command. Do not treat the allowed
# `db:seed:reference` catalog seed as the fixture command because the latter
# shares the `db:seed` prefix.
if grep -Eq 'npm run db:seed([[:space:]]|$)' "$deploy_script"; then
  echo "s378 deploy must not provision Core fixture accounts" >&2
  exit 1
fi

grep -Fq 'Core fixture seeding is intentionally disabled' "$deploy_script"
grep -Fq 'npm run db:seed:reference' "$deploy_script"

echo "s378 Core fixture-seeding contract: PASS"
