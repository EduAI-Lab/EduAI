import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Spinner } from "../spinner"

describe("Spinner", () => {
  it("spins and defaults to the small size", () => {
    const { container } = render(<Spinner />)
    const icon = container.querySelector("svg")
    expect(icon).toHaveClass("animate-spin")
    expect(icon).toHaveClass("size-4")
  })

  it("maps each size token to a class", () => {
    const sizes = { xs: "size-3", sm: "size-4", md: "size-5", lg: "size-6" } as const
    for (const [size, cls] of Object.entries(sizes)) {
      const { container, unmount } = render(<Spinner size={size as keyof typeof sizes} />)
      expect(container.querySelector("svg")).toHaveClass(cls)
      unmount()
    }
  })

  it("is decorative without a label", () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("exposes a status role when labelled", () => {
    render(<Spinner label="Saving" />)
    expect(screen.getByRole("status", { name: "Saving" })).toBeInTheDocument()
  })

  it("merges a custom className", () => {
    const { container } = render(<Spinner className="mr-2" />)
    expect(container.querySelector("svg")).toHaveClass("mr-2")
  })
})
