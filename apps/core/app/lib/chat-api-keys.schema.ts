import { z } from "zod";
import type { UserProviderSettings } from "~/lib/ai/provider-types";

/** Body `apiKeys` from the client (localStorage-backed provider toggles + keys). */
export const clientApiKeysBodySchema = z.record(
  z.string(),
  z.object({
    isEnabled: z.coerce.boolean().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
  }),
);

export type ClientApiKeysBody = z.infer<typeof clientApiKeysBodySchema>;

/** Coerce parsed body into `UserProviderSettings` with safe defaults. */
export function toUserProviderSettings(parsed: ClientApiKeysBody): UserProviderSettings {
  const out: UserProviderSettings = {};
  for (const [providerId, v] of Object.entries(parsed)) {
    out[providerId] = {
      isEnabled: v.isEnabled ?? false,
      apiKey: v.apiKey,
      baseUrl: v.baseUrl,
    };
  }
  return out;
}
