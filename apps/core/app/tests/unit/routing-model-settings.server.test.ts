// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  systemConfig: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  getRoutingModelSettings,
  invalidateRoutingModelSettingsCache,
  setRoutingModelSetting,
} from "~/lib/routing-model-settings.server";

describe("routing-model-settings.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRoutingModelSettingsCache();
  });

  it("defaults Auto on and Auto (rules) off", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([]);

    await expect(getRoutingModelSettings()).resolves.toEqual({
      autoLlmEnabled: true,
      autoRulesEnabled: false,
    });
  });

  it("applies persisted admin overrides", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "routing.model.autoLlmEnabled", value: "false" },
      { key: "routing.model.autoRulesEnabled", value: "true" },
    ]);

    await expect(getRoutingModelSettings()).resolves.toEqual({
      autoLlmEnabled: false,
      autoRulesEnabled: true,
    });
  });

  it("persists a setting and invalidates the read cache", async () => {
    prismaMock.systemConfig.findMany.mockResolvedValue([]);
    await getRoutingModelSettings();

    prismaMock.systemConfig.upsert.mockResolvedValue({});
    await setRoutingModelSetting("autoRulesEnabled", true, "admin-1");

    expect(prismaMock.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "routing.model.autoRulesEnabled" },
        update: { value: "true", updatedBy: "admin-1" },
      }),
    );

    prismaMock.systemConfig.findMany.mockResolvedValue([
      { key: "routing.model.autoRulesEnabled", value: "true" },
    ]);
    expect((await getRoutingModelSettings()).autoRulesEnabled).toBe(true);
    expect(prismaMock.systemConfig.findMany).toHaveBeenCalledTimes(2);
  });
});
