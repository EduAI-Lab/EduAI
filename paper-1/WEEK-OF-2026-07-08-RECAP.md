# Professor check-in — week of 2026-07-08 → 2026-07-15

**Talk flow:** findings → sources → what I worked on → proof → where we stand → open for next-week plan  
**Last updated:** 2026-07-15

---

## 1. Research findings

### A. What the literature says (design basis)

Default LLM tutoring is a poor fit for ADHD learners when replies are long, unstructured, and hard to re-enter after interruption. Working memory is sharply limited (~3–5 chunks). Extraneous load climbs with dense, un-scaffolded prose. ADHD executive-function accounts point to inhibition, sustained attention, and re-orientation costs. Co-design with university students with ADHD converges on the same interaction patterns: concise chunks, fixed structure, progressive disclosure, single agenda, and gentle redirects rather than harsh refusal.

**Implication we take into the system:** ADHD-supportive tutoring is not “be nicer in the system prompt.” It needs an enforceable response *shape*.

### B. What our system evaluation shows (Study 1 / Track A)

On matched multi-turn tutoring probes (same model, tools, temperature; only response-control differs):

| Arm | Strict structural pass | Profile structural pass |
| --- | ---------------------: | ----------------------: |
| Unconstrained baseline | **0%** | — |
| Assist **prompt-only** | **~67%** | **~76%** |
| Assist + **second-pass oversight (Dean)** | **~71%** | **~80%** |

**Finding in one sentence:** prompting alone recovers most of the ADHD-supportive scaffold; oversight improves adherence further, but only **modestly**. Multi-turn drift under baseline is severe. Reliable structure needs a runtime enforcement layer, not one-shot instructions.

*(Do not cite the older ~95% estimate — that was pre-freeze.)*

### C. What the human pilot shows (Track B / H26-00906)

Within-person ADHD pilot (Baseline vs Assist), analyzed **n = 6** after exclusions:

- Preference and scanability lean Assist (e.g. 5/6 prefer Assist; 6/6 rate Assist easier to scan).
- Paired descriptives favor Assist on NASA-TLX, SUS, cognitive-load index, and comprehension (large descriptive effect sizes in the archive).

**Honest claim:** protocol **feasibility** and promising direction — **not** confirmatory evidence of reduced load. Powered ADHD efficacy and any ADHD × non-ADHD interaction belong in Paper 2.

### D. Thesis that follows

> ADHD-friendly LLM tutoring is an **enforcement** problem, not a prompting problem: apply structure rules, verify drafts with a second pass, measure adherence under multi-turn drift.

---

## 2. Where I found them (sources)

### Literature → pillars / architecture (cited papers)

| Finding we rely on | Source (cite as in Paper 1 refs) |
| ------------------ | -------------------------------- |
| WM limits / chunking → keep replies short | Cowan, N. (2010). *Current Directions in Psychological Science* |
| Extraneous load from dense unstructured text | Sweller, J. (2011). Cognitive load theory |
| ADHD executive-function / inhibition / re-entry | Barkley, R. A. (1997). *Psychological Bulletin*; Brown, T. E. (2013); APA DSM-5-TR (2022) |
| Cognitive accessibility / scannable structure | W3C COGA Task Force (2021). *Making content usable…*; CAST UDL Guidelines 2.2 (2018) |
| ADHD GenAI co-design: concise, progressive, gentle redirect | Zhu, Z., Yu, J., & Luo, Y. (2026). CHI ’26 |
| Progressive disclosure / teacher alignment risk | Saha, S., Hase, P., & Bansal, M. (2023). NeurIPS |
| Judge-and-revise tutoring loop (Teacher→Student→Dean) | Liu et al. (2024). SocraticLM — NeurIPS |
| Privileged reviewer sees full draft before emit | Choudhury & Sodhi (2025). LEAP / privileged AI feedback — ICLR |
| Style-only changes must not rewrite facts | Chevalier et al. (2024). Language models as science tutors — ICML |
| Emotion dysregulation / soft redirect rationale | Beheshti, Chavanon, & Christiansen (2020). *BMC Psychiatry* |
| Multi-turn preference/RL framing for drift | Shani et al. (2024). NeurIPS |
| Human instruments (pilot) | Hart & Staveland (1988) NASA-TLX; Brooke (1996) SUS |

Full APA list: `paper-1/drafts/09-references.md` · design mapping: `docs/literature/paper-pillar-policy-traceability.md`

### Our measured evidence (not papers — primary data)

| Finding | Where it lives |
| ------- | -------------- |
| Frozen 3-arm pass rates (5× repeats, Gemini 2.5 Flash) | `eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md` |
| Track B means / preference / exclusion note | `eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md` (+ PDF) |
| July Qualtrics export | `docs/testing/H26-00906-adhd-cohort-qualtrics-export.csv` |
| Earlier narrative brief (pre-freeze; check numbers) | `eduai-summer-2026/reports/form-a/adhd-assist-week-progress-brief.md` |
| Two-paper lock | `~/Code/adhd-assist-paper/docs/two-paper-plan-2026-07-09.md` |
| Ethics protocol (ADHD pilot) | UBC BREB **H26-00906** |

---

## 3. What I worked on this week

### Research & ethics / recruitment

