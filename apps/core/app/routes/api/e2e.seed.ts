/**
 * POST /api/e2e/seed — E2E test helper: run the full demo-data seed (prisma/seed.ts).
 *
 * Only active when the E2E_SEED_SECRET env var is set. Returns 404 otherwise
 * so the endpoint is completely invisible in production environments that omit
 * the variable. Never import or call this from application code.
 *
 * The E2E docker stack only runs `prisma migrate deploy` on boot, not the seed
 * script, so specs that need the deterministic demo accounts/enrollments from
 * prisma/seed.ts (e.g. student1@eduai.local, ta.cs@eduai.local) must trigger
 * this once before signing in. seed.ts's main() is upsert-based, so calling it
 * repeatedly is fine — but several uniquely constrained records still go through
 * delete-then-create, so concurrent callers (two Playwright files' beforeAll)
 * can interleave and fail. Requests are serialized in-process.
 */
import type { ActionFunctionArgs } from "react-router";
import { main as runSeed } from "../../../prisma/seed";

let seedChain: Promise<unknown> = Promise.resolve();

function enqueueSeed<T>(fn: () => Promise<T>): Promise<T> {
  const run = seedChain.then(fn, fn);
  seedChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function action({ request }: ActionFunctionArgs) {
  if (process.env.NODE_ENV !== "test") {
    return new Response(null, { status: 404 });
  }

  const secret = process.env.E2E_SEED_SECRET;
  if (!secret) {
    return new Response(null, { status: 404 });
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body || body.secret !== secret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // seedPasswords -> student-id.server.ts's encrypted student-number storage
  // requires ENCRYPTION_KEY, which the E2E docker stack doesn't set (it's only
  // ever needed by the Canvas student-ID feature, never exercised by an E2E
  // spec before this hook). Fall back to a fixed test key rather than adding
  // it to docker-compose.e2e.yml, which affects every PR's CI run — this
  // route is already unreachable outside NODE_ENV=test + E2E_SEED_SECRET.
  process.env.ENCRYPTION_KEY ??= "e2e-test-encryption-key-not-for-production";

  // Development's seed refuses fixtures unless NODE_ENV=development and
  // EDUAI_LOCAL_SEED_PASSWORD is set. This route is already unreachable
  // outside NODE_ENV=test + E2E_SEED_SECRET, so pass the password explicitly
  // instead of mutating NODE_ENV. Keep the same fallback the week15 specs use.
  const seedPassword = process.env.EDUAI_LOCAL_SEED_PASSWORD?.trim() || "EduAI2026!";

  try {
    await enqueueSeed(() => runSeed({ seedPassword }));
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "SEED_FAILED", message: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
