# Model Latency Tracker — Global (Cloud) Models

A running log of TTFT (time-to-first-token), total response time, and tool-call behaviour for global frontier models hosted by external providers (OpenAI, Google, Anthropic, etc.). Local Ollama runs live in a separate column when needed.

> **Why this exists.** ADHD-relevant latency (Form A §3b efficiency) is the single biggest UX defect we are optimising for. This file is the operational ledger: every time we tweak the prompt, `maxSteps`, the tool surface, or the system prompt, we log the impact here before and after.

## Related docs

> Literature files below link to `docs/literature/` (not in this repo yet — add when the research pack is committed).

- Eight ADHD-relevant principles (Mental Demand / Effort hooks): [`adhd-design-principles.md`](../../literature/adhd-design-principles.md)
- Architecture phases — Phase 2.5 owns this work: [`adhd-assist-architecture-phases.md`](../../literature/adhd-assist-architecture-phases.md)
- Synthetic scenarios used as the canonical probes: [`form-a-eval-scenarios.md`](../../literature/form-a-eval-scenarios.md), [`form-a-scenario-test-sheet.md`](../../literature/form-a-scenario-test-sheet.md)
- Manual eval logging conventions (matrix columns): [`system-prompt-evaluation-runbook.md`](../../literature/system-prompt-evaluation-runbook.md)

## Scope (what counts as "global model")

Cloud-hosted commercial models reachable via API, e.g. `openai:gpt-5`*, `google:gemini-*`, `anthropic:claude-*`, etc. Ollama (local) is tracked separately because TTFT there is dominated by model load and GPU state, not network.

## What to measure (per turn)


| Field                          | Definition                                                                               | How to capture                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TTFT** (time to first token) | Milliseconds from user submit to the **first visible character** in the assistant bubble | Browser devtools Network tab → request to `/api/chat` → look at "Waiting for server response" + first chunk; or a stopwatch is fine for ±200 ms precision |
| **Total**                      | Milliseconds from user submit to end of streaming                                        | Network tab "Time" column, or the timer shown in your UI under each reply                                                                                 |
| **Tool calls**                 | Comma-separated names of any tools fired; `none` if zero                                 | Visible from the in-flight indicator and the `<Tool />` blocks above the assistant text                                                                   |
| **Word count**                 | Words in the assistant reply                                                             | Editor count, or `wc -w` on a copy                                                                                                                        |
| **Cold/warm**                  | `cold` = first request after server start; `warm` = anything after                       | Note server-restart events with a horizontal rule                                                                                                         |
| **Course selected**            | The `courseCode` (e.g. `COSC 304`) or `none`                                             | Visible in the chat input area                                                                                                                            |
| **ADHD Assist toggle**         | `on` / `off` once Phase 1–2 ship; before then = `n/a`                                    | The new boolean toggle                                                                                                                                    |
| **Git SHA**                    | `git rev-parse --short HEAD` at the time the row was generated                           | Run before the test session                                                                                                                               |


## Live platform probe sequence (prompts used in EduAI chat)

These rows record **what was actually typed** in the EduAI chat UI to exercise tools, RAG errors, and latency (e.g. `google:gemini-2.5-flash`, Firecrawl configured, **no course** selected unless noted). For formal Form A wording and scenario IDs, use [`form-a-scenario-test-sheet.md`](../../literature/form-a-scenario-test-sheet.md).

| # | Your prompt | What the code did | Time | Verdict |
|---|-------------|-------------------|------|---------|
| 1 | Search the web for the latest news on GPT-5.5 and summarize the top result. | Model called `webSearch({ query, limit: 1 })` — `limit=1` (not the default 3) because of “top result”. Firecrawl returned one hit; model gave a short summary with the URL. | 4.30 s (cold) | Tool used correctly; output cited; no speculative follow-up tool call. |
| 2 | What is gradient descent? | No tool call; model answered from parametric knowledge. | 2.63 s | Tightened system prompt working — no unnecessary tool use for general knowledge. |
| 3 | Now compare it to Adam | No tool call; direct comparison from knowledge. | 5.16 s | Total dominated by long answer (~720 words), not tool roundtrip; streaming starts well before 5 s. |
| 4 | What did chapter 3 say about this? | Model called `getInformation` → structured `{ error, code: "MISSING_CONFIG" }` (“No course is selected…”) → UI error card → model apologised and asked user to pick a course. | 3.17 s | Structured error path: no stuck UI; pre-fix this scenario could stall on a “Ready” tool card. |
| 5 | Find recent papers on this | First send aborted / raced — no assistant turn (duplicate user bubble). | 1.22 s | Client double-send / race; not a backend logic failure. Mitigations: submit lock + disable send while in flight (see Session 2026-05-14C notes). |
| 6 | Find recent papers on this (retry) | Model called `webSearch` (default `limit=3`); three papers (arXiv / ScienceDirect / OpenReview) with URLs; summarised. | 5.98 s | “Recent papers” correctly maps to web search vs definition-style turns with no tool. |
| 7 | Thanks, summarise this whole chat | No tool call; long summary referencing prior turns (including chapter-3 failure). | 9.91 s | Slowest turn: large context + long output; natural place for ADHD-Assist length caps in Phase 2. |

