# EduAI Fleet Router — Executive Report

**Test period:** August 18–19, 2026 UTC  
**Environment:** `https://dev.eduai.ok.ubc.ca`  
**Configuration:** Qwen 3.5 2B/9B split across cmps01, cmps02, and cmps03  
**Related issue:** [#893](https://github.com/EduAI-Lab/EduAI/issues/893)

## Executive summary

The fleet successfully handled the complete controlled Chat API stress ladder from 16 to 1,000 concurrent users. The Qwen 3.5 2B/9B split remained exactly balanced at 50% per model, and requests were distributed evenly across cmps01, cmps02, and cmps03. At 1,000 concurrent users, all 1,000 direct-Core requests completed successfully, with 332 routed through cmps01, 339 through cmps02, and 329 through cmps03.

The public webapp path was healthy through 256 concurrent users. At higher levels, the public reverse proxy produced 502/fetch failures and the original per-user rate limit interfered with later ladder points. These public-path failures should be treated as ingress and configuration limits, not as evidence that the 2B/9B fleet stopped functioning.

## Key findings

- The fleet router shared Chat API traffic evenly across all three servers.
- The 2B/9B model split maintained an exact 50/50 request allocation at every test level.
- The controlled direct-Core run completed 2,776/2,776 requests successfully across the full ladder.
- The authenticated RAG smoke test preserved `chatId`, citations, RAG results, and `X-Fleet-Server`.
- Follow-up context remained correct when routed to another server because Core persists conversation history.
- The 1,000-user test is a stress ceiling, not a recommended low-latency operating target.

## Production assessment

The fleet/router behavior is promising for production use under the tested workload, but production sign-off should wait for a separate public-ingress capacity test. That test should isolate rate-limit buckets, measure proxy and upstream timeouts, and collect synchronized Core, Redis, database, GPU, and vLLM metrics.

The current results support the one-model-per-GPU 2B/9B topology. They do not establish that multiple model instances on one GPU would improve performance; that remains a separate VRAM-budget and latency experiment.

## Restoration

After testing, cmps02 GPU1 was restored to Qwen 2.5 32B, Core was restored to its original concurrency and rate-limit settings, and the temporary RAG fixture and stress-test files were removed.

See the companion [data report](./FLEET_ROUTER_DATA_REPORT_2026-08-19.md) for the complete measurements and charts.
