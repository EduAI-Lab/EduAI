# cmps01 — vLLM multi-model proxy (LiteLLM)

**Goal:** Run **two vLLM containers** (one per GPU) but expose **one HTTP port** (`8001`) to dev/EduAI so IT only opens a single firewall rule.

```text
dev (s378) ──HTTP :8001──► cmps01 eduai-vllm-proxy (LiteLLM)
                                ├──► 127.0.0.1:18001  eduai-vllm      (GPU 0, 7B)
                                └──► 127.0.0.1:18002  eduai-vllm-t3   (GPU 1, 32B AWQ)
Ollama :11434 — unchanged
```

EduAI uses **`VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001`** only. Chat picks the model via id (`vllm:qwen2.5-7b-instruct`, `vllm:qwen2.5-32b-instruct`).

---

## Current inventory (cmps01, Mar 2026)

| Docker name | Public port (today) | Served model (`/v1/models` → `id`) | HF root (from API) |
| --- | --- | --- | --- |
| **`eduai-vllm`** | `0.0.0.0:8001→8000` | `qwen2.5-7b-instruct` | Qwen 7B Instruct |
| **`eduai-vllm-t3`** | `0.0.0.0:8002→8000` | `qwen2.5-32b-instruct` | `Qwen/Qwen2.5-32B-Instruct-AWQ` |

After migration, backends move to **localhost only** (`18001`, `18002`); **LiteLLM** listens on public **`8001`**.

`litellm-config.yaml` in this folder is already set for both model names.

---

## Migration checklist

Use this order on **cmps01** (SSH). Expect **~10–30+ min** per container while weights load after recreate.

### Step 0 — Save current run commands

Before stopping anything, capture how each container was started:

```bash
docker inspect eduai-vllm --format '{{json .Config.Cmd}}' | jq .
docker inspect eduai-vllm-t3 --format '{{json .Config.Cmd}}' | jq .

docker inspect eduai-vllm --format '{{json .HostConfig.DeviceRequests}}' | jq .
docker inspect eduai-vllm-t3 --format '{{json .HostConfig.DeviceRequests}}' | jq .
```

Copy the output — your new `docker run` lines must use the **same** `--model`, GPU device, and extra flags (AWQ, `--max-model-len`, etc.).

Quick model check (optional):

```bash
curl -s http://127.0.0.1:8001/v1/models | jq '.data[].id'
curl -s http://127.0.0.1:8002/v1/models | jq '.data[].id'
```

### Step 1 — Stop and remove old containers

```bash
docker stop eduai-vllm eduai-vllm-t3
docker rm eduai-vllm eduai-vllm-t3
```

### One-shot script (recommended)

Copy `infra/cmps01` to cmps01, then:

```bash
cd /path/to/EduAICoreLearning/infra/cmps01
chmod +x migrate.sh
./migrate.sh
```

The script uses the **exact flags from `docker inspect`** (Mar 2026), including 32B tool-calling options.

### Step 2 — Recreate backends (localhost only)

Captured from `docker inspect` on cmps01:

```bash
# GPU 0 — 7B (was eduai-vllm on :8001)
docker run -d --name eduai-vllm --gpus '"device=0"' \
  -p 127.0.0.1:18001:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --host 0.0.0.0 \
  --port 8000

# GPU 1 — 32B AWQ + tool calling (was eduai-vllm-t3 on :8002)
docker run -d --name eduai-vllm-t3 --gpus '"device=1"' \
  -p 127.0.0.1:18002:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-32B-Instruct-AWQ \
  --served-model-name qwen2.5-32b-instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --gpu-memory-utilization 0.88 \
  --max-model-len 16384 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

Wait for logs (`docker logs -f eduai-vllm` / `eduai-vllm-t3`) until Uvicorn is ready, then:

```bash
curl -s http://127.0.0.1:18001/v1/models | jq '.data[].id'
curl -s http://127.0.0.1:18002/v1/models | jq '.data[].id'
```

### Step 3 — Start LiteLLM proxy on public :8001

Copy this `infra/cmps01` folder to cmps01 (or `git pull` the repo), then:

```bash
cd /path/to/EduAICoreLearning/infra/cmps01
docker compose up -d
```

Verify **both** models through the proxy:

```bash
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
# expect: qwen2.5-7b-instruct
#         qwen2.5-32b-instruct
```

From dev (after firewall):

```bash
curl -s http://cmps01.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
```

### Step 4 — EduAI dev server (`apps/core/.env` on s378)

```env
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Use **`http://`** not `https://`. Restart the dev server (tmux).

```bash
cd apps/core
npm run vllm:smoke
npx prisma db seed   # registers both vLLM models in Admin
```

### Step 5 — App

1. **Settings** → Enable vLLM  
2. **Admin → AI Models** → provider vLLM → **Refresh list** → confirm both models  
3. Chat: `vllm:qwen2.5-7b-instruct` or `vllm:qwen2.5-32b-instruct`

### Step 6 — IT / firewall

- **Keep:** dev → cmps01 **TCP 8001** (LiteLLM)  
- **Optional remove:** **8002** from firewall (backends no longer public)  
- **Unchanged:** Ollama **11434** if already open  

---

## LiteLLM config

See [`litellm-config.yaml`](./litellm-config.yaml). Backends:

| `model_name` | Backend URL |
| --- | --- |
| `qwen2.5-7b-instruct` | `http://127.0.0.1:18001/v1` |
| `qwen2.5-32b-instruct` | `http://127.0.0.1:18002/v1` |

After editing config: `docker compose restart` in this directory.

---

## Adding a third model later

1. Run new vLLM on `127.0.0.1:18003` (localhost only).
2. Add a block to `litellm-config.yaml`.
3. `docker compose restart eduai-vllm-proxy`
4. Admin → AI Models → Refresh list — **no new firewall ticket**.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `curl :8001` fails after proxy up | `docker ps` — is `eduai-vllm-proxy` running? Port 8001 free? |
| Only one model in proxy list | `curl :18001` and `:18002` directly; fix `litellm-config.yaml` |
| EduAI fetch fails | `VLLM_BASE_URL` on **s378** `.env`; use `http://`; restart dev |
| SSL wrong version | Do not use `https://` for vLLM |
| `-p: command not found` | `-p` is a **docker run** flag, not a standalone command |

---

## Related docs

- [`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md) — EduAI vLLM provider, stress tests, energy
- [`docs/rag-ai/HOW_TO_USE_DEV_SERVER.md`](../../docs/rag-ai/HOW_TO_USE_DEV_SERVER.md) — s378 ops
