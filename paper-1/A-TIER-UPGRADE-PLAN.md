# Paper 1 — A-tier / A\* upgrade plan

**Realistic target (locked 2026-07-14):** **ASSETS (CORE A)** with the current story + blockers closed below.  
**Stretch (deferred):** CHI / SIGCSE **A\*** / **A** only after human evidence stops being a one-paragraph pilot — do not gate the ASSETS submission on that.

This file is the action plan for today’s four blockers — nothing else.

---

## Scoreboard

| # | Blocker | Status today | Target for A (ASSETS) | Target for A\* (CHI) |
| - | ------- | ------------ | --------------------- | -------------------- |
| B1 | Human evidence is n=4–5 feasibility | Open | Honest feasibility + **pre-registered path** to n≥12–20 ADHD | Confirmatory ADHD human study (powered main effect) |
| B2 | RQ3 needs **measured** in-app oversight numbers | Partially closed — frozen Gemini 5× runs exist | Cite run-backed rates only; fix detector / failure modes | Same + second model family OR pre-reg multi-run |
| B3 | Mesh matrix is theoretical | Open (and OK if labeled) | Caption + prose: **conceptual, not measured** | Optional: small expert rating study validating S/P/I — not required for A |
| B4 | Synthetic+pilot looks thin at A\* | Open | Lead with mechanism; do not claim ADHD exclusivity | Powered human data in-paper or under review as companion |

---

## B1 — Human evidence (feasibility → confidence)

### What A accepts
Pilot n=4–5 as **feasibility**, if you never write confirmatory prose and you show the protocol is ready to scale.

### What A\* expects
ADHD within-person Baseline vs Assist (oversight held constant), **one primary DV** (prefer load / re-orientation), n large enough for a within-person main effect (rule of thumb: aim **n≥20–30 ADHD**, not n=4).

### Actions (ordered)

| Priority | Action | Owner / artifact | Done when |
| -------- | ------ | ---------------- | --------- |
| P0 | Freeze pilot language | Manuscript §6 | Every TLX/SUS/preference sentence includes “feasibility / descriptive” |
| P1 | Choose **one** primary human DV for future powered run | This file + ethics note | Written + supervisor OK |
| P2 | Recruit ADHD n=8–12 as **expanded pilot** (still descriptive if underpowered) | BREB H26-00906 | Sessions logged; snapshot in `eduai-summer-2026/reports/` |
| P3 | Pre-register powered ADHD main-effect study (OSF) | Separate from Paper 2 interaction | Frozen scenarios, N, DV, analysis before bulk recruit |
| P4 *(A\*)* | Finish powered ADHD study **or** demote human to appendix and submit systems+eval | Venue decision | Numbers in table with CI / effect sizes |

**Do not** fold the non-ADHD arm into Paper 1 to “save” A\* — that is Paper 2. Inflating Paper 1 kills both papers.

---

## B2 — Measured RQ3 (oversight vs prompt-only)

### Where you are
Measured Gemini-2.5-flash 5× repeats exist (`paper1-frozen-eval-numbers.md`).  
Headline is **modest oversight lift**, not “~95%”: e.g. overall strict ~67% → ~71%; profile ~76% → ~80%. Late-turn similar pattern. Baseline stays ~0%.

That is publishable **if claimed accurately**. Overselling dead numbers is worse than a small lift.

### Actions (ordered)

| Priority | Action | Done when |
| -------- | ------ | --------- |
| P0 | Rebuild Results table from frozen file only | Manuscript numbers match snapshot SHA/model/run path |
| P1 | Decide strict vs profile pass as primary metric (recommend **profile** for assist arms; explain S2.t2 redirect false fails) | One sentence in Methods + one in Limitations |
| P2 | Patch known failure modes that muddy the claim (missing `**Next?**` after rewrite; markdown variant Top summary) | Re-run labeled `paper1-freeze-v3`; new snapshot |
| P3 | Content-parity check: sample N Dean rewrites; score structure-changed / facts-held | Short table or appendix |
| P4 | Optional A-strengthener: second model family (OpenAI) with same harness | Parallel summary row — not required to submit A |
| P5 | If oversight ≤ prompt-only on primary metric after fixes: **narrow claim** to “oversight recovers X failure modes / late-turn subset” — still a paper | Claim sentence rewritten |

