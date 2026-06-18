# Results moved

**Canonical analysis:** [`URA/docs/research/findings/RESULTS.md`](../../../../../docs/research/findings/RESULTS.md)

**Run artifacts:** [`URA/docs/research/data/runs/`](../../../../../docs/research/data/runs/) — see `INDEX.md` there.

**Research hub:** [`URA/docs/research/README.md`](../../../../../docs/research/README.md)

Regenerate status memo from `apps/core`:

```powershell
$env:RESEARCH_RUNS_DIR = "../../../docs/research/data/runs"
npm run research:status-report
```
