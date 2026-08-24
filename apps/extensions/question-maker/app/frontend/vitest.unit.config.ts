import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(frontendDir, "../..");

export default defineConfig({
  plugins: [tailwindcss(), react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(frontendDir, "./src"),
      // Subpath exports must precede the barrel: vite's alias matcher treats
      // '@eduai/ui' as also matching '@eduai/ui/<anything>', so the barrel alias
      // would rewrite subpaths to `.../src/index.ts/<subpath>`.
      "@eduai/ui/runtime-env": path.resolve(
        frontendDir,
        "../../../../../packages/ui/src/lib/runtime-env.ts",
      ),
      "@eduai/ui": path.resolve(frontendDir, "../../../../../packages/ui/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  envDir: extensionRoot,
  envPrefix: "VITE_",
  test: {
    clearMocks: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/vitest.setup.ts"],
    include: [
      "src/tests/unit/**/*.test.ts",
      "src/tests/unit/**/*.test.tsx",
      "src/components/**/*.test.ts",
      "src/components/**/*.test.tsx",
      "src/pages/**/*.test.ts",
      "src/pages/**/*.test.tsx",
    ],
    exclude: ["src/tests/integration/**"],
    passWithNoTests: true,
  },
});
