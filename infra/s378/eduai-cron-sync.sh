#!/usr/bin/env bash
# Root-owned deploy helper. The source checkout is intentionally fixed so the
# deploy account cannot turn the cron-script sync permission into arbitrary
# root-owned file installation.
set -euo pipefail

readonly SOURCE_DIR="/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/infra/cron"
readonly DEST_DIR="/opt/eduai/cron"

[[ -d "$SOURCE_DIR" ]] || { echo "missing cron source: $SOURCE_DIR" >&2; exit 1; }
install -d -m 0750 -o eduai-cron -g eduai-cron "$DEST_DIR"
for script in "$SOURCE_DIR"/*.sh; do
  install -m 0750 -o eduai-cron -g eduai-cron "$script" "$DEST_DIR/"
done
