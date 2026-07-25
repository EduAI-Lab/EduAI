/**
 * seed-perf-volume.ts — Issue #961 perf-baseline VOLUME seed.
 *
 * Layers bulk data ON TOP of the main seed (`npm run db:seed`) so the
 * response-time baseline measures list/pagination/RAG endpoints at realistic
 * scale instead of the ~6-course demo dataset. Does NOT touch the known role
 * users (admin@ / instructor.cs@ / ta.cs@ / student1@ / unitadmin.cosc@) — those
 * stay intact so `scripts/perf-baseline.mjs` can still mint one cookie per role.
 *
 * Everything created here is TAGGED and DROPPABLE:
 *   - courses/materials/enrollments/questions → externalSource = 'perf-volume'
 *   - synthetic students                      → email prefix 'perf.'
 *   - chats                                   → title prefix 'perf-vol '
 * Deleting perf courses cascades to enrollments/materials/chunks/embeddings/
 * topics/questions. Chats (courseId SetNull on course delete) + perf users are
 * cleaned by prefix. Run with --reset (or PERF_RESET=1) to wipe before reseeding.
 *
 * Usage:
 *   npx tsx scripts/seed-perf-volume.ts            # add volume on top of main seed
 *   npx tsx scripts/seed-perf-volume.ts --reset    # drop prior perf-volume, then reseed
 *   PERF_RESET=only npx tsx scripts/seed-perf-volume.ts   # drop only, no reseed
 *
 * Scale via env (defaults in parens):
 *   PERF_COURSES(200) PERF_STUDENTS(2000) PERF_TOPICS_PER_COURSE(8)
 *   PERF_QUESTIONS_PER_COURSE(50) PERF_MATERIALS_PER_COURSE(10)
 *   PERF_CHUNKS_PER_MATERIAL(25) PERF_ENROLL_PER_COURSE(40)
 *   PERF_CHATS_PER_COURSE(5) PERF_MSGS_PER_CHAT(8) PERF_EMBEDDINGS(1 | 0 to skip)
 *
 * Embeddings are SYNTHETIC random unit vectors (1024-dim) inserted via raw SQL —
 * NO embedding-provider API calls (fast, offline). They exercise the pgvector
 * index + query path for latency, but are not semantically meaningful; retrieval
 * *quality* still needs `seed-rag-ingestion-fixtures.ts`. For a perf baseline the
 * distinction does not matter — the cost is in the vector scan, not the content.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import prisma from "../app/lib/prisma.server";
import { formatPgVectorLiteral } from "../app/lib/ai/pgvector";

const MARKER = "perf-volume";
const CHAT_PREFIX = "perf-vol ";
const STUDENT_PREFIX = "perf.";

const num = (k: string, d: number) => {
  const v = process.env[k];
  const n = v == null ? d : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const CFG = {
  courses: num("PERF_COURSES", 200),
  students: num("PERF_STUDENTS", 2000),
  topicsPerCourse: num("PERF_TOPICS_PER_COURSE", 8),
  questionsPerCourse: num("PERF_QUESTIONS_PER_COURSE", 50),
  materialsPerCourse: num("PERF_MATERIALS_PER_COURSE", 10),
  chunksPerMaterial: num("PERF_CHUNKS_PER_MATERIAL", 25),
  enrollPerCourse: num("PERF_ENROLL_PER_COURSE", 40),
  chatsPerCourse: num("PERF_CHATS_PER_COURSE", 5),
  msgsPerChat: num("PERF_MSGS_PER_CHAT", 8),
  embeddings: num("PERF_EMBEDDINGS", 1) === 1,
};

// Deterministic PRNG (mulberry32) — reproducible runs without Math.random spread.
let _s = 0x9e3779b9;
function rnd(): number {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const QTYPES = ["MCQ", "SA", "LA"] as const;
const DIFFS = ["EASY", "MEDIUM", "HARD"] as const;
const REASON = ["FACTUAL", "ANALYTICAL", "APPLICATION"] as const;

function randomVector(dim = 1024): number[] {
  const v = new Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const x = rnd() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] = Math.round((v[i] / norm) * 1e6) / 1e6;
  return v;
}

// ---------------------------------------------------------------------------
// Mutation POOL (issue #961) — disposable, tagged rows so perf-baseline.mjs can
// exercise EVERY in-scope mutation endpoint (create/update/delete) without
// touching demo data. Deletes/role-changes consume victims; a perf run may
// deplete the pool → re-run `db:seed:perf` between runs (the seed is the source
// of truth and rewrites the manifest each time). The manifest below is the
// contract the perf script reads (ids are cuids, not guessable → must be passed).
// ---------------------------------------------------------------------------
const SEED_PASSWORD = "EduAI2026!"; // matches apps/core/prisma/seed.ts
const POOL = num("PERF_POOL_SIZE", 15); // victims per destructive endpoint
const POOL_EMAIL = (p: string, n: number) => `perf.pool-${p}-${String(n).padStart(3, "0")}@perf.local`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// Resolve <repoRoot>/.perf-pool (or $PERF_POOL_DIR) — where all three app seeds
// drop their manifests for the root perf script to read.
function poolDir(): string {
  if (process.env.PERF_POOL_DIR) return process.env.PERF_POOL_DIR;
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(d, "package.json");
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, "utf8"));
        if (j.workspaces) return path.join(d, ".perf-pool");
      } catch { /* ignore */ }
    }
    d = path.dirname(d);
  }
  return path.join(process.cwd(), ".perf-pool");
}
function writeManifest(obj: unknown) {
  const dir = poolDir();
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "core.json");
  writeFileSync(f, JSON.stringify(obj, null, 2));
  console.log(`  ✓ wrote pool manifest → ${f}`);
}

