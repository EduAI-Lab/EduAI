import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse `/api/*` path patterns registered in `app/routes.ts`.
 * Used by agent-readiness tests so coverage tracks the real route registry
 * instead of a second handwritten list (#672 / PR #849).
 */
export function listApiRoutePathsFromRoutesSource(source: string): string[] {
  const paths = new Set<string>();
  for (const match of source.matchAll(/route\(\s*["'`](\/api\/[^"'`]+)["'`]/g)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

export function readCoreRoutesTsSource(): string {
  // tests/unit → ../../routes.ts ; lib/agent-readiness → ../../routes.ts
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "../../routes.ts"), "utf8");
}

/** True when a routes.ts path is represented in the readiness manifest. */
export function manifestCoversRoutePath(
  routePath: string,
  manifestPaths: Iterable<string>,
): boolean {
  const paths = [...manifestPaths];
  if (paths.includes(routePath)) return true;
  if (routePath.endsWith("/*")) {
    const base = routePath.slice(0, -2);
    return paths.some((p) => p === base || p.startsWith(`${base}/`));
  }
  return false;
}
