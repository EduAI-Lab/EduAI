# ADHD Assist ↔ `i-have-adhd` alignment + research brief

**Created:** 2026-07-20  
**Purpose:** Map our Paper 1 findings and five-pillar policy to the practitioner skill [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), then list priority research work (recent PRs, meetings, ethics, venue).

**How to use:** Professor / collaborator briefing · related-work note · personal checkpoint before IUI abstract (13 Aug 2026).

---

## 1. Research findings (our work)

### 1.1 Design claim

Default LLM tutoring fails many students with ADHD when replies are long, unstructured, and hard to re-enter after interruption. ADHD Assist treats supportive tutoring as an **enforceable response shape** (five pillars + optional Dean), not “be nicer in the system prompt.”

### 1.2 Study 1 — synthetic three-arm eval (primary evidence)

Same model, tools, temperature; only response-control differs (Gemini 2.5 Flash, 5× repeats):

| Arm | Strict structural pass | Profile structural pass |
| --- | ---------------------: | ----------------------: |
| Unconstrained baseline | **0%** | — |
| Assist **prompt-only** | **~67%** | **~76%** |
| Assist + **Dean oversight** | **~71%** | **~80%** |

**Finding:** Prompting recovers most of the scaffold; oversight adds a **modest** further lift. Multi-turn drift under baseline is severe. Reliable structure needs runtime enforcement.

Source: `eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md`

### 1.3 Human pilot — ADHD cohort (feasibility only)

BREB **H26-00906** · within-person Baseline vs Assist · analyzed **n = 6** (after exclusions). Preference and scanability lean Assist; TLX/SUS/UX descriptives favor Assist.

**Honest claim:** protocol feasibility and promising direction — **not** confirmatory load reduction. Experts (see §4) agree the direction is right; the gap is **more ADHD participant data**.

### 1.4 Thesis

> ADHD-friendly LLM tutoring is an **enforcement** problem, not a prompting problem.

### 1.5 Where `i-have-adhd` fits

[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) is a Claude/Codex **output-style skill** (10 rules; MIT; loosely based on *The Adult ADHD Tool Kit*, Ramsay & Rostain). It is **prompt-only** — no tutoring domain, no multi-turn drift eval, no second-pass checker.

**Positioning for Paper 1 related work:** practitioner tooling already encodes ADHD-shaped LLM output for coding assistants; our contribution is enforcing analogous constraints under **multi-turn tutoring drift**, with measured prompt-only vs oversight arms.

---

## 2. One-to-one map: our pillars ↔ their rules ↔ research papers

Their skill starts from five facts about ADHD reading (working memory small; knowing ≠ doing; starting is hardest; vague time fails; dopamine scarce). Those facts drive their 10 rules. Below maps **our ADHD Assist pillars / policy** to **their rules**, with the **papers we use** in Paper 1.

### 2.1 Pillar ↔ rule ↔ paper (primary table)

| Our pillar / policy | Their rule (skill) | Shared idea | Research papers we cite |
| --- | --- | --- | --- |
| **P1 Concise** — ~150–250 word caps; no filler praise | **#1 Lead with next action** · **#10 No preamble / closers** · **#9 Cap lists at 5** | Don’t bury the answer; cut throat-clearing | Cowan (2010) WM limits; Sweller (2011) CLT; Zhu, Yu & Luo (CHI’26) density / re-entry; W3C COGA |
| **P2 Structured** — Top summary / TLDR + steps + Next? / Continue | **#2 Number multi-step tasks** · **#5 Restate state every turn** | Externalize “where am I?” so re-entry is cheap | W3C COGA; Barkley (1997) EF; Liu et al. (2024) SocraticLM SER; Zhu et al. (CHI’26); Chevalier et al. (2024) key-point structure |
| **P3 Progressively disclosed** — answer now; depth after Continue | **#1 Lead with action** · **#3 One concrete next step** · **#4 Suppress tangents** (defer second issue) | One decision surface at a time; knowing ≠ doing | Saha, Hase & Bansal (2023) progressive / selective explain; Zhu et al. (CHI’26) progressive subtasks; Sweller (2011) |
| **P4 Single-focus** — one topic per turn | **#4 Suppress tangents** · **#9 Cap at 5 / split now vs later** | Multiple agendas → attention residue / topic-merge | Zhu et al. (CHI’26) distraction; Shani et al. (2024) multi-topic constitution violations; Sweller |
| **P5 Gentle redirect** — acknowledge jump; offer return | **#4 Suppress tangents** (finish first, then ask about second) · **#8 Matter-of-fact tone** | Soft on-task continuity, not harsh refuse or silent follow | Zhu et al. (CHI’26) disruption; Beheshti et al. (2020) emotion dysregulation; Liu et al. (2024) SocraticLM SRR |
| **Next? / Continue** invite | **#3 End with one concrete next action** | Always leave one doable next move | Same as P2/P3 sources + our policy constitution |
| **Validate-and-move** (supporting) | **#7 Make wins visible** | Confirm progress so dopamine / motivation register | Liu et al. (2024) CARA; Zhu et al. expert E2 motivational notes |
| **Time / initiation scaffolding** (mesh: Partial today) | **#6 Specific time estimates** | Vague “a bit” fails under time blindness | Barkley / dual-pathway accounts; Ramsay & Rostain (*Adult ADHD Tool Kit* — their skill’s source); our mesh rates time blindness as Partial — **gap vs their skill** |
| **Reward / motivation** (mesh: weakly covered) | **#7 Make wins visible** | Buried wins don’t register | Sonuga-Barke dual pathway; Zhu Direction 2 (we defer) — **explicit under-coverage in §3 mesh** |
| **Dean / oversight constitution** (architecture) | *(none — they are prompt-only)* | We add second-pass enforcement they lack | Liu et al. (2024) Teacher→Dean; Choudhury & Sodhi (2025) LEAP full-draft review; Shani et al. (2024) written constitution |

