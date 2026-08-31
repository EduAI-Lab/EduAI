# Performance measurement

This document describes repeatable measurements for current behavior. It does
not publish old latency numbers: those depend on model, host load, prompt,
database state, and deployment configuration, so a dated result is not a
current guarantee.

## What to measure

Keep these dimensions separate:

- request admission wait and queueing;
- RAG query embedding and database retrieval;
- provider time to first token/byte and total generation time;
- tool-call round trips and output-token caps;
- fleet host distribution, retries, and ejections;
- success status and grounding quality, not latency alone.

The chat route exposes `X-Admission-Wait-Ms`, `X-RAG-Latency-Ms`,
`X-Fleet-Server`, and `X-Routed-Model`. Non-streaming JSON also includes RAG
chunk count, top similarity, token estimate, and (when applicable) RAG latency.
Streaming benchmarks must measure time to the first response chunk separately
from total completion time.

## Single-request chat benchmark

From `apps/core`:

```bash
npm run bench:chat
```

The script is the source of truth for its required URL, model, authentication,
prompt, and streaming variables. For time-to-first-byte, use its streaming mode
and compare two deployments with the same prompt set, model, auth, and labels.
Do not compare a warm run to a cold run without recording that fact.

## Authenticated RAG/fleet harness

`apps/core/scripts/fleet-rag-stress.mjs` exercises Core's `/api/chat`, not a raw
vLLM endpoint. It:

1. signs in with one configured account;
2. runs a two-turn course-RAG smoke, checking chat continuity and citation;
3. sends a closed-loop concurrency ladder;
4. records status, elapsed time, optional TTFT, selected fleet host, model,
   source titles, similarity, chunk count, and RAG latency;
5. writes JSON to `/tmp/fleet-rag-stress.json` by default.

The default ladder is `16,32,64,128,256,512,768,1000`; set
`FLEET_STRESS_LADDER` for a smaller controlled run. The harness uses one
authenticated session, so it measures one principal's concurrent-request
capacity, not a realistic population of distinct users. It can also hit chat
rate limits; raise limits only for an approved, time-bounded test.

Required variables are `FLEET_STRESS_EMAIL`, `FLEET_STRESS_PASSWORD`, and
`FLEET_STRESS_COURSE_ID`. Optional variables include
`FLEET_STRESS_CORE_URL`, `FLEET_STRESS_MODEL`/`FLEET_STRESS_MODELS`,
`FLEET_STRESS_LADDER`, `FLEET_STRESS_STREAMING`, `FLEET_STRESS_TIMEOUT_MS`, and
`FLEET_STRESS_OUT`. Do not place passwords or cookies in committed output.

## Isolated fixture lifecycle

`apps/core/scripts/fleet-rag-fixture.ts` creates a temporary published course
and embedded material only after the caller sets
`FLEET_STRESS_FIXTURE_ALLOW_MUTATION=1`. The course code must use the reserved
`FLEET-ROUTER-STRESS-*` prefix, and production is rejected unless a second
explicit override is supplied. The script refuses to overwrite an existing
fixture.

The setup prints the course id. After testing, clean up with the same reserved
code and:

```bash
FLEET_STRESS_FIXTURE_ALLOW_MUTATION=1 \
FLEET_STRESS_FIXTURE_COURSE_ID=<course-id> \
npx tsx scripts/fleet-rag-fixture.ts --cleanup
```

Check the script's package entry point before running this command on a branch;
the TypeScript helper may also be invoked directly with the repository's normal
`tsx` runner. Never point mutation helpers at production data.

## Interpreting results

Report at least:

| Area | Evidence |
| --- | --- |
| Correctness | HTTP status, RAG chunks, source title/citation, chat id continuity |
| Capacity | requested concurrency, success/failure counts, request and successful RPS |
| Latency | p50/p95/p99 total and TTFT where streaming is enabled |
| Retrieval | top similarity, chunk count, RAG p50/p95 |
| Fleet | host counts, model counts, status counts, retry/ejection observations |
| Conditions | commit, deployment URL, model, provider, config, warm/cold state, rate limits |

Never treat a successful HTTP response as proof that RAG worked. A run can be
fast because retrieval returned no chunks, or slow because a model loaded on a
host. Record both outcome and instrumentation.

## Known gaps in current harnesses

- `fleet-rag-stress.mjs` uses one session; it is not a multi-user load model.
- `fleet-smoke.mjs` still reads legacy `VLLM_FLEET_*` variables rather than the
  preferred structured fleet config.
- `apps/core/scripts/eval-rag-seed.ts` is stale: it forces the legacy 3072
  embedding path while the live schema is `vector(1024)`. Do not use it as a
  passing evaluation until it is updated or isolated with a matching schema.
- `seed-rag-ingestion-fixtures.ts` discovers the three committed fixtures, but
  its slide-marker assertion has no matching committed slide fixture. Treat
  that check as a known failing/unfinished test seam, not evidence of complete
  slide coverage.

These gaps are recorded so a future developer can fix the harnesses without
mistaking them for production behavior.

## Code map

| Tool | File |
| --- | --- |
| Single-request chat benchmark | [`apps/core/scripts/chat-latency-bench.mjs`](../../apps/core/scripts/chat-latency-bench.mjs) |
| Authenticated RAG/fleet stress | [`apps/core/scripts/fleet-rag-stress.mjs`](../../apps/core/scripts/fleet-rag-stress.mjs) |
| Temporary stress fixture | [`apps/core/scripts/fleet-rag-fixture.ts`](../../apps/core/scripts/fleet-rag-fixture.ts) |
| Fleet smoke | [`apps/core/scripts/fleet-smoke.mjs`](../../apps/core/scripts/fleet-smoke.mjs) |
| Extension routing smoke | [`apps/core/scripts/extension-fleet-smoke.mjs`](../../apps/core/scripts/extension-fleet-smoke.mjs) |
| RAG fixture seeder | [`apps/core/scripts/seed-rag-ingestion-fixtures.ts`](../../apps/core/scripts/seed-rag-ingestion-fixtures.ts) |
