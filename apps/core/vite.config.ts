import path from "node:path";
import { fileURLToPath } from "node:url";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Dependencies are hoisted to the monorepo root (…/EduAICore/node_modules) while Vite root is apps/core.
// Without this, /@fs/… requests into root node_modules hit "outside of Vite serving allow list".
const coreDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(coreDir, "../..");

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
        // /esm/icons/index.mjs only exports the icons statically, so no separate chunks are created
        "@tabler/icons-react": "@tabler/icons-react/dist/esm/icons/index.mjs",
      },
    },
    server: {
      // Apache reverse proxy sends Host: dev.eduai.ok.ubc.ca; Vite 6+ rejects unknown hosts by default.
      host: true,
      // Dev-only: allow any Host (avoids rebinding checks fighting the proxy). Prefer a closed list in vite preview/production.
      allowedHosts: true,
      fs: {
        allow: [monorepoRoot],
      },
      // Browser hits https://PUBLIC_HOST/ while Vite listens on localhost. Without this, HMR tries
      // wss://PUBLIC_HOST (wrong port/path) or ws://localhost:5173 (cross-origin / blocked).
      // Apache (or any front proxy) must forward WebSocket upgrades to this Vite port — see
      // https://vite.dev/config/server-options.html#server-hmr
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