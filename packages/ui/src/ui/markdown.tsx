import { memo, useEffect, useId, useMemo, useState, Suspense } from "react"
import type { Components } from "react-markdown"
import { LazyStreamdown } from "./lazy-streamdown"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
  /** When true, defers code-block copy/download until streaming finishes. */
  isAnimating?: boolean
}

// `marked` is only used to split markdown into blocks — load it on demand so it
// stays out of the always-loaded shared chunk (Streamdown next door is already lazy).
let cachedLexer: ((markdown: string) => string[]) | null = null
let lexerLoad: Promise<void> | null = null

function loadLexer(): Promise<void> {
  lexerLoad ??= import("marked").then(({ marked }) => {
    cachedLexer = (markdown) => marked.lexer(markdown).map((token) => token.raw)
  })
  return lexerLoad
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  // Keep math in one Streamdown pass — marked.lexer splits on headings/lists and can break equations.
  if (/(?<!\\)\$\$|(?<!\\)\$[^$\n]+\$|\\frac|\\sqrt|[a-zA-Z]\^/.test(markdown)) {
    return [markdown];
  }

  // Lexer not loaded yet — render as a single block; the component re-renders
  // and re-splits once the lazy import resolves.
  if (!cachedLexer) {
    return [markdown]
  }

  return cachedLexer(markdown)
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
        <LazyStreamdown
          parseIncompleteMarkdown={true}
          shikiTheme={["github-light", "github-dark"]}
          isAnimating={isAnimating}
          className="streamdown-content"
        >
          {content}
        </LazyStreamdown>
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
  const [lexerReady, setLexerReady] = useState(() => cachedLexer !== null)

  useEffect(() => {
    if (!lexerReady) {
      let cancelled = false
      loadLexer().then(() => {
        if (!cancelled) setLexerReady(true)
      })
      return () => {
        cancelled = true
      }
    }
  }, [lexerReady])

  const blocks = useMemo(
    () => parseMarkdownIntoBlocks(children),
    [children, lexerReady]
  )

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
