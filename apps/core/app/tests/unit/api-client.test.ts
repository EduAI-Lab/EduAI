// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readJsonResponse } from "~/lib/api/client";

describe("readJsonResponse", () => {
  it("parses a valid JSON body", async () => {
    const response = new Response(JSON.stringify({ hello: "world" }), { status: 200 });
    const result = await readJsonResponse<{ hello: string }>(response);
    expect(result).toEqual({ ok: true, data: { hello: "world" } });
  });

  it("reports an empty ok response as an error", async () => {
    const response = new Response("", { status: 200 });
    const result = await readJsonResponse(response);
    expect(result).toEqual({ ok: false, error: "Empty response" });
  });

  it("reports an empty non-ok response with its status", async () => {
    const response = new Response("", { status: 503 });
    const result = await readJsonResponse(response);
    expect(result).toEqual({ ok: false, error: "Request failed (503)" });
  });

  it("reports invalid JSON on an ok response", async () => {
    const response = new Response("<html>not json</html>", { status: 200 });
    const result = await readJsonResponse(response);
    expect(result).toEqual({ ok: false, error: "Server returned invalid JSON" });
  });

  it("returns a snippet of an HTML error page on a non-ok response", async () => {
    const response = new Response("<html>\n  <body>Internal Error</body>\n</html>", {
      status: 500,
    });
    const result = await readJsonResponse(response);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Internal Error");
    }
  });

  it("falls back to the status code when the non-ok snippet is blank", async () => {
    const response = new Response("   ", { status: 502 });
    const result = await readJsonResponse(response);
    expect(result).toEqual({ ok: false, error: "Request failed (502)" });
  });
});
