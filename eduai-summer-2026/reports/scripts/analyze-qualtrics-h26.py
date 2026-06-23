#!/usr/bin/env python3
"""
H26-00906 Qualtrics export → descriptive stats + paired Cohen's d (Baseline vs Assist).

Usage:
  python3 eduai-summer-2026/reports/scripts/analyze-qualtrics-h26.py path/to/export.csv
  python3 eduai-summer-2026/reports/scripts/analyze-qualtrics-h26.py export.csv --out report.md

Formulas align with eduai-summer-2026/reports/form-a/three-condition-sus-tlx-comparison.md
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import sys
from datetime import date
from pathlib import Path


def parse_qualtrics_num(raw: str) -> float:
    """Extract leading integer from Qualtrics cells like '4Moderate' or '1StronglyDisagree'."""
    if raw is None or raw == "":
        return math.nan
    m = re.match(r"^(-?\d+)", str(raw).strip())
    return float(m.group(1)) if m else math.nan


def sus_score_1_7(items: list[float]) -> float:
    """Brooke SUS 0–100 adapted for 1–7 Likert (divide adjusted sum by 60)."""
    if len(items) != 10 or any(not math.isfinite(v) for v in items):
        return math.nan
    total = 0.0
    for i, v in enumerate(items):
        if i % 2 == 0:  # items 1,3,5,7,9
            total += v - 1
        else:  # reverse 2,4,6,8,10
            total += 7 - v
    return (total / 60.0) * 100.0


def mean(vals: list[float]) -> float:
    v = [x for x in vals if math.isfinite(x)]
    return sum(v) / len(v) if v else math.nan


def sd(vals: list[float]) -> float:
    v = [x for x in vals if math.isfinite(x)]
    if len(v) < 2:
        return math.nan
    m = mean(v)
    var = sum((x - m) ** 2 for x in v) / (len(v) - 1)
    return math.sqrt(var)


def cohens_d_paired(baseline: list[float], assist: list[float]) -> float:
    if len(baseline) != len(assist) or len(baseline) < 2:
        return math.nan
    diffs = [b - a for b, a in zip(baseline, assist)]
    d_sd = sd(diffs)
    if not math.isfinite(d_sd) or d_sd == 0:
        return 0.0 if mean(diffs) == 0 else math.nan
    return mean(diffs) / d_sd


def fmt(n: float, digits: int = 2) -> str:
    return f"{n:.{digits}f}" if math.isfinite(n) else "—"


def pct(n: int, total: int) -> str:
    return f"{(n / total) * 100:.0f}%" if total else "—"


def tlx_workload(tlx: list[float]) -> float:
    if len(tlx) < 4:
        return math.nan
    load = tlx[:4]
    return mean(load) if all(math.isfinite(x) for x in load) else math.nan


def is_finished(raw: str) -> bool:
    return str(raw).strip().lower() in ("true", "1", "yes")


def is_adhd_yes(raw: str) -> bool:
    s = str(raw).strip().lower()
    return s in ("1", "yes", "true") or "yes" in s


def normalize_mode_choice(raw: str) -> str:
    """Map Qualtrics text or numeric recodes to assist | baseline | none."""
    s = str(raw).strip()
    if not s:
        return ""
    lower = s.lower()
    if lower in ("2",) or "assistive mode on" in lower or lower == "assist":
        return "assist"
    if lower in ("1",) or "baseline" in lower or "assistive mode off" in lower:
        return "baseline"
    if lower in ("3",) or "no preference" in lower or "neither" in lower:
        return "none"
    return ""


def mode_label(code: str) -> str:
    return {"assist": "Assist", "baseline": "Baseline", "none": "No preference"}.get(code, "—")


def load_participants(csv_path: Path) -> list[dict]:
    with csv_path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if len(rows) < 3:
        return []
    headers = rows[0]
    out = []
    for cells in rows[2:]:
        if not cells or not cells[0] or cells[0].startswith("{"):
            continue
        row = {headers[i]: (cells[i] if i < len(cells) else "") for i in range(len(headers))}

        group = str(row.get("group", "")).strip().upper()
        a_is_baseline = group != "B"

        a_tlx = [parse_qualtrics_num(row.get(f"Q12_A_TLX_{i}")) for i in range(1, 6)]
        b_tlx = [parse_qualtrics_num(row.get(f"Q18_B_TLX_{i}")) for i in range(1, 6)]
        a_sus_items = [parse_qualtrics_num(row.get(f"Q13_A_SUS_{i}")) for i in range(1, 11)]
        b_sus_items = [parse_qualtrics_num(row.get(f"Q19_B_SUS_{i}")) for i in range(1, 11)]

        def cond(tlx, sus_items, comp_key, ux_prefix):
            return {
                "tlx": tlx,
                "tlx_workload": tlx_workload(tlx),
                "tlx_performance": tlx[4] if len(tlx) > 4 else math.nan,
                "sus": sus_score_1_7(sus_items),
                "comp_main": parse_qualtrics_num(row.get(comp_key)),
                "ux_reorient": parse_qualtrics_num(row.get(f"{ux_prefix}_1")),
                "ux_scan": parse_qualtrics_num(row.get(f"{ux_prefix}_2")),
                "ux_oriented": parse_qualtrics_num(row.get(f"{ux_prefix}_5")),
                "cog_load": mean([tlx[0], tlx[2]]) if math.isfinite(tlx[0]) and math.isfinite(tlx[2]) else math.nan,
            }

        cond_a = cond(a_tlx, a_sus_items, "Q14_A_Comp1", "Q16_A_UX")
        cond_b = cond(b_tlx, b_sus_items, "Q20_B_Comp1", "Q22_B_UX")
        baseline = cond_a if a_is_baseline else cond_b
        assist = cond_b if a_is_baseline else cond_a

        out.append(
            {
                "response_id": row.get("ResponseId", ""),
                "status": row.get("Status", ""),
                "distribution": row.get("DistributionChannel", ""),
                "progress": row.get("Progress", ""),
                "finished": is_finished(row.get("Finished", "")),
                "adhd_raw": row.get("Q4_ADHD", ""),
                "adhd_yes": is_adhd_yes(row.get("Q4_ADHD", "")),
                "group": group,
                "prefer": normalize_mode_choice(row.get("Q23_Prefer", "")),
                "back_on_task": normalize_mode_choice(row.get("Q24_BackOnTask", "")),
                "read_scan": normalize_mode_choice(row.get("Q25_ReadScan", "")),
                "baseline": baseline,
                "assist": assist,
            }
        )
    return out


def paired_metric(participants: list[dict], b_key: str, a_key: str, lower_is_better: bool):
    b_vals, a_vals = [], []
    for p in participants:
        b = p["baseline"][b_key]
        a = p["assist"][a_key]
        if math.isfinite(b) and math.isfinite(a):
            b_vals.append(b)
            a_vals.append(a)
    n = len(b_vals)
    b_mean, a_mean = mean(b_vals), mean(a_vals)
    delta = a_mean - b_mean if math.isfinite(a_mean) and math.isfinite(b_mean) else math.nan
    d = cohens_d_paired(b_vals, a_vals)
    if not math.isfinite(delta):
        direction = "tie"
    elif lower_is_better:
        direction = "Assist lower ✓" if delta < 0 else ("Baseline lower" if delta > 0 else "tie")
    else:
        direction = "Assist higher ✓" if delta > 0 else ("Baseline higher" if delta < 0 else "tie")
    return {
        "n": n,
        "b_mean": b_mean,
        "a_mean": a_mean,
        "b_sd": sd(b_vals),
        "a_sd": sd(a_vals),
        "delta": delta,
        "d": d,
        "direction": direction,
    }


def count_mode(participants: list[dict], field: str, choice: str) -> int:
    return sum(1 for p in participants if p.get(field) == choice)


def build_report(
    all_participants: list[dict],
    csv_path: Path,
    *,
    excluded: list[dict] | None = None,
    exclude_note: str = "",
) -> str:
    excluded = excluded or []
    excluded_ids = {p["response_id"] for p in excluded}
    finished_all = [p for p in all_participants if p["finished"]]
    finished = [p for p in finished_all if p["response_id"] not in excluded_ids]
    incomplete = [p for p in all_participants if not p["finished"]]
    n = len(finished)
    preview_n = sum(
        1
        for p in finished
        if "preview" in str(p.get("distribution", "")).lower()
        or "preview" in str(p.get("status", "")).lower()
    )
    adhd_n = sum(1 for p in finished if p["adhd_yes"])
    prefer_assist = count_mode(finished, "prefer", "assist")
    prefer_baseline = count_mode(finished, "prefer", "baseline")
    prefer_none = count_mode(finished, "prefer", "none")

    def tlx_key(i: int) -> str:
        return f"tlx_{i}"

    # store tlx subscales via accessor
    metrics_spec = [
        ("TLX Mental demand ↓", lambda p: p["baseline"]["tlx"][0], lambda p: p["assist"]["tlx"][0], True),
        ("TLX Temporal demand ↓", lambda p: p["baseline"]["tlx"][1], lambda p: p["assist"]["tlx"][1], True),
        ("TLX Effort ↓", lambda p: p["baseline"]["tlx"][2], lambda p: p["assist"]["tlx"][2], True),
        ("TLX Frustration ↓", lambda p: p["baseline"]["tlx"][3], lambda p: p["assist"]["tlx"][3], True),
        ("TLX Performance ↑", lambda p: p["baseline"]["tlx_performance"], lambda p: p["assist"]["tlx_performance"], False),
        ("TLX Raw workload ↓", lambda p: p["baseline"]["tlx_workload"], lambda p: p["assist"]["tlx_workload"], True),
        ("SUS composite (0–100) ↑", lambda p: p["baseline"]["sus"], lambda p: p["assist"]["sus"], False),
        ("Comprehension (main ideas) ↑", lambda p: p["baseline"]["comp_main"], lambda p: p["assist"]["comp_main"], False),
        ("UX Re-orient after leaving ↑", lambda p: p["baseline"]["ux_reorient"], lambda p: p["assist"]["ux_reorient"], False),
        ("UX Layout easy to scan ↑", lambda p: p["baseline"]["ux_scan"], lambda p: p["assist"]["ux_scan"], False),
        ("UX Felt oriented in app ↑", lambda p: p["baseline"]["ux_oriented"], lambda p: p["assist"]["ux_oriented"], False),
        ("Cognitive load index ↓", lambda p: p["baseline"]["cog_load"], lambda p: p["assist"]["cog_load"], True),
    ]

    metric_rows = []
    for label, bf, af, lower in metrics_spec:
        b_vals = [bf(p) for p in finished]
        a_vals = [af(p) for p in finished]
        valid = [(b, a) for b, a in zip(b_vals, a_vals) if math.isfinite(b) and math.isfinite(a)]
        b_only = [b for b, _ in valid]
        a_only = [a for _, a in valid]
        delta = mean(a_only) - mean(b_only) if valid else math.nan
        d = cohens_d_paired(b_only, a_only)
        if not math.isfinite(delta):
            direction = "tie"
        elif lower:
            direction = "Assist lower ✓" if delta < 0 else ("Baseline lower" if delta > 0 else "tie")
        else:
            direction = "Assist higher ✓" if delta > 0 else ("Baseline higher" if delta < 0 else "tie")
        metric_rows.append(
            {
                "label": label,
                "n": len(valid),
                "b_mean": mean(b_only),
                "a_mean": mean(a_only),
                "b_sd": sd(b_only),
                "a_sd": sd(a_only),
                "delta": delta,
                "d": d,
                "direction": direction,
            }
        )

    lines = [
        "# H26-00906 Track B — participant metrics (Baseline vs Assist + oversight)",
        "",
        f"**Generated:** {date.today().isoformat()}",
        f"**Source CSV:** `{csv_path}`",
        "**Design:** Within-person · Baseline vs Assistive Mode On (Phase 3 oversight ON)",
        "",
        "## Sample",
        "",
        "| Field | Value |",
        "| ----- | ----- |",
        f"| Finished responses (n) | **{n}** |",
        f"| Finished before exclusions | {len(finished_all)} |",
        f"| Excluded from means (outlier / confound) | {len(excluded)} |",
        f"| Incomplete / partial (excluded) | {len(incomplete)} |",
        f"| Distribution = preview | {preview_n} |",
        f"| Parsed rows (all) | {len(all_participants)} |",
        f"| ADHD self-identified | {adhd_n} / {n} ({pct(adhd_n, n)}) |",
        f"| Prefer Assist (Q23) | {prefer_assist} / {n} |",
        f"| Prefer Baseline (Q23) | {prefer_baseline} / {n} |",
        f"| No preference (Q23) | {prefer_none} / {n} |",
        "",
    ]
    if excluded:
        lines += [
            "## Excluded participants (not in means)",
            "",
            exclude_note or "Manually excluded via `--exclude`.",
            "",
            "| ResponseId | Group | TLX load B | TLX load A | SUS B | SUS A | Prefer | Reason |",
            "| ---------- | ----- | ---------- | ---------- | ----- | ----- | ------ | ------ |",
        ]
        for p in excluded:
            b, a = p["baseline"], p["assist"]
            lines.append(
                f"| {p['response_id']} | {p['group'] or '—'} | {fmt(b['tlx_workload'])} | {fmt(a['tlx_workload'])} | "
                f"{fmt(b['sus'], 1)} | {fmt(a['sus'], 1)} | {mode_label(p['prefer'])} | Outlier / confound |"
            )
        lines.append("")

    lines += [
        "## Formulas",
        "",
        "| Metric | Formula |",
        "| ------ | ------- |",
        "| NASA-TLX Raw Workload | mean(Mental, Temporal, Effort, Frustration), 1–7, **lower = better** |",
        "| NASA-TLX Performance | TLX item 5, **higher = better** |",
        "| SUS (0–100) | Brooke: odd items `v−1`, even items `7−v`, then `(sum / 60) × 100` on 1–7 scale |",
        "| Cognitive load index | mean(Mental demand, Effort), **lower = better** |",
        "| **Paired Cohen's d** | `mean(Baseline − Assist) / SD(Baseline − Assist)` across participants |",
        "| Independent Cohen's d | OFF vs ON chat telemetry — `report-adhd-metrics.ts` (different design) |",
        "",
        "**Reading Cohen's d (paired):**",
        "- Load metrics (↓): **positive d** → Baseline higher → favors Assist",
        "- Benefit metrics (↑): **negative d** → Assist higher → favors Assist",
        "",
        "## Descriptive statistics + paired Cohen's d",
        "",
        "| Metric | n | Baseline M (SD) | Assist M (SD) | Δ (Assist−Baseline) | Cohen's d | Direction |",
        "| ------ | -: | --------------- | ------------- | ------------------: | --------: | --------- |",
    ]

    for m in metric_rows:
        lines.append(
            f"| {m['label']} | {m['n']} | {fmt(m['b_mean'])} ({fmt(m['b_sd'])}) | "
            f"{fmt(m['a_mean'])} ({fmt(m['a_sd'])}) | {fmt(m['delta'])} | {fmt(m['d'])} | {m['direction']} |"
        )

    lines += [
        "",
        "## Effect size labels",
        "",
        "| |d| | Interpretation |",
        "| --- | -------------- |",
        "| < 0.2 | negligible |",
        "| 0.2 – 0.5 | small |",
        "| 0.5 – 0.8 | medium |",
        "| ≥ 0.8 | large |",
        "",
        "> **Power note:** SD and Cohen's d need **n ≥ 2** paired finished responses. With n < 30, treat as **descriptive** only.",
        "",
        "## Per-participant composites",
        "",
        "| ResponseId | Status | Group | ADHD | TLX load B | TLX load A | SUS B | SUS A | Prefer |",
        "| ---------- | ------ | ----- | ---- | ---------- | ---------- | ----- | ----- | ------ |",
    ]

    for p in finished:
        b, a = p["baseline"], p["assist"]
        adhd_label = "Yes" if p["adhd_yes"] else ("No" if p["adhd_raw"] else "—")
        lines.append(
            f"| {p['response_id']} | {p.get('distribution') or p['status'] or '—'} | {p['group'] or '—'} | {adhd_label} | "
            f"{fmt(b['tlx_workload'])} | {fmt(a['tlx_workload'])} | {fmt(b['sus'], 1)} | {fmt(a['sus'], 1)} | {mode_label(p['prefer'])} |"
        )

    if incomplete:
        lines += [
            "",
            "## Incomplete responses (excluded from stats)",
            "",
            "| ResponseId | Progress | Distribution |",
            "| ---------- | -------- | ------------ |",
        ]
        for p in incomplete:
            lines.append(
                f"| {p['response_id']} | {p.get('progress') or '—'}% | {p.get('distribution') or '—'} |"
            )

    lines += [
        "",
        "## Preference counts",
        "",
        "| Item | Assist | Baseline | No preference |",
        "| ---- | -----: | -------: | ------------: |",
        f"| Q23 Overall preference | {prefer_assist} | {prefer_baseline} | {prefer_none} |",
        f"| Q24 Back on task | {count_mode(finished, 'back_on_task', 'assist')} | "
        f"{count_mode(finished, 'back_on_task', 'baseline')} | "
        f"{count_mode(finished, 'back_on_task', 'none')} |",
        f"| Q25 Easier to read/scan | {count_mode(finished, 'read_scan', 'assist')} | "
        f"{count_mode(finished, 'read_scan', 'baseline')} | "
        f"{count_mode(finished, 'read_scan', 'none')} |",
        "",
        "## Re-run when Qualtrics export updates",
        "",
        "```bash",
        "python3 eduai-summer-2026/reports/scripts/analyze-qualtrics-h26.py \\",
        '  "apps/core/docs/H26-00906 EduAI ADHD Assist Study — 1st Participant_June 22, 2026_16.36.csv" \\',
        "  --out eduai-summer-2026/reports/form-a/h26-track-b-participant-metrics.md",
        "```",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--out", help="Write markdown report to this path")
    ap.add_argument(
        "--production-only",
        action="store_true",
        help="Exclude Survey Preview rows from analysis",
    )
    ap.add_argument(
        "--exclude",
        help="Comma-separated ResponseIds to exclude from finished-participant means",
    )
    ap.add_argument(
        "--exclude-note",
        default="",
        help="Markdown note explaining exclusions (shown in report)",
    )
    args = ap.parse_args()

    csv_path = Path(args.csv)
    all_rows = load_participants(csv_path)
    if args.production_only:
        # Drop preview distribution rows before analysis
        all_rows = [
            p
            for p in all_rows
            if "preview" not in str(p.get("distribution", "")).lower()
            and "preview" not in str(p.get("status", "")).lower()
        ]

    exclude_ids = [x.strip() for x in (args.exclude or "").split(",") if x.strip()]
    excluded_rows = [p for p in all_rows if p["response_id"] in exclude_ids and p["finished"]]
    report = build_report(
        all_rows,
        csv_path,
        excluded=excluded_rows,
        exclude_note=args.exclude_note,
    )
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
        finished_all_n = sum(1 for p in all_rows if p["finished"])
        analyzed_n = finished_all_n - len(excluded_rows)
        print(
            f"Wrote {args.out} (analyzed n={analyzed_n}, "
            f"finished={finished_all_n}, parsed={len(all_rows)}, excluded={len(excluded_rows)})"
        )
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
