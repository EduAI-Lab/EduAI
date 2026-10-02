# vLLM and local inference

This is the current application-facing contract for local vLLM inference. Host
installation details belong in [`infra/cmps01/README.md`](../../infra/cmps01/README.md);
the shared development deployment is in
[`HOW_TO_USE_DEV_SERVER.md`](./HOW_TO_USE_DEV_SERVER.md).

## Request path

EduAI Core does not run vLLM inside Node. It calls an OpenAI-compatible endpoint
over HTTP and selects a served model with a registry id such as
`vllm:<served-model-id>`.

```text
EduAI Core (:3000)
    │  VLLM_BASE_URL or fleet-selected base URL
    ▼
cmps01 / cmps02 / ... (:8001)
    │
    └── vLLM or the configured OpenAI-compatible proxy
```

The campus deployment convention is port `8001`. The backend ports behind a
host are host-local implementation details; Core should use the configured
edge/base URL, not a backend port that is not reachable from the app host.

## Current server models

The current server inventory is Qwen 3.5 2B in the Small tier, Qwen 3.5 9B in
the Large tier on CMPS01/CMPS03, and Qwen 3.8 27B for Assist Auto on CMPS02.
The routing semantics, Auto-selection rules, and repository/deployment model-name
drift warning are documented in
[`MODEL_ROUTING.md`](./MODEL_ROUTING.md).

The exact served id for the Assist Auto model is `qwen3.8-27b-instruct`. Before
using it in another deployment, verify that it appears in that host's
`/v1/models` response and register the exact id in Core's active model catalog
with the intended routing tier and capabilities.

The exact API model ids are deployment values; use each host's `/v1/models`
response rather than deriving an id from the display name. Core's Auto routing
also requires a matching active `vllm` model row in the database—fleet
discovery alone does not create that row.

## Core configuration

For a single host, configure the server environment (never commit the real
secret):

```dotenv
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="<deployment secret>"
```

The provider is server-managed. A browser does not need a vLLM key. Core applies
the URL allowlist and API-key handling in the server provider/fleet code. In
production, use an explicit key shared with the protected inference edge; do not
use a placeholder value.

`VLLM_DISABLE_THINKING` controls whether Qwen3.5 thinking output is disabled for
vLLM chat requests. The default behavior is to disable it; set it to `0` only
when the model's reasoning output is explicitly required.

## Fleet configuration

Fleet routing is optional. The preferred configuration is a host-local,
gitignored `apps/core/fleet.config.json`, copied from
[`fleet.config.example.json`](../../apps/core/fleet.config.example.json):

```json
{
  "servers": [
    { "id": "cmps01", "baseUrl": "http://cmps01.ok.ubc.ca:8001", "jobTypes": ["interactive"] },
    { "id": "cmps02", "baseUrl": "http://cmps02.ok.ubc.ca:8001", "jobTypes": ["interactive"] },
    { "id": "cmps03", "baseUrl": "http://cmps03.ok.ubc.ca:8001", "jobTypes": ["interactive"] }
  ]
}
```

`models` is optional in this file. Core probes each host's `/v1/models` and uses
the live response for eligibility; static model lists are only a fallback when
the live probe cannot supply model ids.

If the structured file is absent, Core falls back to:

```dotenv
VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001,http://cmps03.ok.ubc.ca:8001"
# Leave VLLM_FLEET_HEAVY_URL unset; background AI jobs are disabled pre-MVP.
# Use the exact served ids returned by /v1/models for the current deployment.
VLLM_FLEET_DEFAULT_MODELS="qwen3.5-2b-instruct,qwen3.5-9b-instruct"
```

Live `/v1/models` discovery remains authoritative. If the legacy fallback path
is used, keep `VLLM_FLEET_DEFAULT_MODELS` aligned with the standard small/large
model IDs above; CMPS02's Assist Auto model is selected separately.

The interactive pool serves user-facing chat/tutor work. CMPS03 is classified
as interactive-only and must not be assigned to the heavy/background pool. With
no heavy pool configured, background work falls back to the interactive pool;
that fallback should be monitored because it shares capacity with interactive
requests. Selection, affinity, health, and ejection details are in
[`MODEL_ROUTING.md`](./MODEL_ROUTING.md).

## CMPS03 operational status

