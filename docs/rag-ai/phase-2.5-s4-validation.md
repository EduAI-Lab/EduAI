# Phase 2.5 — S4 tool-heavy validation (#261)

Validates [#260](https://github.com/EduAI-Lab/EduAI/issues/260) and [#259](https://github.com/EduAI-Lab/EduAI/issues/259) against S4-style tool-heavy turns through the real `POST /api/chat` path.

**IURA / §3b record:** [`docs/literature/iura-appendix-3b-scaffold.md`](../literature/iura-appendix-3b-scaffold.md) (#262)

Formal S4 wording will live in `docs/literature/form-a-eval-scenarios.md` (not in repo yet). Until then, scenario **S4** in `apps/core/scripts/eval-adhd-assist.mjs` mirrors the tool-heavy probes in [`MODEL_LATENCY_TRACKER.md`](./latency/MODEL_LATENCY_TRACKER.md) (`webSearch` + `fetchPage`, multi-turn).

## Run (local)

Prerequisites: core dev server, logged-in session cookie, model API keys, `FIRECRAWL_API_KEY` on the server, tool-capable model (e.g. `google:gemini-2.5-flash`).

```bash
# Terminal 1 — from repo root
npm run dev

# Terminal 2 — enable size hints in server logs (optional)
# In apps/core/.env: CHAT_DEBUG_LOG=1

# Terminal 3 — from apps/core
EDUAI_BASE_URL=http://localhost:3000 \
EDUAI_COOKIE="better-auth.session_token=...; ..." \
EDUAI_MODEL=google:gemini-2.5-flash \
EDUAI_API_KEYS_JSON='{"google":{"isEnabled":true,"apiKey":"..."}}' \
node scripts/eval-adhd-assist.mjs --only S4 --mode off
```

Use `--mode off` only for §3b validation (Baseline path; caps are mode-agnostic). Outputs go to `eval-runs/<timestamp>/` (gitignored).

On the server, each turn logs `Starting LLM stream` with `messageTextChars` when `CHAT_DEBUG_LOG=1`.

## Pass criteria

- [ ] All three S4 turns complete without HTTP/stream errors.
- [ ] No single tool-result string in model input exceeds **6,000 chars** (default `TOOL_RAG_MAX_CHARS_PER_CHUNK` / `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK`).
- [ ] On a long thread, total `messageTextChars` stays bounded by session digest (**28,000** default `CHAT_SESSION_MAX_CHARS`) plus recent tail.

## Representative turn — model-input size (before vs after)

**Scenario:** S4 turn 2 — `fetchPage` after `webSearch` (typical multi-page tool payload).

| Measure | Before Phase 2.5 (`development` @ `4a9c400`) | After Phase 2.5 (#260 + #259) |
| --- | --- | --- |
| `fetchPage` return cap (at tool execute) | **20,000** chars (`fetch-page.ts`) | **6,000** chars (shared with `getInformation`) |
| Same blob reloaded from DB on next turn | **Uncapped** — full JSON in `messages[]` | **6,000** chars per string (`capToolResultsInMessages`) |
| Example: 15 KB page markdown in one tool result | ~**15,000** chars in model input | ~**6,001** chars (`6000` + `…`) |
| Long thread (20 msgs, high char total) | Full transcript up to 20 messages | Digest + last **6** msgs when total > **28,000** chars |

**How to verify on a live run:** Compare `messageTextChars` in the `Starting LLM stream` debug line on S4 turn 2 before and after merging PR #443. After Phase 2.5, turn 2 should not show five-digit tool-only growth from a single `fetchPage` blob.

## Unit-test backstop

`apps/core/app/tests/unit/chat-rag.test.ts` asserts a 20,000-char mock `fetchPage` result is capped to 6,001 chars in `capToolResultsInMessages`.

## Record eval SHA

```bash
git rev-parse HEAD
```

Paste the SHA and a screenshot or log snippet of `messageTextChars` on S4 turn 2 into GitHub issue [#261](https://github.com/EduAI-Lab/EduAI/issues/261) when closing.
