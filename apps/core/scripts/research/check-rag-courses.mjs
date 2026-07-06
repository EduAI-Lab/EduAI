#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.env.RESEARCH_USER_EMAIL?.trim() || "student1@eduai.local";
const codes = (process.env.RESEARCH_CHECK_COURSES ?? "COSC 211,PHIL 220").split(",").map((c) => c.trim());

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`user not found: ${email}`);

  for (const code of codes) {
    const course = await prisma.course.findFirst({
      where: { code, deletedAt: null },
      include: {
        _count: { select: { materials: true, enrollments: true } },
      },
    });
    if (!course) {
      console.log(code, "MISSING");
      continue;
    }
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId: user.id, courseId: course.id, isActive: true },
    });
    const mats = await prisma.material.count({
      where: { courseId: course.id, deletedAt: null },
    });
    console.log(
      JSON.stringify({
        code,
        id: course.id,
        isPublished: course.isPublished,
        materials: mats,
        enrolled: Boolean(enrollment),
        enrollmentRole: enrollment?.role ?? null,
      }),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
