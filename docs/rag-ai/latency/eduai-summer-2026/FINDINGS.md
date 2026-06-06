# EduAI chat latency — findings

**Last updated:** 2026-05-29 · **Scope:** `deepseek-r1:8b` + `qwen2.5:7b` (tool path), dev → Ollama on `cmps01`  
**Status:** Core latency investigation complete (Sessions 1–7). Session 8 documents **tool-enabled model** behaviour — EduAI slower vs bare Ollama is **expected** on that path.

> **Benchmark data:** Raw JSON/CSV is **not** in this branch. Check out git branch **`troubleshoot-RAG-delay`** — layout in [`apps/core/output/README.md`](https://github.com/EduAI-Lab/EduAI/blob/troubleshoot-RAG-delay/apps/core/output/README.md), artifacts under [`apps/core/output/`](https://github.com/EduAI-Lab/EduAI/tree/troubleshoot-RAG-delay/apps/core/output). Session index: [appendix — Data files](./FINDINGS_APPENDIX.md#data-files-on-troubleshoot-rag-delay).

---

## Summary

We benchmarked EduAI end-to-end against calling the **same model on the same GPU** without the EduAI app in the middle. The slow UX is **not** caused by Core/RAG code. It comes from:

1. **GPU cold start** — first request after the model was unloaded or idle ~6+ minutes pays **~9–10 seconds** before tokens stream.
2. **How many tokens the model generates** — especially `deepseek-r1` reasoning tokens; total time scales at **~8.5 ms per token** (~130 tokens/s) when warm.
3. **A small, fixed EduAI overhead** — about **60–70 ms** to first token on top of the model; pipeline work before the LLM is **under 15 ms**.

When the model is **warm** and the reply is **short**, chat is typically **~2–4 seconds**. When the model is **cold** or the model emits **hundreds of reasoning tokens**, **10–20+ seconds** is expected — on both EduAI and raw Ollama.

---

## At a glance

| Situation | What users see | Main cause |
| --------- | -------------- | ---------- |
| Model warm, short answer | ~2–4 s total | Normal decode (~130 tok/s) |
| Model cold / evicted from GPU | +**~9–10 s** before first token | Loading weights into VRAM |
| Long or reasoning-heavy reply | 10–20+ s total | Token count (not slower per token) |
| SSH / interactive Ollama chat | Often feels fast | Keeps the model resident on GPU |

---

## What we proved

| Question | Answer |
| -------- | ------ |
| Is EduAI Core/RAG the bottleneck? | **No** — pre-LLM pipeline &lt; 15 ms; ~60–70 ms app overhead to first token. |
| Is EduAI much slower than calling Ollama directly? | **No** — same per-token speed when warm; same cold-start penalty. |
| Why did one run take ~21 s and another ~2.6 s? | **Cold GPU + longer generation**, not a fixed EduAI cost. |
| Does production temperature (0.6) change the story? | **No** — Session 7 matched Session 6 within noise. |

**How we know without “bare metal”:** We did not compare Ollama to vLLM or direct CUDA. We compared **EduAI → Ollama** vs **bench → Ollama** on the same machine. That isolates whether **EduAI adds** the slowness (it doesn’t). Whether Ollama is the best possible runtime is a separate, unmeasured question.

---

## What we did not prove

- Ollama vs a dedicated inference server (vLLM, TGI, etc.) — not tested.
- Reasoning vs plain instruct model on DeepSeek — use `llama3.1:8b` / `qwen2.5:7b` on cmps01 for Comparison 3 instead.

### Session 8 — tool-enabled model (`qwen2.5:7b`) — expected asymmetry

[`session8-qwen-warm/`](https://github.com/EduAI-Lab/EduAI/tree/troubleshoot-RAG-delay/apps/core/output/session8-qwen-warm) on **`troubleshoot-RAG-delay`** compared EduAI vs Ollama-direct when warm. **EduAI was slower — and that is expected**, not a regression.

| Surface | Path | TTFT median | Total median |
| ------- | ---- | -----------: | -----------: |
| **EduAI** | **`tool_calling`** (Qwen has `supportsTools`) | ~470 ms–1 s | **~6.2 s** |
| **Ollama-direct** | Bare prompt only | ~350 ms | **~1.3 s** |

**Why:** Ollama-direct sends a single user message to the model. EduAI runs the full app pipeline first — auth, DB, **`tool_calling` branch** (tools registered, larger system prompt, up to `maxSteps`), then the same Ollama model. The bench’s short prompts did not use a course code, so `getInformation` may not have fired every turn; the **tool path and richer prompt still apply**. This is a **different workload** than Sessions 6–7 (DeepSeek **hybrid** path, ~62 ms overhead, matched per-token speed).

**Do not** read Session 8 as “EduAI is 5× slower than Ollama.” Read it as: **the tool-enabled product path costs more than a bare API call** — measure tool-path latency separately from hybrid/reasoning latency. Details: [appendix Session 8](./FINDINGS_APPENDIX.md#session-8--qwen-tool-path-qwen25-7b).

Bench caveats for Sessions 5–7 are in the [appendix](./FINDINGS_APPENDIX.md#limitations-and-caveats).

---

## Recommended actions

| Action | Who | Why |
| ------ | --- | --- |
| Set **`OLLAMA_KEEP_ALIVE`** (session TTL, not infinite) on `cmps01` | Ops | **Dev/shared-GPU shortcut** — cuts ~9–10 s cold penalty; see [scalability](#scalability--beyond-always-on-ollama) for production alternatives |
| **Cap `maxTokens`** for chat (e.g. 512–1024 vs 8192) | Engineering | Limits worst-case 10–20 s turns |
| Prefer a **non-reasoning model** for fast chat UX | Product | Fewer hidden reasoning tokens |
| Reduce **models resident** on shared GPU | Ops | Less eviction/contention |
| Optional: **warm ping** during dev hours | Ops | Keeps model loaded |

---

## FAQ

**Was Ollama / the GPU the problem?**  
Time is on the model/GPU side. EduAI adds ~60 ms and &lt; 15 ms of pipeline work — not seconds.

**Why does terminal Ollama feel fast but the web app slow?**  
Interactive use keeps the model on GPU. The web app’s first request after idle pays the cold-load penalty.

**Do repeats get faster?**  
**Yes for time-to-first-token** once the model is resident (~9 s → ~0.2 s). Total time still depends on how long the model writes.

**Should we rewrite Core/RAG for speed?**  
Not based on this data. Focus on **keep-alive**, **token limits**, and **model choice** first.

**Do we need Ollama on 24/7?**  
**No for production.** TTL keep-alive (e.g. 30 min) is fine for dev. At scale, use **routing** (small/cloud default), **cold-load UX**, **queues**, and eventually **dedicated inference or cloud API** — see [Scalability](#scalability--beyond-always-on-ollama).

---

## Related docs

| Doc | Audience |
| --- | -------- |
| [**Solutions plan**](./SOLUTIONS_PLAN.md) | **What to build next** — TTL persistence, residency-aware routing, classroom queue |
| [**Investigation appendix**](./FINDINGS_APPENDIX.md) | Numbers per session, methodology, confounds, how to re-run benches |
| [Team problem statement & options](./TEAM_CHAT_LATENCY_AND_TOOLS.md) | Sprint context |
| [Pipeline logging](../RAG_PIPELINE_LATENCY_LOGGING.md) | Enable `[rag-pipeline]` step timing |
| [Chat RAG pipeline](../../CHAT_RAG_PIPELINE.md) | Architecture reference |
| [Benchmark data](./FINDINGS_APPENDIX.md#data-files-on-troubleshoot-rag-delay) | On **`troubleshoot-RAG-delay`** → `apps/core/output/<session>/` ([README](https://github.com/EduAI-Lab/EduAI/blob/troubleshoot-RAG-delay/apps/core/output/README.md)) |

---

## Open follow-ups (optional)

- [x] Tool-path warm benchmark — Session 8 (`qwen2.5:7b`, tool_calling vs bare Ollama); re-run with **course + RAG prompt** to time real `getInformation` loops
- [ ] `deepseek-r1` vs instruct (`llama3.1:8b` / `qwen2.5:7b` hybrid path) on cmps01
- [ ] Fully matched bench re-run (override + fresh chat per prompt) — polish only

---

## Next steps

The core latency investigation is **closed**. Work below is ordered by impact; items marked **scalable** are the path off “one shared Ollama GPU on 24/7.”

### 1. Near term — shared dev GPU (`cmps01`)

| Step | Owner | Notes |
| ---- | ----- | ----- |
| **`OLLAMA_KEEP_ALIVE` with a TTL** (e.g. 15–30 min after last request, not `-1` forever) | Ops | Acceptable **dev compromise**: one house model stays warm during active use; VRAM freed after idle. Not a production architecture. |
| **One default “house” model** on the shared GPU (e.g. `qwen2.5:7b` for speed) | Ops / product | Fewer model swaps → less eviction; deepseek/gemma only when explicitly chosen |
| **Cap `maxTokens`** for chat (512–1024 vs 8192) | Engineering | Limits worst-case 10–20 s turns regardless of runtime |
| **UX: “Loading model…”** when cold (detect ~9 s TTFT or `resident=false`) | Engineering | Makes cold start **expected**, not “broken” — required if we don’t keep models loaded |
| Share this doc with the team | Lead | Latency epic can close; tools/course track is separate |

### 2. Tools & course-awareness (separate track)

Measured separately from latency. Session 1 + manual tests show the **tool_calling** branch runs, but local Ollama models often **`toolCallCount: 0`** even with a course selected — RAG only runs if the model calls `getInformation`.

| Step | Owner | Notes |
| ---- | ----- | ----- |
| **Auto-RAG when course selected** (L03) — run `findRelevantContent` before `streamText` on tool path too | Engineering | [Sprint guide](./TEAM_CHAT_LATENCY_SPRINT_GUIDE.md#step-l03--auto-rag-when-course-is-selected-spike) — fixes “course selected but no materials” without relying on the model |
| Set **`supportsTools: false`** for deepseek / unreliable local tool models in admin | Engineering | Use hybrid RAG; avoid tool-path hangs on reasoning models |
| Tool-path benchmark: **qwen**, course + explicit RAG prompt | QA | Session 8 baseline done (no course); next: `CHAT_BENCH_COURSE_CODE` + materials question — see [Session 8](./FINDINGS_APPENDIX.md#session-8--qwen-tool-path-qwen25-7b) |
| Cloud sanity check: same prompt on **`google:gemini-2.5-flash`** | QA | Separates pipeline bugs from Ollama tool reliability |
| Confirm **`OPENROUTER_API_KEY`** + **`FIRECRAWL_API_KEY`** on dev server | Ops | Only when tools actually fire |

### 3. Optional polish

- [ ] Fully matched bench re-run (override + fresh chat per prompt)
- [ ] `deepseek-r1` vs instruct model when one is available on `cmps01`
- [ ] Document tool-path findings in [appendix](./FINDINGS_APPENDIX.md) after course-aware re-run

---

## Scalability — beyond always-on Ollama

**Problem:** On a shared GPU, cold load costs **~9–10 s**. Keeping Ollama loaded 24/7 fixes UX but **does not scale**: VRAM is fixed, concurrent users contend, and cost grows with “always resident” large models.

**Goal:** Accept that models **will** unload or queue under load; design so latency stays predictable and infrastructure can grow horizontally.

### Tier A — Low effort, still single GPU (good for dev / small cohort)

| Approach | Scales how | Trade-off |
| -------- | ---------- | --------- |
| **Session TTL keep-alive** (`keep_alive: 30m`) | VRAM shared across users for a window; frees after idle | First user after idle still pays cold start — mitigate with UX |
| **Smaller default model** (7–8B instruct, not 31B reasoning) | Faster cold load, higher throughput, less VRAM | Quality cap on default tier |
| **Token caps + terser prompts** | Less decode time per turn | May truncate long answers |
| **Single house model policy** | No swap thrashing on one GPU | Users don’t get arbitrary model choice without cost |

### Tier B — Product / routing (multi-user on limited GPU) **scalable**

| Approach | Scales how | Trade-off |
| -------- | ---------- | --------- |
| **[Model routing / Auto tier](../../routing/eduai-summer-2026/TEAM_ROUTING_LAYER_PLAN.md)** | Most turns hit Tier 1 (small/cloud); large local model only when tools/images/RAG need it | Requires routing rules + telemetry (Phase 0–1) |
| **Cloud fallback when local cold or busy** | Route to Gemini/OpenAI API for that request; local GPU warms in background or stays unloaded | API cost; privacy policy for course data |
| **Pre-warm on intent, not 24/7** | Warm GPU when user opens chat / selects course / picks a local model — not forever | Still one cold user if pre-warm missed |
| **Request queue + backpressure** | One inference slot on GPU; users see queue position instead of timeout | Latency under spike load, but **fair** and no OOM |

### Tier C — Infrastructure (production scale) **scalable**

| Approach | Scales how | Trade-off |
| -------- | ---------- | --------- |
| **Dedicated inference server** (vLLM, SGLang, TGI) OpenAI-compatible | Continuous batching, better multi-tenant than Ollama; same EduAI provider wiring | Ops setup; not yet benchmarked in this repo |
| **Horizontal GPU pool** | N nodes × one warm model each; load balancer by model id | Cost ∝ GPU count; needs orchestration |
| **Separate tiers: dev (shared Ollama) vs prod (managed API or dedicated cluster)** | Dev keeps cost down; prod SLAs on cloud or reserved GPUs | Two environments to maintain |
| **Managed GPU / serverless inference** (Modal, Baseten, etc.) | Scale toward zero with acknowledged cold start; scale out under load | Vendor lock-in; cold start still exists unless min instances > 0 |

### Recommended direction for EduAI

1. **Now (dev):** TTL keep-alive + one house model + token caps + cold-load UX — **not** infinite keep-alive.
2. **Next product slice:** **Auto routing** (small/cloud default) + **auto-RAG when course selected** — fewer tool round-trips, less dependence on local 31B tool calling.
3. **Before large cohort / production:** Benchmark **vLLM (or cloud API)** vs Ollama on the same prompts; decide if local GPU is “default” or “premium tier only.”
4. **Never rely on** “SSH keeps it warm” or “one GPU runs every model users might pick” as the production story.

*Changelog and session-by-session tables: [appendix](./FINDINGS_APPENDIX.md#changelog).*
