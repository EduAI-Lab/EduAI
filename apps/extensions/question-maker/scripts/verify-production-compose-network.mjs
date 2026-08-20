import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(scriptDir, "..");
const repoRoot = resolve(extensionDir, "../../..");
const composeFile = resolve(extensionDir, "docker-compose.yml");
const envFile = resolve(extensionDir, ".env");

// The production Compose file intentionally requires an extension-local .env.
// Create a disposable minimum file when this check runs in a clean checkout;
// never overwrite an operator's real environment file.
let createdEnvFile = false;
if (!existsSync(envFile)) {
  writeFileSync(envFile, "POSTGRES_PASSWORD_PRODUCTION=qm-compose-network-check\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  createdEnvFile = true;
}

const failures = [];
const composeEnv = {
  ...process.env,
  POSTGRES_PASSWORD_PRODUCTION:
    process.env.POSTGRES_PASSWORD_PRODUCTION || "qm-compose-network-check",
};

try {
  const result = spawnSync("docker", ["compose", "-f", composeFile, "config", "--format", "json"], {
    cwd: repoRoot,
    env: composeEnv,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = result.stderr?.trim();
    throw new Error(`docker compose config failed${details ? `: ${details}` : ""}`);
  }

  let config;
  try {
    config = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`docker compose returned invalid JSON: ${error.message}`);
  }

  const postgres = config.services?.postgres;
  const backend = config.services?.backend;
  const frontend = config.services?.frontend;

  if (!postgres) {
    failures.push("postgres service is missing");
  } else {
    const configuredPorts = postgres.ports || [];
    if (configuredPorts.length > 0) {
      failures.push(
        `postgres configures host ports: ${configuredPorts
          .map((port) => `${port.published}:${port.target}`)
          .join(", ")}`,
      );
    }
    if (postgres.network_mode === "host") {
      failures.push("postgres uses host networking");
    }
  }

  if (!backend) {
    failures.push("backend service is missing");
  } else {
    const databaseUrl = backend.environment?.DATABASE_URL;
    if (databaseUrl !== "postgresql://postgres@postgres:5432/eduquery") {
      failures.push(
        `backend DATABASE_URL must use postgres:5432, got ${databaseUrl || "<missing>"}`,
      );
    }
    if (backend.depends_on?.postgres?.condition !== "service_healthy") {
      failures.push("backend must wait for postgres health before starting");
    }
    assertPublishedPort(backend, "8000", "8000", "backend", failures);
  }

  if (!frontend) {
    failures.push("frontend service is missing");
  } else {
    assertPublishedPort(frontend, "3005", "8080", "frontend", failures);
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  console.log(
    "PASS: production Compose keeps PostgreSQL internal on postgres:5432 and preserves the 8000/3005 application ports.",
  );
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (createdEnvFile) {
    unlinkSync(envFile);
  }
}

function assertPublishedPort(service, published, target, name, errors) {
  const matchingPorts = (service.ports || []).filter(
    (port) => port.published === published && String(port.target) === target,
  );
  if (matchingPorts.length !== 1 || (service.ports || []).length !== 1) {
    errors.push(
      `${name} must publish exactly ${published}:${target}; got ${JSON.stringify(
        service.ports || [],
      )}`,
    );
  }
}
