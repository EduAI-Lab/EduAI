/**
 * Application entrypoint: starts the HTTP server and initializes the database connection in the background.
 */
import app from "./app.js";
import { connectDatabase, prisma } from "./config/database.js";
import { config, assertCoreServiceKeyConfigured } from "./config/settings.js";
import { logger } from "./utils/logger.js";
import { initScheduler } from "./jobs/scheduler.js";

const PORT = config.port;

let server = null;
let shutdownPromise = null;
let shutdownExitCode = 0;

/** Closes the HTTP server and database before exiting, with one bounded attempt per process. */
const shutdown = (exitCode, signal) => {
  shutdownExitCode = Math.max(shutdownExitCode, exitCode);

  if (shutdownPromise) return shutdownPromise;

  if (signal) logger.info({ signal }, "Starting graceful shutdown...");

  shutdownPromise = (async () => {
    let timedOut = false;
    let timeout;

    try {
      await Promise.race([
        (async () => {
          if (server) {
            await new Promise((resolve) => {
              try {
                server.close((error) => {
                  if (error) {
                    logger.error({ err: error }, "Error closing HTTP server");
                  } else {
                    logger.info("HTTP server closed");
                  }
                  resolve();
                });
              } catch (error) {
                logger.error({ err: error }, "Error closing HTTP server");
                resolve();
              }
            });
          }

          await Promise.resolve()
            .then(() => prisma.$disconnect())
            .then(() => logger.info("Database connections closed"))
            .catch((error) => logger.error({ err: error }, "Error closing database"));
        })(),
        new Promise((resolve) => {
          timeout = setTimeout(() => {
            timedOut = true;
            resolve();
          }, 10000);
        }),
      ]);
      if (timedOut) logger.error("Forced shutdown after timeout");
    } finally {
      clearTimeout(timeout);
      logger.info("Shutdown complete");
      await new Promise((resolve) => logger.flush(() => process.stdout.write("", resolve)));
      process.exit(timedOut ? 1 : shutdownExitCode);
    }
  })();

  return shutdownPromise;
};

process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "Uncaught Exception");
  shutdown(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ err: reason, promise }, "Unhandled Rejection");
  shutdown(1);
});

process.on("SIGTERM", () => shutdown(0, "SIGTERM"));
process.on("SIGINT", () => shutdown(0, "SIGINT"));

/** Boots the Express app, wires server error handlers, and kicks off DB connection attempts. */
const startServer = async () => {
  try {
    assertCoreServiceKeyConfigured();

    server = app.listen(PORT, "0.0.0.0", () => {
      logger.info(
        {
          port: PORT,
          logLevel: config.logLevel,
          nodeEnv: config.nodeEnv,
        },
        "🚀 Server running and ready for requests",
      );

      initScheduler();
    });

    server.on("error", (error) => {
      if (error.syscall !== "listen") {
        throw error;
      }

      const bind = typeof PORT === "string" ? "Pipe " + PORT : "Port " + PORT;

      switch (error.code) {
        case "EACCES":
          logger.error({ bind, code: error.code }, "Port requires elevated privileges");
          process.exit(1);
          break;
        case "EADDRINUSE":
          logger.error({ bind, code: error.code }, "Port is already in use");
          process.exit(1);
          break;
        default:
          throw error;
      }
    });

    connectDatabase({
      retryOnFailure: true,
      maxRetries: 10,
      allowFailure: true,
    }).catch((error) => {
      logger.warn(
        { err: error },
        "Server started without database connection. Will retry in background",
      );
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

startServer();

export default app;
