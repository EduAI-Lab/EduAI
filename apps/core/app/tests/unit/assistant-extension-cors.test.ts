// @vitest-environment node
/**
 * #1958: the root middleware's CORS for Penny in AI Tutor and Question Maker.
 * Only the assistant endpoints, and only the configured extension origins;
 * every other route keeps refusing cross-origin cookie mutations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "~/root";

const AI_TUTOR = "https://aitutor.eduai.example";
const QUESTION_MAKER = "https://questionmaker.eduai.example";
const COOKIE = "better-auth.session_token=secret";

function run(request: Request, next = vi.fn(async () => new Response("{}", { status: 200 }))) {
  // oxlint-disable-next-line typescript/no-explicit-any -- same harness as security-headers.test.ts
  return { next, res: (middleware[0] as any)({ request }, next) as Promise<Response> };
}

beforeEach(() => {
  vi.stubEnv("VITE_AI_TUTOR_URL", `${AI_TUTOR}/`);
  vi.stubEnv("VITE_QUESTION_MAKER_URL", QUESTION_MAKER);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assistant CORS", () => {
  it.each([AI_TUTOR, QUESTION_MAKER])("answers a preflight from %s itself", async (origin) => {
    const { next, res } = run(
      new Request("https://eduai.example/api/assistant/ask", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      }),
    );
    const response = await res;
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(next).not.toHaveBeenCalled();
  });

  it("lets an extension's cookie-authenticated ask through and labels the response", async () => {
    const { next, res } = run(
      new Request("https://eduai.example/api/assistant/ask", {
        method: "POST",
        headers: { Origin: AI_TUTOR, Cookie: COOKIE, "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    const response = await res;
    expect(next).toHaveBeenCalledOnce();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(AI_TUTOR);
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("covers the gate", async () => {
    const response = await run(
      new Request("https://eduai.example/api/assistant/gate", {
        headers: { Origin: QUESTION_MAKER },
      }),
    ).res;
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(QUESTION_MAKER);
  });

  it("labels a thrown Response too", async () => {
    const next = vi.fn(async () => {
      throw new Response(null, { status: 401 });
    });
    const thrown = await run(
      new Request("https://eduai.example/api/assistant/gate", {
        headers: { Origin: AI_TUTOR },
      }),
      next,
    ).res.then(
      () => null,
      (error: Response) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown?.headers.get("Access-Control-Allow-Origin")).toBe(AI_TUTOR);
  });

  it.each([
    "/api/assistant/settings",
    "/api/assistant/settings/models",
    "/api/assistant/settings/reset",
  ])("keeps %s same-origin", async (path) => {
    const read = await run(
      new Request(`https://eduai.example${path}`, { headers: { Origin: AI_TUTOR } }),
    ).res;
    expect(read.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const { next, res } = run(
      new Request(`https://eduai.example${path}`, {
        method: "POST",
        headers: { Origin: AI_TUTOR, Cookie: COOKIE, "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect((await res).status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("gives an unlisted origin no CORS headers", async () => {
    const response = await run(
      new Request("https://eduai.example/api/assistant/gate", {
        headers: { Origin: "https://evil.example" },
      }),
    ).res;
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("still refuses an unlisted origin's cookie mutation on an assistant endpoint", async () => {
    const { next, res } = run(
      new Request("https://eduai.example/api/assistant/ask", {
        method: "POST",
        headers: { Origin: "https://evil.example", Cookie: COOKIE },
      }),
    );
    expect((await res).status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not open any other route to the extension origins", async () => {
    const { next, res } = run(
      new Request("https://eduai.example/api/questions", {
        method: "POST",
        headers: { Origin: AI_TUTOR, Cookie: COOKIE },
      }),
    );
    const response = await res;
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  it("allows nothing, and warns, when the extension URLs are unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VITE_AI_TUTOR_URL", "");
    vi.stubEnv("VITE_QUESTION_MAKER_URL", "");
    const response = await run(
      new Request("https://eduai.example/api/assistant/ask", {
        method: "OPTIONS",
        headers: { Origin: AI_TUTOR },
      }),
    ).res;
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
