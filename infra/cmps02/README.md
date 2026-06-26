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

EduAI (once multi-server routing lands): **`http://cmps02.ok.ubc.ca:8001`** for chat/tutor traffic. Models: **`vllm:qwen2.5-7b-instruct`**, **`vllm:qwen2.5-32b-instruct`**.

See also: [Multi-server routing plan](../../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md) (parent `docs/` repo).

---

## Model rationale — why 7B + 32B, and why Qwen

### Why a two-model split (not one size fits all)

EduAI’s **Auto routing** picks the smallest tier that can answer well. On local vLLM we run **two tiers only** — no cloud tier in the middle:

| Tier | Model | GPU | Typical use |
| --- | --- | --- | --- |
| **1 — fast / default** | `qwen2.5-7b-instruct` | 0 | Everyday chat, course RAG Q&A, short factual prompts, classifier calls |
| **3 — escalate** | `qwen2.5-32b-instruct` (AWQ) | 1 | Tool calling, harder reasoning, debugging prompts, image turns, “needs more brain” cases |

**Why this split works for scale (100s–1000s of users per day):**

1. **Most traffic should stay on 7B.** Routing rules in `apps/core` default to tier 1; only escalation patterns (tools, complexity, images, etc.) bump to tier 3. That keeps energy and queue time down while preserving quality where it matters.

2. **Concurrency is a 7B problem, not a 120B problem.** On cmps01, vLLM 7B handled **10 parallel short requests at ~320–380 ms** with continuous batching; Ollama on the same host was **~15× slower** under 5-way parallel load ([`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md)). Classroom-scale chat needs **many fast slots**, not one huge model that queues everyone.

3. **One model per GPU, both resident.** Each backend binds to one GPU (`18001` / `18002`). Weights stay in VRAM — no Ollama-style ~9–10 s cold reload between turns. The 32B is **already loaded** when Auto escalates; we pay extra latency only for decode, not for swapping models.

4. **Fits the hardware.** ~15 GB (7B) + ~20 GB (32B AWQ) each fit comfortably on 48 GB Ada cards with room for KV cache and concurrent sequences.

5. **120B does not belong on this box.** `gpt-oss-120b` needs ~60 GB+ and tensor-parallel across **both** GPUs, which removes the entire server from the chat pool. Use **LTIC B300** or a future **cmps03** “heavy jobs” host for tier-3+ / Question Maker–class work ([multi-server plan](../../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md)).

**What we are not optimizing for on cmps02:** maximum reasoning on every turn. We optimize **throughput + sustainability + good-enough quality**, with **selective** use of 32B.

### Why Qwen 2.5 Instruct specifically

| Reason | Detail |
| --- | --- |
| **Already the house stack** | cmps01 runs these exact served names; research routing, benches, and Admin model IDs are built around `qwen2.5-7b-instruct` and `qwen2.5-32b-instruct`. cmps02 is a **clone for capacity**, not a new model experiment. |
| **vLLM + Hugging Face** | vLLM loads HF weights (`Qwen/Qwen2.5-7B-Instruct`, `Qwen/Qwen2.5-32B-Instruct-AWQ`). Same serving path as cmps01 — LiteLLM on `:8001`, OpenAI-compatible `/v1`. |
| **Strong instruct tuning** | Qwen 2.5 Instruct is a solid default for tutoring: follows system prompts, handles RAG context, multilingual (relevant at UBC). |
| **Same family at both tiers** | Escalation from 7B → 32B stays in one model lineage — fewer “personality jumps” than mixing vendors or families per tier. The on-GPU **classifier** also runs on the 7B endpoint (`ROUTING_LLM_CLASSIFIER_MODEL`). |
| **32B AWQ on one GPU** | AWQ makes 32B fit a 48 GB card with tool-call flags (`--enable-auto-tool-choice`, `--tool-call-parser hermes`) for agent-style chat. |
| **Open license** | Apache 2.0 — acceptable for on-campus student data without per-token cloud billing. |
| **Measured on our infra** | Warm 7B direct latency ~57 ms; EduAI full stack median ~211 ms; 10-way parallel without 5xx on cmps01 (Session vLLM-S1, Jun 2026). |

**Alternatives we considered and deferred:**

| Alternative | Why not on cmps02 chat fleet |
| --- | --- |
| **gpt-oss-120b** | Wrong economics for live chat; consumes both GPUs; better on B300 / heavy server |
| **Single 32B only** | Loses concurrency and sustainability default; pays 32B cost on every turn |
| **Single 7B only** | Cheapest, but weak on tools / hard reasoning without cloud fallback |
| **Mixing Llama / Mistral on cmps02** | Breaks fleet symmetry with cmps01; harder routing and ops |

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

From **s378** (after IT opens firewall):

```bash
curl -s http://cmps02.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
```

**EduAI** (`apps/core/.env` on s378) — today single URL; later multi-server config:

```env
VLLM_BASE_URL="http://cmps02.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

```bash
cd apps/core && npm run vllm:smoke
```

**Admin → AI Models → vLLM → Refresh list** → register both ids. Chat: `vllm:qwen2.5-7b-instruct` or Auto (routing picks tier).

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

- [cmps01](../cmps01/README.md) — primary GPU server (same model stack)
- [`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md) — EduAI vLLM provider, stress tests
- [`docs/rag-ai/routing/`](../../docs/rag-ai/routing/) — Auto routing rules and tiers
- [Multi-server routing plan](../../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md)
