#!/usr/bin/env node
/** Publish research RAG courses so student enrollments can access chat. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const codes = (
  process.env.RESEARCH_PUBLISH_COURSES ??
  "STAT 300,COSC 211,PSYO 121,HIST 210,PHIL 220,MATH 320,BIOL 116,COSC 101"
)
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

async function main() {
  for (const code of codes) {
    const course = await prisma.course.findFirst({ where: { code, deletedAt: null } });
    if (!course) {
      console.log("skip missing", code);
      continue;
    }
    if (course.isPublished) {
      console.log("already published", code);
      continue;
    }
    await prisma.course.update({
      where: { id: course.id },
      data: { isPublished: true },
    });
    console.log("published", code);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
