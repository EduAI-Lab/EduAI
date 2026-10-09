/**
 * @file Small shared pieces of the assistant's resource routes: JSON responses,
 * the session check, and per-route throttles.
 */
import type { JsonResponseBody } from "~/lib/api/json-response.server";
import { checkRateLimit } from "~/lib/auth/rate-limit.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

export function jsonResponse(
  status: number,
  body: JsonResponseBody,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export async function requireSessionUser(request: Request) {
  const session = await getRequestSession(request);
  return session?.user ?? null;
}

/** A 429 Response when `bucket` is over `limit` per minute for this user, else null. */
export async function throttle(
  bucket: string,
  userId: string,
  limit: number,
): Promise<Response | null> {
  const rate = await checkRateLimit(`${bucket}:${userId}`, limit, 60_000);
  if (!rate.limited) return null;
  return jsonResponse(
    429,
    {
      error: "Too many requests. Please wait a moment.",
      code: "rate_limited",
      retryAfter: rate.retryAfter,
    },
    { "Retry-After": String(rate.retryAfter) },
  );
}
