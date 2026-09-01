# Model and fleet routing

Routing has two layers:

1. **Model routing** resolves `auto` or `auto-llm` to a concrete model from the
   database-backed tier catalog.
2. **Fleet routing** resolves a vLLM request to a healthy inference host.

The implementation authorities are [`apps/core/app/lib/ai/routing/`](../../apps/core/app/lib/ai/routing/),
[`apps/core/app/lib/ai/routing/fleet/`](../../apps/core/app/lib/ai/routing/fleet/),
and the request integration in [`api/chat.ts`](../../apps/core/app/routes/api/chat.ts).

## Concrete models and Auto

A concrete id such as `google:gemini-2.5-flash` or
`vllm:qwen2.5-7b-instruct` bypasses Auto tier selection. `model=auto` uses
`ROUTER_MODE` (default `rules`); `model=auto-llm` explicitly uses the LLM
classifier. Supported router modes are `rules`, `knn`, `hybrid`, and `llm`.

### Current server model inventory

The current server inventory has two available Qwen models:

| Routing tier | Current server model | Intended use |
| --- | --- | --- |
| Small | Qwen 3.5 2B | Default and lower-cost interactive work when the request does not need a larger model |
| Large | Qwen 3.5 9B | Escalated or more capable interactive work, including requests that need stronger reasoning or tools |

Qwen 3.8 27B is intended as a future additional model. It is a planned
capacity upgrade, not a currently available server model, and should not be
documented or configured as an active route until it is deployed, exposed by
the server's `/v1/models`, and registered in Core's active model catalog with
the intended routing tier and capability flags.

For Auto to select either current server model, its exact served model id must
be registered as an active `vllm` model row with a router tier. Fleet discovery
of a model from `/v1/models` does not create or activate that database row.

The repository's seed data and legacy smoke examples still contain the older
`qwen2.5-7b-instruct` and `qwen2.5-32b-instruct` ids. Treat those values as
repository defaults that require alignment before reproducing the deployment;
they are not the current server inventory listed above. Verify the exact
served ids from each host's `/v1/models` response before changing fallback
configuration.

Auto is available only when the corresponding mode is enabled in Admin → AI
Models. If the client asks for a disabled mode, or sends no model while no Auto
mode is enabled, Core returns `400`.

The routing process is:

```text
request prompt + course/RAG signals
        │
        ├── rules: ordered intent/RAG/debug/complexity rules
        ├── knn: nearest routing exemplars and tier vote
        ├── hybrid: kNN above its confidence floor, otherwise rules
        └── llm: dedicated classifier with confidence handling
        │
        ▼
database model rows in tier 1 / 2 / 3
        │
        ▼
carbon/energy tie-break within the selected tier
        │
        ▼
concrete provider:model id
```

Rules prioritize tool requirements, debugging/complex reasoning, course-RAG
signals, and then the default tier. The default tier is usually tier 1; the
router can escalate when the prompt needs more capability. Strong retrieved
course context can be a signal for a smaller adequate model, but retrieval does
not automatically change a caller's concrete model selection.

When local vLLM-only routing is enabled with `ROUTING_LOCAL_VLLM_ONLY=1`, Auto
does not choose the cloud tier-2 path. The local deployment-aware mapping uses
the configured vLLM tier models instead.

## Routing configuration

The main variables in [`apps/core/.env.example`](../../apps/core/.env.example)
are:

| Variable | Role |
| --- | --- |
| `ROUTER_MODE` | Default Auto mode: `rules`, `knn`, `hybrid`, or `llm` |
| `ROUTING_DEFAULT_TIER` | Default tier when no escalation rule wins |
| `ROUTING_RAG_STRONG_SIM` / `ROUTING_RAG_TIER1_SIM` | Similarity signals used by routing/RAG policy |
| `ROUTING_CARBON_MODE` | `greener`, `quality`, or `balanced` tie-break policy |
| `ROUTING_CARBON_MODE_BY_COURSE` | Optional per-course carbon policy overrides |
| `ROUTING_KNN_EXEMPLARS_PATH` | Seed exemplar data for kNN mode |
| `ROUTING_KNN_K` / `ROUTING_KNN_MIN_SIM` | kNN neighborhood and confidence floor |
| `ROUTING_LLM_CLASSIFIER_MODEL` | Model used by the LLM classifier |
| `ROUTING_LLM_MIN_CONFIDENCE` | Classifier confidence floor |
| `ROUTING_LLM_CLASSIFIER_TIMEOUT_MS` | Classifier deadline |
| `VLLM_BASE_URL` | Restricts local Auto selection to the single vLLM provider when set |
| `ROUTING_LOCAL_VLLM_ONLY` | Explicit local-only routing switch |

