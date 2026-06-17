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

const fullRow = {
  assistDefault: true,
  lastCourseCode: "COSC 121",
  motionReduced: true,
  density: "compact",
  theme: "dark",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserPreference (restore on load)", () => {
  it("returns defaults (off / no course) when the user has no stored preference", async () => {
    db.userPreference.findUnique.mockResolvedValue(null);
    await expect(getUserPreference("u1", [])).resolves.toEqual({
      assistDefault: false,
      lastCourseCode: null,
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("restores the stored toggle + course from a previous session", async () => {
    db.userPreference.findUnique.mockResolvedValue(fullRow);
    await expect(getUserPreference("u1", ["COSC 121"])).resolves.toEqual(fullRow);
  });

  it("clears a stale stored course and returns null when it is no longer available", async () => {
    db.userPreference.findUnique.mockResolvedValue({
      ...fullRow,
      lastCourseCode: "BIOL 200",
    });
    db.userPreference.upsert.mockResolvedValue({
      ...fullRow,
      lastCourseCode: null,
    });

    await expect(getUserPreference("u1", ["COSC 121", "MATH 100"])).resolves.toEqual({
      ...fullRow,
      lastCourseCode: null,
    });
    expect(db.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", lastCourseCode: null },
      update: { lastCourseCode: null },
    });
  });

  it("keeps a stored course when it is still in the available list", async () => {
    db.userPreference.findUnique.mockResolvedValue({
      assistDefault: false,
      lastCourseCode: "MATH 100",
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });

    await expect(getUserPreference("u1", ["COSC 121", "MATH 100"])).resolves.toEqual({
      assistDefault: false,
      lastCourseCode: "MATH 100",
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
    expect(db.userPreference.upsert).not.toHaveBeenCalled();
  });
});

describe("saveUserPreference (persist on change)", () => {
  it("upserts scoped to the user's id and returns the stored values", async () => {
    db.userPreference.upsert.mockResolvedValue(fullRow);

    const result = await saveUserPreference("u1", {
      assistDefault: true,
      lastCourseCode: "MATH 100",
      motionReduced: true,
      density: "compact",
      theme: "dark",
    });

    expect(db.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: {
        userId: "u1",
        assistDefault: true,
        lastCourseCode: "MATH 100",
        motionReduced: true,
        density: "compact",
        theme: "dark",
      },
      update: {
        assistDefault: true,
        lastCourseCode: "MATH 100",
        motionReduced: true,
        density: "compact",
        theme: "dark",
      },
    });
    expect(result).toEqual(fullRow);
  });
});

describe("clearUserPreference (reset on logout)", () => {
  it("deletes the user's preference row so the next login starts fresh", async () => {
    db.userPreference.deleteMany.mockResolvedValue({ count: 1 });
    await clearUserPreference("u1");
    expect(db.userPreference.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});
