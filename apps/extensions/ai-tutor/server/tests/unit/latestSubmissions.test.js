import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: { submission: { findMany: (...args) => findMany(...args) } },
}));

const { getLatestSubmissions } = await import("../../src/services/progressCalculation.js");

beforeEach(() => {
  findMany.mockReset();
});

describe("getLatestSubmissions (#2030)", () => {
  it("only queries the requesting user's submissions for the given activities", async () => {
    findMany.mockResolvedValue([]);

    await getLatestSubmissions([1, 2], "student-a");

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      userId: "student-a",
      activityId: { in: [1, 2] },
    });
  });

  it("keeps the highest attempt per activity regardless of row order", async () => {
    findMany.mockResolvedValue([
      { activityId: 1, attemptNumber: 2, isCorrect: false, response: { answerOption: 1 } },
      { activityId: 1, attemptNumber: 3, isCorrect: true, response: { answerOption: 0 } },
      { activityId: 1, attemptNumber: 1, isCorrect: true, response: { answerOption: 0 } },
      { activityId: 2, attemptNumber: 1, isCorrect: null, response: { answerText: "hi" } },
    ]);

    const latest = await getLatestSubmissions([1, 2], "student-a");

    expect(latest.get(1)).toMatchObject({ attemptNumber: 3, isCorrect: true });
    expect(latest.get(2)).toMatchObject({ attemptNumber: 1, isCorrect: null });
  });

  it("returns an empty map without querying when there is no user or no activities", async () => {
    expect((await getLatestSubmissions([], "student-a")).size).toBe(0);
    expect((await getLatestSubmissions([1], undefined)).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
