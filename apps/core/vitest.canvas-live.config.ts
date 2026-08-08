import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const liveEnabled = process.env.CANVAS_LIVE_TESTS === "1";

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
      ? ["./app/tests/setup.env.ts", "./app/tests/setup.ts", "./app/tests/setup.integration.ts"]
      : [],
    fileParallelism: false,
  },
});
