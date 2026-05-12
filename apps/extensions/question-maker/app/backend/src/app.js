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

import { errorHandler, notFound } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import questionRoutes from './routes/questions.js';
import courseRoutes from './routes/course.js';
import assessmentRoutes from './routes/assessments.js';
import variantRoutes from './routes/variants.js';
import eduaiRoutes from './routes/eduai.js';
import canvasRoutes from './routes/canvas.js';
import assessmentVariantRoutes from './routes/assessmentVariant.js';
import bugReportRoutes from './routes/bugReports.js';
import { config } from './config/settings.js';
import { logger } from './utils/logger.js';
import './schema/index.js';

const app = express();

app.use(helmet());
app.use(cors({
  origin: config.corsOrigins,
  credentials: true
}));

if (config.nodeEnv === 'production') {
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    message: 'Too many requests from this IP, please try again later.'
  });
  app.use(limiter);
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500) {
      return 'error';
    } else if (res.statusCode >= 400) {
      return 'warn';
    } else if (config.logLevel === 'warn' || config.logLevel === 'error') {
      return 'silent';
    }
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },
  autoLogging: {
    ignore: (req) => {
      return req.url === '/healthz' || req.url === '/';
    },
  },
};

app.use(pinoHttp(pinoHttpConfig));

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'EduQuery.ai API is running',
    version: '1.0.0'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/questions', variantRoutes);
app.use('/api/course', courseRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/eduai', eduaiRoutes);
app.use('/api/canvas', canvasRoutes);
app.use('/api/assessment-variant', assessmentVariantRoutes);
app.use('/api/bug-reports', bugReportRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
