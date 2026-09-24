/**
 * Unit tests for the shared `daysAgoLabel` helper (task 15 fix round 1),
 * extracted from `SettingsPage.tsx` / `useAiServicesStatus.ts` where it was
 * previously duplicated verbatim.
 */
import { describe, expect, it } from "vitest";
import { daysAgoLabel } from "@/utils/relativeTime";

describe("daysAgoLabel", () => {
  it("renders a timestamp from earlier today as 'today'", () => {
    expect(daysAgoLabel(new Date().toISOString())).toBe("today");
  });

  it("renders exactly one day ago as '1 day ago'", () => {
    const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(daysAgoLabel(oneDayAgo)).toBe("1 day ago");
  });

  it("renders several days ago as 'N days ago'", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    expect(daysAgoLabel(threeDaysAgo)).toBe("3 days ago");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(daysAgoLabel("not-a-date")).toBe("");
  });
});
