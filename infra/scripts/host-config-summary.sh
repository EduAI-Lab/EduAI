#!/usr/bin/env bash
# Read-only summary of an EduAI host's configuration, for comparing prod (s348)
# with dev (s378) and re-checking after a deploy (#1877). It prints setting
# NAMES, never values (an empty value is marked "(empty)"), so the output is
# safe to paste into an issue. Run it on each host and diff the two outputs:
#
#   bash infra/scripts/host-config-summary.sh > ~/host-summary-$(hostname -s).txt
#
# Needs sudo for /etc/eduai and the service account's files; changes nothing.
set -uo pipefail

section() { printf '\n=== %s ===\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

# KEY or KEY(empty), one line per file, sorted. Quotes count as empty: systemd
# strips them, so KEY="" starts the service with an empty value.
env_names() {
  sudo awk -F= '
    /^[[:space:]]*(#|$)/ { next }
    { sub(/^[[:space:]]*(export[[:space:]]+)?/, "") }
    $1 ~ /^[A-Za-z_][A-Za-z0-9_]*$/ {
      v = substr($0, length($1) + 2); gsub(/^["\047]|["\047][[:space:]]*$/, "", v)
      print (v == "" ? $1 "(empty)" : $1)
    }' "$1" | sort -u | tr '\n' ' '
  echo
}

section "host"
echo "host=$(hostname -f 2>/dev/null || hostname) date=$(date -u +%FT%TZ)"
. /etc/os-release 2>/dev/null && echo "os=$PRETTY_NAME"

section "environment files (names only)"
env_files=()
# /etc/eduai is not readable without sudo, so a shell glob would not expand there.
mapfile -t etc_env < <(sudo find /etc/eduai -maxdepth 2 -name '*.env' -type f 2>/dev/null | sort)
for f in "${etc_env[@]}" \
  /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core/.env \
  /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/extensions/ai-tutor/server/.env \
  /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/extensions/question-maker/.env \
  /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/extensions/question-maker/app/backend/.env; do
  sudo test -f "$f" && env_files+=("$f")
done
for f in "${env_files[@]}"; do
  echo "--- $f ($(sudo stat -c '%U:%G %a' "$f"))"
  env_names "$f"
done
for f in /etc/eduai/cron.env /etc/eduai/fleet/fleet.config.json; do
  sudo test -e "$f" || echo "--- $f MISSING"
done

section "/etc/eduai"
sudo ls -la /etc/eduai 2>/dev/null | awk 'NR > 1 { print $1, $3, $4, $NF }'

section "systemd units"
units=$(systemctl list-unit-files --no-legend 'eduai*' 2>/dev/null | awk '{ print $1 }')
for u in $units; do
  systemctl show "$u" -p ActiveState,UnitFileState,User,Group,WorkingDirectory,EnvironmentFiles 2>/dev/null \
    | sed -E 's/ \(ignore_errors=[a-z]+\)//' | paste -sd ' ' | sed "s|^|$u: |"
done

section "timers and cron"
systemctl list-timers --all --no-legend 2>/dev/null | grep -i eduai | awk '{ print $(NF-1), $NF }'
sudo ls /etc/cron.d 2>/dev/null | sed 's/^/cron.d: /'
for user in root eduai-cron service_eduai "$(id -un)"; do
  id "$user" >/dev/null 2>&1 || continue
  sudo crontab -l -u "$user" 2>/dev/null | grep -Ev '^[[:space:]]*(#|$)' | sed "s|^|crontab($user): |"
done

section "apache vhosts"
for dir in /etc/apache2/sites-enabled /etc/httpd/conf.d; do
  [ -d "$dir" ] || continue
  for f in "$dir"/*.conf; do
    [ -e "$f" ] || continue
    echo "--- $f"
    grep -hE '^[[:space:]]*(ServerName|ServerAlias|ProxyPass |DocumentRoot|CustomLog|ErrorLog)' "$f" \
      | sed -E 's/^[[:space:]]+//' | sort -u
  done
done

section "docker containers"
if have docker; then
  sudo docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | sort
else
  echo "docker not installed"
fi

section "tools"
for t in node npm psql pg_dump docker git mail msmtp sendmail apache2ctl httpd; do
  if have "$t"; then
    v=$("$t" --version 2>/dev/null | head -1) || v=""
    echo "$t: ${v:-present}"
  else
    echo "$t: MISSING"
  fi
done

section "ownership"
for p in /srv/www/eduai-production /srv/www/eduai-production/current \
  /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore /opt/eduai/cron /var/backups/eduai; do
  [ -e "$p" ] && echo "$p $(stat -c '%U:%G %a' "$p")$( [ -L "$p" ] && echo " -> $(readlink "$p")")"
done
