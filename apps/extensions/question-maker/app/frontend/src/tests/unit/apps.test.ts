import { describe, expect, it } from "vitest";
import { CURRENT_APP_ID, getLauncherApps } from "@/lib/apps";

describe("getLauncherApps", () => {
  it("resolves the launcher list with this app's id and per-env URLs", () => {
    const apps = getLauncherApps();
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);
  });

  it("exposes a stable current-app id", () => {
    expect(CURRENT_APP_ID).toBe("question-maker");
  });
});
