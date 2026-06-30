/**
 * Shared empty-state block. Use anywhere a list, grid, or panel can render with no
 * data. Centered icon chip + title + supporting copy + up to two CTAs, wrapped in a
 * subtle dashed container so an empty slot reads as intentional, never broken.
 *
 * Design-system aligned: Tabler icon (muted), 44px+ touch targets, --radius-xl.
 */
import { type ReactNode } from 'react';
import { Button, cn } from '@eduai/ui';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost';
}

export interface EmptyStateProps {
  /** Tabler icon element, e.g. <IconStack2 className="size-6" />. */
  icon?: ReactNode;
  title: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** Optional extra content rendered under the actions (e.g. a tips list). */
  children?: ReactNode;
  /** `sm` for in-panel emptiness, `default` for full-page. */
  size?: 'sm' | 'default';
  /** Render without the dashed border (for already-bordered containers). */
  bare?: boolean;
  className?: string;
}

function ActionButton({ action }: { action: EmptyStateAction }) {
  const content = (
    <>
      {action.icon}
      {action.label}
    </>
  );
  if (action.href) {
    return (
      <Button asChild variant={action.variant ?? 'default'}>
        <a href={action.href}>{content}</a>
      </Button>
    );
  }
  return (
    <Button variant={action.variant ?? 'default'} onClick={action.onClick}>
      {content}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
  size = 'default',
  bare = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'default' ? 'gap-4 px-6 py-14' : 'gap-3 px-4 py-9',
        !bare && 'rounded-[var(--radius-xl)] border border-dashed border-border bg-card/40',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-[var(--radius-lg)] bg-muted text-muted-foreground',
            size === 'default' ? 'size-12' : 'size-10',
          )}
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className={cn('font-semibold text-foreground', size === 'default' ? 'text-base' : 'text-sm')}>
          {title}
        </h3>
        {description && (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {primaryAction && <ActionButton action={primaryAction} />}
          {secondaryAction && (
            <ActionButton action={{ variant: 'outline', ...secondaryAction }} />
          )}
        </div>
      )}
      {children}
    </div>
  );
}
