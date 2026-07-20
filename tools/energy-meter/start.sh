#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
export ENERGY_METER_HOST="${ENERGY_METER_HOST:-127.0.0.1}"
export ENERGY_METER_PORT="${ENERGY_METER_PORT:-9100}"
export LOCAL_GRID_GCO2_PER_KWH="${LOCAL_GRID_GCO2_PER_KWH:-12}"
exec .venv/bin/python server.py
