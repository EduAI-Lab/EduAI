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
| **B — SSH tunnel on dev server** | **Often no new port** | On **s378**: `ssh -N -L 18001:127.0.0.1:8001 USER@cmps01`. `VLLM_BASE_URL=http://127.0.0.1:18001`. vLLM on cmps01: `-p 127.0.0.1:8001:8000`. |
| **C — cmps01-only testing** | No | SSH to cmps01, `curl localhost:8001` — no EduAI integration yet |

**Permissions (from IT):**

- Prefer **Docker** over a large Python venv (easier cleanup).
- **Docker group** for Syed is a smaller ask than sudo; **Dr Mohamed** approval for sudo/docker on cmps01.
- `rbuti` / `shlok10` already have sudo if you need help on-box.

**Reply you can send IT:**

> We need the dev EduAI host (`dev.eduai.ok.ubc.ca` / s378) to call an OpenAI-compatible inference API on cmps01 on port **8001** (`VLLM_PORT`). Destination: cmps01 GPU host. Same access pattern as existing Ollama **11434**. Alternatively we can bind vLLM to localhost on cmps01 and use an SSH tunnel from the dev server — please advise which you prefer.

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

**Path B — SSH tunnel (no public port on cmps01):**

On **dev server** (tmux), as a user that can SSH to cmps01:

```bash
ssh -N -L 18001:127.0.0.1:8001 ssaada08@cmps01.ok.ubc.ca
```

```env
VLLM_BASE_URL="http://127.0.0.1:18001"
VLLM_API_KEY="vllm-local"
```

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

## 5. Constraints on shared cmps01

- **Do not** run huge 31B on vLLM + Ollama large model **at once** — VRAM contention.
- Stop vLLM when done: `docker stop eduai-vllm` (or tmux → Ctrl+C for venv).
- Firewall: port **8001** needs a ticket for path A. Ollama **:11434** is already allowed dev → cmps01; vLLM is a **new** service/port.
- vLLM does **not** implement “RAM offload standby” — model stays loaded while the server runs.

---

## 6. Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Connection refused from dev | Port **8001** open? `curl http://cmps01:8001/v1/models` from s378 |
| 404 model | `curl /v1/models` — use exact `id` as `model` in chat |
| OOM | Lower `--gpu-memory-utilization` or smaller model |
| EduAI “provider not configured” | Enable vLLM in settings; `VLLM_BASE_URL` or `VLLM_PORT` |
| Tools fail | `supportsTools: true` on seeded model; verify vLLM tool calling for that arch |

---

## Related

- [FINDINGS.md](./FINDINGS.md) — Ollama cold ~9 s; vLLM not benchmarked yet  
- [EXPERIMENT_HOST_RAM_STANDBY.md](./EXPERIMENT_HOST_RAM_STANDBY.md) — RAM offload not in Ollama  
- [SOLUTIONS_PLAN.md](./SOLUTIONS_PLAN.md) — Phase D  
- `apps/core/app/lib/ai/providers.ts` — `vllm` provider  
- GitHub **#394** Phase 2
