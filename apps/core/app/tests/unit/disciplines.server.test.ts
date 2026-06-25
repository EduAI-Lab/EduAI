// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  discipline: { findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import {
  isValidDisciplineCode,
  areValidDisciplineCodes,
  searchDisciplines,
  listDisciplines,
  invalidateDisciplineCache,
} from "~/lib/disciplines/server";
import { auth } from "~/lib/auth/server";

const ROWS = [
  { code: "COSC", name: "Computer Science" },
  { code: "MATH", name: "Mathematics" },
  { code: "STAT", name: "Statistics" },
];

beforeEach(() => {
  vi.clearAllMocks();
  invalidateDisciplineCache();
  prismaMock.discipline.findMany.mockResolvedValue(ROWS);
});

describe("isValidDisciplineCode", () => {
  it("accepts a known code", async () => {
    expect(await isValidDisciplineCode("COSC")).toBe(true);
  });

  it("rejects an unknown code", async () => {
    expect(await isValidDisciplineCode("BASKET")).toBe(false);
  });

  it("is case-sensitive (no silent ghost units)", async () => {
    expect(await isValidDisciplineCode("cosc")).toBe(false);
  });

  it("caches the code set after the first read", async () => {
    await isValidDisciplineCode("COSC");
    await isValidDisciplineCode("MATH");
    expect(prismaMock.discipline.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("areValidDisciplineCodes", () => {
  it("returns true for an empty array", async () => {
    expect(await areValidDisciplineCodes([])).toBe(true);
  });

  it("returns true when all codes are known", async () => {
    expect(await areValidDisciplineCodes(["COSC", "MATH"])).toBe(true);
  });

  it("returns false when any code is unknown", async () => {
    expect(await areValidDisciplineCodes(["COSC", "NOPE"])).toBe(false);
  });
});

describe("listDisciplines", () => {
  it("401s without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as any);
    const res = await listDisciplines(new Request("http://localhost/api/disciplines"));
    expect(res.status).toBe(401);
  });

  it("returns the full list for a signed-in user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    const res = await listDisciplines(new Request("http://localhost/api/disciplines"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disciplines: ROWS });
  });
});

describe("searchDisciplines", () => {
  it("401s without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as any);
    const res = await searchDisciplines(
      new Request("http://localhost/api/disciplines/search?q=comp"),
      "comp",
    );
    expect(res.status).toBe(401);
  });

  it("queries by code/name when q is provided", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    prismaMock.discipline.findMany.mockResolvedValue([ROWS[0]]);
    const res = await searchDisciplines(
      new Request("http://localhost/api/disciplines/search?q=comp"),
      "comp",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disciplines: [ROWS[0]] });
    const arg = prismaMock.discipline.findMany.mock.calls.at(-1)?.[0];
    expect(arg.where.OR).toEqual([
      { code: { contains: "comp", mode: "insensitive" } },
      { name: { contains: "comp", mode: "insensitive" } },
    ]);
    expect(arg.take).toBe(50);
  });

  it("returns the unfiltered list when q is blank", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    const res = await searchDisciplines(
      new Request("http://localhost/api/disciplines/search?q="),
      "",
    );
    expect(res.status).toBe(200);
    const arg = prismaMock.discipline.findMany.mock.calls.at(-1)?.[0];
    expect(arg.where).toBeUndefined();
  });
});
