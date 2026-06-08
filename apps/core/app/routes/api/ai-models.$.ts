import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { allowsSupportsToolsToggle } from "~/lib/ai/model-tool-capability";
import { CreateAIModelSchema, UpdateAIModelSchema } from "~/lib/ai/schemas";
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
      // §13 (#303): model config is ADMIN-only — including reads.
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

      const models = await prisma.aIModel.findMany({
        include: {
          provider: true,
        },
        orderBy: { name: 'asc' }
      });
      return new Response(JSON.stringify(models), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const body = await request.json();
      const result = CreateAIModelSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        result.data.supportsTools &&
        !allowsSupportsToolsToggle(result.data.modelId, result.data.type)
      ) {
        return new Response(
          JSON.stringify({ error: "Small or non-chat models cannot have supportsTools enabled" }),
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
        if (error.code === 'P2002') {
          return new Response(
            JSON.stringify({ error: "Model ID must be unique per provider" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        if (error.code === 'P2003') {
          return new Response(
            JSON.stringify({ error: "Provider not found" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "PATCH": {
      const idMatch = url.pathname.match(/\/api\/ai-models\/([^/]+)/);
      const modelId = idMatch?.[1];

      if (!modelId) {
        return new Response("Missing model ID", { status: 400 });
      }

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const body = await request.json();
      const result = UpdateAIModelSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const existingModel = await prisma.aIModel.findUnique({ where: { id: modelId } });
      if (!existingModel) {
        return new Response("Model not found", { status: 404 });
      }

      const nextModelId = result.data.modelId ?? existingModel.modelId;
      const nextType = result.data.type ?? existingModel.type;
      const nextSupportsTools = result.data.supportsTools ?? existingModel.supportsTools;

      if (nextSupportsTools && !allowsSupportsToolsToggle(nextModelId, nextType)) {
        return new Response(
          JSON.stringify({ error: "Small or non-chat models cannot have supportsTools enabled" }),
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
        if (error.code === 'P2025') {
          return new Response("Model not found", { status: 404 });
        }
        if (error.code === 'P2002') {
          return new Response(
            JSON.stringify({ error: "Model ID must be unique per provider" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        if (error.code === 'P2003') {
          return new Response(
            JSON.stringify({ error: "Provider not found" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/ai-models\/([^/]+)/);
      const modelId = idMatch?.[1];

      if (!modelId) {
        return new Response("Missing model ID", { status: 400 });
      }

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      try {
        await prisma.aIModel.delete({
          where: { id: modelId },
        });

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return new Response("Model not found", { status: 404 });
        }
        throw error;
      }
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