Router decisions are recorded with the resolved model, tier, router version,
features, and energy/carbon data when available. The response exposes
`X-Routed-Model`, and Auto responses also expose `X-Routing-Tier` and
`X-Router-Version`.

## Fleet pools

Fleet routing applies to vLLM models and is independent of Auto's model tier.
The runtime prefers `fleet.config.json` and falls back to legacy environment
lists when the file is absent.

| Job type | Intended work | Preferred pool |
| --- | --- | --- |
| `interactive` | User-waiting chat and tutor requests | Servers with `interactive` |
| `background` | Longer-running generation or extension work | Servers with `background`; falls back to interactive if no heavy pool is configured |

The registry filters hosts by job type. Live `/v1/models` probes determine which
hosts can serve the requested model. The optional `models` field in a structured
config is only a static fallback if a live probe cannot provide model ids.

Selection uses independent round-robin cursors for the effective pool. When an
`affinityKey` is supplied, rendezvous-style hashing keeps related requests on a
stable host and limits reshuffling when hosts change. Core returns the selected
host id in `X-Fleet-Server`.

The full fleet configuration and health timers are documented in
[`VLLM.md`](./VLLM.md). The important settings are:

```dotenv
FLEET_CONFIG_PATH="./fleet.config.json"
VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001"
VLLM_FLEET_HEAVY_URL="http://cmps03.ok.ubc.ca:8001"
VLLM_FLEET_DEFAULT_MODELS="qwen2.5-7b-instruct,qwen2.5-32b-instruct"
```

The structured file is host-specific and gitignored. Do not commit credentials
or production fleet URLs if the environment treats them as sensitive.

## Health, ejection, and fallback

Before host selection, Core checks `/v1/models` with a five-second default
timeout and a 30-second default cache. Invalid JSON shape is unhealthy; an
explicit empty model list is healthy but cannot satisfy any model.

After an inference failure, a host is ejected for 30 seconds by default and its
health cache is invalidated. The request may retry once on another healthy host.
Streaming uses a soft startup probe (`FLEET_STREAM_PROBE_MS`, default 10 seconds)
so lazy provider streams are actually started before Core reports readiness.

Local admission is a separate process-local capacity boundary. If admission
times out, the route may use configured Bedrock overflow. Bedrock is not a fleet
pool member and is governed by an aggregate rate limit.

## Debugging checklist

1. Confirm whether the request used a concrete model or Auto with
   `X-Routed-Model`.
2. For Auto, inspect `X-Routing-Tier` and `X-Router-Version` and verify the
   corresponding database model row is active.
3. For vLLM, inspect `X-Fleet-Server` and compare the selected host's
   `/v1/models` response with the requested served model name.
4. Separate routing/admission delay from provider generation and retrieval using
   `X-Admission-Wait-Ms` and `X-RAG-Latency-Ms`.
5. If a host was recently unhealthy, account for its ejection window before
   interpreting traffic distribution.

## Code map

| Concern | File |
| --- | --- |
| Router mode and Auto integration | [`apps/core/app/lib/ai/routing/router.ts`](../../apps/core/app/lib/ai/routing/router.ts) |
| Ordered rules | [`apps/core/app/lib/ai/routing/rules.ts`](../../apps/core/app/lib/ai/routing/rules.ts) |
| Tier model selection | [`apps/core/app/lib/ai/routing/tiers.ts`](../../apps/core/app/lib/ai/routing/tiers.ts) |
| kNN and LLM classifier modes | [`apps/core/app/lib/ai/routing/knn.ts`](../../apps/core/app/lib/ai/routing/knn.ts), [`apps/core/app/lib/ai/routing/llm-classifier.ts`](../../apps/core/app/lib/ai/routing/llm-classifier.ts) |
| Fleet registry | [`apps/core/app/lib/ai/routing/fleet/registry.ts`](../../apps/core/app/lib/ai/routing/fleet/registry.ts) |
| Fleet host selection | [`apps/core/app/lib/ai/routing/fleet/resolve-fleet.ts`](../../apps/core/app/lib/ai/routing/fleet/resolve-fleet.ts) |
| Fleet health | [`apps/core/app/lib/ai/routing/fleet/health.ts`](../../apps/core/app/lib/ai/routing/fleet/health.ts) |
