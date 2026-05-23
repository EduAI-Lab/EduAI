import { createHash, timingSafeEqual } from "node:crypto";
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

/**
 * Enforce: request must carry `Authorization: Bearer <EDUAI_API_KEY>` for
 * server-to-server calls from AI Tutor and Question Maker.
 *
 * Returns `null` if the service key is present and valid (caller may proceed).
 * Returns 401 { "error": "MISSING_SERVICE_KEY" } if the header is absent.
 * Returns 403 { "error": "INVALID_SERVICE_KEY" } if the token does not match.
 */
export async function requireServiceKey(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "MISSING_SERVICE_KEY" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = authHeader.slice(7);
  const envKey = process.env.EDUAI_API_KEY;

  if (!envKey) {
    return new Response(
      JSON.stringify({ error: "INVALID_SERVICE_KEY" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const tokenHash = createHash("sha256").update(token).digest();
  const keyHash   = createHash("sha256").update(envKey).digest();

  if (!timingSafeEqual(tokenHash, keyHash)) {
    return new Response(
      JSON.stringify({ error: "INVALID_SERVICE_KEY" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return null;
}
