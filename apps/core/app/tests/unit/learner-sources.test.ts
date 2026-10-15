// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: { courseTopicSource: { findMany: vi.fn() } },
}));
vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessGate: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import {
  LEARNER_EXCERPT_FALLBACK_HEADER,
  learnerExcerptHeader,
  learnerTopicLabels,
  loadLearnerTopicsByMaterial,
  readerSeesMaterialFiles,
  toLearnerRagHits,
} from "~/lib/chat/learner-sources.server";

const HITS = [
  {
    content: "Lab 14 is due Nov 20.",
    similarity: 0.9,
    materialTitle: "L14.pdf",
    materialId: "m14",
  },
  { content: "Week 1 intro.", similarity: 0.6, materialTitle: "W1.pdf", materialId: "m1" },
  { content: "Hand-built hit.", similarity: 0.5, materialTitle: "secret.pdf" },
];
const TOPICS = new Map([
  ["m14", ["Data cleaning", "Labs"]],
  ["m1", ["Labs"]],
]);

beforeEach(() => vi.clearAllMocks());

describe("learner labels (#1963)", () => {
  it("lists each accepted topic once, in first-seen order", () => {
    expect(learnerTopicLabels(HITS, TOPICS)).toEqual(["Data cleaning", "Labs"]);
  });

  it("heads an excerpt with its topics, or a neutral label, never the file", () => {
    const header = learnerExcerptHeader(TOPICS);

    expect(header(HITS[0])).toBe("**Topics**: Data cleaning, Labs\n");
    expect(header(HITS[2])).toBe(LEARNER_EXCERPT_FALLBACK_HEADER);
    expect(HITS.map(header).join("")).not.toMatch(/\.pdf/);
  });

  it("turns tool hits into topic-labelled hits with no file title", () => {
    const learnerHits = toLearnerRagHits(HITS, TOPICS);

    expect(learnerHits[0]).toEqual({
      content: "Lab 14 is due Nov 20.",
      similarity: 0.9,
      topics: ["Data cleaning", "Labs"],
    });
    expect(learnerHits[2].topics).toEqual([]);
    expect(JSON.stringify(learnerHits)).not.toMatch(/\.pdf|materialTitle|materialId/);
  });
});

describe("loadLearnerTopicsByMaterial (#1963)", () => {
  it("asks only for accepted topics of the hits' materials in this course", async () => {
    vi.mocked(prisma.courseTopicSource.findMany).mockResolvedValue([
      { materialId: "m14", topic: { name: "Data cleaning" } },
      { materialId: "m14", topic: { name: "Labs" } },
    ] as never);

    const topics = await loadLearnerTopicsByMaterial("course-1", HITS);

    expect(topics.get("m14")).toEqual(["Data cleaning", "Labs"]);
    expect(prisma.courseTopicSource.findMany).toHaveBeenCalledWith({
      where: {
        materialId: { in: ["m14", "m1"] },
        topic: {
          courseId: "course-1",
          deletedAt: null,
          reviewStatus: "ACCEPTED",
          name: { not: "Uncategorized" },
        },
      },
      select: { materialId: true, topic: { select: { name: true } } },
      orderBy: { topic: { name: "asc" } },
    });
  });

  it("skips the query when no hit names a material", async () => {
    const topics = await loadLearnerTopicsByMaterial("course-1", [HITS[2]]);

    expect(topics.size).toBe(0);
    expect(prisma.courseTopicSource.findMany).not.toHaveBeenCalled();
  });

  it("returns no topics rather than failing the turn when the lookup throws", async () => {
    vi.mocked(prisma.courseTopicSource.findMany).mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const topics = await loadLearnerTopicsByMaterial("course-1", HITS);

    expect(topics.size).toBe(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("readerSeesMaterialFiles (#1963)", () => {
  const owned = (courseId: string | null) => ({ isOwner: true, chat: { courseId } });

  it("lets admins and staff overseeing someone else's chat see files without a lookup", async () => {
    expect(await readerSeesMaterialFiles({ id: "a", role: "ADMIN" }, owned("c1"))).toBe(true);
    expect(
      await readerSeesMaterialFiles(
        { id: "i", role: "INSTRUCTOR" },
        { isOwner: false, chat: { courseId: "c1" } },
      ),
    ).toBe(true);
    expect(resolveCourseAccessGate).not.toHaveBeenCalled();
  });

  it("hides files from an owner who is a student in the chat's course", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "student", rank: 0 },
    } as never);

    expect(await readerSeesMaterialFiles({ id: "s", role: "STUDENT" }, owned("c1"))).toBe(false);
  });

  it("shows files to an owner who is staff in the chat's course (a TA's own chat)", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" },
      access: { level: "ta", rank: 1 },
    } as never);

    expect(await readerSeesMaterialFiles({ id: "t", role: "STUDENT" }, owned("c1"))).toBe(true);
  });

  it("hides files from an owner who has lost course access", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" },
      access: null,
    } as never);

    expect(await readerSeesMaterialFiles({ id: "s", role: "STUDENT" }, owned("c1"))).toBe(false);
  });
});
