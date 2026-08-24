/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_CORE_URL: string;
  readonly VITE_CANVAS_DEFAULT_URL?: string;
  readonly VITE_CANVAS_TEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
