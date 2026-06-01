# vLLM on cmps01 — setup & EduAI wiring

**Goal:** Run **vLLM** alongside (or instead of) Ollama for **multi-user GPU serving** (Phase D / #394 Phase 2).  
**EduAI:** Uses provider `vllm` → OpenAI-compatible `POST /v1/chat/completions`.

**Not the same as Ollama:** vLLM loads **Hugging Face** weights, not Ollama GGUF blobs. You need HF model IDs (e.g. `Qwen/Qwen2.5-7B-Instruct`).

---

## Architecture

```text
dev.eduai.ok.ubc.ca (s378)          cmps01
        │                              │
        │  VLLM_BASE_URL               │  :8000  vllm serve
        └──────────────────────────────►  GPU (RTX 6000 Ada ×2)
```

Ollama stays on **:11434**. vLLM should use a **different port** (default **8000**) so both can coexist during the spike.

---

## 1. cmps01 — install vLLM (coordinate with ops)

SSH: `ssh YOUR_CWL@cmps01.ok.ubc.ca`

### Option A — user venv (no root)

```bash
python3 -m venv ~/vllm-venv
source ~/vllm-venv/bin/activate
pip install -U pip
pip install vllm
```

CUDA/driver must match your GPU (RTX 6000 Ada). If `pip install vllm` fails, ask ops for a module or Docker image.

### Option B — Docker (if allowed)

```bash
docker run --gpus all -p 8000:8000 \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --host 0.0.0.0 --port 8000
```

---

## 2. Start the server (house model)

Match **`--served-model-name`** to EduAI seed: `qwen2.5-7b-instruct`.

```bash
source ~/vllm-venv/bin/activate

vllm serve Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --served-model-name qwen2.5-7b-instruct \
  --gpu-memory-utilization 0.85 \
  --max-model-len 8192
```

**tmux** so it survives disconnect:

```bash
tmux new -s vllm
# run vllm serve ...
# Ctrl+B, D
```

First start downloads HF weights (~GB) — can take several minutes.

---

## 3. Smoke test (on cmps01)

```bash
curl -s http://127.0.0.1:8000/v1/models | jq .

curl -s http://127.0.0.1:8000/v1/chat/completions \
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
VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8000 node ./scripts/vllm-smoke.mjs
```

---

## 4. EduAI dev server (s378)

In `apps/core/.env` on **dev.eduai.ok.ubc.ca**:

```env
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8000"
VLLM_API_KEY="vllm-local"
```

Re-seed if `vllm` provider is missing:

```bash
cd apps/core && npx prisma db seed
```

In the app **Settings → API keys**: **Enable vLLM**.

In chat model picker (admin): select **`vllm:qwen2.5-7b-instruct`**.

---

## 5. Benchmark vs Ollama (same prompts)

Use existing bench with a vLLM model id once wired, or manual:

| Probe | Ollama | vLLM |
| ----- | ------ | ---- |
| 1 user warm TTFT | `deepseek-r1:8b` hybrid | `qwen2.5-7b-instruct` |
| 5–10 parallel short prompts | compare totals | continuous batching win expected |

Log rows in `docs/rag-ai/latency/MODEL_LATENCY_TRACKER.md`.

---

## 6. Constraints on shared cmps01

- **Do not** run huge 31B on vLLM + Ollama large model **at once** — VRAM contention.
- Stop vLLM when done: `tmux attach -t vllm` → Ctrl+C.
- Firewall: ops may need to allow **s378 → cmps01:8000** (Ollama :11434 is already allowed).
- vLLM does **not** implement “RAM offload standby” — model stays loaded while the server runs (like `keep_alive` in VRAM, but as a **service**).

---

## 7. Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Connection refused from dev | Port 8000 open? vLLM bound `0.0.0.0`? |
| 404 model | `curl /v1/models` — use exact `id` as `model` in chat |
| OOM | Lower `--gpu-memory-utilization` or smaller model |
| EduAI “provider not configured” | Enable vLLM in settings; env `VLLM_BASE_URL` |
| Tools fail | `supportsTools: true` on seeded model; verify vLLM tool calling for that arch |

---

## Related

- [FINDINGS.md](./FINDINGS.md) — Ollama cold ~9 s; vLLM not benchmarked yet  
- [EXPERIMENT_HOST_RAM_STANDBY.md](./EXPERIMENT_HOST_RAM_STANDBY.md) — RAM offload not in Ollama  
- [SOLUTIONS_PLAN.md](./SOLUTIONS_PLAN.md) — Phase D  
- `apps/core/app/lib/ai/providers.ts` — `vllm` provider  
- GitHub **#394** Phase 2
