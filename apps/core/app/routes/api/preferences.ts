/**
 * /api/preferences — read/write the authenticated user's UI preferences.
 *
 * Backs the shell-wide AssistiveUiProvider (and, later, the Settings
 * Accessibility tab). Reuses the same UserPreference storage the chat route
 * seeds per-chat assist from, so a toggle anywhere stays in sync everywhere.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { saveUserPreference } from "~/lib/user-preferences.server";
import { parsePreferenceUpdates } from "~/lib/user-preferences";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const row = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { assistDefault: true, lastCourseCode: true },
  });

  return json(200, {
    assistDefault: row?.assistDefault ?? false,
    lastCourseCode: row?.lastCourseCode ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const updates = parsePreferenceUpdates(await request.json().catch(() => null));
  if (Object.keys(updates).length === 0) {
    return json(400, { error: "No valid preference fields provided" });
  }

  const saved = await saveUserPreference(session.user.id, updates);
  return json(200, saved);
}
