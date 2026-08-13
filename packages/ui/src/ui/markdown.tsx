import { memo, useEffect, useId, useMemo, Suspense } from "react"
import type { Components } from "react-markdown"
import {
  LazyStreamdown,
  getMathStreamdown,
  type MarkdownStyleLoader,
} from "./lazy-streamdown"
import { useMarkdownStyles } from "./markdown-styles"

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
// Deliberately loose: its false positives only force single-block rendering, which is safe.
const MATH_PATTERN = /(?<!\\)\$\$|(?<!\\)\$[^$\n]+\$|\\frac|\\sqrt|[a-zA-Z]\^/

// Whether this content will actually produce KaTeX output, and so needs the
// KaTeX stylesheet (#1342). `$$…$$` is the only delimiter that does today:
// @streamdown/math's createMathPlugin() defaults singleDollarTextMath to false
// and lazy-streamdown.tsx calls it with no arguments, so `$…$`, bare `\frac`
// and `x^2` outside delimiters are never typeset. If that option is ever
// enabled, widen this to match MATH_PATTERN's `$…$` alternative too, or inline
// math will render unstyled.
//
// Kept separate from MATH_PATTERN on purpose — MATH_PATTERN is load-bearing for
// block splitting and must stay loose; this one must be exact, since a false
// positive fetches 18KB of CSS plus KaTeX's fonts for nothing.
const MATH_STYLE_PATTERN = /(?<!\\)\$\$/

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
    hasMath,
    loadKatexStyles,
  }: {
    content: string
    isAnimating?: boolean
    hasMath: boolean
    loadKatexStyles?: MarkdownStyleLoader
  }) {
    // Math blocks fold the stylesheet into the same suspended promise as
    // Streamdown, so the sheet is in place before the block's first paint.
    const Streamdown = hasMath
      ? getMathStreamdown(loadKatexStyles)
      : LazyStreamdown

    return (
      <Suspense fallback={<div className="animate-pulse">{content}</div>}>
        <Streamdown
          parseIncompleteMarkdown={true}
          shikiTheme={["github-light", "github-dark"]}
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
      prevProps.isAnimating === nextProps.isAnimating &&
      prevProps.hasMath === nextProps.hasMath &&
      prevProps.loadKatexStyles === nextProps.loadKatexStyles
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
  const { loadKatexStyles } = useMarkdownStyles()

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
          hasMath={MATH_STYLE_PATTERN.test(block)}
          loadKatexStyles={loadKatexStyles}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown, MATH_STYLE_PATTERN }
