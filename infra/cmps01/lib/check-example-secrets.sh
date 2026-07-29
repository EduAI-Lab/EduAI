#!/usr/bin/env bash
# Shared secret denylist for cmps01 edge deploy (#1115).
# Sourced by deploy-edge-proxy.sh and unit tests — do not execute directly.

# Known example / placeholder values that must never be used in a real deploy.
# Exact match, case-sensitive. Do not log the supplied secret.
CMPS01_EXAMPLE_SECRETS=(
  "vllm-local"
  "changeme-run-deploy-edge-proxy"
  "change-me-use-openssl-rand-hex-32"
)

# Usage: check_not_example_secret VAR_NAME
# Reads ${!VAR_NAME}. Exits 1 with a scrubbed FATAL message on empty/unset/example.
check_not_example_secret() {
  local var_name="${1:?var name required}"
  local value="${!var_name-}"

  if [ -z "${value}" ]; then
    echo "FATAL: ${var_name} is unset or empty; generate a real key with \`openssl rand -hex 32\`" >&2
    return 1
  fi

  local example
  for example in "${CMPS01_EXAMPLE_SECRETS[@]}"; do
    if [ "${value}" = "${example}" ]; then
      echo "FATAL: ${var_name} is a known example value; generate a real key with \`openssl rand -hex 32\`" >&2
      return 1
    fi
  done

  return 0
}

# CMPS01_INTERNAL_KEY is the shared edge secret: nginx X-EduAI-Internal-Key,
# LiteLLM master_key, and (on s378) VLLM_API_KEY — keep them identical (#1115).
check_cmps01_internal_key() {
  check_not_example_secret CMPS01_INTERNAL_KEY
}
