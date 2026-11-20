/**
 * Page chrome for the Question Composer: sticky header (back arrow, title, course code),
 * page padding, and a sticky footer bar. The footer is either the default Cancel/Save pair
 * (`onSave`) or custom content (`footer`), as used by the create/variant wizard.
 */
import type { ReactNode } from "react";
import { Button } from "@eduai/ui";
import { IconArrowLeft, IconCornerDownLeft, IconDeviceFloppy } from "@tabler/icons-react";

interface ComposerShellProps {
  title: string;
  courseCode?: string;
  children: ReactNode;
  onCancel: () => void;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  /** Custom footer content; replaces the default Cancel/Save buttons. */
  footer?: ReactNode;
}

export function ComposerShell({
  title,
  courseCode,
  children,
  onCancel,
  onSave,
  saving,
  saveLabel = "Save",
  footer,
}: ComposerShellProps) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 lg:px-6">
      <div className="sticky top-[var(--header-height)] z-10 -mx-4 mb-6 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel">
            <IconArrowLeft className="size-5" />
          </Button>
          <h1 className="truncate text-base font-semibold text-foreground">
            {title}
            {courseCode && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">{courseCode}</span>
            )}
          </h1>
        </div>
      </div>
      {children}
      {footer ? (
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          {footer}
        </div>
      ) : (
        onSave && (
          <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving} className="gap-1.5">
              <IconDeviceFloppy className="size-4" />
              {saving ? "Saving…" : saveLabel}
              <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-primary-foreground/30 px-1 text-[10px] sm:inline-flex">
                <IconCornerDownLeft className="size-3" />
              </kbd>
            </Button>
          </div>
        )
      )}
    </div>
  );
}
