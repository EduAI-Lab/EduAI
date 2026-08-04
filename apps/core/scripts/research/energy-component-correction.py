#!/usr/bin/env python3
"""PREREG_v3.md energy correction: per-component (CPU/GPU) idle-tax subtraction.

The energy sidecar's measure-start/measure-stop window on every pre-fix
generation-results.jsonl row includes the ~10s probe-tax wait baked into
/api/chat's non-streaming path, in addition to real inference draw (see
RUN_LOG.md 2026-08-03 "Energy sidecar timing assumption checked"). A flat
-108.9J GPU-only correction was already applied to `energyJoules` in
generation-results.energy-corrected.jsonl; this script instead corrects
`joulesCpu` and `joulesGpu` separately, using each host's own idle-floor
replicate measurement (RUN_LOG.md §12 cmps01 idle floor with {2B,9B}
resident; this session's cmps02 idle floor with {4B,27B} resident).

The tax window is capped at each row's own latencyMs (min(10s, latency)),
not a flat 10s constant. The original 800 rows all had a >=10s probe-tax
floor (raw latency 10,073-10,666ms) so a flat 10s subtraction was safe for
them, but the post-fix top-up rows (v3-201+) no longer carry that floor —
some complete in under 2s. Subtracting a flat 10s tax from those drove
energyJoules negative before the max(0, ...) clamp silently zeroed several
rows to a physically impossible 0J (caught by independent review 2026-08-03,
see RUN_LOG.md). Capping the tax at actual latency fixes this without
changing any of the original 800 rows' corrected values.

Usage: python3 energy-component-correction.py <path-to-docs/research/v3>
"""
import json
import sys
from pathlib import Path

# J/s idle draw, per host, measured with the actual served pair resident
# (5 x 20s replicates each, see RUN_LOG.md).
IDLE_RATES = {
    "2b": {"cpu": 107.10, "gpu": 30.13, "host": "cmps01", "note": "5-rep {2B,9B} resident, RUN_LOG.md 2026-08-03 Stage-4 idle floor"},
    "9b": {"cpu": 107.10, "gpu": 30.13, "host": "cmps01", "note": "5-rep {2B,9B} resident, RUN_LOG.md 2026-08-03 Stage-4 idle floor"},
    "4b": {"cpu": 93.37, "gpu": 17.82, "host": "cmps02", "note": "5-rep {4B,27B} resident, measured this session"},
    "27b": {"cpu": 93.37, "gpu": 17.82, "host": "cmps02", "note": "5-rep {4B,27B} resident, measured this session"},
}

# Fixed probe-tax wait baked into every non-streaming /api/chat call
# (raw latency floor observed 10,073-10,666ms across all tiers before any
# real generation time; see RUN_LOG.md's flat -108.9J entry).
PROBE_TAX_SECONDS = 10.0


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 energy-component-correction.py <path-to-docs/research/v3>", file=sys.stderr)
        sys.exit(1)
    base = Path(sys.argv[1])
    in_path = base / "results" / "generation-results.jsonl"
    out_path = base / "results" / "generation-results.energy-component-corrected.jsonl"

    rows = [json.loads(l) for l in in_path.read_text(encoding="utf-8").splitlines() if l.strip()]

    n_corrected = 0
    n_skipped = 0
    n_capped = 0
    for r in rows:
        tier = r.get("tier")
        rates = IDLE_RATES.get(tier)
        if rates is None or r.get("joulesCpu") is None or r.get("joulesGpu") is None:
            n_skipped += 1
            continue
        latency_s = (r.get("latencyMs") or 0) / 1000.0
        tax_seconds = min(PROBE_TAX_SECONDS, latency_s) if latency_s > 0 else PROBE_TAX_SECONDS
        if tax_seconds < PROBE_TAX_SECONDS:
            n_capped += 1
        cpu_tax = rates["cpu"] * tax_seconds
        gpu_tax = rates["gpu"] * tax_seconds
        r["joulesCpuRaw"] = r["joulesCpu"]
        r["joulesGpuRaw"] = r["joulesGpu"]
        r["joulesCpu"] = max(0.0, r["joulesCpu"] - cpu_tax)
        r["joulesGpu"] = max(0.0, r["joulesGpu"] - gpu_tax)
        if r.get("energyJoules") is not None:
            r["energyJoulesRaw"] = r.get("energyJoulesRaw", r["energyJoules"])
        r["energyJoules"] = r["joulesCpu"] + r["joulesGpu"]
        r["energyCorrectionNote"] = (
            f"per-component idle-tax correction: -{cpu_tax:.1f}J CPU, -{gpu_tax:.1f}J GPU "
            f"({rates['host']} idle floor: {rates['cpu']} J/s CPU + {rates['gpu']} J/s GPU, "
            f"{tax_seconds:.2f}s probe-tax window"
            + (f", capped from {PROBE_TAX_SECONDS:.0f}s to row's own latency" if tax_seconds < PROBE_TAX_SECONDS else "")
            + f"; {rates['note']})"
        )
        n_corrected += 1

    out_path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    print(f"corrected {n_corrected} rows ({n_capped} with tax capped below {PROBE_TAX_SECONDS:.0f}s due to short latency), skipped {n_skipped} (missing tier mapping or sub-fields)")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
