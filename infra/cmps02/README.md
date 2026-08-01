# cmps02 — vLLM inference host

**Hardware:** 2× NVIDIA RTX 6000 Ada (~48 GB VRAM each).

**Role:** Second **live-chat** GPU server. EduAI's multi-server plan spreads
student chat across cmps01 and cmps02; heavy models (e.g. the MoE judge)
belong on **cmps03**, not here. This host is also used for research adequacy
runs (ladder comparisons, calibration labeling) between deployments — those
scripts (`migrate-research.sh`, `judge-*-local.py`, etc.) live on the host
under `~/cmps02/` and are not committed here, since they are one-off research
tooling rather than the production deploy path.

```text
dev (s378) ──HTTP :8001──► cmps02 eduai-edge-proxy (nginx)
                                ├── /v1/*     → LiteLLM 127.0.0.1:18091
                                │                 ├──► 127.0.0.1:18001  eduai-vllm      (GPU 0, Qwen3.5-4B)
                                │                 └──► 127.0.0.1:18002  eduai-vllm-t3   (GPU 1, Qwen3.5-27B FP8)
                                └── /energy/* → energy-meter 127.0.0.1:9100 (optional)
```

**Model family (2026-07-31):** upgraded from Qwen2.5 (7B/32B) to **Qwen3.5**
(4B/27B-FP8) per `docs/research/v3/PREREG_v3.md` §2.1's model-family freeze.

EduAI (once multi-server routing lands): **`http://cmps02.ok.ubc.ca:8001`**
for chat/tutor traffic. Models: **`vllm:qwen3.5-4b-instruct`**,
**`vllm:qwen3.5-27b-instruct`**.

### Models on this host

| Tier | Model | GPU | Typical use |
| --- | --- | --- | --- |
| **Small** | `qwen3.5-4b-instruct` | 0 | Everyday chat, RAG Q&A, classifier |
| **Large** | `qwen3.5-27b-instruct` (FP8) | 1 | Tools, harder reasoning, images |

Deploy: **`./migrate.sh`**.

---

## Deploy

```bash
ssh YOUR_CWL@cmps02.ok.ubc.ca
cd ~/cmps02
chmod +x migrate.sh
./migrate.sh          # 15–45+ min while weights load (first pull)
```

Verify on cmps02:

```bash
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
# expect: qwen3.5-4b-instruct
#         qwen3.5-27b-instruct
```

From **s378** (after IT opens firewall):

```bash
curl -s http://cmps02.ok.ubc.ca:8001/v1/models -H "Authorization: Bearer vllm-local" | jq '.data[].id'
```

**EduAI** (`apps/core/.env` on s378) — today single URL; later multi-server config:

```env
VLLM_FLEET_CHAT_URLS="http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001"
```

---

## Qwen3.5 deploy note (Mamba cache limit)

The hybrid Gated-DeltaNet/Mamba architecture caps concurrent sequences by
available Mamba cache blocks, independent of `--gpu-memory-utilization`. If
vLLM logs `max_num_seqs (256) exceeds available Mamba cache blocks (N)` on
startup, the container will crash-loop under `--restart unless-stopped`. Fix:
`docker stop`/`rm` the container and recreate with
`--max-num-seqs <N or lower>` — 224 worked at `--gpu-memory-utilization 0.90`
for `Qwen3.5-27B-FP8` on this host's GPU 1 (already baked into `migrate.sh`).

## Thinking mode

`docs/research/v3/PREREG_v3.md` §2.1 requires thinking mode **disabled** for
all research runs. Observed default: Qwen3.5-4B and Qwen3.5-27B-FP8 both
emit a `Thinking Process:` preamble unless the request explicitly passes
`chat_template_kwargs: {"enable_thinking": false}`. This is a per-request
concern for the Core/routing integration, not something `migrate.sh` can
fix at the server level.

---

## Related docs

- [`../cmps01/README.md`](../cmps01/README.md) — sibling live-chat host, same pattern
- [`docs/research/v3/PREREG_v3.md`](../../docs/research/v3/PREREG_v3.md) — model-family freeze, tier-selection protocol
- [`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md) — EduAI vLLM provider, stress tests, energy
