# Paper 1 — Weekend Execution Plan (80/20 → Acceptance Spine)

**Created:** 2026-07-09  
**Goal:** Move Paper 1 from *Weak Reject* to *Borderline / verge of accept* by producing a **submission spine** — not a camera-ready draft.  
**Target venue:** ASSETS  
**Time budget:** ~8–10 hours over the weekend (~4 hours minimum viable)

---

## What “80% of acceptance” means

Acceptance requires three things reviewers trust:

1. **One claim** (not four RQs)
2. **Measured evidence** for that claim (not estimated ~95%)
3. **Honest boundaries** on what you did *not* prove

This weekend delivers all three. It does **not** deliver confirmatory human data — that is post-weekend work.

---

## The 20% work stack

| # | Task | Time | % of acceptance lift |
|---|------|------|----------------------|
| 1 | Frozen **three-arm eval** (S2 + S3) | 2–3 hrs | **~45%** |
| 2 | **One results table** + 1-page numbers doc | 1–2 hrs | **~25%** |
| 3 | **Collapse Paper 1** to one RQ + draft abstract with real numbers | 2 hrs | **~20%** |
| 4 | **Limitations + methods stub** (copy from existing docs) | 1 hr | **~10%** |

### Explicitly out of scope this weekend

- Paper 2 / curb-cut study
- Empirical mesh (T3)
- CHI-level framing
- Full related-work section
- Writing all sections to camera-ready length
- n=12+ pilot recruitment
- AiTutor collaboration
- Ethics amendment for non-ADHD arm

---

## Saturday AM — Block 1: Run the frozen three-arm eval

**Highest-leverage task.** Everything else is packaging.

### Scenarios

- **S2 + S3 only** — multi-turn drift + re-orientation (RQ2/RQ3 story)
- Add **S1** Sunday only if time permits

### Critical setup note

`assist-prompt-only` vs `assist-oversight` requires **different server oversight settings**. Run **three separate invocations** with server restarts — do **not** use `--mode all-three` in a single process (oversight is server-global via `ADHD_ASSIST_OVERSIGHT`).

### Prerequisites

- [ ] `apps/core` dev server runnable (`npm run dev`, default `http://localhost:3000`)
- [ ] DB migrated (`assistive_events` table exists)
- [ ] Browser session cookie copied to `EDUAI_COOKIE`
- [ ] API keys in `EDUAI_API_KEYS_JSON`
- [ ] Participant-facing model configured (e.g. `google:gemini-2.5-flash`)
- [ ] Record `git rev-parse --short HEAD` before starting

### Commands

```bash
cd apps/core

# --- Run 1: baseline (oversight irrelevant) ---
EDUAI_BASE_URL=http://localhost:3000 \
EDUAI_COOKIE='<paste session cookie>' \
EDUAI_MODEL=google:gemini-2.5-flash \
EDUAI_API_KEYS_JSON='<your keys json>' \
npm run eval:adhd -- --only S2,S3 --mode baseline --label paper1-frozen-baseline

# --- Run 2: prompt only ---
# Set ADHD_ASSIST_OVERSIGHT=false in apps/core/.env, restart dev server
npm run eval:adhd -- --only S2,S3 --mode assist-prompt-only --label paper1-frozen-prompt-only

# --- Run 3: oversight ON ---
# Remove ADHD_ASSIST_OVERSIGHT=false (or set true), restart dev server
npm run eval:adhd -- --only S2,S3 --mode assist-oversight --label paper1-frozen-oversight
```

### Block 1 done when

- [ ] Three timestamped folders under `eval-runs/` (repo root)
- [ ] Each contains `run-meta.json` (git SHA, model, oversight flag) + `turn-results.json`
- [ ] Paths recorded in checklist below

**Run paths (fill in after execution):**

| Arm | Label | `eval-runs/` path |
|-----|-------|-------------------|
| Baseline | `paper1-frozen-baseline` | |
| Prompt-only | `paper1-frozen-prompt-only` | |
| Oversight | `paper1-frozen-oversight` | |

---

## Saturday PM — Block 2: Build THE table

One table → becomes **Table/Figure 1** in the paper.

### Per-turn matrix

| Scenario | Turn | Baseline pass | Prompt-only pass | Oversight pass |
|----------|------|:-------------:|:----------------:|:--------------:|
| S2 | t1 | | | |
| S2 | t2 | | | |
| S2 | t3 | | | |
| S3 | t1 | | | |
| S3 | t2 | | | |

Pass = strict `structuralPass` (`**Top summary**` + `**Next?**` in tail + under word cap).

### Summary rows to compute

- **Overall strict pass rate** per arm (all turns)
- **Late-turn pass rate** (t2, t3 only) — primary “drift” metric

### Deliverable

Create `docs/paper1-results-snapshot.md` with:

```markdown
## Frozen eval provenance
- Model:
- Git SHA:
- Runs: eval-runs/<baseline>, <prompt-only>, <oversight>

## Headline numbers (measured, not estimated)
- Baseline structural pass: X/Y (Z%)
- Prompt-only: X/Y (Z%) — late turns: X/Y (Z%)
- Oversight: X/Y (Z%) — late turns: X/Y (Z%)

## Claim this supports
Multi-turn LLM tutoring scaffolds decay under prompting alone;
a second-pass oversight layer [does / does not] recover adherence on S2/S3 late turns.
```

