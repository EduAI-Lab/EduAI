import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { IconSettings, IconHelp } from "@tabler/icons-react"
import { MemoryRouter } from "react-router"
import { NavSecondary, type NavSecondaryItem } from "@eduai/ui"
import { SidebarProvider } from "@eduai/ui"

const items: NavSecondaryItem[] = [
  { title: "Settings", url: "/settings", icon: IconSettings },
  { title: "Get Help", url: "#", icon: IconHelp },
];

function renderWithSidebar(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>
  )
}

describe("NavSecondary — rendering", () => {
  it("renders each item as a link with the correct href", () => {
    renderWithSidebar(<NavSecondary items={items} currentPath="/" />)
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings")
    expect(screen.getByRole("link", { name: "Get Help" })).toBeInTheDocument()
  })
})

describe("NavSecondary — missing data", () => {
  it("renders without throwing when there are no items", () => {
    const { container } = renderWithSidebar(<NavSecondary items={[]} currentPath="/" />)
    expect(container).toBeTruthy()
  })
})
