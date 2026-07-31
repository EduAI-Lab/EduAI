import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SignOutCard } from "../sign-out-card"

describe("SignOutCard", () => {
  it("renders the platform-wide copy by default", () => {
    render(<SignOutCard action={<button type="button">Log out</button>} />)

    expect(screen.getByText("Sign out")).toBeInTheDocument()
    expect(screen.getByText("Sign out of EduAI on this browser.")).toBeInTheDocument()
  })

  it("renders the injected action", () => {
    const onClick = vi.fn()
    render(
      <SignOutCard
        action={
          <button type="button" onClick={onClick}>
            Log out
          </button>
        }
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Log out" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("allows the copy to be overridden", () => {
    render(
      <SignOutCard
        action={<button type="button">Log out</button>}
        title="Account"
        description="End your session."
      />,
    )

    expect(screen.getByText("Account")).toBeInTheDocument()
    expect(screen.getByText("End your session.")).toBeInTheDocument()
  })
})
