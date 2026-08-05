#!/usr/bin/env bash
set -euo pipefail

branch="${1:-}"
actor="${2:-unknown Discord user}"
repo="${EDUAI_REPO:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore}"

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

# s378 serves pre-built bundles from group-owned system units (see PR #1285) —
# `npm run dev` is no longer what's running. go-live-build.sh is the source of
# truth for env/generate/migrate/seed/build/restart order; branches that predate
# that migration have no way to serve correctly under the units already
# installed on this box, so fail loudly instead of limping through a stale build.
if [[ ! -f infra/s378/go-live-build.sh ]]; then
  echo "Refusing to deploy: infra/s378/go-live-build.sh is missing on $branch." >&2
  echo "The live systemd units serve a pre-built bundle, not 'npm run dev', so" >&2
  echo "branches without the s378 build-serve migration (see PR #1285) cannot" >&2
  echo "be deployed correctly on this box yet." >&2
  exit 7
fi

echo "Building and restarting via go-live-build.sh..."
bash infra/s378/go-live-build.sh

echo "Deployment complete: $branch@$(git rev-parse --short=8 HEAD)"
