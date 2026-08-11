import { z } from 'zod';

/**
 * Payload accepted by the account-level provider key probe.
 * Provider support is checked after parsing so unsupported providers can keep
 * the endpoint's `{ valid: false }` response contract without probing upstream.
 */
export const AiProviderKeySchema = z.object({
  provider: z.string().min(1).max(32),
  apiKey: z.string().min(1).max(512),
});

export default AiProviderKeySchema;
