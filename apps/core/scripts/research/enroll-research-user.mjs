#!/usr/bin/env node
/**
 * Ensure research login user is enrolled in a published course (s378 dev).
 *
 *   RESEARCH_USER_EMAIL=a@mail.com RESEARCH_DEFAULT_COURSE_CODE="COSC 101" \\
 *     node scripts/research/enroll-research-user.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.env.RESEARCH_USER_EMAIL?.trim() || "a@mail.com";
const courseCode = process.env.RESEARCH_DEFAULT_COURSE_CODE?.trim() || "COSC 101";

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`user not found: ${email}`);

  const course = await prisma.course.findFirst({
    where: { code: courseCode, deletedAt: null },
  });
  if (!course) throw new Error(`course not found: ${courseCode}`);

  const existing = await prisma.enrollment.findFirst({
    where: { userId: user.id, courseId: course.id },
  });
  if (existing) {
    console.log("enrollment already exists", existing.id);
    return;
  }

  const row = await prisma.enrollment.create({
    data: {
      userId: user.id,
      courseId: course.id,
      role: "STUDENT",
      isActive: true,
    },
  });
  console.log("created enrollment", row.id, "for", email, "in", courseCode);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
