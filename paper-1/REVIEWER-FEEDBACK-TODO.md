# Paper 1 — Reviewer feedback backlog (not fixable by editing alone)

**Source:** simulated senior PC review + author feedback pass, 2026-07-14 evening.  
**Updated:** 2026-07-24 — Week 12 #1137 Claude gap review (`WEEK12-1137-GAP-REVIEW.md`). Merged duplicates; added net-new items; tagged **Abstract 13 Aug** vs **Full paper 20 Aug** vs **Later**.  
**Author correction 2026-07-24:** Paper 1 confirmed as **system/architecture paper** (human = feasibility, not the bar). A.1 and A.3 **rescoped** — the n=6 ADHD cohort and cross-model Qwen runs already exist; see A.1, A.3, D.30, D.31.  
**Scope:** items that require new experiments, new data, new citations, or a framing decision. Quick editorial fixes from the 2026-07-14 feedback were already applied to `overleaf/` (see `FORMAT_REPORT.md` and git history).

**Deadline legend:** `ABS` = before IUI abstract (13 Aug) · `FULL` = before full paper (20 Aug) · `LATER` = camera-ready / rebuttal / Paper 2

---

## A. Evidence gaps (need new work before or during rebuttal)

1. **Human study — RESCOPED 2026-07-24 (author correction).** Paper 1 is a **system/architecture paper**; the human cohort is feasibility/supporting, not the acceptance bar. A real cohort **already exists**: `eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md` — 9 records → 7 finished → **n=6 analyzed** (1 auto-excluded), paired **Cohen's d** all favoring Assist (TLX raw workload d=0.94; SUS d=0.84; comprehension d=1.06; cognitive-load index d=0.98; felt-oriented d=1.29; 5/6 prefer Assist, 0 baseline). A *powered* study is **not** required for IUI. **Action flipped:** stop hiding the data — §6 currently says "full means live in the study archive." Report the n=6 paired descriptives + d as **feasibility / descriptive** (preview distribution, not confirmatory). Powered ADHD × non-ADHD stays Paper 2.  
   **Deadline:** `ABS` = keep Path IUI, no confirmatory language · `FULL` = **report n=6 paired means + Cohen's d in §6** (see D.30) · `LATER` = powered study (Paper 2)

2. **No statistical tests on Study 1.** Add at minimum Fisher's exact (or bootstrap CIs) on per-turn pass/fail counts across arms. The 76% vs 80% delta sits inside the observed ranges (50–93 vs 71–86); a test may show it is not separable at 5 repeats. Consider more repeats before claiming the oversight lift.  
   **Deadline:** `LATER` (nice for rebuttal); draft already says rates are not population CIs — keep that hedge for `FULL`

3. **Single model — RESCOPED 2026-07-24 (author correction).** Cross-model runs **do exist**: Qwen 2.5 7B + 32B on cmps01 vLLM (and inactive gpt-oss:120b / gemma) — see `eduai-summer-2026/reports/form-a/model-role-sizing-findings.md`. But they are **partial** (4 of 16 cells captured, pre-profile-routing, blind global scoring), **not** the frozen 5× suite. So: the *frozen ablation* is still single-model (Gemini 2.5 Flash), but "model-agnostic by design" now has **exploratory cross-model support** to cite. **Action:** add a short cross-model paragraph citing the Qwen exploratory runs; keep the frozen-suite single-model as an honest limitation. A clean frozen second-model row is a `LATER` A-strengthener, not required to submit.  
   **Deadline:** `FULL` = cite Qwen exploratory + state freeze is single-model · **DONE 2026-07-24** (partial-matrix hedge in Limitations + Discussion) · `LATER` = frozen second-model row

4. **Checker validity / inter-rater reliability.** The automated structural checker has no human agreement study. Sample N turns, have 2 independent raters score them, report agreement with the checker.  
   **Deadline:** `LATER`

5. **Content-parity audit.** Dean rewrites are claimed to be structure-only; no sampled audit is published. Run the planned key-point coverage audit on Dean-rewritten turns (Chevalier-style) before any "structure not facts" claim.  
   **Deadline:** `FULL` = keep honest hedge (already in draft) · `LATER` = sample table if claim hardens

