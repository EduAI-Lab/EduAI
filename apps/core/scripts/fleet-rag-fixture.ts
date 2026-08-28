/**
 * Create a temporary RAG course for the fleet stress harness.
 *
 * Mutation is opt-in. Set FLEET_STRESS_FIXTURE_ALLOW_MUTATION=1 and use a
 * reserved FLEET-ROUTER-STRESS-* code. The script refuses to overwrite an
 * existing course. After the run, pass the emitted courseId with --cleanup.
 */
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

const FIXTURE_NAME = "Fleet Router Stress Fixture";
const FIXTURE_SECTION = "STRESS";
const FIXTURE_CODE_PREFIX = "FLEET-ROUTER-STRESS-";
const allowMutation = process.env.FLEET_STRESS_FIXTURE_ALLOW_MUTATION === "1";
const allowProduction = process.env.FLEET_STRESS_FIXTURE_ALLOW_PRODUCTION === "1";
const cleanup = process.argv.includes("--cleanup");

function assertMutationIsExplicit(): void {
  if (!allowMutation) {
    throw new Error(
      "Refusing to mutate the database. Set FLEET_STRESS_FIXTURE_ALLOW_MUTATION=1 for an explicit test run.",
    );
  }
  if (process.env.NODE_ENV === "production" && !allowProduction) {
    throw new Error(
      "Refusing to run in NODE_ENV=production. Set FLEET_STRESS_FIXTURE_ALLOW_PRODUCTION=1 only after verifying the target is an approved test database.",
    );
  }
}

async function main() {
  assertMutationIsExplicit();
  const prisma = (await import(resolve(root, "app/lib/prisma.server.ts"))).default;
  const { processMaterialEmbeddings } = await import(resolve(root, "app/lib/ai/embedding.ts"));
  let createdCourseId: string | undefined;

  try {
    const code = process.env.FLEET_STRESS_FIXTURE_CODE || "FLEET-ROUTER-STRESS-20260818";
    if (!code.startsWith(FIXTURE_CODE_PREFIX)) {
      throw new Error(`FLEET_STRESS_FIXTURE_CODE must start with ${FIXTURE_CODE_PREFIX}`);
    }
    const instructorId =
      process.env.FLEET_STRESS_FIXTURE_INSTRUCTOR_ID || "seed_user_instructor_cs";

    if (cleanup) {
      const courseId = process.env.FLEET_STRESS_FIXTURE_COURSE_ID;
      if (!courseId) {
        throw new Error("FLEET_STRESS_FIXTURE_COURSE_ID is required with --cleanup");
      }
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        console.log(JSON.stringify({ code, courseId, removed: false, reason: "course not found" }));
        return;
      }
      if (
        course.code !== code ||
        course.section !== FIXTURE_SECTION ||
        course.name !== FIXTURE_NAME
      ) {
        throw new Error(`Refusing to delete non-fixture course ${courseId}`);
      }
      await prisma.$transaction([
        prisma.chat.deleteMany({ where: { courseId } }),
        prisma.course.delete({ where: { id: courseId } }),
      ]);
      console.log(JSON.stringify({ code, courseId, removed: true }));
      return;
    }

    const existingCourse = await prisma.course.findFirst({
      where: { code, section: FIXTURE_SECTION },
    });
    if (existingCourse) {
      throw new Error(
        `Fixture course ${existingCourse.id} already exists; run --cleanup with FLEET_STRESS_FIXTURE_COURSE_ID=${existingCourse.id} before creating it again`,
      );
    }

    const course = await prisma.course.create({
      data: {
        code,
        name: FIXTURE_NAME,
        section: FIXTURE_SECTION,
        term: "W1",
        year: 2026,
        startDate: new Date("2026-08-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        isPublished: true,
        instructorId,
        aiInstructions: "Answer from the fixture when it is relevant.",
      },
    });
    createdCourseId = course.id;

    await prisma.enrollment.create({
      data: { courseId: course.id, userId: instructorId, role: "INSTRUCTOR", isActive: true },
    });

    const title = "Fleet router RAG stress fixture";
    const fact =
      "FLEET_ROUTER_STRESS_FACT_7391: the blue heron represents deterministic cross-server context continuity.";
    const content = `Fleet router stress-test fixture\n\n${fact}\n\nUse this exact fact to verify retrieval and cite this source title: ${title}.`;
    const checksum = createHash("sha256").update(content).digest("hex");
    const material = await prisma.courseMaterial.create({
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

    await processMaterialEmbeddings(material.id, content, { replace: true });
    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { status: "READY", processedAt: new Date() },
    });
    const chunkCount = await prisma.materialChunk.count({ where: { materialId: material.id } });
    console.log(
      JSON.stringify({
        code,
        courseId: course.id,
        materialId: material.id,
        title,
        fact,
        chunkCount,
      }),
    );
  } catch (error) {
    if (createdCourseId) {
      try {
        await prisma.chat.deleteMany({ where: { courseId: createdCourseId } });
        await prisma.course.delete({ where: { id: createdCourseId } });
      } catch (cleanupError) {
        console.error("Fixture setup failed and automatic cleanup also failed", cleanupError);
      }
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
