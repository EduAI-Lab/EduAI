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
  updateApiAccessGrant,
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

/** At least one field; omitted fields keep their current value (#2095). */
const UpdateGrantSchema = z
  .object({
    expiresAt: z.coerce.date().optional(),
    dailyRequestLimit: z.number().int().min(1).max(MAX_API_ACCESS_DAILY_REQUEST_LIMIT).optional(),
    dailyTokenLimit: z.number().int().min(1).max(MAX_API_ACCESS_DAILY_TOKEN_LIMIT).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.expiresAt !== undefined ||
      input.dailyRequestLimit !== undefined ||
      input.dailyTokenLimit !== undefined,
    { message: "Nothing to change" },
  );

function grantLimits(grant: {
  expiresAt: Date;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
}) {
  return {
    expiresAt: grant.expiresAt.toISOString(),
    dailyRequestLimit: grant.dailyRequestLimit,
    dailyTokenLimit: grant.dailyTokenLimit,
  };
}

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
      maxDailyRequestLimit: MAX_API_ACCESS_DAILY_REQUEST_LIMIT,
      maxDailyTokenLimit: MAX_API_ACCESS_DAILY_TOKEN_LIMIT,
    },
  });
}

/**
 * POST /api/admin/api-access — grant a non-admin API access.
 * PATCH /api/admin/api-access/:id — change an active grant's limits or end date;
 *   the user's keys keep working (#2095).
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

    if (request.method === "PATCH" && params.id) {
      const parsed = UpdateGrantSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
      }
      const { before, after } = await updateApiAccessGrant(params.id, parsed.data);
      fireAndForget(
        logAuditAction({
          ...getActorContext(session.user),
          ...getRequestContext(request),
          actionCode: "API_ACCESS_UPDATED",
          category: "SECURITY",
          entityType: "ApiAccessGrant",
          entityId: after.id,
          entityLabel: after.userId,
          details: { userId: after.userId, before: grantLimits(before), after: grantLimits(after) },
        }),
      );
      return json({ grant: after });
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
