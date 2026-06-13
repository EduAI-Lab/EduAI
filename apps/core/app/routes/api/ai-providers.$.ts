import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { CreateAIProviderSchema, UpdateAIProviderSchema } from "~/lib/ai/schemas";
import { apiError, validationErrorFromZod } from "~/lib/api-error.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);

  // If an API key is provided, only ADMIN users may proceed
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      // §13 (#303): provider config is ADMIN-only — including reads.
      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (session.user.role !== "ADMIN") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const providers = await prisma.aIProvider.findMany({
        include: {
          models: {
            orderBy: { name: 'asc' }
          },
          _count: {
            select: { models: true }
          }
        },
        orderBy: { name: 'asc' }
      });
      return new Response(JSON.stringify(providers), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
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

        return new Response(JSON.stringify(provider), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
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

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
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

        return new Response(JSON.stringify(provider), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return apiError(404, "PROVIDER_NOT_FOUND");
        }
        if (error.code === 'P2002') {
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

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return apiError(403, "Forbidden");
      }

      try {
        await prisma.aIProvider.delete({
          where: { id: providerId },
        });

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return apiError(404, "PROVIDER_NOT_FOUND");
        }
        if (error.code === 'P2003') {
          return apiError(409, "CANNOT_DELETE_PROVIDER_WITH_MODELS");
        }
        throw error;
      }
    }

    default:
      return apiError(405, "METHOD_NOT_ALLOWED");
  }
}
