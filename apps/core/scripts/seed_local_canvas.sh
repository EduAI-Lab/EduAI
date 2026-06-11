#!/usr/bin/env bash
# Seed local Canvas LMS with teachers, courses, and students (EduAI dev/testing).
#
# Requires: curl, jq
#
# 1. Export CANVAS_ADMIN_TOKEN or paste into ADMIN_TOKEN below.
# 2. Run:  ./seed_local_canvas.sh
#
# Reset (default on): deletes all courses and non-admin users, then re-seeds.
#   ./seed_local_canvas.sh --no-reset    # upsert only, no wipe
#   ./seed_local_canvas.sh --reset-only  # wipe only, no seed
#
# Admin token: log in as site admin → Account → Settings → New Access Token.
# Do not commit this file with a real token in git.

set -euo pipefail

# ========== CONFIG — edit these, then run the script ==========
CANVAS_BASE_URL="${CANVAS_URL:-http://localhost:8080}"
ADMIN_TOKEN="${CANVAS_ADMIN_TOKEN:-}"
USER_PASSWORD="${CANVAS_SEED_PASSWORD:-password123}"
RESET_BEFORE_SEED=true
# ==============================================================

TEACHERS=(
  "Alex Instructor|prof1@example.com"
  "Jordan Instructor|prof2@example.com"
  "Morgan Instructor|prof3@example.com"
  "Sam Instructor|prof4@example.com"
)

STUDENTS=(
  "Student One|student1@example.com|student_1"
  "Student Two|student2@example.com|student_2"
  "Student Three|student3@example.com|student_3"
  "Student Four|student4@example.com|student_4"
  "Student Five|student5@example.com|student_5"
  "Student Six|student6@example.com|student_6"
  "Student Seven|student7@example.com|student_7"
  "Student Eight|student8@example.com|student_8"
  "Student Nine|student9@example.com|student_9"
  "Demo UBC Student|aoludare@student.ubc.ca|"
)

# name|course_code|teacher_email|student_emails (comma-separated)
COURSES=(
  "Introduction to Computer Science|COSC 101|prof1@example.com|student1@example.com,student2@example.com,student3@example.com,student4@example.com"
  "Data Structures and Algorithms|COSC 201|prof2@example.com|student2@example.com,student3@example.com,student5@example.com,student6@example.com"
  "Computation, Programs, and Programming|COSC 110|prof3@example.com|student4@example.com,student5@example.com,student7@example.com,student8@example.com"
  "Computer Programming II|COSC 121|prof4@example.com|student6@example.com,student7@example.com,student9@example.com,aoludare@student.ubc.ca"
)

DO_RESET=false
DO_SEED=true
CANVAS_URL="$CANVAS_BASE_URL"

CANVAS_HTTP_CODE=0
CANVAS_BODY=""

log() {
  printf '[seed-local-canvas] %s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_tools() {
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v jq >/dev/null 2>&1 || die "jq is required"
}

normalize_token() {
  local t="${1//[$'\t\r\n ']}"
  if [[ ${#t} -ge 2 && ( ("$t" == \"*\" && "${t: -1}" == '"') || ("$t" == \'*\' && "${t: -1}" == "'") ) ]]; then
    t="${t:1:${#t}-2}"
  fi
  printf '%s' "$t"
}

usage() {
  cat <<'EOF'
Usage: seed_local_canvas.sh [options]

Options:
  --url URL         Canvas base URL (default: CANVAS_BASE_URL / CANVAS_URL env)
  --token TOKEN     Admin API token (default: ADMIN_TOKEN / CANVAS_ADMIN_TOKEN env)
  --password PASS   Password for seeded users (default: password123)
  --reset           Delete courses and non-admin users before seeding
  --no-reset        Skip reset; upsert users/courses only
  --reset-only      Only reset, do not seed
  -h, --help        Show this help
EOF
}

should_reset() {
  if [[ "$DO_RESET_ONLY" == true ]]; then
    return 0
  fi
  if [[ "$DO_NO_RESET" == true ]]; then
    return 1
  fi
  if [[ "$DO_RESET" == true ]]; then
    return 0
  fi
  [[ "$RESET_BEFORE_SEED" == true ]]
}

parse_args() {
  DO_RESET=false
  DO_NO_RESET=false
  DO_RESET_ONLY=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url)
        CANVAS_URL="$2"
        shift 2
        ;;
      --token)
        ADMIN_TOKEN="$2"
        shift 2
        ;;
      --password)
        USER_PASSWORD="$2"
        shift 2
        ;;
      --reset)
        DO_RESET=true
        shift
        ;;
      --no-reset)
        DO_NO_RESET=true
        shift
        ;;
      --reset-only)
        DO_RESET_ONLY=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

