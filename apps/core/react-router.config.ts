import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Enables root-route middleware (#982) so security headers reach every
  // response — including `/api/*` resource routes, which bypass entry.server.
  future: { v8_middleware: true },
} satisfies Config;
