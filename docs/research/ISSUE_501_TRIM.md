# Issue #501 — trimmed run (15–30 min)

Focused comparison of **latest RAG pipeline** vs **`main` baseline** without the full 3–5 hour batch.

## What it proves

| Track | Time | What improves on latest |
|-------|------|-------------------------|
| **A** — retrieval only | ~1 min | Higher hit / strong-hit rate; lower retrieval latency (hybrid BM25, chunking, per-course settings) |
| **B** — 12 fixed RAG chat prompts (7B) | ~4–6 min | End-to-end latency + success on course-grounded questions |
| **C** — 30 students @ c=5 (7B) | ~2 min | Load behavior under classroom concurrency |

**Skipped vs full #501:** 32B model, 96-prompt sweep, 100-student C1/C2 stress.

## Time budget

| Step | Per pipeline | Notes |
|------|--------------|-------|
| Track A | ~1 min | Needs `DATABASE_URL` (same DB as deployed app) |
| Track B | ~4–6 min | 12 prompts × 7B, 200 ms sleep |
| Track C | ~2 min | Matches prior 30-student reference run |
| **One pipeline total** | **~8–10 min** | |
| **Both pipelines (parallel)** | **~10–15 min** | dev = latest, my.eduai = main |
| **Both pipelines (sequential)** | **~18–22 min** | Redeploy between runs on one host |

## Run commands

### 1. Latest on dev (s378)

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
set -a && source .env && source .env.research && set +a

export RESEARCH_RUN_URL=http://127.0.0.1:3000/api/chat
bash scripts/research/run-issue-501-trim.sh latest
# optional energy:
# bash scripts/research/run-issue-501-trim.sh latest --with-energy
```

### 2. Main baseline on my.eduai (s348) — parallel option

```bash
cd /path/to/EduAICore/apps/core   # main branch deploy
set -a && source .env && source .env.research && set +a

export RESEARCH_RUN_URL=http://127.0.0.1:3000/api/chat
# Track A needs dev DB — skip on my if DATABASE_URL points elsewhere:
RESEARCH_ISSUE_501_SKIP=A bash scripts/research/run-issue-501-trim.sh main-baseline
```

Or from laptop against public URLs (cookie / admin key in `.env.research`):

```powershell
cd apps/core
. .\scripts\research\load-research-env.ps1
$env:RESEARCH_RUN_URL = "https://my.eduai.ok.ubc.ca/api/chat"
$env:RESEARCH_ISSUE_501_SKIP = "A"
bash scripts/research/run-issue-501-trim.sh main-baseline
```

### 3. Compare

```bash
node scripts/research/compare-issue-501-trim.mjs \
  docs/research/data/runs/issue-501-trim
```

Copy both hosts' `issue-501-trim/` folders into one directory before comparing if you ran in parallel.

## Fixed Track B prompt IDs

Same 12 prompts on both pipelines (cross-course RAG):

`ts-020, ts-023, ts-025, ts-033, ts-044, ts-047, ts-070, ts-075, ts-081, ts-087, ts-104, ts-111`

Override: `RESEARCH_TRIM_PROMPT_IDS=...`

## Outputs

```
docs/research/data/runs/issue-501-trim/
  track-a-{latest|main-baseline}.jsonl
  track-a-*-summary.txt
  track-b-7b-*.jsonl
  track-c1-7b-*.jsonl
  track-c1-7b-*.txt
```

## Interpreting results for #501

Post `compare-issue-501-trim.mjs` output to the issue. Lead with **Track A**:

- **Hit rate ↑** → retrieval finds more relevant chunks
- **Strong-hit rate ↑** → top chunk above similarity threshold more often
- **Retrieval p50 ↓** → faster `findRelevantContent` (batch embeds, hybrid index)

Track B/C confirm the chat path still works under sequential and light concurrent load.
