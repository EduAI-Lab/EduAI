/**
 * A material's topics (#1965): `PUT` replaces them with the caller's ordered
 * choice, at most `MAX_TOPICS_PER_MATERIAL`, the first being the main topic.
 * Reading them is part of the materials list, so there is no loader here.
 */

import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import type { JsonResponseBody } from "~/lib/api/json-response.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getPolicy } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { setMaterialTopics } from "~/lib/topics/material-topics.server";

function json(status: number, body: JsonResponseBody) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Bounded above the cap on purpose: duplicates collapse before the cap is
 * checked, so the service reports TOO_MANY_TOPICS rather than this schema.
 */
const BodySchema = z.object({
  topics: z
    .array(z.union([z.object({ topicId: z.string().min(1) }), z.object({ name: z.string() })]))
    .max(10),
});

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      const { courseId, materialId } = params;
      if (!courseId || !materialId) return json(400, { error: "MATERIAL_ID_REQUIRED" });
      if (request.method !== "PUT") return json(405, { error: "METHOD_NOT_ALLOWED" });

      const session = await getRequestSession(request);
      if (!session?.user) return json(401, { error: "Unauthorized" });

      const { course, access } = await resolveCourseAccessGate(session.user, courseId);
      if (!course) return json(404, { error: "COURSE_NOT_FOUND" });
      if (!access) return json(403, { error: "Forbidden" });

      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return json(400, { error: "INVALID_BODY" });
      }
      const body = BodySchema.safeParse(raw);
      if (!body.success) return json(400, { error: "INVALID_BODY" });

      const material = await prisma.courseMaterial.findFirst({
        where: { id: materialId, courseId, deletedAt: null },
        select: { title: true, uploadedBy: true },
      });
      if (!material) return json(404, { error: "MATERIAL_NOT_FOUND" });

      // Same rule as renaming a material: instructor/admin, or a TA on a file
      // they uploaded. Creating a topic along the way also needs topic rights.
      const isOwnTaEdit = access.level === "ta" && material.uploadedBy === session.user.id;
      if (access.rank < 2 && !isOwnTaEdit) return json(403, { error: "Forbidden" });
      const canCreateTopics =
        access.rank >= 2 || (access.level === "ta" && (await getPolicy("tas.canManageTopics")));

      const outcome = await setMaterialTopics({
        courseId,
        materialId,
        topics: body.data.topics,
        userId: session.user.id,
        canCreateTopics,
      });
      if (outcome.status !== "200") {
        return json(Number(outcome.status), { error: outcome.error });
      }

      const actor = { ...getActorContext(session.user), ...getRequestContext(request) };
      for (const topic of outcome.createdTopics) {
        fireAndForget(
          logAuditAction({
            ...actor,
            actionCode: "TOPIC_CREATED",
            category: "TOPIC",
            entityType: "CourseTopic",
            entityId: topic.id,
            entityLabel: topic.name,
            details: { courseId, materialId },
          }),
        );
      }
      fireAndForget(
        logAuditAction({
          ...actor,
          actionCode: "MATERIAL_TOPICS_SET",
          category: "MATERIAL",
          entityType: "CourseMaterial",
          entityId: materialId,
          entityLabel: material.title,
          details: { courseId, topicIds: outcome.topics.map((topic) => topic.id) },
        }),
      );

      return json(200, { topics: outcome.topics });
    },
    { request },
  );
}
