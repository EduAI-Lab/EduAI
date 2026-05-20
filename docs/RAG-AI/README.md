# EduAI RAG & chat — implementation docs

Team documentation for **course-aware retrieval**, the **`POST /api/chat`** pipeline, **chat latency**, **model routing**, and the shared **dev server**. Living references — update the relevant file when behavior or sprint scope changes.

**Current team focus:** [GitHub #203 — Chat latency & smart grounding sprint](https://github.com/EduAI-Lab/EduAI/issues/203) → start in [`latency/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./latency/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md).


AI models are hosted on cmps01.ok.ubc.ca. EduAI (hosted on my.eduai.ok.ubc.ca) and its respective dev app (dev.eduai.ok.ubc.ca) both connect to cmps01 ollama port to send and recieve AI prompts and responses respectively. 
---

## Where to start

| If you are… | Read first |
| ----------- | ---------- |
| New to EduAI chat/RAG | [`chat-rag-pipeline.md`](./chat-rag-pipeline.md) |
| Picking up latency work (#203) | [`latency/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./latency/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md) |
| Discussing tools vs speed trade-offs | [`latency/TEAM_CHAT_LATENCY_AND_TOOLS.md`](./latency/TEAM_CHAT_LATENCY_AND_TOOLS.md) |
| Logging probe timings | [`latency/model-latency-tracker.md`](./latency/model-latency-tracker.md) |
| Implementing Auto routing (#197) | [`routing/TEAM_PHASE_0_AND_1_GUIDE.md`](./routing/TEAM_PHASE_0_AND_1_GUIDE.md) |
| Testing on `dev.eduai.ok.ubc.ca` | [`how-to-use-dev-server.md`](./how-to-use-dev-server.md) |

---

## Root (`docs/implementations/RAG-AI/`)

| File | Brief description |
| ---- | ----------------- |
| [`chat-rag-pipeline.md`](./chat-rag-pipeline.md) | **Architecture reference** — Mermaid flow of `/api/chat`, hybrid vs tool-calling RAG, `findRelevantContent`, and response paths. Match to `apps/core` on merge. |
| [`how-to-use-dev-server.md`](./how-to-use-dev-server.md) | **Ops runbook** — VPN, SSH, branch checkout, `tmux`, Docker DB, and Turbo dev on the shared UBCO host (`dev.eduai.ok.ubc.ca`). |
| [`helpme-chatbot-vs-eduai-rag-gap-analysis.md`](./helpme-chatbot-vs-eduai-rag-gap-analysis.md) | **Research / borrow list** — What to port from the legacy HelpMe chatbot (caching, chunking, local embeds) vs what stays in EduAI’s stack. Related to #195–#196. |

---

## `latency/` — chat speed & tool grounding ([#203](https://github.com/EduAI-Lab/EduAI/issues/203))

| File | Brief description |
| ---- | ----------------- |
| [`latency/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./latency/TEAM_CHAT_LATENCY_SPRINT_GUIDE.md) | **Sprint playbook** — Delegatable steps L00–L09 (bench script, baselines, auto-RAG, intent routing, Ollama warm-up, TTFT audit). Teammate entry point. |
| [`latency/TEAM_CHAT_LATENCY_AND_TOOLS.md`](./latency/TEAM_CHAT_LATENCY_AND_TOOLS.md) | **Discussion doc** — Problem statement, `supportsTools` vs hybrid path, option table (A–G), open decisions L1–L5, regression rules. |
| [`latency/model-latency-tracker.md`](./latency/model-latency-tracker.md) | **Measurement ledger** — TTFT/Total/tool-call rows per session; live probe table, Gemini quota FAQ, how to record a fresh row. |

---

## `routing/` — sustainability-aware model routing ([#197](https://github.com/EduAI-Lab/EduAICore/issues/197))

| File | Brief description |
| ---- | ----------------- |
| [`routing/TEAM_ROUTING_LAYER_PLAN.md`](./routing/TEAM_ROUTING_LAYER_PLAN.md) | **Epic overview** — Why Auto routing exists, phases 0–4, telemetry/energy goals, and links to GitHub project tracking. |
| [`routing/TEAM_PHASE_0_AND_1_GUIDE.md`](./routing/TEAM_PHASE_0_AND_1_GUIDE.md) | **Implementation guide** — Concrete tasks for Phase 0 (telemetry) and Phase 1 (rule-based Auto tier); sub-issues #182–#192, target branch `feat/routing-mvp`. |

---

## Related work elsewhere

| Topic | Location |
| ----- | -------- |
| Unified DB schema | [`../schema-design.md`](../schema-design.md) |
| Platform architecture | [`../../platform-centralization-architecture-plan.md`](../../platform-centralization-architecture-plan.md) |
| Core app code | [`apps/core/app/routes/api/chat.ts`](../../../apps/core/app/routes/api/chat.ts), [`apps/core/app/lib/ai/embedding.ts`](../../../apps/core/app/lib/ai/embedding.ts) |

---

## Folder layout

```text
docs/implementations/RAG-AI/
├── README.md                          ← this index
├── chat-rag-pipeline.md
├── how-to-use-dev-server.md
├── helpme-chatbot-vs-eduai-rag-gap-analysis.md
├── latency/
│   ├── TEAM_CHAT_LATENCY_SPRINT_GUIDE.md
│   ├── TEAM_CHAT_LATENCY_AND_TOOLS.md
│   └── model-latency-tracker.md
└── routing/
    ├── TEAM_ROUTING_LAYER_PLAN.md
    └── TEAM_PHASE_0_AND_1_GUIDE.md
```
