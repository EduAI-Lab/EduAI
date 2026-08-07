import { withIdempotency } from "~/lib/idempotency.server";

/**
 * Build a valid absolute URL from an idempotency composite route key
 * (e.g. `POST /api/users` → `http://localhost/api/users`).
 * The method prefix is stripped for the URL; callers keep the full string
 * as the `withIdempotency` route key.
 */
export function requestUrlFromIdempotencyRoute(route: string): URL {
  const trimmed = route.trim();
  if (!trimmed) {
    throw new TypeError("idempotency route must not be empty");
  }

  // Strip leading "METHOD " when present; bare paths like `/api/users` are kept.
  const withoutMethod = trimmed.replace(/^[A-Za-z]+\s+/, "").trim();
  // Require a same-origin path. Reject "//host/..." (protocol-relative) and
  // absolute URLs so `new URL(path, base)` cannot retarget the request origin.
  // Also reject backslashes and ASCII tab/CR/LF: the WHATWG URL parser treats
  // "\" as "/" for special schemes and strips tab/CR/LF anywhere in the
  // string, so paths like "/\evil.com/x" or "/\t/evil.com" would otherwise
  // resolve to "//evil.com/..." and retarget the origin.
  if (
    !withoutMethod.startsWith("/") ||
    withoutMethod.startsWith("//") ||
    /[\\\t\r\n]/.test(withoutMethod)
  ) {
    throw new TypeError(
      `idempotency route must include a path starting with /: ${JSON.stringify(route)}`,
    );
  }

  return new URL(withoutMethod, "http://localhost");
}

function methodFromIdempotencyRoute(route: string): string {
  const match = /^([A-Za-z]+)\s+\//.exec(route.trim());
  return match?.[1]?.toUpperCase() ?? "POST";
}

/**
 * Synthetic Request wrapper for admin chat tool mutations that share the
 * centralized idempotency layer with REST POST creates.
 */
export async function runIdempotentAdminMutation<T>(
  actorId: string,
  route: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
  mutation: () => Promise<T>,
): Promise<T> {
  const request = new Request(requestUrlFromIdempotencyRoute(route), {
    method: methodFromIdempotencyRoute(route),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const response = await withIdempotency(
    { request, route, actorId, body },
    async () =>
      new Response(JSON.stringify(await mutation()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  return (await response.json()) as T;
}
