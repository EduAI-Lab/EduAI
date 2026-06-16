/**
 * QM tooltip wrapper — keeps the legacy `content` prop API used across pages.
 * Styled with redesign tokens via semantic classes.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const PADDING = 8;

interface TooltipProps {
  children: React.ReactElement;
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  multiline?: boolean;
}

export const Tooltip = ({
  children,
  content,
  side = 'top',
  className,
  multiline = false,
}: TooltipProps) => {
  const [isVisible, setIsVisible] = React.useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!isVisible || !triggerRef.current || !tooltipRef.current) {
      if (!isVisible) setPosition(null);
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const triggerCenterY = triggerRect.top + triggerRect.height / 2;
    const tw = tooltipRect.width;
    const th = tooltipRect.height;

    let top = 0;
    let left = Math.round(triggerCenterX - tw / 2);

    switch (side) {
      case 'top':
        top = triggerRect.top - th - PADDING;
        break;
      case 'bottom':
        top = triggerRect.bottom + PADDING;
        break;
      case 'left':
        left = triggerRect.left - tw - PADDING;
        top = Math.round(triggerCenterY - th / 2);
        break;
      case 'right':
        left = triggerRect.right + PADDING;
        top = Math.round(triggerCenterY - th / 2);
        break;
      default:
        top = triggerRect.bottom + PADDING;
    }

    if (side === 'top' || side === 'bottom') {
      left = Math.round(triggerCenterX - tw / 2);
    }

    const minLeft = PADDING;
    const maxLeft = viewportW - tw - PADDING;
    const minTop = PADDING;
    const maxTop = viewportH - th - PADDING;

    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, left));
    const clampedTop = Math.max(minTop, Math.min(maxTop, top));

    setPosition({ top: clampedTop, left: clampedLeft });
  }, [isVisible, side, content]);

  const tooltipContent = isVisible && (
    <div
      ref={tooltipRef}
      className={cn(
        'pointer-events-none fixed z-[100] rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-lg',
        multiline ? 'max-w-xs break-words' : 'whitespace-nowrap',
        className,
      )}
      style={
        position === null
          ? { top: -9999, left: -9999 }
          : { top: position.top, left: position.left }
      }
      role="tooltip"
    >
      {content}
    </div>
  );

  const openTooltip = React.useCallback(() => {
    setPosition(null);
    setIsVisible(true);
  }, []);

  return (
    <div
      ref={triggerRef}
      className={cn('relative inline-block', className)}
      onMouseEnter={openTooltip}
      onMouseLeave={() => setIsVisible(false)}
    >
      {React.cloneElement(children)}
      {tooltipContent && createPortal(tooltipContent, document.body)}
    </div>
  );
};
