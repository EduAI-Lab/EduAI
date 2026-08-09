#!/usr/bin/env python3
"""Reproducible statistical analysis: EduAI ADHD pilot, Assistive vs Baseline.

Reads the two Qualtrics exports (label export for preference text, numeric
export for quantitative scoring), scores the five instruments (SUS, NASA-TLX
load/performance, UX, Comprehension), runs paired Wilcoxon signed-rank tests,
and writes analysis_summary.csv plus five figures.

The raw Qualtrics export zips contain participant-level PII (response IDs,
timestamps, open-feedback text) and must not be committed to this repo --
pull them from the approved restricted storage location before running.
Every committed output anonymizes participant identifiers to sequential
P1..Pn labels, assigned deterministically by sorting the raw ResponseIds
(see build_participant_labels()); re-running this script against the same
restricted-storage export reproduces the same P-label for the same
participant, without that mapping itself ever being written to a
git-tracked file.

Usage:
    python adhd_analysis.py \
        --label-zip /path/to/restricted-storage/ADHD_participants_label.zip \
        --numeric-zip /path/to/restricted-storage/ADHD_participants_numeric.zip \
        --outdir eduai-summer-2026/reports/week13-adhd-analysis

Dependencies: pandas, numpy, scipy, matplotlib (see report for versions used).
"""

import argparse
import io
import json
import zipfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.lines import Line2D
from scipy import stats

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

COLOR_ASSISTIVE = "#4F6EF7"
COLOR_BASELINE = "#94A3B8"
COLOR_NEUTRAL = "#CBD5E1"

METRIC_ORDER = ["SUS", "TLX_Load", "TLX_Perf", "UX", "Comp"]
METRIC_LABELS = {
    "SUS": "SUS (0-100)",
    "TLX_Load": "TLX Load\n(1-7, lower=better)",
    "TLX_Perf": "TLX Performance\n(1-7, higher=better)",
    "UX": "UX Score (1-7)",
    "Comp": "Comprehension (1-5)",
}
# Theoretical (not empirical) instrument range, used only for 0-1 radar normalization.
METRIC_RANGE = {
    "SUS": (0, 100),
    "TLX_Load": (1, 7),  # inverted at plot time so higher normalized = better
    "TLX_Perf": (1, 7),
    "UX": (1, 7),
    "Comp": (1, 5),
}
METRIC_LOWER_IS_BETTER = {"TLX_Load"}

BONFERRONI_ALPHA = 0.01  # 5 planned comparisons -> .05 / 5

# Response IDs held out of the primary analysis, per the data-quality calls
# documented in eduai-summer-2026/reports/form-a/week13-1226-stats-one-pager.md:
#   R_62F6naaHk7ItKgb - metric outlier (stated preference contradicts own SUS+TLX scores)
#   R_2Cgk3tzIPPPemYU - concept confound (open feedback describes Apple Assistive Access,
#                       not EduAI Assist -- not evaluating the system under test)
# Pass --include-excluded to run the full, uncurated sample instead (used as a
# sensitivity check, not the primary reported number).
DEFAULT_EXCLUDED_RESPONSE_IDS = {"R_62F6naaHk7ItKgb", "R_2Cgk3tzIPPPemYU"}

PREF_COLUMNS = {
    "Q23_Prefer": "Overall preference",
    "Q24_BackOnTask": "Back-on-task preference",
    "Q25_ReadScan": "Read/Scan preference",
}
PREF_COLOR_MAP = {
    "Assistive Mode On": COLOR_ASSISTIVE,
    "Baseline (Assistive Mode Off)": COLOR_BASELINE,
    "No preference": COLOR_NEUTRAL,
}


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def read_qualtrics_csv_from_zip(zip_path: Path) -> pd.DataFrame:
    """Load a Qualtrics 3-header-row export from inside a zip file.

    Row 0 = column names, row 1 = question text, row 2 = import IDs,
    row 3+ = participant data.
    """
    with zipfile.ZipFile(zip_path) as zf:
        csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            raise FileNotFoundError(f"No CSV found inside {zip_path}")
        with zf.open(csv_names[0]) as f:
            df = pd.read_csv(io.TextIOWrapper(f, encoding="utf-8"), header=0, dtype=str)
    return df.iloc[2:].reset_index(drop=True)