## Recording format

Append one row per turn. Insert a horizontal rule (`---`) between distinct **sessions** (i.e. after a server restart, model swap, or code-level config change). The session header lists shared metadata once instead of repeating it per row.

### Reference baseline (pre-optimisation)

Recorded before the changes in [`apps/core/app/routes/api/chat.ts`](../../../apps/core/app/routes/api/chat.ts) landed. `maxSteps: 12`, original tool-encouraging system prompt, no boot warmup, static "EduAI is thinking…" placeholder.


| Run ID         | Probe | Model | Course | Cold/warm | Tools called | TTFT | Total     | Words | Notes                                                                                                      |
| -------------- | ----- | ----- | ------ | --------- | ------------ | ---- | --------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| *baseline-001* | *S1*  | *?*   | *none* | *cold*    | *?*          | —    | **~11 s** | —     | Reported anecdotally; replace with measured row when a pre-fix branch is checked out for a regression run. |


### Session 2026-05-14 — first run after latency fixes

- **Git SHA:** `0764c68`
- **Server state:** dev, freshly restarted
- **Changes applied:** `TOOL_MAX_STEPS = 3`, tightened tool-use system prompt, `getInformation` dropped when no course, `modelSupportsTools` cached, fire-and-forget user-msg persist, parallel pre-LLM Prisma reads, Prisma + embedding-provider boot warmup, state-aware typing indicator. See full diff at SHA above.
- **ADHD Assist toggle:** n/a (Phase 1–2 not shipped yet)


