# HELPME / EduAI RAG and AI

This folder is the maintained documentation for the RAG and AI behavior in
EduAI Core. The implementation is authoritative: when code, configuration,
tests, and prose disagree, fix the prose or call out the implementation gap.
The documents here describe current contracts and repeatable maintenance
procedures; they do not preserve old sprint status reports or one-time
investigations.

## Start here

| Need | Read |
| --- | --- |
| Understand a request to `POST /api/chat` | [`chat-rag-pipeline.md`](chat-rag-pipeline.md) |
| Understand indexing, embeddings, pgvector, and re-embedding | [`embeddings.md`](embeddings.md) |
| Understand how an uploaded material is stored, fails, retries, and is deleted or re-uploaded | [`embeddings.md`](embeddings.md#material-lifecycle-storage-failure-retry-delete-and-re-upload) |
| Understand Auto model selection and the vLLM fleet | [`model-routing.md`](model-routing.md) |
| Operate a vLLM host or fleet | [`vllm.md`](vllm.md) |
| Run the shared development deployment | [`shared-dev-server.md`](shared-dev-server.md) |
| Measure current behavior without relying on old numbers | [`performance.md`](performance.md) |
| Run RAG, embedding, and fleet checks | [`testing.md`](testing.md) |
| Review possible, not-yet-implemented HELPME upgrades | [`future-work.md`](future-work.md) |
| Review historical fleet-router benchmark numbers | [`performance.md`](performance.md#historical-fleet-router-reports) — restored by deployment PR [#1707](https://github.com/EduAI-Lab/EduAI/pull/1707); not a current capacity guarantee |

## Current invariants

- Course material embeddings are stored in Core's Postgres database in
  `material_embeddings.embedding`, currently `vector(1024)`.
- Embedding provider selection is server-side. Chat-request `apiKeys` do not
  configure indexing or retrieval embeddings.
- Local embedding mode uses an OpenAI-compatible vLLM embedding endpoint when
  `VLLM_EMBEDDING_BASE_URL` is set, otherwise native Ollama. A local provider
  failure is terminal; it does not silently switch to a cloud provider.
- Cloud 1024-dimensional embeddings use OpenRouter/OpenAI-compatible models;
  the 3072-dimensional Gemini path is legacy and must not be mixed with the
  current schema.
- `POST /api/chat` is course-scoped for interactive browser learning chat.
  Service-key integrations are ephemeral, and admin chat may omit a course.
- Retrieval is fail-closed. A provider or database retrieval failure is not
  equivalent to “no relevant chunks”; callers receive an error response.
- Student retrieval applies material visibility, publish, exclusion, and
  availability filters. Staff retrieval does not apply those student-only
  filters.
- The help assistant's documentation corpus (#1819) is embedded by the same
  configured provider but stored separately in `help_doc_chunks`, so a docs
  question never reads course material and vice versa. Its retrieval is
  fail-closed too: a failure answers `retrieval_unavailable`, never "not
  documented". See `apps/core/app/lib/assistant/help-docs/`.
- vLLM fleet routing is optional. A structured `fleet.config.json` is preferred;
  legacy environment lists remain a fallback. Interactive and background work
  have separate pools when a heavy pool is configured.

## Source map

| Concern | Implementation authority |
| --- | --- |
| Chat route, access gates, persistence, response metadata | [`apps/core/app/routes/api/chat.ts`](../../../../../apps/core/app/routes/api/chat.ts) |
| RAG formatting, context caps, tool result caps | [`apps/core/app/lib/chat-rag.ts`](../../../../../apps/core/app/lib/chat-rag.ts) |
| Course RAG prefetch/injection policy | [`apps/core/app/lib/ai/course-rag-policy.ts`](../../../../../apps/core/app/lib/ai/course-rag-policy.ts) |
| Intent heuristics | [`apps/core/app/lib/ai/chat-intent.ts`](../../../../../apps/core/app/lib/ai/chat-intent.ts) |
| Embedding providers, pgvector search, re-embedding | [`apps/core/app/lib/ai/embedding.ts`](../../../../../apps/core/app/lib/ai/embedding.ts) |
| Upload extraction and semantic chunking | [`apps/core/app/lib/ai/file-processing.ts`](../../../../../apps/core/app/lib/ai/file-processing.ts) |
| Auto routing | [`apps/core/app/lib/ai/routing/`](../../../../../apps/core/app/lib/ai/routing) |
| Fleet registration and host selection | [`apps/core/app/lib/ai/routing/fleet/`](../../../../../apps/core/app/lib/ai/routing/fleet) |
| Database schema | [`apps/core/prisma/schema.prisma`](../../../../../apps/core/prisma/schema.prisma) |
| Environment contract | [`apps/core/.env.example`](../../../../../apps/core/.env.example) |

## Fixtures

The three Markdown files under [`fixtures/`](../../../../rag-ai/fixtures) are executable input
fixtures for `seed-rag-ingestion-fixtures.ts`, not prose documentation. Keep
their content stable unless the ingestion test itself changes. The test script
currently discovers those files and also contains a slide-marker assertion;
see [`testing.md`](testing.md) for the exact limitation.

## Maintenance rule

When changing RAG or AI behavior, update the closest document in the same
change and include the relevant code path, environment variable, test, or
operational check. Do not add a dated incident report here when the useful
result is a durable rule. Put proposals in [`future-work.md`](future-work.md)
and label them as potential upgrades until they have shipped implementation,
tests, and configuration.
