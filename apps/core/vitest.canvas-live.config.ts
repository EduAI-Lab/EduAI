import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const liveEnabled = process.env.CANVAS_LIVE_TESTS === "1";

// Live tests intentionally exercise the designated development database. Do
// not load setup.integration.ts here: it replaces DATABASE_URL with the
// disposable eduai_test URL, which cannot contain the configured dev
// instructor identity. Requiring an explicit URL makes the destructive scope
// visible at invocation time and keeps this suite opt-in.
if (liveEnabled) {
  const databaseUrl = process.env.CANVAS_LIVE_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("CANVAS_LIVE_DATABASE_URL is required when CANVAS_LIVE_TESTS=1");
  }
  process.env.DATABASE_URL = databaseUrl;
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: [
      liveEnabled
        ? "app/tests/live/canvas-live.integration.test.ts"
        : "app/tests/live/canvas-live.skip.test.ts",
    ],
    globalSetup: liveEnabled ? "./app/tests/globalSetup.ts" : undefined,
    setupFiles: liveEnabled
      ? ["./app/tests/setup.env.ts", "./app/tests/setup.ts"]
      : [],
    fileParallelism: false,
  },
});
