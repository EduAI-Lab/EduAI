/**
 * Direct admin tool execution against the dev database (no LLM).
 * Run: cd apps/core && npx tsx scripts/admin-chat-tools-smoke.ts
 */
import prisma from "../app/lib/prisma.server";
import { createAdminChatTools } from "../app/lib/agent-tools/create-admin-chat-tools";
import { deleteAdminUser } from "../app/lib/agent-tools/admin-mutations.server";

const stamp = Date.now();
const testEmail = `smoke-admin-${stamp}@eduai.local`;

const toolExec = { toolCallId: "smoke" as const, messages: [] as never[] };

async function main() {
  const admin = await prisma.user.findUnique({
    where: { email: "admin@eduai.local" },
    select: { id: true, role: true, email: true },
  });
  if (!admin || admin.role !== "ADMIN") {
    console.error("FAIL: admin@eduai.local not found or not ADMIN");
    process.exit(1);
  }

  const course = await prisma.course.findFirst({
    where: { deletedAt: null },
    select: { id: true, code: true },
    orderBy: { updatedAt: "desc" },
  });

  const tools = createAdminChatTools({
    user: { id: admin.id, role: admin.role },
    effectiveCourseId: course?.id ?? null,
    effectiveCourseCode: course?.code ?? null,
  });

  // 1. confirmed:false should not write
  const preview = await tools.createUser.execute(
    {
      confirmed: false,
      name: "Smoke Preview",
      email: testEmail,
      role: "STUDENT",
      idempotencyKey: `smoke-preview-${stamp}`,
    },
    toolExec,
  );
  if (
    typeof preview === "object" &&
    preview !== null &&
    "writeSucceeded" in preview &&
    preview.writeSucceeded === false &&
    "error" in preview &&
    preview.error === "CONFIRMATION_REQUIRED"
  ) {
    console.log("OK: createUser confirmed=false → CONFIRMATION_REQUIRED");
  } else {
    console.error("FAIL: createUser confirmed=false", preview);
    process.exit(1);
  }

  const before = await prisma.user.findUnique({ where: { email: testEmail } });
  if (before) {
    console.error("FAIL: user exists before confirmed write");
    process.exit(1);
  }

  // 2. confirmed:true should write
  const created = await tools.createUser.execute(
    {
      confirmed: true,
      name: `Smoke User ${stamp}`,
      email: testEmail,
      role: "STUDENT",
      isActive: true,
      idempotencyKey: `smoke-create-user-${stamp}`,
    },
    toolExec,
  );
  if (
    typeof created === "object" &&
    created !== null &&
    "writeSucceeded" in created &&
    created.writeSucceeded === true
  ) {
    console.log("OK: createUser confirmed=true → writeSucceeded");
  } else {
    console.error("FAIL: createUser confirmed=true", created);
    process.exit(1);
  }

  const inDb = await prisma.user.findUnique({
    where: { email: testEmail },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!inDb) {
    console.error("FAIL: user not in database after create");
    process.exit(1);
  }
  console.log("OK: user visible in database", inDb);

  // 3. listUsers includes new user
  const listed = await tools.listUsers.execute({ limit: 200 }, toolExec);
  if (
    typeof listed === "object" &&
    listed !== null &&
    "users" in listed &&
    Array.isArray((listed as { users: { email: string }[] }).users) &&
    (listed as { users: { email: string }[] }).users.some((u) => u.email === testEmail)
  ) {
    console.log("OK: listUsers includes new user");
  } else {
    console.error("FAIL: listUsers missing new user");
    process.exit(1);
  }

  // 4. updateUser via email
  if (course) {
    const student = await prisma.user.findUnique({ where: { email: testEmail } });
    if (student) {
      const enrollPreview = await tools.createCourseEnrollment.execute(
        {
          confirmed: false,
          userEmail: testEmail,
          role: "STUDENT",
          courseCode: course.code,
          idempotencyKey: `smoke-enroll-preview-${stamp}`,
        },
        toolExec,
      );
      if (
        typeof enrollPreview === "object" &&
        enrollPreview !== null &&
        "error" in enrollPreview &&
        enrollPreview.error === "CONFIRMATION_REQUIRED"
      ) {
        console.log("OK: createCourseEnrollment confirmed=false → CONFIRMATION_REQUIRED");
      } else {
        console.error("FAIL: enrollment preview", enrollPreview);
        process.exit(1);
      }
    }
  } else {
    console.log("SKIP: no course for enrollment test");
  }

  // 5. cleanup
  const deleted = await deleteAdminUser({ id: admin.id, role: admin.role }, inDb.id);
  if (
    typeof deleted === "object" &&
    deleted !== null &&
    "writeSucceeded" in deleted &&
    deleted.writeSucceeded === true
  ) {
    console.log("OK: cleanup deleteAdminUser");
  } else {
    console.error("WARN: cleanup delete failed", deleted);
  }

  const gone = await prisma.user.findUnique({ where: { email: testEmail } });
  if (!gone) {
    console.log("OK: smoke user removed from database");
  } else {
    console.error("WARN: smoke user still in database", gone.id);
  }

  console.log("\nAll direct tool smoke checks passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
