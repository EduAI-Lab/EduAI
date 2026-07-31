import type { ReactElement } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SettingsPageScaffold } from "../settings/settings-page-scaffold"

const TABS = [
  { value: "account", label: "Account", content: <p>Account body</p> },
  { value: "providers", label: "Providers", content: <p>Providers body</p> },
]

describe("SettingsPageScaffold", () => {
  it("renders the Settings heading and every tab trigger", () => {
    render(<SettingsPageScaffold tabs={TABS} />)

    expect(screen.getByText("Settings")).toBeInTheDocument()
    expect(screen.getByText("Account")).toBeInTheDocument()
    expect(screen.getByText("Providers")).toBeInTheDocument()
  })

  it("opens on the first tab and switches when another is selected", () => {
    render(<SettingsPageScaffold tabs={TABS} />)

    expect(screen.getByText("Account body")).toBeInTheDocument()

    // Radix tabs activate on focus in this environment; a bare click does not switch.
    fireEvent.focus(screen.getByRole("tab", { name: "Providers" }))
    expect(screen.getByText("Providers body")).toBeInTheDocument()
  })

  it("honours defaultTab over tab order", () => {
    render(<SettingsPageScaffold tabs={TABS} defaultTab="providers" />)
    expect(screen.getByText("Providers body")).toBeInTheDocument()
  })

  it("applies uniform space-y-6 to every tab body", () => {
    // The drift this scaffold exists to prevent: two Core tabs and both QM tabs
    // were missing the spacing class and compensated with ad-hoc mt-4 on cards.
    const { container } = render(<SettingsPageScaffold tabs={TABS} />)
    const panels = container.querySelectorAll('[role="tabpanel"]')
    expect(panels.length).toBeGreaterThan(0)
    panels.forEach((panel) => expect(panel).toHaveClass("space-y-6"))
  })

  it("defaults to the unpadded wrapper and applies the named padding variants", () => {
    // Nothing asserted on the outer wrapper before, so Core's Settings shipped
    // without a padding prop and rendered flush against the viewport edge — the
    // page-level padding its own shell does not supply.
    const outer = (markup: ReactElement) =>
      render(markup).container.firstElementChild as HTMLElement

    expect(outer(<SettingsPageScaffold tabs={TABS} />).className).toBe(
      "flex flex-col gap-8",
    )

    const app = outer(<SettingsPageScaffold tabs={TABS} padding="app" />)
    expect(app).toHaveClass("@container/main", "flex-1", "px-4", "lg:px-6")

    const qm = outer(<SettingsPageScaffold tabs={TABS} padding="qm" />)
    expect(qm).toHaveClass("@container/main", "flex-1", "px-4", "lg:px-6")
  })

  it("renders beforeTabs above the strip and footer below it", () => {
    render(
      <SettingsPageScaffold
        tabs={TABS}
        beforeTabs={<p>Password expired</p>}
        footer={<p>Sign out card</p>}
      />,
    )

    expect(screen.getByText("Password expired")).toBeInTheDocument()
    expect(screen.getByText("Sign out card")).toBeInTheDocument()
  })

  it("wraps a trigger when the tab asks for it", () => {
    render(
      <SettingsPageScaffold
        tabs={[
          TABS[0],
          {
            ...TABS[1],
            wrapTrigger: (trigger) => <span data-testid="wrapped">{trigger}</span>,
          },
        ]}
      />,
    )

    expect(screen.getByTestId("wrapped")).toBeInTheDocument()
    expect(screen.getByTestId("wrapped")).toHaveTextContent("Providers")
  })

  it("passes each tab body through renderTabBody", () => {
    render(
      <SettingsPageScaffold
        tabs={TABS}
        renderTabBody={(content) => <div data-testid="motion">{content}</div>}
      />,
    )

    expect(screen.getByTestId("motion")).toHaveTextContent("Account body")
  })
})
