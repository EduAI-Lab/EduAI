import { lazy, Suspense } from 'react';
import { READING_SURFACE_CLASS } from '~/components/assistive/reading-surface';
import { cn } from '~/lib/utils';

// Lazy load Streamdown to avoid SSR issues with KaTeX CSS
const Streamdown = lazy(() => import('streamdown').then(module => ({ default: module.Streamdown })));

export interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-sm max-w-none", READING_SURFACE_CLASS, className)}>
      <Suspense fallback={<div className="animate-pulse">{content}</div>}>
        <Streamdown
          parseIncompleteMarkdown={true}
          className="streamdown-content"
          shikiTheme={["github-light", "github-dark"]}
        >
          {content}
        </Streamdown>
      </Suspense>
    </div>
  );
}