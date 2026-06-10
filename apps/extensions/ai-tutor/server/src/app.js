import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';

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
    path.startsWith('/me/') ||
    path.startsWith('/admin/') ||
    path === '/ai-models' ||
    path.startsWith('/ai-models/') ||
    path === '/bug-reports' ||
    path.startsWith('/modules/') ||
    path.startsWith('/lessons/') ||
    path.startsWith('/courses/')
  );
}

/**
 * Creates and configures the Express application.
 *
 * @param {object} [options]
 * @param {object} [options.mockUser] - When provided, skips Core session validation and
 *   injects this object as `req.user` on every request. Used by tests.
 * @returns {Promise<import('express').Express>}
 */
export async function createApp(options = {}) {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));

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

  // Session middleware: real (Core session validation) or mock (tests)
  if (options.mockUser) {
    app.use('/api', (req, _res, next) => {
      req.user = options.mockUser;
      next();
    });
  } else {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health') return next();
      if (req.method === 'POST' && req.path === '/logout') return next();
      return requireAuth(req, res, next);
    });
  }

  // Admins are intentionally isolated to admin-only endpoints.
  // UNIT_ADMINs can reach /admin/courses/* (enrollment management) but not
  // /admin/settings/* or /admin/users* (system config / user management).
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    if (!req.user) return next();
    if (req.user.role === 'ADMIN') {
      if (isAllowedAdminPath(req.path)) return next();
      return res.status(403).json({ error: 'Admins can only access admin endpoints' });
    }
    if (req.user.role === 'UNIT_ADMIN') {
      if (req.path.startsWith('/admin/settings') || req.path.startsWith('/admin/users')) {
        return res.status(403).json({ error: 'Unit admins cannot access system configuration' });
      }
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
