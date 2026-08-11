/**
 * Express application: middleware, routes, and error handlers.
 * Import this module in tests (supertest) without starting the HTTP server.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import net from 'node:net';

import { errorHandler, notFound } from './middleware/errorHandler.js';
import questionRoutes from './routes/questions.js';
import courseRoutes from './routes/course.js';
import assessmentRoutes from './routes/assessments.js';
import variantRoutes from './routes/variants.js';
import eduaiRoutes from './routes/eduai.js';
import canvasRoutes from './routes/canvas.js';
import assessmentVariantRoutes from './routes/assessmentVariant.js';
import topicRoutes from './routes/topics.js';
import authRoutes from './routes/auth.js';
import bugReportRoutes from './routes/bug-reports.js';
import internalRoutes from './routes/internal.js';
import { config } from './config/settings.js';
import { checkDatabaseReadiness } from './config/database.js';
import { logger } from './utils/logger.js';
import { csrfOriginGuard } from './middleware/csrfOrigin.js';

const app = express();

// Production traffic reaches the backend through the host Apache vhost, which
// proxies to localhost:8000. Trust that exact socket topology only. A numeric
// `trust proxy` value (or `true`) would also trust a directly connected caller
// and let it choose an arbitrary X-Forwarded-For value.
const normalizeProxyIp = (value) => String(value || '').trim().toLowerCase().replace(/^::ffff:/, '');
export const isTrustedApacheProxyAddress = (value) => {
  const normalized = normalizeProxyIp(value);
  return normalized === '127.0.0.1' || normalized === '::1';
};

const rateLimitClientIp = (req) => {
  const socketIp = normalizeProxyIp(req?.socket?.remoteAddress);
  if (!isTrustedApacheProxyAddress(socketIp)) return socketIp || 'unknown';

  // Apache appends the real client as the right-most XFF entry. Ignore any
  // spoofable prefix and fall back to the local socket when that entry is
  // malformed. This mirrors the production proxy contract without trusting
  // forwarding headers from a direct/untrusted peer.
  const forwarded = typeof req?.headers?.['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',').map((part) => part.trim()).filter(Boolean).at(-1)
    : null;
  return forwarded && net.isIP(forwarded) ? forwarded : socketIp || 'unknown';
};

// Express uses this same function when deriving req.ip for the rest of the
// application, including pino request metadata and rate-limit identity.
app.set('trust proxy', isTrustedApacheProxyAddress);

app.use(helmet());
// Must run before body parsing and route handlers so a cross-site simple form
// cannot reach a mutating cookie-authenticated endpoint.
app.use(csrfOriginGuard);
app.use(cors({
  origin: config.corsOrigins,
  credentials: true
}));

if (config.nodeEnv === "production") {
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    message: 'Too many requests from this IP, please try again later.',
    keyGenerator: rateLimitClientIp,
    // Liveness/readiness probes should not contend with user/API quota.
    skip: (req) => req.path === '/healthz' || req.path === '/readyz' || req.path === '/',
  });
  app.use(limiter);
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(compression());

const pinoHttpConfig = {
  logger: logger,
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      remoteAddress: req.remoteAddress,
      remotePort: req.remotePort,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  customLogLevel: (req, res) => {
    if (res.statusCode >= 500) {
      return "error";
    } else if (res.statusCode >= 400) {
      return "warn";
    } else if (config.logLevel === "warn" || config.logLevel === "error") {
      return "silent";
    }
    return "info";
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (req, res) => {
    // Keep request logs free of upstream/internal error messages; route-level
    // handlers already record only stable error metadata.
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  autoLogging: {
    ignore: (req) => {
      return req.url === '/healthz' || req.url === '/readyz' || req.url === '/';
    },
  },
};

app.use(pinoHttp(pinoHttpConfig));

app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

app.get('/readyz', async (req, res) => {
  const ready = await checkDatabaseReadiness();

  if (!ready) {
    return res.status(503).json({ status: 'unavailable' });
  }

  return res.status(200).json({ status: 'ready' });
});

app.get('/', (req, res) => {
  res.json({
    status: "ok",
    message: "EduQuery.ai API is running",
    version: "1.0.0",
  });
});

app.use("/api/questions", questionRoutes);
app.use("/api/questions", variantRoutes);
app.use("/api/course", courseRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/eduai", eduaiRoutes);
app.use("/api/canvas", canvasRoutes);
app.use("/api/assessment-variant", assessmentVariantRoutes);
app.use("/api/topics", topicRoutes);
app.use("/api", authRoutes);
app.use("/api", bugReportRoutes);
app.use("/api/internal", internalRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