### 2.2 Their 10 rules → our system (quick index)

| # | `i-have-adhd` rule | Closest EduAI / ADHD Assist piece |
| - | --- | --- |
| 1 | Lead with the next action | Progressive disclosure + action-first body (policy v1.x) |
| 2 | Number multi-step tasks | Step ladder (≤5) in Assist replies |
| 3 | End with one concrete next step | `**Next?**` scored · UI **Continue** |
| 4 | Suppress tangents | P4 + P5 redirect / turn profiles |
| 5 | Restate state every turn | Fixed schema + TLDR for re-entry after interrupt |
| 6 | Specific time estimates | **Not first-class in our constitution yet** (mesh Partial) |
| 7 | Make wins visible | Validate-and-move; still weak on reward column |
| 8 | Matter-of-fact errors | STYLE anti-urgency / no-condescension (v1.1+) |
| 9 | Cap lists at 5 | Hard step-ladder cap |
| 10 | No preamble / recap / closers | P1 concise; Dean strips filler when possible |

### 2.3 What we have that they don’t (and vice versa)

| We have (research system) | They have (coding skill) |
| --- | --- |
| Tutoring domain + course RAG | Dev/debug action-first defaults |
| Measured 3-arm adherence under drift | No empirical adherence study |
| Dean second-pass + turn profiles | Always-on skill file only |
| Human ADHD pilot (small n) | No participant study |
| Gentle educational redirect | Coding “want me to handle that next?” |
| — | Explicit **time estimates** as a hard rule |
| — | Explicit **win visibility** as a hard rule |

**Do not cite their repo as evidence for our freeze rates.** Cite as practitioner parallel + design corroboration.

---

## 3. Priority research work (recent) — ordered

Priorities below mix **what shipped**, **what experts said**, and **what opens next**. P0 = do / protect first for IUI + Paper 2 readiness.

### P0 — Venue + claim lock (this cycle)

| Item | Status | Notes |
| --- | --- | --- |
| **Target venue: ACM IUI 2027** | Locked | Abstract **13 Aug** / paper **20 Aug 2026** AoE. Meeting with **Saad**: IUI is the best fit for this work (AI × HCI, user control / steering of LLM tutors, education + assistive tech) vs e.g. IEEE AI & Engineering–style venues. See `VENUE-DECISION-IUI-2027.md`. |
| Paper 1 = enforcement / Dean under drift | Locked | Paper 2 = who it helps (ADHD × non-ADHD). CHI XOR for this manuscript. |
| Frozen Study 1 numbers | Locked | Use freeze table only — no legacy ~95% language. |

### P0 — Human evidence gap (experts + self-review)

| Item | Status | Notes |
| --- | --- | --- |
| Expert direction check (e.g. **Dr. Maya Libben** meeting prep / consult) | Direction endorsed | Structure-first Assist is the right line; **main missing piece = more ADHD test results** (powered / larger N), not a redesign of pillars. Prep: `MEETING-MAYA-LIBBEN.md`. |
| ADHD pilot n=6 | Feasibility only | Recruit more under **H26-00906** (DRC poster live; CTL/DRC partnerships). |
| Reviewer risk | Known | `REVIEWER-FEEDBACK-TODO.md`: powered human study is the acceptance blocker for accessibility claims. |

### P0 — Paper 2 ethics now unblocked

| Item | Status | Notes |
| --- | --- | --- |
| **Non-ADHD ethics amendment** | **Approved** (recent) | Can start prepping the curb-cut / specificity study: is Assist helpful for **everyone**, or **especially** for ADHD students? Design = population × condition interaction (~15 ADHD vs ~15 non-ADHD target in `paper-2/README.md`). System stays frozen to Paper 1 scaffold. |

### P1 — Product changes that are research-facing (this week / last)

