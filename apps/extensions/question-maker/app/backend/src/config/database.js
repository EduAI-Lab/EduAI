/**
 * Configures the Prisma/PostgreSQL client. Responsible for loading environment
 * variables and retrying the initial connection so the server can still start
 * listening while Postgres (e.g. a Docker Compose dependency) finishes booting.
 */
import { PrismaClient } from '@eduai/question-maker-prisma-client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the project root (4 levels up from app/backend/src/config/database.js)
// app/backend/src/config -> app/backend/src -> app/backend -> app -> root
const projectRoot = join(__dirname, '../../../../');
const envPath = join(projectRoot, '.env');

// Load environment variables
const result = dotenv.config({ path: envPath });

// Check if .env file was loaded and DATABASE_URL exists
if (result.error) {
  logger.warn({ err: result.error, envPath }, 'Could not load .env file');
}

if (!process.env.DATABASE_URL) {
  logger.error({ envPath, projectRoot }, 'DATABASE_URL is not set');
  throw new Error('DATABASE_URL environment variable is required. Please set it in your .env file.');
}

export const prisma = new PrismaClient();

/**
 * Attempts to connect with exponential backoff until success or the retry limit is reached.
 * Keeps startup resilient when Postgres containers or services take time to become available.
 */
const retryConnection = async (maxRetries = 10, initialDelay = 1000) => {
  let attempt = 0;
  let delay = initialDelay;

  while (attempt < maxRetries) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info('Database connection successful');
      return;
    } catch (error) {
      attempt++;
      const isLastAttempt = attempt >= maxRetries;

      if (isLastAttempt) {
        logger.error({ err: error, attempts: maxRetries }, 'Database connection failed after max retries');
        throw error;
      }

      logger.warn({
        err: error,
        attempt,
        maxRetries,
        retryDelay: delay
      }, 'Database connection attempt failed, retrying');

      await new Promise(resolve => setTimeout(resolve, delay));

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
      delay = Math.min(delay * 2, 60000);
    }
  }
};

/**
 * Verifies the Prisma connection, optionally retrying/tolerating failure so the
 * caller can decide whether to let the server start without a DB connection yet.
 * Migrations are applied out-of-band via `prisma migrate deploy` (see package.json).
 */
export const connectDatabase = async (options = {}) => {
  const {
    retryOnFailure = true,
    maxRetries = 10,
    allowFailure = false
  } = options;

  try {
    if (retryOnFailure) {
      await retryConnection(maxRetries);
    } else {
      await prisma.$queryRaw`SELECT 1`;
    }
  } catch (error) {
    if (allowFailure) {
      logger.warn({ err: error }, 'Database connection failed, but continuing anyway. Prisma will reconnect on the next query.');
      return;
    }

    throw error;
  }
};
