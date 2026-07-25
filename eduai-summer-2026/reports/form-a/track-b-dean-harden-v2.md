# Track B — Dean harden + Teacher anchor restore

**Code PR:** [EduAI #1174](https://github.com/EduAI-Lab/EduAI/pull/1174) · branch `feat/adhd-dean-track-b-harden`  
**Policy stamp:** `ADHD_ASSIST_POLICY_VERSION = "2.1"` (do **not** pool with v1.x freeze or broken v2.0 cohorts)

## Headline findings (read this first)

**Current / fixed state = policy v2.1.** The complete matched 5× re-freeze is finished: prompt-only **85.7% profile**, oversight **92.9% profile**. The 9% figure below is a **temporary v2.0 regression that is fixed** — do not cite it as the branch outcome.

Matched protocol vs Paper 1 freeze: Gemini 2.5 Flash, `seed_course_cosc101`, scenarios **S1/S2/S3/S5/S2L** (14 turns/arm).

| Arm | Metric | Freeze (v1.1) | Broken intermediate (v2.0) | **Fixed now (v2.1, 5×)** |
|-----|--------|--------------:|---------------------------:|--------------------------:|
| Baseline | strict | 0% | 0% | **0/70 (0%)** |
| Prompt-only | strict | **67%** | ~~0%~~ | **56/70 (80.0%)** |
| Prompt-only | profile | **76%** | ~~9%~~ | **60/70 (85.7%)** |
| Oversight | strict | **71%** | **77%** | **60/70 (85.7%)** |
| Oversight | profile | **80%** | **87%** (late **97%**) | **65/70 (92.9%)**; late **34/35 (97.1%)** |

Sample sizes: v2.0 cells = 5 repeats × 14 turns = **70 turns/arm** (210 total); complete v2.1 re-freeze = the same **70 turns/arm, 210 total**.

**The single most diagnostic number** — literal anchor emission by the writer, Dean off:

| Token | v2.0 (70 turns) | **v2.1 prompt-only (70 turns)** |
|-------|----------------:|--------------------:|
| `**Top summary**` (bold, line start) | **0** | **60 / 60 eligible** |
| `**Next?**` (bold) | 4 | **60 / 60 eligible** |
| `TLDR` leakage into model output | 0 | 0 |

60 of 70 turns are non-redirect; the 10 redirect turns (`S2.t2`, `S2L.t2` across five repeats) are expected to omit the full anchor set. So v2.1 anchor compliance on eligible turns is **60/60 = 100%**, versus 0/60 under v2.0.

**Bottom line**

1. **Dean / oversight** — Track B fail-closed works: **92.9% profile**, a descriptive **+7.1 points** over matched v2.1 prompt-only and **+12.9 points** over the v1.1 oversight freeze.
2. **Prompt-only** — briefly hit ~~9%~~ when Teacher absorbed UI-only TLDR/Continue; **v2.1 restores 85.7%**. Fixed.
3. **Baseline** — still ~0% structural pass.
4. The full three-arm **v2.1** 5× re-freeze is complete. It can replace the old descriptive scoreboard once the PI approves the re-freeze; do not pool v1.x / v2.0 / v2.1 rows.

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

Prompt-only was back at or above freeze; the complete matched re-freeze below supersedes this n=3 restore smoke.

### D. Complete matched three-arm 5× under v2.1 — 2026-07-25

Full numbers and provenance: [`trackb-v21-eval-numbers.md`](./trackb-v21-eval-numbers.md).

Same model, course, scenarios, and 5×14-turn protocol: **70 complete turns/arm, 210 scored turns**, git `ff653a22`. All included runs completed 14/14 turns without provider errors.

| Arm | Strict | Profile | Late-turn profile | Mean words | Mean latency |
|-----|-------:|--------:|------------------:|-----------:|-------------:|
| Baseline | **0/70 (0.0%)** | 15/70 (21.4%)* | 10/35 (28.6%)* | 194.8 | 3,152 ms |
| Prompt-only | **56/70 (80.0%)** | **60/70 (85.7%)** | **31/35 (88.6%)** | 133.0 | 3,127 ms |
| Oversight | **60/70 (85.7%)** | **65/70 (92.9%)** | **34/35 (97.1%)** | 116.9 | 6,194 ms |

\* Baseline's profile metric only credits accidental redirect-shape matches; baseline emitted 0/70 Top summary and 0/70 Next? anchors. Its ADHD structural result is strict **0/70**.

**Matched v2.1 Dean effect:**

- Profile **85.7% → 92.9%**: **+5/70, +7.1 percentage points**.
- Strict **80.0% → 85.7%**: **+4/70, +5.7 points**.
- Late-turn profile **88.6% → 97.1%**: **+8.5 points**.
- Under-cap **64/70 → 70/70**: the Dean removed all six prompt-only word-cap failures.
- Every full-tutoring turn passed 5/5; residual redirect misses were `S2.t2` at 4/5 and `S2L.t2` at 1/5.

**Against the v1.1 Paper 1 freeze:** prompt-only improved **+13 strict / +10 profile points**; oversight improved **+15 strict / +13 profile points**.

95% Wilson intervals: prompt profile **75.7–92.1%**; oversight profile **84.3–96.9%**. This is repeated synthetic-turn evidence, not participant-level efficacy.

Paired by repeat/turn reference, neither contrast is statistically separable: profile exact McNemar **p=0.180** (7 prompt-fail/Dean-pass vs 2 prompt-pass/Dean-fail; Fisher **p=0.274**), strict McNemar **p=0.125**. The direction remains favorable to oversight, but the lift is descriptive. Treat these as suite-level tests because turns repeat within scenarios.

**Provenance correction:** the first attempted v2.1 oversight batch inherited `ADHD_ASSIST_OVERSIGHT=false`; run metadata exposed it before publication. A later Dean-on set used an older research-worktree harness and was also excluded for exact-harness parity. The five included roots are `oversight-final/run-01..05`; each completed 14/14 turns and records SHA `ff653a22`, `oversight.enabled=true`, and `envValue=true`.

### E. Telemetry logging gap (fixed in #1174)

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
4. **Provider rate limits truncate long runs** — several attempts hit 429s. The final v2.1 scoreboard includes only five complete 14/14 runs per arm and lists the excluded roots.
5. **Server configuration must be verified from run metadata** — one attempted oversight batch inherited `ADHD_ASSIST_OVERSIGHT=false`. It was detected, discarded, and rerun; all included oversight metadata records `enabled=true`.

---

## Research use

| Question | Answer from these runs |
|----------|------------------------|
| Does fail-closed Dean help RQ3? | Descriptively yes — matched v2.1 profile **85.7% prompt-only → 92.9% oversight** (+7.1 pp); late-turn **88.6% → 97.1%**. Exact tests are not separable at 5× |
| Did Track B break prompt-only? | The temporary v2.0 wording regression did (0/60 literal anchors); v2.1 restores **60/60 eligible anchors, 80.0% strict / 85.7% profile** |
| How often was forced wrap in the diagnostic v2.0 cohort? | **13/71 = 19%** of oversight turns, plus 1 `llm_retry`; both paths 100% profile pass |
| Where does the v2.1 Dean still lose? | Redirect shape: `S2.t2` **4/5**, `S2L.t2` **1/5**. All full-tutoring turns passed 5/5; overall **65/70** |
| Cost of oversight under v2.1? | Mean latency **3.13 s prompt-only → 6.19 s oversight** (+3.07 s); mean length fell **133.0 → 116.9 words** |
| Ready to replace freeze numbers? | **Yes, methodologically** — complete matched v2.1 5× is done (210 turns). PI approval is still needed to change cited Paper 1 numbers |

The old `paper1-frozen-eval-numbers.md` remains the cited Study 1 scoreboard until PI approval. The complete proposed replacement is [`trackb-v21-eval-numbers.md`](./trackb-v21-eval-numbers.md).
