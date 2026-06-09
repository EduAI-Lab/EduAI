# Task suite (dev server copy)

**`prompts.v1.jsonl`** is bundled here so `npm run research:run-both-tier` works on s378 after `git pull` — no manual scp.

Canonical source (edit there first): `URA/docs/research/data/task-suite/prompts.v1.jsonl`

Refresh this copy after changing the canonical file:

```powershell
Copy-Item "..\..\..\..\..\docs\research\data\task-suite\prompts.v1.jsonl" ".\prompts.v1.jsonl"
```

From `apps/core`: `npm run research:validate-suite`
