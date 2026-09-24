-- #1803: rateLimitMax is stamped per-key at creation, not re-read from config.
ALTER TABLE "apiKey" ALTER COLUMN "rateLimitMax" SET DEFAULT 1000;

UPDATE "apiKey"
SET "rateLimitMax" = 1000,
    "rateLimitTimeWindow" = 86400000,
    "requestCount" = 0,
    "lastRequest" = NULL
-- Only rows carrying the plugin default, so a deliberately tight per-key ceiling survives.
WHERE "rateLimitMax" IS NULL
   OR ("rateLimitMax" = 10 AND "rateLimitTimeWindow" = 86400000);
