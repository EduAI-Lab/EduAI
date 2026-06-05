# Local embeddings

**Status:** Accepted  
**Date:** 2026-06-02  
**Deciders:** EduAI RAG team (Week 5)  
**Issues:** [#361](https://github.com/EduAI-Lab/EduAI/issues/361), [#369](https://github.com/EduAI-Lab/EduAI/issues/369), [#370](https://github.com/EduAI-Lab/EduAI/issues/370), [#373](https://github.com/EduAI-Lab/EduAI/issues/373)  
**Epic:** [#61](https://github.com/EduAI-Lab/EduAI/issues/61)

---

## Context

EduAI RAG stores course-material vectors in PostgreSQL (`material_embeddings.embedding`) and computes them via **cloud APIs** in `apps/core/app/lib/ai/embedding.ts`. Student **chat** already runs on **Ollama at cmps01**; embeddings do not. Parent issue **#361** wants local embeds for latency, cost, and UBC GPU / URA alignment.

Since August 2025 the column has been `vector(3072)` for Google `gemini-embedding-001`. Common Ollama embedding models output **768** or **1024** dimensions. Mixing dimensions or model families in one table breaks cosine search silently.

---

## Decision

### 1. Option A — migrate pgvector dimension and re-embed

We adopt **Option A** (not dual-store, not 3072-local):

| Item | Choice |
| ---- | ------ |
| **Target dimension** | **1024** (`EMBEDDING_DIMENSION=1024`, pgvector `vector(1024)`) |
| **Default local model** | **`mxbai-embed-large`** via Ollama (`OLLAMA_EMBEDDING_MODEL=mxbai-embed-large`) |
| **Dev server default** | `EMBEDDING_PROVIDER=local` on cmps01 |
| **Cloud path** | When `EMBEDDING_PROVIDER` is cloud/unset (or a course uses cloud): OpenRouter → OpenAI with **1024-dim** models (`openai/text-embedding-3-small` with `dimensions: 1024`) |

**Runner-up local model:** `nomic-embed-text` (768 dims) — requires `vector(768)` instead; not chosen for this migration.

**Rejected Option B:** No standard Ollama embed model outputs 3072.

**Rejected Option C:** Dual cloud + local indexes — deferred complexity.

### 2. Provider resolution

```
EMBEDDING_PROVIDER=local  →  Ollama only (no silent cloud fallback; indexing fails if Ollama is down)

EMBEDDING_PROVIDER=cloud or unset  →  cloud chain (1024-dim models)
```

Per-course `embeddingProvider=local` follows the same rule: index and query must use the configured local model space.

Cloud chain (1024-dim path): OpenRouter (`openai/text-embedding-3-small`) → OpenAI direct → throws if no key.

**Do not** mix local query vectors with Gemini-indexed (3072) chunks. After migration, run `npm run re-embed:course -- <courseId>` per course before expecting RAG to work.

### 3. Impact on existing rows

Every row in `material_embeddings` built with Gemini (3072) is **incompatible** after migration. The Prisma migration **deletes** existing embedding rows and alters the column to `vector(1024)`. Course materials keep `rawText`; operators must **re-embed** via `apps/core/scripts/re-embed-course.ts`.

---

## Consequences

### Positive

- Embeddings colocated with chat on cmps01 — lower latency and cloud cost on the dev path.
- Aligns with HelpMe local-embed precedent (`mxbai-embed-large`, 1024 dims).
- Single model space per environment after re-embed.

### Negative / follow-up

- **One-time re-embed** required for every course with indexed materials.
- Laptop devs without Ollama need a cloud key and 1024-dim models (not legacy Gemini 3072).
- Optional **#372** warmup can follow once #370 lands.

---

## How to change vector dimensionality on the dev server

The shared host uses one Postgres container (`eduai-db`). When a branch expects a different embedding dimension than the DB currently has, follow the full procedure in [`EMBEDDINGS.md` — How to change vector dimensionality](./EMBEDDINGS.md#how-to-change-vector-dimensionality).

Before switching branches for others, repeat the same steps for **that branch’s target dimension** so column, `.env`, and re-embedded vectors stay aligned.

---

## References

- [`EMBEDDINGS.md`](./EMBEDDINGS.md) — operational guide (includes dimension change procedure)
- [`HOW_TO_USE_DEV_SERVER.md`](./HOW_TO_USE_DEV_SERVER.md) — SSH, tmux, branch switching
- [`EDUAI_HELPME_ANALYSIS.md`](./eduai-summer-2026/EDUAI_HELPME_ANALYSIS.md) — HelpMe local embed patterns
- `apps/core/app/lib/ai/embedding.ts` — provider implementation
- `apps/core/scripts/re-embed-course.ts` — course re-index script (CLI, synchronous)
- UI/API re-index uses background `CourseReEmbedJob` records — `POST /api/courses/:id/re-embed` returns a job id; poll `GET /api/courses/:id/re-embed/:jobId` for progress
