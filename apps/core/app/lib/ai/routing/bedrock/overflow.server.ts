/**
 * Bedrock overflow decision helpers (#1441).
 *
 * Bedrock is never a normal pool member. These helpers are the only path
 * that should enable it: local admission timeout or fleet-host exhaustion,
 * and only while the global cost cap still has room.
 */

import { isRateLimited, parseEnvInt } from "~/lib/auth/rate-limit.server";
import type { UserProviderSettings } from "~/lib/ai/provider-types";

export const BEDROCK_OVERFLOW_SERVER_ID = "aws-bedrock";
export const BEDROCK_OVERFLOW_RATE_KEY = "bedrock-overflow";
export const DEFAULT_BEDROCK_MODEL_ID = "meta.llama3-70b-instruct-v1:0";
export const DEFAULT_BEDROCK_RATE_LIMIT = 20;
export const DEFAULT_BEDROCK_RATE_WINDOW_MS = 60_000;

export type BedrockOverflowActivation = {
  resolvedModelId: string;
  serverId: typeof BEDROCK_OVERFLOW_SERVER_ID;
};

export function getBedrockModelId(): string {
  return process.env.BEDROCK_MODEL_ID?.trim() || DEFAULT_BEDROCK_MODEL_ID;
}

export function getBedrockRegion(): string {
  return process.env.BEDROCK_REGION?.trim() || "us-east-1";
}

export function isClientRequestedBedrockModel(model: string | undefined): boolean {
  return typeof model === "string" && model.toLowerCase().startsWith("bedrock:");
}

export function isBedrockTokenConfigured(): boolean {
  return Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK?.trim());
}

/**
 * Consume one global Bedrock overflow slot when the token is configured and
 * the cost cap still has room. Returns the model substitution, or null so
 * the caller can fall through to the existing hard-error response.
 */
export function tryActivateBedrockOverflow(): BedrockOverflowActivation | null {
  if (!isBedrockTokenConfigured()) return null;

  const limit = parseEnvInt(
    process.env.BEDROCK_RATE_LIMIT,
    DEFAULT_BEDROCK_RATE_LIMIT,
  );
  const windowMs = parseEnvInt(
    process.env.BEDROCK_RATE_WINDOW_MS,
    DEFAULT_BEDROCK_RATE_WINDOW_MS,
  );
  if (isRateLimited(BEDROCK_OVERFLOW_RATE_KEY, limit, windowMs)) {
    return null;
  }

  return {
    resolvedModelId: `bedrock:${getBedrockModelId()}`,
    serverId: BEDROCK_OVERFLOW_SERVER_ID,
  };
}

/** Enable Bedrock on a settings object without accepting client key/URL overrides. */
export function enableBedrockOnSettings(
  settings: UserProviderSettings,
): UserProviderSettings {
  return {
    ...settings,
    bedrock: { isEnabled: true },
  };
}
