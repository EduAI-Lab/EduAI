import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { CreateAIModelSchema, UpdateAIModelSchema } from "~/lib/ai/schemas";
import { apiError, validationErrorFromZod } from "~/lib/api-error.server";

export async function handleAiModelsApiRequest(request: Request) {
  const url = new URL(request.url);

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      const session = apiKeySession ?? (await auth.api.getSession(request));
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

      const models = await prisma.aIModel.findMany({
        include: {
          provider: true,
        },
        orderBy: { name: "asc" },
      });
      return new Response(JSON.stringify(models), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = apiKeySession ?? (await auth.api.getSession(request));
      if (!session?.user || session.user.role !== "ADMIN") {
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

      const session = apiKeySession ?? (await auth.api.getSession(request));
      if (!session?.user || session.user.role !== "ADMIN") {
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

      const session = apiKeySession ?? (await auth.api.getSession(request));
      if (!session?.user || session.user.role !== "ADMIN") {
        return apiError(403, "Forbidden");
      }

      try {
        await prisma.aIModel.delete({
          where: { id: modelId },
        });

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
