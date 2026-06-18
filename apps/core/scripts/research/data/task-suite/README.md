# Task suite (dev server copy)

**Canonical:** [`URA/docs/research/data/task-suite/prompts.v1.jsonl`](../../../../../docs/research/data/task-suite/prompts.v1.jsonl)

Bundled here so `npm run research:run-both-tier` works on s378 after `git pull`.

Refresh after editing canonical:

```powershell
Copy-Item "..\..\..\..\..\docs\research\data\task-suite\prompts.v1.jsonl" ".\prompts.v1.jsonl"
```

From `apps/core`: `npm run research:validate-suite`