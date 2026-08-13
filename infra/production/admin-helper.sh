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
readonly STAGED_DIR="/srv/www/eduai-production/shared/staged"
readonly ENV_SOURCE="$STAGED_DIR/eduai-core.env"
readonly CORE_UNIT_SOURCE="$STAGED_DIR/eduai-core.service"
readonly APACHE_SOURCE="$STAGED_DIR/my.eduai.ok.ubc.ca.conf"
die() { echo "ERROR: $*" >&2; exit 1; }
no_extra_args() { [ "$#" -eq 1 ] || die "$1 does not accept arguments"; }
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
    [ -f "$CORE_UNIT_SOURCE" ] || die "staged Core unit does not exist: $CORE_UNIT_SOURCE"
    install -o root -g root -m 0644 "$CORE_UNIT_SOURCE" "$CORE_UNIT"
    systemctl daemon-reload
    echo "Installed $CORE_UNIT"
    ;;
  install-apache-vhost)
    no_extra_args "$@"
    [ -f "$APACHE_SOURCE" ] || die "staged Apache vhost does not exist: $APACHE_SOURCE"
    install -o root -g root -m 0644 "$APACHE_SOURCE" "$APACHE_VHOST"
    a2ensite my.eduai.ok.ubc.ca.conf >/dev/null
    apache2ctl configtest
    echo "Installed and validated $APACHE_VHOST"
    ;;
  enable-core) no_extra_args "$@"; systemctl enable eduai-core ;;
  restart-core) no_extra_args "$@"; systemctl restart eduai-core; systemctl --no-pager --full status eduai-core ;;
  reload-apache) no_extra_args "$@"; apache2ctl configtest; systemctl reload apache2 ;;
  *) die "unknown action; allowed: redis-install, install-env, install-core-unit, install-apache-vhost, enable-core, restart-core, reload-apache" ;;
esac
