import { useEffect, useState } from "react";
import { IconDotsVertical, IconX } from "@tabler/icons-react";
import {
  Button,
  COURSE_COLOR_PRESETS,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@eduai/ui";

import {
  normalizeCourseCardColor,
  type CourseCardPreference,
} from "~/lib/courses/course-card-preferences";

interface CourseCardCustomizePopoverProps {
  courseName: string;
  courseCode?: string;
  preference?: CourseCardPreference;
  onApply: (update: CourseCardPreference | null) => void;
}

export function CourseCardCustomizePopover({
  courseName,
  courseCode,
  preference,
  onApply,
}: CourseCardCustomizePopoverProps) {
  const [open, setOpen] = useState(false);
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const [draftNickname, setDraftNickname] = useState("");
  const [hexInput, setHexInput] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftColor(preference?.color ?? null);
    setDraftNickname(preference?.nickname ?? "");
    setHexInput(preference?.color ?? "");
  }, [open, preference?.color, preference?.nickname]);

  const handleApply = () => {
    const normalized = normalizeCourseCardColor(hexInput);
    const color = normalized ?? draftColor ?? undefined;
    const nickname = draftNickname.trim();

    if (!color && !nickname) {
      onApply(null);
    } else {
      onApply({
        ...(color ? { color } : {}),
        ...(nickname ? { nickname } : {}),
      });
    }
    setOpen(false);
  };

  const previewColor =
    normalizeCourseCardColor(hexInput) ?? draftColor ?? "oklch(0.56 0.20 255)";
  const previewTitle = draftNickname.trim() || courseName;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Customize ${courseName}`}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md",
            "text-white/90 hover:text-white hover:bg-white/20",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <IconDotsVertical size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(100vw-2rem,340px)] p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Course appearance</p>
          <button
            type="button"
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Live preview */}
          <div
            className="overflow-hidden rounded-lg border border-border shadow-sm"
            aria-hidden
          >
            <div
              className="px-3 py-2 text-xs font-bold text-white"
              style={{
                background: `linear-gradient(138deg, ${previewColor} 0%, color-mix(in oklch, ${previewColor} 65%, black) 100%)`,
              }}
            >
              {courseCode ?? "CODE"}
            </div>
            <div
              className="px-3 py-2 text-sm font-semibold text-foreground"
              style={{ background: `color-mix(in oklch, ${previewColor} 8%, var(--card))` }}
            >
              {previewTitle}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-nickname" className="text-xs text-muted-foreground">
              Nickname <span className="font-normal">(only you see this)</span>
            </Label>
            <Input
              id="course-nickname"
              value={draftNickname}
              placeholder={courseName}
              onChange={(event) => setDraftNickname(event.target.value)}
            />
          </div>

          <div>
            <p className="mb-2 text-xs text-muted-foreground">Colour</p>
            <div className="grid grid-cols-5 gap-2">
              {COURSE_COLOR_PRESETS.map((color) => {
                const selected = draftColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Colour ${color}`}
                    aria-pressed={selected}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 transition-transform hover:scale-105",
                      selected ? "border-foreground ring-2 ring-ring ring-offset-2" : "border-transparent",
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => {
                      setDraftColor(color);
                      setHexInput(color);
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="h-9 w-9 shrink-0 rounded-md border border-border"
              style={{ backgroundColor: previewColor }}
              aria-hidden
            />
            <Input
              value={hexInput}
              placeholder="oklch(0.56 0.20 255) or #1a76b8"
              aria-label="Custom colour"
              className="font-mono text-sm"
              onChange={(event) => {
                const value = event.target.value;
                setHexInput(value);
                const normalized = normalizeCourseCardColor(value);
                if (normalized) setDraftColor(normalized);
              }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
