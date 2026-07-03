#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for f in nginx.conf.template nginx.conf; do
  path="$DIR/$f"
  [[ -f "$path" ]] || continue
  if ! grep -q map_hash_bucket_size "$path"; then
    sed -i '/^map \$http_x_eduai_internal_key/i map_hash_bucket_size 128;\nmap_hash_max_size 4096;\n' "$path"
  fi
done
cd "$DIR"
./deploy-edge-proxy.sh
