# Draft: §5 Study 1 (Methods and Results)

**Status:** Human voice rewrite v2 · table + reading story · awaiting author verify · 2026-07-14  
**Rule:** `.cursor/rules/paper1-human-voice-rewrite.mdc`  
**Numbers:** `eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md` only  
**Lead metric:** turn-aware (profile) for Assist claims; report strict alongside

---

## 5. Study 1: Methods and Results

### 5.1 What we manipulate

We ask one primary question. When a tutoring scaffold starts to fall apart over multiple turns, does a second-pass oversight step hold the structure better than putting the same rules in the prompt alone?

To answer that, we only change how ADHD-supportive structure is enforced. Everything else stays fixed: the same chat model (`google:gemini-2.5-flash` for the reported runs), the same retrieval, tools, and temperature, and the same synthetic user turns.

That gives three arms (Figure 2):

1. **Baseline:** ordinary tutoring; Assist off.
2. **Assist, prompt-only:** ADHD Assist policy in the teacher system prompt; no second pass.
3. **Assist + oversight:** same policy, plus a Dean that reads the full draft and revises when the constitution fails.

The independent variable is not a smarter model or better retrieval. It is whether structure is requested in the prompt, or checked after generation.

### 5.2 What we measure

We score each assistant turn for structural adherence with an automatic checker.

**Strict checklist.** The reply must include a summary-first marker, end with a continue invite, and stay under the word cap. Harsh on short redirects that correctly refuse a full teaching template.

**Turn-aware checklist (primary for Assist comparisons).** Same idea, but a redirect may use the short boundary template instead of the full tutoring scaffold. That is the fairer primary score when comparing prompt-only to oversight.

**Interface labels.** The live UI may show TLDR and Continue where the system stores and scores Top summary and Next?. Study 1 scores the internal anchors.

We also keep a late-turn aggregate (second-and-later turns in a scenario, and the late tranche of the long probe), because that is where prompt drift shows up if it is going to. The headline result is the automated pass rates on the three-arm freeze.

### 5.3 Probes

All Study 1 inputs are synthetic multi-turn tutoring scenarios. No learner accounts. No personal data. We average five independent repeats per arm. The freeze includes a multi-turn topic interruption (core drift), continue-a-plan after a break (re-orientation), and shorter and longer variants in the same suite so we do not overfit to two scripts.

### 5.4 How we ran the freeze

Each arm ran as its own server configuration (oversight is a process-level flag). We stored run metadata (git SHA, model id, arm label) with turn-level results. For each arm we report the mean pass rate across five repeats, with the observed range. These are measured compliance rates under a fixed harness, not population estimates with confidence intervals.

### 5.5 What Study 1 deliberately is not

Study 1 does not measure cognitive load, learning gain, or preference. That belongs in the human protocol (feasibility only here). Study 1 asks whether the scaffold stays on the page when we ask the system to keep it there.

### 5.6 Results

Table 1 reports mean structural pass rates over five repeats on the frozen multi-turn suite (`google:gemini-2.5-flash`). Read each row left to right: Baseline → prompt-only Assist → Assist with Dean oversight.

| Metric | Baseline | Prompt-only | Oversight |
| --- | ---: | ---: | ---: |
| Overall (turn-aware) | 0% (0–0%) | **76%** (50–93%) | **80%** (71–86%) |
| Late-turn (turn-aware) | 0% (0–0%) | **86%** (71–100%) | **89%** (86–100%) |
| Overall (strict checklist) | 0% (0–0%) | 67% (50–79%) | 71% (64–79%) |
| Late-turn (strict checklist) | 0% (0–0%) | 77% (71–86%) | 80% (71–86%) |

**Table 1.** Structural adherence on the multi-turn probe suite (mean; ranges in parentheses). Turn-aware scoring allows correct redirects to use a short boundary template; strict scoring demands full tutoring markers. We lead with turn-aware rates for Assist comparisons and report both.

Baseline is **0% (0–0%)** on both checklists across five repeats: unconstrained replies still answer the probes, but they never emit the required ADHD-supportive shape. That zero is not a straw man: it is what the deployed default tutor produces under the same probes, so the informative contrast for this paper is prompt-only vs oversight. Prompt-only Assist produces the large jump (turn-aware **76%** overall / **86%** late; strict **67%** / **77%**). Oversight adds a further lift (turn-aware **80%** / **89%** late; strict **71%** / **80%**), about four points in aggregate, with larger gains on residual hard turns (plan resume and post-interrupt failures that the prompt arm still misses). Strict rates run lower than turn-aware because intentional redirects fail a full-marker checklist by design; we claim scaffold adherence here, not content invariance under Dean rewrite.

---

## Voice-edit checklist

- [ ] One continuous reading under Table 1 (no leftover 5.9–5.11 stubs)
- [ ] Freeze numbers match locked file
- [ ] Modest oversight lift owned; big jump is 0 → Assist
- [ ] User approved before §6
