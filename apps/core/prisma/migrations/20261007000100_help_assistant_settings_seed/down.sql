-- Manual rollback for migration.sql in this directory (Prisma does not run down
-- migrations). Removes only the keys that migration seeds — never any other row.
DELETE FROM "system_config"
WHERE "key" IN (
  'assistant.enable_help_assistant',
  'assistant.enable_student_material_questions',
  'assistant.ai_assistant_max_docs',
  'assistant.ai_assistant_router_model'
);
