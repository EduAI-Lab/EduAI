#!/usr/bin/env python3
"""Filter task-suite JSONL by stratum for adequacy batches."""
import json
import sys
from pathlib import Path

stratum = sys.argv[1] if len(sys.argv) > 1 else "easy"
src = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("prompts.v1.jsonl")
dst = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(f"adequacy-prompts-{stratum}.jsonl")

rows = []
for line in src.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    row = json.loads(line)
    if row.get("stratum") == stratum:
        rows.append(
            {
                "id": row["id"],
                "prompt": row["prompt"],
                "stratum": row["stratum"],
                "category": row["category"],
                "split": row["split"],
                "rag_context": row["rag_context"],
                "tools_expected": row["tools_expected"],
                "course_code": row.get("course_code"),
            }
        )

dst.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
print(f"wrote {len(rows)} prompts → {dst}")
