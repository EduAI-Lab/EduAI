// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "~/lib/prisma.server";
import { acquireReEmbedJob, resumeReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { seedCourse, cleanupRbac } from "../helpers/rbac";

let courseId: string;

beforeAll(async () => {
  const course = await seedCourse();
  courseId = course.id;

  // `prisma db push` cannot represent partial indexes, so mirror the production
  // migration in the integration database before exercising the invariant.
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "course_re_embed_jobs_one_active_per_course"
    ON "course_re_embed_jobs" ("courseId")
    WHERE "status" IN ('PENDING', 'RUNNING')
  `);
});

beforeEach(async () => {
  await prisma.courseReEmbedJob.deleteMany({ where: { courseId } });
  await prisma.course.update({
    where: { id: courseId },
    data: {
      embeddingProvider: "local",
      embeddingModel: "mxbai-embed-large",
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    },
  });
});

afterAll(async () => {
  await cleanupRbac({ courseIds: [courseId] });
  await prisma.$disconnect();
});

describe("durable course re-embed jobs", () => {
  it("atomically converges concurrent acquisitions on one active job", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => acquireReEmbedJob(courseId)));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.job.id)).size).toBe(1);
    await expect(
      prisma.courseReEmbedJob.count({
        where: { courseId, status: { in: ["PENDING", "RUNNING"] } },
      }),
    ).resolves.toBe(1);
  });

  it("keeps the database invariant when a caller bypasses acquisition", async () => {
    await acquireReEmbedJob(courseId);

    await expect(
      prisma.courseReEmbedJob.create({
        data: {
          courseId,
          status: "PENDING",
          embeddingProviderSnapshot: "local",
          embeddingModelSnapshot: "mxbai-embed-large",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("reclaims an expired RUNNING lease and completes the same durable row", async () => {
    const abandoned = await prisma.courseReEmbedJob.create({
      data: {
        courseId,
        status: "RUNNING",
        embeddingProviderSnapshot: "local",
        embeddingModelSnapshot: "mxbai-embed-large",
        leaseOwner: "dead-process",
        leaseHeartbeatAt: new Date(Date.now() - 120_000),
        leaseExpiresAt: new Date(Date.now() - 60_000),
        attemptCount: 1,
        startedAt: new Date(Date.now() - 180_000),
      },
    });

    await expect(resumeReEmbedJob(abandoned.id)).resolves.toBe(true);

    const recovered = await prisma.courseReEmbedJob.findUniqueOrThrow({
      where: { id: abandoned.id },
    });
    expect(recovered).toMatchObject({
      id: abandoned.id,
      status: "COMPLETED",
      attemptCount: 2,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(recovered.completedAt).toBeInstanceOf(Date);
  });

  it("does not steal an unexpired lease", async () => {
    const running = await prisma.courseReEmbedJob.create({
      data: {
        courseId,
        status: "RUNNING",
        embeddingProviderSnapshot: "local",
        embeddingModelSnapshot: "mxbai-embed-large",
        leaseOwner: "live-process",
        leaseHeartbeatAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: 1,
        startedAt: new Date(),
      },
    });

    await expect(resumeReEmbedJob(running.id)).resolves.toBe(false);
    await expect(
      prisma.courseReEmbedJob.findUniqueOrThrow({ where: { id: running.id } }),
    ).resolves.toMatchObject({
      status: "RUNNING",
      leaseOwner: "live-process",
      attemptCount: 1,
    });
  });

  it("persists the resolved settings snapshot independently of later course changes", async () => {
    const { job } = await acquireReEmbedJob(courseId);

    await prisma.course.update({
      where: { id: courseId },
      data: {
        embeddingProvider: "cloud",
        embeddingModel: "openai/text-embedding-3-small",
      },
    });

    await expect(
      prisma.courseReEmbedJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).resolves.toMatchObject({
      embeddingProviderSnapshot: "local",
      embeddingModelSnapshot: "mxbai-embed-large",
    });
  });

  it("terminalizes and releases the lease when Ollama never responds", async () => {
    const content = "A bounded embedding request must not strand this material.";
    const material = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: "hanging-provider.txt",
        mimeType: "text/plain",
        fileSize: content.length,
        checksum: `hanging-provider-${Date.now()}`,
        rawText: content,
        status: "PROCESSING",
      },
    });
    const originalFetch = globalThis.fetch;
    const originalTimeout = process.env.EMBEDDING_REQUEST_TIMEOUT_MS;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error("TEST_MISSING_ABORT_SIGNAL"));
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    try {
      process.env.EMBEDDING_REQUEST_TIMEOUT_MS = "100";
      globalThis.fetch = fetchMock as typeof fetch;
      const { job } = await acquireReEmbedJob(courseId);

      await expect(resumeReEmbedJob(job.id)).resolves.toBe(true);

      await expect(
        prisma.courseReEmbedJob.findUniqueOrThrow({ where: { id: job.id } }),
      ).resolves.toMatchObject({
        status: "PARTIAL",
        failedMaterialIds: [material.id],
        completedAt: expect.any(Date),
        leaseOwner: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTimeout === undefined) delete process.env.EMBEDDING_REQUEST_TIMEOUT_MS;
      else process.env.EMBEDDING_REQUEST_TIMEOUT_MS = originalTimeout;
      await prisma.courseMaterial.deleteMany({ where: { id: material.id } });
    }
  });

  it("fails closed on a rejected heartbeat, then lets a successor reclaim after expiry", async () => {
    const content = "The original worker must not commit after losing its lease.";
    const material = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: "heartbeat-fenced.txt",
        mimeType: "text/plain",
        fileSize: content.length,
        checksum: `heartbeat-fenced-${Date.now()}`,
        rawText: content,
        status: "READY",
      },
    });
    const originalFetch = globalThis.fetch;
    const originalLease = process.env.RE_EMBED_JOB_LEASE_MS;
    const originalTimeout = process.env.EMBEDDING_REQUEST_TIMEOUT_MS;
    let fetchCalls = 0;
    let firstProviderAborted = false;
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      const signal = init?.signal;
      if (fetchCalls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          if (!signal) return reject(new Error("TEST_MISSING_ABORT_SIGNAL"));
          signal.addEventListener(
            "abort",
            () => {
              firstProviderAborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }

      return Promise.resolve(
        new Response(JSON.stringify({ embeddings: [Array.from({ length: 1024 }, () => 0.1)] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    process.env.RE_EMBED_JOB_LEASE_MS = "15000";
    process.env.EMBEDDING_REQUEST_TIMEOUT_MS = "60000";
    const { job } = await acquireReEmbedJob(courseId);
    const realUpdateMany = prisma.courseReEmbedJob.updateMany.bind(prisma.courseReEmbedJob);
    const updateManySpy = vi
      .spyOn(prisma.courseReEmbedJob, "updateMany")
      .mockImplementation((args: any) => {
        const data = args.data ?? {};
        // Reject only a heartbeat renewal, not the claim/progress/final writes.
        if (
          data.leaseHeartbeatAt &&
          data.leaseExpiresAt &&
          data.processedCount === undefined &&
          data.status === undefined
        ) {
          return Promise.reject(new Error("simulated heartbeat database rejection")) as ReturnType<
            typeof realUpdateMany
          >;
        }
        return realUpdateMany(args);
      });

    try {
      await expect(resumeReEmbedJob(job.id)).resolves.toBe(true);
      expect(firstProviderAborted).toBe(true);

      const abandoned = await prisma.courseReEmbedJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(abandoned).toMatchObject({
        id: job.id,
        status: "RUNNING",
        attemptCount: 1,
        leaseOwner: expect.any(String),
      });
      expect(abandoned.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
      await expect(
        prisma.materialChunk.count({ where: { materialId: material.id } }),
      ).resolves.toBe(0);

      await prisma.courseReEmbedJob.update({
        where: { id: job.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1) },
      });

      await expect(resumeReEmbedJob(job.id)).resolves.toBe(true);
      const recovered = await prisma.courseReEmbedJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(recovered).toMatchObject({
        id: job.id,
        status: "COMPLETED",
        attemptCount: 2,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      expect(fetchCalls).toBe(2);
      await expect(
        prisma.materialChunk.count({ where: { materialId: material.id } }),
      ).resolves.toBeGreaterThan(0);
    } finally {
      updateManySpy.mockRestore();
      globalThis.fetch = originalFetch;
      if (originalLease === undefined) delete process.env.RE_EMBED_JOB_LEASE_MS;
      else process.env.RE_EMBED_JOB_LEASE_MS = originalLease;
      if (originalTimeout === undefined) delete process.env.EMBEDDING_REQUEST_TIMEOUT_MS;
      else process.env.EMBEDDING_REQUEST_TIMEOUT_MS = originalTimeout;
      await prisma.courseMaterial.deleteMany({ where: { id: material.id } });
    }
  }, 20_000);
});
