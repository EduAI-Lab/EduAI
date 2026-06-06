# vLLM on cmps01 — developer guide

Run **vLLM** on the shared GPU host (**cmps01**) for fast, multi-user chat inference. EduAI talks to it through the **`vllm`** provider (`POST /v1/chat/completions`, OpenAI-compatible).

**Not Ollama:** vLLM loads **Hugging Face** weights (e.g. `Qwen/Qwen2.5-7B-Instruct`), not Ollama GGUF blobs.

| | |
| --- | --- |
| **Host port (public)** | **8001** — LiteLLM proxy (`network_mode: host`) → backends `127.0.0.1:18001` / `:18002` |
| **Dev app** | `dev.eduai.ok.ubc.ca` (s378) → `http://cmps01.ok.ubc.ca:8001` |
| **Seed models** | `vllm:qwen2.5-7b-instruct`, `vllm:qwen2.5-32b-instruct` |
| **Issues** | [#435](https://github.com/EduAI-Lab/EduAI/issues/435) install/wire · [#394](https://github.com/EduAI-Lab/EduAI/issues/394) tiered memory spike |

---

## New dev? Start here

### 1. What you get vs Ollama

| | **vLLM** (`:8001`) | **Ollama** (`:11434`) |
| --- | --- | --- |
| **Best for** | House chat model, concurrent users | Legacy models, **embeddings**, experiments |
| **Model format** | Hugging Face | GGUF |
| **While running** | Weights stay in VRAM | `keep_alive` TTL; ~**9–10 s** cold reload after unload |
| **Parallel load (measured)** | 10 users **~320–380 ms** | 5 users **~2.9 s** (same host, `qwen2.5:7b`) |
| **Idle GPU power** | **~28 W** (model resident) | varies |

Session **vLLM-S1** (Jun 2026, dev → cmps01): warm direct **~57 ms**; EduAI full stack median **~211 ms**; zero errors under 5–10 parallel direct requests. Details in [Stress test results](#stress-test-results-session-vllm-s1-jun-2026).

### 2. Five-minute dev setup

**On s378** — add to `apps/core/.env`:

```env
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Restart the dev server (tmux). Then:

```bash
cd apps/core
npm run vllm:smoke
```

**In the app:** Settings → **Enable vLLM** → chat model **`vllm:qwen2.5-7b-instruct`** or **`vllm:qwen2.5-32b-instruct`** (run `npx prisma db seed` if missing from Admin).

**Admins:** Models are **seeded** — do not use **Create Model** for the same `modelId` (409 Conflict). **Admin → AI Models → Refresh list** (vLLM provider) only when adding a *new* served name from cmps01.

### 3. Who does what

| Role | Task |
| --- | --- |
| **You (dev)** | `.env`, enable provider, pick model, run smoke/bench |
| **IT / ops** | Firewall dev → cmps01 **TCP 8001**, Docker GPU on cmps01 |
| **On cmps01** | vLLM backends + LiteLLM proxy (see [`infra/cmps01/README.md`](../../infra/cmps01/README.md)) |

---

## Architecture

```text
dev.eduai.ok.ubc.ca (s378)          cmps01
        │                              │
        │  VLLM_BASE_URL :8001         │  eduai-vllm-proxy (LiteLLM, host network)
        └──────────────────────────────►       ├── 127.0.0.1:18001 → eduai-vllm (7B, GPU 0)
                                               └── 127.0.0.1:18002 → eduai-vllm-t3 (32B AWQ, GPU 1)
Ollama :11434 — embeddings + legacy chat (separate service)
```

LiteLLM uses **`network_mode: host`** so it can reach backends on host loopback. Bridge networking + `host.docker.internal` **does not** work for `127.0.0.1`-bound ports on Linux.

---

## Install on cmps01 (production)

**Use the repo ops bundle** — do not publish vLLM backends on `:8001`/`:8002` directly:

| Doc / path | Purpose |
| --- | --- |
| [`infra/cmps01/README.md`](../../infra/cmps01/README.md) | Migration checklist, container names, troubleshooting |
| [`infra/cmps01/migrate.sh`](../../infra/cmps01/migrate.sh) | One-shot recreate backends + start proxy |
| [`infra/cmps01/docker-compose.yml`](../../infra/cmps01/docker-compose.yml) | LiteLLM proxy (`network_mode: host`, port **8001**) |
| [`infra/cmps01/litellm-config.yaml`](../../infra/cmps01/litellm-config.yaml) | Routes model ids → `:18001` / `:18002` |

**Deployed containers (Jun 2026):**

| Name | Bind | Model id |
| --- | --- | --- |
| `eduai-vllm` | `127.0.0.1:18001` | `qwen2.5-7b-instruct` |
| `eduai-vllm-t3` | `127.0.0.1:18002` | `qwen2.5-32b-instruct` |
| `eduai-vllm-proxy` | host `:8001` | both (via LiteLLM) |

Copy `infra/cmps01` to cmps01 (`~/cmps01`), then `docker compose up -d` after backends are on `18001`/`18002`.

<details>
<summary>Legacy single-container install (superseded)</summary>

Single public `:8001` vLLM container — replaced by LiteLLM + two backends so **one firewall port** serves **two models**:

```bash
docker run -d --name eduai-vllm --gpus all \
  -p 8001:8000 ...  # do not use for multi-model production
```
</details>

<details>
<summary>venv fallback (if Docker blocked)</summary>

```bash
export VLLM_PORT=8001
python3 -m venv ~/vllm-venv && source ~/vllm-venv/bin/activate
pip install -U pip vllm
vllm serve Qwen/Qwen2.5-7B-Instruct --host 0.0.0.0 --port ${VLLM_PORT} \
  --served-model-name qwen2.5-7b-instruct --gpu-memory-utilization 0.85 --max-model-len 8192
```
</details>

---

## IT / firewall

EduAI on **s378** must reach cmps01 on **HTTP 8001** (same pattern as Ollama **11434**).

| Approach | Firewall? | Notes |
| --- | --- | --- |
| **A — dev → cmps01 HTTP** | **Yes** | Recommended. Ticket: source = dev app server, dest = cmps01, port = **8001**. |
| **B — SSH tunnel from s378** | No | **Not viable** — SSH to cmps01 times out from dev (2026-06). |
| **C — cmps01 localhost only** | No | Laptop SSH + `curl localhost:8001` only; EduAI on dev needs **A**. |

**Text for IT:**

> Dev EduAI (`dev.eduai.ok.ubc.ca` / s378) needs OpenAI-compatible HTTP to cmps01 port **8001**, plus **host firewall** on cmps01. Same as Ollama **11434**. SSH from s378 is not available.

Permissions: prefer **Docker** over large venv; **docker group** for deployers; sudo via ops (`rbuti`, `shlok10`, Dr Mohamed) for NVIDIA container toolkit if `--gpus all` fails.

---

## Verify

### Smoke test

```bash
cd apps/core
npm run vllm:smoke
# 32B (slower first token):
VLLM_MODEL=qwen2.5-32b-instruct npm run vllm:smoke
```

Reads `apps/core/.env` automatically. On cmps01 (proxy + auth):

```bash
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
curl -s http://127.0.0.1:8001/v1/chat/completions \
  -H "Authorization: Bearer vllm-local" -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5-7b-instruct","messages":[{"role":"user","content":"Say hi"}],"max_tokens":16}'
```

### EduAI bench (full stack)

Use **`CHAT_BENCH_X_API_KEY`** from `.env` (admin API key), not a browser cookie placeholder:

```bash
cd apps/core
CHAT_BENCH_LABEL=vllm-eduai-seq \
CHAT_BENCH_MODEL=vllm:qwen2.5-7b-instruct \
CHAT_BENCH_API_KEYS='{"vllm":{"isEnabled":true}}' \
CHAT_BENCH_COUNT=10 CHAT_BENCH_WARMUP=1 \
npm run bench:chat
```

Ensure `CHAT_BENCH_URL=https://dev.eduai.ok.ubc.ca/api/chat` is set in `.env`.

---

## Stress test results (Session vLLM-S1, Jun 2026)

**Environment:** dev (s378) → `cmps01:8001`, model **`qwen2.5-7b-instruct`**, container **`eduai-vllm`**. Direct tests: `POST /v1/chat/completions`, non-streaming, short prompts.

### Summary

| Probe | Path | N | Result | HTTP |
| --- | --- | ---: | --- | ---: |
| Warm sequential | direct `/v1` | 5 | **~57 ms** median (runs 2–5); run 1 **77 ms** | 200 |
| Parallel | direct `/v1` | 5 | **~195 ms** (184–215 ms) | 200 |
| Parallel | direct `/v1` | 10 | **~348 ms** (317–380 ms) | 200 |
| Parallel | Ollama `/api/generate` | 5 | **~2.9 s** (2.79–3.16 s), `qwen2.5:7b` | 200 |
| EduAI full stack | `POST /api/chat` | 5 | **211 ms** median (122–587 ms) | 200 |
| First request after restart | direct `/v1` | 2 | **218 ms**, then **157 ms** | 200 |

**Headlines:**

- **~15× faster** than Ollama under 5-way parallel short prompts.
- **No OOM / 5xx** through 10 concurrent direct requests.
- **Post-restart inference** (server already loaded, API listening): **~218 ms** first request — not Ollama’s **~9 s** reload. Full container boot (weights into VRAM) is separate — watch `docker logs` until Uvicorn ready.

### EduAI bench detail (`vllm-eduai-seq`)

| # | ms | Prompt |
| ---: | ---: | --- |
| 1 | 167 | Reply: ok |
| 2 | 122 | 19 + 23 |
| 3 | 587 | Photosynthesis (longer answer) |
| 4 | 316 | Three North American countries |
| 5 | 211 | What does HTTP stand for? |

### Reproduce

```bash
export VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001
export VLLM_MODEL=qwen2.5-7b-instruct

# Warm sequential
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "run $i %{time_total}s\n" \
    "$VLLM_BASE_URL/v1/chat/completions" \
    -H "Authorization: Bearer vllm-local" -H "Content-Type: application/json" \
    -d "{\"model\":\"$VLLM_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with one word: ok.\"}],\"max_tokens\":16,\"stream\":false}"
done

# 10 parallel
seq 1 10 | xargs -P10 -I{} curl -s -o /dev/null -w "req {} %{http_code} %{time_total}s\n" \
  "$VLLM_BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer vllm-local" -H "Content-Type: application/json" \
  -d "{\"model\":\"$VLLM_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hi.\"}],\"max_tokens\":32,\"stream\":false}"

# After docker restart (cmps01), when logs show ready:
time curl -s -o /dev/null -w "HTTP %{http_code} %{time_total}s\n" \
  "$VLLM_BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer vllm-local" -H "Content-Type: application/json" \
  -d "{\"model\":\"$VLLM_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}],\"max_tokens\":8,\"stream\":false}"
```

Log rows in [`latency/MODEL_LATENCY_TRACKER.md`](./latency/MODEL_LATENCY_TRACKER.md).

### Conclusions (#394)

- Ollama has **no RAM warm tier** after VRAM unload; vLLM **resident VRAM** avoids day-to-day cold reload.
- **Multi-user:** vLLM continuous batching wins under parallel load; use vLLM for house chat, Ollama for embeddings.
- **Energy:** ~**28 W** idle on vLLM GPU — 24/7 resident feasible on dev ([Energy](#energy-and-residency)).
- **Phase 3 residency router:** deferred.

---

## Energy and residency

### Always resident while the container runs

vLLM keeps weights in **VRAM** until the container stops. No Ollama-style `keep_alive` auto-unload.

- **Container up** → warm chat (~57 ms direct).
- **Container restart** → wait for model load in logs, then first HTTP request ~**200 ms** (measured); full boot can take minutes.

### Measured power (cmps01, Jun 2026)

`nvidia-smi --query-gpu=power.draw --format=csv -l 5`

| State | GPU 0 (vLLM) | GPU 1 (idle) |
| --- | --- | --- |
| Idle, model resident | **~28 W** | **~19 W** |
| Single user chatting | **65–299 W** bursts | ~19 W |
| After chat | back to **~29 W** | ~19 W |

**~0.67 kWh/day** extrapolated (GPU 0 idle only). Inference spikes are brief, not 300 W continuous.

### Sleep mode (optional, off-hours)

[vLLM Sleep Mode](https://docs.vllm.ai/en/stable/features/sleep_mode/) — free VRAM without removing the container. Requires `--enable-sleep-mode` at startup (verify image version).

| Level | Behavior | Typical wake |
| --- | --- | --- |
| **1** | Weights → CPU RAM | ~2–3 s |
| **2** | Weights discarded | ~7–8 s+ |
| **3** | Weights on GPU; KV dropped | fastest |

```bash
curl -X POST 'http://127.0.0.1:8001/sleep?level=1'
curl -X POST 'http://127.0.0.1:8001/wake_up'
```

**Simpler ops alternative:** cron `docker stop eduai-vllm` nights / `docker start` before class.

Not wired in EduAI yet — manual or future ops ticket.

---

## Multiple models (one firewall port)

**One vLLM process = one base model.** For two models on two GPUs, run **two backend containers** on **host loopback** (`127.0.0.1:18001`, `:18002`) and a **LiteLLM proxy** on public **:8001** with **`network_mode: host`**.

| Layer | Port | Firewall from dev? |
| --- | --- | --- |
| LiteLLM proxy (`eduai-vllm-proxy`) | **8001** (host network) | **Yes** (only this one) |
| vLLM backend 1 (`eduai-vllm`) | 127.0.0.1:18001 | No |
| vLLM backend 2 (`eduai-vllm-t3`) | 127.0.0.1:18002 | No |

**Setup:** [`infra/cmps01/README.md`](../../infra/cmps01/README.md) — `migrate.sh` or manual steps, then `docker compose up -d`.

**Adding a third model:** new localhost backend + config row + proxy restart — **no new IT ticket**.

EduAI always uses one `VLLM_BASE_URL`; chat picks the model via `vllm:<served-model-name>`.

| Pattern | When |
| --- | --- |
| **LiteLLM proxy (recommended)** | 2+ models, one firewall port |
| **LoRA adapters** | Same base, course finetunes |
| **Sleep / wake** | Swap models — not simultaneous |

---

## Shared cmps01 rules

- Do **not** run huge 31B vLLM + large Ollama model simultaneously — VRAM contention.
- Default: leave vLLM up during dev/teaching windows (~28 W idle).
- **`supportsTools: false`** on seeded vLLM model (hybrid RAG path) until vLLM tool-call flags are configured on the server.
- Embeddings stay on **cloud or Ollama** — not vLLM. Keep **`vector(3072)`** in sync with your embed provider on dev ([`EMBEDDINGS.md`](./EMBEDDINGS.md)).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Connection refused from dev | `VLLM_BASE_URL` in server `.env`; firewall **8001**; `curl http://cmps01:8001/v1/models` from s378 |
| SSL / wrong version number | Use **`http://`** not `https://` for vLLM |
| `/models` OK, chat **500** “Connection error” | LiteLLM cannot reach backends — use **`network_mode: host`** on proxy + `127.0.0.1:18001` in config ([`infra/cmps01/README.md`](../../infra/cmps01/README.md)) |
| 404 model | `curl /v1/models` — use exact `id` in chat (`qwen2.5-7b-instruct`) |
| EduAI “provider not configured” | Settings → Enable vLLM; set `VLLM_BASE_URL` in server `.env`; restart dev (tmux) |
| Admin **409** adding model | Model already seeded — use existing row, don’t duplicate |
| Chat empty / no reply | Run `npm run vllm:smoke`; check Network tab on `POST /api/chat` |
| RAG vector dimension error | DB `vector(3072)` vs local 1024 embed mismatch — re-embed on same branch/stack |
| OOM | Lower `--gpu-memory-utilization` or smaller model |
| Vite / prisma.client error | `providers.server.ts` split — pull latest `feat/VLLM` |
| Bench HTTP 401 | Use `CHAT_BENCH_X_API_KEY`, not placeholder cookie |

---

## Related

| Doc | Purpose |
| --- | --- |
| [`HOW_TO_USE_DEV_SERVER.md`](./HOW_TO_USE_DEV_SERVER.md) | SSH, tmux, branch switching on s378 |
| [`HOW_TO_USE_DEV_SERVER.md`](./HOW_TO_USE_DEV_SERVER.md) § cmps01 | Quick `.env` for Ollama + vLLM |
| [`EMBEDDINGS.md`](./EMBEDDINGS.md) | pgvector / embed provider (separate from vLLM chat) |
| [`latency/MODEL_LATENCY_TRACKER.md`](./latency/MODEL_LATENCY_TRACKER.md) | Formal latency ledger |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | cmps01 GPU inference section |
| `apps/core/app/lib/ai/providers.ts` | `vllm` provider code |
| `apps/core/scripts/vllm-smoke.mjs` | Smoke test script |