**Use whatever the numbers are.** Null or weak oversight lift is still publishable — narrow the claim accordingly.

### Block 2 done when

- [ ] `docs/paper1-results-snapshot.md` exists with real numbers
- [ ] Per-turn table filled in
- [ ] Late-turn summary row computed

---

## Sunday AM — Block 3: Collapse Paper 1 to one spine

### Single primary RQ

> **Does a second-pass oversight layer improve structural scaffold adherence over prompting alone when multi-turn interaction causes drift?**

### RQ demotion map

| Old RQ | New home |
|--------|----------|
| RQ1 (pillars + mesh) | §3 Design rationale — caption: *theoretical, not empirically measured* |
| RQ2 (drift) | Supporting result — baseline + prompt-only late-turn rates |
| RQ3 (oversight) | **Primary result** — three-arm table |
| RQ4 (pilot n=4–5) | §6.1 Feasibility — *protocol viable; not confirmatory* — 1 paragraph max |

### Deliverable

Create `docs/paper1-spine.md` containing:

- [ ] **Title** (working)
- [ ] **150-word abstract** with real numbers from Block 2
- [ ] **One-sentence contribution**
- [ ] **Primary RQ** (above)
- [ ] **3 contribution bullets** (mechanism, measured ablation, honest feasibility boundary)
- [ ] **Section outline** (Intro → Design → Methods → Results → Discussion → Limitations)

### Abstract template

> LLM tutoring systems for learners with ADHD often rely on prompt-level scaffolding, but multi-turn interaction may cause structural drift. We evaluate three conditions — baseline, prompt-only scaffold, and prompt+oversight — on multi-turn probes (topic interruption, plan continuation). Baseline achieves X% structural compliance; prompt-only achieves Y% (Z% on late turns); oversight achieves W%. [Optional: pilot n=4–5 confirms protocol feasibility.] We discuss implications for reliable accessibility scaffolding in production LLM tutors.

### Block 3 done when

- [ ] `docs/paper1-spine.md` exists
- [ ] Abstract uses measured numbers, not estimates
- [ ] Only one RQ marked **primary**

---

## Sunday PM — Block 4: Methods stub + limitations

~1 hour. Source material: `eduai-summer-2026/PHASE_3_USER_TESTING_GUIDE.md`.

Append to `docs/paper1-spine.md` (or separate `docs/paper1-methods-limitations.md`):

### Methods stub (~½ page)

- **IV:** assist OFF / prompt-only / prompt+oversight; model, retrieval, tools, temperature frozen
- **DV:** `structuralPass` (Top summary + Next? + word cap)
- **Probes:** S2, S3 from Form A (`docs/literature/form-a-scenario-test-sheet.md`)
- **Analysis:** per-turn pass + late-turn aggregate; synthetic only for primary result
- **Human pilot:** feasibility only (n=4–5), secondary

### Limitations box

- Synthetic probes; structural compliance ≠ lived cognitive load
- Single model; single platform (EduAI)
- Pilot n=4–5 is feasibility only, not confirmatory
- Mesh matrix (T3) is design rationale, not empirically measured
- Oversight adds ~1–3 s latency per turn
- RQ3 numbers must come from frozen eval — never cite estimated ~95% without a run path

### Evidence map update

Update `context/02-RQ-EVIDENCE-MAP.md` (if present) so each RQ is tagged:

- `primary` / `supporting` / `appendix` / `not-claimed`

### Block 4 done when

- [ ] Methods stub written
- [ ] Limitations box written
- [ ] RQ-evidence map updated (or noted in spine if file missing)

---

## Weekend definition of done

Hand supervisor **one folder** of artifacts:

| Artifact | Path | Status |
|----------|------|--------|
| Frozen eval runs (×3) | `eval-runs/<timestamps>/` | ☐ |
| Measured headline numbers | `docs/paper1-results-snapshot.md` | ☐ |
| Submission spine | `docs/paper1-spine.md` | ☐ |

You have crossed from *plan* to *evidence-backed submission* when all three exist.

---

## Minimum viable (4 hours only)

If time is tight, do **Block 1 + Block 2 only**:

1. Run three-arm eval
2. Fill table + `paper1-results-snapshot.md`

Blocks 3–4 can wait until Monday (~3 hrs combined).

---

## Post-weekend (not this weekend)

Next 20% for full accept push:

1. Human pilot n=8–12 with **one validated cognitive-load instrument**
2. Pre-register Paper 2 interaction design (separate paper)
3. Expand related work to 2–3 direct LLM-accessibility baselines
4. Full prose draft from spine → ASSETS page limit

---

## Quick reference

| Resource | Location |
|----------|----------|
| Eval script | `apps/core/scripts/eval-adhd-assist.mjs` |
| Eval command | `cd apps/core && npm run eval:adhd` |
| Three-arm conditions | `apps/core/app/lib/eval/eval-adhd-assist-conditions.ts` |
| Metrics implementation | `apps/core/app/lib/ai/adhd-metrics.ts` |
| Testing guide | `eduai-summer-2026/PHASE_3_USER_TESTING_GUIDE.md` |
| Form A scenarios | `docs/literature/form-a-scenario-test-sheet.md` |
| Two-paper plan | (parent planning doc) |

---

*Do not commit `eval-runs/` to git (synthetic transcripts; keep local + record paths in snapshot).*
