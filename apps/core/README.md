# EduAI Core

RAG-powered chat platform and the **central API / auth layer** for the EduAI monorepo. Extensions (AI Tutor, Question Maker) validate sessions against Core and call Core APIs with the shared service key (`EDUAI_API_KEY`).

For platform layout, ports, Docker databases, and `npm run dev`, start at the **[monorepo root README](../../README.md)**. For architecture, RAG/chat flows, schema, and RBAC, see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Develop from the monorepo root

```bash
# from repo root
npm install
npm run dev
# Core only:
npx turbo run dev --filter=edu-ai
```

Core listens at **http://localhost:3000**. Do not treat this package as a standalone Vite app on port 5173.

## What Core owns

- Better Auth sessions and OAuth/OIDC for the platform
- Course / enrollment / materials / Canvas sync APIs
- Chat + RAG (`POST /api/chat`), embeddings (pgvector, `ivfflat` ANN index on `material_embeddings` tunable via `RAG_IVFFLAT_PROBES` — see [`docs/rag-ai/EMBEDDINGS.md`](../../docs/rag-ai/EMBEDDINGS.md#ann-index-940)), AI provider catalog
- Policy registry (`GET /api/policies`) and admin tooling
- Administrator-managed automatic routing: AI Management controls separate `Auto` (LLM-classified) and `Auto (rules)` (fixed-rule) modes. Both select only active tiered models on active providers, while explicit model selections remain unchanged.
- Course-scope guardrail: an always-on system-prompt policy (Layer A) plus an optional second-pass 7B classifier (Layer B, `COURSE_SCOPE_GUARDRAIL_ENABLED` + each course's `courseScopeGuardrailEnabled` setting) that keeps browser learning chat on-topic for the enrolled course, failing open on classifier errors/timeouts and bypassed by admin preview and service-key calls.
- Service-key and session APIs consumed by extensions

## Essential environment

Copy from `.env.example` (root `npm install` also auto-copies if missing). Critical variables:

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Dev default points at Docker `eduai-db` on port `54320` |
| `BETTER_AUTH_SECRET` | Required |
| `BETTER_AUTH_URL` | `http://localhost:3000` in local dev |
| `ENCRYPTION_KEY` | Required for Canvas token storage (AES-256-GCM) |
| `EDUAI_API_KEY` | Same value as AI Tutor server + Question Maker |
| `EMBEDDING_PROVIDER` / `OPENROUTER_API_KEY` / `OLLAMA_BASE_URL` | Embeddings path — see [`docs/rag-ai/EMBEDDINGS.md`](../../docs/rag-ai/EMBEDDINGS.md) |
| `RAG_IVFFLAT_PROBES` | ANN index recall/latency tuning for `material_embeddings` (default `10`, clamped `[1, 100]`) — see [`docs/rag-ai/EMBEDDINGS.md#ann-index-940`](../../docs/rag-ai/EMBEDDINGS.md#ann-index-940) |

Full inventory: [`docs/ENVIRONMENT.md`](../../docs/ENVIRONMENT.md) and `apps/core/.env.example`.

## Useful scripts (from `apps/core`)

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:canvas-live # explicit opt-in; see ../../docs/canvas-live-testing.md
npm run db:migrate
npm run db:generate
npm run db:seed
```

Prefer root scripts for multi-app work: `npm run test:eduai`, etc. Inventory: [`TESTS.md`](../../TESTS.md).

## API discovery

Route handlers under `app/routes/` (API under `app/routes/api/`). Auth guards: `app/lib/auth/`. Course access: `app/lib/auth/course-access.server.ts`.

Do not maintain a curl cookbook — use ARCHITECTURE §6 and §7 plus route modules.

Sustainability-aware tier routing lives under `app/lib/ai/routing/`. Administrators control the chat picker's **Auto** (LLM classifier) and **Auto (rules)** entries from **Administration → AI Management**. `Auto` is enabled by default; `Auto (rules)` is disabled by default. Configure routing algorithms via `ROUTER_MODE`, carbon policy via `ROUTING_CARBON_MODE`, and the classifier via `ROUTING_LLM_CLASSIFIER_MODEL`.

## Related docs

| Doc | Purpose |
|-----|---------|
| [Monorepo root README](../../README.md) | Platform onboarding, ports, Docker DBs, `npm run dev` |
| [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) | System design, RAG/chat flows, schema, RBAC |
| [`docs/EXTENSION_ONBOARDING.md`](../../docs/EXTENSION_ONBOARDING.md) | Extension app integration and auth |
| [`docs/CANVAS.md`](../../docs/CANVAS.md) | Canvas sync and instructor token setup |
| [`docs/LOGGING.md`](../../docs/LOGGING.md) | Audit logs, system logs, admin viewer |
