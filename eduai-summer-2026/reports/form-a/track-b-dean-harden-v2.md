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

Sample sizes: v2.0 cells = 5 repeats × 14 turns = **70 turns/arm** (210 total); v2.1 prompt-only = 3 complete repeats = **42 turns**.

**The single most diagnostic number** — literal anchor emission by the writer, Dean off:

| Token | v2.0 (70 turns) | **v2.1 (42 turns)** |
|-------|----------------:|--------------------:|
| `**Top summary**` (bold, line start) | **0** | **36 / 36 eligible** |
| `Top summary` (any form) | 0 | 36 |
| `**Next?**` (bold) | 4 | **36** |
| `Next?` (any form) | 55 | 36 |
| `Step ladder` | 30 | 30 |
| `TLDR` leakage into model output | 0 | 0 |

36 of 42 turns are non-redirect; the 6 redirect turns (`S2.t2`, `S2L.t2`) are expected to omit the full anchor set. So v2.1 anchor compliance on eligible turns is **36/36 = 100%**, versus 0/60 under v2.0.

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

Oversight methods on those 8 turns: `forced_deterministic` 3, `deterministic` 2, `none` 2, `llm` 1, `llm_retry` 1 — all 100% profile pass.

Telemetry on the same window (11 rows) gave the first Assist-on/off contrast: mean words **56.5 (off) vs 153.6 (on)**, Cohen's *d* **−1.20**; structural pass **0% vs 89%**; mean latency **2,723 ms vs 9,855 ms**, *d* **−1.02**. Only 2 of those rows were Assist-off, which is what exposed the logging gap below.

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

Oversight arm aggregate telemetry (71 logged Assist turns): mean **119.1 words**, mean **7,305 ms**/turn, structural pass **76%**.

**Per-turn profile pass, oversight vs prompt-only (each /5 repeats):**

| Turn | Oversight | Prompt-only | Turn | Oversight | Prompt-only |
|------|----------:|------------:|------|----------:|------------:|
| S1.t1 | 100% | 0% | S2L.t1 | 80% | 0% |
| S2.t1 | 60% | 0% | S2L.t2 | 40% | 60% |
| S2.t2 | 100% | 60% | S2L.t3 | 100% | 0% |
| S2.t3 | 100% | 0% | S2L.t4 | 80% | 0% |
| S3.t1 | 60% | 0% | S2L.t5 | 100% | 0% |
| S3.t2 | 100% | 0% | S2L.t6 | 100% | 0% |
| S5.t1 | 100% | 0% | | | |
| S5.t2 | 100% | 0% | | | |

Reading:

- Prompt-only: across 70 turns, literal `**Top summary**` appeared **0** times; bold `**Next?**` only **4** times (plain `Next?` 55, `Step ladder` 30). Spirit of the policy, wrong tokens. The only non-zero cells were the two redirect turns, which pass on shape alone.
- Oversight: Track B new paths (`forced_deterministic` + `llm_retry`) carried **14/71 turns (~20%)** of the arm; under old fail-open those would have shipped non-compliant.
- Remaining Dean gap: `acceptLlm` accepts score *improvement*, so **47% (9/19)** of accepted `llm` rewrites still miss full profile pass. Weakest turns (`S2.t1`, `S3.t1` at 60%, `S2L.t2` at 40%) are all `llm`-path turns.

**Note on an earlier “model drift” A/B:** a plain-systemPrompt A/B (Assist off, 6 samples per policy text) failed to emit anchors under either version — freeze-era v1.1 text (3,485 chars) gave `**Top summary**` 0/6 and `**Next?**` 1/6; v2.0 text (5,988 chars) gave 0/6 and 0/6. That suggested provider drift, but **v2.1 Teacher hardening restored prompt-only without changing the model id**, so the actionable bug was the model-facing TLDR/Continue language + weak literal-token requirements. Treat the A/B as inconclusive; treat the before/after prompt-only rates as decisive.

### C. Prompt-only recovery under v2.1 — 2026-07-25

`eval-runs/trackb-v21-prompt-restore/gemini-2.5-flash/prompt-only/`, Dean off on :3010. Three complete repeats before a provider 429 cut runs 04–05.

| Run | Strict | Profile |
|-----|-------:|--------:|
| r01 | 11/14 (79%) | 12/14 (86%) |
| r02 | 11/14 (79%) | 12/14 (86%) |
| r03 | 12/14 (86%) | 12/14 (86%) |
| **mean (n=3, 42 turns)** | **81%** | **86%** |
| freeze (v1.1) reference | 67% | 76% |

