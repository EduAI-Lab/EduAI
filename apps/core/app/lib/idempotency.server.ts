import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { apiError, jsonResponse } from "~/lib/api-error.server";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * requestHash written by the entity-key → IdempotencyRecord backfill migration.
 * Original POST bodies are not recoverable; treat any retry with the same key as
 * a replay of the stored create response (prevents duplicate questions/enrollments).
 */
export const LEGACY_ENTITY_BACKFILL_HASH = "legacy-entity-backfill";

export type IdempotencyClaimResult =
  | { kind: "claimed" }
  | { kind: "replay"; statusCode: number; responseBody: unknown }
  | { kind: "mismatch" }
  | { kind: "in_progress" };

/** Stable SHA-256 of a JSON-serializable request body for mismatch detection. */
export function hashRequestBody(body: unknown): string {
  const normalized =
    body === undefined
      ? ""
      : JSON.stringify(body, (_key, value) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            return Object.keys(value)
              .sort()
              .reduce<Record<string, unknown>>((acc, k) => {
                acc[k] = (value as Record<string, unknown>)[k];
                return acc;
              }, {});
          }
          return value;
        });
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Resolve idempotency key from `Idempotency-Key` header (preferred) or body `idempotencyKey`.
 * Body field is stripped before hashing so the key itself is not part of the payload hash.
 */
export function extractIdempotencyKey(
  request: Request,
  body: Record<string, unknown> | null | undefined,
): string | undefined {
  const header = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (header) return header;

  const fromBody = body?.idempotencyKey;
  if (typeof fromBody === "string" && fromBody.trim().length > 0) {
    return fromBody.trim();
  }
  return undefined;
}

/** Body copy without `idempotencyKey` for request-hash comparison. */
export function bodyForIdempotencyHash(
  body: Record<string, unknown> | null | undefined,
): unknown {
  if (!body || typeof body !== "object") return body ?? null;
  const { idempotencyKey: _ignored, ...rest } = body;
  return rest;
}

function expiresAtFromNow(ttlMs = DEFAULT_TTL_MS): Date {
  return new Date(Date.now() + ttlMs);
}

function replayResponse(statusCode: number, responseBody: unknown): Response {
  return jsonResponse(statusCode, responseBody);
}

export async function claimIdempotency(opts: {
  key: string;
  route: string;
  actorId: string;
  requestHash: string;
  ttlMs?: number;
}): Promise<IdempotencyClaimResult> {
  const { key, route, actorId, requestHash, ttlMs = DEFAULT_TTL_MS } = opts;
  const expiresAt = expiresAtFromNow(ttlMs);

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key,
        route,
        actorId,
        requestHash,
        status: "PROCESSING",
        expiresAt,
      },
    });
    return { kind: "claimed" };
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      throw error;
    }
  }

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { key_route_actorId: { key, route, actorId } },
  });
  if (!existing) {
    return claimIdempotency(opts);
  }

  const now = new Date();
  if (existing.expiresAt < now) {
    // Conditional delete avoids racing a newer replacement row (P2025 / wrong-row delete).
    await prisma.idempotencyRecord.deleteMany({
      where: {
        key,
        route,
        actorId,
        status: existing.status,
        requestHash: existing.requestHash,
        expiresAt: { lte: now },
      },
    });
    return claimIdempotency(opts);
  }

  const isLegacyEntityBackfill = existing.requestHash === LEGACY_ENTITY_BACKFILL_HASH;
  if (!isLegacyEntityBackfill && existing.requestHash !== requestHash) {
    return { kind: "mismatch" };
  }

  if (existing.status === "COMPLETED" && existing.statusCode != null) {
    return {
      kind: "replay",
      statusCode: existing.statusCode,
      responseBody: existing.responseBody ?? null,
    };
  }

  if (existing.status === "PROCESSING") {
    return { kind: "in_progress" };
  }

  if (existing.status === "FAILED") {
    const reclaimed = await prisma.idempotencyRecord.updateMany({
      where: { key, route, actorId, status: "FAILED", requestHash },
      data: { status: "PROCESSING", expiresAt },
    });
    if (reclaimed.count === 1) {
      return { kind: "claimed" };
    }
    return claimIdempotency(opts);
  }

  return { kind: "in_progress" };
}

