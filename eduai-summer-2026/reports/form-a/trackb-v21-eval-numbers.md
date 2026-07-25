# Track B v2.1 — complete three-arm 5× re-freeze

**Run date:** 2026-07-25  
**Git SHA:** `ff653a22011fe30f1950ca38943a6a34b39f2d4a`  
**Policy:** `ADHD_ASSIST_POLICY_VERSION = "2.1"`  
**Model:** `google:gemini-2.5-flash`  
**Course:** `seed_course_cosc101`  
**Scenarios:** S1/S2/S3/S5/S2L (14 turns/run)  
**Sample:** 5 complete repeats/arm = 70 turns/arm, 210 scored turns total

## Headline results

| Arm | Strict | 95% Wilson CI | Profile | 95% Wilson CI | Late-turn profile |
|-----|-------:|--------------:|--------:|--------------:|------------------:|
| Baseline | **0/70 (0.0%)** | 0.0–5.2% | 15/70 (21.4%)* | 13.4–32.4% | 10/35 (28.6%)* |
| Prompt-only | **56/70 (80.0%)** | 69.2–87.7% | **60/70 (85.7%)** | 75.7–92.1% | **31/35 (88.6%)** |
| Oversight | **60/70 (85.7%)** | 75.7–92.1% | **65/70 (92.9%)** | 84.3–96.9% | **34/35 (97.1%)** |

\* Baseline profile pass is not evidence of ADHD structure. The profile metric credits a few unscaffolded responses that happen to match redirect shape; baseline emitted zero Top summary and zero Next? anchors. Use strict pass for the baseline comparison.

### Change from Paper 1 freeze (v1.1)

| Arm | Metric | Freeze | v2.1 | Absolute change |
|-----|--------|-------:|-----:|----------------:|
| Baseline | strict | 0% | 0% | 0 pp |
| Prompt-only | strict | 67% | **80%** | **+13 pp** |
| Prompt-only | profile | 76% | **86%** | **+10 pp** |
| Oversight | strict | 71% | **86%** | **+15 pp** |
| Oversight | profile | 80% | **93%** | **+13 pp** |

### Incremental Dean benefit under the same v2.1 policy

- Profile: prompt-only **60/70 (85.7%)** → oversight **65/70 (92.9%)**: **+5/70, +7.1 percentage points**.
- Strict: prompt-only **56/70 (80.0%)** → oversight **60/70 (85.7%)**: **+4/70, +5.7 points**.
- Late-turn profile: **88.6% → 97.1%**, an **8.5-point** gain.
- Oversight removed every word-cap failure: under-cap **64/70 → 70/70**.
- All full-tutoring turns passed **5/5** with oversight. Residual misses were redirect shape: `S2.t2` **4/5** and `S2L.t2` **1/5**.

### Prompt-only versus oversight exact tests

Pairing each prompt-only turn with the same repeat/turn reference in oversight:

| Metric | Prompt fail / Dean pass | Prompt pass / Dean fail | Exact McNemar p | Independent-count Fisher p |
|--------|------------------------:|------------------------:|-----------------:|---------------------------:|
| Strict | 4 | 0 | 0.125 | 0.502 |
| Profile | 7 | 2 | 0.180 | 0.274 |

Neither contrast is statistically separable at five repeats. The direction is favorable to oversight, but it remains a descriptive lift. These tests treat the 70 turn observations as analysis units; turns also repeat within scenarios, so do not present them as population inference.

## Repeat-level results

| Run | Baseline strict | Prompt strict | Prompt profile | Oversight strict | Oversight profile |
|-----|----------------:|--------------:|---------------:|-----------------:|------------------:|
| 1 | 0/14 | 12/14 | 12/14 | 12/14 | 13/14 |
| 2 | 0/14 | 12/14 | 12/14 | 12/14 | 13/14 |
| 3 | 0/14 | 10/14 | 12/14 | 12/14 | 13/14 |
| 4 | 0/14 | 10/14 | 10/14 | 12/14 | 13/14 |
| 5 | 0/14 | 12/14 | 14/14 | 12/14 | 13/14 |

