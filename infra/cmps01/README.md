# cmps01 — vLLM multi-model proxy (LiteLLM)

**Goal:** Run **two vLLM containers** (GPU 0 + GPU 1) but expose **one HTTP port** (`8001`) to dev/EduAI so IT only opens a single firewall rule.

```text
dev (s378) ──HTTP :8001──► cmps01 eduai-vllm-proxy (LiteLLM)
                                ├──► 127.0.0.1:18001  eduai-vllm-1 (GPU 0)
                                └──► 127.0.0.1:18002  eduai-vllm-2 (GPU 1)
Ollama :11434 (GPU 1 or separate) — unchanged
```

EduAI uses **`VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001`** only. Model routing is by **`model` id** in chat (`vllm:qwen2.5-7b-instruct`, etc.).

---

## 1. Backend vLLM containers (localhost only)

Replace existing public `:8001` / `:8002` binds with **127.0.0.1** internal ports:

```bash
# GPU 0 — example
docker run -d --name eduai-vllm-1 --gpus '"device=0"' \
  -p 127.0.0.1:18001:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --host 0.0.0.0 --port 8000

# GPU 1 — use your second HF model + served-model-name
docker run -d --name eduai-vllm-2 --gpus '"device=1"' \
  -p 127.0.0.1:18002:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model YOUR/HF-MODEL \
  --served-model-name YOUR-SERVED-NAME \
  --host 0.0.0.0 --port 8000
```

Verify on cmps01:

```bash
curl -s http://127.0.0.1:18001/v1/models | jq .
curl -s http://127.0.0.1:18002/v1/models | jq .
```

---

## 2. Edit LiteLLM config

Update `litellm-config.yaml`:

- Set **`model_name`** / **`model:`** to each `--served-model-name`
- One entry per backend (`18001`, `18002`)

---

## 3. Start proxy

```bash
cd infra/cmps01   # on cmps01, copy this folder or clone repo
docker compose up -d
```

Verify (from cmps01 or dev after firewall):

```bash
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq .
curl -s http://cmps01.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer vllm-local" | jq .
```

Both served models should appear in **`data[]`**.

---

## 4. EduAI `.env` (dev server)

```env
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Use **`http://`** not `https://`. Restart EduAI after changes.

---

## 5. Firewall (IT)

**Only port 8001** needed from dev → cmps01 for vLLM (plus **11434** for Ollama if not already open).

**Do not** expose `18001` / `18002` — they are localhost-only on cmps01.

---

## Adding a third model later

1. Run new vLLM on `127.0.0.1:18003` (or reuse GPU with smaller models).
2. Add a block to `litellm-config.yaml`.
3. `docker compose restart eduai-vllm-proxy`
4. Admin → AI Models → Refresh vLLM list — **no new firewall ticket**.

---

## Migration from public :8001 + :8002

1. Stop old `eduai-vllm` containers.
2. Recreate with `-p 127.0.0.1:18001:8000` and `-p 127.0.0.1:18002:8000`.
3. Start LiteLLM on `:8001`.
4. Ask IT to **remove** `:8002` from firewall if it was added; keep `:8001` only.
