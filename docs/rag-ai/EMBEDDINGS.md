# Embeddings in EduAI

**Maintenance:** Living reference — update when `embedding.ts`, material upload, pgvector schema, or embedding env vars change.

**See also:** [Local embeddings](./LOCAL-EMBEDDINGS.md) (dimension + model decision), [Chat & RAG pipeline](./CHAT_RAG_PIPELINE.md), [Architecture guide](../ARCHITECTURE.md), [Dev server runbook](./HOW_TO_USE_DEV_SERVER.md).

This document explains **how embeddings work in our system**: what is stored where, which API keys matter, and how that differs from the keys students enter for chat models (Ollama, Gemini, etc.).

---

## The short version

EduAI RAG uses **two separate pieces**:

| Piece | What it is | Where it lives |
| ----- | ---------- | -------------- |
| **Vector library** | Chunk text + numeric vectors per course material | **Our PostgreSQL** (`material_chunks`, `material_embeddings`, pgvector) |
| **Embedding API** | Converts text → vector (list of numbers) | **Ollama (local)** or **OpenRouter / OpenAI cloud** (`apps/core/.env`) |

There is no department-wide “embeddings API” that hosts our vectors. The API key (when using cloud) pays for **conversion** only; **we** store the results in Postgres.

```text
Upload PDF  →  chunk  →  embed API (local or cloud)  →  Postgres
Student asks  →  embed (question)  →  pgvector search  →  chunk text  →  chat LLM
```

The chat model only sees **retrieved text**, not the vector database.

---

## What are embeddings?

When a professor uploads a syllabus or lecture PDF, EduAI does not feed the entire file into the chat model on every question. That would be slow, expensive, and often over the model’s context limit. Instead, we **prepare** the material ahead of time and, at question time, pull back only the **few paragraphs that are most relevant** to what the student asked. Embeddings are the mechanism that makes that “find the right paragraph” step possible.

### Turning text into numbers that capture meaning

An **embedding** is what you get when a specialized **embedding model** reads a piece of text and outputs a long list of numbers — for example, **1024** numbers in our default local setup (`mxbai-embed-large`). You can think of that list as a coordinate in a very high-dimensional space. The important property is not the numbers themselves but what they encode: **text with similar meaning ends up with similar coordinates**.

So two sentences that both discuss “office hours on Tuesdays” will produce vectors that are **close** to each other, even if they use different words. A sentence about “matrix multiplication” will be **far** from office-hour text. The model has learned this from large-scale training; we do not hand-write the rules.

EduAI never shows these numbers to students. We use them only inside the server to **rank** which stored chunks best match a question. The chat model (Ollama, Gemini, etc.) still receives normal **English text** — the actual chunk content pulled from the database.

### How that differs from keyword search

Keyword search (e.g. searching for the word “syllabus”) only finds documents that contain that exact word. A student might ask *“When is the midterm?”* without using the word “exam.” Embedding search compares **meaning**: if a chunk talks about the midterm schedule, it can still rank highly even when the question and the chunk share few words. That is why RAG in EduAI is built on vectors rather than a simple full-text search over PDFs.

### Chunks: we embed paragraphs, not whole PDFs

Course materials are usually long. Embedding the entire syllabus as one vector would blur many topics into a single point and make retrieval vague. So we **split** extracted text into **chunks** — overlapping segments of roughly **800 characters** with about **80 characters** of overlap between neighbors (`generateChunks()`). Each chunk gets its own vector. At question time we retrieve the **top few chunks** (capped in chat code), not the whole course library.

### Dimensionality (1024, 768, 3072, etc.)

