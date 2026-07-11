#!/bin/bash
# Apply public-URL + shared-service-key env for Core + extensions on s378.
# Safe to re-run. Does not print secret values.
set -euo pipefail
REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore

set_or_replace() {
  local file="$1" key="$2" val="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Escape & and \ for sed replacement; keep value otherwise literal.
    local escaped
    escaped=$(printf '%s' "$val" | sed -e 's/[&\\]/\\&/g')
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

# Read KEY=value from an env file (strips surrounding quotes). Empty if unset.
read_env() {
  local file="$1" key="$2"
  local line val
  line=$(grep "^${key}=" "$file" 2>/dev/null | head -1 || true)
  [ -n "$line" ] || { echo ""; return; }
  val="${line#*=}"
  val="${val%\"}"
  val="${val#\"}"
  printf '%s' "$val"
}

CORE="$REPO/apps/core/.env"
AT_SRV="$REPO/apps/extensions/ai-tutor/server/.env"
AT_FE="$REPO/apps/extensions/ai-tutor/.env"
QM="$REPO/apps/extensions/question-maker/.env"

for f in "$CORE" "$AT_SRV" "$QM"; do
  [ -f "$f" ] || { echo "MISSING $f"; exit 1; }
done

# Shared service key: Core is source of truth. Extensions must match exactly
# or topic sync / reconcile / question generation get INVALID_SERVICE_KEY.
SERVICE_KEY=$(read_env "$CORE" EDUAI_API_KEY)
if [ -z "$SERVICE_KEY" ] || [ "$SERVICE_KEY" = "your-eduai-api-key-here" ]; then
  echo "ERROR: apps/core/.env EDUAI_API_KEY is empty or still a placeholder."
  echo "Generate one (openssl rand -hex 32), set it in Core .env, then re-run."
  exit 1
fi

# Core — public URLs for app switcher + shared cookie
set_or_replace "$CORE" BETTER_AUTH_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$CORE" COOKIE_DOMAIN ".eduai.ok.ubc.ca"
set_or_replace "$CORE" VITE_EDUAI_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$CORE" VITE_AI_TUTOR_URL "https://dev.aitutor.eduai.ok.ubc.ca"
set_or_replace "$CORE" VITE_QUESTION_MAKER_URL "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$CORE" VITE_COOKIE_DOMAIN ".eduai.ok.ubc.ca"
# Core → extension cascade-delete targets (#802)
set_or_replace "$CORE" QM_BACKEND_URL "http://127.0.0.1:8000"
set_or_replace "$CORE" AI_TUTOR_SERVER_URL "http://127.0.0.1:4000"

# AI Tutor server — Core session + service-key API
set_or_replace "$AT_SRV" CORE_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$AT_SRV" EDUAI_BASE_URL "https://dev.eduai.ok.ubc.ca/api"
set_or_replace "$AT_SRV" EDUAI_API_KEY "$SERVICE_KEY"

# AI Tutor frontend (Vite reads apps/extensions/ai-tutor/.env)
touch "$AT_FE"
set_or_replace "$AT_FE" VITE_API_URL "https://dev.aitutor.eduai.ok.ubc.ca"
set_or_replace "$AT_FE" VITE_CORE_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$AT_FE" VITE_EDUAI_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$AT_FE" VITE_AI_TUTOR_URL "https://dev.aitutor.eduai.ok.ubc.ca"
set_or_replace "$AT_FE" VITE_QUESTION_MAKER_URL "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$AT_FE" VITE_COOKIE_DOMAIN ".eduai.ok.ubc.ca"

# Question Maker — public origin; axios paths already include /api/...
set_or_replace "$QM" CORE_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$QM" EXTENSION_URL "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$QM" CORS_ORIGINS "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$QM" EDUAI_API_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$QM" EDUAI_API_KEY "$SERVICE_KEY"
set_or_replace "$QM" VITE_API_URL "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_CORE_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_EDUAI_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_AI_TUTOR_URL "https://dev.aitutor.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_QUESTION_MAKER_URL "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_COOKIE_DOMAIN ".eduai.ok.ubc.ca"

echo "ENV_OK (EDUAI_API_KEY synced Core → AI Tutor + Question Maker, len=${#SERVICE_KEY})"
