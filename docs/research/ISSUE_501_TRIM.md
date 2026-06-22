# Issue #501 — Trimmed Runbook

**~15–30 min** comparison of **latest RAG pipeline** vs **`main` baseline** (without the full 3–5 hour batch).

For presentation-ready results, see **[ISSUE_501_TRIM_REPORT.md](./ISSUE_501_TRIM_REPORT.md)**.

---

## Tracks at a glance

| Track | Time | Question | RAG quality? |
|-------|------|----------|:------------:|
| **A** — Retrieval | ~1 min | Can we find relevant chunks? | **Yes** |
| **B** — Sequential chat | ~4–6 min | Does `/api/chat` work? | No |
| **C** — Classroom load | ~2 min | Does concurrency work? | No |

**Skipped vs full #501:** 32B model, 96-prompt sweep, 100-student C1/C2 stress.

---

## Time budget

| Step | Duration | Notes |
|------|----------|-------|
| Track A | ~1 min | Needs `DATABASE_URL`. **On dev → COSC 121 only** |
| Track B | ~4–6 min | 12 prompts × 7B |
| Track C | ~2 min | 30 students, c=5 |
| **One pipeline** | **~8–10 min** | |
| **Both (parallel)** | **~10–15 min** | dev = latest, my.eduai = main |
| **Both (sequential)** | **~18–22 min** | Redeploy between runs |

---

## Run commands

### Latest on dev (s378)

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
set -a && source .env && source .env.research && set +a

export RESEARCH_RUN_URL=http://127.0.0.1:3000/api/chat
export ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy
export RESEARCH_MEASURE_ENERGY=1
npm run research:verify-energy
bash scripts/research/run-issue-501-trim.sh latest --with-energy
```

### Track A only — COSC 121 (20 prompts)

Dev `.env` sets `RESEARCH_RUN_LIMIT=2`. Override **after** sourcing `.env`:

```bash
set -a && source .env && set +a
export RESEARCH_PROMPTS_FILE=scripts/research/data/task-suite/prompts-cosc121-rag.v1.jsonl
export RESEARCH_RUN_LIMIT=20
export RESEARCH_EVAL_RAG_OUT=../../docs/research/data/runs/issue-501-trim/track-a-latest-cosc121.jsonl
export RESEARCH_EVAL_RAG_SUMMARY=../../docs/research/data/runs/issue-501-trim/track-a-latest-cosc121-summary.txt
npm run research:eval-rag
```

Tracks **B** and **C** do not need a COSC 121 rerun.

### Main baseline on my.eduai (s348)

```bash
cd /path/to/EduAICore/apps/core
set -a && source .env && source .env.research && set +a
export RESEARCH_RUN_URL=http://127.0.0.1:3000/api/chat
RESEARCH_ISSUE_501_SKIP=A bash scripts/research/run-issue-501-trim.sh main-baseline --with-energy
```

Skip Track A if `DATABASE_URL` does not point at the dev DB with indexed materials.

### Compare pipelines

```bash
node scripts/research/compare-issue-501-trim.mjs docs/research/data/runs/issue-501-trim
```

Merge both hosts' `issue-501-trim/` folders into one directory if you ran in parallel.

---

## Interpreting results

| Track | Look for |
|-------|----------|
| **A** | Fetch rate ↑, strong-match rate ↑, median fetch time ↓ |
| **B** | Success rate, median response time, slow-tail response time, energy per prompt |
| **C** | Success under concurrency, wall time, per-wave energy |

Empty `rag_chunk_count` on B/C is expected on dev (most courses lack materials). Not a pass/fail criterion for those tracks.

---

## Outputs

```
docs/research/data/runs/issue-501-trim/
  track-a-latest-cosc121.jsonl
  track-b-7b-*.jsonl
  track-c1-7b-*.jsonl
```

**Track B prompt IDs:** `ts-020, ts-023, ts-025, ts-033, ts-044, ts-047, ts-070, ts-075, ts-081, ts-087, ts-104, ts-111`

Override: `RESEARCH_TRIM_PROMPT_IDS=...`

---

## Energy setup

| URL | Purpose |
|-----|---------|
| `http://cmps01.ok.ubc.ca:8001/v1/*` | LiteLLM / vLLM |
| `http://cmps01.ok.ubc.ca:8001/energy/*` | NVML sidecar |

Runs must execute **on s378** — laptops often cannot reach cmps01.

```bash
export ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy
export RESEARCH_MEASURE_ENERGY=1
npm run research:verify-energy   # expect ~15–20 J GPU probe
```

Use `--with-energy` on the trim script, or set `RESEARCH_MEASURE_ENERGY=1` in `.env`.
