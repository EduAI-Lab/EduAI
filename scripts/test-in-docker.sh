#!/bin/bash
# Run the EduAICore unit + integration test suite inside Docker.
# Exits non-zero if any suite fails.
#
# Usage:
#   bash scripts/test-in-docker.sh                          # all suites
#   bash scripts/test-in-docker.sh unit                     # all unit suites
#   bash scripts/test-in-docker.sh integration              # all integration suites
#   bash scripts/test-in-docker.sh eduai-unit-tests         # one suite by name
#   bash scripts/test-in-docker.sh eduai-unit-tests ai-tutor-app-unit-tests

set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"

UNIT_SUITES=(
  eduai-unit-tests
  ai-tutor-app-unit-tests
  ai-tutor-server-unit-tests
  qm-app-unit-tests
  qm-server-unit-tests
)

INTEGRATION_SUITES=(
  eduai-integration-tests
  ai-tutor-app-integration-tests
  ai-tutor-server-integration-tests
  qm-app-integration-tests
  qm-server-integration-tests
)

ALL_SUITES=("${UNIT_SUITES[@]}" "${INTEGRATION_SUITES[@]}")

# Expand group keywords; fall back to all suites if no args given
SUITES=()
for arg in "${@:-all}"; do
  case "$arg" in
    unit)        SUITES+=("${UNIT_SUITES[@]}") ;;
    integration) SUITES+=("${INTEGRATION_SUITES[@]}") ;;
    all)         SUITES=("${ALL_SUITES[@]}"); break ;;
    *)           SUITES+=("$arg") ;;
  esac
done

PASS=()
FAIL=()

# ── Build all images in parallel ─────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Building test images..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker compose -f "$COMPOSE_FILE" build --parallel

# ── Start databases upfront (runner services declare depends_on health checks,
#    so `docker compose run` handles wait logic automatically. Starting them
#    here avoids repeated cold-start latency when suites share a database.) ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting infrastructure..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker compose -f "$COMPOSE_FILE" up -d \
  eduai-test-db \
  ai-tutor-server-test-db \
  ai-tutor-frontend-test-db \
  question-maker-test-db

# ── Run each suite ────────────────────────────────────────────────────────────
for suite in "${SUITES[@]}"; do
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ▶  $suite"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # `docker compose run --rm` starts declared dependencies (e.g. the AI Tutor
  # integration server) and removes the test container on exit.
  if docker compose -f "$COMPOSE_FILE" run --rm "$suite"; then
    PASS+=("$suite")
    echo "  ✅  $suite passed"
  else
    FAIL+=("$suite")
    echo "  ❌  $suite FAILED"
  fi
done

# ── Tear down all containers ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cleaning up..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker compose -f "$COMPOSE_FILE" down

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for suite in "${PASS[@]+"${PASS[@]}"}"; do
  echo "  ✅  $suite"
done

for suite in "${FAIL[@]+"${FAIL[@]}"}"; do
  echo "  ❌  $suite"
done

echo ""

if [ ${#FAIL[@]} -gt 0 ]; then
  echo "  ${#FAIL[@]} suite(s) failed."
  exit 1
fi

echo "  All ${#PASS[@]} suite(s) passed."
exit 0
