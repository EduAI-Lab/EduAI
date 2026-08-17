#!/usr/bin/env bash
# infra/cron/notify-api-key-expiry.sh
# Sends expiry-warning emails to users whose AI provider API keys expire in 7
# days. Delegates email sending to the Core app via its internal cron endpoint.
# Crontab: 0 4 * * *  (UTC)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'cron_fail "Script exited unexpectedly"' ERR
[[ -z "${CORE_CRON_RUN_ID:-}" ]] && cron_start "notify-api-key-expiry"

: "${CORE_URL:?CORE_URL must be set in cron.env}"
: "${EDUAI_API_KEY:?EDUAI_API_KEY must be set in cron.env}"

log "=== API key expiry notifications: checking for keys expiring in 7 days ==="

RESPONSE=$(curl -s -f -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer ${EDUAI_API_KEY}" \
  -H "Content-Type: application/json" \
  "${CORE_URL}/api/cron/notify-api-key-expiry")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" != "200" ]]; then
  cron_fail "Core API returned HTTP $HTTP_CODE: $BODY"
fi

NOTIFIED=$(echo "$BODY" | grep -o '"notified":[0-9]*' | grep -o '[0-9]*' || echo "0")
log "API key expiry notifications: sent $NOTIFIED email(s)"

log "=== API key expiry notifications complete ==="

if [[ -z "${CORE_CRON_RUN_ID:-}" ]]; then
  cron_finish
fi
