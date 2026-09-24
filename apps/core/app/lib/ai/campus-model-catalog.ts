/** The campus models this release expects the Core catalog to expose. */
export const CAMPUS_INTERACTIVE_MODEL_IDS = ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] as const;

/** Large tool-capable Assist model served by cmps02 GPU 1. */
export const RETAINED_ASSIST_MODEL_ID = "qwen3.8-27b-instruct" as const;

/** Models that must not remain active after a clean catalog sync/seed. */
export const LEGACY_CAMPUS_MODEL_IDS = [
  "qwen2.5-7b-instruct",
  "qwen3.5-4b-instruct",
  "qwen2.5-32b-instruct",
] as const;

/**
 * Models addressed by id (Assist Auto, topic analysis) rather than via Auto
 * routing, so the seed and sync clear any stale routerTier on them (#1802).
 */
export const DIRECT_ADDRESSED_MODEL_IDS = [RETAINED_ASSIST_MODEL_ID] as const;
