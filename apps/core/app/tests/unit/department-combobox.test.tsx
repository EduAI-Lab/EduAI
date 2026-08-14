/**
 * Unit tests for DepartmentCombobox — a thin adapter mapping
 * `{ code, label }` departments onto the shared `Combobox`'s option shape,
 * and guarding against forwarding a `null` clear-selection value upward.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DepartmentCombobox } from "~/components/courses/department-combobox";

const departments = [
  { code: "CS", label: "Computer Science" },
  { code: "MATH", label: "Mathematics" },
];

describe("DepartmentCombobox", () => {
  it("shows the placeholder when no department is selected", () => {
    render(
      <DepartmentCombobox departments={departments} value="" onValueChange={vi.fn()} />,
    );
    expect(screen.getByText("Select course code")).toBeInTheDocument();
  });

  it("maps each department onto a combobox option with a code description", () => {
    render(
      <DepartmentCombobox departments={departments} value="" onValueChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("(CS)")).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("(MATH)")).toBeInTheDocument();
  });

  it("reports the selected department's code upward", () => {
    const onValueChange = vi.fn();
    render(
      <DepartmentCombobox departments={departments} value="" onValueChange={onValueChange} />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Mathematics"));

    expect(onValueChange).toHaveBeenCalledWith("MATH");
  });

  it("does not forward a null value when clearing the current selection", () => {
    const onValueChange = vi.fn();
    render(
      <DepartmentCombobox departments={departments} value="CS" onValueChange={onValueChange} />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    // Clicking the already-selected option would deselect it (value -> null).
    fireEvent.mouseDown(screen.getByRole("option", { name: /Computer Science/ }));

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("shows the empty-state text when there are no departments", () => {
    render(<DepartmentCombobox departments={[]} value="" onValueChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("No course code found.")).toBeInTheDocument();
  });

  it("passes disabled and a custom placeholder through", () => {
    render(
      <DepartmentCombobox
        departments={departments}
        value=""
        onValueChange={vi.fn()}
        disabled
        placeholder="Pick a department"
      />,
    );
    expect(screen.getByText("Pick a department")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
