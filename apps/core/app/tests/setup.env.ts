/**
 * Must run BEFORE any other setup file. `~/lib/auth/server`'s `betterAuth({...})`
 * call reads `BETTER_AUTH_DISABLE_RATE_LIMIT` synchronously at module-import
 * time, and setup.integration.ts's own imports (`./helpers/disciplines` ->
 * `~/lib/disciplines/server` -> `~/lib/auth/server`) pull that module in before
 * setup.integration.ts's body ever runs — so setting the flag there is too
 * late. This file has no imports of its own, so it's guaranteed to finish
 * before the next setupFile starts loading.
 */
process.env.BETTER_AUTH_DISABLE_RATE_LIMIT = "1";
