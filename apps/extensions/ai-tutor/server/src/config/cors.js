const corsOriginsEnv = process.env.CORS_ORIGINS;

let allowedOrigins;
if (!corsOriginsEnv || corsOriginsEnv.trim() === '') {
  allowedOrigins = [];
} else {
  const raw = corsOriginsEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (raw.includes('*')) {
    throw new Error(
      'CORS_ORIGINS must not contain a wildcard (*). Use explicit origins only.'
    );
  }

  allowedOrigins = [...new Set(raw)];
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
