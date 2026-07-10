import type { MouseEvent } from 'react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@eduai/ui';
import { cn } from '~/lib/utils';

type PublishStatusButtonProps = {
  isPublished: boolean;
  pending?: boolean;
  blockedReason?: string | null;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
};

/**
 * DS `Button` recolored with the same success/muted tokens `StatusBadge`
 * uses, so "Published" reads consistently with the rest of the app instead
 * of one-off emerald/gray hex values. Stays a real `Button` (not a badge)
 * because it's a click target that toggles publish state.
 */
export function PublishStatusButton({
  isPublished,
  pending = false,
  blockedReason,
  onClick,
  className,
}: PublishStatusButtonProps) {
  const label = pending ? 'Saving…' : isPublished ? 'Published' : 'Unpublished';
  const blocked = Boolean(blockedReason);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={blocked}
      className={cn(
        'font-semibold',
        isPublished
          ? 'border-[var(--color-success-500)] bg-[var(--color-success-100)] text-[var(--color-success-700)] hover:brightness-95'
          : 'bg-muted text-muted-foreground hover:bg-muted/70',
        blocked && 'cursor-not-allowed opacity-60 hover:brightness-100',
        className,
      )}
      onClick={handleClick}
    >
      {label}
    </Button>
  );

  if (!blockedReason) {
    return button;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{blockedReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
