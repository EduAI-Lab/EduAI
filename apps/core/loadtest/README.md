# Browser-level UI stress harness (#919)

k6 + Grafana load-testing harness that simulates up to 500 concurrent users
against Core, plus a smaller real-Chromium scenario for genuine
browser-level coverage. Built for EPIC #63 (Performance & Stress Testing).

## Safety — read before running

- **Local only, by design.** Every script here defaults to
  `http://localhost:4100`, a dedicated app instance with its own DB and a
  mocked LLM/embedding backend. **Never point `LOADTEST_BASE_URL` at
  `dev.eduai.ok.ubc.ca` or any shared host** — that server runs live ADHD
  Assist study sessions with real participants, and a 500-VU ramp will
  degrade or crash it.
- **No real model calls.** `VLLM_BASE_URL`/`OLLAMA_BASE_URL` point at
  `loadtest/mock-llm/server.mjs`, a canned-response stand-in. This is
  intentional — real OpenAI/Google keys would incur real cost per simulated
  user, and this harness measures *your platform's* capacity, not a model
  provider's.
- The isolated instance uses its own Postgres database (`eduai_loadtest`,
  same local Docker container, different DB) so nothing here touches your
  regular dev data.

## One-time setup

```bash
npm run loadtest:setup          # creates eduai_loadtest DB, migrates, seeds demo data
npm run build                   # production build (loadtest measures prod perf, not dev-server HMR overhead)
```

Seeded demo accounts (from `prisma/seed.ts`, password `EduAI2026!` for all):
`student1@eduai.local` … `student5@eduai.local`, all enrolled in course
`DATA 310`. k6 VUs log in as one of these five and reuse the session for the
whole run — same as a real user would.

## Running it

```bash
# Terminal 1 — app instance + mock LLM
npm run loadtest:instance

# Terminal 2 — optional live dashboards
npm run loadtest:monitoring:up
open http://localhost:3300        # Grafana, anonymous viewer access, dashboard auto-provisioned

# Terminal 3 — the test itself
npm run loadtest:smoke            # ~40s, 10 VUs — run this first, always
npm run loadtest:stress           # ~7min ramp to 500 VUs, HTTP-level
npm run loadtest:stress:grafana   # same, streaming metrics to the Grafana dashboard
npm run loadtest:browser          # ~2min, real Chromium, ~20 VUs (see below)
```

Stop the monitoring stack when done: `npm run loadtest:monitoring:down`.

## What "browser-level" means here

k6's core engine is HTTP/protocol-level, not a real browser — it replays the
requests a browser *would* make (`POST /api/auth/sign-in/email`,
`GET /dashboard`, `POST /api/chat`), which is what scales to 500 concurrent
users on a laptop.

`loadtest/k6/browser-flow.js` is the literal-browser complement: it drives
real headless Chromium through the login form, the chat page, and a message
send/receive round trip via `k6/browser`. Real browser processes are far
heavier (~100–300MB RAM each), so this scenario intentionally runs at ~20 VUs
rather than 500 — 500 concurrent real Chromium instances isn't something a
laptop (or most single hosts) can do. Together the two scripts cover both
"does the backend hold up at scale" and "does the actual UI work correctly
under concurrent load."

## Scenarios

| File | What it does |
|---|---|
| `k6/scenarios/chat-flow.js` | login → GET /dashboard → POST /api/chat (streamed), think-time between turns |
| `k6/scenarios/rate-limit-check.js` | bursts `/api/sessions/validate` past the 300 req/60s limit from one fake IP, confirms 429 engages and a different IP is unaffected |
| `k6/browser-flow.js` | real-Chromium login → chat page → send message → assert the reply renders |
| `k6/stress-500.js` | main entrypoint: ramps `chat_flow` to 500 VUs over ~7min, runs `rate_limit_check` once mid-ramp |
| `k6/smoke.js` | same scenarios at 10 VUs / ~40s, for fast iteration |

Thresholds (in `stress-500.js`) — the run fails if any of these are breached:
page-load p95 < 3s, chat-stream p95 < 8s, chat success rate > 95%, HTTP
failure rate < 5%.

## Relationship to #961 (perf-baseline)

`scripts/seed-perf-volume.ts` (issue #961) seeds thousands of synthetic
users/courses for *single-request* latency baselines at realistic data
volume. This harness is the *concurrency* counterpart — same idea (isolated
env, tagged/droppable synthetic data), different axis (500 simultaneous
users vs. one request against a big dataset). They can be combined by
running `db:seed:perf` against the same `eduai_loadtest` DB before a stress
run, if you want concurrent load *and* realistic data volume at once.

## Results so far

Two full 500-VU runs are recorded in [`results/FINDINGS.md`](./results/FINDINGS.md)
(raw k6 summaries alongside it). Headline: chat success rate was ~0.8% at 500
concurrent users, dominated by `401 MISSING_SERVICE_KEY` (session lookups
failing under concurrency) rather than the `AI_MAX_INFLIGHT` admission gate.
Enlarging the DB connection pool did not fix it — that hypothesis is ruled
out. See the doc for what's confirmed, what's ruled out, and the recommended
next diagnostic.

## Interpreting results

k6 prints a summary at the end of every run (thresholds pass/fail, percentiles,
error rate). With `loadtest:stress:grafana`, the same numbers are visible
live at `http://localhost:3300/d/eduai-k6-loadtest`. A failed threshold means
the platform did not hold up at that VU count — the summary tells you which
dimension (latency vs. errors vs. rate-limit isolation) broke first, which is
the input EPIC #63 Phase 3 needs for the actual capacity-tuning work.
