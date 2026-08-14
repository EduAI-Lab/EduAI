// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const createTransport = vi.fn((..._args: unknown[]) => ({ sendMail }));

vi.mock("nodemailer", () => ({
  default: { createTransport: (...args: unknown[]) => createTransport(...args) },
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logSystemError: vi.fn(async () => undefined),
}));

import { logSystemError } from "~/lib/logging.server";
import { resetMailerTransport, sendEmail } from "~/lib/email/mailer.server";

const ORIGINAL_ENV = { ...process.env };
const MESSAGE = {
  to: "student@example.com",
  subject: "Welcome",
  html: "<p>Hi</p>",
  text: "Hi",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMailerTransport();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_SECURE;
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetMailerTransport();
});

describe("sendEmail — SMTP not configured", () => {
  it("logs and reports delivered:false without building a transport", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await sendEmail(MESSAGE);

    expect(result).toEqual({ delivered: false });
    expect(createTransport).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining(MESSAGE.to));
  });

  it("treats a blank SMTP_HOST as unset", async () => {
    process.env.SMTP_HOST = "   ";
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await sendEmail(MESSAGE);

    expect(result).toEqual({ delivered: false });
  });
});

describe("sendEmail — SMTP configured", () => {
  beforeEach(() => {
    process.env.SMTP_HOST = "smtp.example.com";
  });

  it("builds the transport once and caches it across sends", async () => {
    sendMail.mockResolvedValue(undefined);

    await sendEmail(MESSAGE);
    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("defaults the port to 587 and secure to false", async () => {
    sendMail.mockResolvedValue(undefined);

    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587, secure: false }),
    );
  });

  it("treats port 465 as implicit TLS by default", async () => {
    process.env.SMTP_PORT = "465";
    sendMail.mockResolvedValue(undefined);

    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it("honors an explicit SMTP_SECURE=true on a non-465 port", async () => {
    process.env.SMTP_SECURE = "true";
    sendMail.mockResolvedValue(undefined);

    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it("omits auth when user/pass are not both set", async () => {
    process.env.SMTP_USER = "user-only";
    sendMail.mockResolvedValue(undefined);

    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it("passes auth when both user and pass are set", async () => {
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    sendMail.mockResolvedValue(undefined);

    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: "user", pass: "pass" } }),
    );
  });

  it("sends with the default from address, or EMAIL_FROM when set", async () => {
    sendMail.mockResolvedValue(undefined);

    await sendEmail(MESSAGE);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "EduAI <no-reply@eduai.local>", to: MESSAGE.to }),
    );

    process.env.EMAIL_FROM = "custom@eduai.local";
    resetMailerTransport();
    await sendEmail(MESSAGE);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "custom@eduai.local" }));
  });

  it("logs a system error and rethrows when sendMail fails", async () => {
    const error = new Error("smtp down");
    sendMail.mockRejectedValue(error);

    await expect(sendEmail(MESSAGE)).rejects.toThrow("smtp down");
    expect(logSystemError).toHaveBeenCalledWith(
      expect.objectContaining({ source: "MAIL", code: "MAIL_SEND_FAILED", error }),
    );
  });
});

describe("resetMailerTransport", () => {
  it("forces the next send to rebuild the transport from current env", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    sendMail.mockResolvedValue(undefined);
    await sendEmail(MESSAGE);
    expect(createTransport).toHaveBeenCalledTimes(1);

    resetMailerTransport();
    delete process.env.SMTP_HOST;
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await sendEmail(MESSAGE);
    expect(result).toEqual({ delivered: false });
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});
