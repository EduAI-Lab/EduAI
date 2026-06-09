# Task suite copy for dev server

On s378, copy `prompts.v1.jsonl` from your URA machine here:

```bash
# from your laptop (PowerShell example)
scp "docs/research/data/task-suite/prompts.v1.jsonl" \
  s378:/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core/scripts/research/data/task-suite/
```

Or set `RESEARCH_SUITE_DIR` in `.env.research` to wherever you placed the file.

Canonical source: `URA/docs/research/data/task-suite/prompts.v1.jsonl`