def finished_mask(series: pd.Series) -> pd.Series:
    """Qualtrics' 'Finished' column is '1'/'0' in the numeric export but
    'True'/'False' in the label export. Normalize both to a bool mask."""
    return series.astype(str).str.strip().str.lower().isin(["1", "true"])


def load_and_filter(zip_path: Path, exclude_ids: set[str] | None = None) -> pd.DataFrame:
    df = read_qualtrics_csv_from_zip(zip_path)
    mask = finished_mask(df["Finished"]) & df["group"].isin(["A", "B"])
    if exclude_ids:
        mask &= ~df["ResponseId"].isin(exclude_ids)
    out = df.loc[mask].reset_index(drop=True)
    return out


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def to_num(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    return df[cols].apply(pd.to_numeric, errors="coerce")


def sus_7pt(df: pd.DataFrame, prefix: str) -> pd.Series:
    """Adapted SUS for a 7-point Likert scale, rescaled to 0-100.

    Odd items (positively worded) score (v-1); even items (negatively
    worded) score (7-v). Sum ranges 0-60 -> *100/60 gives 0-100. Any missing
    item on a given row invalidates that row's score (skipna=False).
    """
    cols = [f"{prefix}_{i}" for i in range(1, 11)]
    vals = to_num(df, cols)
    scored = pd.DataFrame(index=vals.index)
    for i, col in enumerate(cols, start=1):
        scored[col] = (vals[col] - 1) if i % 2 == 1 else (7 - vals[col])
    return (scored.sum(axis=1, skipna=False) / 60) * 100


def tlx_load(df: pd.DataFrame, prefix: str) -> pd.Series:
    cols = [f"{prefix}_{i}" for i in range(1, 5)]
    return to_num(df, cols).mean(axis=1, skipna=False)


def tlx_perf(df: pd.DataFrame, prefix: str) -> pd.Series:
    return pd.to_numeric(df[f"{prefix}_5"], errors="coerce")


def ux_mean(df: pd.DataFrame, prefix: str) -> pd.Series:
    """UX3 and UX4 (3rd/4th items) are reverse-scored on the 1-7 scale."""
    cols = [f"{prefix}_{i}" for i in range(1, 6)]
    vals = to_num(df, cols).copy()
    vals[cols[2]] = 8 - vals[cols[2]]  # UX3
    vals[cols[3]] = 8 - vals[cols[3]]  # UX4
    return vals.mean(axis=1, skipna=False)


def comp_mean(df: pd.DataFrame, col1: str, col2: str) -> pd.Series:
    return to_num(df, [col1, col2]).mean(axis=1, skipna=False)


def map_conditions(df: pd.DataFrame, series_a: pd.Series, series_b: pd.Series):
    """Group A: Condition A=Baseline, Condition B=Assistive.
    Group B: Condition A=Assistive, Condition B=Baseline."""
    is_group_a = (df["group"] == "A").to_numpy()
    a = series_a.to_numpy(dtype=float)
    b = series_b.to_numpy(dtype=float)
    assistive = np.where(is_group_a, b, a)
    baseline = np.where(is_group_a, a, b)
    return assistive, baseline


def score_all_metrics(df: pd.DataFrame) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    raw = {
        "SUS": (sus_7pt(df, "Q13_A_SUS"), sus_7pt(df, "Q19_B_SUS")),
        "TLX_Load": (tlx_load(df, "Q12_A_TLX"), tlx_load(df, "Q18_B_TLX")),
        "TLX_Perf": (tlx_perf(df, "Q12_A_TLX"), tlx_perf(df, "Q18_B_TLX")),
        "UX": (ux_mean(df, "Q16_A_UX"), ux_mean(df, "Q22_B_UX")),
        "Comp": (
            comp_mean(df, "Q14_A_Comp1", "Q15_A_Comp2"),
            comp_mean(df, "Q20_B_Comp1", "Q21_B_Comp2"),
        ),
    }
    return {m: map_conditions(df, a, b) for m, (a, b) in raw.items()}


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------


def ci95(arr: np.ndarray):
    m = float(np.mean(arr))
    sd = float(np.std(arr, ddof=1)) if len(arr) > 1 else float("nan")
    if len(arr) > 1:
        half = float(stats.t.ppf(0.975, len(arr) - 1) * stats.sem(arr))
    else:
        half = float("nan")
    return m, sd, m - half, m + half


def r_ci_fisher(r: float, n: int, alpha: float = 0.05):
    """Approximate 95% CI for effect size r via Fisher z-transform, treating
    r as a correlation-like statistic (standard approximation; n-3 denom)."""
    if n <= 3 or not np.isfinite(r) or abs(r) >= 1:
        return float("nan"), float("nan")
    z = np.arctanh(r)
    se = 1 / np.sqrt(n - 3)
    zcrit = stats.norm.ppf(1 - alpha / 2)
    lo, hi = np.tanh(z - zcrit * se), np.tanh(z + zcrit * se)
    return float(lo), float(hi)


def paired_stats(assistive: np.ndarray, baseline: np.ndarray, metric: str) -> dict:
    valid = ~np.isnan(assistive) & ~np.isnan(baseline)
    a, b = assistive[valid], baseline[valid]
    n = len(a)
    n_dropped = int((~valid).sum())

    a_mean, a_sd, a_lo, a_hi = ci95(a)
    b_mean, b_sd, b_lo, b_hi = ci95(b)
    delta = a_mean - b_mean

    diffs = a - b
    W, p, r, r_lo, r_hi, note = (
        float("nan"),
        float("nan"),
        float("nan"),
        float("nan"),
        float("nan"),
        "",
    )
    if n < 2:
        note = "n<2, Wilcoxon not computable"
    elif np.allclose(diffs, 0):
        note = "no variance in paired differences"
    else:
        try:
            W, p = stats.wilcoxon(a, b, zero_method="wilcox", alternative="two-sided")
            p_for_z = max(p, np.finfo(float).tiny)
            z = stats.norm.ppf(1 - p_for_z / 2)
            sign = np.sign(np.median(diffs))
            if sign == 0:
                sign = np.sign(delta) or 1
            r = float(sign * z / np.sqrt(n))
            r_lo, r_hi = r_ci_fisher(r, n)
        except ValueError as e:
            note = f"wilcoxon not computable: {e}"

    return {
        "metric": metric,
        "n": n,
        "n_dropped_missing": n_dropped,
        "assistive_mean": a_mean,
        "assistive_sd": a_sd,
        "assistive_ci_lo": a_lo,
        "assistive_ci_hi": a_hi,
        "baseline_mean": b_mean,
        "baseline_sd": b_sd,
        "baseline_ci_lo": b_lo,
        "baseline_ci_hi": b_hi,
        "delta_assistive_minus_baseline": delta,
        "wilcoxon_W": W,
        "p_value": p,
        "effect_r": r,
        "effect_r_ci_lo": r_lo,
        "effect_r_ci_hi": r_hi,
        "below_bonferroni_alpha_.01": bool(p < BONFERRONI_ALPHA) if pd.notna(p) else False,
        "note": note,
    }


# ---------------------------------------------------------------------------
# Leave-one-out sensitivity (#1308)
# ---------------------------------------------------------------------------


def build_participant_labels(response_ids) -> dict[str, str]:
    """Map raw Qualtrics ResponseIds to sequential P1..Pn labels.

    Assignment is deterministic (sorted ResponseId order), so re-running the
    pipeline against the same restricted-storage export reproduces the same
    label for the same participant without ever writing the raw-id-to-label
    mapping itself to a git-tracked file.
    """
    return {rid: f"P{i}" for i, rid in enumerate(sorted(set(response_ids)), start=1)}


def run_leave_one_out(
    df: pd.DataFrame, metrics: list[str], participant_labels: dict[str, str]
) -> pd.DataFrame:
    """Leave-one-out sensitivity analysis: for each participant, refit the
    paired Wilcoxon test on the remaining n-1 sample and record how the
    statistic, p-value, effect size, and direction shift.

    Runs on the full finished+valid-group sample (N=11, no data-quality
    exclusions applied) rather than the primary curated n=9 sample, so that
    any single respondent's influence on the result -- including the two
    respondents excluded from the primary analysis -- is visible directly,
    instead of being pre-filtered out before the check even starts.
    """
    rows = []
    for held_out_id in df["ResponseId"]:
        subset = df.loc[df["ResponseId"] != held_out_id].reset_index(drop=True)
        scored = score_all_metrics(subset)
        for metric in metrics:
            assistive, baseline = scored[metric]
            stat = paired_stats(assistive, baseline, metric)
            r = stat["effect_r"]
            # effect_r itself is left on the pipeline's existing raw-value sign
            # convention (same as analysis_summary.csv / the forest plot), but
            # "direction" needs to say what it means in plain language, so it
            # has to flip for lower-is-better metrics (TLX Load): a negative
            # raw r there means Assistive scored *lower* load, i.e. it favors
            # Assistive, not Baseline.
            directional_r = -r if metric in METRIC_LOWER_IS_BETTER else r
            if not np.isfinite(directional_r) or directional_r == 0:
                direction = "tied / not computable"
            elif directional_r > 0:
                direction = "favors Assistive"
            else:
                direction = "favors Baseline"
            rows.append(
                {
                    "participant_removed": participant_labels[held_out_id],
                    "metric": metric,
                    "wilcoxon_W": stat["wilcoxon_W"],
                    "p_value": stat["p_value"],
                    "effect_r": r,
                    "direction": direction,
                }
            )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------


def _style_axes(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_facecolor("white")


def chart_grouped_bars(stats_rows: list[dict], outpath: Path, n: int):
    fig, axes = plt.subplots(1, len(METRIC_ORDER), figsize=(18, 4.5))
    fig.patch.set_facecolor("white")
    row_by_metric = {r["metric"]: r for r in stats_rows}

    for ax, metric in zip(axes, METRIC_ORDER):
        r = row_by_metric[metric]
        means = [r["assistive_mean"], r["baseline_mean"]]
        err_lo = [means[0] - r["assistive_ci_lo"], means[1] - r["baseline_ci_lo"]]
        err_hi = [r["assistive_ci_hi"] - means[0], r["baseline_ci_hi"] - means[1]]
        ax.bar(
            [0, 1],
            means,
            yerr=[err_lo, err_hi],
            capsize=5,
            color=[COLOR_ASSISTIVE, COLOR_BASELINE],
            width=0.6,
            error_kw={"ecolor": "#374151", "elinewidth": 1.4},
        )
        ax.set_xticks([0, 1])
        ax.set_xticklabels(["Assistive", "Baseline"], fontsize=10)
        ax.set_title(METRIC_LABELS[metric], fontsize=10.5, pad=10)
        top = max(r["assistive_ci_hi"], r["baseline_ci_hi"])
        ax.set_ylim(0, top * 1.25 if top > 0 else 1)
        delta = r["delta_assistive_minus_baseline"]
        ax.annotate(
            f"{'+' if delta >= 0 else ''}{delta:.1f}",
            xy=(0.5, top * 1.08),
            ha="center",
            fontsize=10,
            fontweight="bold",
            color="#1E293B",
        )
        _style_axes(ax)

    fig.suptitle(
        f"EduAI Assistive vs. Baseline — Pilot N={n} (ADHD)",
        fontsize=14,
        fontweight="bold",
        y=1.04,
    )
    fig.text(0.5, -0.02, "Error bars = 95% CI. Δ = Assistive − Baseline.", ha="center", fontsize=9, color="#475569")
    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def chart_slope_plots(scored: dict, outpath: Path):
    fig, axes = plt.subplots(1, len(METRIC_ORDER), figsize=(18, 5))
    fig.patch.set_facecolor("white")

    for ax, metric in zip(axes, METRIC_ORDER):
        assistive, baseline = scored[metric]
        valid = ~np.isnan(assistive) & ~np.isnan(baseline)
        a, b = assistive[valid], baseline[valid]
        lower_is_better = metric in METRIC_LOWER_IS_BETTER
        for ai, bi in zip(a, b):
            favors_assistive = (ai < bi) if lower_is_better else (ai > bi)
            tied = np.isclose(ai, bi)
            color = "#94A3B8" if tied else (COLOR_ASSISTIVE if favors_assistive else "#EF4444")
            ax.plot([0, 1], [bi, ai], color=color, alpha=0.75, linewidth=1.6, marker="o", markersize=4)
        ax.set_xlim(-0.25, 1.25)
        ax.set_xticks([0, 1])
        ax.set_xticklabels(["Baseline", "Assistive"], fontsize=10)
        ax.set_title(METRIC_LABELS[metric], fontsize=10.5, pad=10)
        _style_axes(ax)

    handles = [
        Line2D([0], [0], color=COLOR_ASSISTIVE, lw=2, label="Favors Assistive"),
        Line2D([0], [0], color="#EF4444", lw=2, label="Favors Baseline"),
        Line2D([0], [0], color="#94A3B8", lw=2, label="Tied"),
    ]
    fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, 1.08), ncol=3, frameon=False, fontsize=10)
    fig.suptitle("Individual Participant Change: Baseline → Assistive", fontsize=13, fontweight="bold", y=1.15)
    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def chart_forest_plot(stats_rows: list[dict], outpath: Path):
    fig, ax = plt.subplots(figsize=(9, 5.5))
    fig.patch.set_facecolor("white")

    rows = list(reversed(stats_rows))  # top-to-bottom = METRIC_ORDER order
    ys = np.arange(len(rows))

    for y, r in zip(ys, rows):
        rv, lo, hi = r["effect_r"], r["effect_r_ci_lo"], r["effect_r_ci_hi"]
        if not np.isfinite(rv):
            ax.plot(0, y, marker="x", color="#94A3B8", markersize=8)
            continue
        mag = abs(rv)
        color = "#94A3B8" if mag < 0.1 else ("#93C5FD" if mag < 0.3 else ("#4F6EF7" if mag < 0.5 else "#1E3A8A"))
        if np.isfinite(lo) and np.isfinite(hi):
            ax.plot([lo, hi], [y, y], color=color, linewidth=2, alpha=0.6, zorder=1)
        ax.plot(rv, y, marker="D", markersize=9, color=color, zorder=2)
        label = f"W={r['wilcoxon_W']:.1f}, p={r['p_value']:.3f}" if np.isfinite(r["wilcoxon_W"]) else "n/a"
        ax.annotate(label, xy=(rv, y), xytext=(8, 8), textcoords="offset points", fontsize=8.5, color="#334155")

    for ref in (0.1, 0.3, 0.5):
        for sign in (1, -1):
            ax.axvline(sign * ref, color="#CBD5E1", linestyle="--", linewidth=0.9, zorder=0)
    ax.axvline(0, color="#334155", linewidth=1.2, zorder=0)

    ax.set_yticks(ys)
    ax.set_yticklabels([METRIC_LABELS[r["metric"]].replace("\n", " ") for r in rows], fontsize=10)
    ax.set_xlabel("Effect size r  (negative = favors Baseline, positive = favors Assistive)", fontsize=10)
    ax.set_xlim(-1, 1)
    ax.set_title(
        "Effect Sizes (Wilcoxon r) — small=.1, medium=.3, large=.5",
        fontsize=12.5,
        fontweight="bold",
        pad=12,
    )
    _style_axes(ax)
    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def chart_preferences(label_df: pd.DataFrame, outpath: Path):
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.patch.set_facecolor("white")

    for ax, (col, title) in zip(axes, PREF_COLUMNS.items()):
        counts = label_df[col].fillna("No response").replace("", "No response").value_counts()
        counts = counts[counts.index != "No response"]
        colors = [PREF_COLOR_MAP.get(k, "#E2E8F0") for k in counts.index]
        total = counts.sum()
        wedges, _ = ax.pie(
            counts.values,
            colors=colors,
            startangle=90,
            wedgeprops={"width": 0.45, "edgecolor": "white", "linewidth": 2},
        )
        labels = [f"{k}\n{v} ({v/total*100:.0f}%)" for k, v in counts.items()]
        ax.legend(wedges, labels, loc="center", fontsize=8.5, frameon=False)
        ax.set_title(title, fontsize=11.5, fontweight="bold", pad=10)

    fig.suptitle("Preference Items (Q23-Q25)", fontsize=13.5, fontweight="bold", y=1.03)
    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def _radar_normalize(metric: str, value: float) -> float:
    lo, hi = METRIC_RANGE[metric]
    norm = (value - lo) / (hi - lo)
    if metric in METRIC_LOWER_IS_BETTER:
        norm = 1 - norm
    return float(np.clip(norm, 0, 1))


