import path from "node:path";
import { fileURLToPath } from "node:url";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Dependencies are hoisted to the monorepo root while Vite root is apps/core.
// Without this, /@fs/… requests into root node_modules hit "outside of Vite serving allow list".
const coreDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(coreDir, "../..");
const betterAuthPkg = path.join(monorepoRoot, "node_modules", "better-auth");

/** Pin every better-auth import to hoisted 1.2.8 (ai-tutor may install 1.6.x under workspaces). */
function resolveBetterAuth126(): Plugin {
  const entrypoints: Record<string, string> = {
    "better-auth": path.join(betterAuthPkg, "dist/index.mjs"),
    "better-auth/plugins": path.join(betterAuthPkg, "dist/plugins/index.mjs"),
    "better-auth/adapters/prisma": path.join(
      betterAuthPkg,
      "dist/adapters/prisma-adapter/index.mjs",
    ),
    "better-auth/client/plugins": path.join(
      betterAuthPkg,
      "dist/client/plugins/index.mjs",
    ),
    "better-auth/react": path.join(betterAuthPkg, "dist/client/react/index.mjs"),
  };

  return {
    name: "resolve-better-auth-1.2.8",
    enforce: "pre",
    resolveId(source) {
      const resolved = entrypoints[source];
      return resolved ?? null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, coreDir, "");
  const hmrPublicHost =
    env.DEV_SERVER_HMR_HOST?.trim() || process.env.DEV_SERVER_HMR_HOST?.trim();
  const hmrClientPortRaw =
    env.DEV_SERVER_HMR_CLIENT_PORT?.trim() ||
    process.env.DEV_SERVER_HMR_CLIENT_PORT?.trim();
  const hmrClientPort = Number(hmrClientPortRaw || "443") || 443;

  return {
    plugins: [resolveBetterAuth126(), tailwindcss(), reactRouter(), tsconfigPaths()],
    resolve: {
      alias: {
        "@tabler/icons-react": "@tabler/icons-react/dist/esm/icons/index.mjs",
      },
      dedupe: ["better-auth"],
    },
    optimizeDeps: {
      // Pre-bundling better-auth produces stale/missing chunks in this monorepo layout.
      exclude: [
        "better-auth",
        "better-auth/plugins",
        "better-auth/client/plugins",
        "better-auth/react",
        "better-auth/adapters/prisma",
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
