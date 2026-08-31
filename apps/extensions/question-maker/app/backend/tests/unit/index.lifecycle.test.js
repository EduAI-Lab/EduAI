import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entrypoint = pathToFileURL(resolve(backendRoot, "src/index.js")).href;

const runEntrypoint = (trigger) =>
  new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(entrypoint)}); setTimeout(() => ${trigger}, 100);`,
      ],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://vitest:vitest@127.0.0.1:5432/vitest_unit_stub",
          EDUAI_API_KEY: "test-key",
          LOG_LEVEL: "info",
          NODE_ENV: "production",
          PORT: "0",
        },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal, output }));
  });

it.each([
  ["an uncaught exception", "(() => { throw new Error('lifecycle test'); })()", 1],
  ["an unhandled rejection", "Promise.reject(new Error('lifecycle test'))", 1],
  ["SIGTERM", "process.kill(process.pid, 'SIGTERM')", 0],
])("closes resources before exiting for %s", async (_event, trigger, exitCode) => {
  const result = await runEntrypoint(trigger);

  expect(result.code).toBe(exitCode);
  expect(result.signal).toBeNull();
  const serverClosed = result.output.indexOf("HTTP server closed");
  const databaseClosed = result.output.indexOf("Database connections closed");

  expect(serverClosed).toBeGreaterThanOrEqual(0);
  expect(databaseClosed).toBeGreaterThan(serverClosed);
});