1. **Froze Study 1 numbers** — re-ran / aggregated the three-arm eval to 5× repeats with strict + profile metrics (replaced legacy ~95% language).
2. **Refreshed Track B cohort** — n=6 analyzed + July Qualtrics export into the research branch.
3. **Locked Paper 1 scope + venue** — mechanism paper; primary RQ = oversight vs prompt-only under drift; venue **ACM IUI 2027** (abstract 13 Aug / paper 20 Aug 2026 AoE). CHI XOR; ASSETS 2027 backup.
4. **Drafted Paper 1 end-to-end** — own-words sections + Overleaf ACM package (`paper-1/overleaf/`, upload zip, compiled PDF).
5. **Self PC-style review** — `paper-1/REVIEWER-FEEDBACK-TODO.md` (powered human study, stats on Study 1, content-parity / IAA still open).
6. **Ethics for non-ADHD / Paper 2 arm** — worked through the week toward approval of the ethics application covering the non-ADHD comparison study (Paper 2 population × condition design).
7. **Recruitment partnerships** — met with **CTL** and **DRC** for help reaching ADHD participants; **poster now up in the DRC office** for active on-campus recruitment.

### Product / AI Tutor (same week)

- Course feedback viewer for instructors (#784 → PR #959, open)
- Guide-tour sidebar fix (#740 → PR #952, open)
- Chat history load failures no longer silent (#1000 → PR #1023, merged)
- Focus mode decoupled from Assistive mode (#859, merged)
- Team PR review / merge leadership on supporting EduAI work

---

## 4. Proof (artifacts you can open in the meeting)

| Claim | Artifact |
| ----- | -------- |
| Literature → five pillars | `paper-1/drafts/03-design.md` · refs in `09-references.md` |
| Measured freeze table | `paper-1-frozen-eval-numbers.md` · also Table in `paper-1/figures/table1-freeze-rates.md` |
| System story (Router→Teacher→Student→Dean) | `paper-1/drafts/04-system.md` · Overleaf `sections/system.tex` · Fig. 1/2 |
| Human feasibility only | `paper-1/drafts/06-and-08-feasibility-limitations.md` · H26 metrics PDF |
| Submission spine + abstract | `paper-1/paper1-spine.md` · `drafts/00-abstract.md` |
| Camera-ready path | `paper-1/overleaf/main.pdf` · `paper1-iui2027-overleaf.zip` |
| Venue lock | `paper-1/VENUE-DECISION-IUI-2027.md` · `IUI-DEADLINE.md` |
| Shipped Assist engineering | PRs [#859](https://github.com/EduAI-Lab/EduAI/pull/859), [#1023](https://github.com/EduAI-Lab/EduAI/pull/1023); feedback viewer [#959](https://github.com/EduAI-Lab/EduAI/pull/959) |
| Recruitment in motion | DRC poster live; CTL + DRC conversations this week |
| Ethics progress | Non-ADHD study application advanced / approval track (Paper 2) alongside active **H26-00906** ADHD pilot |

---

## 5. Where we stand today

| Thread | Status |
| ------ | ------ |
| **Paper 1 claim** | Locked: enforcement / oversight under multi-turn drift |
| **Venue** | **IUI 2027** locked · abstract **13 Aug** · paper **20 Aug 2026** |
| **Study 1 numbers** | Frozen · honest modest oversight lift |
| **Human ADHD pilot** | n=6 feasibility · recruit more via DRC/CTL |
| **Manuscript** | Near-complete own-words draft + Overleaf package; remaining = voice polish, stats/appendix gaps, reviewer TODO |
| **Paper 2** | Scoped (ADHD × non-ADHD); engineering frozen to P1 system; **ethics for non-ADHD in progress/approved track** |
| **Product** | Assist still shipping; Tutor feedback viewer + tour button in open PRs |

**Known gaps to own in discussion:** powered human study still the acceptance risk; no significance tests yet on 76% vs 80%; content-parity / checker agreement not published; single-model Study 1.

---

## 6. Open — plan for the upcoming week *(for discussion)*

Proposed priorities (not locked — decide with you):

1. **Recruitment push** — convert DRC poster + CTL/DRC leads into scheduled ADHD sessions; track toward a larger descriptive / powered-prep N under H26-00906 (or governing amendment).
2. **Non-ADHD ethics follow-through** — finish any remaining RISe / BREB steps so Paper 2 recruitment can start when P1 spine is stable.
3. **Study 1 hygiene for IUI** — add Fisher’s / CIs (or more repeats) on arm pass rates; start content-parity sample + checker agreement plan from `REVIEWER-FEEDBACK-TODO.md`.
4. **Manuscript** — finalize §2–§3 voice pass; trim templated scaffolds; lock abstract number lines to frozen table only.
5. **Overleaf** — upload zip, double-blind check, figure captions (what is original vs Liu et al.).
6. **Engineering (bounded)** — land #959 / #952 if review is ready; avoid new research IVs that destabilize the frozen system.

**Questions for this meeting**

- Submit P1 to IUI on current evidence (feasibility humans) and take the risk, or pause for more ADHD N first?
- Priority next 7 days: recruitment vs stats/appendix vs prose polish?
- Any constraints from CTL/DRC partnerships I should bake into the recruitment script?

---

*Working folder:* `EduAICoreLearning-research/paper-1/`  
*Restore note:* this file replaces the earlier chronological recap for professor-facing flow.
