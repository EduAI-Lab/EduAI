/**
 * The export request carries the publish choice (#1556): the exported quiz is
 * published by default so Canvas lists it under Quizzes and Assignments, but an
 * explicit opt-out has to reach the backend as `published: false` — the backend
 * only holds the quiz back on an explicit false.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/api", () => ({
  default: { post: vi.fn() },
}));

import api from "../../services/api";
import canvasService from "../../services/canvasService";

const mockPost = vi.mocked(api.post);

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue({
    data: { data: { quizId: 7, canvasUrl: "u", questionsCreated: 2 } },
  });
});

describe("canvasService.exportAssessment", () => {
  it("sends published: false when the caller opts out", async () => {
    await canvasService.exportAssessment(5, 1, { published: false });

    expect(mockPost).toHaveBeenCalledWith("/api/canvas/export/5", {
      canvasCourseId: 1,
      published: false,
    });
  });

  it("sends published: true when the caller keeps the default", async () => {
    await canvasService.exportAssessment(5, 1, { published: true });

    expect(mockPost).toHaveBeenCalledWith("/api/canvas/export/5", {
      canvasCourseId: 1,
      published: true,
    });
  });
});
