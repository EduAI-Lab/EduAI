# Draft: §3 Design rationale (pillars + mesh)

**Status:** Human voice rewrite v3 · jargon/filler cut · awaiting author verify · 2026-07-14  
**Rule:** `.cursor/rules/paper1-human-voice-rewrite.mdc`  
**Answers:** Form A **RQ1** (internal note only; not in prose)

---

## 3. Design rationale: ADHD Assist pillars

If default LLM tutoring fails students with ADHD, what should a reply look like instead?

ADHD Assist uses five **response-shape** pillars. They draw on cognitive load and accessibility research (Sweller; Cowan; W3C COGA), ADHD executive-function accounts (Barkley and related), and ADHD co-design evidence from Zhu, Yu, and Luo (CHI'26). We mapped each technique to the ADHD difficulties it is meant to help. The pillars become the Teacher policy and the Dean's written constitution (§4).

Study 1 does not re-test every symptom claim as a clinical outcome. It tests whether the structural signature of these pillars holds under multi-turn use when a Dean is present.

Mesh ratings in this section (Strong / Partial / Indirect) are design ratings from that literature and synthesis. They are not Study 1 clinical outcomes.

### 3.1 The five pillars

#### P1. Concise

Working memory only holds a few chunks at once (Cowan, 2010). Long undifferentiated text raises extraneous load (Sweller, 2011) and is hard to re-enter after an interruption (Zhu et al.).

**In practice:** tutoring aims about 150 words (hard cap 250); clarifications shorter. No filler praise. If the topic exceeds the cap, summarize and invite continuation (P3).

**When it fails:** lectures, repeated reassurance, answer buried under throat-clearing.

#### P2. Structured

Headings, bullets, and a fixed order externalize "where am I?" so the learner does not rebuild context from prose after interruption (W3C COGA; Barkley). SocraticLM scores tutor readability (SER) for the same reason.

**In practice:** scaffolded turns open with a short summary block and close with one continuation invite; optional step ladder (at most five) and at most one quick check. Scoring anchors are Top summary and Next?. The interface may label those blocks TLDR and Continue; the underlying checks are unchanged.

**When it fails:** free-form essay; missing summary or Next?; nested sprawl.

#### P3. Progressively disclosed

One decision surface at a time beats dumping everything up front (Saha et al., 2023; Zhu et al. on progressive tasks).

**In practice:** answer the immediate ask tightly first. Add depth only after an explicit Next? invite. If the user asks two questions, answer the first and defer the second.

**When it fails:** full plan or lecture in one shot; multiple open threads.

#### P4. Single-focus

Multiple agendas leave attention residue and invite topic-merge when inhibition is weak (Sweller; Zhu; multi-topic tutoring violations in related education-dialogue work).

**In practice:** one main topic per turn. Steps serve that topic only.

**When it fails:** two unrelated headings; silently answering a second injected topic.

**Limit:** policy and redirect handling encode this intent. Automatic topic-count detection is weak, so Study 1 uses scripted interrupt probes rather than relying on an automatic one-topic detector.

#### P5. On-task continuity (gentle redirect)

Off-topic jumps are common for many students with ADHD. Harsh refusal raises frustration (Beheshti et al.; Zhu). SocraticLM's SRR scores productive handling of irrelevant moves.

**In practice:** acknowledge the jump, name the prior topic briefly, offer return or switch, without scolding.

**When it fails:** silent tangent-follow, or a blunt "I can't help with that."

### 3.2 Supporting constraints (not separate IVs)

Still enforced, but not the main style attributes under test:

- **Validate and move:** confirm a correct grasp, then advance (SocraticLM CARA analogue).
- **Honest unknowns:** do not invent course facts.
- **No clinical inference** from chat.
- **Learner-owned reflection:** optional; off in Study 1 so style remains the only planned difference.

The Dean (§4) audits the pillars through a written constitution. It is not a sixth pillar.

### 3.3 Technique × symptom mesh

Prior ADHD, load, and co-design work already links reply techniques to specific difficulties: short chunked answers to working-memory limits (Cowan; Sweller); external structure to re-entry and attention (Barkley; W3C COGA); progressive disclosure to initiation and overload (Saha et al.; Zhu et al.); single-focus to impulsivity and topic-merge (Shani et al.); gentle redirect to disruption and emotional dysregulation (Zhu; Beheshti et al.; SocraticLM SRR).

We assemble those links into one technique × deficit mesh for ADHD Assist and rate each cell from that evidence. Table 3 is the design map. Systems that ship structure or a second-pass checker usually motivate the technique; they less often publish this matrix as an explicit product constitution.

**S** = strong intended help; **P** = partial; **I** = indirect; **n** = not claimed.

| Technique \\ Symptom | Sust. attention | Working memory | Task initiation | Impulsivity | Time blindness | Inflexibility | Reward / motiv. | Emotional dysreg. | Metacognition |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **P1 Concise** | S | S | S | I | P | I | P | I | n |
| **P2 Structured** | S | S | S | P | P | P | I | I | P |
| **P3 Progressive** | S | S | S | P | P | I | P | I | P |
| **P4 Single-focus** | S | P | P | S | I | S | I | I | P |
| **P5 Gentle redirect** | S | I | n | S | P | S | I | S | P |

P1–P3 carry the working-memory, attention, and initiation core. P4–P5 carry impulsivity and set-shifting when the session derails. Emotional dysregulation is addressed mainly by redirect tone (P5), not a separate affect model. Reward/motivation and deep metacognition are weakly covered here; richer engagement pedagogy sits outside this paper's independent variable.

**Table 3.** Technique × symptom mesh for ADHD Assist. Cells are design ratings from prior evidence and our synthesis, not Study 1 clinical outcomes.

### 3.4 Hand-off to System and Study 1

Pillars become Teacher policy. The constitution becomes the Dean checklist. Turn profiles decide when full scaffold applies versus redirect. Study 1 tests whether that structural signature sticks better with a Dean than with prompting alone. It does not re-test every mesh cell clinically.

---

## Voice-edit checklist

- [ ] No Form A / PR numbers / internal issue IDs in prose
- [ ] No AI filler openers or summary closers
- [ ] Mesh claim: literature-linked techniques → assembled matrix
- [ ] User approved before §4
