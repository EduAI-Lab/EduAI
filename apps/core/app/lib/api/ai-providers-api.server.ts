import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { CreateAIProviderSchema, UpdateAIProviderSchema } from "~/lib/ai/schemas";
import { apiError, validationErrorFromZod } from "~/lib/api-error.server";
import { fireAndForget, logAuditAction, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { invalidateTierModelCache } from "~/lib/ai/routing/tiers";

export async function handleAiProvidersApiRequest(request: Request) {
  const url = new URL(request.url);
  const requestContext = getRequestContext(request);

  const logAdminDenied = (actor: { id: string; role?: string | null } | null) =>
    fireAndForget(
      logSecurityEvent({
        ...getActorContext(actor),
        ...requestContext,
        actionCode: "ADMIN_ACCESS_DENIED",
        outcome: "DENIED",
        entityType: "AIProvider",
      }),
    );

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (session.user.role !== "ADMIN") {
        logAdminDenied(session.user ?? null);
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const providers = await prisma.aIProvider.findMany({
        include: {
          models: {
            orderBy: { name: "asc" },
          },
          _count: {
            select: { models: true },
          },
        },
        orderBy: { name: "asc" },
      });
      return new Response(JSON.stringify(providers), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      const body = await request.json();
      const result = CreateAIProviderSchema.safeParse(body);

      if (!result.success) {
        return validationErrorFromZod(result.error);
      }

      try {
        const provider = await prisma.aIProvider.create({
          data: result.data,
        });
        invalidateTierModelCache();

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "AI_PROVIDER_CREATED",
            category: "AI_CONFIG",
            entityType: "AIProvider",
            entityId: provider.id,
            entityLabel: provider.name,
          }),
        );

        return new Response(JSON.stringify(provider), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === "P2002") {
          return apiError(409, "PROVIDER_NAME_NOT_UNIQUE");
        }
        throw error;
      }
    }

    case "PATCH": {
      const idMatch = url.pathname.match(/\/api\/ai-providers\/([^/]+)/);
      const providerId = idMatch?.[1];

      if (!providerId) {
        return apiError(400, "PROVIDER_ID_REQUIRED");
      }

      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      const body = await request.json();
      const result = UpdateAIProviderSchema.safeParse(body);

      if (!result.success) {
        return validationErrorFromZod(result.error);
      }

      try {
        const provider = await prisma.aIProvider.update({
          where: { id: providerId },
          data: result.data,
        });
        invalidateTierModelCache();

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "AI_PROVIDER_UPDATED",
            category: "AI_CONFIG",
            entityType: "AIProvider",
            entityId: provider.id,
            entityLabel: provider.name,
          }),
        );

        return new Response(JSON.stringify(provider), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === "P2025") {
          return apiError(404, "PROVIDER_NOT_FOUND");
        }
        if (error.code === "P2002") {
          return apiError(409, "PROVIDER_NAME_NOT_UNIQUE");
        }
        throw error;
      }
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/ai-providers\/([^/]+)/);
      const providerId = idMatch?.[1];

      if (!providerId) {
        return apiError(400, "PROVIDER_ID_REQUIRED");
      }

      const session = apiKeySession ?? (await auth.api.getSession({ headers: request.headers }));
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
        return apiError(403, "Forbidden");
      }

      try {
        const provider = await prisma.aIProvider.delete({
          where: { id: providerId },
        });
        invalidateTierModelCache();

        fireAndForget(
          logAuditAction({
            ...getActorContext(session.user),
            ...requestContext,
            actionCode: "AI_PROVIDER_DELETED",
            category: "AI_CONFIG",
            entityType: "AIProvider",
            entityId: provider.id,
            entityLabel: provider.name,
          }),
        );

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === "P2025") {
          return apiError(404, "PROVIDER_NOT_FOUND");
        }
        if (error.code === "P2003") {
          return apiError(409, "CANNOT_DELETE_PROVIDER_WITH_MODELS");
        }
        throw error;
      }
    }

    default:
      return apiError(405, "METHOD_NOT_ALLOWED");
  }
}
