# EduAI chat — latency & tool-use (team discussion doc)

**Audience:** Full EduAI dev team + research lead  
**Status:** Open problems — **not** solved; needs design before shipping toggles that disable course/web grounding  
**Teammates — start here for tasks:** [`TEAM_CHAT_LATENCY_SPRINT_GUIDE.md`](./TEAM_CHAT_LATENCY_SPRINT_GUIDE.md) (this week’s delegatable steps)  
**Lead context:** Documented from local dev on **AI enhancement branch** (Gemma ~31B, DeepSeek via Ollama); targets and cloud numbers in [`../MODEL_LATENCY_TRACKER.md`](../MODEL_LATENCY_TRACKER.md)

---

## The problem in one paragraph

EduAI must stay **course-aware** (RAG / `getInformation`) — that is the product promise. **Web search and page fetching are being gated behind an admin-side Feature Toggle (default OFF) — not deleted** (sprint step **L13**, scope updated 2026-05-26 by PI direction). The grounding tool we actively rely on for the ADHD latency research is course-material RAG; web tools stay in the codebase as a switch we may flip on later if RAG alone proves insufficient. After L13, `supportsTools: true` means `getInformation` is always registered, plus `webSearch` / `fetchPage` if the admin `webToolsEnabled` toggle is ON. Small models stay `supportsTools: false` (no tools at all) so simple questions are answered straight from weights on the fast path; bigger models flip to `supportsTools: true` and are escalated to only when the L04 intent classifier flags a turn as needing course grounding. Today, when tool calling is fully enabled (`supportsTools: true` on the model), turns are **slow** (lead observed **40–50 s** end-to-end on local Ollama). When tools are effectively off (`supportsTools: false` → `hybrid_rag` path in [`apps/core/app/routes/api/chat.ts`](../../apps/core/app/routes/api/chat.ts)), replies are **fast** but students must phrase requests like *“check the course materials for…”* or the model answers from weights only. **Disabling tools globally is not an acceptable product fix.**

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
| **Slow path** | Full **tool_calling** path: `getInformation`, `maxSteps`, RAG merge — required for real EduAI behaviour. Web tools (`webSearch`, `fetchPage`) are gated behind the admin `webToolsEnabled` Feature Toggle (L13, default OFF for the research phase) — when OFF, the only tool on this branch is `getInformation`; when ON, web tools come back. |
| **Prompt workaround** | System prompt tightened to call tools **only when user explicitly asks** → faster, but **breaks** “just ask about my course” UX (~90% of student needs) |

---

## How the code branches today (read before debating fixes)

In `apps/core/app/routes/api/chat.ts` (~line 725+):

```text
supportsTools = await modelSupportsTools(model)   // from DB AIModel.supportsTools

if (!supportsTools) {
  → "hybrid_rag" path: keyword/heuristic isRAGQuery → findRelevantContent inline
  → No tools registered
} else {
  → "tool_calling" path: streamText + tools + maxSteps (default 3)
  → `getInformation` (course RAG) is ALWAYS registered
  → `webSearch` / `fetchPage` are registered ONLY when admin `webToolsEnabled` toggle is ON (L13, default OFF for research)
  → System prompt says: prefer ZERO tool calls; only when explicitly needed
}
```

**Important:** This is **not** the same as the future **ADHD Assist** toggle (`adhdAssist`). ADHD Assist must **not** change model, RAG, or tools between Baseline and Assist (Form A IV). Latency/tool routing is a **platform** problem, separate epic.

---

## Separate the two toggles (team agreement needed)

| Toggle | Purpose | Must NOT |
| ------ | ------- | -------- |
| **`adhdAssist`** (research IV) | Prepend ADHD policy block; optional Phase 3 oversight | Change whether tools/RAG run |
| **Course-RAG grounding strategy** (product — TBD) | When to call `getInformation` without magic phrases | Be confused with ADHD Assist. Note: web tools are no longer "out of scope" — they are gated behind an admin Feature Toggle (default OFF) per L13. Research turns this sprint should run with the toggle OFF so we measure RAG-only behaviour. |

---

## Options to discuss (no decision yet)

Use this table in kickoff; pick 1–2 spikes for the next sprint.

