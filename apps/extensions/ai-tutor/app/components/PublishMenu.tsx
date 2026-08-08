import {
  IconArrowsSort,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconWorldOff,
  IconWorldUpload,
} from '@tabler/icons-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@eduai/ui';
import { cn } from '~/lib/utils';

type PublishMenuProps = {
  isPublished: boolean;
  pending?: boolean;
  /** When set, the toggle item is disabled and the reason is shown in the menu. */
  blockedReason?: string | null;
  /** Publish/unpublish handler. Omit to hide the publish item (e.g. can edit but not publish). */
  onToggle?: () => void;
  /** Edit handler. When set, renders an "Edit {itemLabel}" item. */
  onEdit?: () => void;
  /** Delete handler. When set, renders a destructive "Delete {itemLabel}" item. */
  onDelete?: () => void;
  /**
   * Move handler (#1207). When set, renders a "Move {itemLabel}…" item that
   * opens the move-to-position prompt. This is the only way to move a row to a
   * different page — drag-and-drop can only express a move among the rows
   * currently on screen.
   */
  onMove?: () => void;
  /** Noun for the menu copy, e.g. "module" / "lesson". */
  itemLabel?: string;
  className?: string;
};

/**
 * Compact three-dot menu carrying the per-item content actions — publish
 * toggle, edit, and delete — mirroring the Core course-card kebab convention
 * (publish → edit → separator → destructive delete). The card shows the
 * current publish state as a read-only `StatusBadge`; this menu carries the
 * *actions* (and, when the publish cascade blocks it, the reason) — so state
 * and action stay separate instead of a one-off toggle button.
 *
 * Each action is optional: pass only the handlers the current user is allowed
 * to perform (publish is gated separately from edit/delete). The menu renders
 * only the items whose handler is supplied.
 */
export function PublishMenu({
  isPublished,
  pending = false,
  blockedReason,
  onToggle,
  onEdit,
  onDelete,
  onMove,
  itemLabel = 'item',
  className,
}: PublishMenuProps) {
  const blocked = Boolean(blockedReason);
  const showPublish = Boolean(onToggle);
  const showEdit = Boolean(onEdit);
  const showDelete = Boolean(onDelete);
  const showMove = Boolean(onMove);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="More options"
          className={cn('size-8 text-muted-foreground hover:text-foreground', className)}
        >
          <IconDotsVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {showPublish && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {isPublished ? 'Visible to students' : 'Hidden from students'}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={blocked || pending}
              onSelect={() => {
                if (!blocked && !pending) onToggle?.();
              }}
            >
              {isPublished ? (
                <IconWorldOff className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <IconWorldUpload className="size-4 text-primary-text" aria-hidden="true" />
              )}
              {pending ? 'Saving…' : isPublished ? `Unpublish ${itemLabel}` : `Publish ${itemLabel}`}
            </DropdownMenuItem>
            {blocked && (
              <p className="px-2 pb-1 pt-0.5 text-xs leading-snug text-muted-foreground">
                {blockedReason}
              </p>
            )}
          </>
        )}
        {showEdit && (
          <DropdownMenuItem onSelect={() => onEdit?.()}>
            <IconEdit className="size-4 text-muted-foreground" aria-hidden="true" />
            Edit {itemLabel}
          </DropdownMenuItem>
        )}
        {showMove && (
          <DropdownMenuItem onSelect={() => onMove?.()}>
            <IconArrowsSort className="size-4 text-muted-foreground" aria-hidden="true" />
            Move {itemLabel}…
          </DropdownMenuItem>
        )}
        {(showPublish || showEdit || showMove) && showDelete && <DropdownMenuSeparator />}
        {showDelete && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete?.()}
          >
            <IconTrash className="size-4" aria-hidden="true" />
            Delete {itemLabel}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
