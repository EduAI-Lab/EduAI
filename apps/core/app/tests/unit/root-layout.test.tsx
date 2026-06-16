import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  isRouteErrorResponse: vi.fn(),
  Links: () => null,
  Meta: () => null,
  Outlet: () => null,
  Scripts: () => null,
  ScrollRestoration: () => null,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: { userPreference: { findUnique: vi.fn() } },
}));

import { Layout } from "~/root";

describe("root Layout", () => {
  it("renders the document shell without requiring route loader context", () => {
    const markup = renderToString(
      <Layout>
        <main>Settings</main>
      </Layout>,
    );

    expect(markup).toContain("<html");
    expect(markup).toContain("<main>Settings</main>");
  });
});
