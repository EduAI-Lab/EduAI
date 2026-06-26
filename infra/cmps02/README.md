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

## Business rationale — model choice for stakeholders

**Decision:** Deploy **Qwen 2.5 7B Instruct** (default) and **Qwen 2.5 32B Instruct AWQ** (escalation) on each Okanagan GPU server (cmps01, cmps02). Do **not** deploy 120B-class models on these chat servers — reserve those for LTIC B300 / cmps03 heavy jobs.

**One-line summary:** Use a **fast, cheap tier for most student chat** and a **stronger tier only when needed** — an industry-standard pattern that cuts cost and energy while keeping quality, on **open-weight models we can host on campus** with no per-token cloud bill.

### The business problem

EduAI serves **live tutoring chat** to classes where many students may be active at once. Stakeholders care about:

| Stakeholder concern | What drives it |
| --- | --- |
| **Response time in class** | Students wait on-screen; slow chat feels broken |
| **Operating cost** | GPU power, hardware amortization, staff time |
| **Data residency** | Course materials and student prompts on UBC-controlled infra |
| **Quality & trust** | Answers must be good enough for teaching, not just fast |
| **Sustainability** | EduAI’s routing research explicitly optimizes **energy per useful answer** |

Running one large model for every message — or paying cloud API rates for all traffic — is **expensive, slow under load, and hard to justify** when most questions are routine (definitions, syllabus, RAG over uploaded readings).

### Why two models (7B + 32B), not one

This is a **two-tier “fast + smart” stack**, aligned with how production AI systems are built:

