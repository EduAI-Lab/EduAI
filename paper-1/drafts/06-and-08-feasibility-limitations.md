# Draft: §6 Human feasibility + §8 Limitations

**Status:** Human voice rewrite v3 · §6 reports n=6 paired descriptives (feasibility-labeled) · **author-locked 2026-07-24**  
**Rule:** `.cursor/rules/paper1-human-voice-rewrite.mdc`  
**Split:** P1 = protocol feasibility only; powered humans + ADHD×non-ADHD → Paper 2  
**Canonical numbers:** `eduai-summer-2026/reports/form-a/7_results_consolidated.md` (n=6; 2026-07-11)  
**Handoff inventory:** [`../paper-2/P1-TO-P2-HANDOFF.md`](../paper-2/P1-TO-P2-HANDOFF.md)

---

## 6. Human protocol (feasibility only)

Paper 1's primary evidence is Study 1. We additionally ran a small within-person ADHD pilot under ethics approval **H26-00906** to check that Assist could be administered as a study task. Each participant used the tutor twice (Assist off vs Assist on with second-pass oversight; order counterbalanced) and completed NASA-TLX, SUS, brief UX items, a main-ideas comprehension item, and preference questions after each mode.

Of nine Qualtrics records, seven were finished and **n = 6** entered paired means. All six analyzed responses were ADHD self-identified and were collected while the instrument was still on Qualtrics preview links rather than the final anonymous survey link, so we treat them strictly as pilot data for validating the protocol, not as confirmatory study outcomes. One finished response was excluded because categorical Assist preference contradicted that participant's own SUS and TLX change (SUS fell and raw workload rose under Assist despite an Assist preference), which we treat as a response-order or technical confound.

**Table (paired descriptives, n=6, preview distribution).** Means (SD); Δ = Assist − Baseline; paired |d| descriptive only (n < 30).

| Metric | Baseline | Assist | Δ | \|d\| |
| ------ | -------- | ------ | --: | ----: |
| TLX raw workload ↓ | 3.71 (1.51) | 2.21 (0.99) | −1.50 | 0.94 |
| Cognitive load index ↓ | 3.92 (1.83) | 2.08 (0.86) | −1.83 | 0.98 |
| SUS (0–100) ↑ | 58.89 (21.82) | 80.28 (16.75) | +21.39 | 0.84 |
| Comprehension (main ideas) ↑ | 3.67 (1.21) | 5.83 (1.17) | +2.17 | 1.06 |
| Felt oriented in app ↑ | 4.00 (1.79) | 5.33 (1.03) | +1.33 | 1.29 |
| Layout easy to scan ↑ | 4.33 (2.34) | 5.83 (0.98) | +1.50 | 0.55 |

Within this feasibility cell, every listed mean moves Assist-ward, with large paired |d| on several composites. Overall preference favored Assist for 5/6 participants (none preferred Baseline; one reported no preference). The protocol and Assist toggle are operable as a study task. These numbers do **not** confirm reduced load or ADHD-specific benefit in the population. Powered human efficacy through the final distribution pipeline, and any ADHD vs non-ADHD interaction, remain follow-on work.

---

## 8. Limitations

**Synthetic structure ≠ lived load.** Passing a structural checklist is not the same as reducing cognitive load for a student with ADHD. Study 1 measures scaffold presence, not subjective effort.

**Modest oversight lift.** On the frozen Gemini 2.5 Flash runs, oversight beats prompt-only by a few points on aggregate rates. Some leftover misses are rewrite truncation and detector brittleness.

**Metric choice.** Strict scoring under-credits correct redirects. We lead with turn-aware rates for Assist comparisons and always show both.

**Single model, single platform.** Table 1 freezes one model family on EduAI (`gemini-2.5-flash`), with Student and Dean on the same model. Exploratory Assist-on runs on local Qwen 7B and 32B (outside the freeze) suggest stronger models follow the full ADHD policy more reliably during first-pass generation. That points to model capacity mattering most at the pedagogical generation stage. Future work should test whether narrower oversight can be delegated to smaller models without sacrificing compliance, establishing a quality–latency–cost frontier. The architecture allows a separately sized Dean; that split is not evaluated in Study 1.

**Human feasibility only.** The n = 6 preview pilot cannot confirm efficacy. It is protocol evidence, not an outcome trial. Table descriptives are directional signals inside a preview cell, not powered inference.

**Mesh is design synthesis.** Strong / Partial / Indirect cells are literature-argued, not Study 1 clinical outcomes.

**Latency.** Oversight costs roughly an extra second or few per turn in current builds; we did not treat latency as an outcome.

**Deprecated numbers.** Older notes floated "~95% with oversight." That figure is not in the freeze file and must not re-enter the manuscript.

---

## Voice-edit checklist

- [x] §6 reports n=6 paired means + |d| (no longer "means live in archive")
- [x] Preference/scale confound defined in one sentence
- [x] Human n framed as feasibility, not Study 1
- [x] Paper 2 / follow-on named for powered / interaction work
- [x] User approved / locked 2026-07-24
