# PREREG_v3.md §3.4 step 6 — confirmatory-general draw.
#
# Proportional stratified sample (category x stratum cells, largest-remainder
# allocation) from the never-labeled prompt pool, seed 20260803. Reproduces
# task-suite/confirmatory-general-85.json exactly given the same inputs
# (prompts.v3.jsonl with escalation/dev splits already assigned, and
# results/pairwise-labels.jsonl for reconstructing which prompts were the
# accepted n=10 escalation stratum).
#
# Committed after the fact (2026-08-04) because the original draw was run
# ephemerally and not saved as a script — see RUN_LOG.md. Verified to
# reproduce the saved confirmatory-general-85.json exactly before committing.
#
# Usage: python draw-confirmatory-general.py <path-to-docs/research/v3>
# The v3 research docs live in a sibling directory to this repo, not inside it.

import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

TARGET_TOTAL = 85
SEED = 20260803


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python draw-confirmatory-general.py <path-to-docs/research/v3>")
    v3_root = Path(sys.argv[1])
    prompts_path = v3_root / "task-suite" / "prompts.v3.jsonl"
    labels_path = v3_root / "results" / "pairwise-labels.jsonl"

    rows = [json.loads(line) for line in open(prompts_path, encoding="utf-8")]

    escalation_ids = set()
    for line in open(labels_path, encoding="utf-8"):
        label = json.loads(line)
        if label["escalated"]:
            escalation_ids.add(label["promptId"])

    # Pool at draw time: never-labeled rows, i.e. not the accepted escalation
    # stratum and not burned into dev. Reconstructable post-hoc from the
    # current file since dev/confirmatory-escalation rows are unaffected by
    # this draw.
    pool = [r for r in rows if r["id"] not in escalation_ids and r.get("split") in (None, "confirmatory")]
    assert len(pool) == 152, f"expected pool of 152, got {len(pool)}"

    cells = defaultdict(list)
    for r in pool:
        cells[(r["category"], r["stratum"])].append(r)

    total = len(pool)
    raw_alloc = {k: len(v) / total * TARGET_TOTAL for k, v in cells.items()}
    floor_alloc = {k: math.floor(v) for k, v in raw_alloc.items()}
    remainder = TARGET_TOTAL - sum(floor_alloc.values())
    remainders = sorted(raw_alloc.items(), key=lambda kv: kv[1] - math.floor(kv[1]), reverse=True)
    alloc = dict(floor_alloc)
    for i in range(remainder):
        alloc[remainders[i][0]] += 1

    rng = random.Random(SEED)
    drawn_ids = []
    for k in cells:
        n = alloc[k]
        sorted_items = sorted(cells[k], key=lambda r: r["id"])
        chosen = rng.sample(sorted_items, n)
        drawn_ids.extend(r["id"] for r in chosen)

    assert len(drawn_ids) == TARGET_TOTAL
    assert len(set(drawn_ids)) == TARGET_TOTAL

    print(json.dumps(sorted(drawn_ids), indent=2))


if __name__ == "__main__":
    main()
