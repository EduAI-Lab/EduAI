#!/usr/bin/env python3
"""PREREG_v3.md Sec 6.3: judge replicate self-consistency, computed from
already-stored raw replicate data (no new judge calls).

Covers all three judge processes that use 3-replicate majority voting:
  - standalone-adequacy-raw.jsonl (Stage 4 ladder: adequate/inadequate per
    (promptId, tier), 3 replicates each)
  - pairwise-labels-raw.jsonl (Stage 5 calibration: minimum-adequate-tier,
    3 replicates per small/large judgment)
  - dev-pairwise-labels-raw.jsonl (Stage 6 full dev labeling: same
    minimum-adequate-tier judgment, run over the 67 fresh-dev prompts)

Usage: python3 judge-replicate-agreement.py <path-to-docs/research/v3>
"""
import json
import sys
from collections import Counter
from pathlib import Path


def agreement_stats(splits_count, label):
    total = sum(splits_count.values())
    unanimous = splits_count.get("3-0", 0)
    split_2_1 = splits_count.get("2-1", 0)
    print(f"\n{label}: n={total}")
    if total == 0:
        return
    print(f"  unanimous (3-0): {unanimous} ({100*unanimous/total:.1f}%)")
    print(f"  split (2-1):     {split_2_1} ({100*split_2_1/total:.1f}%)")


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 judge-replicate-agreement.py <path-to-docs/research/v3>", file=sys.stderr)
        sys.exit(1)
    base = Path(sys.argv[1])

    # --- standalone-adequacy-raw.jsonl: group by (promptId, tier), 3 replicates each ---
    adequacy_path = base / "results" / "standalone-adequacy-raw.jsonl"
    rows = [json.loads(l) for l in adequacy_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    groups = {}
    for r in rows:
        key = (r["promptId"], r["tier"])
        groups.setdefault(key, []).append(r["verdict"])

    splits = Counter()
    disagreements = []
    for key, verdicts in groups.items():
        if len(verdicts) != 3:
            continue
        c = Counter(verdicts)
        top = c.most_common(1)[0][1]
        tag = "3-0" if top == 3 else "2-1" if top == 2 else "no-majority"
        splits[tag] += 1
        if tag != "3-0":
            disagreements.append((key, verdicts))

    agreement_stats(splits, "standalone-adequacy (Stage 4 ladder, YES/NO per prompt x tier)")
    print(f"  groups with != 3 replicates: {sum(1 for v in groups.values() if len(v) != 3)}")

    # --- pairwise-style raw files: smallJudgment/largeJudgment each carry their own 3 replicates ---
    def report_pairwise_file(path, label):
        if not path.exists():
            print(f"\n{label}: SKIPPED (file not found: {path})")
            return
        prows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
        for side in ("smallJudgment", "largeJudgment"):
            splits = Counter()
            n_null = 0
            for r in prows:
                j = r.get(side)
                if j is None:
                    n_null += 1
                    continue
                replicates = j.get("replicates", [])
                if len(replicates) != 3:
                    continue
                c = Counter(replicates)
                top = c.most_common(1)[0][1]
                tag = "3-0" if top == 3 else "2-1" if top == 2 else "no-majority"
                splits[tag] += 1
            agreement_stats(splits, f"{label} {side}")
            print(f"  null (not evaluated, short-circuited): {n_null}")

    report_pairwise_file(base / "results" / "pairwise-labels-raw.jsonl", "pairwise-labeling (Stage 5 calibration, minimum-adequate-tier)")
    report_pairwise_file(base / "results" / "dev-pairwise-labels-raw.jsonl", "dev-pairwise-labeling (Stage 6 full dev, minimum-adequate-tier)")

    print("\nNote: 2-1 splits are not errors -- majority vote already resolves them per the "
          "pre-registered protocol. This is a validity/self-consistency statistic (Sec 6.3), "
          "not a correction to any existing label.")


if __name__ == "__main__":
    main()
