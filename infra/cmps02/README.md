# cmps02 — vLLM inference host

**Hardware (probed Jun 2026):** 2× NVIDIA RTX 6000 Ada (~48 GB VRAM each).

**Role:** Second **live-chat** GPU server — same **Qwen 7B + 32B** stack as [cmps01](../cmps01/README.md). EduAI’s multi-server plan spreads student chat across cmps01 and cmps02; heavy models (e.g. **gpt-oss-120b**) belong on **cmps03** or **LTIC B300 (Vancouver)**, not here.

```text
dev (s378) ──HTTP :8001──► cmps02 eduai-edge-proxy (nginx)
                                ├── /v1/*     → LiteLLM 127.0.0.1:18091
                                │                 ├──► 127.0.0.1:18001  eduai-vllm      (GPU 0, Qwen 7B)
                                │                 └──► 127.0.0.1:18002  eduai-vllm-t3   (GPU 1, Qwen 32B AWQ)
                                └── /energy/* → energy-meter 127.0.0.1:9100 (optional)
```

EduAI fleet Slice 1 uses **`http://cmps02.ok.ubc.ca:8001`** alongside cmps01. Models must match cmps01 IDs: **`vllm:qwen2.5-7b-instruct`**, **`vllm:qwen2.5-32b-instruct`** (required for round-robin / retry).

See also: [Multi-server routing plan](../../docs/rag-ai/routing/eduai-summer-2026/MULTI_SERVER_ROUTING_PLAN.md).

**Model choice (stakeholders):** [../MODEL_RATIONALE.md](../MODEL_RATIONALE.md) — why Qwen 7B + 32B fleet-wide.

**Live swap (Jul 2026):** cmps02 was temporarily serving `qwen2.5-14b-instruct` + `qwen2.5-72b-instruct`. Re-run **`./migrate.sh`** to replace those with the shared 7B + 32B stack so fleet routing can alternate hosts for the same model id.

### Models on this host

| Tier | Model | GPU | Typical use |
| --- | --- | --- | --- |
| **1** | `qwen2.5-7b-instruct` | 0 | Everyday chat, RAG Q&A, classifier |
| **3** | `qwen2.5-32b-instruct` (AWQ) | 1 | Tools, harder reasoning, images |

Deploy: **`./migrate.sh`** (tiered 7B + 32B). **`migrate-120b.sh`** is not used on cmps02.

---

## Edge proxy (nginx on :8001)

Same pattern as [cmps01](../cmps01/README.md): **one public port** for vLLM + optional energy sidecar (no extra firewall rules).

| Docker name | Host bind | Role |
| --- | --- | --- |
| **`eduai-vllm`** | `127.0.0.1:18001` | Qwen 7B backend |
| **`eduai-vllm-t3`** | `127.0.0.1:18002` | Qwen 32B AWQ backend |
| **`eduai-vllm-proxy`** | `127.0.0.1:18091` | LiteLLM router (internal) |
| **`eduai-edge-proxy`** | host `:8001` | nginx — `/v1/*` → LiteLLM, `/energy/*` → `:9100` |
| **`eduai-energy-meter`** | `127.0.0.1:9100` | NVML Joules sidecar (optional) |

**Why `network_mode: host`?** LiteLLM and nginx must reach vLLM backends on host loopback (`127.0.0.1:18001/18002`).

### Energy sidecar (research Joules)

```bash
# once on cmps02 — copy tools/energy-meter to ~/eduai-energy-meter
cd ~/eduai-energy-meter && chmod +x deploy-cmps02.sh && ./deploy-cmps02.sh
cd ~/cmps02 && ./deploy-edge-proxy.sh
```

s378: `ENERGY_SIDECAR_URL=http://cmps02.ok.ubc.ca:8001/energy`

---

## Deploy (recommended)

```bash
ssh YOUR_CWL@cmps02.ok.ubc.ca
cd ~/cmps02
chmod +x probe.sh migrate.sh migrate-tiered.sh deploy-edge-proxy.sh
./probe.sh
./migrate.sh          # alias for migrate-tiered.sh — 10–30+ min while weights load
```

Verify on cmps02:

```bash
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
# expect: qwen2.5-7b-instruct
#         qwen2.5-32b-instruct
```

From **s378** (firewall for TCP 8001 is open):

```bash
curl -s http://cmps02.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
# expect the same ids as cmps01
```

**EduAI** (`apps/core/.env` on s378) — fleet chat pool:

```env
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001"
VLLM_FLEET_DEFAULT_MODELS="qwen2.5-7b-instruct,qwen2.5-32b-instruct"
VLLM_API_KEY="vllm-local"
```

```bash
cd apps/core && npm run fleet:smoke && npm run vllm:smoke
```

**Admin → AI Models → vLLM → Refresh list** → register both ids. Chat: `vllm:qwen2.5-7b-instruct` and check `X-Fleet-Server` alternates between `cmps01` / `cmps02`.

---

## Single-GPU fallback

If only one GPU is available, run 7B only:

```bash
SKIP_32B=1 ./migrate-tiered.sh
```

Remove the `qwen2.5-32b-instruct` block from `litellm-config.tiered.yaml` (or use the generated `litellm-config.yaml` after editing), then `docker compose restart`.

---

## Port map

| Port | Use |
| --- | --- |
| `18001` | `eduai-vllm` — Qwen 7B |
| `18002` | `eduai-vllm-t3` — Qwen 32B AWQ |
| `18091` | LiteLLM (localhost) |
| `8001` | nginx edge (public) |
| `9100` | energy-meter (localhost, optional) |

---

## Files

| Script | Purpose |
| --- | --- |
| `probe.sh` | GPU / Docker inventory |
| **`migrate.sh`** / **`migrate-tiered.sh`** | **Qwen 7B + 32B AWQ (default)** |
| `migrate-120b.sh` | **Not used on cmps02** — kept for reference; 120B → LTIC B300 / cmps03 |
| `deploy-edge-proxy.sh` | Restart nginx + LiteLLM edge |
| `litellm-config.tiered.yaml` | Source config for 7B + 32B |

---

## IT / firewall

> Dev EduAI (s378) → **cmps02.ok.ubc.ca TCP 8001** (HTTP). Same pattern as cmps01.

---

## Related

- [Model rationale (stakeholders)](../MODEL_RATIONALE.md)
- [cmps01](../cmps01/README.md) — primary GPU server (same model stack)
- [`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md) — EduAI vLLM provider, stress tests
- [`docs/rag-ai/routing/`](../../docs/rag-ai/routing/) — Auto routing rules and tiers
- [Multi-server routing plan](../../docs/rag-ai/routing/eduai-summer-2026/MULTI_SERVER_ROUTING_PLAN.md)
