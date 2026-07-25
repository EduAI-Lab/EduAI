# Study 1 secondary metrics — SRR / IARA / CARA (SocraticLM-adapted)

**Status:** Future work · **not in current ASSETS manuscript** · 2026-07-14  

Do **not** add these metrics to Paper 1 Results until instrumentation + a re-freeze land and supervisor OK’s them. Spine prose stays on primary profile-pass ablation only.

---

## 1. Mapping (their name → our synthetic test)

| SocraticLM name | Their meaning | Our synthetic meaning | Needed data |
|-----------------|---------------|----------------------|-------------|
| **SRR** | Refuse off-topic + redirect | On interrupt/redirect turns, reply stays single-focus / correct redirect shape | **Mostly have** |
| **IARA** | Catch student errors | Catch *tutor* structural fails: first-pass fail → final pass after Dean (**recovery rate**) | **Need instrumentation** |
| **CARA** | Affirm correct; don’t over-correct | First-pass already pass → Dean leaves unchanged (**pass-through rate**) | **Need instrumentation** |

Honest caption for the paper:  
> We adapt Liu et al.’s (2024) SRR / IARA / CARA *labels* to structural tutor behavior. SRR = successful on-task redirect under topic interrupt. IARA = Dean recovery of constitution failures. CARA = Dean pass-through of already-compliant drafts. These are not their original student-answer recognition tasks.

---

## 2. Do we already have results?

### Freeze provenance
`eval-runs/paper1-repeat-v2/gemini-2.5-flash/{baseline,prompt-only,oversight}/run-01…05`  
Git `7abe68a0…` · model `google:gemini-2.5-flash` · 5 repeats × 14 turns/arm = 70 rows/arm.

### Schema today (`turn-results.json`)
Has: `structuralPass`, `profileStructuralPass`, `contextualPass`, `responseProfile`, final `assistantText`, `metrics`.  
**Missing:** first-pass draft text/metrics, `oversightMethod` (`none` / `deterministic` / `llm` / …), `rewrote` boolean.

### Snapshot — SRR-style only (computable now)

**Definition used here:** turns `S2.t2` + `S2L.t2` (Router profile `redirect` under assist).  
**Pass:** `profileStructuralPass === true` (assist arms). Baseline has no profile → `contextualPass` is a weak proxy only (do not over-claim).

| Arm | Redirect turns (5 runs × 2) | Profile / contextual pass | Strict pass |
|-----|----------------------------:|--------------------------:|------------:|
| Baseline | 10 | contextual 10/10 (proxy; not profile) | 0/10 |
| Prompt-only | 10 | **6/10 (60%)** | 0/10 |
| Oversight | 10 | **6/10 (60%)** | 0/10 |

**Read:** Assist redirects succeed ~60% of the time under profile rules; oversight did **not** lift SRR-style success vs prompt-only in this freeze. Strict always fails redirects (expected — don’t use strict for SRR).

### IARA / CARA
**No results yet.** Eval does not log first-pass vs final or Dean method. Code *has* oversight methods in `adhd-oversight.ts` (`none` / `deterministic` / `llm` / …) and assistive-event tests mention `oversightMethod`, but that is not in `turn-results.json` today.

---

## 3. Spec to implement later (test checklist)

### 3.1 Instrumentation (required for IARA + CARA)

In `eval:adhd` turn results (and ideally chat telemetry), record per Assist+oversight turn:

```json
{
  "firstPass": { "textHash": "...", "metrics": {}, "structuralPass": false, "profileStructuralPass": false },
  "final": { "metrics": {}, "structuralPass": true, "profileStructuralPass": true },
  "oversight": { "method": "deterministic|llm|none|llm_rejected|llm_failed", "rewrote": true }
}
```

Prompt-only / baseline: `oversight.method = "none"`, `firstPass === final`.

### 3.2 Metric formulas

