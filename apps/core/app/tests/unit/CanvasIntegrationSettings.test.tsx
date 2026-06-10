import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CanvasIntegrationSettings } from "~/components/canvas/CanvasIntegrationSettings";
import {
  connectCanvas,
  disconnectCanvas,
  getCanvasIntegration,
} from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  getCanvasIntegration: vi.fn(),
  connectCanvas: vi.fn(),
  disconnectCanvas: vi.fn(),
}));

const connectedIntegration = {
  canvasUrl: "http://localhost:8080",
  isTestMode: false,
  isConnected: true as const,
};

describe("CanvasIntegrationSettings — rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCanvasIntegration).mockResolvedValue(null);
  });

  it("renders the card title and form after loading", async () => {
    render(<CanvasIntegrationSettings />);

    expect(screen.getByText(/loading canvas status/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Canvas Integration")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Canvas instance URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeInTheDocument();
  });

  it("shows connected status when integration exists", async () => {
    vi.mocked(getCanvasIntegration).mockResolvedValue(connectedIntegration);

    render(<CanvasIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("http://localhost:8080")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update connection" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync courses" })).not.toBeInTheDocument();
  });
});

describe("CanvasIntegrationSettings — connect form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCanvasIntegration).mockResolvedValue(null);
  });

  it("disables Connect Canvas until URL and token are provided", async () => {
    render(<CanvasIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "1234~secret-token" },
    });

    expect(screen.getByRole("button", { name: "Connect Canvas" })).not.toBeDisabled();
  });

  it("allows connect in test mode without a token", async () => {
    render(<CanvasIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeDisabled();
    });

    fireEvent.click(screen.getByLabelText("Test mode (no real Canvas token required)"));

    expect(screen.getByLabelText("Personal access token")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect Canvas" })).not.toBeDisabled();
  });

  it("calls connectCanvas with trimmed URL and token", async () => {
    vi.mocked(connectCanvas).mockResolvedValue(connectedIntegration);

    render(<CanvasIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Canvas instance URL"), {
      target: { value: " http://localhost:8080 " },
    });
    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "1234~secret-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() => {
      expect(connectCanvas).toHaveBeenCalledWith({
        canvasUrl: "http://localhost:8080",
        apiKey: "1234~secret-token",
        isTestMode: false,
      });
    });

    expect(
      screen.getByText(/canvas connected\. your api key is stored encrypted/i),
    ).toBeInTheDocument();
  });

  it("calls connectCanvas in test mode without apiKey", async () => {
    vi.mocked(connectCanvas).mockResolvedValue({
      canvasUrl: "http://localhost:8080",
      isTestMode: true,
      isConnected: true,
    });

    render(<CanvasIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Test mode (no real Canvas token required)"));
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() => {
      expect(connectCanvas).toHaveBeenCalledWith({
        canvasUrl: expect.any(String),
        apiKey: undefined,
        isTestMode: true,
      });
    });

    expect(screen.getByText("Canvas test mode enabled.")).toBeInTheDocument();
  });

  it("shows an error when connect fails", async () => {
    vi.mocked(connectCanvas).mockRejectedValue(new Error("Invalid Canvas API token"));

    render(<CanvasIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "bad-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid Canvas API token")).toBeInTheDocument();
    });
  });
});

describe("CanvasIntegrationSettings — disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCanvasIntegration).mockResolvedValue(connectedIntegration);
    vi.mocked(disconnectCanvas).mockResolvedValue(undefined);
  });

  it("calls disconnectCanvas when the disconnect control is clicked", async () => {
    render(<CanvasIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Canvas" }));

    await waitFor(() => {
      expect(disconnectCanvas).toHaveBeenCalled();
    });

    expect(screen.getByText("Canvas disconnected.")).toBeInTheDocument();
  });
});
