/**
 * Ensures Canvas integration routes require authentication (no DB).
 */
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app.js";

let server;

beforeAll(() => {
  // Reuse one real listener for the route matrix. Creating and closing a new
  // ephemeral listener for every Supertest request is flaky on Node 24 and can
  // surface intermittent HTTP parser/ECONNRESET errors unrelated to auth.
  server = app.listen(0);
});

afterAll(
  () =>
    new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const expect401 = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ success: false });
};

describe("GET /api/canvas/* without token", () => {
  it("rejects /integration", async () => {
    const res = await request(server).get("/api/canvas/integration");
    expect401(res);
  });

  it("rejects /courses", async () => {
    const res = await request(server).get("/api/canvas/courses");
    expect401(res);
  });

  it("rejects /mapping/:courseId", async () => {
    const res = await request(server).get("/api/canvas/mapping/1");
    expect401(res);
  });

  it("rejects /courses/:id/quizzes", async () => {
    const res = await request(server).get("/api/canvas/courses/1/quizzes");
    expect401(res);
  });

  it("rejects /courses/.../questions", async () => {
    const res = await request(server).get("/api/canvas/courses/1/quizzes/2/questions");
    expect401(res);
  });
});

describe("POST /api/canvas/* without token", () => {
  it("rejects /connect", async () => {
    const res = await request(server)
      .post("/api/canvas/connect")
      .send({ canvasUrl: "https://canvas.example.com" });
    expect401(res);
  });

  it("rejects /export/:assessmentId", async () => {
    const res = await request(server).post("/api/canvas/export/1").send({ canvasCourseId: 1 });
    expect401(res);
  });

  it("rejects /import/.../quizzes/...", async () => {
    const res = await request(server)
      .post("/api/canvas/import/1/quizzes/2")
      .send({ localCourseId: 1 });
    expect401(res);
  });
});

describe("DELETE /api/canvas/* without token", () => {
  it("rejects /disconnect", async () => {
    const res = await request(server).delete("/api/canvas/disconnect");
    expect401(res);
  });
});
