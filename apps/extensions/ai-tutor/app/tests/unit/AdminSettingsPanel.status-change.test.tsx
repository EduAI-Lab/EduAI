/**
 * @file The admin console renders the key-source badge from the loader, and the
 * loader is not revalidated after a save. Without `onStatusChange` the badge
 * kept claiming ".env" once an override had been saved, so the panel reporting
 * every status change is the contract this pins — for both save and clear.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminSettingsLoaderData } from "~/lib/admin-settings";
import type { EduAiApiKeyStatus } from "~/lib/types";
import { AdminSettingsPanel } from "~/components/admin/AdminSettingsPanel";

const setEduAiApiKey = vi.fn();
const clearEduAiApiKey = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    setEduAiApiKey: (...args: unknown[]) => setEduAiApiKey(...args),
    clearEduAiApiKey: (...args: unknown[]) => clearEduAiApiKey(...args),
  },
}));

const ENV_STATUS: EduAiApiKeyStatus = {
  configured: true,
  source: "ENV",
  hasAdminOverride: false,
  envConfigured: true,
  updatedAt: null,
};

const ADMIN_STATUS: EduAiApiKeyStatus = {
  configured: true,
  source: "ADMIN",
  hasAdminOverride: true,
  envConfigured: true,
  updatedAt: "2026-08-20T12:00:00.000Z",
};

function loaderData(status: EduAiApiKeyStatus = ENV_STATUS): AdminSettingsLoaderData {
  return {
    status,
    aiPolicy: null,
    aiModels: [],
    aiPolicyAvailable: false,
    aiPolicyError: null,
  };
}

function renderPanel(status?: EduAiApiKeyStatus) {
  const onStatusChange = vi.fn();
  render(<AdminSettingsPanel loaderData={loaderData(status)} onStatusChange={onStatusChange} />);
  return { onStatusChange };
}

describe("AdminSettingsPanel — reporting the key status upwards", () => {
  it("reports the new status after a key is saved", async () => {
    setEduAiApiKey.mockResolvedValue(ADMIN_STATUS);
    const { onStatusChange } = renderPanel();

    fireEvent.change(screen.getByPlaceholderText("Paste EDUAI API key"), {
      target: { value: "sk-test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(ADMIN_STATUS));
    expect(setEduAiApiKey).toHaveBeenCalledWith("sk-test-key");
  });

  it("reports the new status after the override is cleared", async () => {
    clearEduAiApiKey.mockResolvedValue(ENV_STATUS);
    const { onStatusChange } = renderPanel(ADMIN_STATUS);

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(ENV_STATUS));
  });

  it("says nothing upwards when the save fails", async () => {
    setEduAiApiKey.mockRejectedValue(new Error("nope"));
    const { onStatusChange } = renderPanel();

    fireEvent.change(screen.getByPlaceholderText("Paste EDUAI API key"), {
      target: { value: "sk-test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(setEduAiApiKey).toHaveBeenCalled());
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
