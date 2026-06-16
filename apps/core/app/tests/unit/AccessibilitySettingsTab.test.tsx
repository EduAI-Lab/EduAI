import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AccessibilitySettingsTab } from "~/components/settings/accessibility-settings-tab";

const setAssistive = vi.fn();
const setMotionReduced = vi.fn();
const setDensity = vi.fn();
const setTheme = vi.fn();

vi.mock("~/components/assistive/assistive-ui-provider", () => ({
  useAssistiveUi: () => ({
    assistive: false,
    setAssistive,
  }),
}));

vi.mock("~/components/assistive/ui-preferences-provider", () => ({
  useUiPreferences: () => ({
    motionReduced: false,
    density: "comfortable",
    theme: "system",
    setMotionReduced,
    setDensity,
    setTheme,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccessibilitySettingsTab", () => {
  it("renders de-stigmatized accessibility controls", () => {
    render(<AccessibilitySettingsTab />);

    expect(screen.getByText("Accessibility")).toBeInTheDocument();
    expect(screen.getByLabelText("Assistive Mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Reduce motion")).toBeInTheDocument();
    expect(screen.getByLabelText("Comfortable")).toBeInTheDocument();
    expect(screen.getByLabelText("Compact")).toBeInTheDocument();
    expect(screen.getByLabelText("System")).toBeInTheDocument();
    expect(screen.getByLabelText("Light")).toBeInTheDocument();
    expect(screen.getByLabelText("Dark")).toBeInTheDocument();
    expect(screen.queryByText(/ADHD|disorder|diagnosis/i)).not.toBeInTheDocument();
  });

  it("wires Assistive Mode to the shared provider", () => {
    render(<AccessibilitySettingsTab />);
    fireEvent.click(screen.getByLabelText("Assistive Mode"));
    expect(setAssistive).toHaveBeenCalledWith(true);
  });

  it("wires reduce motion to ui preferences", () => {
    render(<AccessibilitySettingsTab />);
    fireEvent.click(screen.getByLabelText("Reduce motion"));
    expect(setMotionReduced).toHaveBeenCalledWith(true);
  });
});