canvas_call() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local query="${4:-}"

  local url="${CANVAS_URL%/}/api/v1${path}"
  if [[ -n "$query" ]]; then
    url="${url}?${query}"
  fi

  local tmp
  tmp="$(mktemp)"
  local http_code

  if [[ -n "$body" ]]; then
    http_code=$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${ADMIN_TOKEN}" \
      -H 'Accept: application/json' \
      -H 'Content-Type: application/json' \
      --data-binary "$body" \
      "$url")
  else
    http_code=$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${ADMIN_TOKEN}" \
      -H 'Accept: application/json' \
      "$url")
  fi

  CANVAS_HTTP_CODE="$http_code"
  CANVAS_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

canvas_get() {
  canvas_call GET "$1" "" "$2"
  if [[ "$CANVAS_HTTP_CODE" -ge 400 ]]; then
    die "GET $1 -> HTTP ${CANVAS_HTTP_CODE}: ${CANVAS_BODY}"
  fi
  printf '%s' "$CANVAS_BODY"
}

canvas_post() {
  canvas_call POST "$1" "$2" ""
  if [[ "$CANVAS_HTTP_CODE" -ge 400 ]]; then
    die "POST $1 -> HTTP ${CANVAS_HTTP_CODE}: ${CANVAS_BODY}"
  fi
  printf '%s' "$CANVAS_BODY"
}

canvas_post_soft() {
  canvas_call POST "$1" "$2" ""
}

canvas_delete_soft() {
  canvas_call DELETE "$1" "" "$2"
}

paginate() {
  local path="$1"
  local query="$2"
  local page=1
  local combined='[]'

  while true; do
    local q="per_page=100&page=${page}"
    if [[ -n "$query" ]]; then
      q="${q}&${query}"
    fi
    local batch
    batch="$(canvas_get "$path" "$q")"
    local count
    count="$(printf '%s' "$batch" | jq 'length')"
    if [[ "$count" -eq 0 ]]; then
      break
    fi
    combined="$(printf '%s\n%s' "$combined" "$batch" | jq -s 'add')"
    if [[ "$count" -lt 100 ]]; then
      break
    fi
    page=$((page + 1))
  done

  printf '%s' "$combined"
}

verify_token() {
  canvas_call GET /users/self/profile ""
  if [[ "$CANVAS_HTTP_CODE" -ge 400 ]]; then
    if [[ "$CANVAS_HTTP_CODE" == "401" ]] || printf '%s' "$CANVAS_BODY" | grep -qi 'Invalid access token'; then
      cat >&2 <<EOF
Error: Canvas rejected the access token (HTTP 401).

Check:
  1. ADMIN_TOKEN / CANVAS_ADMIN_TOKEN has no extra spaces or quotes
  2. Token was created on THIS instance: ${CANVAS_URL}
  3. Token was copied in full (format like 1234~AbCdEf...)
  4. Token was not revoked in Canvas → Settings → Approved Integrations
  5. You used the SITE ADMIN account from docker_dev_setup (not a student/teacher)

Create a new token: log in as admin → Account → Settings → Approved Integrations → + New Access Token
EOF
      exit 1
    fi
    die "GET /users/self/profile -> HTTP ${CANVAS_HTTP_CODE}: ${CANVAS_BODY}"
  fi

  local name id
  name="$(printf '%s' "$CANVAS_BODY" | jq -r '.name // .short_name // .id')"
  id="$(printf '%s' "$CANVAS_BODY" | jq -r '.id')"
  log "token ok — logged in as ${name} (user id=${id})"
}