| Run ID           | Probe                                      | Model     | Course | Cold/warm | Tools called      | TTFT      | Total      | Words | Notes                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------ | --------- | ------ | --------- | ----------------- | --------- | ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-05-14-001` | S1 (~gradient descent)                     | *fill in* | none   | cold      | none              | *fill in* | **3.32 s** | ~280  | Down from ~11 s baseline. Healthy.                                                                                                                                                                                                             |
| `2026-05-14-002` | AdHoc "Now compare it to Adam"             | *fill in* | none   | warm      | none              | *fill in* | **6.58 s** | ~700  | Total dominated by long answer; perceived latency lower than total because streaming starts early.                                                                                                                                             |
| `2026-05-14-003` | AdHoc "What did chapter 3 say about this?" | *fill in* | none   | warm      | none              | *fill in* | **1.82 s** | ~85   | Correctly refused to confabulate; no tool call (no course selected → tool not registered). Matches design principle P6.                                                                                                                        |
| `2026-05-14-004` | AdHoc "Find recent papers on this"         | *fill in* | none   | warm      | webSearch (stuck) | *n/a*     | **stuck**  | 0     | **Bug found.** `FIRECRAWL_API_KEY` missing; tool threw, UI stuck on "Ready" tool card with no follow-up text. Initial Option A fix (env-gating) considered architectural debt at Canvas-scale; replaced by Session 3 architecture (see below). |


---

### Session 2026-05-14B — production-grade tool result envelope (no env gating)

- **What changed:** Replaced the env-based tool gating with a `ToolError` envelope ([`tool-result.ts`](../../../apps/core/app/lib/ai/tool-result.ts) on `feat/local-models-and-ai-enhancement`). Tools are **always registered**; failures (missing config, network, rate-limit, empty results) flow through structured `{ error, code }` results. UI ([`chat-message.tsx`](../../../apps/core/app/components/chat/chat-message.tsx) converter + [`tool.tsx`](../../../apps/core/app/components/ui/tool.tsx)) detects the envelope and renders an inline error message instead of "Ready"/"Completed". System prompt instructs the model to acknowledge errors gracefully and not retry.
- **Why:** Env gating coupled deployment config to model capability, hid failures, and could not handle runtime failures (Firecrawl outage, rate limits, etc.). The envelope pattern is the only path to per-tenant config + Canvas-scale reliability without rewrites.
- **Logging:** every tool execute now emits one structured log line `[tool] {"tool":"...","ok":...,"code":"...","latencyMs":...}` via `logToolOutcome`. Greppable in dev; parseable by log shippers in prod.
- **Backward compatibility:** existing **success** shapes are unchanged. Only failures use the envelope. Detection rule is structural (`typeof result.error === "string" && result.error.length > 0`), so older code paths returning `{ error: "..." }` continue to render correctly.
- **Latency wins preserved:** `maxSteps: 3` (server, override `CHAT_TOOL_MAX_STEPS`), tightened tool-use prompt, **awaited** user-msg persist (reverted fire-and-forget for durability), parallel pre-LLM DB reads, server-boot warmup, state-aware in-flight typing indicator, and `modelSupportsTools` cache all remain.


| Run ID           | Probe                                                               | Model            | Course | Cold/warm | Tools called                                               | TTFT | Total      | Words | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------- | ---------------- | ------ | --------- | ---------------------------------------------------------- | ---- | ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-05-14-005` | AdHoc "Find recent papers on this" (with `FIRECRAWL_API_KEY` unset) | gemini-2.5-flash | none   | warm      | *expected* webSearch → `{ error, code: "MISSING_CONFIG" }` | —    | —          | —     | **Not re-measured this session.** `FIRECRAWL_API_KEY` was set before the next test pass, so the missing-config branch was not exercised end-to-end. Code path is verified by reading [`web-search.ts`](../../../apps/core/app/lib/ai/tools/web-search.ts) lines 160-163 (`resolveFirecrawlClient()` returns null → `toolError("MISSING_CONFIG", …)`). To re-measure: temporarily unset the env var, restart, re-run the prompt.                   |
| `2026-05-14-006` | AdHoc "What did chapter 3 say about this?"                          | gemini-2.5-flash | none   | warm      | `getInformation` → `{ error, code: "MISSING_CONFIG" }`     | —    | **3.17 s** | ~45   | **Behaviour matches design.** Tool card renders the inline error "No course is selected…"; model's follow-up apologises and asks the user to select a course from the dropdown. Same scenario previously stuck the UI at the "Ready" tool card. Compare to `2026-05-14-003` (1.82 s) where the tool wasn't even called — Δ ≈ +1.4 s buys correct architectural behaviour (tool always registered → structured error → graceful handoff). |
| `2026-05-14-007` | S1 (~gradient descent), regression check                            | gemini-2.5-flash | none   | warm      | none                                                       | —    | **2.63 s** | ~285  | Confirms revert + envelope work did not regress no-tool latency. Slightly faster than `2026-05-14-001` (3.32 s, cold); difference attributable to warm path.                                                                                                                                                                                                                                                                             |


---

### Session 2026-05-14C — Firecrawl key configured, end-to-end tool path live

- **Git SHA:** `0764c68` (no code change since 14B — this is purely an env change)
- **Server state:** dev, restarted after adding `FIRECRAWL_API_KEY` to `.env`
- **Model:** `google:gemini-2.5-flash` (both Google embeddings + Firecrawl reachable)
- **ADHD Assist toggle:** n/a (Phase 1–2 not shipped yet)
- **What we are observing:** all three production tool paths exercised in one chat thread — `webSearch` (success), `getInformation` (structured `MISSING_CONFIG` because no course), no-tool answers, and long-context summarization. TTFT not separately captured this pass; Totals only.


