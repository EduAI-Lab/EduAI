#!/usr/bin/env node
/** Enroll research user in all courses needed by RAG-grounded dev prompts. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.env.RESEARCH_USER_EMAIL?.trim() || "student1@eduai.local";
const codes = (
  process.env.RESEARCH_ENROLL_COURSES ??
  "STAT 300,COSC 211,PSYO 121,HIST 210,PHIL 220,MATH 320,BIOL 116,COSC 101"
)
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`user not found: ${email}`);

  for (const code of codes) {
    const course = await prisma.course.findFirst({
      where: { code, deletedAt: null },
    });
    if (!course) {
      console.log("skip — course not found:", code);
      continue;
    }
    const existing = await prisma.enrollment.findFirst({
      where: { userId: user.id, courseId: course.id },
    });
    if (existing) {
      console.log("already enrolled", code, existing.id);
      continue;
    }
    const row = await prisma.enrollment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        role: "STUDENT",
        isActive: true,
      },
    });
    console.log("enrolled", code, row.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
