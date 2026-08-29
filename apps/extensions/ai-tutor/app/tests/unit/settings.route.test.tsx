import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const mockRequireClientUser = vi.fn().mockResolvedValue({ id: "u1", role: "STUDENT" });
vi.mock("~/lib/client-auth", () => ({
  requireClientUser: (...args: unknown[]) => mockRequireClientUser(...args),
}));

const mockUseShellBreadcrumbs = vi.fn();
vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: (...args: unknown[]) => mockUseShellBreadcrumbs(...args),
  ShellBreadcrumbContext: {},
}));

vi.mock("~/components/settings/settings-view", () => ({
  SettingsView: () => <div data-testid="settings-view" />,
}));

import SettingsPage, { clientLoader } from "~/routes/settings";

describe("settings route", () => {
  it("allows any authenticated user in the loader and returns an empty object", async () => {
    await expect(clientLoader({} as never)).resolves.toEqual({});
    expect(mockRequireClientUser).toHaveBeenCalledWith();
  });

  it("publishes a Settings breadcrumb and renders SettingsView", () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(mockUseShellBreadcrumbs).toHaveBeenCalledWith([{ label: "Settings" }]);
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
  });
});
