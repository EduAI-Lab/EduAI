/**
 * /api/me (#297, §4) — own-profile read and edit for any authenticated user.
 *
 * PATCH accepts a dedicated whitelist (name, image) — deliberately NOT
 * updateUserSchema, which allows role/isActive and is admin-only territory.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import prisma from "~/lib/prisma.server";
import { updateMeSchema } from "~/lib/auth/schemas";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PROFILE_SELECT = {
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
} as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const apiKeyGate = await enforceAdminIfApiKey(request);
  if (apiKeyGate.response) return apiKeyGate.response;

  const session = apiKeyGate.session ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: PROFILE_SELECT,
  });

  if (!user) {
    return json(404, { error: "USER_NOT_FOUND" });
  }

  return json(200, user);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKeyGate = await enforceAdminIfApiKey(request);
  if (apiKeyGate.response) return apiKeyGate.response;

  const session = apiKeyGate.session ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const body = await request.json();
  const result = updateMeSchema.safeParse(body);

  if (!result.success) {
    return json(400, {
      error: "Invalid input",
      details: result.error.flatten(),
    });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: result.data,
    select: PROFILE_SELECT,
  });

  return json(200, user);
}