Ranges:

- Prompt strict: **71.4–85.7%**; profile: **71.4–100%**.
- Oversight strict: **85.7% in every repeat**; profile: **92.9% in every repeat**.

## Per-turn profile pass

| Turn | Baseline | Prompt-only | Oversight | Turn | Baseline | Prompt-only | Oversight |
|------|---------:|------------:|----------:|------|---------:|------------:|----------:|
| S1.t1 | 0/5 | 4/5 | **5/5** | S2L.t1 | 0/5 | 5/5 | **5/5** |
| S2.t1 | 0/5 | 4/5 | **5/5** | S2L.t2 (redirect) | 5/5* | 2/5 | **1/5** |
| S2.t2 (redirect) | 5/5* | 2/5 | **4/5** | S2L.t3 | 0/5 | 5/5 | **5/5** |
| S2.t3 | 0/5 | 5/5 | **5/5** | S2L.t4 | 5/5* | 5/5 | **5/5** |
| S3.t1 | 0/5 | 4/5 | **5/5** | S2L.t5 | 0/5 | 5/5 | **5/5** |
| S3.t2 | 0/5 | 4/5 | **5/5** | S2L.t6 | 0/5 | 5/5 | **5/5** |
| S5.t1 | 0/5 | 5/5 | **5/5** | | | | |
| S5.t2 | 0/5 | 5/5 | **5/5** | | | | |

\* Accidental shape match without ADHD anchors; not an ADHD compliance result.

## Structural diagnostics, length, and latency

| Arm | Top summary | Next? | Under cap | Mean words | Median words | Max words | Mean latency | Median latency |
|-----|------------:|------:|----------:|-----------:|-------------:|----------:|-------------:|---------------:|
| Baseline | 0/70 | 0/70 | 54/70 | 194.8 | 106.0 | 774 | 3,152 ms | 2,683 ms |
| Prompt-only | 60/70 | 60/70 | 64/70 | 133.0 | 131.5 | 287 | 3,127 ms | 2,806 ms |
| Oversight | 60/70 | 60/70 | **70/70** | 116.9 | 112.0 | 250 | 6,194 ms | 2,971 ms |

The 60/70 anchor count is expected: 10 turns are the two redirect probes across five repeats, which should not use the full tutoring scaffold.

## Provenance and exclusions

Valid run roots:

- Baseline: `eval-runs/trackb-v21-repeat/gemini-2.5-flash/baseline/run-01..05`
- Prompt-only: `eval-runs/trackb-v21-repeat/gemini-2.5-flash/prompt-only/run-01..05`
- Oversight: `eval-runs/trackb-v21-repeat/gemini-2.5-flash/oversight-final/run-01..05`

All included runs have 14/14 scored turns, no provider errors, the same code/harness SHA `ff653a22`, and the same course/model. The five included oversight run metadata records report `oversight.enabled=true` and `envValue=true`.

Excluded:

- `oversight/run-01..05` and `oversight-replacement-*`: the server had inherited `ADHD_ASSIST_OVERSIGHT=false`; these are prompt-policy runs and are not Dean evidence.
- `oversight-dean-on-r1..r5`: valid Dean-on outputs, but generated by the older research-worktree harness, which recorded another harness SHA and omitted explicit `profileStructuralPass`. Excluded so all final arms use the exact same harness.
- Two initial oversight runs were also truncated by provider HTTP 429s.
- Earlier `trackb-v21-prompt-restore` n=3 remains a restore smoke cohort, superseded by this complete matched run.

## Research conclusion

The complete v2.1 cohort supports updating the descriptive Study 1 scoreboard: both Assist arms outperform the v1.1 freeze, and the Dean adds a consistent but still modest descriptive lift over the same fixed Teacher policy. Profile compliance is **85.7% prompt-only versus 92.9% oversight**, with late-turn profile **88.6% versus 97.1%**. The five-repeat exact tests do not separate the arms statistically, so preserve the paper's modest-lift framing.

These are repeated synthetic turns, not independent human participants. Report counts, policy/model/course provenance, and the repeated-run design; do not imply participant-level efficacy.
