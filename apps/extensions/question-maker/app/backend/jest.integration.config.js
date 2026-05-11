/**
 * Runs only *.integration.test.js with a single worker to avoid clobbering
 * a shared test database from parallel files.
 * Uses TEST_DATABASE_URL (see test/setup.js) — do not point at production data.
 */
import config from './jest.config.js';

export default {
  ...config,
  testPathIgnorePatterns: [],
  testMatch: ['**/test/**/*.integration.test.js'],
  maxWorkers: 1,
};
