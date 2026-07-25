# Content-parity audit note (Paper 1)

**Date:** 2026-07-14 (updated after external verification pass)  
**Job:** What we can honestly say in §5 about “structure not facts.”

## Available evidence (do cite)

| Source | Arms | Finding |
| ------ | ---- | ------- |
| [`expert-scores-external-claude.md`](../eduai-summer-2026/reports/form-a/expert-scores-external-claude.md) | Baseline vs Assist (prompt policy; **no Dean arm**) | Non-drift KP coverage is **generally high and often matched** (many **4/4** or **6/6**); **exceptions** exist (e.g. **3/4**, **4/5**). Do not sloganize as universal “4/4–6/6 in both.” |
| Constitution / Dean design (§4) | Assist+oversight | Dean is instructed to restore markers / trim / redirect template — not invent new teaching content |

## Not available yet (do not overclaim)

| Gap | Status |
| ---- | ------ |
| Blind key-point rescore of frozen Gemini 5× **oversight** rewrites vs first-pass drafts | **Not done** — freeze run transcripts not re-audited here |
| Quantitative “Dean never changed a fact” table for Study 1 | **Open** |

## Paper wording (use this)

> **Content parity.** On Track A expert key-point scoring (Baseline vs Assist prompt policy), non-drift coverage is generally high and often matched, with exceptions (3/4, 4/5). That supports style-as-IV for the Assist *policy*. For the **Dean** arm we have constitution intent but not yet a sampled rewrite-vs-draft key-point table on the frozen Gemini runs — so Study 1’s primary claim stays **scaffold adherence**.

## Next engineering pass (optional before camera-ready)

1. Sample N≈10 rewrite pairs from `eval-runs/paper1-repeat-v2/.../oversight` (when present locally).  
2. Score KP hits on first-pass vs Dean output with `key-point-lists.json`.  
3. Replace the hedge above if parity holds.
