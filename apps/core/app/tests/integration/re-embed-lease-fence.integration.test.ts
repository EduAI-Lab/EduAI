// @vitest-environment node
//
// Real-Postgres regression tests for the durable re-embed lease fence.  The
// provider is mocked, but the transaction/row-lock interleaving is real.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";
import { ReEmbedInterruptedError, reEmbedCourseMaterials } from "~/lib/ai/embedding";
import { cleanupRbac, seedCourse } from "../helpers/rbac";

const EMBEDDING_DIMENSION = 1024;
const oldOwner = "old-worker";
const successorOwner = "successor-worker";

const embedMany = vi.fn();

vi.mock("ai", () => ({
  embed: vi.fn(),
  embedMany: (...args: unknown[]) => embedMany(...(args as [unknown])),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn(() => ({ modelId: "openai/text-embedding-3-small" })),
  })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

let courseId: string;
let blocker: PrismaClient;
let activeBlocker:
  | { release: () => void; transaction: Promise<unknown> }
  | undefined;
let activeSuccessorClaim: Promise<unknown> | undefined;

function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for this integration test");
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", "8");
  return parsed.toString();
}

async function holdMaterialChunk(chunkId: string) {
  let ready!: () => void;
  let release!: () => void;
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const releaseGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const transaction = blocker.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "material_chunks" WHERE id = ${chunkId} FOR UPDATE`;
      ready();
      await releaseGate;
    },
    { maxWait: 5_000, timeout: 30_000 },
  );

  return { locked, release: () => release(), transaction };
}

async function waitForLockWait(tableName: "material_chunks" | "course_re_embed_jobs") {
  await vi.waitFor(
    async () => {
      const rows = await blocker.$queryRaw<Array<{ pid: number }>>`
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE ${`%${tableName}%`}
      `;
      expect(rows.length).toBeGreaterThan(0);
    },
    { timeout: 5_000, interval: 25 },
  );
}

async function waitForLeaseExpiry(jobId: string) {
  await vi.waitFor(
    async () => {
      const rows = await blocker.$queryRaw<Array<{ expired: boolean }>>`
        SELECT clock_timestamp() > "leaseExpiresAt" AS expired
        FROM "course_re_embed_jobs"
        WHERE id = ${jobId}
      `;
      expect(rows[0]?.expired).toBe(true);
    },
    { timeout: 5_000, interval: 25 },
  );
}

describe("re-embed lease fencing (real Postgres)", () => {
  beforeAll(async () => {
    const course = await seedCourse({ name: "Re-embed lease fence integration" });
    courseId = course.id;
    blocker = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
    await blocker.$connect();
  });

  beforeEach(async () => {
    activeBlocker = undefined;
    activeSuccessorClaim = undefined;
    vi.clearAllMocks();
    await prisma.courseReEmbedJob.deleteMany({ where: { courseId } });
    await prisma.courseMaterial.deleteMany({ where: { courseId } });
    await prisma.course.update({
      where: { id: courseId },
      data: {
        embeddedWithProvider: null,
        embeddedWithModel: null,
        lastEmbeddedAt: null,
      },
    });
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.EMBEDDING_DIMENSION = String(EMBEDDING_DIMENSION);
    process.env.REINDEX_CONCURRENCY = "1";
  });

  afterEach(async () => {
    // Keep a failed assertion from leaking an interactive transaction into
    // the next test or into cleanup (which otherwise reports a deadlock).
    activeBlocker?.release();
    await activeBlocker?.transaction.catch(() => undefined);
    await activeSuccessorClaim?.catch(() => undefined);
    activeBlocker = undefined;
    activeSuccessorClaim = undefined;
  });

  afterAll(async () => {
    await blocker?.$disconnect();
    await cleanupRbac({ courseIds: [courseId] });
    await prisma.$disconnect();
  });

  it("does not delete/insert vectors or write READY/FAILED after a successor claims", async () => {
    const firstContent = "first material content";
    const secondContent = "second material content";
    const first = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: "first",
        mimeType: "text/plain",
        fileSize: firstContent.length,
        checksum: `fence-first-${randomUUID()}`,
        rawText: firstContent,
        status: "PROCESSING",
      },
    });
    const second = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: "second",
        mimeType: "text/plain",
        fileSize: secondContent.length,
        checksum: `fence-second-${randomUUID()}`,
        rawText: secondContent,
        status: "PROCESSING",
      },
    });
    const oldChunk = { id: randomUUID() };
    await prisma.$executeRaw`
      INSERT INTO material_chunks (id, "materialId", "index", content)
      VALUES (${oldChunk.id}, ${first.id}, 0, ${"old vector content"})
    `;
    const job = await prisma.courseReEmbedJob.create({
      data: {
        courseId,
        status: "RUNNING",
        embeddingProviderSnapshot: "cloud",
        embeddingModelSnapshot: "openai/text-embedding-3-small",
        leaseOwner: oldOwner,
        leaseHeartbeatAt: new Date(),
        // Keep the lease alive long enough to enter the blocked vector
        // transaction, then let it expire while the successor waits on the
        // same job row lock.
        leaseExpiresAt: new Date(Date.now() + 1_000),
      },
    });

    embedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => Array.from({ length: EMBEDDING_DIMENSION }, () => 0.1)),
    }));

    const blocked = await holdMaterialChunk(oldChunk.id);
    activeBlocker = blocked;
    await blocked.locked;

    const run = reEmbedCourseMaterials(courseId, {
      embeddingSettings: {
        provider: "cloud",
        model: "openai/text-embedding-3-small",
        wantsLocal: false,
        source: { provider: "course", model: "course" },
      },
      // The local check deliberately stays true: only the DB fence can see the
      // successor claim while this worker is blocked in its transaction.
      shouldContinue: () => true,
      leaseFence: { jobId: job.id, leaseOwner: oldOwner },
    });
    // Attach the rejection observer immediately; the first fenced transaction
    // can reject before the lock choreography below is released.
    const runError = run.catch((error) => error);

    await vi.waitFor(() => expect(embedMany).toHaveBeenCalled());
    // The old owner now holds the job-row fence and is blocked deleting the
    // pre-existing chunk.  The successor's update must wait on that fence.
    await waitForLockWait("material_chunks");
    const successorClaim = blocker.$executeRaw`
      UPDATE "course_re_embed_jobs"
      SET "leaseOwner" = ${successorOwner},
          "leaseHeartbeatAt" = NOW(),
          "leaseExpiresAt" = NOW() + INTERVAL '5 minutes'
      WHERE id = ${job.id}
    `;
    // Prisma promises are lazy; adopting the thenable starts the UPDATE while
    // the old transaction still owns the job row lock.
    const successorClaimStarted = Promise.resolve(successorClaim);
    activeSuccessorClaim = successorClaimStarted;
    await waitForLockWait("course_re_embed_jobs");
    await waitForLeaseExpiry(job.id);

    // Releasing the chunk lets the stale transaction finish its destructive
    // statements, but its final in-transaction fence now fails and rolls all
    // vector/material writes back.  The successor acquires the row only after
    // that rollback.
    blocked.release();
    await blocked.transaction;
    await successorClaimStarted;
    await expect(runError).resolves.toBeInstanceOf(ReEmbedInterruptedError);

    const chunks = await prisma.materialChunk.findMany({
      where: { materialId: first.id },
      orderBy: { index: "asc" },
    });
    expect(chunks.map((chunk) => chunk.id)).toEqual([oldChunk.id]);

    const statuses = await prisma.courseMaterial.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { id: true, status: true },
      orderBy: { id: "asc" },
    });
    expect(statuses.every(({ status }) => status !== "READY" && status !== "FAILED")).toBe(true);
    await expect(prisma.course.findUnique({ where: { id: courseId } })).resolves.toMatchObject({
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });
  }, 15_000);
});