| Priority | Work | PR / issue | Research link |
| --- | :---: | --- | --- |
| **P1** | **Interactive `eduai-diagrams` + reply flow** — Assist replies now follow a proper visual flow: **Step ladder → diagram → TLDR → Continue**. Diagrams were not part of the earlier Assist surface; catalog types include process-flow, gradient-descent, hierarchy, compare (tappable stages). | [#1091](https://github.com/EduAI-Lab/EduAI/pull/1091) (open) · closes [#1060](https://github.com/EduAI-Lab/EduAI/issues/1060) | Progressive disclosure + structured re-entry (P2/P3). **Display-only reorder**: stored/scoring anchors remain `**Top summary**` / `**Next?**` so Form A freeze metrics stay valid. TLDR moves **below** steps/diagram (participant-facing layout), matching “act first, summarize after.” |
| **P1** | TLDR / Continue labels (earlier) | [#751](https://github.com/EduAI-Lab/EduAI/pull/751) | ADHD pilot language: “TLDR” not “Top summary.” Display transform only. |
| **P1** | Focus mode **decoupled** from Assistive mode | [#859](https://github.com/EduAI-Lab/EduAI/pull/859) (merged 2026-07-15) | Expert UI question (one control vs two); Focus no longer gated behind Assist. |
| **P2** | Chat history load failures surfaced | [#1023](https://github.com/EduAI-Lab/EduAI/pull/1023) | Reliability for study sessions (not a style IV). |
| **P2** | ADHD Assist v1.1 format + turn profiles (foundation) | [#722](https://github.com/EduAI-Lab/EduAI/pull/722), [#714](https://github.com/EduAI-Lab/EduAI/pull/714) | Policy + Dean scoped by turn type — Study 1 profile-pass story. |

> Note: If you remembered “#1098,” the research-relevant diagrams/TLDR layout PR is **#1091** (issue **#1060**). #1093 is UBC student-number validation (not Assist research).

### P1 — Manuscript / IUI packaging (ongoing)

- Own-words drafts + Overleaf ACM package (`paper-1/overleaf/`)
- Figures: pipeline + three-arm diagram (proper flow story for reviewers)
- Related work: optional short cite of [i-have-adhd](https://github.com/ayghri/i-have-adhd) as practitioner parallel (see §1.5)

### P2 — Product work same window (lower research priority)

- AI Tutor course feedback viewer [#959](https://github.com/EduAI-Lab/EduAI/pull/959)
- Guide-tour sidebar [#952](https://github.com/EduAI-Lab/EduAI/pull/952)
- UBC student number validation [#1093](https://github.com/EduAI-Lab/EduAI/pull/1093)

Useful for the platform; not Paper 1 IVs.

---

## 4. Meetings & decisions (capture)

| Who | Outcome for research |
| --- | --- |
| **Saad** | Venue discussion → **IUI 2027** is the closest fit for this work (interactive AI + HCI control of LLM tutors), not IEEE AI & Engineering–style venues as primary. Locked in `VENUE-DECISION-IUI-2027.md` / `LOCKED-SCOPE.md`. |
| **Expert(s)** (incl. psychologist consult line — Maya Libben prep) | Direction of structure / Assist is right; **need more ADHD participant results** before strong human claims. |
| **CTL + DRC** | Recruitment path for more ADHD participants; DRC poster up. |
| **Self PC-style review** | Documented gaps in `REVIEWER-FEEDBACK-TODO.md` (stats on Study 1, content parity, powered humans). |

---

## 5. Near-term action list (from this brief)

1. **Land / demo [#1091](https://github.com/EduAI-Lab/EduAI/pull/1091)** — Step → diagram → TLDR flow for study and IUI system story.
2. **Recruit more ADHD participants** under H26-00906 (expert feedback: this is the missing piece).
3. **Start Paper 2 prep** now that non-ADHD ethics amendment is approved (protocol, materials, freeze system SHA — no new style IVs).
4. **IUI abstract by 13 Aug** — keep claims to freeze ablation + feasibility humans; cite practitioner parallel optionally.
5. Optional design follow-ons (not P1 IVs): hard **time estimates** and stronger **win visibility** (their rules #6–#7) if Paper 2 / product backlog wants them.

---

## 6. Key links

| Resource | Path / URL |
| --- | --- |
| Practitioner skill | https://github.com/ayghri/i-have-adhd |
| Our pillars draft | `paper-1/drafts/03-design.md` |
| Traceability index | `docs/literature/paper-pillar-policy-traceability.md` |
| Venue lock | `paper-1/VENUE-DECISION-IUI-2027.md` |
| Week recap (prior) | `paper-1/WEEK-OF-2026-07-08-RECAP.md` |
| Expert meeting prep | `paper-1/MEETING-MAYA-LIBBEN.md` |
| Paper 2 handoff | `paper-2/README.md` |
| Diagrams + TLDR layout PR | https://github.com/EduAI-Lab/EduAI/pull/1091 |

---

*This file is a working brief, not a manuscript section. Numbers must stay synced with the freeze snapshot when quoted externally.*
