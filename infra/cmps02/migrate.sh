#!/usr/bin/env bash
# Default cmps02 deploy → Qwen 7B + 32B tiered stack (see README.md).
exec "$(dirname "$0")/migrate-tiered.sh" "$@"
