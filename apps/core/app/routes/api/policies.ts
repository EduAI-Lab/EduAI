import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { auth } from "~/lib/auth/server";
import { requireAdmin, requireServiceKey } from "~/lib/auth/guards.server";
import { jsonResponse as json } from "~/lib/api/json-response.server";
import {
  getPolicies,
  getPolicyDefinitions,
  isPolicyKey,
  setPolicy,
} from "~/lib/policy.server";

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
  // Resolve a user session first. Any authenticated user may read policy VALUES
  // so the client can mirror backend enforcement (hide controls that would
  // otherwise 403). A real user request must NOT be diverted to the service-key
  // path just because a proxy/SDK attached a stray `Authorization: Bearer`
  // header — that header is only authoritative when there is no user session.
  const session = await auth.api.getSession(request);
  if (session?.user) {
    if (session.user.role !== "ADMIN") {
      return json({ policies: await getPolicies() });
    }
    // Only ADMIN additionally receives the toggle DEFINITIONS used to render the
    // admin settings UI; PATCH stays ADMIN-only.
    return json({
      policies: await getPolicies(),
      definitions: getPolicyDefinitions(),
    });
  }

  // No user session — this is a server-to-server extension call authenticated
  // with the shared service key.
  const guard = await requireServiceKey(request);
  if (guard) return guard;
  return json({ policies: await getPolicies() });
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

  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

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
