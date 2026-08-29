import * as React from "react";
import { IconCalendarEvent } from "@tabler/icons-react";

import { cn } from "../utils";
import { formatDateInputValue, parseDateInputValue } from "../lib/date-input";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface DatePickerFieldProps {
  /** The field value as `YYYY-MM-DD`, or "" when nothing is chosen yet. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Names the field for assistive tech. The trigger is a button, not an
   * `<input>`, so a neighbouring `<Label htmlFor>` cannot name it — the label
   * text is passed in and applied as the accessible name instead.
   */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * How many years either side of today the month/year dropdowns reach.
   *
   * The dropdown caption needs an explicit span — without one react-day-picker
   * offers only the visible month's year — but that same span is its
   * *navigation* bound: months outside it are hidden and keyboard focus is
   * clamped to it, so anything it excludes cannot be picked at all. The
   * default is therefore wide enough not to narrow what callers already
   * accept (`CreateCourseSchema.startDate` takes any date), and the range is
   * always widened to include a value that is already set. This is a
   * navigation convenience, not validation: a real limit belongs in the
   * schema, where every caller is held to it rather than only this one form.
   */
  yearRange?: number;
}

const DISPLAY_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/**
 * A date field that opens the app's own themed calendar rather than the
 * browser's native date popup, whose chrome is the OS's and ignores the site
 * theme entirely.
 *
 * The value stays the `YYYY-MM-DD` string an `<input type="date">` would
 * produce, so callers that derive from it — course term derivation, form
 * payloads — are unaffected by the swap.
 */
export function DatePickerField({
  value,
  onChange,
  label,
  placeholder = "Pick a date",
  disabled,
  className,
  yearRange = 50,
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseDateInputValue(value);

  const thisYear = new Date().getFullYear();
  // A value set elsewhere (or by an older, wider form) must stay reachable
  // even if it falls outside the default window — otherwise opening the
  // picker on it would hide the very date it is showing.
  const selectedYear = selected?.getFullYear();
  const firstYear = Math.min(thisYear - yearRange, selectedYear ?? Number.POSITIVE_INFINITY);
  const lastYear = Math.max(thisYear + yearRange, selectedYear ?? Number.NEGATIVE_INFINITY);
  const startMonth = new Date(firstYear, 0);
  const endMonth = new Date(lastYear, 11);

  const formatted = selected ? selected.toLocaleDateString(undefined, DISPLAY_FORMAT) : null;

  const handleSelect = (date: Date | undefined) => {
    if (!date) return;
    onChange(formatDateInputValue(date));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          // `aria-label` wins over the button's text, so the chosen date has
          // to be part of it — naming the trigger "Start date" alone left a
          // screen-reader user with no way to hear which date is selected.
          aria-label={formatted ? `${label}: ${formatted}` : label}
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <IconCalendarEvent className="size-4 shrink-0" />
          {formatted ?? placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected ?? undefined}
          onSelect={handleSelect}
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          // Opens on the chosen date's month, or the current one when unset.
          defaultMonth={selected ?? undefined}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
