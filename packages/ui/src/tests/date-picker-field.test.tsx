import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DatePickerField } from "../ui/date-picker-field";

function openCalendar() {
  fireEvent.click(screen.getByRole("button", { name: /start date/i }));
}

/** Clicks a day by its full accessible name, e.g. "Tuesday, September 1st, 2026". */
function pickDay(fullDate: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: fullDate }));
}

describe("DatePickerField", () => {
  it("shows the placeholder when no date is chosen", () => {
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);

    expect(screen.getByRole("button", { name: /start date/i })).toHaveTextContent("Pick a date");
  });

  it("shows the chosen date in a readable form", () => {
    render(<DatePickerField value="2026-09-01" onChange={vi.fn()} label="Start date" />);

    expect(screen.getByRole("button", { name: /start date/i })).toHaveTextContent("Sep 1, 2026");
  });

  it("opens the themed calendar on click", () => {
    render(<DatePickerField value="2026-09-01" onChange={vi.fn()} label="Start date" />);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();

    openCalendar();

    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("reports the picked day as a YYYY-MM-DD string with no timezone drift", () => {
    const onChange = vi.fn();
    render(<DatePickerField value="2026-09-15" onChange={onChange} label="Start date" />);
    openCalendar();

    pickDay(/September 1st, 2026/);

    // Sep 1 must not come back as 2026-08-31 the way toISOString() would render it.
    expect(onChange).toHaveBeenCalledWith("2026-09-01");
  });

  it("closes the calendar once a day is picked", () => {
    render(<DatePickerField value="2026-09-15" onChange={vi.fn()} label="Start date" />);
    openCalendar();

    pickDay(/September 1st, 2026/);

    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("opens on the current month when no date is chosen yet", () => {
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);

    openCalendar();

    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("cannot be opened when disabled", () => {
    render(<DatePickerField value="" onChange={vi.fn()} label="Start date" disabled />);

    expect(screen.getByRole("button", { name: /start date/i })).toBeDisabled();
  });
});
