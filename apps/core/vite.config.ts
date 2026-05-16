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
const betterAuthRoot = path.join(monorepoRoot, "node_modules", "better-auth");
// Vite matches import specifiers exactly; aliasing only "better-auth" does not rewrite
// subpath imports like "better-auth/plugins", which was still resolving to 1.6.x.
const betterAuthAliases = {
  "better-auth": betterAuthRoot,
  "better-auth/plugins": path.join(betterAuthRoot, "dist/plugins/index.mjs"),
  "better-auth/adapters/prisma": path.join(
    betterAuthRoot,
    "dist/adapters/prisma-adapter/index.mjs",
  ),
  "better-auth/client/plugins": path.join(
    betterAuthRoot,
    "dist/client/plugins/index.mjs",
  ),
  "better-auth/react": path.join(betterAuthRoot, "dist/client/react/index.mjs"),
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