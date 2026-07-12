# Paper 1 — Drafting Kit (START HERE)

> **What this folder is.** A reusable scaffolding set for writing the ADHD Assist research paper. Drop any of these files into a fresh Claude conversation (or hand Claude the whole folder) and start drafting a section without re-explaining the project. These are **drafting scaffolds**, not the manuscript.
>
> **Companions (already in `docs/`):** [`PAPER1_FRAMEWORK.md`](../PAPER1_FRAMEWORK.md) (the two-table theoretical contribution + literature the build doesn't cite) and [`RESEARCH_CONTEXT.md`](../RESEARCH_CONTEXT.md) (full project + pilot state). This kit **operationalizes** those into a writeable paper.

---

## The four research questions this paper answers

| RQ | Question (verbatim from Form A) | What it tests | Evidence track |
| -- | ------------------------------- | ------------- | -------------- |
| **RQ1** | What interaction patterns and response attributes best support ADHD learners in AI-based learning tools? | Whether concise / structured / progressively-disclosed responses reduce overload + improve re-orientation | Literature → 5 pillars → expert rubric (Track A) |
| **RQ2** | Can an LLM reliably *maintain* ADHD-supportive patterns across varied prompts and multi-turn interaction? | Whether the base model **drifts** toward verbosity/redundancy despite constraints | Synthetic multi-turn eval, stability across turns (Track A) |
| **RQ3** | Does a *second layer of AI oversight* improve adherence vs the base system alone? | Whether architectural enforcement (the Dean) beats prompting alone | **Three-arm ablation**: baseline / assist-prompt-only / assist-oversight (Track A) |
| **RQ4** | Does enabling ADHD Assist improve *learning efficiency and perceived cognitive load* for ADHD students vs baseline? | Whether the workflow improves task time, clarity of next steps, reduced overload in authentic tasks | **Human study** (Track B, H26-00906): NASA-TLX / SUS / comprehension / preference |

> **Note.** The older `PAPER1_FRAMEWORK.md` was scoped to RQ1–RQ3. **This kit adds RQ4** (the human study) as a first-class arm. RQ1–RQ3 are answerable *without human participants* (Track A, synthetic); RQ4 requires BREB approval (Track B).

---

## The one-sentence argument (decide before drafting)

Every strong paper has one sentence that answers *"what is this actually arguing"* — not the topic, the **contestable claim** the whole paper defends. Two candidate framings below; **pick one and delete the other before you draft.** Each RQ is a load-bearing clause of whichever you choose, not a separate mini-paper.

### Option A — Enforcement framing (recommended; lead with RQ3)

> **Making LLM tutoring accessible to ADHD learners is an enforcement problem, not a prompting one — because base models reliably drift away from ADHD-supportive interaction patterns over multi-turn use, and only a second-pass oversight agent holds those patterns consistently, without altering the underlying facts.**

- **The adversary it defeats:** *"just write a better prompt / let the user ask for bullets."*
- **Why it's falsifiable:** dies if base models don't drift (RQ2), if oversight doesn't beat prompt-only (RQ3), or if rewriting breaks facts (content parity).
- **Best for:** an ML/systems audience. It's the more contestable claim and your strongest evidence (the three-arm ablation) points straight at it.
- **How the RQs serve it:** RQ1 defines the patterns (the target) · RQ2 proves drift (the problem — kills "just prompt it") · RQ3 proves oversight fixes it (the payload) · RQ4 proves it matters to real ADHD learners (the stakes). The "without altering the facts" clause pre-empts the "structural rewriting degrades correctness" attack.

### Option B — Mesh-theory framing (lead with RQ1/the two-table model)

> **Effective ADHD support in AI tutoring comes from meshing each interaction technique to the specific cognitive deficit it repairs — and once that mesh is made explicit, it can be instantiated as an enforceable runtime policy that a verifying second agent holds stable across multi-turn use.**

- **The adversary it defeats:** *"ADHD accommodations are generic UX niceties; there's nothing ADHD-specific here."*
- **Why it's falsifiable:** dies if the technique→deficit mesh has no predictive/organizing value, or if it can't be operationalized and enforced (RQ2/RQ3).
- **Best for:** a CHI/ASSETS accessibility audience — the theoretical mesh (Table 1 × Table 2) is the novelty they'll reward.
- **How the RQs serve it:** RQ1 *is* the mesh (the contribution) · RQ2/RQ3 show it's enforceable, not just conceptual · RQ4 shows the repaired deficits translate to real learner outcomes.

**Recommendation:** Option A. It's the sharper, more defensible bet and matches where your evidence is strongest. Keep Option B's mesh as the *theoretical contribution inside* Option A's paper (§3), not as the top-line thesis.

---

## The files in this kit

| File | Use it when you are… | Contains |
| ---- | -------------------- | -------- |
| **`01-PAPER-SKELETON.md`** | deciding structure / writing section headers | Section-by-section outline mapped to the 4 RQs, word budgets, venue conventions, figure/table list |
| **`02-RQ-EVIDENCE-MAP.md`** | writing any Results/Methods claim | Per-RQ: claim → evidence source → figure/table → papers to cite → **what NOT to claim** |
| **`03-CITATIONS-AND-STYLE.md`** | writing Related Work / references / any prose | Full reference list (APA 7) with `[V]/[F]` confidence flags + writing-convention checklist derived from the 8 anchor venues |
| **`04-METHODS-RESULTS-BLOCKS.md`** | drafting Methods / Results fast | Copy-paste-ready paragraphs (IV, architecture, three-arm eval, human protocol, moderators) with the real pilot numbers |

---

## Recommended drafting workflow with Claude

Don't ask Claude to "write the paper." Use the pipeline that survives review:

1. **Lock the skeleton first** (`01`). Get section headers + 2–3 bullets of *what each section must argue* before any prose. Skeletons are cheap to fix; prose is not.
2. **Draft one section at a time**, anchored to `02` (evidence map) so every claim is traceable to a source and stays inside the "what NOT to claim" guardrails.
3. **Pull citations from `03`** — never let Claude invent a reference. Anything marked `[F]` (foundational, from memory) must be cross-checked in your reference manager before submission.
4. **Reuse the blocks in `04`** for Methods/Results — they already carry the correct numbers and hedging.
5. **Stress-test structure**, not just prose: ask Claude *"what would a hostile ASSETS/CHI reviewer attack in this section?"* before moving on.

### The prompting pattern that actually produces good output

Not *"write me a paper on X."* Give Claude a **role + a skeleton + constraints**, then have it fill **one section at a time**. The reusable kickoff prompt (fill the brackets before pasting):

```
You're an experienced [subfield] researcher. I'm drafting a paper for submission to
[target venue/journal — be specific; this changes structure and tone]. Below is my
research context: [problem, method, key findings]. Generate a section-by-section
outline (Intro, Related Work, Methodology, Results, Discussion, Limitations,
Conclusion) with 2–3 sentences per section describing what argument/claim it needs
to carry and how it connects to the next section. Flag where I need citations vs
where I can write from my own data.
```

> **Note:** the user will supply the filled-in version of this prompt later — treat that as the drafting kickoff when it arrives, not now.

### Tooling & repos worth knowing (beyond chat)

| Repo | What it gives you | Verdict for July 7 |
| ---- | ----------------- | ------------------ |
| **Master-cai/Research-Paper-Writing-Skills** | A Claude Code skill built on Prof. Peng Sida's ML/CV/NLP paper-writing notes; run *"use the research-paper-writing skill to improve my Introduction"* → applies claim–evidence checks + CS structural conventions | **Install this** — lightweight, directly useful |
| **pedrohcgs/claude-code-my-workflow** | 52 skills incl. simulated peer review: `/review-paper --peer <journal>` runs multiple referee personas against your draft; `/respond-to-referees` | Overkill to fork before the deadline, but **steal the `/review-paper` + `/respond-to-referees` pattern** |
| **noise-lab/paper-skeleton** | Minimal, clean LaTeX conference/journal skeleton | Use if you want boilerplate to hand Claude instead of a blank `.tex` |

**The workflow that works across all of these:** keep the paper in a **git repo**, let Claude **draft on a branch**, and **review it as a diff** — so every change is inspectable, revertible, and never a black box. (Repo created — see bottom of this file.)

All three are now **installed** (full usage: `context/05-TOOLING-GUIDE.md` in the paper repo). Cheat sheet below.

---

## Slash-command / skill cheat sheet

> **Where each works:** `research-paper-writing` is a **global** skill (any project, including this one). `/review-paper`, `/respond-to-referees`, `/seven-pass-review` are **project skills — they only activate when Claude Code is running inside `~/Code/adhd-assist-paper`.**

| I want to… | Command / invocation | Tool · scope |
| ---------- | -------------------- | ------------ |
| Improve/polish a section | *"Use the **research-paper-writing** skill to improve my Introduction"* | research-paper-writing · global |
| Check a paragraph flows | *"Run the **paragraph clarity check** on §3.2"* | research-paper-writing · global |
| Reverse-outline a section | *"**Reverse-outline** my Related Work; flag paragraphs that don't map to the thesis"* | research-paper-writing · global |
| Check claims vs evidence | *"Check every claim in my Abstract against `context/02`"* | research-paper-writing · global |
| Quick referee report | `/review-paper manuscript/main.md` | review-paper · paper repo |
| Critic→fix→re-audit loop | `/review-paper manuscript/main.md --adversarial` | review-paper · paper repo |
| Simulated peer review (venue) | `/review-paper manuscript/main.md --peer CHI` (or `ASSETS`, `IEEE`) | review-paper · paper repo |
| Decision *distribution* (variance) | `/review-paper manuscript/main.md --peer CHI --variance 3` | review-paper · paper repo |
| Hostile-editor stress test | `/review-paper manuscript/main.md --peer CHI --stress` | review-paper · paper repo |
| Skip R/Stata reproducibility checks | add `--no-cross-artifact` (your MD paper has no scripts) | review-paper · paper repo |
| R&R response document | `/respond-to-referees <referee-report> manuscript/main.md` | respond-to-referees · paper repo |
| Max-coverage 7-lens review | `/seven-pass-review manuscript/main.md` (7× token cost — submission-ready only) | seven-pass-review · paper repo |
| Convert to LaTeX for submission | *"Convert `manuscript/main.md` into the `latex/` skeleton using the `acmart` class"* | latex/ (paper-skeleton) |

**Journal short names I added** (tool shipped econ-only): `CHI`, `ASSETS`, `IEEE`. Tell the reviewer *"this is an HCI/accessibility paper, not econ"* so it re-maps its "Identification/Econometrics" dimensions to evaluation-validity.

---

## Extra tricks & techniques worth stealing

**Drafting**
- **One paragraph = one message; state it in the first sentence.** The single highest-leverage habit from the research-paper-writing skill — makes reverse outlining trivial.
- **Feed context first, always.** Start every session with *"read `context/00`–`05` first"* so Claude never re-derives (and never invents) the project.
- **Draft in Markdown, convert to LaTeX last.** MD diffs are readable; `.tex` diffs are noise. Lock content, then render.
- **Write the Abstract and Intro LAST.** You can't summarize an argument you haven't finished building.

**Reviewing**
- **Fresh-context re-review beats same-thread re-review.** After a rewrite, start a *new* conversation (or let `--adversarial` fork) to re-review — the same thread anchors on what it just wrote and misses its own errors.
- **`--peer` before you submit, `--variance 3` when the stakes are high.** A single peer pass is a point estimate; variance mode shows *how confidently* the paper survives (concerns that recur across referees = real; one-off = disposition noise).
- **Turn "what would a hostile reviewer attack?" into a standing step** — run it per section, not once at the end.
- **Treat WebSearch novelty claims as flags, not verdicts.** The peer pipeline can hallucinate prior work; verify any "this was already done by X" before believing it.

**Git discipline**
- **Commit before every big AI rewrite** → then `git diff` shows exactly what changed, and `git checkout .` reverts instantly.
- **One section = one branch = one small diff.** Reviewable; a 9-section rewrite is not.
- **Tag milestones:** `git tag draft-v1 && git push --tags` at the July 7 draft, so every later version diffs against a fixed point.

**Cost / deadline discipline**
- **research-paper-writing is your daily driver; `/review-paper --peer` is a once-per-draft event; `/seven-pass-review` is a luxury.** Don't burn 7× tokens on an early draft.
- **Keep referees on a mid-tier model, editor synthesis on the strong one** (variance mode multiplies referee cost by N).

---

## Five guardrails that keep this paper honest (read before drafting)

1. **The pilot is a *feasibility signal*, never confirmatory.** n=4–5 finished, `Survey Preview` distribution. Preference/comprehension/synthetic-compliance are strong; aggregate TLX/SUS are mixed/flat. Label all pilot numbers descriptive/preview-stage. The powered n≈30 study is what tests RQ4.
2. **The IV is *response style only*.** Same model, RAG, tools, temperature, streaming contract across all arms. Never conflate `adhdAssist` with disabling tools or a different model. Latency is a separate epic.
3. **AiTutor / QuestionMaker are a teammate's honours project.** Your contribution is the ADHD framework + the ADHD Assist structural layer (pillars, Dean, Router) in `apps/core`. Guided-discovery (AiTutor) is **related prior platform work** — get teammate approval before citing/depending on it; keep the contribution boundary explicit.
4. **Narrow RQ3 to what was actually run.** If the in-app oversight ablation wasn't executed for a claim, scope RQ3 to the external-sandbox/prompt-only comparison — don't imply in-app parity.
5. **Don't over-claim ADHD-specificity.** Low-load structured responses plausibly help everyone (CLT/COGA are general). The defensible claim is "helps everyone, *more* for ADHD" (ordinal interaction) — which is why RQ4 needs a non-ADHD comparison arm (see `PAPER1_FRAMEWORK.md` §6.4).

---

## Housekeeping

- **Keep these off code PRs.** Per project convention, docs live on the docs branch (`docs/iura-consolidated`), not feature/code PRs. Commit this folder there.
- **This branch (`feat/adhd-feedback-v1.1`) can be auto-reset.** These files are currently untracked — commit them to the docs branch promptly so they aren't wiped.
- **Two-track vocabulary** (don't conflate): *Track A* = synthetic, expert-scored, no participants (answers RQ1–RQ3). *Track B* = H26-00906 human study (answers RQ4).

---

## Paper repo (canonical drafting home)

The actual manuscript lives in a **separate private repo**, not in this code repo:

- **URL:** https://github.com/Ayyhab/adhd-assist-paper (private)
- **Local:** `~/Code/adhd-assist-paper`
- **Layout:** `manuscript/main.md` (draft here) · `context/` (a copy of this kit + the two framework docs) · `figures/`
- **Workflow:** draft each section on its own branch (`draft/intro`, `draft/methods`, …) and **review as a diff** before merging to `main`.

> These `docs/paper1/` files are the **seed**; once you start drafting, treat the paper repo's `context/` as canonical and keep edits there (or re-sync) so the two don't drift.
