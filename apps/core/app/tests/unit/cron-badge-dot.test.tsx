import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CronBadgeDot } from "~/components/layout/core-nav-model";

describe("CronBadgeDot", () => {
  it.each([
    ["red", "A cron job's last run failed"],
    ["orange", "A cron job is running"],
    ["green", "All cron jobs' last runs succeeded"],
  ] as const)("explains a %s dot in a tooltip", async (color, tip) => {
    render(<CronBadgeDot color={color} />);
    const dot = screen.getByRole("img", { name: `Cron status: ${color}` });
    act(() => dot.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(tip);
  });
});
