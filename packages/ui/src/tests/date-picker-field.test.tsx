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

  /**
   * `aria-label` wins over a button's text content, so a static label left the
   * accessible name stuck on "Start date" no matter which date was showing —
   * a screen-reader user had no way to hear the current value (#1681 review).
   */
  describe("accessible name", () => {
    it("is just the label while nothing is chosen", () => {
      render(<DatePickerField value="" onChange={vi.fn()} label="Start date" />);

      expect(screen.getByRole("button", { name: "Start date" })).toBeInTheDocument();
    });

    it("carries the chosen date once one is set", () => {
      render(<DatePickerField value="2026-09-01" onChange={vi.fn()} label="Start date" />);

      expect(screen.getByRole("button", { name: "Start date: Sep 1, 2026" })).toBeInTheDocument();
    });

    it("follows the value when it changes", () => {
      const view = render(
        <DatePickerField value="2026-09-01" onChange={vi.fn()} label="Start date" />,
      );

      view.rerender(<DatePickerField value="2027-01-07" onChange={vi.fn()} label="Start date" />);

      expect(screen.getByRole("button", { name: "Start date: Jan 7, 2027" })).toBeInTheDocument();
    });
  });

  /**
   * react-day-picker treats the dropdown span as its navigation bound: months
   * outside it are hidden and keyboard focus is clamped to it. The old ±5-year
   * default therefore made any older or further-out date unpickable, even
   * though `CreateCourseSchema.startDate` accepts one (#1681 review).
   */
  describe("reachable range", () => {
    it("reaches a start date well outside a few sessions from now", () => {
      const onChange = vi.fn();
      render(<DatePickerField value="2005-06-15" onChange={onChange} label="Start date" />);
      openCalendar();

      pickDay(/June 1st, 2005/);

      expect(onChange).toHaveBeenCalledWith("2005-06-01");
    });

    it("keeps a value from outside the default window reachable", () => {
      // Far enough out that the ±yearRange window around today cannot contain
      // it; the range has to stretch to the value rather than hide it.
      const onChange = vi.fn();
      render(<DatePickerField value="1912-04-15" onChange={onChange} label="Start date" />);
      openCalendar();

      pickDay(/April 1st, 1912/);

      expect(onChange).toHaveBeenCalledWith("1912-04-01");
    });

    it("still honours an explicitly narrowed range from the caller", () => {
      render(<DatePickerField value="" onChange={vi.fn()} label="Start date" yearRange={0} />);
      openCalendar();

      const thisYear = new Date().getFullYear();
      expect(screen.queryByRole("button", { name: new RegExp(`, ${thisYear - 3}$`) })).toBeNull();
    });
  });
});