**Dimensionality** is how long the number list is (e.g. 1024 floats). Higher does not automatically mean better search quality; what matters is a **good embedding model** and the **same model** for indexing and queries. After [LOCAL-EMBEDDINGS](./LOCAL-EMBEDDINGS.md), our schema is `vector(1024)` with default local model **`mxbai-embed-large`**. Switching model or provider requires **re-embedding** all materials — see [Re-embed after migration](#re-embed-after-migration).

For the full upload → chat pipeline, see [Two lifecycles](#two-lifecycles-write-index-and-read-rag) below.

---

## Two lifecycles: write (index) and read (RAG)

### 1. Indexing — when materials are uploaded

**Trigger:** [`courses.materials.$.ts`](../../apps/core/app/routes/api/courses.materials.$.ts) calls `processMaterialEmbeddings(materialId, content)` after text is extracted.

**Steps:**

1. `generateChunks(content)` — sentence-based chunks with overlap.
2. `generateEmbeddings(chunks)` — `embedMany` via Ollama or cloud ([provider order](#provider-selection)).
3. Insert `material_chunks` (text) + `material_embeddings` (vector via raw SQL).
4. Material status → `READY` or `FAILED`.

```mermaid
flowchart LR
  A[PDF / document upload] --> B[Extract rawText]
  B --> C[generateChunks]
  C --> D[embedMany local or cloud]
  D --> E[(Postgres: chunks + vectors)]
```

**Important:** Indexing needs a working **server** embed provider at upload time. Vectors **remain in the DB** if the key is removed later, but **new** uploads and **chat retrieval** fail until a provider is configured again.

### 2. Retrieval — when chat needs course context

**Trigger:** `findRelevantContent` from [`embedding.ts`](../../apps/core/app/lib/ai/embedding.ts), called from [`chat.ts`](../../apps/core/app/routes/api/chat.ts):

| Chat path | When `findRelevantContent` runs |
| --------- | -------------------------------- |
| **Hybrid RAG** | `supportsTools: false`, course selected, keyword heuristics match — **once before** `streamText` |
| **Tool RAG** | `supportsTools: true` — only if the model calls `getInformation` |

**Steps:**

1. `generateEmbedding(userQuery)` — one embed API call for the question.
2. pgvector similarity over that course’s chunks (default threshold **0.5**), top **N** by score.
3. Chunk **text** goes to the chat model (system prompt or tool result).

```mermaid
flowchart LR
  Q[User question] --> E[generateEmbedding]
  E --> S[(pgvector similarity in Postgres)]
  S --> T[Top chunk texts]
  T --> L[Ollama / Gemini chat model]
```

---

## Credentials and environment variables

Single reference for keys and `.env` entries (avoids duplicating the same three variables in two tables).

| Name | Location | Role | Powers RAG embeddings? |
| ---- | -------- | ---- | ---------------------- |
| `EMBEDDING_PROVIDER` | `apps/core/.env` | `local` / `ollama` → Ollama; `cloud` or unset → cloud chain | **Yes** — selects path |
| `EMBEDDING_DIMENSION` | `apps/core/.env` | Expected vector length (default **1024**); must match pgvector column | **Yes** — validation |
| `OLLAMA_BASE_URL` | `apps/core/.env` | Ollama host (same as chat; cmps01 on dev server) | **Yes** (local path) |
| `OLLAMA_EMBEDDING_MODEL` | `apps/core/.env` | Local embed model (default **`mxbai-embed-large`**) | **Yes** (local path) |
| `OPENROUTER_API_KEY` | `apps/core/.env` | Cloud embed via OpenRouter (`openai/text-embedding-3-small` @ 1024 dims) | **Yes** (cloud / fallback) |
| `OPENROUTER_EMBEDDING_MODEL` | `apps/core/.env` | Override OpenRouter model id | Optional |
| `OPENROUTER_HTTP_REFERER` | `apps/core/.env` | OpenRouter ranking header; defaults to `BETTER_AUTH_URL` | Optional |
| `OPENROUTER_APP_TITLE` | `apps/core/.env` | OpenRouter `X-Title` header (default `EduAI`) | Optional |
| `OPENAI_API_KEY` | `apps/core/.env` | Direct OpenAI embed (`text-embedding-3-small`, `dimensions: 1024`) | **Yes** (cloud fallback) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `apps/core/.env` | Legacy 3072-dim Gemini path only when `EMBEDDING_DIMENSION=3072` | **Yes** (legacy) |
| `DATABASE_URL` | `apps/core/.env` | Postgres connection; vectors live here | **No** — not an embed API |
| User **chat** `apiKeys` in request body | Client / chat UI | Ollama, Gemini, etc. for **conversation** | **No** |
| Admin `x-api-key` / Better Auth API keys | Settings / API auth | Sister apps, admin | **No** |

Template: [`apps/core/.env.example`](../../apps/core/.env.example).

### Example blocks

**Dev server (cmps01):**

```env
EMBEDDING_PROVIDER=local
EMBEDDING_DIMENSION=1024
OLLAMA_BASE_URL="http://localhost:11434/"
OLLAMA_EMBEDDING_MODEL=mxbai-embed-large
```

Pull the model once: `ollama pull mxbai-embed-large`

**Laptop without Ollama (cloud fallback):**

```env
EMBEDDING_PROVIDER=cloud
EMBEDDING_DIMENSION=1024
OPENROUTER_API_KEY=sk-or-...
# or OPENAI_API_KEY=sk-...
```

### Common misconception

> “We need the department’s embedding API key to access our vector database.”

**Correction:** The database is **ours** (`eduai-db` in local Docker; dev/prod per `DATABASE_URL`). Any valid **server** embed provider can **generate** vectors for dev, as long as indexing and search use the **same model family and dimension**. The key does not “unlock” stored vectors — Postgres does.

### Provider selection

`getEmbeddingModel()` resolution in [`embedding.ts`](../../apps/core/app/lib/ai/embedding.ts) (logged as `[embedding]`):

**When `EMBEDDING_PROVIDER=local` or `ollama`:**

1. Ollama (`OLLAMA_BASE_URL` + `OLLAMA_EMBEDDING_MODEL`)
2. On failure → cloud chain (1024-dim models)

**When `EMBEDDING_PROVIDER=cloud` or unset:**

1. `OPENROUTER_API_KEY` → OpenRouter `openai/text-embedding-3-small` (1024 dims when `EMBEDDING_DIMENSION=1024`)
2. Else `OPENAI_API_KEY` → OpenAI `text-embedding-3-small` with `dimensions: 1024`
3. Legacy `EMBEDDING_DIMENSION=3072` path: OpenRouter Gemini → Google → OpenAI
4. Else → throws *No embedding provider configured*

**Do not mix providers or dimensions** on existing data without re-indexing.

**Smoke test:** from `apps/core`, run `npm run test:embedding` (loads `.env`, prints active provider and vector length).

### Re-embed after migration

After [LOCAL-EMBEDDINGS](./LOCAL-EMBEDDINGS.md) migration, existing Gemini (3072) vectors are removed. Re-index each course:

```bash
cd apps/core
npm run re-embed:course -- <courseId>
```

This clears chunks/embeddings per material, re-runs `processMaterialEmbeddings`, and sets material status to `READY` or `FAILED`.

---

## Hosting and scale

| Component | Where | Notes |
| --------- | ----- | ----- |
| **Vectors + chunk text** | Campus / project Postgres (pgvector) | See `docker-compose.dev.yml` → `eduai-db`; [DEPLOYMENT.md](../DEPLOYMENT.md) for dev/prod |
| **Embedding computation** | **Ollama on cmps01** (local) or **cloud** (laptop fallback) | Chunk text sent to provider at index + per RAG query |
| **Chat LLM** | `cmps01` Ollama and/or cloud chat APIs | Separate from embeddings; usually dominates latency |

**Classroom scale:** Indexing bursts at upload week (`embedMany`); during term one embed per RAG turn plus a cheap DB search; vectors written once per chunk.

---

## Database layout (RAG storage)

```text
course_materials          ← file metadata, courseId, status (PROCESSING → READY / FAILED)
    └── material_chunks   ← plain text per segment
            └── material_embeddings  ← vector(1024) per chunk
```

pgvector enabled via migration (`CREATE EXTENSION IF NOT EXISTS vector`). Prisma uses raw SQL for vector insert/search. Schema: [`schema.prisma`](../../apps/core/prisma/schema.prisma) — `MaterialChunk`, `MaterialEmbedding`.

---

## Failure modes and debugging

| Symptom | Likely cause |
| ------- | ------------ |
| `No embedding provider configured` | Missing local Ollama or cloud keys in `apps/core/.env` |
| `Embedding dimension mismatch` | `EMBEDDING_DIMENSION` / model output does not match pgvector column — re-embed |
| Generic “check the university website” answers (Ollama + course) | Hybrid RAG failed embed step; fallback prompt without excerpts |
| `getInformation` → `Failed to search course materials` | Same missing/unhealthy embed provider on tool path |
| RAG runs, empty results | No indexed materials (run re-embed), similarity below 0.5, or wrong course |
| Material stuck `FAILED` | Error in `processMaterialEmbeddings` (check upload logs / `[embedding]`) |
| Local embed slow first call | Model cold-start — optional warmup (#372) |

**Verify indexing:** Upload test PDF → material `READY` → rows in `material_chunks` / `material_embeddings`.

**Verify retrieval:** Course-related question with course selected; check `[embedding]` logs before `streamText`.

---

## Code map

| Function | File | Role |
| -------- | ---- | ---- |
| `generateChunks` | `embedding.ts` | Split material text |
| `generateEmbeddings` / `generateEmbedding` | `embedding.ts` | Local or cloud embed API |
| `processMaterialEmbeddings` | `embedding.ts` | Index one material |
| `reEmbedCourseMaterials` | `embedding.ts` | Re-index all materials in a course |
| `findRelevantContent` | `embedding.ts` | Similarity search |
| `re-embed-course.ts` | `scripts/` | CLI wrapper for course re-embed |
| Upload handler | `courses.materials.$.ts` | Triggers indexing |
| Hybrid / tool RAG | `chat.ts` | Calls `findRelevantContent` |

---

## Related reading

- [LOCAL-EMBEDDINGS.md](./LOCAL-EMBEDDINGS.md) — dimension + model decision
- [CHAT_RAG_PIPELINE.md](./CHAT_RAG_PIPELINE.md) — `/api/chat`, hybrid vs tools
- [HOW_TO_USE_DEV_SERVER.md](./HOW_TO_USE_DEV_SERVER.md) — shared dev host, `.env`
- [DEPLOYMENT.md](../DEPLOYMENT.md) — topology, Ollama on cmps01
- [EDUAI_HELPME_ANALYSIS.md](./eduai-summer-2026/EDUAI_HELPME_ANALYSIS.md) — HelpMe local embed patterns
