import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { SettingsView } from "~/components/settings/settings-view";
import { authClient } from "~/lib/auth/client";
import { useApiKeys } from "~/hooks/use-api-keys";
import { usePolicyGate } from "~/components/policy/policy-gate";

vi.mock("~/components/canvas/canvas-integration-settings", () => ({
  CanvasIntegrationSettings: () => <div data-testid="canvas-settings" />,
}));
vi.mock("~/components/settings/accessibility-settings-tab", () => ({
  AccessibilitySettingsTab: () => <div data-testid="accessibility-settings" />,
}));
vi.mock("~/components/settings/change-password-settings", () => ({
  ChangePasswordSettings: () => <div data-testid="change-password-settings" />,
}));
vi.mock("~/components/settings/student-number-settings", () => ({
  StudentNumberSettings: ({ initialStudentNumber }: { initialStudentNumber: string | null }) => (
    <div data-testid="student-number-settings">{initialStudentNumber ?? "none"}</div>
  ),
}));
vi.mock("~/components/motion/scroll-reveal", () => ({
  ScrollReveal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/policy/policy-gate", () => ({
  usePolicyGate: vi.fn(() => ({ isEnabled: () => false })),
  DisabledTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/hooks/use-api-keys", () => ({
  useApiKeys: vi.fn(() => ({
    isProviderConfigured: () => false,
    updateProviderSettings: vi.fn(),
    removeProviderSettings: vi.fn(),
  })),
}));

