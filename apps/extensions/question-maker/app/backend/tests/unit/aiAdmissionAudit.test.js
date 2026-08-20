import express from "express";
import http from "node:http";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/settings.js", () => ({
  config: {
    qmAiRateLimitWindowMs: 60_000,
    qmAiRateLimitMax: 20,
    qmAiProviderCallLimit: 60,
    qmAiOperationDeadlineMs: 90_000,
    qmBankMaxQuestionIds: 10,
    qmBankMaxVariantsPerQuestion: 2,
    qmBankMaxProviderCalls: 24,
    qmReviewMaxPairs: 10,
    qmReviewMaxProviderCalls: 21,
    qmChatMaxMessages: 40,
    qmChatMaxMessageChars: 12_000,
    qmChatMaxAggregateChars: 80_000,
    qmTestApiKeyMaxBodyBytes: 8_192,
    qmTestApiKeyMaxProviderKeyChars: 512,
  },
}));

const {
  qmAiProviderCallAdmission,
  resetQmAiAdmissionForTests,
  validateBankVariantAdmission,
  validateChatAdmission,
  validateTestApiKeyAdmission,
} = await import("../../src/middleware/aiAdmission.js");

describe("Question Maker AI admission audit controls", () => {
  beforeEach(() => resetQmAiAdmissionForTests());

  it("rejects duplicate, non-finite, and over-budget bank question ids before the handler", () => {
    expect(validateBankVariantAdmission({ questionIds: [1, "1"] })).toMatchObject({
      code: "QM_BANK_QUESTION_IDS_DUPLICATE",
    });
    expect(validateBankVariantAdmission({ questionIds: [1, "nope"] })).toMatchObject({
      code: "QM_BANK_QUESTION_ID_INVALID",
    });
    expect(
      validateBankVariantAdmission({
        questionIds: Array.from({ length: 10 }, (_, i) => i + 1),
        variantsToAdd: 2,
      }),
    ).toMatchObject({
      questionIds: expect.any(Array),
    });
    expect(
      validateBankVariantAdmission({
        questionIds: Array.from({ length: 10 }, (_, i) => i + 1),
        variantsToAdd: 2,
      }),
    ).toMatchObject({
      code: "QM_BANK_PROVIDER_CALL_BUDGET",
    });
  });

  it("bounds chat messages and test-api-key provider probing", () => {
    expect(
      validateChatAdmission({ messages: [{ role: "user", content: "x".repeat(12_001) }] }),
    ).toMatchObject({
      code: "QM_CHAT_MESSAGE_TOO_LARGE",
    });
    expect(
      validateChatAdmission({
        messages: Array.from({ length: 41 }, () => ({ role: "user", content: "x" })),
      }),
    ).toMatchObject({
      code: "QM_CHAT_MESSAGE_COUNT_TOO_LARGE",
    });
    expect(
      validateTestApiKeyAdmission({
        provider: "google",
        apiKeys: { google: { apiKey: "a" }, openai: { apiKey: "b" } },
      }),
    ).toMatchObject({
      code: "QM_TEST_API_KEY_AMBIGUOUS_PROVIDER",
    });
  });

  it("keys provider-call admission by authenticated user, not source IP", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: req.headers["x-user"] };
      next();
    });
    app.post("/ai", qmAiProviderCallAdmission({ getCost: () => 60 }), (_req, res) => {
      res.json({ ok: true });
    });

    const first = await request(app).post("/ai").set("x-user", "alice");
    const blocked = await request(app).post("/ai").set("x-user", "alice");
    const isolated = await request(app).post("/ai").set("x-user", "bob");

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(isolated.status).toBe(200);
  });

  it("aborts the shared operation and deferred upstream when a complete request socket closes", async () => {
    const app = express();
    app.use(express.json());
    let signal;
    let handlerReady;
    let resolveHandlerReady;
    handlerReady = new Promise((resolve) => {
      resolveHandlerReady = resolve;
    });
    let responseClosed;
    let resolveResponseClosed;
    responseClosed = new Promise((resolve) => {
      resolveResponseClosed = resolve;
    });
    let upstreamCanceled;
    let resolveUpstreamCanceled;
    upstreamCanceled = new Promise((resolve) => {
      resolveUpstreamCanceled = resolve;
    });

    app.post("/socket-ai", qmAiProviderCallAdmission({ getCost: () => 1 }), (req, res) => {
      signal = req.aiOperation.signal;
      signal.addEventListener("abort", resolveUpstreamCanceled, { once: true });
      res.once("close", resolveResponseClosed);
      resolveHandlerReady();
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    const client = http.request({
      port,
      method: "POST",
      path: "/socket-ai",
      headers: { "content-type": "application/json" },
    });
    client.on("error", () => {});
    client.end("{}");

    try {
      await handlerReady;
      expect(signal.aborted).toBe(false);
      client.destroy();
      await responseClosed;
      expect(signal.aborted).toBe(true);
      await upstreamCanceled;
    } finally {
      client.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("does not abort a normal delayed response before finish/close", async () => {
    const app = express();
    app.use(express.json());
    let signal;
    let handlerReady;
    let resolveHandlerReady;
    handlerReady = new Promise((resolve) => {
      resolveHandlerReady = resolve;
    });
    let releaseResponse;
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve;
    });

    app.post("/delayed-ai", qmAiProviderCallAdmission({ getCost: () => 1 }), async (req, res) => {
      signal = req.aiOperation.signal;
      resolveHandlerReady();
      await responseGate;
      res.end("ok");
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    const response = new Promise((resolve, reject) => {
      const client = http.request(
        {
          port,
          method: "POST",
          path: "/delayed-ai",
          headers: { "content-type": "application/json" },
        },
        (res) => {
          res.resume();
          res.once("end", () => resolve({ client, statusCode: res.statusCode }));
        },
      );
      client.once("error", reject);
      client.end("{}");
    });

    try {
      await handlerReady;
      expect(signal.aborted).toBe(false);
      releaseResponse();
      const result = await response;
      expect(result.statusCode).toBe(200);
      expect(signal.aborted).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
