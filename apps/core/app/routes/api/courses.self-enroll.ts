/**
 * /api/courses/:id/self-enroll — staff management of self-enrollment links (#1756).
 *
 *   GET    — list every link minted for the course, with a derived status.
 *   POST   — mint a link. The raw token is in this response and nowhere else.
 *   DELETE — revoke one link (`?linkId=`).
 *
 * Authorization matches the other enrollment-management routes: rank >= 2 plus
 * the `manageEnrollments` policy gate. A TA can see the roster but cannot mint a
 * credential that enrolls strangers.
 *
 * Redemption is NOT here — it lives on `routes/courses.self-enroll.tsx`, the
 * page a student actually opens, so the only surface that consumes a token is
 * the one the student is looking at.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse } from "~/lib/api/json-response.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { authBaseURL } from "~/lib/auth/server";
import {
  createSelfEnrollmentLink,
  listSelfEnrollmentLinks,
  revokeSelfEnrollmentLink,
  selfEnrollmentUrl,
} from "~/lib/courses/self-enrollment.server";
import { withErrorResponse } from "~/lib/errors.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { denyByPolicy, getPolicy } from "~/lib/policy.server";
import { resolvePolicyGate } from "~/lib/rbac/permissions";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

/** §6: managing enrollments — and therefore minting a link — is rank >= 2. */
const MANAGE_ENROLLMENTS_RANK = 2;

/**
 * The origin the share URL is built on.
 *
 * NOT `request.url`: `root.tsx` documents that behind the TLS-terminating
 * Apache proxy `@react-router/express` builds it from `req.protocol`, which
 * stays `http` because Express does not trust `X-Forwarded-Proto`. The token in
 * this URL is a bearer credential, so minting it with a plaintext scheme means
 * every student click is either an extra redirect hop carrying the token or an
 * outright failure. `authBaseURL` (`BETTER_AUTH_URL`) is the configured public
 * origin, and is the same source the sibling invitation flow builds its accept
 * URL from. The request origin stays as a fallback for the case where that env
 * var is unparseable, which is also what keeps dev and unit tests working.
 */
function shareOrigin(request: Request): string {
  try {
    return new URL(authBaseURL).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

/**
 * Both options are optional; the library owns their ranges so an out-of-range
 * value gets one consistent 422 whether it arrives here or from another caller.
 * What this schema rules out is a *wrong-typed* option being dropped silently —
 * `{"ttlDays": "forever"}` must not quietly mint a 30-day link.
 */
const createLinkBodySchema = z.object({
  ttlDays: z.number().optional(),
  maxRedemptions: z.number().optional(),
});

type StaffGate =
  | { ok: true; courseId: string; user: { id: string }; rank: number }
  | { ok: false; response: Response };

/** The shared 401/404/403/policy gate for every method on this route. */
async function requireStaffAccess(request: Request, courseId: string | undefined) {
  if (!courseId) {
    return { ok: false, response: jsonResponse({ error: "COURSE_ID_REQUIRED" }, 400) } as const;
  }

  const session = await getRequestSession(request);
  if (!session?.user) {
    return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) } as const;
  }

  const { course, access } = await resolveCourseAccessGate(session.user, courseId);
  if (!course) {
    return { ok: false, response: jsonResponse({ error: "COURSE_NOT_FOUND" }, 404) } as const;
  }
  if (!access || access.rank < MANAGE_ENROLLMENTS_RANK) {
    return { ok: false, response: jsonResponse({ error: "Forbidden" }, 403) } as const;
  }

  const gate = resolvePolicyGate(access.level, "manageEnrollments");
  if (gate !== "always" && gate !== "never" && !(await getPolicy(gate))) {
    return {
      ok: false,
      response: denyByPolicy({
        request,
        policyKey: gate,
        user: session.user,
        action: "enrollment.self-enroll-link",
        courseId,
      }),
    } as const;
  }

  return { ok: true, courseId, user: session.user, rank: access.rank } as const;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const gate: StaffGate = await requireStaffAccess(request, params.id);
      if (!gate.ok) return gate.response;

      // Views carry no token and no hash — a minted token is unrecoverable by
      // design, so there is nothing here to leak back to a second staff member.
      return jsonResponse({ links: await listSelfEnrollmentLinks(gate.courseId) });
    },
    { request },
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST" && request.method !== "DELETE") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const gate: StaffGate = await requireStaffAccess(request, params.id);
      if (!gate.ok) return gate.response;

      const actorContext = getActorContext(gate.user);
      const requestContext = getRequestContext(request);

      if (request.method === "DELETE") {
        const linkId = new URL(request.url).searchParams.get("linkId")?.trim();
        if (!linkId) {
          return jsonResponse({ error: "LINK_ID_REQUIRED" }, 400);
        }
        const result = await revokeSelfEnrollmentLink(gate.courseId, linkId);
        if (result.status === "404") {
          return jsonResponse({ error: "LINK_NOT_FOUND" }, 404);
        }
        fireAndForget(
          logAuditAction({
            ...actorContext,
            ...requestContext,
            actionCode: "SELF_ENROLLMENT_LINK_REVOKED",
            category: "ENROLLMENT",
            entityType: "SelfEnrollmentLink",
            entityId: linkId,
            details: {
              courseId: gate.courseId,
              alreadyRevoked: result.alreadyRevoked,
            },
          }),
        );
        return new Response(null, { status: 204 });
      }

      const body = createLinkBodySchema.safeParse(await request.json().catch(() => ({})));
      if (!body.success) {
        return jsonResponse(
          {
            error: "VALIDATION_ERROR",
            fields: { body: "ttlDays and maxRedemptions must be numbers when present" },
          },
          422,
        );
      }

      const result = await createSelfEnrollmentLink({
        courseId: gate.courseId,
        createdById: gate.user.id,
        ttlDays: body.data.ttlDays,
        maxRedemptions: body.data.maxRedemptions,
      });
      if (result.status === "422") {
        return jsonResponse({ error: result.error, fields: result.fields }, 422);
      }

      // Audit the fact of minting, never the credential itself: an audit row is
      // readable by every admin, which would make the log a second copy of the
      // link. `link.id` is enough to tie a later revocation to this creation.
      fireAndForget(
        logAuditAction({
          ...actorContext,
          ...requestContext,
          actionCode: "SELF_ENROLLMENT_LINK_CREATED",
          category: "ENROLLMENT",
          entityType: "SelfEnrollmentLink",
          entityId: result.link.id,
          details: {
            courseId: gate.courseId,
            expiresAt: result.link.expiresAt.toISOString(),
            maxRedemptions: result.link.maxRedemptions,
          },
        }),
      );

      return jsonResponse(
        {
          link: result.link,
          token: result.token,
          url: selfEnrollmentUrl(shareOrigin(request), result.token),
        },
        201,
      );
    },
    { request },
  );
}
