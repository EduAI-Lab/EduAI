import prisma from "~/lib/prisma.server";

/** Minimal discipline rows used by integration tests (COSC/MATH are the usual units). */
const TEST_DISCIPLINES = [
  { code: "COSC", name: "Computer Science" },
  { code: "MATH", name: "Mathematics" },
] as const;

/**
 * Idempotent — safe to call from every integration test file's setup.
 *
 * `~/lib/disciplines/server` is imported lazily, inside the function, on
 * purpose. This helper runs from `setup.integration.ts`, whose module graph is
 * loaded BEFORE any test file's `vi.mock(...)` registrations; a static import
 * here would pull `~/lib/disciplines/server` — and everything it imports, down
 * to `~/lib/auth/server` — into that pre-mock graph, permanently binding those
 * modules to the unmocked originals for every integration test.
 */
export async function seedTestDisciplines() {
  const { invalidateDisciplineCache } = await import("~/lib/disciplines/server");

  for (const { code, name } of TEST_DISCIPLINES) {
    await prisma.discipline.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
  }
  invalidateDisciplineCache();
}
