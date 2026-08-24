/**
 * Seed one password-backed student per k6 VU so a 500-VU run measures 500
 * distinct sessions, not 5 demo accounts sharing a per-user chat limiter.
 *
 * Emails: loadtest.vu-001@eduai.local … loadtest.vu-NNN@eduai.local
 * Password: EDUAI_LOCAL_SEED_PASSWORD (same contract as prisma/seed.ts)
 * Student IDs: 20000001… so login skips /onboarding/student-id
 * Enrollment: STUDENT on DATA 310
 *
 *   LOADTEST_VUS=500 npx tsx loadtest/scripts/seed-loadtest-users.ts
 */
import { hashPassword } from "better-auth/crypto";
import prisma from "../../app/lib/prisma.server";
import { getLocalSeedPassword } from "../../app/lib/deployment-safety.server";
import { prepareStudentIdStorage } from "../../app/lib/canvas/student-id.server";
import { emailForVu, studentNumberForVu } from "./loadtest-fixtures";

const COURSE_CODE = "DATA 310";
const COUNT = Math.max(1, Number(process.env.LOADTEST_VUS || 500));

async function main() {
  const seedPassword = getLocalSeedPassword();
  const course = await prisma.course.findFirst({
    where: { code: COURSE_CODE },
    select: { id: true, code: true },
  });
  if (!course) {
    throw new Error(`Course ${COURSE_CODE} not found — run prisma/seed.ts first.`);
  }

  const hashed = await hashPassword(seedPassword);
  console.log(`▶ seeding ${COUNT} loadtest VUs into ${course.code}`);

  for (let n = 1; n <= COUNT; n++) {
    const email = emailForVu(n);
    const studentNumber = studentNumberForVu(n);
    const studentIdFields = prepareStudentIdStorage(studentNumber);
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        isActive: true,
        emailVerified: true,
        ...studentIdFields,
      },
      create: {
        email,
        name: `Loadtest VU ${n}`,
        role: "STUDENT",
        isActive: true,
        emailVerified: true,
        ...studentIdFields,
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

  console.log(`✓ ${COUNT} loadtest users ready (password from EDUAI_LOCAL_SEED_PASSWORD)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