| Option | Idea | Pros | Cons |
| ------ | ---- | ---- | ---- |
| **A. Course-selected → auto RAG** | If `courseCode` set, always run `findRelevantContent` **before** LLM (like hybrid path) even on tool-capable models | Matches “course-aware” without “check course materials” phrasing | Extra embedding latency every turn; need cap (Phase 2.5) |
| **B. Intent router (lightweight)** | Small rules or classifier: `needs_course` / `chat_only` → decide whether to inject course context | Fewer wasted RAG calls; predictable | Wrong routing = wrong answer; needs tests |
| **C. Per-turn model-tier routing** (**now in scope — L10**) | Default to a **small model with `supportsTools: false`** that answers chat-only questions from weights; **escalate per turn** to a bigger `supportsTools: true` model when `needsCourseRag` fires. Web tools stay out of scope. Pairs with admin-UI fix [#264](https://github.com/EduAI-Lab/EduAI/issues/264) — now its own step **L11** in the sprint guide — which hides (and server-rejects) `supportsTools: true` on small models so the router can't be silently broken by a misconfigured row. | Best of both: fast for ~chat-only, correct for course-RAG; no “always-on tools” foot-gun | Misrouting on borderline prompts; need a clear escalation default (correctness > speed) |
| **D. Keep tools, shrink work** | Lower `CHAT_TOOL_MAX_STEPS`, cap RAG chunks/chars (partially done), summarize tool JSON before model | Already helped cloud (~11 s → ~3 s on Gemini per latency doc) | Local 31B still dominated by inference + load |
| **E. Dev-server defaults** | Default dev server to smaller warm model; document keep-alive; measure TTFT separately from Total | Honest 3–4 s target for **dev** | Production may still use cloud |
| **F. Streaming UX** | Ensure first chunk reaches UI immediately; show phase labels (“Searching course…”) | Fixes “nothing happening for 40 s” perception | Does not remove backend seconds |

**Lead recommendation for discussion:** Combine **A + C + D + F** for the sprint — auto-RAG when course selected, per-turn tier routing (small `supportsTools: false` default → escalate to tool-capable on course-RAG turns), existing tool caps, and streaming/typing indicator. **B** (intent router) is the input to **C**; both land together via L04 + L10. Do **not** ship ADHD Assist Phase 3 oversight until baseline TTFT/Total on the eval model are logged (oversight adds ~1–3 s per architecture doc).

---

## Metrics (use the same ledger as research)

Every spike PR should add rows to [`../MODEL_LATENCY_TRACKER.md`](../MODEL_LATENCY_TRACKER.md):

| Probe | Model | Course | Tools path | TTFT | Total | Notes |
| ----- | ----- | ------ | ---------- | ---- | ----- | ----- |
| S1 “What is gradient descent?” | | none | | | | No tools expected |
| C1 “What did chapter 3 say?” | | selected | | | | Course-RAG grounding |
| C2 “Summarise the lecture notes for week 4” | | selected | | | | Course-RAG, longer context |

**Regression rule:** ADHD Assist PRs must not worsen **warm** Total on the S1 probe by more than **15%** vs `main` at the same model (unless PR is explicitly labeled “latency trade-off accepted”).

---

## Open decisions (fill in after team meeting)

| ID | Question | Owner | Decision |
| -- | -------- | ----- | -------- |
| L1 | Is 3–4 s a hard SLA for the **dev server local-model** path or only cloud/demo? | Lead + PI | |
| L2 | Default when course selected: auto-RAG, tool `getInformation`, or both? | Team | |
| L3 | AI enhancement branch: merge, rebase, or cherry-pick? | Lead | |
| L4 | Does Phase 2.5 block ADHD Assist eval, or document SHA without §3b? | Lead + PI | |

---

## Related docs

| Doc | Role |
| --- | ---- |
| [`../MODEL_LATENCY_TRACKER.md`](../MODEL_LATENCY_TRACKER.md) | Measured TTFT/Total, tool fixes, Gemini quota notes |
| [`../COLD_START_AND_OLLAMA_WARMUP.md`](../COLD_START_AND_OLLAMA_WARMUP.md) | Why local turns spend 10–60 s on first load; cold vs warm vs model-switch (L12 / [#209](https://github.com/EduAI-Lab/EduAI/issues/209)) |
| [`TEAM_ADHD_ASSIST_PLAN.md`](./TEAM_ADHD_ASSIST_PLAN.md) | ADHD Assist feature (orthogonal IV) |
| [`TEAM_PHASE_1_2_3_GUIDE.md`](./TEAM_PHASE_1_2_3_GUIDE.md) | Junior implementation steps |
| [`../literature/adhd-assist-architecture-phases.md`](../literature/adhd-assist-architecture-phases.md) | Phase 2.5 efficiency, Phase 3 latency trade-off |

---

*Last updated: 2026-05-19 — incorporates lead dev findings (40–50 s local, tools vs speed trade-off).*
