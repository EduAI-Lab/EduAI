import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "../segmented-control";

describe("SegmentedControl", () => {
  it("renders options and selects on click", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="all"
        onValueChange={onChange}
        options={[
          { value: "all", label: "All" },
          { value: "t1", label: "Term 1" },
        ]}
        ariaLabel="Filter"
      />,
    );

    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Term 1" }));
    expect(onChange).toHaveBeenCalledWith("t1");
  });
});