declare -a PROTECTED_IDS=()

protected_user_ids() {
  PROTECTED_IDS=()
  local me_id
  me_id="$(printf '%s' "$(canvas_get /users/self/profile)" | jq -r '.id // empty')"
  if [[ -n "$me_id" ]]; then
    PROTECTED_IDS+=("$me_id")
  fi

  local admins
  admins="$(paginate /accounts/self/admins '')"
  while IFS= read -r admin_id; do
    [[ -n "$admin_id" ]] && PROTECTED_IDS+=("$admin_id")
  done < <(printf '%s' "$admins" | jq -r '.[] | (.user.id // .user_id // empty)')

  log "protected user ids (admins + token holder): $(printf '%s\n' "${PROTECTED_IDS[@]}" | sort -n | paste -sd, -)"
}

is_protected() {
  local id="$1"
  local pid
  for pid in "${PROTECTED_IDS[@]}"; do
    if [[ "$pid" == "$id" ]]; then
      return 0
    fi
  done
  return 1
}

find_user_by_email() {
  local email="$1"
  local email_lower="${email,,}"
  local results
  results="$(canvas_get /accounts/self/users "search_term=$(printf '%s' "$email" | jq -sRr @uri)&per_page=100")"
  printf '%s' "$results" | jq -c --arg email "$email_lower" \
    '.[] | select((.login_id // "" | ascii_downcase) == $email or (.email // "" | ascii_downcase) == $email)' | head -n1
}

delete_user() {
  local user_id="$1"
  local label="$2"
  if is_protected "$user_id"; then
    return 0
  fi
  canvas_delete_soft "/accounts/self/users/${user_id}" ""
  if [[ "$CANVAS_HTTP_CODE" -lt 400 ]]; then
    log "  deleted user ${user_id} (${label})"
  else
    log "  skip user ${user_id} (${label}): HTTP ${CANVAS_HTTP_CODE}: ${CANVAS_BODY}"
  fi
}

reset_canvas() {
  log "reset: deleting courses..."
  local courses
  courses="$(paginate /accounts/self/courses '')"
  while IFS=$'\t' read -r course_id name; do
    [[ -z "$course_id" ]] && continue
    canvas_delete_soft "/courses/${course_id}" "event=delete"
    if [[ "$CANVAS_HTTP_CODE" -lt 400 ]]; then
      log "  deleted course ${course_id} (${name})"
    else
      log "  skip course ${course_id}: HTTP ${CANVAS_HTTP_CODE}: ${CANVAS_BODY}"
    fi
  done < <(printf '%s' "$courses" | jq -r '.[] | [.id, (.name // .course_code // .id)] | @tsv')

  log "reset: deleting non-admin users..."
  protected_user_ids

  local person
  for person in "${TEACHERS[@]}" "${STUDENTS[@]}"; do
    IFS='|' read -r _ email _ <<<"$person"
    local found
    found="$(find_user_by_email "$email")"
    if [[ -n "$found" ]]; then
      local uid
      uid="$(printf '%s' "$found" | jq -r '.id')"
      delete_user "$uid" "$email"
    fi
  done

  local pass
  for pass in 1 2; do
    local users
    users="$(paginate /accounts/self/users '')"
    while IFS=$'\t' read -r user_id login; do
      [[ -z "$user_id" ]] && continue
      delete_user "$user_id" "$login"
    done < <(printf '%s' "$users" | jq -r '.[] | [.id, (.login_id // .email // .id)] | @tsv')
  done

  log "reset complete (note: soft-deleted users may still hold SIS IDs; seed will skip duplicate sis_user_id if needed)"
}

