-- Existing accounts predate mandatory email verification. Preserve their
-- access; accounts created after this migration retain the schema default.
UPDATE "user"
SET "emailVerified" = true
WHERE "emailVerified" = false;
