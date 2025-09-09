import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { CreateAIProviderSchema, UpdateAIProviderSchema } from "~/lib/ai/schemas";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);

  switch (request.method) {
    case "GET": {
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
      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const body = await request.json();
      const result = CreateAIProviderSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
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
          return new Response(
            JSON.stringify({ error: "Provider name must be unique" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "PATCH": {
      const idMatch = url.pathname.match(/\/api\/ai-providers\/([^/]+)/);
      const providerId = idMatch?.[1];

      if (!providerId) {
        return new Response("Missing provider ID", { status: 400 });
      }

      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const body = await request.json();
      const result = UpdateAIProviderSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
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
          return new Response("Provider not found", { status: 404 });
        }
        if (error.code === 'P2002') {
          return new Response(
            JSON.stringify({ error: "Provider name must be unique" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/ai-providers\/([^/]+)/);
      const providerId = idMatch?.[1];

      if (!providerId) {
        return new Response("Missing provider ID", { status: 400 });
      }

      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      try {
        await prisma.aIProvider.delete({
          where: { id: providerId },
        });

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return new Response("Provider not found", { status: 404 });
        }
        if (error.code === 'P2003') {
          return new Response(
            JSON.stringify({ error: "Cannot delete provider with associated models" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}