# vLLM on cmps01 — setup & EduAI wiring

**Goal:** Run **vLLM** alongside (or instead of) Ollama for **multi-user GPU serving** (Phase D / #394 Phase 2).  
**EduAI:** Uses provider `vllm` → OpenAI-compatible `POST /v1/chat/completions`.

**Not the same as Ollama:** vLLM loads **Hugging Face** weights, not Ollama GGUF blobs. You need HF model IDs (e.g. `Qwen/Qwen2.5-7B-Instruct`).

**Default host port:** `VLLM_PORT=8001` on cmps01 (container still listens on **8000** inside Docker).

---

## Architecture

```text
dev.eduai.ok.ubc.ca (s378)          cmps01
        │                              │
        │  VLLM_BASE_URL               │  :8001  (host) → :8000 (container)
        └──────────────────────────────►  GPU (RTX 6000 Ada ×2)
```

Ollama stays on **:11434**. vLLM uses **:8001** on the host so it does not collide with other services that use 8000 (e.g. Question Maker).

---

## IT / firewall (read before opening ports)

**What IT needs to know:** EduAI on the **dev web host** (`dev.eduai.ok.ubc.ca` / s378) must reach the vLLM HTTP API on **cmps01** — same pattern as Ollama on **:11434** today.

| Approach | Firewall ticket? | Notes |
| -------- | ---------------- | ----- |
| **A — Server-to-server allow** | **Yes** (unless ops confirms an existing rule) | Ticket: **source** = dev app server, **dest** = `cmps01`, **port** = **8001** (`VLLM_PORT`). |
| **B — SSH tunnel on dev server** | **Not viable on s378** | Tested 2026-06: `ssh ssaada08@cmps01.ok.ubc.ca` from **dev** → **port 22 connection timed out**. Use **Path A** (HTTP 8001) instead. Tunnels from **your laptop** to cmps01 still work for personal `curl` only. |
| **C — cmps01-only testing** | No | SSH to cmps01 from laptop, `curl localhost:8001` — no EduAI on dev until Path A |

**Permissions (from IT):**

- Prefer **Docker** over a large Python venv (easier cleanup).
- **Docker group** for Syed is a smaller ask than sudo; **Dr Mohamed** approval for sudo/docker on cmps01.
- `rbuti` / `shlok10` already have sudo if you need help on-box.

**Reply you can send IT:**

> We need the dev EduAI host (`dev.eduai.ok.ubc.ca` / s378) to call an OpenAI-compatible inference API on cmps01 on port **8001** (`VLLM_PORT`), plus **host firewall** on cmps01 for that port. Same access pattern as existing Ollama **11434**. SSH from s378 to cmps01 is **not** available (port 22 timeout); we need **HTTP** access, not SSH port-forwarding.

---

## 1. cmps01 — install vLLM (Docker — IT preferred)

SSH: `ssh YOUR_CWL@cmps01.ok.ubc.ca`

Must be in the **docker** group (IT can add Syed) or use a colleague with sudo for first-time setup.

### Docker (recommended)

```bash
export VLLM_PORT=8001

docker run -d --name eduai-vllm --gpus all \
  -p 127.0.0.1:${VLLM_PORT}:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --host 0.0.0.0 --port 8000
```

For **firewall path A** (dev → cmps01 direct), publish on all interfaces (only after ticket approved):

```bash
export VLLM_PORT=8001

docker run -d --name eduai-vllm --gpus all \
  -p ${VLLM_PORT}:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --host 0.0.0.0 --port 8000
```

Cleanup: `docker stop eduai-vllm && docker rm eduai-vllm`

### venv (fallback only if Docker blocked)

```bash
export VLLM_PORT=8001
python3 -m venv ~/vllm-venv && source ~/vllm-venv/bin/activate
pip install -U pip vllm

vllm serve Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 \
  --port ${VLLM_PORT} \
  --served-model-name qwen2.5-7b-instruct \
  --gpu-memory-utilization 0.85 \
  --max-model-len 8192
```

First start downloads HF weights (~GB) — can take several minutes. Use **tmux** for long runs.

---

## 2. Smoke test (on cmps01)

```bash
export VLLM_PORT=8001

curl -s http://127.0.0.1:${VLLM_PORT}/v1/models | jq .

curl -s http://127.0.0.1:${VLLM_PORT}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer vllm-local" \
  -d '{
    "model": "qwen2.5-7b-instruct",
    "messages": [{"role": "user", "content": "Say hi in one word."}],
    "max_tokens": 32
  }' | jq .
```

From repo (any host that can reach vLLM):

```bash
cd apps/core
VLLM_PORT=8001 VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001 npm run vllm:smoke
```

---

## 3. EduAI dev server (s378)

**Path A — firewall (direct):**

```env
VLLM_PORT=8001
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

**Path B — SSH tunnel:** **Not available from s378** (SSH to cmps01 times out). Use **Path A** after IT opens **TCP 8001**. Optional: tunnel from **your laptop** to cmps01 for manual testing only — EduAI on dev still needs Path A.

Re-seed if `vllm` provider is missing:

```bash
cd apps/core && npx prisma db seed
```

In the app **Settings → API keys**: **Enable vLLM**.

In chat model picker (admin): select **`vllm:qwen2.5-7b-instruct`**.

---

## 4. Benchmark vs Ollama (same prompts)

| Probe | Ollama | vLLM |
| ----- | ------ | ---- |
| 1 user warm TTFT | `deepseek-r1:8b` hybrid | `qwen2.5-7b-instruct` |
| 5–10 parallel short prompts | compare totals | continuous batching win expected |

Log rows in `docs/rag-ai/latency/MODEL_LATENCY_TRACKER.md`.

---

## 5. GPU residency, energy, and sleep mode

### Always resident while the server runs

Unlike Ollama’s `keep_alive` TTL, vLLM **keeps the served model in GPU memory** for the lifetime of the process/container. There is no built-in idle timer that unloads weights.

With our default Docker setup (`--restart unless-stopped`):

- **Container running** → Qwen weights stay in VRAM → warm chat (sub‑second to low‑seconds TTFT after initial load).
- **Container stopped or restarted** → full cold load again (first request slow until weights are back on GPU).

This is why day‑to‑day chat feels fast: you are not paying Ollama’s ~9–10 s cold reload on every `keep_alive` expiry (#394 Phase 1).

### Energy — measured on cmps01 (2026-06)

Command: `nvidia-smi --query-gpu=power.draw --format=csv -l 5` (5 s interval). cmps01 has **two** RTX 6000 Ada; each sample line alternates GPU 0 (vLLM) / GPU 1 (idle).

#### Idle — vLLM up, no chat (~2 min)

| GPU | power.draw |
| --- | ---------- |
| GPU 0 — Qwen 7B resident | **~27–28 W** (mean ~27.8 W) |
| GPU 1 — idle | **~18–20 W** (mean ~19.2 W) |
| **Both GPUs** | **~47 W** |

#### Active chat — single user talking to vLLM (~same session)

| GPU | power.draw |
| --- | ---------- |
| GPU 0 — inference bursts | **~65–127 W** typical; **peaks ~292–299 W** (near 300 W TDP) |
| GPU 1 — idle | **~19–20 W** (unchanged) |
| After last token | drops toward idle (**~32 W** seen on GPU 0) |

**Interpretation:** idle residency is **~28 W**; you only pay **near-TDP** power during token generation, not 24/7. A classroom spike to ~300 W is short-lived per request.

#### Extrapolated daily energy (GPU only — not a billing quote)

| Scenario | Assumption | ~kWh / day |
| -------- | ---------- | ---------- |
| **Always idle** (24/7 resident, no traffic) | 27.8 W on GPU 0 | **~0.67** |
| **Both GPUs idle** | 47 W | **~1.1** |
| **Heavy use** (illustrative) | e.g. 8 h at ~120 W avg + 16 h at 28 W idle on GPU 0 | **~1.4** |

Real daily use sits between the idle and heavy rows depending on chat volume. Keeping the model warm 24/7 on dev is **feasible** — most hours are idle (~28 W), not peak (~300 W).

```bash
nvidia-smi --query-gpu=index,power.draw --format=csv -l 5
```

### vLLM Sleep Mode (optional — off‑hours / RAM warm tier)

If ops wants to **free VRAM overnight** without a full container restart, vLLM supports **[Sleep Mode](https://docs.vllm.ai/en/stable/features/sleep_mode/)** (requires enabling at startup — verify against your `vllm/vllm-openai` image version):

```bash
# Example: add to docker run (env + flag names per upstream docs)
-e VLLM_SERVER_DEV_MODE=1 \
  ...
  --enable-sleep-mode
```

| Level | Behavior | Typical wake | Use case |
| ----- | -------- | ------------ | -------- |
| **1** | Weights → **CPU RAM**, KV cache dropped | ~2–3 s (upstream/docs; measure on cmps01) | Nights / weekends — **closest to #394 “RAM warm”** for vLLM |
| **2** | Weights discarded; reload from disk on wake | ~7–8 s+ | Max VRAM free; limited CPU RAM |
| **3** | Weights stay on GPU; KV cache dropped | Fastest | Lower VRAM reclaim; still pays idle GPU power |

HTTP control (port 8001 on host):

```bash
curl -X POST 'http://127.0.0.1:8001/sleep?level=1'
curl -X POST 'http://127.0.0.1:8001/wake_up'
```

**Ops scheduling (simple alternative):** cron `docker stop eduai-vllm` off‑hours and `docker start eduai-vllm` before class — no sleep flags, but first user after start waits for cold load.

**Not implemented in EduAI yet** — sleep/wake is manual, cron, or a future ops ticket (#382‑style policy for vLLM).

---

## 6. Multiple models on one GPU (or cmps01)

**One vLLM server process = one base model.** There is no `--model` list or multi-model flag on a single container. `/v1/models` returns that instance’s model (plus LoRA adapters if configured).

### Options on cmps01 (2× RTX 6000 Ada, 48 GB each)

| Pattern | How | When to use |
| ------- | --- | ----------- |
| **A — one model per GPU** (recommended) | Two containers, `CUDA_VISIBLE_DEVICES=0` vs `1`, ports **8001** / **8002** | Different sizes or architectures without VRAM fights |
| **B — two models, same GPU** | Two containers, same GPU, each `--gpu-memory-utilization 0.40–0.50`, different ports | Only for **small** models; watch OOM under concurrent load + KV cache |
| **C — LoRA adapters** | One container, one base model, multiple LoRA finetunes | Same architecture, course-specific tweaks — not “Qwen + Llama” |
| **D — sleep / wake** | One container with `--enable-sleep-mode`; `POST /sleep`, `POST /wake_up` | **Swap** models on one GPU — not serve two at once |

**VRAM rule of thumb:** Qwen 7B FP16 ≈ **~14 GB** weights plus KV cache headroom. Two 7B models on one 48 GB card may fit in theory but is **risky** with real traffic; prefer **GPU 0 + GPU 1** split.

### Example — second model on GPU 1

```bash
export VLLM_PORT=8002

docker run -d --name eduai-vllm-2 --gpus '"device=1"' \
  -p ${VLLM_PORT}:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-3B-Instruct \
  --served-model-name qwen2.5-3b-instruct \
  --host 0.0.0.0 --port 8000 \
  --gpu-memory-utilization 0.85
```

Open **8002** on the cmps01 host firewall (same IT pattern as 8001). EduAI today has **one** `VLLM_BASE_URL` per env — a second model needs another provider URL, a router (LiteLLM / nginx), or a separate spike; not wired in `providers.ts` yet.

### vs Ollama on the same host

| | Ollama `:11434` | vLLM |
| --- | --- | --- |
| Multi-model | Several GGUF names; lazy load / swap | One model per **instance**; optional sleep to swap |
| Cold swap cost | ~9–10 s full reload (#394) | Container restart or sleep Level 2; Level 1 wake ~2–3 s (measure on box) |
| Strength | Dev flexibility, embeddings | Resident model + continuous batching under load |

**Practical split today:** vLLM **house chat** on GPU 0 (`:8001`); Ollama for **embeddings**, legacy chat models, and experiments on GPU 1 or host RAM.

---

## 7. Constraints on shared cmps01

- **Do not** run huge 31B on vLLM + Ollama large model **at once** — VRAM contention.
- **Default policy:** leave vLLM running during dev/teaching windows (resident model, low idle power — see §5).
- **When fully done** with a spike: `docker stop eduai-vllm` (or tmux → Ctrl+C for venv).
- Firewall: port **8001** needs a ticket for path A. Ollama **:11434** is already allowed dev → cmps01; vLLM is a **new** service/port.
- Ollama does **not** RAM‑stage after unload (#394 Phase 1). vLLM **Sleep Level 1** can offload weights to host RAM — different mechanism, optional.

---

## 8. Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Connection refused from dev | Port **8001** open? `curl http://cmps01:8001/v1/models` from s378 |
| 404 model | `curl /v1/models` — use exact `id` as `model` in chat |
| OOM | Lower `--gpu-memory-utilization` or smaller model; do not stack two large models on one GPU without headroom (§6) |
| EduAI “provider not configured” | Enable vLLM in settings; `VLLM_BASE_URL` or `VLLM_PORT` |
| Tools fail | `supportsTools: true` on seeded model; verify vLLM tool calling for that arch |

---

## Related

- [FINDINGS.md](./FINDINGS.md) — Ollama cold ~9 s; vLLM warm latency on dev (informal); formal bench TBD  
- [EXPERIMENT_HOST_RAM_STANDBY.md](./EXPERIMENT_HOST_RAM_STANDBY.md) — RAM offload not in Ollama  
- [SOLUTIONS_PLAN.md](./SOLUTIONS_PLAN.md) — Phase D  
- `apps/core/app/lib/ai/providers.ts` — `vllm` provider  
- GitHub **#394** Phase 2
