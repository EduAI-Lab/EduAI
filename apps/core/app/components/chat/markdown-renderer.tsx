import { Suspense } from 'react';
import { LazyStreamdown } from '@eduai/ui';
import { READING_SURFACE_CLASS } from '~/components/assistive/reading-surface';
import { cn } from '~/lib/utils';

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  isAnimating?: boolean;
}

export function MarkdownRenderer({ content, className, isAnimating }: MarkdownRendererProps) {
  return (
    <div className={cn(
      "prose prose-sm max-w-none dark:prose-invert",
      // Ensure code blocks scroll horizontally rather than stretching the container.
      "[&_pre]:overflow-x-auto [&_pre]:max-w-full",
      // Long unbreakable words / URLs wrap instead of overflowing.
      "break-words [overflow-wrap:anywhere]",
      READING_SURFACE_CLASS,
      className,
    )}>
      <Suspense fallback={<div className="animate-pulse">{content}</div>}>
        <LazyStreamdown
          parseIncompleteMarkdown={true}
          className="streamdown-content"
          shikiTheme={["github-light", "github-dark"]}
          isAnimating={isAnimating}
        >
          {content}
        </LazyStreamdown>
      </Suspense>
    </div>
  );
}
