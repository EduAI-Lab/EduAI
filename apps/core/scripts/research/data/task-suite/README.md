# Task suite (dev server copy)

**Canonical:** [`URA/docs/research/data/task-suite/`](../../../../../docs/research/data/task-suite/)

Bundled here so research runners work on s378 after `git pull` without relying on the sibling `docs/` tree.

## v2 files

| File | Purpose |
|------|---------|
| `prompts.v2-seed.jsonl` | 50 CS-focused seed rows (ts-127–176) |
| `prompts.v2-replacements.jsonl` | Static replacements ts-121–126 |
| `prompts.v2.jsonl` | Built corpus — `npm run research:build-v2` |

Refresh after editing canonical URA docs:

```powershell
Copy-Item "..\..\..\..\..\docs\research\data\task-suite\prompts.v1.jsonl" ".\prompts.v1.jsonl"
Copy-Item "..\..\..\..\..\docs\research\data\task-suite\prompts.v2-seed.jsonl" ".\prompts.v2-seed.jsonl"
Copy-Item "..\..\..\..\..\docs\research\data\task-suite\prompts.v2-replacements.jsonl" ".\prompts.v2-replacements.jsonl"
Copy-Item "..\..\..\..\..\docs\research\data\task-suite\schema.json" ".\schema.json"
```

From `apps/core`: `npm run research:validate-suite`
