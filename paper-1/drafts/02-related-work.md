# Draft: §2 Background & Related Work

**Status:** Human voice rewrite v1 · §2.4 Gap rewritten for clarity · awaiting gap approve · 2026-07-14  
**Rule:** `.cursor/rules/paper1-human-voice-rewrite.mdc`  
**Job:** Three literatures → explicit gap (mesh + enforceable Dean under multi-turn drift).  
**Voice:** One take + one cannot-claim per thread. Storyline openers. No em dashes.

---

## 2. Background & Related Work

Default LLM tutors reward fluent paragraphs. That design assumes the learner can hold the whole turn in working memory, stay on one topic, and re-enter after a tab switch. For many students with ADHD, those assumptions fail in ordinary use. Three literatures make that failure predictable. They still leave a hole where ADHD Assist sits.

### 2.1 ADHD as a dimensional, multi-deficit condition

Start with the condition itself: ADHD is not one "attention off" switch. DSM-5 presentations (inattentive, hyperactive-impulsive, combined) sit on severity ranges, and executive-function accounts go deeper. Barkley (1997) treats behavioral inhibition as core, with secondary damage to working memory, internalized speech, affect and motivation regulation, and reconstitution. Brown (2013) clusters activation, focus, effort, emotion, memory, and action. Adult evidence treats emotional dysregulation as more than a side effect (Beheshti et al., 2020). Sonuga-Barke's (2003) dual pathway adds delay aversion and reward-motivation alongside executive dysfunction, so interest and near-term payoff can mask or amplify the same deficits.

**What we take:** tutoring has to name *which* deficit a reply shape is meant to repair (working memory, initiation, impulsivity, set-shifting, affect), not only "make chat nicer."  
**What we cannot claim from taxonomy alone:** that any particular UI or prompt *works* until it is measured under use.

The closest GenAI bridge is Zhu, Yu, and Luo (CHI'26). ADHD university students and experts co-design scaffolding that limits the visible agenda, prefers progressive tasks, and warns against cognition outsourcing and clinical overclaim. We take their interaction directions as primary human-grounded inspiration for the pillars. We do not treat their study as a measured evaluation of EduAI.

### 2.2 Cognitive load and accessibility foundations

Even if the diagnosis is clear, packaging still matters. Cognitive load theory separates intrinsic task demand from extraneous packaging and germane work (Sweller, 2011). Extraneous load rises when answers dump undifferentiated text. Working memory typically holds only a few chunks at once (Cowan, 2010). Accessibility guidance makes that concrete: W3C COGA (2021) pushes clear purpose, hierarchy, plain language, and predictable structure, and names AD(H)D among populations that benefit. Mayer's segmenting, signaling, and coherence principles, and UDL's multiple means of representation (CAST, 2018), point the same way: signpost, chunk, and do not overwhelm the first surface.

**What we take:** length caps, summary-first layout, and one-decision-at-a-time disclosure are load-management techniques with established warrants. They are not decorative "AI style."  
**What we cannot claim:** that CLT or COGA alone prove ADHD-specific superiority over neurotypical learners. Those frameworks are general. Whether Assist helps students with ADHD *more* than peers is Paper 2 / powered human work, not this paper's primary result.

### 2.3 LLM tutoring architecture and enforcement

A third literature designs LLM tutors as *pipelines*, not single prompts.

Liu et al. (2024), SocraticLM, introduce a Dean-Teacher-Student pattern: a Dean judges whether a generated turn meets stated requirements and may revise it before presentation to the learner. They also score tutor readability (SER), productive refusal of irrelevant moves (SRR), and validate-and-move (CARA). We take the oversight *cadence* and the readability / redirect vocabulary. We do **not** claim their Socratic fine-tuning gains or SER/SRR/CARA numbers as ours. Those metrics stay parked for later EduAI instrumentation.

Saha, Hase, and Bansal (2023) show selective explanation can beat always-explain, that style exemplars beat long rule lists for compliance, and that a *misaligned* teacher harms the trajectory. That is the cleanest argument that prompting alone is fragile. Shani et al. (2024) treat a written *constitution* of tutoring quality over full dialogues and treat multi-topic teacher turns as violations; our single-focus pillar and Dean constitution borrow that framing. Chevalier et al. (2024) warn that dialogue or style tuning without content checks can break subject accuracy, so oversight here must aim at **structure**, not inventing facts (key-point style grading motivates our content-parity discipline). Choudhury and Sodhi (2025) (*Better than your teacher* / LEAP) argue for privileged teachers that see full drafts before a weak agent acts; we take the full-draft-before-stream idea only as architectural analogy. Their benchmarks are not tutoring.

Ma et al. (2025) support simulated-learner QA infrastructure. Big Five is not ADHD, so that line is useful for harnesses, not clinical claims. Heterogeneous-learner teaching theory (e.g., Zhang et al., 2023 MINT) motivates personalisation only at a high level. It does not justify a user-facing ADHD rule by itself.

### 2.4 Gap

The literatures above already give us the spare parts. Zhu et al. tell us what ADHD-friendly scaffolding looks like in design workshops. Sweller, Cowan, and W3C COGA tell us why short, hierarchical, predictable replies reduce extraneous load. Saha et al. and Shani et al. show that teaching style needs selective policy and a written constitution, because open prompting is fragile. Liu et al. (and LEAP-style full-draft review) show that a second agent can judge a turn and revise it before the learner sees it.

What is still missing is putting those parts into one working tutoring control path.

We need two joins that prior systems do not ship together. The first is design clarity: assemble the already-known technique-to-deficit warrants (from ADHD research, load theory, and co-design) into one explicit technique × deficit mesh for a tutoring product, then treat that mesh as the design constitution (§3). The mapping is literature-grounded; Study 1 does not re-prove every cell as a clinical outcome. The second is system evaluation: write that mesh as a runtime policy, add a verifying second agent, and measure structural adherence under multi-turn drift in three arms (baseline, prompt-only, oversight) while holding model, retrieval, and tools fixed. That is the only honest test of whether enforcement beats prompting when dialogue context pulls the tutor off-scaffold.

Closest neighbors stop one step short of that join. Zhu et al. motivate the patterns, but they do not run an enforceable Dean on a live tutor under drift probes. SocraticLM does ship a Dean, yet its constitution is Socratic pedagogy, not ADHD load/structure rules, and it does not report our prompt-vs-oversight ablation. Selective-teaching and RLHF-education papers motivate policy and audit in general; they do not target ADHD scaffolds or late-turn structural pass under interruptions.

Paper 1 sits in that hole. We design the mesh, instantiate Router→Teacher→Student→Dean in EduAI as control over reply shape, and measure whether oversight beats prompting under multi-turn drift. Human load and learning stay feasibility-only until we have powered evidence.

---

## Voice-edit checklist

- [ ] Gap = mesh + enforceable second agent + multi-turn structural eval
- [ ] No freeze numbers in Related Work
- [ ] SocraticLM = architecture take only
- [ ] Paper 2 interaction deferred
- [ ] Zhu CHI'26 = co-design inspiration, not EduAI evaluation
- [ ] No em dashes; storyline openers
- [ ] User approved before §3
