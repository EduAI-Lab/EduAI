import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

// #963 review: aria-controls is wired the same way on both branches, but the
// mobile sidebar renders as a Radix Sheet, which — unlike the desktop
// container — is unmounted from the DOM entirely while closed (no
// `forceMount`). So the id aria-controls points at genuinely does not exist
// until the sheet is opened. Verify it resolves once toggled, on a viewport
// narrow enough to take the mobile branch.
describe("SidebarTrigger — mobile (offcanvas Sheet)", () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 375,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it("starts closed with aria-controls pointing at an id not yet in the DOM", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)).toBeNull();
  });

  it("resolves aria-controls to a real element once opened", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>content</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
    const controlsId = trigger.getAttribute("aria-controls");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(controlsId as string)).not.toBeNull();
  });
});
