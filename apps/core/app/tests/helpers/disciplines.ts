import prisma from "~/lib/prisma.server";
import { invalidateDisciplineCache } from "~/lib/disciplines/server";

/** Minimal discipline rows used by integration tests (COSC/MATH are the usual units). */
const TEST_DISCIPLINES = [
  { code: "COSC", name: "Computer Science" },
  { code: "MATH", name: "Mathematics" },
] as const;

/** Idempotent — safe to call from every integration test file's setup. */
export async function seedTestDisciplines() {
  for (const { code, name } of TEST_DISCIPLINES) {
    await prisma.discipline.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
  }
  invalidateDisciplineCache();
}
