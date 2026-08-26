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
   * A course start date is always within a few sessions of now.
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
  yearRange = 5,
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseDateInputValue(value);

  // The dropdown caption needs an explicit range; without one it offers only
  // the visible month's year, which cannot reach a future session.
  const thisYear = new Date().getFullYear();
  const startMonth = new Date(thisYear - yearRange, 0);
  const endMonth = new Date(thisYear + yearRange, 11);

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
          aria-label={label}
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <IconCalendarEvent className="size-4 shrink-0" />
          {selected ? selected.toLocaleDateString(undefined, DISPLAY_FORMAT) : placeholder}
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
