#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
deploy_script="$repo_root/infra/s378/go-live-build.sh"

# Match the fixture-seeding commands that are forbidden on s378. Do not treat
# the allowed `db:seed:reference` catalog seed as a fixture command.
if grep -Eq 'npm run db:seed(:if-empty)?([[:space:]]|$)' "$deploy_script"; then
  echo "s378 deploy must not provision Core fixture accounts" >&2
  exit 1
fi

grep -Fq 'Core fixture seeding is intentionally disabled' "$deploy_script"
grep -Fq 'npm run db:seed:reference' "$deploy_script"

echo "s378 Core fixture-seeding contract: PASS"
