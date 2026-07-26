import path from "node:path";
import { fileURLToPath } from "node:url";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Dependencies are hoisted to the monorepo root while Vite root is apps/core.
// Without this, /@fs/… requests into root node_modules hit "outside of Vite serving allow list".
const coreDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(coreDir, "../..");

// Vendor-splitting strategy for the client bundle (issue #1039).
//
// Vite's default chunking co-bundled domain UI with framework code into
// shared chunks with effectively random names (recharts once landed in a
// chunk named after a Shiki grammar). We pin:
//   vendor-react — react/react-dom/scheduler/react-router: stable,
//                  long-cacheable, changes only on framework upgrades.
// Deliberately NOT pinned:
//   shiki / streamdown / katex — these split themselves via internal dynamic
//           imports (per-language grammars, lazy code/math pipelines).
//           Pinning any of them merges the lazy halves into one eager chunk
//           that every route then pays for (verified: +1MB initial JS per
//           route when streamdown/katex were pinned).
//   everything else (Radix, lucide, recharts, domain code) — Rollup's
//           route-level splitting handles these; a catch-all vendor chunk
//           would inflate initial JS for every route.
//
// Module ids reach plugins posix-normalized, but the separator class keeps the
// match correct even if a raw Windows path (`\node_modules\react\`) slips in.
function manualChunks(id: string): string | undefined {
  if (
    /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(
      id,
    )
  ) {
    return "vendor-react";
  }
  return undefined;
}

export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, coreDir, "");
  const hmrPublicHost =
    env.DEV_SERVER_HMR_HOST?.trim() || process.env.DEV_SERVER_HMR_HOST?.trim();
  const hmrClientPortRaw =
    env.DEV_SERVER_HMR_CLIENT_PORT?.trim() ||
    process.env.DEV_SERVER_HMR_CLIENT_PORT?.trim();
  const hmrClientPort = Number(hmrClientPortRaw || "443") || 443;

  return {
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
      // ANALYZE=1 npm run build → treemap at build/client-bundle-stats.html
      // Client build only — the SSR pass runs last and would clobber the file.
      ...(process.env.ANALYZE && !isSsrBuild
        ? [
            visualizer({
              filename: "build/client-bundle-stats.html",
              gzipSize: true,
            }),
          ]
        : []),
    ],
    build: {
      // Emit .vite/manifest.json so scripts/bundle-report.mjs can compute
      // per-route initial JS (issue #1039).
      manifest: true,
      // Client build only — the SSR bundle is a single file and the React
      // Router server build rejects manualChunks.
      ...(isSsrBuild
        ? {}
        : { rollupOptions: { output: { manualChunks } } }),
    },
    ssr: {
      // Server bundle is ESM (react-router default). Packages that need bundling:
      //   @tabler/icons-react — aliased to its .mjs file below; must be bundled
      //                         to honour the alias during SSR tree-shaking.
      //   @mendable/firecrawl-js — "type":"module", used in AI web tools.
      //   streamdown — CJS/ESM interop for markdown streaming in SSR.
      noExternal: ["@tabler/icons-react", "@mendable/firecrawl-js", "streamdown"],
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
    // Pre-bundle React, the router runtime, and streamdown's CJS dependencies
    // at startup so client navigation and lazy markdown loads stay on one
    // optimizer generation and remain ESM-compatible.
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react-router",
        "streamdown",
        "@streamdown/math",
        "style-to-js",
      ],
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
