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
#   env  ->  generate  ->  migrate  ->  seed  ->  BUILD  ->  restart
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
#                                                    # (ai-tutor / question-maker also accepted)
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
    --only)
      # Without the arity check, a trailing `--only` leaves the loop with no
      # positional params and the `shift` below kills the script under set -e
      # with no message at all.
      [ $# -ge 2 ] || { echo "--only requires a value: core | aitutor | qm" >&2; exit 2; }
      ONLY="$2"; shift ;;
    -h|--help)    sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

# want() silently matches nothing on a typo, so an unvalidated --only would skip
# every build, restart the stack, and still print BUILD_OK — a deploy that
# reports success while the sites keep serving the previous branch's bundle.
#
# `ai-tutor` and `question-maker` are accepted as aliases because those are the
# directory names on disk, so they are what people type. The canonical values
# match the unit names (eduai-aitutor-server, eduai-qm-backend).
case "$ONLY" in
  ai-tutor)       ONLY=aitutor ;;
  question-maker) ONLY=qm ;;
esac
case "$ONLY" in
  ""|core|aitutor|qm) ;;
  *) echo "unknown --only target: $ONLY (expected: core | aitutor | qm)" >&2; exit 2 ;;
esac

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

step "prisma generate"
# GENERATE BEFORE MIGRATE, not after. Since #1243 each app imports its own
# generated package (`@eduai/question-maker-prisma-client`,
# `@eduai/ai-tutor-prisma-client`) rather than the hoisted root client, and those
# packages exist only once `prisma generate` has written them. Question Maker's
# db:migrate:deploy shells through scripts/baselineExistingDatabase.js, which
# imports src/config/database.js, which imports that package — so migrating first
# dies with ERR_MODULE_NOT_FOUND on any checkout that hasn't generated yet.
# Safe in this order: `generate` never touches the database, and `migrate deploy`
# never needs a client.
#
# Before #1243's pinning, ai-tutor and question-maker both resolved to the same
# root client and whichever generated last silently won — the loser's models came
# back `undefined` at runtime, which was live on s378.
( cd apps/core                                  && npx prisma generate )
( cd apps/extensions/ai-tutor/server            && npx prisma generate )
# Question Maker keeps its .env at the EXTENSION root, not next to its schema, so
# the Prisma CLI's own dotenv resolution (schema dir / cwd only) never finds
# DATABASE_URL — a bare `npx prisma generate` here dies with P1012. Its
# scripts/withPrismaEnv.js wrapper loads that file first.
( cd apps/extensions/question-maker/app/backend && npm run db:generate )

step "assert each app resolves its OWN prisma client"
# Regression guard for the collision above. Ships with #1243; skipped with a
# warning on branches that predate it rather than failing the deploy.
if [ -f scripts/verify-prisma-client-isolation.mjs ]; then
  npm run test:prisma-client-isolation
else
  echo "  WARNING: scripts/verify-prisma-client-isolation.mjs not on this branch —"
  echo "           skipping the client-isolation check (expected before #1243 merges)."
fi

step "migrate"
# These live here rather than in the systemd units on purpose: the units use
# Restart=always, which would re-run a migration on every crash-loop iteration.
# They are also NOT in the `start` scripts the units now exec, so without this
# step a branch carrying a schema change deploys as a runtime crash.
( cd apps/core                                  && npx prisma migrate deploy )
( cd apps/extensions/ai-tutor/server            && npx prisma migrate deploy )
# Same wrapper reason as the generate step above; db:migrate:deploy also runs the
# baseline script first.
( cd apps/extensions/question-maker/app/backend && npm run db:migrate:deploy )

step "seed if empty"
# The old units exec'd `npm run dev`, whose script chained `seed:if-empty` for all
# three apps. The new units exec the server directly, so without this a freshly
# reset or recreated database comes up with no AI providers and no admin user:
# every unit reports active, BUILD_OK prints, and nobody can sign in.
# All three are no-ops when the database already has rows.
( cd apps/core                                  && npm run db:seed:if-empty )
( cd apps/extensions/ai-tutor/server            && npm run seed:if-empty )
( cd apps/extensions/question-maker/app/backend && npm run seed:if-empty )

