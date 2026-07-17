#!/bin/bash
# Boot the full EduAICore stack and run the Playwright E2E suite.
# Exits non-zero if any test fails.
#
# Usage:
#   bash scripts/e2e-in-docker.sh
#
# To keep the stack running after the tests finish (useful for debugging):
#   bash scripts/e2e-in-docker.sh --keep-alive
#
# To open the Playwright HTML report after the run:
#   bash scripts/e2e-in-docker.sh --report

set -euo pipefail

COMPOSE_FILE="docker-compose.e2e.yml"
KEEP_ALIVE=false
SHOW_REPORT=false

for arg in "$@"; do
  case "$arg" in
    --keep-alive) KEEP_ALIVE=true ;;
    --report)     SHOW_REPORT=true ;;
  esac
done

RUNNER_EXIT=0

cleanup() {
  if [ "$KEEP_ALIVE" = false ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Tearing down E2E stack..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    docker compose -f "$COMPOSE_FILE" down -v
  else
    echo ""
    echo "Stack left running (--keep-alive). To stop it:"
    echo "  docker compose -f $COMPOSE_FILE down -v"
  fi
}

trap cleanup EXIT

# ── Build all images ──────────────────────────────────────────────────────────
# CI prebuilds the images with `docker buildx bake` (GitHub Actions layer cache) and
# sets E2E_SKIP_BUILD=1 so this script reuses them instead of rebuilding uncached.
if [ "${E2E_SKIP_BUILD:-}" = "1" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Skipping image build (E2E_SKIP_BUILD=1 — images prebuilt)."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Building E2E images..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  df -h
  docker system df
  docker compose -f "$COMPOSE_FILE" build
  df -h
  docker system df
fi

# ── Boot application stack ────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting application stack..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker compose -f "$COMPOSE_FILE" up -d \
  e2e-eduai-db \
  e2e-ai-tutor-db \
  e2e-qm-db \
  e2e-eduai-app \
  e2e-ai-tutor-server \
  e2e-ai-tutor-app \
  e2e-qm-server \
  e2e-qm-app

echo "  Waiting for all services to become healthy..."
WAIT_EXIT=0
docker compose -f "$COMPOSE_FILE" up -d --wait \
  e2e-eduai-app \
  e2e-ai-tutor-server \
  e2e-ai-tutor-app \
  e2e-qm-server \
  e2e-qm-app || WAIT_EXIT=$?

if [ "$WAIT_EXIT" -ne 0 ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Service startup failed — container logs:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  docker compose -f "$COMPOSE_FILE" logs --no-color 2>&1
  exit "$WAIT_EXIT"
fi

# ── Run Playwright ────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Running E2E tests..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# `docker compose run` streams output directly and returns the container's exit code.
# The playwright-report directory is bind-mounted in docker-compose.e2e.yml, so the
# report is written directly to the host — no docker cp needed.
docker compose -f "$COMPOSE_FILE" run --rm e2e-runner \
  || RUNNER_EXIT=$?

if [ "$SHOW_REPORT" = true ] && [ -d "./playwright-report" ]; then
  npx --yes playwright show-report ./playwright-report
fi

# ── Result ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$RUNNER_EXIT" -eq 0 ]; then
  echo "  ✅  All E2E tests passed."
else
  echo "  ❌  E2E tests failed (exit code $RUNNER_EXIT)."
  echo "      Run with --report to open the Playwright HTML report."
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit "$RUNNER_EXIT"
