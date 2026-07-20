-- Backfill Course.year to UBC academic-year semantics (#1088).
--
-- The canonical term model previously labelled a W2 course (Jan-Apr) with the
-- CALENDAR year it starts in, contradicting TERM_RANK's real UBC
-- academic-year order (S1 < S2 < W1 < W2, where W2 follows W1 into the next
-- calendar year). Decision: a W2 session spanning Jan-Apr belongs to the
-- PREVIOUS year's label (Jan-Apr 2026 => year 2025), matching
-- packages/ui/src/lib/term.ts `termInfoFromDate`.
--
-- Only rows still on the old (wrong) calendar-year labelling are touched: a
-- W2 row whose `year` still equals the calendar year of its `startDate`.
-- Re-running this migration is a no-op — after the first run `year` no
-- longer equals EXTRACT(YEAR FROM "startDate") for these rows, so the WHERE
-- guard excludes them.
UPDATE "courses"
SET "year" = "year" - 1
WHERE "term" = 'W2'
  AND EXTRACT(MONTH FROM "startDate") BETWEEN 1 AND 4
  AND "year" = EXTRACT(YEAR FROM "startDate");
