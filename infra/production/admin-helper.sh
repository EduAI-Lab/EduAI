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
die() { echo "ERROR: $*" >&2; exit 1; }
case "${1:-}" in
  redis-install)
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
    source_path="${2:-}"
    [ -n "$source_path" ] || die "usage: install-env /srv/www/eduai-production/shared/staged/eduai-core.env"
    [ -f "$source_path" ] || die "environment source does not exist"
    grep -q '^NODE_ENV=production$' "$source_path" || die "environment must set NODE_ENV=production"
    grep -Eq '<[^>]+>|CHANGE_ME|REPLACE_ME' "$source_path" && die "environment still contains placeholders"
    install -o root -g eduai -m 0640 "$source_path" "$CORE_ENV"
    echo "Installed $CORE_ENV"
    ;;
  install-core-unit)
    source_path="${2:-}"
    [ -f "$source_path" ] || die "usage: install-core-unit /srv/www/eduai-production/shared/staged/eduai-core.service"
    install -o root -g root -m 0644 "$source_path" "$CORE_UNIT"
    systemctl daemon-reload
    echo "Installed $CORE_UNIT"
    ;;
  install-apache-vhost)
    source_path="${2:-}"
    [ -f "$source_path" ] || die "usage: install-apache-vhost /srv/www/eduai-production/shared/staged/my.eduai.ok.ubc.ca.conf"
    install -o root -g root -m 0644 "$source_path" "$APACHE_VHOST"
    a2ensite my.eduai.ok.ubc.ca.conf >/dev/null
    apache2ctl configtest
    echo "Installed and validated $APACHE_VHOST"
    ;;
  enable-core) systemctl enable eduai-core ;;
  restart-core) systemctl restart eduai-core; systemctl --no-pager --full status eduai-core ;;
  reload-apache) apache2ctl configtest; systemctl reload apache2 ;;
  *) die "unknown action; allowed: redis-install, install-env, install-core-unit, install-apache-vhost, enable-core, restart-core, reload-apache" ;;
esac
