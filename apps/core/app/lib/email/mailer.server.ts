import nodemailer, { type Transporter } from "nodemailer";

import { fireAndForget, logSystemError } from "~/lib/logging.server";

/**
 * Minimal email sender. The transport is built from SMTP_* env vars
 * (Mailtrap in dev, an institutional relay in prod — no code change, just
 * env). When SMTP is not configured, non-production environments log the
 * message for local testing. Production fails closed without logging the
 * message because email bodies can contain invitation or verification tokens.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { delivered: boolean };

const DEFAULT_FROM = "EduAI <no-reply@eduai.local>";

/**
 * Connect, greeting and idle timeouts for the SMTP transport (#1860). Without
 * them nodemailer waits about two minutes on an unreachable relay, so an invite
 * request hangs instead of failing and offering the copy link.
 */
export const SMTP_TIMEOUT_MS = 10_000;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function isSmtpConfigured(): boolean {
  return readEnv("SMTP_HOST") !== undefined;
}

let cachedTransport: Transporter | null | undefined;

/** Lazily build (and cache) the SMTP transport, or null when SMTP is unset. */
function getTransport(): Transporter | null {
  if (cachedTransport !== undefined) return cachedTransport;

  const host = readEnv("SMTP_HOST");
  if (!host) {
    cachedTransport = null;
    return cachedTransport;
  }

  const port = Number(readEnv("SMTP_PORT") ?? "587");
  const user = readEnv("SMTP_USER");
  const pass = readEnv("SMTP_PASS");

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    // `secure` true for implicit TLS (465); otherwise STARTTLS is negotiated.
    secure: readEnv("SMTP_SECURE") === "true" || port === 465,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  return cachedTransport;
}

/**
 * Warn once at startup when a production server has no SMTP relay (#1860).
 * Every email (invites, verification, alerts) would fail, and before this the
 * only sign was a console error on the first send.
 */
export function warnIfSmtpMissing(): void {
  if (process.env.NODE_ENV !== "production" || isSmtpConfigured()) return;
  console.warn(
    "[email] SMTP_HOST is not set — invitations, verification and alert emails cannot be sent. " +
      "Set the SMTP_* variables in apps/core/.env.",
  );
}

/** Test seam: drop the cached transport so env changes take effect. */
export function resetMailerTransport(): void {
  cachedTransport = undefined;
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const transport = getTransport();

  if (!transport) {
    if (process.env.NODE_ENV === "production") {
      const error = new Error("SMTP must be configured before sending email in production");
      // Recorded before the throw so it reaches Admin → Logs, not only the console (#1860).
      fireAndForget(
        logSystemError({
          source: "MAIL",
          code: "MAIL_NOT_CONFIGURED",
          message: "SMTP is not configured; email was not sent",
          error,
        }),
      );
      throw error;
    }
    console.info(
      `[email] SMTP not configured — skipping send to ${message.to}: "${message.subject}"\n${message.text}`,
    );
    return { delivered: false };
  }

  try {
    await transport.sendMail({
      from: readEnv("EMAIL_FROM") ?? DEFAULT_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (error) {
    // No Request reaches this layer, so the system-error event carries no request context.
    fireAndForget(
      logSystemError({
        source: "MAIL",
        code: "MAIL_SEND_FAILED",
        message: "SMTP send failed",
        error,
      }),
    );
    throw error;
  }
  return { delivered: true };
}
