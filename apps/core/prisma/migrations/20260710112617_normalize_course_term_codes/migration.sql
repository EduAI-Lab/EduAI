-- Backfill legacy free-form course terms (e.g. "Fall", "Winter") to canonical
-- UBC term codes (W1/W2/S1/S2). `startDate` is authoritative and required, so
-- the mapping is derived from its month — mirroring `ubcTermFromDate`:
--   Sep–Dec -> W1   Jan–Apr -> W2   May–Jun -> S1   Jul–Aug -> S2
--
-- Rows already holding a canonical code are left untouched. Month is read in UTC;
-- courses starting within a few hours of a month boundary are the only ambiguous
-- cases and fall to the adjacent term, which is acceptable for historical data.
UPDATE "courses"
SET "term" = CASE
  WHEN EXTRACT(MONTH FROM "startDate") BETWEEN 9 AND 12 THEN 'W1'
  WHEN EXTRACT(MONTH FROM "startDate") BETWEEN 1 AND 4  THEN 'W2'
  WHEN EXTRACT(MONTH FROM "startDate") BETWEEN 5 AND 6  THEN 'S1'
  WHEN EXTRACT(MONTH FROM "startDate") BETWEEN 7 AND 8  THEN 'S2'
  ELSE 'W1'
END
WHERE "term" NOT IN ('W1', 'W2', 'S1', 'S2');