create_user() {
  local name="$1"
  local email="$2"
  local password="$3"
  local sis_user_id="${4:-}"

  local body
  if [[ -n "$sis_user_id" ]]; then
    body="$(jq -n \
      --arg name "$name" \
      --arg email "$email" \
      --arg password "$password" \
      --arg sis "$sis_user_id" \
      '{user: {name: $name}, pseudonym: {unique_id: $email, password: $password, password_confirmation: $password, sis_user_id: $sis}, communication_channel: {type: "email", address: $email}}')"
  else
    body="$(jq -n \
      --arg name "$name" \
      --arg email "$email" \
      --arg password "$password" \
      '{user: {name: $name}, pseudonym: {unique_id: $email, password: $password, password_confirmation: $password}, communication_channel: {type: "email", address: $email}}')"
  fi

  canvas_post_soft /accounts/self/users "$body"
  if [[ "$CANVAS_HTTP_CODE" -lt 400 ]]; then
    printf '%s' "$CANVAS_BODY"
    return 0
  fi

  if [[ -n "$sis_user_id" ]]; then
    local err_lower
    err_lower="$(printf '%s' "$CANVAS_BODY" | tr '[:upper:]' '[:lower:]')"
    if [[ "$err_lower" == *sis_user_id* || "$err_lower" == *sis\ id* ]]; then
      log "  sis_user_id '${sis_user_id}' already held by a soft-deleted user; creating ${email} without SIS id"
      body="$(jq -n \
        --arg name "$name" \
        --arg email "$email" \
        --arg password "$password" \
        '{user: {name: $name}, pseudonym: {unique_id: $email, password: $password, password_confirmation: $password}, communication_channel: {type: "email", address: $email}}')"
      canvas_post /accounts/self/users "$body"
      return 0
    fi
  fi

  die "POST /accounts/self/users -> HTTP ${CANVAS_HTTP_CODE}: ${CANVAS_BODY}"
}

get_or_create_user() {
  local name="$1"
  local email="$2"
  local password="$3"
  local sis_user_id="${4:-}"

  local existing
  existing="$(find_user_by_email "$email")"
  if [[ -n "$existing" ]]; then
    local uid
    uid="$(printf '%s' "$existing" | jq -r '.id')"
    log "user exists: ${email} (id=${uid})"
    printf '%s' "$existing"
    return 0
  fi

  local created
  created="$(create_user "$name" "$email" "$password" "$sis_user_id")"
  local uid
  uid="$(printf '%s' "$created" | jq -r '.id')"
  log "created user: ${email} (id=${uid})"
  printf '%s' "$created"
}

find_course_by_code() {
  local course_code="$1"
  local courses
  courses="$(paginate /accounts/self/courses '')"
  printf '%s' "$courses" | jq -c --arg code "$course_code" '.[] | select(.course_code == $code)' | head -n1
}

enroll_user() {
  local course_id="$1"
  local user_id="$2"
  local enrollment_type="$3"
  local body
  body="$(jq -n \
    --argjson user_id "$user_id" \
    --arg type "$enrollment_type" \
    '{enrollment: {user_id: $user_id, type: $type, enrollment_state: "active"}}')"

  canvas_post_soft "/courses/${course_id}/enrollments" "$body"
  if [[ "$CANVAS_HTTP_CODE" -lt 400 ]]; then
    log "  enrolled ${enrollment_type} user ${user_id} in course ${course_id}"
  elif [[ "$CANVAS_HTTP_CODE" == "422" ]] || printf '%s' "$CANVAS_BODY" | grep -qi already; then
    log "  enrollment may already exist: user ${user_id} in course ${course_id}"
  else
    die "POST /courses/${course_id}/enrollments -> HTTP ${CANVAS_HTTP_CODE}: ${CANVAS_BODY}"
  fi
}

