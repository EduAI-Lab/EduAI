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

## What the original runs actually measured (and what they did not)

The dominant failure in both runs is fast (sub-ms) `401 {"error":
"MISSING_SERVICE_KEY"}` responses on `/api/chat` — not the AI admission gate
(that shows up as slow ~15s waits before a 503, and was a minority of
failures by comparison). `MISSING_SERVICE_KEY` fires when the chat route
sees no session (and no service key). That is **consistent with**
`getSession()` returning null, but the original harness could not tell that
apart from simpler explanations it never ruled out:

- **Cookie jar.** Login was asserted on HTTP 200 only. With
  `COOKIE_DOMAIN=localhost`, better-auth sets a `Domain` attribute that k6's
  VU jar may not round-trip — a 401 then looks like a platform ceiling when
  the session cookie never left the client. A `curl` of one captured cookie
  at 40 concurrency hitting `checkRateLimit` (429, not 401) is evidence
  against "the cookie is invalid," not evidence that k6 held the cookie.
- **Dashboard redirects.** `GET /dashboard` followed redirects, so an
  unauthenticated VU still recorded a 200 (the login page). "Dashboard p95
  245ms held up" may be measuring a logged-out bounce.
- **Five accounts, not 500 users.** VUs round-robined `student1`–`student5`.
  Even with auth working, `checkRateLimit` (`chat:${actingUser.id}`) would
  have capped throughput at 5× `CHAT_RATE_LIMIT` (default **100**/60s, not
  20). The original write-up's "500 concurrent distinct sessions" overstated
  what was tested. (This also does not explain the 401s — the limiter sits
  *after* auth.)
- **Stream latency on failures.** `eduai_chat_stream_duration` included
  sub-ms 401s, so the p95 threshold could go green on total failure.
- **No Redis.** `.env.loadtest` has no `REDIS_URL`, so `checkRateLimit` used
  the per-process fallback. "Limiter confirmed working" holds for a single
  instance, not the Redis-shared multi-instance behaviour prod uses.

DB pool size is still ruled out (Run A vs Run B). Session rows existed in
Postgres. **Not yet ruled out:** session-cookie retention in the k6 VU jar,
and the dashboard-redirect false positive. Those are harness bugs until
falsified; they are not yet a Phase 3 mandate to instrument
`auth.api.getSession()`.

Harness follow-up in this PR: assert the session cookie after login
(`redirects: 0` on dashboard), one unique seeded user per VU, record stream
duration only on 200s, split failures by status, bind mock/app/Grafana to
loopback, `NODE_ENV=production`. Re-run before treating 401s as a platform
finding.

## Two real, working rate/capacity gates confirmed

1. **`AI_MAX_INFLIGHT`** (`app/lib/ai/admission.server.ts`, default 8) — caps
   concurrent AI requests platform-wide, 15s admission wait before a 503.
   Deliberate GPU-protection gate; this is why "500 concurrent users" was
   never going to mean "500 concurrent LLM calls" even with a working auth
   layer.
2. **`checkRateLimit` / `CHAT_RATE_LIMIT`** (default **100**/60s) —
   per-user chat throttle, confirmed working on the `curl` side-experiment
   (429). Line numbers in `chat.ts` drift; the symbol is `checkRateLimit`.
3. **Session-validate rate limiter** (`app/lib/auth/rate-limit.server.ts`,
   300/60s per IP) — confirmed engaging under burst and correctly isolating
   other IPs, at both smoke and 500-VU scale.

## What held up fine at 500 concurrent users

- Login (100% HTTP 200 both runs — cookie retention was not yet asserted)
- Dashboard/page loads (p95 70-245ms) — **caveat:** those GETs followed
  redirects, so a bounced-to-login VU still counted as 200
- Raw HTTP throughput (~305-309 req/s sustained for 8 minutes, ~148k
  requests, no crashes, no dropped connections)
- Per-IP rate limiting isolation

## Recommended next steps for EPIC #63 Phase 3

1. **Re-run with the harness checks above** (cookie held after login,
   dashboard not redirected, unique user per VU, duration only on success).
   Chat failed with 401 `MISSING_SERVICE_KEY` at 500 VUs. DB pool size is
   ruled out. If the cookie-jar check fails, the 401s are a harness artifact
   and nobody should spend Phase 3 hours instrumenting `getSession()`. If it
   holds, *then* instrument `auth.api.getSession()` under concurrency.
2. Decide whether `AI_MAX_INFLIGHT=8` should scale with real deployment
   capacity (it's currently a flat default, not tied to fleet size).
3. Re-run against a real vLLM fleet (not the mock) only after (1) is
   settled, to get real latency numbers instead of the mock's near-instant
   response times. Do **not** point this harness at `dev.eduai.ok.ubc.ca`
   (live study traffic). A dedicated loadtest host, if ops provisions one,
   is the right place for "how EduAI handles load under real network
   conditions."
