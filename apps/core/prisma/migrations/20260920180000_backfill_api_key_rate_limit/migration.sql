-- #1803: rateLimitMax is stamped per-key at creation, not re-read from config.
ALTER TABLE "apiKey" ALTER COLUMN "rateLimitMax" SET DEFAULT 1000;

UPDATE "apiKey"
SET "rateLimitMax" = 1000,
    "rateLimitTimeWindow" = 86400000,
    "requestCount" = 0,
    "lastRequest" = NULL
WHERE "rateLimitMax" IS NULL OR "rateLimitMax" <= 10;
