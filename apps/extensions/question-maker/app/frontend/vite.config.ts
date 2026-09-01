import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(frontendDir, "../..");
// frontendDir is <repo>/apps/extensions/question-maker/app/frontend, so the repo
// root is five levels up. Without the true root here, `server.fs.allow` excludes
// the hoisted root `node_modules`, and /@fs requests for the self-hosted Outfit
// woff2 files hit "outside of Vite serving allow list" (403) — QM then renders a
// fallback font in dev while Core/AI Tutor do not (#1575).
const monorepoRoot = path.resolve(frontendDir, "../../../../..");

export default defineConfig({
  plugins: [tailwindcss(), react(), tsconfigPaths()],
  css: {
    devSourcemap: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(frontendDir, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  envDir: extensionRoot,
  envPrefix: "VITE_",
  server: {
    port: 5173,
    host: "0.0.0.0",
    // Explicit hosts only — avoid `allowedHosts: true` (DNS rebinding risk).
    allowedHosts: ["localhost", "127.0.0.1", "dev.questionmaker.eduai.ok.ubc.ca"],
    fs: {
      allow: [monorepoRoot],
    },
  },
  test: {
    clearMocks: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/vitest.setup.ts"],
    passWithNoTests: true,
  },
});
