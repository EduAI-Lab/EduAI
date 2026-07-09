#!/bin/bash
set -e
REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore

set_or_replace() {
  local file="$1" key="$2" val="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

CORE="$REPO/apps/core/.env"
AT_SRV="$REPO/apps/extensions/ai-tutor/server/.env"
QM="$REPO/apps/extensions/question-maker/.env"

for f in "$CORE" "$AT_SRV" "$QM"; do
  [ -f "$f" ] || { echo "MISSING $f"; exit 1; }
done

set_or_replace "$CORE" BETTER_AUTH_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$CORE" COOKIE_DOMAIN ".eduai.ok.ubc.ca"
set_or_replace "$CORE" VITE_QUESTION_MAKER_URL "https://dev.questionmaker.eduai.ok.ubc.ca"

set_or_replace "$AT_SRV" CORE_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$AT_SRV" EDUAI_BASE_URL "https://dev.eduai.ok.ubc.ca/api"

AT_FE="$REPO/apps/extensions/ai-tutor/.env"
if [ -f "$AT_FE" ]; then
  set_or_replace "$AT_FE" VITE_API_URL "https://dev.aitutor.eduai.ok.ubc.ca"
fi

set_or_replace "$QM" CORE_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$QM" EXTENSION_URL "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$QM" CORS_ORIGINS "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$QM" EDUAI_API_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_API_URL "https://dev.questionmaker.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_CORE_URL "https://dev.eduai.ok.ubc.ca"
set_or_replace "$QM" VITE_AI_TUTOR_URL "https://dev.aitutor.eduai.ok.ubc.ca"

echo ENV_OK
