// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatApiError, jsonResponse } from "~/lib/api/json-response.server";

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

describe("formatApiError", () => {
  it("maps P2022 to a migration hint", () => {
    const result = formatApiError({ code: "P2022" });
    expect(result.error).toContain("Database schema is out of date");
    expect(result.hint).toContain("prisma migrate deploy");
  });

  it("maps P2021 to a migration hint", () => {
    const result = formatApiError({ code: "P2021" });
    expect(result.error).toBe("Database table not found.");
    expect(result.hint).toContain("prisma migrate deploy");
  });

  it("passes through other prisma-like error codes as-is", () => {
    const result = formatApiError({ code: "P9999", message: "boom" });
    expect(result).toEqual({ error: "Unexpected server error" });
  });

  it("maps a missing embeddingProvider argument to a generate hint", () => {
    const result = formatApiError(
      new Error("Unknown argument `embeddingProvider`. Available options are marked with ?."),
    );
    expect(result.error).toContain("Prisma client is out of date");
    expect(result.hint).toContain("prisma generate");
  });

  it("maps a missing findFirst model to a generate + migrate hint", () => {
    const result = formatApiError(new TypeError("Cannot read properties of undefined (reading 'findFirst')"));
    expect(result.error).toContain("missing generated models");
    expect(result.hint).toContain("prisma migrate deploy");
  });

  it("handles the double-quoted findFirst message variant", () => {
    const result = formatApiError(new Error(`reading "findFirst"`));
    expect(result.error).toContain("missing generated models");
  });

  it("falls back to the error message for a plain Error", () => {
    const result = formatApiError(new Error("something broke"));
    expect(result).toEqual({ error: "something broke" });
  });

  it("returns a generic message for a non-object, non-Error value", () => {
    expect(formatApiError("just a string")).toEqual({ error: "Unexpected server error" });
    expect(formatApiError(null)).toEqual({ error: "Unexpected server error" });
    expect(formatApiError(undefined)).toEqual({ error: "Unexpected server error" });
  });
});
