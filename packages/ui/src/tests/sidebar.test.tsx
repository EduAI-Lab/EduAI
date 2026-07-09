import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
} from "../ui/sidebar";

describe("SidebarTrigger", () => {
  it("exposes aria-expanded reflecting the open state", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles aria-expanded to false after clicking while open", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("sets aria-controls pointing at an id that exists on the sidebar container", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)).not.toBeNull();
  });
});
