/**
 * `POST /api/assistant/settings/models` — fetch a provider's live model list with
 * the USER'S OWN key (10/min — the only settings route that makes an outbound call).
 *
 * Deliberately never falls back to the platform key (#1823): administrator
 * curation bounds what the platform key may be spent on, and a user without a key
 * of their own has no business probing past it. The list is returned for the user
 * to tick; nothing is written to the shared admin catalogue.
 */
import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";

import { listProviderModels } from "~/lib/ai/list-provider-models.server";
import { parseModelIdentifier } from "~/lib/ai/provider-types";
import { jsonResponse, requireSessionUser, throttle } from "~/lib/assistant/route-helpers.server";
import { loadUserAiRows } from "~/lib/assistant/user-ai-keys.server";
import { readBoundedJson } from "~/lib/chat-input.server";
import { withErrorResponse } from "~/lib/errors.server";
import { getPolicy } from "~/lib/policy.server";

const schema = z.object({ provider: z.string().min(1).max(64) }).strict();

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const user = await requireSessionUser(request);
      if (!user) return jsonResponse(401, { error: "Unauthorized" });
      const limited = await throttle("assistant-settings-models", user.id, 10);
      if (limited) return limited;

      const body = await readBoundedJson(request, 4 * 1024, "Request body too large");
      if (!body.ok) return jsonResponse(body.status, { error: body.error });
      const parsed = schema.safeParse(body.body);
      if (!parsed.success) return jsonResponse(422, { error: "VALIDATION_ERROR" });

      // The platform kill switch stops this outbound call too.
      if (!(await getPolicy("ai.platformEnabled"))) {
        return jsonResponse(403, {
          error: "AI calls are paused on this platform.",
          code: "ai_disabled",
        });
      }

      const provider = parseModelIdentifier(`${parsed.data.provider}:x`)?.providerId;
      const own = (await loadUserAiRows(user.id)).find(
        (row) => row.provider === parsed.data.provider,
      );
      if (!provider || !own?.key) {
        return jsonResponse(422, {
          error:
            "Fetching models needs your own API key for this provider. Save a key first — the platform's key is never used to browse models.",
          code: "no_own_key",
        });
      }

      const result = await listProviderModels(provider, own.key);
      if (result.ok) return jsonResponse(200, { provider, models: result.models });
      if (result.reason === "unsupported") {
        return jsonResponse(422, {
          error: "This provider's models can't be listed.",
          code: "unsupported",
        });
      }
      if (result.reason === "rejected") {
        return jsonResponse(502, {
          error: `The provider refused your key (status ${result.status}). Check the key you saved.`,
          code: "provider_error",
          upstream_status: result.status,
        });
      }
      return jsonResponse(502, {
        error: "The provider couldn't be reached.",
        code: "provider_unreachable",
      });
    },
    { request },
  );
}
