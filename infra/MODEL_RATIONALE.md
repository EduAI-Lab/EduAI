# EduAI GPU fleet — model choice rationale (stakeholders)

**Audience:** Faculty, IT, leadership, partners  
**Status:** June 2026  
**Applies to:** Okanagan chat servers (**cmps01**, **cmps02**, and matching fleet nodes) — not LTIC B300 / cmps03 heavy jobs.

**Decision:** Deploy **Qwen 2.5 7B Instruct** (default) and **Qwen 2.5 32B Instruct AWQ** (escalation) on each Okanagan GPU server. Do **not** deploy 120B-class models on these chat servers — reserve those for **LTIC B300 (Vancouver)** or **cmps03** batch / instructor work.

**One-line summary:** Use a **fast, cheap tier for most student chat** and a **stronger tier only when needed** — an industry-standard pattern that cuts cost and energy while keeping quality, on **open-weight models we can host on campus** with no per-token cloud bill.

**Server ops:** [cmps01](./cmps01/README.md) · [cmps02](./cmps02/README.md)

---

## The business problem

EduAI serves **live tutoring chat** to classes where many students may be active at once. Stakeholders care about:


| Stakeholder concern        | What drives it                                                             |
| -------------------------- | -------------------------------------------------------------------------- |
| **Response time in class** | Students wait on-screen; slow chat feels broken                            |
| **Operating cost**         | GPU power, hardware amortization, staff time                               |
| **Data residency**         | Course materials and student prompts on UBC-controlled infra               |
| **Quality & trust**        | Answers must be good enough for teaching, not just fast                    |
| **Sustainability**         | EduAI’s routing research explicitly optimizes **energy per useful answer** |


Running one large model for every message — or paying cloud API rates for all traffic — is **expensive, slow under load, and hard to justify** when most questions are routine (definitions, syllabus, RAG over uploaded readings).

---

## Why two models (7B + 32B), not one

This is a **two-tier “fast + smart” stack**, aligned with how production AI systems are built:


