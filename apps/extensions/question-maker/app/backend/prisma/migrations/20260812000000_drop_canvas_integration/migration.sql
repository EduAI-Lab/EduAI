-- Preserve QM Canvas credentials until the Node migration script has copied them
-- into Core. Renaming (instead of DROP) means a deploy that skips the copier does
-- not permanently destroy tokens. After verifying Core rows, drop the backup
-- table in a follow-up cleanup (see docs/DEPLOYMENT.md).
ALTER TABLE "canvas_integrations" RENAME TO "canvas_integrations_pre_core_backup";
