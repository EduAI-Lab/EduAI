/**
 * Runs the local `prisma` CLI with DATABASE_URL loaded from the extension-root .env
 * (apps/extensions/question-maker/.env), since that file isn't colocated with
 * prisma/schema.prisma the way it is for ai-tutor/core and the Prisma CLI's own
 * dotenv resolution only looks in the schema dir / cwd. No-ops silently when the
 * .env file is absent (Docker/CI, where DATABASE_URL is already a real env var).
 *
 * Invokes the local prisma/build/index.js directly with `node` instead of going
 * through `npx`: under turbo's nested `npm run dev` fan-out on Windows, `npx`'s own
 * PATH/npm_execpath resolution is unreliable and can fail with
 * "'prisma' is not recognized as an internal or external command" even though the
 * package is installed, while resolving the entry point via `require.resolve` and
 * running it directly with `node` is immune to that.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { createRequire } from "module";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "../../../.env");

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const require = createRequire(import.meta.url);
const prismaBin = require.resolve("prisma/build/index.js");

const result = spawnSync(process.execPath, [prismaBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
