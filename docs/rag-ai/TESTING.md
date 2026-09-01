# RAG and AI testing

Tests are the executable contract for the behavior described in this folder.
Run them from `apps/core` unless a command says otherwise. External-provider,
database, fleet, and deployment checks require their corresponding environment;
the static/unit checks do not.

## Fast local checks

```bash
cd apps/core
npm run test:unit
npm run test:embedding
npm run lint
npm run format:check
```

`npm test` runs both unit and integration suites. `npm run typecheck` is useful
after changing route/provider types. Use focused Vitest paths while iterating,
then run the broader suite before merging a contract change.

## Relevant automated coverage

| Area | Representative tests |
| --- | --- |
| Embedding provider settings | `app/tests/unit/embedding-config.test.ts` |
| Vector retrieval settings and filters | `app/tests/unit/embedding.rag-settings.test.ts`, `embedding.student-visibility.test.ts` |
| RAG formatting and caps | `app/tests/unit/chat-rag.test.ts`, `chat-rag-context.test.ts` |
| Chat route access and history | `app/tests/unit/chat-route.server.test.ts`, `chat-history*.test.ts` |
| Chat route integration | `app/tests/integration/chat*.test.ts`, `chat-admin*.test.ts`, `chat-instructor*.test.ts` |
| Course embedding settings | `app/tests/integration/courses.embedding-settings.integration.test.ts` |
| RAG settings API | `app/tests/integration/courses.rag-settings.integration.test.ts` |
| Material embedding persistence | `app/tests/integration/material-embeddings.integration.test.ts` |
| Re-embed lease fencing | search `reEmbedLease` / `leaseOwner` tests under `app/tests/` |
| Fleet selection and health | search `fleet`, `resolveFleet`, and `health` tests under `app/tests/` |
| Queue enqueue guard | `app/tests/unit/queue.chat-producer.test.ts` |

The exact test filenames can change with refactors; use `rg --files
app/tests | rg 'embedding|rag|chat|fleet|queue'` to discover the current set.

## Embedding smoke test

```bash
cd apps/core
npm run test:embedding
```

This loads the server `.env`, reports the selected mode and expected dimension,
embeds a short string, and verifies the returned vector length. It does not
verify retrieval quality or write the database. It needs either local Ollama /
vLLM embedding access or a configured cloud key.

## Ingestion fixture smoke test

The committed inputs are:

- `docs/rag-ai/fixtures/rag-ingestion-clinical.md`
- `docs/rag-ai/fixtures/rag-ingestion-equations.md`
- `docs/rag-ai/fixtures/rag-ingestion-tables.md`

The script below mutates a named course (`CHUNK433`) and runs retrieval checks;
use only an approved development/test database:

```bash
cd apps/core
npx tsx scripts/seed-rag-ingestion-fixtures.ts
```

It checks that tables and equations survive extraction/chunking and verifies
retrieval expectations. The current script also contains a slide-marker
assertion without a matching committed slide fixture. That is a known test
coverage gap, not a reason to claim slide ingestion is verified. Confirm the
target course and clean up any test rows according to the script/database
operator procedure.

## Course re-embedding

Use the supported command when an approved course needs a fresh index:

```bash
cd apps/core
npm run re-embed:course -- --list
npm run re-embed:course -- <course-id-or-exact-course-code>
```

This is a mutating operation. Verify provider, model, dimension, course, and
database before running it. The re-embed implementation bounds concurrency and
uses lease fencing; a provider failure should leave the previous material
vectors intact.

## Fleet smoke checks

```bash
cd apps/core
npm run vllm:smoke
npm run fleet:smoke
npm run fleet:extensions:smoke
```

These commands need local/fleet URLs and authentication configured in the
environment. `fleet:smoke` and `fleet:extensions:smoke` currently consume the
legacy `VLLM_FLEET_*` variables, even though runtime registration prefers the
structured `fleet.config.json`; do not mistake a successful legacy smoke for a
complete structured-config test. Verify `/v1/models`, requested served model
ids, HTTP status, and `X-Fleet-Server`.

## End-to-end and performance checks

Use [`PERFORMANCE.md`](./PERFORMANCE.md) for authenticated `/api/chat` RAG
and concurrency checks. It explains the temporary fixture safety gates,
single-session limitation, required metrics, and why old benchmark artifacts
are not current evidence.

## Stale evaluation script

`apps/core/scripts/eval-rag-seed.ts` currently forces the legacy 3072-dimensional
embedding path while the live schema is `vector(1024)`. Do not use
`npm run eval:rag:seed` as a current pass/fail gate until the script is updated
or run against a deliberately matching legacy schema. This limitation is
documented here so it is not accidentally treated as production guidance.

## Failure expectations

Tests and manual checks should preserve these distinctions:

- no relevant chunks is different from an embedding/database failure;
- student and staff retrieval have different visibility filters;
- a tool-capable model is required for admin/instructor modes;
- `regenerateOnly` is read-only;
- queue enqueue is disabled unless explicitly enabled;
- a fleet host can be healthy yet unable to serve a requested model;
- an old measurement is not a regression baseline without its environment and
  run conditions.
