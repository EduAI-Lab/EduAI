#!/usr/bin/env bash
set -euo pipefail

# Root-owned helper intended to be the only passwordless sudo entry for the
# EduAI production bootstrap. Keep the action set small and review changes to
# this file before installing a new version.
readonly REDIS_NAME="eduai-redis"
readonly REDIS_VOLUME="eduai-redis-data"
readonly CORE_ENV="/etc/eduai/eduai-core.env"
readonly CORE_UNIT="/etc/systemd/system/eduai-core.service"
readonly APACHE_VHOST="/etc/apache2/sites-available/my.eduai.ok.ubc.ca.conf"
readonly AI_TUTOR_ENV="/etc/eduai/eduai-aitutor.env"
readonly AI_TUTOR_DB_ENV="/etc/eduai/aitutor-db.env"
readonly AI_TUTOR_UNIT="/etc/systemd/system/eduai-aitutor-server.service"
readonly AI_TUTOR_VHOST="/etc/apache2/sites-available/aitutor.eduai.ok.ubc.ca.conf"
readonly QM_UNIT="/etc/systemd/system/eduai-qm-backend.service"
readonly QM_ENV="/etc/eduai/eduai-qm.env"
readonly QM_VHOST="/etc/apache2/sites-available/questionmaker.eduai.ok.ubc.ca.conf"
readonly AI_TUTOR_DB_NAME="eduai-aitutor-db"
readonly AI_TUTOR_DB_VOLUME="eduai-aitutor-db-data"
readonly TEMPLATE_DIR="/etc/eduai/production-templates"
readonly ENV_SOURCE="$TEMPLATE_DIR/eduai-core.env"
readonly CORE_UNIT_SOURCE="$TEMPLATE_DIR/eduai-core.service"
readonly APACHE_SOURCE="$TEMPLATE_DIR/my.eduai.ok.ubc.ca.conf"
readonly AI_TUTOR_ENV_SOURCE="$TEMPLATE_DIR/eduai-aitutor.env"
readonly AI_TUTOR_DB_ENV_SOURCE="$TEMPLATE_DIR/aitutor-db.env"
readonly AI_TUTOR_UNIT_SOURCE="$TEMPLATE_DIR/eduai-aitutor-server.service"
readonly AI_TUTOR_VHOST_SOURCE="$TEMPLATE_DIR/aitutor.eduai.ok.ubc.ca.conf"
readonly QM_UNIT_SOURCE="$TEMPLATE_DIR/eduai-qm-backend.service"
readonly QM_ENV_SOURCE="$TEMPLATE_DIR/eduai-qm.env"
readonly QM_VHOST_SOURCE="$TEMPLATE_DIR/questionmaker.eduai.ok.ubc.ca.conf"
readonly CRON_ENV="/etc/eduai/cron.env"
readonly CRON_UNIT="/etc/systemd/system/eduai-cron-worker.service"
readonly CRON_UNIT_SOURCE="$TEMPLATE_DIR/eduai-cron-worker.service"
readonly CRON_SCRIPT_DIR="/opt/eduai/cron"
readonly TARGET_ROOT="/srv/www/eduai-production"
readonly WEB_USER="www-data"
die() { echo "ERROR: $*" >&2; exit 1; }
no_extra_args() { [ "$#" -eq 1 ] || die "$1 does not accept arguments"; }
assert_no_symlink_components() {
  local path="$1" current="$1"
  while :; do
    [ ! -L "$current" ] || die "refusing symlinked release path component: $current"
    [ "$current" = "/" ] && break
    current=$(dirname "$current")
  done
}
assert_safe_release() {
  local release="$1" resolved
  case "$release" in
    "$TARGET_ROOT/releases"/*) ;;
    *) die "release path is outside the managed release tree: $release" ;;
  esac
  assert_no_symlink_components "$release"
  resolved=$(readlink -f -- "$release") || die "cannot resolve release path: $release"
  case "$resolved" in
    "$TARGET_ROOT/releases"/*) ;;
    *) die "resolved release path is outside the managed release tree: $resolved" ;;
  esac
  [ "$resolved" = "$release" ] || die "release path resolves unexpectedly: $release -> $resolved"
}
release_arg() {
  [ "$#" -eq 2 ] || die "$1 requires a release id"
  [[ "$2" =~ ^[0-9a-f]{8,64}$ ]] || die "invalid release id: $2"
  local release="$TARGET_ROOT/releases/$2"
  [ -d "$release" ] || die "release does not exist: $release"
  assert_safe_release "$release"
  printf '%s' "$release"
}
validate_release() {
  local release="$1"
  local required relative
  assert_safe_release "$release"
  required=(
    "apps/core/build/server/index.js"
    "apps/core/node_modules/@prisma/client/index.js"
    "apps/extensions/ai-tutor/server/node_modules/@eduai/ai-tutor-prisma-client/index.js"
    "apps/extensions/ai-tutor/build/client/index.html"
    "apps/extensions/question-maker/app/backend/node_modules/@eduai/question-maker-prisma-client/index.js"
    "apps/extensions/question-maker/app/frontend/dist/index.html"
  )
  for relative in "${required[@]}"; do
    assert_no_symlink_components "$release/$relative"
    [ -f "$release/$relative" ] || die "release is incomplete; missing $release/$relative"
  done
}
prepare_static_assets() {
  local release="$1" static_root parent
  command -v setfacl >/dev/null 2>&1 || die "setfacl is required to grant Apache access to release assets"
  # Apache needs traversal on the path and read access under these two
  # explicitly public build roots. Use a user ACL rather than world access:
  # env files and backend source remain protected from unrelated users.
  setfacl -m "u:$WEB_USER:x" "$TARGET_ROOT" "$TARGET_ROOT/releases"
  for static_root in \
    "$release/apps/extensions/ai-tutor/build/client" \
    "$release/apps/extensions/question-maker/app/frontend/dist"; do
    [ -d "$static_root" ] || die "static asset directory does not exist: $static_root"
    assert_no_symlink_components "$static_root"
    if find "$static_root" -type l -print -quit | grep -q .; then
      die "refusing symlink inside public static tree: $static_root"
    fi
    parent="$static_root"
    while [ "$parent" != "/" ]; do
      setfacl -m "u:$WEB_USER:x" "$parent"
      [ "$parent" = "$release" ] && break
      parent=$(dirname "$parent")
    done
    setfacl -R -m "u:$WEB_USER:rX" "$static_root"
  done
}
sync_cron_scripts() {
  local release source script script_name
  release=$(readlink -f -- "$TARGET_ROOT/current") || die "cannot resolve the active production release"
  assert_safe_release "$release"
  source="$release/infra/cron"
  assert_no_symlink_components "$source"
  [ -d "$source" ] || die "cron script directory does not exist in the active release: $source"
  install -d -o eduai-cron -g eduai-cron -m 0750 "$CRON_SCRIPT_DIR"
  for script_name in \
    lib.sh \
    backup-nightly.sh \
    backup-offsite.sh \
    backup-rotate.sh \
    cleanup-invitations.sh \
    notify-api-key-expiry.sh; do
    script="$source/$script_name"
    [ -f "$script" ] || die "required cron script is missing: $script"
    [ ! -L "$script" ] || die "refusing symlinked cron script: $script"
    install -o eduai-cron -g eduai-cron -m 0750 "$script" "$CRON_SCRIPT_DIR/$script_name"
  done
}
read_env_value() {
  local file="$1" key="$2" line value
  line=$(grep "^${key}=" "$file" 2>/dev/null | head -1 || true)
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}
set_env_value() {
  local file="$1" key="$2" value="$3" escaped
  touch "$file"
  escaped=$(printf '%s' "$value" | sed -e 's/[&\\]/\\&/g')
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
case "${1:-}" in
  redis-install)
    no_extra_args "$@"
    if docker inspect "$REDIS_NAME" >/dev/null 2>&1; then
      state=$(docker inspect -f '{{.State.Status}}' "$REDIS_NAME")
      [ "$state" = running ] || docker start "$REDIS_NAME" >/dev/null
      echo "Redis container already exists: $REDIS_NAME ($state)"
    else
      docker volume inspect "$REDIS_VOLUME" >/dev/null 2>&1 || docker volume create "$REDIS_VOLUME" >/dev/null
      docker run --detach --name "$REDIS_NAME" --restart unless-stopped \
        --publish 127.0.0.1:6379:6379 \
        --mount "type=volume,source=$REDIS_VOLUME,destination=/data" \
        redis:7-alpine redis-server --appendonly yes >/dev/null
      echo "Redis container created: $REDIS_NAME"
    fi
    docker exec "$REDIS_NAME" redis-cli ping
    ;;
  install-env)
    no_extra_args "$@"
    [ -f "$ENV_SOURCE" ] || die "environment source does not exist: $ENV_SOURCE"
    grep -q '^NODE_ENV=production$' "$ENV_SOURCE" || die "environment must set NODE_ENV=production"
    grep -Eq '<[^>]+>|CHANGE_ME|REPLACE_ME' "$ENV_SOURCE" && die "environment still contains placeholders"
    install -o root -g eduai -m 0640 "$ENV_SOURCE" "$CORE_ENV"
    echo "Installed $CORE_ENV"
    ;;
  install-core-unit)
    no_extra_args "$@"
    [ -f "$CORE_UNIT_SOURCE" ] || die "root-owned Core unit template does not exist: $CORE_UNIT_SOURCE"
    install -o root -g root -m 0644 "$CORE_UNIT_SOURCE" "$CORE_UNIT"
    systemctl daemon-reload
    echo "Installed $CORE_UNIT"
    ;;
  install-apache-vhost)
    no_extra_args "$@"
    [ -f "$APACHE_SOURCE" ] || die "root-owned Apache vhost template does not exist: $APACHE_SOURCE"
    install -o root -g root -m 0644 "$APACHE_SOURCE" "$APACHE_VHOST"
    a2ensite my.eduai.ok.ubc.ca.conf >/dev/null
    apache2ctl configtest
    echo "Installed and validated $APACHE_VHOST"
    ;;
  install-aitutor-db-env)
    no_extra_args "$@"
    [ -f "$AI_TUTOR_DB_ENV_SOURCE" ] || die "AI Tutor database environment source does not exist: $AI_TUTOR_DB_ENV_SOURCE"
    grep -Eq '^POSTGRES_USER=.+$' "$AI_TUTOR_DB_ENV_SOURCE" || die "AI Tutor database environment is missing POSTGRES_USER"
    grep -Eq '^POSTGRES_PASSWORD=.+$' "$AI_TUTOR_DB_ENV_SOURCE" || die "AI Tutor database environment is missing POSTGRES_PASSWORD"
    grep -Eq '^POSTGRES_DB=.+$' "$AI_TUTOR_DB_ENV_SOURCE" || die "AI Tutor database environment is missing POSTGRES_DB"
    grep -Eq '<[^>]+>|CHANGE_ME|REPLACE_ME' "$AI_TUTOR_DB_ENV_SOURCE" && die "AI Tutor database environment still contains placeholders"
    install -o root -g root -m 0600 "$AI_TUTOR_DB_ENV_SOURCE" "$AI_TUTOR_DB_ENV"
    echo "Installed $AI_TUTOR_DB_ENV"
    ;;
  install-aitutor-env)
    no_extra_args "$@"
    [ -f "$AI_TUTOR_ENV_SOURCE" ] || die "AI Tutor environment source does not exist: $AI_TUTOR_ENV_SOURCE"
    grep -q '^NODE_ENV=production$' "$AI_TUTOR_ENV_SOURCE" || die "AI Tutor environment must set NODE_ENV=production"
    grep -Eq '<[^>]+>|CHANGE_ME|REPLACE_ME' "$AI_TUTOR_ENV_SOURCE" && die "AI Tutor environment still contains placeholders"
    install -o root -g eduai -m 0640 "$AI_TUTOR_ENV_SOURCE" "$AI_TUTOR_ENV"
    echo "Installed $AI_TUTOR_ENV"
    ;;
  install-aitutor-unit)
    no_extra_args "$@"
    [ -f "$AI_TUTOR_UNIT_SOURCE" ] || die "AI Tutor unit source does not exist: $AI_TUTOR_UNIT_SOURCE"
    install -o root -g root -m 0644 "$AI_TUTOR_UNIT_SOURCE" "$AI_TUTOR_UNIT"
    systemctl daemon-reload
    echo "Installed $AI_TUTOR_UNIT"
    ;;
  install-aitutor-apache)
    no_extra_args "$@"
    [ -f "$AI_TUTOR_VHOST_SOURCE" ] || die "AI Tutor Apache source does not exist: $AI_TUTOR_VHOST_SOURCE"
    install -o root -g root -m 0644 "$AI_TUTOR_VHOST_SOURCE" "$AI_TUTOR_VHOST"
    a2enmod headers proxy proxy_http ssl >/dev/null
    a2ensite aitutor.eduai.ok.ubc.ca.conf >/dev/null
    apache2ctl configtest
    echo "Installed and validated $AI_TUTOR_VHOST"
    ;;
  install-qm-unit)
    no_extra_args "$@"
    [ -f "$QM_UNIT_SOURCE" ] || die "Question Maker unit source does not exist: $QM_UNIT_SOURCE"
    install -o root -g root -m 0644 "$QM_UNIT_SOURCE" "$QM_UNIT"
    systemctl daemon-reload
    echo "Installed $QM_UNIT"
    ;;
  install-qm-env)
    no_extra_args "$@"
    [ -f "$QM_ENV_SOURCE" ] || die "Question Maker environment source does not exist: $QM_ENV_SOURCE"
    grep -q '^NODE_ENV=production$' "$QM_ENV_SOURCE" || die "Question Maker environment must set NODE_ENV=production"
    grep -Eq '^DATABASE_URL=.+$' "$QM_ENV_SOURCE" || die "Question Maker environment is missing DATABASE_URL"
    grep -Eq '^EDUAI_API_KEY=.+$' "$QM_ENV_SOURCE" || die "Question Maker environment is missing EDUAI_API_KEY"
    grep -Eq '<[^>]+>|CHANGE_ME|REPLACE_ME' "$QM_ENV_SOURCE" && die "Question Maker environment still contains placeholders"
    install -o root -g eduai -m 0640 "$QM_ENV_SOURCE" "$QM_ENV"
    echo "Installed $QM_ENV"
    ;;
  install-qm-apache)
    no_extra_args "$@"
    [ -f "$QM_VHOST_SOURCE" ] || die "Question Maker Apache source does not exist: $QM_VHOST_SOURCE"
    install -o root -g root -m 0644 "$QM_VHOST_SOURCE" "$QM_VHOST"
    a2enmod headers proxy proxy_http ssl >/dev/null
    a2ensite questionmaker.eduai.ok.ubc.ca.conf >/dev/null
    apache2ctl configtest
    echo "Installed and validated $QM_VHOST"
    ;;
  install-cron-worker)
    no_extra_args "$@"
    [ -f "$CRON_UNIT_SOURCE" ] || die "cron worker unit source does not exist: $CRON_UNIT_SOURCE"
    getent passwd eduai-cron >/dev/null || die "user eduai-cron does not exist"
    getent group eduai >/dev/null || die "group eduai does not exist"
    [ -r "$CORE_ENV" ] || die "missing or unreadable $CORE_ENV"
    [ -r "$CRON_ENV" ] || die "missing or unreadable $CRON_ENV"
    sync_cron_scripts
    install -o root -g root -m 0644 "$CRON_UNIT_SOURCE" "$CRON_UNIT"
    systemctl daemon-reload
    echo "Installed $CRON_UNIT and synchronized cron scripts"
    ;;
  aitutor-db-install)
    no_extra_args "$@"
    [ -r "$AI_TUTOR_DB_ENV" ] || die "missing $AI_TUTOR_DB_ENV"
    # This file is root-owned and mode 0600; it is never printed.
    set -a
    # shellcheck disable=SC1090
    . "$AI_TUTOR_DB_ENV"
    set +a
    [ -n "${POSTGRES_USER:-}" ] || die "POSTGRES_USER is missing"
    [ -n "${POSTGRES_PASSWORD:-}" ] || die "POSTGRES_PASSWORD is missing"
    [ -n "${POSTGRES_DB:-}" ] || die "POSTGRES_DB is missing"
    if docker inspect "$AI_TUTOR_DB_NAME" >/dev/null 2>&1; then
      state=$(docker inspect -f '{{.State.Status}}' "$AI_TUTOR_DB_NAME")
      [ "$state" = running ] || docker start "$AI_TUTOR_DB_NAME" >/dev/null
      echo "AI Tutor database container already exists: $AI_TUTOR_DB_NAME ($state)"
    else
      docker volume inspect "$AI_TUTOR_DB_VOLUME" >/dev/null 2>&1 || docker volume create "$AI_TUTOR_DB_VOLUME" >/dev/null
      docker run --detach --name "$AI_TUTOR_DB_NAME" --restart unless-stopped \
        --publish 127.0.0.1:54321:5432 \
        --env "POSTGRES_USER=$POSTGRES_USER" \
        --env "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
        --env "POSTGRES_DB=$POSTGRES_DB" \
        --mount "type=volume,source=$AI_TUTOR_DB_VOLUME,destination=/var/lib/postgresql/data" \
        postgres:16-alpine >/dev/null
      echo "AI Tutor database container created: $AI_TUTOR_DB_NAME"
    fi
    docker exec "$AI_TUTOR_DB_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
    ;;
  provision-aitutor)
    no_extra_args "$@"
    [ -f "$CORE_ENV" ] || die "missing $CORE_ENV"
    service_key=$(read_env_value "$CORE_ENV" EDUAI_API_KEY)
    if [ -z "$service_key" ] || [[ "$service_key" == *"<"* || "$service_key" == *">"* ]]; then
      service_key=$(openssl rand -hex 32)
      set_env_value "$CORE_ENV" EDUAI_API_KEY "$service_key"
    fi
    set_env_value "$CORE_ENV" COOKIE_DOMAIN ".ok.ubc.ca"
    set_env_value "$CORE_ENV" AI_TUTOR_SERVER_URL "http://127.0.0.1:4000"
    set_env_value "$CORE_ENV" VITE_EDUAI_URL "https://my.eduai.ok.ubc.ca"
    set_env_value "$CORE_ENV" VITE_AI_TUTOR_URL "https://aitutor.eduai.ok.ubc.ca"
    set_env_value "$CORE_ENV" VITE_QUESTION_MAKER_URL "https://questionmaker.eduai.ok.ubc.ca"
    chown root:eduai "$CORE_ENV"
    chmod 0640 "$CORE_ENV"

    if [ -f "$AI_TUTOR_DB_ENV" ]; then
      set -a
      # shellcheck disable=SC1090
      . "$AI_TUTOR_DB_ENV"
      set +a
    else
      if docker inspect "$AI_TUTOR_DB_NAME" >/dev/null 2>&1; then
        die "$AI_TUTOR_DB_ENV is missing but the AI Tutor database container already exists"
      fi
      POSTGRES_USER=ai_tutor_prod
      POSTGRES_PASSWORD=$(openssl rand -hex 32)
      POSTGRES_DB=ai_tutor_prod
      umask 077
      printf 'POSTGRES_USER=%s\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=%s\n' \
        "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$POSTGRES_DB" > "$AI_TUTOR_DB_ENV"
      chown root:root "$AI_TUTOR_DB_ENV"
      chmod 0600 "$AI_TUTOR_DB_ENV"
    fi
    [ -n "${POSTGRES_USER:-}" ] || die "POSTGRES_USER is missing"
    [ -n "${POSTGRES_PASSWORD:-}" ] || die "POSTGRES_PASSWORD is missing"
    [ -n "${POSTGRES_DB:-}" ] || die "POSTGRES_DB is missing"

    set_env_value "$AI_TUTOR_ENV" NODE_ENV production
    set_env_value "$AI_TUTOR_ENV" PORT 4000
    set_env_value "$AI_TUTOR_ENV" DATABASE_URL "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:54321/${POSTGRES_DB}?schema=public"
    set_env_value "$AI_TUTOR_ENV" CORE_URL "https://my.eduai.ok.ubc.ca"
    set_env_value "$AI_TUTOR_ENV" EDUAI_BASE_URL "https://my.eduai.ok.ubc.ca/api"
    set_env_value "$AI_TUTOR_ENV" EDUAI_API_KEY "$service_key"
    set_env_value "$AI_TUTOR_ENV" EDUAI_ENFORCE_URL_CONSISTENCY 1
    set_env_value "$AI_TUTOR_ENV" CORS_ORIGINS "https://aitutor.eduai.ok.ubc.ca"
    chown root:eduai "$AI_TUTOR_ENV"
    chmod 0640 "$AI_TUTOR_ENV"
    "$0" aitutor-db-install
    echo "AI_TUTOR_CONFIGURED"
    ;;
  activate-release)
    release=$(release_arg "$@")
    validate_release "$release"
    prepare_static_assets "$release"
    ln -sfn "$release" "$TARGET_ROOT/current"
    echo "Activated $release"
    ;;
  validate-release)
    release=$(release_arg "$@")
    validate_release "$release"
    echo "Release is complete: $release"
    ;;
  enable-aitutor) no_extra_args "$@"; systemctl enable eduai-aitutor-server ;;
  restart-aitutor) no_extra_args "$@"; systemctl restart eduai-aitutor-server; systemctl --no-pager --full status eduai-aitutor-server ;;
  enable-qm) no_extra_args "$@"; systemctl enable eduai-qm-backend ;;
  restart-qm) no_extra_args "$@"; systemctl restart eduai-qm-backend; systemctl --no-pager --full status eduai-qm-backend ;;
  enable-cron-worker) no_extra_args "$@"; systemctl enable eduai-cron-worker ;;
  restart-cron-worker) no_extra_args "$@"; systemctl restart eduai-cron-worker; systemctl --no-pager --full status eduai-cron-worker ;;
  enable-core) no_extra_args "$@"; systemctl enable eduai-core ;;
  restart-core) no_extra_args "$@"; systemctl restart eduai-core; systemctl --no-pager --full status eduai-core ;;
  reload-apache) no_extra_args "$@"; apache2ctl configtest; systemctl reload apache2 ;;
  *) die "unknown action; allowed: redis-install, install-env, install-core-unit, install-apache-vhost, install-aitutor-db-env, install-aitutor-env, install-aitutor-unit, install-aitutor-apache, install-qm-env, install-qm-unit, install-qm-apache, aitutor-db-install, provision-aitutor, install-cron-worker, validate-release, activate-release, enable-aitutor, restart-aitutor, enable-qm, restart-qm, enable-cron-worker, restart-cron-worker, enable-core, restart-core, reload-apache" ;;
esac
