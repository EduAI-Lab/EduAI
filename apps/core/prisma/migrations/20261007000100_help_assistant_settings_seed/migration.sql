-- Seed the help assistant's admin settings (#1817).
--
-- Insert-only: `ON CONFLICT DO NOTHING` means a fresh install and an existing one
-- both get these defaults, and an administrator's earlier choice is never
-- overwritten. The reader also falls back to the same code defaults when a row is
-- missing, so this seed only makes the values visible and auditable.
--
-- `enable_help_assistant` ships OFF: each question spends the platform key when the
-- asker has no key of their own, so turning it on is a deliberate admin decision.
--
-- Rollback: `down.sql` in this directory deletes exactly these keys and nothing else.

INSERT INTO "system_config" ("id", "key", "value", "description", "updatedAt", "updatedBy")
VALUES
  ('assistant_seed_enable_help', 'assistant.enable_help_assistant', 'false',
   'Help assistant (Penny): answer platform how-to questions from the role-scoped user guide.',
   CURRENT_TIMESTAMP, 'migration'),
  ('assistant_seed_student_material', 'assistant.enable_student_material_questions', 'true',
   'Help assistant (Penny): let students ask about the course material they are viewing.',
   CURRENT_TIMESTAMP, 'migration'),
  ('assistant_seed_max_docs', 'assistant.ai_assistant_max_docs', '3',
   'Help assistant (Penny): documentation pages one answer may draw on (1-5).',
   CURRENT_TIMESTAMP, 'migration'),
  ('assistant_seed_router_model', 'assistant.ai_assistant_router_model', '',
   'Help assistant (Penny): cheaper model for follow-up query rewriting; empty reuses the answer model.',
   CURRENT_TIMESTAMP, 'migration')
ON CONFLICT ("key") DO NOTHING;
