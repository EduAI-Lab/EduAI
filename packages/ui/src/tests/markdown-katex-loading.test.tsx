import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Markdown } from "../ui/markdown"
import { MarkdownStylesProvider, type MarkdownStyles } from "../ui/markdown-styles"

/**
 * #1342 — the KaTeX stylesheet must be fetched only for content that renders
 * math, and must be resolved *before* that content paints (a detached import()
 * after render would flash unstyled math).
 *
 * Streamdown and its plugins are stubbed: this asserts the gate and the
 * ordering, not Streamdown's own rendering.
 */
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="streamdown">{children}</div>
  ),
}))
vi.mock("@streamdown/code", () => ({ code: {} }))
vi.mock("@streamdown/math", () => ({ createMathPlugin: () => ({}) }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe("KaTeX stylesheet loading", () => {
  it("does not load the stylesheet for math-free content", async () => {
    const loadKatexStyles = vi.fn(() => Promise.resolve())
    const styles: MarkdownStyles = { loadKatexStyles }

    render(
      <MarkdownStylesProvider value={styles}>
        <Markdown>The textbook costs $45 and the lab kit is $20.</Markdown>
      </MarkdownStylesProvider>
    )

    await screen.findByTestId("streamdown")
    expect(loadKatexStyles).not.toHaveBeenCalled()
  })

  it("loads the stylesheet for content that renders math", async () => {
    const loadKatexStyles = vi.fn(() => Promise.resolve())
    const styles: MarkdownStyles = { loadKatexStyles }

    render(
      <MarkdownStylesProvider value={styles}>
        <Markdown>{"Solve $$x^2 + 1$$ for x."}</Markdown>
      </MarkdownStylesProvider>
    )

    await screen.findByTestId("streamdown")
    expect(loadKatexStyles).toHaveBeenCalledTimes(1)
  })

  it("resolves the stylesheet before the math block paints", async () => {
    let releaseStylesheet!: () => void
    const stylesheet = new Promise<void>((resolve) => {
      releaseStylesheet = resolve
    })
    const styles: MarkdownStyles = { loadKatexStyles: () => stylesheet }

    render(
      <MarkdownStylesProvider value={styles}>
        <Markdown>{"$$E = mc^2$$"}</Markdown>
      </MarkdownStylesProvider>
    )

    // Control: a math-free block sharing this render resolves without the
    // stylesheet, so reaching the assertion below is not just "nothing has
    // resolved yet".
    render(
      <MarkdownStylesProvider value={styles}>
        <Markdown>Plain prose.</Markdown>
      </MarkdownStylesProvider>
    )
    await screen.findByTestId("streamdown")

    // The math block is still held by Suspense — it cannot paint unstyled math
    // ahead of its CSS.
    expect(screen.getAllByTestId("streamdown")).toHaveLength(1)

    releaseStylesheet()
    await waitFor(() => {
      expect(screen.getAllByTestId("streamdown")).toHaveLength(2)
    })
  })

  it("still renders math when the stylesheet fails to load", async () => {
    // React.lazy caches rejections permanently, so a transient CSS 404 must not
    // suspend the message forever — it degrades to unstyled math instead.
    const styles: MarkdownStyles = {
      loadKatexStyles: () => Promise.reject(new Error("chunk 404")),
    }

    render(
      <MarkdownStylesProvider value={styles}>
        <Markdown>{"$$a^2 + b^2 = c^2$$"}</Markdown>
      </MarkdownStylesProvider>
    )

    expect(await screen.findByTestId("streamdown")).toBeTruthy()
  })

  it("renders math without a provider at all", async () => {
    render(<Markdown>{"$$\\int_0^1 x\\,dx$$"}</Markdown>)

    expect(await screen.findByTestId("streamdown")).toBeTruthy()
  })
})