get_or_create_course() {
  local name="$1"
  local course_code="$2"
  local teacher_user_id="$3"
  local course_id

  local existing
  existing="$(find_course_by_code "$course_code")"
  if [[ -n "$existing" ]]; then
    course_id="$(printf '%s' "$existing" | jq -r '.id')"
    log "course exists: ${course_code} (id=${course_id})"
  else
    local body
    body="$(jq -n \
      --arg name "$name" \
      --arg code "$course_code" \
      '{course: {name: $name, course_code: $code, license: "private"}}')"
    local created
    created="$(canvas_post /accounts/self/courses "$body")"
    course_id="$(printf '%s' "$created" | jq -r '.id')"
    log "created course: ${course_code} (id=${course_id})"
  fi

  enroll_user "$course_id" "$teacher_user_id" "TeacherEnrollment"
  printf '%s' "$course_id"
}

declare -A TEACHER_IDS=()
declare -A STUDENT_IDS=()

seed_canvas() {
  local entry name email sis
  for entry in "${TEACHERS[@]}"; do
    IFS='|' read -r name email <<<"$entry"
    local user_json
    user_json="$(get_or_create_user "$name" "$email" "$USER_PASSWORD")"
    TEACHER_IDS["$email"]="$(printf '%s' "$user_json" | jq -r '.id')"
  done

  for entry in "${STUDENTS[@]}"; do
    IFS='|' read -r name email sis <<<"$entry"
    local user_json
    user_json="$(get_or_create_user "$name" "$email" "$USER_PASSWORD" "$sis")"
    STUDENT_IDS["$email"]="$(printf '%s' "$user_json" | jq -r '.id')"
  done

  local course_entry course_name course_code teacher_email student_emails
  for course_entry in "${COURSES[@]}"; do
    IFS='|' read -r course_name course_code teacher_email student_emails <<<"$course_entry"
    local teacher_id="${TEACHER_IDS[$teacher_email]}"
    local course_id
    course_id="$(get_or_create_course "$course_name" "$course_code" "$teacher_id")"

    local student_email
    IFS=',' read -ra student_list <<<"$student_emails"
    for student_email in "${student_list[@]}"; do
      student_email="${student_email//[$'\t\r\n ']}"
      [[ -z "$student_email" ]] && continue
      local student_id="${STUDENT_IDS[$student_email]}"
      enroll_user "$course_id" "$student_id" "StudentEnrollment"
    done
  done
}

main() {
  parse_args "$@"

  require_tools

  ADMIN_TOKEN="$(normalize_token "$ADMIN_TOKEN")"
  [[ -z "$ADMIN_TOKEN" ]] && die "admin token is empty. Set CANVAS_ADMIN_TOKEN or paste into ADMIN_TOKEN near the top of this script."

  CANVAS_URL="${CANVAS_URL%/}"
  log "Canvas: ${CANVAS_URL}"
  log "password: ${USER_PASSWORD}"
  verify_token

  if should_reset; then
    reset_canvas
  else
    log "reset skipped (--no-reset)"
  fi

  if [[ "$DO_RESET_ONLY" != true ]]; then
    log "seeding..."
    seed_canvas
  fi

  log ""
  log "Done."
  if [[ "$DO_RESET_ONLY" != true ]]; then
    log "  Teachers (${#TEACHERS[@]}): prof1@example.com, prof2@example.com, prof3@example.com, prof4@example.com"
    log "  Students (${#STUDENTS[@]}): student1@example.com … aoludare@student.ubc.ca"
    log "  Courses (${#COURSES[@]}): COSC 101, COSC 201, COSC 110, COSC 121"
    log ""
    log "Next: log in as prof1@example.com, create a personal access token, test roster APIs."
  fi
}

main "$@"
