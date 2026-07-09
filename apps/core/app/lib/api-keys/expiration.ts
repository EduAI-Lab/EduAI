export const MAX_API_KEY_EXPIRATION_DAYS = 365;

export const API_KEY_SUPPORTED_ROUTES = [
  "/api/chat",
  "/api/me",
  "/api/users",
  "/api/ai-providers",
  "/api/ai-models",
] as const;

export const API_KEY_EXPIRATION_OPTIONS = [
  { value: "30", label: "30 days", seconds: 60 * 60 * 24 * 30 },
  { value: "90", label: "90 days", seconds: 60 * 60 * 24 * 90 },
  { value: "180", label: "180 days", seconds: 60 * 60 * 24 * 180 },
  { value: "365", label: "1 year", seconds: 60 * 60 * 24 * 365 },
] as const;

export type ApiKeyExpirationChoice = (typeof API_KEY_EXPIRATION_OPTIONS)[number]["value"];

export const DEFAULT_API_KEY_EXPIRATION_CHOICE: ApiKeyExpirationChoice = "90";

export type ApiKeyExpirationStatus = "none" | "active" | "expiring-soon" | "expired";

const DAY_MS = 1000 * 60 * 60 * 24;

export function expirationChoiceToSeconds(choice: ApiKeyExpirationChoice): number | undefined {
  const option = API_KEY_EXPIRATION_OPTIONS.find((entry) => entry.value === choice);
  if (!option || option.seconds === null) return undefined;
  return option.seconds;
}

export function daysUntilExpiration(expiresAt: Date | string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return null;
  return Math.ceil((expiresMs - now) / DAY_MS);
}

export function getApiKeyExpirationStatus(
  expiresAt: Date | string | null | undefined,
  now = Date.now(),
): ApiKeyExpirationStatus {
  if (!expiresAt) return "none";
  const daysLeft = daysUntilExpiration(expiresAt, now);
  if (daysLeft === null) return "none";
  if (daysLeft <= 0) return "expired";
  if (daysLeft <= 14) return "expiring-soon";
  return "active";
}

export function formatExpirationLabel(
  expiresAt: Date | string | null | undefined,
  now = Date.now(),
): string {
  const status = getApiKeyExpirationStatus(expiresAt, now);
  if (status === "none") return "No expiration";
  const date = new Date(expiresAt as Date | string).toLocaleDateString();
  if (status === "expired") return `Expired ${date}`;
  const daysLeft = daysUntilExpiration(expiresAt, now);
  if (daysLeft === 1) return `Expires tomorrow (${date})`;
  if (daysLeft !== null && daysLeft <= 14) return `Expires in ${daysLeft} days (${date})`;
  return `Expires ${date}`;
}
