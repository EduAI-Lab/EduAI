import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconDatabase, IconReport } from "@tabler/icons-react";
import { NavDocuments } from "~/components/nav-documents";
import type { NavDocumentItem } from "~/components/nav-documents";
import { SidebarProvider } from "~/components/ui/sidebar";

const items: NavDocumentItem[] = [
  { name: "Data Library", url: "#", icon: IconDatabase },
  { name: "Reports", url: "#", icon: IconReport },
];

function renderWithSidebar(ui: React.ReactElement) {
  return render(<SidebarProvider>{ui}</SidebarProvider>);
}

describe("NavDocuments — rendering", () => {
  it("renders the Documents group label", () => {
    renderWithSidebar(<NavDocuments items={items} />);
    expect(screen.getByText("Documents")).toBeInTheDocument();
  });

  it("renders each document name", () => {
    renderWithSidebar(<NavDocuments items={items} />);
    expect(screen.getByText("Data Library")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
  });
});

describe("NavDocuments — missing data", () => {
  it("renders the group label when there are no items", () => {
    renderWithSidebar(<NavDocuments items={[]} />);
    expect(screen.getByText("Documents")).toBeInTheDocument();
  });
});
