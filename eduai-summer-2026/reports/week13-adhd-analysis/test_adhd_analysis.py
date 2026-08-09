#!/usr/bin/env python3
"""Focused tests for the leave-one-out sensitivity analysis (#1308, review on #1415).

Uses synthetic, clearly-fake participant data only -- never the real Qualtrics
export, which is participant PII and lives in restricted storage, not this repo.

Run: python3 -m unittest test_adhd_analysis.py -v
"""

import csv
import io
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import pandas as pd

from adhd_analysis import (
    DEFAULT_EXCLUDED_RESPONSE_IDS,
    METRIC_ORDER,
    build_participant_labels,
    load_and_filter,
    run_leave_one_out,
)

HERE = Path(__file__).resolve().parent

# Column schema score_all_metrics()/load_and_filter() require, mirrored from
# the real Qualtrics export shape (read_qualtrics_csv_from_zip skips the
# first two rows as question-text/import-id filler, same as production).
SUS_COLS = [f"Q13_A_SUS_{i}" for i in range(1, 11)] + [f"Q19_B_SUS_{i}" for i in range(1, 11)]
TLX_A_COLS = [f"Q12_A_TLX_{i}" for i in range(1, 6)]
TLX_B_COLS = [f"Q18_B_TLX_{i}" for i in range(1, 6)]
UX_COLS = [f"Q16_A_UX_{i}" for i in range(1, 6)] + [f"Q22_B_UX_{i}" for i in range(1, 6)]
COMP_COLS = ["Q14_A_Comp1", "Q15_A_Comp2", "Q20_B_Comp1", "Q21_B_Comp2"]
PREF_COLS = ["Q23_Prefer", "Q24_BackOnTask", "Q25_ReadScan"]
ALL_COLS = (
    ["ResponseId", "Finished", "group"]
    + SUS_COLS
    + TLX_A_COLS
    + TLX_B_COLS
    + UX_COLS
    + COMP_COLS
    + PREF_COLS
)

# 11 synthetic, obviously-fake participant IDs -- not shaped like real
# Qualtrics ResponseIds -- covering the 2 default data-quality exclusions
# plus 9 others, matching the real pipeline's N=11 finished+valid-group size.
SYNTHETIC_IDS = [f"TEST_P{i:02d}" for i in range(1, 10)] + sorted(DEFAULT_EXCLUDED_RESPONSE_IDS)
assert len(SYNTHETIC_IDS) == 11


def _synthetic_row(idx: int, response_id: str) -> dict:
    """One fabricated participant row where Assistive consistently beats
    Baseline on every metric, with a per-participant magnitude wobble (via
    `idx % 3`) so paired differences aren't perfectly tied across
    participants -- direction stays deterministic, only magnitude varies.
    """
    wobble = idx % 3  # 0, 1, or 2

    row = {"ResponseId": response_id, "Finished": "1", "group": "A"}
    # SUS: odd items score (v-1), even items score (7-v) -- baseline items
    # held at a middling 3/5, Assistive pushed toward the scale extremes
    # that maximize each item's contribution, offset by `wobble`.
    for i in range(1, 11):
        row[f"Q13_A_SUS_{i}"] = 3 if i % 2 else 5  # baseline
        row[f"Q19_B_SUS_{i}"] = (7 - wobble) if i % 2 else (1 + wobble)  # assistive
    # TLX Load (items 1-4, mean) + TLX Perf (item 5). Lower TLX Load is
    # better, so Assistive gets the *lower* value here.
    for i in range(1, 5):
        row[f"Q12_A_TLX_{i}"] = 5  # baseline load
        row[f"Q18_B_TLX_{i}"] = 2 + wobble  # assistive load (lower = better)
    row["Q12_A_TLX_5"] = 4  # baseline perf
    row["Q18_B_TLX_5"] = 6 - wobble  # assistive perf (higher = better)
    # UX (items 1-5; items 3 and 4 reverse-scored by ux_mean itself).
    for i in range(1, 6):
        row[f"Q16_A_UX_{i}"] = 3  # baseline
        row[f"Q22_B_UX_{i}"] = 6 - wobble  # assistive
    # Comprehension (2-item mean per condition).
    row["Q14_A_Comp1"] = 2
    row["Q15_A_Comp2"] = 2
    row["Q20_B_Comp1"] = 5 - wobble
    row["Q21_B_Comp2"] = 5 - wobble
    # Preferences: arbitrary valid categorical text, not exercised by the
    # LOO path but required for load_and_filter()/main() to run end-to-end.
    row["Q23_Prefer"] = "Assistive Mode On"
    row["Q24_BackOnTask"] = "Assistive Mode On"
    row["Q25_ReadScan"] = "No preference"
    return row


def _synthetic_dataframe() -> pd.DataFrame:
    rows = [_synthetic_row(i, rid) for i, rid in enumerate(SYNTHETIC_IDS)]
    return pd.DataFrame(rows, columns=ALL_COLS)


