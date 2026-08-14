# 500-VU run results (#919)

Two full runs against the isolated local instance (mock LLM, `eduai_loadtest`
DB, `BETTER_AUTH_DISABLE_RATE_LIMIT=1`). Raw k6 summaries:
`run-a-default-admission.json`, `run-b-connection-pool.json`.

## Run A — default config

| Metric | Result |
|---|---|
| Login success | 100% |
| Dashboard load p95 | 245ms |
| Chat success rate | **0.79%** (387 / 48,950) |
| HTTP failure rate | 33.2% |
| Rate limiter (429) engages under burst | ✓ (confirmed at req #301+) |
| Rate limiter isolates other IPs | ✓ |

## Run B — DB connection pool raised (`connection_limit=50, pool_timeout=10`)

Same test, same seed data, only the Postgres connection pool changed.

| Metric | Result |
|---|---|
| Chat success rate | **0.78%** (389 / 49,522) — statistically identical to Run A |
| HTTP failure rate | 33.2% |

**Conclusion: DB connection pool size was not the bottleneck.** Enlarging it
5-10x made no measurable difference, so this hypothesis is ruled out.

## What's actually happening

The dominant failure in both runs is fast (sub-ms) `401 {"error":
"MISSING_SERVICE_KEY"}` responses on `/api/chat` — not the AI admission gate
(that shows up as slow ~15s waits before a 503, and was a minority of
failures by comparison). `MISSING_SERVICE_KEY` fires when
`auth.api.getSession()` returns no session for a request, even though:

- The session row exists in Postgres the whole time (verified: 200+ rows per
  demo account after the runs, no eviction).
- The same cookie, hammered directly with `curl` at 40 concurrent requests
  outside k6, does *not* reproduce this — it hits the real, correctly-working
  per-user chat rate limiter (`CHAT_RATE_LIMIT=20/60s`, `app/routes/api/chat.ts:757`)
  instead, returning 429, not 401.

So it reproduces reliably at 500 concurrent *distinct* sessions but not with
40 concurrent requests on one session, and doubling the DB pool didn't help.
The most likely remaining explanation is contention in better-auth's own
session/token verification path under raw concurrency (not DB-bound) — this
was not fully instrumented and is the top follow-up item below.

## Two real, working rate/capacity gates confirmed

1. **`AI_MAX_INFLIGHT`** (`app/lib/ai/admission.server.ts`, default 8) — caps
   concurrent AI requests platform-wide, 15s admission wait before a 503.
   Deliberate GPU-protection gate; this is why "500 concurrent users" was
   never going to mean "500 concurrent LLM calls" even with a working auth
   layer.
2. **`CHAT_RATE_LIMIT`** (`app/routes/api/chat.ts:757`, default 20/60s) —
   per-user chat throttle, confirmed working correctly outside the auth
   failure above.
3. **Session-validate rate limiter** (`app/lib/auth/rate-limit.server.ts`,
   300/60s per IP) — confirmed engaging under burst and correctly isolating
   other IPs, at both smoke and 500-VU scale.

## What held up fine at 500 concurrent users

- Login (100% success both runs)
- Dashboard/page loads (p95 70-245ms, well under the 3s threshold)
- Raw HTTP throughput (~305-309 req/s sustained for 8 minutes, ~148k
  requests, no crashes, no dropped connections)
- Per-IP rate limiting isolation

## Recommended next steps for EPIC #63 Phase 3

1. **Priority: instrument `auth.api.getSession()` under concurrent load** to
   find why it returns null despite a valid, unexpired, DB-backed session —
   this is the actual capacity ceiling exposed by this test, ahead of the
   admission gate.
2. Decide whether `AI_MAX_INFLIGHT=8` should scale with real deployment
   capacity (it's currently a flat default, not tied to fleet size).
3. Re-run this harness against a real vLLM fleet (not the mock) once (1) is
   fixed, to get real latency numbers instead of the mock's near-instant
   response times.
