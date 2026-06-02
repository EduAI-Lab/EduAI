// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    userPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import {
  getUserPreference,
  saveUserPreference,
  clearUserPreference,
} from "~/lib/user-preferences.server";

const db = prisma as unknown as {
  userPreference: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserPreference (restore on load)", () => {
  it("returns defaults (off / no course) when the user has no stored preference", async () => {
    db.userPreference.findUnique.mockResolvedValue(null);
    await expect(getUserPreference("u1")).resolves.toEqual({
      assistDefault: false,
      lastCourseCode: null,
    });
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("restores the stored toggle + course from a previous session", async () => {
    db.userPreference.findUnique.mockResolvedValue({
      assistDefault: true,
      lastCourseCode: "COSC 121",
    });
    await expect(getUserPreference("u1")).resolves.toEqual({
      assistDefault: true,
      lastCourseCode: "COSC 121",
    });
  });
});

describe("saveUserPreference (persist on change)", () => {
  it("upserts scoped to the user's id and returns the stored values", async () => {
    db.userPreference.upsert.mockResolvedValue({
      assistDefault: true,
      lastCourseCode: "MATH 100",
    });

    const result = await saveUserPreference("u1", {
      assistDefault: true,
      lastCourseCode: "MATH 100",
    });

    expect(db.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", assistDefault: true, lastCourseCode: "MATH 100" },
      update: { assistDefault: true, lastCourseCode: "MATH 100" },
    });
    expect(result).toEqual({ assistDefault: true, lastCourseCode: "MATH 100" });
  });
});

describe("clearUserPreference (reset on logout)", () => {
  it("deletes the user's preference row so the next login starts fresh", async () => {
    db.userPreference.deleteMany.mockResolvedValue({ count: 1 });
    await clearUserPreference("u1");
    expect(db.userPreference.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});
