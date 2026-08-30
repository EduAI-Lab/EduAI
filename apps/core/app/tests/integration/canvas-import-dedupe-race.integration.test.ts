// @vitest-environment node
//
// Real-Postgres regression tests for the #1495 atomic Canvas-import dedupe.
// Only the Canvas download and the file-extraction/embedding boundaries are
// mocked; the `(courseId, checksum)` unique index and every write race against
// it are real, so these tests exercise the constraint that guards the importer
// rather than a hand-mocked `P2002`.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/canvas/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/client.server")>();
  return { ...actual, downloadCanvasFile: vi.fn() };
});
vi.mock("~/lib/ai/file-processing", () => ({ processUploadedFile: vi.fn() }));
vi.mock("~/lib/ai/embedding", () => ({ processMaterialEmbeddings: vi.fn() }));

import { downloadCanvasFile } from "~/lib/canvas/client.server";
import { processUploadedFile } from "~/lib/ai/file-processing";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import { importSingleCanvasFile } from "~/lib/canvas/materials.server";
import { seedCourse, seedUser } from "../helpers/rbac";

const CREDENTIALS = { canvasUrl: "http://localhost:8080", apiKey: "test-key", isTestMode: true };

let courseId: string;
let userId: string;

function canvasFile(id: number, name: string) {
  return {
    id,
    display_name: name,
    filename: name,
    "content-type": "text/plain",
    size: 100,
    updated_at: "2026-01-10T12:00:00.000Z",
    url: "mock://file",
  } as never;
}

function importFile(file: ReturnType<typeof canvasFile>) {
  return importSingleCanvasFile(
    courseId,
    userId,
    file,
    CREDENTIALS as never,
    fetch,
    new Set<string>(),
  );
}

beforeAll(async () => {
  const [course, user] = await Promise.all([seedCourse(), seedUser({ role: "INSTRUCTOR" })]);
  courseId = course.id;
  userId = user.id;

  vi.mocked(downloadCanvasFile).mockResolvedValue(new Uint8Array(Buffer.from("hello")));
  vi.mocked(processMaterialEmbeddings).mockResolvedValue(undefined);
});

afterEach(async () => {
  await prisma.courseMaterial.deleteMany({ where: { courseId } });
});

afterAll(async () => {
  await prisma.courseMaterial.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("#1495 Canvas import dedupe — real unique-index races", () => {
  it("finalize-hash race: two files with identical content leave exactly one READY row, none PROCESSING", async () => {
    // Two distinct Canvas files whose extracted text hashes to the same checksum
    // race on the `(courseId, checksum)` finalize write.
    vi.mocked(processUploadedFile).mockResolvedValue({
      title: "Lecture.txt",
      mimeType: "text/plain",
      fileSize: 5,
      checksum: "race-checksum-finalize",
      content: "hello",
    });

    const outcomes = await Promise.all([
      importFile(canvasFile(4101, "a.txt")),
      importFile(canvasFile(4102, "b.txt")),
    ]);

    // Neither call surfaces a raw error; one wins, the other defers as a skip.
    expect(outcomes.filter((o) => o === "imported")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "skipped-not-modified")).toHaveLength(1);

    const rows = await prisma.courseMaterial.findMany({
      where: { courseId, checksum: "race-checksum-finalize" },
    });
    // The unique index admits exactly one winner; the loser's provisional row is
    // dropped, not stranded.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("READY");
    expect(await prisma.courseMaterial.count({ where: { courseId, status: "PROCESSING" } })).toBe(
      0,
    );
  });

  it("provisional-create race: two syncs of the same Canvas file leave one row, none PROCESSING", async () => {
    vi.mocked(processUploadedFile).mockResolvedValue({
      title: "Same.txt",
      mimeType: "text/plain",
      fileSize: 5,
      checksum: "race-checksum-create",
      content: "hello",
    });

    const outcomes = await Promise.all([
      importFile(canvasFile(4201, "same.txt")),
      importFile(canvasFile(4201, "same.txt")),
    ]);

    // However the two interleave (both create-and-collide, or the second sees the
    // first's committed row and updates it), the file resolves without error and
    // never doubles up.
    expect(outcomes).not.toContain(undefined);
    const rows = await prisma.courseMaterial.findMany({
      where: { courseId, externalId: "4201" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("READY");
    expect(await prisma.courseMaterial.count({ where: { courseId, status: "PROCESSING" } })).toBe(
      0,
    );
  });

  it("finalize-hash conflict with a FAILED winner is reported, not silently skipped", async () => {
    // A material already owns the checksum but is itself FAILED — there is no good
    // surviving copy, so the new import must be surfaced as failed rather than
    // deferring to the dead row.
    await prisma.courseMaterial.create({
      data: {
        courseId,
        title: "Dead winner",
        mimeType: "text/plain",
        fileSize: 5,
        checksum: "race-checksum-failed-winner",
        status: "FAILED",
        uploadedBy: userId,
        externalSource: "canvas",
        externalId: "4301",
      },
    });
    vi.mocked(processUploadedFile).mockResolvedValue({
      title: "New.txt",
      mimeType: "text/plain",
      fileSize: 5,
      checksum: "race-checksum-failed-winner",
      content: "hello",
    });

    await expect(importFile(canvasFile(4302, "new.txt"))).rejects.toThrow();

    // The loser's own provisional row is marked FAILED, not left PROCESSING.
    expect(await prisma.courseMaterial.count({ where: { courseId, status: "PROCESSING" } })).toBe(
      0,
    );
    const loser = await prisma.courseMaterial.findFirst({
      where: { courseId, externalId: "4302" },
    });
    expect(loser?.status).toBe("FAILED");
  });

  it("provisional-create conflict with a FAILED owner is reported, not silently skipped", async () => {
    // The competing importer claims `canvas-pending:<id>` and then dies, so the
    // row that won the index is FAILED. Skipping here would report success while
    // the course ends up with no usable copy of the file, so this import must be
    // surfaced as failed instead. The winning row is created inside the race
    // window — after this import's `existing` pre-check, before its own create —
    // by hanging it off the download boundary, which is the only mock that sits
    // between the two.
    // Nothing resets mocks between tests here, so the "backed off before doing
    // any extraction work" assertion below needs a clean call log.
    vi.mocked(processUploadedFile).mockClear();
    vi.mocked(downloadCanvasFile).mockImplementationOnce(async () => {
      await prisma.courseMaterial.create({
        data: {
          courseId,
          title: "Dead provisional owner",
          mimeType: "text/plain",
          fileSize: 5,
          checksum: "canvas-pending:4401",
          status: "FAILED",
          uploadedBy: userId,
          externalSource: "canvas",
          externalId: "4401",
        },
      });
      return new Uint8Array(Buffer.from("hello"));
    });

    await expect(importFile(canvasFile(4401, "dead.txt"))).rejects.toThrow();

    // Only the dead owner remains, and nothing is stranded in PROCESSING.
    const rows = await prisma.courseMaterial.findMany({ where: { courseId, externalId: "4401" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("FAILED");
    expect(await prisma.courseMaterial.count({ where: { courseId, status: "PROCESSING" } })).toBe(
      0,
    );
    expect(processUploadedFile).not.toHaveBeenCalled();
  });
});
