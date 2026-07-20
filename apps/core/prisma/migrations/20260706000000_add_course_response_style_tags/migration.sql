-- Per-course response style tags for instructor AI behaviour (#782).
ALTER TABLE "courses" ADD COLUMN "responseStyleTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