def _write_synthetic_zip(path: Path) -> None:
    """Write a synthetic export zip in the same 3-header-row shape
    read_qualtrics_csv_from_zip() expects (row0=names, rows1-2=filler,
    row3+=data)."""
    df = _synthetic_dataframe()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(ALL_COLS)
    writer.writerow(["question text placeholder"] * len(ALL_COLS))
    writer.writerow(["import id placeholder"] * len(ALL_COLS))
    for _, row in df.iterrows():
        writer.writerow([row[c] for c in ALL_COLS])
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("synthetic_export.csv", buf.getvalue())


class RunLeaveOneOutTests(unittest.TestCase):
    def setUp(self):
        self.df = _synthetic_dataframe()
        self.labels = build_participant_labels(self.df["ResponseId"])
        self.result = run_leave_one_out(self.df, METRIC_ORDER, self.labels)

    def test_row_count_is_55(self):
        # 11 participants x 5 metrics per held-out participant.
        self.assertEqual(len(self.result), 55)

    def test_one_removal_per_participant(self):
        counts = self.result["participant_removed"].value_counts()
        self.assertEqual(set(counts.index), set(self.labels.values()))
        self.assertTrue((counts == 5).all())

    def test_five_metrics_per_removal(self):
        for label in self.labels.values():
            metrics = set(self.result.loc[self.result["participant_removed"] == label, "metric"])
            self.assertEqual(metrics, set(METRIC_ORDER))

    def test_participant_removed_is_anonymized(self):
        # None of the raw synthetic ResponseIds should leak into the output.
        removed = set(self.result["participant_removed"])
        self.assertTrue(removed.issubset(set(self.labels.values())))
        self.assertFalse(any(rid in removed for rid in SYNTHETIC_IDS))

    def test_tlx_load_direction_rule(self):
        # Assistive TLX Load is fixtured lower (better) than Baseline for
        # every participant, so the raw effect_r sign is negative (per the
        # pipeline's existing assistive-minus-baseline convention) -- but
        # since TLX Load is lower-is-better, `direction` must still read
        # "favors Assistive", not a literal (backwards) "favors Baseline".
        tlx = self.result[self.result["metric"] == "TLX_Load"]
        self.assertTrue((tlx["effect_r"] < 0).all(), "fixture should produce a negative raw r")
        self.assertTrue((tlx["direction"] == "favors Assistive").all())

    def test_non_inverted_metric_direction_matches_raw_sign(self):
        # SUS is not in METRIC_LOWER_IS_BETTER, so a positive raw r should
        # map directly to "favors Assistive" with no sign flip.
        sus = self.result[self.result["metric"] == "SUS"]
        self.assertTrue((sus["effect_r"] > 0).all())
        self.assertTrue((sus["direction"] == "favors Assistive").all())


class LooIgnoresIncludeExcludedFlagTests(unittest.TestCase):
    """Integration check: main()'s --include-excluded flag changes the
    *primary* n analysis, but LOO always runs on the full sample regardless
    (real pipeline builds loo_df via load_and_filter(..., exclude_ids=set())
    unconditionally) -- so loo_sensitivity.csv must be identical either way."""

    def test_loo_output_identical_with_and_without_include_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            label_zip = tmp / "label.zip"
            numeric_zip = tmp / "numeric.zip"
            _write_synthetic_zip(label_zip)
            _write_synthetic_zip(numeric_zip)

            outdir_default = tmp / "out_default"
            outdir_included = tmp / "out_included"
            for outdir, extra_args in (
                (outdir_default, []),
                (outdir_included, ["--include-excluded"]),
            ):
                outdir.mkdir()
                subprocess.run(
                    [
                        sys.executable,
                        str(HERE / "adhd_analysis.py"),
                        "--label-zip",
                        str(label_zip),
                        "--numeric-zip",
                        str(numeric_zip),
                        "--outdir",
                        str(outdir),
                        *extra_args,
                    ],
                    cwd=HERE,
                    check=True,
                    capture_output=True,
                    text=True,
                )

            default_csv = (outdir_default / "loo_sensitivity.csv").read_text()
            included_csv = (outdir_included / "loo_sensitivity.csv").read_text()
            self.assertEqual(default_csv, included_csv)
            # Sanity: the *primary* analysis output does differ (n=9 vs
            # n=11), confirming the flag is actually doing something and
            # this isn't a vacuously-passing test.
            default_summary = (outdir_default / "analysis_summary.csv").read_text()
            included_summary = (outdir_included / "analysis_summary.csv").read_text()
            self.assertNotEqual(default_summary, included_summary)


class LoadAndFilterExclusionTests(unittest.TestCase):
    def test_exclude_ids_removes_only_named_participants(self):
        df = _synthetic_dataframe()
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = Path(tmp) / "numeric.zip"
            _write_synthetic_zip(zip_path)
            full = load_and_filter(zip_path)
            curated = load_and_filter(zip_path, exclude_ids=DEFAULT_EXCLUDED_RESPONSE_IDS)
        self.assertEqual(len(full), 11)
        self.assertEqual(len(curated), 9)
        self.assertEqual(
            set(full["ResponseId"]) - set(curated["ResponseId"]), DEFAULT_EXCLUDED_RESPONSE_IDS
        )


if __name__ == "__main__":
    unittest.main()
