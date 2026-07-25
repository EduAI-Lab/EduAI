# Draft: Abstract

**Status:** Human voice rewrite v5 · IUI control framing + hallucination soften · **author-locked 2026-07-24**  
**Venue frame:** ACM IUI 2027  
**Rule:** `.cursor/rules/paper1-human-voice-rewrite.mdc`

---

## Abstract

Students with ADHD use LLM chat tutors the same way their peers do, but what they get back is often a long, loosely organized reply. Over a few turns the response sprawls and the scannable shape falls apart; fluent models can also invent course detail that was never in the materials, a risk that motivates control even though we do not score hallucination here. A one-shot instruction like "keep it short" or "use bullets" sometimes helps on the next message, but it does not hold for a whole conversation. For a learner who already pays a high cost to re-enter after interruption, this is more than a cosmetic problem: when the only available control is prompt steering, the tutoring interface itself has failed.

So we treat ADHD-supportive structure as an interactive control problem. The interface must steer and check generative replies at runtime (a structure policy, plus an optional second-pass checker before emit), not rely on a cleverer system prompt. On matched multi-turn tutoring probes we compare three setups with the model, tools, and decoding held fixed: an unconstrained baseline; the same tutor with an ADHD-supportive structure policy in the prompt only; and that policy plus a second-pass oversight checker that may revise the draft before the learner sees it. Without assistive control, the required scaffolds almost never appear (0% structural pass). Putting the policy in the prompt recovers most of the structure (76% turn-aware overall). Adding the second-pass checker improves adherence again, but only modestly (80% overall; 86% to 89% on late turns). If accessibility depends on the model obeying a prompt forever, ordinary dialogue will break it. Reliable ADHD-supportive tutoring needs an enforceable structure path that can survive multi-turn drift. Powered human efficacy and ADHD-specificity remain follow-on work.

---

## Notes

- Em dashes banned. Split into full sentences or use parentheses.
- v5: hallucination = motivation only (explicit non-DV); lead with IUI interactive control / steer-and-check (no Dean/Teacher jargon, no EduAI dump, no pilot numbers).
- Freeze numbers unchanged: 0% / 76% / 80%; late 86→89%.
- Voice checklist: **author-locked 2026-07-24** (PCS abstract text).
