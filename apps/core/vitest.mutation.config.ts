import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const coreDir = path.dirname(fileURLToPath(import.meta.url));

function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (!fs.existsSync(path.join(dir, 'packages', 'ui'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate monorepo root (packages/ui) starting from ${startDir}`);
    }
    dir = parent;
  }
  return dir;
}

const rootDir = findMonorepoRoot(coreDir);

// Stryker's coverage-analysis dry run must run this suite's full include set
// once, green, before mutating — and the whole 199-file app/tests/unit suite
// takes ~20 minutes here, well past Stryker's dry-run timeout, and includes
// embedding.rag-settings.test.ts (requires local Ollama — a pre-existing,
// unrelated environmental gap). Narrow to just the test files that exercise
// the RBAC/auth/canvas-encryption modules Stryker mutates (found via grep
// for imports of those modules across app/tests/unit).
//
// Deliberately NOT built via mergeConfig(baseConfig, {...}): vitest/vite's
// mergeConfig concatenates array fields rather than overriding them, so
// merging a narrow `include` onto vitest.config.ts's catch-all glob would
// still match every file. Duplicating the base config's plugins/resolve/test
// settings here keeps `include` a true override.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@eduai/ui/term': path.resolve(rootDir, 'packages/ui/src/lib/term.ts'),
      '@eduai/ui': path.resolve(rootDir, 'packages/ui/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    fileParallelism: false,
    setupFiles: ['./app/tests/setup.ts'],
    include: [
      'app/tests/unit/admin-bug-reports.test.ts',
      'app/tests/unit/agent-tools.admin-context.test.ts',
      'app/tests/unit/agent-tools.course-context.test.ts',
      'app/tests/unit/ai-config.rbac.test.ts',
      'app/tests/unit/auth.registration.route.test.ts',
      'app/tests/unit/canvas.route.test.ts',
      'app/tests/unit/canvas-encryption.test.ts',
      'app/tests/unit/canvas-guards.test.ts',
      'app/tests/unit/canvas-integration.server.test.ts',
      'app/tests/unit/canvas-link-roster.test.ts',
      'app/tests/unit/canvas-materials-exclusions.route.test.ts',
      'app/tests/unit/chat.rbac.test.ts',
      'app/tests/unit/chat.web-tools.route.test.ts',
      'app/tests/unit/chat-abort.route.test.ts',
      'app/tests/unit/chat-admin-budget.route.test.ts',
      'app/tests/unit/chat-always-on-rag.route.test.ts',
      'app/tests/unit/chat-oversight.route.test.ts',
      'app/tests/unit/chats.visibility.test.ts',
      'app/tests/unit/chat-stream-error-logging.route.test.ts',
      'app/tests/unit/course-access.server.test.ts',
      'app/tests/unit/courses.canvas-materials.route.test.ts',
      'app/tests/unit/courses.enrollments.enrollmentId.test.ts',
      'app/tests/unit/courses.enrollments.test.ts',
      'app/tests/unit/courses.id.test.ts',
      'app/tests/unit/courses.materials.test.ts',
      'app/tests/unit/courses.rag-settings-cache.test.ts',
      'app/tests/unit/courses.response-style.route.test.ts',
      'app/tests/unit/courses.server.test.ts',
      'app/tests/unit/courses.tas.route.test.ts',
      'app/tests/unit/courses.topics.test.ts',
      'app/tests/unit/cron.notify-api-key-expiry.route.test.ts',
      'app/tests/unit/guards.server.test.ts',
      'app/tests/unit/invitations.route.test.ts',
      'app/tests/unit/me.test.ts',
      'app/tests/unit/password-expiry.test.ts',
      'app/tests/unit/password-history.test.ts',
      'app/tests/unit/password-policy.test.ts',
      'app/tests/unit/permissions.test.ts',
      'app/tests/unit/policies.route.test.ts',
      'app/tests/unit/rate-limit.server.test.ts',
      'app/tests/unit/user-provider-settings.server.test.ts',
      'app/tests/unit/users.rbac.test.ts',
    ],
  },
});
