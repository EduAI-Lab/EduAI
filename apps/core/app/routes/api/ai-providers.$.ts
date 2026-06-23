import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { CreateAIProviderSchema, UpdateAIProviderSchema } from "~/lib/ai/schemas";
import { fireAndForget, logAuditAction, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);
  const requestContext = getRequestContext(request);

  // Records an admin-only access rejection so security triage can spot probing of the provider API.
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

  switch (request.method) {
    case "GET": {
      // §13 (#303): provider config is ADMIN-only — including reads.
      const session = await auth.api.getSession(request);
      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
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
      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        logAdminDenied(session?.user ?? null);
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

        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
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
        logAdminDenied(session?.user ?? null);
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

        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
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
        logAdminDenied(session?.user ?? null);
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      try {
        const provider = await prisma.aIProvider.delete({
          where: { id: providerId },
        });

        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
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
