# Environment variables

Reference for every `.env.example` file in the monorepo: what it's for, which mechanism
loads it, and what each variable does. See [#817](https://github.com/EduAI-Lab/EduAI/issues/817)
for the cleanup this doc is part of.

## How env files get created

`npm install` at the repo root runs `scripts/setup-env.js` as a `postinstall` hook. On a
clean clone it copies each `.env.example` below to its real `.env` (and `.env.test.example`
to `.env.test` where that file exists — see [Test env files](#test-env-files)). If the `.env`
already exists, it instead merges in any *new* keys added to `.env.example` since your last
`npm install`, appending them under a `# Added by setup-env.js` marker — it never overwrites
values you've already set.

None of this affects Docker: `docker-compose.dev.yml` only reads the root `.env` (DB port
overrides), and `docker-compose.test.yml` hardcodes all CI test values directly in the
compose file, independent of any `.env.example`. The files below are for local (non-Docker)
`npm run dev` / test runs.

| File | Copied to | Read by |
|---|---|---|
| `.env.example` (root) | `.env` (root) | `docker-compose.dev.yml` (DB port overrides only) |
| `apps/core/.env.example` | `apps/core/.env` | Core app (Remix/Vite), `apps/core/app/tests/test-database-url.ts` |
| `apps/core/.env.test.example` | `apps/core/.env.test` | Core integration tests only (`test-database-url.ts`) |
| `apps/extensions/ai-tutor/server/.env.example` | `apps/extensions/ai-tutor/server/.env` | AI Tutor server |
| `apps/extensions/ai-tutor/server/.env.test.example` | `apps/extensions/ai-tutor/server/.env.test` | AI Tutor server integration tests only (`tests/globalSetup.js`) |
| `apps/extensions/question-maker/.env.example` | `apps/extensions/question-maker/.env` | QM backend (`app/backend/src/config/settings.js`) **and** QM frontend (Vite `VITE_*` vars) |
| `infra/cron/cron.env.example` | `/etc/eduai/cron.env` (manual, production only) | Production cron scripts |
| `infra/cron/cron.env.local.example` | `infra/cron/cron.env.local` (manual, gitignored) | `infra/cron/dry-run-local.sh` only |

The AI Tutor **frontend** app (`apps/extensions/ai-tutor/`, distinct from its `server/`
sibling) has no `.env` of its own — it does not inherit from `apps/core/.env` or
`apps/extensions/ai-tutor/server/.env`. It reads `VITE_API_URL`, `VITE_CORE_URL`,
`VITE_EDUAI_URL`, and `VITE_AI_TUTOR_URL` from `import.meta.env` (Vite build/dev-server
time), each with a hardcoded `localhost` fallback in code (`app/lib/api.ts`,
`app/lib/extension-urls.ts`), so no env file is required for local `npm run dev`. In CI,
`docker-compose.test.yml` sets `AI_TUTOR_SERVER_URL` (consumed by the integration test
runner, not by the app itself) and does not set any `VITE_*` var.

## Test env files

Core and the AI Tutor server load a **separate** `.env.test` on top of `.env` (via `dotenv`
with `override: true`) when running integration tests outside Docker — see
`apps/core/app/tests/test-database-url.ts` and
`apps/extensions/ai-tutor/server/tests/globalSetup.js`.

Unlike `.env`, these two `.env.test` files are **committed to git** (not gitignored) since
they only ever hold fixed, non-secret fixture values (e.g. `test-secret-not-for-production`)
— so a clean clone already has them without any copy step. `scripts/setup-env.js` now also
lists `.env.test.example` → `.env.test` in its merge pairs, purely as a safety net: if a
tracked `.env.test` has fallen behind its `.example` (this happened — `apps/core/.env.test`
was missing `EDUAI_API_KEY`, added to `.env.test.example` later and never backfilled),
`npm install` now merges the missing key in automatically instead of a test silently running
without it. It does not touch values you've already set, same as the `.env` merge behavior.

**Question Maker is different**: it has no `.env.test` file at all. Its integration suite
reads `TEST_DATABASE_URL` straight out of the regular (gitignored) `.env`
(`app/backend/tests/globalSetup.js`) — commented out by default in `.env.example` so
DB-backed integration tests self-skip locally unless you opt in.

None of this matters for CI — `docker-compose.test.yml` sets every test var directly and
never reads any `.env.test` file.

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
| `REDIS_URL` | optional (default `redis://localhost:63790`) | dev/prod | Redis connection for the async AI-job queue (BullMQ) |
| `QUEUE_ENQUEUE_ENABLED` | optional (default `false`) | dev/prod | Guarded #914 producer flag. When `true`, opted-in `/api/chat` requests (`enqueue: true`) enqueue an AI job instead of streaming. Keep off until the dispatch worker (#168) can drain the queue |
| `QUEUE_MAX_DEPTH` | optional (default off) | dev/prod | Backpressure cap (#915): max PENDING jobs per queue before `enqueue()` rejects with 429 + `Retry-After`. Plain positive integer only — unset, `0`, or a non-integer value (e.g. `1e3`) disables the cap. See [Operating `QUEUE_MAX_DEPTH`](#operating-queue_max_depth) before enabling it |
| `DEV_SERVER_HMR_HOST` / `DEV_SERVER_HMR_CLIENT_PORT` | optional | dev | Vite HMR through an HTTPS reverse proxy |
| `EMBEDDING_PROVIDER`, `EMBEDDING_DIMENSION`, `OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, `OLLAMA_EMBED_MANY_BATCH_SIZE` | optional | dev | RAG embeddings — local Ollama path (default) |
| `OPENROUTER_API_KEY`, `OPENROUTER_EMBEDDING_MODEL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY` | optional | dev/prod | RAG embeddings — cloud fallback path |
| `REINDEX_CONCURRENCY` | optional (default `4`) | dev/prod | #945 — max materials `reEmbedCourseMaterials` (course re-embed background job) processes concurrently via `p-limit`. Keeps large re-embed runs from overwhelming the Postgres connection pool or the embedding provider's rate limit; bump cautiously alongside `OLLAMA_EMBED_MANY_BATCH_SIZE` / `EMBED_MANY_BATCH_SIZE` |
| `VLLM_BASE_URL`, `VLLM_API_KEY` | optional | dev/prod | vLLM proxy on cmps01 |
| `ENERGY_SIDECAR_URL`, `RESEARCH_MEASURE_ENERGY` | optional | research scripts only | Hardware energy collection for controlled experiments; live `/api/chat` does not contact the sidecar |
| `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK`, `CHAT_MAX_CONTEXT_MESSAGES`, `CHAT_SESSION_MAX_CHARS`, `CHAT_SESSION_RECENT_MESSAGES`, `CHAT_SESSION_DIGEST_MAX_CHARS` | optional | dev/prod | Chat context size tuning — code defaults shown in comments |
| `CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE` | optional | dev/prod | Chat latency tuning |
| `ADHD_ASSIST_OVERSIGHT` | optional | dev/prod | Set `false`/`0`/`off` to disable the second-pass structural audit. When enabled (default), Dean reject→retry→forced wrap ships structure-compliant text (policy v2.1+: Teacher requires literal `**Top summary**` / `**Next?**`; UI TLDR/Continue remapping is client-only). |
| `EDUAI_API_KEY` | required for cross-service calls | dev/prod | Shared service key — **must match** AI Tutor server's and QM's `EDUAI_API_KEY` exactly |
| `SESSION_VALIDATE_RATE_LIMIT` | optional (default 300) | dev/prod | Rate limit for `POST /api/sessions/validate` |
| `CHAT_RATE_LIMIT`, `CHAT_RATE_WINDOW_MS` | optional (default 20 per 60000ms) | dev/prod | Per-user rate limit for `POST /api/chat` |
| `ENCRYPTION_KEY` | required for Canvas | dev/prod | AES-256-GCM key for stored Canvas instructor credentials — same format as QM's `ENCRYPTION_KEY` (separate key, same purpose) |
| `VITE_QUESTION_MAKER_URL` | optional | dev | QM dashboard card link |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `INVITE_EXPIRY_HOURS` | optional | dev/prod | Invitation emails — unset `SMTP_HOST` logs the accept link instead of emailing |

### Operating `QUEUE_MAX_DEPTH`

**A Redis outage can present as `429 queue full` rather than `502`.** When the BullMQ
add fails, an enqueue with no `idempotencyKey` deliberately leaves its `PENDING`
row behind for the (not-yet-shipped) reaper, and depth reads count those rows for
a 5-minute grace window — they may still be in Redis. So while Redis is down,
client retries accumulate rows that consume the cap: the first callers get a
truthful `502`, and once accumulated rows reach `QUEUE_MAX_DEPTH` later callers
get `429` instead. `/api/chat` requests carry no `idempotencyKey` unless the
caller supplies one, so this is the common shape of the failure.

Operator guidance when the cap is enabled:

- Treat a `429` spike with no matching rise in *completed* jobs as a suspected
  queue-transport outage, not real saturation. Check Redis reachability and the
  `ai_job_enqueue_failed` system log before assuming the cap was hit honestly.
- Rows age out after 5 minutes, so the condition self-clears once Redis recovers;
  no manual cleanup of `ai_jobs` is needed.
- Set the cap generously above expected steady-state depth. A tight cap makes an
  outage reach the 429 threshold faster and hides the real fault for longer.
- Client copy for a `429` should stay neutral ("the queue is busy, retry shortly")
  rather than asserting a specific queue length, since the number can reflect
  failed-transport rows.

## `apps/core/.env.test.example`

Loaded on top of `.env` for local integration tests only (ignored in Docker CI).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Points at the `eduai_test` database instead of the dev DB |
| `BETTER_AUTH_SECRET` | Fixed test value, not a real secret |
| `BETTER_AUTH_URL` | Test server URL |
| `COOKIE_DOMAIN` | `localhost` |
| `PORT` | Test server port (4001) |
| `EDUAI_API_KEY` | Fixed test value, not a real secret |

## `apps/extensions/ai-tutor/server/.env.example`

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string |
| `PORT` | optional (default 4000) | Server port |
| `CORE_URL` | required | Core base URL — session validation and login redirect |
| `EDUAI_API_KEY` | required | Must match Core's `EDUAI_API_KEY` exactly (Core does not read admin-UI overrides) |
| `EDUAI_BASE_URL` | required | Core API base for course import/sync |
| `EDUAI_MODEL` | required | LLM model id, e.g. `google:gemini-2.5-flash` |
| `POLICY_CACHE_TTL_MS` | optional (default 30000) | TTL for cached Core RBAC policy flags |
| `EDUAI_CALL_TIMEOUT_MS` | optional (default 45000) | Timeout for a single EduAI chat completion round-trip in `callEduAI()` |

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `COOKIE_DOMAIN`, and `AI_SUPERVISOR_ENABLED` were removed
per #817 — none are read anywhere in `server/src`. This server has no local Better Auth instance;
it proxies session validation to Core (`CORE_URL`) via `middleware/auth.js`. The two-agent
supervisor loop is now controlled by the admin-configured `AI_MODEL_POLICY` row, not an env var.

## `apps/extensions/ai-tutor/server/.env.test.example`

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Points at `aitutor_test` |
| `PORT` | Same test-fixture value as Core's `.env.test.example` |
| `EDUAI_API_KEY` | Fixed test value, not a real secret |
| `EDUAI_BASE_URL` | Test-time Core API base |

## `apps/extensions/question-maker/.env.example`

Copied to `apps/extensions/question-maker/.env`, read by both the backend
(`app/backend/src/config/settings.js`) and the Vite frontend (`VITE_*` vars).

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | required | `development` |
| `PORT` | optional (default 8000) | Backend port |
| `DATABASE_URL` | required | Postgres connection string (use `postgres:5432` host instead of `localhost:55432` inside Docker Compose) |
| `CORE_URL` | required | Core auth server — used by session validation middleware |
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

Copied by hand to `infra/cron/cron.env.local` (gitignored), read only by
`infra/cron/dry-run-local.sh` — never by production scripts.

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT_CORE`, `DB_PORT_TUTOR`, `DB_PORT_QM`, `DB_USER` | Match `docker-compose.dev.yml` defaults |
| `DB_PASS` | Core/AI Tutor Postgres password (`postgres`) |
| `DB_PASS_QM` | Question Maker's dev Postgres password (`password` — differs from Core/Tutor, see `docker-compose.dev.yml`) |
| `BACKUP_DIR`, `LOCAL_OFFSITE_DIR`, `AUDIT_LOG` | Local, gitignored paths under the repo |
| `OFFSITE_BUCKET` | Unused in dry-run (kept for parity with production config) |
| `ALERT_EMAIL` | Dry-run alerts are logged locally only |

## Canvas credentials — not in any `.env.example`

Real Canvas instructor credentials are **stored in the database, AES-256-GCM encrypted**
(keyed by `ENCRYPTION_KEY` above) — see `docs/CANVAS.md` and
`apps/core/app/lib/canvas/encryption.ts`. They are not env vars.

The only genuine Canvas *environment* variables in the repo are dev-only, read by
`apps/core/scripts/seed_local_canvas.sh` for seeding a local Canvas instance and not loaded
by the app itself:

| Variable | Purpose |
|---|---|
| `CANVAS_URL` | Local Canvas base URL (default `http://localhost:8080`) |
| `CANVAS_ADMIN_TOKEN` | Canvas admin API token used by the seed script |
| `CANVAS_SEED_PASSWORD` | Password assigned to seeded Canvas users (default `password123`) |

Export these in your shell before running the script; they don't belong in any `.env` file.

## Relationship to #172 (removing `legacy-peer-deps`)

None. `.npmrc` (`legacy-peer-deps`) and the `postinstall` → `scripts/setup-env.js` hook were
both introduced together in PR #133, but they don't interact — one governs npm's dependency
resolution, the other copies env files. #172 does not change anything documented here.
