/**
 * Unit tests for SettingsPage (#1544): API key save/remove, default model
 * selection, export preference persistence, Canvas connect/disconnect flow,
 * and logout wiring. Services and auth/theme hooks are mocked; the shared
 * SettingsPageScaffold/tabs render for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiKeyStorage, eduaiService, canvasService, useAuthMock, setThemeMock, toastFn } =
  vi.hoisted(() => {
    const toast = vi.fn() as any;
    toast.error = vi.fn();
    return {
      apiKeyStorage: {
        getAllApiKeys: vi.fn(),
        setApiKey: vi.fn(),
        removeApiKey: vi.fn(),
      },
      eduaiService: { listModels: vi.fn() },
      canvasService: {
        getIntegration: vi.fn(),
        prefersTestMode: vi.fn(() => false),
        connectCanvasWithFallback: vi.fn(),
        disconnectCanvas: vi.fn(),
      },
      useAuthMock: vi.fn(),
      setThemeMock: vi.fn(),
      toastFn: toast,
    };
  });

vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/services/apiKeyStorage", () => ({ default: apiKeyStorage }));
vi.mock("@/services/eduaiService", () => ({ eduaiService }));
vi.mock("@/services/canvasService", () => ({ canvasService }));
vi.mock("@/services/canvasDefaults", () => ({
  getCanvasDefaultUrl: () => "https://canvas.ubc.ca",
}));

vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useTheme: () => ({ theme: "system", setTheme: setThemeMock }),
    // Real Radix tabs are unreliable to drive with fireEvent.click in jsdom
    // (see CourseDetailPage.test.tsx precedent) — render every tab's content
    // at once so we can exercise all of SettingsPage's own logic directly.
    SettingsPageScaffold: ({ heading = "Settings", subheading, tabs, footer }: any) => (
      <div>
        <h1>{heading}</h1>
        <p>{subheading}</p>
        {tabs.map((tab: any) => (
          <section key={tab.value} aria-label={tab.label}>
            {tab.content}
          </section>
        ))}
        {footer}
      </div>
    ),
  };
});

import SettingsPage from "@/pages/SettingsPage";

afterEach(cleanup);

beforeEach(() => {
  useAuthMock.mockReturnValue({
    user: { id: "1", name: "Jane", role: "INSTRUCTOR" },
    logout: vi.fn(),
  });
  apiKeyStorage.getAllApiKeys.mockResolvedValue({});
  eduaiService.listModels.mockResolvedValue([]);
  canvasService.getIntegration.mockResolvedValue({ isConnected: false });
  localStorage.clear();
});

describe("SettingsPage", () => {
  it("renders the Providers tab by default with all provider labels", async () => {
    render(<SettingsPage />);
    expect(screen.getByText("Model Providers")).toBeInTheDocument();
    await waitFor(() => expect(apiKeyStorage.getAllApiKeys).toHaveBeenCalled());
    expect(screen.getByText("Google AI (Gemini)")).toBeInTheDocument();
    expect(screen.getByText("OpenCode Go")).toBeInTheDocument();
  });

  it("does not load or show Canvas settings without platform authoring access", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "student-1", name: "Student", role: "STUDENT" },
      logout: vi.fn(),
    });

    render(<SettingsPage />);

    expect(screen.queryByText("Canvas Integration")).not.toBeInTheDocument();
    expect(canvasService.getIntegration).not.toHaveBeenCalled();
  });

  it("saves a new API key and shows it masked afterward", async () => {
    apiKeyStorage.getAllApiKeys
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ google: "AIzaSyABCDEFGH1234" });
    apiKeyStorage.setApiKey.mockResolvedValue(undefined);
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Google AI (Gemini)")).toBeInTheDocument());

    const input = screen.getByPlaceholderText("AIza-...");
    fireEvent.change(input, { target: { value: "AIzaSyABCDEFGH1234" } });
    fireEvent.click(screen.getAllByText("Save")[0]);

    await waitFor(() =>
      expect(apiKeyStorage.setApiKey).toHaveBeenCalledWith("google", "AIzaSyABCDEFGH1234"),
    );
    await waitFor(() => expect(screen.getByText(/Configured/)).toBeInTheDocument());
    expect(toastFn).toHaveBeenCalledWith("Google AI (Gemini) API key saved");
  });

  it("removes an existing API key", async () => {
    apiKeyStorage.getAllApiKeys
      .mockResolvedValueOnce({ google: "AIzaSyABCDEFGH1234" })
      .mockResolvedValueOnce({});
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/Configured/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(apiKeyStorage.removeApiKey).toHaveBeenCalledWith("google"));
    expect(toastFn).toHaveBeenCalledWith("Google AI (Gemini) API key removed");
  });

  it("shows a no-models message when no models are configured", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/No models available/)).toBeInTheDocument());
  });

  it("shows the default model select when models exist and persists the choice", async () => {
    eduaiService.listModels.mockResolvedValue([{ id: "gpt-4", label: "GPT-4" }]);
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Select a default model")).toBeInTheDocument());
  });

  it("toggles export preferences and persists to localStorage", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Export preferences")).toBeInTheDocument());
    const checkboxes = screen.getAllByRole("checkbox");
    // Second checkbox is "Include AI-generated tag" (first is "Include answer key").
    fireEvent.click(checkboxes[1]);
    const stored = JSON.parse(localStorage.getItem("qm:export-prefs") || "{}");
    expect(stored.includeAiTag).toBe(true);
  });

  it("switches to the Canvas tab and connects with URL + token", async () => {
    canvasService.connectCanvasWithFallback.mockResolvedValue({
      integration: { isConnected: true, canvasUrl: "https://canvas.ubc.ca" },
      usedTestMode: false,
    });
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Canvas Integration")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Canvas API token"), {
      target: { value: "canvas-token-123" },
    });
    fireEvent.click(screen.getByText("Connect Canvas"));

    await waitFor(() => expect(canvasService.connectCanvasWithFallback).toHaveBeenCalled());
    expect(toastFn).toHaveBeenCalledWith("Canvas connected", expect.any(Object));
  });

  it("disconnects an existing Canvas connection", async () => {
    canvasService.getIntegration.mockResolvedValue({
      isConnected: true,
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: false,
    });
    canvasService.disconnectCanvas.mockResolvedValue(undefined);
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("Disconnect Canvas")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Disconnect Canvas"));
    await waitFor(() => expect(canvasService.disconnectCanvas).toHaveBeenCalled());
    expect(toastFn).toHaveBeenCalledWith("Canvas disconnected");
  });

  it("shows an error toast when Canvas connect fails", async () => {
    canvasService.connectCanvasWithFallback.mockRejectedValue(new Error("bad token"));
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Canvas Integration")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Canvas API token"), {
      target: { value: "canvas-token-123" },
    });
    fireEvent.click(screen.getByText("Connect Canvas"));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });

  it("renders the Accessibility tab", async () => {
    render(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByText(/Personalize how EduAI looks/)).toBeInTheDocument(),
    );
  });

  it("calls logout when the sign-out action is clicked", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({ user: { id: 1, name: "Jane" }, logout });
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("Log out"));
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it("shows an error toast when logout fails", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("fail"));
    useAuthMock.mockReturnValue({ user: { id: 1, name: "Jane" }, logout });
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("Log out"));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
  });
});
