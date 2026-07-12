import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { IconDashboard, IconBooks } from "@tabler/icons-react"
import { NavMain, type NavMainItem } from "@eduai/ui"
import { SidebarProvider } from "@eduai/ui"

const items: NavMainItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: IconDashboard },
  { title: "Courses", url: "/courses", icon: IconBooks },
];

function renderWithSidebar(ui: React.ReactElement, { path = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>
  )
}

describe("NavMain — rendering", () => {
  it("renders each nav item with its link", () => {
    renderWithSidebar(<NavMain items={items} currentPath="/" />)
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard")
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("href", "/courses")
  })
})

describe("NavMain — missing data", () => {
  it("renders without throwing when there are no items", () => {
    renderWithSidebar(<NavMain items={[]} currentPath="/" />)
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
  })
})

describe("NavMain — active state", () => {
  it("marks the current route link as aria-current=page", () => {
    renderWithSidebar(<NavMain items={items} currentPath="/dashboard" />, { path: "/dashboard" })
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Courses" })).not.toHaveAttribute("aria-current")
  })

  it("marks a child route as active when path starts with item url", () => {
    renderWithSidebar(<NavMain items={items} currentPath="/courses/abc123" />, { path: "/courses/abc123" })
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current")
  })
})
