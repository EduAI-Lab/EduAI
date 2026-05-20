# EduAI chat — latency & tool-use (team discussion doc)

**Audience:** Full EduAI dev team + research lead  
**Status:** Open problems — **not** solved; needs design before shipping toggles that disable course/web grounding  
**Teammates — start here for tasks:** [`TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./TEAM_CHAT_LATENCY_SPRINT_GUIDE.md) (this week’s delegatable steps)  
**Lead context:** Documented from local dev on **AI enhancement branch** (Gemma ~31B, DeepSeek via Ollama); targets and cloud numbers in [`../model-latency-tracker.md`](../model-latency-tracker.md)

---

## The problem in one paragraph

EduAI must stay **course-aware** (RAG / `getInformation`) and able to use the **web** when appropriate — that is the product promise. Today, when tool calling is fully enabled (`supportsTools: true` on the model), turns are **slow** (lead observed **40–50 s** end-to-end on local Ollama). When tools are effectively off (`supportsTools: false` → `hybrid_rag` or no-tool path in [`apps/core/app/routes/api/chat.ts`](../../apps/core/app/routes/api/chat.ts)), replies are **fast** but students must phrase requests like *“search the web for…”* or *“check the course materials for…”* or the model answers from weights only. A **“web search always on”** UI toggle was considered but rejected as a bad default (users leave it on). **Disabling tools globally is not an acceptable product fix.**

**Target (product):** ~**3–4 s** perceived for typical tutoring turns where possible; streaming should show the **first token early**, not after the full server pipeline finishes.

---

## What the lead observed (remember for all future work)

| Observation | Detail |
| ----------- | ------ |
| **Branch** | Work on **AI enhancement** branch; changes did not bring local model latency down to target |
| **Models** | Local Ollama: e.g. Gemma ~31B, DeepSeek — very slow vs goal |
| **40–50 s total** | Unacceptable for students; most time felt like **waiting for server** before anything appears |
| **Pre-display wait** | Felt like the app waited to **download / finish server work** before showing streamed text (poor TTFT / buffering) |
| **Fast path** | When the chat API takes the **no tool-calling** branch (`!supportsTools`), responses are much faster |
| **Slow path** | Full **tool_calling** path: `getInformation`, `webSearch`, `fetchPage`, `maxSteps`, RAG merge — required for real EduAI behaviour |
| **Prompt workaround** | System prompt tightened to call tools **only when user explicitly asks** → faster, but **breaks** “just ask about my course” UX (~90% of student needs) |
| **Toggle idea** | Permanent “web search on” toggle → users never turn it off → not a real solution |

---

## How the code branches today (read before debating fixes)

In `apps/core/app/routes/api/chat.ts` (~line 725+):

```text
supportsTools = await modelSupportsTools(model)   // from DB AIModel.supportsTools

if (!supportsTools) {
  → "hybrid_rag" path: keyword/heuristic isRAGQuery → findRelevantContent inline
  → NO webSearch / fetchPage / getInformation tools
} else {
  → "tool_calling" path: streamText + tools + maxSteps (default 3)
  → System prompt says: prefer ZERO tool calls; only when explicitly needed
}
```

**Important:** This is **not** the same as the future **ADHD Assist** toggle (`adhdAssist`). ADHD Assist must **not** change model, RAG, or tools between Baseline and Assist (Form A IV). Latency/tool routing is a **platform** problem, separate epic.

---

## Separate the two toggles (team agreement needed)

| Toggle | Purpose | Must NOT |
| ------ | ------- | -------- |
| **`adhdAssist`** (research IV) | Prepend ADHD policy block; optional Phase 3 oversight | Change whether tools/RAG run |
| **Tool / grounding strategy** (product — TBD) | When to call `getInformation` / `webSearch` without magic phrases | Be confused with ADHD Assist; be “always on” with no guardrails |

---

## Options to discuss (no decision yet)

Use this table in kickoff; pick 1–2 spikes for the next sprint.

| Option | Idea | Pros | Cons |
| ------ | ---- | ---- | ---- |
| **A. Course-selected → auto RAG** | If `courseCode` set, always run `findRelevantContent` **before** LLM (like hybrid path) even on tool-capable models; tools only for web | Matches “course-aware” without “check course materials” phrasing | Extra embedding latency every turn; need cap (Phase 2.5) |
| **B. Intent router (lightweight)** | Small rules or classifier: `needs_web` / `needs_course` / `chat_only` → register subset of tools | Fewer tool round-trips; predictable | Wrong routing = wrong answer; needs tests |
| **C. Model routing (sibling project)** | Friend’s **Auto** tier: cheap model for chat-only, tier 2+ when tools/images needed | Sustainability + speed for simple Qs | Separate track; must not break course default |
| **D. Keep tools, shrink work** | Lower `CHAT_TOOL_MAX_STEPS`, cap RAG chunks/chars (partially done), summarize tool JSON before model | Already helped cloud (~11 s → ~3 s on Gemini per latency doc) | Local 31B still dominated by inference + load |
| **E. Local dev defaults** | Default dev to smaller warm model; document `ollama run` keep-alive; measure TTFT separately from Total | Honest 3–4 s target for **local** | Production may still use cloud |
| **F. Streaming UX** | Ensure first chunk reaches UI immediately; show phase labels (“Searching course…”) | Fixes “nothing happening for 40 s” perception | Does not remove backend seconds |
| **G. User “Research mode”** | Explicit mode that enables web+tools; default course mode auto-RAG only | Clear consent | Still risks “always on” if default wrong |

**Lead recommendation for discussion:** Combine **A + D + F** for a near-term spike (auto-RAG when course selected + keep existing tool caps + streaming/typing indicator). Park **B/C** for a follow-up epic. Do **not** ship ADHD Assist Phase 3 oversight until baseline TTFT/Total on the eval model are logged (oversight adds ~1–3 s per architecture doc).

---

## Metrics (use the same ledger as research)

Every spike PR should add rows to [`../model-latency-tracker.md`](../model-latency-tracker.md):

| Probe | Model | Course | Tools path | TTFT | Total | Notes |
| ----- | ----- | ------ | ---------- | ---- | ----- | ----- |
| S1 “What is gradient descent?” | | none | | | | No tools expected |
| “What did chapter 3 say?” | | selected | | | | Course grounding |
| “Find recent papers on this” | | none | | | | Web tool expected |

**Regression rule:** ADHD Assist PRs must not worsen **warm** Total on the S1 probe by more than **15%** vs `main` at the same model (unless PR is explicitly labeled “latency trade-off accepted”).

---

## Open decisions (fill in after team meeting)

| ID | Question | Owner | Decision |
| -- | -------- | ----- | -------- |
| L1 | Is 3–4 s a hard SLA for **local Ollama** or only cloud/demo? | Lead + PI | |
| L2 | Default when course selected: auto-RAG, tool `getInformation`, or both? | Team | |
| L3 | Separate “web search” product toggle — yes/no/default? | Team | |
| L4 | AI enhancement branch: merge, rebase, or cherry-pick? | Lead | |
| L5 | Does Phase 2.5 block ADHD Assist eval, or document SHA without §3b? | Lead + PI | |

---

## Related docs

| Doc | Role |
| --- | ---- |
| [`../model-latency-tracker.md`](../model-latency-tracker.md) | Measured TTFT/Total, tool fixes, Gemini quota notes |
| [`TEAM_ADHD_ASSIST_PLAN.md`](./TEAM_ADHD_ASSIST_PLAN.md) | ADHD Assist feature (orthogonal IV) |
| [`TEAM_PHASE_1_2_3_GUIDE.md`](./TEAM_PHASE_1_2_3_GUIDE.md) | Junior implementation steps |
| [`../literature/adhd-assist-architecture-phases.md`](../literature/adhd-assist-architecture-phases.md) | Phase 2.5 efficiency, Phase 3 latency trade-off |

---

*Last updated: 2026-05-19 — incorporates lead dev findings (40–50 s local, tools vs speed trade-off).*
