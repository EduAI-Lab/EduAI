import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeProfessor } from "../helpers.js";

// A body comfortably over `compression`'s 1kb default threshold, and repetitive
// enough to stand in for the real payloads this middleware exists for: course
// trees and lesson `contentMd` markdown.
const BIG_BODY = { contentMd: "## Lesson heading\n\nSome tutoring content.\n".repeat(200) };

async function buildApp() {
  const { createApp } = await import("../../src/app.js");
  const app = await createApp({ mockUser: makeProfessor() });

  // Probe routes registered after `createApp` still sit behind the middleware
  // stack it built, so they exercise the real compression config.
  app.get("/api/__compression_probe__", (_req, res) => res.json(BIG_BODY));
  app.get("/api/__sse_probe__", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.send(`data: ${JSON.stringify(BIG_BODY)}\n\n`);
  });

  return app;
}

beforeEach(() => {
  vi.resetModules();
});

describe("response compression", () => {
  it("gzips a large JSON response when the client accepts gzip", async () => {
    const app = await buildApp();

    const res = await request(app).get("/api/__compression_probe__").set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    // supertest transparently inflates the body, so the payload must survive.
    expect(res.body).toEqual(BIG_BODY);
  });

  it("sends the large response uncompressed when the client does not accept gzip", async () => {
    const app = await buildApp();

    const res = await request(app)
      .get("/api/__compression_probe__")
      .set("Accept-Encoding", "identity");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body).toEqual(BIG_BODY);
  });

  it("leaves small responses like /api/health uncompressed", async () => {
    const app = await buildApp();

    const res = await request(app).get("/api/health").set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("never compresses text/event-stream, so a future SSE route cannot buffer", async () => {
    const app = await buildApp();

    const res = await request(app).get("/api/__sse_probe__").set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });
});
