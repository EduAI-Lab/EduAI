# cmps02 — vLLM inference host

**Hardware:** 2× NVIDIA RTX 6000 Ada (~48 GB VRAM each).

**July 2026:** cmps02 is dedicated to **research** (model adequacy ladder). Fleet load-balancing with cmps01 is deferred until experiments finish.

Both models run **simultaneously** (14B on GPU 0, 72B AWQ on GPU 1). Context is capped at **8192 tokens** per model so 72B fits on a single 48 GB GPU alongside 14B. Educational prompts in the task suite are well under this limit.

| Host | Role (Jul 2026) |
|------|-----------------|
| **cmps01** | Production + routing research — **7B + 32B** |
| **cmps02** | Model adequacy experiments — **14B + 72B AWQ** |

```text
research runner ──HTTP :8001──► cmps02 eduai-edge-proxy (nginx)
                                    ├── /v1/*     → LiteLLM 127.0.0.1:18091
                                    │                 ├──► :18001  eduai-vllm-mid  (GPU 0, Qwen 14B)
                                    │                 └──► :18002  eduai-vllm-xl   (GPU 1, Qwen 72B AWQ)
                                    └── /energy/* → energy-meter 127.0.0.1:9100
```

### Profiles

| Profile | Script | Models | When |
| --- | --- | --- | --- |
| **Research (default Jul 2026)** | `./migrate-research.sh` | 14B (GPU 0) + 72B AWQ (GPU 1) | Adequacy ladder experiments |
| **Research 72B only** | `./migrate-research-72b.sh` | 72B AWQ (TP=2, both GPUs) | XL-only batch (legacy) |
| **Fleet tiered** | `./migrate-tiered.sh` | 7B (GPU 0) + 32B AWQ (GPU 1) | Restore when cmps02 rejoins chat pool |

`migrate-120b.sh` is **deprecated** on cmps02 (120B → cmps03 / LTIC B300).

### Deploy research (14B + 72B)

```bash
ssh YOUR_CWL@cmps02.ok.ubc.ca
cd ~/cmps02
chmod +x migrate-research.sh
./migrate-research.sh   # first run: allow 30–60 min total
```

Verify:

```bash
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
# expect: qwen2.5-14b-instruct
#         qwen2.5-72b-instruct
```

**EduAI / research runner:**

```env
VLLM_BASE_URL="http://cmps02.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Models: `vllm:qwen2.5-14b-instruct`, `vllm:qwen2.5-72b-instruct`. Compare against cmps01 `7b` / `32b` for the full ladder.

### Port map

| Port | Use |
| --- | --- |
| `18001` | vLLM — 14B (research) or 7B / 72B-TP2 (other profiles) |
| `18002` | vLLM — 72B AWQ (research) or 32B AWQ (tiered) |
| `18091` | LiteLLM (localhost) |
| `8001` | nginx edge (public) |
| `9100` | energy-meter (localhost) |

### Related

- [cmps01](../cmps01/README.md) — 7B + 32B production
- [Multi-server routing plan](../../docs/rag-ai/routing/eduai-summer-2026/MULTI_SERVER_ROUTING_PLAN.md)
- Research context: `docs/research/RESEARCH_CONTEXT.md` (parent docs repo)
