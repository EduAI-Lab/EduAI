# Paper 1 — figures (camera-ready assets)

**Status:** 2026-07-14 · draft assets for IUI 2027 assemble  
**Path:** this folder + `adhd-assist-paper/latex/figures/`

## Figure 1 — Pipeline overview (mid-§1)

Mermaid source: [`fig1-pipeline.mmd`](./fig1-pipeline.mmd)  
Also embedded in [`drafts/01-intro.md`](../drafts/01-intro.md) after the Dean paragraph.

**Caption (intro):**  
Figure 1. How ADHD Assist runs in EduAI chat. A learner message is typed; the Router picks the turn type and length caps; the Teacher policy applies the ADHD structure rules; the model writes a full draft. If second-pass Dean checking is on, the Dean judges that draft against those rules and may fix or rewrite it before anything streams to the learner. If Dean is off, the draft goes out without that audit. Adapted from Liu et al.'s (2024) Dean oversight cadence.

## Figure 2 — Three Study 1 arms (§4)

Mermaid source: [`fig2-dean-pipeline.mmd`](./fig2-dean-pipeline.mmd)  
Embedded in [`drafts/04-system.md`](../drafts/04-system.md).

**Caption:**  
Figure 2. Three Study 1 arms on the Teacher-Dean control stack. Baseline: drafting model only. Prompt-only: Teacher policy on, Dean off. Oversight: Teacher policy and Dean both on. Same drafting model in all arms. Distinct from Figure 1 (runtime flowchart with Router).

## Table 1 — Freeze three-arm rates (Study 1 primary)

Source: `eduai-summer-2026/reports/form-a/paper1-frozen-eval-numbers.md`  
Provenance: git `7abe68a0…` · `google:gemini-2.5-flash` · 5 repeats/arm.

| Arm | Overall strict | Overall profile | Late-turn strict | Late-turn profile |
| --- | -------------: | --------------: | ---------------: | ----------------: |
| Baseline | 0% | 0% | 0% | 0% |
| Prompt-only | 67% | 76% | 77% | 86% |
| Oversight | 71% | 80% | 80% | 89% |

**Caption:**  
Table 1. Structural pass rates on Form A multi-turn probes (mean over five repeats). Profile pass is turn-type-aware (correct redirects need not carry full Top summary). Lead with profile for assist-arm comparisons; always report both.

## LaTeX stubs

- `figures/fig1-pipeline.md` — this mermaid (copy into draw.io / Excalidraw / TikZ as preferred)
- Rates already embedded as `table` in manuscript §5; keep single source = freeze file

## Render note

Prefer vector (PDF/SVG). Do not screenshot Mermaid from chat for camera-ready if ACM wants crisp lines — redraw once in TikZ or Illustrator using this grammar.
