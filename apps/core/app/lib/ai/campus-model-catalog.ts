/** The campus models this release expects the Core catalog to expose. */
export const CAMPUS_INTERACTIVE_MODEL_IDS = ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] as const;

/** Large tool-capable Assist model served by cmps02 GPU 1. */
export const RETAINED_ASSIST_MODEL_ID = "qwen3.8-27b-instruct" as const;

/** Models that must not remain active after a clean catalog sync/seed. */
export const LEGACY_CAMPUS_MODEL_IDS = ["qwen2.5-7b-instruct", "qwen3.5-4b-instruct"] as const;

/**
 * Models kept active for a direct consumer rather than for Auto routing (#1802).
 * `qwen2.5-32b-instruct` is a generation behind and cmps02 has migrated off it,
 * but `ADHD_ASSIST_AUTO_MODEL_ID` and `DEFAULT_TOPIC_ANALYSIS_MODEL` still
 * resolve it and fail closed without an active catalog row. Retiring it is
 * blocked on re-validating Assist's structural contract (#1523).
 */
export const DIRECT_ADDRESSED_MODEL_IDS = ["qwen2.5-32b-instruct"] as const;
