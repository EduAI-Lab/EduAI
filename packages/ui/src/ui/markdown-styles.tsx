import { createContext, useContext, type ReactNode } from "react"
import type { MarkdownStyleLoader } from "./lazy-streamdown"

/**
 * App-supplied stylesheet loaders for the shared markdown renderer.
 *
 * KaTeX is ~18KB of rules plus 59 font files. The course catalog is bimodal —
 * MATH/STAT/DATA/PHYS chats are full of math, HIST/ENGL/PSYO chats have none —
 * so the sheet is loaded on demand by the message that needs it rather than
 * statically imported by every markdown surface (#1342).
 */
export type MarkdownStyles = {
  /** e.g. `() => import("katex/dist/katex.min.css")`. */
  loadKatexStyles?: MarkdownStyleLoader
}

const EMPTY_MARKDOWN_STYLES: MarkdownStyles = {}

const MarkdownStylesContext = createContext<MarkdownStyles>(
  EMPTY_MARKDOWN_STYLES
)

export type MarkdownStylesProviderProps = {
  /**
   * Must be a module-level constant, not an object literal built in render:
   * the loader's identity keys the cached Streamdown variant, and a new one
   * each render would remount every math block.
   */
  value: MarkdownStyles
  children: ReactNode
}

/**
 * Without a provider, markdown still renders — math just renders unstyled.
 * Apps that render math are expected to supply `loadKatexStyles`.
 */
export function MarkdownStylesProvider({
  value,
  children,
}: MarkdownStylesProviderProps) {
  return (
    <MarkdownStylesContext.Provider value={value}>
      {children}
    </MarkdownStylesContext.Provider>
  )
}

export function useMarkdownStyles(): MarkdownStyles {
  return useContext(MarkdownStylesContext)
}