r04 was cut mid-run by a provider 429 (partial: **9/11 strict, 11/11 profile** — consistent, excluded from the mean); r05 returned errors only.

**Per-turn (n=3 runs), and where the residual misses are:**

| Turn | Strict | Profile | Turn | Strict | Profile |
|------|-------:|--------:|------|-------:|--------:|
| S1.t1 | 3/3 | 3/3 | S2L.t1 | 3/3 | 3/3 |
| S2.t1 | 2/3 | 2/3 | S2L.t2 (redirect) | 0/3 | 2/3 |
| S2.t2 (redirect) | 0/3 | 0/3 | S2L.t3 | 3/3 | 3/3 |
| S2.t3 | 3/3 | 3/3 | S2L.t4 | 3/3 | 3/3 |
| S3.t1 | 2/3 | 2/3 | S2L.t5 | 3/3 | 3/3 |
| S3.t2 | 3/3 | 3/3 | S2L.t6 | 3/3 | 3/3 |
| S5.t1 | 3/3 | 3/3 | | | |
| S5.t2 | 3/3 | 3/3 | mean words 135.3 (max 422) | | |

Residual failures are **word cap**, not structure: 1× `S2.t1` and 1× `S3.t1` came in at 277 words against the 250 cap. Redirect turns fail strict by design (they legitimately skip the full anchor set), which is exactly what `profileStructuralPass` exists to separate.

Prompt-only is back at or above freeze. Full three-arm 5× under **v2.1** still recommended before replacing paper numbers.

### D. Telemetry logging gap (fixed in #1174)

Baseline and prompt-only turns wrote **0** `response_compliance` rows: the streaming `onFinish` hook returns early when `streaming: false`, and the non-streaming branch never logged. The eval harness posts `streaming: false`, so both control arms were invisible in the DB — every earlier arm comparison had to come from run artifacts, not telemetry.

- Before: smoke window 11 rows, Assist-off n=**2** vs Assist-on n=9.
- After: 2/2 baseline turns logged (27 and 86 words, `topSummary=false`, `nextLine=false`).
- Two regression tests added in `chat-oversight.route.test.ts` pin the non-streaming path.

This is the piece that makes Paper 2 arm analysis possible directly from `assistive_events`.

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

1. **`preStructuralPass` is post-normalization** — `auditAndMaybeRewrite` computes `beforeMetrics` on `normalizeAdhdStructuralAnchors(rawDraft)`, so a draft written as `* Top summary` is scored as already compliant. Do not use it as a prompt-only proxy.
2. **Within-scenario Dean contamination** — later drafts in the oversight arm imitate prior rewritten turns. That is why `none` reads 34% (24/71) in the oversight arm while prompt-only was 0% in the same cohort; per-turn "draft was fine" rates are not independent samples.
3. **Policy stamps are not poolable** — v1.x freeze ≠ v2.0 broken Teacher ≠ v2.1 restored. `policyVersion` on each row separates the cohorts.
4. **Provider rate limits truncate long runs** — v2.1 runs 04–05 hit 429s; report only complete repeats and state n.

---

## Research use

| Question | Answer from these runs |
|----------|------------------------|
| Does fail-closed Dean help RQ3? | Yes — oversight profile 80% → **87%** overall, **97%** late-turn (70 turns), strict 71% → **77%** |
| Did Track B break prompt-only? | Indirectly via Teacher TLDR language already in the policy (0/60 literal anchors); **v2.1 restores 36/36 anchors, 81% strict / 86% profile** |
| How often is forced wrap? | **13/71 = 19%** of oversight turns, plus 1 `llm_retry`; both paths 100% profile pass |
| Where does the Dean still lose? | The `llm` path: **9/19 accepted rewrites (47%)** still miss full profile pass because `acceptLlm` only requires improvement |
| Cost of oversight? | +**7.3 s** mean latency and ~2.7× words vs Assist-off (smoke: 2.7 s → 9.9 s, *d* −1.02) |
| Ready to replace freeze numbers? | Not yet — run full three-arm 5× under **v2.1** first (this branch has 210 turns at v2.0 + 42 at v2.1) |

Paper 1 freeze (`paper1-frozen-eval-numbers.md`) stays the cited Study 1 numbers until PI re-freezes.
