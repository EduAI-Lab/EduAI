# cmps02 — Qwen3.5 fleet mirror

cmps02 mirrors cmps01 exactly for production fleet routing:

| GPU | Checkpoint | Served ID | Precision |
| --- | --- | --- | --- |
| 0 | `Qwen/Qwen3.5-2B` | `qwen3.5-2b` | BF16 |
| 1 | `Qwen/Qwen3.5-27B-FP8` | `qwen3.5-27b` | official FP8 |

Both checkpoints, vLLM `v0.26.0`, LiteLLM `v1.92.0`, the 16,384-token
context cap, and thinking-disabled defaults are pinned in
`docker-compose.yml`. The public edge is IP-restricted to s378, uses a
non-committed bearer key, exposes the local energy sidecar at `/energy/`,
and withholds `/v1/models` until the slower 27B backend is ready.

## Deploy

```bash
cd infra/cmps02
cp .env.example .env
openssl rand -hex 32  # set VLLM_API_KEY; use the same value on cmps01 and s378
openssl rand -hex 32  # set EDUAI_INTERNAL_KEY
chmod +x deploy.sh verify.sh
./deploy.sh
```

On s378:

```env
VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001
VLLM_FLEET_DEFAULT_MODELS=qwen3.5-2b,qwen3.5-27b
VLLM_API_KEY=<shared cmps01/cmps02 key>
```

Do not set `VLLM_FLEET_HEAVY_URL` to cmps03. That host carries the other
two ladder models and cannot satisfy production requests for this pair.
