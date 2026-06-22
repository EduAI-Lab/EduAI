/**
 * Send API key expiration reminder emails.
 *
 * Usage:
 *   npm run api-keys:send-reminders
 *
 * Requires DATABASE_URL and SMTP_* (optional — logs instead of sending when SMTP is unset).
 */
import { sendApiKeyExpirationReminders } from "../app/lib/api-keys/reminders.server";

const result = await sendApiKeyExpirationReminders();
console.info("[api-key-reminders]", result);
