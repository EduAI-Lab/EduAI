# EduAI — Spreading AI requests across multiple servers

> **For:** EduAI dev team  
> **Status:** Draft (June 2026)  
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

- Picking 7B vs 32B on a single server — that is separate research work (Auto routing). This doc is only about **which server**.
- Replacing vLLM with Ollama for chat  
- Using Bedrock for **embeddings** (vectors for search stay local on Ollama)

---

## Big picture — two simple steps

When a user sends a message, EduAI will eventually do two things in order:

```text
1. Which server should run this?     ← THIS PLAN (new)
2. Which model on that server?       ← Already exists for chat "Auto" (research; not team focus)
```

**Your team mainly builds step 1.** Step 2 stays as it is today when users pick Auto in chat. You do not need to understand the research rules for 7B vs 32B to work on multi-server routing.

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

Each server is set up the same way: **one URL** (`http://cmpsXX.ok.ubc.ca:8001`) that forwards to the models behind nginx + LiteLLM. See [`infra/cmps01/README.md`](../../../../infra/cmps01/README.md) and [`infra/cmps02/README.md`](../../../../infra/cmps02/README.md).

**Code-level detail:** see [Implementation architecture](#implementation-architecture) below.

---

## Our servers

All three are expected to have **two NVIDIA RTX 6000 Ada GPUs** (same class as cmps01). Each server should host **at most two models** (one per GPU).

| Server     | Status              | Models (today / planned)        | Main job                            |
| ---------- | ------------------- | ------------------------------- | ----------------------------------- |
| **cmps01** | Running             | 7B + 32B                        | Dev, research, chat                 |
| **cmps02** | Infra ready in repo | 7B + 32B (same stack as cmps01) | Extra capacity for **live chat**    |
| **cmps03** | Not set up yet      | TBD (likely 32B-focused)        | **Slow jobs** (e.g. Question Maker) |

**Note:** cmps02 can be deployed with the files in `infra/cmps02/`. Today the app still points at one server via `VLLM_BASE_URL` in `.env` — multi-server routing will change that.

### Cloud backup (later)

| Option                     | Who can use it      | Notes                                                        |
| -------------------------- | ------------------- | ------------------------------------------------------------ |
| **AWS Bedrock** (via LTIC) | Students, after PIA | Paid; Canada region; overflow only for now                   |
| **LTIC B300** (Vancouver)  | Instructors only    | Not for student-facing tools                                 |
| **CTL workstation**        | TBD                 | Useful stress-test numbers; may need booking for big classes |

Bedrock needs a **Privacy Impact Assessment** before student data goes there. Do not wire it into production until that is done.

---

## Route by *type of work*, not just model size

Different parts of EduAI care about different response times:

| Type of work              | Who uses it                            | How fast should it feel?                        | Send to                                                |
| ------------------------- | -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| **Live chat**             | EduAI chat, AI Tutor                   | Seconds; user is waiting on screen              | **Chat servers** — cmps01 and cmps02                   |
| **Harder live chat**      | Chat with tools, tough tutor questions | Still live, but can be a bit slower             | Server that has the **32B** model free                 |
| **Background generation** | Question Maker (questions, extraction) | Minutes are OK (already uses 60–180 s timeouts) | **cmps03** when it exists; don't block chat            |
| **Embeddings**            | Uploading course files, search         | User rarely waits on this directly              | **Separate** — Ollama on cmps01; not part of this plan |

**Why this matters:** Question Maker jobs are heavy and slow. If they share the same server as live chat, students in chat wait longer. We send slow work to a machine meant for batch jobs.

### What each app sends today

| App                | Calls                                        | Default model today | What we should add             |
| ------------------ | -------------------------------------------- | ------------------- | ------------------------------ |
| **EduAI chat**     | `POST /api/chat`                             | Auto                | Tag: `feature: chat`           |
| **AI Tutor**       | `POST /api/chat` (twice per student message) | Gemini (cloud)      | Tag: `feature: tutor`          |
| **Question Maker** | `POST /api/chat`                             | Gemini (cloud)      | Tag: `feature: question-maker` |

Extensions should pass a **feature name** (header or JSON field) so EduAI knows live chat vs Question Maker without guessing from the text.

---

## How to split models across servers (team decision)

We can only run **two models per server**. Two reasonable layouts:

### Option A — Every server the same

Every machine runs **7B + 32B**.

- **Pros:** Simple; any server can handle any request.  
- **Cons:** Three copies of the large model always loaded (uses power); chat and Question Maker still compete on the same boxes.

### Option B — Specialized servers (recommended)

| Server     | GPU 1 | GPU 2        | Role                                  |
| ---------- | ----- | ------------ | ------------------------------------- |
| **cmps01** | 7B    | 32B          | Dev + chat                            |
| **cmps02** | 7B    | *(spare)*    | **More chat capacity**                |
| **cmps03** | 32B   | *(optional)* | **Question Maker + large-model work** |

- **Pros:** Chat load spreads across cmps01 + cmps02; slow QM work stays off chat servers.  
- **Cons:** cmps03 becomes important for big jobs; we need health checks and a fallback if it is down.

**Recommendation:** Option B once cmps03 exists. cmps02 is already set up like cmps01 (7B + 32B) for now — we can later run **only 7B** on cmps02 if we want a dedicated chat pool.

---

## What we build in EduAI

### Where the logic lives

All “which server?” decisions should live in **EduAI Core** (`apps/core`), not inside LiteLLM on each machine.

- **EduAI** — knows the feature (chat vs Question Maker), checks which servers are healthy, picks one  
- **LiteLLM on each server** — unchanged; just forwards to the models on that box  

---

## Implementation architecture

This section describes **how the code changes** — where the new step plugs in, what files to add, and what stays the same.

### Request path: today vs with fleet routing

**Today** (`apps/core/app/routes/api/chat.ts`):

```text
POST /api/chat
  → RAG prefetch (course materials search — stays on EduAI + Postgres)
  → Auto model pick (7B vs 32B — research; team does not change this)
  → mergeLocalInferenceFromEnv()     ← reads one VLLM_BASE_URL from .env
  → createAIProviderRegistry()
  → streamText()                     ← HTTP call goes to that single server
```

**With fleet routing** — one new step before the registry is built:

```text
POST /api/chat
  → read routingContext.feature (chat | tutor | question-maker)
  → RAG prefetch (unchanged)
  → model is resolved (Auto or user picked a model id)
  → resolveFleetHost()               ← NEW: pick cmps01 | cmps02 | cmps03
  → mergeLocalInferenceFromEnv(..., chosenServerUrl)
  → createAIProviderRegistry()
  → streamText()                     ← HTTP call goes to the chosen server
```

**Important:** RAG and the database always run on the EduAI app server. Only the **model inference HTTP call** is sent to the picked GPU machine.

**Important:** Server pick happens **after** the model id is known (e.g. `vllm:qwen2.5-7b-instruct`). We filter to servers that actually host that model — a 32B-only job must not land on a 7B-only box.

The natural hook in existing code is just before `createAIProviderRegistry` in `chat.ts` (today `mergeLocalInferenceFromEnv` always uses the single `VLLM_BASE_URL` from `.env`).

### What does not change

| Piece | Why leave it alone |
|-------|-------------------|
| Auto model rules (7B vs 32B) | Separate research work |
| LiteLLM on each GPU host | Still a static proxy on port 8001 |
| RAG + embeddings | Stay on EduAI; Ollama for vectors |
| Cloud models (Gemini, etc.) | Fleet router only applies when using local `vllm:` models |
| Admin model catalog | Same model names on every host; env registry says which host has which |

### New code: `apps/core/app/lib/ai/routing/fleet/`

| File | Purpose |
|------|---------|
| `types.ts` | Server entry, pick result, feature names |
| `registry.ts` | Load server list from env (YAML file optional later) |
| `health.ts` | Ping `/v1/models`, cache results ~30 seconds |
| `resolve-fleet.ts` | Main function: pick a server for this request |

**Core types (sketch):**

```typescript
type WorkloadFeature = "chat" | "tutor" | "question-maker";

type FleetServer = {
  id: string;           // "cmps01"
  baseUrl: string;      // "http://cmps01.ok.ubc.ca:8001"
  features: WorkloadFeature[];
  models: string[];     // ["qwen2.5-7b-instruct", "qwen2.5-32b-instruct"]
  energySidecarUrl?: string;
};

type FleetPick = {
  serverId: string;
  baseUrl: string;
  energySidecarUrl?: string;
  reason: string;       // e.g. "chat-round-robin", "batch-only"
};
```

**MVP config via env** (no YAML required at first):

```env
# Chat pool — comma-separated; if unset, fleet routing is off (today's behavior)
VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001

# Slow / heavy work (Question Maker)
VLLM_FLEET_HEAVY_URL=http://cmps03.ok.ubc.ca:8001

# Fallback when fleet env is empty
VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001
```

Later, the same data can move to a `fleet-registry.yaml` file (see [Config (concept)](#config-concept) below).

### Server picker logic (version 1)

```text
1. Read feature from request (default: "chat").
2. If course materials must stay on campus → do not send to Bedrock (future).
3. Build candidate pool:
     chat / tutor     → VLLM_FLEET_CHAT_URLS
     question-maker   → VLLM_FLEET_HEAVY_URL
4. Drop servers that are unhealthy (failed health check).
5. Drop servers that do not host the resolved model id.
6. Pick one:
     v1 — round-robin among remaining chat servers
     later — prefer server with shorter queue / lower GPU load
7. If no server left → 503 with a clear error (or try Bedrock after PIA).
8. Log server id + reason on the request.
```

### Request body: feature tag

Extensions and chat send a small context object on `POST /api/chat`:

```json
{
  "messages": [ ... ],
  "model": "vllm:qwen2.5-32b-instruct",
  "routingContext": {
    "feature": "question-maker"
  }
}
```

| `feature` value | Meaning |
|-----------------|---------|
| `chat` | Default — live EduAI chat |
| `tutor` | AI Tutor (two calls per student message) |
| `question-maker` | Question Maker generation / extraction |

If omitted, treat as `chat` (backward compatible).

**Question Maker example** (`eduaiService.js`):

```javascript
await axios.post(`${eduaiBase}/api/chat`, {
  messages,
  model: resolvedModel,
  routingContext: { feature: "question-maker" },
}, { timeout: 180000 });
```

### Wiring in `chat.ts` (sketch)

After the model id is resolved (Auto or explicit):

```typescript
let fleetPick: FleetPick | null = null;

if (parsedModel.providerId === "vllm" && fleetRoutingEnabled()) {
  fleetPick = await resolveFleetHost({
    feature: routingContext?.feature ?? "chat",
    resolvedModelId,
    localOnly: Boolean(effectiveCourseId),
  });
}

const validatedApiKeysMerged = mergeLocalInferenceFromEnv(
  validatedApiKeys,
  resolvedModelId,
  fleetPick?.baseUrl,   // per-request server URL
);
```

### Small change to `mergeLocalInferenceFromEnv`

Today this function always uses `process.env.VLLM_BASE_URL`. Add an optional **per-request override**:

```typescript
mergeLocalInferenceFromEnv(
  userSettings,
  modelIdentifier?,
  vllmBaseUrlOverride?,   // NEW — from fleet pick
)
```

`createAIProviderRegistry` already reads `userSettings.vllm.baseUrl` — no change needed there.

### Health checks

Before sending traffic, ping each server (same check admin uses for the model list):

```bash
curl -H "Authorization: Bearer vllm-local" http://cmps02.ok.ubc.ca:8001/v1/models
```

In code: 5 second timeout, cache pass/fail for ~30 seconds per server so we do not ping on every chat message.

### Load sharing

| Version | How | When to use |
|---------|-----|-------------|
| **v1** | Round-robin across healthy chat servers | First release (cmps01 + cmps02) |
| **v2** | Track recent picks / simple counters | If one server gets hot spots |
| **v3** | Use queue depth or GPU metrics | When we have better observability |

### Energy measurement per server

Today `ENERGY_SIDECAR_URL` points at one host. When a request runs on cmps02, Joules should come from **that** host’s sidecar (e.g. `http://cmps02.ok.ubc.ca:8001/energy`). Pass the picked server’s sidecar URL into the energy helper for that request.

### Telemetry and response headers

Log on each request (inside existing `routerFeatures` JSON — no DB migration required at first):

- `fleetServerId` — e.g. `"cmps02"`
- `fleetReason` — e.g. `"chat-round-robin"`
- `feature` — e.g. `"question-maker"`

Optional response header for debugging: `X-Fleet-Server: cmps02`.

### Code areas to touch

| Area | Change |
|------|--------|
| `apps/core/app/routes/api/chat.ts` | Parse `routingContext`; call fleet picker after model resolved; pass URL into registry |
| `apps/core/app/lib/ai/provider-types.ts` | `mergeLocalInferenceFromEnv` accepts optional base URL override |
| `apps/core/app/lib/ai/routing/fleet/*` | **New** — registry, health, resolve |
| `apps/core/app/lib/ai/routing/telemetry.ts` | Include `fleetServerId` in logged features |
| `apps/core/app/lib/ai/energy/measurement.server.ts` | Optional per-request sidecar URL |
| Question Maker `eduaiService.js` | Send `routingContext: { feature: "question-maker" }` |
| AI Tutor `aiGuidance.js` | Send `routingContext: { feature: "tutor" }` |
| `infra/cmps02/`, `infra/cmps03/` | Deploy scripts (cmps02 done) |

### End-to-end examples

**Student chat (Auto, course RAG):**

1. Request arrives; `feature` defaults to `chat`.
2. RAG search runs on EduAI against Postgres.
3. Auto picks `vllm:qwen2.5-7b-instruct` (unchanged research path).
4. Fleet router: chat pool = [cmps01, cmps02]; both healthy; round-robin → **cmps02**.
5. Registry uses `http://cmps02.ok.ubc.ca:8001`.
6. Answer streams from cmps02’s 7B GPU.
7. Log shows `fleetServerId: "cmps02"`.

**Question Maker extraction (3 minute timeout):**

1. QM sends `feature: "question-maker"`, model `vllm:qwen2.5-32b-instruct`.
2. Fleet router: heavy pool = [cmps03] → **cmps03**.
3. Long job runs there; chat users on cmps01/02 are not blocked.

---

### Simple rules (version 1) — summary

1. Read **feature** from the request (`chat`, `tutor`, `question-maker`).
2. If the request uses **course materials** and must stay on campus → do not send to Bedrock.
3. **Chat / tutor** → pick from chat server list (cmps01, cmps02).
4. **Question Maker** → pick heavy server (cmps03) when available.
5. Only pick servers that host the **resolved model** and pass **health check**.
6. If the chosen server is down → try the next one, or return a clear error.
7. Log **which server** handled the request.

### Config (concept)

YAML registry (optional later; env vars are enough for MVP):

```yaml
servers:
  - name: cmps01
    url: http://cmps01.ok.ubc.ca:8001
    for: [chat, tutor]
    models: [qwen2.5-7b-instruct, qwen2.5-32b-instruct]
  - name: cmps02
    url: http://cmps02.ok.ubc.ca:8001
    for: [chat, tutor]
    models: [qwen2.5-7b-instruct, qwen2.5-32b-instruct]
  - name: cmps03
    url: http://cmps03.ok.ubc.ca:8001
    for: [question-maker]
    models: [qwen2.5-32b-instruct]
```

---

## Rollout plan

Rollout has **ops steps** (deploy servers) and **code slices** (ship incrementally).

### Ops steps

| Step | What | Done when |
|------|------|-----------|
| **1. Inventory** | cmps02 deployed; cmps03 planned with IT | cmps02 answers `curl …/v1/models` from dev server |
| **2. Failover** | Second server URL in env; manual switch if primary dies | Ops can point `VLLM_BASE_URL` at cmps02 |
| **3. Feature tags** | QM and Tutor tell EduAI what kind of request it is | Extensions merged |
| **4. Chat load sharing** | EduAI alternates chat between cmps01 + cmps02 | Load test with many fake users |
| **5. Heavy server** | Question Maker goes to cmps03 | QM works with local models on cmps03 |
| **6. Load test** | Simulate a classroom on multiple servers | Response times better than one server alone |
| **7. Bedrock overflow** | Cloud only when local is full | After PIA approved |

### Code slices (smallest useful PRs)

| Slice | What ships | Proves |
|-------|------------|--------|
| **Slice 1** | Health check + `VLLM_FLEET_CHAT_URLS`; failover if primary down | Second server works without feature tags |
| **Slice 2** | `routingContext.feature`; QM → `VLLM_FLEET_HEAVY_URL` | Slow jobs isolated from chat |
| **Slice 3** | Round-robin + `fleetServerId` in telemetry | Load spread + observability |
| **Slice 4** | Extension patches (QM, Tutor) | End-to-end feature routing |

Steps 1–4 and Slices 1–3 are the priority. Research on Auto model picking can continue on cmps01 in parallel.

---

## Question Maker and waiting in line

Question Maker already allows **up to 3 minutes** per request. That is fine for a dedicated server.

Two approaches:

1. **Simple (start here):** Same as today — hold the HTTP connection, but send the work to cmps03.
2. **Later:** Submit a job, get a job ID, poll for the result — better if the queue gets long.

CTL and faculty agreed that **not everything must be instant**; slow generation is acceptable if users know what to expect.

---

## LiteLLM — what we use it for

| Use                                          | Keep?                                     |
| -------------------------------------------- | ----------------------------------------- |
| On each server, proxy port 8001 → local vLLM | **Yes** — already works on cmps01/cmps02  |
| LiteLLM “smart router” to pick 7B vs 32B     | **No** — that stays in EduAI for research |
| LiteLLM to fail over to Bedrock              | **Maybe later** — after PIA               |

---

## Decisions we still need

| #   | Question                                               | Lean                                             |
| --- | ------------------------------------------------------ | ------------------------------------------------ |
| 1   | Same models on all servers, or specialized (Option B)? | Specialized                                      |
| 2   | cmps02: both models or 7B only for chat?               | Decide after first load test                     |
| 3   | Question Maker: keep long HTTP wait or add job queue?  | Long wait first                                  |
| 4   | AI Tutor: stay on Gemini or move to local servers?     | Local after chat sharing works                   |
| 5   | Class exam windows: book a server with CTL?            | Optional; fleet helps but booking may still help |

---

## How we know it is working

| Check                                      | Target                                    |
| ------------------------------------------ | ----------------------------------------- |
| 30 simulated chat users across two servers | Noticeably better than one server         |
| Chat errors under load                     | Less than 1% failed requests              |
| Question Maker jobs                        | Almost all finish within 3 minutes        |
| Logs                                       | Every request shows which server was used |

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [`TEAM_ROUTING_LAYER_PLAN.md`](./TEAM_ROUTING_LAYER_PLAN.md) | Single-server Auto routing (research) |
| [`../../../../infra/cmps01/README.md`](../../../../infra/cmps01/README.md) | First GPU server setup |
| [`../../../../infra/cmps02/README.md`](../../../../infra/cmps02/README.md) | Second GPU server setup |
| [`../../VLLM.md`](../../VLLM.md) | vLLM provider and smoke tests |

---

*Last updated: 2026-06-26 — team guide + implementation architecture*