| Industry pattern                                                                                                                                      | EduAI equivalent                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Fast tier** — high volume, low cost ([40–60% of traffic in typical routers](https://www.mindstudio.ai/blog/set-up-ai-model-router-llm-stack-c2610)) | **Qwen 7B** — default for Auto routing, course RAG, everyday chat |
| **Power tier** — harder tasks only ([~10–20% of traffic](https://www.mindstudio.ai/blog/set-up-ai-model-router-llm-stack-c2610))                      | **Qwen 32B** — tools, complex reasoning, debugging, image turns   |


### Business benefits

1. **Lower cost per student interaction.** Research on production routing shows **30–85% inference cost reduction** when simple queries stay on smaller models and only hard queries escalate ([routing survey](https://arxiv.org/html/2603.04445); [enterprise routing guide](https://www.calibreos.com/learn/genai-llm-router)). EduAI’s Auto router implements the same idea locally — no cloud invoice, but the **same economic logic**.
2. **Better classroom scalability.** Chat load is **concurrent users**, not daily logins. Our cmps01 measurements: vLLM **7B** handled **10 parallel requests at ~320–380 ms**; Ollama on the same host was **~15× slower** at 5-way parallel (`[docs/rag-ai/VLLM.md](../docs/rag-ai/VLLM.md)`). Independent benchmarks report vLLM **far higher throughput** under concurrency than Ollama ([Red Hat, 2025](https://developers.redhat.com/articles/2025/08/08/ollama-vs-vllm-deep-dive-performance-benchmarking): peak ~793 vs ~41 tokens/s; P99 latency 80 ms vs 673 ms). **7B on vLLM is the throughput tier**; 32B is for quality escalation, not bulk traffic.
3. **Sustainability story stakeholders can defend.** Smaller models use less GPU time and energy per turn. Routing “most traffic to 7B, some to 32B” is directly aligned with EduAI’s [sustainability-aware routing goals](../docs/rag-ai/routing/eduai-summer-2026/TEAM_ROUTING_LAYER_PLAN.md) — measurable, policy-driven, not “always use the biggest model.”
4. **Predictable hardware use.** One model per GPU (~15 GB + ~20 GB on 48 GB cards). Both stay loaded — **no multi-minute cold starts** when escalating. That supports reliable lab sessions.
5. **Fleet scaling.** Additional servers (e.g. **cmps02**) run the **same stack** so live chat spreads horizontally ([multi-server plan](../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md)) — more capacity, not a bigger single model.

### What we explicitly rejected 


| Option                          | Business downside                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| **120B on both GPUs**           | Removes server from chat pool; long queues; suited to B300 / Question Maker, not live chat |
| **32B only**                    | Pays “premium” compute on every message; worse concurrency and sustainability              |
| **7B only**                     | Saves most cost but weak on tools / hard reasoning without cloud fallback                  |
| **Cloud default (GPT-4 class)** | Per-token cost at scale; PIA/residency constraints for course RAG                          |


---

## Why Qwen 2.5 Instruct (not Llama, Mistral, or cloud-by-default)


| Stakeholder question                      | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Is quality good enough for education?** | **7B:** Strong for its size — Qwen team reports **MMLU 74.2** (base) and instruct gains on math/coding/instruction benchmarks vs Llama 3 8B, Gemma2 9B, and prior Qwen2 ([Qwen 2.5 blog](https://qwenlm.github.io/blog/qwen2.5-llm/); [technical report](https://huggingface.co/papers/2412.15115)). Instruct 7B scores **IFEval 71.2** (instruction following), **GSM8K 91.6**, **HumanEval 84.8** ([official tables](https://qwenlm.github.io/blog/qwen2.5-llm/)). **32B:** **MMLU-redux 83.9**, competitive with or above **GPT-4o-mini** on several benchmarks in Qwen’s published comparisons ([32B instruct table](https://qwenlm.github.io/blog/qwen2.5-llm/)). Suitable as campus “house models” for tutoring — not frontier lab research, but **strong open-weight baselines**. |
| **Can we host it legally on campus?**     | **7B and 32B are Apache 2.0** — commercial and research use, modification, redistribution allowed with attribution ([Qwen 2.5 release note](https://www.alibabacloud.com/blog/qwen2-5-a-party-of-foundation-models_601782); [GitHub QwenLM](https://github.com/qwenlm/qwen2.5)). No per-token license fee. *(Note: Qwen 3B and 72B use different terms — we avoid those sizes on this fleet.)*                                                                                                                                                                                                                                                                                                                                                                                           |
| **Does it fit UBC’s user base?**          | Trained with **29+ languages** ([model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)); relevant for multilingual classrooms. **128K context** support (we run shorter limits in vLLM for VRAM). Good at **structured output and long context** — useful for RAG over course materials ([Qwen 2.5 improvements](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)).                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Why not Llama / Mistral?**              | Qwen 2.5 7B **matches or beats** Llama 3.1 8B and Mistral 7B on published MMLU/MATH/coding benches ([Qwen comparisons](https://qwenlm.github.io/blog/qwen2.5-llm/)). More importantly: **cmps01 already runs Qwen**, routing code, classifier, and Admin IDs are wired to `qwen2.5-`*. New fleet nodes are **capacity expansion**, not a second model line — lower ops risk and apples-to-apples research data.                                                                                                                                                                                                                                                                                                                                                                          |
| **Why not cloud APIs for everything?**    | Cloud is right for **overflow or PIA-approved** paths later; it is not the default business case for high-volume student chat: recurring **per-token cost**, vendor dependency, and **data-governance review** for course content. Self-hosted Qwen gives **fixed infrastructure cost** and **on-campus control**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Why vLLM + Hugging Face weights?**      | Production serving for **multi-user** workloads ([Red Hat](https://developers.redhat.com/articles/2025/07/08/ollama-or-vllm-how-choose-right-llm-serving-tool-your-use-case): vLLM for “hundreds or thousands of concurrent users”). Ollama remains for **embeddings and legacy** on cmps01; chat fleet standardizes on vLLM.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |


---

## Mapping to EduAI product tiers


| Tier                   | Model                  | Business role                                              | Typical host      |
| ---------------------- | ---------------------- | ---------------------------------------------------------- | ----------------- |
| **1 — Default**        | `qwen2.5-7b-instruct`  | “Good enough, fast, green” — most Auto-routed chat         | cmps01, cmps02    |
| **3 — Escalate**       | `qwen2.5-32b-instruct` | “Instructor-grade reasoning” — tools, hard prompts, images | cmps01, cmps02    |
| **Heavy / instructor** | `gpt-oss-120b` etc.    | Batch generation, eval — not live student chat             | LTIC B300, cmps03 |


---

## Risks and mitigations


| Risk                             | Mitigation                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| 7B wrong on hard questions       | Auto rules + 32B escalation; users can pick model; research telemetry measures mis-routes |
| 32B still queues in huge classes | Multi-server fleet; inference queue UX; load tests in rollout plan                        |
| Benchmarks ≠ classroom quality   | EduAI research track (judge labels, energy, routing policies) on real prompts             |
| Model ages                       | Qwen 3 exists; migration is a **fleet decision** — re-benchmark before switching          |


---

## References (external)

- [Qwen 2.5 LLM blog — benchmarks, license, multilingual](https://qwenlm.github.io/blog/qwen2.5-llm/)
- [Qwen 2.5 technical report (Hugging Face)](https://huggingface.co/papers/2412.15115)
- [Qwen 2.5 7B Instruct model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)
- [Dynamic model routing survey (cost–quality tradeoff)](https://arxiv.org/html/2603.04445)
- [Red Hat — Ollama vs vLLM benchmarking](https://developers.redhat.com/articles/2025/08/08/ollama-vs-vllm-deep-dive-performance-benchmarking)
- [Three-tier LLM routing — cost split by traffic band](https://www.mindstudio.ai/blog/set-up-ai-model-router-llm-stack-c2610)

## References (EduAI internal)

- `[docs/rag-ai/VLLM.md](../docs/rag-ai/VLLM.md)` — cmps01 latency and parallel load measurements
- `[docs/rag-ai/routing/](../docs/rag-ai/routing/)` — Auto routing and sustainability goals
- [Multi-server routing plan](../../docs/plans/MULTI_SERVER_ROUTING_PLAN.md) — cmps01/cmps02/cmps03 roles
- [cmps01 ops](./cmps01/README.md) · [cmps02 ops](./cmps02/README.md)

