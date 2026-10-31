import { useId, useState } from "react";
import { IconBook, IconChevronDown } from "@tabler/icons-react";
import { MarkdownStylesProvider, MessageContent } from "@eduai/ui";
import { normalizeMathMarkdown } from "@eduai/ui/math-markdown";
import { MARKDOWN_STYLES } from "~/lib/markdown-styles";
import { cn } from "~/lib/utils";
import "~/styles/chat-markdown.css";

type LessonReadingProps = {
  contentMd: string;
  /** Applied to the open panel, e.g. a max height for fixed-height layouts. */
  className?: string;
};

/** The lesson's full `contentMd`, rendered with the chat's Markdown renderer (#2026). */
export function LessonReading({ contentMd, className }: LessonReadingProps) {
  const [open, setOpen] = useState(true);
  const contentId = useId();

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-secondary/15 text-secondary">
            <IconBook className="size-3.5" aria-hidden="true" />
          </span>
          Reading
        </span>
        <IconChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={contentId}
          className={cn("overflow-y-auto border-t border-border px-4 py-3", className)}
        >
          <MarkdownStylesProvider value={MARKDOWN_STYLES}>
            <MessageContent markdown className="max-w-none bg-transparent p-0 text-foreground">
              {normalizeMathMarkdown(contentMd)}
            </MessageContent>
          </MarkdownStylesProvider>
        </div>
      )}
    </section>
  );
}