def chart_radar(stats_rows: list[dict], outpath: Path):
    row_by_metric = {r["metric"]: r for r in stats_rows}
    labels = [METRIC_LABELS[m].replace("\n", " ") for m in METRIC_ORDER]
    assistive_vals = [_radar_normalize(m, row_by_metric[m]["assistive_mean"]) for m in METRIC_ORDER]
    baseline_vals = [_radar_normalize(m, row_by_metric[m]["baseline_mean"]) for m in METRIC_ORDER]

    n = len(METRIC_ORDER)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist()
    assistive_vals += assistive_vals[:1]
    baseline_vals += baseline_vals[:1]
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(7, 7), subplot_kw={"polar": True})
    fig.patch.set_facecolor("white")
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(labels, fontsize=10)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.25, 0.5, 0.75, 1.0])
    ax.set_yticklabels(["0.25", "0.5", "0.75", "1.0"], fontsize=8, color="#64748B")
    ax.set_rlabel_position(20)

    ax.plot(angles, assistive_vals, color=COLOR_ASSISTIVE, linewidth=2, label="Assistive")
    ax.fill(angles, assistive_vals, color=COLOR_ASSISTIVE, alpha=0.25)
    ax.plot(angles, baseline_vals, color=COLOR_BASELINE, linewidth=2, label="Baseline")
    ax.fill(angles, baseline_vals, color=COLOR_BASELINE, alpha=0.25)

    ax.legend(loc="upper right", bbox_to_anchor=(1.25, 1.1), frameon=False)
    ax.set_title(
        "Normalized Profile — Assistive vs. Baseline\n(all axes 0-1, higher=better)",
        fontsize=12.5,
        fontweight="bold",
        pad=20,
    )
    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def _directional_r(metric: str, r: float) -> float:
    """effect_r on a positive=favors-Assistive, negative=favors-Baseline
    scale, flipping the raw value for lower-is-better metrics (TLX Load) --
    same correction _radar_normalize applies for the radar chart. The raw,
    unflipped effect_r (as used in analysis_summary.csv and the forest plot)
    is left alone; this adjustment is local to this chart's plain-language
    axis label."""
    return -r if metric in METRIC_LOWER_IS_BETTER else r


