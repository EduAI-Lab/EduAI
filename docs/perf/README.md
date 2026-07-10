# Performance & Code-Quality Baselines

Snapshots of API response times and code-quality metrics, captured **before** the
#940–#949 / #921 fixes so those fixes can be measured as a concrete before/after delta.

> **Scope.** The normal CRUD API surface (~46 Core + ~77 Question Maker + ~71 AI Tutor
> route defs), **not** AI-chat/model latency (see `apps/core/scripts/chat-latency-bench.mjs`)
> and **not** concurrency/load behaviour (that's stress testing, #918). Baseline runs are
> **concurrency=1**, steady-state.

> **What the numbers mean.** Local / dev numbers are for **relative before/after deltas**,
> not production SLAs. For the DB-round-trip-heavy endpoints that dominate the fix list,
> local *under-states* the real gain (a managed DB adds a network hop × N queries), so the
> measured delta is a **conservative floor**.

## Layout

```
docs/perf/
  README.md                    <- this file
  baseline/                    the pinned BEFORE snapshot (issue #961)
    endpoints.md               inventory: app / method / path / auth / handler
    response-times.json        p50/p95/p99 + payload bytes + status per route (machine-readable)
    SUMMARY.md                 headline numbers + full environment fingerprint
    duplication/               jscpd report (json + html)
    dead-code/                 knip + ts-prune output
    dep-graph/                 madge circular-dep + module graph (json + svg)
```

`baseline/` is the pinned BEFORE run. Don't edit it in place after the fixes land —
capture the AFTER run into a sibling folder (e.g. `after-<date>/`) and compare.

## Regenerate

### Code-quality (no running stack needed)

```bash
npm run perf:quality          # runs jscpd + ts-prune + madge, writes into the dated folder
npm run knip -w ai-tutor       # dead code (already wired in ai-tutor)
```

Individual tools:
```bash
npx jscpd --config .jscpd.json
npx ts-prune -p apps/core/tsconfig.json
npx madge --circular --extensions ts,tsx apps/core/app
```

### Response times (needs the full stack running + seeded)

1. Bring up the stack (local): `npm run docker:dev:db && npm run dev` (Core :3000, AI-Tutor :4000, QM :8000).
2. Seed realistic volume:
   ```bash
   npm run dbseed                                   # users/courses/topics/questions/enrollments
   cd apps/core && npx tsx scripts/seed-rag-ingestion-fixtures.ts   # material chunks + embeddings
   ```
3. Configure targets (env): `CORE_URL`, `AITUTOR_URL`, `QM_URL` — point at local or UBC dev.
4. Run:
   ```bash
   PERF_OUT=docs/perf/baseline npm run perf:endpoints        # or after-<date> for the AFTER run
   ```
   The script mints real better-auth sessions per role (`POST {CORE_URL}/api/auth/sign-in/email`,
   seed password `EduAI2026!`), reuses each cookie across all three apps (all validate against
   Core), warms up, then measures.

## Compare a later run

Both `response-times.json` files share a stable schema keyed by `app+method+path`. To compute
a delta:

```bash
node scripts/perf-compare.mjs docs/perf/baseline/response-times.json \
                              docs/perf/after-<date>/response-times.json
```

Compare like-for-like only: **same target environment + same seed**. The `env` block in each
`SUMMARY.md` / `response-times.json` records git SHA, target URLs, DB name, seed scripts run,
node version, machine, and warm/measure counts so you can confirm comparability.