export async function completeIdempotency(opts: {
  key: string;
  route: string;
  actorId: string;
  statusCode: number;
  responseBody: unknown;
}): Promise<void> {
  await prisma.idempotencyRecord.update({
    where: {
      key_route_actorId: {
        key: opts.key,
        route: opts.route,
        actorId: opts.actorId,
      },
    },
    data: {
      status: "COMPLETED",
      statusCode: opts.statusCode,
      responseBody: opts.responseBody as Prisma.InputJsonValue,
    },
  });
}

/** Drop the in-flight record so the client may retry with the same key. */
export async function releaseIdempotency(opts: {
  key: string;
  route: string;
  actorId: string;
}): Promise<void> {
  await prisma.idempotencyRecord.deleteMany({
    where: {
      key: opts.key,
      route: opts.route,
      actorId: opts.actorId,
      status: "PROCESSING",
    },
  });
}

export async function failIdempotency(opts: {
  key: string;
  route: string;
  actorId: string;
}): Promise<void> {
  await prisma.idempotencyRecord.updateMany({
    where: {
      key: opts.key,
      route: opts.route,
      actorId: opts.actorId,
      status: "PROCESSING",
    },
    data: { status: "FAILED" },
  });
}

export type WithIdempotencyOptions = {
  request: Request;
  /** Stable route identifier, e.g. `POST /api/users` */
  route: string;
  /** Authenticated actor whose keys and cached responses are isolated. */
  actorId: string;
  ttlMs?: number;
  /**
   * Pre-parsed JSON body from the route (e.g. after an RBAC peek).
   * When set, skips cloning/parsing the request again.
   */
  body?: Record<string, unknown> | null;
};

/**
 * React Router action wrapper: optional idempotency for retry-safe POST creates.
 * When no key is present, runs the handler directly.
 */
export async function withIdempotency(
  opts: WithIdempotencyOptions,
  handler: (body: Record<string, unknown> | null) => Promise<Response>,
): Promise<Response> {
  let body: Record<string, unknown> | null;
  if (opts.body !== undefined) {
    body = opts.body;
  } else {
    const rawBody = await opts.request
      .clone()
      .json()
      .catch(() => null);
    body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : null;
  }

  const key = extractIdempotencyKey(opts.request, body);
  if (!key) {
    return handler(body);
  }

  const requestHash = hashRequestBody(bodyForIdempotencyHash(body));
  const claim = await claimIdempotency({
    key,
    route: opts.route,
    actorId: opts.actorId,
    requestHash,
    ttlMs: opts.ttlMs,
  });

  if (claim.kind === "mismatch") {
    return apiError(422, "IDEMPOTENCY_KEY_MISMATCH");
  }
  if (claim.kind === "in_progress") {
    return apiError(409, "IDEMPOTENCY_IN_PROGRESS");
  }
  if (claim.kind === "replay") {
    return replayResponse(claim.statusCode, claim.responseBody);
  }

  let response: Response;
  try {
    response = await handler(body);
  } catch (error) {
    await failIdempotency({ key, route: opts.route, actorId: opts.actorId });
    throw error;
  }

  const statusCode = response.status;
  const responseBody = await response.clone().json().catch(() => null);

  if (statusCode >= 200 && statusCode < 300) {
    // Do not release or mark FAILED if persistence fails after the mutation
    // succeeded. Leaving PROCESSING makes retries fail closed instead of
    // executing the create again and producing a duplicate row.
    await completeIdempotency({
      key,
      route: opts.route,
      actorId: opts.actorId,
      statusCode,
      responseBody,
    });
  } else {
    await releaseIdempotency({
      key,
      route: opts.route,
      actorId: opts.actorId,
    });
  }

  return response;
}