vi.mock("~/lib/auth/client", () => ({
  authClient: {
    apiKey: {
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

function renderView(overrides: Partial<React.ComponentProps<typeof SettingsView>> = {}) {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsView {...overrides} />,
        // The expiry fetcher posts to action="/settings"; give it a no-op
        // action so the submission resolves instead of 404ing.
        action: () => null,
      },
    ],
    { initialEntries: ["/settings"] },
  );
  return render(<RouterProvider router={router} />);
}

// Radix Tabs activates on pointerdown/mousedown, not click — a plain
// fireEvent.click never fires that handler, so the tab body never swaps.
function clickTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authClient.apiKey.list).mockResolvedValue({
    data: { apiKeys: [] },
    error: null,
  } as never);
  vi.mocked(useApiKeys).mockReturnValue({
    isProviderConfigured: () => false,
    updateProviderSettings: vi.fn(),
    removeProviderSettings: vi.fn(),
  } as never);
  vi.mocked(usePolicyGate).mockReturnValue({ isEnabled: () => false } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SettingsView — tab visibility by role", () => {
  it("shows only Account, Accessibility, and Providers tabs with no role", () => {
    renderView();

    expect(screen.getByRole("tab", { name: /account/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /accessibility/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /providers/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /api keys/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /canvas/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("student-number-settings")).not.toBeInTheDocument();
  });

  it("shows the student-number settings inline on the Account tab for STUDENT", () => {
    renderView({ role: "STUDENT", studentNumber: "12345" });

    expect(screen.getByTestId("student-number-settings")).toHaveTextContent("12345");
  });

  it("shows the API Keys tab for ADMIN", () => {
    renderView({ role: "ADMIN" });

    expect(screen.getByRole("tab", { name: /api keys/i })).toBeInTheDocument();
  });

  it("shows the Canvas tab for ADMIN regardless of the policy gate", () => {
    vi.mocked(usePolicyGate).mockReturnValue({ isEnabled: () => false } as never);
    renderView({ role: "ADMIN" });

    expect(screen.getByRole("tab", { name: /canvas/i })).toBeInTheDocument();
  });

  it("shows the Canvas tab for INSTRUCTOR only when the policy gate is enabled", () => {
    vi.mocked(usePolicyGate).mockReturnValue({
      isEnabled: (key: string) => key === "instructors.canManageCanvasIntegration",
    } as never);
    renderView({ role: "INSTRUCTOR" });

    expect(screen.getByRole("tab", { name: /canvas/i })).toBeInTheDocument();
  });

  it("hides the Canvas tab for INSTRUCTOR when the policy gate is disabled", () => {
    renderView({ role: "INSTRUCTOR" });

    expect(screen.queryByRole("tab", { name: /canvas/i })).not.toBeInTheDocument();
  });

  it("hides the Canvas tab for STUDENT even though it wouldn't be gated", () => {
    renderView({ role: "STUDENT" });

    expect(screen.queryByRole("tab", { name: /canvas/i })).not.toBeInTheDocument();
  });
});

describe("SettingsView — password expired banner", () => {
  it("shows the expired-password banner when passwordExpired is true", () => {
    renderView({ passwordExpired: true });

    expect(screen.getByText(/your password has expired/i)).toBeInTheDocument();
  });

  it("hides the banner by default", () => {
    renderView();

    expect(screen.queryByText(/your password has expired/i)).not.toBeInTheDocument();
  });
});

describe("SettingsView — server API key management (ADMIN)", () => {
  it("loads server keys on mount and renders them", async () => {
    vi.mocked(authClient.apiKey.list).mockResolvedValue({
      data: {
        apiKeys: [
          { id: "k1", name: "My Key", prefix: "eduai", start: "abcdefgh", enabled: true },
        ],
      },
      error: null,
    } as never);

    renderView({ role: "ADMIN" });
    clickTab(/api keys/i);

    await waitFor(() => expect(screen.getByText("My Key")).toBeInTheDocument());
  });

  it("shows the empty state when there are no server keys", async () => {
    renderView({ role: "ADMIN" });
    clickTab(/api keys/i);

    await waitFor(() => expect(authClient.apiKey.list).toHaveBeenCalled());
    expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();
  });

  it("creates a key, shows the plaintext key once, and copies it", async () => {
    vi.mocked(authClient.apiKey.create).mockResolvedValue({
      data: { key: "eduai-plaintext-secret" },
      error: null,
    } as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderView({ role: "ADMIN" });
    clickTab(/api keys/i);
    await waitFor(() => expect(authClient.apiKey.list).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "My Integration" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() =>
      expect(screen.getByText("eduai-plaintext-secret")).toBeInTheDocument(),
    );
    expect(authClient.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Integration", prefix: "eduai" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("eduai-plaintext-secret"));
  });

  it("deletes a server key and reloads the list", async () => {
    vi.mocked(authClient.apiKey.list)
      .mockResolvedValueOnce({
        data: {
          apiKeys: [
            { id: "k1", name: "Doomed Key", prefix: "eduai", start: "abcdefgh", enabled: true },
          ],
        },
        error: null,
      } as never)
      .mockResolvedValue({ data: { apiKeys: [] }, error: null } as never);
    vi.mocked(authClient.apiKey.delete).mockResolvedValue({ data: {}, error: null } as never);

    renderView({ role: "ADMIN" });
    clickTab(/api keys/i);
    await waitFor(() => expect(screen.getByText("Doomed Key")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(authClient.apiKey.delete).toHaveBeenCalledWith({ keyId: "k1" }));
    await waitFor(() => expect(screen.getByText("No API keys yet.")).toBeInTheDocument());
  });

  it("logs and swallows a failed key list load", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(authClient.apiKey.list).mockRejectedValue(new Error("network down"));

    renderView({ role: "ADMIN" });
    clickTab(/api keys/i);

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});

describe("SettingsView — provider key management", () => {
  it("shows an input for an unconfigured provider and commits the key on blur", () => {
    const updateProviderSettings = vi.fn();
    vi.mocked(useApiKeys).mockReturnValue({
      isProviderConfigured: () => false,
      updateProviderSettings,
      removeProviderSettings: vi.fn(),
    } as never);

    renderView();
    clickTab(/providers/i);

    const input = screen.getByLabelText("OpenAI API key");
    fireEvent.change(input, { target: { value: "sk-abc123" } });
    fireEvent.blur(input);

    expect(updateProviderSettings).toHaveBeenCalledWith("openai", {
      apiKey: "sk-abc123",
      isEnabled: true,
    });
  });

  it("does not commit an empty draft on blur", () => {
    const updateProviderSettings = vi.fn();
    vi.mocked(useApiKeys).mockReturnValue({
      isProviderConfigured: () => false,
      updateProviderSettings,
      removeProviderSettings: vi.fn(),
    } as never);

    renderView();
    clickTab(/providers/i);

    fireEvent.blur(screen.getByLabelText("OpenAI API key"));

    expect(updateProviderSettings).not.toHaveBeenCalled();
  });

  it("shows Configured + Remove for a configured provider and removes it", () => {
    const removeProviderSettings = vi.fn();
    vi.mocked(useApiKeys).mockReturnValue({
      isProviderConfigured: (id: string) => id === "openai",
      updateProviderSettings: vi.fn(),
      removeProviderSettings,
    } as never);

    renderView();
    clickTab(/providers/i);

    expect(screen.getByText("Configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(removeProviderSettings).toHaveBeenCalledWith("openai");
  });

  it("updates the expiry date for a configured provider via the fetcher", () => {
    vi.mocked(useApiKeys).mockReturnValue({
      isProviderConfigured: (id: string) => id === "openai",
      updateProviderSettings: vi.fn(),
      removeProviderSettings: vi.fn(),
    } as never);

    renderView({ providerExpiries: { openai: "2027-01-01" } });
    clickTab(/providers/i);

    const expiryInput = screen.getByLabelText("OpenAI key expiry date") as HTMLInputElement;
    expect(expiryInput.value).toBe("2027-01-01");

    fireEvent.change(expiryInput, { target: { value: "2028-01-01" } });
    expect(expiryInput.value).toBe("2028-01-01");

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect((screen.getByLabelText("OpenAI key expiry date") as HTMLInputElement).value).toBe("");
  });

  it("enables and disables Ollama", () => {
    const updateProviderSettings = vi.fn();
    const removeProviderSettings = vi.fn();
    vi.mocked(useApiKeys).mockReturnValue({
      isProviderConfigured: () => false,
      updateProviderSettings,
      removeProviderSettings,
    } as never);

    renderView();
    clickTab(/providers/i);

    fireEvent.click(screen.getByRole("button", { name: /enable ollama/i }));
    expect(updateProviderSettings).toHaveBeenCalledWith("ollama", { isEnabled: true });
  });

  it("shows Enabled + Disable when ollama is configured", () => {
    vi.mocked(useApiKeys).mockReturnValue({
      isProviderConfigured: (id: string) => id === "ollama",
      updateProviderSettings: vi.fn(),
      removeProviderSettings: vi.fn(),
    } as never);

    renderView();
    clickTab(/providers/i);

    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable/i })).toBeInTheDocument();
  });
});
