-- Per-model override for CHAT_CONTEXT_FILL_RATIO (#1639). When set, the chat
-- context pipeline digests older turns once the assembled prompt reaches this
-- fraction (0 < r <= 1) of the model's context window, instead of the global
-- env default. NULL falls back to CHAT_CONTEXT_FILL_RATIO / 0.90.
ALTER TABLE "ai_models" ADD COLUMN "contextFillRatio" DOUBLE PRECISION;
