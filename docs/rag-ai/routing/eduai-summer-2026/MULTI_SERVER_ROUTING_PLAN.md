# EduAI — Spreading AI requests across multiple servers

> **For:** EduAI dev team  
> **Status:** Slice 1 implemented (pick-time routing + health cache); Slice 2 implemented (one inference retry on alternate host after failure)  
> **Owner:** Saad (AI / infra)  
> **See also:** [TEAM_ROUTING_LAYER_PLAN.md](./TEAM_ROUTING_LAYER_PLAN.md) (single-server Auto routing — research)

---

## What problem are we solving?

The interactive local AI fleet uses **cmps01 and cmps02**. Each machine runs the same two models on two GPUs:

- **Qwen3.5 2B** — small-tier candidate for everyday chat
- **Qwen3.5 27B FP8** — large-tier candidate for harder tasks and tools

When several people use the chat **at the same time**, wait times climb quickly. CTL tested this on a similar setup: with 3 people at once, responses took about **6–13 seconds**; with 5 people, up to **~19 seconds**. We want EduAI in classrooms with **10–100 students** across many courses — one server will not be enough.

**What we want:** EduAI picks **which server** should handle each request, so load is spread across **three local GPU machines** (same hardware as cmps01). Cloud (AWS Bedrock) stays a **backup** for later, after privacy review — not the main path.

**What this plan does *not* cover:**

- Picking 7B vs 32B on a single server — separate research work (Auto routing). This doc is only about **which server**.
- Replacing vLLM with Ollama for chat  
- Using Bedrock for **embeddings** (vectors for search stay local on Ollama)

---

## Big picture — two simple steps

When a user sends a message, EduAI does two things in order:

```text
1. Which server should run this?     ← fleet router (this plan)
2. Which model on that server?       ← Auto routing (research; not team focus)
```

**Your team mainly owns step 1.** Step 2 stays as it is when users pick Auto in chat.

```text
User / Extension
       │
       ▼
   EduAI Core
       │
       ├──► Pick server (cmps01 or cmps02; cloud overflow later)
       │
       └──► Send request to that server's API (port 8001)
                 │
                 └──► vLLM runs the model on that machine
```

Each server exposes **one URL** (`http://cmpsXX.ok.ubc.ca:8001`) via nginx + LiteLLM. See [`infra/cmps01/README.md`](../../../../infra/cmps01/README.md).

