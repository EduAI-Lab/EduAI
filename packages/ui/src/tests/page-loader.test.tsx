import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PageLoader } from "../page-loader"

describe("PageLoader", () => {
  it("renders the loading text", () => {
    render(<PageLoader />)
    expect(screen.getByText("Loading…")).toBeInTheDocument()
  })

  it("fills the viewport and centers its content", () => {
    const { container } = render(<PageLoader />)
    const root = container.firstElementChild
    expect(root).toHaveClass("min-h-dvh", "flex", "items-center", "justify-center")
  })

  it("applies a custom className to the container", () => {
    const { container } = render(<PageLoader className="custom-loader-class" />)
    const root = container.firstElementChild
    expect(root).toHaveClass("custom-loader-class")
  })
})
