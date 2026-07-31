import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette, CommandSearchButton, buildAppSwitcherGroup } from "../command-palette";
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

/**
 * Host-driven search mode (#1143).
 *
 * Passing `onQueryChange` flips the palette from cmdk's built-in filtering to
 * host-driven results. That matters for a server-paginated group: cmdk can only
 * filter rows already loaded, which for a paged list is just the first page, so
 * it would hide rows the server had already matched. The palette therefore has
 * to become a controlled input, disable `shouldFilter`, and clear the query on
 * close so the next open starts from the unfiltered list.
 */
describe("CommandPalette host-driven search", () => {
  const courseGroups = () => [
    {
      heading: "Switch course",
      items: [
        { label: "CS101", sublabel: "Intro to CS", value: "course CS101", onSelect: vi.fn() },
        { label: "CS201", sublabel: "Data Structures", value: "course CS201", onSelect: vi.fn() },
      ],
    },
  ];

  /** The palette is keyboard-triggered; ⌘K toggles it. */
  const togglePalette = () => fireEvent.keyDown(document, { key: "k", metaKey: true });

  const input = () => screen.getByPlaceholderText("Search or jump to…");

  it("reports every keystroke to the host when onQueryChange is supplied", () => {
    const onQueryChange = vi.fn();
    render(<CommandPalette groups={courseGroups()} onQueryChange={onQueryChange} />);
    togglePalette();

    fireEvent.change(input(), { target: { value: "alg" } });

    expect(onQueryChange).toHaveBeenCalledWith("alg");
  });

  it("drives the search box as a controlled input in host-filtered mode", () => {
    render(<CommandPalette groups={courseGroups()} onQueryChange={vi.fn()} />);
    togglePalette();

    fireEvent.change(input(), { target: { value: "data" } });

    expect((input() as HTMLInputElement).value).toBe("data");
  });

  it("keeps host-supplied rows that do not match the typed query", () => {
    // cmdk's own filter would hide both rows for "zzz"; host-driven mode must
    // not, because the host already narrowed the list server-side.
    render(<CommandPalette groups={courseGroups()} onQueryChange={vi.fn()} />);
    togglePalette();

    fireEvent.change(input(), { target: { value: "zzz" } });

    expect(screen.getByText("CS101")).toBeInTheDocument();
    expect(screen.getByText("CS201")).toBeInTheDocument();
  });

  it("clears the query and tells the host when the palette closes", () => {
    const onQueryChange = vi.fn();
    render(<CommandPalette groups={courseGroups()} onQueryChange={onQueryChange} />);
    togglePalette();
    fireEvent.change(input(), { target: { value: "alg" } });
    onQueryChange.mockClear();

    togglePalette();

    // The next open has to start from the unfiltered list, not the last search.
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("does not fire the reset when nothing was ever typed", () => {
    const onQueryChange = vi.fn();
    render(<CommandPalette groups={courseGroups()} onQueryChange={onQueryChange} />);
    togglePalette();
    togglePalette();

    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("leaves cmdk filtering in charge when no onQueryChange is supplied", () => {
    render(<CommandPalette groups={courseGroups()} />);
    togglePalette();

    fireEvent.change(input(), { target: { value: "CS201" } });

    // Uncontrolled mode: cmdk narrows the rendered list itself.
    expect(screen.queryByText("CS101")).not.toBeInTheDocument();
    expect(screen.getByText("CS201")).toBeInTheDocument();
  });
});
