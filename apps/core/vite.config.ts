import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  resolve: {
    alias: {
      // /esm/icons/index.mjs only exports the icons statically, so no separate chunks are created
      '@tabler/icons-react': '@tabler/icons-react/dist/esm/icons/index.mjs',
    },
  },
  server: {
    // Apache reverse proxy sends Host: dev.eduai.ok.ubc.ca; Vite 6+ rejects unknown hosts by default.
    host: true,
    // Dev-only: allow any Host (avoids rebinding checks fighting the proxy). Prefer a closed list in vite preview/production.
    allowedHosts: true,
  },
});