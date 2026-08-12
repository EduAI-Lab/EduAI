#!/usr/bin/env bash
# Shared secret denylist for cmps01 edge deploy (#1115).
# Sourced by deploy-edge-proxy.sh and unit tests — do not execute directly.

# Known example / placeholder values that must never be used in a real deploy.
# Matched case-insensitively (see check_not_example_secret). Do not log the
# supplied secret.
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

  if [ "${#value}" -lt 16 ]; then
    echo "FATAL: ${var_name} is too short; generate a real key with \`openssl rand -hex 32\`" >&2
    return 1
  fi

  # tr, not bash 4's ${var,,}, so this still works under macOS's bash 3.2.
  local example value_lower
  value_lower="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  for example in "${CMPS01_EXAMPLE_SECRETS[@]}"; do
    if [ "${value_lower}" = "$(printf '%s' "${example}" | tr '[:upper:]' '[:lower:]')" ]; then
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

# CMPS01_INTERNAL_ALLOW_IPS gates the nginx internal-path allowlist. Must be
# validated before any docker stop/rm/run so a missing allowlist fails closed
# up front rather than after vLLM containers have already been torn down (#1115).
check_cmps01_allow_ips() {
  if [ -z "${CMPS01_INTERNAL_ALLOW_IPS:-}" ]; then
    echo "FATAL: CMPS01_INTERNAL_ALLOW_IPS is unset; set it to s378 only (e.g. 206.87.25.229) — do not add laptops" >&2
    return 1
  fi
  return 0
}
