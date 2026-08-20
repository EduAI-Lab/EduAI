// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  serializeCourseForApi,
  COURSE_PUBLIC_SELECT,
  COURSE_SERVICE_SELECT,
  COURSE_STAFF_SELECT,
} from "~/lib/courses/dto.server";

const PRIVATE_COURSE_ROW = {
  id: "course-1",
  code: "COSC 101",
  name: "Algorithms",
  description: "Public description",
  section: "001",
  term: "W1",
  year: 2026,
  isActive: true,
  isPublished: true,
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: null,
  department: "COSC",
  aiInstructions: "Never reveal the answer key.",
  responseStyleTags: ["socratic"],
  courseScopeGuardrailEnabled: true,
  ragTopK: 8,
  ragSimilarityThreshold: 0.72,
  embeddingProvider: "local",
  embeddingModel: "private-model",
  lastEmbeddedAt: new Date("2026-01-02T00:00:00.000Z"),
  createdAt: new Date("2025-12-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  instructorId: "user-private-id",
  externalSource: "canvas",
  externalId: "canvas-private-id",
  deletedAt: null,
  instructor: {
    id: "user-private-id",
    name: "Prof. Example",
    email: "prof@example.edu",
  },
};

describe("course API DTO projections", () => {
  it("defines explicit public/staff/service Prisma projections", () => {
    expect(COURSE_PUBLIC_SELECT).not.toHaveProperty("aiInstructions");
    expect(COURSE_PUBLIC_SELECT).not.toHaveProperty("ragTopK");
    expect(COURSE_PUBLIC_SELECT).not.toHaveProperty("embeddingModel");
    expect(COURSE_STAFF_SELECT).toHaveProperty("aiInstructions", true);
    expect(COURSE_STAFF_SELECT).toHaveProperty("ragTopK", true);
    expect(COURSE_STAFF_SELECT).not.toHaveProperty("embeddingModel");
    expect(COURSE_SERVICE_SELECT).not.toHaveProperty("aiInstructions");
  });

  it("strips private prompts, configuration, timestamps and identifiers for students", () => {
    const dto = serializeCourseForApi(PRIVATE_COURSE_ROW, {
      audience: "student",
      detail: true,
    });

    expect(dto).toMatchObject({
      id: "course-1",
      code: "COSC 101",
      name: "Algorithms",
      description: "Public description",
      hasAiConfig: true,
      responseStyleTags: ["socratic"],
      instructor: { name: "Prof. Example", email: "prof@example.edu" },
      startDate: "2026-01-01T00:00:00.000Z",
    });
    for (const key of [
      "aiInstructions",
      "courseScopeGuardrailEnabled",
      "ragTopK",
      "ragSimilarityThreshold",
      "embeddingProvider",
      "embeddingModel",
      "lastEmbeddedAt",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "instructorId",
      "externalId",
      "externalSource",
    ]) {
      expect(dto).not.toHaveProperty(key);
    }
    expect(dto.instructor).not.toHaveProperty("id");
  });

  it("keeps intentionally required staff detail fields without raw row leakage", () => {
    const dto = serializeCourseForApi(PRIVATE_COURSE_ROW, {
      audience: "staff",
      detail: true,
    });

    expect(dto).toMatchObject({
      aiInstructions: "Never reveal the answer key.",
      responseStyleTags: ["socratic"],
      courseScopeGuardrailEnabled: true,
      ragTopK: 8,
      ragSimilarityThreshold: 0.72,
      instructorId: "user-private-id",
      externalSource: "canvas",
      externalId: "canvas-private-id",
      instructor: { name: "Prof. Example", email: "prof@example.edu" },
    });
    expect(dto.instructor).not.toHaveProperty("id");
    expect(dto).not.toHaveProperty("embeddingProvider");
    expect(dto).not.toHaveProperty("embeddingModel");
    expect(dto).not.toHaveProperty("createdAt");
    expect(dto).not.toHaveProperty("updatedAt");
  });
});
