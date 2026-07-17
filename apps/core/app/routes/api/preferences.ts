/**
 * /api/preferences — read/write the authenticated user's UI preferences.
 *
 * Backs AssistiveUiProvider, UiPreferencesProvider, and the Settings
 * Accessibility tab. Reuses UserPreference storage so toggles stay in sync.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { saveUserPreference } from "~/lib/user-preferences.server";
import { DEFAULT_ACCOUNT_PREFERENCES, parsePreferenceUpdates } from "~/lib/user-preferences";
import { isUiDensity, isUiTheme } from "~/lib/ui-preferences";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rowToResponse(row: {
  assistDefault: boolean;
  lastCourseCode: string | null;
  motionReduced: boolean;
  density: string;
  theme: string;
}) {
  return {
    assistDefault: row.assistDefault,
    lastCourseCode: row.lastCourseCode,
    motionReduced: row.motionReduced,
    density: isUiDensity(row.density) ? row.density : DEFAULT_ACCOUNT_PREFERENCES.density,
    theme: isUiTheme(row.theme) ? row.theme : DEFAULT_ACCOUNT_PREFERENCES.theme,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const row = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: {
      assistDefault: true,
      lastCourseCode: true,
      motionReduced: true,
      density: true,
      theme: true,
    },
  });

  if (!row) {
    return json(200, DEFAULT_ACCOUNT_PREFERENCES);
  }

  return json(200, rowToResponse(row));
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const session = await auth.api.getSession({ headers: request.headers });
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
