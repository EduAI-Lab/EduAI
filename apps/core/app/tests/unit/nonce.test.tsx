import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  NonceProvider,
  readDocumentNonce,
  useNonce,
} from "~/lib/nonce";

function NoncedShell() {
  const nonce = useNonce();
  return (
    <div data-nonce={nonce}>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "void 0" }} />
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CSP nonce propagation", () => {
  it("reads the browser nonce property from an existing SSR script", () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "attribute-nonce");
    Object.defineProperty(script, "nonce", {
      configurable: true,
      value: "property-nonce",
    });
    document.body.append(script);

    expect(readDocumentNonce()).toBe("property-nonce");
  });

  it("falls back to the nonce attribute for DOM implementations without the property", () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "attribute-nonce");
    document.body.append(script);

    expect(readDocumentNonce()).toBe("attribute-nonce");
  });

  it("hydrates the server nonce without a React mismatch warning", async () => {
    const nonce = "request-nonce";
    const serverMarkup = renderToString(
      <NonceProvider value={nonce}>
        <NoncedShell />
      </NonceProvider>,
    );
    const container = document.createElement("main");
    container.innerHTML = serverMarkup;
    document.body.append(container);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = hydrateRoot(
      container,
      <NonceProvider value={readDocumentNonce()}>
        <NoncedShell />
      </NonceProvider>,
    );

    // React reports hydration attribute mismatches through console.error.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const hydrationWarnings = errorSpy.mock.calls.filter(([message]) =>
      /hydration|server rendered HTML|did not match/i.test(String(message)),
    );
    expect(hydrationWarnings).toEqual([]);
    expect(container.querySelector("[data-nonce]")?.getAttribute("data-nonce")).toBe(nonce);

    root.unmount();
    errorSpy.mockRestore();
  });
});
