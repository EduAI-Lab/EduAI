# cmps03 — Qwen3.5 ladder host

cmps03 carries the two Qwen3.5 dense variants that are not duplicated on the
interactive fleet:

| GPU | Checkpoint | Served ID | Precision |
| --- | --- | --- | --- |
| 0 | `Qwen/Qwen3.5-4B` | `qwen3.5-4b` | BF16 |
| 1 | `Qwen/Qwen3.5-9B` | `qwen3.5-9b` | BF16 |

This is the Stage-4 ladder profile, not a production heavy pool. Do **not** set
`VLLM_FLEET_HEAVY_URL` to cmps03: production background requests resolve to
the same 2B/27B IDs as interactive requests, and cmps03 intentionally does not
serve those IDs.

The model checkpoints, vLLM `v0.26.0`, LiteLLM `v1.92.0`, 16,384-token
context cap, and thinking-disabled defaults are pinned in
`docker-compose.yml`. The edge is restricted to s378, credentials remain in a
git-ignored `.env`, `/v1/models` is withheld while 9B is loading, and the
energy sidecar is available through the protected `/energy/` path.

## Deploy

```bash
cd infra/cmps03
cp .env.example .env
openssl rand -hex 32  # VLLM_API_KEY
openssl rand -hex 32  # EDUAI_INTERNAL_KEY
chmod +x deploy.sh start-edge.sh
./deploy.sh
```

Research runner:

```env
VLLM_BASE_URL=http://cmps03.ok.ubc.ca:8001
VLLM_API_KEY=<cmps03 key>
ENERGY_SIDECAR_URL=http://cmps03.ok.ubc.ca:8001/energy
CMPS01_INTERNAL_KEY=<cmps03 EDUAI_INTERNAL_KEY>
```

The `CMPS01_INTERNAL_KEY` variable name is a legacy Core interface; its value
is host-specific here.
