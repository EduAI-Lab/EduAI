/**
 * Application entrypoint: starts the HTTP server and initializes the database connection in the background.
 */
import app from './app.js';
import { connectDatabase, sequelize } from './config/database.js';
import { config } from './config/settings.js';
import { logger } from './utils/logger.js';

const PORT = config.port;

let server = null;

/** Handles SIGTERM/SIGINT by closing the HTTP server and database before exiting. */
const gracefulShutdown = async (signal) => {
  logger.info({ signal }, 'Starting graceful shutdown...');

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        if (sequelize) {
          await sequelize.close();
          logger.info('Database connections closed');
        }
      } catch (error) {
        logger.error({ err: error }, 'Error closing database');
      }

      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught Exception');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ err: reason, promise }, 'Unhandled Rejection');
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/** Boots the Express app, wires server error handlers, and kicks off DB connection attempts. */
const startServer = async () => {
  try {
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({
        port: PORT,
        logLevel: config.logLevel,
        nodeEnv: config.nodeEnv,
      }, '🚀 Server running and ready for requests');
    });

    server.on('error', (error) => {
      if (error.syscall !== 'listen') {
        throw error;
      }

      const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;

      switch (error.code) {
        case 'EACCES':
          logger.error({ bind, code: error.code }, 'Port requires elevated privileges');
          process.exit(1);
          break;
        case 'EADDRINUSE':
          logger.error({ bind, code: error.code }, 'Port is already in use');
          process.exit(1);
          break;
        default:
          throw error;
      }
    });

    connectDatabase({
      retryOnFailure: true,
      maxRetries: 10,
      allowFailure: true
    }).catch((error) => {
      logger.warn({ err: error }, 'Server started without database connection. Will retry in background');
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();

export default app;