CMPS03 is healthy for interactive fleet traffic as verified on 2026-09-02. Its
authenticated port-8001 `/v1/models` response advertises
`qwen3.5-2b-instruct` and `qwen3.5-9b-instruct`.

The former `HTTP 400 no_db_connection` / `No connected db.` response was caused
by the CMPS03 LiteLLM `master_key` not matching Core's `VLLM_API_KEY`. This
deployment is DB-less, so that response can be a misleading authentication
failure rather than evidence that a LiteLLM database is missing. Do not print
the key while checking alignment.

## Host health and retry behavior

The fleet health check calls `GET /v1/models`:

- default timeout: 5 seconds (`FLEET_HEALTH_TIMEOUT_MS`)
- default health-cache TTL: 30 seconds (`FLEET_HEALTH_CACHE_TTL_MS`)
- an invalid response shape is unhealthy
- an explicit empty model list is healthy but cannot satisfy a model request
- an inference failure ejects the host for 30 seconds by default
  (`FLEET_FAILURE_EJECTION_MS`), invalidates its cache, and permits one
  alternate healthy-host retry
- stream startup probing uses a 10-second soft deadline by default
  (`FLEET_STREAM_PROBE_MS`)

All duration overrides are bounded by the implementation. A host that is not
healthy or does not advertise the requested model is not eligible for routing.

## Admission and overflow

Local interactive work uses a process-local FIFO admission limit:

```dotenv
AI_MAX_INFLIGHT=8
AI_ADMISSION_WAIT_MS=15000
```

When local admission or fleet capacity is exhausted, a configured Bedrock
overflow path may be attempted. Bedrock is not a normal fleet member; its global
rate limit is an aggregate cost-control boundary. The relevant variables are
`AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`,
`BEDROCK_RATE_LIMIT`, and `BEDROCK_RATE_WINDOW_MS`.

## Smoke checks

From `apps/core`:

```bash
npm run vllm:smoke
npm run fleet:smoke
npm run fleet:extensions:smoke
```

`vllm:smoke` checks a single configured endpoint. `fleet:smoke` checks the
legacy environment-listed interactive and optional heavy hosts and their
`/v1/models` responses. `fleet:extensions:smoke` exercises Core's
`/api/completion` routing for interactive and background extension workloads.
These smoke scripts currently read the legacy fleet variables, even when the
runtime fleet registry prefers `fleet.config.json`; set those variables for the
smoke command or update the script before treating it as a structured-config
verification.

For an authenticated end-to-end RAG and concurrency run, use the controlled
harness described in [`PERFORMANCE.md`](./PERFORMANCE.md), not old benchmark
numbers committed to the repository.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| Connection refused or timeout | Check `VLLM_BASE_URL`/fleet URLs, port 8001 reachability, firewall, and `curl <host>/v1/models` from the app host. |
| Model unavailable | Compare the requested `vllm:<served-name>` with `/v1/models`; static defaults do not prove a model is loaded. |
| Unauthorized | Use the deployment's real `VLLM_API_KEY` and matching inference-edge key; never paste it into logs or docs. |
| `X-Fleet-Server` absent | The request may be using single-host mode, a non-vLLM provider, or a smoke script/configuration path that bypasses the fleet. |
| First token is slow | Inspect admission wait, fleet health/ejection, stream startup probe, model load, and `X-RAG-Latency-Ms` separately. Do not attribute total latency to RAG without measurements. |

## Code map

| Concern | File |
| --- | --- |
| vLLM provider registry | [`apps/core/app/lib/ai/providers.ts`](../../apps/core/app/lib/ai/providers.ts) |
| Server/provider URL and key handling | [`apps/core/app/lib/ai/providers.server.ts`](../../apps/core/app/lib/ai/providers.server.ts) |
| Fleet registry/config | [`apps/core/app/lib/ai/routing/fleet/registry.ts`](../../apps/core/app/lib/ai/routing/fleet/registry.ts) |
| Fleet selection and affinity | [`apps/core/app/lib/ai/routing/fleet/resolve-fleet.ts`](../../apps/core/app/lib/ai/routing/fleet/resolve-fleet.ts) |
| Health cache and host ejection | [`apps/core/app/lib/ai/routing/fleet/health.ts`](../../apps/core/app/lib/ai/routing/fleet/health.ts) |
| Host installation/operations | [`infra/cmps01/README.md`](../../infra/cmps01/README.md) |
