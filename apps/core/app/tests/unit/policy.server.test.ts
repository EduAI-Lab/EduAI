// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  systemConfig: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

import {
  getPolicies,
  getPolicy,
  setPolicy,
  invalidatePolicyCache,
  isPolicyKey,
  getPolicyDefinitions,
  POLICY_FLAGS,
} from "~/lib/policy.server";

const FLAG = "instructors.canCreateCourses";

describe("policy.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePolicyCache();
  });

  it("returns code defaults when no overrides are persisted", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    const policies = await getPolicies();
    expect(policies[FLAG]).toBe(POLICY_FLAGS[FLAG].default);
  });

  it("applies a persisted override over the default", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: `policy.${FLAG}`, value: "false" },
    ]);
    expect(await getPolicy(FLAG)).toBe(false);
  });

  it("ignores unknown/legacy SystemConfig rows", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "policy.somethingRemoved", value: "true" },
    ]);
    const policies = await getPolicies();
    const allDefaults = Object.fromEntries(
      Object.entries(POLICY_FLAGS).map(([key, def]) => [key, def.default]),
    );
    expect(policies).toEqual(allDefaults);
  });

  it("caches reads — a second call within the TTL does not re-query", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    await getPolicies();
    await getPolicies();
    expect(prismaMock.systemConfig.findMany).toHaveBeenCalledTimes(1);
  });

  it("setPolicy upserts under the policy.<key> prefix and invalidates the cache", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    await getPolicies(); // warm cache (1 query)

    prismaMock.systemConfig.upsert.mockResolvedValue({});
    await setPolicy(FLAG, false, "admin-1");

    expect(prismaMock.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: `policy.${FLAG}` },
        update: { value: "false", updatedBy: "admin-1" },
      }),
    );

    // Cache was invalidated, so the next read re-queries.
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: `policy.${FLAG}`, value: "false" },
    ]);
    expect(await getPolicy(FLAG)).toBe(false);
    expect(prismaMock.systemConfig.findMany).toHaveBeenCalledTimes(2);
  });

  it("registers unitAdmins.canInvite defaulting to false (opt-in)", async () => {
    expect(POLICY_FLAGS["unitAdmins.canInvite"].default).toBe(false);
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    expect(await getPolicy("unitAdmins.canInvite")).toBe(false);
  });

  it("isPolicyKey guards unknown keys", () => {
    expect(isPolicyKey(FLAG)).toBe(true);
    expect(isPolicyKey("nope")).toBe(false);
  });

  it("exposes definitions for the admin UI", () => {
    const defs = getPolicyDefinitions();
    expect(defs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: FLAG, label: expect.any(String) }),
      ]),
    );
  });
});
