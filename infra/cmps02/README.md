# cmps02 — vLLM inference host

**Hardware (probed Jun 2026):** 2× NVIDIA RTX 6000 Ada (~48 GB VRAM each, ~96 GB total).

**Recommended role:** Dedicated **`gpt-oss-120b`** host. Keep **Qwen 7B + 32B** on [cmps01](../cmps01/README.md) for routing tiers.

```text
dev (s378) ──HTTP :8001──► cmps02 nginx (:8001)
                                └── /v1/* → LiteLLM :18091 → vLLM :18001
                                      gpt-oss-120b (tensor-parallel across GPU 0 + 1)
```

EduAI: **`VLLM_BASE_URL=http://cmps02.ok.ubc.ca:8001`** · chat model **`vllm:gpt-oss-120b`**.

---

## Can we run 3 models (7B + 32B + 120B)?

**No — not at the same time on cmps02.**

| Model | Typical VRAM | Fits alone on 1× 48 GB? |
| --- | --- | --- |
| Qwen 7B | ~14–16 GB | Yes |
| Qwen 32B AWQ | ~18–22 GB | Yes |
| **gpt-oss-120b** (MXFP4) | **~60 GB+ weights** (+ KV cache) | **No** — needs ~80 GB class or **TP=2** across both GPUs |

`gpt-oss-120b` with `--tensor-parallel-size 2` **uses both GPUs together**. There is no third GPU left for 7B/32B while 120B is loaded.

| Layout | GPUs used | Models live simultaneously |
| --- | --- | --- |
| **Recommended** — `./migrate-120b.sh` | 0+1 (TP=2) | **gpt-oss-120b only** |
| Tiered — `./migrate-tiered.sh` | 0 → 7B, 1 → 32B | **7B + 32B only** (cmps01 clone) |
| All three | — | **Not feasible** on 2× 48 GB |

**Split across hosts (best of both worlds):**

| Host | Models | EduAI |
| --- | --- | --- |
| **cmps01** | `qwen2.5-7b-instruct`, `qwen2.5-32b-instruct` | `VLLM_BASE_URL` for tiered routing (today) |
| **cmps02** | `gpt-oss-120b` | Second base URL **or** migrate tiered stack here and keep 120B on cmps01 Ollama |

EduAI currently exposes **one** `VLLM_BASE_URL`. To use both hosts you either:

1. **Point dev at cmps02** for 120B experiments (`vllm:gpt-oss-120b`), keep cmps01 for production routing — switch `.env` when needed, or  
2. **Add a future LiteLLM route** on one host that proxies to the other (not in repo yet).

Question Maker already uses **`ollama:gpt-oss:120b`** on cmps01 — vLLM on cmps02 is the faster serving path for the same model family.

> **Ada Lovelace note:** vLLM’s GPT-OSS recipe targets H100/MI300 first; use image **`vllm/vllm-openai:v0.18.0`** and verify with `./probe.sh` + a smoke chat. If the container OOMs, lower `--max-model-len` (e.g. 16384) or `--gpu-memory-utilization` (0.85).

---

## Deploy (120B — recommended)

```bash
ssh ssaada08@cmps02.ok.ubc.ca
cd ~/cmps02
chmod +x probe.sh migrate-120b.sh deploy-edge-proxy.sh
./probe.sh
./migrate-120b.sh    # 20–60+ min first run
```

Verify:

```bash
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
# expect: gpt-oss-120b
```

**s378** (after IT opens firewall):

```env
VLLM_BASE_URL="http://cmps02.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Register in **Admin → AI Models → vLLM → Refresh list** → `gpt-oss-120b` → chat as **`vllm:gpt-oss-120b`**.

---

## Deploy (tiered 7B + 32B — optional)

Only if you are **not** running 120B on this host:

```bash
./migrate-tiered.sh
```

---

## Files

| Script | Purpose |
| --- | --- |
| `probe.sh` | GPU / Docker inventory |
| **`migrate-120b.sh`** | **gpt-oss-120b, TP=2 (default for cmps02)** |
| `migrate-tiered.sh` | Qwen 7B + 32B AWQ (cmps01 clone) |
| `migrate.sh` | Symlink-style alias → run `migrate-120b.sh` |
| `deploy-edge-proxy.sh` | Restart nginx + LiteLLM edge |

---

## IT / firewall

> Dev EduAI (s378) → **cmps02.ok.ubc.ca TCP 8001** (HTTP). Same pattern as cmps01.

---

## Related

- [cmps01](../cmps01/README.md) — tiered 7B/32B routing stack
- [`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md) — EduAI vLLM provider
