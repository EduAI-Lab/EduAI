# Performance & Code-Quality Baselines

Snapshots of API response times, per-page browser vitals, and code-quality metrics, captured
**before** the #940–#949 / #921 fixes so those fixes can be measured as a concrete
before/after delta.

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
  backend/foreign-key-indexes.md
                               which Core FKs are indexed, which are deliberately not, and why (#1369)
  backend/baseline/            the pinned BEFORE snapshot — API + code quality (issue #961)
    endpoints.md               inventory: app / method / path / auth / handler
    response-times.json        p50/p95/p99 + payload bytes + status per route (machine-readable)
    SUMMARY.md                 headline numbers + full environment fingerprint
    duplication/               jscpd report (json + html)
    dead-code/                 knip + ts-prune output
    dep-graph/                 madge circular-dep + module graph (json + svg)
  frontend/baseline/           the pinned BEFORE snapshot — per-page browser vitals
    page-vitals.json           TTFB/FCP/LCP/DCL/load/CLS/blocking + JS totals per page
    errors.json                pages that produced no trustworthy number, and why
```

Both `baseline/` folders are pinned BEFORE runs. Don't edit them in place after the fixes
land — capture the AFTER run into a sibling folder (e.g. `after-<date>/`) and compare.

`backend/` measures the server (response times per endpoint, plus the static code-quality
reports); `frontend/` measures what a real browser experiences per page. They are separate
because a fast API can still render slowly, and the fix lists don't overlap.

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

Covers **100% of the in-scope DB API surface** (~157 endpoints — every read + every
create/update/delete that touches only our own databases). External/AI/Canvas endpoints are out of
scope (see the per-app `*-measurement-spec.md` SKIP lists).

1. Bring up the stack (local): `npm run docker:dev:db && npm run dev` (Core :3000, AI-Tutor :4000, QM :8000).
2. **Seed all three DBs + the mutation pools (one command):**
   ```bash
   npm run db:seed:perf     # = dbseed + core volume + per-app perf pools + writes .perf-pool/*.json
   ```
   This is idempotent — run it once before a perf run, and **again between runs** to refill the
   delete pools that a run consumes (the script preflights the manifests and warns if a pool is low).
   For semantically-real RAG volume also run `cd apps/core && npx tsx scripts/seed-rag-ingestion-fixtures.ts`.
3. Configure targets (env): `CORE_URL`, `AITUTOR_URL`, `QM_URL` — point at local or UBC dev.
4. Run:
   ```bash
   npm run perf:endpoints -- --out=docs/perf/backend/baseline   # or --out=docs/perf/backend/after-<date>
   ```
   (Output dir is the `--out` flag; note the npm `--` that forwards it. Errors land in
   `<out>/errors.log` + `<out>/errors.json`.)
   The script mints real better-auth sessions per role + a pooled "perf actor" (`POST {CORE_URL}/api/auth/sign-in/email`,
   seed password `EduAI2026!`), reuses each cookie across all three apps (all validate against Core),
   reads the `.perf-pool/*.json` manifests for pooled ids, warms up, then measures reads (hammered)
   and mutations (create/update/delete). A client-side governor paces cookie-validate traffic under
   Core's IP rate limit. Tune with `PERF_SAMPLES`, `PERF_MUT_SAMPLES`, `PERF_VALIDATE_LIMIT`.

### Page vitals (needs the full stack running + seeded)

Covers **every UI route** in all three apps (~52 pages), each loaded in a real headless
Chromium under the lowest seeded role that can render it. Dynamic segments
(`:courseId`, `:moduleId`, …) are resolved at runtime from each app's own API.

```bash
cd scripts/page-profile && npm install && npx playwright install chromium && cd ../..
CORE_URL=... AI_TUTOR_URL=... AI_TUTOR_API_URL=... QM_URL=... QM_API_URL=... \
  npm run perf:pages -- --runs=3 --target=dev-remote
```

Defaults to `docs/perf/frontend/baseline`. Run it from a workstation rather than on the
server — measuring over the loopback interface drops the RTT the numbers are meant to
include. A page that redirects anywhere other than the route asked for, fails to load, or
whose ids can't be resolved is reported in `errors.json` instead of contributing a
misleading number, and the run exits non-zero so a partial sweep can't be mistaken for
full coverage. Both runs also write a human-readable `errors.log` beside it, which stays
local — the repo's blanket `*.log` ignore keeps it out of the pinned snapshot.

A handful of routes are unreachable in the seeded dev state — `unitAdmins.canInvite`
defaults to off, every seeded student is already onboarded, and every seeded role is one
AI Tutor supports. Those carry a `gated` reason in `pages.mjs` and are reported as
**expected skips**: listed for the record, excluded from the measured count, and not a
run failure. Arrange the missing flag or seed state and pass `--include-gated` to profile
them.

> On a Vite **dev** server the JS byte counts and request counts reflect unbundled ESM
> modules, not a production build — treat those two columns as relative only. TTFB, the
> LCP-after-FCP gap, CLS and blocking time are meaningful either way.

Per-page JS **totals** (`jsCount`, `jsTransferBytes`, `jsDecodedBytes`, `totalTransferBytes`)
are committed in full, but the per-chunk list is truncated to the 5 heaviest by transfer
size, with `chunkCount` kept alongside. Unbundled ESM means a full sweep otherwise carries
~12k chunk rows — 100k lines of JSON nobody reads, when it's rank 1 (a 3.8MB
`@tabler/icons-react` barrel, say) that names the fix. Pass `--full-chunks` for the
untruncated lists; they go to a separate `page-chunks.json`, which is git-ignored.

## Compare a later run

Both `response-times.json` files share a stable schema keyed by `app+method+path`. To compute
a delta:

```bash
node scripts/perf-compare.mjs docs/perf/backend/baseline/response-times.json \
                              docs/perf/backend/after-<date>/response-times.json
```

Compare like-for-like only: **same target environment + same seed**. The `env` block in each
`SUMMARY.md` / `response-times.json` records git SHA, target URLs, DB name, seed scripts run,
node version, machine, and warm/measure counts so you can confirm comparability.
