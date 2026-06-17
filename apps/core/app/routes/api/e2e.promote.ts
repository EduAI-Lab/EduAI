/**
 * POST /api/e2e/promote — E2E test helper: promote a user to a given role.
 *
 * Only active when the E2E_SEED_SECRET env var is set. Returns 404 otherwise
 * so the endpoint is completely invisible in production environments that omit
 * the variable. Never import or call this from application code.
 */
import type { ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";

const VALID_ROLES = new Set(['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'TA', 'STUDENT']);

export async function action({ request }: ActionFunctionArgs) {
  if (process.env.NODE_ENV !== 'test') {
    return new Response(null, { status: 404 });
  }

  const secret = process.env.E2E_SEED_SECRET;
  if (!secret) {
    return new Response(null, { status: 404 });
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body || body.secret !== secret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { email, role } = body ?? {};
  if (typeof email !== "string" || typeof role !== "string") {
    return new Response(JSON.stringify({ error: "email and role required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!VALID_ROLES.has(role)) {
    return new Response(JSON.stringify({ error: `Invalid role. Must be one of: ${[...VALID_ROLES].join(', ')}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return new Response(JSON.stringify({ error: "USER_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await prisma.user.update({
    where: { email },
    data: { role },
    select: { id: true, email: true, role: true, name: true },
  });

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
