import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import {
  ApiAccessGrantError,
  createApiAccessGrant,
  DEFAULT_API_ACCESS_DAILY_REQUEST_LIMIT,
  DEFAULT_API_ACCESS_DAILY_TOKEN_LIMIT,
  listApiAccessGrants,
  MAX_API_ACCESS_DAILY_REQUEST_LIMIT,
  MAX_API_ACCESS_DAILY_TOKEN_LIMIT,
  revokeApiAccessGrant,
} from "~/lib/api-keys/access-grants.server";
import { jsonResponse as json } from "~/lib/api/json-response.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

const CreateGrantSchema = z.object({
  userId: z.string().trim().min(1),
  purpose: z.string().trim().min(1).max(500),
  expiresAt: z.coerce.date(),
  dailyRequestLimit: z
    .number()
    .int()
    .min(1)
    .max(MAX_API_ACCESS_DAILY_REQUEST_LIMIT)
    .default(DEFAULT_API_ACCESS_DAILY_REQUEST_LIMIT),
  dailyTokenLimit: z
    .number()
    .int()
    .min(1)
    .max(MAX_API_ACCESS_DAILY_TOKEN_LIMIT)
    .default(DEFAULT_API_ACCESS_DAILY_TOKEN_LIMIT),
});

/**
 * GET /api/admin/api-access — API access grants (#2039), active ones by default
 * (`?all=1` adds revoked and expired), each with its last-24h usage.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  const includeInactive = new URL(request.url).searchParams.get("all") === "1";
  const grants = await listApiAccessGrants({ includeInactive });
  return json({
    grants,
    defaults: {
      dailyRequestLimit: DEFAULT_API_ACCESS_DAILY_REQUEST_LIMIT,
      dailyTokenLimit: DEFAULT_API_ACCESS_DAILY_TOKEN_LIMIT,
    },
  });
}

/**
 * POST /api/admin/api-access — grant a non-admin API access.
 * DELETE /api/admin/api-access/:id — revoke a grant; the user's keys are disabled.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  try {
    if (request.method === "POST" && !params.id) {
      const parsed = CreateGrantSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
      }
      const grant = await createApiAccessGrant({ ...parsed.data, grantedById: session.user.id });
      fireAndForget(
        logAuditAction({
          ...getActorContext(session.user),
          ...getRequestContext(request),
          actionCode: "API_ACCESS_GRANTED",
          category: "SECURITY",
          entityType: "ApiAccessGrant",
          entityId: grant.id,
          entityLabel: grant.userId,
          details: {
            userId: grant.userId,
            purpose: grant.purpose,
            expiresAt: grant.expiresAt.toISOString(),
            dailyRequestLimit: grant.dailyRequestLimit,
            dailyTokenLimit: grant.dailyTokenLimit,
          },
        }),
      );
      return json({ grant }, 201);
    }

    if (request.method === "DELETE" && params.id) {
      const grant = await revokeApiAccessGrant(params.id, session.user.id);
      fireAndForget(
        logAuditAction({
          ...getActorContext(session.user),
          ...getRequestContext(request),
          actionCode: "API_ACCESS_REVOKED",
          category: "SECURITY",
          entityType: "ApiAccessGrant",
          entityId: grant.id,
          entityLabel: grant.userId,
          details: { userId: grant.userId },
        }),
      );
      return json({ grant });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof ApiAccessGrantError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }
}
