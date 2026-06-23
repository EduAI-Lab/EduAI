/**
 * Enroll a user in the CHUNK433 demo course by email substring.
 * Usage: npx tsx scripts/dev-enroll-user.ts ssaada
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../app/lib/prisma.server";

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvFile();
  const needle = process.argv[2] ?? "ssaada";
  const course = await prisma.course.findFirst({ where: { code: "CHUNK433" } });
  if (!course) throw new Error("CHUNK433 course not found — run dev-smart-chunking-demo.ts first");

  const user = await prisma.user.findFirst({
    where: { email: { contains: needle, mode: "insensitive" } },
  });
  if (!user) {
    const all = await prisma.user.findMany({ select: { email: true }, take: 20 });
    console.log("No user matching", needle);
    console.log("Sample emails:", all.map((u) => u.email));
    return;
  }

  const existing = await prisma.enrollment.findFirst({
    where: { courseId: course.id, userId: user.id },
  });
  if (existing) {
    console.log("Already enrolled:", user.email, "in", course.code);
    return;
  }

  await prisma.enrollment.create({
    data: { userId: user.id, courseId: course.id, role: "INSTRUCTOR", isActive: true },
  });
  console.log("Enrolled", user.email, "as INSTRUCTOR in", course.code, course.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
