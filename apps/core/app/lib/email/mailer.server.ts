import nodemailer, { type Transporter } from "nodemailer";

import { fireAndForget, logSystemError } from "~/lib/logging.server";

/**
 * Minimal email sender. The transport is built from SMTP_* env vars
 * (Mailtrap in dev, an institutional relay in prod — no code change, just
 * env). When SMTP is not configured the sender falls back to logging the
 * message (and any invite link) to the console and reports `delivered: false`,
 * so unconfigured environments degrade gracefully instead of throwing.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { delivered: boolean };

const DEFAULT_FROM = "EduAI <no-reply@eduai.local>";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
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
  });
  return cachedTransport;
}

/** Test seam: drop the cached transport so env changes take effect. */
export function resetMailerTransport(): void {
  cachedTransport = undefined;
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const transport = getTransport();

  if (!transport) {
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
