/** Create/refresh a temporary RAG course for the fleet stress harness. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = process.env.CORE_APP_ROOT || process.cwd();
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    const split = line.indexOf("=");
    if (!line || line.startsWith("#") || split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  const prisma = (await import(resolve(root, "app/lib/prisma.server.ts"))).default;
  const { processMaterialEmbeddings } = await import(resolve(root, "app/lib/ai/embedding.ts"));

  const code = process.env.FLEET_STRESS_FIXTURE_CODE || "FLEET-ROUTER-STRESS-20260818";
  const title = "Fleet router RAG stress fixture";
  const fact =
    "FLEET_ROUTER_STRESS_FACT_7391: the blue heron represents deterministic cross-server context continuity.";
  const content = `Fleet router stress-test fixture\n\n${fact}\n\nUse this exact fact to verify retrieval and cite this source title: ${title}.`;
  const instructorId = process.env.FLEET_STRESS_FIXTURE_INSTRUCTOR_ID || "seed_user_instructor_cs";

  let course = await prisma.course.findFirst({ where: { code, section: "STRESS" } });
  if (!course) {
    course = await prisma.course.create({
      data: {
        code,
        name: "Fleet Router Stress Fixture",
        section: "STRESS",
        term: "W1",
        year: 2026,
        startDate: new Date("2026-08-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        isPublished: true,
        instructorId,
        aiInstructions: "Answer from the fixture when it is relevant.",
      },
    });
  }

  await prisma.enrollment.upsert({
    where: { courseId_userId: { courseId: course.id, userId: instructorId } },
    create: { courseId: course.id, userId: instructorId, role: "INSTRUCTOR", isActive: true },
    update: { role: "INSTRUCTOR", isActive: true },
  });

  const checksum = createHash("sha256").update(content).digest("hex");
  let material = await prisma.courseMaterial.findFirst({ where: { courseId: course.id, title } });
  if (!material) {
    material = await prisma.courseMaterial.create({
      data: {
        courseId: course.id,
        title,
        mimeType: "text/plain",
        fileSize: content.length,
        checksum,
        rawText: content,
        status: "PROCESSING",
        uploadedBy: instructorId,
      },
    });
  } else {
    material = await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { rawText: content, fileSize: content.length, checksum, status: "PROCESSING" },
    });
  }

  await processMaterialEmbeddings(material.id, content, { replace: true });
  await prisma.courseMaterial.update({
    where: { id: material.id },
    data: { status: "READY", processedAt: new Date() },
  });
  const chunkCount = await prisma.materialChunk.count({ where: { materialId: material.id } });
  console.log(
    JSON.stringify({ code, courseId: course.id, materialId: material.id, title, fact, chunkCount }),
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
