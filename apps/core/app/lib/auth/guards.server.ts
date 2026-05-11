import type { Session } from "./server";
import { auth } from "./server";

type GuardResult = {
  response: Response | null;
  session: Session | null;
};

/**
 * Enforce: if request includes `x-api-key`, only ADMIN users may proceed.
 * Returns `{ response, session }` so callers can reuse the fetched session.
 */
export async function enforceAdminIfApiKey(request: Request): Promise<GuardResult> {
  const apiKeyHeader = request.headers.get("x-api-key");
  if (!apiKeyHeader) {
    return { response: null, session: null };
  }

  const session = await auth.api.getSession(request);
  if (!session?.user || session.user.role !== "ADMIN") {
    return {
      response: new Response(
        JSON.stringify({ error: "Forbidden: x-api-key access restricted to admin users" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      ),
      session,
    };
  }

  return { response: null, session };
}
