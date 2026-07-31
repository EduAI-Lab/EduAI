#!/bin/bash
# Build and (re)start the EduAI s378 dev stack.
#
# This is the deploy command. s378 serves BUILT assets — `git pull` alone no
# longer changes what the sites serve, and neither does restarting a unit.
#
#   git pull && bash infra/s378/go-live-build.sh
#
# Order is the whole point and is not negotiable:
#
#   env  ->  migrate  ->  generate  ->  BUILD  ->  restart
#
# `go-live-env.sh` rewrites the VITE_* public URLs. Those used to be read when
# the dev server started; now they are BAKED INTO THE BUNDLE at build time. Run
# the env step after the build and the sites ship the previous run's URLs.
#
# Usage:
#   bash infra/s378/go-live-build.sh                 # full deploy
#   bash infra/s378/go-live-build.sh --install       # npm install first (after a branch switch)
#   bash infra/s378/go-live-build.sh --no-env        # skip go-live-env.sh
#   bash infra/s378/go-live-build.sh --no-restart    # build only, leave units alone
#   bash infra/s378/go-live-build.sh --only aitutor  # core | aitutor | qm
#
# Env:
#   EDUAI_SKIP_QM_TSC=1   bypass Question Maker's `tsc` gate (see below)

set -euo pipefail

# Shared checkout: everything this script writes must stay group-writable, or the
# next eduai-dev member to deploy hits EACCES.
umask 0002

REPO="${EDUAI_REPO:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# THE lever. Drives both halves of "s378 is still a development environment":
#   server-side  Core's isProd gates (HSTS, strict nonce CSP) stay off.
#   client-side  Vite derives isProduction from NODE_ENV, and import.meta.env.DEV
#                is !isProduction — so the dev-only client branches survive.
# Must be exported: it has to reach the nested vite process, not just npm.
# Do NOT add `--mode development`; it was measured to be a no-op on top of this.
export NODE_ENV=development

DO_ENV=1
DO_INSTALL=0
DO_RESTART=1
ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --install)    DO_INSTALL=1 ;;
    --no-env)     DO_ENV=0 ;;
    --no-restart) DO_RESTART=0 ;;
    --only)       ONLY="${2:-}"; shift ;;
    -h|--help)    sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
step() { echo; echo "=== $* ==="; }

cd "$REPO"

# Vite picks up .env.<mode> files. Mode stays at its "production" default (only
# NODE_ENV is changed), so a stray .env.production would silently override the
# public URLs go-live-env.sh just wrote. None exist today; fail loudly if one appears.
step "preflight"
STRAY=$(find apps -maxdepth 4 -name '.env.production*' -o -maxdepth 4 -name '.env.development*' 2>/dev/null | grep -v node_modules || true)
if [ -n "$STRAY" ]; then
  echo "ERROR: unexpected mode-specific env file(s) found:"
  echo "$STRAY"
  echo "These override apps/*/.env at build time. Remove them or update this script."
  exit 1
fi
echo "no mode-specific .env files (good)"
node -v

if [ "$DO_INSTALL" = "1" ]; then
  step "npm install"
  npm install
fi

if [ "$DO_ENV" = "1" ]; then
  step "env (MUST run before the build — VITE_* values get baked in)"
  bash "$SCRIPT_DIR/go-live-env.sh"
fi

step "migrate"
# These live here rather than in the systemd units on purpose: the units use
# Restart=always, which would re-run a migration on every crash-loop iteration.
# They are also NOT in the `start` scripts the units now exec, so without this
# step a branch carrying a schema change deploys as a runtime crash.
( cd apps/core                                  && npx prisma migrate deploy )
( cd apps/extensions/ai-tutor/server            && npx prisma migrate deploy )
( cd apps/extensions/question-maker/app/backend && npx prisma migrate deploy )

step "prisma generate"
# Each schema pins its own generator `output` (#1218 / PR #1243), so these three
# write to three different packages and cannot clobber each other. Before that
# pinning, ai-tutor and question-maker both resolved to the hoisted root client
# and whichever ran last silently won — the loser's models came back `undefined`
# at runtime, which was live on s378.
( cd apps/core                                  && npx prisma generate )
( cd apps/extensions/ai-tutor/server            && npx prisma generate )
( cd apps/extensions/question-maker/app/backend && npx prisma generate )

step "assert each app resolves its OWN prisma client"
# Regression guard for the collision above. Ships with #1243; skipped with a
# warning on branches that predate it rather than failing the deploy.
if [ -f scripts/verify-prisma-client-isolation.mjs ]; then
  npm run test:prisma-client-isolation
else
  echo "  WARNING: scripts/verify-prisma-client-isolation.mjs not on this branch —"
  echo "           skipping the client-isolation check (expected before #1243 merges)."
fi

step "build"
# NEVER `turbo run build` here. turbo.json's build task declares no `inputs` and
# no `env`, so its cache hash ignores .env contents — after go-live-env.sh
# rewrites the VITE_* URLs, turbo would replay a cached bundle carrying the OLD
# URLs. That is a silent wrong answer, not just a stale-cache annoyance.
if want core; then
  step "build: core (SSR)"
  npm run build -w edu-ai
fi

if want aitutor; then
  step "build: ai-tutor (static SPA -> build/client)"
  npm run build -w ai-tutor
fi

if want qm; then
  step "build: question-maker (static SPA -> dist)"
  # QM's build is `tsc && vite build`, where tsc is a noEmit typecheck gate. A
  # type error anywhere on the deployed branch therefore blocks the QM deploy and
  # can leave dist/ half-replaced. The escape hatch skips only the typecheck.
  if [ "${EDUAI_SKIP_QM_TSC:-0}" = "1" ]; then
    echo "WARNING: skipping QM typecheck (EDUAI_SKIP_QM_TSC=1)"
    ( cd apps/extensions/question-maker/app/frontend \
        && node "$REPO/node_modules/vite/bin/vite.js" build )
  else
    npm run build -w question-maker-frontend
  fi
fi

step "verify the builds carry development semantics"
# If NODE_ENV failed to reach the bundler, the build still succeeds and still
# serves fine — it just silently drops every import.meta.env.DEV branch. These
# two markers are the cheapest reliable proof that did not happen.
QM_DIST="apps/extensions/question-maker/app/frontend/dist/assets"
if want qm && [ -d "$QM_DIST" ]; then
  if grep -rqs 'localhost:8080' "$QM_DIST"; then
    echo "  ok question-maker: import.meta.env.DEV baked true"
  else
    echo "  WARNING question-maker: DEV-only markers absent — built with production semantics."
    echo "          Check that NODE_ENV=development is exported."
  fi
fi

if [ "$DO_RESTART" = "1" ]; then
  step "restart"
  # PartOf= in each unit propagates the target restart down to the services.
  # No sudo: the polkit rule in systemd/49-eduai-dev.rules grants eduai-dev
  # members lifecycle control over eduai-* units.
  systemctl restart eduai-dev.target
  sleep 3
  systemctl --no-pager --lines=0 status eduai-dev.target || true
  for u in eduai-core eduai-aitutor-server eduai-qm-backend; do
    printf '  %-24s %s\n' "$u" "$(systemctl is-active "$u" 2>&1)"
  done
fi

echo
echo "BUILD_OK"
