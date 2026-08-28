import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  isRouteErrorResponse: vi.fn(),
  Links: ({ nonce }: { nonce?: string }) => (
    <meta data-testid="links-nonce" content={nonce ?? ""} />
  ),
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
import { NonceProvider } from "~/lib/nonce";

describe("root Layout", () => {
  it("renders the document shell without requiring route loader context", () => {
    const markup = renderToString(
      <NonceProvider value="request-nonce">
        <Layout>
          <main>Settings</main>
        </Layout>
      </NonceProvider>,
    );

    expect(markup).toContain("<html");
    expect(markup).toContain("<main>Settings</main>");
    expect(markup).toContain('data-testid="links-nonce" content="request-nonce"');
    expect(markup).toContain('rel="icon" href="/eduai-graduation.svg"');
  });
});
