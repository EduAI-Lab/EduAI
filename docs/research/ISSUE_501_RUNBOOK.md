# Issue #501 — RAG stress test runbook

Compare **latest RAG pipeline** (`feat/always-on-course-rag` / this branch) vs **original pipeline on `main`**, under classroom-scale load on **dev** (`dev.eduai.ok.ubc.ca` / s378).

**GitHub:** [#501](https://github.com/EduAI-Lab/EduAICoreLearning/issues/501)  
**Prior runs:** `feat/research-routing-vllm` → `docs/research/data/runs/classroom-sim-*.txt` (30 students, routing policies P0/P1)

---

## What changed in the pipeline (main → latest)

| Area | `main` (baseline) | Latest (this branch) |
|------|-------------------|----------------------|
| Chunking | Double-split risk (`file-processing` + `generateChunks`) | Document-aware chunking, no double-split |
| Embeddings | Per-chunk sequential writes | `embedMany` batching |
| Retrieval | Pure vector + threshold filter | Optional hybrid BM25+vector (`RAG_HYBRID_BM25=1`) |
| Course settings | Global defaults only | Per-course `ragTopK` / threshold + TTL cache |
| Chat RAG gate | Keyword/heuristic hybrid path | Always-on course RAG on hybrid + tool paths |

Track A isolates retrieval; Tracks B/C measure full `/api/chat` under fixed models.

---

## Prerequisites (dev / s378)

1. **Materials indexed** — re-embed courses if needed after #363:
   ```bash
   cd apps/core
   npm run re-embed:course -- <courseId>
   ```
2. **Env file** — copy and fill secrets:
   ```bash
   cp scripts/research/env.research.s378.example .env.research
   # edit RESEARCH_RUN_X_API_KEY, DATABASE_URL (Track A only)
   ```
3. **Deploy branch** under test before each pipeline label (`latest` vs `main-baseline`).
4. Record **git SHA** and date in every run:
   ```bash
   export RESEARCH_GIT_SHA=$(git rev-parse --short HEAD)
   export RESEARCH_PIPELINE_LABEL=latest   # or main-baseline
   ```

---

## Models (fixed — no `auto` routing)

| Label | Model ID | Track B timeout | Track C timeout |
|-------|----------|-----------------|-----------------|
| **7B** | `vllm:qwen2.5-7b-instruct` | 180s | 180s |
| **32B** | `vllm:qwen2.5-32b-instruct` | 300s | 300s |
| **120B** | `ollama:gpt-oss:120b` | 300s | 300s |

Run **one model at a time** — 7B and 32B share the vLLM host.

Set via `RESEARCH_FIXED_MODEL=7B|32B|120B` (or full model id).

---

## Track A — RAG retrieval (20 prompts, no LLM)

Retrieval-only against `findRelevantContent` using `rag_grounded` dev prompts from `prompts.v1.jsonl`.

```bash
cd apps/core
set -a && source .env.research && set +a

export RESEARCH_PIPELINE_LABEL=latest
export RESEARCH_GIT_SHA=$(git rev-parse --short HEAD)
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_RUN_LIMIT=20
export RESEARCH_EVAL_RAG_OUT=../../docs/research/data/runs/issue-501/track-a-latest.jsonl

npm run research:eval-rag
```

Repeat after checking out / deploying **`main`** with `RESEARCH_PIPELINE_LABEL=main-baseline` and a different output path.

**Deliverable columns:** hit rate, strong-hit rate (top1 ≥ `RAG_SIMILARITY_THRESHOLD`), p50 retrieval latency, optional human Y/N relevance.

---

## Track B — Sequential full-pipeline sweep

96 dev prompts (or full 120) × each model, non-streaming, `forceHybridRag: true` on course prompts.

```bash
export RESEARCH_FIXED_MODEL=7B
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_RUN_SLEEP_MS=500
export RESEARCH_RUN_LABEL=501-track-b-7b-latest
export RESEARCH_POLICY_OUT=../../docs/research/data/runs/issue-501/track-b-7b-latest.jsonl

npm run research:run-policy
npm run research:summarize-policy   # optional existing summarizer
node scripts/research/summarize-issue-501.mjs "$RESEARCH_POLICY_OUT"
```

Repeat for `32B`, `120B`, and again on **`main`** baseline deploy.

---

## Track C — Stress / load simulation

Extend classroom sim for 100+ students (issue #501 scenarios):

| Scenario | Students | Concurrency | Env |
|----------|----------|-------------|-----|
| **C1** | 100 | 5 | default |
| **C2** | 100 | 10 | `RESEARCH_CLASSROOM_CONCURRENCY=10` |
| **C3** (optional) | 150 | 5 | only if C1 stable |

```bash
export RESEARCH_FIXED_MODEL=7B
export RESEARCH_CLASSROOM_STUDENTS=100
export RESEARCH_CLASSROOM_CONCURRENCY=5
export RESEARCH_CLASSROOM_SPLIT=dev
export RESEARCH_RUN_LABEL=501-c1-7b-latest
export RESEARCH_CLASSROOM_OUT=../../docs/research/data/runs/issue-501/track-c1-7b-latest.jsonl
export RESEARCH_CLASSROOM_SUMMARY=../../docs/research/data/runs/issue-501/track-c1-7b-latest.txt

npm run research:run-classroom
```

For **120B**, set `RESEARCH_RUN_TIMEOUT_MS=300000`.

**Prior reference (30 students, P1 auto routing):**

```
docs/research/data/runs/classroom-sim-summary.v1.txt
  OK: 30/30, p50: 11379ms, p95: 22062ms
```

---

## Comparing main vs latest

Recommended workflow on s378:

1. Deploy **latest** branch → run Tracks A/B/C → tag outputs `*-latest.*`
2. Deploy **`main`** (or known pre-#360 SHA) → same commands → tag `*-main-baseline.*`
3. Post tables to #501 using `summarize-issue-501.mjs` and Track A summary files

Optional: git worktree for local Track A only (needs `DATABASE_URL` pointing at dev DB):

```bash
git worktree add ../EduAI-main-baseline main
# run research:eval-rag from each worktree with different RESEARCH_PIPELINE_LABEL
```

---

## Orchestrated batch (s378)

```bash
cd apps/core
bash scripts/research/run-issue-501.sh latest    # or main-baseline
```

Runs Track A + Track B (all models) + C1/C2 sequentially. Edit the script to skip tracks or models.

---

## Deliverable checklist (#501)

- [ ] Date + git SHA + environment noted
- [ ] Track A retrieval table (20 prompts) — latest vs main
- [ ] Track B per-model latency table (96+ prompts)
- [ ] Track C load table (≥ C1 for all three models)
- [ ] Short interpretation posted on #501
- [ ] Materials confirmed indexed on dev

---

## Output layout

```
docs/research/data/runs/issue-501/
  track-a-{latest|main-baseline}.jsonl
  track-a-*-summary.txt
  track-b-{7b|32b|120b}-{latest|main-baseline}.jsonl
  track-c1-* ...
  track-c2-* ...
```
