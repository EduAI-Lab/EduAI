import prisma from "~/lib/prisma.server";
import type { Prisma } from "@prisma/client";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { CreateAIModelSchema, UpdateAIModelSchema } from "~/lib/ai/schemas";
import { apiError, validationErrorFromZod } from "~/lib/api-error.server";
import { fireAndForget, logAuditAction, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import {
  paginatedResponse,
  parsePaginationParams,
  parseSearchParam,
} from "~/lib/pagination.server";

export async function handleAiModelsApiRequest(request: Request) {
  const url = new URL(request.url);
  const requestContext = getRequestContext(request);

  const logAdminDenied = (actor: { id: string; role?: string | null } | null) =>
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(actor),
        ...requestContext,
        actionCode: "ADMIN_ACCESS_DENIED",
        outcome: "DENIED",
        entityType: "AIModel",
      }),
    );

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user) {
        if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
          const serviceKeyGuard = await requireServiceKey(request);
          if (serviceKeyGuard) return serviceKeyGuard;
        } else {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      } else if (session.user.role !== "ADMIN") {
        logAdminDenied(session.user ?? null);
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      // #1041: pagination is required — no full-list fallback. Search and the
      // provider filter are resolved here too, so the admin table's controls
      // apply across all models rather than the page it happens to hold.
      const paginationResult = parsePaginationParams(url.searchParams);
      if ("response" in paginationResult) return paginationResult.response;
      const { pagination } = paginationResult;

      const search = parseSearchParam(url.searchParams);
      const providerId = url.searchParams.get("providerId")?.trim() || null;

      const where: Prisma.AIModelWhereInput = {};
      if (providerId) where.providerId = providerId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { modelId: { contains: search, mode: "insensitive" } },
        ];
      }

      const [total, models] = await prisma.$transaction([
        prisma.aIModel.count({ where }),
        prisma.aIModel.findMany({
          where,
          include: { provider: true },
          orderBy: { name: "asc" },
          skip: pagination.skip,
          take: pagination.take,
        }),
      ]);
      return paginatedResponse(models, total, pagination);
    }

    case "POST": {
      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      const body = await request.json();
      const result = CreateAIModelSchema.safeParse(body);

      if (!result.success) {
        return validationErrorFromZod(result.error);
      }

      if (result.data.supportsTools && result.data.type !== "CHAT") {
        return new Response(
          JSON.stringify({ error: "Only CHAT models can have supportsTools enabled" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      try {
        const model = await prisma.aIModel.create({
          data: result.data,
          include: {
            provider: true,
          },
        });

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "AI_MODEL_CREATED",
            category: "AI_CONFIG",
            entityType: "AIModel",
            entityId: model.id,
            entityLabel: model.name,
          }),
        );

        return new Response(JSON.stringify(model), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === "P2002") {
          return apiError(409, "MODEL_ID_NOT_UNIQUE");
        }
        if (error.code === "P2003") {
          return apiError(400, "PROVIDER_NOT_FOUND");
        }
        throw error;
      }
    }

    case "PATCH": {
      const idMatch = url.pathname.match(/\/api\/ai-models\/([^/]+)/);
      const modelId = idMatch?.[1];

      if (!modelId) {
        return apiError(400, "MODEL_ID_REQUIRED");
      }

      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      const body = await request.json();
      const result = UpdateAIModelSchema.safeParse(body);

      if (!result.success) {
        return validationErrorFromZod(result.error);
      }

      const existingModel = await prisma.aIModel.findUnique({ where: { id: modelId } });
      if (!existingModel) {
        return new Response("Model not found", { status: 404 });
      }

      const nextType = result.data.type ?? existingModel.type;
      const nextSupportsTools = result.data.supportsTools ?? existingModel.supportsTools;

      if (nextSupportsTools && nextType !== "CHAT") {
        return new Response(
          JSON.stringify({ error: "Only CHAT models can have supportsTools enabled" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      try {
        const model = await prisma.aIModel.update({
          where: { id: modelId },
          data: result.data,
          include: {
            provider: true,
          },
        });

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "AI_MODEL_UPDATED",
            category: "AI_CONFIG",
            entityType: "AIModel",
            entityId: model.id,
            entityLabel: model.name,
          }),
        );

        return new Response(JSON.stringify(model), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === "P2025") {
          return apiError(404, "MODEL_NOT_FOUND");
        }
        if (error.code === "P2002") {
          return apiError(409, "MODEL_ID_NOT_UNIQUE");
        }
        if (error.code === "P2003") {
          return apiError(400, "PROVIDER_NOT_FOUND");
        }
        throw error;
      }
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/ai-models\/([^/]+)/);
      const modelId = idMatch?.[1];

      if (!modelId) {
        return apiError(400, "MODEL_ID_REQUIRED");
      }

      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      try {
        const model = await prisma.aIModel.delete({
          where: { id: modelId },
        });

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "AI_MODEL_DELETED",
            category: "AI_CONFIG",
            entityType: "AIModel",
            entityId: model.id,
            entityLabel: model.name,
          }),
        );

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === "P2025") {
          return apiError(404, "MODEL_NOT_FOUND");
        }
        throw error;
      }
    }

    default:
      return apiError(405, "METHOD_NOT_ALLOWED");
  }
}