**Hard rule:** delete every “~95%” / “~15%→~95%” string unless it is in the current snapshot.

---

## B3 — Mesh matrix theoretical

### Honest stance (A-compatible)
The mesh is a **contribution as a conceptual organizing model**, not a result. Reviewers attack it when it looks like data.

### Actions

| Priority | Action | Done when |
| -------- | ------ | --------- |
| P0 | T3 caption: “Theoretical S/P/I ratings; not empirically measured.” | Caption shipped |
| P1 | §3 opening sentence repeats the same hedge | In manuscript |
| P2 | Related Work gap = “prior work justifies techniques; not the technique↔deficit mesh + runtime enforcement” | Gap paragraph rewritten |
| P3 *(optional)* | 2–3 experts rate a subset of cells; report agreement as exploratory | Appendix only — skip if it delays Track A |

---

## B4 — Synthetic + pilot thin for A\*

### Two venue strategies (pick one for the next deadline)

**Strategy A — ASSETS / A-tier (recommended now)**  
Submit mechanism paper: pillars (conceptual) + measured 3-arm ablation + feasibility pilot. Strength = clarity of RQ + measured evidence + honest limits.  
Companion: Paper 2 interaction study later.

**Strategy B — CHI A\* stretch**  
Only if by submission you have: (1) clean multi-run Track A across ≥1–2 models, (2) powered ADHD human main-effect **or** larger n with clear primary DV, (3) no estimated metrics. Even then, expect heavy R&R.

### Actions toward A\* (do not block ASSETS path)

| Priority | Action |
| -------- | ------ |
| 1 | Finish Strategy A package first (camera-ready spine) |
| 2 | Run P2–P3 under B1 in parallel without rewriting Paper 1’s claim set |
| 3 | Decide CHI only when human n clears a pre-registered bar |

---

## 14-day execution board (Paper 1 only)

| Day | Focus | Deliverable |
| --- | ----- | ----------- |
| 1–2 | B2 P0–P2 | Results table + claim sentence match frozen numbers; metric decision |
| 3 | B3 P0–P2 | Mesh honesty language locked |
| 4–5 | B1 P0 + rewrite §5 | Methods/Results in own words (`REWRITE-OWN-WORDS.md`) |
| 6–7 | Rewrite §4 + §8 | System + Limitations owning remaining blockers |
| 8–9 | Rewrite §3 + §2 | Framework + Related Work + gap |
| 10 | Rewrite §1 + Abstract draft | Thesis + contributions |
| 11–12 | §6–§7 | Feasibility discipline |
| 13 | Supervisor pass | Check claim = evidence |
| 14 | Venue decision lock | ASSETS-class A target confirmed vs CHI stretch |

---

## Definition of “A-ready” (exit criteria)

Paper 1 is **A-tier submission-ready** when all are true:

1. [ ] Primary RQ is oversight vs prompt-only under drift  
2. [ ] Every headline % has a run path + model + git SHA  
3. [ ] Mesh labeled conceptual everywhere it appears  
4. [ ] Human data never uses confirmatory language  
5. [ ] Limitations own residual B1/B2/B4 debt  
6. [ ] Abstract and Intro use **your** phrasing (`REWRITE-OWN-WORDS.md` loop complete for those sections)

**A\*-ready** additionally requires powered ADHD human evidence (or a different paper shape). Do not pretend otherwise.

---

## Explicit non-goals this sprint

- Paper 2 recruitment / BREB amendment for non-ADHD  
- AiTutor integration paper  
- Validating every mesh cell  
- Chasing 95% rhetoric
