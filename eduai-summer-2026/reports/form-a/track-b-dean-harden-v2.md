# Track B — Dean harden + Teacher anchor restore

**Code PR:** [EduAI #1174](https://github.com/EduAI-Lab/EduAI/pull/1174) · branch `feat/adhd-dean-track-b-harden`  
**Policy stamp:** `ADHD_ASSIST_POLICY_VERSION = "2.1"` (do **not** pool with v1.x freeze or broken v2.0 cohorts)

## Headline findings (read this first)

**Current / fixed state = policy v2.1.** Prompt-only is restored (~86% profile). The 9% figure below is a **temporary v2.0 regression that is fixed** — do not cite it as the branch outcome.

Matched protocol vs Paper 1 freeze: Gemini 2.5 Flash, `seed_course_cosc101`, scenarios **S1/S2/S3/S5/S2L** (14 turns/arm).

| Arm | Metric | Freeze (v1.1) | Broken intermediate (v2.0) | **Fixed now (v2.1)** |
|-----|--------|--------------:|---------------------------:|---------------------:|
| Baseline | strict | 0% | 0% | *(unchanged)* |
| Prompt-only | strict | **67%** | ~~0%~~ | **~81%** (n=3) |
| Prompt-only | profile | **76%** | ~~9%~~ | **~86%** (n=3) |
| Oversight | strict | **71%** | **77%** | *(Dean unchanged; keep Track B)* |
| Oversight | profile | **80%** | **87%** (late **97%**) | *(Dean unchanged; keep Track B)* |

**Bottom line**

1. **Dean / oversight** — Track B fail-closed works (profile 80% → 87% on the v2.0 5×). Keep it.
2. **Prompt-only** — briefly hit ~~9%~~ when Teacher absorbed UI-only TLDR/Continue; **v2.1 restores ~86%**. Fixed.
3. **Baseline** — still ~0% structural pass.
4. Paper 1 freeze numbers stay authoritative until a full three-arm **v2.1** 5× re-freeze. Do not pool v1.x / v2.0 / v2.1.

---

## What shipped in code (#1174)

### Dean (Track B, policy 2.0)

1. **No fail-open:** rejected/failed LLM rewrites → one retry with reject reasons → `forced_deterministic` wrap.
2. **Dean context:** rewrite prompt includes learner message + profile Teacher policy slice.
3. **Anchor normalization:** `* Top summary` → `**Top summary**`; forward-offer `Next?` → `**Next?**`.
4. **Sources when tools/RAG ran:** `toolsUsed` → require Sources footer.
5. **Telemetry:** `llm_retry`, `forced_deterministic`.

### Teacher (policy 2.1 — prompt-only recovery)

- Require exact first line `**Top summary**` and last structural line starting `**Next?**`.
- Ship a copyable output skeleton.
- Ban renaming to TLDR/Continue in the **model-facing** policy (UI remapping stays client-only in `assistive-display-transform.ts`).
- Dean Track B logic unchanged.

### Eval / telemetry plumbing

- Eval requires `EDUAI_COURSE_ID` / `EDUAI_COURSE_CODE` (course-scoped chats since #657).
- Restored **S2L** + `profileStructuralPass` in `eval-adhd-assist.mjs`.
- Non-streaming turns now log `response_compliance` (baseline + prompt-only were invisible before).
- `report-adhd-metrics.ts` breaks Assist turns down by `oversightMethod`.

---

## Arm-by-arm evaluation results

### A. Smoke three-arm (n=8 turns each) — 2026-07-24

`eval-runs/2026-07-24-trackb/`, course `MATH 320`, S1/S2/S3/S5 only (no S2L). Policy **2.0**.

| Arm | Strict | Profile |
|-----|-------:|--------:|
| Baseline | 0/8 | 0/8 |
| Prompt-only | 0/8 | 1/8 |
| Oversight | 7/8 | 8/8 |

Useful only as a smoke that fail-closed Dean works. Prompt-only already looked wrong here (Teacher issue).

### B. Matched 5× three-arm under v2.0 — 2026-07-25

`eval-runs/trackb-repeat-v2/gemini-2.5-flash/`, git `a8397474`, course `COSC 101`, S1/S2/S3/S5/S2L, **5 repeats × 14 turns = 70 turns/arm**.

| Arm | Metric | Overall | Late-turn | Freeze |
|-----|--------|--------:|----------:|-------:|
| Baseline | strict | 0% | 0% | 0% |
| Prompt-only | strict | **0%** | 0% | 67% |
| Prompt-only | profile | **9%** (0–14%) | 9% | 76% |
| Oversight | strict | **77%** (64–86%) | 83% | 71% |
| Oversight | profile | **87%** (71–100%) | **97%** (86–100%) | 80% |

**Oversight path histogram** (70 Assist+Dean turns, policy 2.0):

| Method | Turns | Share | Profile pass |
|--------|------:|------:|-------------:|
| `none` | 24 | 34% | 100% |
| `llm` | 19 | 27% | **53%** |
| `forced_deterministic` | 13 | 19% | 100% |
| `deterministic` | 13 | 19% | 100% |
| `llm_retry` | 1 | 1% | 100% |

Reading:

- Prompt-only: across 70 turns, literal `**Top summary**` appeared **0** times; bold `**Next?**` only **4** times (plain `Next?` 55, `Step ladder` 30). Spirit of the policy, wrong tokens.
- Oversight: Track B new paths (`forced_deterministic` + `llm_retry`) carried ~20% of the arm; under old fail-open those would have shipped non-compliant.
- Remaining Dean gap: `acceptLlm` accepts score *improvement*, so 47% of accepted `llm` rewrites still miss full profile pass.

**Note on an earlier “model drift” A/B:** a plain-systemPrompt A/B (Assist off) also failed to emit anchors under freeze-era v1.1 text. That suggested provider drift, but **v2.1 Teacher hardening restored prompt-only without changing the model id**, so the actionable bug was the model-facing TLDR/Continue language + weak literal-token requirements. Treat the A/B as inconclusive; treat the before/after prompt-only rates as decisive.

### C. Prompt-only recovery under v2.1 — 2026-07-25

`eval-runs/trackb-v21-prompt-restore/gemini-2.5-flash/prompt-only/`, Dean off on :3010. Three complete repeats before a provider 429 cut runs 04–05.

| Run | Strict | Profile |
|-----|-------:|--------:|
| r01 | 11/14 (79%) | 12/14 (86%) |
| r02 | 11/14 (79%) | 12/14 (86%) |
| r03 | 12/14 (86%) | 12/14 (86%) |
| **mean (n=3)** | **81%** | **86%** |

Prompt-only is back at or above freeze. Full three-arm 5× under **v2.1** still recommended before replacing paper numbers.

---

## How to re-run locally

### Unit

```bash
cd apps/core && nvm use 20.19.0
npx vitest run \
  app/tests/unit/adhd-oversight.test.ts \
  app/tests/unit/adhd-metrics.test.ts \
  app/tests/unit/adhd-assist.test.ts \
  app/tests/unit/assistive-events.server.test.ts \
  app/tests/unit/chat-oversight.route.test.ts \
  app/tests/unit/eval-adhd-assist.test.ts
```

### Three-arm synthetic (matched freeze set)

```bash
# Prompt-only needs a second Core with Dean off:
ADHD_ASSIST_OVERSIGHT=false npx react-router dev --port 3010

cd apps/core
export EDUAI_COOKIE='better-auth.session_token=<token>'   # admin@eduai.local
export EDUAI_MODEL=google:gemini-2.5-flash
export EDUAI_API_KEYS_JSON='{}'
export EDUAI_COURSE_ID=seed_course_cosc101

# baseline + oversight on :3000; prompt-only on :3010
node ../../eduai-summer-2026/reports/scripts/run-paper1-frozen-eval-repeat.mjs \
  --arm baseline --repeats 5 --model google:gemini-2.5-flash \
  --out-root eval-runs/trackb-v21-repeat/gemini-2.5-flash
# …repeat for prompt-only (EDUAI_BASE_URL=http://localhost:3010) and oversight
```

Aggregate:

```bash
node ../../eduai-summer-2026/reports/scripts/aggregate-paper1-frozen-eval.mjs \
  --baseline eval-runs/trackb-v21-repeat/gemini-2.5-flash/baseline \
  --prompt-only eval-runs/trackb-v21-repeat/gemini-2.5-flash/prompt-only \
  --oversight eval-runs/trackb-v21-repeat/gemini-2.5-flash/oversight \
  --repeated --out eduai-summer-2026/reports/form-a/trackb-v21-eval-numbers.md
```

Telemetry histogram:

```bash
npx tsx ../../eduai-summer-2026/reports/scripts/report-adhd-metrics.ts \
  --since <ISO> --event response_compliance
```

---

## Measurement caveats

1. **`preStructuralPass` is post-normalization** — do not use it as a prompt-only proxy.
2. **Within-scenario Dean contamination** — later drafts in the oversight arm imitate prior rewritten turns (`none` can look high even when prompt-only is low).
3. **Policy stamps are not poolable** — v1.x freeze ≠ v2.0 broken Teacher ≠ v2.1 restored.

---

## Research use

| Question | Answer from these runs |
|----------|------------------------|
| Does fail-closed Dean help RQ3? | Yes — oversight profile 80% → 87% (v2.0 5×), with forced wraps closing fail-open misses |
| Did Track B break prompt-only? | Indirectly via Teacher TLDR language already in the policy; **v2.1 restores ~86% profile** |
| How often is forced wrap? | ~19% of oversight turns under v2.0 5× |
| Ready to replace freeze numbers? | Not yet — run full three-arm 5× under **v2.1** first |

Paper 1 freeze (`paper1-frozen-eval-numbers.md`) stays the cited Study 1 numbers until PI re-freezes.
