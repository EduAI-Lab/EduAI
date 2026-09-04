#!/usr/bin/env bash
set +e

TARGET_ROOT="${EDUAI_PRODUCTION_ROOT:-/srv/www/eduai-production}"
LEGACY_ROOT="${EDUAI_LEGACY_ROOT:-/srv/www/my.eduai.ok.ubc.ca}"
PUBLIC_URL="${EDUAI_PUBLIC_URL:-https://my.eduai.ok.ubc.ca}"
REQUIRED_CHECK_FAILED=0
AI_TUTOR_URL="${EDUAI_AI_TUTOR_URL:-https://aitutor.eduai.ok.ubc.ca}"
QUESTION_MAKER_URL="${EDUAI_QUESTION_MAKER_URL:-https://questionmaker.eduai.ok.ubc.ca}"

ok() { printf 'OK   %s\n' "$1"; }
warn() { printf 'WARN %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; }

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1: $(command -v "$1")"
  else
    fail "$1 is not installed or not on PATH"
    REQUIRED_CHECK_FAILED=1
  fi
}

check_path() {
  if [ -e "$1" ]; then
    ok "$1 exists"
  else
    warn "$1 does not exist"
  fi
}

check_required_path() {
  if [ -f "$1" ]; then
    ok "$1 exists"
  else
    fail "$1 is missing"
    REQUIRED_CHECK_FAILED=1
  fi
}

check_service() {
  local service="$1" state
  state=$(systemctl is-active "$service" 2>/dev/null || true)
  if [ "$state" = "active" ]; then
    ok "$service: active"
  else
    fail "$service: ${state:-unavailable}"
    REQUIRED_CHECK_FAILED=1
  fi
}

check_required_port() {
  local host="$1" port="$2" label="$3"
  if command -v nc >/dev/null 2>&1 && nc -z -w 3 "$host" "$port" >/dev/null 2>&1; then
    ok "$label: $host:$port reachable"
  elif command -v timeout >/dev/null 2>&1 && timeout 3 bash -c "</dev/tcp/$host/$port" >/dev/null 2>&1; then
    ok "$label: $host:$port reachable"
  else
    fail "$label: $host:$port unavailable or blocked"
    REQUIRED_CHECK_FAILED=1
  fi
}

check_http() {
  local url="$1" label="$2"
  if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then
    ok "$label: $url"
  else
    fail "$label: $url unavailable or unhealthy"
    REQUIRED_CHECK_FAILED=1
  fi
}

check_port() {
  local host="$1" port="$2" label="$3"
  if command -v nc >/dev/null 2>&1 && nc -z -w 3 "$host" "$port" >/dev/null 2>&1; then
    ok "$label: $host:$port reachable"
  elif command -v timeout >/dev/null 2>&1 && timeout 3 bash -c "</dev/tcp/$host/$port" >/dev/null 2>&1; then
    ok "$label: $host:$port reachable"
  else
    warn "$label: $host:$port unavailable or blocked"
  fi
}

echo "EduAI Core production preflight"
echo "Host: $(hostname)"
echo "User: $(id -un)"
echo

echo "== Runtime commands =="
for command_name in git node npm curl systemctl apache2ctl setfacl; do
  check_cmd "$command_name"
done

echo
echo "== Runtime versions =="
node --version 2>/dev/null || true
npm --version 2>/dev/null || true
git --version 2>/dev/null || true

echo
echo "== Filesystem =="
check_path "$LEGACY_ROOT"
check_path "$TARGET_ROOT"
check_path /etc/eduai
check_path /etc/eduai/eduai-core.env
check_path /srv/www
df -h / 2>/dev/null || true

echo
echo "== Existing checkout =="
if [ -d "$LEGACY_ROOT/.git" ]; then
  ( cd "$LEGACY_ROOT" && git branch --show-current && git log -1 --oneline && git status --short | head -20 )
else
  warn "legacy checkout is not a Git worktree"
fi

echo
echo "== Services and listeners =="
systemctl is-active apache2 2>/dev/null || true
systemctl is-active docker 2>/dev/null || true
check_service eduai-core.service
check_service eduai-aitutor-server.service
check_service eduai-qm-backend.service
check_service eduai-cron-worker.service
ss -ltn 2>/dev/null | grep -E ':(80|443|3000|4000|5432|6379|8000|8001)\b' || true

echo
echo "== Active release artifacts =="
check_required_path "$TARGET_ROOT/current/apps/core/build/server/index.js"
check_required_path "$TARGET_ROOT/current/apps/core/node_modules/@prisma/client/index.js"
check_required_path "$TARGET_ROOT/current/apps/extensions/ai-tutor/server/node_modules/@eduai/ai-tutor-prisma-client/index.js"
check_required_path "$TARGET_ROOT/current/apps/extensions/ai-tutor/build/client/index.html"
check_required_path "$TARGET_ROOT/current/apps/extensions/question-maker/app/backend/node_modules/@eduai/question-maker-prisma-client/index.js"
check_required_path "$TARGET_ROOT/current/apps/extensions/question-maker/app/frontend/dist/index.html"
check_required_path /etc/eduai/cron.env
check_required_path /opt/eduai/cron/backup-nightly.sh

echo
echo "== Production dependencies =="
check_port 127.0.0.1 5432 "PostgreSQL"
check_port 127.0.0.1 6379 "Redis"
check_required_port 127.0.0.1 3000 "Core API"
check_required_port 127.0.0.1 4000 "AI Tutor API"
check_required_port 127.0.0.1 8000 "Question Maker API"
check_http http://127.0.0.1:3000/api/health "Core health"
check_http http://127.0.0.1:4000/api/health "AI Tutor health"
check_http http://127.0.0.1:8000/readyz "Question Maker readiness"
check_port cmps01.ok.ubc.ca 8001 "cmps01 inference"
check_port cmps02.ok.ubc.ca 8001 "cmps02 inference"
check_port cmps03.ok.ubc.ca 8001 "cmps03 inference"

echo
echo "== Public endpoint =="
curl -fsS --max-time 10 -o /dev/null -w 'HTTP %{http_code} %{url_effective}\n' "$PUBLIC_URL/" 2>/dev/null || warn "public endpoint is not healthy/reachable"
curl -fsS --max-time 10 -o /dev/null -w 'HTTP %{http_code} %{url_effective}\n' "$AI_TUTOR_URL/" 2>/dev/null || warn "AI Tutor endpoint is not healthy/reachable"
curl -fsS --max-time 10 -o /dev/null -w 'HTTP %{http_code} %{url_effective}\n' "$QUESTION_MAKER_URL/" 2>/dev/null || warn "Question Maker endpoint is not healthy/reachable"

echo
echo "Preflight complete; no files or services were changed."

if [ "$REQUIRED_CHECK_FAILED" -ne 0 ]; then
  echo "Preflight failed: one or more required checks did not pass." >&2
  exit 1
fi
