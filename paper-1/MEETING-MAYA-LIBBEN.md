# Meeting brief — Dr. Maya Libben (UBC psychologist)

**Goal of the meeting:** Get expert validation (and pushback) on how we design an AI tutoring layer for students with ADHD.  
**Not the goal:** Demo EduAI, tour general product features, or brainstorm every possible ADHD intervention.

**Posture:** Talk less. Listen more. Ask, then shut up. Top items first — these meetings move fast.

**Collaborator ask:** Only at the end, if the conversation went well (see §6). Soft, not the focus.

**How to use links:** Cmd-click in preview / editor. Open the doc, scroll to the named bit, show *her* that fragment — don’t narrate the whole file.

### Quick open (home bases)

| Need | Open |
| ---- | ---- |
| Design pillars (source of truth) | [adhd-assist-design-pillars.md](../docs/literature/adhd-assist-design-pillars.md) |
| 8 principles + anti-patterns | [adhd-design-principles.md](../docs/literature/adhd-design-principles.md) |
| Executable policy (what the AI is told) | [adhd-assist-prompt-policy.md](../docs/literature/adhd-assist-prompt-policy.md) |
| Paper → pillar → policy map | [paper-pillar-policy-traceability.md](../docs/literature/paper-pillar-policy-traceability.md) |
| Mesh + under-coverage (paper draft) | [drafts/03-design.md](./drafts/03-design.md) |
| Citation list | [drafts/09-references.md](./drafts/09-references.md) |
| Human pilot metrics (n=6) | [h26-track-b-participant-metrics.md](../eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md) |
| Frozen structure eval (Show only if asked) | [paper1-frozen-eval-numbers.md](../eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md) |
| Paper 2 curb-cut plan | [paper-2/README.md](../paper-2/README.md) · [two-paper plan](file:///Users/ahabmasudsiddiqui/Code/adhd-assist-paper/docs/two-paper-plan-2026-07-09.md) |

---

## 0. Context for her (≤90 seconds — then stop)

We built **ADHD Assist**: a response-style layer on a course AI tutor. Same model and tools as baseline chat; only the *shape* of replies changes (short, structured, progressive, one topic, gentle redirects). A second-pass checker can revise drafts before students see them.

We are **not** clinical experts. We synthesized literature into design pillars and want those **assumptions challenged**.

**Do not open with:** live EduAI tour, architecture diagrams, freeze-rate tables, or general product features — unless she asks.

**Backup one-liner docs (if she asks “what is this?”):** [LOCKED-SCOPE.md](./LOCKED-SCOPE.md) · [paper1-spine.md](./paper1-spine.md) · [drafts/04-system.md](./drafts/04-system.md)

---

## 0b. What to *show* before the priority questions (2–4 min)

Yes — she needs a **concrete stimulus**, otherwise P1–P3 stay abstract. Show artifacts, not a product walkthrough.

### Bring one page: Baseline vs Assist side-by-side

| Leave as Baseline | Assist on |
| ----------------- | --------- |
| Long prose essay-ish turn | Top summary → steps → one Continue / Next? |

**Open while you describe the schema (don’t read aloud):**

- Response shape + caps: [adhd-assist-prompt-policy.md §3–4](../docs/literature/adhd-assist-prompt-policy.md)
- Structured pillar ops: [Pillar 2 — Structured](../docs/literature/adhd-assist-design-pillars.md)
- Scenario prompts (if you need a canned student question): [form-a-scenario-test-sheet.md](../docs/literature/form-a-scenario-test-sheet.md) · [form-a-eval-scenarios.md](../docs/literature/form-a-eval-scenarios.md)

Optional third snippet: **gentle redirect** → [Pillar 5](../docs/literature/adhd-assist-design-pillars.md) · policy drift section in [adhd-assist-prompt-policy.md](../docs/literature/adhd-assist-prompt-policy.md)

**How to use it:** “React to *this reply shape*.” Then go to P1.

### Bring only if you will ask P4

- What humans fill / results snapshot: [h26-track-b-participant-metrics.md](../eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md) · [pilot participant form](../docs/testing/adhd-pilot-participant-form.md) · [facilitator sheet](../docs/testing/adhd-pilot-facilitator-sheet.md)
- Feasibility framing in paper: [drafts/06-and-08-feasibility-limitations.md](./drafts/06-and-08-feasibility-limitations.md)

**Do not** open Qualtrics live or walk charts unless she asks. Raw July export (only if she asks): [H26-00906-adhd-cohort-qualtrics-export.csv](../docs/testing/H26-00906-adhd-cohort-qualtrics-export.csv)

### Do **not** show first

- Full EduAI tour · freeze % · mesh as “proven” · ethics packet unless she asks about logistics

---

## 1. PRIORITY list (discuss in this order)

### P1 — Is our ADHD “foundation” clinically sound? *(design strategies)*

Spend time only where we are **uncertain**. Settled unless she objects: short summaries / scannable structure help under load.

| # | Assumption | Why unsure | Ask her | Open |
| - | ---------- | ---------- | ------- | ---- |
| 1.1 | **Five pillars** are the right primary levers (concise, structured, progressive, single-focus, gentle redirect) | Our synthesis; reward / emotion weakly covered | Essential vs nice-to-have? Drop / demote which? | [design-pillars](../docs/literature/adhd-assist-design-pillars.md) · [mesh draft §3](./drafts/03-design.md) · [traceability](../docs/literature/paper-pillar-policy-traceability.md) |
| 1.2 | **Word caps** (~150 / 250) cut extraneous load without harming learning | CLT + Zhu; no ADHD RCTs on chat length | Too aggressive / weak? Differ by task? | [Pillar 1 — Concise](../docs/literature/adhd-assist-design-pillars.md) · [principles P3](../docs/literature/adhd-design-principles.md) · [refs: Cowan/Sweller/Zhu](./drafts/09-references.md) |
| 1.3 | **Fixed schema** every tutoring turn aids re-entry after distraction | May feel rigid / infantilizing / heavier for some | Who benefits vs overloaded? | [Pillar 2](../docs/literature/adhd-assist-design-pillars.md) · [policy schema §4](../docs/literature/adhd-assist-prompt-policy.md) · [principles P1+P4](../docs/literature/adhd-design-principles.md) |
| 1.4 | **One topic per reply** + defer second Q is ADHD-supportive | Impulsivity rationale; students ask compound Qs | Helpful or frustrating? | [Pillar 4](../docs/literature/adhd-assist-design-pillars.md) · [principles P2](../docs/literature/adhd-design-principles.md) · [FOCUS in policy](../docs/literature/adhd-assist-prompt-policy.md) |
| 1.5 | **Gentle redirect** > hard refuse or silent follow | Zhu + emotion dysregulation; tone unvalidated | When help vs shame / control? | [Pillar 5](../docs/literature/adhd-assist-design-pillars.md) · [principles P5](../docs/literature/adhd-design-principles.md) · [Beheshti + Zhu in refs](./drafts/09-references.md) |
| 1.6 | **Validate-and-move** (don’t re-quiz if they got it) | From SocraticLM CARA, not clinic | OK for reassurance-seeking ADHD learners? | [principles P7](../docs/literature/adhd-design-principles.md) · [SocraticLM phrase bank](./drafts/socraticlm-phrase-bank.md) · [related draft](./drafts/02-related-work.md) |
| 1.7 | We **under-cover** emotion / reward / deep metacognition on purpose | Dual pathway + Zhu Direction 2 deferred | Structure-first still right MVP? | [mesh under-coverage §3.3](./drafts/03-design.md) · [principles P8](../docs/literature/adhd-design-principles.md) · [policy §11 backlog](../docs/literature/adhd-assist-prompt-policy.md) · [related: DSM/Barkley/Sonuga-Barke](./drafts/02-related-work.md) |
| 1.8 | **No clinical inference** / therapy / meds from chat | Ethics + Zhu guardrails | Correct boundary? Grey zones? | [boundaries §4](../docs/literature/adhd-design-principles.md) · [policy WHAT NOT TO DO](../docs/literature/adhd-assist-prompt-policy.md) · [architecture ethics notes](../docs/literature/adhd-assist-architecture-phases.md) |

**Listen for:** incorrect assumptions, overlooked challenges, common mistakes in “ADHD-friendly” tools.

External papers (open only if she wants the source, not our digest): [Zhu et al. CHI’26 DOI](https://doi.org/10.1145/3772318.3790697) · [Barkley 1997](https://doi.org/10.1037/0033-2909.121.1.65) · [Cowan 2010](https://doi.org/10.1177/0963721409359277) · [W3C COGA](https://www.w3.org/TR/coga-usable/)

---

### P2 — Spectrum vs narrow focus *(who is this for?)*

We treat ADHD as a spectrum but ship **one** toggle.

| # | Decision | Ask her | Open |
| - | -------- | ------- | ---- |
| 2.1 | One **broad** Assist vs **narrow** to a subgroup | If narrow: which presentation / severity for a chat tutor? | [related: presentations / EF](./drafts/02-related-work.md) · [DSM/Barkley/Brown in refs](./drafts/09-references.md) · [design intro](../docs/literature/adhd-assist-design-pillars.md) |
| 2.2 | Different defaults for **HI vs inattentive**? | Length, structure density, redirect, pacing? | Same + [stimulus §0b](#0b-what-to-show-before-the-priority-questions-24-min) side-by-side |
| 2.3 | **Adapt** to severity / prefs vs one stable constitution? | Personalization vs consistency after interruption | [LOCKED-SCOPE “one IV”](./LOCKED-SCOPE.md) · [policy = single constitution](../docs/literature/adhd-assist-prompt-policy.md) |

---

### P3 — Is this actually ADHD-specific? *(or universal design?)*

Honest fear: Assist may help *everyone* (curb-cut), not ADHD more.

| # | Assumption | Ask her | Open |
| - | ---------- | ------- | ---- |
| 3.1 | Scaffolds matter *especially* under ADHD executive load | What would make tutor **more useful for ADHD than peers**? | [related “cannot claim ADHD-specific”](./drafts/02-related-work.md) · [discussion hedges](./drafts/07-discussion.md) · [UDL / COGA cites](./drafts/09-references.md) |
| 3.2 | ADHD vs non-ADHD (**group × condition**) is the right specificity test | Right clinical RQ? Alternatives? | [paper-2 README](../paper-2/README.md) · [P1→P2 handoff](../paper-2/P1-TO-P2-HANDOFF.md) · [two-paper plan](file:///Users/ahabmasudsiddiqui/Code/adhd-assist-paper/docs/two-paper-plan-2026-07-09.md) · [prof briefing §2](file:///Users/ahabmasudsiddiqui/Code/adhd-assist-paper/docs/prof-briefing-2026-07-06.md) |
| 3.3 | “ADHD-friendly” features might **hurt** some ADHD students | Structure / redirect / reflection / caps | [anti-patterns table](../docs/literature/adhd-design-principles.md) · [policy §11 tensions](../docs/literature/adhd-assist-prompt-policy.md) · [A-tier human gaps](./A-TIER-UPGRADE-PLAN.md) |

---

### P4 — Study design: questions, data, metrics *(research)*

Context: within-person Baseline vs Assist · BREB **H26-00906** · TLX / SUS / UX / comprehension / preference · pilot **n≈6** feasibility only. Synthetic Study 1 = structure adherence, not clinical outcomes.

| # | Ask her | Open |
| - | ------- | ---- |
| 4.1 | Are **TLX + SUS + preference + light comprehension** the right primary outcomes, or something else (re-orient after interruption, completion, abandon, frustration)? | [pilot metrics](../eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md) · [participant form](../docs/testing/adhd-pilot-participant-form.md) · [principles → survey map §3](../docs/literature/adhd-design-principles.md) · [feasibility draft](./drafts/06-and-08-feasibility-limitations.md) |
| 4.2 | What **process measures** are we missing clinically? | [telemetry / ethics §8](../docs/literature/adhd-assist-prompt-policy.md) · [architecture Phase 5 QA](../docs/literature/adhd-assist-architecture-phases.md) · [reviewer TODO A.1–A.2](./REVIEWER-FEEDBACK-TODO.md) |
| 4.3 | Ethical / clinical red lines on recruit, consent phrasing, self-ID samples? | [architecture ethics](../docs/literature/adhd-assist-architecture-phases.md) · [pre-coding checklist](../docs/literature/pre-coding-checklist.md) · [facilitator sheet](../docs/testing/adhd-pilot-facilitator-sheet.md) · [interview runbook](../docs/testing/adhd-pilot-interview-runbook.md) |
| 4.4 | Future powered study: N, DVs, ADHD confirmation you’d trust? | [A-TIER-UPGRADE-PLAN.md](./A-TIER-UPGRADE-PLAN.md) · [paper-2 README](../paper-2/README.md) · [RQ map](./RQ-ADDRESS-MAP.md) |
| 4.5 | Wrong to lead with **structure adherence** and park human load as follow-on? | [LOCKED-SCOPE](./LOCKED-SCOPE.md) · [paper1-spine](./paper1-spine.md) · [frozen eval](../eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md) · [methods draft](./drafts/05-methods-results.md) |

---

### P5 — UI / interaction decisions *(only ADHD-relevant)*

Skip generic EduAI chrome.

| Decision | Benefit | Harm | Ask | Open |
| -------- | ------- | ---- | --- | ---- |
| Assist **default on** vs opt-in | Accessibility stays on | Paternalizing | Which default? | [architecture Phase 1 toggle](../docs/literature/adhd-assist-architecture-phases.md) · [LOCKED-SCOPE](./LOCKED-SCOPE.md) |
| **Always-on schema** | Re-entry | Clutter / babying | Vary by turn type more? | [policy schema](../docs/literature/adhd-assist-prompt-policy.md) · [Pillar 2](../docs/literature/adhd-assist-design-pillars.md) · [system turn profiles](./drafts/04-system.md) |
| **TLDR / Continue** labels | Student language | Vs teaching structure vocab | Fine either way? | [LOCKED-SCOPE TLDR note](./LOCKED-SCOPE.md) · [design draft labels](./drafts/03-design.md) |
| **Focus** vs Assist separate | Visual quiet | Two toggles = decision load | One control or two? | [PR #859 Focus↔Assist decouple](https://github.com/EduAI-Lab/EduAI/pull/859) |
| Assistive **reading styling** | Scan cost ↓ | Overstimulation / fights schema | Keep / kill / optional? | [design-system Assistive Mode note](../eduai-design-system/project/readme.md) |
| Soft **reflection** invites | Metacognition (Zhu) | Nagging load | Milestones only / never default? | [principles P8](../docs/literature/adhd-design-principles.md) · [policy §7 + §11](../docs/literature/adhd-assist-prompt-policy.md) |
| **Redirect** off-topic | Holds goal | Interrupts hyperfocus | When *not* to redirect? | [Pillar 5](../docs/literature/adhd-assist-design-pillars.md) · [principles P5](../docs/literature/adhd-design-principles.md) |

---

## 2. Card questions (if time)

- Incorrect assumptions? Overlooked ADHD challenges? Common mistakes designing for ADHD? What to **delete** first?

**Open if she names a hole you already spotted:** [anti-patterns](../docs/literature/adhd-design-principles.md) · [mesh under-coverage](./drafts/03-design.md) · [reviewer feedback TODO](./REVIEWER-FEEDBACK-TODO.md)

---

## 3. Explicitly defer (don’t raise unless she asks)

| Topic | Parked doc (only if she asks) |
| ----- | ----------------------------- |
| Venue / IUI | [VENUE-DECISION-IUI-2027.md](./VENUE-DECISION-IUI-2027.md) |
| Freeze % / mechanism claim | [paper1-frozen-eval-numbers.md](../eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md) |
| Full Overleaf package | [overleaf/](./overleaf/) |
| Week engineering recap | [WEEK-OF-2026-07-08-RECAP.md](./WEEK-OF-2026-07-08-RECAP.md) |

---

## 4. Suggested timebox (~30–45 min)

| Minutes | Focus |
| ------: | ----- |
| 0–2 | Goal + 90-sec context (§0) |
| 2–5 | **Stimulus:** Baseline vs Assist (§0b) — then stop presenting |
| 5–15 | **P1** — open pillar/policy links, don’t dump |
| 15–22 | **P2** spectrum |
| 22–30 | **P3** specificity + harms |
| 30–38 | **P4** study — metrics + feasibility docs |
| 38–42 | **P5** only if energy remains |
| last 2–3 | Soft collab ask (§6) if it went well |

---

## 5. One-page cheat: pillars

| Pillar | In practice | Doc |
| ------ | ----------- | --- |
| Concise | ~150–250 words | [P1](../docs/literature/adhd-assist-design-pillars.md) |
| Structured | Summary + steps + Continue | [P2](../docs/literature/adhd-assist-design-pillars.md) |
| Progressive | Depth on demand | [P3](../docs/literature/adhd-assist-design-pillars.md) |
| Single-focus | One topic | [P4](../docs/literature/adhd-assist-design-pillars.md) |
| Gentle redirect | Soft return | [P5](../docs/literature/adhd-assist-design-pillars.md) |

**We already admit:** mesh is design rationale; human n small; ADHD>non-ADHD untested — [spine hedges](./paper1-spine.md).

---

## 6. Closing — collaboration (soft)

If it went well:

> “This was really helpful. We’re not ADHD clinical experts, and that shows in the gaps you flagged. Would you be interested in contributing more — advising on the design and study as the work continues, or collaborating on the research if that’s a fit?”

Then **stop.** Offer a short follow-up of what you heard.

---

## 7. After the meeting

Capture: rejected · endorsed · overlooked · spectrum lean · metric changes · collab interest → new note in this folder (or append here).

---

*Prepared for: meeting with Dr. Maya Libben · ADHD Assist design validation · not a product demo.*
