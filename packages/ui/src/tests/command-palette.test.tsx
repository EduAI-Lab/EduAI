import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandSearchButton, buildAppSwitcherGroup } from "../command-palette";
import type { LauncherApp } from "../app-launcher";

const APPS: LauncherApp[] = [
  { id: "core", name: "EduAI Core", url: "http://core", description: "Hub" },
  { id: "ai-tutor", name: "AI Tutor", url: "http://tutor", description: "Chat" },
  { id: "question-maker", name: "Question Maker", url: "http://qm", description: "Assess", roles: ["INSTRUCTOR", "ADMIN"] },
];

describe("buildAppSwitcherGroup", () => {
  it("excludes the current app and RBAC-gates the rest", () => {
    const g = buildAppSwitcherGroup({ apps: APPS, currentAppId: "core", role: "STUDENT" });
    const labels = g.items.map((i) => i.label);
    expect(labels).toContain("AI Tutor");
    expect(labels).not.toContain("EduAI Core"); // current app dropped
    expect(labels).not.toContain("Question Maker"); // role-gated out for STUDENT
  });

  it("includes role-gated apps for permitted roles", () => {
    const g = buildAppSwitcherGroup({ apps: APPS, currentAppId: "ai-tutor", role: "ADMIN" });
    const labels = g.items.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(["EduAI Core", "Question Maker"]));
    expect(labels).not.toContain("AI Tutor");
  });

  it("uses a Switch app heading by default", () => {
    expect(buildAppSwitcherGroup({ apps: APPS, currentAppId: "core" }).heading).toBe("Switch app");
  });
});

describe("CommandSearchButton", () => {
  it("calls onOpen when provided", () => {
    const onOpen = vi.fn();
    render(<CommandSearchButton onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Open command palette"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("dispatches the given window event when onOpen is absent", () => {
    const handler = vi.fn();
    window.addEventListener("test:open-command", handler);
    render(<CommandSearchButton eventName="test:open-command" />);
    fireEvent.click(screen.getByLabelText("Open command palette"));
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("test:open-command", handler);
  });

  it("renders the label", () => {
    render(<CommandSearchButton label="Find" onOpen={() => {}} />);
    expect(screen.getByText("Find")).toBeInTheDocument();
  });

  it("shows ⌘K on macOS and Ctrl K elsewhere", async () => {
    const setPlatform = (value: string) =>
      Object.defineProperty(window.navigator, "platform", { value, configurable: true });

    setPlatform("MacIntel");
    const mac = render(<CommandSearchButton onOpen={() => {}} />);
    expect(await mac.findByText("⌘K")).toBeInTheDocument();
    mac.unmount();

    setPlatform("Win32");
    const win = render(<CommandSearchButton onOpen={() => {}} />);
    expect(await win.findByText("Ctrl K")).toBeInTheDocument();
  });
});
