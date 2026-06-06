# EduAI chat latency — investigation appendix

Companion to [**FINDINGS.md**](./FINDINGS.md) (team summary). This doc has methodology, session evidence, confounds, tooling, and raw data links.

> **Benchmark data:** Raw JSON/CSV is **not** in this branch. All artifacts below live on git branch **`troubleshoot-RAG-delay`** under [`apps/core/output/`](https://github.com/EduAI-Lab/EduAI/tree/troubleshoot-RAG-delay/apps/core/output) ([layout README](https://github.com/EduAI-Lab/EduAI/blob/troubleshoot-RAG-delay/apps/core/output/README.md)). See [Data files](#data-files-on-troubleshoot-rag-delay).

---

## Key numbers (Sessions 5–7)

Controlled runs: `deepseek-r1:8b`, dev → `cmps01`, residency logged, `COUNT=10 × REPEATS=3`.

### Warm, interleaved compare (Sessions 6 & 7)

| Metric | EduAI | Ollama-direct |
| ------ | ----: | ------------: |
| TTFT (median) | **191–200 ms** | model-side **128–129 ms** |
| EduAI app overhead | **≈ 62–72 ms** | — |
| Total (median) | **3,949–4,091 ms** | **2,189–2,194 ms** |
| Completion tokens (median) | **471–477** | **256** (capped) |
| ms per token | **≈ 8.4** | **≈ 8.6** |
| Decode throughput | — | **~133 tok/s** |

When token counts matched on the same prompt (e.g. ~170 tokens), totals matched (~**1.4 s**). When EduAI emitted **1,570** tokens vs Ollama’s **256**, total was **13.1 s vs 2.2 s**.

### Cold start (Session 6)

| Phase | Ollama | EduAI |
| ----- | -----: | ----: |
| Cold TTFT (1st req after unload + 6 min idle) | **9,137 ms** (model) | **9,576 ms** |
| Warm TTFT (median after) | **130 ms** | **187 ms** |
| Residency | `false` → `true` | `false` → `true` |

Cold penalty is almost entirely **model load to GPU** (`loadMs` ≈ 9,113 ms on Ollama cold row), not EduAI/RAG.

### Session 2 vs 4 (early runs, less controlled)

| Metric | Session 2 | Session 4 |
| ------ | --------: | --------: |
| TTFT median | 1,945 ms | 192 ms |
| Total median | 20,776 ms | 2,610 ms |

Explained by Session 6: cold/eviction + much longer generation in Session 2.

---

## Confidence levels

### High confidence

- Core/RAG is not the bottleneck (&lt; 15 ms pipeline; ~62 ms app TTFT overhead).
- Warm per-token decode is equal EduAI ≈ Ollama (~8.5 ms/token, ~133 tok/s).
- Cold model load costs ~9–10 s on first request after unload/idle.
- Session 2 vs 4 swing is cold GPU + token volume, not Core code.
- Production temperature 0.6 does not change the story (Session 7 ≈ Session 6).

### Partially open

- Perfect apples-to-apples total-time comparison — EduAI bench override and fresh-chat options were not fully applied in Sessions 6–7.
- Tool-calling path — not benchmarked.
- Reasoning vs instruct model — no instruct model on `cmps01`.
- Ollama vs bare-metal inference engine — not tested.

> **Historical retraction:** Early drafts claimed “Ollama is the bottleneck,” then “EduAI generates ~70× more tokens,” then prematurely “GPU warm/cold dominates.” Session 6+ confirms cold-start and token volume with measured numbers.

---

## Limitations and caveats

| # | Variable | Status |
| - | -------- | ------ |
| C1 | Shared GPU on `cmps01` | Logged via `/api/ps`; warm runs all `resident=true`. |
| C2 | Model warm/cold | Measured: ~9–10 s cold TTFT. |
| C3 | Output length not fixed | Ollama capped at 256; EduAI override not applied (477 median tokens). |
| C4 | Different inputs (system prompt, history) | Ollama had `system: null`; use `CHAT_BENCH_OLLAMA_SYSTEM` to mirror. |
| C5 | TTFT measured differently | Use Ollama `modelTtft = load+prompt_eval`; EduAI streaming TTFT. |
| C6 | Words vs tokens | Addressed in Session 5+. |
| C7 | Time-of-day / network | Partially addressed via interleaved `compare`. |
| C8 | Small sample | `REPEATS=3`, median + IQR. |
| C9 | No load/eval split on EduAI | Token counts captured; split Ollama-only. |
| C10 | History accumulation in bench | Fixed via `CHAT_BENCH_FRESH_CHAT=1`; not used in Sessions 6–7. |
| C11 | Temp asymmetry (Session 6) | Ollama @ 0, EduAI @ 0.6; Session 7 fixed (both @ 0.6). |

---

## Methodology

Agreed 2026-05-29; Sessions 6–7 executed Comparisons 1 & 2; Comparison 3 deferred.

**Decisions:**
- Benchmark-only override in `chat.ts` (`temperature`/`seed`/`maxTokens`), gated by admin API key + `CHAT_BENCH_ALLOW_OVERRIDE=1`.
- No exclusive GPU window — log residency per request; flag evicted runs.
- Document method → build tooling → run.

| Step | Action | Neutralizes |
| ---- | ------ | ----------- |
| 0 | `GET /api/ps` before each request | C1, C2 |
| 1 | Pin temp/seed/maxTokens; identical prompt; Ollama `/api/chat` + system mirror | C3, C4 |
| 2 | Ollama model-reported timings; EduAI data-stream token counts | C5, C6, C9 |
| 3 | Warm vs cold matrix (unload + idle) | C2 |
| 4 | Interleave EduAI ↔ Ollama per prompt | C7 |
| 5 | `REPEATS≥3`; median + IQR | C8 |
| 6 | Persist to `apps/core/output/<session>/` | — |

**Three comparisons:**
1. **Matched-warm EduAI vs Ollama** — Sessions 6 & 7; overhead ≈ 62 ms.
2. **Cold − warm** — Session 6; ~9 s TTFT penalty.
3. **Reasoning vs instruct** — deferred.

---

## Instrumentation

| What | Where | Enable |
| ---- | ----- | ------ |
| Pipeline step timing (`[rag-pipeline]`) | `rag-pipeline-log.ts`, `chat.ts`, `embedding.ts` | `CHAT_RAG_LATENCY_LOG=1` |
| TTFT + tool-step logging | `streamText` hooks in `chat.ts` | same |
| Ollama cold/warm hint | `ragPipelineNoteModel` | same |
| Latency benchmark | `scripts/chat-latency-bench.mjs` | see [How to run](#how-to-run) |
| Suite orchestrator | `scripts/chat-latency-suite.mjs` | `--session=<name>` |

### Tooling built

**`chat-latency-bench.mjs`:**
- `/api/ps` residency probe per request
- Ollama `modelTtft = load+prompt_eval`
- EduAI data-stream `completionTokens` / `promptTokens`
- `CHAT_BENCH_REPEATS` + median + IQR
- `CHAT_BENCH_TARGET=compare` (interleaved)
- `CHAT_BENCH_TEMPERATURE` / `SEED` / `NUM_PREDICT`
- `CHAT_BENCH_FRESH_CHAT=1` (new chat per prompt)
- Ollama `/api/chat` + optional `CHAT_BENCH_OLLAMA_SYSTEM`

**`chat-latency-suite.mjs`:** multi-scenario runner → JSON/CSV, logs, `manifest.json`.

**`chat.ts`:** gated `benchOverride` (admin key + `CHAT_BENCH_ALLOW_OVERRIDE=1`).

Deterministic EduAI comparison requires server env `CHAT_BENCH_ALLOW_OVERRIDE=1` and admin API key auth.

---

## How to run

Set bench env once (`CHAT_BENCH_URL`, `CHAT_BENCH_MODEL`, API key, `CHAT_BENCH_OLLAMA_*`, `CHAT_BENCH_COUNT`, `CHAT_BENCH_REPEATS`), then from `apps/core`:

```bash
# Warm interleaved compare:
node ./scripts/chat-latency-suite.mjs --session=session6-matched-warm compare

# Production temperature (0.6):
CHAT_BENCH_TEMPERATURE=0.6 node ./scripts/chat-latency-suite.mjs --session=session7-prod-temp06 compare

# Cold start:
CHAT_BENCH_COLD=1 CHAT_BENCH_UNLOAD=1 CHAT_BENCH_WARMUP=0 node ./scripts/chat-latency-suite.mjs --session=session6-cold-ollama ollama
CHAT_BENCH_COLD=1 CHAT_BENCH_WARMUP=0 node ./scripts/chat-latency-suite.mjs --session=session6-cold-eduai eduai

# All scenarios (eduai + ollama + compare):
node ./scripts/chat-latency-suite.mjs --session=warm-deepseek
```

Output on **`troubleshoot-RAG-delay`**: `apps/core/output/<session>/` — each session has `results/*`, optional `logs/*`, and `manifest.json` ([README](https://github.com/EduAI-Lab/EduAI/blob/troubleshoot-RAG-delay/apps/core/output/README.md)).

**Acceptance bar:** ≥3 repeats, residency logged, identical prompts + pinned params, model-reported timings for Ollama path.

**Copy from server** — scp the session folder, not the whole `output/` dir (avoids nested `output/output/`):

```powershell
scp -r "user@host:/path/to/apps/core/output/session7-prod-temp06" "C:\...\apps\core\output\"
```

---

## Data files (on `troubleshoot-RAG-delay`)

This docs branch (**`docs/ai-latency-experiment`**) contains write-ups only. Raw benchmark artifacts are tracked on investigation branch **`troubleshoot-RAG-delay`**.

**Checkout locally:**

```bash
git fetch origin troubleshoot-RAG-delay
git checkout troubleshoot-RAG-delay -- apps/core/output
# or: git switch troubleshoot-RAG-delay
```

**Browse on GitHub:** [apps/core/output/](https://github.com/EduAI-Lab/EduAI/tree/troubleshoot-RAG-delay/apps/core/output) · [README (layout index)](https://github.com/EduAI-Lab/EduAI/blob/troubleshoot-RAG-delay/apps/core/output/README.md)

| Session | Surface | Path on `troubleshoot-RAG-delay` | Notes |
| ------- | ------- | -------------------------------- | ----- |
| 3 | Ollama-direct | `apps/core/output/session3-ollama-direct/results/ollama.{json,csv}` | Early; `/api/generate`; buffered TTFT |
| 4 | EduAI | `apps/core/output/session4-eduai-deepseek/results/eduai.{json,csv}` | Warm repeat |
| 5 | Suite | `apps/core/output/session5-warm-deepseek/` | First controlled suite; includes `logs/` |
| 6 warm | `compare` | `apps/core/output/session6-matched-warm/` | Comparison 1 |
| 6 cold | `ollama` / `eduai` | `apps/core/output/session6-cold-ollama/`, `session6-cold-eduai/` | Comparison 2 |
| 7 | `compare` @ 0.6 | `apps/core/output/session7-prod-temp06/` | Production temperature |
| 8 | `qwen2.5:7b` suite | `apps/core/output/session8-qwen-warm/` | Tool path; EduAI vs Ollama |
| 9 | maxTokens sweep | `apps/core/output/session9-maxtokens-sweep/` | `results/cap-*.json` + `comparison.json` (when run) |
| — | Probe | `apps/core/output/session-probe/` | Smoke / residency check |

Sessions 1–2: `[rag-pipeline]` server logs / terminal scrollback only (not in `output/`).

Bench scripts and `[rag-pipeline]` instrumentation also live on **`troubleshoot-RAG-delay`** (`apps/core/scripts/chat-latency-bench.mjs`, `chat-latency-suite.mjs`, `apps/core/app/lib/rag-pipeline-log.ts`).

---

## Evidence by session

### Session 1 — `[rag-pipeline]` server logs

Models: `deepseek-r1:8b` (hybrid), `gemma4:31b` (tool). No course on most turns.

| traceId | Model | Path | Pre-LLM | TTFT | Total |
| ------- | ----- | ---- | ------- | ---- | ----- |
| 3aa96796 | deepseek-r1:8b | hybrid | 14 ms | 7,156 ms (cold) | 7.4 s |
| 52344a88 | deepseek-r1:8b | hybrid | 9 ms | 1,774 ms (warm) | 2.3 s |
| e437e7ea | deepseek-r1:8b | hybrid | 8 ms | 12,139 ms | 12.6 s |
| 0240c25c | gemma4:31b | tool_calling | 8 ms | (none) | 23.1 s |
| d57b45f0 | gemma4:31b | tool_calling | 15 ms | (none) | 21.7 s |

- Core overhead &lt; 15 ms every run.
- No `rag.*` steps on these turns (`isRAGQuery: false`; tools not invoked).
- Cold/warm pattern matches model residency.
- Tool path: no early token logged; ~20+ s before visible output.

### Session 2 — EduAI benchmark (early)

| Metric | Median | Min | Max |
| ------ | -----: | --: | --: |
| TTFT | 1,945 ms | 447 ms | 10,500 ms |
| Gen | 17,392 ms | 7,884 ms | 29,772 ms |
| Total | 20,776 ms | 9,883 ms | 31,823 ms |

~88% of total is generation. One TTFT spike to 10.5 s (eviction mid-session).

### Session 3 — Ollama-direct (early)

Via `/api/generate`; wall TTFT unreliable (buffered NDJSON). Trust `eval_duration` (~136 tok/s) and `load_duration` (~150 ms when resident). Do not compare directly to Session 2.

### Session 4 — EduAI repeat

| Metric | Median |
| ------ | -----: |
| TTFT | 192 ms |
| Total | 2,610 ms |
| Gen | 2,429 ms |

Warm; ~8× faster than Session 2 (see cold + token explanation in Session 6).

### Session 5 — first controlled suite (all warm)

132 requests, all `resident=true`.

| Metric | EduAI | Ollama |
| ------ | ----: | -----: |
| TTFT | 194 ms | model 129 ms |
| Total | 3,964 ms | 2,210 ms |
| Tokens (median) | 471 | 256 |
| ms/token | ~8.4 | ~8.6 |

Override not applied on EduAI; C10 history accumulation observed.

### Session 6 — Comparisons 1 & 2

See [Key numbers](#key-numbers-sessions-57). Interleaved examples:

| Prompt | EduAI | Ollama |
| ------ | ----- | ------ |
| #1 rep 1 | 1,469 ms / 165 tok | 1,377 ms / 159 tok |
| #9 rep 3 | 14,503 ms / 1,741 tok | 2,197 ms / 256 tok |

### Session 7 — production temp 0.6

Repeat of Comparison 1 at `temperature=0.6` both surfaces. All metrics within noise of Session 6. `promptTokens` still climb to 276 (fresh chat not enabled).

### Session 8 — Qwen tool path (`qwen2.5:7b`)

Warm suite: eduai + ollama + compare. Model: `ollama:qwen2.5:7b`. Qwen has **`supportsTools: true`** in admin → EduAI uses **`tool_calling`** branch; Ollama-direct sends bare prompts only. Data: [`session8-qwen-warm/`](https://github.com/EduAI-Lab/EduAI/tree/troubleshoot-RAG-delay/apps/core/output/session8-qwen-warm) on **`troubleshoot-RAG-delay`**.

**Interpretation: EduAI slower than Ollama-direct is expected** — not a bug and not comparable to Sessions 6–7 (DeepSeek **hybrid** path).

| Metric | EduAI (`tool_calling`) | Ollama-direct | Notes |
| ------ | ---------------------: | ------------: | ----- |
| TTFT median (compare) | **1,004 ms** | **468 ms** | EduAI: pipeline + tool-ready stream |
| Total median (compare) | **6,233 ms** | **1,350 ms** | Different paths + token counts |
| Completion tokens median | **121** | **25** | Bench prompts short; EduAI still longer |
| Pre-LLM pipeline (Session 1 pattern) | &lt; 15 ms when logged | n/a | Bottleneck is not Core/RAG setup |

**Why EduAI totals are higher:**

1. **Different code path** — `tool_calling` (tools, large system prompt, `maxSteps`) vs one-shot Ollama `/api/chat`.
2. **Not apples-to-apples with DeepSeek benches** — `deepseek-r1:8b` uses **hybrid RAG** (~62 ms TTFT overhead when warm); Qwen uses **tools**.
3. **Bench did not set `CHAT_BENCH_COURSE_CODE`** — `getInformation` may not run every turn; overhead is still the tool-enabled **product** path, not “model only.”
4. **Variable generation** — some EduAI rows 10–18 s (longer outputs / possible tool steps); Ollama capped shorter replies on many prompts.

**Next run (optional):** same session config + `CHAT_BENCH_COURSE_CODE=<course with materials>` + prompts that require course content → measure real embed + `getInformation` latency with `[rag-pipeline]` logs.

---

## Open items

- [x] Build tooling
- [x] Comparison 1 (warm interleaved) — Sessions 6 & 7
- [x] Comparison 2 (cold − warm) — Session 6
- [x] Production temperature check — Session 7
- [x] Tool-path warm benchmark — Session 8 (`qwen2.5:7b`); course-aware re-run optional
- [ ] Comparison 3 — reasoning (`deepseek-r1`) vs instruct (`llama3.1:8b` / hybrid qwen)
- [ ] Mitigations: `OLLAMA_KEEP_ALIVE`, maxTokens cap, dedicated inference server

---

## Changelog

- **2026-05-28** — Created. Sessions 1–2. Premature “Ollama bottleneck” claim (retracted).
- **2026-05-28** — Session 3 (Ollama-direct). Retracted “EduAI 8.5× slower” claim.
- **2026-05-29** — Session 4. Brief “GPU dominates” claim (refined).
- **2026-05-29** — Walked back root-cause claims; documented confounds C1–C9; controlled protocol; tracked `apps/core/output/`.
- **2026-05-29** — Agreed methodology; gated bench override decision.
- **2026-05-29** — Session 5: overhead ≈ 65 ms; per-token parity; found C10.
- **2026-05-29** — Session 6: Comparisons 1 & 2; cold ~9–10 s; Session 2 vs 4 explained.
- **2026-05-29** — Session 7: temp 0.6; C11; scp tip.
- **2026-05-29** — Restructured: team summary → `FINDINGS.md`; details → this appendix.
- **2026-05-29** — **Session 8** (`session8-qwen-warm`, `qwen2.5:7b`): EduAI slower than Ollama-direct documented as **expected** — `tool_calling` path vs bare Ollama; not comparable to DeepSeek hybrid benches (Sessions 6–7).
