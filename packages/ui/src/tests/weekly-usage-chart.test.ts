import { describe, expect, it } from "vitest";

import { resolveSeries } from "../charts/weekly-usage-chart";

describe("WeeklyUsageChart resolveSeries", () => {
  it("draws the single count line under the given label", () => {
    expect(resolveSeries({ data: [], seriesLabel: "AI chats" })).toEqual([
      { key: "count", label: "AI chats", color: "var(--primary)" },
    ]);
  });

  it("gives the first series the primary colour and later ones the series palette", () => {
    const lines = resolveSeries({
      data: [],
      series: [
        { key: "ai", label: "AI-generated" },
        { key: "manual", label: "Written by hand" },
      ],
    });
    expect(lines.map((line) => line.color)).toEqual(["var(--primary)", "var(--color-series-2)"]);
  });

  it("keeps a colour the caller chose", () => {
    const [line] = resolveSeries({
      data: [],
      series: [{ key: "ai", label: "AI", color: "red" }],
    });
    expect(line.color).toBe("red");
  });
});
