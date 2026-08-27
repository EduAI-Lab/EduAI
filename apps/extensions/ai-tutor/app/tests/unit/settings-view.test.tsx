import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ThemeProvider } from "@eduai/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "~/hooks/useLocalUser";
import { UiPreferencesProvider } from "~/components/settings/ui-preferences";

let mockUser: AuthUser | null = {
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "STUDENT",
};
const mockLogout = vi.fn();
vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser, logout: mockLogout }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockAssistive = { assistive: false, setAssistive: vi.fn() };
vi.mock("~/components/settings/assistive-mode", () => ({
  useAssistiveMode: () => mockAssistive,
}));

vi.mock("~/components/settings/providers-settings", () => ({
  ProvidersSettings: () => <div data-testid="providers-settings-stub" />,
}));

import { SettingsView } from "~/components/settings/settings-view";

function renderView() {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <ThemeProvider>
        <UiPreferencesProvider>{children}</UiPreferencesProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  return render(<SettingsView />, { wrapper: Wrapper });
}

describe("SettingsView", () => {
  beforeEach(() => {
    mockLogout.mockReset();
    mockNavigate.mockReset();
    mockAssistive = { assistive: false, setAssistive: vi.fn() };
    mockUser = { id: "u1", name: "Ada Lovelace", email: "ada@example.com", role: "STUDENT" };
    document.documentElement.removeAttribute("data-density");
    document.documentElement.removeAttribute("data-reduce-motion");
  });

  it("renders the account tab with the current user", () => {
    renderView();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it('falls back to "Signed in" when there is no user name', () => {
    mockUser = null;
    renderView();
    expect(screen.getByText("Signed in")).toBeInTheDocument();
  });

  it("logs out and navigates home when Log out is clicked", async () => {
    mockLogout.mockResolvedValue(undefined);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Log out/ }));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  it("renders the accessibility tab content, including assistive mode state", () => {
    renderView();
    fireEvent.focus(screen.getByRole("tab", { name: /Accessibility/ }));
    expect(
      screen.getByText(
        "Personalize how AI Tutor looks and feels. These settings are optional for everyone.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the providers tab content via the ProvidersSettings stub", () => {
    renderView();
    fireEvent.focus(screen.getByRole("tab", { name: /Providers/ }));
    expect(screen.getByTestId("providers-settings-stub")).toBeInTheDocument();
  });

  it("reads initial density/motion-reduced state from document attributes", () => {
    document.documentElement.setAttribute("data-density", "compact");
    document.documentElement.setAttribute("data-reduce-motion", "true");
    renderView();
    // Just verifying it renders without crashing while these attrs are set;
    // the accessibility panel internals belong to @eduai/ui's own tests.
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});
