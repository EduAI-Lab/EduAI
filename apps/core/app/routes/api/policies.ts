import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import {
  getPolicies,
  getPolicyDefinitions,
  isPolicyKey,
  setPolicy,
} from "~/lib/policy.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * GET /api/policies — read all configurable RBAC policy flags.
 *
 * Auth (two callers, nothing else):
 *   - Extensions: Authorization: Bearer <EDUAI_API_KEY> (server-to-server).
 *   - Admin dashboard: an ADMIN user session.
 * Returns `{ policies, definitions }` — values plus label/description metadata
 * so the admin UI can render the toggles from the same response.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Extensions call server-to-server with the service key.
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const guard = await requireServiceKey(request);
    if (guard) return guard;
    return json({ policies: await getPolicies() });
  }

  // Otherwise: ADMIN session only (the admin dashboard).
  const session = await auth.api.getSession(request);
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  if (session.user.role !== "ADMIN") return json({ error: "Forbidden" }, 403);

  return json({
    policies: await getPolicies(),
    definitions: getPolicyDefinitions(),
  });
}

const UpdatePolicySchema = z.object({
  key: z.string(),
  value: z.boolean(),
});

/**
 * PATCH /api/policies — toggle a policy flag. ADMIN only.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  if (session.user.role !== "ADMIN") return json({ error: "Forbidden" }, 403);

  const body = await request.json().catch(() => null);
  const parsed = UpdatePolicySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  if (!isPolicyKey(parsed.data.key)) {
    return json({ error: "Unknown policy key" }, 404);
  }

  await setPolicy(parsed.data.key, parsed.data.value, session.user.id);
  return json({ policies: await getPolicies() });
}
