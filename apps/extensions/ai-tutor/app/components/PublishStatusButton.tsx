import type { MouseEvent } from 'react';
import { Button } from '~/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import { cn } from '~/lib/utils';

type PublishStatusButtonProps = {
  isPublished: boolean;
  pending?: boolean;
  blockedReason?: string | null;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
};

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
      size="sm"
      aria-disabled={blocked}
      className={cn(
        'px-3 py-1.5 text-xs font-semibold transition',
        isPublished
          ? 'bg-emerald-400 text-emerald-900 hover:bg-emerald-500 dark:bg-emerald-500/80 dark:text-white dark:hover:bg-emerald-500/70'
          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
        blocked && 'cursor-not-allowed opacity-60 hover:bg-gray-300/80 dark:hover:bg-gray-700/80',
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
