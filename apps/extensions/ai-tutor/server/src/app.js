import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';

// Route imports
import authRoutes from './routes/authentication.js';
import courseRoutes from './routes/courses.js';
import moduleRoutes from './routes/modules.js';
import lessonRoutes from './routes/lessons.js';
import activityRoutes from './routes/activities.js';
import promptRoutes from './routes/prompts.js';
import topicRoutes from './routes/topics.js';
import aiModelRoutes from './routes/ai-models.js';
import adminRoutes from './routes/admin.js';
import suggestedPromptRoutes from './routes/suggested-prompts.js';
import bugReportRoutes from './routes/bug-reports.js';
import { prisma } from './config/database.js';

function isAllowedAdminPath(path) {
  return (
    path === '/me' ||
    path.startsWith('/admin/') ||
    path === '/ai-models' ||
    path.startsWith('/ai-models/')
  );
}

/**
 * Creates and configures the Express application.
 *
 * @param {object} [options]
 * @param {object} [options.mockUser] - When provided, skips Better Auth and
 *   injects this object as `req.user` on every request. Used by tests.
 * @returns {Promise<import('express').Express>}
 */
export async function createApp(options = {}) {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));

  if (!options.mockUser) {
    // Production path: mount Better Auth handler BEFORE json parser
    const { toNodeHandler } = await import('better-auth/node');
    const { auth } = await import('./auth.js');
    app.all('/api/auth/{*any}', toNodeHandler(auth));
  }

  // JSON parser for our own routes
  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Session middleware: real or mock
  if (options.mockUser) {
    app.use('/api', (req, res, next) => {
      req.user = options.mockUser;
      next();
    });
  } else {
    const { attachSession } = await import('./middleware/auth.js');
    app.use('/api', attachSession);
  }

  // Require auth for all /api routes except health and auth
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/auth/')) {
      return next();
    }
    return requireAuth(req, res, next);
  });

  // Admins are intentionally isolated to admin-only endpoints
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/auth/')) {
      return next();
    }
    if (!req.user) {
      return next();
    }
    if (req.user.role === 'ADMIN') {
      if (isAllowedAdminPath(req.path)) {
        return next();
      }
      return res.status(403).json({ error: 'Admins can only access admin endpoints' });
    }
    next();
  });

  // Mount route modules
  app.use('/api', authRoutes);
  app.use('/api', courseRoutes);
  app.use('/api', moduleRoutes);
  app.use('/api', lessonRoutes);
  app.use('/api', activityRoutes);
  app.use('/api', promptRoutes);
  app.use('/api', topicRoutes);
  app.use('/api', aiModelRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', suggestedPromptRoutes);
  app.use('/api', bugReportRoutes);

  return app;
}