| Industry pattern | EduAI equivalent |
| --- | --- |
| **Fast tier** — high volume, low cost ([40–60% of traffic in typical routers](https://www.mindstudio.ai/blog/set-up-ai-model-router-llm-stack-c2610)) | **Qwen 7B** — default for Auto routing, course RAG, everyday chat |
| **Power tier** — harder tasks only ([~10–20% of traffic](https://www.mindstudio.ai/blog/set-up-ai-model-router-llm-stack-c2610)) | **Qwen 32B** — tools, complex reasoning, debugging, image turns |

**Business benefits:**

1. **Lower cost per student interaction.** Research on production routing shows **30–85% inference cost reduction** when simple queries stay on smaller models and only hard queries escalate ([RouteLLM / FrugalGPT surveys](https://arxiv.org/html/2603.04445); [enterprise routing guide](https://www.calibreos.com/learn/genai-llm-router)). EduAI’s Auto router implements the same idea locally — no cloud invoice, but the **same economic logic**.

2. **Better classroom scalability.** Chat load is **concurrent users**, not daily logins. Our cmps01 measurements: vLLM **7B** handled **10 parallel requests at ~320–380 ms**; Ollama on the same host was **~15× slower** at 5-way parallel ([`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md)). Independent benchmarks report vLLM **far higher throughput** under concurrency than Ollama ([Red Hat, 2025](https://developers.redhat.com/articles/2025/08/08/ollama-vs-vllm-deep-dive-performance-benchmarking): peak ~793 vs ~41 tokens/s; P99 latency 80 ms vs 673 ms). **7B on vLLM is the throughput tier**; 32B is for quality escalation, not bulk traffic.

3. **Sustainability story stakeholders can defend.** Smaller models use less GPU time and energy per turn. Routing “most traffic to 7B, some to 32B” is directly aligned with EduAI’s [sustainability-aware routing goals](../../docs/rag-ai/routing/eduai-summer-2026/TEAM_ROUTING_LAYER_PLAN.md) — measurable, policy-driven, not “always use the biggest model.”

4. **Predictable hardware use.** One model per GPU (~15 GB + ~20 GB on 48 GB cards). Both stay loaded — **no multi-minute cold starts** when escalating. That supports reliable lab sessions.

5. **Fleet scaling.** cmps02 adds a **second identical stack** so live chat can spread across servers ([multi-server plan](../../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md)) — horizontal capacity, not a bigger single model.

**What we explicitly rejected for cmps02 chat:**

| Option | Business downside |
| --- | --- |
| **120B on both GPUs** | Removes server from chat pool; long queues; suited to B300 / Question Maker, not live chat |
| **32B only** | Pays “premium” compute on every message; worse concurrency and sustainability |
| **7B only** | Saves most cost but weak on tools / hard reasoning without cloud fallback |
| **Cloud default (GPT-4 class)** | Per-token cost at scale; PIA/residency constraints for course RAG |

### Why Qwen 2.5 Instruct (not Llama, Mistral, or cloud-by-default)

| Stakeholder question | Answer |
| --- | --- |
| **Is quality good enough for education?** | **7B:** Strong for its size — Qwen team reports **MMLU 74.2** (base) and instruct gains on math/coding/instruction benchmarks vs Llama 3 8B, Gemma2 9B, and prior Qwen2 ([Qwen 2.5 blog](https://qwenlm.github.io/blog/qwen2.5-llm/); [technical report](https://huggingface.co/papers/2412.15115)). Instruct 7B scores **IFEval 71.2** (instruction following), **GSM8K 91.6**, **HumanEval 84.8** ([official tables](https://qwenlm.github.io/blog/qwen2.5-llm/)). **32B:** **MMLU-redux 83.9**, competitive with or above **GPT-4o-mini** on several benchmarks in Qwen’s published comparisons ([32B instruct table](https://qwenlm.github.io/blog/qwen2.5-llm/)). Suitable as campus “house models” for tutoring — not frontier lab research, but **strong open-weight baselines**. |
| **Can we host it legally on campus?** | **7B and 32B are Apache 2.0** — commercial and research use, modification, redistribution allowed with attribution ([Qwen 2.5 release note](https://www.alibabacloud.com/blog/qwen2-5-a-party-of-foundation-models_601782); [GitHub QwenLM](https://github.com/qwenlm/qwen2.5)). No per-token license fee. *(Note: Qwen 3B and 72B use different terms — we avoid those sizes on this fleet.)* |
| **Does it fit UBC’s user base?** | Trained with **29+ languages** ([model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)); relevant for multilingual classrooms. **128K context** support (we run shorter limits in vLLM for VRAM). Good at **structured output and long context** — useful for RAG over course materials ([Qwen 2.5 improvements](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)). |
| **Why not Llama / Mistral?** | Qwen 2.5 7B **matches or beats** Llama 3.1 8B and Mistral 7B on published MMLU/MATH/coding benches ([Qwen comparisons](https://qwenlm.github.io/blog/qwen2.5-llm/)). More importantly: **cmps01 already runs Qwen**, routing code, classifier, and Admin IDs are wired to `qwen2.5-*`. cmps02 is **capacity expansion**, not a second model line — lower ops risk and apples-to-apples research data. |
| **Why not cloud APIs for everything?** | Cloud is right for **overflow or PIA-approved** paths later; it is not the default business case for high-volume student chat: recurring **per-token cost**, vendor dependency, and **data-governance review** for course content. Self-hosted Qwen gives **fixed infrastructure cost** and **on-campus control**. |
| **Why vLLM + Hugging Face weights?** | Production serving for **multi-user** workloads ([Red Hat](https://developers.redhat.com/articles/2025/07/08/ollama-or-vllm-how-choose-right-llm-serving-tool-your-use-case): vLLM for “hundreds or thousands of concurrent users”). Ollama remains for **embeddings and legacy** on cmps01; chat fleet standardizes on vLLM. |

### Mapping to EduAI product tiers

| Tier | Model | Business role |
| --- | --- | --- |
| **1 — Default** | `qwen2.5-7b-instruct` | “Good enough, fast, green” — most Auto-routed chat |
| **3 — Escalate** | `qwen2.5-32b-instruct` | “Instructor-grade reasoning” — tools, hard prompts, images |
| **Heavy / instructor** | `gpt-oss-120b` etc. | **Not on cmps02** → LTIC B300 or cmps03 ([plan](../../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md)) |

### Risks and mitigations (for honest stakeholder conversations)

| Risk | Mitigation |
| --- | --- |
| 7B wrong on hard questions | Auto rules + 32B escalation; users can pick model; research telemetry measures mis-routes |
| 32B still queues in huge classes | Multi-server fleet (cmps01 + cmps02); inference queue UX; load tests in rollout plan |
| Benchmarks ≠ classroom quality | EduAI research track (judge labels, energy, routing policies) on real prompts |
| Model ages | Qwen 3 exists; migration is a **fleet decision** — we can re-benchmark before switching |

### References (external)

- [Qwen 2.5 LLM blog — benchmarks, license, multilingual](https://qwenlm.github.io/blog/qwen2.5-llm/)
- [Qwen 2.5 technical report (Hugging Face)](https://huggingface.co/papers/2412.15115)
- [Qwen 2.5 7B Instruct model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)
- [Dynamic model routing survey (cost–quality tradeoff)](https://arxiv.org/html/2603.04445)
- [Red Hat — Ollama vs vLLM benchmarking](https://developers.redhat.com/articles/2025/08/08/ollama-vs-vllm-deep-dive-performance-benchmarking)
- [Three-tier LLM routing — cost split by traffic band](https://www.mindstudio.ai/blog/set-up-ai-model-router-llm-stack-c2610)

### References (EduAI internal)

- [`docs/rag-ai/VLLM.md`](../../docs/rag-ai/VLLM.md) — cmps01 latency and parallel load measurements
- [`docs/rag-ai/routing/`](../../docs/rag-ai/routing/) — Auto routing and sustainability goals
- [Multi-server routing plan](../../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md) — cmps01/cmps02/cmps03 roles

---

## Model rationale — technical summary (ops)

| Tier | Model | GPU | Typical use |
| --- | --- | --- | --- |
| **1** | `qwen2.5-7b-instruct` | 0 | Everyday chat, RAG Q&A, classifier |
| **3** | `qwen2.5-32b-instruct` (AWQ) | 1 | Tools, harder reasoning, images |

Deploy scripts: **`./migrate.sh`** (tiered 7B + 32B). **`migrate-120b.sh`** is deprecated on cmps02.

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
