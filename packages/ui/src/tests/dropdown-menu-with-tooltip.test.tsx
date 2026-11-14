import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DropdownMenuWithTooltip } from "../dropdown-menu-with-tooltip";
import { DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";

function Menu() {
  return (
    <DropdownMenuWithTooltip
      tooltip="Report actions"
      trigger={
        <button type="button" aria-label="Actions for report 7">
          ⋯
        </button>
      }
    >
      <DropdownMenuContent>
        <DropdownMenuItem>Mark resolved</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuWithTooltip>
  );
}

const trigger = () => screen.getByRole("button", { name: "Actions for report 7" });

describe("DropdownMenuWithTooltip", () => {
  it("names the icon-only trigger with a tooltip, keeping its own accessible name", async () => {
    render(<Menu />);
    act(() => trigger().focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Report actions");
    expect(trigger()).toHaveAccessibleName("Actions for report 7");
  });

  it("opens the menu from the trigger and hides the tooltip while it is open", async () => {
    render(<Menu />);
    act(() => trigger().focus());
    await screen.findByRole("tooltip");

    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Mark resolved" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
