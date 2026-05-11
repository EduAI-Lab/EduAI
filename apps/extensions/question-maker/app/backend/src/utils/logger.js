/**
 * Centralized Pino logger configuration shared across the backend.
 * Handles redaction, pretty-printing in development, and JSON output in production.
 * Falls back to console when pino is not installed (e.g. scripts run without backend node_modules).
 */
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

const noop = () => {};
const consoleFallback = {
  info: (...args) => console.log('[info]', ...args),
  warn: (...args) => console.warn('[warn]', ...args),
  error: (...args) => console.error('[error]', ...args),
  debug: noop,
  trace: noop,
  child: () => consoleFallback,
};

let logger = consoleFallback;

try {
  const pino = (await import('pino')).default;
  const pinoConfig = {
    level: LOG_LEVEL.toLowerCase(),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'token',
        'secret',
        'apiKey',
      ],
      remove: true,
    },
  };
  if (isProduction) {
    pinoConfig.formatters = { level: (label) => ({ level: label }) };
    pinoConfig.timestamp = pino.stdTimeFunctions.isoTime;
  } else {
    pinoConfig.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    };
  }
  logger = pino(pinoConfig);
} catch {
  // pino not installed (e.g. populate/seed run from root without backend node_modules)
}

export { logger };
export default logger;
