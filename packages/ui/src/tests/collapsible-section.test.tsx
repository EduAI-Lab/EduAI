import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { CollapsibleSection } from "../collapsible-section";

const KEY = "test.collapsible";

function renderSection() {
  return render(
    <CollapsibleSection title="At a glance" storageKey={KEY}>
      <p>Charts</p>
    </CollapsibleSection>,
  );
}

describe("CollapsibleSection", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts expanded, collapses, saves, and expands again", () => {
    renderSection();
    expect(screen.getByText("Charts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("Charts")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Charts")).toBeInTheDocument();
  });

  it("starts collapsed when the saved state says so", () => {
    window.localStorage.setItem(KEY, "true");
    renderSection();
    expect(screen.queryByText("Charts")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("only points aria-controls at the body while the body is mounted", () => {
    renderSection();
    const button = screen.getByRole("button", { name: "Collapse" });
    expect(button).toHaveAttribute("aria-controls", screen.getByText("Charts").parentElement!.id);

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Expand" })).not.toHaveAttribute("aria-controls");
  });
});
