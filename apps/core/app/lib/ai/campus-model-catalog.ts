/** The campus models this release expects the Core catalog to expose. */
export const CAMPUS_INTERACTIVE_MODEL_IDS = ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] as const;

/** Retained only for Assist Auto while the separate host rollout is pending. */
export const RETAINED_ASSIST_MODEL_ID = "qwen2.5-32b-instruct" as const;

/** Models that must not remain active after a clean catalog sync/seed. */
export const LEGACY_CAMPUS_MODEL_IDS = ["qwen2.5-7b-instruct", "qwen3.5-4b-instruct"] as const;