// Drop prior pool rows (tags disjoint from demo data). Courses cascade to their
// materials/topics/questions/enrollments; users cascade to their accounts.
async function resetPool() {
  await prisma.chat.deleteMany({ where: { title: { startsWith: "perf-pool " } } });
  await prisma.invitation.deleteMany({ where: { email: { startsWith: "perf.pool-" } } });
  await prisma.bugReport.deleteMany({ where: { description: { startsWith: "PERF-POOL" } } });
  await prisma.aIModel.deleteMany({ where: { modelId: { startsWith: "perf-pool-" } } });
  await prisma.aIProvider.deleteMany({ where: { name: { startsWith: "perf-pool-" } } });
  await prisma.course.deleteMany({ where: { code: { startsWith: "PERF-POOL" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "perf.pool-" } } });
  await prisma.user.deleteMany({ where: { email: "perf.actor@perf.local" } });
}

async function makeUser(email: string, name: string, role: "STUDENT" | "INSTRUCTOR" = "STUDENT") {
  return prisma.user.create({
    data: { email, name, role, isActive: true, emailVerified: true },
  });
}

// Build the whole disposable pool + return the manifest the perf script consumes.
async function seedPool(instructorId: string, deptCode: string) {
  console.log(`▶ perf pool: ${POOL} victims/endpoint · dept=${deptCode}`);
  await resetPool();
  const now = new Date();
  const mk = { code: (s: string) => `PERF-POOL-${s}` };

  // --- dedicated perf actor (STUDENT, password-backed → the script can sign in) ---
  const actor = await makeUser("perf.actor@perf.local", "Perf Actor");
  await prisma.account.create({
    data: { providerId: "credential", accountId: actor.email, userId: actor.id, password: await hashPassword(SEED_PASSWORD) },
  });

  // --- courses ---
  // Core RBAC resolves course access ONLY through an active Enrollment row
  // (lib/auth/course-access.server.ts) — `Course.instructorId` alone grants
  // nothing. Every perf course therefore also gets an INSTRUCTOR enrollment for
  // the pool instructor, or every instructor-role endpoint 403s.
  const newCourse = async (code: string, name: string, published = true) => {
    const course = await prisma.course.create({
      data: {
        code, name, section: "001", term: "Fall", year: 2026, isActive: true,
        isPublished: published, startDate: now, department: deptCode,
        instructorId, externalSource: "perf-volume", aiInstructions: "",
      },
    });
    await prisma.enrollment.create({
      data: { courseId: course.id, userId: instructorId, role: "INSTRUCTOR", isActive: true },
    });
    return course;
  };
  const sharedCourse = await newCourse(mk.code("MAIN"), "Perf Pool Main Course");
  const updateCourse = await newCourse(mk.code("UPD"), "Perf Pool Update Course", false);
  const deleteCoursePool = [];
  for (const i of range(POOL)) deleteCoursePool.push((await newCourse(`${mk.code("DEL")}-${i}`, `Perf Del Course ${i}`)).id);

  // --- topics in sharedCourse ---
  const newTopic = (name: string) =>
    prisma.courseTopic.create({ data: { courseId: sharedCourse.id, name, createdBy: instructorId } });
  const readTopic = await newTopic("Perf Read Topic");
  const updateTopic = await newTopic("Perf Update Topic");
  const deleteTopicPool = [];
  for (const i of range(POOL)) deleteTopicPool.push((await newTopic(`Perf Del Topic ${i}`)).id);

  // --- materials in sharedCourse (distinct checksums; READY) ---
  const newMaterial = (n: string, sum: string) =>
    prisma.courseMaterial.create({
      data: {
        courseId: sharedCourse.id, title: n, mimeType: "text/plain", fileSize: 1024,
        checksum: sum, rawText: "perf", status: "READY", externalSource: "perf-volume",
        uploadedBy: instructorId,
      },
    });
  const updateMaterial = await newMaterial("Perf Update Material", "perf-pool-upd-mat");
  const deleteMaterialPool = [];
  for (const i of range(POOL)) deleteMaterialPool.push((await newMaterial(`Perf Del Material ${i}`, `perf-pool-del-mat-${i}`)).id);

  // --- questions in sharedCourse (need topicId + createdBy) ---
  const newQuestion = (content: string) =>
    prisma.question.create({
      data: { courseId: sharedCourse.id, topicId: readTopic.id, createdBy: instructorId, content, type: "MCQ", answer: "A" },
    });
  const questionUpdate = await newQuestion("Perf update question?");
  const readQuestion = await newQuestion("Perf read question?");

  // --- enrollment users (fresh, unenrolled) for POST /enrollments ---
  const enrolleeUserPool = [];
  for (const i of range(POOL)) enrolleeUserPool.push((await makeUser(POOL_EMAIL("enroll", i), `Perf Enrollee ${i}`)).id);
  // dedicated STUDENT enrollment (disposable user) for PATCH enrollment role
  const enrUser = await makeUser("perf.pool-enrupd-000@perf.local", "Perf Enr Update");
  const updateEnrollment = await prisma.enrollment.create({
    data: { courseId: sharedCourse.id, userId: enrUser.id, role: "STUDENT", isActive: true },
  });

  // --- TA add users (fresh STUDENT, unenrolled) for POST /tas ---
  const taAddUserPool = [];
  for (const i of range(POOL)) taAddUserPool.push((await makeUser(POOL_EMAIL("taadd", i), `Perf TA Add ${i}`)).id);
  // --- TA remove: STUDENT users already TA of sharedCourse for DELETE /tas ---
  const taRemoveUserIds = [];
  for (const i of range(POOL)) {
    const u = await makeUser(POOL_EMAIL("tarm", i), `Perf TA Rm ${i}`);
    await prisma.enrollment.create({ data: { courseId: sharedCourse.id, userId: u.id, role: "TA", isActive: true } });
    taRemoveUserIds.push(u.id);
  }

  // --- chats owned by student1 (script reads chats as `student` role) in sharedCourse ---
  const student1 = await prisma.user.findFirst({ where: { email: "student1@eduai.local" }, select: { id: true } });
  const chatOwnerId = student1?.id ?? actor.id;
  const deleteChatPool = [];
  for (const i of range(POOL)) {
    const chat = await prisma.chat.create({
      data: { userId: chatOwnerId, courseId: sharedCourse.id, chatbotType: "LEARNING", title: `perf-pool chat ${i}` },
    });
    await prisma.chatMessage.create({ data: { chatId: chat.id, messageId: `perf-pool-${i}-0`, role: "user", content: { text: "hi" } } });
    deleteChatPool.push(chat.id);
  }
  const readChatId = deleteChatPool[0]; // reused for GET chat/messages (not deleted first)

  // --- AI providers + models (no external call — pure CRUD) ---
  const newProvider = (name: string) =>
    prisma.aIProvider.create({ data: { name, displayName: "Perf", description: "perf", requiresApiKey: false, isActive: true } });
  const updateProvider = await newProvider("perf-pool-prov-upd");
  const deleteProviderPool = [];
  for (const i of range(POOL)) deleteProviderPool.push((await newProvider(`perf-pool-prov-del-${i}`)).id);
  const newModel = (modelId: string) =>
    prisma.aIModel.create({ data: { modelId, name: "Perf Model", description: "perf", type: "CHAT", providerId: updateProvider.id, isActive: true } });
  const updateModel = await newModel("perf-pool-model-upd");
  const deleteModelPool = [];
  for (const i of range(POOL)) deleteModelPool.push((await newModel(`perf-pool-model-del-${i}`)).id);

  // --- users for admin user CRUD ---
  const updateUser = await makeUser("perf.pool-userupd-000@perf.local", "Perf User Update");
  const deleteUserPool = [];
  for (const i of range(POOL)) deleteUserPool.push((await makeUser(POOL_EMAIL("userdel", i), `Perf User Del ${i}`)).id);

  // --- invitations (PENDING) ---
  const newInvite = (email: string) =>
    prisma.invitation.create({
      data: { email, role: "INSTRUCTOR", tokenHash: randomUUID(), status: "PENDING", invitedById: null, expiresAt: new Date(now.getTime() + 72 * 3600 * 1000) },
    });
  const resendInvitation = await newInvite("perf.pool-invresend-000@perf.local");
  const deleteInvitationPool = [];
  for (const i of range(POOL)) deleteInvitationPool.push((await newInvite(POOL_EMAIL("invdel", i))).id);

  // --- bug report for admin PATCH status ---
  const bugReport = await prisma.bugReport.create({
    data: { source: "CORE", userId: actor.id, description: "PERF-POOL admin status target", status: "UNHANDLED" },
  });

  const manifest = {
    generatedAt: now.toISOString(),
    poolSize: POOL,
    department: deptCode,
    instructorUserId: instructorId,
    actor: { id: actor.id, email: actor.email, password: SEED_PASSWORD },
    sharedCourseId: sharedCourse.id,
    updateCourseId: updateCourse.id,
    deleteCoursePool,
    readTopicId: readTopic.id,
    updateTopicId: updateTopic.id,
    deleteTopicPool,
    updateMaterialId: updateMaterial.id,
    deleteMaterialPool,
    questionUpdateId: questionUpdate.id,
    readQuestionId: readQuestion.id,
    enrolleeUserPool,
    updateEnrollmentId: updateEnrollment.id,
    taAddUserPool,
    taRemoveUserIds,
    deleteChatPool,
    readChatId,
    updateProviderId: updateProvider.id,
    deleteProviderPool,
    updateModelId: updateModel.id,
    deleteModelPool,
    updateUserId: updateUser.id,
    deleteUserPool,
    resendInvitationId: resendInvitation.id,
    deleteInvitationPool,
    bugReportId: bugReport.id,
  };
  writeManifest(manifest);
  console.log(`  ✓ core pool: ${POOL} victims/endpoint across ~25 pools`);
  return manifest;
}

