#!/usr/bin/env bash
# Default cmps02 deploy → gpt-oss-120b (see README.md).
exec "$(dirname "$0")/migrate-120b.sh" "$@"
