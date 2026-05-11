import { cn } from "~/lib/utils"
import { marked } from "marked"
import { memo, useId, useMemo, lazy, Suspense } from "react"
import type { Components } from "react-markdown"
import { CodeBlock, CodeBlockCode } from "./code-block"

// Lazy load Streamdown to avoid SSR issues with KaTeX CSS
const Streamdown = lazy(() => import('streamdown').then(module => ({ default: module.Streamdown })))

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-(\w+)/)
  return match ? match[1] : "plaintext"
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
  }: {
    content: string
  }) {
    return (
      <Suspense fallback={<div className="animate-pulse">{content}</div>}>
        <Streamdown
          parseIncompleteMarkdown={true}
          shikiTheme={["github-light", "github-dark"]}
          className="streamdown-content"
        >
          {content}
        </Streamdown>
      </Suspense>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
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
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
