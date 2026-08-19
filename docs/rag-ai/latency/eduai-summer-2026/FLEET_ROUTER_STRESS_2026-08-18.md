# Fleet-router authenticated RAG stress test

Date: 2026-08-18/19 UTC  
Environment: `https://dev.eduai.ok.ubc.ca` via s378  
Fixture: temporary course `FLEET-ROUTER-STRESS-20260818` (removed after testing)  
Models: `qwen3.5-2b-instruct` and `qwen3.5-9b-instruct`, alternating evenly  
Artifacts: [`artifacts/`](./artifacts/)

## Summary

We completed an authenticated RAG fleet stress test from 16 to 1000 concurrent users using an even Qwen 3.5 2B/9B split. The direct Core path handled all 1000 requests successfully, while the public webapp path exposed reverse-proxy and rate-limit bottlenecks above 256 users. Router hardening added deterministic chat affinity, failed-host ejection, configurable health checks, and RAG timing metadata. The test fixture and temporary settings were removed afterward, cmps02 GPU1 was restored to Qwen 2.5 32B, and the implementation was documented in GitHub issue #1581 and draft PR #1582.

## Smoke validation

The authenticated first turn returned HTTP 200, a `chatId`, `X-Fleet-Server`, one RAG chunk, a similarity score, and a response citing `Fleet router RAG stress fixture`. The follow-up reused the same `chatId` and succeeded on a second server in the baseline run. This confirms that conversation context is persisted by Core/DB rather than held only in the inference server.

After the affinity change, the follow-up remained on the same server, demonstrating the intended cache-locality behavior while retaining persisted context as the correctness mechanism.

## Baseline: public webapp path

The baseline ladder used the public webapp path and the original process-local round-robin router.

| Concurrent users | Successes | p50 ms | p95 ms | RPS | Notes |
|---:|---:|---:|---:|---:|---|
| 16 | 16/16 | 1,569 | 2,240 | 7.12 | Balanced across cmps01–03 |
| 32 | 32/32 | 1,721 | 2,477 | 12.79 | Balanced across cmps01–03 |
| 64 | 64/64 | 2,711 | 3,888 | 15.52 | 63/64 citation-bearing responses |
| 128 | 128/128 | 5,254 | 6,616 | 19.02 | 125/128 citation-bearing responses |
| 256 | 256/256 | 8,796 | 11,475 | 22.19 | 252/256 citation-bearing responses |
| 512 | 400/512 | 17,451* | 19,699* | 20.28* | 108 fetch failures, 4 HTTP 502 |
| 768 | 152/768 |  — |  — | 9.32* | Cumulative per-user HTTP 429s plus HTTP 502s |
| 1000 | 318/1000 |  — |  — | 16.75* | Cumulative per-user HTTP 429s plus fetch failures |

`*` The 512–1000 public results are not pure fleet-capacity measurements. The ladder reused one authenticated user and the original `CHAT_RATE_LIMIT=20` window; later levels therefore hit application rate limiting. The public reverse proxy also began returning 502/fetch failures. These results are retained as evidence of the public-path ceiling, not as a claim that the router itself failed at those concurrency levels.

## Post-hardening: direct Core path

For an unconfounded router/application measurement, the same authenticated RAG harness ran against Core on s378 at `127.0.0.1:3000`, bypassing the public reverse proxy. The temporary test settings allowed the 1000-request run. Every request returned HTTP 200.

| Concurrent users | Successes | p50 ms | p95 ms | RPS | Server distribution |
|---:|---:|---:|---:|---:|---|
| 16 | 16/16 | 1,326 | 2,106 | 7.57 | 5 / 3 / 8 |
| 32 | 32/32 | 1,802 | 2,586 | 12.31 | 9 / 15 / 8 |
| 64 | 64/64 | 3,132 | 3,543 | 17.70 | 22 / 23 / 19 |
| 128 | 128/128 | 4,990 | 6,861 | 18.44 | 39 / 42 / 47 |
| 256 | 256/256 | 9,772 | 13,373 | 18.94 | 79 / 96 / 81 |
| 512 | 512/512 | 17,451 | 19,699 | 25.51 | 165 / 164 / 183 |
| 768 | 768/768 | 26,513 | 30,089 | 25.29 | 257 / 268 / 243 |
| 1000 | 1000/1000 | 35,036 | 43,394 | 22.81 | 332 / 339 / 329 |

Server columns are `cmps01 / cmps02 / cmps03`. Each level split requests exactly 50/50 between the 2B and 9B models. RAG returned a chunk for every response; citation-bearing response rates ranged from 98.0% to 100% depending on model wording.

## Router hardening validated

The draft change adds:

- deterministic chat affinity using a stable hash of `chatId` (with user ID fallback), so repeated turns do not depend on a process-local cursor or a particular Core worker;
- short host ejection after an inference failure, preventing immediate reuse of a failed vLLM host while preserving one alternate-host retry;
- configurable health-cache TTL, health timeout, and failure-ejection duration;
- RAG duration response metadata (`ragLatencyMs` and `X-RAG-Latency-Ms`) for future per-request observability;
- unit coverage for affinity and host ejection.

The post-hardening public smoke preserved `chatId`, RAG chunk/similarity metadata, citation text, and `X-Fleet-Server`. Its two smoke turns stayed on the same fleet server, as expected with affinity.

## Supporting-system observations

After the post-hardening run, Redis reported `rejected_connections=0`, `evicted_keys=0`, `keyspace_hits=6366`, and `keyspace_misses=25`. A point-in-time container snapshot showed `eduai-redis` at approximately 15 MiB and `eduai-db` at approximately 117 MiB. Per-level DB query latency and GPU utilization were not emitted by the original harness; these remain follow-up observability work.

## Restoration

- cmps02 GPU1 restored to `Qwen/Qwen2.5-32B-Instruct-AWQ`, served as `qwen2.5-32b-instruct`.
- Core restored to `AI_MAX_INFLIGHT=8`, `CHAT_RATE_LIMIT=20`, and the pre-test environment.
- Temporary RAG course/material, cookies, source backups, and host-side stress artifacts removed.
- Core rebuild completed; `eduai-core` is active and the public root returned HTTP 200.
