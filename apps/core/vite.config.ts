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
      // react-router 7.18 externalises @tabler/icons-react, which resolves via
      // the alias below to an .mjs file. Node 20 (Docker) cannot require() .mjs
      // (ERR_REQUIRE_ESM). Bundling it lets Vite transpile ESM→CJS at build
      // time so there is no runtime .mjs require in the server bundle.
      noExternal: ["@tabler/icons-react"],
    },
    resolve: {
      // Pin one copy for core (1.2.8 via root overrides). Do not alias the package root — that
      // breaks subpath exports such as better-auth/client/plugins.
      alias: {
        "@tabler/icons-react": "@tabler/icons-react/dist/esm/icons/index.mjs",
      },
      // Monorepo hoisting can give Radix/shadcn a second React copy → "useState of null" after HMR.
      dedupe: ["react", "react-dom", "better-auth"],
    },
    // Force React to be pre-bundled at startup so Vite never discovers it lazily during
    // a first client-side navigation.
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client"],
    },
    server: {
      port: 3000,
      // Apache reverse proxy sends Host: dev.eduai.ok.ubc.ca; Vite 6+ rejects unknown hosts by default.
      host: true,
      allowedHosts: ["dev.eduai.ok.ubc.ca", "localhost", "127.0.0.1"],
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