**SRR (redirect success)**  
- Denominator: turns with `responseProfile === "redirect"` (or turnRefs `S2.t2`, `S2L.t2`).  
- Numerator: `profileStructuralPass === true` (primary); optionally also human rubric “gentle redirect held.”  
- Report per arm: baseline / prompt-only / oversight.

**IARA → Dean recovery rate** (oversight arm only, or all arms with firstPass logged)  
- Denominator: turns with `firstPass.profileStructuralPass === false` (or strict, declare which).  
- Numerator: those with `final.profileStructuralPass === true`.  
- Optional split by `oversight.method`.

**CARA → Dean pass-through rate** (oversight arm)  
- Denominator: turns with `firstPass.profileStructuralPass === true`.  
- Numerator: `oversight.rewrote === false` (or method `none`).  
- Target story: high pass-through + non-zero recovery = healthy Dean (not “always rewrite”).

### 3.3 Run command (fill when instrumented)

```bash
# After logging firstPass + oversight method:
# Re-run paper1-repeat-v2 protocol for oversight (+ prompt-only for SRR), then:
# node eduai-summer-2026/reports/scripts/aggregate-srr-iara-cara.mjs  # TODO
```

### 3.4 Paper table sketch (secondary)

| Metric | Baseline | Prompt-only | Oversight |
|--------|----------|-------------|-----------|
| SRR (redirect profile pass) | — / proxy | 60%* | 60%* |
| IARA (Dean recovery) | n/a | n/a | TBD |
| CARA (Dean pass-through) | n/a | n/a | TBD |

\*From current freeze; recompute after re-freeze.

---

## 4. Professor / supervisor feedback log

| Date | Who | Feedback | Action / decision |
|------|-----|----------|-------------------|
| | | | |
| | | | |
| | | | |

**Prompts to ask in the next meeting:**
1. OK to borrow SRR/IARA/CARA *names* with an explicit remap footnote?  
2. Prefer recovery/pass-through as appendix only, or as a Results subsection?  
3. Is redirect-only SRR enough, or do they want more off-topic inject scripts?  
4. Any objection to logging first-pass drafts in eval (synthetic only, no human PII)?

---

## 5. Other ways to make Paper 1 more valuable (backlog)

Keep ASSETS scope; pick 1–2, don’t boil the ocean.

| Idea | Effort | Value | Notes |
|------|--------|-------|-------|
| Ship SRR + IARA + CARA table | M | High | Needs instrumentation for 2/3 |
| Content-parity sample (Dean rewrites don’t invent facts) | M | High | Unlocks “structure not facts” |
| Second model family (OpenAI) same harness | M | Med | Cross-model row |
| Expert E1–E5 on freeze subset | M | Med | Human judgment spine |
| Worked S2 transcript figure (fail → Dean fix) | S | High | SocraticLM Fig. 2 energy |
| Latency appendix (p50 Dean cost) | S | Low–Med | Honesty, not primary claim |
| Powered ADHD human (n≈20–30) | L | CHI stretch | **Out of ASSETS now path** |
| Merge Paper 2 curb-cut | — | — | **Rejected** (venue decision) |

---

## 6. Decision log

| Date | Decision |
|------|----------|
| 2026-07-14 | Adopt SRR / IARA / CARA as **secondary** synthetic metrics (SocraticLM-adapted). |
| 2026-07-14 | Freeze already supports **SRR-style** proxy only (60% prompt-only = oversight on S2.t2/S2L.t2). |
| 2026-07-14 | IARA + CARA blocked on eval logging of first-pass + oversight method. |
| 2026-07-14 | **Parked from ASSETS draft** — keep as future aspect; do not insert into manuscript Results yet. |

---

## 7. Owner next actions

- [ ] Supervisor sign-off on naming/remap (§4 table)  
- [ ] PR: persist `firstPass` + `oversight.method` in `eval:adhd` turn-results  
- [ ] Re-run oversight (and prompt-only for SRR) 5×  
- [ ] Fill results rows; update `paper1-frozen-eval-numbers.md` + spine  
- [ ] Add one Results subsection + table in `05-methods-results.md` / manuscript  
