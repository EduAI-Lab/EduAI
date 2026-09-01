# EduAI RAG & chat — implementation docs

Team documentation for **course-aware retrieval**, the **`POST /api/chat`** pipeline, **chat latency**, **model routing**, and the shared **dev server**. Living references — update the relevant file when behavior or sprint scope changes.

**Current team focus:** [GitHub #203 — Chat latency & smart grounding sprint](https://github.com/EduAI-Lab/EduAI/issues/203) → start in [`latency/eduai-summer-2026/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./latency/eduai-summer-2026/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md).

**Local chat inference** runs on the campus GPU hosts (**cmps01/02/03**). EduAI app hosts call them over **HTTP**:

| Service | Port | EduAI provider |
| ------- | ---- | -------------- |
| **Ollama** | 11434 | `ollama:…` |
| **vLLM**, behind the nginx/LiteLLM edge | **8001** | `vllm:…` (OpenAI-compatible; see setup doc) |

**Embeddings** for RAG are **not necessarily cloud**. The path is chosen by `EMBEDDING_PROVIDER` plus per-course `Course.embeddingProvider` / `embeddingModel` columns: `local` uses an OpenAI-compatible vLLM embedding endpoint (`VLLM_EMBEDDING_BASE_URL`) or Ollama `mxbai-embed-large` on the GPU host — this is the dev-server default — and `cloud` uses OpenRouter/OpenAI server keys. **A local failure throws rather than silently falling back to cloud**, because index and query must share a model space. See [`EMBEDDINGS.md`](./EMBEDDINGS.md) and [`LOCAL-EMBEDDINGS.md`](./LOCAL-EMBEDDINGS.md).

**Architecture:** [../ARCHITECTURE.md](../ARCHITECTURE.md#cmps01-gpu-inference-host) · **Deploy:** [../DEPLOYMENT.md](../DEPLOYMENT.md).

---

## Where to start

| If you are… | Read first |
| ----------- | ---------- |
| New to EduAI chat/RAG | [`CHAT_RAG_PIPELINE.md`](./CHAT_RAG_PIPELINE.md) |
| How embeddings, API keys, and pgvector fit together | [`EMBEDDINGS.md`](./EMBEDDINGS.md) |
| Picking up latency work (#203) | [`latency/eduai-summer-2026/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./latency/eduai-summer-2026/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md) |
| **Latency investigation conclusions** | [`latency/eduai-summer-2026/FINDINGS.md`](./latency/eduai-summer-2026/FINDINGS.md) → appendix + [`SOLUTIONS_PLAN.md`](./latency/eduai-summer-2026/SOLUTIONS_PLAN.md) |
| Discussing tools vs speed trade-offs | [`latency/eduai-summer-2026/TEAM_CHAT_LATENCY_AND_TOOLS.md`](./latency/eduai-summer-2026/TEAM_CHAT_LATENCY_AND_TOOLS.md) |
| Logging probe timings | [`latency/MODEL_LATENCY_TRACKER.md`](./latency/MODEL_LATENCY_TRACKER.md) |
| Understanding Auto routing as shipped | `apps/core/app/lib/ai/routing/` — `router.ts` (mode dispatch), `rules.ts`, `knn.ts`, `llm-classifier.ts`, `tiers.ts`, `fleet/`, `bedrock/`. The plan docs below are the *background*, not the current contract. |
| Background on why Auto routing exists (#197) | [`routing/eduai-summer-2026/TEAM_PHASE_0_AND_1_GUIDE.md`](./routing/eduai-summer-2026/TEAM_PHASE_0_AND_1_GUIDE.md) |
| **Agent-ready endpoints & chat tools** (#167) | [`../AGENT_READINESS.md`](../AGENT_READINESS.md) |
| Testing on `dev.eduai.ok.ubc.ca` | [`HOW_TO_USE_DEV_SERVER.md`](./HOW_TO_USE_DEV_SERVER.md) |
| vLLM on cmps01 (Docker, firewall, EduAI wiring) | [`VLLM.md`](./VLLM.md) |

---

## Root (`docs/rag-ai/`)

| File | Brief description |
| ---- | ----------------- |
| [`CHAT_RAG_PIPELINE.md`](./CHAT_RAG_PIPELINE.md) | **Architecture reference** — Mermaid flow of `/api/chat`, hybrid vs tool-calling RAG, `findRelevantContent`, and response paths. Match to `apps/core` on merge. |
| [`EMBEDDINGS.md`](./EMBEDDINGS.md) | **Embeddings & storage** — index vs query lifecycle, local Ollama + cloud fallback, server vs chat API keys, pgvector tables, hosting, failures, env vars. |
| [`LOCAL-EMBEDDINGS.md`](./LOCAL-EMBEDDINGS.md) | **Architecture decision** — local model (`mxbai-embed-large`), `vector(1024)` migration, re-embed strategy ([#361](https://github.com/EduAI-Lab/EduAI/issues/361)). |
| [`VLLM.md`](./VLLM.md) | **vLLM on the GPU hosts** — Docker + LiteLLM proxy on `:8001`, IT firewall, EduAI `vllm` provider wiring, stress test vs Ollama, smoke test. |
| [`IVFFLAT_EXPLAIN_EVIDENCE.md`](./IVFFLAT_EXPLAIN_EVIDENCE.md) | **Evidence (#940)** — Live `EXPLAIN (ANALYZE, BUFFERS)` showing why `ivfflat.iterative_scan` is required for a small course inside a large shared table, plus reproduction steps. |
| [`RAG_INGESTION_TEST.md`](./RAG_INGESTION_TEST.md) | **Manual test guide** — Upload the [`fixtures/`](./fixtures/) files and check three known-answer prompts. Seed with `npx tsx scripts/seed-rag-ingestion-fixtures.ts`. |
| [`ADR-prior-question-cache.md`](./ADR-prior-question-cache.md) | **Architecture decision** — Whether to cache prior question/answer pairs. |
| [`HOW_TO_USE_DEV_SERVER.md`](./HOW_TO_USE_DEV_SERVER.md) | **Ops runbook** — VPN, SSH, branch checkout, `tmux`, Docker DB, and Turbo dev on the shared UBCO host (`dev.eduai.ok.ubc.ca`). |
| [`eduai-summer-2026/EDUAI_HELPME_ANALYSIS.md`](./eduai-summer-2026/EDUAI_HELPME_ANALYSIS.md) | **Research / borrow list** — What to port from the legacy HelpMe chatbot (caching, chunking, local embeds) vs what stays in EduAI’s stack. Related to #195–#196. |

---

## `latency/` — chat speed & tool grounding ([#203](https://github.com/EduAI-Lab/EduAI/issues/203))

| File | Brief description |
| ---- | ----------------- |
| [`latency/eduai-summer-2026/FINDINGS.md`](./latency/eduai-summer-2026/FINDINGS.md) | **Investigation summary** — Root causes (GPU cold start, token volume, ~60–70 ms EduAI overhead); warm vs cold UX; Session 8 tool-path notes. **Start here** after the sprint guide. |
| [`latency/eduai-summer-2026/FINDINGS_APPENDIX.md`](./latency/eduai-summer-2026/FINDINGS_APPENDIX.md) | **Evidence & methodology** — Sessions 1–8, confounds, bench protocol, raw data paths on `troubleshoot-RAG-delay`. |
| [`latency/eduai-summer-2026/SOLUTIONS_PLAN.md`](./latency/eduai-summer-2026/SOLUTIONS_PLAN.md) | **Mitigations & roadmap** — TTL keep-alive, routing, token caps, cold-load UX, scale path. |
| [`latency/eduai-summer-2026/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./latency/eduai-summer-2026/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md) | **Sprint playbook** — Delegatable steps L00–L09 (bench script, baselines, auto-RAG, intent routing, Ollama warm-up, TTFT audit). Teammate entry point. |
| [`latency/eduai-summer-2026/TEAM_CHAT_LATENCY_AND_TOOLS.md`](./latency/eduai-summer-2026/TEAM_CHAT_LATENCY_AND_TOOLS.md) | **Discussion doc** — Problem statement, `supportsTools` vs hybrid path, option table (A–G), open decisions L1–L5, regression rules. |
| [`latency/MODEL_LATENCY_TRACKER.md`](./latency/MODEL_LATENCY_TRACKER.md) | **Measurement ledger** — TTFT/Total/tool-call rows per session; live probe table, Gemini quota FAQ, how to record a fresh row. |
| [`latency/eduai-summer-2026/FLEET_ROUTER_STRESS_2026-08-18.md`](./latency/eduai-summer-2026/FLEET_ROUTER_STRESS_2026-08-18.md) · [`FLEET_ROUTER_DATA_REPORT_2026-08-19.md`](./latency/eduai-summer-2026/FLEET_ROUTER_DATA_REPORT_2026-08-19.md) · [`FLEET_ROUTER_EXECUTIVE_REPORT_2026-08-19.md`](./latency/eduai-summer-2026/FLEET_ROUTER_EXECUTIVE_REPORT_2026-08-19.md) | **Fleet-router stress runs** — dated load-ladder results and their write-ups. |
| [`latency/eduai-summer-2026/CMPS03_OUTLIER_INVESTIGATION_2026-08-26.md`](./latency/eduai-summer-2026/CMPS03_OUTLIER_INVESTIGATION_2026-08-26.md) | **cmps03 outlier investigation (#1589)** — Repeats PR #1582's fleet-stress load ladder directly against cmps01/cmps03; the reported 7–9x outlier did not reproduce under single-model or combined dual-GPU load. Documents an unrelated vLLM version drift found and fixed along the way. |

> Everything under `latency/` and `routing/` other than `MODEL_LATENCY_TRACKER.md` is a
> **dated, point-in-time record** (sprint plans, investigation findings, stress-run reports).
> They are kept as written; do not "refresh" them against current code — add a new dated document instead.

---

## `routing/` — sustainability-aware model routing ([#197](https://github.com/EduAI-Lab/EduAICore/issues/197))

| File | Brief description |
| ---- | ----------------- |
| [`routing/eduai-summer-2026/TEAM_ROUTING_LAYER_PLAN.md`](./routing/eduai-summer-2026/TEAM_ROUTING_LAYER_PLAN.md) | **Epic overview** — Why Auto routing exists, phases 0–4, telemetry/energy goals, and links to GitHub project tracking. |
| [`routing/eduai-summer-2026/TEAM_PHASE_0_AND_1_GUIDE.md`](./routing/eduai-summer-2026/TEAM_PHASE_0_AND_1_GUIDE.md) | **Implementation guide** — Concrete tasks for Phase 0 (telemetry) and Phase 1 (rule-based Auto tier); sub-issues #182–#192, target branch `feat/routing-mvp`. |

---

## Related work elsewhere

| Topic | Location |
| ----- | -------- |
| Unified DB schema | [`../implementations/schema-design.md`](../implementations/schema-design.md) |
| **Agent readiness** (#167, #672) | [`../AGENT_READINESS.md`](../AGENT_READINESS.md) |
| Environment variables | [`../ENVIRONMENT.md`](../ENVIRONMENT.md) |
| EduAI architecture guide | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Core app code | [`apps/core/app/routes/api/chat.ts`](../../apps/core/app/routes/api/chat.ts), [`apps/core/app/lib/ai/embedding.ts`](../../apps/core/app/lib/ai/embedding.ts) |

---

## Folder layout

```text
docs/rag-ai/
├── README.md                          ← this index
├── ADR-prior-question-cache.md
├── CHAT_RAG_PIPELINE.md
├── EMBEDDINGS.md
├── HOW_TO_USE_DEV_SERVER.md
├── IVFFLAT_EXPLAIN_EVIDENCE.md
├── LOCAL-EMBEDDINGS.md
├── RAG_INGESTION_TEST.md
├── VLLM.md
├── fixtures/
│   ├── rag-ingestion-clinical.md
│   ├── rag-ingestion-equations.md
│   └── rag-ingestion-tables.md
├── eduai-summer-2026/
│   └── EDUAI_HELPME_ANALYSIS.md
├── latency/
│   ├── MODEL_LATENCY_TRACKER.md
│   └── eduai-summer-2026/
│       ├── CMPS03_OUTLIER_INVESTIGATION_2026-08-26.md
│       ├── FINDINGS.md
│       ├── FINDINGS_APPENDIX.md
│       ├── FLEET_ROUTER_DATA_REPORT_2026-08-19.md
│       ├── FLEET_ROUTER_EXECUTIVE_REPORT_2026-08-19.md
│       ├── FLEET_ROUTER_STRESS_2026-08-18.md
│       ├── SOLUTIONS_PLAN.md
│       ├── TEAM_CHAT_LATENCY_AND_TOOLS.md
│       └── TEAM_CHAT_LATENCY_SPRINT_GUIDE.md
└── routing/
    └── eduai-summer-2026/
        ├── MULTI_SERVER_ROUTING_PLAN.md
        ├── TEAM_PHASE_0_AND_1_GUIDE.md
        └── TEAM_ROUTING_LAYER_PLAN.md
```
