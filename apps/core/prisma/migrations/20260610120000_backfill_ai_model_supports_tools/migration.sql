-- #264 backfill: clear supportsTools on non-CHAT models and known small-model slugs.
UPDATE "ai_models"
SET "supportsTools" = false
WHERE "supportsTools" = true
  AND "type"::text != 'CHAT';

UPDATE "ai_models"
SET "supportsTools" = false
WHERE "supportsTools" = true
  AND "type"::text = 'CHAT'
  AND (
    "modelId" ~* '(^|:|/)0\.5b($|:|/|\s)'
    OR "modelId" ~* '(^|:|/)1b($|:|/|\s)'
    OR "modelId" ~* '(^|:|/)1\.5b($|:|/|\s)'
    OR "modelId" ~* '(^|:|/)1\.7b($|:|/|\s)'
    OR "modelId" ~* '(^|:|/)2b($|:|/|\s)'
    OR "modelId" ~* '(^|:|/)3b($|:|/|\s)'
    OR "modelId" ~* 'phi-?3[:.]mini'
    OR "modelId" ~* 'tinyllama'
    OR "modelId" ~* 'gemma2:2b'
    OR "modelId" ~* 'gemma:2b'
  );
