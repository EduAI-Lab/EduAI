#!/usr/bin/env bash
# cmps02 — preflight inventory before vLLM deploy.
set -euo pipefail

echo "=== host ==="
hostname -f 2>/dev/null || hostname
date -Is

echo ""
echo "=== nvidia-smi ==="
if command -v nvidia-smi >/dev/null; then
  nvidia-smi -L
  nvidia-smi --query-gpu=index,name,memory.total,driver_version --format=csv
else
  echo "MISSING: nvidia-smi not found"
fi

echo ""
echo "=== docker ==="
docker --version 2>/dev/null || echo "MISSING: docker"
docker info 2>/dev/null | grep -i runtime || true

echo ""
echo "=== docker GPU smoke ==="
if docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi -L 2>/dev/null; then
  echo "OK: docker --gpus works"
else
  echo "FAIL: docker --gpus — install NVIDIA Container Toolkit"
fi

echo ""
echo "=== listening ports (8001, 18001, 18002, 18091) ==="
ss -tlnp 2>/dev/null | grep -E ':8001|:18001|:18002|:18091' || echo "(none bound — good for fresh install)"

echo ""
echo "=== existing eduai containers ==="
docker ps -a --filter 'name=eduai-' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true

echo ""
echo "=== disk ==="
df -h / /var/lib/docker 2>/dev/null | head -5

echo ""
echo "Done. Fix any FAIL lines before ./migrate.sh"
