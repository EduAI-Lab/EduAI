import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
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
      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
          isActive: true,
          emailVerified: true,
          authorizedUnits: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              enrollments: true,
              courseTAs: true,
              taughtCourses: true,
              aiInteractions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' }
      });

      const mapped = users.map(({ _count, ...u }) => ({
        ...u,
        _count: {
          enrolledCourses: _count.enrollments,
          assistedCourses: _count.courseTAs,
          taughtCourses: _count.taughtCourses,
          aiInteractions: _count.aiInteractions,
        },
      }));

      return new Response(JSON.stringify(mapped), {
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
      const result = createUserSchema.safeParse(body);

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
        const { _count, ...created } = await prisma.user.create({
          data: {
            ...result.data,
            emailVerified: false, // New users need to verify their email
          },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            isActive: true,
            emailVerified: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                enrollments: true,
                courseTAs: true,
                taughtCourses: true,
                aiInteractions: true,
              },
            },
          },
        });

        const user = {
          ...created,
          _count: {
            enrolledCourses: _count.enrollments,
            assistedCourses: _count.courseTAs,
            taughtCourses: _count.taughtCourses,
            aiInteractions: _count.aiInteractions,
          },
        };

        return new Response(JSON.stringify(user), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
          return new Response(
            JSON.stringify({ error: "Email already exists" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "PATCH": {
      const idMatch = url.pathname.match(/\/api\/users\/([^/]+)/);
      const userId = idMatch?.[1];

      if (!userId) {
        return new Response("Missing user ID", { status: 400 });
      }

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const body = await request.json();

      // Self-lockout guards (§4): an admin cannot deactivate themselves or
      // change their own role (#297).
      if (userId === session.user.id) {
        if (body.isActive === false) {
          return new Response(
            JSON.stringify({ error: "Cannot deactivate your own account" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        if (body.role !== undefined && body.role !== session.user.role) {
          return new Response(
            JSON.stringify({ error: "Cannot change your own role" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      const result = updateUserSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // #297: authorizedUnits only makes sense on a UNIT_ADMIN — reject
      // writes against any other target role (considering a role change in
      // the same request).
      if (result.data.authorizedUnits !== undefined) {
        const target = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!target) {
          return new Response("User not found", { status: 404 });
        }
        const effectiveRole = result.data.role ?? target.role;
        if (effectiveRole !== "UNIT_ADMIN") {
          return new Response(JSON.stringify({ error: "ROLE_MISMATCH" }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      try {
        const { _count, ...updated } = await prisma.user.update({
          where: { id: userId },
          data: result.data,
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            isActive: true,
            emailVerified: true,
            authorizedUnits: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                enrollments: true,
                courseTAs: true,
                taughtCourses: true,
                aiInteractions: true,
              },
            },
          },
        });

        const user = {
          ...updated,
          _count: {
            enrolledCourses: _count.enrollments,
            assistedCourses: _count.courseTAs,
            taughtCourses: _count.taughtCourses,
            aiInteractions: _count.aiInteractions,
          },
        };

        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return new Response("User not found", { status: 404 });
        }
        if (error.code === 'P2002') {
          return new Response(
            JSON.stringify({ error: "Email already exists" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/users\/([^/]+)/);
      const userId = idMatch?.[1];

      if (!userId) {
        return new Response("Missing user ID", { status: 400 });
      }

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      // Prevent admin from deleting themselves
      if (userId === session.user.id) {
        return new Response(
          JSON.stringify({ error: "Cannot delete your own account" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      try {
        await prisma.user.delete({
          where: { id: userId },
        });

        return new Response(null, { status: 204 });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return new Response("User not found", { status: 404 });
        }
        if (error.code === 'P2003') {
          return new Response(
            JSON.stringify({ error: "Cannot delete user with existing data" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        throw error;
      }
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
