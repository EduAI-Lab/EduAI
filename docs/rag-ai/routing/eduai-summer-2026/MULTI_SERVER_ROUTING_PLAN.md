# EduAI — Spreading AI requests across multiple servers

> **For:** EduAI dev team  
> **Status:** Slice 1 implemented on `feat/fleet-routing` (pick-time routing + health cache); Slice 2 (inference retry) planned  
> **Owner:** Saad (AI / infra)  
> **See also:** [TEAM_ROUTING_LAYER_PLAN.md](./TEAM_ROUTING_LAYER_PLAN.md) (single-server Auto routing — research)

---

## What problem are we solving?

Right now, almost all local AI chat goes to **one machine** (`cmps01`). That machine runs two models on two GPUs:

- **Qwen 7B** — faster, good for everyday chat  
- **Qwen 32B** — slower, used for harder tasks and tools

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
       ├──► Pick server (cmps01, cmps02, cmps03, or cloud later)
       │
       └──► Send request to that server's API (port 8001)
                 │
                 └──► vLLM runs the model on that machine
```

Each server exposes **one URL** (`http://cmpsXX.ok.ubc.ca:8001`) via nginx + LiteLLM. See [`infra/cmps01/README.md`](../../../../infra/cmps01/README.md) and [`infra/cmps02/README.md`](../../../../infra/cmps02/README.md).

**Code-level detail:** [Implementation architecture](#implementation-architecture) below.

---

## Job types — how we pick a server pool

Fleet routing uses two **job types**. They describe how long the user can wait, not which app sent the request.

| `JobType` | Meaning | Server pool (env) |
|-----------|---------|-------------------|
| **`interactive`** | User is waiting on screen (seconds) | `VLLM_FLEET_CHAT_URLS` |
| **`background`** | Minutes are OK (generation, extraction) | `VLLM_FLEET_HEAVY_URL` (falls back to chat pool if unset) |

Extensions still send a **feature** tag for telemetry and debugging. EduAI maps it to a job type:

| `routingContext.feature` | Maps to `JobType` | Apps |
|--------------------------|-------------------|------|
| `chat` (default) | `interactive` | EduAI chat |
| `tutor` | `interactive` | AI Tutor |
| `question-maker` | `background` | Question Maker |

```typescript
type JobType = "interactive" | "background";
type WorkloadFeature = "chat" | "tutor" | "question-maker";
```

Harder live chat (tools, 32B) is still **`interactive`** — the model id (7B vs 32B) is chosen by Auto routing before the fleet step.

### Route by job type, not just model size

| Job type | Who uses it | How fast should it feel? | Send to |
|----------|-------------|--------------------------|---------|
| **`interactive`** | EduAI chat, AI Tutor, tool-heavy chat | Seconds | cmps01 + cmps02 (chat pool) |
| **`background`** | Question Maker | Minutes OK (60–180 s timeouts) | cmps03 when configured; else chat pool |
| *(not fleet)* | Embeddings / RAG index | Not user-visible | Ollama on cmps01 |

**Why this matters:** Background jobs must not block interactive traffic on the same GPU host.

---

## Our servers

All three are expected to have **two NVIDIA RTX 6000 Ada GPUs**. Each host runs **at most two models** (one per GPU).

| Server | Status | Models | Main job |
|--------|--------|--------|----------|
| **cmps01** | Running | 7B + 32B | Dev, research, interactive |
| **cmps02** | Infra in repo | 7B + 32B | Extra **interactive** capacity |
| **cmps03** | Planned | TBD (likely 32B) | **Background** (Question Maker) |

When `VLLM_FLEET_CHAT_URLS` is set, fleet routing is **on**; otherwise the app uses single-host `VLLM_BASE_URL` only.

---

## Implementation architecture

### Request path (implemented on `feat/fleet-routing`)

```text
POST /api/chat
  → parse routingContext.feature → JobType
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
| `types.ts` | `JobType`, `WorkloadFeature`, feature → job type, telemetry helpers |
| `registry.ts` | Load chat / heavy pools from env |
| `health.ts` | Ping `/v1/models`, 30 s cache |
| `resolve-fleet.ts` | Pick healthy host (round-robin) |

### Env config

```env
VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001
VLLM_FLEET_HEAVY_URL=http://cmps03.ok.ubc.ca:8001
VLLM_FLEET_DEFAULT_MODELS=qwen2.5-7b-instruct,qwen2.5-32b-instruct
VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001   # fallback when fleet env empty
```

### Request body

```json
{
  "messages": [ ... ],
  "model": "vllm:qwen2.5-32b-instruct",
  "routingContext": { "feature": "question-maker" }
}
```

Omit `routingContext` → `feature: chat` → `JobType: interactive`.

---

## Health checks and fallback during the cache window

Health results are cached for **~30 seconds** per host so we do not ping `/v1/models` on every message.

### At pick time (Slice 1 — **implemented**)

1. Map feature → `JobType` → server pool.  
2. Drop hosts that fail the cached or fresh health check.  
3. Drop hosts that do not list the resolved model.  
4. Round-robin among the rest.  
5. If **no** host qualifies → **503** immediately with `"No healthy vLLM fleet server available"` (not silent).

### During the stale cache window (Slice 2 — **planned**)

If a host was marked healthy within the last ~30 s but **dies before the cache expires**, pick-time routing may still send traffic there. Planned behavior:

1. **On inference failure** to that host (connection refused, reset, or timeout to vLLM) → **invalidate** that host’s cache entry immediately (do not wait for TTL).  
2. **Retry the same request once** on the next eligible host in the same job-type pool.  
3. If the retry succeeds → normal response (logged with `fleetRetry: true`).  
4. If no host remains or the retry fails → **503** with a clear error.  
5. Log `fleetServerId`, failure reason, and retry status — operators debugging a mid-class outage can see retries, not silent drops.

Until Slice 2 ships, requests sent to a stale-healthy dead host will **fail at inference time** with the usual chat error; they are **not** automatically retried on another server.

---

## Telemetry

Logged in `routerFeatures` (no schema migration required):

- `feature` — e.g. `"tutor"`
- `jobType` — `"interactive"` or `"background"`
- `fleetServerId` — e.g. `"cmps02"`
- `fleetReason` — e.g. `"interactive-round-robin"`
- `fleetRetry` — *(planned Slice 2)* whether inference was retried on another host

Optional response header: `X-Fleet-Server: cmps02`.

---

## Rollout

| Slice | Status | What |
|-------|--------|------|
| **1** | **Done** (`feat/fleet-routing`) | Env pools, health cache, round-robin, 503 at pick time, `JobType` mapping |
| **2** | Planned | Inference failure → cache invalidate + one retry; extension feature tags |
| **3** | Planned | Per-host energy sidecar URL; classroom load test |
| **4** | Planned | Bedrock overflow (PIA) |

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [TEAM_ROUTING_LAYER_PLAN.md](./TEAM_ROUTING_LAYER_PLAN.md) | Single-server Auto routing (research) |
| [../../../../infra/cmps01/README.md](../../../../infra/cmps01/README.md) | First GPU server |
| [../../../../infra/cmps02/README.md](../../../../infra/cmps02/README.md) | Second GPU server |
| [../../VLLM.md](../../VLLM.md) | vLLM provider and smoke tests |

---

*Last updated: 2026-06-26 — JobType (`interactive` / `background`), stale-cache fallback, aligned with `feat/fleet-routing` Slice 1*
