// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  systemConfig: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  getBedrockOverflowSettings,
  invalidateBedrockOverflowSettingsCache,
  setBedrockOverflowSettings,
} from "~/lib/ai/routing/bedrock/bedrock-settings.server";
import { defaultBedrockOverflowSettings } from "~/lib/ai/routing/bedrock/bedrock-settings";

describe("bedrock-settings.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateBedrockOverflowSettingsCache();
  });

  it("defaults AWS overflow off with every cap at 0", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([]);

    await expect(getBedrockOverflowSettings()).resolves.toEqual(
      defaultBedrockOverflowSettings(),
    );
  });

  it("applies persisted admin overrides", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "bedrock.overflow.enabled", value: "true" },
      { key: "bedrock.overflow.dailyUserLimit", value: "5" },
      { key: "bedrock.overflow.monthlyUserLimit", value: "40" },
      { key: "bedrock.overflow.globalLimit", value: "200" },
      { key: "bedrock.overflow.resourceLimit", value: "3" },
    ]);

    await expect(getBedrockOverflowSettings()).resolves.toEqual({
      enabled: true,
      dailyUserLimit: 5,
      monthlyUserLimit: 40,
      globalLimit: 200,
      resourceLimit: 3,
    });
  });

  it("persists settings and invalidates the read cache", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    await getBedrockOverflowSettings();

    prismaMock.systemConfig.upsert.mockResolvedValue({});
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "bedrock.overflow.enabled", value: "true" },
      { key: "bedrock.overflow.resourceLimit", value: "8" },
    ]);

    const saved = await setBedrockOverflowSettings(
      {
        enabled: true,
        dailyUserLimit: 0,
        monthlyUserLimit: 0,
        globalLimit: 0,
        resourceLimit: 8,
      },
      "admin-1",
    );

    expect(prismaMock.systemConfig.upsert).toHaveBeenCalledTimes(5);
    expect(prismaMock.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "bedrock.overflow.enabled" },
        update: { value: "true", updatedBy: "admin-1" },
      }),
    );
    expect(saved).toEqual({
      enabled: true,
      dailyUserLimit: 0,
      monthlyUserLimit: 0,
      globalLimit: 0,
      resourceLimit: 8,
    });
    expect(prismaMock.systemConfig.findMany).toHaveBeenCalledTimes(2);
  });
});
