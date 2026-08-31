// @vitest-environment node
import { describe, expect, it } from "vitest";
import { jsonResponse } from "~/lib/api/json-response.server";

describe("jsonResponse", () => {
  it("serializes the body as JSON with a 200 default status", async () => {
    const response = jsonResponse({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("honors an explicit status", async () => {
    const response = jsonResponse({ error: "nope" }, 400);
    expect(response.status).toBe(400);
  });
});
