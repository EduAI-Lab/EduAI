/**
 * Seed one password-backed student per k6 VU so a 500-VU run measures 500
 * distinct sessions, not 5 demo accounts sharing a per-user chat limiter.
 *
 * Emails: loadtest.vu-001@eduai.local … loadtest.vu-NNN@eduai.local
 * Password: EduAI2026! (same as prisma/seed.ts demo accounts)
 * Enrollment: STUDENT on DATA 310
 *
 *   LOADTEST_VUS=500 npx tsx loadtest/scripts/seed-loadtest-users.ts
 */
import { hashPassword } from "better-auth/crypto";
import prisma from "../../app/lib/prisma.server";

const SEED_PASSWORD = "EduAI2026!";
const COURSE_CODE = "DATA 310";
const COUNT = Math.max(1, Number(process.env.LOADTEST_VUS || 500));

function emailForVu(n: number) {
  return `loadtest.vu-${String(n).padStart(3, "0")}@eduai.local`;
}

async function main() {
  const course = await prisma.course.findFirst({
    where: { code: COURSE_CODE },
    select: { id: true, code: true },
  });
  if (!course) {
    throw new Error(
      `Course ${COURSE_CODE} not found — run prisma/seed.ts first.`,
    );
  }

  const hashed = await hashPassword(SEED_PASSWORD);
  console.log(`▶ seeding ${COUNT} loadtest VUs into ${course.code}`);

  for (let n = 1; n <= COUNT; n++) {
    const email = emailForVu(n);
    const user = await prisma.user.upsert({
      where: { email },
      update: { isActive: true, emailVerified: true },
      create: {
        email,
        name: `Loadtest VU ${n}`,
        role: "STUDENT",
        isActive: true,
        emailVerified: true,
      },
    });
    await prisma.account.upsert({
      where: {
        providerId_accountId: { providerId: "credential", accountId: email },
      },
      update: { password: hashed },
      create: {
        providerId: "credential",
        accountId: email,
        userId: user.id,
        password: hashed,
      },
    });
    await prisma.enrollment.upsert({
      where: { courseId_userId: { courseId: course.id, userId: user.id } },
      update: { role: "STUDENT", isActive: true },
      create: {
        courseId: course.id,
        userId: user.id,
        role: "STUDENT",
        isActive: true,
        externalSource: "loadtest",
      },
    });
    if (n % 50 === 0) console.log(`  … ${n}/${COUNT}`);
  }

  console.log(`✓ ${COUNT} loadtest users ready (password ${SEED_PASSWORD})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