step "build"
# NEVER `turbo run build` here. turbo.json's build task declares no `inputs` and
# no `env`, so its cache hash ignores .env contents — after go-live-env.sh
# rewrites the VITE_* URLs, turbo would replay a cached bundle carrying the OLD
# URLs. That is a silent wrong answer, not just a stale-cache annoyance.
CORE_RESTARTED=0
if want core; then
  step "build: core (SSR)"
  npm run build -w edu-ai
  # Restart Core HERE, not with the rest of the stack at the end. `react-router
  # build` empties and repopulates build/client with fresh content hashes while
  # the running process still renders the OLD asset URLs off disk. Deferring the
  # restart until after the ai-tutor and QM builds (1-3 min) leaves dev.eduai
  # serving an unstyled, non-interactive shell for that whole window.
  if [ "$DO_RESTART" = "1" ]; then
    step "restart: core (closes the stale-asset window)"
    systemctl restart eduai-core.service
    CORE_RESTARTED=1
  fi
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
  # No sudo: the polkit rule in systemd/49-eduai-dev.rules grants eduai-dev
  # members lifecycle control over every eduai-* unit individually, so this does
  # not have to go through eduai-dev.target. Core is skipped when it was already
  # restarted right after its own build, above.
  # Restart only what this invocation actually rebuilt. `--only aitutor` must not
  # bounce Core: the flag exists to limit blast radius, and restarting a service
  # whose bundle did not change is a pointless outage on a shared box.
  RESTART_UNITS=()
  if want core && [ "$CORE_RESTARTED" != "1" ]; then RESTART_UNITS+=(eduai-core.service); fi
  # The cron worker imports Core server code directly, so it must restart with
  # every Core deployment even when Core itself was restarted after its build.
  if want core; then RESTART_UNITS+=(eduai-cron-worker.service); fi
  if want aitutor; then RESTART_UNITS+=(eduai-aitutor-server.service); fi
  if want qm;      then RESTART_UNITS+=(eduai-qm-backend.service); fi

  # Empty is legitimate: `--only core` already restarted Core above. Guard anyway,
  # because `systemctl restart` with no arguments is an error, not a no-op.
  if [ "${#RESTART_UNITS[@]}" -gt 0 ]; then
    systemctl restart "${RESTART_UNITS[@]}"
  else
    echo "  nothing left to restart"
  fi

  step "verify the stack is actually up"
  # `sleep 3` + `systemctl is-active` is not a health check: a unit that starts,
  # fails to reach Postgres and dies is 3s into its RestartSec=5 backoff and
  # reports `activating`, so a crash-looping stack still printed BUILD_OK.
  # Poll the listening ports instead, the way the retired go-live-systemd-start.sh
  # did, and make failure fatal. /dev/tcp avoids depending on nc/lsof.
  wait_port() {
    local name=$1 port=$2 deadline=$((SECONDS + 120))
    while [ "$SECONDS" -lt "$deadline" ]; do
      if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
        exec 3<&- 3>&-
        printf '  %-24s listening on :%s\n' "$name" "$port"
        return 0
      fi
      # A unit that has given up entirely will never open the port; say so early.
      if [ "$(systemctl is-active "$name" 2>&1)" = "failed" ]; then
        break
      fi
      sleep 2
    done
    printf '  %-24s NOT listening on :%s (%s)\n' "$name" "$port" "$(systemctl is-active "$name" 2>&1)"
    return 1
  }

  # Same scoping as the restart above. Under `--only qm` the other two units are
  # untouched, and failing the deploy because someone has Core deliberately
  # stopped would be a false alarm.
  UNHEALTHY=()
  if want core;    then wait_port eduai-core           3000 || UNHEALTHY+=(eduai-core); fi
  if want core && [ "$(systemctl is-active eduai-cron-worker.service 2>&1)" != "active" ]; then
    echo "  eduai-cron-worker        NOT active"
    UNHEALTHY+=(eduai-cron-worker)
  fi
  if want aitutor; then wait_port eduai-aitutor-server 4000 || UNHEALTHY+=(eduai-aitutor-server); fi
  if want qm;      then wait_port eduai-qm-backend     8000 || UNHEALTHY+=(eduai-qm-backend); fi

  if [ "${#UNHEALTHY[@]}" -gt 0 ]; then
    echo
    echo "DEPLOY FAILED: ${UNHEALTHY[*]} did not come up."
    for u in "${UNHEALTHY[@]}"; do
      echo "--- journalctl -u $u ---"
      journalctl -u "$u" --no-pager --lines=40 || true
    done
    exit 1
  fi
fi

echo
echo "BUILD_OK"