**Code-level detail:** [Implementation architecture](#implementation-architecture) below.

---

## Job types — how we pick a server pool

Fleet routing uses two **job types**. They describe how long the user can wait, not which app sent the request.

| `JobType` | Meaning | Server pool (env) |
|-----------|---------|-------------------|
| **`interactive`** | User is waiting on screen (seconds) | `VLLM_FLEET_CHAT_URLS` |
| **`background`** | Minutes are OK (generation, extraction) | `VLLM_FLEET_HEAVY_URL` (falls back to chat pool if unset) |

Apps select the pool with **`routingContext.jobType`** only (no per-app feature tags):

```typescript
type JobType = "interactive" | "background";
```

| `routingContext.jobType` | Apps | Pool |
|--------------------------|------|------|
| `interactive` (default) | EduAI chat, AI Tutor | `VLLM_FLEET_CHAT_URLS` |
| `background` | Question Maker | `VLLM_FLEET_HEAVY_URL` (falls back to chat pool) |

Harder live chat is still **`interactive`** — the model ID (2B vs 27B) is chosen by Auto routing before the fleet step.

### Route by job type, not just model size

| Job type | Who uses it | How fast should it feel? | Send to |
|----------|-------------|--------------------------|---------|
| **`interactive`** | EduAI chat, AI Tutor, tool-heavy chat | Seconds | cmps01 + cmps02 (chat pool) |
| **`background`** | Question Maker (`jobType: "background"`) | Minutes OK (60–180 s timeouts) | chat pool until a model-compatible heavy pool exists |
| *(not fleet)* | Embeddings / RAG index | Not user-visible | Ollama on cmps01 |

**Why this matters:** Background jobs must not block interactive traffic on the same GPU host.

---

## Our servers

All three are expected to have **two NVIDIA RTX 6000 Ada GPUs**. Each host runs **at most two models** (one per GPU).

| Server | Status | Models | Main job |
|--------|--------|--------|----------|
| **cmps01** | Deployment profile | Qwen3.5 2B + 27B FP8 | Dev, research, interactive |
| **cmps02** | Deployment profile | Qwen3.5 2B + 27B FP8 | Mirrored **interactive** capacity |
| **cmps03** | Research profile | Qwen3.5 4B + 9B | v3 adequacy ladder; not a fleet pool |

When `VLLM_FLEET_CHAT_URLS` is set, fleet routing is **on**; otherwise the app uses single-host `VLLM_BASE_URL` only.

---

## Implementation architecture

### Request path (implemented on `feat/fleet-routing`)

```text
POST /api/chat
  → parse routingContext.jobType → JobType (default interactive)
  → RAG prefetch (unchanged — EduAI + Postgres)
  → resolve model id (Auto or explicit)
  → resolveFleetHost()          ← pick server from job-type pool
  → mergeLocalInferenceFromEnv(..., chosenServerUrl)
  → createAIProviderRegistry()
  → streamText()                  ← HTTP to chosen host
```

RAG stays on the app server. Only **inference** is sent to the picked GPU machine.

Server pick happens **after** the model id is known. Hosts that do not serve that model are excluded.

### Code layout (`apps/core/app/lib/ai/routing/fleet/`)

| File | Purpose |
|------|---------|
| `types.ts` | `JobType`, `parseJobType` |
| `registry.ts` | Load chat / heavy pools from env |
| `health.ts` | Ping `/v1/models`, 30 s cache |
| `resolve-fleet.ts` | Pick healthy host (round-robin) |

### Env config

```env
VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001
VLLM_FLEET_DEFAULT_MODELS=qwen3.5-2b,qwen3.5-27b
# VLLM_FLEET_HEAVY_URL intentionally unset: cmps03 serves different model IDs
VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001   # fallback when fleet env empty
```

### Request body

```json
{
  "messages": [ ... ],
  "model": "vllm:qwen3.5-27b",
  "routingContext": { "jobType": "interactive" }
}
```

Omit `routingContext` → `JobType: interactive`.

---

## Health checks and fallback during the cache window

Health results are cached for **~30 seconds** per host so we do not ping `/v1/models` on every message.

### At pick time (Slice 1 — **implemented**)

1. Map feature → `JobType` → server pool.  
2. Drop hosts that fail the cached or fresh health check.  
3. Drop hosts that do not list the resolved model.  
4. Round-robin among the rest.  
5. If **no** host qualifies → **503** immediately with `"No healthy vLLM fleet server available"` (not silent).

### During the stale cache window (Slice 2 — **implemented**)

If a host was marked healthy within the last ~30 s but **dies before the cache expires**, pick-time routing may still send traffic there. Behavior:

1. **On inference failure** to that host (connection refused, reset, or timeout to vLLM) → **invalidate** that host’s cache entry immediately (do not wait for TTL).  
2. **Retry the same request once** on the next eligible host in the same job-type pool.  
3. If the retry succeeds → normal response (logged with `fleetRetry: true`).  
4. If no host remains or the retry fails → existing chat error / **503** with a clear error.  
5. Log `fleetServerId`, failure reason, and retry status — operators debugging a mid-class outage can see retries, not silent drops.

**Startup probe (Slice 2 scope):** For every fleet `vllm:*` turn (streaming, non-streaming / `consumeStream`, and ADHD oversight), Core waits briefly for the first stream chunk/step (or an `onError`) before treating the host as usable, so connection/startup failures still throw inside the retry `try/catch`. Soft timeout: `FLEET_STREAM_PROBE_MS` (default `10000`).

**Deliberate tradeoffs (not retried):**

- Soft-timeout marks a silent/slow host as **ready** so TTFT is not blocked forever. After that, a late `onError` cannot trigger another host retry — the client sees the bad/hung stream. Operators who prefer fail-closed on dead hosts can lower `FLEET_STREAM_PROBE_MS`.
- Failures **after** the probe has settled (mid-stream disconnect, oversight rewrite errors, etc.) do **not** get a second host. Slice 2 is **startup-failure retry**, not full mid-stream failover.

`fleetRetry: true` is logged only after the alternate host attempt **succeeds**. A failed second attempt logs `[fleet] retry attempt` then surfaces the error with `fleetRetry: false` (no success marker).

`X-Fleet-Server` reflects the **final** host after a successful retry.

---

## Telemetry

Logged in `routerFeatures` (no schema migration required):

- `feature` — e.g. `"tutor"`
- `jobType` — `"interactive"` or `"background"`
- `fleetServerId` — e.g. `"cmps02"`
- `fleetReason` — e.g. `"interactive-round-robin"`
- `fleetRetry` — whether inference was retried on another host (Slice 2)

Optional response header: `X-Fleet-Server: cmps02`.

---

## Testing fleet routing

Run from **`apps/core`**. Host checks must run on a machine that can reach cmps (e.g. **s378 dev server**), not a typical off-campus laptop.

### 1. Unit tests (no GPUs)

```bash
npx vitest run app/tests/unit/fleet-routing.test.ts
```

Covers `routingContext.jobType` parsing, round-robin, 503 when no healthy host, and provider URL override.

### 2. Pre-flight — health-check every fleet host

```bash
# After setting VLLM_FLEET_CHAT_URLS in .env:
npm run fleet:smoke

# Or inline (no .env edit):
VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001" npm run fleet:smoke
```

Pings `GET /v1/models` on each URL in `VLLM_FLEET_CHAT_URLS` (and `VLLM_FLEET_HEAVY_URL` if set). Warns when expected models from `VLLM_FLEET_DEFAULT_MODELS` are missing.

Single-host check (legacy): `npm run vllm:smoke` with `VLLM_BASE_URL` set.

### 3. Enable fleet in `.env` and restart

```env
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001"
VLLM_API_KEY="<shared non-committed cmps01/cmps02 key>"
```

Restart the app after env changes — the fleet registry is cached at process start.

Fleet is **on** when `VLLM_FLEET_CHAT_URLS` is non-empty. Routing applies only to **`vllm:*`** models.

### 4. End-to-end — chat and verify pick

Send several chat messages with a vLLM model. Confirm `X-Fleet-Server: cmps01` (or `cmps02`) in the Network tab on `/api/chat` response headers. With two healthy hosts, the header should alternate across requests.

**Background / heavy pool:** call `resolveFleetHost` with `jobType: "background"` when `VLLM_FLEET_HEAVY_URL` is set (not via a feature tag).

### 5. Negative checks (optional)

| Scenario | Expected |
|----------|----------|
| `VLLM_FLEET_CHAT_URLS` unset | No `X-Fleet-Server`; uses `VLLM_BASE_URL` only |
| All fleet hosts unreachable | **503** `"No healthy vLLM fleet server available"` |
| Model not on any host | **503** with model name in `details` |
| Briefly stop one healthy vLLM (manual failover) | Chat logs `[fleet] retry attempt` then `fleetRetry: true` and succeeds on the other host; `X-Fleet-Server` is the survivor |

**Implemented:** Slice 2 inference retry after a stale health cache — dead mid-window hosts invalidate and retry once on another healthy host.

---

## Rollout

| Slice | Status | What |
|-------|--------|------|
| **1** | **Done** (`feat/fleet-slice1`) | Env pools, health cache, per-pool round-robin, 503 at pick time, `routingContext.jobType` pool selection |
| **2** | **Done** (`feat/fleet-slice2-retry`) | Inference startup failure → cache invalidate + one alternate-host retry; stream probe + process-local admission |
| **3** | Planned | Per-host energy sidecar URL; classroom load test |
| **4** | Planned | Bedrock overflow (PIA) |

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [TEAM_ROUTING_LAYER_PLAN.md](./TEAM_ROUTING_LAYER_PLAN.md) | Single-server Auto routing (research) |
| [../../../../infra/cmps01/README.md](../../../../infra/cmps01/README.md) | First GPU server |
| [../../VLLM.md](../../VLLM.md) | vLLM provider and smoke tests |

---

*Last updated: 2026-07-08 — Slice 1 fleet-only PR, testing section, `npm run fleet:smoke`*
