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
 * this once before signing in. seed.ts's main() is upsert-based end to end, so
 * calling it repeatedly (or concurrently, across workers) is safe.
 */
import type { ActionFunctionArgs } from "react-router";
import { main as runSeed } from "../../../prisma/seed";

export async function action({ request }: ActionFunctionArgs) {
  if (process.env.NODE_ENV !== 'test') {
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

  try {
    await runSeed();
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
