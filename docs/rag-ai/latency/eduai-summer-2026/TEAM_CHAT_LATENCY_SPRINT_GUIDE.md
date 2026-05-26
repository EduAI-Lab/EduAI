# EduAI chat latency — team sprint guide (this week)

**Audience:** Teammates implementing **faster chat** (you are **not** on ADHD Assist — lead owns that separately)  
**Parent issue:** [#203 — Chat latency & smart grounding sprint](https://github.com/EduAI-Lab/EduAI/issues/203)  
**Related:** [#195](https://github.com/EduAI-Lab/EduAI/issues/195) (small-model tools), [#196](https://github.com/EduAI-Lab/EduAI/issues/196) (TTFB investigation), [#264](https://github.com/EduAI-Lab/EduAI/issues/264) (hide support-tools toggle for small models — addressed in L10)  
**Discussion / context:** `[TEAM_CHAT_LATENCY_AND_TOOLS.md](./TEAM_CHAT_LATENCY_AND_TOOLS.md)`  
**Measurement ledger:** `[../MODEL_LATENCY_TRACKER.md](../MODEL_LATENCY_TRACKER.md)`  
**Base branch:** `feat/local-models-and-ai-enhancement` (merged work from `AI-enhancement`) — **build on top of this**, do not restart from scratch unless PI says so  
**Target branch for PRs:** `feat/chat-latency-week` (create from base above)  
**Product goal:** Typical turns feel **~3–4 s** where possible; **first visible token** early; course-material RAG still works **without** magic phrases like “check the course materials”.

**`supportsTools` invariant (after L13):**

- `supportsTools = false` → **small models, no tools registered at all.** Default for simple/chat-only turns. The fastest path.
- `supportsTools = true` → **bigger models, only `getInformation` registered.** Course-material RAG only. The router escalates here when L04 flags a turn as needing course grounding (typically bigger / more detailed questions).
- **Web search and page fetching are removed entirely (L13).** `webSearch` / `fetchPage` are deleted from the codebase, not just flagged out-of-scope. `supportsTools = true` means course-aware RAG and nothing else.

So the routing model the team is building is: **small (`supportsTools: false`) for simple questions → big (`supportsTools: true` = `getInformation` only) for detailed / course-aware questions.**

---

## What the lead already shipped (read before coding)

Most of this landed in commit `**c158023`** (`feat(chat): tool error envelopes, RAG/env tuning, materials admin access, observability`) on the AI enhancement line, now on `**feat/local-models-and-ai-enhancement**`.

### Already in the codebase


| Area                                                                | What changed                                                                                                            | Why it matters                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `**apps/core/app/routes/api/chat.ts**`                              | `TOOL_MAX_STEPS` default **3** (env `CHAT_TOOL_MAX_STEPS`); tightened system prompt (“prefer ZERO tool calls”)          | Cut speculative tool chains (~11 s → ~3 s on **cloud** Gemini in May session) |
|                                                                     | `CHAT_LLM_MAX_RETRIES` (default 2 → up to 3 HTTP tries); set `**CHAT_LLM_MAX_RETRIES=0`** on free tier                  | Stops burning quota on 429 retries                                            |
|                                                                     | Hybrid RAG caps: `CHAT_HYBRID_RAG_MAX_CHUNKS`, `CHAT_HYBRID_RAG_MAX_CONTEXT_CHARS`, `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK` | Stops huge course blobs from flooding the model                               |
|                                                                     | `buildCappedRagContextText` / `capRagHitsForTool`                                                                       | Bounded context for local LLM prefill                                         |
|                                                                     | Parallel **course + chat** Prisma lookups before LLM                                                                    | Saves ~30–150 ms TTFT on first message                                        |
|                                                                     | `**await` user message persist** before `streamText`                                                                    | Durability; slight add vs fire-and-forget                                     |
|                                                                     | Tool path uses `runTool` / `toolError` envelope                                                                         | No stuck “Ready” tool card on missing Firecrawl / course                      |
|                                                                     | `formatChatStreamError` + APICallError details to client                                                                | Easier debugging slow/failed streams                                          |
| `**apps/core/app/lib/ai/tool-result.ts`**                           | New — structured tool errors + `logToolOutcome`                                                                         | Production-safe failures                                                      |
| `**apps/core/app/lib/ai/tools/web-search.ts**`, `**fetch-page.ts**` | Return envelopes instead of throwing (web tools remain in tree but are **out of scope** this sprint)                    | Same                                                                          |
| `**apps/core/app/lib/ai/warmup.server.ts`**                         | Boot-time embedding call for HTTPS keepalive                                                                            | Cold TCP/TLS on first embedding                                               |
| `**apps/core/app/lib/ai/providers.ts**`                             | 5-minute cache for `modelSupportsTools`                                                                                 | Avoid DB hit every turn                                                       |
| `**apps/core/app/lib/prisma.server.ts**`                            | Boot connection warmup                                                                                                  | Faster first DB read                                                          |
| `**apps/core/app/routes/chat.tsx**`                                 | `getEffectiveParts` + typing phases (“Searching…”)                                                                      | UX during tool latency                                                        |
| `**apps/core/app/components/chat/chat-input.tsx**`                  | Submit lock + disable while loading                                                                                     | Fewer duplicate sends                                                         |
|                                                                     | Error `Alert` on failed stream                                                                                          |                                                                               |
| [`MODEL_LATENCY_TRACKER.md`](../MODEL_LATENCY_TRACKER.md)                                 | Live probe table + FAQ                                                                                                  | Operational record                                                            |


### Measured results (cloud — May 2026, see ledger)


| Probe                     | Before (approx.) | After (approx.)           |
| ------------------------- | ---------------- | ------------------------- |
| Simple factual (no tools) | ~11 s cold       | **~2.6–3.3 s**            |
| Long chat summary         | —                | **~9.9 s** (context size) |


### Still broken (why this sprint exists)


| Problem                                 | Detail                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Local Ollama (Gemma ~31B, DeepSeek)** | Lead still sees **40–50 s** total; fixes above helped **cloud** more than local           |
| **Server wait before UI text**          | Feels like “waiting for server to load” / no early tokens                                 |
| **Tool vs speed trade-off**             | `supportsTools: true` → full tool path (slow but correct); `false` → fast hybrid RAG only |
| **Course UX**                           | Students must say “check course materials” unless heuristics fire                         |
| **Prompt-only workaround**              | “Only call tools when user explicitly asks” → faster but breaks ~90% course-aware usage   |


**Forbidden fix:** Globally disable tools or set all models `supportsTools: false` to hit 3–4 s.

### Optional asset to restore

Commit `**de20b42`** added `apps/core/scripts/chat-latency-bench.mjs` + npm script — **may not be on your branch**. Cherry-pick or copy from that commit if missing; needed for step **L01**.

---

## Architecture reminder

```mermaid
flowchart TB
  subgraph fast [Fast but limited]
    HY[hybrid_rag when supportsTools false]
  end
  subgraph slow [Slow but course-aware]
    TC[tool_calling when supportsTools true]
    T1[getInformation course RAG]
  end
  REQ[POST /api/chat] --> CHECK{modelSupportsTools?}
  CHECK -->|false| HY
  CHECK -->|true| TC
  TC --> T1
```



**Sprint goal:** Make the **tool_calling** path feel closer to hybrid speed **without** losing course-material grounding. Web tools (`webSearch`, `fetchPage`) remain in the codebase but are not exercised this sprint.

---

## This week — steps for teammates

**Rough squad budget:** ~**15–25 h** across 2–3 devs (parallel where noted).  
**Done when:** Ledger rows prove improvement on **both** (1) cloud Gemini S1 probe and (2) **dev-server local-model** S1 probe, plus at least one course-RAG probe — without disabling tools. **No web probes.**

```mermaid
flowchart TB
  L00[L00 Kickoff] --> L01[L01 Bench script]
  L00 --> L02[L02 Baselines]
  L01 --> L02
  L02 --> L03[L03 Auto-RAG]
  L02 --> L04[L04 Intent router]
  L03 --> L06[L06 Tool output cap]
  L04 --> L06
  L02 --> L05[L05 Ollama warm]
  L06 --> L07[L07 TTFT audit]
  L05 --> L07
  L07 --> L08[L08 Session cap]
  L04 --> L10[L10 Model-tier routing]
  L10 --> L11[L11 Hide tools toggle for small models]
  L05 --> L12[L12 Cold start doc]
  L00 --> L13[L13 Remove webSearch + fetchPage]
  L13 --> L10
  L11 --> L09[L09 End week smoke]
  L12 --> L09
  L07 --> L09
```



---

## Step L00 — Kickoff & branch

**GitHub:** [#204](https://github.com/EduAI-Lab/EduAI/issues/204) · **Size:** S (~1h)

### Context

Lead owns ADHD Assist separately. Your epic is **platform speed + smart grounding** only.

### Task

1. Read `[TEAM_CHAT_LATENCY_AND_TOOLS.md](./TEAM_CHAT_LATENCY_AND_TOOLS.md)` and the “Already shipped” section above.
2. `git fetch` && checkout `feat/local-models-and-ai-enhancement` (or latest team integration branch).
3. Create `feat/chat-latency-week` from that tip.
4. Record `git rev-parse --short HEAD` in the parent issue.

### Done when

- Branch pushed; everyone on same SHA.

---

## Step L01 — Latency benchmark script in repo

**GitHub:** [#205](https://github.com/EduAI-Lab/EduAI/issues/205) · **Size:** S (~1–2h) · **Blocked by:** #204

### Context

Repeatable numbers beat gut feel. Script existed in `**de20b42`**; restore if missing.

### Task

1. Add `apps/core/scripts/chat-latency-bench.mjs` (from commit `de20b42` or equivalent).
2. Add npm script in `apps/core/package.json`, e.g. `"chat:latency-bench": "node ./scripts/chat-latency-bench.mjs"`.
3. Document env vars in `apps/core/.env.example` (`CHAT_BENCH_URL`, `CHAT_BENCH_MODEL`, `CHAT_BENCH_API_KEYS`, optional `CHAT_BENCH_COURSE_CODE`).
4. Run once against local dev; paste summary (median ms) into parent issue.

### Done when

- Teammate can run bench without asking lead for curl recipes.

---

## Step L02 — Baseline matrix (cloud + dev-server local model)

**GitHub:** [#206](https://github.com/EduAI-Lab/EduAI/issues/206) · **Size:** S (~2h) · **Blocked by:** #205

### Context

We need before/after on the **same** prompts and models. **Do not benchmark against a model running on your own laptop** — different hardware between teammates makes rows incomparable and we lose the regression gate. **Run all probes against the shared dev server**, which already hosts the agreed local model(s) via Ollama.

### Task

1. Point your `.env` (or the bench script env) at the **dev-server `CHAT_BENCH_URL`** — ask infra/lead for the URL if you don't have it.
2. Use the same `CHAT_BENCH_MODEL` slug everyone else uses (team-default local model on the dev server, plus `google:gemini-2.5-flash` for the cloud row).
3. Run and append rows to `[../MODEL_LATENCY_TRACKER.md](../MODEL_LATENCY_TRACKER.md)`:


| Probe ID   | Prompt (short)                         | Model                                 | Course       | supportsTools path |
| ---------- | -------------------------------------- | ------------------------------------- | ------------ | ------------------ |
| **S1**     | What is gradient descent?              | `google:gemini-2.5-flash` (cloud)     | none         | tool_calling       |
| **S1-dev** | Same                                   | dev-server local model (team default) | none         | tool_calling       |
| **C1**     | What did chapter 3 say about X?        | dev-server local model                | **selected** | tool_calling       |
| **C2**     | Summarise the lecture notes for week 4 | dev-server local model                | **selected** | tool_calling       |


Capture **TTFT** (stopwatch or Network) and **Total** per [`MODEL_LATENCY_TRACKER.md`](../MODEL_LATENCY_TRACKER.md). **No web probes** — web tools are out of scope this sprint.

### Done when

- Four rows with git SHA, all measured against the dev server (note the dev-server SHA / model slug in each row).
- Note if Total > 10 s on the dev-server local row (expected problem statement).

---

## Step L03 — Auto-RAG when course is selected (spike)

**GitHub:** [#207](https://github.com/EduAI-Lab/EduAI/issues/207) · **Size:** M (~4h) · **Blocked by:** #206 · **Owner:** backend

### Context

Today, tool-capable models only get course context if the model calls `getInformation` or user uses magic words. Hybrid path auto-injects RAG when `courseCode` is set but **only** when `supportsTools === false`.

### Task

In `apps/core/app/routes/api/chat.ts` **tool_calling** branch:

1. If `effectiveCourseId` is set, run `findRelevantContent` **before** `streamText` (same caps as hybrid).
2. Inject capped excerpts into the system prompt (reuse `buildCappedRagContextText`).
3. Keep tools registered; prompt: “Course excerpts already provided; use `getInformation` only if excerpts are insufficient.”
4. Measure **C1** probe before/after.

### Done when

- With course selected, “What did chapter 3 say…” works **without** the phrase “check course materials”.
- No regression on S1 Total > 15% on cloud.

---

## Step L04 — Lightweight intent routing (course-RAG vs chat-only)

**GitHub:** [#208](https://github.com/EduAI-Lab/EduAI/issues/208) · **Size:** M (~4h) · **Blocked by:** #206 · **Owner:** backend

### Context

Roughly 90% of turns need course context, but not every turn. Speculative `getInformation` (and the embedding cost behind it) is expensive on every turn — we want to skip it when the question is clearly chat-only. **Web search is out of scope this sprint** — do not add web routing.

### Task

Add `apps/core/app/lib/ai/chat-intent.ts` (name flexible) with one pure function:

- `needsCourseRag(message, hasCourse): boolean` — extend beyond the current hybrid keyword list (chat.ts:737–752); return `false` for clearly generic prompts (greetings, “what is X” when no course is selected, math/code asks, etc.).

In `chat.ts`, when `supportsTools`:

- Use `needsCourseRag` to decide whether to auto-inject course context (the L03 path) or skip straight to `streamText`.
- **Do not** remove `getInformation` from the tool list — the model can still call it explicitly if the heuristic is wrong.
- **Do not** add any web-routing logic (`webSearch` / `fetchPage` remain registered but untouched).

Document rules in PR; add unit tests for 10 example strings.

### Done when

- S1 does **not** trigger course-RAG injection.
- C1 **does** trigger course-RAG injection without user saying “check course materials”.
- Unit tests pass.

---

## Step L05 — Local Ollama: warm model & dev defaults

**GitHub:** [#209](https://github.com/EduAI-Lab/EduAI/issues/209) · **Size:** S (~2h) · **Blocked by:** #206 · **Owner:** infra / backend

### Context

40–50 s on 31B is often **model load + generation**, not TypeScript. Smaller default + keep-alive helps dev iteration.

### Task

1. Document in [`README.md`](../../../README.md) (or a new `docs/rag-ai/latency/eduai-summer-2026/` runbook when added): `ollama run <model>` keep-alive, GPU memory, first-token expectations. Background / theory lives in [`../COLD_START_AND_OLLAMA_WARMUP.md`](../COLD_START_AND_OLLAMA_WARMUP.md) (L12) — link to it from the runbook rather than duplicating.
2. Propose seed/admin default for **local dev**: e.g. `deepseek-r1:8b` for speed tests, `gemma` 31B for quality tests — separate profiles.
3. Optional: env `OLLAMA_KEEP_ALIVE` / compose note if team uses Docker.
4. Re-run **S1-local** after warm model; log row.

### Done when

- Written runbook + one measured warm vs cold row in ledger.

---

## Step L06 — Shrink course-RAG payloads before next model step

**GitHub:** [#210](https://github.com/EduAI-Lab/EduAI/issues/210) · **Size:** M (~3h) · **Blocked by:** #207 or #208

### Context

Large course-RAG dumps force slow second steps (see 9.9 s summary turn). Web payloads (Firecrawl) are out of scope this sprint.

### Task

1. After `getInformation` returns, summarise or truncate the RAG payload before appending to the model context (cap e.g. 2–4k chars per chunk — tune via env).
2. Reuse / extend `capRagHitsForTool` patterns (chat.ts:154).
3. Re-run **C1** and **C2** probes; log Total

### Done when

- Course-RAG turn Total improves measurably OR documented trade-off in PR.

---

## Step L07 — TTFT / streaming audit

**GitHub:** [#211](https://github.com/EduAI-Lab/EduAI/issues/211) · **Size:** M (~3h) · **Blocked by:** #206 · **Owner:** frontend + backend pair

### Context

Lead perceived delay before **any** text appears — may be server buffering, not model only.

### Task

1. DevTools: measure “Waiting for server response” vs first streamed chunk on `/api/chat`.
2. Confirm `toolCallStreaming` / AI SDK path forwards partial tokens when tools are idle.
3. If first byte is late only when tools run, improve typing indicator copy (already partially done in `chat.tsx`).
4. File issue if proxy/nginx buffers streaming (document host).

### Done when

- Short report in parent issue: where TTFT is spent (DB / embed / tools / model).
- One screenshot of Network timing tab.

---

## Step L08 — Session context cap (long threads)

**GitHub:** [#212](https://github.com/EduAI-Lab/EduAI/issues/212) · **Size:** M (~4h) · **Blocked by:** #211 · **Label:** optional if week runs long

### Context

`MAX_CONTEXT_MESSAGES = 20` + full tool outputs → slow “summarise this chat” turns.

### Task

1. Rolling summary or stricter trim of old tool messages before `streamText`.
2. Env-tunable `CHAT_MAX_CONTEXT_MESSAGES` or char budget.
3. Re-run long-thread probe from latency doc (~9.9 s case); target meaningful drop.

### Done when

- Documented env knobs + one ledger row.

---

## Step L10 — Model-tier routing (small-default → escalate to tool-capable)

**GitHub:** [#334](https://github.com/EduAI-Lab/EduAI/issues/334) · **Size:** M (~4–5h) · **Blocked by:** #208 (L04 intent router) · **Owner:** backend
**Related issue:** [#264 — hide support tools toggle for smaller models](https://github.com/EduAI-Lab/EduAI/issues/264)

### Context

Today every turn hits whichever model the user selected; `supportsTools: true` runs the slow tool path even when the question is clearly chat-only. The product idea is:

- **Default tier — small model, `supportsTools: false`.** Answers chat-only questions straight from weights. Fast. No RAG cost. No tool overhead.
- **Escalation tier — bigger model, `supportsTools: true`.** Only invoked when the request needs course-material grounding (per `needsCourseRag` from L04). Slower, but correct.

This is **not** "always-on tools" and **not** "always-off tools" — it's a per-turn router decision driven by the L04 intent classifier. Web tools stay out of scope.

### Task

1. In `apps/core/app/routes/api/chat.ts`, before resolving the model, call `needsCourseRag(message, hasCourse)` from L04.
  - If `false` → resolve to the configured **small-model slug** (env, e.g. `CHAT_SMALL_MODEL`); skip RAG entirely; do **not** register any tools.
  - If `true` → resolve to the **tool-capable model** the user/admin picked; proceed with the L03 auto-RAG path.
2. Add admin-side guard (covers [#264](https://github.com/EduAI-Lab/EduAI/issues/264)): in the model-config UI, hide / disable the `supportsTools` toggle for models flagged as small/non-tool-capable. A small model with `supportsTools: true` is a misconfiguration this router would silently exploit.
3. The escalation must be invisible to the user — same chat thread, same UI; only the model slug recorded in the DB differs per turn.
4. Cover edge cases:
  - User explicitly @-mentions a model → honour their choice, skip the router.
  - `needsCourseRag` confidence is borderline → default to **escalate** (correctness over speed).
5. Re-run **S1-dev** (should now hit small model, very fast) and **C1** (should escalate, similar to L03 timing). Log both rows; note which model each used.

### Done when

- S1-dev Total drops materially vs L02 baseline because it now uses the small model.
- C1 still works without the magic phrase and the ledger row shows the escalated model.
- `supportsTools` toggle is hidden for small models in the admin UI ([#264](https://github.com/EduAI-Lab/EduAI/issues/264) closed by this PR or a sibling).
- No regression on any C* probe.

### Open questions for kickoff

- Which small model do we trust as the default? (Candidates: `deepseek-r1:8b`, `gemma2:9b`, cloud `gemini-2.5-flash-lite`.) Decide in L00; record in ledger.
- Should the router ever escalate **mid-turn** (small model answers, then we notice it needed RAG)? **No** for this sprint — too complex; flag for follow-up.

---

## Step L11 — Hide `supportsTools` toggle for smaller models in Admin UI

**GitHub:** [#264](https://github.com/EduAI-Lab/EduAI/issues/264) · **Size:** S (~1–2h) · **Blocked by:** #334 (L10) · **Owner:** frontend

### Context

Smaller models (e.g. `deepseek-r1:8b`, `gemma2:9b`) do not support tool calling. Today the Admin UI still shows the `supportsTools` checkbox/toggle for every model, which means an admin can flip it on for a small model and silently break the L10 tier router (it will route course-RAG turns to a model that can't call `getInformation`). This is the misconfiguration foot-gun called out in L10 step 2 — split out here so a frontend dev can own it independently.

### Task

1. In the admin model-config UI (model create/edit form), determine the "small / non-tool-capable" set. Options:
  - Check a capability flag on the model row (preferred — add `toolsCapable: boolean` on `AIModel` if not already present), **or**
  - Maintain a deny-list of provider:model slugs in a shared constant (acceptable short-term).
2. Conditionally render the `supportsTools` toggle: **hide** (or disable with tooltip "This model does not support tool calling") when the selected model is in the non-tool-capable set.
3. Server-side guard: reject `supportsTools: true` on save for non-tool-capable models — UI hiding alone is not enough.
4. Backfill: write a one-shot script or migration that flips `supportsTools` to `false` for any currently-misconfigured small model in the DB.
5. Manual test: open admin UI, switch model dropdown between a small and a large model, confirm toggle shows/hides correctly; attempt API save with toggle forced on for a small model and confirm 4xx.

### Done when

- Toggle is invisible (or disabled with explanation) for small models in the admin UI.
- Server rejects `supportsTools: true` for those models.
- Existing DB rows backfilled; no small model has `supportsTools = true` in dev.
- [#264](https://github.com/EduAI-Lab/EduAI/issues/264) closed by this PR.

---

## Step L13 — Remove `webSearch` and `fetchPage` tools (scope cut)

**GitHub:** [#348](https://github.com/EduAI-Lab/EduAI/issues/348) · **Size:** M (~3h) · **Blocked by:** #204 (L00) · **Owner:** backend

### Context

The product no longer wants web grounding. The only grounding we care about is **course-material RAG via `getInformation`**. Keeping `webSearch` and `fetchPage` in the tool list — even when unused — costs us in three ways:

1. The model sees them in the tool schema every turn → extra prefill tokens and occasional speculative tool calls we don't want.
2. They make `supportsTools: true` ambiguous (does it mean "can hit the web" or "course-aware"?). For L10/L11 to be coherent, `supportsTools: true` must mean exactly one thing: **`getInformation` is registered and the model can pull course material through RAG**.
3. They keep Firecrawl + web-search infra on the critical path for failures, error envelopes, and review surface area.

**Target invariant after this step:**

- `supportsTools = false` (small models) → no tools registered. Model answers simple questions straight from weights. Fast path, no RAG, no web. This is the default the router sends most turns to.
- `supportsTools = true` (bigger models) → **only** `getInformation` is registered. When the L04 intent classifier flags a turn as needing course RAG, the router escalates here; the model can pull course chunks and answer with grounding. No web.

### Task

1. In `apps/core/app/routes/api/chat.ts`, delete `webSearch` and `fetchPage` from the tool registry passed to `streamText`. `getInformation` is the only entry that remains in the tools object on the tool-calling branch.
2. Delete the tool source files: `apps/core/app/lib/ai/tools/web-search.ts`, `apps/core/app/lib/ai/tools/fetch-page.ts`, and any sibling helpers used **only** by those two (grep before deleting).
3. Remove Firecrawl wiring that is now unused: env vars (`FIRECRAWL_*`), `.env.example` entries, any client/provider init, and dependency from `apps/core/package.json` if nothing else imports it. Run `npm install` to refresh the lockfile.
4. Update the system prompt in `chat.ts` to drop references to web search / "search the web" / "fetch this URL"; rewrite the tool-use guidance so it only describes `getInformation` (course material RAG).
5. Update `app/lib/ai/tool-result.ts` / `runTool` only if it special-cases the removed tools — otherwise leave it alone (the envelope itself stays for `getInformation`).
6. UI: in `apps/core/app/routes/chat.tsx` typing-phase copy ("Searching the web…" etc.), drop the web phrasing; "Searching course…" stays. Remove any tool-card UI specific to web results.
7. Tests: remove or rewrite any unit/integration tests that asserted webSearch/fetchPage behaviour. Add one assertion that the tool registry on the tool-calling branch contains exactly `getInformation`.
8. Docs: update `TEAM_CHAT_LATENCY_AND_TOOLS.md` and this sprint guide to drop "web tools remain in the codebase but out of scope" language — they no longer remain.
9. Manual smoke: ask a question that previously would have triggered web search ("what's the latest on X?"); confirm the model now answers from weights (small model) or from course material (big model) with no web call.

### Done when

- `grep -ri "webSearch\|fetchPage\|firecrawl" apps/core/app` returns nothing meaningful (only stray comments to delete).
- `getInformation` is the sole tool registered when `supportsTools: true`.
- No new package dependency on Firecrawl / web-search SDKs remains.
- Sprint docs no longer carry the "web tools out of scope but still present" caveat; they state the new invariant.
- One regression-style test pins the tool list to `["getInformation"]`.

### Open questions for kickoff

- Are there course pages (admin/help text) that mention web search as a feature? If so, remove or reword in the same PR.
- Telemetry: any `AIInteraction` rows or analytics filters that group by `toolName = 'webSearch'`? Decide whether to keep historical rows or migrate the field.

---

## Step L12 — Cold-start & Ollama warmup reference doc

**GitHub:** [#209](https://github.com/EduAI-Lab/EduAI/issues/209) (shares parent with L05) · **Size:** S (~1h) · **Blocked by:** #209 (L05 runbook) · **Owner:** infra / docs

### Context

L05 ships the runbook for *how* to warm Ollama on cmps01, but the team keeps re-explaining *why* local turns spend 10–60 s before any tokens appear, why a routed turn that just worked is suddenly slow again, and why bench numbers swing between runs. We need a single, linkable explainer that distinguishes **cold start** (load weights → GPU), **warm** (same model still resident), and **model-switch eviction** (Auto router rotates tiers, previous weights get unloaded) — and that calls out what cold start is **not** (Postgres, embeddings, routing bugs, empty `apiKeys`). This is reference material, not a fix; it unblocks the team from misattributing latency.

### Task

1. Land [`docs/rag-ai/latency/COLD_START_AND_OLLAMA_WARMUP.md`](../COLD_START_AND_OLLAMA_WARMUP.md) (already drafted; commit as-is or with minor edits). It must cover:
  - Phase breakdown of a local chat turn (RAG embed → model load → prefill → generate).
  - Cold vs warm vs model-switch definitions, with the rule that ledger rows must be tagged `cold` / `warm`.
  - Why cmps01 + Auto tier rotation amplifies cold loads (VRAM eviction).
  - Mitigations: keep 1–2 models hot, `keep_alive`, tier-pool alignment with [`apps/core/prisma/seed.ts`](../../../apps/core/prisma/seed.ts), session stickiness, streaming/UX.
  - A "checklist for investigating a slow turn" the team can paste into issues.
2. Cross-link:
  - From this sprint guide's **L05** step → add "Background: see [`COLD_START_AND_OLLAMA_WARMUP.md`](../COLD_START_AND_OLLAMA_WARMUP.md)".
  - From [`../MODEL_LATENCY_TRACKER.md`](../MODEL_LATENCY_TRACKER.md) → reference the cold/warm tagging rule.
  - From [`TEAM_CHAT_LATENCY_AND_TOOLS.md`](./TEAM_CHAT_LATENCY_AND_TOOLS.md) → add to the Related docs table.
3. Comment on [#209](https://github.com/EduAI-Lab/EduAI/issues/209) linking the merged doc so L05 reviewers see the rationale.

### Done when

- File exists at `docs/rag-ai/latency/COLD_START_AND_OLLAMA_WARMUP.md` on the sprint branch.
- L05, ledger, and AND_TOOLS docs link to it.
- Comment on [#209](https://github.com/EduAI-Lab/EduAI/issues/209) posted.

---

## Step L09 — End-of-week smoke & handoff

**GitHub:** [#213](https://github.com/EduAI-Lab/EduAI/issues/213) · **Size:** S (~2h) · **Blocked by:** #207–#211 (whatever merged)

### Task

Checklist on parent issue:

- S1 cloud ≤ **4 s** warm Total (or documented why not)
- S1-dev (dev-server local model) improved vs L02 baseline **or** documented dev-server hardware limit
- C1 works without the “check course materials” phrase
- C2 (long course-RAG summary) Total improved vs L02 baseline
- No global `supportsTools: false` hack
- `webSearch` + `fetchPage` removed (L13); only `getInformation` remains as a tool
- L10 tier router lands: S1-dev uses small model, C1 escalates to tool-capable model
- L11 — [#264](https://github.com/EduAI-Lab/EduAI/issues/264) `supportsTools` toggle hidden (and server-rejected) for small models; existing DB rows backfilled
- L12 — [`COLD_START_AND_OLLAMA_WARMUP.md`](../COLD_START_AND_OLLAMA_WARMUP.md) merged and linked from L05, ledger, and AND_TOOLS doc
- L13 — `webSearch` + `fetchPage` deleted; tool registry on the tool-calling branch contains exactly `getInformation`; Firecrawl deps removed
- All PRs link sub-issues; ledger updated

### Done when

- Lead can demo to PI with numbers, not adjectives.

---

## Code map (quick reference)


| Area                               | Path                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| Chat API (main surgery)            | `apps/core/app/routes/api/chat.ts`                                  |
| Hybrid vs tools branch             | ~line 725 `modelSupportsTools`                                      |
| Tool envelope                      | `apps/core/app/lib/ai/tool-result.ts`                               |
| Course-RAG tool (`getInformation`) | defined inline in `apps/core/app/routes/api/chat.ts:674` (in scope) |
| Web / fetch tools                  | `apps/core/app/lib/ai/tools/` (**deleted in L13** — no longer present after that step lands) |
| Embeddings / RAG                   | `apps/core/app/lib/ai/embedding.ts`                                 |
| Boot warmup                        | `apps/core/app/lib/ai/warmup.server.ts`                             |
| Chat UI / TTFT perception          | `apps/core/app/routes/chat.tsx`                                     |
| Bench script (restore)             | `apps/core/scripts/chat-latency-bench.mjs`                          |
| Env knobs                          | `apps/core/.env.example`                                            |


---

## How to pick up work

1. Claim **#204–#213, #264, #334** on parent [#203](https://github.com/EduAI-Lab/EduAI/issues/203); do **not** pick ADHD Assist issues.
2. Branch `feat/chat-latency-week` from `feat/local-models-and-ai-enhancement`.
3. Every PR: **Context → Task → Done when**; append latency rows.
4. Questions on product trade-offs → lead. Ollama hardware → infra.

---

## Relationship to other docs


| Doc                                                                  | Who uses it                       |
| -------------------------------------------------------------------- | --------------------------------- |
| `TEAM_ADHD_ASSIST_PLAN.md` *(planned — ask lead)* | Lead only (this week) |
| [`TEAM_PHASE_0_AND_1_GUIDE.md`](../../routing/eduai-summer-2026/TEAM_PHASE_0_AND_1_GUIDE.md) | Routing Phase 0 & 1 (lead reference) |
| **This file**                                                        | **Teammates — latency sprint**    |
| `[TEAM_CHAT_LATENCY_AND_TOOLS.md](./TEAM_CHAT_LATENCY_AND_TOOLS.md)` | Background + open decisions L1–L5 |


---

*Last updated: 2026-05-19 — built from `c158023` / AI-enhancement work + lead local Ollama findings.*