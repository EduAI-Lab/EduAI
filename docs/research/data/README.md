# URA research data — runs and methodology

This folder holds **artifacts from the two-tier routing research program** (7B + 32B vLLM, LLM-judge labels, P0 vs P1 policy comparison, load simulation). Summaries (`.txt`) are tracked in git where noted; large JSONL run files are **gitignored** and live on disk or on the dev server (s378).

**Environment:** EduAI dev server `eduai-dev` (`ssaada08@dev.eduai.ok.ubc.ca`), app path  
`/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core`, research env in `.env.research`.

**Branch:** `feat/research-routing-vllm`

---

## Research pipeline (steps)

| Step | Script | Purpose |
|------|--------|---------|
| **4** | `npm run research:run-both-tier` | Baseline: every dev prompt × tier 1 (7B) and tier 3 (32B) |
| **4b** | `npm run research:label-both-tier` | LLM judge: `min_adequate_tier`, `tier_sensitive`, adequacy |
| **5** | `npm run research:run-policy` | P0 (always 32B) vs P1 (`model=auto`) on test/dev splits |
| **5 summary** | `npm run research:summarize-policy` | Latency + oracle gap vs labels |
| **5 merge** | `npm run research:merge-policy-v3` | Merge v2 runs + tool-stratum reruns → v3 |
| **5 spot-check** | `npm run research:spot-check-labels` | Stricter judge on 10 hard dev prompts |
| **6** | `npm run research:run-classroom` | Synthetic concurrent load (see below) |
| **6b** | `npm run research:summarize-classroom-replicates` | Mean ± std over replicate summary files |

Scripts live under `apps/core/scripts/research/`. Task suite: `apps/core/scripts/research/data/task-suite/prompts.v1.jsonl` (120 prompts; dev/test splits).

---

## Directory layout

```
docs/research/data/
├── README.md                 ← this file
└── runs/
    ├── both-tier.v1.jsonl           # Step 4 baseline (gitignored)
    ├── labels.v1.jsonl              # Step 4b labels (gitignored)
    ├── policy-runs-*.jsonl            # Step 5 JSONL (gitignored)
    ├── policy-summary-v2.txt        # Step 5 before tool fix (tracked)
    ├── policy-summary-v3.txt        # Step 5 final (tracked)
    ├── hard-spot-check-summary.v1.txt
    ├── hard-spot-check.v1.jsonl     # gitignored
    ├── classroom-sim-summary.v1.txt   # Step 6 P1 (tracked)
    ├── classroom-sim-p0-summary.v1.txt
    ├── classroom-sim-p1-r{1,2,3}.txt      # replicate summaries (tracked)
    ├── classroom-sim-p0-r{1,2,3}.txt
    ├── classroom-sim-replicates-summary.txt
    └── classroom-sim*.jsonl               # gitignored
```

---

## Documented test runs

### Step 4 — Both-tier baseline (`both-tier.v1.jsonl`)

- **96 dev prompts** × tier 1 + tier 3 → 192 paired rows (deduped from 203 lines if reruns present).
- **Workaround:** `forceHybridRag: true` for non-tool prompts; 32B multi-step tool calling hangs on dev.
- **Local copy:** `runs/both-tier.v1.jsonl` (gitignored).

### Step 4b — LLM judge labels (`labels.v1.jsonl`)

- Judge via EduAI 32B (`RESEARCH_JUDGE_VIA_EDUAI=1`).
- **96/96** labeled; initial 7 JSON parse failures retried successfully.
- **Caveat (reviewers):** Same-stack 32B judge may be lenient — 100% `min_adequate_tier=1`, 0% `tier_sensitive` on full dev set. See spot-check below.

### Step 5 — Policy comparison

| Version | What changed | Test split | P1 dev |
|---------|----------------|------------|--------|
| **v1** | First run; P1 routed to Google Gemini → HTTP 400 | P1 6/24 OK | 32/96 OK |
| **v2** | vLLM-only routing fix; tool prompts still timeout | 46/48 OK | 91/96 OK |
| **v3** | Hybrid web-tool prefetch for `webSearch` / `fetchPage` | **48/48 OK** | **96/96 OK** |

**Policies:**

- **P0:** `vllm:qwen2.5-32b-instruct` (always tier 3).
- **P1:** `model=auto` (rule-based router, local vLLM only).

**Key v3 results** (`policy-summary-v3.txt`):

- Test: P0 mean **11.7s**, P1 mean **11.2s**; P1 routing tier1=6, tier3=18.
- P1 dev oracle gap: **33.3%** correct tier vs labels, **0%** under-routed, **64** over-routed.
- Tool stratum: 7/7 OK with `tool_execution_mode: hybrid_prefetch`.

**JSONL (gitignored):** `policy-runs-test.v3.jsonl`, `policy-runs-p1-dev.v3.jsonl`.

### Step 5b — Strict hard-prompt spot-check

- **10 hard dev prompts**, stricter judge prompt (`spot-check-hard-labels.mjs`).
- **9/10** agree with original `min_adequate_tier=1`; **1 disagree** (`ts-037` → strict says tier 3).
- **2/10** `tier_sensitive` under strict judge (`ts-037`, `ts-118`).
- Summary: `hard-spot-check-summary.v1.txt`.

### Step 6 — Classroom load simulation

#### What it is

A **synthetic concurrent HTTP load benchmark**, not a field study or real classroom experiment.

