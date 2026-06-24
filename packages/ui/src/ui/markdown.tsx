import { cn } from "../utils"
import { marked } from "marked"
import { memo, useId, useMemo, lazy, Suspense } from "react"
import type { Components } from "react-markdown"
import { streamdownPlugins } from "../lib/streamdown-config"

// Lazy load Streamdown to avoid SSR issues with KaTeX CSS
const Streamdown = lazy(() => import('streamdown').then(module => ({ default: module.Streamdown })))

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
  /** When true, defers code-block copy/download until streaming finishes. */
  isAnimating?: boolean
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    isAnimating,
  }: {
    content: string
    isAnimating?: boolean
  }) {
    return (
      <Suspense fallback={<div className="animate-pulse">{content}</div>}>
        <Streamdown
          parseIncompleteMarkdown={true}
          shikiTheme={["github-light", "github-dark"]}
          plugins={streamdownPlugins}
          isAnimating={isAnimating}
          className="streamdown-content"
        >
          {content}
        </Streamdown>
      </Suspense>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return (
      prevProps.content === nextProps.content &&
      prevProps.isAnimating === nextProps.isAnimating
    )
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
  isAnimating,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          isAnimating={isAnimating}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
