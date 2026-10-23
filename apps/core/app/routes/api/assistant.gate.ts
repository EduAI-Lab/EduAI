/**
 * `GET /api/assistant/gate[?courseId=…]` — the help assistant's render condition
 * for an app with no Core root loader: AI Tutor and Question Maker (#1958).
 *
 * Same gate as the root loader and the course page loader, so an extension's
 * bubble can never promise an answer `POST /api/assistant/ask` refuses. The
 * course id is a hint re-derived for this reader; one that resolves to nothing
 * (or that the reader can't see) just gets no material scope.
 */
import type { LoaderFunctionArgs } from "react-router";

import {
  gateSnapshot,
  loadAssistantAvailability,
  materialSourceAvailable,
} from "~/lib/assistant/assistant-gate.server";
import { parsePageContextHint, resolvePageContext } from "~/lib/assistant/material-context.server";
import { jsonResponse, requireSessionUser, throttle } from "~/lib/assistant/route-helpers.server";
import { withErrorResponse } from "~/lib/errors.server";

const HIDDEN = { mounted: false, docs: false };

export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const user = await requireSessionUser(request);
      if (!user) return jsonResponse(401, { error: "Unauthorized" });
      const limited = await throttle("assistant-gate", user.id, 60);
      if (limited) return limited;

      const profile = { id: user.id, role: user.role ?? null };
      const courseId = new URL(request.url).searchParams.get("courseId");
      const hint = parsePageContextHint(courseId ? { courseId } : null);

      // A settings read failure hides the assistant rather than failing the shell.
      const availability = await loadAssistantAvailability().catch(() => null);
      if (!availability) return jsonResponse(200, { gate: HIDDEN, user: profile, context: null });

      const resolution = await resolvePageContext(user, hint);
      const context =
        resolution.kind === "resolved"
          ? {
              courseId: resolution.courseId,
              materialId: null,
              label: resolution.courseLabel,
              materialScope: materialSourceAvailable(availability, resolution),
            }
          : null;
      return jsonResponse(200, {
        gate: gateSnapshot(availability, user.role),
        user: profile,
        context,
      });
    },
    { request },
  );
}
