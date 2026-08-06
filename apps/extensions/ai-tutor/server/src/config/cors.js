export function isValidOrigin(entry) {
  let url;
  try {
    url = new URL(entry);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  if (url.username !== '' || url.password !== '') {
    return false;
  }

  if (url.pathname !== '/') {
    return false;
  }

  if (url.search !== '') {
    return false;
  }

  if (url.hash !== '') {
    return false;
  }

  if (entry.includes('*')) {
    return false;
  }

  return true;
}

export function normalizeOrigin(entry) {
  return new URL(entry).origin;
}

const corsOriginsEnv = process.env.CORS_ORIGINS;
const runtimeEnvironment = process.env.NODE_ENV?.trim() || 'development';
const localDefaultOrigins =
  runtimeEnvironment === 'development' || runtimeEnvironment === 'test'
    ? ['http://localhost:3001']
    : [];

let allowedOrigins;
if (!corsOriginsEnv || corsOriginsEnv.trim() === '') {
  allowedOrigins = [...localDefaultOrigins];
} else {
  const raw = corsOriginsEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const deduped = [...new Set(raw)];

  for (const entry of deduped) {
    if (entry.includes('*')) {
      throw new Error('CORS_ORIGINS must not contain a wildcard (*). Use explicit origins only.');
    }

    if (!isValidOrigin(entry)) {
      throw new Error(
        `CORS_ORIGINS contains an invalid origin: "${entry}". Must be an exact http:// or https:// origin with no path, query, fragment, or credentials.`,
      );
    }
  }

  allowedOrigins = deduped.map((entry) => normalizeOrigin(entry));
}

export function corsOriginCallback(origin, callback) {
  if (!origin || origin === 'null') {
    return callback(null, false);
  }

  if (allowedOrigins.includes(origin)) {
    return callback(null, true);
  }

  return callback(null, false);
}

export const corsOptions = {
  origin: corsOriginCallback,
  credentials: true,
};