6. **Circularity of the Dean evaluation.** Judge and policy share the same constitution and authorship. Mitigations to consider: independent rater scoring against the constitution; an external rubric; or reporting Dean-rewrite quality separately from pass rates.  
   **Deadline:** `LATER`

7. **Probe suite reproducibility.** Paper does not specify scenario count, total turns scored, or example probes. Add an appendix (or supplementary material) with the scripted probes, turn counts, and scoring config; consider releasing the harness.  
   **Deadline:** `FULL` — **P0**

8. **Latency measurement.** We now say "not systematically measured." Before camera-ready, either measure per-turn latency distributions (draft vs audited turns) or leave the honest disclaimer.  
   **Deadline:** `LATER` (disclaimer already OK for `FULL`)

9. **"Preference / scale confound" is undefined.** Write the one-sentence operational definition of why the excluded pilot participant was excluded (from the study archive) and add it to §6.  
   **Deadline:** `FULL` — **P0** · **DONE 2026-07-24** in `overleaf/sections/feasibility.tex` (categorical Assist preference contradicted SUS↓ + TLX workload↑)

10. **Ethics protocol number completeness.** Confirm whether the pilot ran under H26-00906 or amendment H26-00906-A001 and cite the governing version consistently.  
    **Deadline:** `FULL`

---

## B. Related-work additions (need reading + new citations)

11. **ITS / adaptive tutoring literature.** VanLehn 2011 (Educational Psychologist) and the Cognitive Tutor line; situate the pillar-to-deficit mapping against 30 years of ITS scaffolding work.  
    **Deadline:** `FULL` if time, else `LATER`

12. **UDL implementation literature** beyond the CAST 2018 guidelines cite.  
    **Deadline:** `LATER` / opportunistic `FULL`

13. **LLM accessibility for neurodivergent users** beyond Zhu et al. (recent CHI/ASSETS work).  
    **Deadline:** `LATER` / opportunistic `FULL`

14. **Prompt robustness / system-prompt adherence / prompt drift** empirical literature — the multi-turn-drift motivation currently argues this position without citing it.  
    **Deadline:** `FULL` if time (high relevance to RQ2)

15. **RAG tutoring factual reliability** literature, relevant to the Dean content-parity constraint.  
    **Deadline:** `LATER`

16. **Saha et al. framing.** "Perhaps the strongest evidence that prompting alone is fragile" is our inference, not their claim; either soften or support with their specific result.  
    **Deadline:** `FULL` — easy edit

17. **LEAP citation weight.** Used as architectural analogy only; either make the analogy do real work in §4 or trim to one mention.  
    **Deadline:** `FULL` — easy edit

---

## C. Framing / structural decisions (author calls, larger rewrites)

18. **Venue-fit risk.** The review predicts an IUI reject on venue mismatch (no interaction evidence). Options: (a) submit to IUI anyway with the feasibility framing; (b) hold for the powered study; (c) reframe as EdTech/NLP systems paper for EDM / AIED / LAK. Currently locked: IUI 2027. Revisit after seeing how much of A.1–A.7 lands by early August.  
    **Deadline:** `ABS` = keep Path IUI decision · `FULL` = add learner-facing interaction paragraph (see **D.24**)

19. **"Baseline 0% is a tautology" objection.** Prepare the rebuttal framing: baseline represents deployed default behavior (what students actually get), not a straw man; the informative contrast is prompt-only vs oversight. Consider adding one sentence in §5 making this explicit.  
    **Deadline:** `FULL` — **P0** · **DONE 2026-07-24** in `study1.tex` results

20. **Templated section scaffolds.** "What we take / What we cannot claim" (×3 in §2) and "When it fails" (×5 in §3) read as generated boilerplate to the reviewer. Rewriting these into flowing prose is a half-day voice pass across §2–§3; not attempted tonight to avoid destabilizing approved content.  
    **Deadline:** `FULL` if half-day available, else `LATER`

21. **Figure 1 originality.** Caption says "adapted from Liu et al."; specify what is original (Router gate, profile-scoped caps, deterministic fixer, human-facing audience) vs inherited (judge-and-revise cadence).  
    **Deadline:** `FULL`

22. **Mesh rating methodology.** Table 1 cells have no assignment procedure or inter-rater process. Either describe how ratings were assigned (and by whom) or expect specific-cell challenges (e.g., P1 metacognition "n" vs P5 metacognition "P/S" consistency).  
    **Deadline:** `FULL`