The script (`run-classroom-sim.mjs`):

1. Assigns each of **N students** (default 30) one prompt from the **test split** (cycles if N > 24).
2. Sends requests in **waves** of **C concurrent** `POST /api/chat` calls (default C=5) via `Promise.all`, then the next wave.
3. Uses the same research flags as Step 5 (`forceHybridRag`, `hybridWebTools` for tool prompts).
4. Records client-side `duration_ms`, `routing_tier`, wall time, p50/p95.

This models *“several students submit at once on one shared GPU host”* aligned with the latency doc scenario (30 students, 5 simultaneous). It does **not** model think time, multi-turn chats, staggered arrivals, or distinct student accounts.

#### Defensibility for reviewers

| Appropriate claim | Do not claim |
|-------------------|--------------|
| Tail latency grows under concurrent load on one vLLM host (queueing) | Real classroom learning outcomes |
| P0 vs P1 comparison under identical load pattern | Production SLA without repeats / CIs |
| Complement to sequential Step 5 latency | Organic lab session without stating synthetic workload |

**Strengthening (optional):** repeat runs (mean ± std), P0 vs P1 same sim, vary concurrency (1/5/10), join server `AIInteraction` telemetry.

#### Documented runs

**Pilot (single run each):**

| Run | Policy | mean (ms) | p95 (ms) | wall (s) | Summary |
|-----|--------|-----------|----------|----------|---------|
| classroom-v1 | P1 | 11163 | 22062 | 109 | `classroom-sim-summary.v1.txt` |
| classroom-p0-v1 | P0 | 11914 | 19253 | 103 | `classroom-sim-p0-summary.v1.txt` |

**Replicates (3 runs each — use for paper):** `npm run research:summarize-classroom-replicates`  
Aggregate: `classroom-sim-replicates-summary.txt`

| Policy | mean (ms) | p50 (ms) | p95 (ms) | wall (s) | tier1 / tier3 |
|--------|-----------|----------|----------|----------|---------------|
| P1 (n=3) | 10977 ± 95 | 11774 ± 432 | 20230 ± 1667 | 103.3 ± 1.3 | 9 / 21 |
| P0 (n=3) | 11439 ± 213 | 11420 ± 573 | 20361 ± 3046 | 100.8 ± 3.7 | 0 / 30 |

Per-run files: `classroom-sim-p1-r{1,2,3}.txt`, `classroom-sim-p0-r{1,2,3}.txt`.

**P1 vs P0 (replicate means):** P1 mean latency **~4% lower** than P0 (11.0s vs 11.4s). p95 is similar (~20s both); high variance on tails (±1.7–3.0s) — report as mean ± std, not single runs.

Both policies show p95 > p50 vs ~11s sequential Step 5 mean → queueing on a single GPU host.

**Batch replicates on s378:** `bash scripts/research/run-classroom-replicates.sh` (from `apps/core`).

**JSONL (gitignored):** `classroom-sim*.jsonl`, `/tmp/classroom-*-r*.jsonl` on server.

#### How to run (on s378)

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
set -a && source .env.research && set +a

# P1 (auto routing)
RESEARCH_CLASSROOM_POLICY=P1 \
RESEARCH_CLASSROOM_STUDENTS=30 \
RESEARCH_CLASSROOM_CONCURRENCY=5 \
RESEARCH_CLASSROOM_OUT=/tmp/classroom-sim.v1.jsonl \
RESEARCH_CLASSROOM_SUMMARY=/tmp/classroom-sim-summary.v1.txt \
node ./scripts/research/run-classroom-sim.mjs

# P0 (always 32B)
RESEARCH_CLASSROOM_POLICY=P0 \
RESEARCH_CLASSROOM_OUT=/tmp/classroom-sim-p0.v1.jsonl \
RESEARCH_CLASSROOM_SUMMARY=/tmp/classroom-sim-p0-summary.v1.txt \
node ./scripts/research/run-classroom-sim.mjs
```

---

## Reproducing locally

From `apps/core` with `RESEARCH_RUNS_DIR` pointing at this `runs/` folder and `.env.research` credentials (or env vars) for the dev API:

```powershell
$env:RESEARCH_RUNS_DIR="../../docs/research/data/runs"
$env:RESEARCH_SUITE_DIR="./scripts/research/data/task-suite"
npm run research:summarize-policy
npm run research:merge-policy-v3
```

---

## Gitignore

Large JSONL artifacts are listed in `.gitignore` (`both-tier`, `labels`, `policy-runs*`, `classroom-sim*.jsonl`). **Text summaries** and this README are tracked for paper / PR reference.

---

## Known limitations (paper methods section)

1. **Single dev server**, not multi-tenant production.
2. **32B tool-calling path** unreliable; research uses hybrid prefetch for tool prompts.
3. **Judge labels** may be lenient; spot-check shows disagreement on at least one hard prompt.
4. **Classroom sim** is one-shot load test unless repeated; label as synthetic concurrent benchmark.
5. **P1 over-routes** to tier 3 vs oracle labels — safe but limits energy savings claims.

---

## Related docs

- Latency classroom walkthrough (conceptual): `docs/rag-ai/latency/eduai-summer-2026/SOLUTIONS_PLAN.md` (30 students, one GPU).
- Routing plan: `docs/rag-ai/routing/eduai-summer-2026/TEAM_ROUTING_LAYER_PLAN.md`.
