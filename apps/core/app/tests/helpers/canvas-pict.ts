/**
 * Shared Canvas PICT fixtures (#1183 → #1184).
 *
 * Integration usage: stub `ENCRYPTION_KEY` before calling
 * `seedCanvasIntegrationForUser` (same pattern as canvas.integration.test.ts).
 * Upstream file fixtures are plain data — adapters inject them via mocked
 * `fetchImpl` / `listCanvasCourseFiles`, not real HTTP.
 */
import { randomUUID } from "node:crypto";
import { CANVAS_EXTERNAL_SOURCE } from "~/lib/canvas/client.server";
import { encrypt } from "~/lib/canvas/encryption";
import prisma from "~/lib/prisma.server";
import { enroll, seedUser } from "./rbac";

const DEFAULT_CANVAS_URL = "http://localhost:8080";
const TEST_MODE_API_KEY = "test-key";

export async function seedCanvasLinkedCourse(opts?: {
  department?: string;
  externalId?: string;
}): Promise<{ course: { id: string; externalId: string }; instructor: { id: string } }> {
  const externalId = opts?.externalId ?? randomUUID().slice(0, 8);
  const instructor = await seedUser({ role: "INSTRUCTOR" });
  const suffix = randomUUID().slice(0, 8);

  const course = await prisma.course.create({
    data: {
      name: `Canvas PICT Course ${suffix}`,
      code: `CPICT ${suffix}`,
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
      externalId,
      externalSource: CANVAS_EXTERNAL_SOURCE,
      isPublished: true,
      department: opts?.department ?? null,
      lastSyncedAt: new Date(),
    },
  });

  await enroll(course.id, instructor.id, "INSTRUCTOR");

  return {
    course: { id: course.id, externalId },
    instructor: { id: instructor.id },
  };
}

export async function seedCanvasIntegrationForUser(
  userId: string,
  opts?: { canvasUrl?: string },
): Promise<void> {
  const canvasUrl = opts?.canvasUrl ?? DEFAULT_CANVAS_URL;
  const apiKey = encrypt(TEST_MODE_API_KEY);

  await prisma.canvasIntegration.upsert({
    where: { userId },
    create: {
      userId,
      canvasUrl,
      apiKey,
      isTestMode: true,
    },
    update: {
      canvasUrl,
      apiKey,
      isTestMode: true,
    },
  });
}

export type UpstreamFileFixture = {
  canvasFileId: string;
  displayName: string;
  url: string;
  updatedAt: Date;
  checksum?: string;
  published?: boolean;
};

export function buildUpstreamCanvasFile(
  partial: Partial<UpstreamFileFixture> & Pick<UpstreamFileFixture, "canvasFileId">,
): UpstreamFileFixture {
  const { canvasFileId } = partial;

  return {
    canvasFileId,
    displayName: partial.displayName ?? `File ${canvasFileId}.txt`,
    url: partial.url ?? `mock://canvas/files/${canvasFileId}`,
    updatedAt: partial.updatedAt ?? new Date("2025-01-10T12:00:00.000Z"),
    checksum: partial.checksum,
    published: partial.published ?? true,
  };
}