def chart_loo_sensitivity(loo_df: pd.DataFrame, full_n11_stats_rows: list[dict], outpath: Path):
    """One row per metric; each dot is one LOO iteration's effect size r,
    the diamond is the full N=11 (no exclusions) sample's effect size."""
    fig, ax = plt.subplots(figsize=(9, 5.5))
    fig.patch.set_facecolor("white")

    row_by_metric = {r["metric"]: r for r in full_n11_stats_rows}
    rows_order = list(reversed(METRIC_ORDER))
    ys = np.arange(len(rows_order))
    rng = np.random.default_rng(0)

    for y, metric in zip(ys, rows_order):
        sub = loo_df.loc[loo_df["metric"] == metric, "effect_r"].map(lambda r: _directional_r(metric, r))
        finite = sub[np.isfinite(sub)]
        jitter = rng.uniform(-0.12, 0.12, size=len(finite))
        ax.scatter(finite, y + jitter, color=COLOR_ASSISTIVE, alpha=0.55, s=32, zorder=2, edgecolor="none")
        full_r = _directional_r(metric, row_by_metric[metric]["effect_r"])
        if np.isfinite(full_r):
            ax.plot(full_r, y, marker="D", markersize=9, color="#1E293B", zorder=3)

    for ref in (0.1, 0.3, 0.5):
        for sign in (1, -1):
            ax.axvline(sign * ref, color="#CBD5E1", linestyle="--", linewidth=0.9, zorder=0)
    ax.axvline(0, color="#334155", linewidth=1.2, zorder=0)

    ax.set_yticks(ys)
    ax.set_yticklabels([METRIC_LABELS[m].replace("\n", " ") for m in rows_order], fontsize=10)
    ax.set_xlabel(
        "Directional effect size r per LOO iteration (negative = favors Baseline, positive = favors Assistive; "
        "TLX Load sign-flipped since lower=better)",
        fontsize=9,
    )
    ax.set_xlim(-1, 1)
    ax.set_title(
        "Leave-One-Out Sensitivity — Effect Size Stability (N=11, 11 iterations)",
        fontsize=12.5,
        fontweight="bold",
        pad=12,
    )
    handles = [
        Line2D(
            [0],
            [0],
            marker="o",
            color="w",
            markerfacecolor=COLOR_ASSISTIVE,
            alpha=0.7,
            markersize=8,
            label="LOO iteration (1 participant removed)",
        ),
        Line2D([0], [0], marker="D", color="#1E293B", lw=0, markersize=8, label="Full N=11 sample"),
    ]
    fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, 1.04), ncol=2, frameon=False, fontsize=8.5)
    _style_axes(ax)
    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label-zip", required=True, type=Path)
    parser.add_argument("--numeric-zip", required=True, type=Path)
    parser.add_argument("--outdir", required=True, type=Path)
    parser.add_argument(
        "--include-excluded",
        action="store_true",
        help="Skip the default data-quality exclusions (sensitivity check only; "
        "not the primary reported sample).",
    )
    args = parser.parse_args()

    outdir = args.outdir
    fig_dir = outdir / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)

    exclude_ids = set() if args.include_excluded else DEFAULT_EXCLUDED_RESPONSE_IDS
    numeric_df = load_and_filter(args.numeric_zip, exclude_ids)
    label_df = load_and_filter(args.label_zip, exclude_ids)
    n_before_quality_exclusion = len(load_and_filter(args.numeric_zip))

    n = len(numeric_df)
    scored = score_all_metrics(numeric_df)
    stats_rows = [paired_stats(scored[m][0], scored[m][1], m) for m in METRIC_ORDER]

    summary_df = pd.DataFrame(stats_rows)
    summary_df.to_csv(outdir / "analysis_summary.csv", index=False)

    chart_grouped_bars(stats_rows, fig_dir / "01_grouped_bars.png", n)
    chart_slope_plots(scored, fig_dir / "02_slope_plots.png")
    chart_forest_plot(stats_rows, fig_dir / "03_forest_plot.png")
    chart_preferences(label_df, fig_dir / "04_preferences.png")
    chart_radar(stats_rows, fig_dir / "05_radar.png")

    # Leave-one-out sensitivity analysis (#1308). Always runs on the full
    # N=11 finished+valid-group sample, independent of --include-excluded,
    # so it checks robustness against every respondent -- including the two
    # flagged for data quality -- not just the primary n=9.
    loo_df = load_and_filter(args.numeric_zip, exclude_ids=set())
    participant_labels = build_participant_labels(loo_df["ResponseId"])
    loo_results = run_leave_one_out(loo_df, METRIC_ORDER, participant_labels)
    loo_results.to_csv(outdir / "loo_sensitivity.csv", index=False)

    full_n11_scored = score_all_metrics(loo_df)
    full_n11_stats_rows = [
        paired_stats(full_n11_scored[m][0], full_n11_scored[m][1], m) for m in METRIC_ORDER
    ]
    chart_loo_sensitivity(loo_results, full_n11_stats_rows, fig_dir / "06_loo_sensitivity.png")

    # Preference counts for the report, computed here so report numbers are
    # guaranteed consistent with what chart 4 draws.
    pref_summary = {}
    for col, title in PREF_COLUMNS.items():
        counts = label_df[col].fillna("No response").replace("", "No response").value_counts()
        counts = counts[counts.index != "No response"]
        pref_summary[title] = {
            k: {"n": int(v), "pct": round(float(v) / counts.sum() * 100, 1)} for k, v in counts.items()
        }

    n_raw_records = len(read_qualtrics_csv_from_zip(args.numeric_zip))
    dump = {
        "n": n,
        "n_label_file": len(label_df),
        "n_raw_records": n_raw_records,
        "n_after_finished_and_group_filter": n_before_quality_exclusion,
        "n_dropped_incomplete_or_no_group": n_raw_records - n_before_quality_exclusion,
        "n_dropped_data_quality": (0 if args.include_excluded else len(DEFAULT_EXCLUDED_RESPONSE_IDS)),
        "excluded_participants": (
            []
            if args.include_excluded
            else sorted(participant_labels[rid] for rid in DEFAULT_EXCLUDED_RESPONSE_IDS)
        ),
        "metrics": stats_rows,
        "preferences": pref_summary,
        "versions": {
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "scipy": __import__("scipy").__version__,
            "matplotlib": matplotlib.__version__,
        },
    }
    with open(outdir / "stats_dump.json", "w") as f:
        json.dump(dump, f, indent=2, default=str)

    print(f"Raw records in export                            = {n_raw_records}")
    print(f"After Finished + valid-group filter               = {n_before_quality_exclusion} "
          f"(dropped {n_raw_records - n_before_quality_exclusion}: incomplete or no group assigned)")
    if not args.include_excluded:
        print(f"After data-quality exclusions                     = {n} "
              f"(dropped {len(DEFAULT_EXCLUDED_RESPONSE_IDS)}: {sorted(DEFAULT_EXCLUDED_RESPONSE_IDS)})")
    else:
        print(f"Data-quality exclusions skipped (--include-excluded) = {n}")
    print(f"N (label export, same pipeline)                   = {len(label_df)}")
    print()
    for r in stats_rows:
        print(
            f"{r['metric']:>9s}: Assistive M={r['assistive_mean']:.2f} SD={r['assistive_sd']:.2f} "
            f"| Baseline M={r['baseline_mean']:.2f} SD={r['baseline_sd']:.2f} "
            f"| Δ={r['delta_assistive_minus_baseline']:+.2f} "
            f"| W={r['wilcoxon_W']:.1f} p={r['p_value']:.4f} r={r['effect_r']:+.2f} "
            f"(n={r['n']}, dropped={r['n_dropped_missing']}) {r['note']}"
        )
    print()
    print("Preferences:")
    for title, counts in pref_summary.items():
        print(f"  {title}: {counts}")
    print()
    print(f"Leave-one-out sensitivity (N=11, {len(loo_df)} iterations x {len(METRIC_ORDER)} metrics):")
    for metric in METRIC_ORDER:
        sub = loo_results[loo_results["metric"] == metric]
        n_favors_assistive = int((sub["direction"] == "favors Assistive").sum())
        n_favors_baseline = int((sub["direction"] == "favors Baseline").sum())
        r_min, r_max = sub["effect_r"].min(), sub["effect_r"].max()
        full_r = next(r["effect_r"] for r in full_n11_stats_rows if r["metric"] == metric)
        print(
            f"  {metric:>9s}: full-N11 r={full_r:+.2f} | LOO r range=[{r_min:+.2f}, {r_max:+.2f}] "
            f"| direction: {n_favors_assistive}/{len(sub)} favor Assistive, "
            f"{n_favors_baseline}/{len(sub)} favor Baseline"
        )
    print()
    print(
        f"Wrote: {outdir}/analysis_summary.csv, {outdir}/stats_dump.json, {outdir}/loo_sensitivity.csv, "
        f"and 6 figures under {fig_dir}/"
    )


if __name__ == "__main__":
    main()
