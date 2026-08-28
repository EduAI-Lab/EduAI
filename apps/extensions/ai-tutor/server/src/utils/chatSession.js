/**
 * @file Chat-session identity helpers for the student AI tutoring endpoints.
 *
 * Responsibility: Decide the `chatId` that keys an `AiChatSession` row.
 * Gotchas:
 *   - AI Tutor owns its own session identity. Core's `/api/completion` is
 *     deliberately stateless and returns no chatId, so on a first turn neither
 *     the upstream result nor the client supplies one. We mint a UUID here so
 *     `upsertChatSession` can persist a row and the student's history panel is
 *     non-empty (#1646). Tutor content itself stays out of Core's
 *     `Chat`/`ChatMessage` store by design.
 * Related: routes/activities.js (caller), services/aiGuidance.js (upstream call).
 */

import { randomUUID } from "crypto";

/**
 * Resolve the chatId to persist for this turn.
 *
 * Preference order: a chatId the upstream minted (future-proofing — the
 * stateless completion endpoint returns none today), then the client-supplied
 * chatId of an ongoing session, then a freshly minted UUID for a brand-new
 * session. Never returns null, so every turn produces a persistable session key.
 *
 * @param {string|null|undefined} aiResultChatId chatId returned by the AI call
 * @param {string|null|undefined} requestChatId  chatId the client threaded in
 * @returns {string} a non-empty chatId
 */
export function resolveNextChatId(aiResultChatId, requestChatId) {
  return aiResultChatId || requestChatId || randomUUID();
}
