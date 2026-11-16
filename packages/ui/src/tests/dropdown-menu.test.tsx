/**
 * `DropdownMenuItem`: a disabled item is marked the way Radix marks it
 * (`data-disabled`, `aria-disabled`) and carries the styles keyed on that
 * marker, so hovering it shows the not-allowed cursor and it reads as dimmed.
 * (`:disabled` never matched: menu items are not form controls.) Radix still
 * runs a disabled item's `onClick`, so the wrapper drops it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

describe("DropdownMenuItem — disabled", () => {
  it("shows the not-allowed cursor and dims a disabled item", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem disabled>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Open menu" }), {
      button: 0,
      ctrlKey: false,
    });

    const disabled = screen.getByRole("menuitem", { name: "Delete" });
    expect(disabled).toHaveAttribute("data-disabled");
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled.className).toContain("data-[disabled]:cursor-not-allowed");
    expect(disabled.className).toContain("data-[disabled]:opacity-50");
    expect(screen.getByRole("menuitem", { name: "Edit" })).not.toHaveAttribute("data-disabled");
  });

  it("does not run onClick on a disabled item", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuItem disabled onClick={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Open menu" }), {
      button: 0,
      ctrlKey: false,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
