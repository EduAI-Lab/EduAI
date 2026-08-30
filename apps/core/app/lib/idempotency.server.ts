import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { apiError, jsonResponse } from "~/lib/api-error.server";
import type { JsonObject, JsonValue } from "~/lib/json-value";
import { asJsonObject, asPresentText } from "~/lib/json-value";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const IN_PROGRESS_REPLAY_WAIT_MS = 5_000;
const IN_PROGRESS_REPLAY_POLL_INTERVAL_MS = 50;
const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * requestHash written by the entity-key → IdempotencyRecord backfill migration.
 * Original POST bodies are not recoverable; treat any retry with the same key as
 * a replay of the stored create response (prevents duplicate questions/enrollments).
 */
export const LEGACY_ENTITY_BACKFILL_HASH = "legacy-entity-backfill";

export type IdempotencyClaimResult =
  | { kind: "claimed" }
  | { kind: "replay"; statusCode: number; responseBody: JsonValue }
  | { kind: "mismatch" }
  | { kind: "in_progress" };

/**
 * Stable SHA-256 of a request body for mismatch detection. Object keys are
 * sorted at every depth so two bodies that differ only in key order hash the
 * same and a retry is not mistaken for a different request.
 */
export function hashRequestBody(body: JsonValue | undefined): string {
  const normalized =
    body === undefined
      ? ""
      : JSON.stringify(body, (_key, value: JsonValue) => {
          const fields = asJsonObject(value);
          if (fields) {
            const sorted: JsonObject = {};
            for (const k of Object.keys(fields).sort()) {
              sorted[k] = fields[k];
            }
            return sorted;
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
  body: JsonObject | null | undefined,
): string | undefined {
  const header = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (header) return header;

  return asPresentText(body?.idempotencyKey) ?? undefined;
}

/** Body copy without `idempotencyKey` for request-hash comparison. */
export function bodyForIdempotencyHash(body: JsonObject | null | undefined): JsonObject | null {
  if (!body) return null;
  const { idempotencyKey: _ignored, ...rest } = body;
  return rest;
}

function expiresAtFromNow(ttlMs = DEFAULT_TTL_MS): Date {
  return new Date(Date.now() + ttlMs);
}

function replayResponse(statusCode: number, responseBody: JsonValue): Response {
  return jsonResponse(statusCode, responseBody);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInProgressReplay(opts: {
  key: string;
  route: string;
  actorId: string;
  requestHash: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<IdempotencyClaimResult> {
  const {
    key,
    route,
    actorId,
    requestHash,
    timeoutMs = IN_PROGRESS_REPLAY_WAIT_MS,
    pollIntervalMs = IN_PROGRESS_REPLAY_POLL_INTERVAL_MS,
  } = opts;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { key_route_actorId: { key, route, actorId } },
    });

    if (!existing) {
      return { kind: "in_progress" };
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

    if (existing.status !== "PROCESSING") {
      return { kind: "in_progress" };
    }

    await sleep(pollIntervalMs);
  }

  return { kind: "in_progress" };
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
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
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
  responseBody: JsonValue;
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
  body?: JsonObject | null;
};

/**
 * Same-process coalescing for overlapping identical idempotent requests
 * (#1110): concurrent twins await the first execution and replay its
 * Response instead of racing a second mutation or returning 409 while
 * PROCESSING. Key includes requestHash so a body mismatch cannot join.
 */
const inFlightIdempotentRequests = new Map<string, Promise<Response>>();

function inFlightKey(key: string, route: string, actorId: string, requestHash: string): string {
  return `${key}\0${route}\0${actorId}\0${requestHash}`;
}

async function executeIdempotentRequest(
  opts: WithIdempotencyOptions,
  body: JsonObject | null,
  key: string,
  requestHash: string,
  handler: (body: JsonObject | null) => Promise<Response>,
): Promise<Response> {
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
    // Same-process overlap is handled by the coalesce map above. For
    // cross-process overlap, wait briefly for the writer to complete so the
    // second request can replay instead of failing with 409.
    const waited = await waitForInProgressReplay({
      key,
      route: opts.route,
      actorId: opts.actorId,
      requestHash,
    });

    if (waited.kind === "replay") {
      return replayResponse(waited.statusCode, waited.responseBody);
    }
    if (waited.kind === "mismatch") {
      return apiError(422, "IDEMPOTENCY_KEY_MISMATCH");
    }

    // Still processing after bounded wait; ask client to retry.
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
  const responseBody = await response
    .clone()
    .json()
    .catch(() => null);

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

/**
 * React Router action wrapper: optional idempotency for retry-safe POST creates.
 * When no key is present, runs the handler directly.
 */
export async function withIdempotency(
  opts: WithIdempotencyOptions,
  handler: (body: JsonObject | null) => Promise<Response>,
): Promise<Response> {
  let body: JsonObject | null;
  if (opts.body !== undefined) {
    body = opts.body;
  } else {
    // SAFETY: `Request#json` resolves to whatever the client sent; naming it
    // `JsonValue` claims only what JSON parsing already guarantees. Checked
    // structurally rather than decoded — this runs on every idempotent write,
    // and a recursive union decode would walk and clone the whole body to
    // establish only that its top level is an object.
    const rawBody = (await opts.request
      .clone()
      .json()
      .catch(() => null)) as JsonValue | null;
    body = asJsonObject(rawBody ?? undefined);
  }

  const key = extractIdempotencyKey(opts.request, body);
  if (!key) {
    return handler(body);
  }

  const requestHash = hashRequestBody(bodyForIdempotencyHash(body));
  const mapKey = inFlightKey(key, opts.route, opts.actorId, requestHash);

  // Register before any await so overlapping same-process callers join this
  // promise instead of each claiming / returning IDEMPOTENCY_IN_PROGRESS.
  let shared = inFlightIdempotentRequests.get(mapKey);
  if (!shared) {
    shared = executeIdempotentRequest(opts, body, key, requestHash, handler);
    inFlightIdempotentRequests.set(mapKey, shared);
    // Cleanup only — callers awaiting `shared` still observe rejections.
    void shared
      .finally(() => {
        if (inFlightIdempotentRequests.get(mapKey) === shared) {
          inFlightIdempotentRequests.delete(mapKey);
        }
      })
      .catch(() => undefined);
  }

  const response = await shared;
  // Each waiter needs its own body stream.
  return response.clone();
}
