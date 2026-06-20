-- §3 RBAC policy expansion: fold the standalone `webToolsEnabled` SystemConfig
-- row into the policy registry, which reads it as `policy.chat.webToolsEnabled`.
-- Idempotent data move (no schema change): rename the legacy key only when a
-- value exists and the new key is not already present, so an install that had
-- web tools enabled does not silently revert to the default (false).
UPDATE "system_config"
SET "key" = 'policy.chat.webToolsEnabled'
WHERE "key" = 'webToolsEnabled'
  AND NOT EXISTS (
    SELECT 1 FROM "system_config" sc WHERE sc."key" = 'policy.chat.webToolsEnabled'
  );

-- If the new key already existed, drop the now-redundant legacy row.
DELETE FROM "system_config" WHERE "key" = 'webToolsEnabled';
