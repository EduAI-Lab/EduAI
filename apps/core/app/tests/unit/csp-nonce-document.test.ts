// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AppLoadContext, EntryContext } from "react-router";

/**
 * Regression guard for #1219.
 *
 * Runs in `node`, not the suite-wide `happy-dom`: this asserts on server-render
 * output, and next-themes only emits its nonce when `typeof window ===
 * "undefined"` — under happy-dom it would render `nonce=""` and the theme
 * assertion would fail against a browser-shaped global that SSR never sees.
 *
 * Under `script-src 'self' 'nonce-…' 'strict-dynamic'` every inline `<script>`
 * in a document response has to carry the request nonce, or the browser drops
 * it. Three of them were being dropped: React Router's SSR data-stream scripts
 * (`streamController.enqueue` / `.close()`), which take their nonce from the
 * `nonce` prop on `<ServerRouter>` — not from `<Scripts nonce>` — and
 * next-themes' no-flash script, which takes it from `<ThemeProvider nonce>`.
 * Both are plain prop drilling, so nothing stops a future provider from
 * reintroducing the bug silently. Hence: render the real document through
 * `entry.server`'s `handleRequest` and assert *every* inline script is nonced
 * with the nonce the response's own CSP actually allows.
 */

// `root.tsx` reaches for the DB, better-auth, and the cron scheduler at import
// time. Only its `loader` calls them — `Layout`, the part under test, does not —
// so stub them rather than standing up a database for a render test.
vi.mock("~/lib/prisma.server", () => ({
  default: { userPreference: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("~/lib/policy.server", () => ({ getPolicies: vi.fn() }));
vi.mock("~/lib/auth/password-expiry.server", () => ({
  getExpiredPasswordRedirect: vi.fn(),
}));
import handleRequest from "~/entry.server";
import * as rootRouteModule from "~/root";

const ROOT_LOADER_DATA = {
  assistive: false,
  motionReduced: false,
  density: "comfortable",
  theme: "system",
  canInvite: false,
  policies: {},
};

/**
 * `<ServerRouter>` only renders the `StreamTransfer` scripts when
 * `serverHandoffStream` is present, so the stream has to be real or the
 * assertion below would pass vacuously. Chunk contents are irrelevant — the
 * scripts wrap whatever bytes come through.
 */
function serverHandoffStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('[{"_1":2},"loaderData",{}]'),
    encoder.encode('["tail"]'),
  ];
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Minimal `EntryContext` wired to the *real* root route module, so the document
 * under test is the one `root.tsx` actually produces.
 */
function entryContext(): EntryContext {
  const location = {
    pathname: "/",
    search: "",
    hash: "",
    state: null,
    key: "test",
  };

  return {
    manifest: {
      entry: { module: "/entry.client.js", imports: [] },
      routes: {
        root: {
          id: "root",
          path: "/",
          module: "/root.js",
          hasAction: false,
          hasLoader: true,
          hasClientAction: false,
          hasClientLoader: false,
          hasClientMiddleware: false,
          hasErrorBoundary: true,
        },
      },
      url: "/manifest.js",
      version: "test",
    },
    routeModules: { root: rootRouteModule },
    staticHandlerContext: {
      actionData: null,
      actionHeaders: {},
      basename: undefined,
      errors: null,
      loaderData: { root: ROOT_LOADER_DATA },
      loaderHeaders: {},
      location,
      matches: [
        {
          params: {},
          pathname: "/",
          pathnameBase: "/",
          route: { id: "root", path: "/", hasErrorBoundary: true },
        },
      ],
      statusCode: 200,
    },
    future: {},
    ssr: true,
    isSpaMode: false,
    routeDiscovery: { mode: "initial" as const },
    renderMeta: {},
    serverHandoffString: JSON.stringify({ ssr: true, isSpaMode: false }),
    serverHandoffStream: serverHandoffStream(),
    // `EntryContext` is the framework's own build-time shape (full asset
    // manifest, route-module types); this is the hand-rolled minimum that
    // `<ServerRouter>` actually reads, so it needs the widening cast.
  } as unknown as EntryContext;
}

/** Every `src`-less (i.e. inline) `<script>` in the document, tag and body. */
function inlineScripts(html: string): { tag: string; body: string }[] {
  const matches = html.matchAll(
    /<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g,
  );
  return [...matches].map((m) => ({ tag: `<script${m[1]}>`, body: m[2] }));
}

async function renderDocument() {
  // `handleRequest` reads NODE_ENV per call, and only emits the nonce CSP in
  // prod — we want the real header so the nonce can be cross-checked against it.
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = (await handleRequest(
      new Request("http://localhost/"),
      200,
      new Headers(),
      entryContext(),
      {} as AppLoadContext,
    )) as Response;

    return { response, html: await response.text() };
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
}

describe("CSP nonce on document inline scripts (#1219)", () => {
  it("nonces every inline script with the nonce its own CSP allows", async () => {
    const { response, html } = await renderDocument();

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, `no nonce in CSP: ${csp}`).toBeTruthy();

    const scripts = inlineScripts(html);
    // Guard the guard: if the document stops emitting inline scripts entirely,
    // "all of them are nonced" would be trivially true.
    expect(scripts.length).toBeGreaterThanOrEqual(4);

    const unnonced = scripts
      .filter(({ tag }) => !tag.includes(`nonce="${nonce}"`))
      .map(({ body }) => body.slice(0, 80));
    expect(unnonced, "inline scripts missing the CSP nonce").toEqual([]);
  });

  it("nonces the SSR data-stream scripts React Router emits", async () => {
    // These come from `<ServerRouter nonce>`, not `<Scripts nonce>`. Unnonced,
    // the stream never closes and the client throws away the SSR payload.
    const { response, html } = await renderDocument();
    const nonce = (response.headers.get("Content-Security-Policy") ?? "").match(
      /'nonce-([^']+)'/,
    )?.[1];

    const streamScripts = inlineScripts(html).filter(({ body }) =>
      body.includes("window.__reactRouterContext.streamController"),
    );

    expect(streamScripts.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("window.__reactRouterContext.streamController.close");
    for (const { tag } of streamScripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  it("nonces the theme no-flash scripts", async () => {
    // The hand-written one in `root.tsx`'s <head> plus next-themes' own, which
    // only gets a nonce because `<ThemeProvider nonce>` forwards it.
    const { response, html } = await renderDocument();
    const nonce = (response.headers.get("Content-Security-Policy") ?? "").match(
      /'nonce-([^']+)'/,
    )?.[1];

    const themeScripts = inlineScripts(html).filter(
      ({ body }) =>
        body.includes("colorScheme") || body.includes("classList"),
    );

    expect(themeScripts.length).toBeGreaterThanOrEqual(1);
    for (const { tag } of themeScripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });
});