23. **"Deterministic structural fixes" specification.** List what the deterministic fixer can repair (missing Next?, marker restoration, cap trim) vs what triggers an LLM rewrite; one short paragraph in §4.4.  
    **Deadline:** `FULL`

---

## D. Net-new from Week 12 #1137 gap review (2026-07-24)

24. **IUI interaction surface under-described.** Add a short learner-facing paragraph: Assist toggle, what the student sees when Dean holds then emits, TLDR/Continue vs scored anchors. Strengthens venue fit beyond C.18's binary submit/hold choice.  
    **Deadline:** `ABS` = one control/steering sentence in abstract · **DONE 2026-07-24** (abstract v5, **author-locked**) · `FULL` = system/interaction paragraph (still open)

25. **Expert rubric mentioned but not reported.** Study 1 calls expert rubric scores "secondary" then never shows them. Either add a brief secondary result / appendix row or delete the mention.  
    **Deadline:** `FULL` — **P0** · **DONE 2026-07-24** (mention removed from `study1.tex`)

26. **Hard-turn lift examples lack denominators.** Plan resume 20%→60% and post-interrupt 60%→100% read as cherry-picks without per-cell N. Add turn counts / repeat context or demote to qualitative residual-failure discussion.  
    **Deadline:** `FULL` — **P1** · **DONE 2026-07-24** (demoted to qualitative in `study1.tex`)

27. **Qwen capacity notes lack run path.** Discussion/Limitations cite exploratory Qwen 7B/32B Assist-on behavior without a table or snapshot pointer. Cite a run artifact or strip numeric implication and keep "exploratory, outside freeze."  
    **Deadline:** `FULL` · **DONE 2026-07-24** (labeled partial matrix / not a second frozen suite)

28. **Abstract hallucination lead.** Abstract opens with invented course detail (unmeasured DV). Keep as motivation only; consider one-clause soften so reviewers do not demand a hallucination metric.  
    **Deadline:** `ABS` · **DONE 2026-07-24** (abstract v5, **author-locked**: "motivates control even though we do not score hallucination here")

29. **Submission hygiene.** Supervisor email TODO in `main.tex`; switch to `anonymous,review` for PCS PDF; verify IUI ≤~8,000-word preference.  
    **Deadline:** `ABS` = author list / title freeze · `FULL` = anonymous build + word count · `LATER` = supervisor email if still open at camera-ready

30. **Report the n=6 ADHD cohort in §6 (under-reporting fix).** §6 currently defers to "the study archive." Pull the paired descriptives + Cohen's d from `7_results_consolidated.md` (canonical n=6 snapshot) into a small §6 table (TLX raw workload, SUS, comprehension, cognitive-load index, felt-oriented, preference counts), explicitly labeled **descriptive / feasibility, preview distribution, n=6, not confirmatory**. Keep effect-size caveat (n<30 → descriptive). This is human-centric evidence appropriate to an IUI system paper.  
    **Deadline:** `FULL` — **P0** · **DONE 2026-07-24** in `overleaf/sections/feasibility.tex` (`tab:pilot`) + draft sync; **author-locked**

31. **Purge legacy / estimated numbers (discipline).** `three-condition-sus-tlx-comparison.md` still carries banned strings (`~15%`, `~80%`, `~95% est.`, "policy-only SUS ~68 est."). `LOCKED-SCOPE.md` forbids any figure not in the frozen snapshot. Before/after each Overleaf edit, confirm only frozen **0 / 76 / 80** (+ late 86→89) and the measured **n=6** metrics appear. No estimated cells.  
    **Deadline:** `FULL` — **P0** · **VERIFIED 2026-07-24:** Overleaf package clean of `~95%` / est. cells; keep ban when editing reports docs

---

**Fixed already (2026-07-14, do not re-do):** staccato §4.5 sentence; "read the table" hand-holding in §5.6; editorial note inside refs.bib entry (Ma et al.); n=6 demoted from numbered contribution to a feasibility note; latency range replaced with honest non-measurement statement; Dean model now stated (same `google:gemini-2.5-flash` as drafting model, per `model-role-sizing-findings.md`); "only honest test" → "appropriate test"; "Dean wins" phrasing; follow-on-work sentence added to abstract.
