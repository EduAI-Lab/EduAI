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
die() { echo "ERROR: $*" >&2; exit 1; }
no_extra_args() { [ "$#" -eq 1 ] || die "$1 does not accept arguments"; }
release_arg() {
  [ "$#" -eq 2 ] || die "$1 requires a release id"
  [[ "$2" =~ ^[0-9a-f]{8,64}$ ]] || die "invalid release id: $2"
  local release="/srv/www/eduai-production/releases/$2"
  [ -d "$release" ] || die "release does not exist: $release"
  printf '%s' "$release"
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
    grep -Eq '^POSTGRES_(USER|PASSWORD|DB)=.+$' "$AI_TUTOR_DB_ENV_SOURCE" || die "AI Tutor database environment is incomplete"
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
  activate-release)
    release=$(release_arg "$@")
    ln -sfn "$release" /srv/www/eduai-production/current
    echo "Activated $release"
    ;;
  enable-aitutor) no_extra_args "$@"; systemctl enable eduai-aitutor-server ;;
  restart-aitutor) no_extra_args "$@"; systemctl restart eduai-aitutor-server; systemctl --no-pager --full status eduai-aitutor-server ;;
  enable-core) no_extra_args "$@"; systemctl enable eduai-core ;;
  restart-core) no_extra_args "$@"; systemctl restart eduai-core; systemctl --no-pager --full status eduai-core ;;
  reload-apache) no_extra_args "$@"; apache2ctl configtest; systemctl reload apache2 ;;
  *) die "unknown action; allowed: redis-install, install-env, install-core-unit, install-apache-vhost, install-aitutor-db-env, install-aitutor-env, install-aitutor-unit, install-aitutor-apache, aitutor-db-install, activate-release, enable-aitutor, restart-aitutor, enable-core, restart-core, reload-apache" ;;
esac