async function reset() {
  console.log("↺ dropping prior perf-volume data …");
  // Chats survive course delete (SetNull) — remove by title prefix first.
  const delChats = await prisma.chat.deleteMany({ where: { title: { startsWith: CHAT_PREFIX } } });
  // Courses cascade → enrollments/materials/chunks/embeddings/topics/questions.
  const delCourses = await prisma.course.deleteMany({ where: { externalSource: MARKER } });
  const delUsers = await prisma.user.deleteMany({ where: { email: { startsWith: STUDENT_PREFIX } } });
  await resetPool();
  console.log(`  chats=${delChats.count} courses=${delCourses.count} users=${delUsers.count} removed (+pool)`);
}

async function main() {
  const t0 = Date.now();
  const resetMode = process.argv.includes("--reset") || process.env.PERF_RESET;
  if (resetMode) await reset();
  if (process.env.PERF_RESET === "only") {
    console.log("✓ reset-only complete.");
    return;
  }

  // Anchor on existing seeded instructor + discipline codes (Course.department FK
  // is Restrict → must reference a real Discipline.code).
  const instructor =
    (await prisma.user.findFirst({ where: { email: "instructor.cs@eduai.local" } })) ??
    (await prisma.user.findFirst({ where: { role: "INSTRUCTOR" } }));
  if (!instructor) throw new Error("No instructor found — run the main seed first (npm run db:seed).");
  const disciplines = await prisma.discipline.findMany({ select: { code: true } });
  if (disciplines.length === 0) throw new Error("No disciplines found — run the main seed first.");
  const deptCodes = disciplines.map((d) => d.code);

  console.log(
    `▶ perf-volume seed: ${CFG.courses} courses · ${CFG.students} students · ` +
      `${CFG.questionsPerCourse}q/${CFG.materialsPerCourse}mat×${CFG.chunksPerMaterial}chunk per course · ` +
      `embeddings=${CFG.embeddings ? "on" : "off"}`,
  );

  // 1. Synthetic students (for enrollment + chat volume). No passwords — auth
  //    uses the known role users, these only add row weight to list endpoints.
  console.log("· students …");
  const studentIds: string[] = [];
  const BATCH = 500;
  for (let start = 0; start < CFG.students; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(start + BATCH, CFG.students); i++) {
      const id = `perfstu-${i.toString().padStart(6, "0")}`;
      studentIds.push(id);
      rows.push({
        id,
        email: `${STUDENT_PREFIX}student${i}@eduai.local`,
        name: `Perf Student ${i}`,
        role: "STUDENT" as const,
        isActive: true,
        emailVerified: true,
      });
    }
    await prisma.user.createMany({ data: rows, skipDuplicates: true });
  }

  // 2. Courses + topics + questions + materials + chunks + embeddings + enrollments.
  let nQuestions = 0,
    nMaterials = 0,
    nChunks = 0,
    nEnroll = 0,
    nChats = 0,
    nMsgs = 0;
  const now = new Date();

  for (let c = 0; c < CFG.courses; c++) {
    const dept = pick(deptCodes);
    const course = await prisma.course.create({
      data: {
        code: `PERF ${c.toString().padStart(4, "0")}`,
        name: `Perf Volume Course ${c}`,
        section: "001",
        term: "Fall",
        year: 2026,
        isActive: true,
        isPublished: true,
        startDate: now,
        department: dept,
        instructorId: instructor.id,
        externalSource: MARKER,
        externalId: `${MARKER}-course-${c}`,
        aiInstructions: "",
      },
    });

    // Topics
    const topicRows = Array.from({ length: CFG.topicsPerCourse }, (_, t) => ({
      courseId: course.id,
      name: `Topic ${t}`,
      createdBy: instructor.id,
    }));
    const topics = await prisma.courseTopic.createManyAndReturn({ data: topicRows });

    // Questions
    const qRows = Array.from({ length: CFG.questionsPerCourse }, (_, q) => {
      const type = pick(QTYPES);
      return {
        courseId: course.id,
        topicId: pick(topics).id,
        createdBy: instructor.id,
        content: `Perf question ${q} for course ${c}. Placeholder body for latency measurement.`,
        type,
        difficulty: pick(DIFFS),
        reasoningLevel: pick(REASON),
        choices: type === "MCQ" ? { options: ["A", "B", "C", "D"], correct: 0 } : undefined,
        answer: type === "MCQ" ? "A" : "Sample answer.",
        testable: rnd() < 0.5,
        idempotencyKey: `${MARKER}-q-${c}-${q}`,
      };
    });
    await prisma.question.createMany({ data: qRows, skipDuplicates: true });
    nQuestions += qRows.length;

    // Materials + chunks + synthetic embeddings
    for (let m = 0; m < CFG.materialsPerCourse; m++) {
      const material = await prisma.courseMaterial.create({
        data: {
          courseId: course.id,
          title: `Perf Material ${m} (course ${c})`,
          mimeType: "text/plain",
          fileSize: 4096,
          checksum: `${MARKER}-${c}-${m}`,
          rawText: `Synthetic material ${m} content for course ${c}.`,
          status: "READY",
          externalSource: MARKER,
          externalId: `${MARKER}-mat-${c}-${m}`,
          uploadedBy: instructor.id,
        },
      });
      nMaterials++;

      const chunkRows = Array.from({ length: CFG.chunksPerMaterial }, (_, i) => ({
        materialId: material.id,
        index: i,
        content: `Chunk ${i} of material ${m}, course ${c}. Synthetic text for vector-scan latency.`,
      }));
      const chunks = await prisma.materialChunk.createManyAndReturn({ data: chunkRows });
      nChunks += chunks.length;

      if (CFG.embeddings) {
        // Batch raw INSERT — 1024-dim vectors, no provider calls.
        for (let b = 0; b < chunks.length; b += 100) {
          const slice = chunks.slice(b, b + 100);
          const values = slice
            .map((ch) => {
              const lit = formatPgVectorLiteral(randomVector());
              return `('${randomUUID()}', '${ch.id}', '${lit}'::vector, NOW())`;
            })
            .join(",");
          await prisma.$executeRawUnsafe(
            `INSERT INTO material_embeddings (id, "chunkId", embedding, "createdAt") VALUES ${values}`,
          );
        }
      }
    }

    // Enrollments — round-robin a slice of synthetic students into this course.
    const enrollRows = [];
    for (let e = 0; e < CFG.enrollPerCourse && e < studentIds.length; e++) {
      const sid = studentIds[(c * CFG.enrollPerCourse + e) % studentIds.length];
      enrollRows.push({
        courseId: course.id,
        userId: sid,
        role: "STUDENT" as const,
        isActive: true,
        idempotencyKey: `${MARKER}-enr-${c}-${e}`,
        externalSource: MARKER,
      });
    }
    if (enrollRows.length) {
      const r = await prisma.enrollment.createMany({ data: enrollRows, skipDuplicates: true });
      nEnroll += r.count;
    }

    // Chats + messages (for chat-list endpoints)
    for (let h = 0; h < CFG.chatsPerCourse; h++) {
      const sid = studentIds[(c + h) % studentIds.length];
      const chat = await prisma.chat.create({
        data: {
          userId: sid,
          courseId: course.id,
          chatbotType: "LEARNING",
          title: `${CHAT_PREFIX}c${c} #${h}`,
        },
      });
      nChats++;
      const msgRows = Array.from({ length: CFG.msgsPerChat }, (_, i) => ({
        chatId: chat.id,
        messageId: `${MARKER}-msg-${c}-${h}-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: { text: `Perf message ${i} in chat ${h}, course ${c}.` },
      }));
      await prisma.chatMessage.createMany({ data: msgRows, skipDuplicates: true });
      nMsgs += msgRows.length;
    }

    if ((c + 1) % 25 === 0 || c === CFG.courses - 1) {
      console.log(`  … ${c + 1}/${CFG.courses} courses (q=${nQuestions} mat=${nMaterials} chunk=${nChunks} enr=${nEnroll} chat=${nChats})`);
    }
  }

  // Mutation pool + manifest (always, so db:seed:perf populates everything the
  // perf script needs in one run). Prefer COSC as the FK department if present.
  const deptCode = deptCodes.includes("COSC") ? "COSC" : deptCodes[0];
  await seedPool(instructor.id, deptCode);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n✓ perf-volume seed done in ${secs}s:\n` +
      `  courses=${CFG.courses} students=${CFG.students} enrollments=${nEnroll}\n` +
      `  topics=${CFG.courses * CFG.topicsPerCourse} questions=${nQuestions}\n` +
      `  materials=${nMaterials} chunks=${nChunks} embeddings=${CFG.embeddings ? nChunks : 0}\n` +
      `  chats=${nChats} messages=${nMsgs}\n` +
      `  Drop with: npx tsx scripts/seed-perf-volume.ts --reset (PERF_RESET=only to just drop).`,
  );
}

main()
  .catch((e) => {
    console.error("✗ perf-volume seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
