# Paper 1 — Overleaf package (IUI 2027)

Two-column ACM conference layout (`sigconf`) + approved prose + native TikZ figures.

## Upload / refresh on Overleaf

1. Use `../paper1-iui2027-overleaf.zip`, or zip this folder.
2. Overleaf → **New Project** → **Upload Project** (or replace files in an existing project).
3. Compiler: **pdfLaTeX** · Main: `main.tex`.
4. Recompile 2–3 times for refs/figures.

## Layout modes

| Mode | Class options | When |
| ---- | ------------- | ---- |
| **Working / share** (default here) | `sigconf,anonymous` | Two-column paper look |
| PCS review | `sigconf,anonymous,review` | Adds line numbers |
| Do **not** use | `manuscript` | Single-column draft (what you disliked) |

## Figures

| Fig | File | Notes |
| --- | ---- | ----- |
| 1 | `figures/fig1-pipeline.tex` | Runtime Router→Teacher→Draft→Dean |
| 2 | `figures/fig2-three-arms.tex` | Three Study 1 arms (TikZ, not PNG) |

Do **not** reintroduce deprecated “~95% with oversight.” Freeze numbers only.
