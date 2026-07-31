#!/usr/bin/env bash
set -euo pipefail

branch="${1:-}"
actor="${2:-unknown Discord user}"
repo="${EDUAI_REPO:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore}"
health_url="${EDUAI_HEALTH_URL:-http://127.0.0.1:3000/}"

if [[ -z "$branch" ]]; then
  echo "Usage: deploy-branch.sh <branch> [actor]" >&2
  exit 2
fi

cd "$repo"

exec 9>".git/discord-dev-deploy.lock"
if ! flock -n 9; then
  echo "Another deployment holds .git/discord-dev-deploy.lock" >&2
  exit 3
fi

git check-ref-format --branch "$branch" >/dev/null

# package-lock.json is routinely rewritten by `npm ci` from the previous deploy;
# discard drift here since the upcoming checkout + npm ci will overwrite it anyway.
git checkout -- package-lock.json 2>/dev/null || true

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Refusing to deploy: the shared checkout has uncommitted or untracked files." >&2
  git status --short >&2
  exit 4
fi

echo "Requested by: $actor"
echo "Fetching origin..."
git fetch --prune origin

remote_ref="refs/remotes/origin/$branch"
if ! git show-ref --verify --quiet "$remote_ref"; then
  echo "Remote branch origin/$branch does not exist." >&2
  exit 5
fi

target_sha="$(git rev-parse "$remote_ref")"
echo "Checking out origin/$branch at $target_sha..."
git checkout -B "$branch" "$remote_ref"

echo "Installing the exact locked dependencies..."
npm ci

echo "Starting the Core development database..."
npm run docker:dev:db:eduai

echo "Generating the Prisma client and applying migrations..."
(
  cd apps/core
  npx prisma generate
  npx prisma migrate deploy
)

echo "Restarting the shared development services..."
systemctl --user restart eduai-dev.target

echo "Waiting for Core health check: $health_url"
healthy=0
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" -ne 1 ]]; then
  echo "Branch changed, but the Core health check did not pass within 60 seconds." >&2
  systemctl --user --no-pager status eduai-core.service >&2 || true
  exit 6
fi

echo "Deployment complete: $branch@$(git rev-parse --short=8 HEAD)"