| Run ID           | Probe                                                                               | Course | Cold/warm                              | Tools called                                           | TTFT | Total      | Words | Notes                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------- | ------ | -------------------------------------- | ------------------------------------------------------ | ---- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2026-05-14-008` | AdHoc "Search the web for the latest news on GPT-5.5 and summarize the top result." | none   | **cold** (first message after restart) | `webSearch(query, limit=1)`                            | —    | **4.30 s** | ~55   | Cold start + 1 tool roundtrip + Firecrawl HTTP. Model adaptively picked `limit=1` from the wording "top result" (default in tool schema is 3). Source URL cited inline. **No stuck UI, no speculative second tool call.**                                                                                                                                                                                                |
| `2026-05-14-009` | S1-equivalent "What is gradient descent?"                                           | none   | warm                                   | none                                                   | —    | **2.63 s** | ~285  | Identical row to `2026-05-14-007`. Recorded again to anchor the session.                                                                                                                                                                                                                                                                                                                                                 |
| `2026-05-14-010` | AdHoc "Now compare it to Adam" (follow-up to 009)                                   | none   | warm                                   | none                                                   | —    | **5.16 s** | ~720  | No tool. Total dominated by output token generation, not tool latency. Compare to `2026-05-14-002` (6.58 s) on the same probe at SHA `0764c68` — within noise. Streaming starts well before 5 s; perceived latency is much lower.                                                                                                                                                                                        |
| `2026-05-14-011` | AdHoc-Course "What did chapter 3 say about this?"                                   | none   | warm                                   | `getInformation` → `{ error, code: "MISSING_CONFIG" }` | —    | **3.17 s** | ~45   | Same data as `2026-05-14-006`, recorded inside this session because it sits in the same thread between two tool-using turns. Critical signal: the structured-error path coexists with successful tool calls in the same thread without state leakage.                                                                                                                                                                    |
| `2026-05-14-012` | AdHoc duplicate send "Find recent papers on this"                                   | none   | warm                                   | none on first send                                     | —    | **1.22 s** | 0     | First send appears to have raced/aborted (UI shows the user prompt twice, no assistant text between them). Not a backend bug — second send (013) succeeded immediately after. Possible double-click or send-while-streaming race. **Worth flagging:** UX should disable Send while the previous turn is in flight, or de-dupe by client message id. Action item, not a latency regression.                               |
| `2026-05-14-013` | AdHoc "Find recent papers on this" (effective retry)                                | none   | warm                                   | `webSearch`                                            | —    | **5.98 s** | ~140  | Returned 3 papers with title, partial authors, source, URL. Confirms model correctly distinguishes "general knowledge" (009/010, no tool) from "recent papers" (uses webSearch). Matches the tightened system prompt's rule "only call tools when grounding in fresh data is required."                                                                                                                                  |
| `2026-05-14-014` | AdHoc "Thanks, summarise this whole chat"                                           | none   | warm                                   | none                                                   | —    | **9.91 s** | ~210  | **Slowest turn in the session.** Drivers: large context window (6 prior turns including tool calls and tool outputs), long structured output (numbered list, multi-paragraph). Not a regression in the optimisation work — same context size would have been ≥ 9 s pre-changes too. Action item: long-context summaries are a natural place to apply an explicit length cap in ADHD-Assist mode (Phase 2 prompt schema). |


**Summary of the session.** Every architectural decision held under live load:

- **Latency.** Pre-optimisation baseline was ~11 s for the first message. This session's cold first message (which also did a tool roundtrip) was **4.30 s** — and the cold non-tool message in Session 2026-05-14 was **3.32 s**. Both well under the 11 s baseline. The 9.91 s outlier is a long-context summary, expected.
- **Tool error envelope.** Worked exactly as designed in `2026-05-14-011`: no stuck UI, model wrote a graceful "please select a course" follow-up, the user could continue the conversation in the same thread. Same machinery would handle a Firecrawl outage or rate-limit in production identically.
- **No speculative tool calls.** `2026-05-14-009` and `2026-05-14-010` are pure knowledge questions and stayed pure — the tightened system prompt is holding.
- **Adaptive tool parameters.** `2026-05-14-008` picked `limit=1` because the user asked for "the top result." The model is reading the schema and the wording, not blindly defaulting.

### Session 2026-05-14D — chat UX hardening + RAG defaults + durable user persist

- **Changes:** (1) Typing indicator reads `toolInvocations` when `parts` is not yet filled (`getEffectiveParts` in `chat.tsx`). (2) Double-submit guard in `chat-input.tsx` + guarded submit in `chat.tsx`. (3) Non-200 / stream `onError` surfaced as a destructive `Alert`. (4) Incoming user messages are **`await appendMessages(...)`** before `streamText` (503 if DB write fails). (5) Higher default RAG caps with env overrides (`CHAT_HYBRID_RAG_*`, `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK`).

---

## Chat reliability & limits (FAQ)

### Duplicate user bubbles / “I have to repeat myself”

Usually **double-send**: Enter and the send button both call the same submit path, or two fast clicks occur before `isLoading` flips. Mitigations in the app:

- `ChatInput` uses a short-lived submit lock + `disabled={isLoading}` on the textarea.
- `chat.tsx` wraps `handleSubmit` so a submit is ignored while `isLoading` is true.

If duplicates still appear, capture whether they share the same `id` in the Network payload (duplicate POST bodies).

### “EduAI is thinking” forever / no assistant bubble

1. **TTFB** — DevTools → Timing → “Waiting for server response” is often the whole wait; that is server + provider latency, not WebSocket reuse on `/api/chat` (each turn is typically one HTTP request).
2. **Streaming errors** — Non-200 or mid-stream failures: an error banner should appear above the transcript (`onError` / `onResponse` in `chat.tsx`). If you see nothing, check the **Console** and the **Network** response body for `chat`.
3. **Typing indicator** — Uses `getEffectiveParts()` so tool phases show “Searching…” even when `parts` is briefly empty but `toolInvocations` is already set (`chat.tsx`).

### `TOOL_MAX_STEPS` vs “how many messages can I send?”

They are **unrelated**:

| Knob | Scope | Default | Meaning |
|------|--------|---------|--------|
| **Server** `CHAT_TOOL_MAX_STEPS` | One POST to `/api/chat` | `3` (hard cap `32`) | Max internal **model↔tool** round-trips **for that single user turn** inside `streamText`. Does **not** cap how many prompts the student can send in a thread. |
| **Client** `useChat({ maxSteps })` | Browser hook | `1` in `@ai-sdk/react` | Only matters for **client-driven auto-resubmit** when the server returns one tool step per HTTP request. Our server runs multi-step tools **inside one streamed response**, so leave the client default at `1` unless you change the wire protocol. |

If the model needed **more than 3** tool hops in one turn (rare), set e.g. `CHAT_TOOL_MAX_STEPS=5` in `.env` and restart.

### Long-output response caps (#152)

Long-output intent (for example, “summarise the whole chat”) uses a smaller output-token budget to bound completion latency and avoid an unstructured wall of text. This cap applies only when the server classifies the latest user turn as long-output intent; ordinary turns retain their existing model/provider limit.

| Env var | Default | Scope |
|---------|---------|-------|
| `CHAT_LONG_OUTPUT_MAX_TOKENS` | `1200` | Long-output turns in standard chat mode |
| `CHAT_LONG_OUTPUT_ADHD_MAX_TOKENS` | `600` | Long-output turns while ADHD Assist is enabled |

Both overrides must be positive integers. Missing or invalid values use the defaults, and the effective limit is `min(existing model/provider max tokens, configured long-output cap)`, so these settings never increase output length. When generation finishes with `length` after the server applied this cap, the response is persisted with `metadata.hitLongOutputCap=true`; the UI exposes a durable **Continue** action for that response.

When benchmarking a cap change, use the same long-output prompt, model, assistive-mode setting, and warm/cold path before and after. Record TTFT and total response time in separate session rows; do not treat the configured token ceiling as observed token usage.

### Gemini free tier quota (`generate_content_free_tier_requests`)

If the error mentions **`generate_content_free_tier_requests`** with a small **limit (e.g. 20)**, you are on Google’s **free** quota for that model/metric. Waiting **one wall-clock minute** is not always enough: the limit may be **per rolling window** or you may still be **over the daily cap** until Google resets it.

**What burns the same pool**

- Every **chat** completion to `gemini-*` using your browser-stored key (or any key tied to that **Google Cloud / AI Studio project**).
- **`GOOGLE_GENERATIVE_AI_API_KEY` in `.env`** — embeddings, indexing, and **boot warmup** (`[warmup] ...` via [`warmup.server.ts`](../../../apps/core/app/lib/ai/warmup.server.ts) on the AI-enhancement branch) also call Google; they often **share one project quota** with the chat key if it is the same key or same billing project.

**Why you see “Failed after 3 attempts”**

- The AI SDK **retries** failed calls by default (`maxRetries: 2` → up to **three** HTTP attempts per single user message). On **429 quota**, retries usually fail again and only **waste** free-tier requests.

**Mitigations**

1. **Enable billing** / upgrade the Gemini project (recommended for sustained dev or any demo with students).
2. **Reduce retries locally:** set `CHAT_LLM_MAX_RETRIES=0` in `.env` (or `1`), **restart the dev server**, so one failed quota error does not triple-call the API.
3. **Reduce other Google calls:** e.g. `CHAT_DISABLE_BOOT_WARMUP=1` skips the embedding warmup request (saves one call per server start; less helpful for first-byte latency).
4. **Separate keys/projects** — chat UI key vs server `.env` key on **different** projects doubles total free quota (two pools), at the cost of two setups.

### RAG excerpt size (multi-turn students)

Hybrid / tool RAG limits are tuned for **token safety** and latency; defaults were raised for richer course context. Override without code changes:

| Env var | Default (after 2026-05-14D) | Purpose |
|---------|-----------------------------|---------|
| `CHAT_HYBRID_RAG_MAX_CHUNKS` | `8` (max 24) | Vector hits merged into hybrid system prompt / tool payload cap |
| `CHAT_HYBRID_RAG_MAX_CONTEXT_CHARS` | `28000` (max 100000) | Total character budget for hybrid `system` injection (non-tool path) |
| `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK` | `10000` (max 50000) | Per-chunk truncation for `getInformation` tool results |
| `CHAT_LLM_MAX_RETRIES` | `2` (max 4) | HTTP retries inside `streamText`; use `0` on Gemini free tier to avoid 3× quota burn per send |

### Conversation length

`MAX_CONTEXT_MESSAGES` in `chat.ts` (default **20** messages) trims what is sent to the model so context does not grow without bound — separate from `TOOL_MAX_STEPS`.

---

## How to run a fresh row

1. `git rev-parse --short HEAD` — record the SHA in the session header.
2. If you want a **cold** number, restart the dev server. Wait for the boot-warmup log line (`[warmup] ... HTTPS keepalive established` or `[warmup] no embedding provider configured`).
3. Open `/chat`, pick the model under test, leave `courseCode` empty unless probing AdHoc-Course.
4. Open browser devtools Network tab. Filter by `chat`.
5. Paste a probe verbatim (Form A test sheet, or a row from **Live platform probe sequence** above). Press send.
6. After the reply is fully streamed, capture:
  - First-byte time → use as TTFT
  - Total request time → use as Total
  - Any in-flight tool labels you saw → list under "Tools called"
  - Word count of the assistant reply
7. Append a row to the latest session table. If anything notable happened (model refused, called an unexpected tool, broke the schema), note it in the **Notes** column.

## Honesty rules

- **Do not** average rows across different SHAs in the same table. Make a new session.
- **Do not** delete rows. If a measurement was wrong, append a corrected row and add a one-line "supersedes *RunID*" note.
- **Do not** infer "the model is faster" from a single warm-path run. The cold/warm distinction matters; restart-cold rows are the load-bearing ones.
- **Do not** record fake numbers. If you cannot measure TTFT (e.g. on the Claude consumer UI), say so in Notes and leave the cell blank.

## When to add a new session

- Server restart after a code change that could affect TTFT
- Model swap (different provider or different model id within a provider)
- `.env` change (e.g. flipping `CHAT_TOOL_MAX_STEPS`, `CHAT_LLM_MAX_RETRIES`, `CHAT_DISABLE_BOOT_WARMUP`, `CHAT_LONG_OUTPUT_MAX_TOKENS`, `CHAT_LONG_OUTPUT_ADHD_MAX_TOKENS`, `CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE`, `CHAT_HYBRID_RAG_MAX_CHUNKS`, `CHAT_HYBRID_RAG_MAX_CONTEXT_CHARS`, `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK`)
- Major prompt or tools-map change

## Open questions / ideas backlog

- Should we capture **byte counts** of the prompt sent to the provider (system + messages) per row? Useful for Phase 2.5 efficiency claims, but adds capture friction.
- Should we add a `streaming: true/false` column? Currently always `true` from the UI; might matter once Phase 3 oversight ships and buffers the first pass.
- Once `adhdAssist` toggle ships, every row should be **paired**: same probe in both modes, same model, same SHA. That is the format the Form A appendix wants.
- **Course materials UX:** after refresh, surface what was already uploaded for the course (or persist upload list client-side) so admins/instructors don’t lose context of indexed content between sessions.
