/**
 * Admin-only Amazon Bedrock overflow settings (#1441 / #1547).
 *
 * Defaults stay at 0 / off so AWS never spends until an administrator
 * enables overflow and types a positive cap.
 */

export const BEDROCK_OVERFLOW_SETTING_PREFIX = "bedrock.overflow.";

export const BEDROCK_OVERFLOW_SETTING_KEYS = [
  "enabled",
  "dailyUserLimit",
  "monthlyUserLimit",
  "globalLimit",
  "resourceLimit",
] as const;

export type BedrockOverflowSettingKey = (typeof BEDROCK_OVERFLOW_SETTING_KEYS)[number];

export type BedrockOverflowSettings = {
  enabled: boolean;
  dailyUserLimit: number;
  monthlyUserLimit: number;
  globalLimit: number;
  resourceLimit: number;
};

export const DEFAULT_BEDROCK_OVERFLOW_SETTINGS: BedrockOverflowSettings = {
  enabled: false,
  dailyUserLimit: 0,
  monthlyUserLimit: 0,
  globalLimit: 0,
  resourceLimit: 0,
};

export const BEDROCK_LIMIT_MAX = 1_000_000;
export const BEDROCK_RESOURCE_WINDOW_MS = 60_000;
export const BEDROCK_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BEDROCK_MONTHLY_WINDOW_MS = 30 * BEDROCK_DAILY_WINDOW_MS;

export const BEDROCK_OVERFLOW_SETTING_DEFINITIONS = {
  enabled: {
    label: "Enable AWS Bedrock overflow",
    description:
      "When local GPUs are saturated, send that one chat turn to Amazon Bedrock. Off by default. Administrators only.",
  },
  dailyUserLimit: {
    label: "Daily cap per user",
    description:
      "Maximum Bedrock overflow turns one user may consume in 24 hours. 0 blocks this cap.",
  },
  monthlyUserLimit: {
    label: "Monthly cap per user",
    description:
      "Maximum Bedrock overflow turns one user may consume in 30 days. 0 blocks this cap.",
  },
  globalLimit: {
    label: "Global monthly cap",
    description: "Maximum Bedrock overflow turns across all users in 30 days. 0 blocks this cap.",
  },
  resourceLimit: {
    label: "Burst / resource limit",
    description: "Maximum Bedrock overflow turns in a 60-second window. 0 blocks this cap.",
  },
} satisfies Record<BedrockOverflowSettingKey, { label: string; description: string }>;

export function defaultBedrockOverflowSettings(): BedrockOverflowSettings {
  return { ...DEFAULT_BEDROCK_OVERFLOW_SETTINGS };
}

export function isBedrockOverflowSettingKey(value: string): value is BedrockOverflowSettingKey {
  return (BEDROCK_OVERFLOW_SETTING_KEYS as readonly string[]).includes(value);
}

export function parseBedrockLimit(value: string | undefined, fallback = 0): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(BEDROCK_LIMIT_MAX, Math.floor(parsed)));
}

export function normalizeBedrockOverflowSettings(
  input: Partial<BedrockOverflowSettings>,
): BedrockOverflowSettings {
  return {
    enabled: Boolean(input.enabled),
    dailyUserLimit: parseBedrockLimit(String(input.dailyUserLimit ?? 0)),
    monthlyUserLimit: parseBedrockLimit(String(input.monthlyUserLimit ?? 0)),
    globalLimit: parseBedrockLimit(String(input.globalLimit ?? 0)),
    resourceLimit: parseBedrockLimit(String(input.resourceLimit ?? 0)),
  };
}

/** True when at least one typed cap can admit an overflow turn. */
export function hasPositiveBedrockCap(settings: BedrockOverflowSettings): boolean {
  return (
    settings.dailyUserLimit > 0 ||
    settings.monthlyUserLimit > 0 ||
    settings.globalLimit > 0 ||
    settings.resourceLimit > 0
  );
}

export function isBedrockProviderName(name: string | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "bedrock";
}

export const BEDROCK_USER_SETTINGS_ERROR =
  "Bedrock is admin-only overflow and cannot be configured from user settings.";
