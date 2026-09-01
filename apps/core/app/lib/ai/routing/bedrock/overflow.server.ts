/**
 * Bedrock overflow decision helpers (#1441 / #1547).
 *
 * Bedrock is never a normal pool member. These helpers are the only path
 * that should enable it: local admission timeout or fleet-host exhaustion,
 * and only after an administrator has enabled overflow and typed a
 * positive cap. Defaults stay at 0 / off so AWS does not spend on its own.
 */

import { checkRateLimit } from "~/lib/auth/rate-limit.server";
import type { UserProviderSettings } from "~/lib/ai/provider-types";
import {
  BEDROCK_DAILY_WINDOW_MS,
  BEDROCK_MONTHLY_WINDOW_MS,
  BEDROCK_RESOURCE_WINDOW_MS,
  hasPositiveBedrockCap,
  type BedrockOverflowSettings,
} from "./bedrock-settings";

export const BEDROCK_OVERFLOW_SERVER_ID = "aws-bedrock";
export const BEDROCK_OVERFLOW_RATE_KEY = "bedrock-overflow";
export const DEFAULT_BEDROCK_MODEL_ID = "meta.llama3-70b-instruct-v1:0";
/** @deprecated Use admin Bedrock settings. Kept at 0 so env-only deploys stay off. */
export const DEFAULT_BEDROCK_RATE_LIMIT = 0;
export const DEFAULT_BEDROCK_RATE_WINDOW_MS = BEDROCK_RESOURCE_WINDOW_MS;

export type BedrockOverflowActivation = {
  resolvedModelId: string;
  serverId: typeof BEDROCK_OVERFLOW_SERVER_ID;
};

export type TryActivateBedrockOverflowOptions = {
  userId?: string;
  settings?: BedrockOverflowSettings;
};

export function getBedrockModelId(): string {
  return process.env.BEDROCK_MODEL_ID?.trim() || DEFAULT_BEDROCK_MODEL_ID;
}

export function getBedrockRegion(): string {
  return process.env.BEDROCK_REGION?.trim() || "us-east-1";
}

export function isClientRequestedBedrockModel(model: string | undefined): boolean {
  return (model ?? "").toLowerCase().startsWith("bedrock:");
}

export function isBedrockTokenConfigured(): boolean {
  return Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK?.trim());
}

type OverflowCap = {
  key: string;
  limit: number;
  windowMs: number;
};

function overflowCaps(
  settings: BedrockOverflowSettings,
  userId: string | undefined,
): OverflowCap[] {
  const caps: OverflowCap[] = [];
  if (settings.resourceLimit > 0) {
    caps.push({
      key: BEDROCK_OVERFLOW_RATE_KEY,
      limit: settings.resourceLimit,
      windowMs: BEDROCK_RESOURCE_WINDOW_MS,
    });
  }
  if (settings.globalLimit > 0) {
    caps.push({
      key: `${BEDROCK_OVERFLOW_RATE_KEY}:global:monthly`,
      limit: settings.globalLimit,
      windowMs: BEDROCK_MONTHLY_WINDOW_MS,
    });
  }
  if (userId && settings.dailyUserLimit > 0) {
    caps.push({
      key: `${BEDROCK_OVERFLOW_RATE_KEY}:user:${userId}:daily`,
      limit: settings.dailyUserLimit,
      windowMs: BEDROCK_DAILY_WINDOW_MS,
    });
  }
  if (userId && settings.monthlyUserLimit > 0) {
    caps.push({
      key: `${BEDROCK_OVERFLOW_RATE_KEY}:user:${userId}:monthly`,
      limit: settings.monthlyUserLimit,
      windowMs: BEDROCK_MONTHLY_WINDOW_MS,
    });
  }
  return caps;
}

/**
 * Consume Bedrock overflow slots when the token is configured, an
 * administrator has enabled overflow, and at least one typed cap still
 * has room. Returns the model substitution, or null so the caller can
 * fall through to the existing hard-error response.
 */
export async function tryActivateBedrockOverflow(
  options: TryActivateBedrockOverflowOptions = {},
): Promise<BedrockOverflowActivation | null> {
  if (!isBedrockTokenConfigured()) return null;

  const settings =
    options.settings ??
    (await (await import("./bedrock-settings.server")).getBedrockOverflowSettings());
  if (!settings.enabled || !hasPositiveBedrockCap(settings)) {
    return null;
  }

  const caps = overflowCaps(settings, options.userId);
  if (caps.length === 0) return null;

  for (const cap of caps) {
    const result = await checkRateLimit(cap.key, cap.limit, cap.windowMs);
    if (result.limited) return null;
  }

  return {
    resolvedModelId: `bedrock:${getBedrockModelId()}`,
    serverId: BEDROCK_OVERFLOW_SERVER_ID,
  };
}

/** Enable Bedrock on a settings object without accepting client key/URL overrides. */
export function enableBedrockOnSettings(settings: UserProviderSettings): UserProviderSettings {
  return {
    ...settings,
    bedrock: { isEnabled: true },
  };
}
