# Paper 1 — Rewrite each module in your own words

Goal: every section reads like **you** wrote it — not like scaffold prose was lightly edited.  
Method: **steal structure, invent sentences.** Never paste AI paragraphs into the manuscript.

---

## The rewrite loop (use for every section)

1. **Close the scaffold.** Don’t draft with `01-PAPER-SKELETON.md` and the manuscript open side-by-side.
2. **Dump from memory (5–10 min).** On a blank page, write bullets answering: *What does this section need to prove? What evidence backs it? What must I refuse to claim?*
3. **Open the checklist below** — only to check you didn’t miss a load-bearing point.
4. **Draft aloud first.** Say the paragraph; then type what you said. Cuts AI cadence.
5. **Voice pass.** Kill: “In this section, we…”, stacked hedged adjectives, generic “accessibility barriers,” filler thesis restatements.
6. **Claim audit.** Highlight every factual claim → must map to `LOCKED-SCOPE.md`, frozen eval numbers, or a cited paper. Delete or hedge anything else.
7. **Diff vs scaffold.** If a sentence is ≥70% word-overlap with kit text, rewrite it again.

**Done when:** a classmate hearing you talk would recognize the same voice on the page.

---

## Voice constraints (paper-wide)

| Prefer | Avoid |
| ------ | ----- |
| Concrete nouns (Dean, Top summary / TLDR display label, structural pass) | Vague “accessibility interventions” |

When writing Methods: score **Top summary / Next?**; when writing human/UX: participants see **TLDR / Continue** (PR #751 display-only). Do not mix them as if the freeze metric renamed.
| Short claims + measured numbers | Soft marketing (“significantly enhances”) |
| Honest hedges in the claim sentence | Hedges buried in a footnote |
| One job per paragraph | Five RQs competing in one para |

**Locked thesis sentence (rephrase, don’t abandon):**  
ADHD-friendly tutoring fails when left to prompts alone because models drift; a second-pass oversight agent holds structure without rewriting facts.

---

## Module-by-module rewrite plan

Work **downstream-first for truth, upstream-last for polish**: Methods/Results outline → Discussion hedges → Intro/Abstract.

### Abstract (write LAST)

| | |
| --- | --- |
| **Job** | One breath: problem → gap → system → method → measured result → honest boundary |
| **Must include** | 3-arm eval; one real pass-rate triple; pilot = feasibility |
| **Must exclude** | Confirmatory human efficacy; ADHD-only exclusivity; estimated ~95% |
| **Own-words prompt** | *Explain the paper to a professor in 8 sentences, then cut to 150–200 words.* |
| **Done check** | A stranger can restate your primary RQ after reading only the abstract |

### 1. Introduction

| | |
| --- | --- |
| **Job** | Install the enforcement thesis; list contributions; scope boundary (your layer vs teammate AiTutor) |
| **Must include** | Prompt workarounds as the wrong fix; four contribution bullets with RQ roles demoted correctly |
| **Own-words prompt** | *Without looking at the outline: why isn’t “just use a better prompt” enough?* |
| **Done check** | Thesis appears once, early; contributions map 1:1 to later sections |

### 2. Background & Related Work

| | |
| --- | --- |
| **Job** | Three threads → gap sentence that *only this paper* fills |
| **Threads** | (1) ADHD as multi-deficit · (2) CLT / COGA / UDL · (3) LLM tutor pipelines (SocraticLM Dean, LEAP, selective teaching) |
| **Own-words prompt** | *For each paper you cite, write one sentence: what we take, what we cannot claim.* |
| **Done check** | Gap paragraph names mesh + enforceable second agent — not “little work on ADHD + AI” |

### 3. Framework (pillars + mesh)

| | |
| --- | --- |
| **Job** | Define five pillars; present mesh as **design rationale** |
| **Caption mandate** | T3 ratings are argued (S/P/I), **not measured** |
| **Own-words prompt** | *Pick one pillar. Explain which deficit it repairs like you’re teaching a lab mate.* |
| **Done check** | No results-table vibes on the mesh; under-coverage (reward / emotion) stated |

### 4. System (EduAI instantiation)

| | |
| --- | --- |
| **Job** | Make Router→Teacher→Student→Dean runnable; defend “style-only IV” |
| **Own-words prompt** | *Draw the pipeline from memory, then write one paragraph per box.* |
| **Done check** | Reader knows what is held constant across arms |

### 5. Study 1 — Synthetic eval (PRIMARY)

| | |
| --- | --- |
| **Job** | Methods + results for 3 arms; late-turn drift story |
| **Numbers** | Only from `paper1-frozen-eval-numbers.md` (update if re-run) |
| **Own-words prompt** | *Tell the story of one S2 multi-turn failure under prompt-only, then what oversight changed.* |
| **Done check** | Table + run provenance; content-parity sentence; no estimated rates |

### 6. Study 2 — Human pilot (FEASIBILITY)

| | |
| --- | --- |
| **Job** | Protocol exists; n=4–5 is not confirmatory |
| **Max length** | ~1–1.5 short pages / one tight subsection if pruning for page limit |
| **Own-words prompt** | *What would I need to change before calling this a result?* |
| **Done check** | “Feasibility” in first sentence; no significance language |

### 7. Discussion

| | |
| --- | --- |
| **Job** | Interpret primary claim; name what Paper 2 must still test |
| **Own-words prompt** | *If oversight lift is modest, what claim still survives?* |
| **Done check** | Ties results to thesis; does not smuggle Paper 2 interaction claims |

### 8. Limitations

| | |
| --- | --- |
| **Job** | Say the quiet parts loud (the A-tier blockers belong here if not yet fixed) |
| **Own-words prompt** | *List every attack a hostile reviewer will make — then own them.* |

### 9. Conclusion

| | |
| --- | --- |
| **Job** | Restate thesis inside the evidence we actually have |
| **Own-words prompt** | *Close the paper in four sentences while walking.* |

---

## Suggested order for this week

| Day focus | Section | Output |
| --------- | ------- | ------ |
| 1 | §5 Methods/Results bullets + table | numbers locked |
| 2 | §4 System + §8 Limitations | architecture + honesty |
| 3 | §3 Framework | pillars in your voice |
| 4 | §2 Related Work | gap paragraph last |
| 5 | §1 Intro | contributions sync |
| 6 | §6–§7 Human + Discussion | feasibility discipline |
| 7 | Abstract | last |

Manuscript: draft in `~/Code/adhd-assist-paper/manuscript/main.md`, one section per branch if you follow that repo’s git habit.

---

## Anti-patterns that make it sound like AI wrote it

- Starting every section with “In this paper/section, we…”
- Synonym piles (“robust, scalable, principled framework”)
- Citing three papers for one soft claim instead of one hard claim
- Restating the thesis with new adjectives instead of new evidence
- Collapsing Track A measured results with Track B pilot language
