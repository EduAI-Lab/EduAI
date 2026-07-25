# Draft: §7 Discussion + §9 Conclusion

**Status:** Human voice rewrite v2 · shortened · **approved** · 2026-07-14  
**Rule:** `.cursor/rules/paper1-human-voice-rewrite.mdc`

---

## 7. Discussion

The primary question is narrow: when multi-turn tutoring causes ADHD-supportive scaffolds to slip, does second-pass oversight improve structural adherence over a structure policy in the prompt alone?

Study 1 answers in three beats. Unconstrained tutoring almost never produces the required scaffolds (**0%**). The ADHD Assist policy recovers most of the structure (**~76%** turn-aware overall; **~86%** late). Oversight adds a further, measured but modest lift (**~80%** / **~89%** late), with larger gains on residual hard turns. Aggregate Dean wins are not dramatic; the useful reading is architectural.

What survives is not “oversight replaces prompting.” Reliable ADHD-supportive structure is a **control stack**: written policy, turn-aware routing, and an optional auditor that can revise a draft before the learner sees it. Prompting does most of the work. Oversight is residual insurance for multi-turn failure modes the prompt does not fully close. For a tutor that must keep ADHD-supportive structure on by default, that stack is the contribution: steering generative replies at the interface, with model, retrieval, tools, and decoding held fixed.

We measured scaffold presence under automated checks. Hallucination was motivation for wanting control, not a primary DV. The short human pilot shows Assist is usable enough to study, not that it reduces load in a powered sense. Whether Assist helps students with ADHD *more* than peers, and confirmatory human outcomes, belong to Paper 2. The technique × symptom mesh (§3) is literature-argued design, not a Study 1 clinical validation of every cell.

Modest oversight lift still supports the enforcement thesis if we refuse stronger stories: near-perfect overall rates, confirmatory load reduction, and ADHD exclusivity.

Model capacity is a separate follow-on question. Study 1 freezes one drafting model and uses that same model for Dean rewrites. Exploratory Assist-on runs outside the freeze (local Qwen 7B vs 32B, alongside the Flash baseline) suggest stronger models follow the full ADHD policy more reliably during first-pass generation. Capacity therefore looks most consequential at the pedagogical generation stage. Future work should test whether narrower oversight can be delegated to smaller models without sacrificing compliance, establishing a quality–latency–cost frontier, rather than assuming every role needs the largest available model.

## 9. Conclusion

LLM tutoring that students with ADHD can re-enter after interruption needs structure that survives multi-turn dialogue. On matched probes, unconstrained tutors almost never produce that structure; a prompt policy recovers most of it; a second-pass checker adds a further, modest adherence gain without changing the model or tools. Accessibility meant to stay on by default cannot rest on prompting alone. Powered human efficacy and ADHD-specificity remain follow-on work.

---

## Voice-edit checklist

- [ ] Shorter; no lost claim stack / Paper 2 / mesh hedge
- [ ] No ~95%; no confirmatory human claim
- [ ] User approved
