# Results moved

**Canonical analysis:** [`URA/docs/research/findings/RESULTS.md`](../../../../../docs/research/findings/RESULTS.md)

Also see: `findings/PAPER1_ROUTING_SECTION.md`, `findings/STRESS_TEST_REPORT.md`

**Run artifacts:** [`URA/docs/research/data/runs/`](../../../../../docs/research/data/runs/)

Regenerate status memo:

```powershell
$env:RESEARCH_RUNS_DIR = "../../../docs/research/data/runs"
$env:RESEARCH_LABEL_OUT = "../../../docs/research/data/runs/labels/labels-strict.v1.jsonl"
npm run research:status-report
```
