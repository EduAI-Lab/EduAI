# Environment variables

Reference for every `.env.example` file in the monorepo: what it's for, which mechanism loads it, and what each variable does. See [#817](https://github.com/EduAI-Lab/EduAI/issues/817) for the cleanup this doc is part of.

## How env files get created

`npm install` at the repo root runs `scripts/setup-env.js` as a `postinstall` hook. On a clean clone it copies each `.env.example` below to its real `.env` (and `.env.test.example` to `.env.test` where that file exists — see [Test env files](#test-env-files)). If the `.env` already exists, it instead merges in any *new* keys added to `.env.example` since your last `npm install`, appending them under a `# Added by setup-env.js` marker — it never overwrites values you've already set.

None of this affects Docker: `docker-compose.dev.yml` only reads the root `.env` (DB port overrides), and `docker-compose.test.yml` hardcodes all CI test values directly in the compose file, independent of any `.env.example`. The files below are for local (non-Docker) `npm run dev` / test runs.

| File | Copied to | Read by |
|---|---|---|
| `.env.example` (root) | `.env` (root) | `docker-compose.dev.yml` (DB/Redis port overrides only) |
| `apps/core/.env.example` | `apps/core/.env` | Core app (React Router v7 + Vite), `apps/core/app/tests/test-database-url.ts` |
| `apps/core/.env.test.example` | `apps/core/.env.test` | Core integration tests only (`test-database-url.ts`) |
| `apps/extensions/ai-tutor/server/.env.example` | `apps/extensions/ai-tutor/server/.env` | AI Tutor server |
| `apps/extensions/ai-tutor/server/.env.test.example` | `apps/extensions/ai-tutor/server/.env.test` | AI Tutor server integration tests only (`tests/globalSetup.js`) |
| `apps/extensions/question-maker/.env.example` | `apps/extensions/question-maker/.env` | QM backend (`app/backend/src/config/settings.js`) **and** QM frontend (Vite `VITE_*` vars) |
| `apps/extensions/example-extension/.env.example` | `apps/extensions/example-extension/.env` | The minimal reference extension (see [Extension onboarding](EXTENSION_ONBOARDING.md)) |
| `apps/extensions/ai-tutor/.env.example` | *(not copied by `setup-env.js`)* | Docker Compose only — supplies `POSTGRES_PASSWORD` for AI Tutor's own compose file |
| `infra/cmps01/.env.example` | *(manual, on the GPU host)* | cmps01 edge proxy (`infra/cmps01/docker-compose.yml`) |
| `infra/s378/discord-dev-bot/.env.example` | `~/.config/eduai/discord-dev-bot.env` (manual) | The shared dev-server Discord bot |
| `infra/cron/cron.env.example` | `/etc/eduai/cron.env` (manual, production only) | Production cron scripts |
| `infra/cron/cron.env.local.example` | `infra/cron/cron.env.local` (manual, gitignored) | `infra/cron/dry-run-local.sh` only |
| `apps/core/loadtest/.env.loadtest.example` | `apps/core/.env.loadtest` (manual, gitignored) | Isolated #919 k6 harness (`npm run loadtest:*`) — never the shared study host |

`scripts/setup-env.js` also runs `prisma generate` for Core, the AI Tutor server, and the QM backend after the copy/merge step. Set `SKIP_PRISMA_GENERATE=1` to skip that (CI does, because each job generates the client it needs explicitly).

The AI Tutor **frontend** app (`apps/extensions/ai-tutor/`, distinct from its `server/` sibling) has no `.env` of its own — it does not inherit from `apps/core/.env` or `apps/extensions/ai-tutor/server/.env`. It reads `VITE_API_URL`, `VITE_CORE_URL`, `VITE_EDUAI_URL`, and `VITE_AI_TUTOR_URL` from `import.meta.env` (Vite build/dev-server time), each with a hardcoded `localhost` fallback in code (`app/lib/api.ts`, `app/lib/extension-urls.ts`), so no env file is required for local `npm run dev`. In CI, `docker-compose.test.yml` sets `AI_TUTOR_SERVER_URL` (consumed by the integration test runner, not by the app itself) and does not set any `VITE_*` var.

## Test env files

Core and the AI Tutor server load a **separate** `.env.test` on top of `.env` (via `dotenv` with `override: true`) when running integration tests outside Docker — see `apps/core/app/tests/test-database-url.ts` and `apps/extensions/ai-tutor/server/tests/globalSetup.js`.

Unlike `.env`, these two `.env.test` files are **committed to git** (not gitignored) since they only ever hold fixed, non-secret fixture values (e.g. `test-secret-not-for-production`) — so a clean clone already has them without any copy step. `scripts/setup-env.js` now also lists `.env.test.example` → `.env.test` in its merge pairs, purely as a safety net: if a tracked `.env.test` has fallen behind its `.example` (this happened — `apps/core/.env.test` was missing `EDUAI_API_KEY`, added to `.env.test.example` later and never backfilled), `npm install` now merges the missing key in automatically instead of a test silently running without it. It does not touch values you've already set, same as the `.env` merge behavior.

**Question Maker is different**: it has no `.env.test` file at all. Its integration suite reads `TEST_DATABASE_URL` straight out of the regular (gitignored) `.env` (`app/backend/tests/globalSetup.js`) — commented out by default in `.env.example` so DB-backed integration tests self-skip locally unless you opt in.

None of this matters for CI — `docker-compose.test.yml` sets every test var directly and never reads any `.env.test` file.

## Root `.env.example`

Purely `docker-compose.dev.yml` port overrides — optional, dev-only.

| Variable | Required | Purpose |
|---|---|---|
| `CORE_DB_PORT` | optional (default 54320) | Host port for the Core Postgres container |
| `TUTOR_DB_PORT` | optional (default 54321) | Host port for the AI Tutor Postgres container |
| `QM_DB_PORT` | optional (default 55432) | Host port for the Question Maker Postgres container |
| `CORE_REDIS_PORT` | optional (default 63790) | Host port for the Core Redis container (async AI-job queue) |

## `apps/core/.env.example`

| Variable | Required | Scope | Purpose |
|---|---|---|---|
| `NODE_ENV` | required | dev | `development` locally |
| `DATABASE_URL` | required | dev | Postgres connection string |
| `BETTER_AUTH_SECRET` | required | dev | Auth session signing secret — generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | required | dev | Base URL of the Core app |
| `REDIS_URL` | optional (default `redis://localhost:63790`) | dev/prod | Redis connection for the async AI-job queue (BullMQ) and shared chat/completion sliding-window limits |
| `QUEUE_ENQUEUE_ENABLED` | deprecated (ignored) | dev/prod | Pre-MVP fail-closed boundary: setting this to `true` does not enable queuing. `/api/chat` continues through direct chat. Re-enabling requires a reviewed code change after owner-scoped status/cancellation and server-side model authorization exist. |
| `QUEUE_MAX_DEPTH` | dormant pre-MVP | dev/prod | Retained for the future queue contract; has no effect on `/api/chat` while the queue is hard-disabled. |
| `AI_JOB_DEFAULT_MODEL` | dormant pre-MVP | dev/prod | Retained for future worker model authorization; no worker starts while the queue is hard-disabled. Since #1624 it is also the second step of `TOPIC_ANALYSIS_MODEL`'s fallback, so it does affect topic analysis even while the queue is off. |
| `TOPIC_ANALYSIS_MODEL` | optional (default `vllm:qwen2.5-32b-instruct`) | dev/prod | Model used by automatic topic provisioning (#1624), which runs in-process rather than on the dormant queue. Resolves `TOPIC_ANALYSIS_MODEL` → `AI_JOB_DEFAULT_MODEL` → the default. Only reached when Canvas modules and material headings both yield nothing, so most syncs never call a model at all. An `openai:`/`google:` prefix draws its key from `OPENAI_API_KEY`/`GOOGLE_GENERATIVE_AI_API_KEY` — the job has no user, so browser-supplied keys never apply. |
| `AI_JOB_CHAT_CONCURRENCY` / `AI_JOB_HEAVY_CONCURRENCY` | dormant pre-MVP | dev/prod | Retained for future BullMQ worker concurrency. |
| `AI_JOB_EXECUTION_TIMEOUT_MS` | dormant pre-MVP | dev/prod | Retained for the future async-job execution deadline. |
| `AI_JOB_ATTEMPTS` / `AI_JOB_RETRY_DELAY_MS` | dormant pre-MVP | dev/prod | Retained for future BullMQ retry policy. |
| `DEV_SERVER_HMR_HOST` / `DEV_SERVER_HMR_CLIENT_PORT` | optional | dev | Vite HMR through an HTTPS reverse proxy |
| `EMBEDDING_PROVIDER`, `EMBEDDING_DIMENSION`, `OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, `OLLAMA_EMBED_MANY_BATCH_SIZE` | optional | dev | RAG embeddings — local Ollama path (default) |
| `EMBEDDING_REQUEST_TIMEOUT_MS` | optional (default `30000`, range `100-120000`) | dev/prod | Hard per-attempt deadline for native Ollama `fetch` and cloud SDK `embed` / `embedMany` calls. Timeouts abort the provider request, retry within the fixed three-attempt cap using exponential jitter, then surface as `RAG_RETRIEVAL_TIMEOUT`. Invalid or sub-minimum values use the default; larger values are capped at 120 seconds. |
| `OPENROUTER_API_KEY`, `OPENROUTER_EMBEDDING_MODEL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY` | optional | dev/prod | RAG embeddings — cloud fallback path |
| `REINDEX_CONCURRENCY` | optional (default `4`, range `1-16`) | dev/prod | #945 — max materials `reEmbedCourseMaterials` (course re-embed background job) processes concurrently via `p-limit`. Non-positive, fractional, blank, and non-numeric values use the default; values above 16 are capped at 16. Keeps large re-embed runs from overwhelming the Postgres connection pool or the embedding provider's rate limit; bump cautiously alongside `OLLAMA_EMBED_MANY_BATCH_SIZE` / `EMBED_MANY_BATCH_SIZE` |
| `CRON_RUN_LEASE_MS` | optional (default `60000`, range `15000-600000`) | dev/prod | Lifetime of a Core cron execution lease. The child renews the lease every third of this interval and terminates if renewal fails. Invalid and sub-minimum values use the default; larger values are capped at 10 minutes. |
| `CRON_STANDALONE_LEASE_MS` | optional (default `600000`, positive integer milliseconds) | `/etc/eduai/cron.env` | Lifetime of a direct `infra/cron` script invocation that does not receive `CORE_CRON_RUN_ID`. The script creates and owns the lease but does not heartbeat it, so set this longer than the slowest direct run. Invalid values fail closed before work starts. If unset, `CRON_RUN_LEASE_MS` is accepted as a fallback. |
| `CRON_OUTPUT_MAX_BYTES` | optional (default `65536`, range `1024-1048576`) | dev/prod | Maximum combined stdout/stderr bytes retained for a spawned cron script. Core terminates and fails a child that exceeds the cap. Invalid and sub-minimum values use the default; larger values are capped at 1 MiB. |
| `CRON_SCRIPT_DIR` | optional (default repository `infra/cron`) | dev/prod | Directory that contains Core-triggered shell scripts. Production can set `/opt/eduai/cron`. |
| `VLLM_BASE_URL`, `VLLM_API_KEY` | optional | dev/prod | vLLM proxy on cmps01 |
| `ENERGY_SIDECAR_URL`, `RESEARCH_MEASURE_ENERGY` | optional | research scripts only | Hardware energy collection for controlled experiments; live `/api/chat` does not contact the sidecar |
| `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK`, `CHAT_MAX_CONTEXT_MESSAGES`, `CHAT_CONTEXT_FILL_RATIO`, `CHAT_SESSION_MAX_CHARS`, `CHAT_SESSION_RECENT_MESSAGES`, `CHAT_SESSION_DIGEST_MAX_CHARS` | optional | dev/prod | Chat context size tuning — code defaults shown in comments. `CHAT_CONTEXT_FILL_RATIO` (#1639) sets the token-budget trigger as a fraction of the model context window (per-model override: `AIModel.contextFillRatio`) |
| `CHAT_MAX_BODY_BYTES`, `CHAT_MAX_MESSAGES`, `CHAT_MAX_MESSAGE_CHARS`, `CHAT_MAX_TOTAL_MESSAGE_CHARS` | optional (defaults 2 MiB, 100, 32768, 131072) | dev/prod | Bounded `/api/chat` ingress; rejects oversized request bodies with 413 and message count/content overages with 422 before persistence or provider admission |
| `CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE` | optional | dev/prod | Chat latency tuning |
| `COMPLETION_FLEET_FALLBACK_MODELS` | optional (default `openai:gpt-4o-mini,google:gemini-2.5-flash`) | dev/prod | Ordered `provider:model` list `/api/completion` falls back to, in order, when the UBC vLLM fleet is unavailable (#1645). A candidate is used only if the caller supplied its BYOK key, its provider is enabled, **and** the `provider:model` exists as an **active `AIModel` catalog row** — the fallback picks the first candidate meeting all three and skips the rest; local providers (`vllm`/`ollama`) are ignored. With no qualifying candidate the outage stays `MODEL_UNAVAILABLE`. **Seeding required:** the fallback only functions if those provider models are seeded as active `AIModel` rows. A default deployment whose catalog lists only admin EduAI/vLLM models will silently no-op it — a keyed-but-uncatalogued candidate is logged as a `[completion] fleet fallback candidate unavailable in catalog` warn breadcrumb. |
| `ADHD_ASSIST_OVERSIGHT` | optional | dev/prod | Set `false`/`0`/`off` to disable the second-pass structural audit. When enabled (default), Dean reject→retry→forced wrap ships structure-compliant text (policy v2.1+: Teacher requires literal `**Top summary**` / `**Next?**`; UI TLDR/Continue remapping is client-only). |
| `EDUAI_API_KEY` | required for cross-service calls | dev/prod | Shared service key — **must match** AI Tutor server's and QM's `EDUAI_API_KEY` exactly |
| `SESSION_VALIDATE_RATE_LIMIT` | optional (default 300) | dev/prod | Per-original-client pre-auth and per-user/anonymous post-auth limits for the service-authenticated `POST /api/sessions/validate` extension endpoint |
| `SESSION_VALIDATE_PREAUTH_RATE_LIMIT` | optional (default 1200) | dev/prod | Coarse per-original-client-IP admission ceiling for `POST /api/sessions/validate`, enforced before Better Auth session lookup. Keep this above the post-auth per-user limit. |
| `CHAT_RATE_LIMIT`, `CHAT_RATE_LIMIT_WINDOW_MS` | optional (defaults `100` / `60000`) | dev/prod | Shared Redis sliding-window limit for `POST /api/chat` and `POST /api/completion`. Session/API-key callers are keyed by user; direct service-key callers use a stable shared service bucket. Denials return `429 {"error":"RATE_LIMITED","retryAfter":<seconds>}` plus `Retry-After`. `CHAT_RATE_WINDOW_MS` remains a legacy fallback only when the canonical window variable is unset. If Redis is unavailable, Core fails over quickly to a bounded per-process limiter; protection remains, but decisions are no longer shared across app instances until Redis recovers. |
| `ENCRYPTION_KEY` | required for Canvas | dev/prod | AES-256-GCM key for stored Canvas instructor credentials — same format as QM's `ENCRYPTION_KEY` (separate key, same purpose) |
| `VITE_QUESTION_MAKER_URL` | optional | dev | QM dashboard card link |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `INVITE_EXPIRY_HOURS` | optional | dev/prod | Invitation emails — unset `SMTP_HOST` logs the accept link instead of emailing |
| `BETTER_AUTH_DISABLE_RATE_LIMIT` | optional | loadtest / integration tests | Set `1` to turn off Better Auth's per-IP sign-in limiter. Core integration tests set this in `app/tests/setup.env.ts`. The #919 harness sets it in `.env.loadtest` so 500 loopback VUs are not measuring "how fast does the auth limiter trip." |
| `LOADTEST_BASE_URL` | optional (default `http://127.0.0.1:4100`) | loadtest | k6 target. Loopback only unless `LOADTEST_ALLOW_REMOTE=1`. Live hosts `dev.eduai.ok.ubc.ca` / `my.eduai.ok.ubc.ca` are always refused (trailing-dot FQDNs included). |
| `LOADTEST_ALLOW_REMOTE` | optional | loadtest | Set `1` to allow a non-loopback `LOADTEST_BASE_URL` for a **dedicated** load-test host. Does not unlock the live study/prod hosts. |
| `LOADTEST_VUS` | optional (default `500`) | loadtest | How many `loadtest.vu-NNN@eduai.local` accounts `seed-loadtest-users.ts` creates. |
| `EDUAI_LOCAL_SEED_PASSWORD` | required for `loadtest:setup` | loadtest | Explicit fixture password for `prisma/seed.ts` and the VU seeder. `loadtest:setup` generates it if empty and invokes seed with a local-demo contract; the app runtime in `.env.loadtest` stays `NODE_ENV=production`. k6 reads the same value via `loadtest/scripts/run-k6.sh`. |
| `LOADTEST_UNIQUE_USERS` | optional | loadtest | Set `0` to round-robin the five demo students instead of one account per VU. |
| `HOST` | optional (loadtest default `127.0.0.1`) | loadtest | Bind address for the mock LLM and `react-router-serve` during a harness run. |
| `ROUTING_LOCAL_VLLM_ONLY` | optional | loadtest / research | Set `1` so Auto routing stays on `vllm:*` models. The #919 harness also sets `VLLM_FLEET_CHAT_URLS` to the mock so chat does not wait on campus fleet hosts. |

### Core — additional variables read by the code

The table above covers what `apps/core/.env.example` ships. The groups below are read by `apps/core/app/**` but are not all present in the example file; every one is optional and falls back to the code default shown.

#### Local demo / fixture contract

| Variable | Default | Purpose |
|---|---|---|
| `EDUAI_DEPLOYMENT_MODE` | — | Must be `local` for auto-seeding and fixed demo users to run at all |
| `EDUAI_ENABLE_LOCAL_DEMO` | — | Must be `true` alongside the above |
| `EDUAI_LOCAL_SEED_PASSWORD` | — | Explicit fixture password; seeding refuses to run without it |
| `E2E_SEED_SECRET` | — | Shared secret gating `POST /api/e2e/seed` and `/api/e2e/promote` |

#### Chat behaviour

| Variable | Default | Purpose |
|---|---|---|
| `CHAT_TOOL_MAX_STEPS` | `12` (1–32) | Tool-loop `maxSteps` |
| `CHAT_TOOL_MAX_OUTPUT_TOKENS` | `8192` (min 1024) | Env cap for tool-path `maxTokens`, further clamped to `AIModel.maxTokens` |
| `CHAT_SYSTEM_PROMPT_MAX_CHARS` | `8192` (256–32768) | Cap on a user-supplied custom system prompt before sanitization/persistence |
| `CHAT_LONG_OUTPUT_MAX_TOKENS` / `CHAT_LONG_OUTPUT_ADHD_MAX_TOKENS` | `1200` / `600` | Caps applied only to detected long-output requests; never raise a model/provider cap |
| `CHAT_RAG_INJECT_STRONG_SIM` | `0.8` (or `ROUTING_RAG_STRONG_SIM`) | Inject RAG excerpts when top-1 similarity clears this bar even if intent says no |
| `CHAT_RAG_INJECT_MODERATE_SIM` | `0.55` (or `ROUTING_RAG_TIER1_SIM`) | Inject when at least one chunk clears the moderate bar |
| `CHAT_API_DEBUG` / `CHAT_API_TRACE` / `CHAT_DEBUG_LOG` | off | Verbose `/api/chat` breadcrumbs (`=1`); never dumps full RAG text |
| `COMPLETION_RATE_LIMIT` / `COMPLETION_SERVICE_RATE_LIMIT` / `COMPLETION_RATE_WINDOW_MS` | `30` / `120` / `60000` | `/api/completion` limits; authenticated users get their own bucket, service-key-only callers share one |
| `RATE_LIMIT_MAX_KEYS` | `50000` | Bound on the in-process rate-limit fallback store |

#### Retrieval / RAG

| Variable | Default | Purpose |
|---|---|---|
| `RAG_SIMILARITY_THRESHOLD` | `0.5` | Vector cosine floor; per-course `ragSimilarityThreshold` overrides it |
| `RAG_HYBRID_BM25` | off | `1` enables the BM25 + vector hybrid retrieval path |
| `RAG_HYBRID_BM25_ALPHA` | `0.7` | Vector weight in the hybrid score (BM25 weight = 1−α) |
| `RAG_IVFFLAT_PROBES` | `10` (1–100) | `ivfflat.probes` per retrieval query |
| `QUERY_EMBED_CACHE_TTL_MS` / `QUERY_EMBED_CACHE_MAX` | `90000` (min 5000) / `300` (min 50) | In-memory query-embedding cache |
| `COURSE_RAG_SETTINGS_CACHE_TTL_MS` | `3600000` (min 5000) | Per-course RAG settings cache |
| `DISCIPLINE_CACHE_TTL_MS` | `3600000` (min 5000) | Discipline-code cache |
| `EMBED_MANY_BATCH_SIZE` | `64` (8–100) | Cloud ingestion batch size |
| `OLLAMA_EMBED_CHUNK_SIZE` / `OLLAMA_EMBED_CHUNK_OVERLAP` | `480` (min 128) / `48` | Chunk sizing on the local embedding path |
| `MATERIAL_EMBEDDING_INSERT_BATCH_SIZE` | `500` | Max rows per `material_embeddings` insert |
| `RE_EMBED_JOB_LEASE_MS` | `120000` (min 15000) | Lease lifetime for the background re-embed job |
| `PDF_EXTRACTION_MAX_CONCURRENT` / `PDF_EXTRACTION_MAX_QUEUED` / `PDF_EXTRACTION_MAX_RSS_MB` | `4` / `16` / host-derived | Per-process PDF extraction concurrency, queue depth, and RSS ceiling |
| `FIRECRAWL_API_KEY` | — | Enables the `webSearch` / `fetchPage` chat tools; unset disables them |

#### Auto routing, fleet, and overflow

| Variable | Default | Purpose |
|---|---|---|
| `ROUTER_MODE` | `rules` | Global default Auto mode: `rules` \| `knn` \| `hybrid` \| `llm` |
| `ROUTING_DEFAULT_TIER` | `1` | Starting tier before escalation rules fire |
| `ROUTING_RAG_STRONG_SIM` / `ROUTING_RAG_TIER1_SIM` | `0.8` / `0.55` | Similarity bars used by the rule stack (and reused as chat inject defaults) |
| `ROUTING_KNN_K` / `ROUTING_KNN_MIN_SIM` | `5` (1–25) / `0.55` (0–1) | kNN tier vote |
| `ROUTING_KNN_EXEMPLARS_PATH` | `./data/routing-knn-exemplars.json` | Seed exemplars for the kNN router |
| `ROUTING_LLM_CLASSIFIER_MODEL` / `ROUTING_LLM_MIN_CONFIDENCE` / `ROUTING_LLM_CLASSIFIER_TIMEOUT_MS` | — / `60` / `30000` | LLM classifier (`model=auto-llm`) |
| `ROUTING_CARBON_MODE` / `ROUTING_CARBON_MODE_BY_COURSE` | `balanced` / — | Greener-vs-quality tie-break on the tier pool; JSON map for per-course overrides |
| `ROUTING_LOCAL_VLLM_ONLY` | off | `1` keeps Auto routing on `vllm:*` models only |
| `FLEET_CONFIG_PATH` | `./fleet.config.json` | Preferred multi-host fleet registry (gitignored, host-specific) |
| `VLLM_FLEET_CHAT_URLS` / `VLLM_FLEET_HEAVY_URL` / `VLLM_FLEET_DEFAULT_MODELS` | — | Legacy fallback used only when no `fleet.config.json` is found |
| `VLLM_TRUSTED_BASE_URLS` | — | SSRF allowlist for every vLLM base URL (chat **and** embeddings) |
| `FLEET_HEALTH_CACHE_TTL_MS` / `FLEET_HEALTH_TIMEOUT_MS` / `FLEET_FAILURE_EJECTION_MS` | `30000` / `5000` / `30000` | Fleet health probing and failure ejection |
| `FLEET_STREAM_PROBE_MS` | `10000` | Soft deadline waiting for the first stream chunk before retrying another host |
| `AI_MAX_INFLIGHT` / `AI_ADMISSION_WAIT_MS` | `8` / `15000` | Process-local FIFO admission gate for local-GPU inference (`0` disables) |
| `AWS_BEARER_TOKEN_BEDROCK` / `BEDROCK_REGION` / `BEDROCK_MODEL_ID` | — / `us-east-1` / `meta.llama3-70b-instruct-v1:0` | Bedrock **overflow** target — server env only, never client-selectable |
| `BEDROCK_RATE_LIMIT` / `BEDROCK_RATE_WINDOW_MS` | `20` / `60000` | Aggregate AWS cost cap (global, not per user) |
| `VLLM_CHAT_TOOLS` | off | `1` honours the DB `supportsTools` flag for vLLM models instead of forcing hybrid RAG |
| `VLLM_DISABLE_THINKING` | on | `0` preserves `<think>` output from Qwen3.5 |
| `VLLM_DEGRADED_WAITING` / `VLLM_DEGRADED_CACHE_PCT` | `4` / `0.9` | Thresholds for the header "degraded" model-status chip |
| `CMPS01_INTERNAL_KEY` / `CMPS01_INTERNAL_BASE_URL` | — | Shared secret and allowlisted origin for the nginx edge in front of cmps01. The key is attached only to deployment-owned URLs, never client-supplied ones |

#### Guardrails, Assist, and Canvas

| Variable | Default | Purpose |
|---|---|---|
| `COURSE_SCOPE_GUARDRAIL_ENABLED` | `false` | Server kill switch for the Layer B course-scope classifier — **ANDed** with each course's own `courseScopeGuardrailEnabled` column, so Layer B runs only when both are on. Layer A (system-prompt policy) is always on |
| `COURSE_SCOPE_CLASSIFIER_MODEL` / `COURSE_SCOPE_MIN_CONFIDENCE` / `COURSE_SCOPE_CLASSIFIER_TIMEOUT_MS` | — / `75` / `2000` | Layer B classifier; fails open on timeout |
| `ADHD_ASSIST_AUTO_MODEL` | `vllm:qwen2.5-32b-instruct` | Model Assist Auto is pinned to |
| `ADHD_ASSIST_OVERSIGHT_DETERMINISTIC_ONLY` | off | `true`/`1`/`on` restricts oversight to the deterministic pass (no model rewrite) |
| `CANVAS_SYNC_RATE_LIMIT` / `CANVAS_SYNC_RATE_WINDOW_MS` | `1` / `30000` | Per-user Canvas course/material sync limiter |
| `CANVAS_LINK_ROSTER_RATE_LIMIT` / `CANVAS_LINK_ROSTER_RATE_WINDOW_MS` | `10` / `900000` | Per-user Canvas roster-link limiter |

#### Cross-service and misc

| Variable | Default | Purpose |
|---|---|---|
| `QM_BACKEND_URL` / `AI_TUTOR_SERVER_URL` | — | Extension base URLs Core calls outward to for best-effort cascade-delete on course deletion. Unset ⇒ the call is skipped and the extension's nightly reconcile self-heals |
| `COOKIE_DOMAIN` | — | Cross-subdomain auth cookie domain (e.g. `.eduai.ok.ubc.ca`). Loopback values are ignored so `crossSubDomainCookies` stays off locally |
| `LOG_LEVEL` | `info` | Server log verbosity |
| `TOPIC_ANALYSIS_MODEL` | `vllm:qwen2.5-32b-instruct` | See the main table — resolves `TOPIC_ANALYSIS_MODEL` → `AI_JOB_DEFAULT_MODEL` → the default |
| `VITE_AI_TUTOR_URL` / `VITE_QUESTION_MAKER_URL` / `VITE_EXTRA_EXTENSIONS` | — | Sidebar app-switcher entries. An extension appears **only** when its URL var is set; `VITE_EXTRA_EXTENSIONS` is a JSON array of `{id,name,url,description?,color?}`. Baked in at build time |

### Future queue settings

`QUEUE_MAX_DEPTH` and the `AI_JOB_*` variables describe the dormant future contract only. They must not be operated or tuned before the queue's security contract is completed and the compile-time disable is deliberately removed.

## `apps/core/.env.test.example`

Loaded on top of `.env` for local integration tests only (ignored in Docker CI).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Points at the `eduai_test` database instead of the dev DB |
| `BETTER_AUTH_SECRET` | Fixed test value, not a real secret |
| `BETTER_AUTH_URL` | Test server URL |
| `COOKIE_DOMAIN` | `localhost` — Core treats loopback values as unset, so `crossSubDomainCookies` stays off locally (#1517) |
| `PORT` | Test server port (4001) |
| `EDUAI_API_KEY` | Fixed test value, not a real secret |

## `apps/extensions/ai-tutor/server/.env.example`

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string |
| `NODE_ENV` | required | Runtime mode. The local template actively sets `development`, which `setup-env.js` copies or merges; production deployments must set `production` explicitly. |
| `PORT` | optional (default 4000) | Server port |
| `CORE_URL` | required | Core base URL — session validation and login redirect |
| `CORE_AUTH_TIMEOUT_MS` | optional (default 5000) | Finite deadline for Core session-validation and logout requests; invalid or non-positive values fall back to 5000 ms |
| `EDUAI_API_KEY` | required | Must match Core's `EDUAI_API_KEY` exactly (Core does not read admin-UI overrides) |
| `EDUAI_BASE_URL` | required | Core API base for course import/sync |
| `EDUAI_MODEL` | required | LLM model id, e.g. `google:gemini-2.5-flash` |
| `CORS_ORIGINS` | optional (`http://localhost:3001` only when `NODE_ENV` is explicitly `development` or `test`; otherwise empty/fail-closed) | Comma-separated canonical browser origins with no wildcards, paths, queries, fragments, or credentials (e.g. `http://localhost:3001,https://dev.aitutor.eduai.ok.ubc.ca`). Deployments must configure every trusted frontend origin. |
| `POLICY_CACHE_TTL_MS` | optional (default 30000) | TTL for cached Core RBAC policy flags |
| `EDUAI_CALL_TIMEOUT_MS` | optional (default 45000) | Timeout for a single EduAI chat completion round-trip in `callEduAI()` |

Additional variables read by `server/src/**` but not all present in the example file:

| Variable | Default | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | — | AES-256-GCM key protecting the admin `EDUAI_API_KEY` override stored in `SystemSetting`. **Required in production** — without it the admin key-write endpoint fails closed (`503`) rather than persisting the secret in plaintext. Existing plaintext rows keep working, so enabling it later needs no migration |
| `EDUAI_ENFORCE_URL_CONSISTENCY` | off | `1` makes a `CORE_URL` / `EDUAI_BASE_URL` origin mismatch fail startup instead of only warning (`services/urlConsistency.js`, #225 SEAM-05) |
| `AI_KEY_VALIDATION_TIMEOUT_MS` | `5000` (45000 for OpenCode's authenticated probe) | Deadline for provider API-key validation calls |
| `AI_KEY_VALIDATION_MAX_TRACKED_USERS` | `10000` | Hard cap on per-process validation-limiter identities |
| `CORE_MIRROR_THROTTLE_MS` | — | Minimum interval between Core mirror refreshes |
| `CORE_PUBLIC_ORIGIN` | — | Public origin used when building browser-facing Core links behind a proxy |

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `COOKIE_DOMAIN`, and `AI_SUPERVISOR_ENABLED` were removed per #817 — none are read anywhere in `server/src`. This server has no local Better Auth instance; it proxies session validation to Core (`CORE_URL`) via `middleware/auth.js`. The two-agent supervisor loop is now controlled by the admin-configured `AI_MODEL_POLICY` row, not an env var.

## `apps/extensions/ai-tutor/server/.env.test.example`

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Points at `aitutor_test` |
| `PORT` | Same test-fixture value as Core's `.env.test.example` |
| `EDUAI_API_KEY` | Fixed test value, not a real secret |
| `EDUAI_BASE_URL` | Test-time Core API base |

## `apps/extensions/question-maker/.env.example`

Copied to `apps/extensions/question-maker/.env`, read by both the backend (`app/backend/src/config/settings.js`) and the Vite frontend (`VITE_*` vars).

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | required | `development` |
| `PORT` | optional (default 8000) | Backend port |
| `DATABASE_URL` | required | Postgres connection string (use `postgres:5432` host instead of `localhost:55432` inside Docker Compose) |
| `CORE_URL` | required | Core auth server — used by session validation middleware |
| `CORE_AUTH_TIMEOUT_MS` | optional (default 5000) | Finite deadline for Core session-validation and logout requests; invalid or non-positive values fall back to 5000 ms |
| `EXTENSION_URL` | required | This extension's public URL — builds the post-login `?redirect=` param |
| `CORS_ORIGINS` | required | Comma-separated allowed browser origins, no spaces |
| `ENCRYPTION_KEY` | required in production | 64-char hex (32 bytes); same format/purpose as Core's `ENCRYPTION_KEY`, separate key |
| `LOG_LEVEL` | optional (default info) | Log verbosity |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | optional | Rate limiting |
| `EDUAI_API_URL` | required | EduAI course/topic sync base URL |
| `EDUAI_API_KEY` | required | Must match Core's `EDUAI_API_KEY` |
| `EDUAI_IGNORED_COURSE_CODES` | optional | Comma-separated course codes hidden from the picker |
| `GROQ_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` | optional | Direct LLM keys for question generation |
| `DEFAULT_NUM_QUESTIONS`, `MAX_QUESTIONS` | optional | Generation tuning, code defaults exist |
| `BUG_REPORT_ADMIN_EMAILS` | optional | Extra admins for the bug-report triage UI |
| `VITE_API_URL`, `VITE_CORE_URL`, `VITE_AI_TUTOR_URL` | required (frontend) | Vite-time base URLs, loaded from repo root |
| `TEST_DATABASE_URL` | optional, commented out | See [Test env files](#test-env-files) — set to opt in to DB-backed integration tests locally |
| `POSTGRES_PASSWORD_PRODUCTION` | production only | `docker-compose.yml` production Postgres password |
| `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN` / `PERSONAL_ACCESS_TOKEN` | production deploy only | One of these for `git pull` on the deploy server — never commit a real value |

Additional variables read by `app/backend/src/**` (all optional; defaults live in `src/config/settings.js` and the modules that read them):

| Variable | Default | Purpose |
|---|---|---|
| `COURSE_ACCESS_SYNC_TTL_MS` | `60000` | How long a caller's synced Core enrollment access (and the ADMIN full catalog) is reused before `GET /api/course` refreshes it from Core |
| `USER_ROW_CACHE_TTL_MS` / `USER_ROW_CACHE_MAX` | `900000` / `5000` | Memoizes the FK-integrity `users` upsert on side-effect-free reads. `0` disables it for reads; mutating requests always upsert |
| `CORE_MIRROR_THROTTLE_MS` | — | Minimum interval between Core mirror refreshes |
| `CORE_PUBLIC_ORIGIN` | — | Public Core origin used when building browser-facing links behind a proxy |
| `QM_MAX_EXTRACT_TEXT_CHARS` / `QM_MAX_EXTRACT_CHUNKS` / `QM_MAX_EXTRACT_PROVIDER_CALLS` / `QM_EXTRACT_DEADLINE_MS` | `120000` / `24` / `36` / `120000` | OCR-extraction budgets |
| `QM_AI_PROVIDER_TIMEOUT_MS` / `QM_AI_OPERATION_DEADLINE_MS` / `QM_AI_PROVIDER_CALL_LIMIT` | `30000` / — / — | Per-call and per-operation AI deadlines and call ceilings |
| `QM_AI_RATE_LIMIT_WINDOW_MS` / `QM_AI_RATE_LIMIT_MAX` | `900000` / `60` | Caller-keyed AI quota |
| `QM_GENERATE_PROMPT_MAX_CHARS` | `12000` | Cap on the legacy `/generate` prompt |
| `QM_CHAT_MAX_MESSAGES` / `QM_CHAT_MAX_MESSAGE_CHARS` / `QM_CHAT_MAX_AGGREGATE_CHARS` | — | Bounded chat ingress on QM's AI endpoints |
| `QM_BANK_MAX_QUESTION_IDS` / `QM_BANK_MAX_VARIANTS_PER_QUESTION` / `QM_BANK_MAX_PROVIDER_CALLS` | — | Bank-level generation budgets |
| `QM_REVIEW_MAX_PAIRS` / `QM_REVIEW_MAX_PROVIDER_CALLS` | — | Variant-review budgets |
| `QM_TEST_API_KEY_MAX_BODY_BYTES` / `QM_TEST_API_KEY_MAX_PROVIDER_KEY_CHARS` | — | Bounds on the provider key-test endpoint |
| `CANVAS_MAX_PAGES` / `CANVAS_MAX_ITEMS` / `CANVAS_PAGINATION_MAX_PAGES` / `CANVAS_PAGINATION_MAX_ITEMS` / `CANVAS_PAGINATION_DEADLINE_MS` | — | Canvas pagination ceilings |
| `CANVAS_REQUEST_TIMEOUT_MS` / `CANVAS_PER_REQUEST_TIMEOUT_MS` / `CANVAS_OPERATION_TIMEOUT_MS` | — | Canvas per-request and whole-operation deadlines |
| `CANVAS_MAX_REQUEST_BODY_BYTES` / `CANVAS_MAX_RESPONSE_BYTES` / `CANVAS_MAX_WIRE_BYTES` / `CANVAS_MAX_COMPRESSED_RESPONSE_BYTES` / `CANVAS_MAX_DECOMPRESSED_RESPONSE_BYTES` | — | Canvas payload-size guards (including a decompression-bomb ceiling) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | Optional direct Gemini key for question generation, alongside `GROQ_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` |
| `VITE_CANVAS_DEFAULT_URL` | — | Optional HTTPS Canvas host prefilled in development/test mode |

## `infra/cron/cron.env.example` (production)

Copied by hand to `/etc/eduai/cron.env` on the production server (`chmod 600`, `chown root:root`).

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT_CORE`, `DB_PORT_TUTOR`, `DB_PORT_QM`, `DB_USER`, `DB_PASS` | Database connections for cron scripts |
| `BACKUP_DIR`, `BACKUP_RETAIN_DAYS` | Local backup destination and retention window |
| `OFFSITE_BUCKET` | S3 (or `sftp://`) off-site backup target |
| `AUDIT_LOG` | Data-lifecycle audit log path |
| `ALERT_EMAIL` | Notification recipient |

## `infra/cron/cron.env.local.example` (local dry-run)

Copied by hand to `infra/cron/cron.env.local` (gitignored), read only by `infra/cron/dry-run-local.sh` — never by production scripts.

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT_CORE`, `DB_PORT_TUTOR`, `DB_PORT_QM`, `DB_USER` | Match `docker-compose.dev.yml` defaults |
| `DB_PASS` | Core/AI Tutor Postgres password (`postgres`) |
| `DB_PASS_QM` | Question Maker's dev Postgres password (`password` — differs from Core/Tutor, see `docker-compose.dev.yml`) |
| `BACKUP_DIR`, `LOCAL_OFFSITE_DIR`, `AUDIT_LOG` | Local, gitignored paths under the repo |
| `OFFSITE_BUCKET` | Unused in dry-run (kept for parity with production config) |
| `ALERT_EMAIL` | Dry-run alerts are logged locally only |

## Canvas credentials — not in any `.env.example`

Real Canvas instructor credentials are **stored in the database, AES-256-GCM encrypted** (keyed by `ENCRYPTION_KEY` above) — see `docs/CANVAS.md` and `apps/core/app/lib/canvas/encryption.ts`. They are not env vars.

Core and Question Maker use **separate** `ENCRYPTION_KEY` values. The one-time QM→Core credential copy (`npm run db:migrate:canvas-to-core -w question-maker-backend`) decrypts under QM's key and re-encrypts under Core's before inserting into Core — see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).

The only genuine Canvas *environment* variables in the repo are dev-only, read by `apps/core/scripts/seed_local_canvas.sh` for seeding a local Canvas instance and not loaded by the app itself:

| Variable | Purpose |
|---|---|
| `CANVAS_URL` | Local Canvas base URL (default `http://localhost:8080`) |
| `CANVAS_ADMIN_TOKEN` | Canvas admin API token used by the seed script |
| `CANVAS_SEED_PASSWORD` | Password assigned to seeded Canvas users (default `password123`) |

Export these in your shell before running the script; they don't belong in any `.env` file.

## Relationship to #172 (removing `legacy-peer-deps`)

None. `.npmrc` (`legacy-peer-deps`) and the `postinstall` → `scripts/setup-env.js` hook were both introduced together in PR #133, but they don't interact — one governs npm's dependency resolution, the other copies env files. #172 does not change anything documented here.
