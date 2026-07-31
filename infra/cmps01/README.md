# cmps01 — Qwen3.5 fleet host

cmps01 is the primary member of the interactive Qwen3.5 fleet. cmps02 mirrors
the same model IDs so Core can round-robin without model-dependent gaps.

| GPU | Checkpoint | Revision | Served ID | Precision |
| --- | --- | --- | --- | --- |
| 0 | `Qwen/Qwen3.5-2B` | `15852e8c…` | `qwen3.5-2b` | BF16 |
| 1 | `Qwen/Qwen3.5-27B-FP8` | `97f5941b…` | `qwen3.5-27b` | official FP8 |

The full revisions, vLLM `v0.26.0`, LiteLLM `v1.92.0`, 16,384-token
context cap, thinking-disabled defaults, and single-GPU placement are pinned in
`docker-compose.yml`. The vision towers remain resident but are not exercised
by the text-only v3 prompt suite.

```text
s378 :8001 -> nginx
                 |-- /v1/*    -> LiteLLM :18091
                 |                  |-- 2B  :18001 (GPU 0)
                 |                  `-- 27B :18002 (GPU 1)
                 |-- /energy/ -> energy meter :9100
                 `-- /ollama/ -> Ollama :11434
```

The edge is restricted to the IPs in `.env`, the LiteLLM bearer key is not
committed, and `/v1/models` is withheld until the slower 27B backend is live.
This prevents Core from admitting the host while LiteLLM only has a static
model catalog available.

## Deploy

The migration replaces the existing Qwen2.5 7B/32B containers and causes a
model-loading outage.

```bash
cd infra/cmps01
cp .env.example .env
openssl rand -hex 32  # set VLLM_API_KEY; use the same value on cmps02 and s378
openssl rand -hex 32  # set EDUAI_INTERNAL_KEY
chmod +x migrate.sh deploy-edge-proxy.sh verify-edge-security.sh
./migrate.sh
```

Then configure s378:

```env
VLLM_BASE_URL=http://cmps01.ok.ubc.ca:8001
VLLM_FLEET_CHAT_URLS=http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001
VLLM_FLEET_DEFAULT_MODELS=qwen3.5-2b,qwen3.5-27b
VLLM_API_KEY=<shared cmps01/cmps02 key>
ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy
CMPS01_INTERNAL_KEY=<cmps01 EDUAI_INTERNAL_KEY>
```

Run `npm run fleet:smoke` and the Prisma provider sync before enabling user
traffic. Leave `VLLM_FLEET_HEAVY_URL` unset; background jobs then use the
mirrored chat pool safely.

## Rollback

Before migrating, record `docker inspect` output for both Qwen2.5 containers.
To roll back, stop this Compose project, restore the captured Qwen2.5 launch
commands, restore the prior LiteLLM model list, and reactivate the two Qwen2.5
model rows in Admin. Do not expose a mixed cmps01/cmps02 model inventory to the
fleet during either transition.
