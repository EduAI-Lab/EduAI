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
    ssr: {
      // Server bundle is ESM (react-router default). Two packages need bundling:
      //   @tabler/icons-react — aliased to its .mjs file below; must be bundled
      //                         to honour the alias during SSR tree-shaking.
      //   @mendable/firecrawl-js — "type":"module", used in AI web tools.
      noExternal: ["@tabler/icons-react", "@mendable/firecrawl-js"],
    },
    define: {
      __dirname: "import.meta.dirname",
      __filename: "import.meta.filename",
    },
    resolve: {
      alias: {
        "@tabler/icons-react": "@tabler/icons-react/dist/esm/icons/index.mjs",
      },
      // Monorepo hoisting can give Radix/shadcn a second React copy → "useState of null" after HMR.
      dedupe: ["react", "react-dom"],
    },
    // Pre-bundle React at startup and streamdown + CJS deps so lazy loads stay ESM.
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "streamdown",
        "@streamdown/math",
        "style-to-js",
      ],
    },
    ssr: {
      noExternal: ["streamdown"],
    },
    server: {
      port: 3000,
      // Apache reverse proxy sends Host: dev.eduai.ok.ubc.ca; Vite 6+ rejects unknown hosts by default.
      host: true,
      allowedHosts: ["dev.eduai.ok.ubc.ca", "localhost", "127.0.0.1"],
      headers: {
        "Cache-Control": "no-store",
      },
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
