/**
 * Shared fixture types for Core's in-process route unit tests.
 *
 * These name the contracts that route-test helpers were previously declaring as
 * bare `object`, which said nothing about what the helper would accept and hid
 * fixtures that were missing fields the route under test actually reads.
 *
 * Integration tests that seed real rows use `helpers/rbac.ts` instead; nothing
 * here touches the database.
 */

import type { JsonObject, JsonValue } from "~/lib/json-value";

/**
 * A JSON request body handed to a route handler.
 *
 * Deliberately open: route tests routinely post deliberately malformed or
 * partial bodies to exercise validation, so the fixture cannot be the route's
 * parsed input type. It is any JSON value rather than an object for the same
 * reason — a test that posts `null` or a bare array is testing something real.
 *
 * What it still rules out is a fixture JSON cannot carry at all (a function, a
 * `Map`, a `Date`), which would serialise to something the route never sees.
 */
export type RouteRequestBody = JsonValue;

/**
 * A course row as returned by the course access gates
 * (`resolveCourseAccessGate` / `resolveCourseAccessWithCourse`).
 *
 * Only `id` is required, because that is the only field every gate consumer
 * reads unconditionally. Tests that exercise publication or department checks
 * pass the extra fields; the rest stay off the fixture so a route that starts
 * reading one fails loudly rather than seeing an accidental default.
 */
export type CourseGateFixture = {
  id: string;
  isPublished?: boolean;
  department?: string | null;
  deletedAt?: Date | null;
};

/**
 * A parsed JSON response body.
 *
 * Route tests assert on these with `toEqual`, so the fixture only has to say
 * "a JSON object" — naming it keeps the assertion from being written against
 * `unknown`, which every caller would then have to narrow for no benefit.
 *
 * Named for the parsed side on purpose: `~/lib/api/json-response.server` owns
 * `JsonResponseBody`, which is what a route may *hand* to `JSON.stringify`
 * (`Date`s included). This is what comes back out of it.
 */
export type ParsedJsonBody = JsonObject;

/** Options accepted by the child-process helpers in `app/tests/globalSetup.ts`. */
export type ExecBinOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "ignore" | "pipe";
  timeout?: number;
};
