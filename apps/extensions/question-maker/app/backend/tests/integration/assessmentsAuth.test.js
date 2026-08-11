/**
 * Ensures assessment routes require authentication (no DB).
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const expect401 = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ success: false });
};

describe("GET /api/assessments without token", () => {
  it("rejects list", async () => {
    const res = await request(app).get("/api/assessments");
    expect401(res);
  });

  it("rejects by id", async () => {
    const res = await request(app).get("/api/assessments/1");
    expect401(res);
  });
});

describe("POST /api/assessments without token", () => {
  it("rejects create", async () => {
    const res = await request(app)
      .post("/api/assessments")
      .send({ type: "Quiz", name: "X", semester: "Fall 2026", courseId: 1 });
    expect401(res);
  });
});
