import path from "node:path";
import { fileURLToPath } from "node:url";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Dependencies are hoisted to the monorepo root while Vite root is apps/core.
// Without this, /@fs/… requests into root node_modules hit "outside of Vite serving allow list".
const coreDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(coreDir, "../..");
// Core auth code imports apiKey from better-auth/plugins (1.2.x API). The monorepo
// also installs better-auth 1.5+ for ai-tutor; without pinning resolution here,
// Vite SSR can pick apps/core/node_modules/better-auth@1.6.x which has no apiKey export.
// Force all better-auth imports to the hoisted 1.2.8 package (ai-tutor may install 1.6.x).
const betterAuthPkg = path.join(monorepoRoot, "node_modules", "better-auth");
// Client transforms break when aliases point at `.mjs` files (vite:import-analysis / normalizeUrl).
// Use package + dist directories for the browser bundle; use explicit .mjs only under ssr.resolve.
const betterAuthAliases = {
  "better-auth": betterAuthPkg,
  "better-auth/client/plugins": path.join(betterAuthPkg, "dist/client/plugins"),
  "better-auth/react": path.join(betterAuthPkg, "dist/client/react"),
};
const betterAuthSsrAliases = {
  "better-auth": betterAuthPkg,
  "better-auth/plugins": path.join(betterAuthPkg, "dist/plugins/index.mjs"),
  "better-auth/adapters/prisma": path.join(
    betterAuthPkg,
    "dist/adapters/prisma-adapter/index.mjs",
  ),
  "better-auth/client/plugins": path.join(betterAuthPkg, "dist/client/plugins"),
  "better-auth/react": path.join(betterAuthPkg, "dist/client/react"),
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, coreDir, "");
  const hmrPublicHost =
    env.DEV_SERVER_HMR_HOST?.trim() || process.env.DEV_SERVER_HMR_HOST?.trim();
  const hmrClientPortRaw =
    env.DEV_SERVER_HMR_CLIENT_PORT?.trim() ||
    process.env.DEV_SERVER_HMR_CLIENT_PORT?.trim();
  const hmrClientPort = Number(hmrClientPortRaw || "443") || 443;

  return {
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
    resolve: {
      alias: {
        "@tabler/icons-react": "@tabler/icons-react/dist/esm/icons/index.mjs",
        ...betterAuthAliases,
      },
      dedupe: ["better-auth"],
    },
    ssr: {
      resolve: {
        alias: betterAuthSsrAliases,
        dedupe: ["better-auth"],
      },
    },
    optimizeDeps: {
      include: [
        "better-auth",
        "better-auth/client/plugins",
        "better-auth/react",
      ],
    },
    server: {
      port: 3000,
      // Apache reverse proxy sends Host: dev.eduai.ok.ubc.ca; Vite 6+ rejects unknown hosts by default.
      host: true,
      allowedHosts: true,
      fs: {
        allow: [monorepoRoot],
      },
      ...(hmrPublicHost
        ? {
            hmr: {
              protocol: "wss",
              host: hmrPublicHost,
              clientPort: hmrClientPort,
            },
          }
        : {}),
    },
  };
});