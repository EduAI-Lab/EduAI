import { auth } from "./server";

/**
 * Enforce: if request includes `x-api-key`, only ADMIN users may proceed.
 * Returns a Response (403) when forbidden, otherwise null.
 */
export async function enforceAdminIfApiKey(request: Request): Promise<Response | null> {
  const apiKeyHeader = request.headers.get("x-api-key");
  if (!apiKeyHeader) return null;

  const session = await auth.api.getSession(request);
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response(
      JSON.stringify({ error: "Forbidden: x-api-key access restricted to admin users" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  return null;
}

