import { memo, useEffect, useId, useMemo, Suspense } from "react"
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
  lexerLoad ??= import("marked")
    .then(({ marked }) => {
      cachedLexer = (markdown) => marked.lexer(markdown).map((token) => token.raw)
    })
    .catch(() => {
      // Transient failure (e.g. stale chunk 404 across a redeploy) — clear the
      // cached promise so a later mount can retry instead of failing forever.
      lexerLoad = null
    })
  return lexerLoad
}

// Keep math in one Streamdown pass — marked.lexer splits on headings/lists and can break equations.
const MATH_PATTERN = /(?<!\\)\$\$|(?<!\\)\$[^$\n]+\$|\\frac|\\sqrt|[a-zA-Z]\^/

function parseMarkdownIntoBlocks(markdown: string): string[] {
  if (MATH_PATTERN.test(markdown)) {
    return [markdown];
  }

  // Lexer not loaded yet — render as a single block. Static content stays a
  // single block (splitting only matters for streaming memoization); streaming
  // content re-splits on the next token once the lazy import resolves. Never
  // re-splitting retroactively avoids tearing down already-rendered blocks.
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

  // Warm the lexer only when this content would actually use it — math-heavy
  // content short-circuits in parseMarkdownIntoBlocks and never consults it.
  useEffect(() => {
    if (!cachedLexer && !MATH_PATTERN.test(children)) {
      void loadLexer()
    }
  }, [children])

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
